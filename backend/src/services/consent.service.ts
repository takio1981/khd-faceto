import { pool } from '../db';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

export const CONSENT_VERSION = 'v1';

export interface ConsentStatus {
  hasConsent: boolean;
  consentVersion: string | null;
  consentedAt: string | null;
  withdrawnAt: string | null;
}

// Status = the most recent consent_log row for the employee. hasConsent is
// true only if that row is a grant (consented_at set) that hasn't since
// been withdrawn.
export async function getConsentStatus(employeeId: number): Promise<ConsentStatus> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT consent_version, consented_at, withdrawn_at
       FROM consent_log
      WHERE employee_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [employeeId]
  );
  if (!rows.length) {
    return { hasConsent: false, consentVersion: null, consentedAt: null, withdrawnAt: null };
  }
  const row = rows[0];
  return {
    hasConsent: !!row.consented_at && !row.withdrawn_at,
    consentVersion: row.consent_version,
    consentedAt: row.consented_at,
    withdrawnAt: row.withdrawn_at,
  };
}

export async function recordConsent(employeeId: number, recordedBy: number | null): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO consent_log (employee_id, consent_version, consented_at, recorded_by)
     VALUES (?, ?, NOW(), ?)`,
    [employeeId, CONSENT_VERSION, recordedBy]
  );
}

export async function withdrawConsent(employeeId: number, recordedBy: number | null): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO consent_log (employee_id, consent_version, withdrawn_at, recorded_by)
     VALUES (?, ?, NOW(), ?)`,
    [employeeId, CONSENT_VERSION, recordedBy]
  );
}
