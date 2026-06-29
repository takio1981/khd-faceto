import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import rateLimit from 'express-rate-limit';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { processScan, processScanPreview, saveUnknownFaceAndNotify } from '../services/shift.service';
import { ictDateKey } from '../utils/ict';
import { logAudit } from '../services/audit.service';

const router = Router();

// The live check-in loop calls preview/scan repeatedly (every ~400ms, once per
// detected face) by design, so it needs a much higher ceiling than the rest
// of the API's default 300/min limit.
const scanLimiter = rateLimit({ windowMs: 60_000, max: 6000, standardHeaders: true, legacyHeaders: false });

// POST /api/attendance/scan  - public: the checkin kiosk page (frontend/public/checkin.html)
// is reachable without login by design, so anyone with the page open can scan.
router.post('/scan', scanLimiter, asyncHandler(async (req, res) => {
  const { descriptor, imageBase64, scanLocationId } = req.body ?? {};
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    res.status(400).json({ error: 'descriptor ต้องเป็น array ขนาด 128' });
    return;
  }
  const locId = scanLocationId != null && !Number.isNaN(Number(scanLocationId)) ? Number(scanLocationId) : null;

  // processScan saves the image (if any) and resolves the scan location's
  // name itself now, so the notification it fires always has the right
  // face_image_path — no more separate post-hoc UPDATE racing against it.
  const result = await processScan(descriptor, imageBase64 || null, new Date(), locId);

  res.json(result);
}));

// POST /api/attendance/unknown-face  - public, same reasoning as /scan above.
// Follow-up call the kiosk makes when a /preview result comes back with
// unknownFaceAlert: true (server-debounced, see shift.service.ts) — captures
// the face that didn't match anyone so admin can review it.
router.post('/unknown-face', scanLimiter, asyncHandler(async (req, res) => {
  const { imageBase64, scanLocationId } = req.body ?? {};
  const locId = scanLocationId != null && !Number.isNaN(Number(scanLocationId)) ? Number(scanLocationId) : null;
  await saveUnknownFaceAndNotify(imageBase64 || null, locId, new Date());
  res.json({ ok: true });
}));

// GET /api/attendance  - list with filters
// Query: dateFrom, dateTo, employeeId, status, page, pageSize
// GET /api/attendance  - list with filters
// Query: dateFrom, dateTo, employeeId, department, scanType, status, search, page, pageSize
router.get('/', verifyJWT, asyncHandler(async (req, res) => {
  const { dateFrom, dateTo, employeeId, department, scanType, status, search } = req.query;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10)));
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: any[] = [];

  // Non-admin users can only see their own records
  if (req.user!.role !== 'admin') {
    where.push('ar.employee_id = ?');
    params.push(req.user!.employeeId ?? -1);
  } else if (employeeId) {
    where.push('ar.employee_id = ?');
    params.push(employeeId);
  }
  if (dateFrom)   { where.push('DATE(ar.scan_time) >= ?'); params.push(dateFrom); }
  if (dateTo)     { where.push('DATE(ar.scan_time) <= ?'); params.push(dateTo); }
  if (status)     { where.push('ar.status = ?'); params.push(status); }
  if (scanType)   { where.push('ar.scan_type = ?'); params.push(scanType); }
  if (department) { where.push('e.department = ?'); params.push(department); }
  if (search) {
    where.push('(e.full_name LIKE ? OR e.employee_code LIKE ? OR e.department LIKE ?)');
    const kw = `%${search}%`;
    params.push(kw, kw, kw);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id ${whereSql}`,
    params
  );
  const total = countRows[0].total as number;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ar.*, e.employee_code, e.full_name, e.department, sl.name AS scan_location_name
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN scan_locations sl ON sl.id = ar.scan_location_id
       ${whereSql}
      ORDER BY ar.scan_time DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  res.json({ data: rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}));

// GET /api/attendance/recent  - public: powers the checkin kiosk's "ภาพและ
// ข้อมูลการสแกนล่าสุด" feed (same reasoning as /scan and /preview above —
// the kiosk runs without login by design). Sourced from the real
// attendance_records table, scoped to just today and optionally one scan
// location, and capped to a small limit, so an unauthenticated kiosk only
// ever sees a bounded slice of "who scanned here today" — the same category
// of info the kiosk already shows live as people scan, just sourced from
// the database instead of a client-only cache, so edits/deletes made via
// the admin Attendance page show up here too on the next poll.
router.get('/recent', asyncHandler(async (req, res) => {
  const scanLocationId = req.query.scanLocationId ? Number(req.query.scanLocationId) : null;
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10)));

  const where: string[] = ['DATE(ar.scan_time) = ?'];
  const params: any[] = [ictDateKey(new Date())];
  if (scanLocationId) {
    where.push('ar.scan_location_id = ?');
    params.push(scanLocationId);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ar.id, ar.scan_time, ar.scan_type, ar.status, ar.face_image_path, e.full_name
       FROM attendance_records ar
       JOIN employees e ON e.id = ar.employee_id
      WHERE ${where.join(' AND ')}
      ORDER BY ar.scan_time DESC
      LIMIT ?`,
    [...params, limit]
  );

  const data = await Promise.all(rows.map(async (r) => {
    let imageBase64: string | null = null;
    if (r.face_image_path) {
      try {
        const abs = path.join(config.face.imageDir, r.face_image_path);
        if (abs.startsWith(path.resolve(config.face.imageDir))) {
          const buf = await fs.readFile(abs);
          imageBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      } catch {
        // image missing on disk — just omit the thumbnail
      }
    }
    return {
      id: r.id,
      name: r.full_name,
      scanType: r.scan_type,
      status: r.status,
      time: r.scan_time,
      imageBase64,
    };
  }));

  res.json(data);
}));

// GET /api/attendance/image/:id  - stream the saved face JPEG (admin or owner)
router.get('/image/:id', verifyJWT, asyncHandler(async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT employee_id, face_image_path FROM attendance_records WHERE id = ? LIMIT 1',
    [req.params.id]
  );
  if (!rows.length || !rows[0].face_image_path) {
    res.status(404).json({ error: 'ไม่พบรูปภาพ' });
    return;
  }
  // Authorisation: admins see all; users only their own
  if (req.user!.role !== 'admin' && req.user!.employeeId !== rows[0].employee_id) {
    res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึงรูปภาพนี้' });
    return;
  }
  const abs = path.join(config.face.imageDir, rows[0].face_image_path);
  // Prevent path traversal
  if (!abs.startsWith(path.resolve(config.face.imageDir))) {
    res.status(400).json({ error: 'invalid path' });
    return;
  }
  // Log admin access to a face image — viewing someone else's biometric
  // photo is exactly the kind of access PDPA/the Computer Crime Act expects
  // to be traceable. Not logged for a user viewing their own image.
  if (req.user!.role === 'admin') {
    await logAudit(req, { action: 'attendance.view_image', targetTable: 'attendance_records', targetId: Number(req.params.id) });
  }
  res.setHeader('Content-Type', 'image/jpeg');
  createReadStream(abs).on('error', () => res.status(404).end()).pipe(res);
}));

// PUT /api/attendance/:id  - Admin: edit scan_time, scan_type, status
router.put('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const { scan_time, scan_type, status } = req.body ?? {};
  const fields: string[] = [];
  const params: any[] = [];

  if (scan_time) { fields.push('scan_time = ?'); params.push(scan_time); }
  if (scan_type) { fields.push('scan_type = ?'); params.push(scan_type); }
  if (status)    { fields.push('status = ?'); params.push(status); }

  if (!fields.length) {
    res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องการแก้ไข (scan_time, scan_type, status)' });
    return;
  }

  const [beforeRows] = await pool.query<RowDataPacket[]>('SELECT * FROM attendance_records WHERE id = ?', [req.params.id]);
  params.push(req.params.id);
  try {
    await pool.query<ResultSetHeader>(
      `UPDATE attendance_records SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'พนักงานคนนี้มีรายการประเภทเดียวกันในวันนั้นอยู่แล้ว' });
      return;
    }
    throw err;
  }
  await logAudit(req, {
    action: 'attendance.update',
    targetTable: 'attendance_records',
    targetId: Number(req.params.id),
    before: beforeRows[0],
    after: { scan_time, scan_type, status },
  });
  res.json({ ok: true });
}));

// POST /api/attendance/preview - validate face without inserting (for confirmation dialog)
// Public for the same reason as /scan above.
router.post('/preview', scanLimiter, asyncHandler(async (req, res) => {
  const { descriptor, scanLocationId } = req.body ?? {};
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    res.status(400).json({ error: 'descriptor ต้องเป็น array ขนาด 128' });
    return;
  }
  const locId = scanLocationId != null && !Number.isNaN(Number(scanLocationId)) ? Number(scanLocationId) : null;

  const now = new Date();
  const previewResult = await processScanPreview(descriptor, now, locId);
  res.json(previewResult);
}));

// DELETE /api/attendance/:id  - Admin: delete a record
router.delete('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const [beforeRows] = await pool.query<RowDataPacket[]>('SELECT * FROM attendance_records WHERE id = ?', [req.params.id]);
  await pool.query<ResultSetHeader>(
    'DELETE FROM attendance_records WHERE id = ?',
    [req.params.id]
  );
  await logAudit(req, {
    action: 'attendance.delete',
    targetTable: 'attendance_records',
    targetId: Number(req.params.id),
    before: beforeRows[0],
  });
  res.json({ ok: true });
}));

export default router;
