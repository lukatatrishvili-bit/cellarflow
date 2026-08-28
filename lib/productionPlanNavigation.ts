import type { Language } from './language';
import type { HarvestRecord } from './wineryState';
import type { ProductionPlanItem } from './operationsControl';

export interface ProductionPlanNavigationActions {
  lang: Language;
  harvests: HarvestRecord[];
  navigate: (module: string, tab?: string) => boolean;
  setIntakeHarvestId: (harvestId: string | null) => void;
  setTransfer: (sourceId: string, destinationId: string, volume?: number) => void;
  setLab: (lotId: string, vesselId: string) => void;
  setSanitation: (vesselId: string) => void;
  setTaskDraft: (title: string, priority: 'high' | 'medium', description: string) => void;
}

export function openProductionPlanItem(
  item: ProductionPlanItem,
  actions: ProductionPlanNavigationActions,
): void {
  if (item.kind === 'harvest') {
    actions.navigate('vazi');
    return;
  }
  if (item.kind === 'procurement') {
    actions.navigate('procurement');
    return;
  }
  if (item.kind === 'dispatch') {
    actions.navigate('sales');
    return;
  }
  if (item.kind === 'intake') {
    if (!actions.navigate('gvino', 'intake')) return;
    const generatedHarvestId = item.notes.match(/harvest:([^\s]+)/)?.[1];
    const harvest = actions.harvests.find(record => (
      record.id === generatedHarvestId
      || (Boolean(item.blockId) && record.blockId === item.blockId
        && (!item.lotId || record.associatedLotId === item.lotId))
    ));
    actions.setIntakeHarvestId(harvest?.id || null);
    return;
  }
  if (item.kind === 'transfer') {
    if (actions.navigate('gvino', 'transfers')) {
      actions.setTransfer(item.vesselIds[0] || '', item.vesselIds[1] || '', item.quantityLiters);
    }
    return;
  }
  if (item.kind === 'lab') {
    if (actions.navigate('gvino', 'labs')) {
      actions.setLab(item.lotId || '', item.vesselIds[0] || '');
    }
    return;
  }
  if (item.kind === 'sanitation') {
    if (actions.navigate('gvino', 'operations')) actions.setSanitation(item.vesselIds[0] || '');
    return;
  }
  if (item.kind === 'other') {
    if (!actions.navigate('gvino', 'tasks')) return;
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
    return;
  }
  actions.navigate('gvino', item.kind === 'fermentation' ? 'fermentation' : item.kind === 'bottling' ? 'bottling' : 'cellar');
}
