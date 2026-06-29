export type Role = 'admin' | 'user';

export interface LoginResponse {
  accessToken: string;
  role: Role;
  username: string;
  employeeId: number | null;
}

export interface UserAccount {
  id: number;
  username: string;
  role: Role;
  employee_id: number | null;
  employee_code: string | null;
  full_name: string | null;
  is_locked: boolean;
  failed_login_attempts: number;
  created_at: string;
}

export interface Employee {
  id: number;
  employee_code: string;
  full_name: string;
  department: string | null;
  department_id?: number | null;
  department_name?: string | null;
  division_id?: number | null;
  division_name?: string | null;
  position: string | null;
  position_id?: number | null;
  position_name?: string | null;
  level_id?: number | null;
  level_name?: string | null;
  shift_id: number | null;
  shift_name?: string | null;
  supervisor_id?: number | null;
  supervisor_name?: string | null;
  employee_type?: 'civil_servant' | 'government_employee' | 'temp_employee';
  is_active: 0 | 1;
  face_count?: number;
  notify_email?: string | null;
  notify_line_user_id?: string | null;
  notify_telegram_chat_id?: string | null;
  notify_enabled?: 0 | 1;
  login_username?: string | null;
  login_role?: Role | null;
}

export interface EmployeeCreateRequest {
  employee_code: string;
  full_name: string;
  department_id?: number | null;
  position_id?: number | null;
  level_id?: number | null;
  employee_type?: 'civil_servant' | 'government_employee' | 'temp_employee';
  shift_id?: number | null;
  supervisor_id?: number | null;
  notify_email?: string | null;
  notify_line_user_id?: string | null;
  notify_telegram_chat_id?: string | null;
  notify_enabled?: boolean;
  is_active?: boolean;
  create_login?: boolean;
  login_username?: string;
  login_password?: string;
  login_role?: Role;
}

export interface FaceRecord {
  id: number;
  employee_id?: number;
  descriptor: number[];
  thumbnail?: string | null;
  created_at?: string;
}

export interface ConsentStatus {
  hasConsent: boolean;
  consentVersion: string | null;
  consentedAt: string | null;
  withdrawnAt: string | null;
}

export interface Shift {
  id: number;
  name: string;
  checkin_start: string;
  checkin_end: string;
  late_cutoff: string;
  checkout_start: string;
  checkout_end: string;
  ot_start: string;
  ot_end: string;
}

export type ScanType = 'check_in' | 'check_out' | 'ot_in' | 'ot_out';
export type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'ot';

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  employee_code?: string;
  full_name?: string;
  department?: string | null;
  scan_time: string;
  scan_type: ScanType;
  status: AttendanceStatus;
  confidence?: number | null;
  scan_location_id?: number | null;
  scan_location_name?: string | null;
  face_image_path?: string | null;
}

export interface AttendanceListResponse {
  data: AttendanceRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ScanResult {
  recordId?: number;
  matched?: boolean;
  employee?: { id: number; employee_code: string; full_name: string } | null;
  scan_type?: ScanType;
  status?: AttendanceStatus;
  message?: string;
  scanLocationName?: string | null;
  // Set (server-debounced, ~once/5min/location) on an unmatched preview
  // result — tells the kiosk to follow up with POST /attendance/unknown-face.
  unknownFaceAlert?: boolean;
}

// Backs the checkin kiosk's "ภาพและข้อมูลการสแกนล่าสุด" feed — see
// GET /api/attendance/recent (public, scoped to today + one scan location).
export interface RecentScanItem {
  id: number;
  name: string;
  scanType: ScanType | null;
  status: AttendanceStatus | null;
  time: string; // ISO datetime
  imageBase64: string | null;
}

export interface DashboardSummary {
  date: string;
  counts: { on_time: number; late: number; absent: number; ot: number };
  totalEmployees: number;
  present: number;
  isNonWorkday: boolean;
  weekly: { d: string; on_time: number; late: number }[];
  employeeHistory: { d: string; first_checkin: string; status: AttendanceStatus }[];
}

export interface ScanLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

export interface Holiday {
  id: number;
  holiday_date: string; // YYYY-MM-DD
  name: string;
}

export interface SettingsResponse {
  loginMaxAttempts: number;
  loginLockoutMinutes: number;
}

// Exact sub-fields verified against backend/src/services/notification.service.ts
// (NotificationSettings interface + DEFAULT_SETTINGS) and the PUT validator in
// backend/src/routes/notification.routes.ts, which requires all six top-level
// keys (email, line, telegram, local, admin, events) to be present.
export interface NotificationEventRule {
  employee: boolean;
  admin: boolean;
  supervisor: boolean;
}

export interface NotificationSettings {
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  line: {
    enabled: boolean;
    channelAccessToken: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
  };
  local: {
    enabled: boolean;
  };
  admin: {
    emails: string; // comma-separated
    lineUserId: string;
    telegramChatId: string;
  };
  events: {
    late: NotificationEventRule;
    absent: NotificationEventRule;
    success: NotificationEventRule;
    // Admin-only by nature — no matched employee to notify or to resolve a
    // supervisor from when a scan doesn't match anyone.
    unknownFace: { admin: boolean };
  };
}

export interface RecentNotification {
  id: number;
  event_type: string;
  title: string;
  body: string;
  created_at: string;
  image_base64?: string | null;
}

export type NotifyEventType = 'late' | 'absent' | 'success' | 'unknown_face';

export interface NotificationHistoryItem {
  id: number;
  event_type: NotifyEventType;
  title: string;
  body: string;
  is_read: 0 | 1;
  created_at: string;
  image_base64?: string | null;
}

export interface NotificationHistoryListResponse {
  data: NotificationHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  unreadCount: number;
}

export interface ReportRow {
  [key: string]: any;
}

export interface AuditLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_table: string | null;
  target_id: number | null;
  before_data: string | null;
  after_data: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Division {
  id: number;
  name: string;
  head_employee_id: number | null;
  head_name: string | null;
}

export interface Department {
  id: number;
  name: string;
  division_id: number | null;
  division_name: string | null;
  head_employee_id: number | null;
  head_name: string | null;
}

export interface Position {
  id: number;
  name: string;
  category: string | null;
  sort_order: number;
}

export interface CivilServiceLevel {
  id: number;
  name: string;
  category: string | null;
  sort_order: number;
}

export type CorrectionRequestType = 'correction' | 'appeal_absent' | 'appeal_late';
export type CorrectionRequestStatus = 'pending_supervisor' | 'pending_admin' | 'approved' | 'rejected';

export interface CorrectionRequest {
  id: number;
  employee_id: number;
  employee_code: string;
  full_name: string;
  attendance_record_id: number | null;
  request_type: CorrectionRequestType;
  target_date: string;
  original_scan_time: string | null;
  original_status: AttendanceStatus | null;
  requested_scan_time: string | null;
  requested_status: AttendanceStatus | null;
  reason: string;
  status: CorrectionRequestStatus;
  supervisor_id: number | null;
  supervisor_name: string | null;
  supervisor_decision: 'approved' | 'rejected' | null;
  supervisor_comment: string | null;
  supervisor_decided_at: string | null;
  admin_decision: 'approved' | 'rejected' | null;
  admin_comment: string | null;
  admin_decided_at: string | null;
  created_at: string;
}
