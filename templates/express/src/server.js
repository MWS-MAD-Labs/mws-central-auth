const path = require('node:path');
const express = require('express');
const { accessFor } = require('./access');
const { hub, required } = require('./hub');

// Who is on this request: the Hub's identity plus what Central says they may do here.
async function identify(req) {
    const claims = await hub().fromCookieHeader(req.get('cookie'));
    if (!claims) return { claims: null, user: null };
    const access = await accessFor(claims.sub);
    return { claims, user: access ? { id: claims.sub, email: claims.email, ...access } : null };
}

// For routes that need a signed-in person. `permission` is a Central permission key.
function requireUser(permission) {
    return async (req, res, next) => {
        try {
            const { claims, user } = await identify(req);
            if (!claims) return res.status(401).json({ error: 'Not signed in' });
            if (!user) return res.status(403).json({ error: 'No access to this application' });
            if (permission && !user.permissions.includes(permission)) return res.status(403).json({ error: 'Not allowed' });
            req.claims = claims;
            req.user = user;
            next();
        } catch (error) {
            console.error('Could not check access:', error.message);
            res.status(503).json({ error: 'Try again shortly' });
        }
    };
}

function createApp() {
    const app = express();

    // The browser half (keeping the token fresh) is served straight from the package.
    app.get('/vendor/central-auth-client.js', (req, res) => {
        const dir = path.dirname(require.resolve('mws-central-auth/client'));
        res.type('js').sendFile(path.join(dir, 'index.js'));
    });

    // Where the Hub's card opens the app (the launch address Central keeps). There is nothing to sign in to: the
    // session is read from the Hub's cookie, so this only sends the browser to the page.
    app.get('/auth/sso', (req, res) => res.redirect('/'));

    // The page. No session: the Hub restores one if the person still has it, or shows its front page.
    app.get('/', async (req, res, next) => {
        const session = hub();
        const { claims } = await identify(req).catch(() => ({ claims: null }));
        const step = session.step({ claims, restored: 'restored' in req.query });
        if (step === 'ok') return next();
        if (step === 'restore') return res.redirect(session.restoreUrl(new URL('/', required('APP_PUBLIC_URL')).toString()));
        res.redirect(session.homeUrl());
    });

    app.get('/api/me', requireUser(), (req, res) => {
        const session = hub();
        const { id, email, role, permissions } = req.user;
        res.json({
            id,
            email,
            role,
            permissions,
            hub: { homeUrl: session.homeUrl(), refreshUrl: session.refreshUrl() },
            expiresIn: Math.max(req.claims.exp - Math.floor(Date.now() / 1000), 0),
        });
    });

    // Example of a route that needs one of the permissions Central gave the person in this application.
    app.get('/api/things', requireUser('things.read'), (req, res) => res.json({ things: [] }));

    app.use(express.static(path.join(__dirname, '..', 'public')));
    return app;
}

if (require.main === module) {
    const port = process.env.PORT || 3100;
    createApp().listen(port, () => console.log(`Listening on ${port}`));
}

module.exports = { createApp, requireUser, identify };
