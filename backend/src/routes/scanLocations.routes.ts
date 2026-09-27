import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import {
  listScanLocations,
  createScanLocation,
  updateScanLocation,
  deleteScanLocation,
  getScanLocation,
} from '../services/scanLocations.service';
import { logAudit } from '../services/audit.service';

const router = Router();

// `existing` supplies whichever field the caller omits, so a PUT can move
// just the GPS pin (e.g. via the "ตำแหน่งปัจจุบัน" button) without resending
// the Thai location name, or vice versa.
function parseLocationBody(
  body: any,
  existing?: { name: string; latitude: number; longitude: number }
): { name: string; latitude: number; longitude: number } | null {
  const name = typeof body?.name === 'string' ? body.name.trim() : (body?.name === undefined ? existing?.name ?? '' : '');
  const latitude = body?.latitude === undefined ? existing?.latitude : Number(body.latitude);
  const longitude = body?.longitude === undefined ? existing?.longitude : Number(body.longitude);
  if (!name) return null;
  if (latitude === undefined || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (longitude === undefined || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
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
  const existing = await getScanLocation(Number(req.params.id));
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบจุดติดตั้ง' });
    return;
  }
  const parsed = parseLocationBody(req.body, existing);
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
