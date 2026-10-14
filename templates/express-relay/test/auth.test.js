const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, describe, it } = require('node:test');

// A pretend Hub: it publishes its signing key and trades a code for a relay token.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const APP_ID = 'my-new-app';
const ORG_ID = 'org_my_new_app_test';
const APP_SECRET = 'app-secret';

function relayToken({ jti, entitlement }) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = encode({ alg: 'RS256', kid: 'test-key' });
    const body = encode({
        iss: 'mws-hub',
        aud: APP_ID,
        sub: 'person-1',
        email: 'person@example.com',
        source: 'employee',
        tags: [],
        ...(entitlement ? { entitlement } : {}),
        jti,
        iat: now,
        exp: now + 30,
    });
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
    return `${head}.${body}.${signature}`;
}

const entitlement = {
    id: 'ent-1',
    application_id: APP_ID,
    organization_id: ORG_ID,
    role: 'STAFF',
    permissions: ['things.read'],
    version: 1,
};
const codes = {
    'good-code': () => relayToken({ jti: '11111111-1111-4111-8111-111111111111', entitlement }),
    'again-code': () => relayToken({ jti: '11111111-1111-4111-8111-111111111111', entitlement }),
    'no-access-code': () => relayToken({ jti: '22222222-2222-4222-8222-222222222222', entitlement: { ...entitlement, permissions: [] } }),
};

let hub;
let appServer;
let base;

before(async () => {
    hub = http.createServer((req, res) => {
        if (req.url === '/.well-known/jwks.json') return res.end(JSON.stringify({ keys: [jwk] }));
        if (req.url === '/sso/exchange' && req.method === 'POST') {
            let raw = '';
            req.on('data', (chunk) => (raw += chunk));
            req.on('end', () => {
                const body = JSON.parse(raw);
                const make = codes[body.code];
                if (req.headers['x-hub-internal-secret'] !== APP_SECRET || body.appId !== APP_ID || !make) {
                    res.statusCode = 400;
                    return res.end('{}');
                }
                res.end(JSON.stringify({ data: { token: make() } }));
            });
            return;
        }
        res.statusCode = 404;
        res.end();
    });
    await new Promise((resolve) => hub.listen(0, resolve));
    const hubUrl = `http://localhost:${hub.address().port}`;

    process.env.HUB_BASE_URL = hubUrl;
    process.env.HUB_SSO_APP_ID = APP_ID;
    process.env.HUB_INTERNAL_SECRET = APP_SECRET;
    process.env.CENTRAL_ORGANIZATION_ID = ORG_ID;
    process.env.HUB_SSO_JWKS_URL = `${hubUrl}/.well-known/jwks.json`;
    process.env.SESSION_SECRET = 'test-session-secret';

    const { createApp } = require('../src/server');
    appServer = createApp().listen(0);
    await new Promise((resolve) => appServer.on('listening', resolve));
    base = `http://localhost:${appServer.address().port}`;
});

after(() => {
    hub.close();
    appServer.close();
});

const get = (path, cookie) => fetch(`${base}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const cookieOf = (response, name) => {
    const line = response.headers.getSetCookie().find((entry) => entry.startsWith(`${name}=`));
    return line ? line.split(';')[0] : null;
};

describe('the starter app', () => {
    let session;

    it('sends a visit without a session to the Hub front page', async () => {
        const response = await get('/');
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), `${process.env.HUB_BASE_URL}/`);
    });

    it('starts its own round when the Hub started the login (a card click has no state)', async () => {
        const response = await get('/auth/sso?code=good-code');
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/auth/hub');
    });

    it('rejects a state that does not match the cookie', async () => {
        const response = await get('/auth/sso?code=good-code&state=forged', 'mws_sso_state=something-else');
        assert.equal(response.headers.get('location'), '/?error=sso');
    });

    it('signs the person in after the Hub round trip', async () => {
        const started = await get('/auth/hub');
        const launch = new URL(started.headers.get('location'));
        assert.equal(launch.pathname, `/apps/${APP_ID}/launch`);
        const state = launch.searchParams.get('state');
        const stateCookie = cookieOf(started, 'mws_sso_state');
        assert.ok(state && stateCookie);

        const back = await get(`/auth/sso?code=good-code&state=${state}`, stateCookie);
        assert.equal(back.headers.get('location'), '/');
        session = cookieOf(back, 'app_session');
        assert.ok(session);

        const me = await get('/api/me', session);
        assert.equal(me.status, 200);
        assert.deepEqual(await me.json(), { id: 'person-1', email: 'person@example.com', role: 'STAFF', permissions: ['things.read'] });
    });

    it('does not accept the same relay token twice', async () => {
        const started = await get('/auth/hub');
        const state = new URL(started.headers.get('location')).searchParams.get('state');
        const back = await get(`/auth/sso?code=again-code&state=${state}`, cookieOf(started, 'mws_sso_state'));
        assert.equal(back.headers.get('location'), '/?error=sso');
    });

    it('refuses a person the application has no permissions for', async () => {
        const started = await get('/auth/hub');
        const state = new URL(started.headers.get('location')).searchParams.get('state');
        const back = await get(`/auth/sso?code=no-access-code&state=${state}`, cookieOf(started, 'mws_sso_state'));
        assert.equal(back.headers.get('location'), '/?error=no_access');
    });

    it('lets the Hub end sessions, and only with the right secret', async () => {
        const call = (secret) =>
            fetch(`${base}/auth/revoke-session`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-hub-internal-secret': secret },
                body: JSON.stringify({ email: 'person@example.com', central_id: 'person-1' }),
            });
        assert.equal((await call('wrong')).status, 401);
        assert.equal((await get('/api/me', session)).status, 200);

        const accepted = await call(APP_SECRET);
        assert.equal(accepted.status, 200);
        assert.deepEqual(await accepted.json(), { revoked: true });
        assert.equal((await get('/api/me', session)).status, 401);
    });

    it('logs out to the Hub logout address with who signed out', async () => {
        const response = await get('/auth/logout');
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), `${process.env.HUB_BASE_URL}/auth/logout`);
    });
});
