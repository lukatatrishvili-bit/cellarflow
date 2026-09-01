import type { Language } from './language';
import type { CellarOperationType, HarvestRecord } from './wineryState';
import type { ProductionPlanItem } from './operationsControl';
import { isQuickCellarOperation } from './wineryOperations';
import type { PlanFulfilmentKind } from './planFulfilment';

export interface ProductionPlanNavigationActions {
  lang: Language;
  harvests: HarvestRecord[];
  navigate: (module: string, tab?: string) => boolean;
  setIntakeHarvestId: (harvestId: string | null) => void;
  setTransfer: (sourceId: string, destinationId: string, volume?: number) => void;
  setLab: (lotId: string, vesselId: string) => void;
  setSanitation: (vesselId: string) => void;
  setOperation: (lotId: string, vesselId: string, operationType: CellarOperationType) => void;
  setTaskDraft: (title: string, priority: 'high' | 'medium', description: string) => void;
}

/**
 * Sends an operator to the recorder for this item, and reports which recorder
 * that was so the caller can remember what is now outstanding. `null` means
 * the item was only navigated to — either the destination cannot settle it
 * (harvest, procurement, dispatch) or the operator's role was refused entry.
 */
export function openProductionPlanItem(
  item: ProductionPlanItem,
  actions: ProductionPlanNavigationActions,
): PlanFulfilmentKind | null {
  if (item.operationType && isQuickCellarOperation(item.operationType)) {
    if (actions.navigate('gvino', 'operations')) {
      actions.setOperation(item.lotId || '', item.vesselIds[0] || '', item.operationType);
      return 'operation';
    }
    return null;
  }
  if (item.kind === 'harvest') {
    actions.navigate('vazi');
    return null;
  }
  if (item.kind === 'procurement') {
    actions.navigate('procurement');
    return null;
  }
  if (item.kind === 'dispatch') {
    actions.navigate('sales');
    return null;
  }
  if (item.kind === 'intake') {
    if (!actions.navigate('gvino', 'intake')) return null;
    const generatedHarvestId = item.notes.match(/harvest:([^\s]+)/)?.[1];
    const harvest = actions.harvests.find(record => (
      record.id === generatedHarvestId
      || (Boolean(item.blockId) && record.blockId === item.blockId
        && (!item.lotId || record.associatedLotId === item.lotId))
    ));
    actions.setIntakeHarvestId(harvest?.id || null);
    return 'intake';
  }
  if (item.kind === 'transfer') {
    if (actions.navigate('gvino', 'transfers')) {
      actions.setTransfer(item.vesselIds[0] || '', item.vesselIds[1] || '', item.quantityLiters);
      return 'transfer';
    }
    return null;
  }
  if (item.kind === 'lab') {
    if (actions.navigate('gvino', 'labs')) {
      actions.setLab(item.lotId || '', item.vesselIds[0] || '');
      return 'lab';
    }
    return null;
  }
  if (item.kind === 'sanitation') {
    if (actions.navigate('gvino', 'winery-plan')) {
      actions.setSanitation(item.vesselIds[0] || '');
      return 'sanitation';
    }
    return null;
  }
  if (item.kind === 'other') {
    if (!actions.navigate('gvino', 'tasks')) return null;
    actions.setTaskDraft(
      item.title,
      item.status === 'blocked' ? 'high' : 'medium',
      [
        item.notes,
        item.lotId ? (actions.lang === 'ka' ? 'პარტია: ' : 'Lot: ') + item.lotId : '',
        item.vesselIds.length
          ? (actions.lang === 'ka' ? 'ჭურჭელი: ' : 'Vessel: ') + item.vesselIds.join(', ')
          : '',
      ].filter(Boolean).join('\n'),
    );
    return null;
  }
  actions.navigate('gvino', item.kind === 'fermentation' ? 'fermentation' : item.kind === 'bottling' ? 'bottling' : 'cellar');
  return null;
}
