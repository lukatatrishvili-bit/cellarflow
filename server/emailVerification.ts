import crypto from 'crypto';

/**
 * Email-verification tokens. The raw token travels in the verification link and
 * is never stored; only its SHA-256 hash + expiry live on the user record, so a
 * leaked database cannot be used to forge verification links.
 */

/** How long a verification link stays valid. */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface VerificationToken {
  token: string;     // raw token for the email link (never persisted)
  tokenHash: string; // SHA-256 of token (persisted on the user)
  expiresAt: number; // epoch ms
}

export interface VerificationRecord {
  verifyTokenHash?: string;
  verifyTokenExpires?: number;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateVerificationToken(now: number = Date.now()): VerificationToken {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashToken(token), expiresAt: now + VERIFICATION_TTL_MS };
}

/** Constant-time check that a raw token matches the stored hash and isn't expired. */
export function isVerificationTokenValid(
  record: VerificationRecord | null | undefined,
  token: string | undefined | null,
  now: number = Date.now(),
): boolean {
  if (!record || !token || !record.verifyTokenHash || !record.verifyTokenExpires) return false;
  if (now > record.verifyTokenExpires) return false;
  const provided = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(record.verifyTokenHash, 'hex');
  if (provided.length !== stored.length) return false;
  return crypto.timingSafeEqual(provided, stored);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}
