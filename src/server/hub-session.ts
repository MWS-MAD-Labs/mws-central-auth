import { webcrypto } from "node:crypto";
import { z } from "zod";
import { importPublicKeyFromJwks } from "./jwks.js";

// The app side of the Hub's shared session (see the Hub README). The Hub puts a short access token in a cookie
// on the parent domain; every app on that domain reads it here and checks it against the Hub's published keys.
// The app keeps no session of its own and has no sign-out: signing out of the Hub deletes the cookie.

const subtle = webcrypto.subtle;

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string().min(1),
  email: z.string(),
  source: z.enum(["employee", "intern", "student"]),
  tags: z.array(z.string()),
  sid: z.string().min(1),
  jti: z.string(),
  iat: z.number(),
  exp: z.number(),
});

export type HubSessionClaims = z.infer<typeof claimsSchema>;

export interface HubSessionOptions {
  // The Hub's public address.
  hubBaseUrl: string;
  // `aud` of the access token. Default `mws-apps`.
  audience?: string;
  issuer?: string;
  // Name of the access token cookie. Without it: HUB_ACCESS_COOKIE_NAME from the environment, then what the Hub
  // reports at /.well-known/hub-config, then `hub_at`.
  cookieName?: string;
  // Set to false to never ask the Hub for its cookie name (tests, no network).
  discovery?: boolean;
  jwksUrl?: string;
  clockToleranceSeconds?: number;
  fetchImpl?: typeof fetch;
}

export type CookieNameSource = "option" | "env" | "hub" | "default";

const COOKIE_NAME = /^[A-Za-z0-9_-]{3,40}$/;
// Cookies the Hub keeps for itself. The access token is never one of them.
const RESERVED_COOKIE_NAMES = ["hub_rt", "hub_session"];
const validCookieName = (value: unknown): value is string =>
  typeof value === "string" && COOKIE_NAME.test(value) && !RESERVED_COOKIE_NAMES.includes(value);

const DISCOVERY_TTL_MS = 10 * 60 * 1000;
// A Hub that does not answer (or has no endpoint yet) is asked again after this long, not on every request.
const DISCOVERY_RETRY_MS = 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 3000;

export type SessionStep = "ok" | "restore" | "hub";

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function createHubSession(options: HubSessionOptions) {
  const base = options.hubBaseUrl.replace(/\/+$/, "");
  const envName = process.env.HUB_ACCESS_COOKIE_NAME?.trim();
  // A name given by the app wins and the Hub is never asked.
  const pinned = options.cookieName ?? (validCookieName(envName) ? envName : undefined);
  const askHub = !pinned && options.discovery !== false;
  // Only the cookie name comes from the Hub. Audience and issuer decide who is trusted, so the app keeps them.
  const audience = options.audience ?? "mws-apps";
  const issuer = options.issuer ?? "mws-hub";
  const jwksUrl = options.jwksUrl ?? `${base}/.well-known/jwks.json`;
  const tolerance = options.clockToleranceSeconds ?? 5;

  async function verify(token: string | null | undefined): Promise<HubSessionClaims | null> {
    if (!token) return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [head, body, signature] = parts;
      const header = JSON.parse(Buffer.from(base64UrlDecode(head)).toString("utf8")) as { alg?: string; kid?: string };
      if (header.alg !== "RS256" || !header.kid) return null;
      const key = await importPublicKeyFromJwks({
        jwksUrl,
        kid: header.kid,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      const valid = await subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        base64UrlDecode(signature) as BufferSource,
        new TextEncoder().encode(`${head}.${body}`) as BufferSource,
      );
      if (!valid) return null;
      const parsed = claimsSchema.safeParse(JSON.parse(Buffer.from(base64UrlDecode(body)).toString("utf8")));
      if (!parsed.success) return null;
      const claims = parsed.data;
      const now = Date.now() / 1000;
      if (claims.iss !== issuer || claims.aud !== audience) return null;
      if (claims.exp + tolerance < now || claims.iat - tolerance > now) return null;
      return claims;
    } catch {
      return null;
    }
  }

  let learned: string | undefined;
  let nextAskAt = 0;
  let asking: Promise<void> | null = null;
  const currentName = () => pinned ?? learned ?? "hub_at";

  async function ask(): Promise<void> {
    let found = false;
    try {
      // Over http only while developing; in production the name must come over https.
      const secureEnough = new URL(base).protocol === "https:" || process.env.NODE_ENV !== "production";
      if (secureEnough) {
        const response = await (options.fetchImpl ?? fetch)(`${base}/.well-known/hub-config`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
        });
        if (response.ok) {
          const body = (await response.json()) as { access_cookie_name?: unknown };
          if (validCookieName(body.access_cookie_name)) {
            learned = body.access_cookie_name;
            found = true;
          }
        }
      }
    } catch {
      // The name known so far stays.
    }
    nextAskAt = Date.now() + (found ? DISCOVERY_TTL_MS : DISCOVERY_RETRY_MS);
  }

  // Resolves once the cookie name is as known as it is going to get. Call it at start-up so the first request
  // already reads the right cookie; `fromCookieHeader` calls it too.
  async function ready(): Promise<string> {
    if (askHub && Date.now() >= nextAskAt) {
      asking ??= ask().finally(() => {
        asking = null;
      });
      await asking;
    }
    return currentName();
  }

  // The value of the access token cookie in a `Cookie` request header. Synchronous, so it uses the name known so
  // far: until `ready()` has finished that is the app's own setting, or `hub_at`.
  function readCookie(header: string | null | undefined): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index > 0 && part.slice(0, index).trim() === currentName()) return decodeURIComponent(part.slice(index + 1).trim());
    }
    return undefined;
  }

  return {
    get cookieName() {
      return currentName();
    },
    // Where the name came from, for logs and startup checks.
    nameSource(): CookieNameSource {
      return options.cookieName ? "option" : pinned ? "env" : learned ? "hub" : "default";
    },
    ready,
    verify,
    readCookie,
    // Who is signed in on this request, or null.
    fromCookieHeader: async (header: string | null | undefined) => {
      await ready();
      return verify(readCookie(header));
    },
    // The Hub front page, where people pick an app.
    homeUrl: () => `${base}/`,
    // Where the app's pages ask for a new access token, with `keepFresh` from the client entry.
    refreshUrl: () => `${base}/auth/refresh`,
    // For a request that arrives without a valid access token: the Hub gives one back if the person still has a
    // valid session, then returns to `returnUrl` with `restored=1` added.
    restoreUrl(returnUrl: string) {
      const url = new URL("/auth/restore", `${base}/`);
      url.searchParams.set("return", returnUrl);
      return url.toString();
    },
    // What to do with a request: serve it, ask the Hub to restore the session, or go to the Hub front page.
    // `restored` is true when the URL carries `restored=1`, which stops a restore loop.
    step(input: { claims: HubSessionClaims | null; restored: boolean }): SessionStep {
      if (input.claims) return "ok";
      return input.restored ? "hub" : "restore";
    },
  };
}

export type HubSession = ReturnType<typeof createHubSession>;
