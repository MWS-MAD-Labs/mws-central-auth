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
