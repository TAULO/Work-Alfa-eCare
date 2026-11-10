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