// Shared TypeScript types across the backend

export type Role = 'admin' | 'user';
export type ScanType = 'check_in' | 'check_out' | 'ot_in' | 'ot_out';
export type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'ot';

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  employee_id: number | null;
  failed_login_attempts: number;
  locked_until: string | null;
}

export interface Employee {
  id: number;
  employee_code: string;
  full_name: string;
  department: string | null;
  position: string | null;
  shift_id: number | null;
  is_active: number; // 1 | 0
}

export interface Shift {
  id: number;
  name: string;
  checkin_start: string;  // 'HH:MM:SS'
  checkin_end: string;
  late_cutoff: string;
  checkout_start: string;
  checkout_end: string;
  ot_start: string;
  ot_end: string;
}

export interface FaceDescriptorRow {
  id: number;
  employee_id: number;
  descriptor: number[]; // parsed from JSON
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  scan_location_id: number | null;
  scan_time: string;
  scan_type: ScanType;
  status: AttendanceStatus;
  matched_confidence: number | null;
  face_image_path: string | null;
}

export interface JWTPayload {
  sub: number;       // user id
  role: Role;
  employeeId: number | null;
}

// Result returned by the scan classification service
export interface ScanResult {
  matched: boolean;
  employee?: { id: number; employee_code: string; full_name: string };
  scan_type?: ScanType;
  status?: AttendanceStatus;
  confidence?: number;
  message: string; // human-readable Thai message for the kiosk
  ignored?: boolean; // true when within cooldown window
  recordId?: number; // id of the inserted attendance_records row (when a record was created)
  ambiguous?: boolean; // true when rejected because two enrolled faces were too close to distinguish
  previewOnly?: boolean; // true when this result is from a preview check (no record inserted)
  scanLocationName?: string | null; // name of the installed scan-camera location, when known
  // Set (rarely, server-debounced) on an unmatched preview result when the
  // server wants the kiosk to follow up with POST /attendance/unknown-face —
  // see processScanPreview in shift.service.ts for the cooldown logic.
  unknownFaceAlert?: boolean;
}

// Augment Express Request to carry the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}
