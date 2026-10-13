import { describe, expect, it } from "bun:test";
import { createHubSso } from "../src/server/hub-sso";

const sso = createHubSso({
  hubBaseUrl: "http://hub.test:5175/",
  appId: "demo",
  internalSecret: "app-secret",
  fetchImpl: (async (_url: unknown, init?: RequestInit) =>
    new Response(JSON.stringify({ data: { token: `token-for-${JSON.parse(String(init?.body)).code}` } }), { status: 200 })) as typeof fetch,
});

describe("launch and callback", () => {
  it("begins a sign-in with a state, its url, and a cookie holding the same state", () => {
    const first = sso.launch.begin();
    expect(first.url).toBe(`http://hub.test:5175/apps/demo/launch?state=${first.state}`);
    expect(first.cookie).toMatchObject({ name: "mws_sso_state", value: first.state, httpOnly: true, sameSite: "lax", path: "/" });
    expect(sso.launch.begin().state).not.toBe(first.state);
  });

  it("restarts a callback that has no state, even when an old cookie is around", () => {
    expect(sso.callback.decide({ code: "c", state: null, cookieState: null })).toBe("restart");
    expect(sso.callback.decide({ code: "c", state: undefined, cookieState: "old" })).toBe("restart");
  });

  it("continues only when the state matches the cookie", () => {
    expect(sso.callback.decide({ code: "c", state: "s1", cookieState: "s1" })).toBe("continue");
    expect(sso.callback.decide({ code: "c", state: "s1", cookieState: "s2" })).toBe("reject");
    expect(sso.callback.decide({ code: "c", state: "s1", cookieState: null })).toBe("reject");
  });

  it("rejects a callback without a code", () => {
    expect(sso.callback.decide({ code: null, state: "s1", cookieState: "s1" })).toBe("reject");
  });

  it("clears the cookie with an empty value and no lifetime", () => {
    expect(sso.callback.clearCookie()).toMatchObject({ value: "", maxAgeSeconds: 0 });
  });
});

describe("exchange and addresses", () => {
  it("trades a code for the token through the Hub", async () => {
    expect(await sso.exchange("abc", "s1")).toBe("token-for-abc");
  });

  it("makes the Hub addresses", () => {
    expect(sso.homeUrl()).toBe("http://hub.test:5175/");
    expect(sso.jwksUrl()).toBe("http://hub.test:5175/.well-known/jwks.json");
    expect(sso.logoutUrl("a@x.id")).toBe("http://hub.test:5175/auth/logout?email=a%40x.id");
    expect(sso.logoutUrl()).toBe("http://hub.test:5175/auth/logout");
  });
});

describe("revoke", () => {
  const seen: unknown[] = [];
  const apply = async (scope: unknown) => {
    seen.push(scope);
    return true;
  };

  it("refuses a wrong secret without touching sessions", async () => {
    seen.length = 0;
    const result = await sso.revoke.handle({ secret: "nope", body: { email: "a@x.id" }, apply });
    expect(result).toEqual({ status: 401, body: { revoked: false } });
    expect(seen).toEqual([]);
  });

  it("refuses a body that names nobody", async () => {
    expect((await sso.revoke.handle({ secret: "app-secret", body: {}, apply })).status).toBe(400);
  });

  it("passes the person, or all, to the app", async () => {
    seen.length = 0;
    expect(await sso.revoke.handle({ secret: "app-secret", body: { email: "a@x.id", central_id: "p1" }, apply })).toEqual({
      status: 200,
      body: { revoked: true },
    });
    await sso.revoke.handle({ secret: "app-secret", body: { all: true }, apply });
    expect(seen).toEqual([
      { personId: "p1", email: "a@x.id", all: false },
      { personId: undefined, email: undefined, all: true },
    ]);
  });

  it("answers 503 when the app cannot end the sessions", async () => {
    const result = await sso.revoke.handle({ secret: "app-secret", body: { all: true }, apply: async () => { throw new Error("db"); } });
    expect(result.status).toBe(503);
  });
});
