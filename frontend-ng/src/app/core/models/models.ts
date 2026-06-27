export type Role = 'admin' | 'user';

export interface LoginResponse {
  accessToken: string;
  role: Role;
  username: string;
  employeeId: number | null;
}

export interface Employee {
  id: number;
  employee_code: string;
  full_name: string;
  department: string | null;
  position: string | null;
  shift_id: number | null;
  shift_name?: string | null;
  is_active: 0 | 1;
  face_count?: number;
  notify_email?: string | null;
  notify_line_user_id?: string | null;
  notify_telegram_chat_id?: string | null;
  notify_enabled?: 0 | 1;
}

export interface EmployeeCreateRequest {
  employee_code: string;
  full_name: string;
  department?: string | null;
  position?: string | null;
  shift_id?: number | null;
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
  };
}

export interface RecentNotification {
  id: number;
  event_type: string;
  title: string;
  body: string;
  created_at: string;
}

export interface ReportRow {
  [key: string]: any;
}
