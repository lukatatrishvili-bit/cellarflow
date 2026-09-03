import { describe, it, expect } from 'vitest';
import {
  AUDIT_HYDRATION_WINDOW,
  isWindowedAuditChain,
  windowAuditLogsForHydration,
} from '../lib/auditHydration';
import { buildAuditHashChain, signAuditEntries } from '../lib/auditHash';
import { buildAuditTrailPage } from '../lib/auditTrailPage';
import { redactWineryDatabaseForRole, buildSyncCandidate } from '../server/routes/sync';
import { createEmptyUserData } from '../server/db';
import type { MaraniOSAuditLog } from '../lib/wineryState';

function entry(index: number, overrides: Partial<MaraniOSAuditLog> = {}): MaraniOSAuditLog {
  return {
    id: `audit-${String(index).padStart(5, '0')}`,
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

function signedChain(count: number, overrides: (i: number) => Partial<MaraniOSAuditLog> = () => ({})) {
  return signAuditEntries(Array.from({ length: count }, (_, i) => entry(i, overrides(i))), []);
}

function stateWith(auditLogs: MaraniOSAuditLog[]): any {
  const state = createEmptyUserData() as any;
  state.auditLogs = auditLogs;
  return state;
}

describe('audit hydration window', () => {
  it('keeps a short chain whole', () => {
    const logs = signedChain(10);

    expect(windowAuditLogsForHydration(logs)).toHaveLength(10);
    expect(isWindowedAuditChain(logs)).toBe(false);
  });

  it('keeps the newest records when the chain exceeds the window', () => {
    const logs = signedChain(AUDIT_HYDRATION_WINDOW + 250);

    const windowed = windowAuditLogsForHydration(logs);

    expect(windowed).toHaveLength(AUDIT_HYDRATION_WINDOW);
    expect(windowed.at(-1)?.chainSequence).toBe(AUDIT_HYDRATION_WINDOW + 250);
    expect(windowed[0]?.chainSequence).toBe(251);
    expect(isWindowedAuditChain(windowed)).toBe(true);
  });

  it('windows by chain order, not stored array order', () => {
    const logs = signedChain(AUDIT_HYDRATION_WINDOW + 40);
    const shuffled = [...logs].reverse();

    const windowed = windowAuditLogsForHydration(shuffled);

    expect(windowed.at(-1)?.chainSequence).toBe(AUDIT_HYDRATION_WINDOW + 40);
    expect(windowed).toHaveLength(AUDIT_HYDRATION_WINDOW);
  });

  it('treats a legacy unsigned chain as complete', () => {
    // No chainSequence anywhere: these verify by computed chain, so there is no
    // missing head to warn about.
    const legacy = Array.from({ length: 5 }, (_, i) => entry(i));

    expect(isWindowedAuditChain(legacy)).toBe(false);
  });

  it('reports an empty or absent chain as not windowed', () => {
    expect(isWindowedAuditChain([])).toBe(false);
    expect(isWindowedAuditChain(undefined)).toBe(false);
    expect(windowAuditLogsForHydration(undefined)).toEqual([]);
  });

  it('records why a window cannot be verified locally', () => {
    // The behaviour the UI must not misreport: a window fails verification
    // wholesale because its first record is not chainSequence 1.
    const windowed = windowAuditLogsForHydration(signedChain(AUDIT_HYDRATION_WINDOW + 100));

    const summary = buildAuditHashChain(windowed);

    expect(summary.invalidCount).toBe(AUDIT_HYDRATION_WINDOW);
    expect(buildAuditTrailPage(windowed, {}).chain.invalidCount).toBe(AUDIT_HYDRATION_WINDOW);
    // Which is exactly why callers must consult this before showing validity.
    expect(isWindowedAuditChain(windowed)).toBe(true);
  });
});

describe('hydration responses', () => {
  it('windows auditLogs in the role-filtered snapshot', () => {
    const logs = signedChain(AUDIT_HYDRATION_WINDOW + 900);

    const response = redactWineryDatabaseForRole('Owner/Admin', stateWith(logs));

    expect(response.auditLogs).toHaveLength(AUDIT_HYDRATION_WINDOW);
    expect(response.auditLogs.at(-1).chainSequence).toBe(AUDIT_HYDRATION_WINDOW + 900);
  });

  it('leaves other collections untouched', () => {
    const state = stateWith(signedChain(AUDIT_HYDRATION_WINDOW + 10));
    state.lots = Array.from({ length: 900 }, (_, i) => ({ id: `lot-${i}`, name: `LOT-${i}` }));

    const response = redactWineryDatabaseForRole('Owner/Admin', state);

    expect(response.lots).toHaveLength(900);
  });

  it('does not window a chain that fits', () => {
    const logs = signedChain(12);

    const response = redactWineryDatabaseForRole('Owner/Admin', stateWith(logs));

    expect(response.auditLogs).toHaveLength(12);
    expect(isWindowedAuditChain(response.auditLogs)).toBe(false);
  });
});

describe('syncing a window back', () => {
  it('never deletes the history the client no longer holds', () => {
    // The property the whole change rests on. The client is hydrated with a
    // window, edits nothing, and syncs. If the merge treated an absent record
    // as a deletion, this would destroy the organization's audit chain.
    const full = signedChain(AUDIT_HYDRATION_WINDOW + 800);
    const serverState = stateWith(full);
    const clientWindow = windowAuditLogsForHydration(full);

    const { candidateDb, conflicts } = buildSyncCandidate(
      serverState,
      { auditLogs: clientWindow },
      undefined,
      'org-window',
    );

    expect(conflicts).toEqual([]);
    expect(candidateDb.auditLogs).toHaveLength(AUDIT_HYDRATION_WINDOW + 800);
    expect(buildAuditHashChain(candidateDb.auditLogs).invalidCount).toBe(0);
  });

  it('appends a record created offline without disturbing the chain', () => {
    const full = signedChain(AUDIT_HYDRATION_WINDOW + 300);
    const serverState = stateWith(full);
    const clientWindow = windowAuditLogsForHydration(full);

    // A worker records something offline. The client signs it against the
    // window it holds, so its sequence is provisional and wrong; the server
    // re-signs against the authoritative chain on merge.
    const offlineEntry = signAuditEntries([entry(99_999, { actionType: 'Racking' })], clientWindow)[0];
    expect(offlineEntry.chainSequence).toBe(AUDIT_HYDRATION_WINDOW + 1);

    const { candidateDb } = buildSyncCandidate(
      serverState,
      { auditLogs: [...clientWindow, offlineEntry] },
      undefined,
      'org-window',
    );

    expect(candidateDb.auditLogs).toHaveLength(AUDIT_HYDRATION_WINDOW + 301);
    expect(candidateDb.auditLogs.some((log: MaraniOSAuditLog) => log.id === offlineEntry.id)).toBe(true);
  });

  it('keeps the full chain verifiable server-side after a windowed sync', () => {
    const full = signedChain(AUDIT_HYDRATION_WINDOW + 400);
    const serverState = stateWith(full);

    const { candidateDb } = buildSyncCandidate(
      serverState,
      { auditLogs: windowAuditLogsForHydration(full) },
      undefined,
      'org-window',
    );

    const page = buildAuditTrailPage(candidateDb.auditLogs, { offset: 0, limit: 50 });
    expect(page.chain.totalEntries).toBe(AUDIT_HYDRATION_WINDOW + 400);
    expect(page.chain.invalidCount).toBe(0);
    expect(page.chain.verifiedCount).toBe(AUDIT_HYDRATION_WINDOW + 400);
  });
});
