import { redirect } from "next/navigation";
import { hubSso } from "@/lib/hub-sso";
import { currentUser } from "@/lib/session";
import { SessionWatcher } from "./session-watcher";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await currentUser();

  if (!user) {
    if (error) {
      return (
        <main>
          <h1>My New App</h1>
          <p>{error === "no_access" ? "You do not have access to this application." : "Sign-in failed. Try again from the Hub."}</p>
        </main>
      );
    }
    // A visit without a session goes to the Hub, where the person picks an app.
    redirect(hubSso().homeUrl());
  }

  return (
    <main>
      <h1>My New App</h1>
      <p>
        Signed in as {user.email} ({user.role}).
      </p>
      <p>
        <a href="/auth/logout">Log out</a>
      </p>
      <SessionWatcher />
    </main>
  );
}
