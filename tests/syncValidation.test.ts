import { describe, expect, it } from 'vitest';
import { checksumAttachmentDataUrl, MAX_INLINE_ATTACHMENT_BYTES } from '../lib/attachments';
import {
  buildRecoverableSyncCandidate,
  buildSyncCandidate,
  prepareAttachmentsForServerMerge,
  prepareCollectionsForRejectedDeletion,
  validateSyncPayload,
} from '../server/routes/sync';

const baseDb = () => ({
  lots: [],
  auditLogs: [],
  attachments: [],
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
  storageLocations: [],
  stockMovements: [],
  salesDispatches: [],
  salesOrders: [],
  bottlingRuns: [],
  costEntries: [],
  tasks: [],
  ...fields,
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
});
