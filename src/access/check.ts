import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkManifest } from "../conformance/manifest.js";
import { checkPresets } from "../conformance/presets.js";
import { probeRoutes, type RouteInfo } from "../conformance/routes.js";
import { checkNoRoleNames, checkPermissionUsage } from "../conformance/source.js";
import { formatFindings, mergeResults, type CheckResult, type ManifestEntry, type RolePreset } from "../conformance/types.js";

// `mws-access check`: the same checks on every app, read from `access.config.json` at the root of the app.
//
// {
//   "application": "woko",
//   "manifest": "packages/domain/dist/manifest.json",            // JSON, or a module (run the command under tsx for .ts)
//   "manifestExport": "permissionManifest",                       // which export, when a module has several
//   "presets": "role-presets.json",
//   "source": { "roots": ["apps/api/src"], "manifestFiles": ["packages/domain/src/permissions.ts"] },
//   "roleNames": ["ADMINISTRATOR"], "roleNameAllow": [{ "file": "src/labels.ts", "reason": "display label" }],
//   "legacyKeys": [],
//   "probe": { "module": "scripts/access-probe.ts", "open": ["GET /me", "/health/*"] }
// }
//
// The probe module exports `createProbe(): Promise<{ routes: RouteInfo[]; call(route): Promise<number>; close?(): Promise<void> }>`.
// It starts the app, lists its routes and sends each one as a signed-in person with no permissions.

export interface AccessConfig {
  application: string;
  manifest: string;
  manifestExport?: string;
  presets?: string;
  source?: { roots: string[]; manifestFiles?: string[] };
  roleNames?: string[];
  roleNameAllow?: Array<{ file: string; reason: string }>;
  legacyKeys?: string[];
  probe?: { module: string; open: string[] };
  // For `mws-access doctor`: the name this app gives its own web address (default APP_BASE_URL), and the lines it needs.
  doctor?: { appUrlEnv?: string; env?: string[] };
}

export interface Probe {
  routes: RouteInfo[];
  call(route: RouteInfo): Promise<number>;
  close?(): Promise<void>;
}

async function loadModule(cwd: string, path: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(resolve(cwd, path)).href)) as Record<string, unknown>;
}

function pickManifest(loaded: Record<string, unknown>, name?: string): ManifestEntry[] {
  const candidates = name ? [name] : ["default", "manifest", "permissionManifest", "PERMISSION_MANIFEST", "permissions"];
  for (const candidate of candidates) {
    const value = loaded[candidate] as unknown;
    if (Array.isArray(value) && value.every((entry) => entry && typeof entry === "object" && "key" in entry)) return value as ManifestEntry[];
    const nested = (value as { manifest?: unknown } | undefined)?.manifest;
    if (Array.isArray(nested)) return nested as ManifestEntry[];
  }
  throw new Error(`No manifest found${name ? ` in the export "${name}"` : ""}. Export an array of { key, description, requires } or the result of definePermissions.`);
}

export async function loadManifest(cwd: string, config: AccessConfig): Promise<ManifestEntry[]> {
  if (config.manifest.endsWith(".json")) {
    const parsed = JSON.parse(await readFile(resolve(cwd, config.manifest), "utf8")) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { permissions?: unknown; manifest?: unknown }).permissions ?? (parsed as { manifest?: unknown }).manifest;
    if (!Array.isArray(list)) throw new Error(`${config.manifest} has no list of permissions.`);
    return list as ManifestEntry[];
  }
  return pickManifest(await loadModule(cwd, config.manifest), config.manifestExport);
}

export async function checkAccess(cwd: string, config: AccessConfig): Promise<CheckResult> {
  const manifest = await loadManifest(cwd, config);
  const results: CheckResult[] = [checkManifest(manifest, { application: config.application, legacyKeys: config.legacyKeys })];
  if (config.presets) {
    const file = JSON.parse(await readFile(resolve(cwd, config.presets), "utf8")) as { roles?: RolePreset[] };
    results.push(checkPresets(file.roles ?? [], manifest));
  }
  if (config.source) {
    results.push(await checkPermissionUsage({ roots: config.source.roots, manifest, manifestFiles: config.source.manifestFiles ?? [], cwd }));
    if (config.roleNames?.length) {
      results.push(await checkNoRoleNames({ roots: config.source.roots, roleNames: config.roleNames, allow: config.roleNameAllow, cwd }));
    }
  }
  if (config.probe) {
    const loaded = await loadModule(cwd, config.probe.module);
    if (typeof loaded.createProbe !== "function") throw new Error(`${config.probe.module} has to export createProbe().`);
    const probe = (await (loaded.createProbe as () => Promise<Probe>)()) as Probe;
    try {
      results.push(await probeRoutes({ routes: probe.routes, open: config.probe.open, call: probe.call }));
    } finally {
      await probe.close?.();
    }
  }
  return mergeResults(...results);
}

export async function runAccessCheck(options: { cwd?: string; configPath?: string; output?: Pick<Console, "log" | "error"> } = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const output = options.output ?? console;
  let config: AccessConfig;
  try {
    config = JSON.parse(await readFile(resolve(cwd, options.configPath ?? "access.config.json"), "utf8")) as AccessConfig;
    if (!config.application || !config.manifest) throw new Error("access.config.json needs application and manifest.");
  } catch (error) {
    output.error(`Cannot read access.config.json: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  try {
    const result = await checkAccess(cwd, config);
    output.log(formatFindings(result) || `${config.application}: the Access Standard checks pass.`);
    output.log(`${result.problems.length} problem(s), ${result.warnings.length} warning(s).`);
    return result.problems.length > 0 ? 1 : 0;
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
