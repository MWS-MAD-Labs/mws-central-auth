import { CentralDataClient } from "../data-client/client.js";
import { CentralApiError } from "../data-client/types.js";
import { comparePermissions, permissionCheckFailed, type PermissionCheck } from "../data-client/permissions.js";
import type { ManifestEntry } from "../conformance/types.js";
import type { PermissionManifestEntry, PermissionSyncResult, RegisteredPermission } from "../data-client/types.js";

// The permissions:sync and permissions:check commands (Access Standard AS-4), the same in every app. The app's script is:
//
//   import { runPermissionsCli } from "mws-central-auth/access/cli";
//   import { permissions } from "./permissions";
//   process.exit(await runPermissionsCli({ application: permissions.application, manifest: permissions.manifest }));
//
//   npm run permissions:sync  -- [--check] [--confirm-removals] [--allow-removals] [--soft] [--retries N] [--wait SECONDS]
//   npm run permissions:check -- [--allow-removals] [--soft] [--retries N] [--wait SECONDS]

const usage = `Usage:
  permissions:sync  [--check] [--confirm-removals] [--allow-removals] [--soft] [--retries N] [--wait SECONDS]
  permissions:check [--allow-removals] [--before-deploy] [--soft] [--retries N] [--wait SECONDS]

Needs CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN. CENTRAL_ORGANIZATION_ID is sent when set. CENTRAL_APPLICATION_ID replaces the application id.`;

export interface PermissionsClient {
  publishPermissions(applicationId: string, permissions: PermissionManifestEntry[], options?: { confirmRemovals?: boolean }): Promise<PermissionSyncResult>;
  listRegisteredPermissions(applicationId: string): Promise<RegisteredPermission[]>;
  permissionUsage(applicationId: string): Promise<string[]>;
}

export interface PermissionsCliOptions {
  application: string;
  manifest: readonly ManifestEntry[];
  // "sync" or "check" first, then the flags. Defaults to what the script was started with after the command name.
  argv?: string[];
  command?: "sync" | "check";
  env?: Partial<Record<string, string | undefined>>;
  output?: Pick<Console, "log" | "warn" | "error">;
  client?: PermissionsClient;
  sleep?: (ms: number) => Promise<void>;
}

interface Parsed {
  mode: "sync" | "check";
  confirmRemovals: boolean;
  allowRemovals: boolean;
  soft: boolean;
  // For CI before a deploy: only roles that use a permission the code no longer knows fail it.
  beforeDeploy: boolean;
  retries: number;
  waitMs: number;
}

export function parsePermissionsArguments(argv: string[], command: "sync" | "check"): Parsed {
  const parsed: Parsed = { mode: command, confirmRemovals: false, allowRemovals: false, beforeDeploy: false, soft: false, retries: 0, waitMs: 5000 };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") parsed.mode = "check";
    else if (flag === "--confirm-removals") parsed.confirmRemovals = true;
    else if (flag === "--allow-removals") parsed.allowRemovals = true;
    else if (flag === "--soft") parsed.soft = true;
    else if (flag === "--before-deploy") parsed.beforeDeploy = true;
    else if (flag === "--retries" || flag === "--wait") {
      const value = argv[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${flag} needs a whole number.\n${usage}`);
      index += 1;
      if (flag === "--retries") parsed.retries = Number(value);
      else parsed.waitMs = Number(value) * 1000;
    } else throw new Error(`Unknown option ${flag}.\n${usage}`);
  }
  if (command === "check" && parsed.confirmRemovals) throw new Error(`--confirm-removals is for permissions:sync.\n${usage}`);
  return parsed;
}

export function describePermissionCheck(check: PermissionCheck): string[] {
  const lines: string[] = [];
  if (check.notRegistered.length) lines.push(`Would add: ${check.notRegistered.join(", ")}`);
  if (check.wouldDrop.length) lines.push(`Would drop: ${check.wouldDrop.join(", ")}`);
  if (check.unknownToCode.length) lines.push(`Roles in Central carry permissions the code does not know: ${check.unknownToCode.join(", ")}`);
  if (check.requiresDiffer.length) lines.push(`Needs differ from Central: ${check.requiresDiffer.join(", ")}`);
  return lines.length ? lines : ["The code and Central agree."];
}

// The address may be given with or without /api/internal.
export function centralOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\/api\/internal$/, "");
}

// Returns the exit code. Network failures and 5xx are tried again (Central may be deploying); a refusal is not.
export async function runPermissionsCli(options: PermissionsCliOptions): Promise<number> {
  const output = options.output ?? console;
  const env = options.env ?? process.env;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const application = env.CENTRAL_APPLICATION_ID?.trim() || options.application;
  const manifest: PermissionManifestEntry[] = options.manifest.map((entry) => ({ key: entry.key, description: entry.description, ...(entry.requires ? { requires: [...entry.requires] } : {}) }));

  let args: Parsed;
  let client: PermissionsClient;
  try {
    const rawArgv = options.argv ?? process.argv.slice(2);
    const command = options.command ?? (rawArgv[0] === "check" ? "check" : "sync");
    args = parsePermissionsArguments(options.argv ? rawArgv : rawArgv.slice(rawArgv[0] === "sync" || rawArgv[0] === "check" ? 1 : 0), command);
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  try {
    if (options.client) client = options.client;
    else {
      const baseUrl = env.CENTRAL_API_BASE_URL?.trim();
      const token = env.CENTRAL_API_TOKEN?.trim();
      if (!baseUrl || !token) throw new Error(`CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN are required.\n${usage}`);
      client = new CentralDataClient({ baseUrl: centralOrigin(baseUrl), token, organizationId: env.CENTRAL_ORGANIZATION_ID });
    }
  } catch (error) {
    // --soft is for "predev": a Central that is not set up must not stop a developer from starting the app.
    output[args.soft ? "warn" : "error"](error instanceof Error ? error.message : String(error));
    return args.soft ? 0 : 1;
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      if (args.mode === "sync") {
        const result = await client.publishPermissions(application, manifest, { confirmRemovals: args.confirmRemovals });
        output.log(`Published ${result.total} permissions to ${application}: ${result.added} added, ${result.deprecated.length} dropped.`);
        if (result.legacy_keys?.length) output.warn(`Still in an old format: ${result.legacy_keys.join(", ")}`);
        for (const role of result.affected_roles) output.warn(`Role ${role.role} still carries dropped permissions: ${role.permissions.join(", ")}`);
        return 0;
      }
      const [registered, usage] = await Promise.all([client.listRegisteredPermissions(application), client.permissionUsage(application)]);
      const check = comparePermissions(manifest, registered, usage);
      for (const line of describePermissionCheck(check)) output.log(line);
      const failed = args.beforeDeploy ? check.unknownToCode.length > 0 : permissionCheckFailed(check, { allowRemovals: args.allowRemovals });
      return failed && !args.soft ? 1 : 0;
    } catch (error) {
      const refused = error instanceof CentralApiError && error.status > 0 && error.status < 500;
      if (!refused && attempt < args.retries) {
        output.warn(`Central did not answer (${error instanceof Error ? error.message : "error"}). Trying again in ${args.waitMs / 1000}s.`);
        await sleep(args.waitMs);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      output.error(refused ? `Central refused: ${message}` : `Could not reach Central: ${message}`);
      return args.soft ? 0 : 1;
    }
  }
}
