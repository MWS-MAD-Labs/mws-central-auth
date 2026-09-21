import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Mirrors the body Hub's revokeSessionsForUser() sends
// (mws-hub/backend/src/lib/session-revocation.ts) to each app's
// /auth/revoke-session - always email, central_id only when Hub has it.
const hubInternalRevocationPayloadSchema = z.object({
  email: z.string().email(),
  central_id: z.string().optional(),
});

export type HubInternalRevocationPayload = z.infer<typeof hubInternalRevocationPayloadSchema>;

export class HubInternalRequestVerificationError extends Error {}

// Compares the X-Hub-Internal-Secret header a satellite app's
// /auth/revoke-session receives against its own configured secret.
// Constant-time - avoids leaking how many leading bytes of the secret a
// guess got right via response-time differences.
export function verifyHubInternalSecret(providedSecret: string | null | undefined, expectedSecret: string): boolean {
  if (typeof providedSecret !== "string" || providedSecret.length === 0) return false;
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(expectedSecret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function parseHubRevocationPayload(body: unknown): HubInternalRevocationPayload {
  const result = hubInternalRevocationPayloadSchema.safeParse(body);
  if (!result.success) throw new HubInternalRequestVerificationError("Invalid Hub revocation payload.");
  return result.data;
}
