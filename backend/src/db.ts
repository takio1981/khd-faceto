import mysql from 'mysql2/promise';
import { config } from './config';

// Single shared connection pool
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // MariaDB JSON columns come back as strings; keep them as strings and JSON.parse where needed
});

// Wait for the DB to accept connections (container start race). Retries with backoff.
export async function waitForDb(retries = 15, delayMs = 3000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      console.log('[db] connected');
      return;
    } catch (err) {
      console.log(`[db] not ready (attempt ${attempt}/${retries}) - retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('[db] could not connect after multiple attempts');
}
