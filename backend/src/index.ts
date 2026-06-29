import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { config } from './config';
import { waitForDb } from './db';
import { loadFaceCache } from './services/faceCache';
import { startAbsentCheckScheduler } from './services/notification.service';
import { ensureSelfSignedCert } from './services/certs';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/auth.routes';
import employeeRoutes from './routes/employee.routes';
import shiftRoutes from './routes/shift.routes';
import attendanceRoutes from './routes/attendance.routes';
import dashboardRoutes from './routes/dashboard.routes';
import reportRoutes from './routes/report.routes';
import settingsRoutes from './routes/settings.routes';
import scanLocationRoutes from './routes/scanLocations.routes';
import notificationRoutes from './routes/notification.routes';
import holidayRoutes from './routes/holidays.routes';
import auditRoutes from './routes/audit.routes';
import orgStructureRoutes from './routes/orgStructure.routes';
import correctionRequestRoutes from './routes/correctionRequests.routes';
import userRoutes from './routes/user.routes';

async function main() {
  await waitForDb();
  await loadFaceCache();
  startAbsentCheckScheduler();

  // Ensure the face image directory exists
  fs.mkdirSync(config.face.imageDir, { recursive: true });

  const app = express();

  // Security headers. CSP relaxed so face-api.js / Chart.js CDN + inline scripts work,
  // and webcam (getUserMedia) is permitted.
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({ origin: false }));
  app.use(express.json({ limit: '5mb' })); // descriptor + base64 JPEG snapshot

  // Everything (API + the Angular build + the SPA fallback) is served under
  // /khd-faceto instead of the domain/port root — lets this app share a host
  // with other apps behind a reverse proxy without colliding at "/". The
  // Angular build's <base href="/khd-faceto/"> (see frontend-ng/src/index.html)
  // and its apiBaseUrl ('api', relative) are the matching frontend half of
  // this — both resolve against that base href regardless of route depth.
  const BASE_PATH = '/khd-faceto';
  const base = express.Router();

  // Rate limit the API. The live check-in camera loop polls /attendance/preview
  // and /attendance/scan many times a minute by design (every ~400ms, once per
  // detected face) — that path has its own much higher limit set directly on
  // the route in attendance.routes.ts, so it's excluded here.
  base.use('/api/', rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/attendance/preview' || req.path === '/attendance/scan',
  }));

  // Expose branding to the frontend without auth
  base.get('/api/config', (_req, res) => {
    res.json({ companyName: config.companyName, appName: config.appName });
  });

  // API routes
  base.use('/api/auth', authRoutes);
  base.use('/api/employees', employeeRoutes);
  base.use('/api/shifts', shiftRoutes);
  base.use('/api/attendance', attendanceRoutes);
  base.use('/api/dashboard', dashboardRoutes);
  base.use('/api/reports', reportRoutes);
  base.use('/api/settings', settingsRoutes);
  base.use('/api/scan-locations', scanLocationRoutes);
  base.use('/api/notifications', notificationRoutes);
  base.use('/api/holidays', holidayRoutes);
  base.use('/api/audit-log', auditRoutes);
  base.use('/api/org', orgStructureRoutes);
  base.use('/api/correction-requests', correctionRequestRoutes);
  base.use('/api/users', userRoutes);

  base.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Static frontend (Angular build). In Docker the public dir sits at /app/public
  // (next to dist); in local dev it's the Angular CLI's build output directory —
  // run `npm run build` (or `ng build --watch`) inside frontend-ng/ to populate it.
  const dockerPublic = path.resolve(__dirname, '../public');
  const devPublic = path.resolve(__dirname, '../../frontend-ng/dist/frontend-ng/browser');
  const publicDir = fs.existsSync(dockerPublic) ? dockerPublic : devPublic;
  base.use(express.static(publicDir));

  // SPA-style fallback to login for unknown non-API GET routes
  base.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(BASE_PATH, base);

  // Convenience redirect so hitting the bare host/port still lands somewhere useful.
  app.get('/', (_req, res) => res.redirect(`${BASE_PATH}/`));

  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`[server] http listening on http://localhost:${config.port}${BASE_PATH}/`);
  });

  // HTTPS listener for LAN devices (phones/tablets): getUserMedia (camera)
  // only runs in a secure context, and plain http:// to the server's LAN IP
  // from another device does not count as one. Self-signed, so the first
  // visit on each device needs a one-time "proceed anyway" past the browser
  // warning — see ensureSelfSignedCert() for the cert/SAN details.
  try {
    const { cert, key } = await ensureSelfSignedCert();
    https.createServer({ cert, key }, app).listen(config.https.port, () => {
      console.log(`[server] https listening on https://localhost:${config.https.port}${BASE_PATH}/ (and any LAN IP in the cert)`);
    });
  } catch (err) {
    console.error('[server] failed to start HTTPS listener — LAN camera access will not work', err);
  }

  console.log(`[server] company: ${config.companyName}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
