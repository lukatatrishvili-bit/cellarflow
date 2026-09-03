import { describe, expect, it } from 'vitest';
import { checksumAttachmentDataUrl, MAX_INLINE_ATTACHMENT_BYTES } from '../lib/attachments';
import {
  assertSyncPayloadWithinLimits,
  authorizeSyncPayload,
  buildRecoverableSyncCandidate,
  buildSyncCandidate,
  MAX_SYNC_RECORDS_PER_COLLECTION,
  MAX_SYNC_TOMBSTONES,
  MAX_SYNC_TOTAL_RECORDS,
  prepareAttachmentsForServerMerge,
  prepareCollectionsForRejectedDeletion,
  SyncPayloadLimitError,
  validateSyncPayload,
} from '../server/routes/sync';

const baseDb = () => ({
  lots: [],
  auditLogs: [],
  attachments: [],
});

describe('cellar plan and generated task integrity', () => {
  const floor = { id: 'ground', name: 'Ground', level: 0, widthMeters: 30, heightMeters: 18, gridMeters: 1 };
  const task = {
    id: 'task-plan', title: 'Inspect tank', priority: 'medium', dueDate: '2026-08-30',
    assignedTo: 'Ana', status: 'pending', description: '',
  };

  it('validates physical floor dimensions and unique floor ids', () => {
    expect(() => validateSyncPayload(baseDb(), { companyProfile: { cellarFloors: [floor] } }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(baseDb(), { companyProfile: { cellarFloors: [{ ...floor, widthMeters: 2 }] } }, undefined)).toThrow(/invalid cellar floor/i);
    expect(() => validateSyncPayload(baseDb(), { companyProfile: { cellarFloors: [floor, floor] } }, undefined)).toThrow(/invalid cellar floor/i);
  });

  it('validates scaled winery areas and infrastructure objects', () => {
    const planObjects = [
      { id: 'zone-fermentation', kind: 'zone', label: 'Fermentation', xMeters: 8, yMeters: 6, widthMeters: 8, heightMeters: 5, rotation: 0, zoneUse: 'fermentation' },
      { id: 'utility-water', kind: 'water', label: 'Wash point', xMeters: 2, yMeters: 2, widthMeters: 1, heightMeters: 1, rotation: 90 },
    ];
    expect(() => validateSyncPayload(baseDb(), { companyProfile: { cellarFloors: [{ ...floor, planObjects }] } }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(baseDb(), { companyProfile: { cellarFloors: [{ ...floor, planObjects: [{ ...planObjects[0], xMeters: 29 }] }] } }, undefined)).toThrow(/invalid plan object/i);
    expect(() => validateSyncPayload(baseDb(), { companyProfile: { cellarFloors: [{ ...floor, planObjects: [{ ...planObjects[1], zoneUse: 'utility' }] }] } }, undefined)).toThrow(/invalid plan object/i);
  });

  it('lets vessel operators change only the physical floor plan', () => {
    const db = { ...baseDb(), companyProfile: { companyName: 'Estate', cellarFloors: [floor] } };
    expect(authorizeSyncPayload('Winemaker', db, {
      companyProfile: { companyName: 'Estate', cellarFloors: [{ ...floor, widthMeters: 32 }] },
    }, undefined)).toBeNull();
    expect(authorizeSyncPayload('Winemaker', db, {
      companyProfile: { companyName: 'Changed', cellarFloors: [floor] },
    }, undefined)).toMatch(/cannot update companyProfile/i);
  });

  it('rejects unknown floor and production-plan task references', () => {
    const vessel = {
      id: 'T-1', capacity: 1_000, currentVolume: 0, assignedLotId: null,
      cellarFloorId: 'unknown-floor',
    };
    expect(() => validateSyncPayload(operationalDb({ companyProfile: { cellarFloors: [floor] } }), { vessels: [vessel] }, undefined)).toThrow(/unknown cellar floor/i);
    expect(() => validateSyncPayload(operationalDb({ productionPlans: [] }), {
      tasks: [{ ...task, source: { type: 'production_plan', id: 'missing-plan' } }],
    }, undefined)).toThrow(/invalid production plan source/i);
  });

  it('accepts a task linked to an existing production plan and its vessels', () => {
    const plan = {
      id: 'plan-1', title: 'Inspect tank', kind: 'lab', status: 'planned',
      startDate: '2026-08-30', endDate: '2026-08-30', vesselIds: ['T-1'], dependencyIds: [],
    };
    const vessel = { id: 'T-1', capacity: 1_000, currentVolume: 0, assignedLotId: null };
    expect(() => validateSyncPayload(operationalDb({ productionPlans: [plan], vessels: [vessel] }), {
      tasks: [{ ...task, source: { type: 'production_plan', id: 'plan-1', vesselIds: ['T-1'] } }],
    }, undefined)).not.toThrow();
  });

  it('validates persisted 3D vessel models, dimensions, and map coordinates', () => {
    const vessel = {
      id: 'T-3D', capacity: 5_000, currentVolume: 0, assignedLotId: null,
      planModel: 'closed_top_jacket', planWidthMeters: 1.8, planDepthMeters: 1.8,
      planHeightMeters: 3.6, planElevationMeters: 0.25, planRotationDegrees: 45,
      xGrid: 42, yGrid: 58,
    };
    expect(() => validateSyncPayload(operationalDb(), { vessels: [vessel] }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(operationalDb(), { vessels: [{ ...vessel, planModel: 'spaceship' }] }, undefined)).toThrow(/invalid 3D plan model/i);
    expect(() => validateSyncPayload(operationalDb(), { vessels: [{ ...vessel, planHeightMeters: 200 }] }, undefined)).toThrow(/invalid planHeightMeters/i);
    expect(() => validateSyncPayload(operationalDb(), { vessels: [{ ...vessel, xGrid: -1 }] }, undefined)).toThrow(/invalid xGrid/i);
  });
});

const attachment = (fields: Record<string, any>) => ({
  id: 'att-1',
  fileName: 'certificate.pdf',
  module: 'certification',
  storage: { kind: 'metadata_only' },
  ...fields,
});

const operationalDb = (fields: Record<string, any> = {}) => ({
  lots: [],
  auditLogs: [],
  attachments: [],
  inventory: [],
  invoiceReceipts: [],
  inventoryMovements: [],
  vessels: [],
  cellarOps: [],
  storageLocations: [],
  stockMovements: [],
  salesDispatches: [],
  salesOrders: [],
  bottlingRuns: [],
  costEntries: [],
  tasks: [],
  ...fields,
});

describe('sync payload work limits', () => {
  it('rejects non-object sync bodies before route destructuring', () => {
    expect(() => assertSyncPayloadWithinLimits(null)).toThrowError(expect.objectContaining({
      code: 'sync_payload_invalid',
      statusCode: 400,
    }));
    expect(() => assertSyncPayloadWithinLimits([])).toThrowError(expect.objectContaining({
      code: 'sync_payload_invalid',
      statusCode: 400,
    }));
  });

  it('accepts collections and tombstones at their documented limits', () => {
    expect(() => assertSyncPayloadWithinLimits({
      lots: new Array(MAX_SYNC_RECORDS_PER_COLLECTION).fill(null),
      deletedRecords: new Array(MAX_SYNC_TOMBSTONES).fill(null),
    })).not.toThrow();
  });

  it('rejects an oversized collection with a stable recovery code', () => {
    try {
      assertSyncPayloadWithinLimits({
        lots: new Array(MAX_SYNC_RECORDS_PER_COLLECTION + 1).fill(null),
      });
      throw new Error('Expected payload limit rejection.');
    } catch (error) {
      expect(error).toBeInstanceOf(SyncPayloadLimitError);
      expect((error as SyncPayloadLimitError).code).toBe('sync_collection_record_limit_exceeded');
      expect((error as Error).message).toContain('Local changes were kept');
    }
  });

  it('rejects excessive records spread across otherwise valid collections', () => {
    const records = new Array(MAX_SYNC_RECORDS_PER_COLLECTION).fill(null);

    expect(() => assertSyncPayloadWithinLimits({
      lots: records,
      tasks: records,
      inventory: records,
      cellarOps: records,
    })).toThrowError(expect.objectContaining({
      code: 'sync_total_record_limit_exceeded',
    }));
    expect(MAX_SYNC_RECORDS_PER_COLLECTION * 4).toBeGreaterThan(MAX_SYNC_TOTAL_RECORDS);
  });

  it('rejects an oversized deletion ledger independently of record totals', () => {
    expect(() => assertSyncPayloadWithinLimits({
      deletedIds: new Array(MAX_SYNC_TOMBSTONES + 1).fill(null),
    })).toThrowError(expect.objectContaining({
      code: 'sync_tombstone_limit_exceeded',
    }));
  });
});

describe('sync payload validation', () => {
  it('accepts supported inline attachments with matching checksum and MIME', () => {
    const dataUrl = 'data:application/pdf;base64,AAAA';

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl },
        checksum: checksumAttachmentDataUrl(dataUrl),
      })],
    }, undefined)).not.toThrow();
  });

  it('rejects unsafe or non-HTTPS external attachment URLs', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'javascript:alert(1)' },
      })],
    }, undefined)).toThrow(/https/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'http://example.test/evidence.pdf' },
      })],
    }, undefined)).toThrow(/https/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'external', url: 'https://user:pass@example.test/evidence.pdf' },
      })],
    }, undefined)).toThrow(/https/i);
  });

  it('rejects unsupported attachment filenames and MIME types', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({ fileName: '../certificate.pdf' })],
    }, undefined)).toThrow(/safe fileName/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({ fileName: 'payload.exe' })],
    }, undefined)).toThrow(/unsupported file type/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'text/html',
        storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
      })],
    }, undefined)).toThrow(/unsupported MIME type/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        fileName: 'certificate.pdf',
        mimeType: 'image/png',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/unsupported MIME type/i);
  });

  it('rejects inline MIME and checksum mismatches', () => {
    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/inline storage requires|MIME type does not match/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        fileName: 'certificate.pdf',
        storage: { kind: 'inline', dataUrl: 'data:image/png;base64,AAAA' },
      })],
    }, undefined)).toThrow(/inline storage requires/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        fileName: 'certificate.pdf',
        mimeType: 'application/pdf',
        storage: { kind: 'inline', dataUrl: 'data:application/pdf,not-base64' },
      })],
    }, undefined)).toThrow(/inline storage requires/i);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        storage: { kind: 'inline', dataUrl: 'data:application/pdf;base64,AAAA' },
        checksum: '0'.repeat(64),
      })],
    }, undefined)).toThrow(/checksum does not match/i);
  });

  it('rejects inline attachments whose decoded payload exceeds the single-file cap', () => {
    const payload = 'A'.repeat(Math.ceil((MAX_INLINE_ATTACHMENT_BYTES + 1) / 3) * 4);

    expect(() => validateSyncPayload(baseDb(), {
      attachments: [attachment({
        mimeType: 'application/pdf',
        sizeBytes: 1,
        storage: { kind: 'inline', dataUrl: `data:application/pdf;base64,${payload}` },
      })],
    }, undefined)).toThrow(/too large/i);
  });

  it('normalizes attachment payloads before server merge without mutating the request', () => {
    const dataUrl = 'data:application/pdf;base64,AAAA';
    const incoming = [{
      id: 'att-1',
      fileName: '  Certificate.PDF  ',
      mimeType: ' Application/PDF; charset=UTF-8 ',
      module: 'certification',
      storage: { kind: 'inline', dataUrl, url: 'https://example.test/ignored.pdf' },
    }, {
      id: 'att-2',
      fileName: ' External Evidence.PDF ',
      mimeType: '',
      module: 'official_docs',
      checksum: 'A'.repeat(64),
      storage: {
        kind: 'external',
        url: ' https://example.test/evidence.pdf ',
        dataUrl: 'data:application/pdf;base64,SHOULD_NOT_PERSIST',
      },
    }, {
      id: 'att-3',
      fileName: 'Metadata.pdf',
      module: 'official_docs',
      storage: {
        kind: 'metadata_only',
        dataUrl: 'data:application/pdf;base64,SHOULD_NOT_PERSIST',
        url: 'https://example.test/ignored.pdf',
      },
    }];

    const prepared = prepareAttachmentsForServerMerge(incoming);

    expect(prepared[0]).toMatchObject({
      fileName: 'Certificate.PDF',
      mimeType: 'application/pdf',
      checksum: checksumAttachmentDataUrl(dataUrl),
    });
    expect(prepared[1]).toMatchObject({
      fileName: 'External Evidence.PDF',
      checksum: 'a'.repeat(64),
      storage: { kind: 'external', url: 'https://example.test/evidence.pdf' },
    });
    expect(prepared[0].storage).toEqual({ kind: 'inline', dataUrl });
    expect(prepared[1].storage).toEqual({ kind: 'external', url: 'https://example.test/evidence.pdf' });
    expect(prepared[2].storage).toEqual({ kind: 'metadata_only' });
    expect(prepared[1]).not.toHaveProperty('mimeType');
    expect(incoming[0].fileName).toBe('  Certificate.PDF  ');
    expect(incoming[0].storage).not.toBe(prepared[0].storage);
    expect(incoming[1].storage.url).toBe(' https://example.test/evidence.pdf ');
  });

  it('rejects deleting storage locations that still have dependent records', () => {
    const db = {
      ...baseDb(),
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [{ id: 'move-1', locationId: 'loc-1' }],
      salesDispatches: [],
      salesOrders: [],
      bottlingRuns: [],
    };

    expect(() => validateSyncPayload(db, {}, ['loc-1'])).toThrow(/still used by stock movement move-1/i);
  });

  it.each([
    ['sales dispatch', { salesDispatches: [{ id: 'sale-1', locationId: 'loc-1' }] }],
    ['sales order', { salesOrders: [{ id: 'order-1', locationId: 'loc-1' }] }],
    ['bottling run', { bottlingRuns: [{ id: 'run-1', storageLocationId: 'loc-1' }] }],
  ])('rejects deleting a storage location referenced by a %s', (_kind, dependent) => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [],
      salesDispatches: [],
      salesOrders: [],
      bottlingRuns: [],
      ...dependent,
    };

    expect(() => validateSyncPayload(db, {}, ['loc-1'])).toThrow(/Referenced Storage Location/i);
  });

  it('allows a storage location deletion when every dependent record is deleted atomically', () => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [{ id: 'move-1', locationId: 'loc-1' }],
      salesDispatches: [{ id: 'sale-1', locationId: 'loc-1', stockMovementId: 'move-1' }],
      salesOrders: [{ id: 'order-1', locationId: 'loc-1', dispatchId: 'sale-1' }],
      bottlingRuns: [{ id: 'run-1', storageLocationId: 'loc-1' }],
    };

    expect(() => validateSyncPayload(
      db,
      {},
      ['loc-1', 'move-1', 'sale-1', 'order-1', 'run-1'],
    )).not.toThrow();
  });

  it('rejects deleting a movement or dispatch while a surviving sales record references it', () => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [{ id: 'move-1', locationId: 'loc-1' }],
      salesDispatches: [{ id: 'sale-1', locationId: 'loc-1', stockMovementId: 'move-1' }],
      salesOrders: [{ id: 'order-1', locationId: 'loc-1', dispatchId: 'sale-1' }],
      bottlingRuns: [],
    };

    expect(() => validateSyncPayload(db, {}, ['move-1'])).toThrow(/Referenced Stock Movement/i);
    expect(() => validateSyncPayload(db, {}, ['sale-1'])).toThrow(/Referenced Sales Dispatch/i);
  });

  it('rejects movement deletions that would make stock negative or undercut reservations', () => {
    const negativeDb = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [
        { id: 'in-1', locationId: 'loc-1', lotId: 'lot-1', direction: 'in', bottles: 10 },
        { id: 'out-1', locationId: 'loc-1', lotId: 'lot-1', direction: 'out', bottles: 8 },
      ],
      salesDispatches: [],
      salesOrders: [],
      bottlingRuns: [],
    };
    expect(() => validateSyncPayload(negativeDb, {}, ['in-1'])).toThrow(/make stock negative/i);

    const reservedDb = {
      ...negativeDb,
      stockMovements: [
        { id: 'in-1', locationId: 'loc-1', lotId: 'lot-1', direction: 'in', bottles: 10 },
        { id: 'in-2', locationId: 'loc-1', lotId: 'lot-1', direction: 'in', bottles: 5 },
      ],
      salesOrders: [{
        id: 'order-1',
        locationId: 'loc-1',
        lotId: 'lot-1',
        bottles: 8,
        status: 'reserved',
      }],
    };
    expect(() => validateSyncPayload(reservedDb, {}, ['in-1'])).toThrow(/reserved bottles without enough stock/i);
  });

  it('rejects movement deletions linked to bottling by either side of the relationship', () => {
    const common = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      salesDispatches: [],
      salesOrders: [],
    };

    expect(() => validateSyncPayload({
      ...common,
      stockMovements: [{ id: 'move-1', locationId: 'loc-1', lotId: 'lot-1', direction: 'in', bottles: 10 }],
      bottlingRuns: [{ id: 'run-1', storageMovementId: 'move-1' }],
    }, {}, ['move-1'])).toThrow(/still used by bottling run run-1/i);

    expect(() => validateSyncPayload({
      ...common,
      stockMovements: [{ id: 'move-1', locationId: 'loc-1', lotId: 'lot-1', direction: 'in', bottles: 10, sourceRef: 'run-1' }],
      bottlingRuns: [{ id: 'run-1' }],
    }, {}, ['move-1'])).toThrow(/still used by bottling run run-1/i);
  });

  it('preserves stored optional references while validating partial incoming updates', () => {
    const db = {
      ...baseDb(),
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [],
      salesDispatches: [{ id: 'sale-1', locationId: 'loc-1' }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        dispatchId: 'sale-1',
        status: 'fulfilled',
      }],
      bottlingRuns: [],
    };

    expect(() => validateSyncPayload(db, {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        status: 'reserved',
      }],
    }, ['sale-1'])).toThrow(/Referenced Sales Dispatch/i);

    expect(() => validateSyncPayload(db, {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        dispatchId: null,
        status: 'reserved',
      }],
    }, ['sale-1'])).not.toThrow();
  });

  it('rejects a newly submitted storage location that is tombstoned in the same payload', () => {
    const db = {
      ...baseDb(),
      storageLocations: [],
      stockMovements: [],
      salesDispatches: [],
      salesOrders: [],
      bottlingRuns: [],
    };
    const collections = {
      storageLocations: [{ id: 'loc-new', name: 'Temporary' }],
      stockMovements: [{
        id: 'move-new',
        lotId: 'lot-1',
        locationId: 'loc-new',
        direction: 'in',
        bottles: 10,
      }],
    };

    expect(() => validateSyncPayload(db, collections, ['loc-new']))
      .toThrow(/Referenced Storage Location|Deleted item loc-new/i);
  });

  it('rejects deleting a dispatch while a source-linked stock movement survives', () => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 10,
        sourceRef: 'sale-1',
      }],
      salesDispatches: [{ id: 'sale-1', locationId: 'loc-1' }],
      salesOrders: [],
      bottlingRuns: [],
    };

    expect(() => validateSyncPayload(db, {}, ['sale-1']))
      .toThrow(/still used by stock movement move-1/i);
  });

  it('rejects deleting sales records while explicit forward-linked records survive', () => {
    const db = {
      ...baseDb(),
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1' }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 10,
      }],
      salesDispatches: [{
        id: 'sale-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        stockMovementId: 'move-1',
        salesOrderId: 'order-1',
      }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        status: 'fulfilled',
      }],
      bottlingRuns: [],
    };

    expect(() => validateSyncPayload(db, {}, ['sale-1']))
      .toThrow(/still used by stock movement move-1/i);
    expect(() => validateSyncPayload(db, {}, ['order-1']))
      .toThrow(/still used by sales dispatch sale-1/i);
  });

  it('requires a bottling rollback to delete its linked movement and costs atomically', () => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 10,
        sourceRef: 'run-1',
      }],
      salesDispatches: [],
      salesOrders: [],
      bottlingRuns: [{ id: 'run-1', storageMovementId: 'move-1' }],
      costEntries: [{ id: 'cost-1', sourceRef: 'run-1' }],
    };

    expect(() => validateSyncPayload(db, {}, ['run-1']))
      .toThrow(/still used by stock movement move-1/i);
    expect(() => validateSyncPayload(db, {}, ['run-1', 'move-1']))
      .toThrow(/still used by cost entry cost-1/i);
    expect(() => validateSyncPayload(db, {}, ['run-1', 'move-1', 'cost-1']))
      .not.toThrow();
  });

  it('defers the entire payload when its reference-clearing update has a stale baseline', () => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [],
      salesDispatches: [{ id: 'sale-1', locationId: 'loc-1' }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        dispatchId: 'sale-1',
        status: 'fulfilled',
        lastModified: '2026-01-02T00:00:00.000Z',
      }],
      bottlingRuns: [],
      tasks: [{ id: 'task-1', title: 'Old title', lastModified: '2026-01-01T00:00:00.000Z' }],
    };
    const result = buildSyncCandidate(db, {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        dispatchId: null,
        status: 'reserved',
        lastModified: '2026-01-03T00:00:00.000Z',
        baselineTimestamp: '2026-01-01T00:00:00.000Z',
      }],
      tasks: [{
        id: 'task-1',
        title: 'Clean local update',
        lastModified: '2026-01-03T00:00:00.000Z',
        baselineTimestamp: '2026-01-01T00:00:00.000Z',
      }],
    }, ['sale-1']);

    expect(result.deletionConflict).toBe(true);
    expect(result.conflicts).toHaveLength(1);
    expect(result.candidateDb.salesDispatches).toHaveLength(1);
    expect(result.candidateDb.salesOrders[0].dispatchId).toBe('sale-1');
    expect(result.candidateDb.tasks[0].title).toBe('Old title');
    expect(db.salesDispatches).toHaveLength(1);
  });

  it('applies a compound unlink and deletion only after a clean merge', () => {
    const db = {
      ...baseDb(),
      storageLocations: [{ id: 'loc-1', name: 'Main' }],
      stockMovements: [],
      salesDispatches: [{ id: 'sale-1', locationId: 'loc-1' }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        dispatchId: 'sale-1',
        status: 'fulfilled',
        lastModified: '2026-01-02T00:00:00.000Z',
      }],
      bottlingRuns: [],
    };
    const result = buildSyncCandidate(db, {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        dispatchId: null,
        status: 'reserved',
        lastModified: '2026-01-03T00:00:00.000Z',
        baselineTimestamp: '2026-01-02T00:00:00.000Z',
      }],
    }, ['sale-1']);

    expect(result.deletionConflict).toBe(false);
    expect(result.conflicts).toHaveLength(0);
    expect(result.candidateDb.salesDispatches).toHaveLength(0);
    expect(result.candidateDb.salesOrders[0]).toMatchObject({
      dispatchId: null,
      status: 'reserved',
    });
    expect(db.salesDispatches).toHaveLength(1);
  });

  it('only rolls back the chronologically latest bottling run for a lot', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled', currentVolume: 0 }],
      // Deliberately stored in the opposite order to prove date chronology is
      // authoritative when server merge order differs from client display order.
      bottlingRuns: [
        { id: 'run-older', lotId: 'lot-1', date: '2026-01-01' },
        { id: 'run-newer', lotId: 'lot-1', date: '2026-02-01' },
      ],
    });

    expect(() => validateSyncPayload(db, {}, ['run-older']))
      .toThrow(/not the latest bottling run.*run-newer first/i);
    expect(() => validateSyncPayload(db, {}, ['run-newer'])).not.toThrow();
  });

  it('allows only an exact lot-stage and volume restoration for bottling rollback', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled', currentVolume: 100, name: 'Bottled lot' }],
      bottlingRuns: [{
        id: 'run-1',
        lotId: 'lot-1',
        date: '2026-02-01',
        previousLotStage: 'aging',
        previousLotVolumeL: 850,
      }],
    });

    expect(() => validateSyncPayload(db, {
      lots: [{ id: 'lot-1', stage: 'aging', currentVolume: 850 }],
    }, ['run-1'])).not.toThrow();

    expect(() => validateSyncPayload(db, {
      lots: [{ id: 'lot-1', stage: 'aging', currentVolume: 849 }],
    }, ['run-1'])).toThrow(/Rollback Mismatch.*volume 850/i);

    expect(() => validateSyncPayload(db, {
      lots: [{ id: 'lot-1', stage: 'fermentation', currentVolume: 850 }],
    }, ['run-1'])).toThrow(/Rollback Mismatch.*stage aging/i);

    expect(() => validateSyncPayload(db, {}, ['run-1']))
      .toThrow(/Rollback Mismatch/i);
  });

  it('applies an exact bottling rollback atomically with scoped linked tombstones', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled', currentVolume: 100 }],
      storageLocations: [{ id: 'loc-1' }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 100,
        reason: 'bottling',
        sourceRef: 'run-1',
      }],
      bottlingRuns: [{
        id: 'run-1',
        lotId: 'lot-1',
        date: '2026-02-01',
        storageMovementId: 'move-1',
        previousLotStage: 'aging',
        previousLotVolumeL: 850,
      }],
      costEntries: [{ id: 'cost-1', lotId: 'lot-1', sourceRef: 'run-1' }],
    });
    const collections = { lots: [{ id: 'lot-1', stage: 'aging', currentVolume: 850 }] };
    const deletedRecords = [
      { collection: 'bottlingRuns', id: 'run-1' },
      { collection: 'stockMovements', id: 'move-1' },
      { collection: 'costEntries', id: 'cost-1' },
    ];

    expect(() => validateSyncPayload(db, collections, undefined, deletedRecords)).not.toThrow();
    const result = buildSyncCandidate(db, collections, undefined, '', deletedRecords);
    expect(result.deletionConflict).toBe(false);
    expect(result.candidateDb.lots[0]).toMatchObject({ stage: 'aging', currentVolume: 850 });
    expect(result.candidateDb.bottlingRuns).toEqual([]);
    expect(result.candidateDb.stockMovements).toEqual([]);
    expect(result.candidateDb.costEntries).toEqual([]);
  });

  it('validates forward and reverse storage/sales links against effective tombstoned state', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1' }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 2,
        reason: 'sale',
        sourceRef: 'dispatch-1',
      }],
    });

    expect(() => validateSyncPayload(db, {
      bottlingRuns: [{ id: 'run-1', lotId: 'lot-1', storageMovementId: 'missing-movement' }],
    }, undefined)).toThrow(/non-existent or deleted Stock Movement/i);

    expect(() => validateSyncPayload(db, {
      salesDispatches: [{
        id: 'dispatch-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        stockMovementId: 'missing-movement',
      }],
    }, undefined)).toThrow(/non-existent or deleted Stock Movement/i);

    expect(() => validateSyncPayload(db, {
      salesDispatches: [{
        id: 'dispatch-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        stockMovementId: 'move-1',
        salesOrderId: 'missing-order',
      }],
    }, undefined)).toThrow(/non-existent or deleted Sales Order/i);

    expect(() => validateSyncPayload(db, {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        status: 'fulfilled',
        dispatchId: 'missing-dispatch',
      }],
    }, undefined)).toThrow(/non-existent or deleted Sales Dispatch/i);

    expect(() => validateSyncPayload(operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }],
    }), {
      stockMovements: [{
        id: 'move-new',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 2,
        reason: 'bottling',
        sourceRef: 'missing-run',
      }],
    }, undefined)).toThrow(/non-existent or deleted Bottling Run/i);

    expect(() => validateSyncPayload(db, {
      salesDispatches: [{
        id: 'dispatch-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        stockMovementId: 'move-1',
      }],
    }, undefined, [{ collection: 'stockMovements', id: 'move-1' }]))
      .toThrow(/still used by sales dispatch|non-existent or deleted Stock Movement/i);
  });

  it('accepts paired transfer corrections and rejects forged or deleted command ledger records', () => {
    const original = {
      id: 'xfer-command-1',
      commandId: 'cmd-transfer-1',
      recordKind: 'transfer',
      sourceId: 'T-1',
      destId: 'T-2',
      volume: 100,
      loss: 2,
      sourceLotId: 'LOT-A',
      resultLotId: 'LOT-A',
      operator: 'Nino',
      category: 'racking',
      date: '2026-07-20',
      pump: 'Pump',
      details: 'Transferred.',
      lastModified: '2026-07-20T08:00:00.000Z',
      reversalSnapshot: { version: 1 },
    };
    const correctedOriginal = {
      ...original,
      reversedByCommandId: 'cmd-transfer-reversal-1',
      reversedAt: '2026-07-20T09:00:00.000Z',
      reversalReason: 'Wrong vessel.',
      lastModified: '2026-07-20T09:00:00.000Z',
    };
    const correction = {
      id: 'xfer-reversal-1',
      commandId: 'cmd-transfer-reversal-1',
      recordKind: 'reversal',
      reversalOfTransferId: original.id,
      reversalOfCommandId: original.commandId,
      reversalReason: 'Wrong vessel.',
      lastModified: '2026-07-20T09:00:00.000Z',
      sourceId: 'T-2',
      destId: 'T-1',
      volume: 100,
      loss: 0,
      operator: 'Owner',
      category: 'reversal',
      date: '2026-07-20',
      pump: 'Accounting correction',
      details: 'Reversed.',
    };
    const db = operationalDb({ transfers: [original] });

    expect(() => validateSyncPayload(db, {
      transfers: [correctedOriginal, correction],
    }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, {
      transfers: [correctedOriginal, { ...correction, reversalOfCommandId: 'cmd-forged' }],
    }, undefined)).toThrow(/Mismatched Transfer Reversal/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'transfers', id: original.id },
    ])).toThrow(/Immutable Transfer Ledger/i);
  });

  it('accepts only a complete append-only sales return and protects its command ledger', () => {
    const originalMovement = {
      id: 'move-sale-original',
      commandId: 'cmd-sale-original',
      lastModified: '2026-07-20T08:00:00.000Z',
      date: '2026-07-20',
      lotId: 'lot-1',
      locationId: 'loc-1',
      direction: 'out',
      bottles: 10,
      reason: 'sale',
      sourceRef: 'dispatch-original',
    };
    const original = {
      id: 'dispatch-original',
      commandId: 'cmd-sale-original',
      recordKind: 'dispatch',
      lastModified: '2026-07-20T08:00:00.000Z',
      date: '2026-07-20',
      customerName: 'Buyer',
      lotId: 'lot-1',
      lotName: 'Lot 1',
      locationId: 'loc-1',
      locationName: 'Warehouse',
      bottles: 10,
      pricePerBottle: 20,
      currency: 'GEL',
      revenue: 200,
      cogs: 50,
      grossProfit: 150,
      stockMovementId: originalMovement.id,
      operator: 'Owner',
    };
    const correctedOriginal = {
      ...original,
      lastModified: '2026-07-20T09:00:00.000Z',
      reversedByCommandId: 'cmd-sale-reversal',
      reversedAt: '2026-07-20T09:00:00.000Z',
      reversalReason: 'Returned shipment.',
    };
    const correction = {
      ...original,
      id: 'dispatch-reversal',
      commandId: 'cmd-sale-reversal',
      recordKind: 'reversal',
      lastModified: '2026-07-20T09:00:00.000Z',
      stockMovementId: 'move-sale-return',
      reversalOfDispatchId: original.id,
      reversalOfCommandId: original.commandId,
      reversalReason: 'Returned shipment.',
    };
    const returnMovement = {
      id: 'move-sale-return',
      commandId: 'cmd-sale-reversal',
      lastModified: '2026-07-20T09:00:00.000Z',
      date: '2026-07-20',
      lotId: 'lot-1',
      locationId: 'loc-1',
      direction: 'in',
      bottles: 10,
      reason: 'sale_reversal',
      sourceRef: correction.id,
      reversalOfMovementId: originalMovement.id,
      reversalOfCommandId: original.commandId,
    };
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1', capacityBottles: 100 }],
      stockMovements: [{
        id: 'move-receipt', date: '2026-07-01', lotId: 'lot-1', locationId: 'loc-1',
        direction: 'in', bottles: 100, reason: 'manual',
      }, originalMovement],
      salesDispatches: [original],
    });
    const correctionCollections = {
      stockMovements: [returnMovement],
      salesDispatches: [correctedOriginal, correction],
    };

    expect(() => validateSyncPayload(db, correctionCollections, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      stockMovements: [{ ...returnMovement, bottles: 9 }],
    }, undefined)).toThrow(/Mismatched Sales Reversal/i);
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      salesDispatches: [correctedOriginal, { ...correction, revenue: 201 }],
    }, undefined)).toThrow(/Mismatched Sales Reversal/i);
    expect(() => validateSyncPayload(db, {
      stockMovements: [returnMovement],
      salesDispatches: [correctedOriginal],
    }, undefined)).toThrow(/Sales Reversal|correction entry/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'salesDispatches', id: original.id },
    ])).toThrow(/Immutable Sales Ledger/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'stockMovements', id: originalMovement.id },
    ])).toThrow(/Immutable Stock Ledger/i);
  });

  it('accepts only a complete bottling compensation and protects every command ledger', () => {
    const postedAt = '2026-07-20T08:00:00.000Z';
    const correctedAt = '2026-07-21T09:00:00.000Z';
    const originalMovement = {
      id: 'move-bottling-original', commandId: 'cmd-bottling-original', lastModified: postedAt,
      date: '2026-07-20', lotId: 'lot-1', locationId: 'loc-1', direction: 'in', bottles: 100,
      reason: 'bottling', sourceRef: 'run-original',
    };
    const originalRun = {
      id: 'run-original', commandId: 'cmd-bottling-original', recordKind: 'bottling',
      createdAt: postedAt, lastModified: postedAt, lotId: 'lot-1', lotName: 'Lot 1',
      date: '2026-07-20', lotNumber: 'B-1', operator: 'Nino', formats: { '0.75': 100 },
      totalBottles: 100, totalCeramic: 0, volumeBottledL: 75,
      previousLotVolumeL: 200, previousLotStage: 'aging',
      packagingMaterialIds: { bottle: 'bottle-1' }, packagingDeductions: { 'bottle-1': 100 },
      bottlesPerBox: 6, packagingCostTotal: 50, bottlingServiceCost: 25,
      storageLocationId: 'loc-1', storageMovementId: originalMovement.id, placedInStorageBottles: 100,
    };
    const updatedOriginal = {
      ...originalRun, lastModified: correctedAt, reversedByCommandId: 'cmd-bottling-reversal',
      reversedAt: correctedAt, reversalReason: 'Duplicate posting.',
    };
    const correctionRun = {
      id: 'run-reversal', commandId: 'cmd-bottling-reversal', recordKind: 'reversal',
      createdAt: correctedAt, lastModified: correctedAt, lotId: 'lot-1', lotName: 'Lot 1',
      date: '2026-07-21', lotNumber: 'B-1', operator: 'Owner', formats: { '0.75': 100 },
      totalBottles: 100, totalCeramic: 0, volumeBottledL: 75,
      packagingMaterialIds: { bottle: 'bottle-1' }, packagingDeductions: { 'bottle-1': 100 },
      bottlesPerBox: 6, packagingCostTotal: 50, bottlingServiceCost: 25,
      storageLocationId: 'loc-1', storageMovementId: 'move-bottling-reversal', placedInStorageBottles: 100,
      reversalOfRunId: originalRun.id, reversalOfCommandId: originalRun.commandId,
      reversalReason: 'Duplicate posting.',
    };
    const returnMovement = {
      id: 'move-bottling-reversal', commandId: 'cmd-bottling-reversal', lastModified: correctedAt,
      date: '2026-07-21', lotId: 'lot-1', locationId: 'loc-1', direction: 'out', bottles: 100,
      reason: 'bottling_reversal', sourceRef: correctionRun.id,
      reversalOfMovementId: originalMovement.id, reversalOfCommandId: originalRun.commandId,
    };
    const originalCosts = [
      { id: 'cost-pack', commandId: originalRun.commandId, recordKind: 'cost', lastModified: postedAt,
        date: '2026-07-20', lotId: 'lot-1', category: 'packaging', description: 'Packaging',
        amount: 50, currency: 'GEL', quantity: 100, sourceRef: originalRun.id },
      { id: 'cost-service', commandId: originalRun.commandId, recordKind: 'cost', lastModified: postedAt,
        date: '2026-07-20', lotId: 'lot-1', category: 'bottling', description: 'Service',
        amount: 25, currency: 'GEL', quantity: 100, sourceRef: originalRun.id },
    ];
    const correctedCosts = originalCosts.map(cost => ({
      ...cost, lastModified: correctedAt, reversedByCommandId: 'cmd-bottling-reversal',
      reversedAt: correctedAt, reversalReason: 'Duplicate posting.',
    }));
    const reversalCosts = originalCosts.map((cost, index) => ({
      ...cost, id: `cost-reversal-${index}`, commandId: 'cmd-bottling-reversal', recordKind: 'reversal',
      lastModified: correctedAt, date: '2026-07-21', description: `Reversal: ${cost.description}`,
      amount: -cost.amount, quantity: -100, sourceRef: correctionRun.id,
      reversalOfCostEntryId: cost.id, reversalOfCommandId: originalRun.commandId,
      reversalReason: 'Duplicate posting.',
    }));
    const restoredLot = {
      id: 'lot-1', stage: 'aging', currentVolume: 200, lastCommandId: 'cmd-bottling-reversal',
      lastModified: correctedAt,
      history: [{ date: '2026-07-21', type: 'correction', description: 'Correction', operator: 'Owner', sourceRef: correctionRun.id }],
    };
    const restoredInventory = {
      id: 'bottle-1', stock: 150, minThreshold: 0, costPerUnit: 0.5,
      lastCommandId: 'cmd-bottling-reversal', lastModified: correctedAt,
    };
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'aging', currentVolume: 125, lastCommandId: originalRun.commandId,
        lastModified: postedAt, history: [{ date: '2026-07-20', type: 'bottling', sourceRef: originalRun.id }] }],
      inventory: [{ id: 'bottle-1', stock: 50, minThreshold: 0, costPerUnit: 0.5,
        lastCommandId: originalRun.commandId, lastModified: postedAt }],
      storageLocations: [{ id: 'loc-1', capacityBottles: 500 }],
      stockMovements: [originalMovement], bottlingRuns: [originalRun], costEntries: originalCosts,
    });
    const correctionCollections = {
      lots: [restoredLot], inventory: [restoredInventory],
      bottlingRuns: [updatedOriginal, correctionRun],
      costEntries: [...reversalCosts, ...correctedCosts], stockMovements: [returnMovement],
    };

    expect(() => validateSyncPayload(db, correctionCollections, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      costEntries: [{ ...reversalCosts[0], amount: -49 }, reversalCosts[1], ...correctedCosts],
    }, undefined)).toThrow(/Bottling Reversal|Cost Reversal/i);
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      inventory: [{ ...restoredInventory, stock: 149 }],
    }, undefined)).toThrow(/packaging material/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'bottlingRuns', id: originalRun.id },
    ])).toThrow(/Immutable Bottling Ledger/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'costEntries', id: originalCosts[0].id },
    ])).toThrow(/Immutable Cost Ledger/i);
  });

  it('accepts only a complete cellar-operation compensation and protects its command ledger', () => {
    const postedAt = '2026-07-20T08:00:00.000Z';
    const correctedAt = '2026-07-21T09:00:00.000Z';
    const description = 'Fining · Bentonite 1.5kg · TANK-1';
    const original = {
      id: 'operation-original', commandId: 'cmd-operation-original', recordKind: 'operation',
      lastModified: postedAt, date: '2026-07-20', type: 'fining', lotId: 'lot-1', lotName: 'Lot 1',
      vesselId: 'TANK-1', vesselToId: null, volumeBeforeL: 920,
      materialId: 'material-1', materialName: 'Bentonite', dose: 1.5, unit: 'kg',
      operator: 'Nino', notes: '',
      reversalSnapshot: {
        version: 1,
        lot: { id: 'lot-1', currentVolume: 920, stage: 'aging' },
        vessel: { id: 'TANK-1', currentVolume: 920, lastOperation: 'Filled' },
        inventory: { id: 'material-1', stock: 12 },
        costEntry: { id: 'cost-operation-original', amount: 12, currency: 'GEL', quantity: 1.5 },
        auditId: 'audit-operation-original', operationDescription: description,
      },
    };
    const updatedOriginal = {
      ...original, lastModified: correctedAt, reversedByCommandId: 'cmd-operation-reversal',
      reversedAt: correctedAt, reversalReason: 'Wrong lot selected.',
    };
    const correction = {
      id: 'operation-reversal', commandId: 'cmd-operation-reversal', recordKind: 'reversal',
      lastModified: correctedAt, date: '2026-07-21', type: 'correction',
      customLabel: 'Reversal of fining', lotId: 'lot-1', lotName: 'Lot 1',
      vesselId: 'TANK-1', vesselToId: null, volumeBeforeL: 920, volumeAfterL: 920,
      materialId: 'material-1', materialName: 'Bentonite', dose: 1.5, unit: 'kg',
      operator: 'Owner', notes: 'Wrong lot selected.', reversalOfOperationId: original.id,
      reversalOfCommandId: original.commandId, reversalReason: 'Wrong lot selected.',
    };
    const originalCost = {
      id: 'cost-operation-original', commandId: original.commandId, recordKind: 'cost',
      lastModified: postedAt, date: '2026-07-20', lotId: 'lot-1', category: 'additive',
      description: 'Fining: Bentonite', amount: 12, currency: 'GEL', quantity: 1.5,
      unitCost: 8, sourceRef: original.id,
    };
    const updatedOriginalCost = {
      ...originalCost, lastModified: correctedAt, reversedByCommandId: correction.commandId,
      reversedAt: correctedAt, reversalReason: correction.reversalReason,
    };
    const reversalCost = {
      ...originalCost, id: 'cost-operation-reversal', commandId: correction.commandId,
      recordKind: 'reversal', lastModified: correctedAt, date: '2026-07-21',
      description: 'Reversal: Fining: Bentonite', amount: -12, quantity: -1.5,
      sourceRef: correction.id, reversalOfCostEntryId: originalCost.id,
      reversalOfCommandId: original.commandId, reversalReason: correction.reversalReason,
    };
    const originalAudit = {
      id: 'audit-operation-original', commandId: original.commandId, lastModified: postedAt,
      timestamp: postedAt, user: 'Nino', module: 'GVINO', actionType: 'Cellar Operation: Fining',
      changedItem: 'Lot lot-1', oldValue: '', newValue: description, notes: description,
    };
    const correctionAudit = {
      id: 'audit-operation-reversal', commandId: correction.commandId, lastModified: correctedAt,
      timestamp: correctedAt, user: 'Owner', module: 'GVINO',
      actionType: 'Cellar Operation Reversal: fining', changedItem: 'Lot lot-1',
      oldValue: '920 L', newValue: '920 L', notes: 'Wrong lot selected.',
    };
    const restoredLot = {
      id: 'lot-1', stage: 'aging', currentVolume: 920, lastCommandId: correction.commandId,
      lastModified: correctedAt,
      history: [{ date: '2026-07-21', type: 'correction', description: 'Correction', operator: 'Owner', sourceRef: correction.id }],
    };
    const restoredVessel = {
      id: 'TANK-1', capacity: 1_200, currentVolume: 920, assignedLotId: 'lot-1', lastOperation: 'Filled',
      lastCommandId: correction.commandId, lastModified: correctedAt,
    };
    const restoredMaterial = {
      id: 'material-1', stock: 12, minThreshold: 0, costPerUnit: 8,
      lastCommandId: correction.commandId, lastModified: correctedAt,
    };
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'aging', currentVolume: 920, lastCommandId: original.commandId,
        lastModified: postedAt, history: [{ date: '2026-07-20', type: 'Fining', description,
          operator: 'Nino', sourceRef: original.id }] }],
      vessels: [{ id: 'TANK-1', capacity: 1_200, currentVolume: 920, assignedLotId: 'lot-1',
        lastOperation: description, lastCommandId: original.commandId, lastModified: postedAt }],
      inventory: [{ id: 'material-1', stock: 10.5, minThreshold: 0, costPerUnit: 8,
        lastCommandId: original.commandId, lastModified: postedAt }],
      cellarOps: [original], costEntries: [originalCost], auditLogs: [originalAudit],
    });
    const correctionCollections = {
      lots: [restoredLot], vessels: [restoredVessel], inventory: [restoredMaterial],
      cellarOps: [updatedOriginal, correction],
      costEntries: [reversalCost, updatedOriginalCost], auditLogs: [correctionAudit],
    };

    expect(() => validateSyncPayload(db, correctionCollections, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      inventory: [{ ...restoredMaterial, stock: 11.9 }],
    }, undefined)).toThrow(/Cellar Operation Reversal.*material/i);
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      costEntries: [{ ...reversalCost, amount: -11 }, updatedOriginalCost],
    }, undefined)).toThrow(/Cellar Operation Reversal|Cost Reversal/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'cellarOps', id: original.id },
    ])).toThrow(/Immutable Cellar Operation Ledger/i);
    expect(() => validateSyncPayload(db, {
      cellarOps: [{ ...original, notes: 'forged edit' }],
    }, undefined)).toThrow(/Immutable Cellar Operation Ledger/i);
  });

  it('accepts only a complete grape-intake compensation and protects its command ledger', () => {
    const postedAt = '2026-09-15T09:00:00.000Z';
    const correctedAt = '2026-09-16T10:00:00.000Z';
    const snapshot = {
      version: 1,
      lot: { id: 'lot-intake', initialVolume: 700, currentVolume: 700, stage: 'crushing', historyDescription: 'Intake created' },
      harvest: { id: 'harvest-intake', sentToGvino: false, actualHarvestedKg: null, actualHarvestDate: null, associatedLotId: null },
      vessel: { id: 'tank-intake', currentVolume: 0, assignedLotId: null, temperature: 16, lastOperation: 'Sanitized' },
      costEntry: { id: 'cost-intake', amount: 2_500, currency: 'GEL', quantity: 1_000 },
      auditId: 'audit-intake',
    };
    const original = {
      id: 'intake-original', commandId: 'cmd-intake-original', recordKind: 'intake', lastModified: postedAt,
      date: '2026-09-15', source: 'own', blockId: 'block-intake', variety: 'Saperavi', vintage: 2026,
      grossWeightKg: 1_100, tareWeightKg: 100, netWeightKg: 1_000, brix: 23, ph: 3.4,
      titratableAcidity: 6, temperatureC: 18, condition: 'good', pickingMethod: 'hand', wineClass: 'red',
      juiceYieldPct: 70, estimatedVolumeL: 700, destinationVesselId: 'tank-intake',
      createdLotId: 'lot-intake', harvestRecordId: 'harvest-intake', operator: 'Nino', notes: '',
      reversalSnapshot: snapshot,
    };
    const updatedOriginal = {
      ...original, lastModified: correctedAt, reversedByCommandId: 'cmd-intake-reversal',
      reversedAt: correctedAt, reversalReason: 'Duplicate receipt.',
    };
    const correction = {
      ...original, id: 'intake-reversal', commandId: 'cmd-intake-reversal', recordKind: 'reversal',
      lastModified: correctedAt, date: '2026-09-16', operator: 'Owner', notes: 'Duplicate receipt.',
      reversalSnapshot: undefined, reversalOfIntakeId: original.id, reversalOfCommandId: original.commandId,
      reversalReason: 'Duplicate receipt.',
    };
    const originalCost = {
      id: 'cost-intake', commandId: original.commandId, recordKind: 'cost', lastModified: postedAt,
      date: '2026-09-15', lotId: 'lot-intake', category: 'grapes', description: 'Grapes', amount: 2_500,
      currency: 'GEL', quantity: 1_000, unitCost: 2.5, sourceRef: original.id,
    };
    const updatedOriginalCost = {
      ...originalCost, lastModified: correctedAt, reversedByCommandId: correction.commandId,
      reversedAt: correctedAt, reversalReason: correction.reversalReason,
    };
    const reversalCost = {
      ...originalCost, id: 'cost-intake-reversal', commandId: correction.commandId, recordKind: 'reversal',
      lastModified: correctedAt, date: '2026-09-16', amount: -2_500, quantity: -1_000,
      sourceRef: correction.id, reversalOfCostEntryId: originalCost.id,
      reversalOfCommandId: original.commandId, reversalReason: correction.reversalReason,
    };
    const originalAudit = {
      id: 'audit-intake', commandId: original.commandId, lastModified: postedAt, timestamp: postedAt,
      user: 'Nino', module: 'GVINO', actionType: 'Grape Receiving', changedItem: 'WineLot lot-intake',
      oldValue: 'None', newValue: '1000 kg', notes: '',
    };
    const correctionAudit = {
      id: 'audit-intake-reversal', commandId: correction.commandId, lastModified: correctedAt,
      timestamp: correctedAt, user: 'Owner', module: 'GVINO', actionType: 'Grape Receiving Reversal',
      changedItem: 'WineLot lot-intake', oldValue: '1000 kg', newValue: 'Voided', notes: 'Duplicate receipt.',
    };
    const db = operationalDb({
      blocks: [{ id: 'block-intake' }],
      harvests: [{ id: 'harvest-intake', sentToGvino: true, actualHarvestedKg: 1_000,
        actualHarvestDate: '2026-09-15', associatedLotId: 'lot-intake',
        lastCommandId: original.commandId, lastModified: postedAt }],
      lots: [{ id: 'lot-intake', commandId: original.commandId, lastCommandId: original.commandId,
        lastModified: postedAt, stage: 'crushing', initialVolume: 700, currentVolume: 700,
        history: [{ date: '2026-09-15', type: 'Grape Receiving', description: 'Intake created', sourceRef: original.id }] }],
      vessels: [{ id: 'tank-intake', capacity: 1_000, currentVolume: 700, assignedLotId: 'lot-intake',
        temperature: 18, lastOperation: 'Grape intake: Saperavi (700 L must)',
        lastCommandId: original.commandId, lastModified: postedAt }],
      grapeIntakes: [original], costEntries: [originalCost], auditLogs: [originalAudit],
    });
    const correctionCollections = {
      harvests: [{ id: 'harvest-intake', sentToGvino: false,
        lastCommandId: correction.commandId, lastModified: correctedAt }],
      lots: [{ id: 'lot-intake', commandId: original.commandId, lastCommandId: correction.commandId,
        lastModified: correctedAt, stage: 'crushing', initialVolume: 700, currentVolume: 0,
        voidedAt: correctedAt, voidedByCommandId: correction.commandId, voidReason: correction.reversalReason,
        history: [{ date: '2026-09-16', type: 'Grape Intake Reversal', description: 'Correction', sourceRef: correction.id }] }],
      vessels: [{ id: 'tank-intake', capacity: 1_000, currentVolume: 0, assignedLotId: null,
        temperature: 16, lastOperation: 'Sanitized', lastCommandId: correction.commandId, lastModified: correctedAt }],
      grapeIntakes: [updatedOriginal, correction],
      costEntries: [reversalCost, updatedOriginalCost], auditLogs: [correctionAudit],
    };

    expect(() => validateSyncPayload(db, correctionCollections, undefined))
      .toThrow(/Harvest Intake Reversal.*harvest/i);
    const correctedDb = operationalDb({
      ...db,
      ...correctionCollections,
      auditLogs: [correctionAudit, originalAudit],
    });
    expect(() => validateSyncPayload(correctedDb, correctionCollections, undefined)).not.toThrow();
    expect(() => validateSyncPayload(correctedDb, {
      ...correctionCollections,
      vessels: [{ ...correctionCollections.vessels[0], currentVolume: 1 }],
    }, undefined)).toThrow(/Harvest Intake Reversal.*vessel/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'grapeIntakes', id: original.id },
    ])).toThrow(/Immutable Grape Intake Ledger/i);
    expect(() => validateSyncPayload(db, {
      grapeIntakes: [{ ...original, netWeightKg: 999 }],
    }, undefined)).toThrow(/Immutable Grape Intake Ledger/i);
  });

  it('accepts only a complete fermentation-completion correction and protects its command ledger', () => {
    const completedAt = '2026-09-14T16:30:00.000Z';
    const correctedAt = '2026-09-15T09:00:00.000Z';
    const originalCommandId = 'cmd-fermentation-complete-original';
    const reversalCommandId = 'cmd-fermentation-complete-reversal';
    const snapshot = {
      version: 1,
      lot: { id: 'lot-ferm', stage: 'fermenting', currentVolume: 920, historyDescription: 'Completion history' },
      vessel: { id: 'tank-ferm', currentVolume: 920, assignedLotId: 'lot-ferm', lastOperation: 'Final reading recorded' },
      finalLog: {
        id: 'ferm-final', date: '2026-09-14', temperature: 20.5, density: 0.996,
        sugar: 2, ph: 3.48, tastingNotes: 'Dry and clean', capManagement: 'None', additives: 'None',
      },
      auditId: 'audit-fermentation-complete',
    };
    const original = {
      id: 'ferm-final', commandId: originalCommandId, recordKind: 'completion', lastModified: completedAt,
      tankId: 'tank-ferm', lotId: 'lot-ferm', date: '2026-09-14', temperature: 20.5,
      density: 0.996, sugar: 2, ph: 3.48, tastingNotes: 'Dry and clean', capManagement: 'None',
      additives: 'None', isCompletion: true, completedAt, completedBy: 'Nino', completionSnapshot: snapshot,
    };
    const updatedOriginal = {
      ...original, lastModified: correctedAt, reversedByCommandId: reversalCommandId,
      reversedAt: correctedAt, reversalReason: 'Completion was premature.',
    };
    const correction = {
      id: 'ferm-reversal', commandId: reversalCommandId, recordKind: 'reversal', lastModified: correctedAt,
      tankId: 'tank-ferm', lotId: 'lot-ferm', date: '2026-09-15', temperature: 20.5,
      density: 0.996, sugar: 2, ph: 3.48, tastingNotes: 'Correction', capManagement: 'correction',
      additives: '', isCompletion: false, reversalOfLogId: original.id,
      reversalOfCommandId: original.commandId, reversalReason: 'Completion was premature.',
    };
    const originalAudit = {
      id: snapshot.auditId, commandId: originalCommandId, lastModified: completedAt,
      timestamp: completedAt, user: 'Nino', module: 'GVINO', actionType: 'Fermentation Completion',
      changedItem: 'WineLot lot-ferm', oldValue: 'fermenting', newValue: 'stabilization', notes: '',
    };
    const correctionAudit = {
      id: 'audit-fermentation-reversal', commandId: reversalCommandId, lastModified: correctedAt,
      timestamp: correctedAt, user: 'Owner', module: 'GVINO', actionType: 'Fermentation Completion Reversal',
      changedItem: 'WineLot lot-ferm', oldValue: 'stabilization', newValue: 'fermenting', notes: '',
    };
    const db = operationalDb({
      lots: [{ id: 'lot-ferm', stage: 'stabilization', initialVolume: 1_000, currentVolume: 920,
        lastCommandId: originalCommandId, lastModified: completedAt,
        history: [{ type: 'Fermentation Concluded', description: 'Completion history', sourceRef: original.id }] }],
      vessels: [{ id: 'tank-ferm', capacity: 1_200, currentVolume: 920, assignedLotId: 'lot-ferm',
        lastOperation: 'Fermentation completed for lot lot-ferm; moved to stabilization',
        lastCommandId: originalCommandId, lastModified: completedAt }],
      fermlogs: [original], auditLogs: [originalAudit],
    });
    const correctionCollections = {
      lots: [{ id: 'lot-ferm', stage: 'fermenting', initialVolume: 1_000, currentVolume: 920,
        lastCommandId: reversalCommandId, lastModified: correctedAt,
        history: [{ type: 'correction', description: 'Correction', sourceRef: correction.id }] }],
      vessels: [{ id: 'tank-ferm', capacity: 1_200, currentVolume: 920, assignedLotId: 'lot-ferm',
        lastOperation: 'Final reading recorded', lastCommandId: reversalCommandId, lastModified: correctedAt }],
      fermlogs: [correction, updatedOriginal], auditLogs: [correctionAudit],
    };

    expect(() => validateSyncPayload(db, correctionCollections, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, {
      ...correctionCollections,
      vessels: [{ ...correctionCollections.vessels[0], lastOperation: 'Forged operation' }],
    }, undefined)).toThrow(/Fermentation Completion Reversal.*vessel/i);
    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'fermlogs', id: original.id },
    ])).toThrow(/Immutable Fermentation Ledger/i);
    expect(() => validateSyncPayload(db, {
      fermlogs: [{ ...original, density: 1.05 }],
    }, undefined)).toThrow(/Immutable Fermentation Ledger/i);

    const correctedDb = operationalDb({
      ...db,
      ...correctionCollections,
      lots: [{ ...correctionCollections.lots[0], stage: 'stabilization', lastCommandId: 'cmd-later-completion' }],
      vessels: [{ ...correctionCollections.vessels[0], lastOperation: 'Later completion', lastCommandId: 'cmd-later-completion' }],
      auditLogs: [correctionAudit, originalAudit],
    });
    expect(() => validateSyncPayload(correctedDb, {}, undefined)).not.toThrow();
  });

  it('rejects finished-goods stock above physical location capacity', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1', capacityBottles: 10 }],
    });
    expect(() => validateSyncPayload(db, {
      stockMovements: [{
        id: 'move-over-capacity', date: '2026-07-20', lotId: 'lot-1', locationId: 'loc-1',
        direction: 'in', bottles: 11, reason: 'manual',
      }],
    }, undefined)).toThrow(/Invalid Storage Capacity/i);
  });

  it('accepts source-linked receipts and paired relocations from storage.movement', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
      bottlingRuns: [],
      stockMovements: [],
    });
    const receipt = {
      id: 'move-receive', commandId: 'cmd-storage-receive', date: '2026-10-02',
      lotId: 'lot-1', locationId: 'loc-1', direction: 'in', bottles: 60,
      reason: 'receive', sourceRef: 'run-1',
    };
    const run = {
      id: 'run-1', lotId: 'lot-1', totalBottles: 100, totalCeramic: 0,
      placedInStorageBottles: 60,
      storagePlacements: [{
        movementId: 'move-receive', locationId: 'loc-1', bottles: 60,
        date: '2026-10-02', commandId: 'cmd-storage-receive',
      }],
    };

    expect(() => validateSyncPayload(db, {
      bottlingRuns: [run],
      stockMovements: [receipt],
    }, undefined)).not.toThrow();

    const relocation = [{
      id: 'move-transfer-out', commandId: 'cmd-storage-transfer', date: '2026-10-03',
      lotId: 'lot-1', locationId: 'loc-1', direction: 'out', bottles: 20,
      reason: 'transfer', sourceRef: 'cmd-storage-transfer', relatedMovementId: 'move-transfer-in',
    }, {
      id: 'move-transfer-in', commandId: 'cmd-storage-transfer', date: '2026-10-03',
      lotId: 'lot-1', locationId: 'loc-2', direction: 'in', bottles: 20,
      reason: 'transfer', sourceRef: 'cmd-storage-transfer', relatedMovementId: 'move-transfer-out',
    }];
    expect(() => validateSyncPayload(operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
      bottlingRuns: [run],
      stockMovements: [receipt],
    }), {
      stockMovements: relocation,
    }, undefined)).not.toThrow();

    expect(() => validateSyncPayload(db, {
      bottlingRuns: [{ ...run, placedInStorageBottles: 0, storagePlacements: [] }],
      stockMovements: [receipt],
    }, undefined)).toThrow(/does not point to stock movement/i);
    expect(() => validateSyncPayload(operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
      bottlingRuns: [run],
      stockMovements: [receipt],
    }), {
      stockMovements: [{ ...relocation[0], bottles: 21 }, relocation[1]],
    }, undefined)).toThrow(/Mismatched Storage Relocation/i);
  });

  it('keeps typed deletions collection-scoped when record IDs collide', () => {
    const db = operationalDb({
      lots: [{ id: 'shared-id', stage: 'aging' }],
      storageLocations: [{ id: 'shared-id', name: 'Temporary' }],
    });
    const deletedRecords = [{ collection: 'storageLocations', id: 'shared-id' }];

    expect(() => validateSyncPayload(db, {}, undefined, deletedRecords)).not.toThrow();
    const result = buildSyncCandidate(db, {}, undefined, '', deletedRecords);
    expect(result.candidateDb.storageLocations).toEqual([]);
    expect(result.candidateDb.lots).toEqual([{ id: 'shared-id', stage: 'aging' }]);

    expect(() => validateSyncPayload(db, {}, undefined, [
      { collection: 'unknownCollection', id: 'shared-id' },
    ])).toThrow(/invalid deleted record collection/i);
  });

  it('recovers rejected deletions, restores compound side effects, and keeps unrelated clean updates', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1' }],
      salesDispatches: [{
        id: 'dispatch-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        stockMovementId: 'move-1',
        salesOrderId: 'order-1',
      }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 2,
        reason: 'sale',
        sourceRef: 'dispatch-1',
      }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        status: 'fulfilled',
        dispatchId: 'dispatch-1',
        fulfilledAt: '2026-02-01T10:00:00.000Z',
        lastModified: 'T0',
      }],
      tasks: [{ id: 'task-1', title: 'Old', lastModified: 'T0' }],
    });
    const collections = {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        status: 'reserved',
        dispatchId: null,
        fulfilledAt: null,
        lastModified: 'T1',
        baselineTimestamp: 'T0',
      }],
      tasks: [{
        id: 'task-1',
        title: 'Clean update',
        lastModified: 'T1',
        baselineTimestamp: 'T0',
      }],
    };

    const result = buildRecoverableSyncCandidate(
      db,
      collections,
      ['dispatch-1', 'move-1'],
      'Referenced Sales Dispatch: another session added a link.',
    );

    expect(result).toMatchObject({
      deletionRejected: true,
      deletionError: expect.stringMatching(/another session/i),
    });
    expect(result.candidateDb.salesDispatches).toHaveLength(1);
    expect(result.candidateDb.stockMovements).toHaveLength(1);
    expect(result.candidateDb.salesOrders[0]).toMatchObject({
      status: 'fulfilled',
      dispatchId: 'dispatch-1',
      fulfilledAt: '2026-02-01T10:00:00.000Z',
    });
    expect(result.candidateDb.tasks[0].title).toBe('Clean update');
    expect(result.recoverableCollections?.salesOrders[0]).toMatchObject({
      status: 'fulfilled',
      dispatchId: 'dispatch-1',
      fulfilledAt: '2026-02-01T10:00:00.000Z',
    });
    expect(result.recoverableCollections?.tasks[0].title).toBe('Clean update');
  });

  it('recovers a post-merge deletion failure instead of leaving a permanent 400 tombstone', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1' }],
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 12,
      }],
      tasks: [{ id: 'task-1', title: 'Old', lastModified: 'T0' }],
    });
    const result = buildRecoverableSyncCandidate(db, {
      tasks: [{
        id: 'task-1',
        title: 'Still saved',
        lastModified: 'T1',
        baselineTimestamp: 'T0',
      }],
    }, ['loc-1']);

    expect(result.deletionRejected).toBe(true);
    expect(result.deletionError).toMatch(/still used by stock movement/i);
    expect(result.candidateDb.storageLocations).toHaveLength(1);
    expect(result.candidateDb.tasks[0].title).toBe('Still saved');
  });

  it('returns deletion rejection flags alongside conflicts without saving clean siblings', () => {
    const db = operationalDb({
      storageLocations: [{ id: 'loc-1' }],
      tasks: [
        { id: 'task-conflict', title: 'Server title', lastModified: 'T2' },
        { id: 'task-clean', title: 'Old', lastModified: 'T0' },
      ],
    });
    const result = buildRecoverableSyncCandidate(db, {
      tasks: [
        {
          id: 'task-conflict',
          title: 'Local title',
          lastModified: 'T3',
          baselineTimestamp: 'T0',
        },
        {
          id: 'task-clean',
          title: 'Saved title',
          lastModified: 'T1',
          baselineTimestamp: 'T0',
        },
      ],
    }, ['loc-1'], 'Forbidden: deletion permission changed.');

    expect(result.deletionRejected).toBe(true);
    expect(result.deletionError).toMatch(/permission changed/i);
    expect(result.conflicts).toHaveLength(1);
    expect(result.candidateDb.storageLocations).toHaveLength(1);
    expect(result.candidateDb.tasks.find((task: any) => task.id === 'task-conflict').title).toBe('Server title');
    expect(result.candidateDb.tasks.find((task: any) => task.id === 'task-clean').title).toBe('Old');
  });

  it('removes exact bottling rollback compensation from a rejected-deletion merge', () => {
    const sourceEvent = {
      date: '2026-02-01',
      type: 'Bottling',
      description: 'Run 1 bottled',
      operator: 'Nino',
      sourceRef: 'run-1',
    };
    const unrelatedServerEvent = {
      date: '2026-01-01',
      type: 'Lab',
      description: 'Baseline lab check',
      operator: 'Nino',
    };
    const unrelatedClientEvent = {
      date: '2026-03-01',
      type: 'Note',
      description: 'Unrelated client note',
      operator: 'Nino',
    };
    const db = operationalDb({
      lots: [{
        id: 'lot-1',
        stage: 'bottled',
        currentVolume: 100,
        history: [sourceEvent, unrelatedServerEvent],
      }],
      inventory: [{ id: 'bottles', stock: 5 }],
      bottlingRuns: [{
        id: 'run-1',
        lotId: 'lot-1',
        previousLotStage: 'aging',
        previousLotVolumeL: 850,
        packagingDeductions: { bottles: 10 },
      }],
    });
    const safe = prepareCollectionsForRejectedDeletion(db, {
      lots: [{
        id: 'lot-1',
        stage: 'aging',
        currentVolume: 850,
        history: [unrelatedClientEvent, unrelatedServerEvent],
      }],
      inventory: [{ id: 'bottles', stock: 15 }],
    }, ['run-1']);

    expect(safe.lots[0]).toMatchObject({ stage: 'bottled', currentVolume: 100 });
    expect(safe.lots[0].history).toContainEqual(sourceEvent);
    expect(safe.lots[0].history).toContainEqual(unrelatedClientEvent);
    expect(safe.lots[0].history.filter((event: any) => event.sourceRef === 'run-1')).toHaveLength(1);
    expect(safe.inventory[0].stock).toBe(5);
  });

  it('defers every sibling in compound sales and bottling creates when an anchor conflicts', () => {
    const salesDb = operationalDb({
      lots: [{ id: 'lot-1' }],
      storageLocations: [{ id: 'loc-1' }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        bottles: 10,
        status: 'reserved',
        lastModified: 'T2',
      }],
    });
    const salesResult = buildSyncCandidate(salesDb, {
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 10,
        reason: 'sale',
        sourceRef: 'dispatch-1',
      }],
      salesDispatches: [{
        id: 'dispatch-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        bottles: 10,
        stockMovementId: 'move-1',
        salesOrderId: 'order-1',
      }],
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        bottles: 10,
        status: 'fulfilled',
        dispatchId: 'dispatch-1',
        lastModified: 'T3',
        baselineTimestamp: 'T0',
      }],
    }, undefined);

    expect(salesResult.conflicts).toHaveLength(1);
    expect(salesResult.candidateDb.stockMovements).toEqual([]);
    expect(salesResult.candidateDb.salesDispatches).toEqual([]);
    expect(salesResult.candidateDb.salesOrders[0]).toMatchObject({ status: 'reserved', lastModified: 'T2' });

    const bottlingDb = operationalDb({
      lots: [{
        id: 'lot-1',
        stage: 'aging',
        currentVolume: 850,
        lastModified: 'T2',
      }],
      storageLocations: [{ id: 'loc-1' }],
    });
    const bottlingResult = buildSyncCandidate(bottlingDb, {
      lots: [{
        id: 'lot-1',
        stage: 'bottled',
        currentVolume: 775,
        lastModified: 'T3',
        baselineTimestamp: 'T0',
      }],
      stockMovements: [{
        id: 'move-bottle',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 100,
        reason: 'bottling',
        sourceRef: 'run-1',
      }],
      bottlingRuns: [{
        id: 'run-1',
        lotId: 'lot-1',
        storageLocationId: 'loc-1',
        storageMovementId: 'move-bottle',
        placedInStorageBottles: 100,
      }],
    }, undefined);

    expect(bottlingResult.conflicts).toHaveLength(1);
    expect(bottlingResult.candidateDb.bottlingRuns).toEqual([]);
    expect(bottlingResult.candidateDb.stockMovements).toEqual([]);
    expect(bottlingResult.candidateDb.lots[0]).toMatchObject({ stage: 'aging', currentVolume: 850 });
  });

  it('enforces bottling movement direction, source, lot, location, reason, and bottle parity', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }, { id: 'lot-2', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
      stockMovements: [{
        id: 'move-in',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 20,
        reason: 'manual',
      }],
    });
    const validMovement = {
      id: 'move-1',
      lotId: 'lot-1',
      locationId: 'loc-1',
      direction: 'in',
      bottles: 100,
      reason: 'bottling',
      sourceRef: 'run-1',
    };
    const run = {
      id: 'run-1',
      lotId: 'lot-1',
      storageLocationId: 'loc-1',
      storageMovementId: 'move-1',
      placedInStorageBottles: 100,
    };

    expect(() => validateSyncPayload(db, {
      stockMovements: [validMovement],
      bottlingRuns: [run],
    }, undefined)).not.toThrow();

    for (const mutation of [
      { direction: 'out' },
      { reason: 'manual' },
      { sourceRef: 'other-run' },
      { lotId: 'lot-2' },
      { locationId: 'loc-2' },
      { bottles: 99 },
    ]) {
      expect(() => validateSyncPayload(db, {
        stockMovements: [{ ...validMovement, ...mutation }],
        bottlingRuns: [run],
      }, undefined)).toThrow(/Mismatched|Orphaned/i);
    }
  });

  it('enforces sales movement parity and a reciprocal fulfilled order link', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }, { id: 'lot-2', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }, { id: 'loc-2' }],
      stockMovements: [{
        id: 'move-in',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 20,
        reason: 'manual',
      }],
    });
    const movement = {
      id: 'move-1',
      lotId: 'lot-1',
      locationId: 'loc-1',
      direction: 'out',
      bottles: 10,
      reason: 'sale',
      sourceRef: 'dispatch-1',
    };
    const dispatch = {
      id: 'dispatch-1',
      lotId: 'lot-1',
      locationId: 'loc-1',
      bottles: 10,
      stockMovementId: 'move-1',
      salesOrderId: 'order-1',
    };
    const order = {
      id: 'order-1',
      lotId: 'lot-1',
      locationId: 'loc-1',
      bottles: 10,
      status: 'fulfilled',
      dispatchId: 'dispatch-1',
    };

    expect(() => validateSyncPayload(db, {
      stockMovements: [movement],
      salesDispatches: [dispatch],
      salesOrders: [order],
    }, undefined)).not.toThrow();

    for (const mutation of [
      { direction: 'in' },
      { reason: 'manual' },
      { sourceRef: 'other-dispatch' },
      { lotId: 'lot-2' },
      { locationId: 'loc-2' },
      { bottles: 9 },
    ]) {
      expect(() => validateSyncPayload(db, {
        stockMovements: [{ ...movement, ...mutation }],
        salesDispatches: [dispatch],
        salesOrders: [order],
      }, undefined)).toThrow(/Mismatched|Orphaned/i);
    }

    expect(() => validateSyncPayload(db, {
      stockMovements: [movement],
      salesDispatches: [dispatch],
      salesOrders: [{ ...order, status: 'reserved' }],
    }, undefined)).toThrow(/must be fulfilled/i);
    expect(() => validateSyncPayload(db, {
      stockMovements: [movement],
      salesDispatches: [dispatch],
      salesOrders: [{ ...order, bottles: 9 }],
    }, undefined)).toThrow(/does not match dispatch/i);
  });

  it.each([
    ['lots', [{ id: 'duplicate-1' }, { id: 'duplicate-1' }]],
    ['harvests', [{ id: 'duplicate-1' }, { id: 'duplicate-1' }]],
  ])('rejects duplicate IDs in incoming %s', (collection, records) => {
    expect(() => validateSyncPayload(operationalDb({ harvests: [] }), {
      [collection]: records,
    }, undefined)).toThrow(new RegExp(`Duplicate ID in ${collection}`, 'i'));
  });

  it('rejects duplicate movement and dispatch IDs before merge', () => {
    const movementDb = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }],
    });
    const movement = {
      id: 'move-1',
      lotId: 'lot-1',
      locationId: 'loc-1',
      direction: 'in',
      bottles: 10,
      reason: 'manual',
    };
    expect(() => validateSyncPayload(movementDb, {
      stockMovements: [movement, { ...movement }],
    }, undefined)).toThrow(/Duplicate ID in stockMovements/i);

    const dispatchDb = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }],
      stockMovements: [{
        id: 'move-sale',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 10,
        reason: 'sale',
        sourceRef: 'dispatch-1',
      }],
    });
    const dispatch = {
      id: 'dispatch-1',
      lotId: 'lot-1',
      locationId: 'loc-1',
      bottles: 10,
      stockMovementId: 'move-sale',
    };
    expect(() => validateSyncPayload(dispatchDb, {
      salesDispatches: [dispatch, { ...dispatch }],
    }, undefined)).toThrow(/Duplicate ID in salesDispatches/i);
  });

  it('rejects post-merge negative stock and over-reservation aggregates', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }],
      stockMovements: [
        { id: 'in-1', lotId: 'lot-1', locationId: 'loc-1', direction: 'in', bottles: 100, reason: 'manual' },
        { id: 'out-1', lotId: 'lot-1', locationId: 'loc-1', direction: 'out', bottles: 80, reason: 'manual' },
      ],
    });

    expect(() => validateSyncPayload(db, {
      stockMovements: [{
        id: 'out-concurrent',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'out',
        bottles: 80,
        reason: 'manual',
      }],
    }, undefined)).toThrow(/outbound movements exceed inbound stock/i);
    expect(db.stockMovements).toHaveLength(2);

    expect(() => validateSyncPayload(db, {
      salesOrders: [{
        id: 'order-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        bottles: 30,
        status: 'reserved',
      }],
    }, undefined)).toThrow(/reserved bottles exceed 20 on hand/i);
  });

  it.each(['crushing', 'fermenting'])('rejects storage movements for %s bulk lots', stage => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage }],
      storageLocations: [{ id: 'loc-1' }],
    });
    expect(() => validateSyncPayload(db, {
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 10,
        reason: 'manual',
      }],
    }, undefined)).toThrow(/not bottled and has no bottling provenance/i);
  });

  it('accepts storage movements for bottled lots', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'bottled' }],
      storageLocations: [{ id: 'loc-1' }],
    });
    expect(() => validateSyncPayload(db, {
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 10,
        reason: 'manual',
      }],
    }, undefined)).not.toThrow();
  });

  it('accepts first partial-bottling storage placement through same-payload run provenance', () => {
    const db = operationalDb({
      lots: [{ id: 'lot-1', stage: 'aging' }],
      storageLocations: [{ id: 'loc-1' }],
    });
    expect(() => validateSyncPayload(db, {
      stockMovements: [{
        id: 'move-1',
        lotId: 'lot-1',
        locationId: 'loc-1',
        direction: 'in',
        bottles: 100,
        reason: 'bottling',
        sourceRef: 'run-1',
      }],
      bottlingRuns: [{
        id: 'run-1',
        lotId: 'lot-1',
        storageLocationId: 'loc-1',
        storageMovementId: 'move-1',
        placedInStorageBottles: 100,
      }],
    }, undefined)).not.toThrow();
  });

  it('allows command-ledger echoes but rejects invoice receipt or movement edits through sync', () => {
    const receipt = {
      id: 'receipt-1', commandId: 'cmd-1', status: 'posted', analysisId: 'analysis-1',
      duplicateFingerprint: 'number:supplier:1', invoice: { supplierName: 'Supplier', currency: 'GEL' },
    };
    const movement = {
      id: 'movement-1', commandId: 'cmd-1', kind: 'invoice_receipt', direction: 'in',
      inventoryItemId: 'item-1', quantity: 1, unit: 'kg', accountingAmount: 10,
    };
    const db = operationalDb({ invoiceReceipts: [receipt], inventoryMovements: [movement] });

    expect(() => validateSyncPayload(db, {
      invoiceReceipts: [{ ...receipt }],
      inventoryMovements: [{ ...movement }],
    }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, {
      invoiceReceipts: [{ ...receipt, status: 'reversed' }],
    }, undefined)).toThrow(/Immutable Invoice Receipt Ledger/);
    expect(() => validateSyncPayload(db, {
      inventoryMovements: [{ ...movement, quantity: 99 }],
    }, undefined)).toThrow(/Immutable Inventory Movement Ledger/);
  });

  it('validates recurring SOP evidence as an append-only bounded history', () => {
    const original = {
      id: 'sop-1', title: 'ATP check', category: 'sanitation', frequency: 'monthly',
      nextDueDate: '2026-08-13', checklist: ['Rinse'], evidenceRequired: true,
      completionHistory: [{ id: 'completion-1', completedAt: '2026-07-13T10:00:00.000Z', completedBy: 'ana', completedChecklist: ['Rinse'], evidenceNote: '18 RLU' }],
    };
    const db = operationalDb({ qualitySops: [original] });
    expect(() => validateSyncPayload(db, { qualitySops: [{
      ...original,
      nextDueDate: '2026-09-13',
      completionHistory: [
        { id: 'completion-2', completedAt: '2026-08-13T10:00:00.000Z', completedBy: 'ana', completedChecklist: ['Rinse'], evidenceNote: '12 RLU' },
        ...original.completionHistory,
      ],
    }] }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, { qualitySops: [{
      ...original,
      completionHistory: [{ ...original.completionHistory[0], evidenceNote: 'forged' }],
    }] }, undefined)).toThrow(/append-only/i);
  });

  it('requires purchase-order receipt evidence before closing an order', () => {
    const inventory = [{ id: 'item-1', name: 'Yeast', unit: 'kg' }];
    const line = { id: 'po-line-1', inventoryItemId: 'item-1', productName: 'Yeast', quantity: 2, receivedQuantity: 0, unit: 'kg', unitCost: 10 };
    const order = { id: 'po-1', orderNumber: 'PO-1', supplierName: 'Supplier', status: 'ordered', currency: 'GEL', lines: [line] };
    const db = operationalDb({ inventory, purchaseOrders: [order] });
    expect(() => validateSyncPayload(db, { purchaseOrders: [{ ...order, status: 'received', lines: [{ ...line, receivedQuantity: 2 }] }] }, undefined)).toThrow(/evidence/i);
    expect(() => validateSyncPayload(db, { purchaseOrders: [{
      ...order, status: 'received', receivedAt: '2026-08-13T10:00:00.000Z', receiptCommandId: 'cmd-receipt-1',
      receiptHistory: [{
        id: 'po-receipt-1', commandId: 'cmd-receipt-1', receivedAt: '2026-08-13T10:00:00.000Z', receivedBy: 'ana',
        lines: [{ purchaseOrderLineId: 'po-line-1', quantity: 2 }],
      }],
      lines: [{ ...line, receivedQuantity: 2 }],
    }] }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, { purchaseOrders: [{
      ...order, status: 'partially_received', receiptCommandId: 'cmd-receipt-partial',
      receiptHistory: [{
        id: 'po-receipt-partial', commandId: 'cmd-receipt-partial', receivedAt: '2026-08-13T09:00:00.000Z', receivedBy: 'ana',
        lines: [{ purchaseOrderLineId: 'po-line-1', quantity: 1 }],
      }],
      lines: [{ ...line, receivedQuantity: 1 }],
    }] }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(db, { purchaseOrders: [{
      ...order, status: 'partially_received', receiptCommandId: 'cmd-receipt-forged',
      receiptHistory: [{
        id: 'po-receipt-forged', commandId: 'cmd-receipt-forged', receivedAt: '2026-08-13T09:00:00.000Z', receivedBy: 'ana',
        lines: [{ purchaseOrderLineId: 'po-line-1', quantity: 0.5 }],
      }],
      lines: [{ ...line, receivedQuantity: 1 }],
    }] }, undefined)).toThrow(/lacks matching evidence/i);
  });

  it('rejects impossible production dates and unknown dependencies', () => {
    const base = {
      id: 'plan-1', title: 'Transfer', kind: 'transfer', status: 'planned',
      startDate: '2026-08-14', endDate: '2026-08-15', vesselIds: [], dependencyIds: [],
    };
    const db = operationalDb({ productionPlans: [] });
    expect(() => validateSyncPayload(db, { productionPlans: [{ ...base, endDate: '2026-08-13' }] }, undefined)).toThrow(/cannot end before/i);
    expect(() => validateSyncPayload(db, { productionPlans: [{ ...base, operationType: 'teleport' }] }, undefined)).toThrow(/invalid cellar operation type/i);
    expect(() => validateSyncPayload(db, { productionPlans: [{ ...base, dependencyIds: ['missing'] }] }, undefined)).toThrow(/unknown dependency/i);
    const cyclic = operationalDb({ productionPlans: [
      { ...base, id: 'plan-1', dependencyIds: ['plan-2'] },
      { ...base, id: 'plan-2', dependencyIds: ['plan-1'] },
    ] });
    expect(() => validateSyncPayload(cyclic, { productionPlans: cyclic.productionPlans }, undefined)).toThrow(/dependency cycle/i);
  });

  it('enforces production-plan status order and completed prerequisites on the server', () => {
    const prerequisite = {
      id: 'plan-prepare', title: 'Prepare vessel', kind: 'sanitation', status: 'in_progress',
      startDate: '2026-08-13', endDate: '2026-08-13', vesselIds: [], dependencyIds: [],
    };
    const transfer = {
      id: 'plan-transfer', title: 'Transfer', kind: 'transfer', status: 'planned',
      startDate: '2026-08-14', endDate: '2026-08-15', vesselIds: [], dependencyIds: ['plan-prepare'],
    };
    const db = operationalDb({ productionPlans: [prerequisite, transfer] });

    expect(() => validateSyncPayload(db, {
      productionPlans: [{ ...transfer, status: 'completed' }],
    }, undefined)).toThrow(/cannot move from planned to completed/i);
    expect(() => validateSyncPayload(db, {
      productionPlans: [{ ...transfer, status: 'ready' }],
    }, undefined)).toThrow(/Complete prerequisite work first/i);

    const readyDb = operationalDb({
      productionPlans: [{ ...prerequisite, status: 'completed' }, transfer],
    });
    expect(() => validateSyncPayload(readyDb, {
      productionPlans: [{ ...transfer, status: 'ready' }],
    }, undefined)).not.toThrow();
  });

  it('freezes recall exposure and makes closure terminal', () => {
    const recall = {
      id: 'recall-1', lotId: 'lot-1', title: 'Recall lot-1', reason: 'Cork issue', status: 'active',
      openedAt: '2026-08-13T10:00:00.000Z', openedBy: 'ana', affectedBottlingRunIds: [],
      affectedOrderIds: [], affectedDispatchIds: [], containmentTaskIds: ['task-1'], notes: '',
    };
    const task = { id: 'task-1', title: 'Quarantine', priority: 'high', dueDate: '2026-08-13', assignedTo: 'Ana', status: 'completed', description: '' };
    expect(() => validateSyncPayload(operationalDb({ lots: [{ id: 'lot-1' }] }), {
      tasks: [task],
      recallCases: [recall],
    }, undefined)).not.toThrow();
    const db = operationalDb({ lots: [{ id: 'lot-1' }], tasks: [task], recallCases: [recall] });
    expect(() => validateSyncPayload(db, { recallCases: [{ ...recall, status: 'closed' }] }, undefined)).toThrow(/cannot move/i);
    const contained = { ...recall, status: 'contained', containedAt: '2026-08-13T10:30:00.000Z', containedBy: 'ana' };
    expect(() => validateSyncPayload(db, { recallCases: [contained] }, undefined)).not.toThrow();
    const pendingDb = operationalDb({ lots: [{ id: 'lot-1' }], tasks: [{ ...task, status: 'pending' }], recallCases: [recall] });
    expect(() => validateSyncPayload(pendingDb, { recallCases: [contained] }, undefined)).toThrow(/every containment task/i);
    const closed = { ...contained, status: 'closed', closedAt: '2026-08-13T11:00:00.000Z', closedBy: 'ana' };
    expect(() => validateSyncPayload(operationalDb({ lots: [{ id: 'lot-1' }], tasks: [task], recallCases: [contained] }), { recallCases: [closed] }, undefined)).not.toThrow();
    expect(() => validateSyncPayload(operationalDb({ lots: [{ id: 'lot-1' }], tasks: [task], recallCases: [closed] }), {
      recallCases: [{ ...closed, status: 'active' }],
    }, undefined)).toThrow(/cannot move/i);
    expect(() => validateSyncPayload(db, { recallCases: [{ ...recall, reason: 'Changed' }] }, undefined)).toThrow(/exposure evidence/i);
  });
});
