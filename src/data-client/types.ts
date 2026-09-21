export interface CentralDataClientOptions {
  // Central's own origin, e.g. https://central.mws.sch.id - the client adds
  // the /api/internal prefix itself.
  baseUrl: string;
  // "<token_prefix>.<secret>" as issued by Central's Access > API Clients page.
  token: string;
  timeoutMs?: number;
}

export class CentralApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CentralApiError";
  }
}

export interface Paging {
  size: number;
  current_page: number;
  total_page: number;
  total_item: number;
}

// Mirrors Central's StudentLookupResponse (server/src/model/student-api-model.ts)
// - the students.read scope's shape, not the full roster-export row.
export interface StudentProfile {
  id: string;
  person_id: string;
  nis: string | null;
  nisn: string | null;
  full_name: string;
  nick_name: string;
  email: string;
  gender: string;
  status: string;
  current_grade: string;
  current_class: string | null;
}

// Mirrors Central's StudentAcademicHistoryEntry - one row per enrollment,
// requires the separate students.academic_history.read scope.
export interface StudentAcademicHistoryEntry {
  academic_year: string;
  grade_level: string;
  class_name: string;
  enrollment_status: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ListStudentsParams {
  page?: number;
  size?: number;
  status?: string;
  current_grade_id?: string;
  current_class_id?: string;
  academic_year_id?: string;
}
