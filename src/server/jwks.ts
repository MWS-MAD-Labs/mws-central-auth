import { webcrypto } from "node:crypto";

// Explicit import instead of the ambient `crypto` global: `globalThis.crypto`
// only became available without a flag starting in Node 19 - some consumers
// of this package (mws-mtss-system, mws-daily-checkin) run on Node 18
// containers, where that global isn't guaranteed. `node:crypto`'s
// `webcrypto` export has been stable since Node 15 regardless.
const subtle = webcrypto.subtle;

interface JsonWebKey {
  kty?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

interface Jwks {
  keys: JsonWebKey[];
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

// One cache entry per jwksUrl, so multiple consumers configured against
// different Hub environments (staging vs production) don't clobber each
// other in the same process.
const cache = new Map<string, { fetchedAt: number; jwks: Jwks }>();

async function loadJwks(jwksUrl: string, fetchImpl: typeof fetch, ttlMs: number): Promise<Jwks> {
  const cached = cache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.jwks;

  const response = await fetchImpl(jwksUrl, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Failed to fetch JWKS from ${jwksUrl}: ${response.status}`);
  const jwks = (await response.json()) as Jwks;
  cache.set(jwksUrl, { fetchedAt: Date.now(), jwks });
  return jwks;
}

// Looks up `kid` in the cached JWKS document, refetching once if it's
// missing - covers the case where Hub rotated its signing key since the
// last fetch. A `kid` still missing after a refetch is a hard failure, not
// silently ignored.
export async function importPublicKeyFromJwks(input: {
  jwksUrl: string;
  kid: string;
  fetchImpl?: typeof fetch;
  ttlMs?: number;
}): Promise<CryptoKey> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;

  let jwks = await loadJwks(input.jwksUrl, fetchImpl, ttlMs);
  let jwk = jwks.keys.find((key) => key.kid === input.kid);

  if (!jwk) {
    cache.delete(input.jwksUrl);
    jwks = await loadJwks(input.jwksUrl, fetchImpl, ttlMs);
    jwk = jwks.keys.find((key) => key.kid === input.kid);
  }

  if (!jwk) throw new Error(`No JWKS key found for kid "${input.kid}" at ${input.jwksUrl}`);

  return subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");

  const keyData = Buffer.from(body, "base64");

  return subtle.importKey(
    "spki",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}
