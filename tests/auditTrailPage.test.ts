import { describe, it, expect, beforeEach } from 'vitest';
import { AUDIT_GENESIS_HASH, hashAuditLog, signAuditEntries } from '../lib/auditHash';
import {
  AUDIT_TRAIL_MAX_LIMIT,
  buildAuditTrailPage,
  pageVerifiedAuditChain,
  parseAuditModuleFilter,
  verifyAuditChain,
} from '../lib/auditTrailPage';
import { clearAuditChainCache, verifyOrganizationAuditChain } from '../server/auditChainCache';
import type { MaraniOSAuditLog } from '../lib/wineryState';

function entry(index: number, overrides: Partial<MaraniOSAuditLog> = {}): MaraniOSAuditLog {
  return {
    id: `audit-${String(index).padStart(4, '0')}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    user: 'winemaker@example.ge',
    module: 'GVINO',
    actionType: 'Create Lot',
    changedItem: `LOT-${index}`,
    oldValue: '',
    newValue: 'created',
    notes: 'routine',
    ...overrides,
  };
}

/** A chain as the server stores it: every record signed, in order. */
function signedChain(count: number, overrides: (i: number) => Partial<MaraniOSAuditLog> = () => ({})) {
  const unsigned = Array.from({ length: count }, (_, i) => entry(i, overrides(i)));
  return signAuditEntries(unsigned, []);
}

describe('audit trail windowing', () => {
  it('verifies a windowed page against the full chain, not the window', () => {
    const logs = signedChain(250);

    // The last page holds the OLDEST records, which for a hash chain is the
    // case that matters: their verification depends on records that are not in
    // the response at all. Verifying a window in isolation reports every one of
    // these as tampered.
    const lastPage = buildAuditTrailPage(logs, { offset: 200, limit: 100 });

    expect(lastPage.entries).toHaveLength(50);
    expect(lastPage.entries.every(item => item.verification.valid)).toBe(true);
    expect(lastPage.chain.invalidCount).toBe(0);
    expect(lastPage.chain.verifiedCount).toBe(250);
    expect(lastPage.chain.totalEntries).toBe(250);
  });

  it('keeps chain-correct sequence numbers on every page', () => {
    const logs = signedChain(250);

    const firstPage = buildAuditTrailPage(logs, { offset: 0, limit: 100 });
    const lastPage = buildAuditTrailPage(logs, { offset: 200, limit: 100 });

    // Newest first: page one starts at the top of the chain.
    expect(firstPage.entries[0].verification.sequence).toBe(250);
    expect(firstPage.entries.at(-1)?.verification.sequence).toBe(151);
    // The final page ends at the genesis record, numbered #1 as stored.
    expect(lastPage.entries.at(-1)?.verification.sequence).toBe(1);
    expect(lastPage.entries.at(-1)?.verification.previousHash).toBe(AUDIT_GENESIS_HASH);
  });

  it('reports totals for the whole chain while paging a slice', () => {
    const page = buildAuditTrailPage(signedChain(250), { offset: 0, limit: 10 });

    expect(page.entries).toHaveLength(10);
    expect(page.total).toBe(250);
    expect(page.chain.totalEntries).toBe(250);
    expect(page.chain.signedCount).toBe(250);
  });

  it('still detects a record tampered with in the middle of the chain', () => {
    const logs = signedChain(120);
    // Same id and hashes, different payload: exactly what the chain exists to
    // catch, and what a length/tail fingerprint would miss.
    logs[60] = { ...logs[60], newValue: 'silently rewritten' };

    const page = buildAuditTrailPage(logs, { offset: 0, limit: 100 });

    expect(page.chain.invalidCount).toBeGreaterThan(0);
    expect(page.chain.verifiedCount).toBeLessThan(120);
  });

  it('orders newest first regardless of stored array order', () => {
    const logs = signedChain(5);
    const shuffled = [logs[3], logs[0], logs[4], logs[1], logs[2]];

    const page = buildAuditTrailPage(shuffled, {});

    expect(page.entries.map(item => item.verification.sequence)).toEqual([5, 4, 3, 2, 1]);
  });
});

describe('audit trail filtering', () => {
  it('filters by module and counts every module across the chain', () => {
    const logs = signedChain(9, i => ({
      module: (['GVINO', 'VAZI', 'MARANIOS'] as const)[i % 3],
    }));

    const page = buildAuditTrailPage(logs, { module: 'VAZI' });

    expect(page.total).toBe(3);
    expect(page.entries.every(item => item.log.module === 'VAZI')).toBe(true);
    // Counts describe the chain, not the filter, so the tiles do not collapse
    // to the active view.
    expect(page.moduleCounts).toEqual({ GVINO: 3, VAZI: 3, MARANIOS: 3 });
  });

  it('excludes records older than the cutoff', () => {
    const logs = signAuditEntries([
      entry(0, { timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() }),
      entry(1, { timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() }),
    ], []);

    const page = buildAuditTrailPage(logs, {
      since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(page.total).toBe(1);
    expect(page.entries[0].log.id).toBe('audit-0001');
  });

  it('keeps a record whose timestamp cannot be parsed rather than dropping it', () => {
    const logs = signAuditEntries([entry(0, { timestamp: 'not-a-date' })], []);

    const page = buildAuditTrailPage(logs, { since: new Date().toISOString() });

    expect(page.total).toBe(1);
  });

  it('searches record fields and chain metadata', () => {
    const logs = signedChain(3, i => ({ user: i === 1 ? 'cellar.hand@example.ge' : 'winemaker@example.ge' }));

    expect(buildAuditTrailPage(logs, { search: 'cellar.hand' }).total).toBe(1);
    // The visible hash prefix is searchable, which is how an auditor chases a
    // hash quoted in an export back to its record.
    const hash = logs[2].chainHash!;
    expect(buildAuditTrailPage(logs, { search: hash.slice(0, 10) }).total).toBe(1);
  });

  it('ignores an unknown module filter instead of returning nothing', () => {
    expect(parseAuditModuleFilter('DROP TABLE')).toBe('all');
    expect(parseAuditModuleFilter(undefined)).toBe('all');
    expect(parseAuditModuleFilter('VAZI')).toBe('VAZI');
  });

  it('clamps the page size to the documented ceiling', () => {
    const page = buildAuditTrailPage(signedChain(20), { limit: 10_000 });

    expect(page.limit).toBe(AUDIT_TRAIL_MAX_LIMIT);
  });

  it('returns an empty page past the end rather than failing', () => {
    const page = buildAuditTrailPage(signedChain(5), { offset: 500, limit: 100 });

    expect(page.entries).toEqual([]);
    expect(page.total).toBe(5);
  });

  it('handles an organization with no audit history', () => {
    const page = buildAuditTrailPage([], {});

    expect(page.entries).toEqual([]);
    expect(page.chain.rootHash).toBe('');
    expect(page.chain.totalEntries).toBe(0);
  });
});

describe('audit chain verification cache', () => {
  beforeEach(() => clearAuditChainCache());

  it('reuses the verification while the state version is unchanged', () => {
    const logs = signedChain(20);

    const first = verifyOrganizationAuditChain('org-1', 7, logs);
    const second = verifyOrganizationAuditChain('org-1', 7, logs);

    expect(second).toBe(first);
  });

  it('re-verifies when the organization state version advances', () => {
    const logs = signedChain(20);

    const before = verifyOrganizationAuditChain('org-1', 7, logs);
    const appended = [...logs, ...signAuditEntries([entry(99)], logs)];
    const after = verifyOrganizationAuditChain('org-1', 8, appended);

    expect(after).not.toBe(before);
    expect(after.chain.totalEntries).toBe(21);
    expect(after.chain.invalidCount).toBe(0);
  });

  it('never caches when the store assigns no version', () => {
    const logs = signedChain(5);

    // The JSON development store has no version counter. Reusing a cached
    // verification there could hide an edit, so it re-verifies every time.
    const first = verifyOrganizationAuditChain('org-1', null, logs);
    const second = verifyOrganizationAuditChain('org-1', null, logs);

    expect(second).not.toBe(first);
    expect(second.chain.verifiedCount).toBe(5);
  });

  it('keeps organizations isolated from each other', () => {
    const orgOne = signedChain(3);
    const orgTwo = signedChain(9);

    const one = verifyOrganizationAuditChain('org-1', 1, orgOne);
    const two = verifyOrganizationAuditChain('org-2', 1, orgTwo);

    expect(one.chain.totalEntries).toBe(3);
    expect(two.chain.totalEntries).toBe(9);
    expect(verifyOrganizationAuditChain('org-1', 1, orgOne)).toBe(one);
  });
});

describe('verified chain reuse', () => {
  it('serves many pages from one verification', () => {
    const verified = verifyAuditChain(signedChain(250));

    const first = pageVerifiedAuditChain(verified, { offset: 0, limit: 100 });
    const second = pageVerifiedAuditChain(verified, { offset: 100, limit: 100 });

    expect(first.entries[0].verification.sequence).toBe(250);
    expect(second.entries[0].verification.sequence).toBe(150);
    expect(second.chain).toBe(first.chain);
  });

  it('agrees with the legacy whole-chain view for an unsigned chain', () => {
    // Legacy records carry no persisted hash metadata; they verify by computed
    // chain and must keep doing so.
    const legacy = Array.from({ length: 4 }, (_, i) => entry(i));

    const page = buildAuditTrailPage(legacy, {});

    expect(page.chain.signedCount).toBe(0);
    expect(page.chain.invalidCount).toBe(0);
    expect(page.entries.every(item => item.verification.persisted)).toBe(false);
    expect(page.entries.at(-1)?.verification.hash).toBe(hashAuditLog(legacy[0], AUDIT_GENESIS_HASH));
  });
});
