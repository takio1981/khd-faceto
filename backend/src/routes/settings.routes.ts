import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { verifyJWT, requireRole } from '../middleware/auth';
import { getLoginSettings, setSetting } from '../services/settings.service';
import { logAudit } from '../services/audit.service';

const router = Router();

router.get('/', verifyJWT, requireRole('admin'), asyncHandler(async (_req, res) => {
  const settings = await getLoginSettings();
  res.json(settings);
}));

router.put('/', verifyJWT, requireRole('admin'), asyncHandler(async (req, res) => {
  const { loginMaxAttempts, loginLockoutMinutes, pinLoginEnabled, pinMaxAttempts, pinLockoutMinutes } = req.body ?? {};
  const maxAttempts = parseInt(loginMaxAttempts, 10);
  const lockoutMinutes = parseInt(loginLockoutMinutes, 10);
  const pinAttempts = parseInt(pinMaxAttempts, 10);
  const pinLockout = parseInt(pinLockoutMinutes, 10);

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    res.status(400).json({ error: 'จำนวนครั้งที่ผิดได้ต้องเป็นเลข 1-20' });
    return;
  }
  if (!Number.isInteger(lockoutMinutes) || lockoutMinutes < 1 || lockoutMinutes > 1440) {
    res.status(400).json({ error: 'เวลาล็อก (นาที) ต้องเป็นเลข 1-1440' });
    return;
  }
  if (typeof pinLoginEnabled !== 'boolean') {
    res.status(400).json({ error: 'ค่าการเปิดใช้งาน PIN ต้องเป็น true/false' });
    return;
  }
  if (!Number.isInteger(pinAttempts) || pinAttempts < 1 || pinAttempts > 10) {
    res.status(400).json({ error: 'จำนวนครั้งที่ PIN ผิดได้ต้องเป็นเลข 1-10' });
    return;
  }
  if (!Number.isInteger(pinLockout) || pinLockout < 1 || pinLockout > 1440) {
    res.status(400).json({ error: 'เวลาล็อก PIN (นาที) ต้องเป็นเลข 1-1440' });
    return;
  }

  await setSetting('login_max_attempts', String(maxAttempts));
  await setSetting('login_lockout_minutes', String(lockoutMinutes));
  await setSetting('pin_login_enabled', String(pinLoginEnabled));
  await setSetting('pin_max_attempts', String(pinAttempts));
  await setSetting('pin_lockout_minutes', String(pinLockout));
  await logAudit(req, {
    action: 'settings.update',
    targetTable: 'app_settings',
    after: { maxAttempts, lockoutMinutes, pinLoginEnabled, pinAttempts, pinLockout },
  });
  res.json({ ok: true });
}));

export default router;
