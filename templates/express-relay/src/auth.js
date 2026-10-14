const express = require('express');
const { verifyRelayToken, InMemoryReplayStore } = require('mws-central-auth/server');
const { hubSso, cookieOptions, required } = require('./hubSso');
const { currentUser, endSession, startSession } = require('./session');
const { endSessions, upsertFromRelay } = require('./users');

const router = express.Router();
const replayStore = new InMemoryReplayStore();

// 1. A sign-in this app starts: to the Hub with a state, and a cookie that remembers it.
router.get('/hub', (req, res) => {
    try {
        const { url, cookie } = hubSso().launch.begin();
        res.cookie(cookie.name, cookie.value, cookieOptions(cookie));
        res.redirect(url);
    } catch {
        res.redirect('/?error=sso');
    }
});

// 2. The Hub sends the person back with a code.
router.get('/sso', async (req, res) => {
    let sso;
    try {
        sso = hubSso();
    } catch {
        return res.redirect('/?error=sso');
    }
    const { code, state } = req.query;
    const cookieName = sso.callback.clearCookie().name;
    const action = sso.callback.decide({ code, state, cookieState: req.cookies?.[cookieName] });
    // A card click in the Hub carries no state: start our own round, the Hub signs the person in again.
    if (action === 'restart') return res.redirect('/auth/hub');
    if (action === 'reject') return res.redirect('/?error=sso');
    res.clearCookie(cookieName, { path: '/' });

    try {
        const token = await sso.exchange(code, state);
        const relay = await verifyRelayToken(token, {
            audience: required('HUB_SSO_APP_ID'),
            jwksUrl: process.env.HUB_SSO_JWKS_URL || sso.jwksUrl(),
            replayStore,
        });
        const entitlement = relay.entitlement;
        // The Hub only sends an entitlement for people Central gave access to this application.
        if (
            !entitlement ||
            entitlement.application_id !== required('HUB_SSO_APP_ID') ||
            entitlement.organization_id !== required('CENTRAL_ORGANIZATION_ID') ||
            entitlement.permissions.length === 0
        ) {
            return res.redirect('/?error=no_access');
        }
        startSession(res, upsertFromRelay(relay));
        res.redirect('/');
    } catch (error) {
        console.error('Sign-in failed:', error.message);
        res.redirect('/?error=sso');
    }
});

// 3. The person pressed Logout: end this session, then let the Hub end the others and show its front page.
router.get('/logout', (req, res) => {
    const user = currentUser(req);
    endSession(res);
    let destination = '/';
    try {
        destination = hubSso().logoutUrl(user?.email);
    } catch {
        // Hub not configured: stay here
    }
    res.redirect(destination);
});

// 4. The Hub ends sessions: a person signed out of another app, or this application was retired.
router.post('/revoke-session', express.json(), async (req, res) => {
    let sso;
    try {
        sso = hubSso();
    } catch {
        return res.status(503).json({ revoked: false });
    }
    const result = await sso.revoke.handle({
        secret: req.get('x-hub-internal-secret'),
        body: req.body,
        apply: async (scope) => endSessions(scope),
    });
    res.status(result.status).json(result.body);
});

module.exports = router;
