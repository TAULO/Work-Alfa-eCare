// JS equivalent of GetAllRequestsFromTaskList.xaml for the ROS group (SearchCriteria_Group="ROS", Status="Nytt", Template="Behörighet").
// Requires Node 18+ (global fetch).
const BASE_URL = process.env.SDPLUS_BASE_URL;   // Orchestrator asset "SDPlus_BaseUrl"
const API_KEY = process.env.SDPLUS_API_KEY;      // Orchestrator asset "SDPlus_APIKey_Value"

// Mirrors "Format Search Criteria As Json.xaml": one {field, condition, value} block per
// criterion, joined with "logical_operator":"and", wrapped in [] when there is more than one.
function buildSearchCriteriaJson({ group, status, template }) {
    const criteria = [];
    if (group) criteria.push({ field: "group.name", condition: "is", value: group });
    if (status) criteria.push({ field: "status.name", condition: "is", value: status });
    if (template) criteria.push({ field: "template.name", condition: "starts with", value: template });

    criteria.forEach((c, i) => {
        if (i > 0) c.logical_operator = "and";
    });

    const search_criteria = criteria.length > 1 ? criteria : criteria[0];
    return JSON.stringify({ list_info: { row_count: 150, search_criteria } });
}

// Mirrors the "HTTP Request" (ui:HttpClient) activity + RetryScope (3 retries, expects 200).
async function callSdPlus(endpoint, inputData, retries = 3) {
    const url = `${BASE_URL}${endpoint}`;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(`${url}?input_data=${encodeURIComponent(inputData)}`, {
            method: "GET",
            headers: { AUTHTOKEN: API_KEY },
        });

        if (response.status === 200) {
            return response.json();
        }
        lastError = new Error(`Status code: ${response.status}. Response message: ${await response.text()}`);
    }
    throw lastError;
}

// Mirrors "Get List Task.xaml" (endpoint api/v3/tasks).
async function getListTask(searchCriteria) {
    const inputData = buildSearchCriteriaJson(searchCriteria);
    return callSdPlus("api/v3/tasks", inputData);
}

// Mirrors "Get Request.xaml" (endpoint api/v3/requests/{id}).
async function getRequest(requestId) {
    return callSdPlus(`api/v3/requests/${requestId}`);
}

// Mirrors "GetAllRequestsFromTaskList.xaml": fetch tasks, resolve each task's request,
// skip requests already flagged for manual handling.
async function getAllNewRosTasks() {
    const { tasks } = await getListTask({ group: "ROS", status: "Nytt", template: "Behörighet" });
    const allaArenden = [];

    for (const task of tasks) {
        if (!task.request?.id) continue;

        const requestResponse = await getRequest(task.request.id);
        const resolutionContent = requestResponse.request?.resolution?.content ?? "";
        if (resolutionContent.toLowerCase().includes("manuell hantering")) continue;

        requestResponse.TaskId = task.id;
        allaArenden.push(requestResponse);
    }

    return allaArenden;
}

module.exports = { getAllNewRosTasks };

// ================================================================================================ UPDATE ================================================================================================
// JS equivalent of UiPath_ServiceDeskPlus_Lib/Tasks/Edit Task.xaml (the PUT request that
// updates a task's status/owner on a request). Requires Node 18+ (global fetch).
const BASE_URL = process.env.SDPLUS_BASE_URL;  // Orchestrator asset "SDPlus_BaseUrl"
const API_KEY = process.env.SDPLUS_API_KEY;     // Orchestrator asset "SDPlus_APIKey_Value"

// Mirrors the "Switch - System" block: each system has its own task template id.
const SYSTEM_TASK_ID = {
    aweria: "901",
    paratus: "1205",
    cytodos: "902",
    "flexlab kemi": "2758",
    "p-mobile": "6301",
    obstetrix: "1203",
    ros: "601",
};

// Mirrors "Switch - Status": maps a status name to SD+'s numeric status id + completion %.
const STATUS_MAP = {
    löst: { id: "4", percentage_completion: 100 },
    pågående: { id: "6", percentage_completion: 0 },
    nytt: { id: "2", percentage_completion: 0 },
};

// Mirrors "Get Request Tasks.xaml" (GET api/v3/requests/{id}/tasks).
async function getRequestTasks(requestId) {
    const url = `${BASE_URL}api/v3/requests/${requestId}/tasks`;
    const response = await fetch(url, { method: "GET", headers: { AUTHTOKEN: API_KEY } });
    if (response.status !== 200) {
        throw new Error(`Status code: ${response.status}. Response message: ${await response.text()}`);
    }
    return response.json();
}

// Mirrors the "HTTP Request" (ui:HttpClient, Method="PUT") + RetryScope (3 retries, expects 200).
async function putTaskUpdate(requestId, taskId, inputData, retries = 3) {
    const url = `${BASE_URL}api/v3/requests/${requestId}/tasks/${taskId}`;
    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {
        const response = await fetch(url, {
            method: "PUT",
            headers: { AUTHTOKEN: API_KEY, "Content-Type": "application/x-www-form-urlencoded" },
            body: `input_data=${encodeURIComponent(inputData)}`,
        });

        if (response.status === 200) {
            return response.json();
        }
        lastError = new Error(`Status code: ${response.status}. Response message: ${await response.text()}`);
    }
    throw lastError;
}

// Mirrors "Edit Task.xaml": find the matching task by template id, update status/owner,
// then PUT the updated task back. editOwner: "true" | "false" | '{"name":"...","id":"..."}'.
async function editTask(requestId, system, editStatus, editOwner = "false") {
    const taskId = SYSTEM_TASK_ID[system.toLowerCase()];
    if (!taskId) throw new Error(`Ingen task-id konfigurerad för system: ${system}`);

    const statusInfo = STATUS_MAP[editStatus.toLowerCase()];
    if (!statusInfo) throw new Error(`Kan inte ändra status. Status behöver läggas till i Lib: ${editStatus}`);

    const { tasks } = await getRequestTasks(requestId);
    const task = tasks.find((t) => t.template.id === taskId);
    if (!task) throw new Error(`Hittade ingen task med template id ${taskId} på ärende ${requestId}`);

    task.status.name = editStatus;
    task.status.id = statusInfo.id;
    task.percentage_completion = statusInfo.percentage_completion;

    if (editOwner.toLowerCase() !== "false") {
        task.owner = editOwner.toLowerCase() === "true" ? task.owner : JSON.parse(editOwner);
    }

    const updatedTask = {
        id: task.id,
        index: task.index,
        template: task.template,
        status: task.status,
        percentage_completion: task.percentage_completion,
        owner: task.owner,
    };

    const inputData = JSON.stringify({ tasks: [updatedTask] });
    return putTaskUpdate(requestId, taskId, inputData);
}

module.exports = { editTask };