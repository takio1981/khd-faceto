import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { JWTPayload, Role } from '../types';
import { isPinLoginEnabled } from '../services/settings.service';

// Verify the Bearer token and attach req.user
export function verifyJWT(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'ไม่พบ token (Unauthorized)' });
    return;
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, config.jwt.secret) as unknown as JWTPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'token ไม่ถูกต้องหรือหมดอายุ (Invalid token)' });
  }
}

// Restrict a route to one or more roles
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'ไม่มีสิทธิ์เข้าถึง (Forbidden)' });
      return;
    }
    next();
  };
}

// Gates all PIN login/setup/device routes behind the admin-controlled
// PIN_LOGIN_ENABLED toggle. Deliberately NOT applied to GET /pin/status
// (a status read shouldn't require the flag it's reporting on) or to the
// admin PIN-cleanup endpoints (housekeeping shouldn't be blocked by the
// org-wide toggle).
export function requirePinLoginEnabled(req: Request, res: Response, next: NextFunction): void {
  isPinLoginEnabled()
    .then((enabled) => {
      if (!enabled) {
        res.status(403).json({ error: 'ระบบเข้าสู่ระบบด้วย PIN ถูกปิดใช้งาน', code: 'PIN_LOGIN_DISABLED' });
        return;
      }
      next();
    })
    .catch(next);
}
