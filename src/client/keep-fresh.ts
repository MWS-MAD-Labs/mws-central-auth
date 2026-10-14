// Browser side of the Hub's shared session: asks the Hub for a new access token shortly before the current one
// ends, so a page left open stays signed in for as long as the Hub session lasts. The cookies do the rest; this
// only has to make the request and know when to make it.

export interface KeepFreshOptions {
  // The Hub's refresh address (`session.refreshUrl()` on the server).
  refreshUrl: string;
  // Called when the Hub says the session is over (signed out, revoked, or no longer active).
  onEnded: () => void;
  // Seconds the current access token has left when this starts. Default 240.
  initialExpiresIn?: number;
  // Ask this many seconds before the end. Default 60.
  skewSeconds?: number;
  fetchImpl?: typeof fetch;
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  doc?: { visibilityState: string; addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] };
  win?: { addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] };
  now?: () => number;
  random?: () => number;
}

const RETRY_MS = 15_000;
const MAX_RETRIES = 5;

export function keepFresh(options: KeepFreshOptions): () => void {
  const doc = options.doc ?? (globalThis as { document?: KeepFreshOptions["doc"] }).document;
  const win = options.win ?? (globalThis as { window?: KeepFreshOptions["win"] }).window;
  const fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!fetchImpl) return () => {};
  const timers = options.timers ?? {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const skewMs = (options.skewSeconds ?? 60) * 1000;

  let stopped = false;
  let handle: unknown = null;
  let dueAt = 0;
  let retries = 0;
  let running = false;

  const schedule = (delayMs: number) => {
    if (handle !== null) timers.clearTimeout(handle);
    dueAt = now() + delayMs;
    handle = timers.setTimeout(refresh, delayMs);
  };

  async function refresh() {
    if (stopped || running) return;
    running = true;
    try {
      const response = await fetchImpl!(options.refreshUrl, {
        method: "POST",
        credentials: "include",
        headers: { "X-Requested-With": "mws" },
        cache: "no-store",
      });
      if (stopped) return;
      if (response.status === 401) {
        stopped = true;
        options.onEnded();
        return;
      }
      if (!response.ok) throw new Error(`refresh answered ${response.status}`);
      const body = (await response.json().catch(() => null)) as { data?: { expires_in?: number } } | null;
      const expiresIn = Number(body?.data?.expires_in) || 300;
      retries = 0;
      // A few seconds of spread, so tabs of the same person do not all ask in the same moment.
      schedule(Math.max(expiresIn * 1000 - skewMs, 5_000) + random() * 3_000);
    } catch {
      if (stopped) return;
      retries += 1;
      if (retries <= MAX_RETRIES) schedule(RETRY_MS);
    } finally {
      running = false;
    }
  }

  // Timers in a background tab are slowed down, so a tab that comes back checks whether it is due.
  const recheck = () => {
    if (stopped || (doc && doc.visibilityState !== "visible")) return;
    if (now() >= dueAt - 5_000) void refresh();
  };

  schedule(Math.max((options.initialExpiresIn ?? 240) * 1000 - skewMs, 5_000) + random() * 3_000);
  doc?.addEventListener("visibilitychange", recheck);
  win?.addEventListener("focus", recheck);

  return () => {
    stopped = true;
    if (handle !== null) timers.clearTimeout(handle);
    doc?.removeEventListener("visibilitychange", recheck);
    win?.removeEventListener("focus", recheck);
  };
}
