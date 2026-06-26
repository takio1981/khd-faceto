import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT } from '../middleware/auth';
import { fetchReportRows, buildExcel, buildPdf, ReportType } from '../services/report.service';

const router = Router();

// Non-admins may only pull their own records; force the employeeId filter.
function scopedQuery(req: any): any {
  const q = { ...req.query };
  if (req.user.role !== 'admin') {
    q.employeeId = req.user.employeeId ?? -1;
  }
  return q;
}

// JSON data endpoints (used by the on-screen report preview)
router.get('/daily', verifyJWT, asyncHandler(async (req, res) => {
  const { rows, title } = await fetchReportRows('daily', scopedQuery(req));
  res.json({ title, rows });
}));

router.get('/monthly', verifyJWT, asyncHandler(async (req, res) => {
  const { rows, title } = await fetchReportRows('monthly', scopedQuery(req));
  res.json({ title, rows });
}));

router.get('/yearly', verifyJWT, asyncHandler(async (req, res) => {
  const { rows, title } = await fetchReportRows('yearly', scopedQuery(req));
  res.json({ title, rows });
}));

// GET /api/reports/export?type=daily|monthly|yearly&format=xlsx|pdf&...
router.get('/export', verifyJWT, asyncHandler(async (req, res) => {
  const type = String(req.query.type || 'daily') as ReportType;
  const format = String(req.query.format || 'xlsx');
  if (!['daily', 'monthly', 'yearly'].includes(type)) {
    res.status(400).json({ error: 'type ไม่ถูกต้อง' });
    return;
  }

  const { rows, title } = await fetchReportRows(type, scopedQuery(req));

  if (format === 'pdf') {
    buildPdf(res, type, rows, title);
  } else {
    await buildExcel(res, type, rows, title);
  }
}));

export default router;
