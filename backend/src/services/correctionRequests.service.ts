import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export type RequestType = 'correction' | 'appeal_absent' | 'appeal_late';
export type RequestStatus = 'pending_supervisor' | 'pending_admin' | 'approved' | 'rejected';

export interface CorrectionRequest {
  id: number;
  employee_id: number;
  employee_code?: string;
  full_name?: string;
  attendance_record_id: number | null;
  request_type: RequestType;
  target_date: string;
  original_scan_time: string | null;
  original_status: string | null;
  requested_scan_time: string | null;
  requested_status: string | null;
  reason: string;
  status: RequestStatus;
  supervisor_id: number | null;
  supervisor_name?: string;
  supervisor_decision: 'approved' | 'rejected' | null;
  supervisor_comment: string | null;
  supervisor_decided_at: string | null;
  admin_decision: 'approved' | 'rejected' | null;
  admin_comment: string | null;
  admin_decided_at: string | null;
  created_at: string;
}

const SELECT_REQUEST = `
  SELECT r.*, e.employee_code, e.full_name, sup.full_name AS supervisor_name
    FROM attendance_correction_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN employees sup ON sup.id = r.supervisor_id`;

// The employee's first-line approver: their department head if set, else
// their division head (department has no head, or no department at all),
// else null — meaning nobody to route to, so the request skips straight to
// admin.
export async function resolveSupervisorId(employeeId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT dept.head_employee_id AS dept_head, dv.head_employee_id AS div_head
       FROM employees e
       LEFT JOIN departments dept ON dept.id = e.department_id
       LEFT JOIN divisions dv ON dv.id = dept.division_id
      WHERE e.id = ?`,
    [employeeId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.dept_head && row.dept_head !== employeeId) return row.dept_head;
  if (row.div_head && row.div_head !== employeeId) return row.div_head;
  return null;
}

export async function createRequest(input: {
  employeeId: number;
  attendanceRecordId: number | null;
  requestType: RequestType;
  targetDate: string;
  originalScanTime: string | null;
  originalStatus: string | null;
  requestedScanTime: string | null;
  requestedStatus: string | null;
  reason: string;
}): Promise<number> {
  const supervisorId = await resolveSupervisorId(input.employeeId);
  const initialStatus: RequestStatus = supervisorId ? 'pending_supervisor' : 'pending_admin';

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO attendance_correction_requests
       (employee_id, attendance_record_id, request_type, target_date, original_scan_time, original_status,
        requested_scan_time, requested_status, reason, status, supervisor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.employeeId, input.attendanceRecordId, input.requestType, input.targetDate,
      input.originalScanTime, input.originalStatus, input.requestedScanTime, input.requestedStatus,
      input.reason, initialStatus, supervisorId,
    ]
  );
  return result.insertId;
}

export async function getRequest(id: number): Promise<CorrectionRequest | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_REQUEST} WHERE r.id = ?`, [id]);
  return (rows[0] as CorrectionRequest) ?? null;
}

// status filter + role-based scoping is handled by the route (it knows the
// caller's identity); this just runs whatever WHERE it's given.
export async function listRequests(where: string, params: any[]): Promise<CorrectionRequest[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SELECT_REQUEST} ${where ? `WHERE ${where}` : ''} ORDER BY r.created_at DESC`,
    params
  );
  return rows as CorrectionRequest[];
}

export async function decideSupervisor(
  id: number,
  decision: 'approved' | 'rejected',
  comment: string | null
): Promise<void> {
  const nextStatus: RequestStatus = decision === 'approved' ? 'pending_admin' : 'rejected';
  await pool.query<ResultSetHeader>(
    `UPDATE attendance_correction_requests
        SET supervisor_decision = ?, supervisor_comment = ?, supervisor_decided_at = NOW(), status = ?
      WHERE id = ?`,
    [decision, comment, nextStatus, id]
  );
}

// Admin's final confirmation actually mutates attendance_records — this is
// the only place a correction/appeal takes effect.
export async function decideAdmin(
  id: number,
  decision: 'approved' | 'rejected',
  comment: string | null
): Promise<void> {
  const req = await getRequest(id);
  if (!req) throw new Error('ไม่พบคำขอ');

  if (decision === 'approved') {
    if (req.request_type === 'correction' && req.attendance_record_id) {
      await pool.query(
        'UPDATE attendance_records SET scan_time = COALESCE(?, scan_time), status = COALESCE(?, status) WHERE id = ?',
        [req.requested_scan_time, req.requested_status, req.attendance_record_id]
      );
    } else if (req.request_type === 'appeal_absent' || req.request_type === 'appeal_late') {
      if (req.attendance_record_id) {
        await pool.query(
          'UPDATE attendance_records SET status = COALESCE(?, status), scan_time = COALESCE(?, scan_time) WHERE id = ?',
          [req.requested_status, req.requested_scan_time, req.attendance_record_id]
        );
      } else if (req.requested_scan_time) {
        // Appealing an absence with no existing scan at all — insert one on
        // the employee's behalf (admin-confirmed, so no face descriptor).
        await pool.query<ResultSetHeader>(
          `INSERT INTO attendance_records (employee_id, scan_time, scan_type, status)
           VALUES (?, ?, 'check_in', ?)`,
          [req.employee_id, req.requested_scan_time, req.requested_status || 'on_time']
        );
      }
    }
  }

  await pool.query<ResultSetHeader>(
    `UPDATE attendance_correction_requests
        SET admin_decision = ?, admin_comment = ?, admin_decided_at = NOW(),
            status = ?
      WHERE id = ?`,
    [decision, comment, decision === 'approved' ? 'approved' : 'rejected', id]
  );
}
