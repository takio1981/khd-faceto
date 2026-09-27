import { Request, Response, NextFunction } from 'express';

// U+FFFD is what express.json() substitutes for byte sequences that aren't
// valid UTF-8 — e.g. Thai text sent as TIS-620/cp874 by a Windows shell
// (curl in Git Bash) instead of UTF-8. Legitimate input never contains it,
// so any occurrence means the text was already corrupted in transit; saving
// it would permanently store garbled names (this happened to a shift name).
const REPLACEMENT_CHAR = '�';

function containsReplacementChar(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(REPLACEMENT_CHAR);
  if (Array.isArray(value)) return value.some(containsReplacementChar);
  if (value && typeof value === 'object') return Object.values(value).some(containsReplacementChar);
  return false;
}

export function rejectMojibake(req: Request, res: Response, next: NextFunction): void {
  if (containsReplacementChar(req.body)) {
    res.status(400).json({
      error: 'ข้อความภาษาไทยในคำขอเข้ารหัสไม่ถูกต้อง (ต้องเป็น UTF-8) — ระบบไม่บันทึกเพื่อป้องกันข้อความเพี้ยน',
      code: 'INVALID_TEXT_ENCODING',
    });
    return;
  }
  next();
}
