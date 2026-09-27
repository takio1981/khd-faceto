import { Router } from 'express';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import {
  listDivisions, createDivision, updateDivision, deleteDivision,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listPositions, createPosition, updatePosition, deletePosition,
  listLevels, createLevel, updateLevel, deleteLevel, listLevelsForPosition,
} from '../services/orgStructure.service';

const router = Router();

// Fetches the raw row so a PUT can fall back to it for any field the caller
// omits — lets a caller change e.g. just head_employee_id without resending
// the Thai `name` every time.
async function getRawRow(table: string, id: number): Promise<RowDataPacket | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

// Listing is allowed for any logged-in user (employee form/approval routing
// need it); mutations require admin.
router.get('/divisions', verifyJWT, asyncHandler(async (_req, res) => {
  res.json(await listDivisions());
}));

router.post('/divisions', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มงาน' });
    return;
  }
  const id = await createDivision(name, req.body?.head_employee_id || null);
  await logAudit(req, { action: 'division.create', targetTable: 'divisions', targetId: id, after: req.body });
  res.status(201).json({ id });
}));

router.put('/divisions/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getRawRow('divisions', id);
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบกลุ่มงาน' });
    return;
  }
  const name = String(req.body?.name !== undefined ? req.body.name : existing.name).trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มงาน' });
    return;
  }
  const headEmployeeId = req.body?.head_employee_id !== undefined ? (req.body.head_employee_id || null) : existing.head_employee_id;
  await updateDivision(id, name, headEmployeeId);
  await logAudit(req, { action: 'division.update', targetTable: 'divisions', targetId: id, after: { name, head_employee_id: headEmployeeId } });
  res.json({ ok: true });
}));

router.delete('/divisions/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deleteDivision(Number(req.params.id));
  await logAudit(req, { action: 'division.delete', targetTable: 'divisions', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

router.get('/departments', verifyJWT, asyncHandler(async (_req, res) => {
  res.json(await listDepartments());
}));

router.post('/departments', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อแผนก' });
    return;
  }
  const id = await createDepartment(name, req.body?.division_id || null, req.body?.head_employee_id || null);
  await logAudit(req, { action: 'department.create', targetTable: 'departments', targetId: id, after: req.body });
  res.status(201).json({ id });
}));

router.put('/departments/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getRawRow('departments', id);
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบแผนก' });
    return;
  }
  const name = String(req.body?.name !== undefined ? req.body.name : existing.name).trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อแผนก' });
    return;
  }
  const divisionId = req.body?.division_id !== undefined ? (req.body.division_id || null) : existing.division_id;
  const headEmployeeId = req.body?.head_employee_id !== undefined ? (req.body.head_employee_id || null) : existing.head_employee_id;
  await updateDepartment(id, name, divisionId, headEmployeeId);
  await logAudit(req, { action: 'department.update', targetTable: 'departments', targetId: id, after: { name, division_id: divisionId, head_employee_id: headEmployeeId } });
  res.json({ ok: true });
}));

router.delete('/departments/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deleteDepartment(Number(req.params.id));
  await logAudit(req, { action: 'department.delete', targetTable: 'departments', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

router.get('/positions', verifyJWT, asyncHandler(async (_req, res) => {
  res.json(await listPositions());
}));

router.post('/positions', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อตำแหน่ง' });
    return;
  }
  const id = await createPosition(name, req.body?.category || null);
  await logAudit(req, { action: 'position.create', targetTable: 'positions', targetId: id, after: req.body });
  res.status(201).json({ id });
}));

router.put('/positions/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getRawRow('positions', id);
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบตำแหน่ง' });
    return;
  }
  const name = String(req.body?.name !== undefined ? req.body.name : existing.name).trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อตำแหน่ง' });
    return;
  }
  const category = req.body?.category !== undefined ? (req.body.category || null) : existing.category;
  await updatePosition(id, name, category);
  await logAudit(req, { action: 'position.update', targetTable: 'positions', targetId: id, after: { name, category } });
  res.json({ ok: true });
}));

router.delete('/positions/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deletePosition(Number(req.params.id));
  await logAudit(req, { action: 'position.delete', targetTable: 'positions', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

router.get('/levels', verifyJWT, asyncHandler(async (_req, res) => {
  res.json(await listLevels());
}));

router.post('/levels', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อระดับ' });
    return;
  }
  const id = await createLevel(name, req.body?.category || null);
  await logAudit(req, { action: 'level.create', targetTable: 'civil_service_levels', targetId: id, after: req.body });
  res.status(201).json({ id });
}));

router.put('/levels/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await getRawRow('civil_service_levels', id);
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบระดับ' });
    return;
  }
  const name = String(req.body?.name !== undefined ? req.body.name : existing.name).trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อระดับ' });
    return;
  }
  const category = req.body?.category !== undefined ? (req.body.category || null) : existing.category;
  await updateLevel(id, name, category);
  await logAudit(req, { action: 'level.update', targetTable: 'civil_service_levels', targetId: id, after: { name, category } });
  res.json({ ok: true });
}));

router.delete('/levels/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deleteLevel(Number(req.params.id));
  await logAudit(req, { action: 'level.delete', targetTable: 'civil_service_levels', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

router.get('/positions/:id/levels', verifyJWT, asyncHandler(async (req, res) => {
  res.json(await listLevelsForPosition(Number(req.params.id)));
}));

export default router;
