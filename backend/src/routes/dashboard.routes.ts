import { Router } from 'express';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT } from '../middleware/auth';
import { isWeekendDateKey } from '../utils/ict';
import { isHoliday } from '../services/holidays.service';

const router = Router();

// GET /api/dashboard/summary?date=YYYY-MM-DD&employeeId=optional
router.get('/summary', verifyJWT, asyncHandler(async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;

  // Non-admins are scoped to themselves
  const scopedEmployeeId = req.user!.role === 'admin' ? employeeId : (req.user!.employeeId ?? -1);

  // --- Today's status counts (check-in records only, since that's the daily attendance signal) ---
  const statusParams: any[] = [date];
  let statusScope = '';
  if (scopedEmployeeId) { statusScope = 'AND employee_id = ?'; statusParams.push(scopedEmployeeId); }

  const [statusRows] = await pool.query<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS cnt
       FROM attendance_records
      WHERE DATE(scan_time) = ? AND scan_type = 'check_in' ${statusScope}
      GROUP BY status`,
    statusParams
  );

  const counts = { on_time: 0, late: 0, absent: 0, ot: 0 };
  for (const r of statusRows) {
    counts[r.status as keyof typeof counts] = r.cnt;
  }

  // OT count for the day (one per employee who clocked OT-in)
  const [otRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM attendance_records
      WHERE DATE(scan_time) = ? AND scan_type = 'ot_in' ${statusScope}`,
    statusParams
  );
  counts.ot = otRows[0].cnt as number;

  // Total active employees (for absent calculation context)
  const [empRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM employees WHERE is_active = 1 ${scopedEmployeeId ? 'AND id = ?' : ''}`,
    scopedEmployeeId ? [scopedEmployeeId] : []
  );
  const totalEmployees = empRows[0].total as number;
  const present = counts.on_time + counts.late;
  // Nobody is expected to check in on a non-workday — don't count the whole
  // staff as "absent" just because it's a weekend or a declared holiday.
  const isNonWorkday = isWeekendDateKey(date) || (await isHoliday(date));
  counts.absent = isNonWorkday ? 0 : Math.max(0, totalEmployees - present);

  // --- Weekly trend: last 7 days, on_time vs late ---
  const weeklyParams: any[] = [];
  let weeklyScope = '';
  if (scopedEmployeeId) { weeklyScope = 'AND employee_id = ?'; weeklyParams.push(scopedEmployeeId); }
  const [weekRows] = await pool.query<RowDataPacket[]>(
    `SELECT DATE(scan_time) AS d,
            SUM(status = 'on_time') AS on_time,
            SUM(status = 'late')    AS late
       FROM attendance_records
      WHERE scan_type = 'check_in'
        AND scan_time >= DATE_SUB(?, INTERVAL 6 DAY)
        AND scan_time <  DATE_ADD(?, INTERVAL 1 DAY) ${weeklyScope}
      GROUP BY DATE(scan_time)
      ORDER BY d ASC`,
    [date, date, ...weeklyParams]
  );

  // --- Per-employee 30-day check-in time history (drill-down) ---
  let employeeHistory: any[] = [];
  if (employeeId && req.user!.role === 'admin') {
    const [histRows] = await pool.query<RowDataPacket[]>(
      `SELECT DATE(scan_time) AS d,
              TIME(MIN(scan_time)) AS first_checkin,
              MIN(status) AS status
         FROM attendance_records
        WHERE employee_id = ? AND scan_type = 'check_in'
          AND scan_time >= DATE_SUB(?, INTERVAL 29 DAY)
          AND scan_time <  DATE_ADD(?, INTERVAL 1 DAY)
        GROUP BY DATE(scan_time)
        ORDER BY d ASC`,
      [employeeId, date, date]
    );
    employeeHistory = histRows;
  }

  res.json({
    date,
    counts,
    totalEmployees,
    present,
    isNonWorkday,
    weekly: weekRows,
    employeeHistory,
  });
}));

export default router;
