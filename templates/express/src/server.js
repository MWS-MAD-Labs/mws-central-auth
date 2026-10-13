const path = require('node:path');
const cookieParser = require('cookie-parser');
const express = require('express');
const authRouter = require('./auth');
const { hubSso } = require('./hubSso');
const { currentUser, requireSession } = require('./session');

function createApp() {
    const app = express();
    app.use(cookieParser());

    app.use('/auth', authRouter);

    // The browser half of the contract (see public/app.js) is served straight from the package.
    app.get('/vendor/central-auth-client.js', (req, res) => {
        const dir = path.dirname(require.resolve('mws-central-auth/client'));
        res.type('js').sendFile(path.join(dir, 'index.js'));
    });

    // A visit without a session goes to the Hub, where the person picks an app. The page itself is only
    // reachable with a session, except when it has an ?error to show.
    app.get('/', (req, res, next) => {
        if (currentUser(req) || req.query.error) return next();
        try {
            return res.redirect(hubSso().homeUrl());
        } catch {
            return next();
        }
    });

    app.get('/api/me', requireSession(), (req, res) => {
        const { id, email, role, permissions } = req.user;
        res.json({ id, email, role, permissions });
    });

    app.use(express.static(path.join(__dirname, '..', 'public')));
    return app;
}

if (require.main === module) {
    const port = process.env.PORT || 3100;
    createApp().listen(port, () => console.log(`Listening on ${port}`));
}

module.exports = { createApp };
