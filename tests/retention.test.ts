import { describe, expect, it } from 'vitest';
import {
  assessFootprintPressure,
  chainIntegrityCollections,
  FOOTPRINT_CRITICAL_RATIO,
  FOOTPRINT_WARN_RATIO,
  measureStateFootprint,
  prunableTransientRecords,
  retentionPolicyFor,
  RETENTION_POLICIES,
} from '../lib/retention';
import { buildAuditHashChain, signAuditEntries } from '../lib/auditHash';
import type { MaraniOSAuditLog } from '../lib/wineryState';

describe('retention policy', () => {
  it('classifies every append-only collection it names', () => {
    for (const policy of RETENTION_POLICIES) {
      expect(policy.dateField).toBeTruthy();
      expect(policy.reason.length).toBeGreaterThan(20);
    }
  });

  it('marks the audit log as chain-protected and never prunable', () => {
    expect(chainIntegrityCollections()).toContain('auditLogs');
    expect(retentionPolicyFor('auditLogs')?.kind).toBe('compliance-chain');
    expect(prunableTransientRecords('auditLogs', [{ id: 'a', status: 'dismissed' }])).toEqual([]);
  });

  /**
   * The reason the audit log carries that classification, asserted against the
   * real chain builder rather than trusted from a comment: drop the head of the
   * chain and every remaining entry verifies as tampered.
   */
  it('demonstrates that truncating the audit chain invalidates it', () => {
    const base: Omit<MaraniOSAuditLog, 'id' | 'timestamp'> = {
      user: 'nino',
      module: 'GVINO',
      actionType: 'Create Lot',
      changedItem: 'lot-1',
      oldValue: '',
      newValue: 'created',
      notes: '',
    };
    const unsigned = Array.from({ length: 6 }, (_, i) => ({
      ...base,
      id: `audit-${i}`,
      timestamp: `2026-0${i + 1}-01T00:00:00.000Z`,
    })) as MaraniOSAuditLog[];

    const signed = signAuditEntries(unsigned, []);
    const intact = buildAuditHashChain(signed);
    expect(intact.invalidCount).toBe(0);
    expect(intact.verifiedCount).toBe(signed.length);

    // Keep only the most recent three — exactly what a naive window would do.
    const rebuilt = buildAuditHashChain(signed.slice(3));
    // Not "some entries lost": every remaining entry now fails verification,
    // because each one's expected predecessor hash and sequence shifted.
    expect(rebuilt.invalidCount).toBe(3);
    expect(rebuilt.verifiedCount).toBe(0);
  });

  it('prunes only terminal AI drafts past the grace period', () => {
    const now = new Date('2026-08-03T00:00:00.000Z');
    const drafts = [
      { id: 'd1', status: 'dismissed', createdAt: '2026-01-01T00:00:00.000Z' },        // old + terminal
      { id: 'd2', status: 'converted_to_task', createdAt: '2026-01-02T00:00:00.000Z' },// old + terminal
      { id: 'd3', status: 'draft', createdAt: '2026-01-03T00:00:00.000Z' },            // old but still open
      { id: 'd4', status: 'dismissed', createdAt: '2026-08-01T00:00:00.000Z' },        // terminal but recent
    ];

    const prunable = prunableTransientRecords('aiDrafts', drafts, now);
    expect(prunable.map(d => d.id)).toEqual(['d1', 'd2']);
  });

  it('keeps records whose age cannot be determined', () => {
    const now = new Date('2026-08-03T00:00:00.000Z');
    const drafts = [
      { id: 'd1', status: 'dismissed', createdAt: 'not-a-date' },
      { id: 'd2', status: 'dismissed' },
    ];
    expect(prunableTransientRecords('aiDrafts', drafts, now)).toEqual([]);
  });

  it('never prunes business records', () => {
    const old = [{ id: 'f1', status: 'dismissed', date: '2020-01-01' }];
    expect(prunableTransientRecords('fermLogs', old)).toEqual([]);
    expect(prunableTransientRecords('stockMovements', old)).toEqual([]);
    expect(prunableTransientRecords('cellarOps', old)).toEqual([]);
  });
});

describe('state footprint', () => {
  it('measures arrays only and ranks the biggest collections first', () => {
    const footprint = measureStateFootprint({
      lots: [{ id: 'l1' }],
      fermLogs: [{ id: 'f1', notes: 'x'.repeat(500) }],
      companyProfile: { name: 'not an array' },
      winePricing: {},
    });

    expect(footprint.collections.map(c => c.collection)).toEqual(['fermLogs', 'lots']);
    expect(footprint.totalRecords).toBe(2);
    expect(footprint.collections[0].bytes).toBeGreaterThan(footprint.collections[1].bytes);
  });

  it('handles absent or malformed state without throwing', () => {
    for (const value of [null, undefined, 'nope', 42]) {
      const footprint = measureStateFootprint(value as any);
      expect(footprint.totalRecords).toBe(0);
      expect(footprint.collections).toEqual([]);
    }
  });

  it('escalates from ok to warn to critical as either ceiling is approached', () => {
    const limits = { maxRecords: 1000, maxBytes: 1_000_000 };
    const at = (records: number) => assessFootprintPressure(
      { collections: [], totalRecords: records, totalBytes: 0 },
      limits,
    );

    expect(at(100).level).toBe('ok');
    expect(at(Math.ceil(FOOTPRINT_WARN_RATIO * 1000)).level).toBe('warn');
    expect(at(Math.ceil(FOOTPRINT_CRITICAL_RATIO * 1000)).level).toBe('critical');
  });

  it('escalates on bytes even when the record count is comfortable', () => {
    const pressure = assessFootprintPressure(
      { collections: [], totalRecords: 10, totalBytes: 900_000 },
      { maxRecords: 100_000, maxBytes: 1_000_000 },
    );
    // A few huge records (inline attachments) breach bytes long before count.
    expect(pressure.level).toBe('critical');
    expect(pressure.recordsPct).toBeLessThan(0.01);
  });

  it('names the collections responsible so the warning is actionable', () => {
    const footprint = measureStateFootprint({
      auditLogs: Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, notes: 'x'.repeat(200) })),
      lots: [{ id: 'l1' }],
    });
    const pressure = assessFootprintPressure(footprint, { maxRecords: 45, maxBytes: 10_000_000 });

    expect(pressure.level).toBe('critical');
    expect(pressure.topCollections[0].collection).toBe('auditLogs');
  });
});
