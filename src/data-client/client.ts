import {
  CentralApiError,
  type ApplicationEntitlement,
  type CentralDataClientOptions,
  type ClassProfile,
  type ClassTeacherAssignment,
  type EmployeeProfile,
  type ListEmployeesParams,
  type ListStudentsParams,
  type Paging,
  type PermissionManifestEntry,
  type PermissionSyncResult,
  type RegisteredPermission,
  type StudentAcademicHistoryEntry,
  type StudentProfile,
  type StudentSupportAssignment,
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
  private readonly fetchImpl: typeof fetch;

  constructor(options: CentralDataClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private request<T>(path: string, searchParams?: Record<string, string | number | undefined>): Promise<T>;
  private request<T>(
    path: string,
    searchParams: Record<string, string | number | undefined>,
    options: { nullOn404: true },
  ): Promise<T | null>;
  private request<T>(
    path: string,
    searchParams: Record<string, string | number | undefined> | undefined,
    options: { method: "PUT"; body: unknown },
  ): Promise<T>;
  private async request<T>(
    path: string,
    searchParams?: Record<string, string | number | undefined>,
    options: { nullOn404?: boolean; method?: "GET" | "PUT"; body?: unknown } = {},
  ): Promise<T | null> {
    const url = new URL(`${this.baseUrl}/api/internal${path}`);
    if (searchParams) {
      for (const [key, value] of Object.entries(searchParams)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new CentralApiError(0, `Central API request failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    const body = (await response.json().catch(() => null)) as (T & { success?: true }) | ErrorEnvelope | null;
    if (options.nullOn404 && response.status === 404) return null;
    if (!response.ok) {
      const message = body && "errors" in body ? body.errors : `Central API request failed with status ${response.status}`;
      throw new CentralApiError(response.status, message);
    }
    return body as T;
  }

  // Pages through every result automatically - callers that just want "the
  // whole current list" shouldn't have to hand-roll pagination themselves.
  private async listAllPages<T>(path: string, params: { page?: number; size?: number; [key: string]: string | number | undefined }): Promise<T[]> {
    const size = params.size ?? 100;
    const all: T[] = [];
    let page = 1;
    for (;;) {
      const result = await this.request<PagedEnvelope<T>>(path, { ...params, page, size });
      all.push(...result.data);
      if (page >= result.paging.total_page || result.data.length === 0) break;
      page += 1;
    }
    return all;
  }

  async listStudents(params: ListStudentsParams = {}): Promise<{ data: StudentProfile[]; paging: Paging }> {
    const result = await this.request<PagedEnvelope<StudentProfile>>("/students", { ...params });
    return { data: result.data, paging: result.paging };
  }

  async listAllStudents(params: Omit<ListStudentsParams, "page"> = {}): Promise<StudentProfile[]> {
    return this.listAllPages<StudentProfile>("/students", { ...params });
  }

  async lookupStudent(params: { id?: string; nis?: string; email?: string }): Promise<StudentProfile> {
    const result = await this.request<SuccessEnvelope<StudentProfile>>("/students/lookup", params);
    return result.data;
  }

  async getStudentAcademicHistory(studentId: string): Promise<StudentAcademicHistoryEntry[]> {
    const result = await this.request<SuccessEnvelope<StudentAcademicHistoryEntry[]>>(`/students/${encodeURIComponent(studentId)}/academic-history`);
    return result.data;
  }

  async listEmployees(params: ListEmployeesParams = {}): Promise<{ data: EmployeeProfile[]; paging: Paging }> {
    const result = await this.request<PagedEnvelope<EmployeeProfile>>("/employees", { ...params });
    return { data: result.data, paging: result.paging };
  }

  async listAllEmployees(params: Omit<ListEmployeesParams, "page"> = {}): Promise<EmployeeProfile[]> {
    return this.listAllPages<EmployeeProfile>("/employees", { ...params });
  }

  async lookupEmployee(params: { id?: string; person_id?: string; employee_id?: string; email?: string }): Promise<EmployeeProfile> {
    const result = await this.request<SuccessEnvelope<EmployeeProfile>>("/employees/lookup", params);
    return result.data;
  }

  async lookupApplicationEntitlement(params: {
    person_id: string;
    application_id: string;
  }): Promise<ApplicationEntitlement | null> {
    const result = await this.request<SuccessEnvelope<ApplicationEntitlement>>(
      "/application-entitlements/lookup",
      params,
      { nullOn404: true },
    );
    return result?.data ?? null;
  }

  // The permissions the application's code understands, sent on deploy. The token must be the
  // API client made for this application.
  async publishPermissions(
    applicationId: string,
    permissions: PermissionManifestEntry[],
    options: { confirmRemovals?: boolean } = {},
  ): Promise<PermissionSyncResult> {
    const result = await this.request<SuccessEnvelope<PermissionSyncResult>>(
      `/application-permissions/${encodeURIComponent(applicationId)}`,
      undefined,
      { method: "PUT", body: { permissions, confirm_removals: options.confirmRemovals } },
    );
    return result.data;
  }

  async listRegisteredPermissions(applicationId: string): Promise<RegisteredPermission[]> {
    const result = await this.request<SuccessEnvelope<RegisteredPermission[]>>(
      `/application-permissions/${encodeURIComponent(applicationId)}`,
    );
    return result.data;
  }

  // Permissions the active roles of the application carry.
  async permissionUsage(applicationId: string): Promise<string[]> {
    const result = await this.request<SuccessEnvelope<string[]>>(
      `/application-permissions/${encodeURIComponent(applicationId)}/usage`,
    );
    return result.data;
  }

  async listAllClasses(params: { size?: number } = {}): Promise<ClassProfile[]> {
    return this.listAllPages<ClassProfile>("/classes", { ...params });
  }

  async listAllClassTeacherAssignments(params: { size?: number } = {}): Promise<ClassTeacherAssignment[]> {
    return this.listAllPages<ClassTeacherAssignment>("/class-teacher-assignments", { ...params });
  }

  async listAllStudentSupportAssignments(params: { size?: number } = {}): Promise<StudentSupportAssignment[]> {
    return this.listAllPages<StudentSupportAssignment>("/student-support-assignments", { ...params });
  }
}
