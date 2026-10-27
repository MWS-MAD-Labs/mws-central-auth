// What an app does with the entitlement Central gives for a person (Access Standard AS-10 and AS-11): a person with no
// access is turned away, an inactive or other-organization entitlement is refused, a permission the app does not know is
// never a right, and the answer is kept for no longer than a minute so a withdrawn access ends quickly.

export interface EntitlementLike {
  id: string;
  application_id: string;
  organization_id: string;
  role: string;
  permissions: readonly string[];
  version: number;
  is_active: boolean;
}

export type AccessDenial = "no-access" | "inactive" | "wrong-organization" | "wrong-application" | "no-use";

export type AccessResult =
  | {
      status: "allowed";
      personId: string;
      // For display and audit only. Never decide on it.
      role: string;
      // The permissions the app knows. These are the rights.
      permissions: string[];
      // Permissions in the entitlement that the app does not know. Reported, never granted.
      ignored: string[];
      entitlementId: string;
      version: number;
    }
  | { status: "denied"; personId: string; reason: AccessDenial }
  // Central could not be asked. The app decides what to show; nothing is granted and nothing is kept.
  | { status: "unavailable"; personId: string; error: unknown };

export interface AccessResolverOptions {
  application: string;
  // The permission keys of the app (the manifest). `<application>.use` has to be among them.
  permissions: readonly string[];
  // The Organization ID of the app in Central. When set, an entitlement of another organization is refused.
  organizationId?: string;
  // Asks Central. Returns null when the person has no access (404).
  lookup(personId: string): Promise<EntitlementLike | null>;
  // How long an answer is kept. At most 60 seconds (AS-11).
  cacheSeconds?: number;
  // How long "no access" is kept. At most 5 minutes (AS-10).
  notFoundSeconds?: number;
  now?: () => number;
}

export interface AccessResolver {
  resolve(personId: string): Promise<AccessResult>;
  // Forget one person, or everyone.
  invalidate(personId?: string): void;
}

const MAX_CACHE_SECONDS = 60;
const MAX_NOT_FOUND_SECONDS = 300;

export function createAccessResolver(options: AccessResolverOptions): AccessResolver {
  const known = new Set(options.permissions);
  const use = `${options.application}.use`;
  if (!known.has(use)) throw new Error(`The permissions of ${options.application} have no "${use}".`);
  const now = options.now ?? Date.now;
  const keepMs = Math.min(Math.max(options.cacheSeconds ?? MAX_CACHE_SECONDS, 0), MAX_CACHE_SECONDS) * 1000;
  const keepNotFoundMs = Math.min(Math.max(options.notFoundSeconds ?? 30, 0), MAX_NOT_FOUND_SECONDS) * 1000;
  const cache = new Map<string, { until: number; result: AccessResult }>();
  const inFlight = new Map<string, Promise<AccessResult>>();

  function decide(personId: string, entitlement: EntitlementLike | null): AccessResult {
    if (!entitlement) return { status: "denied", personId, reason: "no-access" };
    if (entitlement.application_id !== options.application) return { status: "denied", personId, reason: "wrong-application" };
    if (!entitlement.is_active) return { status: "denied", personId, reason: "inactive" };
    if (options.organizationId && entitlement.organization_id !== options.organizationId) {
      return { status: "denied", personId, reason: "wrong-organization" };
    }
    const permissions = [...new Set(entitlement.permissions)].filter((key) => known.has(key));
    const ignored = [...new Set(entitlement.permissions)].filter((key) => !known.has(key));
    if (!permissions.includes(use)) return { status: "denied", personId, reason: "no-use" };
    return { status: "allowed", personId, role: entitlement.role, permissions, ignored, entitlementId: entitlement.id, version: entitlement.version };
  }

  async function ask(personId: string): Promise<AccessResult> {
    let entitlement: EntitlementLike | null;
    try {
      entitlement = await options.lookup(personId);
    } catch (error) {
      return { status: "unavailable", personId, error };
    }
    const result = decide(personId, entitlement);
    const ms = result.status === "denied" && result.reason === "no-access" ? keepNotFoundMs : keepMs;
    if (ms > 0) cache.set(personId, { until: now() + ms, result });
    return result;
  }

  return {
    async resolve(personId) {
      const cached = cache.get(personId);
      if (cached && cached.until > now()) return cached.result;
      cache.delete(personId);
      // Two requests for the same person at once ask Central once.
      const pending = inFlight.get(personId) ?? ask(personId).finally(() => inFlight.delete(personId));
      inFlight.set(personId, pending);
      return pending;
    },
    invalidate(personId) {
      if (personId === undefined) cache.clear();
      else cache.delete(personId);
    },
  };
}
