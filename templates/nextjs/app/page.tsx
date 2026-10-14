import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessFor } from "@/lib/access";
import { hub, required } from "@/lib/hub";
import { SessionKeeper } from "./session-keeper";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const session = hub();
  const claims = await session.fromCookieHeader((await headers()).get("cookie"));

  // No session: the Hub gives one back if the person still has it, or shows its front page.
  const step = session.step({ claims, restored: "restored" in query });
  if (step === "restore") redirect(session.restoreUrl(new URL("/", required("APP_PUBLIC_URL")).toString()));
  if (step === "hub" || !claims) redirect(session.homeUrl());

  const access = await accessFor(claims.sub).catch(() => undefined);
  if (access === undefined) return <main><h1>My New App</h1><p>Try again shortly.</p></main>;
  if (access === null) return <main><h1>My New App</h1><p>You do not have access to this application.</p></main>;

  return (
    <main>
      <h1>My New App</h1>
      <p>
        Signed in as {claims.email} ({access.role}).
      </p>
      <p>
        <a href={session.homeUrl()}>Back to the Hub</a>
      </p>
      <SessionKeeper
        refreshUrl={session.refreshUrl()}
        homeUrl={session.homeUrl()}
        expiresIn={Math.max(claims.exp - Math.floor(Date.now() / 1000), 0)}
      />
    </main>
  );
}
