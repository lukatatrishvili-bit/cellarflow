import { describe, expect, it } from 'vitest';
import {
  AUDIT_GENESIS_HASH,
  buildAuditHashChain,
  hashAuditLog,
  prepareAuditLogsForServerMerge,
  sha256Hex,
  signAuditEntries,
} from '../lib/auditHash';
import type { MaraniOSAuditLog } from '../lib/wineryState';

const audit = (id: string, timestamp: string, overrides: Partial<MaraniOSAuditLog> = {}): MaraniOSAuditLog => ({
  id,
  timestamp,
  user: 'Winemaker',
  module: 'GVINO',
  actionType: 'Cellar Operation',
  changedItem: 'LOT-001',
  oldValue: '10 L',
  newValue: '9 L',
  notes: 'Racking completed.',
  ...overrides,
});

describe('audit hash chain', () => {
  it('computes a standard SHA-256 digest synchronously', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('signs new audit entries after the existing chain', () => {
    const first = signAuditEntries([audit('audit-1', '2026-07-01T08:00:00.000Z')], [])[0];
    const second = signAuditEntries([audit('audit-2', '2026-07-01T09:00:00.000Z')], [first])[0];

    expect(first).toMatchObject({
      chainSequence: 1,
      previousHash: AUDIT_GENESIS_HASH,
      hashAlgorithm: 'SHA-256',
      hashCanonicalVersion: 1,
    });
    expect(first.chainHash).toBe(hashAuditLog(first, AUDIT_GENESIS_HASH));
    expect(second).toMatchObject({
      chainSequence: 2,
      previousHash: first.chainHash,
    });
    expect(second.chainHash).toBe(hashAuditLog(second, first.chainHash || ''));
  });

  it('keeps legacy unsigned rows verifiable and signs new rows after them', () => {
    const legacy = audit('audit-legacy', '2026-07-01T08:00:00.000Z');
    const signed = signAuditEntries([audit('audit-new', '2026-07-01T09:00:00.000Z')], [legacy])[0];
    const summary = buildAuditHashChain([signed, legacy]);

    expect(summary.invalidCount).toBe(0);
    expect(summary.signedCount).toBe(1);
    expect(summary.byId['audit-legacy']).toMatchObject({
      sequence: 1,
      persisted: false,
      valid: true,
    });
    expect(summary.byId['audit-new']).toMatchObject({
      sequence: 2,
      persisted: true,
      valid: true,
    });
  });

  it('detects tampering in persisted audit hash metadata or canonical content', () => {
    const signed = signAuditEntries([audit('audit-1', '2026-07-01T08:00:00.000Z')], [])[0];
    const tampered = { ...signed, newValue: '999 L' };
    const summary = buildAuditHashChain([tampered]);

    expect(summary.invalidCount).toBe(1);
    expect(summary.byId['audit-1']).toMatchObject({
      persisted: true,
      valid: false,
    });
  });

  it('server merge preserves existing audit rows and stamps new rows authoritatively', () => {
    const existing = signAuditEntries([audit('audit-1', '2026-07-01T08:00:00.000Z')], [])[0];
    const forgedNew = {
      ...audit('audit-2', '2026-07-01T09:00:00.000Z'),
      previousHash: 'forged',
      chainHash: 'forged',
      chainSequence: 999,
      hashAlgorithm: 'not-sha',
      hashCanonicalVersion: 999,
    };

    const merged = prepareAuditLogsForServerMerge([existing], [forgedNew, { ...existing, chainHash: 'client-downgrade' }]);
    const newLog = merged.find(log => log.id === 'audit-2');
    const preservedExisting = merged.find(log => log.id === 'audit-1');

    expect(preservedExisting).toEqual(existing);
    expect(newLog).toMatchObject({
      chainSequence: 2,
      previousHash: existing.chainHash,
      hashAlgorithm: 'SHA-256',
      hashCanonicalVersion: 1,
    });
    expect(newLog?.chainHash).not.toBe('forged');
    expect(buildAuditHashChain(merged).invalidCount).toBe(0);
  });

  it('server merge rejects modifications to existing audit content', () => {
    const existing = signAuditEntries([audit('audit-1', '2026-07-01T08:00:00.000Z')], [])[0];

    expect(() => prepareAuditLogsForServerMerge([existing], [{ ...existing, notes: 'Changed after signing.' }]))
      .toThrow('Audit Immutability');
  });
});
