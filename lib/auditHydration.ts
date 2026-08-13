/**
 * How much of the audit chain the client is given.
 *
 * `auditLogs` only ever grows, and it used to be hydrated and re-sent whole:
 * a winery writing ~100 audited actions a day crosses the 20,000-record sync
 * ceiling in about seven months, and the first symptom is a rejected sync.
 * Every other append-only collection has a natural display window; this one did
 * not, because verifying a hash chain requires seeing it from entry #1.
 *
 * `GET /api/audit-trail` now verifies server-side over the stored chain, so the
 * client no longer needs the whole thing to show a verified trail. What it still
 * genuinely needs is recent context that must work offline: the dashboard's
 * latest-activity list, and audit entries a worker created while disconnected.
 * A bounded window covers both.
 *
 * Two consequences the callers must respect, both enforced by tests:
 *
 *   1. A windowed chain CANNOT be verified locally. `buildAuditHashChain`
 *      asserts `chainSequence === index + 1`, so a window starting at #501
 *      fails on its first record and reports every record as tampered. Code
 *      holding a window must say verification is unavailable — never that the
 *      records are invalid. `isWindowedAuditChain` is how you tell.
 *   2. Anything needing the full history for a record — the lot passport, which
 *      matches audit entries against a lot that may be years old — must read it
 *      from the server rather than filtering the window.
 *
 * Sending the window back on sync is safe: `mergeCollections` merges per record
 * and only ever deletes through explicit tombstones, so records absent from a
 * payload are left untouched on the server.
 */

import { sortAuditLogsForChain } from './auditHash';
import type { MaraniOSAuditLog } from './wineryState';

/**
 * Records retained client-side. Large enough that a disconnected cellar keeps
 * weeks of context, small enough that the collection stops driving state growth.
 */
export const AUDIT_HYDRATION_WINDOW = 500;

/**
 * The newest `limit` records, oldest-first — matching how the server stores the
 * collection, so a windowed payload stays a drop-in replacement for the full one.
 */
export function windowAuditLogsForHydration(
  logs: unknown,
  limit: number = AUDIT_HYDRATION_WINDOW,
): MaraniOSAuditLog[] {
  if (!Array.isArray(logs)) return [];
  if (logs.length <= limit) return logs as MaraniOSAuditLog[];
  return sortAuditLogsForChain(logs as MaraniOSAuditLog[]).slice(-limit);
}

/**
 * Whether these records are a window rather than a whole chain.
 *
 * Determined from the chain's own numbering: a complete chain starts at #1. A
 * legacy chain carries no `chainSequence` at all and is treated as complete,
 * which is correct — it verifies by computed chain rather than by sequence.
 */
export function isWindowedAuditChain(logs: MaraniOSAuditLog[] | undefined | null): boolean {
  if (!Array.isArray(logs) || logs.length === 0) return false;

  let lowest: number | null = null;
  for (const log of logs) {
    if (typeof log?.chainSequence !== 'number') continue;
    if (lowest === null || log.chainSequence < lowest) lowest = log.chainSequence;
  }

  return lowest !== null && lowest > 1;
}
