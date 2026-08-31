import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { RowDataPacket } from 'mysql2';
import { pool } from '../db';
import { config } from '../config';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requirePinLoginEnabled } from '../middleware/auth';
import { isPinLoginEnabled } from '../services/settings.service';
import { logAudit } from '../services/audit.service';
import {
  getPinStatus, createPin, verifyPinLogin, changePin, resetPin,
} from '../services/pinAuth.service';
import { registerDevice, listDevices, removeDevice } from '../services/device.service';
import {
  PinNotConfiguredError, PinAlreadyConfiguredError, PinIncorrectError, PinLockedError, DeviceLimitReachedError,
} from '../services/pinErrors';
import { User, JWTPayload } from '../types';

const router = Router();

const PIN_REGEX = /^\d{6}$/;
function isValidPin(v: unknown): v is string {
  return typeof v === 'string' && PIN_REGEX.test(v);
}

function fmtRemaining(ms: number): string {
  const mins = Math.ceil(ms / 60000);
  return mins <= 1 ? '1 นาที' : `${mins} นาที`;
}

// Stricter than the app-wide 300/min-per-IP limiter (index.ts) — specifically
// slows a single IP trying many usernames/PINs against this one endpoint, on
// top of the per-account failed_pin_attempts lockout.
const pinLoginLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

// GET /api/auth/pin/status — deliberately NOT behind requirePinLoginEnabled:
// a status read (including the enabled flag itself) shouldn't require the
// flag it's reporting on.
router.get('/pin/status', verifyJWT, asyncHandler(async (req, res) => {
  const enabled = await isPinLoginEnabled();
  const status = await getPinStatus(req.user!.sub);
  res.json({ enabled, configured: status.configured, deviceCount: status.deviceCount });
}));

// POST /api/auth/pin/login — unauthenticated, mirrors POST /auth/login's
// response shape exactly (same JWTPayload, same jwt.sign call) so a
// PIN-issued session is indistinguishable from a password-issued one.
router.post('/pin/login', pinLoginLimiter, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const { username, pin, deviceId } = req.body ?? {};
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  const cleanDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';

  if (!cleanUsername || !isValidPin(pin) || !cleanDeviceId) {
    res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
    return;
  }

  const result = await verifyPinLogin(cleanUsername, pin, cleanDeviceId);

  if (!result.ok) {
    if (result.reason === 'locked') {
      if (result.justLocked) {
        await logAudit(req, { action: 'pin.locked', targetTable: 'user_pin', userId: null, username: cleanUsername });
      }
      await logAudit(req, {
        action: 'pin_login.failed', targetTable: 'users', userId: null, username: cleanUsername,
        after: { reason: 'locked' },
      });
      res.status(423).json({
        error: `PIN ถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${fmtRemaining(result.lockedUntil.getTime() - Date.now())} หรือเข้าสู่ระบบด้วยรหัสผ่านแทน`,
        code: 'PIN_LOCKED',
      });
      return;
    }
    if (result.reason === 'device_not_registered') {
      await logAudit(req, {
        action: 'pin_login.failed', targetTable: 'users', userId: null, username: cleanUsername,
        after: { reason: 'device_not_registered' },
      });
      res.status(403).json({ error: 'อุปกรณ์นี้ยังไม่ได้ลงทะเบียนสำหรับเข้าสู่ระบบด้วย PIN', code: 'DEVICE_NOT_REGISTERED' });
      return;
    }
    await logAudit(req, {
      action: 'pin_login.failed', targetTable: 'users', userId: null, username: cleanUsername,
      after: { reason: 'generic' },
    });
    res.status(401).json({ error: 'ไม่สามารถเข้าสู่ระบบด้วย PIN ได้' });
    return;
  }

  const { user } = result;
  const payload: JWTPayload = { sub: user.id, role: user.role, employeeId: user.employee_id };
  const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn } as jwt.SignOptions);

  await logAudit(req, {
    action: 'pin_login.success', targetTable: 'users', targetId: user.id, userId: user.id, username: user.username,
  });

  res.json({ accessToken: token, role: user.role, username: user.username, employeeId: user.employee_id });
}));

// POST /api/auth/pin/setup — first-time PIN creation, also registers the
// current device (single transaction, see pinAuth.service.createPin).
router.post('/pin/setup', verifyJWT, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const { pin, confirmPin, deviceId } = req.body ?? {};
  const cleanDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';

  if (!isValidPin(pin) || pin !== confirmPin) {
    res.status(400).json({ error: 'PIN ต้องเป็นตัวเลข 6 หลัก และต้องกรอกยืนยันให้ตรงกัน' });
    return;
  }
  if (!cleanDeviceId) {
    res.status(400).json({ error: 'ไม่พบรหัสอุปกรณ์' });
    return;
  }

  let userPinId: number;
  try {
    userPinId = await createPin(req.user!.sub, pin, cleanDeviceId, req.headers['user-agent'] ?? null);
  } catch (err) {
    if (err instanceof PinAlreadyConfiguredError) {
      res.status(409).json({ error: 'ตั้งค่า PIN ไปแล้ว กรุณาใช้การเปลี่ยน PIN แทน' });
      return;
    }
    throw err;
  }

  await logAudit(req, { action: 'pin.created', targetTable: 'user_pin', targetId: userPinId });
  await logAudit(req, { action: 'device.registered', targetTable: 'user_pin_devices' });
  res.status(201).json({ ok: true });
}));

// POST /api/auth/pin/change — requires knowing the CURRENT PIN.
router.post('/pin/change', verifyJWT, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const { currentPin, newPin, confirmNewPin } = req.body ?? {};

  if (!isValidPin(currentPin) || !isValidPin(newPin) || newPin !== confirmNewPin) {
    res.status(400).json({ error: 'กรุณากรอก PIN ปัจจุบันและ PIN ใหม่ (ตัวเลข 6 หลัก) ให้ถูกต้อง และยืนยันให้ตรงกัน' });
    return;
  }

  try {
    await changePin(req.user!.sub, currentPin, newPin);
  } catch (err) {
    if (err instanceof PinNotConfiguredError) {
      res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า PIN', code: 'PIN_NOT_CONFIGURED' });
      return;
    }
    if (err instanceof PinLockedError) {
      await logAudit(req, { action: 'pin.locked', targetTable: 'user_pin', targetId: req.user!.sub });
      res.status(423).json({
        error: `PIN ถูกล็อกชั่วคราว กรุณาลองใหม่ในอีก ${fmtRemaining(err.lockedUntil.getTime() - Date.now())}`,
        code: 'PIN_LOCKED',
      });
      return;
    }
    if (err instanceof PinIncorrectError) {
      res.status(401).json({ error: 'PIN ปัจจุบันไม่ถูกต้อง' });
      return;
    }
    throw err;
  }

  await logAudit(req, { action: 'pin.changed', targetTable: 'user_pin', targetId: req.user!.sub });
  res.json({ ok: true });
}));

// POST /api/auth/pin/reset — requires the PASSWORD (never the old PIN) as
// proof of identity, since a JWT alone carries no marker of how the session
// was established.
router.post('/pin/reset', verifyJWT, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const { password, newPin, confirmNewPin } = req.body ?? {};

  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'กรุณากรอกรหัสผ่านเพื่อยืนยันตัวตน' });
    return;
  }
  if (!isValidPin(newPin) || newPin !== confirmNewPin) {
    res.status(400).json({ error: 'PIN ใหม่ต้องเป็นตัวเลข 6 หลัก และต้องกรอกยืนยันให้ตรงกัน' });
    return;
  }

  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM users WHERE id = ? LIMIT 1', [req.user!.sub]);
  const user = rows[0] as User | undefined;
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!ok) {
    res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    return;
  }

  await resetPin(req.user!.sub, newPin);
  await logAudit(req, { action: 'pin.reset', targetTable: 'user_pin', targetId: req.user!.sub });
  res.json({ ok: true });
}));

router.get('/devices', verifyJWT, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const devices = await listDevices(req.user!.sub);
  res.json(devices);
}));

router.post('/devices', verifyJWT, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const { deviceId } = req.body ?? {};
  const cleanDeviceId = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!cleanDeviceId) {
    res.status(400).json({ error: 'ไม่พบรหัสอุปกรณ์' });
    return;
  }

  try {
    const id = await registerDevice(req.user!.sub, cleanDeviceId, req.headers['user-agent'] ?? null);
    await logAudit(req, { action: 'device.registered', targetTable: 'user_pin_devices', targetId: id });
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof PinNotConfiguredError) {
      res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า PIN', code: 'PIN_NOT_CONFIGURED' });
      return;
    }
    if (err instanceof DeviceLimitReachedError) {
      res.status(409).json({
        error: 'บัญชีนี้มีอุปกรณ์ที่ลงทะเบียนครบ 2 เครื่องแล้ว กรุณาลบอุปกรณ์เดิมก่อนเพิ่มอุปกรณ์ใหม่',
        code: 'DEVICE_LIMIT_REACHED',
      });
      return;
    }
    throw err;
  }
}));

router.delete('/devices/:id', verifyJWT, requirePinLoginEnabled, asyncHandler(async (req, res) => {
  const removed = await removeDevice(req.user!.sub, Number(req.params.id));
  if (!removed) {
    res.status(404).json({ error: 'ไม่พบอุปกรณ์นี้' });
    return;
  }
  await logAudit(req, { action: 'device.removed', targetTable: 'user_pin_devices', targetId: Number(req.params.id) });
  res.json({ ok: true });
}));

export default router;
