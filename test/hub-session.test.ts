import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { createHubSession } from "../src/server/index.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function accessToken(over: Record<string, unknown> = {}, kid = "k1", key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const head = encode({ alg: "RS256", typ: "JWT", kid });
  const body = encode({
    iss: "mws-hub",
    aud: "mws-apps",
    sub: "person-1",
    email: "person@example.com",
    source: "employee",
    tags: ["staff"],
    sid: "family-1",
    jti: "j1",
    iat: now,
    exp: now + 300,
    ...over,
  });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}

const fetchImpl = (async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as unknown as typeof fetch;
let counter = 0;
const session = () => createHubSession({ hubBaseUrl: `http://hub-${counter++}.test:5175/`, fetchImpl });

describe("createHubSession", () => {
  it("accepts a good access token and returns who it is", async () => {
    const claims = await session().verify(accessToken());
    expect(claims).toMatchObject({ sub: "person-1", email: "person@example.com", source: "employee", sid: "family-1" });
  });

  it("accepts the token of an intern and refuses a source it does not know", async () => {
    const hub = session();
    expect(await hub.verify(accessToken({ source: "intern" }))).toMatchObject({ source: "intern" });
    expect(await hub.verify(accessToken({ source: "alumni" }))).toBeNull();
  });

  it("refuses an expired token, another audience, another issuer and a forged signature", async () => {
    const hub = session();
    const now = Math.floor(Date.now() / 1000);
    expect(await hub.verify(accessToken({ iat: now - 700, exp: now - 400 }))).toBeNull();
    expect(await hub.verify(accessToken({ aud: "other-app" }))).toBeNull();
    expect(await hub.verify(accessToken({ iss: "someone" }))).toBeNull();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(await hub.verify(accessToken({}, "k1", other))).toBeNull();
    expect(await hub.verify(accessToken({}, "unknown-key"))).toBeNull();
  });

  it("refuses garbage, a missing token and an unsigned token", async () => {
    const hub = session();
    expect(await hub.verify(undefined)).toBeNull();
    expect(await hub.verify("not.a.token")).toBeNull();
    expect(await hub.verify("a.b")).toBeNull();
    const head = encode({ alg: "none" });
    expect(await hub.verify(`${head}.${encode({})}.`)).toBeNull();
  });

  it("reads the cookie out of a Cookie header", async () => {
    const hub = session();
    const token = accessToken();
    expect(hub.readCookie(`a=1; hub_at=${token}; b=2`)).toBe(token);
    expect(hub.readCookie("a=1; b=2")).toBeUndefined();
    expect((await hub.fromCookieHeader(`x=1; hub_at=${token}`))?.sub).toBe("person-1");
    expect(await hub.fromCookieHeader(undefined)).toBeNull();
  });

  it("makes the Hub addresses", () => {
    const hub = createHubSession({ hubBaseUrl: "http://hub.test:5175/" });
    expect(hub.homeUrl()).toBe("http://hub.test:5175/");
    expect(hub.refreshUrl()).toBe("http://hub.test:5175/auth/refresh");
    expect(hub.restoreUrl("https://app.mws.web.id/page?x=1")).toBe(
      "http://hub.test:5175/auth/restore?return=https%3A%2F%2Fapp.mws.web.id%2Fpage%3Fx%3D1",
    );
  });

  it("decides what a request does: serve it, ask the Hub to restore, or go to the Hub, never looping", () => {
    const hub = createHubSession({ hubBaseUrl: "http://hub.test:5175/" });
    const claims = { sub: "p" } as never;
    expect(hub.step({ claims, restored: false })).toBe("ok");
    expect(hub.step({ claims: null, restored: false })).toBe("restore");
    expect(hub.step({ claims: null, restored: true })).toBe("hub");
  });
});

describe("cookie name discovery", () => {
  const savedEnv = process.env.HUB_ACCESS_COOKIE_NAME;
  const savedNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (savedEnv === undefined) delete process.env.HUB_ACCESS_COOKIE_NAME;
    else process.env.HUB_ACCESS_COOKIE_NAME = savedEnv;
    process.env.NODE_ENV = savedNodeEnv;
  });

  // A Hub that answers /.well-known/hub-config with `config` (or fails when it is null) and counts the calls.
  const hubAnswering = (config: unknown) => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (config === null) throw new Error("down");
      return new Response(JSON.stringify(config), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const make = (hub: ReturnType<typeof hubAnswering>, extra: Record<string, unknown> = {}) =>
    createHubSession({ hubBaseUrl: `http://hub-${counter++}.test:5175`, fetchImpl: hub.fetchImpl, ...extra });

  it("uses the cookie name the Hub reports", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const hub = hubAnswering({ access_cookie_name: "hub_at_stg" });
    const session = make(hub);
    expect(session.cookieName).toBe("hub_at");
    expect(await session.ready()).toBe("hub_at_stg");
    expect(session.cookieName).toBe("hub_at_stg");
    expect(session.nameSource()).toBe("hub");
    expect(session.readCookie("hub_at_stg=abc")).toBe("abc");
    expect(hub.calls[0]).toEndWith("/.well-known/hub-config");
  });

  it("reads the right cookie on the first request", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const claims = await make(hubAnswering({ access_cookie_name: "hub_at_stg" })).fromCookieHeader("hub_at_stg=x");
    expect(claims).toBeNull();
    const hub = createHubSession({
      hubBaseUrl: "http://hub-first.test:5175",
      fetchImpl: (async (url: string) =>
        String(url).endsWith("hub-config")
          ? new Response(JSON.stringify({ access_cookie_name: "hub_at_stg" }))
          : new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch,
    });
    expect((await hub.fromCookieHeader(`hub_at_stg=${accessToken()}`))?.sub).toBe("person-1");
  });

  it("lets the option and the environment win without asking the Hub", async () => {
    const hub = hubAnswering({ access_cookie_name: "hub_at_stg" });
    const byOption = make(hub, { cookieName: "my_cookie" });
    expect(await byOption.ready()).toBe("my_cookie");
    expect(byOption.nameSource()).toBe("option");

    process.env.HUB_ACCESS_COOKIE_NAME = "env_cookie";
    const byEnv = make(hub);
    expect(await byEnv.ready()).toBe("env_cookie");
    expect(byEnv.nameSource()).toBe("env");
    expect(hub.calls).toHaveLength(0);
  });

  it("ignores an env value that is not a usable name and asks the Hub", async () => {
    process.env.HUB_ACCESS_COOKIE_NAME = "hub_rt";
    const session = make(hubAnswering({ access_cookie_name: "hub_at_stg" }));
    expect(await session.ready()).toBe("hub_at_stg");
  });

  it("never takes audience or issuer from the Hub", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const session = createHubSession({
      hubBaseUrl: "http://hub-policy.test:5175",
      fetchImpl: (async (url: string) =>
        String(url).endsWith("hub-config")
          ? new Response(JSON.stringify({ access_cookie_name: "hub_at", audience: "evil", issuer: "evil" }))
          : new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch,
    });
    await session.ready();
    expect(await session.verify(accessToken())).not.toBeNull();
    expect(await session.verify(accessToken({ aud: "evil", iss: "evil" }))).toBeNull();
  });

  it("refuses names that are not safe or that belong to the Hub", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    for (const name of ["hub_rt", "hub_session", "a b", "x", "a;b=c", "x".repeat(41), 42, null]) {
      const session = make(hubAnswering({ access_cookie_name: name }));
      expect(await session.ready()).toBe("hub_at");
    }
  });

  it("keeps hub_at when the Hub is down, and the last name when it goes down later", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const down = make(hubAnswering(null));
    expect(await down.ready()).toBe("hub_at");
    expect(down.nameSource()).toBe("default");

    let up = true;
    const session = createHubSession({
      hubBaseUrl: "http://hub-flaky.test:5175",
      fetchImpl: (async () => {
        if (!up) throw new Error("down");
        return new Response(JSON.stringify({ access_cookie_name: "hub_at_stg" }));
      }) as unknown as typeof fetch,
    });
    expect(await session.ready()).toBe("hub_at_stg");
    up = false;
    expect(session.cookieName).toBe("hub_at_stg");
  });

  it("asks once for requests that arrive together and then remembers", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const hub = hubAnswering({ access_cookie_name: "hub_at_stg" });
    const session = make(hub);
    await Promise.all([session.ready(), session.ready(), session.fromCookieHeader("a=1")]);
    await session.ready();
    expect(hub.calls).toHaveLength(1);
  });

  it("does not ask again at once when the Hub has no endpoint", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const calls: string[] = [];
    const session = createHubSession({
      hubBaseUrl: "http://hub-old.test:5175",
      fetchImpl: (async (url: string) => {
        calls.push(String(url));
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch,
    });
    await session.ready();
    await session.ready();
    expect(calls).toHaveLength(1);
    expect(session.cookieName).toBe("hub_at");
  });

  it("can be switched off", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    const hub = hubAnswering({ access_cookie_name: "hub_at_stg" });
    expect(await make(hub, { discovery: false }).ready()).toBe("hub_at");
    expect(hub.calls).toHaveLength(0);
  });

  it("only asks over https in production", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    process.env.NODE_ENV = "production";
    const insecure = hubAnswering({ access_cookie_name: "hub_at_stg" });
    expect(await make(insecure).ready()).toBe("hub_at");
    expect(insecure.calls).toHaveLength(0);

    const secure = hubAnswering({ access_cookie_name: "hub_at_stg" });
    const session = createHubSession({ hubBaseUrl: "https://hub.mws.test", fetchImpl: secure.fetchImpl });
    expect(await session.ready()).toBe("hub_at_stg");
  });

  it("refreshes in the background, so a Hub that hangs later does not hold a request", async () => {
    delete process.env.HUB_ACCESS_COOKIE_NAME;
    let hang = false;
    let calls = 0;
    const session = createHubSession({
      hubBaseUrl: "http://hub-slow.test:5175",
      fetchImpl: (async () => {
        calls += 1;
        if (hang) return new Promise<Response>(() => {});
        return new Response(JSON.stringify({ access_cookie_name: "hub_at_stg" }));
      }) as unknown as typeof fetch,
    });
    try {
      expect(await session.ready()).toBe("hub_at_stg");
      hang = true;
      setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
      // Past the 10 minutes: asks again, but answers at once with the name it has.
      expect(await session.ready()).toBe("hub_at_stg");
      expect(calls).toBe(2);
      await session.ready();
      expect(calls).toBe(2);
    } finally {
      setSystemTime();
    }
  });
});
