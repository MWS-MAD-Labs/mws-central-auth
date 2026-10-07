import { describe, expect, it } from "bun:test";
import { CentralDataClient, comparePermissions, permissionCheckFailed } from "../src/data-client/index.js";

const row = (key: string, extra: Partial<{ requires: string[]; deprecated: boolean }> = {}) => ({
  key,
  description: null,
  requires: [],
  source: "MANIFEST" as const,
  deprecated: false,
  ...extra,
});

describe("CentralDataClient permissions", () => {
  it("publishes the manifest with the token and the removal confirmation", async () => {
    let request: { url: string; method: string; body: unknown; authorization: string } | null = null;
    const client = new CentralDataClient({
      baseUrl: "https://central.example/",
      token: "prefix.secret",
      fetchImpl: async (input, init) => {
        request = {
          url: String(input),
          method: init?.method ?? "",
          body: JSON.parse(String(init?.body)),
          authorization: new Headers(init?.headers).get("authorization") ?? "",
        };
        return Response.json({ success: true, data: { application_id: "exima", total: 1, added: 1, deprecated: [], affected_roles: [] } });
      },
    });
    const result = await client.publishPermissions("exima", [{ key: "pos.checkout" }], { confirmRemovals: true });
    expect(result.added).toBe(1);
    expect(request).toEqual({
      url: "https://central.example/api/internal/application-permissions/exima",
      method: "PUT",
      body: { permissions: [{ key: "pos.checkout" }], confirm_removals: true },
      authorization: "Bearer prefix.secret",
    });
  });

  it("reads what is registered and what roles carry", async () => {
    const urls: string[] = [];
    const client = new CentralDataClient({
      baseUrl: "https://central.example",
      token: "t",
      fetchImpl: async (input) => {
        urls.push(String(input));
        return Response.json({ success: true, data: String(input).endsWith("/usage") ? ["a.read"] : [row("a.read")] });
      },
    });
    expect(await client.listRegisteredPermissions("exima")).toEqual([row("a.read")]);
    expect(await client.permissionUsage("exima")).toEqual(["a.read"]);
    expect(urls).toEqual([
      "https://central.example/api/internal/application-permissions/exima",
      "https://central.example/api/internal/application-permissions/exima/usage",
    ]);
  });
});

describe("comparePermissions", () => {
  it("passes when code, Central and the roles agree", () => {
    const check = comparePermissions([{ key: "a.read" }, { key: "a.manage", requires: ["a.read"] }], [row("a.read"), row("a.manage", { requires: ["a.read"] })], ["a.read"]);
    expect(check).toEqual({ notRegistered: [], wouldDrop: [], unknownToCode: [], requiresDiffer: [] });
    expect(permissionCheckFailed(check)).toBe(false);
  });

  it("finds new, dropped, unknown and different needs", () => {
    const check = comparePermissions(
      [{ key: "a.read" }, { key: "a.new" }, { key: "a.manage", requires: ["a.read"] }],
      [row("a.read"), row("a.old"), row("a.manage"), row("a.gone", { deprecated: true })],
      ["a.old", "a.read"],
    );
    expect(check).toEqual({
      notRegistered: ["a.new"],
      wouldDrop: ["a.old"],
      unknownToCode: ["a.old"],
      requiresDiffer: ["a.manage"],
    });
    expect(permissionCheckFailed(check)).toBe(true);
  });

  it("lets removals through when they are allowed, but never a permission roles carry that the code lost", () => {
    const dropOnly = comparePermissions([{ key: "a.read" }], [row("a.read"), row("a.old")], []);
    expect(permissionCheckFailed(dropOnly)).toBe(true);
    expect(permissionCheckFailed(dropOnly, { allowRemovals: true })).toBe(false);
    const carried = comparePermissions([{ key: "a.read" }], [row("a.read"), row("a.old")], ["a.old"]);
    expect(permissionCheckFailed(carried, { allowRemovals: true })).toBe(true);
  });

  it("does not count a new permission as a failure before the deploy", () => {
    const check = comparePermissions([{ key: "a.read" }, { key: "a.new" }], [row("a.read")], []);
    expect(check.notRegistered).toEqual(["a.new"]);
    expect(permissionCheckFailed(check)).toBe(false);
  });
});
