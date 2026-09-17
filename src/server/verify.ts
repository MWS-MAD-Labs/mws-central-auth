import { importPublicKeyFromJwks, importPublicKeyFromPem } from "./jwks.js";
import { InMemoryReplayStore } from "./replay-store.js";
import { relayTokenPayloadSchema, type RelayTokenPayload, type ReplayStore } from "./types.js";

export interface VerifyRelayTokenOptions {
  // The `aud` claim this app expects on its own tokens - matches the
  // `appId`/`sso.appId` Hub's app catalog was configured with for this app.
  audience: string;
  issuer?: string;
  // Dynamic verification (recommended): fetches Hub's public keys from its
  // JWKS endpoint and picks the one matching the token's `kid`, so Hub can
  // rotate its signing key without every satellite app needing a redeploy.
  jwksUrl?: string;
  // Static verification (matches the older mws-mtss-system/mws-daily-checkin
  // HUB_SSO_PUBLIC_KEY env var behavior): a single fixed PEM public key.
  // A key rotation on Hub's side requires updating this and redeploying.
  publicKeyPem?: string;
  // How long a relay token stays remembered after being consumed, so a
  // replay within the token's own short validity window is rejected even
  // if it somehow gets reused. Defaults to comfortably outlasting the
  // token's own `exp` - `RELAY_TTL_SECONDS` in mws-hub is 30s.
  replayTtlSeconds?: number;
  replayStore?: ReplayStore;
  fetchImpl?: typeof fetch;
  // Clock skew tolerance between this app's server and Hub's, in seconds.
  clockToleranceSeconds?: number;
}

export class RelayTokenVerificationError extends Error {}

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function base64UrlDecodeJson<T>(segment: string): T {
  return JSON.parse(Buffer.from(base64UrlDecode(segment)).toString("utf8")) as T;
}

// Verifies a Hub-minted relay token end to end: RS256 signature, issuer,
// audience, expiry, and single-use `jti`. Throws RelayTokenVerificationError
// on any failure - callers should treat every failure mode the same way
// (redirect to a generic sign-in error), not leak which check failed.
export async function verifyRelayToken(token: string, options: VerifyRelayTokenOptions): Promise<RelayTokenPayload> {
  if (!options.jwksUrl && !options.publicKeyPem) {
    throw new RelayTokenVerificationError("Either jwksUrl or publicKeyPem must be configured.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw new RelayTokenVerificationError("Malformed relay token.");
  const [headerSegment, payloadSegment, signatureSegment] = parts;

  let header: { alg?: string; kid?: string };
  try {
    header = base64UrlDecodeJson(headerSegment);
  } catch {
    throw new RelayTokenVerificationError("Malformed relay token header.");
  }
  if (header.alg !== "RS256") throw new RelayTokenVerificationError(`Unsupported relay token algorithm "${header.alg}".`);

  const key = options.jwksUrl
    ? await importPublicKeyFromJwks({
        jwksUrl: options.jwksUrl,
        kid: requireKid(header.kid),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })
    : await importPublicKeyFromPem(options.publicKeyPem!);

  const signingInput = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const signature = base64UrlDecode(signatureSegment);
  const signatureValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signature as BufferSource,
    signingInput as BufferSource,
  );
  if (!signatureValid) throw new RelayTokenVerificationError("Relay token signature is invalid.");

  let rawPayload: unknown;
  try {
    rawPayload = base64UrlDecodeJson(payloadSegment);
  } catch {
    throw new RelayTokenVerificationError("Malformed relay token payload.");
  }

  const parsed = relayTokenPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) throw new RelayTokenVerificationError("Relay token payload failed validation.");
  const payload = parsed.data;

  const issuer = options.issuer ?? "mws-hub";
  if (payload.iss !== issuer) throw new RelayTokenVerificationError(`Unexpected relay token issuer "${payload.iss}".`);
  if (payload.aud !== options.audience) throw new RelayTokenVerificationError(`Unexpected relay token audience "${payload.aud}".`);

  const clockToleranceSeconds = options.clockToleranceSeconds ?? 5;
  const nowSeconds = Date.now() / 1000;
  if (payload.exp + clockToleranceSeconds < nowSeconds) throw new RelayTokenVerificationError("Relay token has expired.");
  if (payload.iat - clockToleranceSeconds > nowSeconds) throw new RelayTokenVerificationError("Relay token issued in the future.");

  const replayStore = options.replayStore ?? new InMemoryReplayStore();
  if (await replayStore.hasSeen(payload.jti)) throw new RelayTokenVerificationError("Relay token has already been used.");
  await replayStore.markSeen(payload.jti, options.replayTtlSeconds ?? 120);

  return payload;
}

function requireKid(kid: string | undefined): string {
  if (!kid) throw new RelayTokenVerificationError("Relay token header is missing \"kid\".");
  return kid;
}
