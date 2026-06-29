import crypto from 'crypto';
import { config } from '../config';

// Short-lived, unguessable URL token for serving a single face image file
// without authentication — needed so LINE's Messaging API (which fetches
// image URLs itself, with no support for auth headers) can display a scan
// photo without exposing a permanently-public, unauthenticated endpoint.
// The token embeds its own expiry + HMAC signature (using the same secret
// as JWT signing), so no database table or cleanup job is needed — an
// expired or tampered token simply fails verification.
const DEFAULT_TTL_MS = 15 * 60 * 1000;

function sign(payload: string): string {
  return crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex');
}

export function signImageToken(imagePath: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const expires = Date.now() + ttlMs;
  const payload = `${imagePath}|${expires}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}|${sig}`, 'utf8').toString('base64url');
}

export function verifyImageToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const lastSep = decoded.lastIndexOf('|');
    const secondLastSep = decoded.lastIndexOf('|', lastSep - 1);
    if (lastSep < 0 || secondLastSep < 0) return null;

    const imagePath = decoded.slice(0, secondLastSep);
    const expiresStr = decoded.slice(secondLastSep + 1, lastSep);
    const sig = decoded.slice(lastSep + 1);
    const expires = Number(expiresStr);
    if (!imagePath || !Number.isFinite(expires)) return null;

    const expected = sign(`${imagePath}|${expires}`);
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    if (Date.now() > expires) return null;

    return imagePath;
  } catch {
    return null;
  }
}
