import { NextResponse } from "next/server";
import { hubSso } from "@/lib/hub-sso";
import { endSessions } from "@/lib/users";

// 4. The Hub ends sessions: a person signed out of another app, or this application was retired.
export async function POST(request: Request) {
  let sso;
  try {
    sso = hubSso();
  } catch {
    return NextResponse.json({ revoked: false }, { status: 503 });
  }
  const result = await sso.revoke.handle({
    secret: request.headers.get("x-hub-internal-secret"),
    body: await request.json().catch(() => null),
    apply: async (scope) => endSessions(scope),
  });
  return NextResponse.json(result.body, { status: result.status });
}
