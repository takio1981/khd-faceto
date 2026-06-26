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
import { processScan, processScanPreview } from '../services/shift.service';
import { ictDateKey, ictTimeStamp } from '../utils/ict';

const router = Router();

// The live check-in loop calls preview/scan repeatedly (every ~400ms, once per
// detected face) by design, so it needs a much higher ceiling than the rest
// of the API's default 300/min limit.
const scanLimiter = rateLimit({ windowMs: 60_000, max: 6000, standardHeaders: true, legacyHeaders: false });

// Save a base64 data-URL JPEG to disk under FACE_IMAGE_DIR/<YYYY-MM-DD>/<code>_<ts>.jpg
// Returns the relative path stored in the DB, or null on failure / no image.
async function saveFaceImage(imageBase64: string | undefined, employeeCode: string, now: Date): Promise<string | null> {
  if (!imageBase64) return null;
  const match = /^data:image\/\w+;base64,(.+)$/.exec(imageBase64);
  const data = match ? match[1] : imageBase64;
  try {
    const day = ictDateKey(now);
    const ts = ictTimeStamp(now);
    const dir = path.join(config.face.imageDir, day);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${employeeCode}_${ts}_${Date.now() % 1000}.jpg`;
    const relPath = path.join(day, filename);
    await fs.writeFile(path.join(config.face.imageDir, relPath), Buffer.from(data, 'base64'));
    return relPath.split(path.sep).join('/');
  } catch (err) {
    console.error('[attendance] failed to save face image', err);
    return null;
  }
}

// POST /api/attendance/scan  - public: the checkin kiosk page (frontend/public/checkin.html)
// is reachable without login by design, so anyone with the page open can scan.
router.post('/scan', scanLimiter, asyncHandler(async (req, res) => {
  const { descriptor, imageBase64, scanLocationId } = req.body ?? {};
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    res.status(400).json({ error: 'descriptor ต้องเป็น array ขนาด 128' });
    return;
  }
  const locId = scanLocationId != null && !Number.isNaN(Number(scanLocationId)) ? Number(scanLocationId) : null;

  const now = new Date();

  // Run the scan: it matches the face, classifies the scan, and inserts a record.
  // Only after we know the matched employee (for the filename) do we save the image,
  // then patch the freshly-inserted record by its id.
  const result = await processScan(descriptor, null, now, locId);

  if (result.recordId && result.employee) {
    const imgPath = await saveFaceImage(imageBase64, result.employee.employee_code, now);
    if (imgPath) {
      await pool.query(
        'UPDATE attendance_records SET face_image_path = ? WHERE id = ?',
        [imgPath, result.recordId]
      );
    }
  }

  res.json(result);
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
  res.json({ ok: true });
}));

// POST /api/attendance/preview - validate face without inserting (for confirmation dialog)
// Public for the same reason as /scan above.
router.post('/preview', scanLimiter, asyncHandler(async (req, res) => {
  const { descriptor } = req.body ?? {};
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    res.status(400).json({ error: 'descriptor ต้องเป็น array ขนาด 128' });
    return;
  }

  const now = new Date();
  const previewResult = await processScanPreview(descriptor, now);
  res.json(previewResult);
}));

// DELETE /api/attendance/:id  - Admin: delete a record
router.delete('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await pool.query<ResultSetHeader>(
    'DELETE FROM attendance_records WHERE id = ?',
    [req.params.id]
  );
  res.json({ ok: true });
}));

export default router;
