import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { validateShiftOrder } from '../services/shift.service';

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

function readShiftBody(body: any) {
  return {
    name: body.name,
    checkin_start: body.checkin_start,
    checkin_end: body.checkin_end,
    late_cutoff: body.late_cutoff,
    checkout_start: body.checkout_start,
    checkout_end: body.checkout_end,
    ot_start: body.ot_start,
    ot_end: body.ot_end,
  };
}

router.post('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const s = readShiftBody(req.body ?? {});
  if (!s.name) {
    res.status(400).json({ error: 'กรุณาตั้งชื่อกะการทำงาน' });
    return;
  }
  const err = validateShiftOrder(s as any);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO shifts
       (name, checkin_start, checkin_end, late_cutoff, checkout_start, checkout_end, ot_start, ot_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.name, s.checkin_start, s.checkin_end, s.late_cutoff, s.checkout_start, s.checkout_end, s.ot_start, s.ot_end]
  );
  res.status(201).json({ id: result.insertId });
}));

router.put('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const s = readShiftBody(req.body ?? {});
  const err = validateShiftOrder(s as any);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  await pool.query<ResultSetHeader>(
    `UPDATE shifts
        SET name = ?, checkin_start = ?, checkin_end = ?, late_cutoff = ?,
            checkout_start = ?, checkout_end = ?, ot_start = ?, ot_end = ?
      WHERE id = ?`,
    [s.name, s.checkin_start, s.checkin_end, s.late_cutoff, s.checkout_start, s.checkout_end, s.ot_start, s.ot_end, req.params.id]
  );
  res.json({ ok: true });
}));

router.delete('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await pool.query<ResultSetHeader>('DELETE FROM shifts WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
