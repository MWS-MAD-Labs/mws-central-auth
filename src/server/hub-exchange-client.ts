export interface HubExchangeClientOptions {
  baseUrl: string;
  internalSecret: string;
  appId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HubExchangeError extends Error {
  // The HTTP status the Hub answered with, or null when it could not be reached.
  readonly status: number | null;

  constructor(status: number | null = null) {
    super("Hub code exchange failed.");
    this.name = "HubExchangeError";
    this.status = status;
  }
}

export class HubExchangeClient {
  private readonly baseUrl: string;
  private readonly internalSecret: string;
  private readonly appId: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HubExchangeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.internalSecret = options.internalSecret;
    this.appId = options.appId;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async exchangeCode(code: string, state?: string): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/sso/exchange`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-internal-secret": this.internalSecret,
        },
        body: JSON.stringify({ code, appId: this.appId, ...(state === undefined ? {} : { state }) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new HubExchangeError();
    }

    if (!response.ok) throw new HubExchangeError(response.status);
    const body = (await response.json().catch(() => null)) as { data?: { token?: unknown } } | null;
    if (typeof body?.data?.token !== "string" || !body.data.token) throw new HubExchangeError();
    return body.data.token;
  }
}
