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
  // Name of the access token cookie. Default `hub_at`.
  cookieName?: string;
  jwksUrl?: string;
  clockToleranceSeconds?: number;
  fetchImpl?: typeof fetch;
}

export type SessionStep = "ok" | "restore" | "hub";

function base64UrlDecode(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function createHubSession(options: HubSessionOptions) {
  const base = options.hubBaseUrl.replace(/\/+$/, "");
  const cookieName = options.cookieName ?? "hub_at";
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

  // The value of the access token cookie in a `Cookie` request header.
  function readCookie(header: string | null | undefined): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(";")) {
      const index = part.indexOf("=");
      if (index > 0 && part.slice(0, index).trim() === cookieName) return decodeURIComponent(part.slice(index + 1).trim());
    }
    return undefined;
  }

  return {
    cookieName,
    verify,
    readCookie,
    // Who is signed in on this request, or null.
    fromCookieHeader: (header: string | null | undefined) => verify(readCookie(header)),
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
