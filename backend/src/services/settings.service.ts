import { pool } from '../db';
import { RowDataPacket } from 'mysql2';

// Defaults used if a key is missing from app_settings (should not happen
// after migration 008, but keeps the app usable if the table is empty).
const DEFAULTS: Record<string, string> = {
  login_max_attempts: '5',
  login_lockout_minutes: '15',
};

export interface LoginSettings {
  loginMaxAttempts: number;
  loginLockoutMinutes: number;
}

async function getSetting(key: string): Promise<string> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  return rows.length ? String(rows[0].setting_value) : DEFAULTS[key];
}

export async function getLoginSettings(): Promise<LoginSettings> {
  const [maxAttempts, lockoutMinutes] = await Promise.all([
    getSetting('login_max_attempts'),
    getSetting('login_lockout_minutes'),
  ]);
  return {
    loginMaxAttempts: parseInt(maxAttempts, 10),
    loginLockoutMinutes: parseInt(lockoutMinutes, 10),
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = ?`,
    [key, value, value]
  );
}
