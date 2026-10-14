// Browser side of the contract: a tab that comes back into view asks whether its session is still valid,
// so a sign-out done in another app shows up at once instead of at the next click.

export interface WatchSessionOptions {
  // Resolves true while the session is valid. A rejected promise is treated as "unknown" and ignored.
  check: () => Promise<boolean>;
  // Called when `check` says the session is gone.
  onRevoked: () => void;
  // Fewest milliseconds between two checks. Default 15000.
  minGapMs?: number;
  // For tests and non-browser hosts.
  doc?: { visibilityState: string; addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] };
  win?: { addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] };
  now?: () => number;
}

export function watchSession(options: WatchSessionOptions): () => void {
  const doc = options.doc ?? (globalThis as { document?: WatchSessionOptions["doc"] }).document;
  const win = options.win ?? (globalThis as { window?: WatchSessionOptions["win"] }).window;
  if (!doc || !win) return () => {};
  const minGap = options.minGapMs ?? 15000;
  const now = options.now ?? Date.now;
  let last = 0;
  let stopped = false;

  const recheck = () => {
    if (stopped || doc.visibilityState !== "visible") return;
    const at = now();
    if (at - last < minGap) return;
    last = at;
    options
      .check()
      .then((valid) => {
        if (!valid && !stopped) options.onRevoked();
      })
      .catch(() => {});
  };

  doc.addEventListener("visibilitychange", recheck);
  win.addEventListener("focus", recheck);
  return () => {
    stopped = true;
    doc.removeEventListener("visibilitychange", recheck);
    win.removeEventListener("focus", recheck);
  };
}

export { keepFresh } from "./keep-fresh.js";
export type { KeepFreshOptions } from "./keep-fresh.js";
