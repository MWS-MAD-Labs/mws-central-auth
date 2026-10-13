import { webcrypto } from "node:crypto";
import { describe, expect, it } from "bun:test";
import {
  InMemoryReplayStore,
  RelayTokenVerificationError,
  relayTokenPayloadSchema,
  verifyRelayToken,
  type ReplayStore,
} from "../src/server/index.js";

const encoder = new TextEncoder();

function encode(value: string | object): string {
  const input = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(input).toString("base64url");
}

async function createToken(jti: string) {
  const keys = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = Buffer.from(await webcrypto.subtle.exportKey("spki", keys.publicKey)).toString("base64");
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "RS256" });
  const payload = encode({
    iss: "mws-hub",
    aud: "exima",
    sub: "person-1",
    email: "person@example.com",
    source: "employee",
    tags: ["exima"],
    jti,
    iat: now,
    exp: now + 30,
  });
  const input = `${header}.${payload}`;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, encoder.encode(input));
  return { token: `${input}.${Buffer.from(signature).toString("base64url")}`, publicKeyPem };
}

describe("relay token contract", () => {
  const basePayload = {
    iss: "mws-hub",
    aud: "exima",
    sub: "person-1",
    email: "person@example.com",
    source: "employee" as const,
    tags: ["exima"],
    jti: "d9ad59f2-e24e-48d1-888d-605727e8b18c",
    iat: 1,
    exp: 2,
  };

  it("accepts old relay payloads without an entitlement", () => {
    expect(relayTokenPayloadSchema.parse(basePayload)).toEqual(basePayload);
  });

  it("accepts the optional entitlement claim", () => {
    const entitlement = {
      id: "entitlement-1",
      application_id: "exima",
      organization_id: "organization-1",
      role: "cashier",
      permissions: ["sales:create"],
      version: 4,
    };
    expect(relayTokenPayloadSchema.parse({ ...basePayload, entitlement }).entitlement).toEqual(entitlement);
  });
});

describe("relay replay protection", () => {
  it("atomically accepts only one concurrent verification", async () => {
    const { token, publicKeyPem } = await createToken("bd694586-76b8-41ef-af64-5ad27442b57d");
    const replayStore = new InMemoryReplayStore();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => verifyRelayToken(token, {
      audience: "exima",
      publicKeyPem,
      replayStore,
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(failures).toHaveLength(19);
    expect(failures.every((result) => result.reason instanceof RelayTokenVerificationError)).toBe(true);
  });

  it("continues to support legacy ReplayStore implementations", async () => {
    const { token, publicKeyPem } = await createToken("cc3580f9-eab5-458f-aae0-36e5bbb861d4");
    const seen = new Set<string>();
    const replayStore: ReplayStore = {
      hasSeen: (jti) => seen.has(jti),
      markSeen: (jti) => { seen.add(jti); },
    };

    await expect(verifyRelayToken(token, { audience: "exima", publicKeyPem, replayStore })).resolves.toMatchObject({ sub: "person-1" });
    await expect(verifyRelayToken(token, { audience: "exima", publicKeyPem, replayStore })).rejects.toBeInstanceOf(RelayTokenVerificationError);
  });
});
