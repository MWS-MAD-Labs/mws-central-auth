import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertConformance,
  checkManifest,
  checkNoRoleNames,
  checkPermissionUsage,
  checkPresets,
  fillParams,
  isOpenRoute,
  isStandardPermissionKey,
  mergeResults,
  probeRoutes,
  trackFastifyRoutes,
} from "../src/conformance";

const manifest = [
  { key: "inv.use" },
  { key: "inv.read", requires: ["inv.use"] },
  { key: "inv.manage", requires: ["inv.read"] },
  { key: "scope.grade" },
];
const rules = (result: { problems: { rule: string }[] }) => result.problems.map((finding) => finding.rule);

describe("isStandardPermissionKey (AS-3)", () => {
  it("takes domain.action keys of 2 or 3 levels", () => {
    for (const key of ["work-order.create", "scope.grade", "iep.coordinator.approve", "a.1", "hub.use"]) expect(isStandardPermissionKey(key)).toBe(true);
  });

  it("refuses the other shapes", () => {
    for (const key of ["journey:write", "Work.Create", "work_order.create", "create", "a.b.c.d", "work-order.", "9work.create", ".a", `a.${"x".repeat(70)}`]) {
      expect([key, isStandardPermissionKey(key)]).toEqual([key, false]);
    }
  });
});

describe("checkManifest", () => {
  it("passes a manifest that follows the standard", () => {
    expect(checkManifest(manifest, { application: "inv" })).toEqual({ problems: [], warnings: [] });
  });

  it("finds the bad format, the missing .use, repeats, dangling and looping requires, and manage without read", () => {
    const result = checkManifest(
      [
        { key: "inv.read", requires: ["inv.ghost"] },
        { key: "inv.read" },
        { key: "inv:write" },
        { key: "inv.manage" },
        { key: "inv.a", requires: ["inv.b"] },
        { key: "inv.b", requires: ["inv.a"] },
        { key: "inv.self", requires: ["inv.self"] },
      ],
      { application: "inv" },
    );
    const messages = result.problems.map((finding) => finding.message).join("\n");
    expect(messages).toContain('"inv.read" is listed more than once');
    expect(messages).toContain('"inv:write" is not domain.action');
    expect(messages).toContain('no "inv.use"');
    expect(messages).toContain('"inv.read" needs "inv.ghost"');
    expect(messages).toContain('"inv.manage" should need "inv.read"');
    expect(messages).toContain('"inv.a" needs itself through');
    expect(messages).toContain('"inv.self" needs itself');
  });

  it("only warns about an old key that is being renamed, and fails on an empty manifest", () => {
    const legacy = checkManifest([{ key: "inv.use" }, { key: "inv:write" }], { application: "inv", legacyKeys: ["inv:write"] });
    expect(legacy.problems).toEqual([]);
    expect(legacy.warnings.map((finding) => finding.rule)).toEqual(["AS-3"]);
    expect(rules(checkManifest([], { application: "inv" }))).toEqual(["AS-4"]);
  });
});

describe("checkPresets", () => {
  it("passes presets that use the manifest and carry what is needed", () => {
    const presets = [
      { key: "ADMIN", permissions: ["inv.use", "inv.read", "inv.manage", "scope.grade"] },
      { key: "VIEWER", permissions: ["inv.use", "inv.read"] },
    ];
    expect(checkPresets(presets, manifest)).toEqual({ problems: [], warnings: [] });
  });

  it("finds unknown permissions, missing needs, empty and repeated roles, and two roles with the same permissions", () => {
    const result = checkPresets(
      [
        { key: "A", permissions: ["inv.use", "inv.ghost"] },
        { key: "B", permissions: ["inv.manage"] },
        { key: "C", permissions: [] },
        { key: "D", permissions: ["inv.use", "inv.read"] },
        { key: "E", permissions: ["inv.read", "inv.use"] },
        { key: "A", permissions: ["inv.use"] },
      ],
      manifest,
    );
    const messages = result.problems.map((finding) => finding.message).join("\n");
    expect(messages).toContain('"inv.ghost", which is not in the manifest');
    expect(messages).toContain('"inv.manage" without "inv.read"');
    expect(messages).toContain('Role "C" has no permissions');
    expect(messages).toContain('Roles "D" and "E" have exactly the same permissions');
    expect(messages).toContain('Role "A" is listed more than once');
  });
});

describe("routes (AS-6)", () => {
  it("knows which routes are open, with or without a method, and fills parameters", () => {
    expect(isOpenRoute({ method: "GET", url: "/me" }, ["GET /me"])).toBe(true);
    expect(isOpenRoute({ method: "POST", url: "/me" }, ["GET /me"])).toBe(false);
    expect(isOpenRoute({ method: "GET", url: "/health/ready" }, ["/health/*"])).toBe(true);
    expect(isOpenRoute({ method: "POST", url: "/lists/:id/submit" }, ["POST /lists/*/submit"])).toBe(true);
    expect(isOpenRoute({ method: "POST", url: "/lists/:id/submit/more" }, ["POST /lists/*/submit"])).toBe(false);
    expect(isOpenRoute({ method: "GET", url: "/a.b" }, ["/a.b"])).toBe(true);
    expect(isOpenRoute({ method: "GET", url: "/axb" }, ["/a.b*"])).toBe(false);
    expect(fillParams("/items/:id/files/:name", { name: "a" })).toBe("/items/00000000-0000-4000-8000-000000000000/files/a");
  });

  it("passes when every closed route turns a person with no permissions away", async () => {
    const result = await probeRoutes({
      routes: [{ method: "GET", url: "/items" }, { method: "GET", url: "/me" }],
      open: ["GET /me"],
      call: async ({ url }) => (url === "/items" ? 403 : 200),
    });
    expect(result).toEqual({ problems: [], warnings: [] });
  });

  it("reports a route that answers, and warns about answers that come before the gate", async () => {
    const statuses: Record<string, number> = { "/open-by-mistake": 200, "/missing-row": 404, "/needs-body": 400, "/ok": 401 };
    const result = await probeRoutes({
      routes: Object.keys(statuses).map((url) => ({ method: "POST", url })),
      open: [],
      call: async ({ url }) => statuses[url]!,
    });
    expect(result.problems.map((finding) => finding.message)).toEqual([
      expect.stringContaining("POST /open-by-mistake answered 200"),
      expect.stringContaining("POST /missing-row answered 404"),
    ]);
    expect(result.warnings.map((finding) => finding.message)).toEqual([expect.stringContaining("POST /needs-body answered 400")]);
  });

  it("collects the routes of a Fastify app, once per method, without HEAD and OPTIONS", () => {
    const hooks: Array<(route: { method: string | string[]; url: string }) => void> = [];
    const tracker = trackFastifyRoutes({ addHook: (_, handler) => hooks.push(handler) });
    hooks[0]!({ method: ["GET", "HEAD"], url: "/items" });
    hooks[0]!({ method: "POST", url: "/items" });
    hooks[0]!({ method: "OPTIONS", url: "/items" });
    hooks[0]!({ method: "GET", url: "/items" });
    expect(tracker.routes()).toEqual([{ method: "GET", url: "/items" }, { method: "POST", url: "/items" }]);
  });
});

describe("source scans (AS-2, AS-6, AS-7)", () => {
  let dir: string;
  const setup = async (files: Record<string, string>) => {
    dir = await mkdtemp(join(tmpdir(), "conformance-"));
    for (const [name, text] of Object.entries(files)) {
      await mkdir(join(dir, name.split("/").slice(0, -1).join("/")), { recursive: true });
      await writeFile(join(dir, name), text);
    }
  };
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("finds a permission that looks like the app's but is not in the manifest, and a manifest key nobody asks for", async () => {
    await setup({
      "src/permissions.ts": `export const M = ['inv.use', 'inv.read', 'inv.manage', 'scope.grade'];`,
      "src/routes.ts": `gate('inv.read'); gate("inv.manag"); gate('scope.grade'); const x = 'unrelated.thing'; gate(\`inv.use\`);`,
      "src/routes.test.ts": `gate('inv.typo')`,
      "node_modules/x/index.ts": `gate('inv.typo2')`,
    });
    const result = await checkPermissionUsage({ roots: ["src"], manifest, manifestFiles: ["src/permissions.ts"], cwd: dir });
    expect(result.problems.map((finding) => finding.message)).toEqual(['src/routes.ts asks for "inv.manag", which is not in the manifest.']);
    expect(result.warnings.map((finding) => finding.message)).toEqual(['"inv.manage" is in the manifest but no code asks for it.']);
  });

  it("finds role names in the logic and skips the files that may show them", async () => {
    await setup({
      "api/auth.ts": `if (roles.includes('ADMINISTRATOR')) allow();`,
      "api/labels.ts": `export const label = { ADMINISTRATOR: 'Administrator' };`,
      "api/clean.ts": `can(user, 'inv.read'); // an ADMINISTRATORS list is not the role`,
    });
    const result = await checkNoRoleNames({ roots: ["api"], roleNames: ["ADMINISTRATOR", "WORKER"], allow: [{ file: "api/labels.ts", reason: "display label" }], cwd: dir });
    expect(result.problems.map((finding) => finding.message)).toEqual(['api/auth.ts:1 mentions the role "ADMINISTRATOR".']);
  });
});

describe("assertConformance", () => {
  it("is silent for warnings only, and throws listing every problem", () => {
    assertConformance({ problems: [], warnings: [{ rule: "AS-7", message: "unused" }] });
    const failing = mergeResults(
      { problems: [{ rule: "AS-3", message: "bad key" }], warnings: [] },
      { problems: [{ rule: "AS-6", message: "open route" }], warnings: [{ rule: "AS-7", message: "unused" }] },
    );
    expect(() => assertConformance(failing)).toThrow(/AS-3: bad key[\s\S]*AS-6: open route[\s\S]*warning AS-7: unused/);
  });
});
