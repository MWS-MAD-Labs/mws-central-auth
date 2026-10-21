const { createHubSession } = require('mws-central-auth/server');

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
}

// The Hub's shared session: a short access token in a cookie on the parent domain, checked against the Hub's keys.
// One session for the whole process: it remembers the cookie name the Hub reports.
let session;
function hub() {
    session ??= createHubSession({ hubBaseUrl: required('HUB_BASE_URL') });
    return session;
}

module.exports = { hub, required };
