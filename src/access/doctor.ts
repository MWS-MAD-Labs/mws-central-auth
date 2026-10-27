import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CentralDataClient } from "../data-client/client.js";
import { CentralApiError } from "../data-client/types.js";
import { centralOrigin } from "./cli.js";
import { loadManifest, type AccessConfig } from "./check.js";

// `mws-access doctor`: why an application does not sign people in, answered the same way for every app.
// It reads the .env (or the environment), asks the Hub and Central, and says what to change. It never prints a value of
// a secret.

export type DoctorStatus = "ok" | "fail" | "skip";

export interface DoctorFinding {
  name: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

export interface DoctorOptions {
  cwd?: string;
  config: AccessConfig;
  env: Record<string, string | undefined>;
  // The address of the running application. When given, it is asked who it thinks an anonymous visitor is.
  url?: string;
  mePath?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_APP_URL = "APP_BASE_URL";
const required = (config: AccessConfig) =>
  config.doctor?.env ?? ["HUB_BASE_URL", "CENTRAL_API_BASE_URL", "CENTRAL_API_TOKEN", "CENTRAL_ORGANIZATION_ID", config.doctor?.appUrlEnv ?? DEFAULT_APP_URL];

// KEY=value lines of a .env. Quotes are taken off, comments and blank lines are skipped.
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]!] = value;
  }
  return values;
}

const isUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export async function runDoctorChecks(options: DoctorOptions): Promise<DoctorFinding[]> {
  const { config, env } = options;
  const application = env.CENTRAL_APPLICATION_ID?.trim() || config.application;
  const doFetch = options.fetchImpl ?? fetch;
  const findings: DoctorFinding[] = [];
  const add = (finding: DoctorFinding) => findings.push(finding);

  const appUrlEnv = config.doctor?.appUrlEnv ?? DEFAULT_APP_URL;
  const missing = required(config).filter((name) => !env[name]?.trim());
  add(
    missing.length
      ? { name: "Environment", status: "fail", detail: `Missing: ${missing.join(", ")}.`, fix: `Copy the block Central shows when the application is added or its token is rotated, and set ${appUrlEnv} to the address people open the app at.` }
      : { name: "Environment", status: "ok", detail: "All the lines are set." },
  );
  const badUrls = ["HUB_BASE_URL", "CENTRAL_API_BASE_URL", appUrlEnv].filter((name) => env[name]?.trim() && !isUrl(env[name]!.trim()));
  if (badUrls.length) add({ name: "Addresses", status: "fail", detail: `${badUrls.join(", ")} must start with http:// or https://.`, fix: "Write the whole address, with the scheme." });

  // The Hub: its keys must be readable, or nobody's session can be checked.
  const hub = env.HUB_BASE_URL?.trim();
  if (hub && isUrl(hub)) {
    try {
      const response = await doFetch(`${hub.replace(/\/+$/, "")}/.well-known/jwks.json`);
      const body = response.ok ? ((await response.json()) as { keys?: unknown[] }) : null;
      add(
        body?.keys?.length
          ? { name: "Hub", status: "ok", detail: "The Hub answers and publishes its keys." }
          : { name: "Hub", status: "fail", detail: `The Hub's key address answered ${response.status}${response.ok ? " with no keys" : ""}.`, fix: "Check HUB_BASE_URL points at the Hub itself and that the Hub is running." },
      );
    } catch (error) {
      add({ name: "Hub", status: "fail", detail: `Could not reach the Hub: ${error instanceof Error ? error.message : String(error)}.`, fix: "Check HUB_BASE_URL and that the Hub is running." });
    }
  } else add({ name: "Hub", status: "skip", detail: "HUB_BASE_URL is not usable." });

  // Central: the token has to work, and has to be the one made for this application.
  const base = env.CENTRAL_API_BASE_URL?.trim();
  const token = env.CENTRAL_API_TOKEN?.trim();
  let registered: Array<{ key: string; deprecated: boolean }> | null = null;
  if (base && token && isUrl(base)) {
    const client = new CentralDataClient({ baseUrl: centralOrigin(base), token, organizationId: env.CENTRAL_ORGANIZATION_ID, fetchImpl: options.fetchImpl });
    try {
      registered = await client.listRegisteredPermissions(application);
      add({ name: "Central token", status: "ok", detail: `The token is accepted and belongs to ${application}.` });
    } catch (error) {
      if (error instanceof CentralApiError && error.status === 401) {
        add({ name: "Central token", status: "fail", detail: "Central does not accept the token.", fix: "Rotate the token in Central (Application Access) and copy the new block into the .env." });
      } else if (error instanceof CentralApiError && error.status === 403) {
        add({ name: "Central token", status: "fail", detail: error.message, fix: `The API client has to be made under the integration profile with the code "${application}", with the scopes application_permissions:write and application_entitlements:read.` });
      } else if (error instanceof CentralApiError && error.status === 404) {
        add({ name: "Central token", status: "fail", detail: `Central does not know the application "${application}".`, fix: "Add the application in Central, or set CENTRAL_APPLICATION_ID to the id it has there." });
      } else {
        add({ name: "Central token", status: "fail", detail: `Could not reach Central: ${error instanceof Error ? error.message : String(error)}.`, fix: "Check CENTRAL_API_BASE_URL and that Central is running." });
      }
    }
  } else add({ name: "Central token", status: "skip", detail: "CENTRAL_API_BASE_URL or CENTRAL_API_TOKEN is not usable." });

  // The code and Central have to agree on the permissions.
  if (registered) {
    try {
      const manifest = await loadManifest(options.cwd ?? process.cwd(), config);
      const known = new Set(registered.filter((entry) => !entry.deprecated).map((entry) => entry.key));
      const notPublished = manifest.map((entry) => entry.key).filter((key) => !known.has(key));
      add(
        notPublished.length
          ? { name: "Permissions", status: "fail", detail: `Central does not have: ${notPublished.join(", ")}.`, fix: "Run the permissions:sync command of the application." }
          : { name: "Permissions", status: "ok", detail: `Central has all ${manifest.length} permissions of the code.` },
      );
    } catch (error) {
      add({ name: "Permissions", status: "fail", detail: `The manifest could not be read: ${error instanceof Error ? error.message : String(error)}.` });
    }
    // Somebody has to be allowed in, or every sign-in ends in "no access".
    try {
      const client = new CentralDataClient({ baseUrl: centralOrigin(base!), token: token!, organizationId: env.CENTRAL_ORGANIZATION_ID, fetchImpl: options.fetchImpl });
      const entitlements = await client.listAllApplicationEntitlements({ application_id: application });
      add(
        entitlements.length
          ? { name: "Access", status: "ok", detail: `${entitlements.length} people can use ${application}.` }
          : { name: "Access", status: "fail", detail: `Nobody has access to ${application} yet.`, fix: "In Central, give a role to a person or an access group, and make sure the application is Single Sign-On with the Shared Hub Session." },
      );
    } catch (error) {
      add({ name: "Access", status: "fail", detail: `The list of people with access could not be read: ${error instanceof Error ? error.message : String(error)}.`, fix: "The API client needs the scope application_entitlements:read." });
    }
  }

  // The running application: an anonymous visitor has to be turned away. An answer means it is not looking at the Hub.
  if (options.url) {
    const address = `${options.url.replace(/\/+$/, "")}${options.mePath ?? "/api/v1/me"}`;
    try {
      const response = await doFetch(address, { redirect: "manual" });
      add(
        response.status === 401
          ? { name: "Running app", status: "ok", detail: "It turns away a visitor without the Hub session." }
          : response.status === 200
            ? { name: "Running app", status: "fail", detail: "It answers as a signed-in person without any cookie.", fix: "It is not in the Hub sign-in mode, or it was not restarted after the .env changed. Set the mode, then restart it." }
            : { name: "Running app", status: "fail", detail: `${address} answered ${response.status}, not 401.`, fix: "Check the address and the --me-path." },
      );
    } catch (error) {
      add({ name: "Running app", status: "fail", detail: `Could not reach ${address}: ${error instanceof Error ? error.message : String(error)}.`, fix: "Start the application, or leave out --url." });
    }
  }
  return findings;
}

export function formatDoctor(findings: DoctorFinding[]): string {
  const mark = { ok: "ok  ", fail: "FAIL", skip: "skip" } as const;
  return findings
    .map((finding) => `${mark[finding.status]} ${finding.name}: ${finding.detail}${finding.status === "fail" && finding.fix ? `\n     Fix: ${finding.fix}` : ""}`)
    .join("\n");
}

export async function runDoctor(options: {
  cwd?: string;
  configPath?: string;
  envFile?: string;
  url?: string;
  mePath?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  output?: Pick<Console, "log" | "error">;
}): Promise<number> {
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
  let fileValues: Record<string, string> = {};
  try {
    fileValues = parseEnvFile(await readFile(resolve(cwd, options.envFile ?? ".env"), "utf8"));
  } catch {
    // No .env file: the environment alone is used.
  }
  const findings = await runDoctorChecks({ cwd, config, env: { ...fileValues, ...(options.env ?? process.env) }, url: options.url, mePath: options.mePath, fetchImpl: options.fetchImpl });
  output.log(formatDoctor(findings));
  const failed = findings.filter((finding) => finding.status === "fail").length;
  output.log(failed ? `${failed} thing(s) to fix.` : `${config.application}: ready to sign people in.`);
  return failed ? 1 : 0;
}
