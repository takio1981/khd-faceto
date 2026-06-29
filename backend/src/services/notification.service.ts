import fs from 'fs/promises';
import path from 'path';
import nodemailer from 'nodemailer';
import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { config } from '../config';
import { ictDateKey, ictSecondsSinceMidnight, isWeekendDateKey } from '../utils/ict';
import { isHoliday } from './holidays.service';

export type NotifyEventType = 'late' | 'absent' | 'success' | 'unknown_face';

export interface NotificationSettings {
  email: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  line: {
    enabled: boolean;
    channelAccessToken: string;
  };
  telegram: {
    enabled: boolean;
    botToken: string;
  };
  local: {
    enabled: boolean;
  };
  admin: {
    emails: string;       // comma-separated
    lineUserId: string;
    telegramChatId: string;
  };
  events: {
    late: { employee: boolean; admin: boolean; supervisor: boolean };
    absent: { employee: boolean; admin: boolean; supervisor: boolean };
    success: { employee: boolean; admin: boolean; supervisor: boolean };
    // Admin-only by nature — there's no matched employee to notify or to
    // resolve a supervisor from when a scanned face doesn't match anyone.
    unknownFace: { admin: boolean };
  };
}

const DEFAULT_SETTINGS: NotificationSettings = {
  email: { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '' },
  line: { enabled: false, channelAccessToken: '' },
  telegram: { enabled: false, botToken: '' },
  local: { enabled: false },
  admin: { emails: '', lineUserId: '', telegramChatId: '' },
  events: {
    late: { employee: true, admin: true, supervisor: false },
    absent: { employee: false, admin: true, supervisor: false },
    success: { employee: true, admin: false, supervisor: false },
    unknownFace: { admin: true },
  },
};

const SETTINGS_KEY = 'notification_settings';

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    [SETTINGS_KEY]
  );
  if (!rows.length) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(rows[0].setting_value);
    // Shallow-merge over defaults so newly added fields don't crash old saved configs.
    return {
      email: { ...DEFAULT_SETTINGS.email, ...parsed.email },
      line: { ...DEFAULT_SETTINGS.line, ...parsed.line },
      telegram: { ...DEFAULT_SETTINGS.telegram, ...parsed.telegram },
      local: { ...DEFAULT_SETTINGS.local, ...parsed.local },
      admin: { ...DEFAULT_SETTINGS.admin, ...parsed.admin },
      events: {
        late: { ...DEFAULT_SETTINGS.events.late, ...parsed.events?.late },
        absent: { ...DEFAULT_SETTINGS.events.absent, ...parsed.events?.absent },
        success: { ...DEFAULT_SETTINGS.events.success, ...parsed.events?.success },
        unknownFace: { ...DEFAULT_SETTINGS.events.unknownFace, ...parsed.events?.unknownFace },
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = ?`,
    [SETTINGS_KEY, JSON.stringify(settings), JSON.stringify(settings)]
  );
}

// ---- Channel senders -------------------------------------------------------

// `imagePath` is relative to config.face.imageDir (same scheme as
// attendance_records.face_image_path) — resolved and attached directly, no
// public URL needed (unlike LINE's image message type, see sendLine below).
async function sendEmail(
  settings: NotificationSettings,
  to: string,
  subject: string,
  text: string,
  imagePath?: string | null
): Promise<void> {
  if (!settings.email.enabled || !to) return;
  const transporter = nodemailer.createTransport({
    host: settings.email.host,
    port: settings.email.port,
    secure: settings.email.secure,
    auth: settings.email.user ? { user: settings.email.user, pass: settings.email.pass } : undefined,
  });
  const attachments = imagePath
    ? [{ filename: 'scan.jpg', path: path.join(config.face.imageDir, imagePath) }]
    : undefined;
  await transporter.sendMail({ from: settings.email.from || settings.email.user, to, subject, text, attachments });
}

// Text-only, deliberately: LINE's image message type requires
// originalContentUrl/previewImageUrl to be publicly fetchable HTTPS URLs
// (LINE's own servers fetch them, no auth header support) — exposing face
// photos at an unauthenticated URL just so LINE can read them would undercut
// every other PDPA-conscious access control this app has for biometric
// images. Email/Telegram below support attaching the image directly
// (upload, not a fetched URL), so they're the channels that actually carry it.
async function sendLine(settings: NotificationSettings, userId: string, text: string): Promise<void> {
  if (!settings.line.enabled || !userId || !settings.line.channelAccessToken) return;
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.line.channelAccessToken}`,
    },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) throw new Error(`LINE API error: ${res.status} ${await res.text()}`);
}

async function sendTelegram(
  settings: NotificationSettings,
  chatId: string,
  text: string,
  imagePath?: string | null
): Promise<void> {
  if (!settings.telegram.enabled || !chatId || !settings.telegram.botToken) return;
  if (imagePath) {
    // sendPhoto takes the image as a direct multipart upload — no public URL
    // needed (unlike LINE's image message type above).
    try {
      const buffer = await fs.readFile(path.join(config.face.imageDir, imagePath));
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', text);
      form.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'scan.jpg');
      const res = await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(`Telegram API error: ${res.status} ${await res.text()}`);
      return;
    } catch (err) {
      console.error('[notification] telegram sendPhoto failed, falling back to text:', err);
      // fall through to plain text below
    }
  }
  const res = await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram API error: ${res.status} ${await res.text()}`);
}

async function pushLocal(
  settings: NotificationSettings,
  title: string,
  body: string,
  eventType: NotifyEventType,
  employeeId: number | null = null,
  imagePath: string | null = null
): Promise<void> {
  if (!settings.local.enabled) return;
  await pool.query<ResultSetHeader>(
    'INSERT INTO notification_inbox (employee_id, event_type, title, body, image_path) VALUES (?, ?, ?, ?, ?)',
    [employeeId, eventType, title, body, imagePath]
  );
  // Keep the inbox from growing forever. Raised from 200 once this table
  // started doubling as each employee's personal notification history (not
  // just the admin-facing feed) — 200 system-wide would only leave a
  // handful of rows per employee in a multi-employee office.
  await pool.query(
    `DELETE FROM notification_inbox WHERE id NOT IN
       (SELECT id FROM (SELECT id FROM notification_inbox ORDER BY id DESC LIMIT 2000) t)`
  );
}

// ---- Test send (settings page "ทดสอบส่ง" buttons) -------------------------

export async function sendTestMessage(
  channel: 'email' | 'line' | 'telegram' | 'local',
  target: string
): Promise<void> {
  const settings = await getNotificationSettings();
  const title = 'ทดสอบการแจ้งเตือน';
  const text = 'นี่คือข้อความทดสอบจากระบบลงเวลา KHD FaceTo';
  if (channel === 'email') await sendEmail(settings, target, title, text);
  else if (channel === 'line') await sendLine(settings, target, text);
  else if (channel === 'telegram') await sendTelegram(settings, target, text);
  else if (channel === 'local') await pushLocal(settings, title, text, 'success');
}

// ---- Event dispatch ---------------------------------------------------------

interface NotifyEmployee {
  id: number;
  employee_code: string;
  full_name: string;
  notify_email: string | null;
  notify_line_user_id: string | null;
  notify_telegram_chat_id: string | null;
  notify_enabled: number;
  supervisor_id: number | null;
}

const EVENT_LABEL: Record<NotifyEventType, string> = {
  late: 'มาสาย',
  absent: 'ขาดงาน',
  success: 'ลงเวลาสำเร็จ',
  unknown_face: 'ใบหน้าที่ไม่รู้จัก',
};

export interface DispatchDetail {
  imagePath?: string | null;
  scanLocationName?: string | null;
  scanTime?: Date;
}

// Builds the "รายละเอียดข้อมูลสำคัญ" line — scan location + exact time when
// known — appended under the base message so every channel carries the full
// context, not just the bare status text.
function formatDetailLine(detail?: DispatchDetail): string {
  if (!detail) return '';
  const parts: string[] = [];
  if (detail.scanTime) {
    parts.push(`เวลา ${detail.scanTime.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
  }
  if (detail.scanLocationName) parts.push(`จุดสแกน: ${detail.scanLocationName}`);
  return parts.length ? `\n${parts.join(' | ')}` : '';
}

async function dispatch(
  eventType: 'late' | 'absent' | 'success',
  employee: NotifyEmployee,
  message: string,
  detail?: DispatchDetail
): Promise<void> {
  const settings = await getNotificationSettings();
  const evt = settings.events[eventType];
  const title = `[${EVENT_LABEL[eventType]}] ${employee.full_name}`;
  const body = `${employee.employee_code} - ${employee.full_name}: ${message}${formatDetailLine(detail)}`;
  const imagePath = detail?.imagePath ?? null;

  const jobs: Promise<void>[] = [];

  if (evt.employee && employee.notify_enabled) {
    if (employee.notify_email) jobs.push(sendEmail(settings, employee.notify_email, title, body, imagePath));
    if (employee.notify_line_user_id) jobs.push(sendLine(settings, employee.notify_line_user_id, body));
    if (employee.notify_telegram_chat_id) jobs.push(sendTelegram(settings, employee.notify_telegram_chat_id, body, imagePath));
  }
  if (evt.admin) {
    for (const email of settings.admin.emails.split(',').map((s) => s.trim()).filter(Boolean)) {
      jobs.push(sendEmail(settings, email, title, body, imagePath));
    }
    if (settings.admin.lineUserId) jobs.push(sendLine(settings, settings.admin.lineUserId, body));
    if (settings.admin.telegramChatId) jobs.push(sendTelegram(settings, settings.admin.telegramChatId, body, imagePath));
  }
  if (evt.supervisor && employee.supervisor_id) {
    const supervisor = await loadNotifyEmployee(employee.supervisor_id);
    if (supervisor && supervisor.notify_enabled) {
      const supTitle = `[${EVENT_LABEL[eventType]}] ทีมงาน: ${employee.full_name}`;
      const supBody = `แจ้งเตือนสำหรับหัวหน้างาน — ${body}`;
      if (supervisor.notify_email) jobs.push(sendEmail(settings, supervisor.notify_email, supTitle, supBody, imagePath));
      if (supervisor.notify_line_user_id) jobs.push(sendLine(settings, supervisor.notify_line_user_id, supBody));
      if (supervisor.notify_telegram_chat_id) jobs.push(sendTelegram(settings, supervisor.notify_telegram_chat_id, supBody, imagePath));
      jobs.push(pushLocal(settings, supTitle, supBody, eventType, supervisor.id, imagePath));
    }
  }
  if (evt.employee || evt.admin) jobs.push(pushLocal(settings, title, body, eventType, employee.id, imagePath));

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[notification] send failed:', r.reason);
  }
}

// Admin-only events (currently just unknown_face) have no employee/
// supervisor target to resolve — separate, simpler dispatch path.
async function dispatchAdminOnly(eventType: NotifyEventType, title: string, body: string, imagePath: string | null): Promise<void> {
  const settings = await getNotificationSettings();
  const evt = settings.events.unknownFace; // only admin-only event type today
  if (!evt.admin) return;

  const jobs: Promise<void>[] = [];
  for (const email of settings.admin.emails.split(',').map((s) => s.trim()).filter(Boolean)) {
    jobs.push(sendEmail(settings, email, title, body, imagePath));
  }
  if (settings.admin.lineUserId) jobs.push(sendLine(settings, settings.admin.lineUserId, body));
  if (settings.admin.telegramChatId) jobs.push(sendTelegram(settings, settings.admin.telegramChatId, body, imagePath));
  jobs.push(pushLocal(settings, title, body, eventType, null, imagePath));

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[notification] send failed:', r.reason);
  }
}

async function loadNotifyEmployee(employeeId: number): Promise<NotifyEmployee | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, notify_email, notify_line_user_id, notify_telegram_chat_id, notify_enabled, supervisor_id
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  return rows.length ? (rows[0] as NotifyEmployee) : null;
}

// Called after a scan is recorded — fires 'success' always, and 'late' when
// the classification status came back late. Fire-and-forget: errors are
// logged but never bubble up to the scan response (a broken SMTP config
// should not block the kiosk from recording attendance).
export function notifyScan(employeeId: number, status: string, message: string, detail?: DispatchDetail): void {
  loadNotifyEmployee(employeeId)
    .then(async (employee) => {
      if (!employee) return;
      await dispatch('success', employee, message, detail);
      if (status === 'late') await dispatch('late', employee, message, detail);
    })
    .catch((err) => console.error('[notification] notifyScan failed:', err));
}

// Called from POST /attendance/unknown-face after a debounced preview result
// (see shift.service.ts shouldAlertUnknownFace) — a face that doesn't match
// any enrolled employee. Admin-only by nature: there's no employee to notify
// or to resolve a supervisor from.
export function notifyUnknownFace(imagePath: string | null, scanLocationName: string | null, scanTime: Date): void {
  const title = 'พบใบหน้าที่ไม่รู้จัก';
  const body = `ตรวจพบความพยายามสแกนใบหน้าที่ไม่ตรงกับพนักงานคนใด${formatDetailLine({ scanLocationName, scanTime })}`;
  dispatchAdminOnly('unknown_face', title, body, imagePath).catch((err) =>
    console.error('[notification] notifyUnknownFace failed:', err)
  );
}

// ---- Absent check (scheduled) ----------------------------------------------
// Runs every minute; for each shift, once "now" has passed that shift's
// checkout_end (i.e. the day's attendance window is fully closed), flags any
// active employee on that shift who never checked in today. Each employee is
// only notified once per calendar day (enforced by the PRIMARY KEY on
// notification_absent_log).
async function runAbsentCheck(): Promise<void> {
  const now = new Date();
  const today = ictDateKey(now);

  // Nobody is expected to check in on a weekend or declared holiday — skip
  // the whole check rather than flagging the entire active staff as absent.
  if (isWeekendDateKey(today) || (await isHoliday(today))) return;

  const nowSec = ictSecondsSinceMidnight(now);
  const [shifts] = await pool.query<RowDataPacket[]>('SELECT id, checkout_end FROM shifts');
  for (const shift of shifts) {
    const [h, m, s] = String(shift.checkout_end).split(':').map(Number);
    const cutoffSec = h * 3600 + m * 60 + (s || 0);
    if (nowSec < cutoffSec) continue; // checkout window for this shift hasn't ended yet

    const [absentees] = await pool.query<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.notify_email, e.notify_line_user_id,
              e.notify_telegram_chat_id, e.notify_enabled, e.supervisor_id
         FROM employees e
        WHERE e.shift_id = ? AND e.is_active = 1
          AND NOT EXISTS (
            SELECT 1 FROM attendance_records ar
             WHERE ar.employee_id = e.id AND ar.scan_type = 'check_in' AND DATE(ar.scan_time) = ?
          )`,
      [shift.id, today]
    );

    for (const emp of absentees) {
      try {
        await pool.query<ResultSetHeader>(
          'INSERT INTO notification_absent_log (employee_id, notify_date) VALUES (?, ?)',
          [emp.id, today]
        );
      } catch (err: any) {
        if (err && err.code === 'ER_DUP_ENTRY') continue; // already notified today
        throw err;
      }
      await dispatch('absent', emp as NotifyEmployee, 'ไม่พบการลงเวลาเข้างานวันนี้').catch((err) =>
        console.error('[notification] absent dispatch failed:', err)
      );
    }
  }
}

export function startAbsentCheckScheduler(): void {
  setInterval(() => {
    runAbsentCheck().catch((err) => console.error('[notification] absent check failed:', err));
  }, 60_000);
}

// ---- Per-employee notification history (personal "ประวัติการแจ้งเตือน") ----

export interface NotificationHistoryItem {
  id: number;
  event_type: NotifyEventType;
  title: string;
  body: string;
  is_read: 0 | 1;
  created_at: string;
  image_base64?: string | null;
}

// Inlines the saved scan image as a data URI, same pattern as
// GET /api/attendance/recent — authenticated callers only (this is always
// reached via verifyJWT-protected routes), so unlike the LINE-image
// limitation above there's no PDPA concern serving it this way.
export async function inlineImage(imagePath: string | null | undefined): Promise<string | null> {
  if (!imagePath) return null;
  try {
    const abs = path.join(config.face.imageDir, imagePath);
    if (!abs.startsWith(path.resolve(config.face.imageDir))) return null; // path traversal guard
    const buf = await fs.readFile(abs);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null; // image missing on disk — just omit the thumbnail
  }
}

export interface NotificationHistoryFilter {
  eventType?: NotifyEventType;
  isRead?: '0' | '1';
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listMyNotifications(
  employeeId: number,
  filter: NotificationHistoryFilter
): Promise<{ data: NotificationHistoryItem[]; total: number; page: number; pageSize: number; unreadCount: number }> {
  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const where: string[] = ['employee_id = ?'];
  const params: any[] = [employeeId];
  if (filter.eventType) { where.push('event_type = ?'); params.push(filter.eventType); }
  if (filter.isRead === '0' || filter.isRead === '1') { where.push('is_read = ?'); params.push(filter.isRead); }
  if (filter.dateFrom) { where.push('DATE(created_at) >= ?'); params.push(filter.dateFrom); }
  if (filter.dateTo) { where.push('DATE(created_at) <= ?'); params.push(filter.dateTo); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM notification_inbox ${whereSql}`,
    params
  );
  const [unreadRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS unread FROM notification_inbox WHERE employee_id = ? AND is_read = 0`,
    [employeeId]
  );
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, event_type, title, body, image_path, is_read, created_at FROM notification_inbox
       ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const data = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      event_type: r.event_type,
      title: r.title,
      body: r.body,
      is_read: r.is_read,
      created_at: r.created_at,
      image_base64: await inlineImage(r.image_path),
    }))
  );

  return {
    data: data as NotificationHistoryItem[],
    total: countRows[0].total as number,
    page,
    pageSize,
    unreadCount: unreadRows[0].unread as number,
  };
}

export async function setNotificationRead(employeeId: number, id: number, isRead: boolean): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    'UPDATE notification_inbox SET is_read = ? WHERE id = ? AND employee_id = ?',
    [isRead ? 1 : 0, id, employeeId]
  );
  return result.affectedRows > 0;
}

export async function setAllNotificationsRead(employeeId: number): Promise<void> {
  await pool.query('UPDATE notification_inbox SET is_read = 1 WHERE employee_id = ? AND is_read = 0', [employeeId]);
}

export async function deleteMyNotification(employeeId: number, id: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    'DELETE FROM notification_inbox WHERE id = ? AND employee_id = ?',
    [id, employeeId]
  );
  return result.affectedRows > 0;
}
