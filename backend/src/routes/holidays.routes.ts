import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { listHolidays, createHoliday, updateHoliday, deleteHoliday, getHoliday } from '../services/holidays.service';

const router = Router();

// `existing` supplies whichever of holiday_date/name the caller omits, so a
// PUT can change just one of them without resending the Thai name.
function parseHolidayBody(body: any, existing?: { holiday_date: string; name: string }): { holidayDate: string; name: string } | null {
  const holidayDate = typeof body?.holiday_date === 'string' ? body.holiday_date.trim() : (body?.holiday_date === undefined ? existing?.holiday_date ?? '' : '');
  const name = typeof body?.name === 'string' ? body.name.trim() : (body?.name === undefined ? existing?.name ?? '' : '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(holidayDate) || !name) return null;
  return { holidayDate, name };
}

// Listing is allowed for any logged-in user (dashboard/reports need it to
// explain why a day has no data); mutations require admin.
router.get('/', verifyJWT, asyncHandler(async (req, res) => {
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json(await listHolidays(year));
}));

router.post('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const parsed = parseHolidayBody(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'กรุณากรอกวันที่ (YYYY-MM-DD) และชื่อวันหยุดให้ถูกต้อง' });
    return;
  }
  try {
    const id = await createHoliday(parsed.holidayDate, parsed.name);
    res.status(201).json({ id, holiday_date: parsed.holidayDate, name: parsed.name });
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'มีวันหยุดของวันนี้อยู่แล้ว' });
      return;
    }
    throw err;
  }
}));

router.put('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const existing = await getHoliday(Number(req.params.id));
  if (!existing) {
    res.status(404).json({ error: 'ไม่พบวันหยุด' });
    return;
  }
  const parsed = parseHolidayBody(req.body, existing);
  if (!parsed) {
    res.status(400).json({ error: 'กรุณากรอกวันที่ (YYYY-MM-DD) และชื่อวันหยุดให้ถูกต้อง' });
    return;
  }
  try {
    await updateHoliday(Number(req.params.id), parsed.holidayDate, parsed.name);
    res.json({ id: Number(req.params.id), holiday_date: parsed.holidayDate, name: parsed.name });
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'มีวันหยุดของวันนี้อยู่แล้ว' });
      return;
    }
    throw err;
  }
}));

router.delete('/:id', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  await deleteHoliday(Number(req.params.id));
  res.json({ ok: true });
}));

export default router;
