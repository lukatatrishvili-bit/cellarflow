import crypto from 'crypto';
import { resolveSessionSecret } from './auth';

/**
 * Sealing for integration connector credentials (1C passwords / API keys).
 *
 * The raw secret is captured once at the /config route, sealed here, and only
 * the sealed blob is persisted inside the org state. It is decrypted
 * exclusively on the server at outbound-call time; redactConnector strips the
 * blob from every API response, so the plaintext never reaches a client.
 *
 * Key derivation: HKDF-SHA256 from SESSION_SECRET with a dedicated info label,
 * so session-token signing and secret sealing never share key material.
 * Rotating SESSION_SECRET therefore invalidates sealed secrets — operators
 * re-enter connector credentials after a rotation (documented trade-off;
 * moving to GCP Secret Manager is the planned hardening step).
 */

const SEAL_VERSION = 'v1';

function sealingKey(): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', resolveSessionSecret(), 'cellarflow-integrations', 'connector-secret-sealing-v1', 32),
  );
}

export function sealIntegrationSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealingKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SEAL_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Returns the plaintext, or null when the blob is missing, malformed, or tampered. */
export function openIntegrationSecret(sealed: unknown): string | null {
  if (typeof sealed !== 'string' || !sealed) return null;
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== SEAL_VERSION) return null;
  try {
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key (rotated SESSION_SECRET) or tampered blob
  }
}
