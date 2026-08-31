import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { UserPinDevice } from '../types';
import { PinNotConfiguredError, DeviceLimitReachedError } from './pinErrors';

const MAX_DEVICES_PER_PIN = 2;

// Small hand-rolled "Chrome / Windows" heuristic — no UA-parsing dependency,
// matching this project's low-dependency style (self-signed certs, JPEG
// thumbnails etc. are already hand-rolled rather than pulled from npm).
export function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'อุปกรณ์ไม่ทราบชนิด';
  const ua = userAgent;
  let browser = 'เบราว์เซอร์';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/safari\//i.test(ua)) browser = 'Safari';

  let os = 'ไม่ทราบระบบปฏิบัติการ';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS';
  else if (/mac os/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return `${browser} / ${os}`;
}

async function getUserPinId(userId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id FROM user_pin WHERE user_id = ? LIMIT 1', [userId]);
  return rows.length ? rows[0].id : null;
}

// Concurrency-safe device registration: `SELECT ... FOR UPDATE` on the
// parent user_pin row serializes concurrent registrations for the same
// user (a second transaction blocks until the first commits/rolls back),
// so two simultaneous "register device" requests can never both slip past
// the 2-device count check.
export async function registerDevice(userId: number, deviceId: string, userAgent: string | null): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [pinRows] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM user_pin WHERE user_id = ? FOR UPDATE',
      [userId]
    );
    if (!pinRows.length) throw new PinNotConfiguredError();
    const userPinId = pinRows[0].id;

    const [existing] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM user_pin_devices WHERE user_pin_id = ? AND device_id = ? LIMIT 1',
      [userPinId, deviceId]
    );
    if (existing.length) {
      await conn.commit();
      return existing[0].id; // idempotent re-register of an already-known device
    }

    const [countRows] = await conn.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS c FROM user_pin_devices WHERE user_pin_id = ?',
      [userPinId]
    );
    if (countRows[0].c >= MAX_DEVICES_PER_PIN) {
      await conn.rollback();
      throw new DeviceLimitReachedError();
    }

    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO user_pin_devices (user_pin_id, device_id, device_label) VALUES (?, ?, ?)',
      [userPinId, deviceId, parseDeviceLabel(userAgent)]
    );
    await conn.commit();
    return result.insertId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function listDevices(userId: number): Promise<UserPinDevice[]> {
  const userPinId = await getUserPinId(userId);
  if (!userPinId) return [];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_pin_id, device_id, device_label, last_login_at, created_at
       FROM user_pin_devices WHERE user_pin_id = ? ORDER BY created_at ASC`,
    [userPinId]
  );
  return rows as UserPinDevice[];
}

// Ownership check is baked into the DELETE's own WHERE/JOIN rather than a
// separate SELECT-then-DELETE — closes any IDOR gap between the two steps.
export async function removeDevice(userId: number, deviceRowId: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE d FROM user_pin_devices d
       JOIN user_pin p ON p.id = d.user_pin_id
      WHERE d.id = ? AND p.user_id = ?`,
    [deviceRowId, userId]
  );
  return result.affectedRows > 0;
}

// Admin-only: removes every device for a user's PIN without deleting the
// PIN itself (used when e.g. a phone is lost, but the user should keep
// their PIN and just re-register a new device).
export async function removeAllDevices(userId: number): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    `DELETE d FROM user_pin_devices d
       JOIN user_pin p ON p.id = d.user_pin_id
      WHERE p.user_id = ?`,
    [userId]
  );
  return result.affectedRows;
}
