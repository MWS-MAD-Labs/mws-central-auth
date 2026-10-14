const { createHubSession } = require('mws-central-auth/server');

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
}

// The Hub's shared session: a short access token in a cookie on the parent domain, checked against the Hub's keys.
function hub() {
    return createHubSession({ hubBaseUrl: required('HUB_BASE_URL') });
}

module.exports = { hub, required };
