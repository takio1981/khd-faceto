import { Router } from 'express';
import path from 'path';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import {
  getNotificationSettings, saveNotificationSettings, sendTestMessage,
  listMyNotifications, setNotificationRead, setAllNotificationsRead, deleteMyNotification,
  inlineImage,
} from '../services/notification.service';
import { verifyImageToken } from '../utils/imageToken';
import { logAudit } from '../services/audit.service';

const router = Router();

// GET /api/notifications/image/:token  - public, deliberately unauthenticated.
// Exists only so LINE's Messaging API (which fetches image URLs itself, with
// no support for auth headers) can display a scan photo — see
// backend/src/utils/imageToken.ts. The token is a short-lived (~15 min),
// HMAC-signed, single-purpose URL bound to one image path; it is NOT a
// general-purpose public image gallery. Every other place this app exposes
// face images (attendance records, notification history, admin feed) stays
// behind verifyJWT as before.
router.get('/image/:token', asyncHandler(async (req, res) => {
  const imagePath = verifyImageToken(req.params.token);
  if (!imagePath) {
    res.status(404).end();
    return;
  }
  const abs = path.join(config.face.imageDir, imagePath);
  if (!abs.startsWith(path.resolve(config.face.imageDir))) {
    res.status(404).end();
    return;
  }
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}));

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
  // Don't store the payload — it contains SMTP/LINE/Telegram credentials,
  // which have no business being duplicated in plaintext in the audit log.
  await logAudit(req, { action: 'notification_settings.update', targetTable: 'app_settings' });
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
    'SELECT id, event_type, title, body, image_path, created_at FROM notification_inbox WHERE id > ? ORDER BY id ASC LIMIT 50',
    [sinceId]
  );
  const data = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      event_type: r.event_type,
      title: r.title,
      body: r.body,
      created_at: r.created_at,
      image_base64: await inlineImage(r.image_path),
    }))
  );
  res.json(data);
}));

// ---- Personal notification history (any logged-in employee, not admin-only) ----

router.get('/my', verifyJWT, asyncHandler(async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    res.json({ data: [], total: 0, page: 1, pageSize: 20, unreadCount: 0 });
    return;
  }
  const { eventType, isRead, dateFrom, dateTo } = req.query;
  const result = await listMyNotifications(employeeId, {
    eventType: eventType as any,
    isRead: isRead as any,
    dateFrom: dateFrom ? String(dateFrom) : undefined,
    dateTo: dateTo ? String(dateTo) : undefined,
    page: parseInt(String(req.query.page || '1'), 10),
    pageSize: parseInt(String(req.query.pageSize || '20'), 10),
  });
  res.json(result);
}));

router.put('/my/:id/read', verifyJWT, asyncHandler(async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    res.status(403).json({ error: 'บัญชีนี้ไม่ได้ผูกกับพนักงาน' });
    return;
  }
  const isRead = req.body?.isRead !== false;
  const ok = await setNotificationRead(employeeId, Number(req.params.id), isRead);
  if (!ok) {
    res.status(404).json({ error: 'ไม่พบการแจ้งเตือนนี้' });
    return;
  }
  res.json({ ok: true });
}));

router.put('/my/read-all', verifyJWT, asyncHandler(async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    res.status(403).json({ error: 'บัญชีนี้ไม่ได้ผูกกับพนักงาน' });
    return;
  }
  await setAllNotificationsRead(employeeId);
  res.json({ ok: true });
}));

router.delete('/my/:id', verifyJWT, asyncHandler(async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) {
    res.status(403).json({ error: 'บัญชีนี้ไม่ได้ผูกกับพนักงาน' });
    return;
  }
  const ok = await deleteMyNotification(employeeId, Number(req.params.id));
  if (!ok) {
    res.status(404).json({ error: 'ไม่พบการแจ้งเตือนนี้' });
    return;
  }
  res.json({ ok: true });
}));

export default router;
