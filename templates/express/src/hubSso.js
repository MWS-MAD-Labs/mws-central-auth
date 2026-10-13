const { createHubSso } = require('mws-central-auth/server');

function required(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
}

// Everything about the Hub sign-in and sign-out flow comes from the shared package.
function hubSso() {
    return createHubSso({
        hubBaseUrl: required('HUB_BASE_URL'),
        appId: required('HUB_SSO_APP_ID'),
        internalSecret: required('HUB_INTERNAL_SECRET'),
    });
}

// Express cookie options from the package's cookie descriptor.
function cookieOptions(cookie) {
    return {
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        path: cookie.path,
        maxAge: cookie.maxAgeSeconds * 1000,
        secure: process.env.NODE_ENV === 'production',
    };
}

module.exports = { hubSso, cookieOptions, required };
