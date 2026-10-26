import { describe, expect, it } from "bun:test";
import { CentralApiError, CentralDataClient, type ApplicationEntitlement } from "../src/data-client/index.js";

const entitlement: ApplicationEntitlement = {
  id: "entitlement-1",
  person_id: "person-1",
  application_id: "exima",
  organization_id: "organization-1",
  role: "cashier",
  permissions: ["sales:create", "sales:read"],
  version: 3,
  is_active: true,
  granted_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-29T00:00:00.000Z",
};

describe("CentralDataClient.lookupApplicationEntitlement", () => {
  it("looks up an entitlement by person and application", async () => {
    let requestUrl = "";
    let authorization = "";
    const client = new CentralDataClient({
      baseUrl: "https://central.example/",
      token: "prefix.secret",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json({ success: true, data: entitlement });
      },
    });

    await expect(client.lookupApplicationEntitlement({
      person_id: "person-1",
      application_id: "exima",
    })).resolves.toEqual(entitlement);
    expect(requestUrl).toBe("https://central.example/api/internal/application-entitlements/lookup?person_id=person-1&application_id=exima");
    expect(authorization).toBe("Bearer prefix.secret");
  });

  it("returns null for a 404", async () => {
    const client = new CentralDataClient({
      baseUrl: "https://central.example",
      token: "prefix.secret",
      fetchImpl: async () => Response.json({ errors: "not found" }, { status: 404 }),
    });

    await expect(client.lookupApplicationEntitlement({ person_id: "missing", application_id: "exima" })).resolves.toBeNull();
  });

  it("throws CentralApiError for other failures", async () => {
    const client = new CentralDataClient({
      baseUrl: "https://central.example",
      token: "prefix.secret",
      fetchImpl: async () => Response.json({ errors: "temporarily unavailable" }, { status: 503 }),
    });

    const request = client.lookupApplicationEntitlement({ person_id: "person-1", application_id: "exima" });
    await expect(request).rejects.toBeInstanceOf(CentralApiError);
    await expect(request).rejects.toMatchObject({ status: 503, message: "temporarily unavailable" });
  });
});

describe("CentralDataClient.listStudentRoster", () => {
  it("asks the roster export for one status and returns the rows", async () => {
    let requestUrl = "";
    const client = new CentralDataClient({
      baseUrl: "https://central.example",
      token: "prefix.secret",
      fetchImpl: async (input) => {
        requestUrl = String(input);
        return Response.json({ success: true, data: [{ email: "a@example.test", birth_date: "2015-01-02T00:00:00.000Z" }] });
      },
    });

    const rows = await client.listStudentRoster({ status: "ACTIVE" });
    expect(rows).toHaveLength(1);
    expect(requestUrl).toBe("https://central.example/api/internal/students/roster-export?status=ACTIVE");
  });
});

describe("CentralDataClient.listAllApplicationEntitlements", () => {
  it("reads every page of the active entitlements, 200 at a time", async () => {
    const urls: string[] = [];
    const client = new CentralDataClient({
      baseUrl: "https://central.example",
      token: "prefix.secret",
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json({
          success: true,
          data: [{ ...entitlement, id: `e${page}`, person: { full_name: "A", email: "a@example.test", unit: null } }],
          paging: { current_page: page, total_page: 2, total_item: 2, size: 200 },
        });
      },
    });

    const rows = await client.listAllApplicationEntitlements({ application_id: "learnspace" });
    expect(rows.map((row) => row.id)).toEqual(["e1", "e2"]);
    expect(urls[0]).toContain("size=200");
    expect(urls[0]).toContain("application_id=learnspace");
  });
});
