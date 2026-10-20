import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Used when the email is unknown, so login takes the same time either way.
export const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(KEY_LEN)}`;

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newGameId = () => randomBytes(8).toString('hex');

// In-memory limiter for failed logins: enough for a single-process prototype.
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    blocked(key) {
      const h = hits.get(key);
      if (!h) return false;
      if (Date.now() - h.start > windowMs) { hits.delete(key); return false; }
      return h.count >= max;
    },
    fail(key) {
      const h = hits.get(key);
      if (!h || Date.now() - h.start > windowMs) hits.set(key, { start: Date.now(), count: 1 });
      else h.count++;
    },
    reset(key) { hits.delete(key); },
  };
}
