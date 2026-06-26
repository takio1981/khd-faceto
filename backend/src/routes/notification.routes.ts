import { Router } from 'express';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { getNotificationSettings, saveNotificationSettings, sendTestMessage } from '../services/notification.service';

const router = Router();

router.get('/', verifyJWT, requireRole('admin'), asyncHandler(async (_req, res) => {
  res.json(await getNotificationSettings());
}));

router.put('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const s = req.body;
  if (!s || typeof s !== 'object' || !s.email || !s.line || !s.telegram || !s.local || !s.admin || !s.events) {
    res.status(400).json({ error: 'รูปแบบการตั้งค่าไม่ถูกต้อง' });
    return;
  }
  await saveNotificationSettings(s);
  res.json({ ok: true });
}));

router.post('/test', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const { channel, target } = req.body ?? {};
  if (!['email', 'line', 'telegram', 'local'].includes(channel)) {
    res.status(400).json({ error: 'channel ไม่ถูกต้อง' });
    return;
  }
  if (channel !== 'local' && !target) {
    res.status(400).json({ error: 'กรุณากรอกปลายทางสำหรับทดสอบ' });
    return;
  }
  try {
    await sendTestMessage(channel, target || '');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'ส่งข้อความทดสอบไม่สำเร็จ' });
  }
}));

// Polled by the dashboard for the "local notify" channel (admin only).
router.get('/recent', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const sinceId = parseInt(String(req.query.sinceId || '0'), 10) || 0;
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, event_type, title, body, created_at FROM notification_inbox WHERE id > ? ORDER BY id ASC LIMIT 50',
    [sinceId]
  );
  res.json(rows);
}));

export default router;
