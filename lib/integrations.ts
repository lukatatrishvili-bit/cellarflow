export const ONE_C_CONNECTOR_ID = 'one_c_accounting';

export type IntegrationConnectorKind = '1c_accounting';
export type IntegrationConnectorStatus = 'available' | 'configured' | 'disabled' | 'error';
export type IntegrationAuthMode = 'none' | 'basic' | 'api_key' | 'bearer' | 'oauth_placeholder';
export type IntegrationExchangeMode = 'manual_json_csv' | 'api_placeholder';
export type IntegrationSyncDirection = 'export' | 'import';
export type IntegrationSyncFormat = 'json' | 'csv';
export type IntegrationSyncJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'needs_review';
export type IntegrationConflictStatus = 'open' | 'resolved' | 'ignored';

export type IntegrationSyncDomain =
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'sales_dispatches'
  | 'sales_orders'
  | 'supplier_payments'
  | 'stock_movements'
  | 'cost_entries';

export interface IntegrationDomainDefinition {
  id: IntegrationSyncDomain;
  label: string;
  description: string;
  localCollectionKeys: string[];
}

export interface SourceOfTruthRule {
  domain: IntegrationSyncDomain;
  cellarFlowOwns: string[];
  externalOwns: string[];
  notes: string;
}

export interface IntegrationConnectorDefinition {
  id: string;
  kind: IntegrationConnectorKind;
  displayName: string;
  description: string;
  requiredSettings: string[];
  optionalSettings: string[];
  supportedDomains: IntegrationSyncDomain[];
  supportedDirections: IntegrationSyncDirection[];
  supportedFormats: IntegrationSyncFormat[];
  sourceOfTruthSummary: string;
}

export interface IntegrationConnectorConfig {
  id: string;
  kind: IntegrationConnectorKind;
  displayName: string;
  enabled: boolean;
  status: IntegrationConnectorStatus;
  endpointUrl: string;
  authMode: IntegrationAuthMode;
  username?: string;
  databaseName?: string;
  exchangeMode: IntegrationExchangeMode;
  defaultExportFormat: IntegrationSyncFormat;
  secretConfigured: boolean;
  authSecretUpdatedAt?: string;
  lastSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationFieldMapping {
  id: string;
  connectorId: string;
  domain: IntegrationSyncDomain;
  direction: IntegrationSyncDirection;
  localField: string;
  externalField: string;
  required: boolean;
  transform?: 'string' | 'number' | 'date' | 'boolean' | 'none';
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationSyncJob {
  id: string;
  connectorId: string;
  domain: IntegrationSyncDomain;
  direction: IntegrationSyncDirection;
  format: IntegrationSyncFormat;
  status: IntegrationSyncJobStatus;
  retry_count: number;
  last_error?: string;
  next_retry_at?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  createdBy: string;
  payloadName?: string;
  inputPayload?: unknown;
  resultSummary?: {
    recordCount: number;
    createdRefs?: number;
    updatedRefs?: number;
    conflictCount?: number;
    artifactBytes?: number;
  };
  exportArtifact?: {
    format: IntegrationSyncFormat;
    generatedAt: string;
    filename: string;
    content: string;
  };
}

export interface IntegrationSyncEvent {
  id: string;
  jobId?: string;
  connectorId: string;
  domain?: IntegrationSyncDomain;
  level: 'info' | 'warning' | 'error';
  action: string;
  message: string;
  createdAt: string;
  actor: string;
  metadata?: Record<string, unknown>;
}

export interface IntegrationExternalReference {
  id: string;
  connectorId: string;
  domain: IntegrationSyncDomain;
  localId: string;
  externalId: string;
  externalType?: string;
  displayName?: string;
  sourceOfTruth: 'cellarflow' | 'external' | 'shared';
  accounting?: Record<string, unknown>;
  lastJobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConflictRecord {
  id: string;
  connectorId: string;
  domain: IntegrationSyncDomain;
  jobId?: string;
  localId?: string;
  externalId?: string;
  status: IntegrationConflictStatus;
  reason: string;
  fieldPath?: string;
  localValue?: unknown;
  externalValue?: unknown;
  resolution?: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface IntegrationHubState {
  connectors: IntegrationConnectorConfig[];
  mappings: IntegrationFieldMapping[];
  jobs: IntegrationSyncJob[];
  events: IntegrationSyncEvent[];
  externalRefs: IntegrationExternalReference[];
  conflicts: IntegrationConflictRecord[];
}

export interface ConnectorConfigInput {
  enabled?: boolean;
  endpointUrl?: string;
  authMode?: IntegrationAuthMode;
  username?: string;
  databaseName?: string;
  exchangeMode?: IntegrationExchangeMode;
  defaultExportFormat?: IntegrationSyncFormat;
  password?: string;
  apiKey?: string;
  bearerToken?: string;
}

export interface FieldMappingInput {
  domain: IntegrationSyncDomain;
  direction: IntegrationSyncDirection;
  localField: string;
  externalField: string;
  required?: boolean;
  transform?: IntegrationFieldMapping['transform'];
}

export interface CreateSyncJobInput {
  connectorId: string;
  domain: IntegrationSyncDomain;
  direction: IntegrationSyncDirection;
  format?: IntegrationSyncFormat;
  payloadName?: string;
  inputPayload?: unknown;
}

export interface ProcessIntegrationJobResult {
  job: IntegrationSyncJob;
  createdRefs: number;
  updatedRefs: number;
  conflictCount: number;
}

type CollectionRecord = Record<string, unknown>;

const SENSITIVE_KEY = /password|passcode|secret|token|api[_-]?key|bearer/i;
const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_EVENTS = 1000;
const MAX_JOBS = 500;
const MAX_CONFLICTS = 500;

export const INTEGRATION_DOMAINS: IntegrationDomainDefinition[] = [
  {
    id: 'products',
    label: 'Products / nomenclature',
    description: 'Wine lots, bottled goods, and materials that may become 1C nomenclature.',
    localCollectionKeys: ['lots', 'inventory'],
  },
  {
    id: 'customers',
    label: 'Customers',
    description: 'Customer names derived from sales orders and dispatches.',
    localCollectionKeys: ['salesOrders', 'salesDispatches'],
  },
  {
    id: 'suppliers',
    label: 'Suppliers',
    description: 'Suppliers derived from grape intake, inventory, and supplier payments.',
    localCollectionKeys: ['grapeIntakes', 'inventory', 'supplierPayments'],
  },
  {
    id: 'sales_dispatches',
    label: 'Sales dispatches',
    description: 'Physical stock dispatches. Accounting posting state is owned by 1C.',
    localCollectionKeys: ['salesDispatches'],
  },
  {
    id: 'sales_orders',
    label: 'Sales orders',
    description: 'Reservations and commercial orders before/after fulfillment.',
    localCollectionKeys: ['salesOrders'],
  },
  {
    id: 'supplier_payments',
    label: 'Supplier payments',
    description: 'Operational payment records for grape supplier settlement review.',
    localCollectionKeys: ['supplierPayments'],
  },
  {
    id: 'stock_movements',
    label: 'Stock movements',
    description: 'Bottle movements in CellarFlow storage. Official valuation remains in 1C.',
    localCollectionKeys: ['stockMovements'],
  },
  {
    id: 'cost_entries',
    label: 'Cost entries',
    description: 'Winemaking cost ledger entries. Official accounting postings remain in 1C.',
    localCollectionKeys: ['costEntries'],
  },
];

export const SOURCE_OF_TRUTH_RULES: Record<IntegrationSyncDomain, SourceOfTruthRule> = {
  products: {
    domain: 'products',
    cellarFlowOwns: ['wine lot identity', 'variety', 'vintage', 'cellar stage', 'inventory material usage'],
    externalOwns: ['official nomenclature code', 'accounting category', 'tax class'],
    notes: 'CellarFlow exports operational products. 1C may return official nomenclature IDs and tax/accounting attributes.',
  },
  customers: {
    domain: 'customers',
    cellarFlowOwns: ['customer name captured on sales records'],
    externalOwns: ['legal customer code', 'VAT registration data', 'receivables status'],
    notes: 'Customer master data can be matched by external ID without letting 1C rewrite historical dispatches.',
  },
  suppliers: {
    domain: 'suppliers',
    cellarFlowOwns: ['supplier names on vineyard/cellar operations'],
    externalOwns: ['legal supplier code', 'VAT registration data', 'payables status'],
    notes: 'Supplier matching is idempotent through external references.',
  },
  sales_dispatches: {
    domain: 'sales_dispatches',
    cellarFlowOwns: ['physical dispatch', 'lot', 'location', 'bottle quantity', 'operator notes'],
    externalOwns: ['invoice number', 'document status', 'VAT/tax fields', 'payment status'],
    notes: '1C can annotate dispatches with accounting document state but cannot change traceability quantities.',
  },
  sales_orders: {
    domain: 'sales_orders',
    cellarFlowOwns: ['reservation', 'fulfillment link', 'lot', 'location', 'requested dispatch date'],
    externalOwns: ['official order number', 'accounting status', 'tax fields'],
    notes: 'CellarFlow remains the operational order source; 1C returns accounting identifiers.',
  },
  supplier_payments: {
    domain: 'supplier_payments',
    cellarFlowOwns: ['payment intent/operational note', 'supplier settlement context'],
    externalOwns: ['official payment document number', 'posting status', 'bank reconciliation status'],
    notes: '1C owns official payment posting and document numbering.',
  },
  stock_movements: {
    domain: 'stock_movements',
    cellarFlowOwns: ['lot traceability', 'storage location', 'movement direction', 'bottle count'],
    externalOwns: ['official inventory valuation', 'accounting posting status', 'tax/accounting period'],
    notes: '1C can return valuation and posting metadata, not rewrite physical stock movement facts.',
  },
  cost_entries: {
    domain: 'cost_entries',
    cellarFlowOwns: ['lot cost attribution', 'cellar cost category', 'operational source reference'],
    externalOwns: ['official accounting account', 'posted document number', 'tax treatment'],
    notes: 'Cost entries feed accounting review; 1C remains the accounting ledger of record.',
  },
};

export const CONNECTOR_CATALOG: IntegrationConnectorDefinition[] = [
  {
    id: ONE_C_CONNECTOR_ID,
    kind: '1c_accounting',
    displayName: '1C Connector',
    description: 'Safe placeholder for future 1C accounting/ERP synchronization via manual JSON/CSV exchange first.',
    requiredSettings: ['Endpoint URL or exchange folder reference', 'Authentication mode'],
    optionalSettings: ['Username', '1C database name', 'Secret reference managed outside CellarFlow'],
    supportedDomains: INTEGRATION_DOMAINS.map((domain) => domain.id),
    supportedDirections: ['export', 'import'],
    supportedFormats: ['json', 'csv'],
    sourceOfTruthSummary: 'CellarFlow owns production and traceability; 1C owns accounting documents, payments, official IDs, valuation, VAT/tax, and posting state.',
  },
];

export function createEmptyIntegrationHubState(now = new Date().toISOString()): IntegrationHubState {
  return {
    connectors: [defaultOneCConnector(now)],
    mappings: [],
    jobs: [],
    events: [],
    externalRefs: [],
    conflicts: [],
  };
}

export function ensureIntegrationHubState(input: Partial<IntegrationHubState> | null | undefined): IntegrationHubState {
  const now = new Date().toISOString();
  const empty = createEmptyIntegrationHubState(now);
  const connectors = Array.isArray(input?.connectors) ? input!.connectors : [];
  const byId = new Map<string, IntegrationConnectorConfig>();

  for (const connector of empty.connectors) {
    byId.set(connector.id, connector);
  }
  for (const connector of connectors) {
    if (!connector || typeof connector !== 'object') continue;
    byId.set(String(connector.id || ONE_C_CONNECTOR_ID), {
      ...defaultOneCConnector(now),
      ...connector,
      id: String(connector.id || ONE_C_CONNECTOR_ID),
      kind: '1c_accounting',
      displayName: connector.displayName || '1C Connector',
      exchangeMode: connector.exchangeMode || 'manual_json_csv',
      defaultExportFormat: connector.defaultExportFormat || 'json',
      secretConfigured: Boolean(connector.secretConfigured),
    });
  }

  return {
    connectors: Array.from(byId.values()),
    mappings: Array.isArray(input?.mappings) ? input!.mappings : [],
    jobs: Array.isArray(input?.jobs) ? input!.jobs : [],
    events: Array.isArray(input?.events) ? input!.events : [],
    externalRefs: Array.isArray(input?.externalRefs) ? input!.externalRefs : [],
    conflicts: Array.isArray(input?.conflicts) ? input!.conflicts : [],
  };
}

export function defaultOneCConnector(now = new Date().toISOString()): IntegrationConnectorConfig {
  return {
    id: ONE_C_CONNECTOR_ID,
    kind: '1c_accounting',
    displayName: '1C Connector',
    enabled: false,
    status: 'available',
    endpointUrl: '',
    authMode: 'none',
    exchangeMode: 'manual_json_csv',
    defaultExportFormat: 'json',
    secretConfigured: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((child) => redactSensitiveValue(child));
  if (!value || typeof value !== 'object') return value;

  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    cleaned[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redactSensitiveValue(child);
  }
  return cleaned;
}

export function redactConnector(connector: IntegrationConnectorConfig): IntegrationConnectorConfig {
  const redacted = connector.lastError
    ? redactSensitiveValue({ lastError: connector.lastError }) as { lastError?: string }
    : {};
  return {
    ...connector,
    lastError: redacted.lastError || connector.lastError,
  };
}

export function validateConnectorConfigInput(input: unknown): ConnectorConfigInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Connector configuration must be an object.');
  }
  const body = input as Record<string, unknown>;
  const next: ConnectorConfigInput = {};

  if (body.enabled !== undefined) next.enabled = Boolean(body.enabled);
  if (body.endpointUrl !== undefined) {
    next.endpointUrl = String(body.endpointUrl || '').trim();
    if (next.endpointUrl.length > 500) throw new Error('Endpoint URL is too long.');
  }
  if (body.authMode !== undefined) {
    if (!isAuthMode(body.authMode)) throw new Error('Unsupported authentication mode.');
    next.authMode = body.authMode;
  }
  if (body.username !== undefined) next.username = String(body.username || '').trim().slice(0, 200);
  if (body.databaseName !== undefined) next.databaseName = String(body.databaseName || '').trim().slice(0, 200);
  if (body.exchangeMode !== undefined) {
    if (body.exchangeMode !== 'manual_json_csv' && body.exchangeMode !== 'api_placeholder') {
      throw new Error('Unsupported exchange mode.');
    }
    next.exchangeMode = body.exchangeMode;
  }
  if (body.defaultExportFormat !== undefined) {
    if (!isSyncFormat(body.defaultExportFormat)) throw new Error('Unsupported default export format.');
    next.defaultExportFormat = body.defaultExportFormat;
  }
  for (const secretKey of ['password', 'apiKey', 'bearerToken'] as const) {
    if (body[secretKey] !== undefined && String(body[secretKey] || '').trim()) {
      next[secretKey] = '[provided]';
    }
  }
  return next;
}

export function applyConnectorConfig(
  hub: IntegrationHubState,
  connectorId: string,
  input: ConnectorConfigInput,
  actor: string,
  now = new Date().toISOString(),
): IntegrationConnectorConfig {
  if (connectorId !== ONE_C_CONNECTOR_ID) throw new Error('Unknown connector.');
  const normalized = ensureIntegrationHubState(hub);
  Object.assign(hub, normalized);
  const existing = hub.connectors.find((connector) => connector.id === connectorId) || defaultOneCConnector(now);
  const secretProvided = Boolean(input.password || input.apiKey || input.bearerToken);
  const next: IntegrationConnectorConfig = {
    ...existing,
    enabled: input.enabled ?? existing.enabled,
    endpointUrl: input.endpointUrl ?? existing.endpointUrl,
    authMode: input.authMode ?? existing.authMode,
    username: input.username ?? existing.username,
    databaseName: input.databaseName ?? existing.databaseName,
    exchangeMode: input.exchangeMode ?? existing.exchangeMode,
    defaultExportFormat: input.defaultExportFormat ?? existing.defaultExportFormat,
    secretConfigured: secretProvided ? true : existing.secretConfigured,
    authSecretUpdatedAt: secretProvided ? now : existing.authSecretUpdatedAt,
    status: input.enabled === false ? 'disabled' : 'configured',
    updatedAt: now,
  };

  const index = hub.connectors.findIndex((connector) => connector.id === connectorId);
  if (index === -1) {
    hub.connectors.unshift(next);
  } else {
    hub.connectors[index] = next;
  }
  addIntegrationEvent(hub, {
    connectorId,
    level: 'info',
    action: 'connector.configure',
    message: `${next.displayName} configuration updated.`,
    actor,
    metadata: {
      enabled: next.enabled,
      authMode: next.authMode,
      exchangeMode: next.exchangeMode,
      endpointConfigured: Boolean(next.endpointUrl),
      secretConfigured: next.secretConfigured,
    },
  }, now);
  return next;
}

export function validateFieldMappingInputs(input: unknown): FieldMappingInput[] {
  const list = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as any).mappings)
      ? (input as any).mappings
      : null;
  if (!list) throw new Error('Mappings must be an array.');

  return list.map((raw: unknown, index: number) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Mapping ${index + 1} must be an object.`);
    }
    const candidate = raw as Record<string, unknown>;
    if (!isSyncDomain(candidate.domain)) throw new Error(`Mapping ${index + 1} has an unsupported domain.`);
    if (!isSyncDirection(candidate.direction)) throw new Error(`Mapping ${index + 1} has an unsupported direction.`);
    const localField = String(candidate.localField || '').trim();
    const externalField = String(candidate.externalField || '').trim();
    if (!localField || !externalField) throw new Error(`Mapping ${index + 1} requires localField and externalField.`);
    if (localField.length > 160 || externalField.length > 160) throw new Error(`Mapping ${index + 1} field names are too long.`);
    const transform = candidate.transform === undefined ? 'none' : candidate.transform;
    if (!['string', 'number', 'date', 'boolean', 'none'].includes(String(transform))) {
      throw new Error(`Mapping ${index + 1} has an unsupported transform.`);
    }
    return {
      domain: candidate.domain,
      direction: candidate.direction,
      localField,
      externalField,
      required: Boolean(candidate.required),
      transform: transform as FieldMappingInput['transform'],
    };
  });
}

export function saveFieldMappings(
  hub: IntegrationHubState,
  connectorId: string,
  mappings: FieldMappingInput[],
  actor: string,
  now = new Date().toISOString(),
): IntegrationFieldMapping[] {
  if (connectorId !== ONE_C_CONNECTOR_ID) throw new Error('Unknown connector.');
  const normalized = ensureIntegrationHubState(hub);
  Object.assign(hub, normalized);

  const keys = new Set(mappings.map((mapping) => mappingKey(connectorId, mapping)));
  hub.mappings = hub.mappings.filter((mapping) => !keys.has(mappingKey(connectorId, mapping)));

  const saved = mappings.map((mapping) => ({
    id: newIntegrationId('map'),
    connectorId,
    domain: mapping.domain,
    direction: mapping.direction,
    localField: mapping.localField,
    externalField: mapping.externalField,
    required: Boolean(mapping.required),
    transform: mapping.transform || 'none',
    createdAt: now,
    updatedAt: now,
  }));

  hub.mappings.unshift(...saved);
  addIntegrationEvent(hub, {
    connectorId,
    level: 'info',
    action: 'mappings.save',
    message: `${saved.length} field mapping${saved.length === 1 ? '' : 's'} saved.`,
    actor,
    metadata: { count: saved.length },
  }, now);
  return saved;
}

export function validateCreateSyncJobInput(input: unknown): CreateSyncJobInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Sync job request must be an object.');
  }
  const body = input as Record<string, unknown>;
  const connectorId = String(body.connectorId || '').trim();
  if (connectorId !== ONE_C_CONNECTOR_ID) throw new Error('Unknown connector.');
  if (!isSyncDomain(body.domain)) throw new Error('Unsupported sync domain.');
  if (!isSyncDirection(body.direction)) throw new Error('Unsupported sync direction.');
  const format = body.format === undefined ? 'json' : body.format;
  if (!isSyncFormat(format)) throw new Error('Unsupported sync format.');
  if (body.direction === 'import' && body.inputPayload === undefined) {
    throw new Error('Import jobs require an input payload.');
  }
  return {
    connectorId,
    domain: body.domain,
    direction: body.direction,
    format,
    payloadName: body.payloadName ? String(body.payloadName).trim().slice(0, 240) : undefined,
    inputPayload: body.inputPayload,
  };
}

export function enqueueIntegrationJob(
  hub: IntegrationHubState,
  input: CreateSyncJobInput,
  actor: string,
  now = new Date().toISOString(),
): IntegrationSyncJob {
  const normalized = ensureIntegrationHubState(hub);
  Object.assign(hub, normalized);
  const connector = hub.connectors.find((candidate) => candidate.id === input.connectorId);
  if (!connector) throw new Error('Connector is not available.');
  if (!connector.enabled) throw new Error('Connector must be enabled before creating sync jobs.');

  const job: IntegrationSyncJob = {
    id: newIntegrationId('job'),
    connectorId: input.connectorId,
    domain: input.domain,
    direction: input.direction,
    format: input.format || connector.defaultExportFormat || 'json',
    status: 'pending',
    retry_count: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    payloadName: input.payloadName,
    inputPayload: input.direction === 'import' ? input.inputPayload : undefined,
  };

  hub.jobs.unshift(job);
  capArray(hub.jobs, MAX_JOBS);
  addIntegrationEvent(hub, {
    jobId: job.id,
    connectorId: job.connectorId,
    domain: job.domain,
    level: 'info',
    action: 'job.enqueue',
    message: `${job.direction} job queued for ${job.domain}.`,
    actor,
  }, now);
  return job;
}

export function processIntegrationJob(
  hub: IntegrationHubState,
  orgData: Record<string, unknown>,
  jobId: string,
  actor: string,
  now = new Date().toISOString(),
): ProcessIntegrationJobResult {
  const normalized = ensureIntegrationHubState(hub);
  Object.assign(hub, normalized);
  const job = hub.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error('Sync job not found.');
  const connector = hub.connectors.find((candidate) => candidate.id === job.connectorId);
  if (!connector || !connector.enabled) throw new Error('Connector is not enabled.');

  job.status = 'running';
  job.startedAt = now;
  job.updatedAt = now;
  job.last_error = undefined;
  addIntegrationEvent(hub, {
    jobId: job.id,
    connectorId: job.connectorId,
    domain: job.domain,
    level: 'info',
    action: 'job.running',
    message: `Started ${job.direction} job.`,
    actor,
  }, now);

  try {
    let result: ProcessIntegrationJobResult;
    if (job.direction === 'export') {
      result = processExportJob(hub, orgData, job, actor, now);
    } else {
      result = processImportJob(hub, orgData, job, actor, now);
    }

    const completedAt = new Date().toISOString();
    job.completedAt = completedAt;
    job.updatedAt = completedAt;
    job.status = result.conflictCount > 0 ? 'needs_review' : 'succeeded';
    job.resultSummary = {
      recordCount: job.resultSummary?.recordCount || 0,
      createdRefs: result.createdRefs,
      updatedRefs: result.updatedRefs,
      conflictCount: result.conflictCount,
      artifactBytes: job.exportArtifact ? byteLength(job.exportArtifact.content) : undefined,
    };
    connector.lastSyncAt = completedAt;
    if (job.status === 'succeeded') connector.lastSuccessfulSyncAt = completedAt;
    connector.lastError = undefined;
    connector.status = 'configured';
    connector.updatedAt = completedAt;
    addIntegrationEvent(hub, {
      jobId: job.id,
      connectorId: job.connectorId,
      domain: job.domain,
      level: job.status === 'needs_review' ? 'warning' : 'info',
      action: `job.${job.status}`,
      message: job.status === 'needs_review'
        ? `${result.conflictCount} conflict${result.conflictCount === 1 ? '' : 's'} need review.`
        : `Job completed successfully.`,
      actor,
      metadata: job.resultSummary,
    }, completedAt);
    return result;
  } catch (err) {
    const failedAt = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.completedAt = failedAt;
    job.updatedAt = failedAt;
    const redacted = redactSensitiveValue({ error: message }) as { error?: string };
    job.last_error = redacted.error || message;
    job.next_retry_at = new Date(Date.now() + Math.min(60, Math.max(1, job.retry_count + 1)) * 60_000).toISOString();
    connector.lastError = job.last_error;
    connector.status = 'error';
    connector.updatedAt = failedAt;
    addIntegrationEvent(hub, {
      jobId: job.id,
      connectorId: job.connectorId,
      domain: job.domain,
      level: 'error',
      action: 'job.failed',
      message: job.last_error || 'Job failed.',
      actor,
    }, failedAt);
    return { job, createdRefs: 0, updatedRefs: 0, conflictCount: 0 };
  }
}

export function retryIntegrationJob(
  hub: IntegrationHubState,
  jobId: string,
  actor: string,
  now = new Date().toISOString(),
): IntegrationSyncJob {
  const job = hub.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error('Sync job not found.');
  if (job.status !== 'failed' && job.status !== 'needs_review') {
    throw new Error('Only failed or needs-review jobs can be retried.');
  }
  job.status = 'pending';
  job.retry_count += 1;
  job.last_error = undefined;
  job.next_retry_at = undefined;
  job.updatedAt = now;
  job.startedAt = undefined;
  job.completedAt = undefined;
  addIntegrationEvent(hub, {
    jobId: job.id,
    connectorId: job.connectorId,
    domain: job.domain,
    level: 'info',
    action: 'job.retry',
    message: `Job queued for retry ${job.retry_count}.`,
    actor,
  }, now);
  return job;
}

export function resolveIntegrationConflict(
  hub: IntegrationHubState,
  conflictId: string,
  actor: string,
  resolution: string,
  now = new Date().toISOString(),
): IntegrationConflictRecord {
  const conflict = hub.conflicts.find((candidate) => candidate.id === conflictId);
  if (!conflict) throw new Error('Conflict not found.');
  conflict.status = 'resolved';
  conflict.resolution = resolution.trim().slice(0, 500) || 'Resolved by administrator';
  conflict.resolvedAt = now;
  conflict.resolvedBy = actor;
  addIntegrationEvent(hub, {
    jobId: conflict.jobId,
    connectorId: conflict.connectorId,
    domain: conflict.domain,
    level: 'info',
    action: 'conflict.resolve',
    message: `Conflict resolved for ${conflict.domain}.`,
    actor,
    metadata: {
      conflictId,
      localId: conflict.localId,
      externalId: conflict.externalId,
    },
  }, now);
  return conflict;
}

export function collectDomainRecords(domain: IntegrationSyncDomain, orgData: Record<string, unknown>): CollectionRecord[] {
  const asRecords = (key: string) => Array.isArray(orgData[key]) ? orgData[key] as CollectionRecord[] : [];

  if (domain === 'products') {
    const lots = asRecords('lots').map((lot) => ({
      kind: 'wine_lot',
      localId: String(lot.id || ''),
      name: lot.name || lot.id,
      vintage: lot.vintage,
      variety: lot.variety,
      wineClass: lot.wineClass,
      stage: lot.stage,
      currentVolumeL: lot.currentVolume,
    }));
    const inventory = asRecords('inventory').map((item) => ({
      kind: 'inventory_item',
      localId: String(item.id || ''),
      name: item.name || item.id,
      category: item.category,
      unit: item.unit,
      stock: item.stock,
      supplierName: item.supplierName,
    }));
    return [...lots, ...inventory].filter((record) => record.localId);
  }

  if (domain === 'customers') {
    const names = new Set<string>();
    for (const record of [...asRecords('salesOrders'), ...asRecords('salesDispatches')]) {
      const name = String(record.customerName || '').trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort().map((name) => ({
      localId: stablePartyId('customer', name),
      name,
    }));
  }

  if (domain === 'suppliers') {
    const names = new Set<string>();
    for (const record of [...asRecords('inventory'), ...asRecords('grapeIntakes'), ...asRecords('supplierPayments')]) {
      const name = String(record.supplierName || '').trim();
      if (name) names.add(name);
    }
    return Array.from(names).sort().map((name) => ({
      localId: stablePartyId('supplier', name),
      name,
    }));
  }

  const keyByDomain: Record<Exclude<IntegrationSyncDomain, 'products' | 'customers' | 'suppliers'>, string> = {
    sales_dispatches: 'salesDispatches',
    sales_orders: 'salesOrders',
    supplier_payments: 'supplierPayments',
    stock_movements: 'stockMovements',
    cost_entries: 'costEntries',
  };

  return asRecords(keyByDomain[domain]).map((record) => ({
    ...record,
    localId: String(record.id || record.localId || ''),
  })).filter((record) => record.localId);
}

export function serializeRecords(format: IntegrationSyncFormat, records: CollectionRecord[]): string {
  if (format === 'json') return JSON.stringify({ records }, null, 2);
  return recordsToCsv(records);
}

export function parseManualImportPayload(format: IntegrationSyncFormat, payload: unknown): CollectionRecord[] {
  if (format === 'json') {
    const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (Array.isArray(parsed)) return parsed.filter(isPlainObject) as CollectionRecord[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).records)) {
      return (parsed as any).records.filter(isPlainObject) as CollectionRecord[];
    }
    throw new Error('JSON import payload must be an array or an object with a records array.');
  }

  if (typeof payload !== 'string') throw new Error('CSV import payload must be a string.');
  return csvToRecords(payload);
}

export function domainAllowsExternalField(domain: IntegrationSyncDomain, field: string): boolean {
  const normalized = field.toLowerCase();
  const allowedFragments = [
    'account',
    'official',
    'invoice',
    'document',
    'doc',
    'payment',
    'posting',
    'posted',
    'tax',
    'vat',
    'valuation',
    'external',
    'nomenclature',
    'legal',
    'reconciliation',
  ];
  return SOURCE_OF_TRUTH_RULES[domain].externalOwns.some((owned) => owned.toLowerCase().includes(normalized))
    || allowedFragments.some((fragment) => normalized.includes(fragment));
}

export function isSyncDomain(value: unknown): value is IntegrationSyncDomain {
  return typeof value === 'string' && INTEGRATION_DOMAINS.some((domain) => domain.id === value);
}

export function isSyncDirection(value: unknown): value is IntegrationSyncDirection {
  return value === 'export' || value === 'import';
}

export function isSyncFormat(value: unknown): value is IntegrationSyncFormat {
  return value === 'json' || value === 'csv';
}

export function isAuthMode(value: unknown): value is IntegrationAuthMode {
  return value === 'none' || value === 'basic' || value === 'api_key' || value === 'bearer' || value === 'oauth_placeholder';
}

export function newIntegrationId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

function processExportJob(
  hub: IntegrationHubState,
  orgData: Record<string, unknown>,
  job: IntegrationSyncJob,
  _actor: string,
  now: string,
): ProcessIntegrationJobResult {
  const localRecords = collectDomainRecords(job.domain, orgData);
  const records = localRecords.map((record) => {
    const localId = String(record.localId || record.id || '');
    const ref = localId
      ? hub.externalRefs.find((candidate) => candidate.connectorId === job.connectorId && candidate.domain === job.domain && candidate.localId === localId)
      : null;
    return {
      ...record,
      cellarflowLocalId: localId,
      externalId: ref?.externalId || '',
      sourceOfTruth: SOURCE_OF_TRUTH_RULES[job.domain],
    };
  });
  const content = serializeRecords(job.format, records);
  job.exportArtifact = {
    format: job.format,
    generatedAt: now,
    filename: `cellarflow_${job.domain}_${now.replace(/[:.]/g, '-')}.${job.format}`,
    content,
  };
  job.resultSummary = {
    recordCount: records.length,
    artifactBytes: byteLength(content),
    createdRefs: 0,
    updatedRefs: 0,
    conflictCount: 0,
  };
  return { job, createdRefs: 0, updatedRefs: 0, conflictCount: 0 };
}

function processImportJob(
  hub: IntegrationHubState,
  orgData: Record<string, unknown>,
  job: IntegrationSyncJob,
  actor: string,
  now: string,
): ProcessIntegrationJobResult {
  const records = parseManualImportPayload(job.format, job.inputPayload);
  let createdRefs = 0;
  let updatedRefs = 0;
  let conflictCount = 0;

  for (const record of records) {
    const domain = isSyncDomain(record.domain) ? record.domain : job.domain;
    if (domain !== job.domain) {
      conflictCount += createConflict(hub, job, domain, {
        reason: `Record domain ${domain} does not match job domain ${job.domain}.`,
        externalId: stringOrUndefined(record.externalId),
        externalValue: record,
      }, now);
      continue;
    }

    const externalId = String(record.externalId || record.external_id || record.ref || '').trim();
    if (!externalId) {
      conflictCount += createConflict(hub, job, domain, {
        reason: 'Imported record is missing externalId.',
        localId: stringOrUndefined(record.localId || record.cellarflowLocalId),
        externalValue: record,
      }, now);
      continue;
    }

    const existingByExternal = hub.externalRefs.find((ref) =>
      ref.connectorId === job.connectorId && ref.domain === domain && ref.externalId === externalId);
    const localId = String(record.localId || record.cellarflowLocalId || existingByExternal?.localId || '').trim();
    const localRecord = localId ? findLocalRecord(domain, localId, orgData) : null;
    if (!localId || !localRecord) {
      conflictCount += createConflict(hub, job, domain, {
        reason: 'Imported external record could not be matched to a CellarFlow record.',
        localId: localId || undefined,
        externalId,
        externalValue: record,
      }, now);
      continue;
    }

    const protectedConflict = findProtectedFieldConflict(domain, localRecord, record);
    if (protectedConflict) {
      conflictCount += createConflict(hub, job, domain, {
        reason: 'External payload attempted to change a CellarFlow-owned operational field.',
        localId,
        externalId,
        fieldPath: protectedConflict.field,
        localValue: protectedConflict.localValue,
        externalValue: protectedConflict.externalValue,
      }, now);
      continue;
    }

    const accounting = pickExternalOwnedFields(domain, record);
    const upsert = upsertExternalReference(hub, {
      connectorId: job.connectorId,
      domain,
      localId,
      externalId,
      externalType: stringOrUndefined(record.externalType || record.type),
      displayName: stringOrUndefined(record.displayName || record.name || record.documentNumber || record.invoiceNumber),
      sourceOfTruth: 'shared',
      accounting,
      lastJobId: job.id,
    }, now);
    if (upsert.created) createdRefs += 1;
    if (upsert.updated) updatedRefs += 1;
    addIntegrationEvent(hub, {
      jobId: job.id,
      connectorId: job.connectorId,
      domain,
      level: 'info',
      action: upsert.created ? 'external_ref.create' : 'external_ref.update',
      message: `Mapped ${domain} ${localId} to external ID ${externalId}.`,
      actor,
      metadata: { localId, externalId },
    }, now);
  }

  job.resultSummary = {
    recordCount: records.length,
    createdRefs,
    updatedRefs,
    conflictCount,
  };
  return { job, createdRefs, updatedRefs, conflictCount };
}

function upsertExternalReference(
  hub: IntegrationHubState,
  input: Omit<IntegrationExternalReference, 'id' | 'createdAt' | 'updatedAt'>,
  now: string,
): { ref: IntegrationExternalReference; created: boolean; updated: boolean } {
  const existing = hub.externalRefs.find((ref) =>
    ref.connectorId === input.connectorId &&
    ref.domain === input.domain &&
    (ref.externalId === input.externalId || ref.localId === input.localId));

  if (existing) {
    existing.localId = input.localId;
    existing.externalId = input.externalId;
    existing.externalType = input.externalType;
    existing.displayName = input.displayName;
    existing.sourceOfTruth = input.sourceOfTruth;
    existing.accounting = input.accounting;
    existing.lastJobId = input.lastJobId;
    existing.updatedAt = now;
    return { ref: existing, created: false, updated: true };
  }

  const ref: IntegrationExternalReference = {
    ...input,
    id: newIntegrationId('xref'),
    createdAt: now,
    updatedAt: now,
  };
  hub.externalRefs.unshift(ref);
  return { ref, created: true, updated: false };
}

function addIntegrationEvent(
  hub: IntegrationHubState,
  event: Omit<IntegrationSyncEvent, 'id' | 'createdAt'>,
  now = new Date().toISOString(),
): IntegrationSyncEvent {
  const item: IntegrationSyncEvent = {
    ...event,
    id: newIntegrationId('evt'),
    createdAt: now,
    metadata: event.metadata ? redactSensitiveValue(event.metadata) as Record<string, unknown> : undefined,
  };
  hub.events.unshift(item);
  capArray(hub.events, MAX_EVENTS);
  return item;
}

function createConflict(
  hub: IntegrationHubState,
  job: IntegrationSyncJob,
  domain: IntegrationSyncDomain,
  input: Pick<IntegrationConflictRecord, 'reason' | 'localId' | 'externalId' | 'fieldPath' | 'localValue' | 'externalValue'>,
  now: string,
): number {
  const conflict: IntegrationConflictRecord = {
    id: newIntegrationId('conf'),
    connectorId: job.connectorId,
    domain,
    jobId: job.id,
    localId: input.localId,
    externalId: input.externalId,
    status: 'open',
    reason: input.reason,
    fieldPath: input.fieldPath,
    localValue: input.localValue,
    externalValue: redactSensitiveValue(input.externalValue),
    createdAt: now,
  };
  hub.conflicts.unshift(conflict);
  capArray(hub.conflicts, MAX_CONFLICTS);
  return 1;
}

function findProtectedFieldConflict(domain: IntegrationSyncDomain, localRecord: CollectionRecord, externalRecord: CollectionRecord): { field: string; localValue: unknown; externalValue: unknown } | null {
  for (const [field, externalValue] of Object.entries(externalRecord)) {
    if (['domain', 'localId', 'cellarflowLocalId', 'externalId', 'external_id', 'externalType', 'displayName'].includes(field)) continue;
    if (domainAllowsExternalField(domain, field)) continue;
    if (!(field in localRecord)) continue;
    const localValue = localRecord[field];
    if (externalValue !== undefined && JSON.stringify(localValue) !== JSON.stringify(externalValue)) {
      return { field, localValue, externalValue };
    }
  }
  return null;
}

function pickExternalOwnedFields(domain: IntegrationSyncDomain, record: CollectionRecord): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (domainAllowsExternalField(domain, key)) picked[key] = redactSensitiveValue(value);
  }
  return picked;
}

function findLocalRecord(domain: IntegrationSyncDomain, localId: string, orgData: Record<string, unknown>): CollectionRecord | null {
  const records = collectDomainRecords(domain, orgData);
  return records.find((record) => String(record.localId || record.id || '') === localId) || null;
}

function recordsToCsv(records: CollectionRecord[]): string {
  const headers = Array.from(records.reduce((set, record) => {
    Object.keys(flattenRecord(record)).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  if (headers.length === 0) return '';
  const rows = [headers.join(',')];
  for (const record of records) {
    const flat = flattenRecord(record);
    rows.push(headers.map((header) => csvEscape(flat[header])).join(','));
  }
  return rows.join('\n');
}

function csvToRecords(csv: string): CollectionRecord[] {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim()).filter(Boolean);
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const record: CollectionRecord = {};
    headers.forEach((header, index) => {
      record[header] = parseCsvValue(row[index] ?? '');
    });
    return record;
  });
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    const next = csv[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function csvEscape(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function parseCsvValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const n = Number(trimmed);
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(trimmed)) return n;
  return value;
}

function flattenRecord(record: CollectionRecord, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flattenRecord(value as CollectionRecord, path));
    } else if (Array.isArray(value)) {
      out[path] = JSON.stringify(value);
    } else {
      out[path] = value;
    }
  }
  return out;
}

function mappingKey(connectorId: string, mapping: Pick<IntegrationFieldMapping | FieldMappingInput, 'domain' | 'direction' | 'localField'>): string {
  return `${connectorId}::${mapping.domain}::${mapping.direction}::${mapping.localField}`;
}

function stablePartyId(prefix: 'customer' | 'supplier', name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unnamed';
  return `${prefix}-${slug}`;
}

function stringOrUndefined(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function isPlainObject(value: unknown): value is CollectionRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capArray<T>(items: T[], max: number): void {
  if (items.length > max) items.length = max;
}

function byteLength(value: string): number {
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
  return new TextEncoder().encode(value).length;
}

export function isValidIntegrationRecordId(value: string): boolean {
  return VALID_ID.test(value);
}
