import { z } from "zod";

// Mirrors the payload mws-hub/backend/src/lib/sso-relay.ts mints in
// mintRelayToken(). Keep both in sync if Hub adds a claim.
export const relayTokenPayloadSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.email(),
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
