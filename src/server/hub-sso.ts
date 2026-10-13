import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HubExchangeClient } from "./hub-exchange-client.js";
import { verifyHubInternalSecret } from "./hub-internal-request.js";

// One place for the app side of the Hub sign-in and sign-out flow, so every app behaves the same and a change
// is made here once. It returns plain values (urls, cookie descriptors, verdicts) and never touches a request,
// so it works with Express, Next.js route handlers or anything else.

export interface HubSsoOptions {
  // The Hub's public address (its front page lives here).
  hubBaseUrl: string;
  // This application's id in Central and the Hub.
  appId: string;
  // The secret the Hub shares with this application.
  internalSecret: string;
  // Cookie that holds the state of a sign-in this app started. Default `mws_sso_state`.
  stateCookieName?: string;
  stateTtlSeconds?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CookieDescriptor {
  name: string;
  value: string;
  maxAgeSeconds: number;
  httpOnly: true;
  sameSite: "lax";
  path: string;
}

export type CallbackAction = "restart" | "continue" | "reject";

export interface RevokeScope {
  personId?: string;
  email?: string;
  // The Hub says every session of this application has to end (the application was retired).
  all?: boolean;
}

export interface RevokeResult {
  status: 200 | 400 | 401 | 503;
  body: { revoked: boolean };
}

const revokeBodySchema = z
  .object({
    email: z.string().email().optional(),
    central_id: z.string().min(1).optional(),
    all: z.boolean().optional(),
  })
  .refine((value) => value.all === true || value.email || value.central_id);

function sameValue(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHubSso(options: HubSsoOptions) {
  const base = options.hubBaseUrl.replace(/\/+$/, "");
  const cookieName = options.stateCookieName ?? "mws_sso_state";
  const ttl = options.stateTtlSeconds ?? 300;
  const exchangeClient = new HubExchangeClient({
    baseUrl: base,
    internalSecret: options.internalSecret,
    appId: options.appId,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  const cookie = (value: string, maxAgeSeconds: number): CookieDescriptor => ({
    name: cookieName,
    value,
    maxAgeSeconds,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return {
    launch: {
      // Starts a sign-in this app owns: send the person to `url` and set `cookie` on the response.
      begin() {
        const state = randomBytes(32).toString("base64url");
        const url = new URL(`/apps/${encodeURIComponent(options.appId)}/launch`, `${base}/`);
        url.searchParams.set("state", state);
        return { state, url: url.toString(), cookie: cookie(state, ttl) };
      },
    },
    callback: {
      // What to do with a callback from the Hub. A sign-in this app started always carries a state, so a
      // callback without one came from a card click: start our own round, the Hub signs the person in again.
      decide(input: {
        code?: string | null;
        state?: string | null;
        cookieState?: string | null;
      }): CallbackAction {
        if (!input.code) return "reject";
        if (!input.state) return "restart";
        if (!input.cookieState || !sameValue(input.state, input.cookieState)) return "reject";
        return "continue";
      },
      // Set this once the callback is used, so a state works only one time.
      clearCookie: () => cookie("", 0),
    },
    exchange: (code: string, state?: string) => exchangeClient.exchangeCode(code, state),
    // Where the Hub publishes the keys that sign its relay tokens.
    jwksUrl: () => `${base}/.well-known/jwks.json`,
    // The Hub front page, where people pick an app.
    homeUrl: () => `${base}/`,
    // Where to send the browser after this app cleared its own session. The Hub ends the person's sessions in
    // the other apps and keeps its own, then shows its front page.
    logoutUrl(email?: string) {
      const url = new URL("/auth/logout", `${base}/`);
      if (email) url.searchParams.set("email", email);
      return url.toString();
    },
    revoke: {
      // The Hub calls an app's /auth/revoke-session when a person signed out elsewhere or the app was retired.
      // `apply` ends the sessions and returns whether anyone was affected.
      async handle(input: {
        secret: string | null | undefined;
        body: unknown;
        apply: (scope: RevokeScope) => Promise<boolean> | boolean;
      }): Promise<RevokeResult> {
        if (!verifyHubInternalSecret(input.secret, options.internalSecret)) return { status: 401, body: { revoked: false } };
        const parsed = revokeBodySchema.safeParse(input.body);
        if (!parsed.success) return { status: 400, body: { revoked: false } };
        try {
          const revoked = await input.apply({
            personId: parsed.data.central_id,
            email: parsed.data.email,
            all: parsed.data.all === true,
          });
          return { status: 200, body: { revoked } };
        } catch {
          return { status: 503, body: { revoked: false } };
        }
      },
    },
  };
}

export type HubSso = ReturnType<typeof createHubSso>;
