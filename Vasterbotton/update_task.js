const token = "2c4cb07b328d8904fb8c778bbea870161130eca3db0e72d62b28785bb7b66a7bc77b103891b5b1729f72b404c99caac978404008080653b5d2c446b555d51752e155e3d9"
const updateTask = {
    "task": {
        "status": { name: "Nytt" }, // change if needed
    },
}

const requestId = "45958"; // change if needed
const taskId = "57836"; // change if needed

const body = 'input_data=' + encodeURIComponent(JSON.stringify(updateTask));
Http.put("https://sdp-test.vll.se/api/v3/requests/" + requestId + "/tasks/" + taskId, body, {
    headers: { 'AUTHTOKEN': token },
    contenttype: 'application/x-www-form-urlencoded',
    useWebRequest: true, // NOTE: Must be set to true - else we get the error message: "Det går inte att skicka en innehållstext med den här verbtypen."
});


const res = Http.get("https://sdp-test.vll.se/api/v3/requests/45958/tasks/57836", {
    headers: {
        'AUTHTOKEN': token,
    }
});

res.data



// === Below fails with 400 bad request
const endpoint = "https://sdp-test.vll.se/api/v3/requests/45980"
const inputData = "input_data=%7B%22request%22%3A%7B%22resolution%22%3A%7B%22content%22%3A%22%3Cdiv%20class%3D%5C%22sdp-ze-default-wrapper%5C%22%20style%3D%5C%22font-family%3A%20Calibri%2C%20Arial%3B%20font-size%3A%2010pt%5C%22%3E%3Cdiv%3Efff%3Cbr%20%2F%3E%3C%2Fdiv%3E%3C%2Fdiv%3E%3Cbr%20%2F%3E%3Cbr%20%2F%3Eundefined%3Cbr%20%2F%3E%3Cbr%20%2F%3Enull%20har%20f%C3%A5tt%20L%C3%A4sbeh%C3%B6righet%20till%20systemet%20Cytodos.%3Cbr%20%2F%3E2026-08-26%3Cbr%20%2F%3Ebot-rpadev01%3Cbr%3E%3Cbr%3Ebot-rpadev01%20har%20f%C3%A5tt%20L%C3%A4sbeh%C3%B6righet%20till%20systemet%20Cytodos.%3Cbr%3E2026-08-26%3Cbr%3Ebot-rpadev01%22%7D%7D%7D"
const token = "2c4cb07b328d8904fb8c778bbea870161130eca3db0e72d62b28785bb7b66a7bc77b103891b5b1729f72b404c99caac978404008080653b5d2c446b555d51752e155e3d9"

const res = Http.put(endpoint, inputData, {
    headers: { 'AUTHTOKEN': token },
    contenttype: 'application/x-www-form-urlencoded',
    useWebRequest: true, // NOTE: Must be set to true - else we get the error message: "Det går inte att skicka en innehållstext med den här verbtypen."
});

res


// UPDATE TASK OWNER TEST
const token = "2c4cb07b328d8904fb8c778bbea870161130eca3db0e72d62b28785bb7b66a7bc77b103891b5b1729f72b404c99caac978404008080653b5d2c446b555d51752e155e3d9";

function updateTaskOwner(ownerId) {
    return {
        task: {
            owner: { id: ownerId },
        },
    };
}

const requestId = "45981";
const taskId = "57849";
const ownerId = "3010"; // the technician/bot id — change to the real one

const body = 'input_data=' + encodeURIComponent(JSON.stringify(updateTaskOwner(ownerId)));

Http.put("https://sdp-test.vll.se/api/v3/requests/" + requestId + "/tasks/" + taskId, body, {
    headers: { 'AUTHTOKEN': token },
    contenttype: 'application/x-www-form-urlencoded',
    useWebRequest: true,
});

const res = Http.get("https://sdp-test.vll.se/api/v3/requests/" + requestId + "/tasks/" + taskId, {
    headers: { 'AUTHTOKEN': token },
});
res.data;