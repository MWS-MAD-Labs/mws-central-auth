// The app's own record of a signed-in person. In memory here so the starter runs on its own:
// replace this file with your database (Prisma, Postgres). Keep the same four functions.
//
// sessionVersion is what makes a sign-out elsewhere stick: bumping it makes every session cookie issued
// before that point invalid.
export interface AppUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  entitlementVersion: number;
  sessionVersion: number;
}

// Module state survives hot reloads in dev and is per process in production. Use a database for more than one instance.
const globalStore = globalThis as unknown as { __appUsers?: Map<string, AppUser> };
const users = (globalStore.__appUsers ??= new Map<string, AppUser>());

interface RelayLike {
  sub: string;
  email: string;
  entitlement: { role: string; permissions: string[]; version: number };
}

// Called after a verified sign-in. The Hub's entitlement says what this person may do here.
export function upsertFromRelay(relay: RelayLike): AppUser {
  const current = users.get(relay.sub);
  const user: AppUser = {
    id: relay.sub,
    email: relay.email,
    role: relay.entitlement.role,
    permissions: relay.entitlement.permissions,
    entitlementVersion: relay.entitlement.version,
    sessionVersion: current?.sessionVersion ?? 0,
  };
  users.set(relay.sub, user);
  return user;
}

export function findById(id: string): AppUser | null {
  return users.get(id) ?? null;
}

// Ends the sessions of one person, or of everybody when `all` is true. Returns whether anyone was affected.
export function endSessions(scope: { personId?: string; email?: string; all?: boolean }): boolean {
  let affected = 0;
  for (const user of users.values()) {
    if (scope.all || (scope.personId && user.id === scope.personId) || (scope.email && user.email === scope.email.toLowerCase())) {
      user.sessionVersion += 1;
      affected += 1;
    }
  }
  return affected > 0;
}
