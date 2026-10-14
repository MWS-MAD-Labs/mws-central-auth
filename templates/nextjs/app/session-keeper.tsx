"use client";

import { keepFresh } from "mws-central-auth/client";
import { useEffect } from "react";

// Asks the Hub for a new token shortly before this one ends. Signing out of the Hub ends the session here too.
export function SessionKeeper({ refreshUrl, homeUrl, expiresIn }: { refreshUrl: string; homeUrl: string; expiresIn: number }) {
  useEffect(
    () =>
      keepFresh({
        refreshUrl,
        initialExpiresIn: expiresIn,
        onEnded: () => {
          window.location.href = homeUrl;
        },
      }),
    [refreshUrl, homeUrl, expiresIn],
  );
  return null;
}
