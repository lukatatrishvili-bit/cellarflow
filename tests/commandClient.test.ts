import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandRequestError,
  createBottlingCommandIntent,
  createBottlingReversalCommandIntent,
  createCellarOperationCommandIntent,
  createCellarOperationReversalCommandIntent,
  createFermentationCompletionCommandIntent,
  createFermentationCompletionReversalCommandIntent,
  createHarvestIntakeCommandIntent,
  createHarvestIntakeReversalCommandIntent,
  createSalesStockCommandIntent,
  createSalesStockReversalCommandIntent,
  createStorageMovementCommandIntent,
  createTransferCommandIntent,
  createTransferReversalCommandIntent,
  pendingBottlingCommandIntent,
  pendingBottlingReversalCommandIntent,
  pendingCellarOperationCommandIntent,
  pendingCellarOperationReversalCommandIntent,
  pendingFermentationCompletionCommandIntent,
  pendingFermentationCompletionReversalCommandIntent,
  pendingHarvestIntakeCommandIntent,
  pendingHarvestIntakeReversalCommandIntent,
  pendingSalesStockCommandIntent,
  pendingSalesStockReversalCommandIntent,
  pendingStorageMovementCommandIntent,
  pendingTransferReversalCommandIntent,
  submitBottlingCommand,
  submitBottlingReversalCommand,
  submitCellarOperationCommand,
  submitCellarOperationReversalCommand,
  submitFermentationCompletionCommand,
  submitFermentationCompletionReversalCommand,
  submitHarvestIntakeCommand,
  submitHarvestIntakeReversalCommand,
  submitSalesStockCommand,
  submitSalesStockReversalCommand,
  submitStorageMovementCommand,
  submitTransferCommand,
  submitTransferReversalCommand,
} from '../lib/commands/client';
import { SyncQueueManager } from '../lib/syncQueue';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
  removeItem(key: string): void { this.store.delete(key); }
}

function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-cellarflow-org-id': 'org-command-client' },
  });
}

const payload = {
  sourceVesselId: 'T-1',
  destinationVesselId: 'T-2',
  volumeLiters: 100,
  lossLiters: 2,
  operator: 'Client Winemaker',
  category: 'racking' as const,
  pump: 'Client Pump',
};

const bottlingPayload = {
  lotId: 'LOT-A',
  date: '2026-07-20',
  lotNumber: 'CLIENT-01',
  operator: 'Client Winemaker',
  formats: { '0.75': 100 },
  packagingSelections: { bottle: 'BOTTLE' },
  bottlesPerBox: 6,
  bottlingServiceCost: 25,
  storageLocationId: 'STORE-A',
};

const salesReservePayload = {
  action: 'reserve' as const,
  orderDate: '2026-07-20',
  requestedDispatchDate: '2026-07-22',
  reservedUntil: '2026-07-25',
  customerName: 'Client Buyer',
  lotId: 'LOT-A',
  locationId: 'STORE-A',
  bottles: 20,
  pricePerBottle: 18,
  operator: 'Client Owner',
  notes: '',
};

const harvestIntakePayload = {
  date: '2026-09-15',
  source: 'own' as const,
  blockId: 'BLOCK-A',
  blockName: 'Block A',
  variety: 'Saperavi',
  vintage: 2026,
  grossWeightKg: 1_100,
  tareWeightKg: 100,
  brix: 23.5,
  ph: 3.45,
  titratableAcidity: 6.1,
  temperatureC: 18,
  condition: 'good' as const,
  pickingMethod: 'hand' as const,
  wineClass: 'red' as const,
  juiceYieldPct: 70,
  paymentStatus: 'not_applicable' as const,
  destinationVesselId: null,
  harvestRecordId: 'HARVEST-A',
  operator: 'Client Winemaker',
  notes: '',
};

describe('durable command client', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    localStorage.setItem('cellarflow_org_state_org_id', 'org-command-client');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates stable, valid identifiers for one transfer intent', () => {
    const intent = createTransferCommandIntent(payload);

    expect(intent.commandId).toMatch(/^cmd-transfer-[A-Za-z0-9-]+$/);
    expect(intent.payload.transferId).toMatch(/^xfer-[A-Za-z0-9-]+$/);
    expect(intent.payload.blendLotId).toMatch(/^blend-[A-Za-z0-9-]+$/);
    expect(intent.payload.sourceVesselId).toBe('T-1');
  });

  it('consumes durable intent only after a verifiable acknowledgement', async () => {
    const intent = createTransferCommandIntent(payload);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.transfer',
      result: { transfer: { id: intent.payload.transferId } },
    }, 201)));

    await expect(submitTransferCommand(intent)).resolves.toMatchObject({ commandId: intent.commandId });
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('retains intent after a retryable storage failure', async () => {
    const intent = createTransferCommandIntent(payload);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    const error = await submitTransferCommand(intent).catch(value => value);
    expect(error).toBeInstanceOf(CommandRequestError);
    expect(error).toMatchObject({ code: 'command_store_unavailable', retryable: true });
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([intent]);
  });

  it('consumes intent after a definitive domain rejection that performed no mutation', async () => {
    const intent = createTransferCommandIntent(payload);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'insufficient_source_volume',
        message: 'Not enough wine remains.',
        retryable: false,
      },
    }, 409)));

    await expect(submitTransferCommand(intent)).rejects.toMatchObject({
      code: 'insufficient_source_volume',
      retryable: false,
    });
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('creates, recovers, and acknowledges a stable transfer reversal intent', async () => {
    const intent = createTransferReversalCommandIntent({
      originalCommandId: 'cmd-transfer-original-client-0001',
      reason: 'Wrong destination vessel.',
    });
    expect(intent.commandId).toMatch(/^cmd-transfer-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.reversalId).toMatch(/^xfer-reversal-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)).mockResolvedValueOnce(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.transfer.reverse',
      result: {
        originalTransfer: { id: 'xfer-original-client-0001' },
        reversalTransfer: { id: intent.payload.reversalId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitTransferReversalCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable',
      retryable: true,
    });
    expect(pendingTransferReversalCommandIntent()).toEqual(intent);
    await expect(submitTransferReversalCommand(intent)).resolves.toMatchObject({
      commandId: intent.commandId,
      commandType: 'cellar.transfer.reverse',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/cellar.transfer.reverse',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('creates, recovers, and acknowledges one stable sales reversal intent', async () => {
    const intent = createSalesStockReversalCommandIntent({
      originalCommandId: 'cmd-sales-original-client-0001',
      reason: 'Customer returned the shipment.',
    });
    expect(intent.commandId).toMatch(/^cmd-sales-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.reversalDispatchId).toMatch(/^sale-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.returnMovementId).toMatch(/^mov-sale-return-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)).mockResolvedValueOnce(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'sales.stock.reverse',
      result: {
        originalDispatch: { id: 'sale-original-client-0001' },
        reversalDispatch: { id: intent.payload.reversalDispatchId },
        returnMovement: { id: intent.payload.returnMovementId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitSalesStockReversalCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable',
      retryable: true,
    });
    expect(pendingSalesStockReversalCommandIntent()).toEqual(intent);
    await expect(submitSalesStockReversalCommand(intent)).resolves.toMatchObject({
      commandId: intent.commandId,
      commandType: 'sales.stock.reverse',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/sales.stock.reverse',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('creates and acknowledges a stable bottling intent through the bottling endpoint', async () => {
    const intent = createBottlingCommandIntent(bottlingPayload);
    expect(intent.commandId).toMatch(/^cmd-bottling-[A-Za-z0-9-]+$/);
    expect(intent.payload.runId).toMatch(/^bot-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.bottling',
      result: { run: { id: intent.payload.runId } },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitBottlingCommand(intent)).resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/cellar.bottling', expect.objectContaining({
      method: 'POST',
    }));
    expect(SyncQueueManager.getPendingCommandIntents()).toEqual([]);
  });

  it('restores the exact bottling intent after an unacknowledged retryable response', async () => {
    const intent = createBottlingCommandIntent(bottlingPayload);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    await expect(submitBottlingCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable',
      retryable: true,
    });
    expect(pendingBottlingCommandIntent()).toEqual(intent);
  });

  it('consumes a bottling intent after a definitive inventory rejection', async () => {
    const intent = createBottlingCommandIntent(bottlingPayload);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'insufficient_packaging_stock',
        message: 'Not enough bottles remain.',
        retryable: false,
      },
    }, 409)));

    await expect(submitBottlingCommand(intent)).rejects.toMatchObject({
      code: 'insufficient_packaging_stock',
      retryable: false,
    });
    expect(pendingBottlingCommandIntent()).toBeNull();
  });

  it('recovers the exact bottling correction intent and acknowledges it once', async () => {
    const intent = createBottlingReversalCommandIntent({
      originalCommandId: 'cmd-bottling-original',
      reason: 'Duplicate bottling posting',
    });
    expect(intent.commandId).toMatch(/^cmd-bottling-reversal-/);
    expect(intent.payload.reversalRunId).toMatch(/^bot-reversal-/);
    expect(intent.payload.storageReturnMovementId).toMatch(/^mov-bottling-reversal-/);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        ok: false,
        error: { code: 'command_store_unavailable', message: 'Retry later.', retryable: true },
      }, 503))
      .mockResolvedValueOnce(response({
        ok: true,
        disposition: 'executed',
        commandId: intent.commandId,
        commandType: 'cellar.bottling.reverse',
        result: {
          originalRun: { id: 'run-original' },
          reversalRun: { id: intent.payload.reversalRunId },
        },
      }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitBottlingReversalCommand(intent)).rejects.toMatchObject({ retryable: true });
    expect(pendingBottlingReversalCommandIntent()).toEqual(intent);
    await expect(submitBottlingReversalCommand(intent)).resolves.toMatchObject({
      commandId: intent.commandId,
      commandType: 'cellar.bottling.reverse',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/cellar.bottling.reverse', expect.objectContaining({
      method: 'POST',
    }));
    expect(pendingBottlingReversalCommandIntent()).toBeNull();
  });

  it('creates stable record identifiers for sales reservation, dispatch, and fulfillment intents', () => {
    const reservation = createSalesStockCommandIntent(salesReservePayload);
    const dispatch = createSalesStockCommandIntent({
      action: 'dispatch',
      date: '2026-07-20',
      customerName: 'Client Buyer',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles: 10,
      pricePerBottle: 18,
      operator: 'Client Owner',
      notes: '',
    });
    const fulfillment = createSalesStockCommandIntent({
      action: 'fulfill',
      orderId: 'so-existing',
      date: '2026-07-20',
      operator: 'Client Owner',
    });

    expect(reservation.commandId).toMatch(/^cmd-sales-[A-Za-z0-9-]+$/);
    expect(reservation.payload).toMatchObject({ action: 'reserve' });
    expect(reservation.payload.action === 'reserve' && reservation.payload.orderId).toMatch(/^so-/);
    expect(dispatch.payload.action === 'dispatch' && dispatch.payload.dispatchId).toMatch(/^sale-/);
    expect(fulfillment.payload.action === 'fulfill' && fulfillment.payload.dispatchId).toMatch(/^sale-/);
  });

  it('acknowledges a verified sales stock result and consumes its durable intent', async () => {
    const intent = createSalesStockCommandIntent(salesReservePayload);
    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'sales.stock',
      result: {
        action: 'reserve',
        receipt: { action: 'reserve', orderId: intent.payload.action === 'reserve' ? intent.payload.orderId : '' },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitSalesStockCommand(intent)).resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/sales.stock', expect.objectContaining({ method: 'POST' }));
    expect(pendingSalesStockCommandIntent()).toBeNull();
  });

  it('retains the exact sales intent after an uncertain server response', async () => {
    const intent = createSalesStockCommandIntent({ action: 'cancel', orderId: 'so-existing' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    await expect(submitSalesStockCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable',
      retryable: true,
    });
    expect(pendingSalesStockCommandIntent()).toEqual(intent);
  });

  it('creates paired relocation ids and acknowledges a verified storage movement', async () => {
    const intent = createStorageMovementCommandIntent({
      action: 'relocate',
      date: '2026-10-02',
      lotId: 'LOT-A',
      sourceLocationId: 'STORE-A',
      destinationLocationId: 'STORE-B',
      bottles: 12,
      note: 'Reserve room move',
    });
    expect(intent.commandId).toMatch(/^cmd-storage-[A-Za-z0-9-]+$/);
    expect(intent.payload.action === 'relocate' && intent.payload.sourceMovementId).toMatch(/^mov-relocate-out-/);
    expect(intent.payload.action === 'relocate' && intent.payload.destinationMovementId).toMatch(/^mov-relocate-in-/);

    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'storage.movement',
      result: {
        movements: [{ id: intent.payload.action === 'relocate' ? intent.payload.sourceMovementId : '' }],
        receipt: { action: 'relocate', lotId: 'LOT-A', bottles: 12 },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitStorageMovementCommand(intent)).resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/storage.movement', expect.objectContaining({ method: 'POST' }));
    expect(pendingStorageMovementCommandIntent()).toBeNull();
  });

  it('restores the exact storage movement after an uncertain response', async () => {
    const intent = createStorageMovementCommandIntent({
      action: 'receive',
      date: '2026-10-02',
      lotId: 'LOT-A',
      bottlingRunId: 'RUN-A',
      locationId: 'STORE-A',
      bottles: 24,
      note: '',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    await expect(submitStorageMovementCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable', retryable: true,
    });
    expect(pendingStorageMovementCommandIntent()).toEqual(intent);
  });

  it('creates stable intake, lot, and audit identifiers for a harvest-intake intent', () => {
    const intent = createHarvestIntakeCommandIntent(harvestIntakePayload);

    expect(intent.commandId).toMatch(/^cmd-intake-[A-Za-z0-9-]+$/);
    expect(intent.payload.intakeId).toMatch(/^intake-[A-Za-z0-9-]+$/);
    expect(intent.payload.lotId).toMatch(/^lot-[A-Za-z0-9-]+$/);
    expect(intent.payload.auditId).toMatch(/^audit-intake-[A-Za-z0-9-]+$/);
    expect(intent.payload.intake).toEqual(harvestIntakePayload);
  });

  it('acknowledges a verified harvest-intake result and consumes its durable intent', async () => {
    const intent = createHarvestIntakeCommandIntent(harvestIntakePayload);
    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.harvest-intake',
      result: {
        intake: { id: intent.payload.intakeId },
        lot: { id: intent.payload.lotId },
        receipt: { intakeId: intent.payload.intakeId, lotId: intent.payload.lotId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitHarvestIntakeCommand(intent)).resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/cellar.harvest-intake', expect.objectContaining({ method: 'POST' }));
    expect(pendingHarvestIntakeCommandIntent()).toBeNull();
  });

  it('restores the exact harvest-intake intent after an uncertain response', async () => {
    const intent = createHarvestIntakeCommandIntent(harvestIntakePayload);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    await expect(submitHarvestIntakeCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable',
      retryable: true,
    });
    expect(pendingHarvestIntakeCommandIntent()).toEqual(intent);
  });

  it('creates stable harvest-intake correction ids and consumes a verified response', async () => {
    const intent = createHarvestIntakeReversalCommandIntent({
      originalCommandId: 'cmd-intake-original',
      reason: 'Duplicate receipt',
    });
    expect(intent.commandId).toMatch(/^cmd-intake-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.reversalIntakeId).toMatch(/^intake-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.auditId).toMatch(/^audit-intake-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.costReversalId).toMatch(/^cost-intake-reversal-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.harvest-intake.reverse',
      result: {
        originalIntake: { id: 'intake-original' },
        reversalIntake: { id: intent.payload.reversalIntakeId },
        voidedLot: { id: 'lot-original' },
        auditLog: { id: intent.payload.auditId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitHarvestIntakeReversalCommand(intent)).resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith('/api/commands/cellar.harvest-intake.reverse', expect.objectContaining({ method: 'POST' }));
    expect(pendingHarvestIntakeReversalCommandIntent()).toBeNull();
  });

  it('keeps the exact harvest-intake correction intent after an uncertain response', async () => {
    const intent = createHarvestIntakeReversalCommandIntent({
      originalCommandId: 'cmd-intake-original',
      reason: 'Duplicate receipt',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: { code: 'command_store_unavailable', message: 'Unavailable', retryable: true },
    }, 503)));

    await expect(submitHarvestIntakeReversalCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable', retryable: true,
    });
    expect(pendingHarvestIntakeReversalCommandIntent()).toEqual(intent);
  });

  it('creates and acknowledges a stable fermentation-completion intent', async () => {
    const intent = createFermentationCompletionCommandIntent({
      lotId: 'LOT-FERM-1',
      vesselId: 'TANK-FERM-1',
      finalLogId: 'FLOG-FINAL-1',
      operator: 'Client Winemaker',
    });
    expect(intent.commandId).toMatch(/^cmd-fermentation-complete-[A-Za-z0-9-]+$/);
    expect(intent.payload.auditId).toMatch(/^audit-fermentation-complete-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.fermentation-complete',
      result: {
        lot: { id: intent.payload.lotId },
        vessel: { id: intent.payload.vesselId },
        finalLog: { id: intent.payload.finalLogId },
        auditLog: { id: intent.payload.auditId },
        receipt: { lotId: intent.payload.lotId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitFermentationCompletionCommand(intent))
      .resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/cellar.fermentation-complete',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(pendingFermentationCompletionCommandIntent()).toBeNull();
  });

  it('restores the exact fermentation completion after an uncertain response', async () => {
    const intent = createFermentationCompletionCommandIntent({
      lotId: 'LOT-FERM-1',
      vesselId: 'TANK-FERM-1',
      finalLogId: 'FLOG-FINAL-1',
      operator: 'Client Winemaker',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    await expect(submitFermentationCompletionCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable',
      retryable: true,
    });
    expect(pendingFermentationCompletionCommandIntent()).toEqual(intent);
  });

  it('creates and acknowledges a stable fermentation-completion reversal intent', async () => {
    const intent = createFermentationCompletionReversalCommandIntent({
      originalCommandId: 'cmd-fermentation-complete-original',
      reason: 'Completion was recorded prematurely.',
    });
    expect(intent.commandId).toMatch(/^cmd-fermentation-complete-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.reversalLogId).toMatch(/^ferm-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.auditId).toMatch(/^audit-fermentation-complete-reversal-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.fermentation-complete.reverse',
      result: {
        lot: { id: 'LOT-FERM-1' }, vessel: { id: 'TANK-FERM-1' },
        originalLog: { id: 'FLOG-FINAL-1' },
        reversalLog: { id: intent.payload.reversalLogId },
        auditLog: { id: intent.payload.auditId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitFermentationCompletionReversalCommand(intent))
      .resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/cellar.fermentation-complete.reverse',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(pendingFermentationCompletionReversalCommandIntent()).toBeNull();
  });

  it('keeps the exact fermentation-completion reversal after an uncertain response', async () => {
    const intent = createFermentationCompletionReversalCommandIntent({
      originalCommandId: 'cmd-fermentation-complete-original',
      reason: 'Completion was recorded prematurely.',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: { code: 'command_store_unavailable', message: 'Unavailable', retryable: true },
    }, 503)));

    await expect(submitFermentationCompletionReversalCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable', retryable: true,
    });
    expect(pendingFermentationCompletionReversalCommandIntent()).toEqual(intent);
  });

  it('creates and acknowledges stable cellar-operation, audit, and command identifiers', async () => {
    const intent = createCellarOperationCommandIntent({
      date: '2026-09-10', type: 'sulfitation', lotId: 'LOT-CELLAR-1',
      vesselId: 'TANK-CELLAR-1', vesselToId: null, materialId: 'INV-SO2', dose: 0.2,
      operator: 'Client Winemaker', notes: 'Protection dose.',
    });
    expect(intent.commandId).toMatch(/^cmd-cellar-operation-[A-Za-z0-9-]+$/);
    expect(intent.payload.operationId).toMatch(/^op-[A-Za-z0-9-]+$/);
    expect(intent.payload.auditId).toMatch(/^audit-cellar-operation-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn().mockResolvedValue(response({
      ok: true,
      disposition: 'executed',
      commandId: intent.commandId,
      commandType: 'cellar.operation',
      result: {
        operation: { id: intent.payload.operationId },
        lot: { id: intent.payload.operation.lotId },
        auditLog: { id: intent.payload.auditId },
        receipt: { operationId: intent.payload.operationId },
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitCellarOperationCommand(intent))
      .resolves.toMatchObject({ commandId: intent.commandId });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/cellar.operation',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(pendingCellarOperationCommandIntent()).toBeNull();
  });

  it('restores the exact cellar operation after an uncertain response', async () => {
    const intent = createCellarOperationCommandIntent({
      date: '2026-09-10', type: 'measurement', lotId: 'LOT-CELLAR-1',
      vesselId: null, vesselToId: null, operator: 'Client Winemaker', notes: '',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      ok: false,
      error: {
        code: 'command_store_unavailable',
        message: 'Durable command storage is unavailable.',
        retryable: true,
      },
    }, 503)));

    await expect(submitCellarOperationCommand(intent)).rejects.toMatchObject({
      code: 'command_store_unavailable', retryable: true,
    });
    expect(pendingCellarOperationCommandIntent()).toEqual(intent);
  });

  it('keeps stable cellar-operation reversal ids until the server acknowledges compensation', async () => {
    const intent = createCellarOperationReversalCommandIntent({
      originalCommandId: 'cmd-cellar-operation-original',
      reason: 'Wrong treatment was recorded.',
    });
    expect(intent.commandId).toMatch(/^cmd-cellar-operation-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.reversalOperationId).toMatch(/^op-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.auditId).toMatch(/^audit-cellar-operation-reversal-[A-Za-z0-9-]+$/);
    expect(intent.payload.costReversalId).toMatch(/^cost-cellar-operation-reversal-[A-Za-z0-9-]+$/);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        ok: false,
        error: { code: 'command_store_unavailable', message: 'Retry.', retryable: true },
      }, 503))
      .mockResolvedValueOnce(response({
        ok: true,
        disposition: 'executed',
        commandId: intent.commandId,
        commandType: 'cellar.operation.reverse',
        result: {
          originalOperation: { id: 'OP-ORIGINAL' },
          reversalOperation: { id: intent.payload.reversalOperationId },
          updatedLot: { id: 'LOT-1' },
          auditLog: { id: intent.payload.auditId },
        },
      }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitCellarOperationReversalCommand(intent)).rejects.toMatchObject({ retryable: true });
    expect(pendingCellarOperationReversalCommandIntent()).toEqual(intent);
    await expect(submitCellarOperationReversalCommand(intent)).resolves.toMatchObject({
      commandId: intent.commandId,
      commandType: 'cellar.operation.reverse',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/commands/cellar.operation.reverse',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(pendingCellarOperationReversalCommandIntent()).toBeNull();
  });
});
