import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { User, UserPin } from '../types';
import { getLoginSettings } from './settings.service';
import { parseDeviceLabel } from './device.service';
import { PinNotConfiguredError, PinAlreadyConfiguredError, PinIncorrectError, PinLockedError } from './pinErrors';

// A precomputed bcrypt hash of a value that is never a valid PIN, compared
// against on every "no such user"/"no PIN configured" path so those cases
// take the same amount of time as a real wrong-PIN compare — otherwise the
// missing bcrypt.compare() call would be a timing side-channel that lets an
// attacker distinguish "unknown username" from "wrong PIN" by latency alone.
const DUMMY_HASH = bcrypt.hashSync('khd-faceto-dummy-pin-compare', 10);

export interface PinStatus {
  configured: boolean;
  deviceCount: number;
}

export async function getPinStatus(userId: number): Promise<PinStatus> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT up.id, (SELECT COUNT(*) FROM user_pin_devices d WHERE d.user_pin_id = up.id) AS device_count
       FROM user_pin up WHERE up.user_id = ? LIMIT 1`,
    [userId]
  );
  if (!rows.length) return { configured: false, deviceCount: 0 };
  return { configured: true, deviceCount: Number(rows[0].device_count) || 0 };
}

// Creates a user's first PIN and registers the current device in a single
// transaction — if either insert fails, both roll back. Throws
// PinAlreadyConfiguredError if a PIN already exists (use changePin/resetPin).
export async function createPin(
  userId: number,
  pin: string,
  deviceId: string,
  userAgent: string | null
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query<RowDataPacket[]>(
      'SELECT id FROM user_pin WHERE user_id = ? LIMIT 1',
      [userId]
    );
    if (existing.length) throw new PinAlreadyConfiguredError();

    const hash = await bcrypt.hash(pin, 10);
    const [result] = await conn.query<ResultSetHeader>(
      'INSERT INTO user_pin (user_id, pin_hash) VALUES (?, ?)',
      [userId, hash]
    );
    await conn.query(
      'INSERT INTO user_pin_devices (user_pin_id, device_id, device_label) VALUES (?, ?, ?)',
      [result.insertId, deviceId, parseDeviceLabel(userAgent)]
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

export type PinLoginResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'generic' }
  | { ok: false; reason: 'locked'; lockedUntil: Date; justLocked: boolean }
  | { ok: false; reason: 'device_not_registered' };

export async function verifyPinLogin(username: string, pin: string, deviceId: string): Promise<PinLoginResult> {
  const [userRows] = await pool.query<RowDataPacket[]>('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  const user = userRows[0] as User | undefined;
  if (!user) {
    await bcrypt.compare(pin, DUMMY_HASH);
    return { ok: false, reason: 'generic' };
  }

  const [pinRows] = await pool.query<RowDataPacket[]>('SELECT * FROM user_pin WHERE user_id = ? LIMIT 1', [user.id]);
  const userPin = pinRows[0] as UserPin | undefined;
  if (!userPin) {
    await bcrypt.compare(pin, DUMMY_HASH);
    return { ok: false, reason: 'generic' };
  }

  if (userPin.locked_until && new Date(userPin.locked_until).getTime() > Date.now()) {
    return { ok: false, reason: 'locked', lockedUntil: new Date(userPin.locked_until), justLocked: false };
  }

  const ok = await bcrypt.compare(pin, userPin.pin_hash);
  if (!ok) {
    const { pinMaxAttempts, pinLockoutMinutes } = await getLoginSettings();
    const attempts = userPin.failed_pin_attempts + 1;
    if (attempts >= pinMaxAttempts) {
      const lockedUntil = new Date(Date.now() + pinLockoutMinutes * 60_000);
      await pool.query('UPDATE user_pin SET failed_pin_attempts = 0, locked_until = ? WHERE id = ?', [
        lockedUntil,
        userPin.id,
      ]);
      return { ok: false, reason: 'locked', lockedUntil, justLocked: true };
    }
    await pool.query('UPDATE user_pin SET failed_pin_attempts = ? WHERE id = ?', [attempts, userPin.id]);
    return { ok: false, reason: 'generic' };
  }

  await pool.query('UPDATE user_pin SET failed_pin_attempts = 0, locked_until = NULL WHERE id = ?', [userPin.id]);

  const [deviceRows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM user_pin_devices WHERE user_pin_id = ? AND device_id = ? LIMIT 1',
    [userPin.id, deviceId]
  );
  if (!deviceRows.length) {
    return { ok: false, reason: 'device_not_registered' };
  }

  await pool.query('UPDATE user_pin_devices SET last_login_at = NOW() WHERE id = ?', [deviceRows[0].id]);
  return { ok: true, user };
}

// Requires the caller to already know the current PIN (self-service change,
// while logged in) — subject to the same lock/attempt-counter rules as login,
// since it's still an online PIN-guessing surface.
export async function changePin(userId: number, currentPin: string, newPin: string): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM user_pin WHERE user_id = ? LIMIT 1', [userId]);
  const row = rows[0] as UserPin | undefined;
  if (!row) throw new PinNotConfiguredError();

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new PinLockedError(new Date(row.locked_until));
  }

  const ok = await bcrypt.compare(currentPin, row.pin_hash);
  if (!ok) {
    const { pinMaxAttempts, pinLockoutMinutes } = await getLoginSettings();
    const attempts = row.failed_pin_attempts + 1;
    if (attempts >= pinMaxAttempts) {
      const lockedUntil = new Date(Date.now() + pinLockoutMinutes * 60_000);
      await pool.query('UPDATE user_pin SET failed_pin_attempts = 0, locked_until = ? WHERE id = ?', [
        lockedUntil,
        row.id,
      ]);
      throw new PinLockedError(lockedUntil);
    }
    await pool.query('UPDATE user_pin SET failed_pin_attempts = ? WHERE id = ?', [attempts, row.id]);
    throw new PinIncorrectError();
  }

  const hash = await bcrypt.hash(newPin, 10);
  await pool.query('UPDATE user_pin SET pin_hash = ?, failed_pin_attempts = 0, locked_until = NULL WHERE id = ?', [
    hash,
    row.id,
  ]);
}

// Re-authentication (password, checked by the route before calling this) is
// the only way in — never the old PIN, so a stolen/guessed PIN can't be used
// to mint a fresh one. Devices are intentionally left untouched (rule: PIN
// reset does not deregister existing devices). Works whether or not a PIN
// already existed (first-time setup via "forgot PIN" or a genuine reset).
// Admin-only: wipes a user's PIN entirely (CASCADE also removes their
// devices) — the user's next password login re-triggers first-time setup.
export async function forceResetPin(userId: number): Promise<void> {
  await pool.query('DELETE FROM user_pin WHERE user_id = ?', [userId]);
}

export async function resetPin(userId: number, newPin: string): Promise<void> {
  const hash = await bcrypt.hash(newPin, 10);
  await pool.query(
    `INSERT INTO user_pin (user_id, pin_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE pin_hash = ?, failed_pin_attempts = 0, locked_until = NULL`,
    [userId, hash, hash]
  );
}
