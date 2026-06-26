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
