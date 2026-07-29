import type {
  BottlingRunRecord,
  CellarTransferRecord,
  CellarOperation,
  DailyFermLog,
  GrapeIntakeRecord,
  HarvestRecord,
  InventoryItem,
  MaraniOSAuditLog,
  SalesDispatchRecord,
  SalesOrderRecord,
  Vessel,
  WineLot,
} from '../wineryState';
import type { CostEntry } from '../costing';
import type { StockMovement } from '../storage';
import {
  SyncQueueManager,
  type PendingCommandIntent,
} from '../syncQueue';
import {
  TRANSFER_COMMAND_TYPE,
  type TransferCommandPayload,
  type TransferCommandResult,
} from './transfer';
import {
  TRANSFER_REVERSAL_COMMAND_TYPE,
  type TransferReversalCommandPayload,
  type TransferReversalCommandResult,
} from './transferReversal';
import {
  BOTTLING_COMMAND_TYPE,
  type BottlingCommandPayload,
  type BottlingCommandResult,
} from './bottling';
import {
  BOTTLING_REVERSAL_COMMAND_TYPE,
  type BottlingReversalCommandPayload,
  type BottlingReversalCommandResult,
} from './bottlingReversal';
import {
  SALES_STOCK_COMMAND_TYPE,
  type CancelSalesStockPayload,
  type DispatchSalesStockPayload,
  type FulfillSalesStockPayload,
  type ReserveSalesStockPayload,
  type SalesStockCommandPayload,
  type SalesStockCommandResult,
} from './salesStock';
import {
  SALES_STOCK_REVERSAL_COMMAND_TYPE,
  type SalesStockReversalCommandPayload,
  type SalesStockReversalCommandResult,
} from './salesStockReversal';
import {
  HARVEST_INTAKE_COMMAND_TYPE,
  type HarvestIntakeCommandPayload,
  type HarvestIntakeCommandResult,
  type HarvestIntakeInput,
} from './harvestIntake';
import {
  HARVEST_INTAKE_REVERSAL_COMMAND_TYPE,
  type HarvestIntakeReversalCommandPayload,
  type HarvestIntakeReversalCommandResult,
} from './harvestIntakeReversal';
import {
  FERMENTATION_COMPLETION_COMMAND_TYPE,
  type FermentationCompletionCommandPayload,
  type FermentationCompletionCommandResult,
} from './fermentationCompletion';
import {
  FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE,
  type FermentationCompletionReversalCommandPayload,
  type FermentationCompletionReversalCommandResult,
} from './fermentationCompletionReversal';
import {
  CELLAR_OPERATION_COMMAND_TYPE,
  type CellarOperationCommandPayload,
  type CellarOperationCommandResult,
  type CellarOperationInput,
} from './cellarOperation';
import {
  CELLAR_OPERATION_REVERSAL_COMMAND_TYPE,
  type CellarOperationReversalCommandPayload,
  type CellarOperationReversalCommandResult,
} from './cellarOperationReversal';
import {
  STORAGE_MOVEMENT_COMMAND_TYPE,
  type AdjustStorageMovementPayload,
  type ReceiveStorageMovementPayload,
  type RelocateStorageMovementPayload,
  type StorageMovementCommandPayload,
  type StorageMovementCommandResult,
} from './storageMovement';

export interface TransferCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof TRANSFER_COMMAND_TYPE;
  result: TransferCommandResult;
  collections?: {
    vessels: Vessel[];
    lots: WineLot[];
    transfers: CellarTransferRecord[];
    costEntries: CostEntry[];
  };
}

export interface TransferReversalCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof TRANSFER_REVERSAL_COMMAND_TYPE;
  result: TransferReversalCommandResult;
  collections?: {
    vessels: Vessel[];
    lots: WineLot[];
    transfers: CellarTransferRecord[];
    costEntries: CostEntry[];
  };
}

export interface BottlingCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof BOTTLING_COMMAND_TYPE;
  result: BottlingCommandResult;
  collections?: {
    lots: WineLot[];
    bottlingRuns: BottlingRunRecord[];
    inventory: InventoryItem[];
    costEntries: CostEntry[];
    stockMovements: StockMovement[];
  };
}

export interface BottlingReversalCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof BOTTLING_REVERSAL_COMMAND_TYPE;
  result: BottlingReversalCommandResult;
  collections?: {
    lots: WineLot[];
    bottlingRuns: BottlingRunRecord[];
    inventory: InventoryItem[];
    costEntries: CostEntry[];
    stockMovements: StockMovement[];
  };
}

export interface SalesStockCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof SALES_STOCK_COMMAND_TYPE;
  result: SalesStockCommandResult;
  collections?: {
    stockMovements: StockMovement[];
    salesDispatches: SalesDispatchRecord[];
    salesOrders: SalesOrderRecord[];
  };
}

export interface SalesStockReversalCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof SALES_STOCK_REVERSAL_COMMAND_TYPE;
  result: SalesStockReversalCommandResult;
  collections?: {
    stockMovements: StockMovement[];
    salesDispatches: SalesDispatchRecord[];
    salesOrders: SalesOrderRecord[];
  };
}

export interface HarvestIntakeCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof HARVEST_INTAKE_COMMAND_TYPE;
  result: HarvestIntakeCommandResult;
  collections?: {
    harvests: HarvestRecord[];
    lots: WineLot[];
    vessels: Vessel[];
    grapeIntakes: GrapeIntakeRecord[];
    costEntries: CostEntry[];
    auditLogs: MaraniOSAuditLog[];
  };
}

export interface HarvestIntakeReversalCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof HARVEST_INTAKE_REVERSAL_COMMAND_TYPE;
  result: HarvestIntakeReversalCommandResult;
  collections?: {
    harvests: HarvestRecord[];
    lots: WineLot[];
    vessels: Vessel[];
    grapeIntakes: GrapeIntakeRecord[];
    costEntries: CostEntry[];
    auditLogs: MaraniOSAuditLog[];
  };
}

export interface FermentationCompletionCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof FERMENTATION_COMPLETION_COMMAND_TYPE;
  result: FermentationCompletionCommandResult;
  collections?: {
    lots: WineLot[];
    vessels: Vessel[];
    fermlogs: DailyFermLog[];
    auditLogs: MaraniOSAuditLog[];
  };
}

export interface FermentationCompletionReversalCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE;
  result: FermentationCompletionReversalCommandResult;
  collections?: {
    lots: WineLot[];
    vessels: Vessel[];
    fermlogs: DailyFermLog[];
    auditLogs: MaraniOSAuditLog[];
  };
}

export interface CellarOperationCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof CELLAR_OPERATION_COMMAND_TYPE;
  result: CellarOperationCommandResult;
  collections?: {
    lots: WineLot[];
    vessels: Vessel[];
    inventory: InventoryItem[];
    cellarOps: CellarOperation[];
    costEntries: CostEntry[];
    auditLogs: MaraniOSAuditLog[];
  };
}

export interface CellarOperationReversalCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof CELLAR_OPERATION_REVERSAL_COMMAND_TYPE;
  result: CellarOperationReversalCommandResult;
  collections?: {
    lots: WineLot[];
    vessels: Vessel[];
    inventory: InventoryItem[];
    cellarOps: CellarOperation[];
    costEntries: CostEntry[];
    auditLogs: MaraniOSAuditLog[];
  };
}

export interface StorageMovementCommandResponse {
  ok: true;
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: typeof STORAGE_MOVEMENT_COMMAND_TYPE;
  result: StorageMovementCommandResult;
  collections?: {
    bottlingRuns: BottlingRunRecord[];
    stockMovements: StockMovement[];
  };
}

export class CommandRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'CommandRequestError';
  }
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function createTransferCommandIntent(
  payload: Omit<TransferCommandPayload, 'transferId' | 'blendLotId'>,
): PendingCommandIntent<TransferCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-transfer-${nonce}`,
    commandType: TRANSFER_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      transferId: `xfer-${nonce}`,
      blendLotId: `blend-${nonce}`,
    },
  };
}

export function pendingTransferCommandIntent(): PendingCommandIntent<TransferCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<TransferCommandPayload>()
    .find(intent => intent.commandType === TRANSFER_COMMAND_TYPE) || null;
}

export function createTransferReversalCommandIntent(
  payload: Omit<TransferReversalCommandPayload, 'reversalId'>,
): PendingCommandIntent<TransferReversalCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-transfer-reversal-${nonce}`,
    commandType: TRANSFER_REVERSAL_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      reversalId: `xfer-reversal-${nonce}`,
    },
  };
}

export function pendingTransferReversalCommandIntent(): PendingCommandIntent<TransferReversalCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<TransferReversalCommandPayload>()
    .find(intent => intent.commandType === TRANSFER_REVERSAL_COMMAND_TYPE) || null;
}

export function createBottlingCommandIntent(
  payload: Omit<BottlingCommandPayload, 'runId'>,
): PendingCommandIntent<BottlingCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-bottling-${nonce}`,
    commandType: BOTTLING_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      runId: `bot-${nonce}`,
    },
  };
}

export function pendingBottlingCommandIntent(): PendingCommandIntent<BottlingCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<BottlingCommandPayload>()
    .find(intent => intent.commandType === BOTTLING_COMMAND_TYPE) || null;
}

export function createBottlingReversalCommandIntent(
  payload: Omit<BottlingReversalCommandPayload,
    'reversalRunId' | 'storageReturnMovementId' | 'packagingCostReversalId' | 'serviceCostReversalId'>,
): PendingCommandIntent<BottlingReversalCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-bottling-reversal-${nonce}`,
    commandType: BOTTLING_REVERSAL_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      reversalRunId: `bot-reversal-${nonce}`,
      storageReturnMovementId: `mov-bottling-reversal-${nonce}`,
      packagingCostReversalId: `cost-packaging-reversal-${nonce}`,
      serviceCostReversalId: `cost-service-reversal-${nonce}`,
    },
  };
}

export function pendingBottlingReversalCommandIntent(): PendingCommandIntent<BottlingReversalCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<BottlingReversalCommandPayload>()
    .find(intent => intent.commandType === BOTTLING_REVERSAL_COMMAND_TYPE) || null;
}

export type CreateSalesStockIntentInput =
  | Omit<ReserveSalesStockPayload, 'orderId' | 'orderNumber'>
  | Omit<DispatchSalesStockPayload, 'dispatchId'>
  | Omit<FulfillSalesStockPayload, 'dispatchId'>
  | CancelSalesStockPayload;

export function createSalesStockCommandIntent(
  input: CreateSalesStockIntentInput,
): PendingCommandIntent<SalesStockCommandPayload> {
  const nonce = randomId();
  let payload: SalesStockCommandPayload;
  if (input.action === 'reserve') {
    const suffix = nonce.replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() || 'ORDER';
    payload = {
      ...input,
      orderId: `so-${nonce}`,
      orderNumber: `SO-${input.orderDate.replace(/-/g, '')}-${suffix}`,
    };
  } else if (input.action === 'dispatch' || input.action === 'fulfill') {
    payload = { ...input, dispatchId: `sale-${nonce}` };
  } else {
    payload = input;
  }
  return {
    commandId: `cmd-sales-${nonce}`,
    commandType: SALES_STOCK_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload,
  };
}

export function pendingSalesStockCommandIntent(): PendingCommandIntent<SalesStockCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<SalesStockCommandPayload>()
    .find(intent => intent.commandType === SALES_STOCK_COMMAND_TYPE) || null;
}

export function createSalesStockReversalCommandIntent(
  payload: Omit<SalesStockReversalCommandPayload, 'reversalDispatchId' | 'returnMovementId'>,
): PendingCommandIntent<SalesStockReversalCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-sales-reversal-${nonce}`,
    commandType: SALES_STOCK_REVERSAL_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      reversalDispatchId: `sale-reversal-${nonce}`,
      returnMovementId: `mov-sale-return-${nonce}`,
    },
  };
}

export function pendingSalesStockReversalCommandIntent(): PendingCommandIntent<SalesStockReversalCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<SalesStockReversalCommandPayload>()
    .find(intent => intent.commandType === SALES_STOCK_REVERSAL_COMMAND_TYPE) || null;
}

export function createHarvestIntakeCommandIntent(
  intake: HarvestIntakeInput,
): PendingCommandIntent<HarvestIntakeCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-intake-${nonce}`,
    commandType: HARVEST_INTAKE_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      intakeId: `intake-${nonce}`,
      lotId: `lot-${nonce}`,
      auditId: `audit-intake-${nonce}`,
      intake: { ...intake },
    },
  };
}

export function pendingHarvestIntakeCommandIntent(): PendingCommandIntent<HarvestIntakeCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<HarvestIntakeCommandPayload>()
    .find(intent => intent.commandType === HARVEST_INTAKE_COMMAND_TYPE) || null;
}

export function createHarvestIntakeReversalCommandIntent(
  payload: Omit<HarvestIntakeReversalCommandPayload,
    'reversalIntakeId' | 'auditId' | 'costReversalId'>,
): PendingCommandIntent<HarvestIntakeReversalCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-intake-reversal-${nonce}`,
    commandType: HARVEST_INTAKE_REVERSAL_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      reversalIntakeId: `intake-reversal-${nonce}`,
      auditId: `audit-intake-reversal-${nonce}`,
      costReversalId: `cost-intake-reversal-${nonce}`,
    },
  };
}

export function pendingHarvestIntakeReversalCommandIntent(
): PendingCommandIntent<HarvestIntakeReversalCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<HarvestIntakeReversalCommandPayload>()
    .find(intent => intent.commandType === HARVEST_INTAKE_REVERSAL_COMMAND_TYPE) || null;
}

export function createFermentationCompletionCommandIntent(
  payload: Omit<FermentationCompletionCommandPayload, 'auditId'>,
): PendingCommandIntent<FermentationCompletionCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-fermentation-complete-${nonce}`,
    commandType: FERMENTATION_COMPLETION_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      auditId: `audit-fermentation-complete-${nonce}`,
    },
  };
}

export function pendingFermentationCompletionCommandIntent(): PendingCommandIntent<FermentationCompletionCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<FermentationCompletionCommandPayload>()
    .find(intent => intent.commandType === FERMENTATION_COMPLETION_COMMAND_TYPE) || null;
}

export function createFermentationCompletionReversalCommandIntent(
  payload: Omit<FermentationCompletionReversalCommandPayload, 'reversalLogId' | 'auditId'>,
): PendingCommandIntent<FermentationCompletionReversalCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-fermentation-complete-reversal-${nonce}`,
    commandType: FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      reversalLogId: `ferm-reversal-${nonce}`,
      auditId: `audit-fermentation-complete-reversal-${nonce}`,
    },
  };
}

export function pendingFermentationCompletionReversalCommandIntent(
): PendingCommandIntent<FermentationCompletionReversalCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<FermentationCompletionReversalCommandPayload>()
    .find(intent => intent.commandType === FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE) || null;
}

export function createCellarOperationCommandIntent(
  operation: CellarOperationInput,
): PendingCommandIntent<CellarOperationCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-cellar-operation-${nonce}`,
    commandType: CELLAR_OPERATION_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      operationId: `op-${nonce}`,
      auditId: `audit-cellar-operation-${nonce}`,
      operation: { ...operation },
    },
  };
}

export function pendingCellarOperationCommandIntent(): PendingCommandIntent<CellarOperationCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<CellarOperationCommandPayload>()
    .find(intent => intent.commandType === CELLAR_OPERATION_COMMAND_TYPE) || null;
}

export function createCellarOperationReversalCommandIntent(
  payload: Omit<CellarOperationReversalCommandPayload,
    'reversalOperationId' | 'auditId' | 'costReversalId'>,
): PendingCommandIntent<CellarOperationReversalCommandPayload> {
  const nonce = randomId();
  return {
    commandId: `cmd-cellar-operation-reversal-${nonce}`,
    commandType: CELLAR_OPERATION_REVERSAL_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload: {
      ...payload,
      reversalOperationId: `op-reversal-${nonce}`,
      auditId: `audit-cellar-operation-reversal-${nonce}`,
      costReversalId: `cost-cellar-operation-reversal-${nonce}`,
    },
  };
}

export function pendingCellarOperationReversalCommandIntent(
): PendingCommandIntent<CellarOperationReversalCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<CellarOperationReversalCommandPayload>()
    .find(intent => intent.commandType === CELLAR_OPERATION_REVERSAL_COMMAND_TYPE) || null;
}

export type CreateStorageMovementIntentInput =
  | Omit<ReceiveStorageMovementPayload, 'movementId'>
  | Omit<RelocateStorageMovementPayload, 'sourceMovementId' | 'destinationMovementId'>
  | Omit<AdjustStorageMovementPayload, 'movementId'>;

export function createStorageMovementCommandIntent(
  input: CreateStorageMovementIntentInput,
): PendingCommandIntent<StorageMovementCommandPayload> {
  const nonce = randomId();
  let payload: StorageMovementCommandPayload;
  if (input.action === 'relocate') {
    payload = {
      ...input,
      sourceMovementId: `mov-relocate-out-${nonce}`,
      destinationMovementId: `mov-relocate-in-${nonce}`,
    };
  } else {
    payload = {
      ...input,
      movementId: `mov-${input.action}-${nonce}`,
    };
  }
  return {
    commandId: `cmd-storage-${nonce}`,
    commandType: STORAGE_MOVEMENT_COMMAND_TYPE,
    capturedAt: new Date().toISOString(),
    payload,
  };
}

export function pendingStorageMovementCommandIntent(): PendingCommandIntent<StorageMovementCommandPayload> | null {
  return SyncQueueManager
    .getPendingCommandIntents<StorageMovementCommandPayload>()
    .find(intent => intent.commandType === STORAGE_MOVEMENT_COMMAND_TYPE) || null;
}

export async function submitTransferCommand(
  intent: PendingCommandIntent<TransferCommandPayload>,
): Promise<TransferCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string' ? apiError.message : `Transfer rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId || !body.result?.transfer) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The transfer response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as TransferCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the transfer. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitTransferReversalCommand(
  intent: PendingCommandIntent<TransferReversalCommandPayload>,
): Promise<TransferReversalCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.transfer.reverse', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Transfer reversal rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || !body.result?.originalTransfer || !body.result?.reversalTransfer) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The transfer reversal response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as TransferReversalCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the transfer reversal. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitBottlingCommand(
  intent: PendingCommandIntent<BottlingCommandPayload>,
): Promise<BottlingCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.bottling', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string' ? apiError.message : `Bottling rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId || !body.result?.run) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The bottling response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as BottlingCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the bottling run. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitBottlingReversalCommand(
  intent: PendingCommandIntent<BottlingReversalCommandPayload>,
): Promise<BottlingReversalCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.bottling.reverse', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Bottling reversal rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || !body.result?.originalRun || !body.result?.reversalRun) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The bottling reversal response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }
    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as BottlingReversalCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the bottling reversal. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitSalesStockCommand(
  intent: PendingCommandIntent<SalesStockCommandPayload>,
): Promise<SalesStockCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/sales.stock', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string' ? apiError.message : `Sales stock action rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId || !body.result?.receipt) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The sales stock response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as SalesStockCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the sales stock action. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitSalesStockReversalCommand(
  intent: PendingCommandIntent<SalesStockReversalCommandPayload>,
): Promise<SalesStockReversalCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/sales.stock.reverse', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Sales stock reversal rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || !body.result?.originalDispatch || !body.result?.reversalDispatch || !body.result?.returnMovement) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The sales stock reversal response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as SalesStockReversalCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the sales stock reversal. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitHarvestIntakeCommand(
  intent: PendingCommandIntent<HarvestIntakeCommandPayload>,
): Promise<HarvestIntakeCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.harvest-intake', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string' ? apiError.message : `Grape intake rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== HARVEST_INTAKE_COMMAND_TYPE || !body.result?.intake || !body.result?.lot) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The grape intake response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as HarvestIntakeCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the grape intake. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitHarvestIntakeReversalCommand(
  intent: PendingCommandIntent<HarvestIntakeReversalCommandPayload>,
): Promise<HarvestIntakeReversalCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.harvest-intake.reverse', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Grape intake reversal rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== HARVEST_INTAKE_REVERSAL_COMMAND_TYPE
      || !body.result?.originalIntake || !body.result?.reversalIntake
      || !body.result?.voidedLot || !body.result?.auditLog) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The grape-intake reversal response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as HarvestIntakeReversalCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the grape-intake reversal. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitFermentationCompletionCommand(
  intent: PendingCommandIntent<FermentationCompletionCommandPayload>,
): Promise<FermentationCompletionCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest(
      '/api/commands/cellar.fermentation-complete',
      intent,
    );
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Fermentation completion rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== FERMENTATION_COMPLETION_COMMAND_TYPE
      || !body.result?.finalLog || !body.result?.lot || !body.result?.vessel || !body.result?.auditLog) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The fermentation completion response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as FermentationCompletionCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge fermentation completion. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitFermentationCompletionReversalCommand(
  intent: PendingCommandIntent<FermentationCompletionReversalCommandPayload>,
): Promise<FermentationCompletionReversalCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest(
      '/api/commands/cellar.fermentation-complete.reverse',
      intent,
    );
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Fermentation-completion reversal rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE
      || !body.result?.originalLog || !body.result?.reversalLog
      || !body.result?.lot || !body.result?.vessel || !body.result?.auditLog) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The fermentation-completion reversal response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as FermentationCompletionReversalCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge fermentation-completion reversal. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitCellarOperationCommand(
  intent: PendingCommandIntent<CellarOperationCommandPayload>,
): Promise<CellarOperationCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.operation', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Cellar operation rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== CELLAR_OPERATION_COMMAND_TYPE
      || !body.result?.operation || !body.result?.lot || !body.result?.auditLog) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The cellar operation response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as CellarOperationCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the cellar operation. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitCellarOperationReversalCommand(
  intent: PendingCommandIntent<CellarOperationReversalCommandPayload>,
): Promise<CellarOperationReversalCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/cellar.operation.reverse', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Cellar operation reversal rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== CELLAR_OPERATION_REVERSAL_COMMAND_TYPE
      || !body.result?.originalOperation || !body.result?.reversalOperation
      || !body.result?.updatedLot || !body.result?.auditLog) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The cellar-operation reversal response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as CellarOperationReversalCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the cellar-operation reversal. Retry to recover the original result.',
      0,
      true,
    );
  }
}

export async function submitStorageMovementCommand(
  intent: PendingCommandIntent<StorageMovementCommandPayload>,
): Promise<StorageMovementCommandResponse> {
  try {
    const response = await SyncQueueManager.executeCommandRequest('/api/commands/storage.movement', intent);
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const apiError = body?.error && typeof body.error === 'object' ? body.error : null;
      const retryable = apiError?.retryable === true || response.status >= 500;
      if (!retryable) SyncQueueManager.consumePendingCommandIntent(intent.commandId);
      throw new CommandRequestError(
        typeof apiError?.code === 'string' ? apiError.code : 'command_rejected',
        typeof apiError?.message === 'string'
          ? apiError.message
          : `Storage movement rejected (HTTP ${response.status}).`,
        response.status,
        retryable,
      );
    }
    if (!body || body.ok !== true || body.commandId !== intent.commandId
      || body.commandType !== STORAGE_MOVEMENT_COMMAND_TYPE
      || !Array.isArray(body.result?.movements) || !body.result?.receipt) {
      throw new CommandRequestError(
        'invalid_command_response',
        'The storage movement response could not be verified. Retry the same command.',
        response.status,
        true,
      );
    }

    SyncQueueManager.consumePendingCommandIntent(intent.commandId);
    return body as StorageMovementCommandResponse;
  } catch (error) {
    if (error instanceof CommandRequestError) throw error;
    throw new CommandRequestError(
      'command_network_error',
      'The server did not acknowledge the storage movement. Retry to recover the original result.',
      0,
      true,
    );
  }
}
