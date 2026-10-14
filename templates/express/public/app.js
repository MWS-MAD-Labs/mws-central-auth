import { keepFresh } from '/vendor/central-auth-client.js';

const status = document.getElementById('status');
const hubLink = document.getElementById('hub');

(async () => {
    const response = await fetch('/api/me', { cache: 'no-store' });
    if (response.status === 403) {
        status.textContent = 'You do not have access to this application.';
        return;
    }
    if (!response.ok) {
        // The session is gone: the page asks the server again, which sends the person to the Hub.
        location.href = '/';
        return;
    }
    const me = await response.json();
    status.textContent = `Signed in as ${me.email} (${me.role}).`;
    hubLink.href = me.hub.homeUrl;
    hubLink.hidden = false;

    // Ask the Hub for a new token shortly before this one ends. Signing out of the Hub ends the session here too.
    keepFresh({
        refreshUrl: me.hub.refreshUrl,
        initialExpiresIn: me.expiresIn,
        onEnded: () => {
            location.href = me.hub.homeUrl;
        },
    });
})();
