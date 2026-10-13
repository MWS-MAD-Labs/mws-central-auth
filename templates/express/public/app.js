import { watchSession } from '/vendor/central-auth-client.js';

const status = document.getElementById('status');
const logout = document.getElementById('logout');
const error = new URLSearchParams(location.search).get('error');

async function loadMe() {
    const response = await fetch('/api/me', { cache: 'no-store' });
    return response.ok ? response.json() : null;
}

(async () => {
    if (error) {
        status.textContent = error === 'no_access' ? 'You do not have access to this application.' : 'Sign-in failed. Try again from the Hub.';
        return;
    }
    const me = await loadMe();
    if (!me) {
        location.href = '/';
        return;
    }
    status.textContent = `Signed in as ${me.email} (${me.role}).`;
    logout.hidden = false;

    // When a sign-out in another app ends this session, leave when the tab is looked at again.
    watchSession({
        check: async () => (await fetch('/api/me', { cache: 'no-store' })).ok,
        onRevoked: () => {
            location.href = '/';
        },
    });
})();
