import { z } from "zod";

// Mirrors the payload mws-hub/backend/src/lib/sso-relay.ts mints in
// mintRelayToken(). Keep both in sync if Hub adds a claim.
export const relayTokenPayloadSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  // Central's Person.id, not email - this is the actual identity anchor.
  // Key your own session/user records off this, never off `email` below:
  // Central allows editing an employee's email, so a lookup keyed by it can
  // silently go stale mid-session the moment someone's email changes there.
  // sub never has that problem - it's Central's stable internal id.
  sub: z.string().min(1),
  // Carried for display/contact purposes only (e.g. showing "signed in as
  // ...", or a support ticket). Never use this as a key.
  email: z.email(),
  source: z.enum(["employee", "student"]),
  tags: z.array(z.string()),
  jti: z.uuid(),
  iat: z.number(),
  exp: z.number(),
});

export type RelayTokenPayload = z.infer<typeof relayTokenPayloadSchema>;

export interface ReplayStore {
  hasSeen(jti: string): Promise<boolean> | boolean;
  markSeen(jti: string, ttlSeconds: number): Promise<void> | void;
}
