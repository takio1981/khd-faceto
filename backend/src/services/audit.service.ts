import { Request } from 'express';
import { pool } from '../db';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

export interface AuditEntry {
  action: string;
  targetTable?: string;
  targetId?: number | null;
  before?: unknown;
  after?: unknown;
}

// Called explicitly at each mutation site (after the DB write succeeds) —
// not a generic auto-wrapping middleware, since "before" data needs to be
// read before the change and varies per route. Never throws: a logging
// failure should not block the actual operation it's recording.
export async function logAudit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    const userId = req.user?.sub ?? null;
    let username: string | null = null;
    if (userId) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT username FROM users WHERE id = ?', [userId]);
      username = rows[0]?.username ?? null;
    }

    await pool.query<ResultSetHeader>(
      `INSERT INTO audit_log (user_id, username, action, target_table, target_id, before_data, after_data, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        entry.action,
        entry.targetTable ?? null,
        entry.targetId ?? null,
        entry.before !== undefined ? JSON.stringify(entry.before) : null,
        entry.after !== undefined ? JSON.stringify(entry.after) : null,
        req.ip ?? null,
      ]
    );
  } catch (err) {
    console.error('[audit] failed to write log entry', err);
  }
}

export interface AuditListFilter {
  page: number;
  pageSize: number;
  action?: string;
  username?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listAuditLog(filter: AuditListFilter) {
  const where: string[] = [];
  const params: any[] = [];
  if (filter.action) { where.push('action = ?'); params.push(filter.action); }
  if (filter.username) { where.push('username LIKE ?'); params.push(`%${filter.username}%`); }
  if (filter.dateFrom) { where.push('DATE(created_at) >= ?'); params.push(filter.dateFrom); }
  if (filter.dateTo) { where.push('DATE(created_at) <= ?'); params.push(filter.dateTo); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (filter.page - 1) * filter.pageSize;

  const [countRows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM audit_log ${whereSql}`,
    params
  );
  const total = countRows[0].total as number;

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, username, action, target_table, target_id, before_data, after_data, ip_address, created_at
       FROM audit_log ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, filter.pageSize, offset]
  );

  return { data: rows, total, page: filter.page, pageSize: filter.pageSize };
}
