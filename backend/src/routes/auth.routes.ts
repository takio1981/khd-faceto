import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT } from '../middleware/auth';
import { getLoginSettings } from '../services/settings.service';
import { User, JWTPayload } from '../types';

const router = Router();

function fmtRemaining(ms: number): string {
  const mins = Math.ceil(ms / 60000);
  return mins <= 1 ? '1 นาที' : `${mins} นาที`;
}

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body ?? {};
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanUsername && !cleanPassword) {
    res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    return;
  }
  if (!cleanUsername) {
    res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้ (Username)' });
    return;
  }
  if (!cleanPassword) {
    res.status(400).json({ error: 'กรุณากรอกรหัสผ่าน (Password)' });
    return;
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT * FROM users WHERE username = ? LIMIT 1',
    [cleanUsername]
  );
  const user = rows[0] as User | undefined;
  if (!user) {
    res.status(401).json({ error: 'ไม่พบชื่อผู้ใช้นี้ในระบบ (Username not found)' });
    return;
  }

  // Already locked out from a previous burst of failed attempts?
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    const remaining = new Date(user.locked_until).getTime() - Date.now();
    res.status(423).json({
      error: `บัญชีถูกล็อกชั่วคราวเนื่องจากกรอกรหัสผ่านผิดหลายครั้ง กรุณาลองใหม่ในอีก ${fmtRemaining(remaining)}`,
    });
    return;
  }

  const ok = await bcrypt.compare(cleanPassword, user.password_hash);
  const { loginMaxAttempts, loginLockoutMinutes } = await getLoginSettings();

  if (!ok) {
    const attempts = user.failed_login_attempts + 1;
    if (attempts >= loginMaxAttempts) {
      const lockedUntil = new Date(Date.now() + loginLockoutMinutes * 60_000);
      await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = ? WHERE id = ?', [lockedUntil, user.id]);
      res.status(423).json({
        error: `กรอกรหัสผ่านผิด ${attempts} ครั้ง บัญชีถูกล็อกชั่วคราว ${loginLockoutMinutes} นาที`,
      });
      return;
    }
    await pool.query('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [attempts, user.id]);
    res.status(401).json({
      error: `รหัสผ่านไม่ถูกต้อง (ผิด ${attempts}/${loginMaxAttempts} ครั้ง)`,
    });
    return;
  }

  // Successful login: reset the failed-attempt counter / any stale lock
  if (user.failed_login_attempts > 0 || user.locked_until) {
    await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
  }

  const payload: JWTPayload = { sub: user.id, role: user.role, employeeId: user.employee_id };
  const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn } as jwt.SignOptions);

  res.json({
    accessToken: token,
    role: user.role,
    username: user.username,
    employeeId: user.employee_id,
  });
}));

// GET /api/auth/me  - return the current user from the token
router.get('/me', verifyJWT, asyncHandler(async (req, res) => {
  res.json({ user: req.user });
}));

export default router;
