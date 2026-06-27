import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { listAuditLog } from '../services/audit.service';

const router = Router();

// GET /api/audit-log?page=&pageSize=&action=&username=&dateFrom=&dateTo=
router.get('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10)));
  const result = await listAuditLog({
    page,
    pageSize,
    action: req.query.action ? String(req.query.action) : undefined,
    username: req.query.username ? String(req.query.username) : undefined,
    dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
    dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
  });
  res.json(result);
}));

export default router;
