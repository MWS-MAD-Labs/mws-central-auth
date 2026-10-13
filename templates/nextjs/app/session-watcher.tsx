"use client";

import { watchSession } from "mws-central-auth/client";
import { useEffect } from "react";

// When a sign-out in another app ends this session, leave when the tab is looked at again.
export function SessionWatcher() {
  useEffect(
    () =>
      watchSession({
        check: async () => (await fetch("/api/me", { cache: "no-store" })).ok,
        onRevoked: () => {
          window.location.href = "/";
        },
      }),
    [],
  );
  return null;
}
