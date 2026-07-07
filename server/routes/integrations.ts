import express from 'express';
import { checkWineryScope } from '../middleware/auth';
import { createEmptyUserData, getUserData, saveUserData, type UserDataState } from '../db';
import { signAuditEntries } from '../../lib/auditHash';
import {
  CONNECTOR_CATALOG,
  INTEGRATION_DOMAINS,
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
  });
});

router.post('/connectors/:connectorId/config', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
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

router.post('/connectors/:connectorId/mappings', checkWineryScope('admin'), async (req, res) => {
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

router.post('/jobs', checkWineryScope('admin'), async (req, res) => {
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

router.post('/jobs/:jobId/retry', checkWineryScope('admin'), async (req, res) => {
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

router.post('/conflicts/:conflictId/resolve', checkWineryScope('admin'), async (req, res) => {
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
