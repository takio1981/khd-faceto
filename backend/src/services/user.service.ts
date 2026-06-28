import bcrypt from 'bcryptjs';
import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { Role } from '../types';

export interface UserListItem {
  id: number;
  username: string;
  role: Role;
  employee_id: number | null;
  employee_code: string | null;
  full_name: string | null;
  is_locked: boolean;
  failed_login_attempts: number;
  created_at: string;
}

export interface UserFilter {
  role?: Role;
  search?: string;
  employeeId?: number;
  unlinkedOnly?: boolean;
  lockedOnly?: boolean;
}

const SELECT_USER = `
  SELECT u.id, u.username, u.role, u.employee_id, e.employee_code, e.full_name,
         u.failed_login_attempts, u.locked_until, u.created_at
    FROM users u
    LEFT JOIN employees e ON e.id = u.employee_id`;

function toListItem(row: RowDataPacket): UserListItem {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    employee_id: row.employee_id,
    employee_code: row.employee_code,
    full_name: row.full_name,
    is_locked: !!row.locked_until && new Date(row.locked_until).getTime() > Date.now(),
    failed_login_attempts: row.failed_login_attempts,
    created_at: row.created_at,
  };
}

export async function listUsers(filter: UserFilter): Promise<UserListItem[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (filter.role) { where.push('u.role = ?'); params.push(filter.role); }
  if (filter.employeeId) { where.push('u.employee_id = ?'); params.push(filter.employeeId); }
  if (filter.unlinkedOnly) { where.push('u.employee_id IS NULL'); }
  if (filter.lockedOnly) { where.push('u.locked_until IS NOT NULL AND u.locked_until > NOW()'); }
  if (filter.search) {
    where.push('(u.username LIKE ? OR e.full_name LIKE ? OR e.employee_code LIKE ?)');
    const kw = `%${filter.search}%`;
    params.push(kw, kw, kw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query<RowDataPacket[]>(
    `${SELECT_USER} ${whereSql} ORDER BY u.username ASC`,
    params
  );
  return rows.map(toListItem);
}

export async function getUser(id: number): Promise<UserListItem | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`${SELECT_USER} WHERE u.id = ? LIMIT 1`, [id]);
  return rows.length ? toListItem(rows[0]) : null;
}

async function assertEmployeeNotLinked(employeeId: number, excludeUserId?: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id FROM users WHERE employee_id = ? AND id != ? LIMIT 1',
    [employeeId, excludeUserId ?? 0]
  );
  if (rows.length) throw new ConflictError('พนักงานคนนี้มีบัญชีผู้ใช้ผูกอยู่แล้ว');
}

export class ConflictError extends Error {}
export class DuplicateUsernameError extends Error {}

export async function createUser(
  username: string,
  password: string,
  role: Role,
  employeeId: number | null
): Promise<number> {
  if (employeeId) await assertEmployeeNotLinked(employeeId);
  const hash = await bcrypt.hash(password, 10);
  try {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)',
      [username, hash, role, employeeId]
    );
    return result.insertId;
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') throw new DuplicateUsernameError('ชื่อผู้ใช้นี้มีอยู่แล้ว');
    throw err;
  }
}

export async function updateUser(
  id: number,
  fields: { username?: string; password?: string; role?: Role; employeeId?: number | null }
): Promise<void> {
  if (fields.employeeId) await assertEmployeeNotLinked(fields.employeeId, id);

  const sets: string[] = [];
  const params: any[] = [];
  if (fields.username !== undefined) { sets.push('username = ?'); params.push(fields.username); }
  if (fields.role !== undefined) { sets.push('role = ?'); params.push(fields.role); }
  if (fields.employeeId !== undefined) { sets.push('employee_id = ?'); params.push(fields.employeeId); }
  if (fields.password) {
    const hash = await bcrypt.hash(fields.password, 10);
    sets.push('password_hash = ?');
    params.push(hash);
  }
  if (!sets.length) return;
  params.push(id);
  try {
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  } catch (err: any) {
    if (err && err.code === 'ER_DUP_ENTRY') throw new DuplicateUsernameError('ชื่อผู้ใช้นี้มีอยู่แล้ว');
    throw err;
  }
}

export async function unlockUser(id: number): Promise<void> {
  await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [id]);
}

export async function deleteUser(id: number): Promise<void> {
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
}

export async function countAdmins(excludeUserId?: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?",
    [excludeUserId ?? 0]
  );
  return rows[0].c as number;
}
