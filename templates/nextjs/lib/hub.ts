import { createHubSession } from "mws-central-auth/server";

export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// The Hub's shared session: a short access token in a cookie on the parent domain, checked against the Hub's keys.
// One session for the whole process: it remembers the cookie name the Hub reports.
let session: ReturnType<typeof createHubSession> | undefined;
export function hub() {
  session ??= createHubSession({ hubBaseUrl: required("HUB_BASE_URL") });
  return session;
}
