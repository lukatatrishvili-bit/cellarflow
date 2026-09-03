import { useCallback, useState } from 'react';
import type { CostEntry } from '../lib/costing';
import type {
  CellarOperation,
  InventoryItem,
  MaraniOSAuditLog,
  Vessel,
  WineLot,
} from '../lib/wineryState';
import type { ToppingPlan } from '../lib/topping';

/**
 * Writing a batch of toppings.
 *
 * Each barrel is a full cellar operation, validated by the same
 * `applyCellarOperationCommand` the server runs — so capacity, source balance
 * and cost movement are checked per barrel, not waved through because the
 * batch as a whole looked fine.
 *
 * The batch is built against one accumulating state and committed in a single
 * update. Sequential server round trips were the alternative, and they fail
 * badly here: a batch that stops at barrel seven of twelve leaves the cellar in
 * a state nobody chose, and the operator standing at barrel eight with no way
 * to tell. Building the whole thing first means it either applies or it does
 * not, and a barrel that cannot be topped is reported before anything is
 * written. The established whole-state sync carries the result up, which is the
 * same path any offline recording takes.
 */

export interface BatchToppingDeps {
  lots: WineLot[];
  vessels: Vessel[];
  inventory: InventoryItem[];
  cellarOps: CellarOperation[];
  costEntries: CostEntry[];
  auditLogs: MaraniOSAuditLog[];
  currency: string;
  costAutomation?: unknown;
  actorUsername: string;
  operatorName: string;
  onUpdateLots: (lots: WineLot[]) => void;
  onUpdateVessels: (vessels: Vessel[]) => void;
  onUpdateInventory: (inventory: InventoryItem[]) => void;
  onUpdateOperations: (operations: CellarOperation[]) => void;
  onUpdateCostEntries: (entries: CostEntry[]) => void;
  onUpdateAuditLogs: (logs: MaraniOSAuditLog[]) => void;
  /** Runs once per barrel written, so planned work settles from a batch too. */
  onApplied?: () => void;
}

export interface BatchToppingOutcome {
  /** Barrels written. Zero means nothing was committed. */
  done: number;
  /** The barrel that stopped the batch, when one did. */
  failure?: { vesselId: string; error: string };
}

export interface BatchToppingRunner {
  runBatchTopping: (plans: ToppingPlan[], notes?: string) => Promise<BatchToppingOutcome>;
  progress: { done: number; total: number } | null;
}

export function useBatchTopping(deps: BatchToppingDeps): BatchToppingRunner {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const runBatchTopping = useCallback(async (
    plans: ToppingPlan[],
    notes = '',
  ): Promise<BatchToppingOutcome> => {
    if (!plans.length) return { done: 0 };

    // Loaded on demand: this hook is reachable from App, and the command
    // modules are large enough to matter on the critical path.
    const [{ applyCellarOperationCommand }, commandClient] = await Promise.all([
      import('../lib/commands/cellarOperation'),
      import('../lib/commands/client'),
    ]);

    setProgress({ done: 0, total: plans.length });

    let failedIndex = -1;
    let state = {
      lots: deps.lots,
      vessels: deps.vessels,
      inventory: deps.inventory,
      cellarOps: deps.cellarOps,
      costEntries: deps.costEntries,
      auditLogs: deps.auditLogs,
    };
    const date = new Date().toISOString().slice(0, 10);

    try {
      for (let index = 0; index < plans.length; index += 1) {
        failedIndex = index;
        const plan = plans[index];
        const intent = commandClient.createCellarOperationCommandIntent({
          date,
          type: 'topping',
          lotId: plan.toppedLotId,
          vesselId: plan.toppedVesselId,
          vesselToId: null,
          sourceVesselId: plan.sourceVesselId,
          toppingVolumeL: plan.volumeL,
          operator: deps.operatorName || 'Cellar Crew',
          notes,
        });

        const applied = applyCellarOperationCommand(state, intent.payload, {
          commandId: intent.commandId,
          actorUsername: deps.actorUsername,
          currency: deps.currency,
          costAutomation: deps.costAutomation,
          performedAt: new Date(intent.capturedAt),
        });
        state = applied.state;
        setProgress({ done: index + 1, total: plans.length });
      }
    } catch (error) {
      setProgress(null);
      return {
        done: 0,
        failure: {
          vesselId: plans[failedIndex]?.toppedVesselId || '',
          error: error instanceof Error ? error.message : 'Topping was refused.',
        },
      };
    }

    deps.onUpdateLots(state.lots);
    deps.onUpdateVessels(state.vessels);
    deps.onUpdateInventory(state.inventory);
    deps.onUpdateOperations(state.cellarOps);
    deps.onUpdateCostEntries(state.costEntries);
    deps.onUpdateAuditLogs(state.auditLogs);
    for (let index = 0; index < plans.length; index += 1) deps.onApplied?.();
    setProgress(null);
    return { done: plans.length };
  }, [deps]);

  return { runBatchTopping, progress };
}
