/**
 * Memoizes audit-chain verification per organization state version.
 *
 * Verification is a SHA-256 per record over the whole chain: ~123 ms at the
 * 20,000-record sync ceiling, measured with the pure-JS implementation in
 * `lib/auditHash.ts`. That is event-loop time, and this service runs with
 * `--max-instances 1`, so it is time no other tenant's request is being served.
 * Paging the trail or walking it for a CSV export would otherwise re-verify the
 * identical chain once per page.
 *
 * The cache key is the organization's state version, which `saveOrganizationData`
 * increments on every write. That is deliberately stricter than a fingerprint
 * of the audit array: a fingerprint over length and tail hash cannot see a
 * record edited in the middle of the chain, and detecting exactly that edit is
 * the entire purpose of verifying. When the version is unavailable — the JSON
 * development store never assigns one — the chain is re-verified rather than
 * guessed at.
 */

import { verifyAuditChain, type VerifiedAuditChain } from '../lib/auditTrailPage';
import type { MaraniOSAuditLog } from '../lib/wineryState';

interface CacheEntry {
  version: number;
  verified: VerifiedAuditChain;
}

/**
 * Bounded so a long-lived instance holding many tenants cannot grow without
 * limit. Each entry is one verification index, not the records themselves.
 */
const MAX_CACHED_ORGANIZATIONS = 50;

const cache = new Map<string, CacheEntry>();

export function verifyOrganizationAuditChain(
  organizationId: string,
  version: number | null | undefined,
  logs: MaraniOSAuditLog[] | undefined | null,
): VerifiedAuditChain {
  if (typeof version !== 'number') {
    return verifyAuditChain(logs);
  }

  const cached = cache.get(organizationId);
  if (cached && cached.version === version) {
    // Refresh recency: re-inserting moves the key to the end of Map iteration
    // order, so the eviction below drops the least recently used organization.
    cache.delete(organizationId);
    cache.set(organizationId, cached);
    return cached.verified;
  }

  const verified = verifyAuditChain(logs);
  cache.delete(organizationId);
  cache.set(organizationId, { version, verified });

  while (cache.size > MAX_CACHED_ORGANIZATIONS) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }

  return verified;
}

/** Test seam; also used when an organization is deleted. */
export function clearAuditChainCache(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
}
