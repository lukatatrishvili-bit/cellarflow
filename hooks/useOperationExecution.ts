import { useCallback, useState } from 'react';
import type { CostEntry } from '../lib/costing';
import type {
  CellarOperation,
  InventoryItem,
  MaraniOSAuditLog,
  Vessel,
  WineLot,
} from '../lib/wineryState';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import type {
  CellarOperationCommandPayload,
  CellarOperationInput,
} from '../lib/commands/cellarOperation';
import type { CellarOperationCommandResponse } from '../lib/commands/client';

/**
 * Committing one cellar operation, in one place.
 *
 * A recorded operation reaches state by three routes — the durable command
 * round trip, local application of that same command when the command store is
 * unavailable, and a bare `onAddOperation` when the command bindings are absent
 * altogether. Getting all three right once is work; getting them right twice,
 * in the operations screen and again on the cellar map, is how they drift.
 *
 * Validation stays with each caller: the operations screen has a full form with
 * materials and cost drivers, the map has a short one. What they share is what
 * happens after someone presses record.
 *
 * The command modules load on demand — this is reachable from `App`, and they
 * are large enough to matter on the critical path.
 */

export interface OperationExecutionDeps {
  lots: WineLot[];
  vessels: Vessel[];
  inventory: InventoryItem[];
  cellarOps: CellarOperation[];
  costEntries: CostEntry[];
  auditLogs: MaraniOSAuditLog[];
  currency: string;
  costAutomation?: unknown;
  actorUsername: string;
  onUpdateLots?: (lots: WineLot[]) => void;
  onUpdateVessels?: (vessels: Vessel[]) => void;
  onUpdateInventory?: (inventory: InventoryItem[]) => void;
  onUpdateOperations?: (operations: CellarOperation[]) => void;
  onUpdateCostEntries?: (entries: CostEntry[]) => void;
  onUpdateAuditLogs?: (logs: MaraniOSAuditLog[]) => void;
  onApplyCommandResponse?: (response: CellarOperationCommandResponse) => void;
  /**
   * Used when the command bindings above are absent, which is the case for
   * callers that only own the operation ledger. Returns the new operation id.
   */
  onAddOperation?: (input: CellarOperationInput) => string;
  /** Runs once per successful commit, whichever route applied it. */
  onApplied?: (operation: Pick<CellarOperation, 'id' | 'vesselId'>) => void;
}

export type OperationExecutionOutcome =
  | { ok: true; operation: Pick<CellarOperation, 'id' | 'vesselId'>; lotName?: string }
  | { ok: false; error: string; retryableIntent?: PendingCommandIntent<CellarOperationCommandPayload> };

export interface OperationExecution {
  executeOperation: (
    input: CellarOperationInput,
    pendingIntent?: PendingCommandIntent<CellarOperationCommandPayload> | null,
  ) => Promise<OperationExecutionOutcome>;
  isSubmitting: boolean;
}

export function useOperationExecution(deps: OperationExecutionDeps): OperationExecution {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const applyLocally = useCallback(async (
    intent: PendingCommandIntent<CellarOperationCommandPayload>,
  ): Promise<OperationExecutionOutcome> => {
    const hasCommandBindings = Boolean(
      deps.onUpdateLots && deps.onUpdateVessels && deps.onUpdateInventory
      && deps.onUpdateOperations && deps.onUpdateCostEntries && deps.onUpdateAuditLogs,
    );

    if (!hasCommandBindings) {
      if (!deps.onAddOperation) {
        return { ok: false, error: 'This workspace cannot record cellar operations.' };
      }
      const id = deps.onAddOperation(intent.payload.operation);
      if (!id) return { ok: false, error: 'The operation was refused.' };
      const operation = { id, vesselId: intent.payload.operation.vesselId };
      deps.onApplied?.(operation);
      return { ok: true, operation };
    }

    try {
      const { applyCellarOperationCommand } = await import('../lib/commands/cellarOperation');
      const applied = applyCellarOperationCommand(
        {
          lots: deps.lots,
          vessels: deps.vessels,
          inventory: deps.inventory,
          cellarOps: deps.cellarOps,
          costEntries: deps.costEntries,
          auditLogs: deps.auditLogs,
        },
        intent.payload,
        {
          commandId: intent.commandId,
          actorUsername: deps.actorUsername,
          currency: deps.currency,
          costAutomation: deps.costAutomation,
          performedAt: new Date(intent.capturedAt),
        },
      );
      deps.onUpdateLots?.(applied.state.lots);
      deps.onUpdateVessels?.(applied.state.vessels);
      deps.onUpdateInventory?.(applied.state.inventory);
      deps.onUpdateOperations?.(applied.state.cellarOps);
      deps.onUpdateCostEntries?.(applied.state.costEntries);
      deps.onUpdateAuditLogs?.(applied.state.auditLogs);
      deps.onApplied?.(applied.result.operation);
      return { ok: true, operation: applied.result.operation, lotName: applied.result.operation.lotName };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Cellar operation validation failed.',
      };
    }
  }, [deps]);

  const executeOperation = useCallback(async (
    input: CellarOperationInput,
    pendingIntent?: PendingCommandIntent<CellarOperationCommandPayload> | null,
  ): Promise<OperationExecutionOutcome> => {
    const commandClient = await import('../lib/commands/client');
    const intent = pendingIntent || commandClient.createCellarOperationCommandIntent(input);

    if (!deps.onApplyCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        return {
          ok: false,
          error: 'Recovering an unacknowledged cellar operation requires a server connection.',
          retryableIntent: pendingIntent,
        };
      }
      return applyLocally(intent);
    }

    setIsSubmitting(true);
    try {
      const response = await commandClient.submitCellarOperationCommand(intent);
      deps.onApplyCommandResponse(response);
      deps.onApplied?.(response.result.operation);
      return {
        ok: true,
        operation: response.result.operation,
        lotName: response.result.operation.lotName,
      };
    } catch (error) {
      if (error instanceof commandClient.CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        // The server refused before claiming or mutating anything, so the
        // intent can be released and applied locally instead.
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        return applyLocally(intent);
      }
      const message = error instanceof Error ? error.message : 'Cellar operation failed.';
      const retryable = error instanceof commandClient.CommandRequestError && error.retryable;
      return { ok: false, error: message, ...(retryable ? { retryableIntent: intent } : {}) };
    } finally {
      setIsSubmitting(false);
    }
  }, [applyLocally, deps]);

  return { executeOperation, isSubmitting };
}
