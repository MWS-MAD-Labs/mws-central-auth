import { describe, expect, it } from "bun:test";
import { HubExchangeClient, HubExchangeError } from "../src/server/index.js";

describe("HubExchangeClient", () => {
  it("posts the code, appId, and optional state", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    let secret = "";
    const client = new HubExchangeClient({
      baseUrl: "https://hub.example/",
      internalSecret: "shared-secret",
      appId: "exima",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        secret = new Headers(init?.headers).get("x-hub-internal-secret") ?? "";
        return Response.json({ data: { token: "relay-token" } });
      },
    });

    await expect(client.exchangeCode("opaque-code", "csrf-state")).resolves.toBe("relay-token");
    expect(requestUrl).toBe("https://hub.example/sso/exchange");
    expect(requestBody).toEqual({ code: "opaque-code", appId: "exima", state: "csrf-state" });
    expect(secret).toBe("shared-secret");
  });

  it("omits state when it is not supplied", async () => {
    let requestBody: unknown;
    const client = new HubExchangeClient({
      baseUrl: "https://hub.example",
      internalSecret: "shared-secret",
      appId: "exima",
      fetchImpl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ data: { token: "relay-token" } });
      },
    });

    await client.exchangeCode("opaque-code");
    expect(requestBody).toEqual({ code: "opaque-code", appId: "exima" });
  });

  it.each([
    ["network failure", async () => { throw new Error("private network detail"); }],
    ["non-success response", async () => Response.json({ errors: "private Hub detail" }, { status: 400 })],
    ["invalid response", async () => Response.json({ data: {} })],
  ])("uses the same safe error for %s", async (_name, fetchImpl) => {
    const client = new HubExchangeClient({
      baseUrl: "https://hub.example",
      internalSecret: "shared-secret",
      appId: "exima",
      fetchImpl,
    });

    const request = client.exchangeCode("opaque-code");
    await expect(request).rejects.toBeInstanceOf(HubExchangeError);
    await expect(request).rejects.toMatchObject({ message: "Hub code exchange failed." });
  });
});

describe("HubExchangeError status", () => {
  it("carries the Hub's status, or null when the Hub could not be reached", async () => {
    const refused = new HubExchangeClient({ baseUrl: "http://hub.test", internalSecret: "s", appId: "a", fetchImpl: (async () => new Response("{}", { status: 503 })) as typeof fetch });
    await expect(refused.exchangeCode("c")).rejects.toMatchObject({ status: 503 });
    const down = new HubExchangeClient({ baseUrl: "http://hub.test", internalSecret: "s", appId: "a", fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch });
    await expect(down.exchangeCode("c")).rejects.toMatchObject({ status: null });
  });
});
