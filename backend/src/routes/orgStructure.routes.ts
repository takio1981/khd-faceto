import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import {
  listDivisions, createDivision, updateDivision, deleteDivision,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listPositions, createPosition, updatePosition, deletePosition,
} from '../services/orgStructure.service';

const router = Router();

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
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อกลุ่มงาน' });
    return;
  }
  await updateDivision(Number(req.params.id), name, req.body?.head_employee_id || null);
  await logAudit(req, { action: 'division.update', targetTable: 'divisions', targetId: Number(req.params.id), after: req.body });
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
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อแผนก' });
    return;
  }
  await updateDepartment(Number(req.params.id), name, req.body?.division_id || null, req.body?.head_employee_id || null);
  await logAudit(req, { action: 'department.update', targetTable: 'departments', targetId: Number(req.params.id), after: req.body });
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
  const name = String(req.body?.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'กรุณากรอกชื่อตำแหน่ง' });
    return;
  }
  await updatePosition(Number(req.params.id), name, req.body?.category || null);
  await logAudit(req, { action: 'position.update', targetTable: 'positions', targetId: Number(req.params.id), after: req.body });
  res.json({ ok: true });
}));

router.delete('/positions/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deletePosition(Number(req.params.id));
  await logAudit(req, { action: 'position.delete', targetTable: 'positions', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

export default router;
