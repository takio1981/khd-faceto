import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { JWTPayload, Role } from '../types';

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
