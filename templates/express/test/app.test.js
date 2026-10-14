const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { after, before, beforeEach, describe, it } = require('node:test');

// A pretend Hub (publishes its signing key) and a pretend Central (answers entitlement lookups).
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const APP_ID = 'my-new-app';
const ORG_ID = 'org_my_new_app_test';

function accessToken(sub, over = {}) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
    const body = encode({
        iss: 'mws-hub',
        aud: 'mws-apps',
        sub,
        email: `${sub}@example.com`,
        source: 'employee',
        tags: [],
        sid: 'family-1',
        jti: crypto.randomUUID(),
        iat: now,
        exp: now + 300,
        ...over,
    });
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
    return `${head}.${body}.${signature}`;
}

const entitlement = (over = {}) => ({
    id: 'ent',
    organization_id: ORG_ID,
    role: 'STAFF',
    permissions: ['things.read'],
    version: 1,
    is_active: true,
    ...over,
});

let central = {};
let hubServer;
let centralServer;
let appServer;
let base;
let hubUrl;

before(async () => {
    hubServer = http.createServer((req, res) => {
        if (req.url === '/.well-known/jwks.json') return res.end(JSON.stringify({ keys: [jwk] }));
        res.statusCode = 404;
        res.end();
    });
    centralServer = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://central.test');
        const answer = central[url.searchParams.get('person_id')];
        if (!answer) return res.end(JSON.stringify({ data: null }));
        res.statusCode = answer.status ?? 200;
        res.end(JSON.stringify(answer.body));
    });
    await Promise.all([new Promise((r) => hubServer.listen(0, r)), new Promise((r) => centralServer.listen(0, r))]);
    hubUrl = `http://localhost:${hubServer.address().port}`;

    process.env.HUB_BASE_URL = hubUrl;
    process.env.HUB_SSO_APP_ID = APP_ID;
    process.env.CENTRAL_API_BASE_URL = `http://localhost:${centralServer.address().port}`;
    process.env.CENTRAL_API_TOKEN = 'token';
    process.env.CENTRAL_ORGANIZATION_ID = ORG_ID;
    process.env.APP_PUBLIC_URL = 'http://app.test';

    appServer = require('../src/server').createApp().listen(0);
    await new Promise((resolve) => appServer.on('listening', resolve));
    base = `http://localhost:${appServer.address().port}`;
});

beforeEach(() => {
    central = { alice: { body: { data: entitlement() } } };
    require('../src/access').clearAccessCache();
});

after(() => {
    hubServer.close();
    centralServer.close();
    appServer.close();
});

const get = (path, token) =>
    fetch(`${base}${path}`, { redirect: 'manual', headers: token ? { cookie: `hub_at=${token}` } : {} });

describe('the starter app on the shared session', () => {
    it('asks the Hub to restore a session when a page comes without a token', async () => {
        const response = await get('/');
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), `${hubUrl}/auth/restore?return=${encodeURIComponent('http://app.test/')}`);
    });

    it('goes to the Hub front page, not in a loop, when the restore brought nothing back', async () => {
        const response = await get('/?restored=1');
        assert.equal(response.headers.get('location'), `${hubUrl}/`);
    });

    it('treats an expired token like no token', async () => {
        const now = Math.floor(Date.now() / 1000);
        const response = await get('/', accessToken('alice', { iat: now - 700, exp: now - 400 }));
        assert.match(response.headers.get('location'), /\/auth\/restore\?return=/);
    });

    it('serves the page and who the person is, with the role and permissions Central gave', async () => {
        const token = accessToken('alice');
        assert.equal((await get('/', token)).status, 200);
        const me = await get('/api/me', token);
        assert.equal(me.status, 200);
        const body = await me.json();
        assert.deepEqual(
            { email: body.email, role: body.role, permissions: body.permissions },
            { email: 'alice@example.com', role: 'STAFF', permissions: ['things.read'] },
        );
        assert.equal(body.hub.homeUrl, `${hubUrl}/`);
        assert.equal(body.hub.refreshUrl, `${hubUrl}/auth/refresh`);
        assert.ok(body.expiresIn > 280 && body.expiresIn <= 300);
    });

    it('answers 401 without a token', async () => {
        assert.equal((await get('/api/me')).status, 401);
    });

    it('answers 403 for a person Central gave no access to, and for another organization', async () => {
        assert.equal((await get('/api/me', accessToken('bob'))).status, 403);
        central.carol = { body: { data: entitlement({ organization_id: 'other-org' }) } };
        assert.equal((await get('/api/me', accessToken('carol'))).status, 403);
        central.dave = { body: { data: entitlement({ permissions: [] }) } };
        assert.equal((await get('/api/me', accessToken('dave'))).status, 403);
    });

    it('gives nobody access once Central says the application was retired', async () => {
        central.erin = { status: 403, body: { errors: 'Application retired', code: 'application_retired' } };
        assert.equal((await get('/api/me', accessToken('erin'))).status, 403);
    });

    it('answers 503, not a wrong yes or no, when Central cannot be asked', async () => {
        central.frank = { status: 500, body: {} };
        assert.equal((await get('/api/me', accessToken('frank'))).status, 503);
    });

    it('protects a route with a Central permission', async () => {
        assert.equal((await get('/api/things', accessToken('alice'))).status, 200);
        central.gina = { body: { data: entitlement({ permissions: ['other.read'] }) } };
        assert.equal((await get('/api/things', accessToken('gina'))).status, 403);
    });

    it('opens from the Hub card with no code to handle', async () => {
        const response = await get('/auth/sso?code=ignored');
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/');
    });

    it('serves the browser half from the package', async () => {
        const response = await get('/vendor/central-auth-client.js');
        assert.equal(response.status, 200);
        assert.match(await response.text(), /keepFresh/);
    });
});
