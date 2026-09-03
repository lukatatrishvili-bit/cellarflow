/**
 * Server-side audit trail: verified against the authoritative chain, returned
 * a page at a time.
 *
 * Before this endpoint the browser verified the chain itself, which forced it
 * to hold every audit record the organization had ever written — `auditLogs` is
 * the one collection `lib/retention.ts` says can never be windowed client-side,
 * because a chain missing its head verifies as entirely tampered. That made an
 * append-only collection part of the login payload and of every sync body, and
 * a winery writing ~100 audited actions a day crosses the 20,000-record sync
 * ceiling in about seven months. The first symptom is a rejected sync.
 *
 * Verifying here removes that constraint: the server has the whole chain
 * anyway, and this is also the stronger claim — it verifies the stored chain
 * rather than the copy the client already holds.
 */

import express from 'express';
import { checkWineryScope } from '../middleware/auth';
import { canAccess } from '../permissions';
import { getUserData, reloadUserOrganizationDataFromPostgres } from '../db';
import { verifyOrganizationAuditChain } from '../auditChainCache';
import {
  AUDIT_TRAIL_DEFAULT_LIMIT,
  AUDIT_TRAIL_MAX_LIMIT,
  pageVerifiedAuditChain,
  parseAuditModuleFilter,
} from '../../lib/auditTrailPage';

const router = express.Router();

/** Bounds what a search term can cost to evaluate against every record. */
const MAX_SEARCH_LENGTH = 200;

router.get('/', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;

  if (!canAccess(session.role, 'audit', 'view')) {
    return res.status(403).json({ error: 'Forbidden: audit view access required.' });
  }

  const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
  const userDb = refreshed?.data || (await getUserData(session.username));

  const verified = verifyOrganizationAuditChain(
    session.organizationId,
    refreshed?.meta.version ?? null,
    userDb?.auditLogs || [],
  );

  const search = typeof req.query.search === 'string'
    ? req.query.search.slice(0, MAX_SEARCH_LENGTH)
    : '';

  const page = pageVerifiedAuditChain(verified, {
    module: parseAuditModuleFilter(req.query.module),
    since: typeof req.query.since === 'string' ? req.query.since : null,
    search,
    offset: Number.parseInt(String(req.query.offset ?? '0'), 10),
    limit: Number.parseInt(String(req.query.limit ?? AUDIT_TRAIL_DEFAULT_LIMIT), 10),
  });

  res.json({ ...page, maxLimit: AUDIT_TRAIL_MAX_LIMIT });
});

export default router;
