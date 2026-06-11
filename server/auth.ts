import crypto from 'crypto';

const ITERATIONS = 10000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';
const SECRET_KEY = process.env.SESSION_SECRET || 'vinea-cellar-secret-key-signature-2026';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch {
    return false;
  }
}

export function createSessionToken(payload: any, rememberMe?: boolean): string {
  const lifespan = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30 days vs 24 hours
  const expiresAt = Date.now() + lifespan;
  const data = JSON.stringify({ ...payload, expiresAt });
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + signature;
}

export function verifySessionToken(token: string): any {
  if (!token) return null;
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;
    
    const data = Buffer.from(encodedPayload, 'base64').toString('utf8');
    const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
    
    if (signature !== expectedSignature) {
      return null;
    }
    
    const payload = JSON.parse(data);
    if (payload.expiresAt < Date.now()) {
      return null; // Expired
    }
    
    return payload;
  } catch {
    return null;
  }
}
