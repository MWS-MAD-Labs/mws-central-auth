import { InMemoryReplayStore, verifyRelayToken } from "mws-central-auth/server";
import { NextRequest, NextResponse } from "next/server";
import { hubSso, required } from "@/lib/hub-sso";
import { startSession } from "@/lib/session";
import { upsertFromRelay } from "@/lib/users";

const replayStore = new InMemoryReplayStore();

// 2. The Hub sends the person back with a code.
export async function GET(request: NextRequest) {
  const fail = (reason: string) => NextResponse.redirect(new URL(`/?error=${reason}`, request.url));
  let sso;
  try {
    sso = hubSso();
  } catch {
    return fail("sso");
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const clear = sso.callback.clearCookie();
  const action = sso.callback.decide({ code, state, cookieState: request.cookies.get(clear.name)?.value });
  // A card click in the Hub carries no state: start our own round, the Hub signs the person in again.
  if (action === "restart") return NextResponse.redirect(new URL("/auth/hub", request.url));
  if (action === "reject" || !code || !state) return fail("sso");

  try {
    const token = await sso.exchange(code, state);
    const relay = await verifyRelayToken(token, {
      audience: required("HUB_SSO_APP_ID"),
      jwksUrl: process.env.HUB_SSO_JWKS_URL || sso.jwksUrl(),
      replayStore,
    });
    const entitlement = relay.entitlement;
    // The Hub only sends an entitlement for people Central gave access to this application.
    if (
      !entitlement ||
      entitlement.application_id !== required("HUB_SSO_APP_ID") ||
      entitlement.organization_id !== required("CENTRAL_ORGANIZATION_ID") ||
      entitlement.permissions.length === 0
    ) {
      return fail("no_access");
    }
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(clear.name, "", { path: clear.path, expires: new Date(0) });
    await startSession(response, upsertFromRelay({ sub: relay.sub, email: relay.email, entitlement }));
    return response;
  } catch (error) {
    console.error("Sign-in failed:", error instanceof Error ? error.message : error);
    return fail("sso");
  }
}
