import crypto from 'crypto';
import { resolveSessionSecret } from './auth';
import { recordSecurityAuditEvent, type SecurityAuditEventInput } from './db';

export function securityAuditIpHash(ip: unknown): string | null {
  const normalized = typeof ip === 'string' ? ip.trim() : '';
  if (!normalized) return null;
  return crypto
    .createHmac('sha256', resolveSessionSecret())
    .update(normalized)
    .digest('hex');
}

export async function auditSecurityEvent(
  input: SecurityAuditEventInput & { ip?: unknown },
): Promise<void> {
  try {
    const { ip, ...event } = input;
    await recordSecurityAuditEvent({
      ...event,
      ipHash: event.ipHash || securityAuditIpHash(ip),
    });
  } catch (err) {
    // Audit persistence must be visible operationally, but it must not expose
    // request bodies or bearer values and should not corrupt the user action.
    console.error('[security-audit] Event persistence failed:', err);
  }
}
