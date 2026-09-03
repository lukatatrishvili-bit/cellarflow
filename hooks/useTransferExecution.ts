import { useCallback, useState } from 'react';
import type { CostEntry } from '../lib/costing';
import type { CellarTransferRecord, Vessel, WineLot } from '../lib/wineryState';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import type {
  TransferCategory,
  TransferCommandPayload,
  TransferCommandResult,
} from '../lib/commands/transfer';
import type { TransferCommandResponse } from '../lib/commands/client';

/**
 * The command modules are loaded when a transfer is actually committed, not
 * when the app boots. This hook is used from `App`, so a static import would
 * pull the whole transfer command and command-client machinery — about 100 KB
 * — onto the critical path, where it previously rode along inside the lazily
 * loaded transfers screen.
 */
const loadTransferCommands = () => Promise.all([
  import('../lib/commands/transfer'),
  import('../lib/commands/client'),
]);

/**
 * Committing a transfer, in one place.
 *
 * The path has four branches that are easy to get subtly wrong — server
 * command, offline local application, recovery of an intent the server may
 * already have claimed, and the development JSON-backend fallback where the
 * server refuses before touching anything. It lived inside TransfersTab, which
 * was fine while the transfer screen was the only way to move wine.
 *
 * The cellar map now commits transfers too, and a second copy of this is
 * exactly where the two would drift: one of them would gain a fix the other
 * did not, and the difference would show up as wine that moved in one place
 * and not the other. Validation deliberately stays with each caller — they
 * have different forms and different amounts of context — but the commit is
 * shared.
 */

export interface TransferExecutionInput {
  sourceVesselId: string;
  destinationVesselId: string;
  volumeLiters: number;
  lossLiters: number;
  operator: string;
  category: TransferCategory;
  pump: string;
}

export interface TransferExecutionDeps {
  vessels: Vessel[];
  lots: WineLot[];
  transfers: CellarTransferRecord[];
  costEntries: CostEntry[];
  currency: string;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onUpdateLots: (lots: WineLot[]) => void;
  onUpdateTransfers: (transfers: CellarTransferRecord[]) => void;
  onUpdateCostEntries?: (entries: CostEntry[]) => void;
  onApplyCommandResponse?: (response: TransferCommandResponse) => void;
  /** Runs after a successful commit, however it was applied. */
  onApplied?: (result: TransferCommandResult) => void;
}

export type TransferExecutionOutcome =
  | { ok: true; result: TransferCommandResult }
  | { ok: false; error: string; retryableIntent?: PendingCommandIntent<TransferCommandPayload> };

export interface TransferExecution {
  executeTransfer: (
    input: TransferExecutionInput,
    /** Re-submitting an intent the server may already hold. */
    pendingIntent?: PendingCommandIntent<TransferCommandPayload> | null,
  ) => Promise<TransferExecutionOutcome>;
  isSubmitting: boolean;
}

export function useTransferExecution(deps: TransferExecutionDeps): TransferExecution {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const applyLocally = useCallback(async (
    intent: PendingCommandIntent<TransferCommandPayload>,
  ): Promise<TransferExecutionOutcome> => {
    try {
      const [{ applyTransferCommand }] = await loadTransferCommands();
      const applied = applyTransferCommand(
        {
          vessels: deps.vessels,
          lots: deps.lots,
          transfers: deps.transfers,
          costEntries: deps.costEntries,
        },
        intent.payload,
        {
          commandId: intent.commandId,
          actorUsername: intent.payload.operator || 'Cellar Crew',
          currency: deps.currency,
          performedAt: new Date(),
        },
      );
      deps.onUpdateVessels(applied.state.vessels);
      deps.onUpdateLots(applied.state.lots);
      deps.onUpdateTransfers(applied.state.transfers);
      deps.onUpdateCostEntries?.(applied.state.costEntries);
      deps.onApplied?.(applied.result);
      return { ok: true, result: applied.result };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Transfer validation failed.' };
    }
  }, [deps]);

  const executeTransfer = useCallback(async (
    input: TransferExecutionInput,
    pendingIntent?: PendingCommandIntent<TransferCommandPayload> | null,
  ): Promise<TransferExecutionOutcome> => {
    const [, commandClient] = await loadTransferCommands();
    const intent = pendingIntent || commandClient.createTransferCommandIntent({
      sourceVesselId: input.sourceVesselId,
      destinationVesselId: input.destinationVesselId,
      volumeLiters: input.volumeLiters,
      lossLiters: input.lossLiters,
      operator: input.operator || 'Cellar Crew',
      category: input.category,
      pump: input.pump,
    });

    if (!deps.onApplyCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        return {
          ok: false,
          error: 'Recovering an unacknowledged transfer requires a server connection.',
          retryableIntent: pendingIntent,
        };
      }
      return applyLocally(intent);
    }

    setIsSubmitting(true);
    try {
      const response = await commandClient.submitTransferCommand(intent);
      deps.onApplyCommandResponse(response);
      deps.onApplied?.(response.result);
      return { ok: true, result: response.result };
    } catch (error) {
      if (error instanceof commandClient.CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        // The server rejected before claiming or mutating anything. This is the
        // development/JSON-backend compatibility path and is safe to apply
        // locally and let the established whole-state sync carry it.
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        return applyLocally(intent);
      }
      const message = error instanceof Error ? error.message : 'Transfer command failed.';
      const retryable = error instanceof commandClient.CommandRequestError && error.retryable;
      return { ok: false, error: message, ...(retryable ? { retryableIntent: intent } : {}) };
    } finally {
      setIsSubmitting(false);
    }
  }, [applyLocally, deps]);

  return { executeTransfer, isSubmitting };
}
