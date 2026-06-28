import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import {
  listUsers, getUser, createUser, updateUser, deleteUser, unlockUser, countAdmins,
  ConflictError, DuplicateUsernameError,
} from '../services/user.service';

const router = Router();

// All user-management routes are admin-only
router.use(verifyJWT, requireRole('admin'));

router.get('/', asyncHandler(async (req, res) => {
  const { role, search, employeeId, unlinkedOnly, lockedOnly } = req.query;
  const users = await listUsers({
    role: role as any,
    search: search ? String(search) : undefined,
    employeeId: employeeId ? Number(employeeId) : undefined,
    unlinkedOnly: unlinkedOnly === '1',
    lockedOnly: lockedOnly === '1',
  });
  res.json(users);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { username, password, role, employee_id } = req.body ?? {};
  const cleanUsername = String(username || '').trim();
  if (!cleanUsername || !password) {
    res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    return;
  }
  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: 'สิทธิ์ผู้ใช้ไม่ถูกต้อง' });
    return;
  }
  try {
    const id = await createUser(cleanUsername, password, role, employee_id || null);
    await logAudit(req, { action: 'user.create', targetTable: 'users', targetId: id, after: { username: cleanUsername, role, employee_id: employee_id || null } });
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof DuplicateUsernameError || err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { username, password, role, employee_id } = req.body ?? {};
  if (role !== undefined && role !== 'admin' && role !== 'user') {
    res.status(400).json({ error: 'สิทธิ์ผู้ใช้ไม่ถูกต้อง' });
    return;
  }
  const userId = Number(req.params.id);

  // Don't let the last admin demote/unlink themselves into a dead end where
  // nobody with admin rights can log back in to fix it.
  if (role === 'user') {
    const before = await getUser(userId);
    if (before?.role === 'admin' && (await countAdmins(userId)) === 0) {
      res.status(400).json({ error: 'ไม่สามารถลดสิทธิ์ผู้ดูแลคนสุดท้ายของระบบได้' });
      return;
    }
  }

  try {
    await updateUser(userId, {
      username: username ? String(username).trim() : undefined,
      password: password || undefined,
      role,
      employeeId: employee_id === undefined ? undefined : (employee_id || null),
    });
    await logAudit(req, {
      action: 'user.update',
      targetTable: 'users',
      targetId: userId,
      after: { username, role, employee_id, passwordChanged: !!password },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof DuplicateUsernameError || err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
}));

router.put('/:id/unlock', asyncHandler(async (req, res) => {
  await unlockUser(Number(req.params.id));
  await logAudit(req, { action: 'user.unlock', targetTable: 'users', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user!.sub) {
    res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
    return;
  }
  const target = await getUser(userId);
  if (target?.role === 'admin' && (await countAdmins(userId)) === 0) {
    res.status(400).json({ error: 'ไม่สามารถลบผู้ดูแลคนสุดท้ายของระบบได้' });
    return;
  }
  await deleteUser(userId);
  await logAudit(req, { action: 'user.delete', targetTable: 'users', targetId: userId, before: target as any });
  res.json({ ok: true });
}));

export default router;
