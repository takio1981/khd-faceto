import dotenv from 'dotenv';
import path from 'path';

// Load .env from the project root when running locally (ignored in Docker, which injects env vars)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(required('PORT', '3000'), 10),
  nodeEnv: required('NODE_ENV', 'development'),

  https: {
    // HTTPS port for LAN devices (phones/tablets) — getUserMedia (camera)
    // only runs in a "secure context": localhost or HTTPS. Plain http:// to
    // the server's LAN IP from another device is NOT secure, so we also run
    // an HTTPS listener with a self-signed cert for that case.
    port: parseInt(required('HTTPS_PORT', '3443'), 10),
    // Comma-separated extra hostnames/IPs to put in the cert's SAN list
    // (besides auto-detected LAN IPs + localhost) — set this to the
    // server's LAN IP (e.g. 192.168.1.50) so phones/tablets on the same
    // Wi-Fi can open https://<that-ip>:3443 without a SAN mismatch error.
    extraHosts: (process.env.SERVER_LAN_IP || '').split(',').map((s) => s.trim()).filter(Boolean),
    certDir: required('CERT_DIR', path.resolve(__dirname, '../../data/certs')),
  },

  db: {
    host: required('DB_HOST', 'localhost'),
    port: parseInt(required('DB_PORT', '3306'), 10),
    database: required('DB_NAME', 'khd_attendance'),
    user: required('DB_USER', 'khdapp'),
    password: required('DB_PASSWORD'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: required('JWT_EXPIRES_IN', '8h'),
  },

  face: {
    matchThreshold: parseFloat(required('FACE_MATCH_THRESHOLD', '0.5')),
    // Minimum distance gap required between the best and second-best match
    // (when they belong to different employees) before we trust the result.
    // Guards against falsely recognizing look-alikes as a confident match.
    minMargin: parseFloat(required('FACE_MIN_MARGIN', '0.08')),
    cooldownMinutes: parseInt(required('FACE_COOLDOWN_MINUTES', '3'), 10),
    imageDir: required('FACE_IMAGE_DIR', path.resolve(__dirname, '../../data/faces')),
  },

  companyName: required('COMPANY_NAME', 'COMPANY'),
  appName: required('APP_NAME', 'KHD-FaceTo'),
};
