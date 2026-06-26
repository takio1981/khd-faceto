import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface ScanLocation {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
}

export async function listScanLocations(): Promise<ScanLocation[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, latitude, longitude FROM scan_locations ORDER BY id'
  );
  return rows as ScanLocation[];
}

export async function createScanLocation(name: string, latitude: number, longitude: number): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO scan_locations (name, latitude, longitude) VALUES (?, ?, ?)',
    [name, latitude, longitude]
  );
  return result.insertId;
}

export async function updateScanLocation(id: number, name: string, latitude: number, longitude: number): Promise<void> {
  await pool.query(
    'UPDATE scan_locations SET name = ?, latitude = ?, longitude = ? WHERE id = ?',
    [name, latitude, longitude, id]
  );
}

export async function deleteScanLocation(id: number): Promise<void> {
  await pool.query('DELETE FROM scan_locations WHERE id = ?', [id]);
}
