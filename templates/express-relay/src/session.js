const jwt = require('jsonwebtoken');
const { findById } = require('./users');

const COOKIE_NAME = 'app_session';
const MAX_AGE_SECONDS = 15 * 60;

function secret() {
    const value = process.env.SESSION_SECRET;
    if (!value) throw new Error('SESSION_SECRET is not set');
    return value;
}

const cookieOptions = () => ({
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
});

function startSession(res, user) {
    const token = jwt.sign({ sub: user.id, v: user.sessionVersion, ev: user.entitlementVersion }, secret(), {
        expiresIn: MAX_AGE_SECONDS,
    });
    res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_SECONDS * 1000 });
}

function endSession(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions());
}

// The person behind this request, or null. A session whose version is behind the stored one was ended
// (a sign-out in another app, or the application was retired).
function currentUser(req) {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return null;
    try {
        const claims = jwt.verify(token, secret());
        const user = findById(claims.sub);
        if (!user || user.sessionVersion !== claims.v || user.entitlementVersion !== claims.ev) return null;
        return user;
    } catch {
        return null;
    }
}

// Use on routes that need a signed-in person. `permission` is a Central permission key.
function requireSession(permission) {
    return (req, res, next) => {
        const user = currentUser(req);
        if (!user) return res.status(401).json({ error: 'Not signed in' });
        if (permission && !user.permissions.includes(permission)) return res.status(403).json({ error: 'Not allowed' });
        req.user = user;
        next();
    };
}

module.exports = { startSession, endSession, currentUser, requireSession };
