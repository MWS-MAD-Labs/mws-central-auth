import { emptyResult, type CheckResult } from "./types.js";

export interface RouteInfo {
  method: string;
  url: string;
}

export interface RouteTracker {
  routes(): RouteInfo[];
}

interface HasOnRouteHook {
  addHook(name: "onRoute", handler: (route: { method: string | string[]; url: string }) => void): unknown;
}

// Fastify: call this right after creating the app, before any route or plugin is registered, so every route is seen.
export function trackFastifyRoutes(app: HasOnRouteHook): RouteTracker {
  const seen = new Map<string, RouteInfo>();
  app.addHook("onRoute", (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      seen.set(`${method} ${route.url}`, { method, url: route.url });
    }
  });
  return { routes: () => [...seen.values()] };
}

export interface ProbeOptions {
  routes: readonly RouteInfo[];
  // Routes that may be reached without a permission (AS-6): "GET /me", "POST /auth/logout", or a pattern like "/health/*" or "/work-lists/*/submit".
  // A pattern without a method matches every method, and "*" matches any run of characters.
  open: readonly string[];
  // Sends the request as a signed-in person who holds no permission at all, and returns the status code.
  call(request: RouteInfo): Promise<number>;
  // Values for route parameters, by name. Anything not listed gets a UUID that matches nothing.
  params?: Readonly<Record<string, string>>;
  // Statuses that can come from validation before the gate runs, so they say nothing either way. Reported as warnings.
  inconclusive?: readonly number[];
}

const NO_ROW = "00000000-0000-4000-8000-000000000000";

export function isOpenRoute(route: RouteInfo, open: readonly string[]): boolean {
  return open.some((pattern) => {
    const [first, ...rest] = pattern.split(" ");
    const hasMethod = rest.length > 0;
    const path = hasMethod ? rest.join(" ") : (first as string);
    if (hasMethod && first!.toUpperCase() !== route.method.toUpperCase()) return false;
    if (!path.includes("*")) return route.url === path;
    return new RegExp(`^${path.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(route.url);
  });
}

export function fillParams(url: string, params: Readonly<Record<string, string>> = {}): string {
  return url.replace(/:([A-Za-z0-9_]+)\??/g, (_, name: string) => params[name] ?? NO_ROW).replace(/\*/g, "x");
}

// AS-6, deny by default: every route that is not on the open list has to turn away a signed-in person with no
// permissions (401 or 403). Any other answer means the gate let the request through to the route.
export async function probeRoutes(options: ProbeOptions): Promise<CheckResult> {
  const result = emptyResult();
  const inconclusive = new Set(options.inconclusive ?? [400, 413, 415, 422]);
  for (const route of options.routes) {
    if (isOpenRoute(route, options.open)) continue;
    const status = await options.call({ method: route.method, url: fillParams(route.url, options.params) });
    const label = `${route.method} ${route.url}`;
    if (status === 401 || status === 403) continue;
    if (inconclusive.has(status)) {
      result.warnings.push({ rule: "AS-6", message: `${label} answered ${status} before the gate could be seen. Check it by hand.` });
    } else {
      result.problems.push({ rule: "AS-6", message: `${label} answered ${status} to a person with no permissions. It needs a gate, or has to be on the open list.` });
    }
  }
  return result;
}
