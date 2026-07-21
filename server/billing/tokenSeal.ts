import crypto from 'crypto';
import { resolveSessionSecret } from '../auth';

const VERSION = 'v1';

function tokenKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', resolveSessionSecret(), 'cellarflow-billing', 'provider-recurring-token-v1', 32),
  );
}

/** Recurring card identifiers are provider tokens and are encrypted at rest. */
export function sealBillingToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function openBillingToken(sealed: unknown): string | null {
  if (typeof sealed !== 'string') return null;
  const [version, iv, tag, ciphertext, ...extra] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext || extra.length) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
