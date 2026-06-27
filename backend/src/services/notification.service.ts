import nodemailer from 'nodemailer';
import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { ictDateKey, ictSecondsSinceMidnight, isWeekendDateKey } from '../utils/ict';
import { isHoliday } from './holidays.service';

export type NotifyEventType = 'late' | 'absent' | 'success';

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
    late: { employee: boolean; admin: boolean };
    absent: { employee: boolean; admin: boolean };
    success: { employee: boolean; admin: boolean };
  };
}

const DEFAULT_SETTINGS: NotificationSettings = {
  email: { enabled: false, host: '', port: 587, secure: false, user: '', pass: '', from: '' },
  line: { enabled: false, channelAccessToken: '' },
  telegram: { enabled: false, botToken: '' },
  local: { enabled: false },
  admin: { emails: '', lineUserId: '', telegramChatId: '' },
  events: {
    late: { employee: true, admin: true },
    absent: { employee: false, admin: true },
    success: { employee: true, admin: false },
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

async function sendEmail(settings: NotificationSettings, to: string, subject: string, text: string): Promise<void> {
  if (!settings.email.enabled || !to) return;
  const transporter = nodemailer.createTransport({
    host: settings.email.host,
    port: settings.email.port,
    secure: settings.email.secure,
    auth: settings.email.user ? { user: settings.email.user, pass: settings.email.pass } : undefined,
  });
  await transporter.sendMail({ from: settings.email.from || settings.email.user, to, subject, text });
}

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

async function sendTelegram(settings: NotificationSettings, chatId: string, text: string): Promise<void> {
  if (!settings.telegram.enabled || !chatId || !settings.telegram.botToken) return;
  const res = await fetch(`https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) throw new Error(`Telegram API error: ${res.status} ${await res.text()}`);
}

async function pushLocal(settings: NotificationSettings, title: string, body: string, eventType: NotifyEventType): Promise<void> {
  if (!settings.local.enabled) return;
  await pool.query<ResultSetHeader>(
    'INSERT INTO notification_inbox (event_type, title, body) VALUES (?, ?, ?)',
    [eventType, title, body]
  );
  // Keep the inbox from growing forever — only the most recent 200 entries matter.
  await pool.query(
    `DELETE FROM notification_inbox WHERE id NOT IN
       (SELECT id FROM (SELECT id FROM notification_inbox ORDER BY id DESC LIMIT 200) t)`
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
}

const EVENT_LABEL: Record<NotifyEventType, string> = {
  late: 'มาสาย',
  absent: 'ขาดงาน',
  success: 'ลงเวลาสำเร็จ',
};

async function dispatch(eventType: NotifyEventType, employee: NotifyEmployee, message: string): Promise<void> {
  const settings = await getNotificationSettings();
  const evt = settings.events[eventType];
  const title = `[${EVENT_LABEL[eventType]}] ${employee.full_name}`;
  const body = `${employee.employee_code} - ${employee.full_name}: ${message}`;

  const jobs: Promise<void>[] = [];

  if (evt.employee && employee.notify_enabled) {
    if (employee.notify_email) jobs.push(sendEmail(settings, employee.notify_email, title, body));
    if (employee.notify_line_user_id) jobs.push(sendLine(settings, employee.notify_line_user_id, body));
    if (employee.notify_telegram_chat_id) jobs.push(sendTelegram(settings, employee.notify_telegram_chat_id, body));
  }
  if (evt.admin) {
    for (const email of settings.admin.emails.split(',').map((s) => s.trim()).filter(Boolean)) {
      jobs.push(sendEmail(settings, email, title, body));
    }
    if (settings.admin.lineUserId) jobs.push(sendLine(settings, settings.admin.lineUserId, body));
    if (settings.admin.telegramChatId) jobs.push(sendTelegram(settings, settings.admin.telegramChatId, body));
  }
  if (evt.employee || evt.admin) jobs.push(pushLocal(settings, title, body, eventType));

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('[notification] send failed:', r.reason);
  }
}

async function loadNotifyEmployee(employeeId: number): Promise<NotifyEmployee | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, notify_email, notify_line_user_id, notify_telegram_chat_id, notify_enabled
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  return rows.length ? (rows[0] as NotifyEmployee) : null;
}

// Called after a scan is recorded — fires 'success' always, and 'late' when
// the classification status came back late. Fire-and-forget: errors are
// logged but never bubble up to the scan response (a broken SMTP config
// should not block the kiosk from recording attendance).
export function notifyScan(employeeId: number, status: string, message: string): void {
  loadNotifyEmployee(employeeId)
    .then(async (employee) => {
      if (!employee) return;
      await dispatch('success', employee, message);
      if (status === 'late') await dispatch('late', employee, message);
    })
    .catch((err) => console.error('[notification] notifyScan failed:', err));
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
              e.notify_telegram_chat_id, e.notify_enabled
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
