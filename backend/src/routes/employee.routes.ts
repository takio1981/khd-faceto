import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { pool } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { invalidateFaceCache } from '../services/faceCache';
import { getConsentStatus, recordConsent, withdrawConsent } from '../services/consent.service';
import { logAudit } from '../services/audit.service';

const router = Router();

// All employee management routes require admin
router.use(verifyJWT, requireRole('admin'));

// GET /api/employees  - list (with shift name + descriptor count)
router.get('/', asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === '1';
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.*, s.name AS shift_name, sup.full_name AS supervisor_name,
            (SELECT COUNT(*) FROM face_descriptors fd WHERE fd.employee_id = e.id) AS face_count
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN employees sup ON sup.id = e.supervisor_id
      ${includeInactive ? '' : 'WHERE e.is_active = 1'}
      ORDER BY e.employee_code ASC`
  );
  res.json(rows);
}));

// GET /api/employees/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.*, s.name AS shift_name, sup.full_name AS supervisor_name,
            (SELECT COUNT(*) FROM face_descriptors fd WHERE fd.employee_id = e.id) AS face_count
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN employees sup ON sup.id = e.supervisor_id
      WHERE e.id = ? LIMIT 1`,
    [req.params.id]
  );
  if (!rows.length) {
    res.status(404).json({ error: 'ไม่พบพนักงาน' });
    return;
  }
  res.json(rows[0]);
}));

// POST /api/employees  - create. Optionally create a linked login account.
router.post('/', asyncHandler(async (req, res) => {
  const { employee_code, full_name, department, position, shift_id, supervisor_id,
          notify_email, notify_line_user_id, notify_telegram_chat_id, notify_enabled,
          create_login, login_username, login_password, login_role } = req.body ?? {};

  if (!employee_code || !full_name) {
    res.status(400).json({ error: 'กรุณากรอกรหัสพนักงานและชื่อ-นามสกุล' });
    return;
  }

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO employees (employee_code, full_name, department, position, shift_id, supervisor_id,
                             notify_email, notify_line_user_id, notify_telegram_chat_id, notify_enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employee_code, full_name, department || null, position || null, shift_id || null, supervisor_id || null,
      notify_email || null, notify_line_user_id || null, notify_telegram_chat_id || null,
      notify_enabled === undefined ? 1 : notify_enabled ? 1 : 0,
    ]
  );
  const employeeId = result.insertId;

  // Optionally create a user account linked to this employee
  if (create_login && login_username && login_password) {
    const hash = await bcrypt.hash(login_password, 10);
    await pool.query<ResultSetHeader>(
      `INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)`,
      [login_username, hash, login_role === 'admin' ? 'admin' : 'user', employeeId]
    );
  }

  res.status(201).json({ id: employeeId });
}));

// PUT /api/employees/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { employee_code, full_name, department, position, shift_id, supervisor_id, is_active,
          notify_email, notify_line_user_id, notify_telegram_chat_id, notify_enabled } = req.body ?? {};

  if (supervisor_id && Number(supervisor_id) === Number(req.params.id)) {
    res.status(400).json({ error: 'พนักงานไม่สามารถเป็นผู้บังคับบัญชาของตัวเองได้' });
    return;
  }

  const [beforeRows] = await pool.query<RowDataPacket[]>('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  await pool.query<ResultSetHeader>(
    `UPDATE employees
        SET employee_code = ?, full_name = ?, department = ?, position = ?,
            shift_id = ?, supervisor_id = ?, is_active = ?,
            notify_email = ?, notify_line_user_id = ?, notify_telegram_chat_id = ?, notify_enabled = ?
      WHERE id = ?`,
    [
      employee_code, full_name, department || null, position || null,
      shift_id || null, supervisor_id || null, is_active === undefined ? 1 : is_active ? 1 : 0,
      notify_email || null, notify_line_user_id || null, notify_telegram_chat_id || null,
      notify_enabled === undefined ? 1 : notify_enabled ? 1 : 0,
      req.params.id,
    ]
  );
  invalidateFaceCache();
  await logAudit(req, {
    action: 'employee.update',
    targetTable: 'employees',
    targetId: Number(req.params.id),
    before: beforeRows[0],
    after: req.body,
  });
  res.json({ ok: true });
}));

// DELETE /api/employees/:id  - soft delete
router.delete('/:id', asyncHandler(async (req, res) => {
  await pool.query<ResultSetHeader>(
    'UPDATE employees SET is_active = 0 WHERE id = ?',
    [req.params.id]
  );
  invalidateFaceCache();
  await logAudit(req, { action: 'employee.deactivate', targetTable: 'employees', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---- PDPA consent (มาตรา 26 — face data is sensitive/biometric data) ----

// GET /api/employees/:id/consent
router.get('/:id/consent', asyncHandler(async (req, res) => {
  res.json(await getConsentStatus(Number(req.params.id)));
}));

// POST /api/employees/:id/consent - record that the employee has given explicit
// consent (in person; an admin/HR staff records it on their behalf)
router.post('/:id/consent', asyncHandler(async (req, res) => {
  await recordConsent(Number(req.params.id), req.user!.sub ?? null);
  await logAudit(req, { action: 'consent.grant', targetTable: 'employees', targetId: Number(req.params.id) });
  res.status(201).json(await getConsentStatus(Number(req.params.id)));
}));

// DELETE /api/employees/:id/consent - withdraw consent. Also wipes any
// already-collected face data, since there's no remaining legal basis to
// keep it once consent is withdrawn (PDPA มาตรา 30-36 right to withdraw).
router.delete('/:id/consent', asyncHandler(async (req, res) => {
  await withdrawConsent(Number(req.params.id), req.user!.sub ?? null);
  await pool.query<ResultSetHeader>('DELETE FROM face_descriptors WHERE employee_id = ?', [req.params.id]);
  invalidateFaceCache();
  await logAudit(req, { action: 'consent.withdraw', targetTable: 'employees', targetId: Number(req.params.id) });
  res.json(await getConsentStatus(Number(req.params.id)));
}));

// POST /api/employees/:id/face  - enroll a descriptor (128 floats) + optional thumbnail (base64 JPEG)
router.post('/:id/face', asyncHandler(async (req, res) => {
  const { descriptor, thumbnail } = req.body ?? {};
  if (!Array.isArray(descriptor) || descriptor.length !== 128) {
    res.status(400).json({ error: 'descriptor ต้องเป็น array ขนาด 128' });
    return;
  }
  const consent = await getConsentStatus(Number(req.params.id));
  if (!consent.hasConsent) {
    res.status(403).json({ error: 'ต้องบันทึกความยินยอม (consent) ของพนักงานก่อนเก็บข้อมูลใบหน้า' });
    return;
  }
  await pool.query<ResultSetHeader>(
    'INSERT INTO face_descriptors (employee_id, descriptor, thumbnail) VALUES (?, ?, ?)',
    [req.params.id, JSON.stringify(descriptor), thumbnail || null]
  );
  invalidateFaceCache();
  res.status(201).json({ ok: true });
}));

// GET /api/employees/:id/faces  - list all face descriptors + thumbnails for an employee
router.get('/:id/faces', asyncHandler(async (req, res) => {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, descriptor, thumbnail, created_at FROM face_descriptors WHERE employee_id = ? ORDER BY id ASC',
    [req.params.id]
  );
  res.json(rows.map((r) => ({
    id: r.id,
    descriptor: typeof r.descriptor === 'string' ? JSON.parse(r.descriptor) : r.descriptor,
    thumbnail: r.thumbnail || null,
    created_at: r.created_at,
  })));
}));

// DELETE /api/employees/:id/face  - clear all descriptors for an employee
router.delete('/:id/face', asyncHandler(async (req, res) => {
  await pool.query<ResultSetHeader>(
    'DELETE FROM face_descriptors WHERE employee_id = ?',
    [req.params.id]
  );
  invalidateFaceCache();
  res.json({ ok: true });
}));

export default router;
