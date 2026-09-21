import {
  CentralApiError,
  type CentralDataClientOptions,
  type ListStudentsParams,
  type Paging,
  type StudentAcademicHistoryEntry,
  type StudentProfile,
} from "./types.js";

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

interface PagedEnvelope<T> {
  success: true;
  data: T[];
  paging: Paging;
}

interface ErrorEnvelope {
  errors: string;
}

// Typed client for Central's /api/internal/students endpoints
// (server/src/routes/internal/student-api-router.ts). Framework-agnostic -
// plain fetch, no app-specific assumptions - so any MWS app can reuse it
// the same way HubSsoClient is reused for the SSO relay.
export class CentralDataClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(options: CentralDataClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async request<T>(path: string, searchParams?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/internal${path}`);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CentralApiError(0, `Central API request failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const body = (await response.json().catch(() => null)) as (T & { success?: true }) | ErrorEnvelope | null;
    if (!response.ok) {
      const message = body && "errors" in body ? body.errors : `Central API request failed with status ${response.status}`;
      throw new CentralApiError(response.status, message);
    }
    return body as T;
  }

  async listStudents(params: ListStudentsParams = {}): Promise<{ data: StudentProfile[]; paging: Paging }> {
    const result = await this.request<PagedEnvelope<StudentProfile>>("/students", { ...params });
    return { data: result.data, paging: result.paging };
  }

  // Pages through every result automatically - callers that just want "the
  // current active roster" shouldn't have to hand-roll pagination.
  async listAllStudents(params: Omit<ListStudentsParams, "page"> = {}): Promise<StudentProfile[]> {
    const size = params.size ?? 100;
    const all: StudentProfile[] = [];
    let page = 1;
    for (;;) {
      const { data, paging } = await this.listStudents({ ...params, page, size });
      all.push(...data);
      if (page >= paging.total_page || data.length === 0) break;
      page += 1;
    }
    return all;
  }

  async lookupStudent(params: { id?: string; nis?: string; email?: string }): Promise<StudentProfile> {
    const result = await this.request<SuccessEnvelope<StudentProfile>>("/students/lookup", params);
    return result.data;
  }

  async getStudentAcademicHistory(studentId: string): Promise<StudentAcademicHistoryEntry[]> {
    const result = await this.request<SuccessEnvelope<StudentAcademicHistoryEntry[]>>(`/students/${encodeURIComponent(studentId)}/academic-history`);
    return result.data;
  }
}
