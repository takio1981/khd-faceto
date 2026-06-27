import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import {
  listScanLocations,
  createScanLocation,
  updateScanLocation,
  deleteScanLocation,
} from '../services/scanLocations.service';
import { logAudit } from '../services/audit.service';

const router = Router();

function parseLocationBody(body: any): { name: string; latitude: number; longitude: number } | null {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  if (!name) return null;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  return { name, latitude, longitude };
}

// GET /api/scan-locations - public: the login page shows these as map pins without auth
router.get('/', asyncHandler(async (_req, res) => {
  const locations = await listScanLocations();
  res.json(locations);
}));

router.post('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = parseLocationBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'กรุณากรอกชื่อจุดติดตั้งและพิกัดละติจูด/ลองจิจูดให้ถูกต้อง' });
    return;
  }
  const id = await createScanLocation(parsed.name, parsed.latitude, parsed.longitude);
  await logAudit(req, { action: 'scan_location.create', targetTable: 'scan_locations', targetId: id, after: parsed });
  res.json({ id, ...parsed });
}));

router.put('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = parseLocationBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'กรุณากรอกชื่อจุดติดตั้งและพิกัดละติจูด/ลองจิจูดให้ถูกต้อง' });
    return;
  }
  await updateScanLocation(Number(req.params.id), parsed.name, parsed.latitude, parsed.longitude);
  await logAudit(req, { action: 'scan_location.update', targetTable: 'scan_locations', targetId: Number(req.params.id), after: parsed });
  res.json({ ok: true });
}));

router.delete('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deleteScanLocation(Number(req.params.id));
  await logAudit(req, { action: 'scan_location.delete', targetTable: 'scan_locations', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

export default router;
