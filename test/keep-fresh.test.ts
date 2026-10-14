import { describe, expect, it } from "bun:test";
import { keepFresh } from "../src/client/index.js";

function setup(answers: Array<{ status: number; body?: unknown } | Error>) {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = new EventTarget();
  const timers: { id: number; fn: () => void; ms: number }[] = [];
  let nextId = 1;
  let clock = 1_000_000;
  const calls: { url: string; init: RequestInit }[] = [];
  let ended = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body ?? { data: { expires_in: 300 } }), { status: answer.status });
  }) as unknown as typeof fetch;
  const stop = keepFresh({
    refreshUrl: "http://hub.test/auth/refresh",
    onEnded: () => ended++,
    fetchImpl,
    doc,
    win,
    now: () => clock,
    random: () => 0,
    timers: {
      setTimeout: (fn, ms) => {
        const id = nextId++;
        // Like a real timer, it is gone once it has fired.
        timers.push({
          id,
          ms,
          fn: () => {
            const index = timers.findIndex((timer) => timer.id === id);
            if (index >= 0) timers.splice(index, 1);
            fn();
          },
        });
        return id;
      },
      clearTimeout: (handle) => {
        const index = timers.findIndex((timer) => timer.id === handle);
        if (index >= 0) timers.splice(index, 1);
      },
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { doc, win, timers, calls, stop, flush, advance: (ms: number) => (clock += ms), ended: () => ended };
}

describe("keepFresh", () => {
  it("asks the Hub before the token ends, with the cookies, then schedules the next one", async () => {
    const t = setup([{ status: 200 }]);
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0].ms).toBe(180_000);
    t.timers[0].fn();
    await t.flush();
    expect(t.calls[0].url).toBe("http://hub.test/auth/refresh");
    expect(t.calls[0].init).toMatchObject({ method: "POST", credentials: "include" });
    expect((t.calls[0].init.headers as Record<string, string>)["X-Requested-With"]).toBe("mws");
    expect(t.timers).toHaveLength(1);
    expect(t.timers[0].ms).toBe(240_000);
    t.stop();
  });

  it("calls onEnded when the Hub says the session is over, and stops", async () => {
    const t = setup([{ status: 401 }]);
    t.timers[0].fn();
    await t.flush();
    expect(t.ended()).toBe(1);
    expect(t.timers).toHaveLength(0);
  });

  it("retries a failure a few times, then gives up without ending the session", async () => {
    const t = setup([new Error("offline"), { status: 503 }, { status: 200 }]);
    t.timers[0].fn();
    await t.flush();
    expect(t.timers[0].ms).toBe(15_000);
    t.timers[0].fn();
    await t.flush();
    t.timers[0].fn();
    await t.flush();
    expect(t.ended()).toBe(0);
    expect(t.timers[0].ms).toBe(240_000);
    t.stop();
  });

  it("checks when a background tab comes back and the time is due, and not before", async () => {
    const t = setup([{ status: 200 }]);
    t.doc.dispatchEvent(new Event("visibilitychange"));
    await t.flush();
    expect(t.calls).toHaveLength(0);
    t.advance(200_000);
    t.win.dispatchEvent(new Event("focus"));
    await t.flush();
    expect(t.calls).toHaveLength(1);
    t.stop();
  });

  it("does nothing after stop", async () => {
    const t = setup([{ status: 200 }]);
    t.stop();
    t.advance(500_000);
    t.win.dispatchEvent(new Event("focus"));
    await t.flush();
    expect(t.calls).toHaveLength(0);
  });
});
