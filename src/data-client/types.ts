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

// Mirrors Central's EmployeeLookupResponse (server/src/model/employee-api-model.ts).
export interface EmployeeProfile {
  id: string;
  // Person.id - the same stable id space Hub SSO relay tokens use as `sub`
  // (see mws-central-auth/server's verifyRelayToken). Prefer this over `id`
  // when correlating with an already-provisioned local User.
  person_id: string;
  employee_id: string;
  full_name: string;
  nick_name: string;
  birth_date: string;
  email: string;
  gender: string;
  photo_url: string | null;
  unit: string;
  unit_id: string;
  job_position: string;
  job_level: string;
  is_teaching_role: boolean;
  status: string;
  employment_type: string;
}

export interface ListEmployeesParams {
  page?: number;
  size?: number;
  status?: string;
  unit_id?: string;
  job_position_id?: string;
}

// Mirrors Central's ClassResponseForApi (server/src/model/class-api-model.ts).
// Every active class in the active academic year, independent of whether it
// has a teacher assigned yet - unlike ClassTeacherAssignment below, which
// only surfaces a class once it has one.
export interface ClassProfile {
  class_id: string;
  class_name: string;
  grade_name: string;
  additional_grade_names: string[];
  unit_name: string | null;
  academic_year_id: string;
  academic_year: string;
  academic_year_start_date: string;
  academic_year_end_date: string | null;
}

// Mirrors Central's ClassTeacherAssignmentResponse
// (server/src/model/class-teacher-assignment-api-model.ts).
export interface ClassTeacherAssignment {
  class_id: string;
  class_name: string;
  grade_name: string;
  additional_grade_names: string[];
  unit_name: string | null;
  academic_year_id: string;
  academic_year: string;
  academic_year_start_date: string;
  academic_year_end_date: string | null;
  role: "HOMEROOM" | "SUPPORTING_HOMEROOM" | "SUBJECT_TEACHER";
  subject: string | null;
  workforce_member: {
    type: "EMPLOYEE" | "INTERN";
    id: string;
    member_id: string;
    full_name: string;
    email: string;
    unit_name: string;
    job_position: string;
    employee_id: string | null;
  };
  employee_id: string | null;
  employee_email: string | null;
}

// Mirrors Central's StudentSupportAssignmentResponse
// (server/src/model/student-support-assignment-api-model.ts). Central only
// has one role today (SPECIAL_ED); kept as a string so a future role
// doesn't require a client version bump to parse.
export interface StudentSupportAssignment {
  workforce_member: {
    type: "EMPLOYEE" | "INTERN";
    id: string;
    member_id: string;
    full_name: string;
    email: string;
    employee_id: string | null;
  };
  employee_id: string | null;
  employee_email: string | null;
  student_id: string;
  student_email: string;
  role: string;
}
