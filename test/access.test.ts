import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccessDefinitionError, can, canAny, createAccessResolver, definePermissions, type EntitlementLike } from "../src/access";
import { parsePermissionsArguments, runPermissionsCli, type PermissionsClient } from "../src/access/cli";
import { checkAccess, runAccessCheck } from "../src/access/check";
import { CentralApiError } from "../src/data-client/types";

const list = [
  { key: "inv.use", description: "Sign in" },
  { key: "inv.read", description: "See items", requires: ["inv.use"] },
  { key: "inv.manage", description: "Change items", requires: ["inv.read"] },
] as const;

describe("definePermissions", () => {
  it("returns the manifest and knows its keys", () => {
    const permissions = definePermissions({ application: "inv", permissions: list });
    expect(permissions.keys).toEqual(["inv.use", "inv.read", "inv.manage"]);
    expect(permissions.manifest[1]).toEqual({ key: "inv.read", description: "See items", requires: ["inv.use"] });
    expect(permissions.has("inv.read")).toBe(true);
    expect(permissions.has("inv.ghost")).toBe(false);
  });

  it("stops at once, listing everything wrong", () => {
    try {
      definePermissions({
        application: "inv",
        permissions: [
          { key: "inv:read", description: "x" },
          { key: "inv.manage", description: "", requires: ["inv.ghost"] },
        ],
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AccessDefinitionError);
      const text = (error as Error).message;
      expect(text).toContain('"inv:read" is not domain.action');
      expect(text).toContain('no "inv.use"');
      expect(text).toContain('"inv.manage" needs "inv.ghost"');
      expect(text).toContain("inv.manage has no description");
    }
  });

  it("lets an old key through while it is being renamed", () => {
    const permissions = definePermissions({
      application: "inv",
      permissions: [{ key: "inv.use", description: "Sign in" }, { key: "inv:write", description: "Old" }],
      legacyKeys: ["inv:write"],
    });
    expect(permissions.has("inv:write")).toBe(true);
  });
});

describe("can and canAny", () => {
  it("answers for a list, a missing list and several keys", () => {
    expect(can(["a.b"], "a.b")).toBe(true);
    expect(can(undefined, "a.b")).toBe(false);
    expect(canAny(["a.b"], ["c.d", "a.b"])).toBe(true);
    expect(canAny([], ["a.b"])).toBe(false);
  });
});

const entitlement = (over: Partial<EntitlementLike> = {}): EntitlementLike => ({
  id: "e1", application_id: "inv", organization_id: "org_inv", role: "CLERK", permissions: ["inv.use", "inv.read"], version: 1, is_active: true, ...over,
});

function resolverWith(answer: () => Promise<EntitlementLike | null>, extra: Record<string, unknown> = {}) {
  let calls = 0;
  let clock = 1_000_000;
  const resolver = createAccessResolver({
    application: "inv", permissions: ["inv.use", "inv.read", "inv.manage"], organizationId: "org_inv",
    lookup: async () => { calls += 1; return answer(); }, now: () => clock, ...extra,
  });
  return { resolver, calls: () => calls, tick: (seconds: number) => { clock += seconds * 1000; } };
}

describe("createAccessResolver", () => {
  it("needs the application's own .use permission", () => {
    expect(() => createAccessResolver({ application: "inv", permissions: ["inv.read"], lookup: async () => null })).toThrow(/inv\.use/);
  });

  it("allows an active entitlement of the right organization, with the permissions the app knows", async () => {
    const { resolver } = resolverWith(async () => entitlement({ permissions: ["inv.use", "inv.read", "inv.mystery"] }));
    expect(await resolver.resolve("p1")).toEqual({
      status: "allowed", personId: "p1", role: "CLERK", permissions: ["inv.use", "inv.read"], ignored: ["inv.mystery"], entitlementId: "e1", version: 1,
    });
  });

  it("turns away no access, an inactive entitlement, another organization, another application and a missing .use", async () => {
    const cases: Array<[EntitlementLike | null, string]> = [
      [null, "no-access"],
      [entitlement({ is_active: false }), "inactive"],
      [entitlement({ organization_id: "org_other" }), "wrong-organization"],
      [entitlement({ application_id: "exima" }), "wrong-application"],
      [entitlement({ permissions: ["inv.read"] }), "no-use"],
    ];
    for (const [value, reason] of cases) {
      const { resolver } = resolverWith(async () => value);
      expect(await resolver.resolve("p1")).toEqual({ status: "denied", personId: "p1", reason });
    }
  });

  it("does not check the organization when none is set", async () => {
    const resolver = createAccessResolver({ application: "inv", permissions: ["inv.use"], lookup: async () => entitlement({ organization_id: "anything", permissions: ["inv.use"] }) });
    expect((await resolver.resolve("p1")).status).toBe("allowed");
  });

  it("keeps an answer for at most a minute, and not more however long it is asked to", async () => {
    const { resolver, calls, tick } = resolverWith(async () => entitlement(), { cacheSeconds: 3600 });
    await resolver.resolve("p1");
    tick(59);
    await resolver.resolve("p1");
    expect(calls()).toBe(1);
    tick(2);
    await resolver.resolve("p1");
    expect(calls()).toBe(2);
  });

  it("ends access on the next look after Central withdraws it", async () => {
    let active = true;
    const { resolver, tick } = resolverWith(async () => entitlement({ is_active: active }));
    expect((await resolver.resolve("p1")).status).toBe("allowed");
    active = false;
    tick(61);
    expect(await resolver.resolve("p1")).toMatchObject({ status: "denied", reason: "inactive" });
  });

  it("keeps 'no access' only briefly, and can forget a person at once", async () => {
    let value: EntitlementLike | null = null;
    const { resolver, calls, tick } = resolverWith(async () => value);
    await resolver.resolve("p1");
    await resolver.resolve("p1");
    expect(calls()).toBe(1);
    value = entitlement();
    resolver.invalidate("p1");
    expect((await resolver.resolve("p1")).status).toBe("allowed");
    tick(61);
    resolver.invalidate();
    await resolver.resolve("p1");
    expect(calls()).toBe(3);
  });

  it("never keeps or grants anything when Central cannot be asked", async () => {
    let up = false;
    const { resolver, calls } = resolverWith(async () => { if (!up) throw new Error("down"); return entitlement(); });
    expect(await resolver.resolve("p1")).toMatchObject({ status: "unavailable" });
    up = true;
    expect((await resolver.resolve("p1")).status).toBe("allowed");
    expect(calls()).toBe(2);
  });

  it("asks Central once for two requests at the same time", async () => {
    const { resolver, calls } = resolverWith(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); return entitlement(); });
    await Promise.all([resolver.resolve("p1"), resolver.resolve("p1"), resolver.resolve("p2")]);
    expect(calls()).toBe(2);
  });
});

describe("the permissions command", () => {
  const manifest = [{ key: "inv.use", description: "Sign in" }, { key: "inv.read", description: "See", requires: ["inv.use"] }];
  const quiet = () => {
    const lines: string[] = [];
    return { lines, output: { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } };
  };
  const client = (over: Partial<PermissionsClient> = {}): PermissionsClient => ({
    publishPermissions: async () => ({ application_id: "inv", total: 2, added: 2, deprecated: [], affected_roles: [] }),
    listRegisteredPermissions: async () => manifest.map((entry) => ({ key: entry.key, description: entry.description, requires: entry.requires ?? [], source: "MANIFEST" as const, deprecated: false })),
    permissionUsage: async () => [],
    ...over,
  });

  it("reads the options and refuses unknown ones", () => {
    expect(parsePermissionsArguments(["--confirm-removals", "--retries", "2", "--wait", "3"], "sync")).toMatchObject({ confirmRemovals: true, retries: 2, waitMs: 3000 });
    expect(parsePermissionsArguments(["--check"], "sync").mode).toBe("check");
    expect(() => parsePermissionsArguments(["--nope"], "sync")).toThrow(/Unknown option/);
    expect(() => parsePermissionsArguments(["--confirm-removals"], "check")).toThrow(/permissions:sync/);
  });

  it("publishes under the application id, or the one in the environment", async () => {
    const seen: string[] = [];
    const publish = client({ publishPermissions: async (id, _p, o) => { seen.push(`${id}:${o?.confirmRemovals}`); return { application_id: id, total: 2, added: 1, deprecated: ["x.y"], affected_roles: [{ role: "R", permissions: ["x.y"] }], legacy_keys: ["a:b"] }; } });
    const { lines, output } = quiet();
    expect(await runPermissionsCli({ application: "inv", manifest, command: "sync", argv: ["--confirm-removals"], client: publish, output, env: {} })).toBe(0);
    expect(await runPermissionsCli({ application: "inv", manifest, command: "sync", argv: [], client: publish, output, env: { CENTRAL_APPLICATION_ID: "other" } })).toBe(0);
    expect(seen).toEqual(["inv:true", "other:false"]);
    expect(lines.join("\n")).toContain("Published 2 permissions to inv: 1 added, 1 dropped.");
    expect(lines.join("\n")).toContain("Still in an old format: a:b");
    expect(lines.join("\n")).toContain("Role R still carries dropped permissions: x.y");
  });

  it("fails a check that disagrees unless --soft, and says the address and token are needed", async () => {
    const disagree = client({ permissionUsage: async () => ["mystery.key"] });
    const strict = quiet();
    expect(await runPermissionsCli({ application: "inv", manifest, command: "check", argv: [], client: disagree, output: strict.output, env: {} })).toBe(1);
    expect(strict.lines.join("\n")).toContain("mystery.key");
    expect(await runPermissionsCli({ application: "inv", manifest, command: "check", argv: ["--soft"], client: disagree, output: quiet().output, env: {} })).toBe(0);
    const missing = quiet();
    expect(await runPermissionsCli({ application: "inv", manifest, command: "sync", argv: [], output: missing.output, env: {} })).toBe(1);
    expect(missing.lines.join("\n")).toContain("CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN are required");
    // For "predev": with nothing set up, --soft warns and lets the app start.
    const soft = quiet();
    expect(await runPermissionsCli({ application: "inv", manifest, command: "sync", argv: ["--soft"], output: soft.output, env: {} })).toBe(0);
    expect(soft.lines.join("\n")).toContain("CENTRAL_API_BASE_URL and CENTRAL_API_TOKEN are required");
  });

  it("checks before a deploy: only roles using a permission the code lost fail it", async () => {
    const ahead = client({ listRegisteredPermissions: async () => [{ key: "inv.use", description: null, requires: ["other"], source: "MANIFEST" as const, deprecated: false }, { key: "old.gone", description: null, requires: [], source: "MANIFEST" as const, deprecated: false }] });
    expect(await runPermissionsCli({ application: "inv", manifest, command: "check", argv: [], client: ahead, output: quiet().output, env: {} })).toBe(1);
    expect(await runPermissionsCli({ application: "inv", manifest, command: "check", argv: ["--before-deploy"], client: ahead, output: quiet().output, env: {} })).toBe(0);
    const lost = client({ permissionUsage: async () => ["mystery.key"] });
    expect(await runPermissionsCli({ application: "inv", manifest, command: "check", argv: ["--before-deploy"], client: lost, output: quiet().output, env: {} })).toBe(1);
  });

  it("tries again when Central is down, but not when it refuses", async () => {
    let attempts = 0;
    const down = client({ publishPermissions: async () => { attempts += 1; throw new CentralApiError(0, "connect ECONNREFUSED"); } });
    const waited: number[] = [];
    expect(await runPermissionsCli({ application: "inv", manifest, command: "sync", argv: ["--retries", "2", "--wait", "1"], client: down, output: quiet().output, env: {}, sleep: async (ms) => { waited.push(ms); } })).toBe(1);
    expect([attempts, waited]).toEqual([3, [1000, 1000]]);
    let refusals = 0;
    const refused = client({ publishPermissions: async () => { refusals += 1; throw new CentralApiError(400, "New permission must be domain.action"); } });
    const refusal = quiet();
    expect(await runPermissionsCli({ application: "inv", manifest, command: "sync", argv: ["--retries", "2"], client: refused, output: refusal.output, env: {}, sleep: async () => {} })).toBe(1);
    expect(refusals).toBe(1);
    expect(refusal.lines.join("\n")).toContain("Central refused: New permission must be domain.action");
  });
});

describe("mws-access check", () => {
  let dir: string;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  const setup = async (files: Record<string, string>) => {
    dir = await mkdtemp(join(tmpdir(), "access-"));
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(dir, name.split("/").slice(0, -1).join("/") || "."), { recursive: true });
      await writeFile(join(dir, name), text);
    }
  };
  const manifestJson = JSON.stringify({ permissions: list });
  const presetsJson = JSON.stringify({ roles: [{ key: "CLERK", permissions: ["inv.use", "inv.read"] }, { key: "BOSS", permissions: ["inv.use", "inv.read", "inv.manage"] }] });

  it("passes an app that follows the standard, probe included", async () => {
    await setup({
      "access.config.json": JSON.stringify({ application: "inv", manifest: "perms.json", presets: "presets.json", source: { roots: ["src"] }, roleNames: ["BOSS"], probe: { module: "probe.mjs", open: ["GET /me"] } }),
      "perms.json": manifestJson,
      "presets.json": presetsJson,
      "src/routes.ts": "gate('inv.read'); gate('inv.manage'); gate('inv.use');",
      "probe.mjs": "export async function createProbe() { return { routes: [{ method: 'GET', url: '/items' }, { method: 'GET', url: '/me' }], call: async ({ url }) => (url === '/items' ? 403 : 200) }; }",
    });
    const lines: string[] = [];
    expect(await runAccessCheck({ cwd: dir, output: { log: (m) => lines.push(m), error: (m) => lines.push(m) } })).toBe(0);
    expect(lines.join("\n")).toContain("0 problem(s), 0 warning(s).");
  });

  it("fails with the rule numbers when it does not", async () => {
    await setup({
      "access.config.json": JSON.stringify({ application: "inv", manifest: "perms.json", presets: "presets.json", source: { roots: ["src"] }, roleNames: ["BOSS"], probe: { module: "probe.mjs", open: [] } }),
      "perms.json": JSON.stringify([{ key: "inv.use" }, { key: "inv:old" }]),
      "presets.json": presetsJson,
      "src/routes.ts": "if (role === 'BOSS') gate('inv.mystery');",
      "probe.mjs": "export async function createProbe() { return { routes: [{ method: 'GET', url: '/items' }], call: async () => 200 }; }",
    });
    const config = JSON.parse(await (await import("node:fs/promises")).readFile(join(dir, "access.config.json"), "utf8"));
    const result = await checkAccess(dir, config);
    const rules = new Set(result.problems.map((finding) => finding.rule));
    for (const rule of ["AS-3", "AS-6", "AS-2", "AS-13"]) expect(rules.has(rule)).toBe(true);
    const lines: string[] = [];
    expect(await runAccessCheck({ cwd: dir, output: { log: (m) => lines.push(m), error: (m) => lines.push(m) } })).toBe(1);
  });

  it("explains a missing or broken config", async () => {
    await setup({ "other.txt": "x" });
    const lines: string[] = [];
    expect(await runAccessCheck({ cwd: dir, output: { log: (m) => lines.push(m), error: (m) => lines.push(m) } })).toBe(1);
    expect(lines.join("\n")).toContain("Cannot read access.config.json");
  });
});
