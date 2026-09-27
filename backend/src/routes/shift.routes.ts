import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { validateShiftOrder } from '../services/shift.service';
import { logAudit } from '../services/audit.service';

const router = Router();

// Listing shifts is allowed for any logged-in user (needed by employee forms);
// mutations require admin.
router.get('/', verifyJWT, asyncHandler(async (_req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM shifts ORDER BY id ASC');
  res.json(rows);
}));

router.get('/:id', verifyJWT, asyncHandler(async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ? LIMIT 1', [req.params.id]);
  if (!rows.length) {
    res.status(404).json({ error: 'ไม่พบกะการทำงาน' });
    return;
  }
  res.json(rows[0]);
}));

const DAY_FIELDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const TIME_FIELDS = ['checkin_start', 'checkin_end', 'late_cutoff', 'checkout_start', 'checkout_end', 'ot_start', 'ot_end'] as const;

// `existing` (the current DB row, on PUT) supplies any field the caller
// omits — so a PUT only needs to send the field(s) actually changing,
// instead of resending everything including the Thai `name` every time
// (which is how a shell-encoding slip once corrupted a shift's name).
function readShiftBody(body: any, existing?: any) {
  const days = Object.fromEntries(
    DAY_FIELDS.map((f) => [f, body[f] !== undefined ? (body[f] ? 1 : 0) : (existing ? existing[f] : 0)])
  ) as Record<(typeof DAY_FIELDS)[number], number>;
  const times = Object.fromEntries(
    TIME_FIELDS.map((f) => [f, body[f] !== undefined ? body[f] : existing?.[f]])
  ) as Record<(typeof TIME_FIELDS)[number], string>;
  const flexibleTime = body.flexible_time !== undefined ? (body.flexible_time ? 1 : 0) : (existing ? existing.flexible_time : 0);
  return {
    name: body.name !== undefined ? body.name : existing?.name,
    ...days,
    ...times,
    flexible_time: flexibleTime,
  };
}

// A shift active on zero days would silently never apply to anyone.
function validateAtLeastOneDay(s: Record<(typeof DAY_FIELDS)[number], number>): string | null {
  return DAY_FIELDS.some((f) => s[f]) ? null : 'กรุณาเลือกอย่างน้อย 1 วันที่กะนี้ใช้งาน';
}

router.post('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const s = readShiftBody(req.body ?? {});
  if (!s.name) {
    res.status(400).json({ error: 'กรุณาตั้งชื่อกะการทำงาน' });
    return;
  }
  const dayErr = validateAtLeastOneDay(s);
  if (dayErr) {
    res.status(400).json({ error: dayErr });
    return;
  }
  const err = validateShiftOrder(s as any);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO shifts
       (name, mon, tue, wed, thu, fri, sat, sun, checkin_start, checkin_end, late_cutoff, checkout_start, checkout_end, ot_start, ot_end, flexible_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.name, s.mon, s.tue, s.wed, s.thu, s.fri, s.sat, s.sun, s.checkin_start, s.checkin_end, s.late_cutoff, s.checkout_start, s.checkout_end, s.ot_start, s.ot_end, s.flexible_time]
  );
  await logAudit(req, { action: 'shift.create', targetTable: 'shifts', targetId: result.insertId, after: s });
  res.status(201).json({ id: result.insertId });
}));

router.put('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const [beforeRows] = await pool.query<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
  if (!beforeRows.length) {
    res.status(404).json({ error: 'ไม่พบกะการทำงาน' });
    return;
  }
  const s = readShiftBody(req.body ?? {}, beforeRows[0]);
  if (!s.name) {
    res.status(400).json({ error: 'กรุณาตั้งชื่อกะการทำงาน' });
    return;
  }
  const dayErr = validateAtLeastOneDay(s);
  if (dayErr) {
    res.status(400).json({ error: dayErr });
    return;
  }
  const err = validateShiftOrder(s as any);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  await pool.query<ResultSetHeader>(
    `UPDATE shifts
        SET name = ?, mon = ?, tue = ?, wed = ?, thu = ?, fri = ?, sat = ?, sun = ?,
            checkin_start = ?, checkin_end = ?, late_cutoff = ?,
            checkout_start = ?, checkout_end = ?, ot_start = ?, ot_end = ?, flexible_time = ?
      WHERE id = ?`,
    [s.name, s.mon, s.tue, s.wed, s.thu, s.fri, s.sat, s.sun, s.checkin_start, s.checkin_end, s.late_cutoff, s.checkout_start, s.checkout_end, s.ot_start, s.ot_end, s.flexible_time, req.params.id]
  );
  await logAudit(req, { action: 'shift.update', targetTable: 'shifts', targetId: Number(req.params.id), before: beforeRows[0], after: s });
  res.json({ ok: true });
}));

router.delete('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const [beforeRows] = await pool.query<RowDataPacket[]>('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
  await pool.query<ResultSetHeader>('DELETE FROM shifts WHERE id = ?', [req.params.id]);
  await logAudit(req, { action: 'shift.delete', targetTable: 'shifts', targetId: Number(req.params.id), before: beforeRows[0] });
  res.json({ ok: true });
}));

export default router;
