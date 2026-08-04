import { describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../server/db';
import { organizationContextMismatch } from '../server/middleware/auth';
import {
  authorizeSyncPayload,
  redactWineryDatabaseForRole,
  syncMutatesCollection,
} from '../server/routes/sync';

describe('sync authorization', () => {
  it('rejects server-owned AI findings even for an owner', () => {
    const incoming = {
      aiFindings: [{
        id: 'ai-forged',
        source: 'rule',
        severity: 'critical',
        status: 'new',
        dedupeKey: 'forged',
        requiresHumanConfirmation: true,
      }],
    };
    expect(authorizeSyncPayload('Owner/Admin', { aiFindings: [] }, incoming, undefined))
      .toMatch(/server-owned/i);
  });

  it('distinguishes preserved cost data from a gated cost mutation', () => {
    const userDb = { costEntries: [{ id: 'cost-1', amount: 500, lastModified: '2026-07-20T00:00:00Z' }] };

    expect(syncMutatesCollection(userDb, {
      costEntries: [{ id: 'cost-1', amount: 500, lastModified: '2026-07-21T00:00:00Z' }],
    }, undefined, undefined, 'costEntries')).toBe(false);
    expect(syncMutatesCollection(userDb, {
      costEntries: [{ id: 'cost-1', amount: 600 }],
    }, undefined, undefined, 'costEntries')).toBe(true);
    expect(syncMutatesCollection(userDb, {}, undefined, [
      { collection: 'costEntries', id: 'cost-1' },
    ], 'costEntries')).toBe(true);
  });

  it('allows attachment removal when the role can update the target module', () => {
    const userDb = {
      attachments: [
        { id: 'att-cert', module: 'certification', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Lab Technician', userDb, {}, ['att-cert'])).toBeNull();
  });

  it('blocks attachment removal when the role cannot update the target module', () => {
    const userDb = {
      attachments: [
        { id: 'att-doc', module: 'official_docs', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, {}, ['att-doc'])).toMatch(/cannot update attachments/i);
  });

  it('blocks attachment updates when the stored module is not writable even if the incoming module is', () => {
    const userDb = {
      attachments: [
        { id: 'att-doc', module: 'official_docs', fileName: 'doc.pdf', storage: { kind: 'metadata_only' } },
      ],
    };
    const incoming = {
      attachments: [
        { id: 'att-doc', module: 'certification', fileName: 'doc.pdf', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, incoming, undefined)).toMatch(/official_docs/i);
  });

  it('allows attachment updates when the role can update the stored and incoming modules', () => {
    const userDb = {
      attachments: [
        { id: 'att-cert', module: 'certification', fileName: 'cert.pdf', storage: { kind: 'metadata_only' } },
      ],
    };
    const incoming = {
      attachments: [
        { id: 'att-cert', module: 'certification', fileName: 'cert-updated.pdf', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Lab Technician', userDb, incoming, undefined)).toBeNull();
  });

  it('keeps ordinary record deletion behind delete permission', () => {
    const userDb = {
      tasks: [{ id: 'task-1' }],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, {}, ['task-1'])).toBeNull();
    expect(authorizeSyncPayload('Lab Technician', userDb, {}, ['task-1'])).toMatch(/cannot delete tasks/i);
  });

  it('returns a schema-complete but module-redacted snapshot for operational roles', () => {
    const userDb = {
      ...createEmptyUserData(),
      companyProfile: { companyName: 'Secret Winery LLC', identificationCode: '123456789' },
      integrationHub: { connectors: [{ id: 'accounting', endpointUrl: 'https://private.example' }] },
      lots: [{ id: 'lot-1', name: 'Lot 1' }],
      vessels: [{ id: 'tank-1', currentVolume: 500 }],
      blocks: [{ id: 'block-1', cadastralCode: 'private-cadastre' }],
      grapeIntakes: [{
        id: 'intake-1',
        createdLotId: 'lot-1',
        costPerKg: 4,
        totalCost: 4000,
        grapePrice: 4,
        paymentStatus: 'unpaid',
        reversalSnapshot: {
          version: 1,
          lot: { id: 'lot-1', initialVolume: 700, currentVolume: 700, stage: 'crushing', historyDescription: 'Intake' },
          costEntry: { id: 'cost-intake-1', amount: 4000, currency: 'GEL' },
          auditId: 'audit-intake-1',
        },
      }],
      inventory: [{
        id: 'yeast-1',
        stock: 10,
        costPerUnit: 22,
        lastInvoiceReceipt: {
          analysisLineId: 'invoice-line-1',
          receivedAt: '2026-08-04T10:00:00.000Z',
          supplierName: 'Private Supplier',
          quantity: 10,
          unit: 'kg',
          unitCost: 22,
          lineTotal: 220,
          currency: 'GEL',
        },
      }],
      bottlingRuns: [{
        id: 'run-1',
        lotId: 'lot-1',
        packagingCostTotal: 900,
        bottlingServiceCost: 400,
        storageLocationId: 'store-1',
        storageMovementId: 'move-1',
        placedInStorageBottles: 100,
      }],
      costEntries: [{ id: 'cost-1', amount: 5000 }],
      supplierPayments: [{ id: 'payment-1', amount: 1000 }],
      winePricing: { 'lot-1': 30 },
      storageLocations: [{ id: 'store-1', name: 'Private warehouse' }],
      stockMovements: [{ id: 'move-1', bottles: 100 }],
      salesDispatches: [{ id: 'dispatch-1', revenue: 3000 }],
      salesOrders: [{ id: 'order-1', revenue: 3000 }],
      crmLeads: [{ id: 'lead-1', contactEmail: 'buyer@example.com' }],
      attachments: [
        { id: 'cert-file', module: 'certification' },
        { id: 'qvevri-file', module: 'qvevri' },
        { id: 'cadastre-file', module: 'cadastre' },
        { id: 'crm-file', module: 'crm' },
        { id: 'company-file', module: 'company' },
      ],
      secretInternalCollection: [{ token: 'must-not-leak' }],
    };

    const response = redactWineryDatabaseForRole('Winemaker', userDb);

    expect(Object.keys(response).sort()).toEqual(
      Object.keys(createEmptyUserData()).filter(key => key !== 'syncDeletionLedger').sort(),
    );
    expect(response).not.toHaveProperty('syncDeletionLedger');
    expect(response).not.toHaveProperty('secretInternalCollection');
    expect(response.lots).toEqual(userDb.lots);
    expect(response.vessels).toEqual(userDb.vessels);
    expect(response.costEntries).toEqual([]);
    expect(response.supplierPayments).toEqual([]);
    expect(response.winePricing).toEqual({});
    expect(response.storageLocations).toEqual([]);
    expect(response.stockMovements).toEqual([]);
    expect(response.salesDispatches).toEqual([]);
    expect(response.salesOrders).toEqual([]);
    expect(response.crmLeads).toEqual([]);
    expect(response.companyProfile).toEqual({});
    expect(response.integrationHub).toEqual({});
    expect(response.inventory[0]).not.toHaveProperty('costPerUnit');
    expect(response.inventory[0]).not.toHaveProperty('lastInvoiceReceipt');
    expect(response.grapeIntakes[0]).not.toHaveProperty('totalCost');
    expect(response.grapeIntakes[0]).not.toHaveProperty('grapePrice');
    expect(response.grapeIntakes[0].reversalSnapshot).not.toHaveProperty('costEntry');
    expect(response.grapeIntakes[0].reversalSnapshot.lot.id).toBe('lot-1');
    expect(response.bottlingRuns[0]).not.toHaveProperty('packagingCostTotal');
    expect(response.bottlingRuns[0]).not.toHaveProperty('storageLocationId');
    expect(response.attachments.map((item: any) => item.id)).toEqual(['cert-file', 'qvevri-file']);

    // Redaction must never mutate the full candidate that is persisted.
    expect(userDb.inventory[0].costPerUnit).toBe(22);
    expect(userDb.grapeIntakes[0].reversalSnapshot.costEntry.amount).toBe(4000);
    expect(userDb.bottlingRuns[0].storageLocationId).toBe('store-1');
  });

  it('preserves read-only dependency collections for lab/certification without exposing commercial ledgers', () => {
    const userDb = {
      ...createEmptyUserData(),
      lots: [{ id: 'lot-1' }],
      vessels: [{ id: 'tank-1', currentVolume: 500 }],
      blocks: [{ id: 'block-1' }],
      grapeIntakes: [{ id: 'intake-1', totalCost: 2000, grapePrice: 2 }],
      lablogs: [{ id: 'lab-1', lotId: 'lot-1', tankId: 'tank-1' }],
      bottlingRuns: [{ id: 'run-1', lotId: 'lot-1', bottlingServiceCost: 600, storageLocationId: 'store-1' }],
      costEntries: [{ id: 'cost-1', amount: 600 }],
      storageLocations: [{ id: 'store-1' }],
      salesDispatches: [{ id: 'dispatch-1' }],
    };

    const response = redactWineryDatabaseForRole('Lab Technician', userDb);

    expect(response.lots).toHaveLength(1);
    expect(response.vessels).toHaveLength(1);
    expect(response.blocks).toHaveLength(1);
    expect(response.grapeIntakes).toHaveLength(1);
    expect(response.lablogs).toHaveLength(1);
    expect(response.bottlingRuns).toHaveLength(1);
    expect(response.grapeIntakes[0]).not.toHaveProperty('totalCost');
    expect(response.bottlingRuns[0]).not.toHaveProperty('bottlingServiceCost');
    expect(response.bottlingRuns[0]).not.toHaveProperty('storageLocationId');
    expect(response.costEntries).toEqual([]);
    expect(response.storageLocations).toEqual([]);
    expect(response.salesDispatches).toEqual([]);
  });

  it('returns the full persisted schema to roles with every module view permission', () => {
    const userDb = {
      ...createEmptyUserData(),
      companyProfile: { companyName: 'Owner Winery' },
      costEntries: [{ id: 'cost-1', amount: 42 }],
      storageLocations: [{ id: 'store-1' }],
      salesDispatches: [{ id: 'dispatch-1' }],
    };

    const response = redactWineryDatabaseForRole('Owner/Admin', userDb);
    expect(response.companyProfile).toEqual(userDb.companyProfile);
    expect(response.costEntries).toEqual(userDb.costEntries);
    expect(response.storageLocations).toEqual(userDb.storageLocations);
    expect(response.salesDispatches).toEqual(userDb.salesDispatches);
  });

  it('detects a stale organization header without rejecting absent/current headers', () => {
    expect(organizationContextMismatch(undefined, 'org-current')).toBe(false);
    expect(organizationContextMismatch('', 'org-current')).toBe(false);
    expect(organizationContextMismatch('org-current', 'org-current')).toBe(false);
    expect(organizationContextMismatch('org-stale', 'org-current')).toBe(true);
  });
});
