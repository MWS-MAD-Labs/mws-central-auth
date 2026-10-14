import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { required } from "./hub-sso";
import { findById, type AppUser } from "./users";

export const SESSION_COOKIE = "app_session";
const MAX_AGE_SECONDS = 15 * 60;

const key = () => new TextEncoder().encode(required("SESSION_SECRET"));

const cookieBase = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
});

export async function startSession(response: NextResponse, user: AppUser) {
  const token = await new SignJWT({ v: user.sessionVersion, ev: user.entitlementVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
  response.cookies.set(SESSION_COOKIE, token, { ...cookieBase(), maxAge: MAX_AGE_SECONDS });
}

export function endSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieBase(), expires: new Date(0) });
}

// The person behind this request, or null. A session whose version is behind the stored one was ended
// (a sign-out in another app, or the application was retired).
export async function currentUser(): Promise<AppUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const user = payload.sub ? findById(payload.sub) : null;
    if (!user || user.sessionVersion !== payload.v || user.entitlementVersion !== payload.ev) return null;
    return user;
  } catch {
    return null;
  }
}

// For route handlers that need a signed-in person. `permission` is a Central permission key.
export async function requireUser(permission?: string): Promise<AppUser | Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (permission && !user.permissions.includes(permission)) return Response.json({ error: "Not allowed" }, { status: 403 });
  return user;
}
