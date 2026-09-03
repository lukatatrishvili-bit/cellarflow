import type { Language } from './i18n';
import type { WineClass, WinemakingStage } from './wineryState';

export type WinemakingWorkflowKind = 'red' | 'white' | 'amber' | 'qvevri' | 'standard';

const STANDARD_STAGES: readonly WinemakingStage[] = [
  'crushing',
  'fermenting',
  'maceration',
  'pressing',
  'aging',
  'stabilization',
  'filtration',
  'bottled',
  'sold',
];

const WORKFLOW_STAGES: Record<WinemakingWorkflowKind, readonly WinemakingStage[]> = {
  red: [
    'crushing',
    'fermenting',
    'maceration',
    'pressing',
    'aging',
    'stabilization',
    'filtration',
    'bottled',
    'sold',
  ],
  white: [
    'crushing',
    'pressing',
    'fermenting',
    'aging',
    'stabilization',
    'filtration',
    'bottled',
    'sold',
  ],
  amber: [
    'crushing',
    'maceration',
    'fermenting',
    'pressing',
    'aging',
    'stabilization',
    'filtration',
    'bottled',
    'sold',
  ],
  qvevri: [
    'crushing',
    'fermenting',
    'maceration',
    'pressing',
    'aging',
    'stabilization',
    'bottled',
    'sold',
  ],
  standard: STANDARD_STAGES,
};

const WORKFLOW_LABELS: Record<WinemakingWorkflowKind, { en: string; ka: string }> = {
  red: { en: 'Red wine workflow', ka: 'წითელი ღვინის ეტაპები' },
  white: { en: 'White wine workflow', ka: 'თეთრი ღვინის ეტაპები' },
  amber: { en: 'Amber wine workflow', ka: 'ქარვისფერი ღვინის ეტაპები' },
  qvevri: { en: 'Qvevri wine workflow', ka: 'ქვევრის ღვინის ეტაპები' },
  standard: { en: 'Standard wine workflow', ka: 'ღვინის სტანდარტული ეტაპები' },
};

export function workflowKindForWineClass(wineClass: WineClass): WinemakingWorkflowKind {
  if (wineClass === 'red' || wineClass === 'white' || wineClass === 'amber' || wineClass === 'qvevri') {
    return wineClass;
  }
  if (wineClass === 'rose' || wineClass === 'sparkling' || wineClass === 'base_wine') {
    return 'white';
  }
  return 'standard';
}

export function stagesForWineClass(wineClass: WineClass): readonly WinemakingStage[] {
  return WORKFLOW_STAGES[workflowKindForWineClass(wineClass)];
}

export function stagesForCurrentLot(
  wineClass: WineClass,
  currentStage: WinemakingStage,
): readonly WinemakingStage[] {
  const stages = [...stagesForWineClass(wineClass)];
  if (stages.includes(currentStage)) return stages;

  const currentRank = STANDARD_STAGES.indexOf(currentStage);
  const insertionIndex = stages.findIndex(stage => STANDARD_STAGES.indexOf(stage) > currentRank);
  stages.splice(insertionIndex === -1 ? stages.length : insertionIndex, 0, currentStage);
  return stages;
}

export function nextStageForWineClass(
  wineClass: WineClass,
  currentStage: WinemakingStage,
): WinemakingStage {
  const stages = stagesForCurrentLot(wineClass, currentStage);
  const currentIndex = stages.indexOf(currentStage);
  return stages[Math.min(stages.length - 1, Math.max(0, currentIndex + 1))];
}

export function winemakingWorkflowLabel(wineClass: WineClass, lang: Language): string {
  const labels = WORKFLOW_LABELS[workflowKindForWineClass(wineClass)];
  return lang === 'ka' ? labels.ka : labels.en;
}
