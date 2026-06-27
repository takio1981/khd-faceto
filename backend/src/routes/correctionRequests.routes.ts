import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import {
  createRequest, getRequest, listRequests, decideSupervisor, decideAdmin, RequestType,
} from '../services/correctionRequests.service';

const router = Router();

const VALID_TYPES: RequestType[] = ['correction', 'appeal_absent', 'appeal_late'];

// POST /api/correction-requests — employees submit for themselves; admin
// may submit on behalf of anyone (e.g. taking a phone-in dispute).
router.post('/', verifyJWT, asyncHandler(async (req, res) => {
  const body = req.body ?? {};
  const employeeId = req.user!.role === 'admin' && body.employeeId ? Number(body.employeeId) : req.user!.employeeId;

  if (!employeeId) {
    res.status(400).json({ error: 'ไม่พบข้อมูลพนักงานที่ผูกกับบัญชีนี้ ไม่สามารถยื่นคำขอได้' });
    return;
  }
  if (!VALID_TYPES.includes(body.requestType)) {
    res.status(400).json({ error: 'ประเภทคำขอไม่ถูกต้อง' });
    return;
  }
  if (!body.targetDate || !body.reason?.trim()) {
    res.status(400).json({ error: 'กรุณาระบุวันที่และเหตุผล' });
    return;
  }

  const id = await createRequest({
    employeeId,
    attendanceRecordId: body.attendanceRecordId || null,
    requestType: body.requestType,
    targetDate: body.targetDate,
    originalScanTime: body.originalScanTime || null,
    originalStatus: body.originalStatus || null,
    requestedScanTime: body.requestedScanTime || null,
    requestedStatus: body.requestedStatus || null,
    reason: body.reason.trim(),
  });
  await logAudit(req, { action: 'correction_request.create', targetTable: 'attendance_correction_requests', targetId: id, after: body });
  res.status(201).json(await getRequest(id));
}));

// GET /api/correction-requests?scope=mine|approving|all
// - mine: the caller's own requests
// - approving: requests currently awaiting THIS caller's decision as supervisor
// - all: admin only — everything
router.get('/', verifyJWT, asyncHandler(async (req, res) => {
  const scope = String(req.query.scope || 'mine');

  if (scope === 'all') {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'ไม่มีสิทธิ์ดูคำขอทั้งหมด' });
      return;
    }
    const status = req.query.status ? String(req.query.status) : undefined;
    res.json(await listRequests(status ? 'r.status = ?' : '', status ? [status] : []));
    return;
  }

  if (scope === 'approving') {
    if (!req.user!.employeeId) {
      res.json([]);
      return;
    }
    res.json(await listRequests('r.supervisor_id = ? AND r.status = ?', [req.user!.employeeId, 'pending_supervisor']));
    return;
  }

  // mine
  const employeeId = req.user!.role === 'admin' && req.query.employeeId ? Number(req.query.employeeId) : req.user!.employeeId;
  if (!employeeId) {
    res.json([]);
    return;
  }
  res.json(await listRequests('r.employee_id = ?', [employeeId]));
}));

// PUT /api/correction-requests/:id/supervisor-decision
router.put('/:id/supervisor-decision', verifyJWT, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const request = await getRequest(id);
  if (!request) {
    res.status(404).json({ error: 'ไม่พบคำขอ' });
    return;
  }
  if (request.status !== 'pending_supervisor') {
    res.status(409).json({ error: 'คำขอนี้ไม่อยู่ในสถานะรอหัวหน้าอนุมัติแล้ว' });
    return;
  }
  // The resolved supervisor must match the caller, unless admin is overriding.
  if (req.user!.role !== 'admin' && req.user!.employeeId !== request.supervisor_id) {
    res.status(403).json({ error: 'คุณไม่ใช่ผู้บังคับบัญชาที่ต้องอนุมัติคำขอนี้' });
    return;
  }
  const decision = req.body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    res.status(400).json({ error: 'decision ต้องเป็น approved หรือ rejected' });
    return;
  }
  await decideSupervisor(id, decision, req.body?.comment || null);
  await logAudit(req, { action: 'correction_request.supervisor_decision', targetTable: 'attendance_correction_requests', targetId: id, after: { decision } });
  res.json(await getRequest(id));
}));

// PUT /api/correction-requests/:id/admin-decision — final step, applies the change
router.put('/:id/admin-decision', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const request = await getRequest(id);
  if (!request) {
    res.status(404).json({ error: 'ไม่พบคำขอ' });
    return;
  }
  if (request.status !== 'pending_admin') {
    res.status(409).json({ error: 'คำขอนี้ไม่อยู่ในสถานะรอ admin ยืนยัน' });
    return;
  }
  const decision = req.body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    res.status(400).json({ error: 'decision ต้องเป็น approved หรือ rejected' });
    return;
  }
  await decideAdmin(id, decision, req.body?.comment || null);
  await logAudit(req, { action: 'correction_request.admin_decision', targetTable: 'attendance_correction_requests', targetId: id, after: { decision } });
  res.json(await getRequest(id));
}));

export default router;
