import express from 'express';
import { checkWineryScope } from '../middleware/auth';
import { createEmptyUserData, getUserData, saveUserData, type UserDataState } from '../db';
import { signAuditEntries } from '../../lib/auditHash';
import {
  CONNECTOR_CATALOG,
  INTEGRATION_DOMAINS,
  ONE_C_CONNECTOR_ID,
  SOURCE_OF_TRUTH_RULES,
  applyConnectorConfig,
  enqueueIntegrationJob,
  ensureIntegrationHubState,
  processIntegrationJob,
  redactConnector,
  redactSensitiveValue,
  resolveIntegrationConflict,
  retryIntegrationJob,
  saveFieldMappings,
  validateConnectorConfigInput,
  validateCreateSyncJobInput,
  validateFieldMappingInputs,
  type IntegrationHubState,
  type IntegrationSyncJob,
} from '../../lib/integrations';
import { sealIntegrationSecret } from '../integrationSecrets';
import { requireBillingFeature } from '../billing/middleware';
import { pullOneCEntitySet, testOneCConnection } from '../integrationTransport';
import {
  applyWineAgencyVerification,
  searchWineAgencyRegistry,
  wineAgencyIdentityMismatches,
  wineAgencyVerificationStatus,
  WINE_AGENCY_PORTAL_URL,
  WineAgencyRegistryError,
} from '../wineAgencyRegistry';

const router = express.Router();

function publicJob(job: IntegrationSyncJob): Omit<IntegrationSyncJob, 'inputPayload'> {
  const { inputPayload: _inputPayload, ...rest } = job;
  return rest;
}

function publicHub(hub: IntegrationHubState) {
  return {
    connectors: hub.connectors.map(redactConnector),
    mappings: hub.mappings,
    jobs: hub.jobs.map(publicJob),
    events: hub.events,
    externalRefs: hub.externalRefs,
    conflicts: hub.conflicts,
  };
}

async function getScopedData(username: string): Promise<UserDataState> {
  return await getUserData(username) || createEmptyUserData();
}

function integrationHubFor(data: UserDataState): IntegrationHubState {
  const hub = ensureIntegrationHubState((data as any).integrationHub);
  (data as any).integrationHub = hub;
  return hub;
}

function appendIntegrationAudit(
  data: UserDataState,
  actor: string,
  actionType: string,
  changedItem: string,
  newValue: unknown,
  notes: string,
) {
  const audit = {
    id: `audit-integration-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    user: actor,
    module: 'MARANIOS' as const,
    actionType,
    changedItem,
    oldValue: '',
    newValue: JSON.stringify(redactSensitiveValue(newValue)).slice(0, 1000),
    notes,
  };
  const signed = signAuditEntries([audit], data.auditLogs || [])[0] || audit;
  data.auditLogs = [signed, ...(data.auditLogs || [])];
}

export function validateConflictResolutionInput(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Conflict resolution must be an object.');
  }
  const resolution = String((input as any).resolution || '').trim();
  if (!resolution) throw new Error('Resolution note is required.');
  if (resolution.length > 500) throw new Error('Resolution note is too long.');
  return resolution;
}

router.get('/wine-agency/registry', checkWineryScope('admin'), async (req, res) => {
  try {
    const result = await searchWineAgencyRegistry({
      registrationNumber: String(req.query.registrationNumber || req.query.lotNumber || ''),
      companyName: String(req.query.companyName || ''),
    });
    return res.json({ ok: true, ...result, portalUrl: WINE_AGENCY_PORTAL_URL });
  } catch (error) {
    const statusCode = error instanceof WineAgencyRegistryError ? error.statusCode : 502;
    const message = error instanceof Error ? error.message : 'Wine Agency registry lookup failed.';
    return res.status(statusCode).json({ error: message });
  }
});

router.post('/wine-agency/registry/link', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
  try {
    const registrationNumber = String(req.body?.registrationNumber || '');
    // Resolve the record again server-side so a client cannot persist invented
    // verification evidence or stale producer details.
    const lookup = await searchWineAgencyRegistry({ registrationNumber }, { useCache: false });
    const entry = lookup.results.find(result => result.registrationNumber === registrationNumber.trim());
    if (!entry) return res.status(404).json({ error: 'Producer was not found in the Wine Agency public directory.' });

    const data = await getScopedData(session.username);
    const applied = applyWineAgencyVerification(data.companyProfile, entry);
    data.companyProfile = applied.profile;
    appendIntegrationAudit(
      data,
      session.username,
      'Wine Agency Producer Identity Verified',
      entry.registrationNumber,
      { verification: applied.verification, mismatches: applied.mismatches },
      'Producer identity was re-read from the Agency public directory before local verification evidence was saved.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({
      ok: true,
      companyProfile: data.companyProfile,
      verification: applied.verification,
      mismatches: applied.mismatches,
      status: wineAgencyVerificationStatus(data.companyProfile),
      portalUrl: WINE_AGENCY_PORTAL_URL,
    });
  } catch (error) {
    const statusCode = error instanceof WineAgencyRegistryError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Unable to link Wine Agency producer identity.';
    return res.status(statusCode).json({ error: message });
  }
});

router.post('/wine-agency/registry/reverify', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
  try {
    const data = await getScopedData(session.username);
    const linkedVerification = data.companyProfile.wineAgencyVerification;
    if (!linkedVerification?.registrationNumber) {
      return res.status(409).json({ error: 'Link a Wine Agency producer record before requesting a re-check.' });
    }

    // The server chooses the already-linked identity. No client-supplied
    // producer number can silently replace trusted verification evidence.
    const registrationNumber = linkedVerification.registrationNumber;
    const lookup = await searchWineAgencyRegistry({ registrationNumber }, { useCache: false });
    const entry = lookup.results.find(result => result.registrationNumber === registrationNumber);
    if (!entry) return res.status(404).json({ error: 'The linked producer was not found in the Wine Agency public directory.' });

    const applied = applyWineAgencyVerification(data.companyProfile, entry);
    data.companyProfile = applied.profile;
    appendIntegrationAudit(
      data,
      session.username,
      'Wine Agency Producer Identity Rechecked',
      entry.registrationNumber,
      { verification: applied.verification, mismatches: applied.mismatches },
      'The linked producer identity was re-read from the Agency public directory using the server-stored registration number.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({
      ok: true,
      companyProfile: data.companyProfile,
      verification: applied.verification,
      mismatches: applied.mismatches,
      status: wineAgencyVerificationStatus(data.companyProfile),
      portalUrl: WINE_AGENCY_PORTAL_URL,
    });
  } catch (error) {
    const statusCode = error instanceof WineAgencyRegistryError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Unable to re-check the linked Wine Agency producer identity.';
    return res.status(statusCode).json({ error: message });
  }
});

router.get('/connectors', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);

  res.json({
    ok: true,
    catalog: CONNECTOR_CATALOG,
    domains: INTEGRATION_DOMAINS,
    sourceOfTruth: SOURCE_OF_TRUTH_RULES,
    hub: publicHub(hub),
    wineAgency: {
      verification: data.companyProfile.wineAgencyVerification || null,
      mismatches: data.companyProfile.wineAgencyVerification
        ? wineAgencyIdentityMismatches(data.companyProfile, data.companyProfile.wineAgencyVerification)
        : [],
      status: wineAgencyVerificationStatus(data.companyProfile),
      portalUrl: WINE_AGENCY_PORTAL_URL,
    },
  });
});

router.post('/connectors/:connectorId/config', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  // Capture the raw credential BEFORE validation replaces it with the
  // '[provided]' marker; it is sealed server-side and never echoed back.
  const rawSecret = (['password', 'apiKey', 'bearerToken'] as const)
    .map((key) => (typeof (req.body as any)?.[key] === 'string' ? String((req.body as any)[key]).trim() : ''))
    .find(Boolean) || '';
  let input;
  try {
    input = validateConnectorConfigInput(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid connector configuration.' });
  }

  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);

  try {
    const connectorId = String(req.params.connectorId || '');
    const connector = applyConnectorConfig(hub, connectorId, input, session.username);
    if (rawSecret) {
      connector.sealedSecret = sealIntegrationSecret(rawSecret);
    }
    appendIntegrationAudit(
      data,
      session.username,
      'Integration Connector Configured',
      connector.displayName,
      {
        enabled: connector.enabled,
        authMode: connector.authMode,
        exchangeMode: connector.exchangeMode,
        endpointConfigured: Boolean(connector.endpointUrl),
        secretConfigured: connector.secretConfigured,
      },
      'Connector settings updated. Secrets are not stored in audit notes or returned to the UI.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({ ok: true, connector: redactConnector(connector), hub: publicHub(hub) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to configure connector.' });
  }
});

router.post('/connectors/:connectorId/mappings', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  let mappings;
  try {
    mappings = validateFieldMappingInputs(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid field mappings.' });
  }

  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);
  try {
    const connectorId = String(req.params.connectorId || '');
    const saved = saveFieldMappings(hub, connectorId, mappings, session.username);
    appendIntegrationAudit(
      data,
      session.username,
      'Integration Field Mappings Saved',
      connectorId,
      { count: saved.length },
      'Field mappings define controlled import/export translation. They do not grant direct database access.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({ ok: true, mappings: saved, hub: publicHub(hub) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to save field mappings.' });
  }
});

router.post('/jobs', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  let input;
  try {
    input = validateCreateSyncJobInput(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid sync job request.' });
  }

  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);

  try {
    const job = enqueueIntegrationJob(hub, input, session.username);
    const result = processIntegrationJob(hub, data as any, job.id, session.username);
    appendIntegrationAudit(
      data,
      session.username,
      `Integration ${job.direction === 'export' ? 'Export' : 'Import'} Job`,
      `${job.connectorId}:${job.domain}`,
      {
        jobId: job.id,
        status: result.job.status,
        recordCount: result.job.resultSummary?.recordCount || 0,
        conflicts: result.conflictCount,
      },
      job.direction === 'export'
        ? 'Manual export generated through the Integration Hub control layer.'
        : 'Manual import processed through source-of-truth rules and external ID mapping.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.status(201).json({ ok: true, job: publicJob(result.job), hub: publicHub(hub) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to create sync job.' });
  }
});

router.get('/jobs', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);
  res.json({
    ok: true,
    jobs: hub.jobs.map(publicJob),
    events: hub.events,
    conflicts: hub.conflicts,
    externalRefs: hub.externalRefs,
  });
});

router.post('/jobs/:jobId/retry', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);

  try {
    const jobId = String(req.params.jobId || '');
    const queued = retryIntegrationJob(hub, jobId, session.username);
    const result = processIntegrationJob(hub, data as any, queued.id, session.username);
    appendIntegrationAudit(
      data,
      session.username,
      'Integration Job Retried',
      queued.id,
      { jobId: queued.id, status: result.job.status, retryCount: result.job.retry_count },
      'Retry executed through the Integration Hub queue using existing external reference mappings for idempotency.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({ ok: true, job: publicJob(result.job), hub: publicHub(hub) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to retry sync job.' });
  }
});

// POST /api/integrations/connectors/:connectorId/test — live reachability probe
// against the configured 1C OData endpoint (SSRF-guarded server-side fetch).
router.post('/connectors/:connectorId/test', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);
  const connector = hub.connectors.find((c) => c.id === String(req.params.connectorId || ''));
  if (!connector) return res.status(404).json({ error: 'Unknown connector.' });

  try {
    const probe = await testOneCConnection(connector);
    appendIntegrationAudit(
      data,
      session.username,
      'Integration Connection Tested',
      connector.displayName,
      { ok: probe.ok, entitySets: probe.entitySets.length },
      'Live OData reachability probe executed server-side. Credentials never leave the server.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({ ok: true, probe: { ...probe, entitySets: probe.entitySets.slice(0, 40) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection test failed.';
    return res.status(502).json({ error: message });
  }
});

// POST /api/integrations/jobs/live-pull — fetch an entity set from 1C over
// OData and run it through the standard import pipeline (idempotent external
// refs, source-of-truth protection, conflicts for unmatched rows).
router.post('/jobs/live-pull', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  const entitySet = String((req.body as any)?.entitySet || '').trim();
  const domain = (req.body as any)?.domain;
  const top = Number((req.body as any)?.top) || 50;
  if (!entitySet) return res.status(400).json({ error: 'entitySet is required.' });

  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);
  const connector = hub.connectors.find((c) => c.id === ONE_C_CONNECTOR_ID);
  if (!connector) return res.status(404).json({ error: 'Unknown connector.' });

  let records;
  try {
    records = await pullOneCEntitySet(connector, entitySet, top);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : 'Live pull failed.' });
  }

  let input;
  try {
    input = validateCreateSyncJobInput({
      connectorId: ONE_C_CONNECTOR_ID,
      domain,
      direction: 'import',
      format: 'json',
      payloadName: `live:${entitySet}`,
      inputPayload: JSON.stringify(records),
    });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid live pull request.' });
  }

  try {
    const job = enqueueIntegrationJob(hub, input, session.username);
    const result = processIntegrationJob(hub, data as any, job.id, session.username);
    appendIntegrationAudit(
      data,
      session.username,
      'Integration Live Pull',
      `${ONE_C_CONNECTOR_ID}:${input.domain}`,
      {
        jobId: job.id,
        entitySet,
        rows: records.length,
        status: result.job.status,
        conflicts: result.conflictCount,
      },
      'Rows pulled from 1C over OData and processed through source-of-truth rules and external ID mapping.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.status(201).json({ ok: true, job: publicJob(result.job), hub: publicHub(hub) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to process live pull.' });
  }
});

router.post('/conflicts/:conflictId/resolve', checkWineryScope('admin'), requireBillingFeature('custom_integrations'), async (req, res) => {
  const session = (req as any).wineryContext;
  let resolution;
  try {
    resolution = validateConflictResolutionInput(req.body);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid conflict resolution.' });
  }

  const data = await getScopedData(session.username);
  const hub = integrationHubFor(data);
  try {
    const conflictId = String(req.params.conflictId || '');
    const conflict = resolveIntegrationConflict(hub, conflictId, session.username, resolution);
    appendIntegrationAudit(
      data,
      session.username,
      'Integration Conflict Resolved',
      conflict.id,
      { conflictId: conflict.id, domain: conflict.domain, resolution },
      'Administrator marked an integration conflict resolved after review.',
    );
    await saveUserData(session.username, data, { updatedBy: `api-integrations:${session.username}` });
    return res.json({ ok: true, conflict, hub: publicHub(hub) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to resolve conflict.' });
  }
});

export default router;
