// The app's own record of a signed-in person. In memory here so the starter runs on its own:
// replace this file with your database (Mongo, Postgres). Keep the same four functions.
//
// sessionVersion is what makes a sign-out elsewhere stick: bumping it makes every session cookie issued
// before that point invalid.
const users = new Map();

// Called after a verified sign-in. The Hub's entitlement says what this person may do here.
function upsertFromRelay(relay) {
    const current = users.get(relay.sub);
    const user = {
        id: relay.sub,
        email: relay.email,
        role: relay.entitlement.role,
        permissions: relay.entitlement.permissions,
        entitlementVersion: relay.entitlement.version,
        sessionVersion: current ? current.sessionVersion : 0,
    };
    users.set(relay.sub, user);
    return user;
}

function findById(id) {
    return users.get(id) ?? null;
}

// Ends the sessions of one person, or of everybody when `all` is true. Returns whether anyone was affected.
function endSessions({ personId, email, all }) {
    let affected = 0;
    for (const user of users.values()) {
        if (all || (personId && user.id === personId) || (email && user.email === email.toLowerCase())) {
            user.sessionVersion += 1;
            affected += 1;
        }
    }
    return affected > 0;
}

module.exports = { upsertFromRelay, findById, endSessions };
