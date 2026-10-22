import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'pfw_session';
export const SESSION_SECONDS = 12 * 60 * 60; // stay logged in for 12 hours

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters long.');
  }
  return s;
}

/** Constant-time string comparison (safe against timing attacks). */
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function createSessionToken(now = Date.now()) {
  const payload = `admin.${now + SESSION_SECONDS * 1000}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token, now = Date.now()) {
  try {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'admin') return false;
    const expires = Number(parts[1]);
    if (!Number.isFinite(expires) || expires < now) return false;
    return safeEqual(sign(`${parts[0]}.${parts[1]}`), parts[2]);
  } catch {
    return false;
  }
}
