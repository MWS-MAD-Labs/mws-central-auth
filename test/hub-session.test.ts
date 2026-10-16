import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "bun:test";
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
