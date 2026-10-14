import { NextResponse } from "next/server";
import { hubSso } from "@/lib/hub-sso";
import { currentUser, endSession } from "@/lib/session";

// 3. The person pressed Logout: end this session, then let the Hub end the others and show its front page.
export async function GET(request: Request) {
  const user = await currentUser();
  let destination = new URL("/", request.url).toString();
  try {
    destination = hubSso().logoutUrl(user?.email);
  } catch {
    // Hub not configured: stay here
  }
  const response = NextResponse.redirect(destination);
  endSession(response);
  return response;
}
