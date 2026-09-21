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
export function verifyHubInternalSecret(providedSecret: string | null | undefined, expectedSecret: string): boolean {
  return typeof providedSecret === "string" && providedSecret.length > 0 && providedSecret === expectedSecret;
}

export function parseHubRevocationPayload(body: unknown): HubInternalRevocationPayload {
  const result = hubInternalRevocationPayloadSchema.safeParse(body);
  if (!result.success) throw new HubInternalRequestVerificationError("Invalid Hub revocation payload.");
  return result.data;
}
