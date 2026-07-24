import crypto from 'crypto';

const CURRENT_ITERATIONS = 210000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA512
const LEGACY_ITERATIONS = 10000;   // pre-2026 hashes stored as `salt:hash`
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export const MIN_PASSCODE_LENGTH = 8;
export const MAX_PASSCODE_LENGTH = 128;

/**
 * Shared passcode policy for registration and recovery. Keep the rule simple
 * enough to explain in one sentence and friendly to password managers and
 * passphrases; strength comes from length, not brittle character recipes.
 */
export function passcodeValidationError(passcode: unknown): string | null {
  if (typeof passcode !== 'string' || passcode.length < MIN_PASSCODE_LENGTH) {
    return `Passcode must be at least ${MIN_PASSCODE_LENGTH} characters`;
  }
  if (passcode.length > MAX_PASSCODE_LENGTH) {
    return `Passcode must be at most ${MAX_PASSCODE_LENGTH} characters`;
  }
  return null;
}

export function sameNormalizedEmail(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

/**
 * Account usernames remain an internal compatibility key, while people sign in
 * with their email address. Generate a stable, readable key and resolve clashes
 * without asking a new customer to invent another identifier.
 */
export function uniqueUsernameForEmail(email: unknown, existingUsernames: Iterable<string>): string {
  const emailPrefix = typeof email === 'string' ? email.trim().toLowerCase().split('@')[0] : '';
  const normalizedPrefix = emailPrefix
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const baseUsername = normalizedPrefix || 'member';
  const existing = new Set(Array.from(existingUsernames, username => String(username).toLowerCase()));

  if (!existing.has(baseUsername)) return baseUsername;
  let suffix = 2;
  while (existing.has(`${baseUsername}_${suffix}`)) suffix += 1;
  return `${baseUsername}_${suffix}`;
}

/**
 * Resolve the HMAC signing secret for session tokens. In production a real
 * secret is mandatory — falling back to a hardcoded value would let anyone with
 * source access forge a session for any user (including the master admin), so
 * we fail fast at startup instead. Dev/test use a fixed, clearly-marked value.
 */
export function resolveSessionSecret(): string {
  const configured = (process.env.SESSION_SECRET || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET must be set in production. Generate one with: openssl rand -hex 32',
    );
  }
  return 'vinea-cellar-dev-only-secret-do-not-use-in-prod';
}

const SECRET_KEY = resolveSessionSecret();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, CURRENT_ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${CURRENT_ITERATIONS}:${salt}:${hash}`;
}

/** Parse both the current `iterations:salt:hash` and legacy `salt:hash` formats. */
function parseStoredHash(storedHash: string): { iterations: number; salt: string; hash: string } | null {
  const parts = storedHash.split(':');
  if (parts.length === 3) {
    const iterations = parseInt(parts[0], 10);
    if (!Number.isInteger(iterations) || iterations <= 0) return null;
    return { iterations, salt: parts[1], hash: parts[2] };
  }
  if (parts.length === 2) {
    return { iterations: LEGACY_ITERATIONS, salt: parts[0], hash: parts[1] };
  }
  return null;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parsed = parseStoredHash(storedHash);
    if (!parsed || !parsed.salt || !parsed.hash) return false;
    const verifyHash = crypto
      .pbkdf2Sync(password, parsed.salt, parsed.iterations, KEY_LENGTH, DIGEST)
      .toString('hex');
    const a = Buffer.from(parsed.hash, 'hex');
    const b = Buffer.from(verifyHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * True when a stored hash was produced with an older/weaker parameter set and
 * should be transparently re-hashed after a successful login.
 */
export function passwordNeedsUpgrade(storedHash: string): boolean {
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;
  return parsed.iterations < CURRENT_ITERATIONS;
}

export function createSessionToken(payload: any, rememberMe?: boolean): string {
  const lifespan = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30 days vs 24 hours
  const expiresAt = Date.now() + lifespan;
  const data = JSON.stringify({ ...payload, expiresAt });
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + signature;
}

export function sessionVersionForUser(user: any): number {
  const value = Number(user?.sessionVersion);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function sessionPayloadForUser(
  user: any,
  role: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    username: user.username,
    role,
    sessionVersion: sessionVersionForUser(user),
    ...extra,
  };
}

/**
 * Legacy sessions without a version map to version 1. Once a password reset or
 * security-sensitive admin change increments the stored version, every older
 * cookie fails this comparison on its next request.
 */
export function sessionMatchesUserVersion(session: any, user: any): boolean {
  const sessionVersion = session?.sessionVersion === undefined
    ? 1
    : Number(session.sessionVersion);
  return Number.isInteger(sessionVersion) && sessionVersion === sessionVersionForUser(user);
}

export function userAccountIsEnabled(user: any): boolean {
  return Boolean(user) && user.accountEnabled !== false;
}

export function verifySessionToken(token: string): any {
  if (!token) return null;
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const data = Buffer.from(encodedPayload, 'base64').toString('utf8');
    const expectedSignature = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
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
