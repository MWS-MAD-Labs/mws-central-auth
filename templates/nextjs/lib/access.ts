import { required } from "./hub";

export interface Access {
  role: string;
  permissions: string[];
}

interface Entitlement {
  organization_id: string;
  role: string;
  permissions: string[];
  is_active: boolean;
}

// What this person may do in this app comes from Central, not from the Hub's token (which only says who they are).
// Answers are kept for a minute, so a change in Central shows up within that time.
const CACHE_MS = 60_000;
const globalCache = globalThis as unknown as { __accessCache?: Map<string, { at: number; value: Access | null }> };
const cache = (globalCache.__accessCache ??= new Map());

async function lookupEntitlement(personId: string): Promise<Entitlement | null> {
  const url = new URL(`${required("CENTRAL_API_BASE_URL").replace(/\/$/, "")}/application-entitlements/lookup`);
  url.searchParams.set("person_id", personId);
  url.searchParams.set("application_id", required("HUB_SSO_APP_ID"));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${required("CENTRAL_API_TOKEN")}`, accept: "application/json" },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  // Central stopped this application (it was retired): nobody has access.
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "application_retired") return null;
  }
  if (!response.ok) throw new Error(`Central answered ${response.status}`);
  const body = (await response.json()) as { data?: Entitlement | null };
  return body.data ?? null;
}

// The person's role and permissions in this app, or null when they have no access. Throws when Central cannot be asked.
export async function accessFor(personId: string): Promise<Access | null> {
  const cached = cache.get(personId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const entitlement = await lookupEntitlement(personId);
  const usable =
    entitlement &&
    entitlement.is_active &&
    entitlement.organization_id === required("CENTRAL_ORGANIZATION_ID") &&
    entitlement.permissions.length > 0;
  const value = usable ? { role: entitlement.role, permissions: entitlement.permissions } : null;
  cache.set(personId, { at: Date.now(), value });
  return value;
}
