import { describe, expect, it } from 'vitest';
import {
  ONE_C_CONNECTOR_ID,
  applyConnectorConfig,
  createEmptyIntegrationHubState,
  enqueueIntegrationJob,
  processIntegrationJob,
  saveFieldMappings,
  validateConnectorConfigInput,
  validateCreateSyncJobInput,
  validateFieldMappingInputs,
} from '../lib/integrations';
import { validateConflictResolutionInput } from '../server/routes/integrations';

const actor = 'admin';

function enabledHub() {
  const hub = createEmptyIntegrationHubState('2026-07-06T00:00:00.000Z');
  applyConnectorConfig(hub, ONE_C_CONNECTOR_ID, { enabled: true, endpointUrl: 'manual://1c', authMode: 'none' }, actor);
  return hub;
}

describe('integration queue', () => {
  it('creates and completes a manual JSON export job', () => {
    const hub = enabledHub();
    const data = {
      lots: [
        { id: 'lot-1', name: 'Saperavi Reserve', vintage: 2026, variety: 'Saperavi', currentVolume: 1200, wineClass: 'red', stage: 'aging' },
      ],
      inventory: [
        { id: 'bottle-750', name: '750ml bottle', category: 'packaging', unit: 'pcs', stock: 5000, supplierName: 'Glass Co' },
      ],
    };

    const job = enqueueIntegrationJob(hub, {
      connectorId: ONE_C_CONNECTOR_ID,
      domain: 'products',
      direction: 'export',
      format: 'json',
    }, actor);
    const result = processIntegrationJob(hub, data, job.id, actor);

    expect(result.job.status).toBe('succeeded');
    expect(result.job.resultSummary).toMatchObject({ recordCount: 2, conflictCount: 0 });
    expect(result.job.exportArtifact?.content).toContain('Saperavi Reserve');
    expect(hub.events.some((event) => event.action === 'job.succeeded')).toBe(true);
  });

  it('keeps external ID mapping idempotent across import retries', () => {
    const hub = enabledHub();
    const data = {
      salesOrders: [
        { id: 'so-1', orderNumber: 'SO-001', customerName: 'Acme', lotId: 'lot-1', locationId: 'loc-1', bottles: 24, status: 'reserved' },
      ],
    };
    const payload = {
      records: [
        { localId: 'so-1', externalId: '1c-order-100', documentNumber: 'INV-100', accountingStatus: 'posted' },
      ],
    };

    const first = enqueueIntegrationJob(hub, {
      connectorId: ONE_C_CONNECTOR_ID,
      domain: 'sales_orders',
      direction: 'import',
      format: 'json',
      inputPayload: payload,
    }, actor);
    const firstResult = processIntegrationJob(hub, data, first.id, actor);

    const second = enqueueIntegrationJob(hub, {
      connectorId: ONE_C_CONNECTOR_ID,
      domain: 'sales_orders',
      direction: 'import',
      format: 'json',
      inputPayload: payload,
    }, actor);
    const secondResult = processIntegrationJob(hub, data, second.id, actor);

    expect(firstResult.createdRefs).toBe(1);
    expect(secondResult.createdRefs).toBe(0);
    expect(secondResult.updatedRefs).toBe(1);
    expect(hub.externalRefs).toHaveLength(1);
    expect(hub.externalRefs[0]).toMatchObject({
      localId: 'so-1',
      externalId: '1c-order-100',
      accounting: expect.objectContaining({ documentNumber: 'INV-100', accountingStatus: 'posted' }),
    });
  });

  it('marks imports needs_review when 1C attempts to change CellarFlow-owned fields', () => {
    const hub = enabledHub();
    const data = {
      salesDispatches: [
        { id: 'disp-1', customerName: 'Acme', lotId: 'lot-1', locationId: 'loc-1', bottles: 12, pricePerBottle: 15 },
      ],
    };
    const job = enqueueIntegrationJob(hub, {
      connectorId: ONE_C_CONNECTOR_ID,
      domain: 'sales_dispatches',
      direction: 'import',
      format: 'json',
      inputPayload: {
        records: [
          { localId: 'disp-1', externalId: '1c-disp-9', bottles: 10, invoiceNumber: 'INV-9' },
        ],
      },
    }, actor);

    const result = processIntegrationJob(hub, data, job.id, actor);

    expect(result.job.status).toBe('needs_review');
    expect(result.conflictCount).toBe(1);
    expect(hub.externalRefs).toHaveLength(0);
    expect(hub.conflicts[0]).toMatchObject({
      domain: 'sales_dispatches',
      fieldPath: 'bottles',
      status: 'open',
    });
  });
});

describe('integration mappings and route validation', () => {
  it('replaces matching field mappings for a connector/domain/direction', () => {
    const hub = enabledHub();
    saveFieldMappings(hub, ONE_C_CONNECTOR_ID, [
      { domain: 'products', direction: 'export', localField: 'localId', externalField: 'Code', required: true },
    ], actor);
    saveFieldMappings(hub, ONE_C_CONNECTOR_ID, [
      { domain: 'products', direction: 'export', localField: 'localId', externalField: 'CellarFlowID', required: true },
    ], actor);

    expect(hub.mappings.filter((mapping) => mapping.localField === 'localId')).toHaveLength(1);
    expect(hub.mappings[0].externalField).toBe('CellarFlowID');
  });

  it('validates connector secrets as write-only placeholders', () => {
    const input = validateConnectorConfigInput({
      enabled: true,
      authMode: 'api_key',
      apiKey: 'super-secret-key',
    });

    expect(input.apiKey).toBe('[provided]');
    expect(JSON.stringify(input)).not.toContain('super-secret-key');
  });

  it('rejects invalid sync job and mapping requests', () => {
    expect(() => validateCreateSyncJobInput({
      connectorId: ONE_C_CONNECTOR_ID,
      domain: 'unknown',
      direction: 'export',
    })).toThrow(/Unsupported sync domain/);

    expect(() => validateCreateSyncJobInput({
      connectorId: ONE_C_CONNECTOR_ID,
      domain: 'products',
      direction: 'import',
      format: 'json',
    })).toThrow(/input payload/);

    expect(() => validateFieldMappingInputs({
      mappings: [{ domain: 'products', direction: 'sideways', localField: 'id', externalField: 'Ref' }],
    })).toThrow(/unsupported direction/i);
  });

  it('requires a conflict resolution note on the route validator', () => {
    expect(() => validateConflictResolutionInput({ resolution: '' })).toThrow(/required/);
    expect(validateConflictResolutionInput({ resolution: 'Reviewed against 1C document INV-9.' })).toContain('INV-9');
  });
});
