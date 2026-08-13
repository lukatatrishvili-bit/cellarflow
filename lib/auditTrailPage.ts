/**
 * Filtering, ordering, and windowing for the audit trail — applied *after* the
 * hash chain has been verified, never before.
 *
 * The ordering matters more than it looks. `buildAuditHashChain` verifies each
 * record against its predecessor and asserts `chainSequence === index + 1`, so
 * it can only ever run over the complete chain from entry #1. Hand it a window
 * and the first record fails, which makes every remaining record report as
 * tampered — the failure documented in `lib/retention.ts`. Truncation does not
 * degrade the audit trail, it invalidates it.
 *
 * That is why this module takes the whole chain, verifies it, and only then
 * filters and pages. A windowed response still carries chain-correct sequence
 * numbers and hashes, because they were computed with every earlier record
 * present. It is what lets a caller show page 40 of an audit trail without
 * holding pages 1–39.
 *
 * It lives in `lib/` rather than `server/` so the server (verifying the
 * authoritative chain) and the browser (falling back to its local mirror while
 * offline) produce identical ordering, search, and paging. A compliance view
 * that quietly reorders itself when the network drops is worse than one that
 * is simply unavailable.
 */

import {
  AUDIT_HASH_ALGORITHM,
  buildAuditHashChain,
  sortAuditLogsForChain,
  type AuditChainVerification,
} from './auditHash';
import type { MaraniOSAuditLog } from './wineryState';

export const AUDIT_MODULES = ['GVINO', 'VAZI', 'MARANIOS'] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];
export type AuditModuleFilter = 'all' | AuditModule;

/** Default page size for the trail view. */
export const AUDIT_TRAIL_DEFAULT_LIMIT = 100;
/**
 * Hard ceiling per request. Export walks pages rather than asking for
 * everything at once, so no single response has to be held whole in memory on
 * either side.
 */
export const AUDIT_TRAIL_MAX_LIMIT = 1_000;

export interface AuditTrailQuery {
  module?: AuditModuleFilter;
  /** ISO timestamp; records older than this are excluded. */
  since?: string | null;
  search?: string;
  offset?: number;
  limit?: number;
}

export interface VerifiedAuditEntry {
  log: MaraniOSAuditLog;
  verification: AuditChainVerification;
}

export interface AuditTrailChainStatus {
  rootHash: string;
  algorithm: string;
  /** Length of the whole chain, not of this page. */
  totalEntries: number;
  verifiedCount: number;
  invalidCount: number;
  signedCount: number;
}

export interface AuditTrailPage {
  entries: VerifiedAuditEntry[];
  /** Records matching the filter across the whole chain. */
  total: number;
  offset: number;
  limit: number;
  chain: AuditTrailChainStatus;
  moduleCounts: Record<AuditModule, number>;
}

export interface VerifiedAuditChain {
  /** Newest first — the order the trail is read in. */
  ordered: MaraniOSAuditLog[];
  byId: Record<string, AuditChainVerification>;
  chain: AuditTrailChainStatus;
  moduleCounts: Record<AuditModule, number>;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function parseAuditModuleFilter(value: unknown): AuditModuleFilter {
  return AUDIT_MODULES.includes(value as AuditModule) ? (value as AuditModule) : 'all';
}

/**
 * Verify the complete chain once and index it for reuse.
 *
 * Separated from paging because verification is the expensive half (a SHA-256
 * per record) and is identical for every page, filter, and search of the same
 * chain. Callers that serve many pages from one chain should hold this.
 */
export function verifyAuditChain(logs: MaraniOSAuditLog[] | undefined | null): VerifiedAuditChain {
  const all = Array.isArray(logs) ? logs : [];
  const summary = buildAuditHashChain(all);

  // Chain order is oldest-first because that is how it verifies; the trail is
  // read newest-first. Reversing the already-sorted chain keeps a single
  // ordering rule instead of two comparators that could drift apart.
  const ordered = sortAuditLogsForChain(all).reverse();

  const moduleCounts: Record<AuditModule, number> = { GVINO: 0, VAZI: 0, MARANIOS: 0 };
  for (const log of all) {
    if (log && AUDIT_MODULES.includes(log.module as AuditModule)) {
      moduleCounts[log.module as AuditModule] += 1;
    }
  }

  return {
    ordered,
    byId: summary.byId,
    moduleCounts,
    chain: {
      rootHash: summary.rootHash,
      algorithm: summary.algorithm || AUDIT_HASH_ALGORITHM,
      totalEntries: all.length,
      verifiedCount: summary.verifiedCount,
      invalidCount: summary.invalidCount,
      signedCount: summary.signedCount,
    },
  };
}

function matchesSearch(
  log: MaraniOSAuditLog,
  verification: AuditChainVerification | undefined,
  query: string,
): boolean {
  if (!query) return true;
  return [
    log.timestamp,
    log.module,
    log.user,
    log.actionType,
    log.changedItem,
    log.oldValue,
    log.newValue,
    log.notes,
    verification?.hash,
    verification?.sequence,
  ].some(value => String(value ?? '').toLowerCase().includes(query));
}

/** Window an already-verified chain. */
export function pageVerifiedAuditChain(
  verified: VerifiedAuditChain,
  query: AuditTrailQuery = {},
): AuditTrailPage {
  const moduleFilter = parseAuditModuleFilter(query.module ?? 'all');
  const search = (query.search || '').trim().toLowerCase();

  const cutoffValue = query.since ? new Date(query.since).getTime() : Number.NaN;
  const cutoff = Number.isFinite(cutoffValue) ? cutoffValue : null;

  const matching = verified.ordered.filter(log => {
    if (moduleFilter !== 'all' && log.module !== moduleFilter) return false;
    if (cutoff !== null) {
      const timestamp = new Date(log.timestamp).getTime();
      // An unparseable timestamp is kept rather than silently dropped: losing a
      // record from a compliance view is worse than showing an odd one.
      if (Number.isFinite(timestamp) && timestamp < cutoff) return false;
    }
    return matchesSearch(log, verified.byId[log.id], search);
  });

  const limit = clampInteger(query.limit, AUDIT_TRAIL_DEFAULT_LIMIT, 1, AUDIT_TRAIL_MAX_LIMIT);
  const offset = clampInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const entries = matching.slice(offset, offset + limit).map(log => ({
    log,
    verification: verified.byId[log.id],
  }));

  return {
    entries,
    total: matching.length,
    offset,
    limit,
    chain: verified.chain,
    moduleCounts: verified.moduleCounts,
  };
}

/** Verify and window in one step, for callers holding a chain only briefly. */
export function buildAuditTrailPage(
  logs: MaraniOSAuditLog[] | undefined | null,
  query: AuditTrailQuery = {},
): AuditTrailPage {
  return pageVerifiedAuditChain(verifyAuditChain(logs), query);
}
