import { NextResponse } from "next/server";

// Where the Hub's card opens the app (the launch address Central keeps). There is nothing to sign in to: the session
// is read from the Hub's cookie, so this only sends the browser to the page.
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url));
}
