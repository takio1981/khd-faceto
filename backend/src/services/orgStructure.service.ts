import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export interface Division {
  id: number;
  name: string;
  head_employee_id: number | null;
  head_name: string | null;
}

export interface Department {
  id: number;
  name: string;
  division_id: number | null;
  division_name: string | null;
  head_employee_id: number | null;
  head_name: string | null;
}

const SELECT_DIVISION = `
  SELECT d.id, d.name, d.head_employee_id, e.full_name AS head_name
    FROM divisions d
    LEFT JOIN employees e ON e.id = d.head_employee_id`;

const SELECT_DEPARTMENT = `
  SELECT dept.id, dept.name, dept.division_id, dv.name AS division_name,
         dept.head_employee_id, e.full_name AS head_name
    FROM departments dept
    LEFT JOIN divisions dv ON dv.id = dept.division_id
    LEFT JOIN employees e ON e.id = dept.head_employee_id`;

// ---- Divisions (กลุ่มงาน) ----

export async function listDivisions(): Promise<Division[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_DIVISION} ORDER BY d.name`);
  return rows as Division[];
}

export async function createDivision(name: string, headEmployeeId: number | null): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO divisions (name, head_employee_id) VALUES (?, ?)',
    [name, headEmployeeId]
  );
  return result.insertId;
}

export async function updateDivision(id: number, name: string, headEmployeeId: number | null): Promise<void> {
  await pool.query('UPDATE divisions SET name = ?, head_employee_id = ? WHERE id = ?', [name, headEmployeeId, id]);
}

export async function deleteDivision(id: number): Promise<void> {
  await pool.query('DELETE FROM divisions WHERE id = ?', [id]);
}

// ---- Departments (แผนก) ----

export async function listDepartments(): Promise<Department[]> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_DEPARTMENT} ORDER BY dept.name`);
  return rows as Department[];
}

export async function createDepartment(
  name: string,
  divisionId: number | null,
  headEmployeeId: number | null
): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO departments (name, division_id, head_employee_id) VALUES (?, ?, ?)',
    [name, divisionId, headEmployeeId]
  );
  return result.insertId;
}

export async function updateDepartment(
  id: number,
  name: string,
  divisionId: number | null,
  headEmployeeId: number | null
): Promise<void> {
  await pool.query(
    'UPDATE departments SET name = ?, division_id = ?, head_employee_id = ? WHERE id = ?',
    [name, divisionId, headEmployeeId, id]
  );
}

export async function deleteDepartment(id: number): Promise<void> {
  await pool.query('DELETE FROM departments WHERE id = ?', [id]);
}

export async function getDepartment(id: number): Promise<Department | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_DEPARTMENT} WHERE dept.id = ?`, [id]);
  return (rows[0] as Department) ?? null;
}

// ---- Positions (ตำแหน่ง) ----

export interface Position {
  id: number;
  name: string;
  category: string | null;
  sort_order: number;
}

export async function listPositions(): Promise<Position[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, name, category, sort_order FROM positions ORDER BY sort_order, name'
  );
  return rows as Position[];
}

export async function createPosition(name: string, category: string | null): Promise<number> {
  const [result] = await pool.query<ResultSetHeader>(
    'INSERT INTO positions (name, category) VALUES (?, ?)',
    [name, category]
  );
  return result.insertId;
}

export async function updatePosition(id: number, name: string, category: string | null): Promise<void> {
  await pool.query('UPDATE positions SET name = ?, category = ? WHERE id = ?', [name, category, id]);
}

export async function deletePosition(id: number): Promise<void> {
  await pool.query('DELETE FROM positions WHERE id = ?', [id]);
}
