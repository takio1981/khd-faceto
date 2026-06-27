import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Holiday {
  id: number;
  holiday_date: string; // YYYY-MM-DD
  name: string;
}

// DATE_FORMAT here, not just `holiday_date` — mysql2 otherwise returns DATE
// columns as JS Date objects, which JSON.stringify as full UTC timestamps
// (e.g. "2026-04-12T17:00:00.000Z" for an ICT 2026-04-13), confusing in the
// UI and off-by-one-looking. A plain 'YYYY-MM-DD' string round-trips cleanly.
const SELECT_HOLIDAY = "SELECT id, DATE_FORMAT(holiday_date, '%Y-%m-%d') AS holiday_date, name FROM holidays";

export async function listHolidays(year?: number): Promise<Holiday[]> {
  if (year) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `${SELECT_HOLIDAY} WHERE YEAR(holiday_date) = ? ORDER BY holiday_date`,
      [year]
    );
    return rows as Holiday[];
  }
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_HOLIDAY} ORDER BY holiday_date`);
  return rows as Holiday[];
}

export async function createHoliday(holidayDate: string, name: string): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO holidays (holiday_date, name) VALUES (?, ?)',
    [holidayDate, name]
  );
  return result.insertId;
}

export async function deleteHoliday(id: number): Promise<void> {
  await pool.query('DELETE FROM holidays WHERE id = ?', [id]);
}

// Used by the dashboard summary + absent-notification scheduler — both only
// need a yes/no answer for "is anyone expected to check in on this date".
export async function isHoliday(dateKey: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM holidays WHERE holiday_date = ? LIMIT 1',
    [dateKey]
  );
  return rows.length > 0;
}
