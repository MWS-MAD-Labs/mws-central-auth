import { describe, expect, it } from "bun:test";
import { watchSession } from "../src/client";

function host() {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget();
  return { doc, win };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watchSession", () => {
  it("calls onRevoked when the check says the session is gone", async () => {
    const { doc, win } = host();
    let revoked = 0;
    watchSession({ check: async () => false, onRevoked: () => revoked++, doc, win, now: () => 100000 });
    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(revoked).toBe(1);
  });

  it("does nothing while the session is valid, and not more often than the gap", async () => {
    const { doc, win } = host();
    let checks = 0;
    let clock = 100000;
    watchSession({ check: async () => (checks++, true), onRevoked: () => {}, doc, win, minGapMs: 15000, now: () => clock });
    win.dispatchEvent(new Event("focus"));
    win.dispatchEvent(new Event("focus"));
    clock += 16000;
    doc.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(checks).toBe(2);
  });

  it("ignores a hidden tab, a failing check and a stopped watcher", async () => {
    const { doc, win } = host();
    let revoked = 0;
    doc.visibilityState = "hidden";
    const stop = watchSession({ check: async () => { throw new Error("offline"); }, onRevoked: () => revoked++, doc, win, now: () => 1 });
    win.dispatchEvent(new Event("focus"));
    doc.visibilityState = "visible";
    win.dispatchEvent(new Event("focus"));
    await flush();
    stop();
    win.dispatchEvent(new Event("focus"));
    await flush();
    expect(revoked).toBe(0);
  });
});
