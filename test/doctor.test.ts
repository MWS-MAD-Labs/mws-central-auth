import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDoctor, parseEnvFile, runDoctor, runDoctorChecks } from "../src/access/doctor";

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

const env = {
  HUB_BASE_URL: "https://hub.example.org",
  CENTRAL_API_BASE_URL: "https://central.example.org/api/internal",
  CENTRAL_API_TOKEN: "mws_abc.secret-value",
  CENTRAL_ORGANIZATION_ID: "org_x",
  APP_BASE_URL: "https://app.example.org",
};

async function project() {
  const cwd = await mkdtemp(join(tmpdir(), "mws-doctor-"));
  dirs.push(cwd);
  await writeFile(join(cwd, "manifest.json"), JSON.stringify([{ key: "inv.use", description: "Sign in" }, { key: "inv.read", description: "See", requires: ["inv.use"] }]));
  const config = { application: "inv", manifest: "manifest.json" };
  await writeFile(join(cwd, "access.config.json"), JSON.stringify(config));
  return { cwd, config };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// The Hub and Central as they are when everything is right. Each test changes one answer.
function world(overrides: Partial<Record<"jwks" | "permissions" | "entitlements" | "me", () => Response>> = {}) {
  const answers = {
    jwks: () => json(200, { keys: [{ kid: "k1" }] }),
    permissions: () => json(200, { success: true, data: [{ key: "inv.use", deprecated: false }, { key: "inv.read", deprecated: false }] }),
    entitlements: () => json(200, { success: true, data: [{ person_id: "p1" }], paging: { current_page: 1, total_page: 1, total_item: 1, size: 200 } }),
    me: () => json(401, {}),
    ...overrides,
  };
  return (async (input: URL | string) => {
    const url = String(input);
    if (url.includes("/.well-known/jwks.json")) return answers.jwks();
    if (url.includes("/api/internal/application-permissions/")) return answers.permissions();
    if (url.includes("/api/internal/application-entitlements")) return answers.entitlements();
    if (url.endsWith("/api/v1/me")) return answers.me();
    return json(404, {});
  }) as typeof fetch;
}

const byName = (findings: Awaited<ReturnType<typeof runDoctorChecks>>) => Object.fromEntries(findings.map((finding) => [finding.name, finding]));

describe("mws-access doctor", () => {
  it("passes when the Hub, Central, the code and the app agree", async () => {
    const { cwd, config } = await project();
    const findings = await runDoctorChecks({ cwd, config, env, url: "http://localhost:3011", fetchImpl: world() });
    expect(findings.map((finding) => finding.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  it("lists the lines that are missing", async () => {
    const { cwd, config } = await project();
    const { APP_BASE_URL: _removed, ...rest } = env;
    const findings = byName(await runDoctorChecks({ cwd, config, env: rest, fetchImpl: world() }));
    expect(findings.Environment).toMatchObject({ status: "fail", detail: "Missing: APP_BASE_URL." });
  });

  it("says the client belongs to another profile, in Central's words", async () => {
    const { cwd, config } = await project();
    const message = 'This API client belongs to the profile "hub". Only a client under a profile with the code "inv" may use the permissions of inv.';
    const findings = byName(await runDoctorChecks({ cwd, config, env, fetchImpl: world({ permissions: () => json(403, { errors: message }) }) }));
    expect(findings["Central token"]).toMatchObject({ status: "fail", detail: message });
    expect(findings["Central token"]!.fix).toContain('code "inv"');
    expect(findings.Permissions).toBeUndefined();
  });

  it("separates a rejected token from an unknown application", async () => {
    const { cwd, config } = await project();
    expect(byName(await runDoctorChecks({ cwd, config, env, fetchImpl: world({ permissions: () => json(401, { errors: "Unauthorized" }) }) }))["Central token"]!.detail).toContain("does not accept");
    expect(byName(await runDoctorChecks({ cwd, config, env, fetchImpl: world({ permissions: () => json(404, { errors: "none" }) }) }))["Central token"]!.detail).toContain('does not know the application "inv"');
  });

  it("names the permissions Central does not have yet", async () => {
    const { cwd, config } = await project();
    const findings = byName(await runDoctorChecks({ cwd, config, env, fetchImpl: world({ permissions: () => json(200, { success: true, data: [{ key: "inv.use", deprecated: false }] }) }) }));
    expect(findings.Permissions).toMatchObject({ status: "fail", detail: "Central does not have: inv.read." });
    expect(findings.Permissions!.fix).toContain("permissions:sync");
  });

  it("warns that nobody can sign in when nobody has access", async () => {
    const { cwd, config } = await project();
    const empty = json(200, { success: true, data: [], paging: { current_page: 1, total_page: 1, total_item: 0, size: 200 } });
    const findings = byName(await runDoctorChecks({ cwd, config, env, fetchImpl: world({ entitlements: () => empty.clone() }) }));
    expect(findings.Access).toMatchObject({ status: "fail" });
  });

  it("catches an app that answers without a session, which is the not restarted case", async () => {
    const { cwd, config } = await project();
    const findings = byName(await runDoctorChecks({ cwd, config, env, url: "http://localhost:3011/", fetchImpl: world({ me: () => json(200, { data: { email: "dev@example.org" } }) }) }));
    expect(findings["Running app"]).toMatchObject({ status: "fail", detail: "It answers as a signed-in person without any cookie." });
    expect(findings["Running app"]!.fix).toContain("restarted");
  });

  it("reports an unreachable Hub", async () => {
    const { cwd, config } = await project();
    const findings = byName(await runDoctorChecks({ cwd, config, env, fetchImpl: world({ jwks: () => json(404, {}) }) }));
    expect(findings.Hub).toMatchObject({ status: "fail" });
  });

  it("never prints the token", async () => {
    const { cwd, config } = await project();
    const findings = await runDoctorChecks({ cwd, config, env: { ...env, HUB_BASE_URL: "" }, fetchImpl: world() });
    expect(formatDoctor(findings)).not.toContain("secret-value");
  });
});

describe("runDoctor", () => {
  it("reads the .env of the app and exits 1 when something fails", async () => {
    const { cwd } = await project();
    await writeFile(join(cwd, ".env"), 'HUB_BASE_URL="https://hub.example.org"\n# comment\nCENTRAL_API_TOKEN=mws_abc.secret-value\n');
    const lines: string[] = [];
    const code = await runDoctor({ cwd, env: {}, fetchImpl: world(), output: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) } });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("Missing: CENTRAL_API_BASE_URL, CENTRAL_ORGANIZATION_ID, APP_BASE_URL.");
    expect(lines.join("\n")).not.toContain("secret-value");
  });

  it("exits 0 when all is well", async () => {
    const { cwd } = await project();
    const code = await runDoctor({ cwd, env, fetchImpl: world(), output: { log: () => {}, error: () => {} } });
    expect(code).toBe(0);
  });

  it("parses quotes, comments and export", () => {
    expect(parseEnvFile('A="x y"\nB=\'z\'\n# C=1\nexport D=4\nbad line')).toEqual({ A: "x y", B: "z", D: "4" });
  });
});
