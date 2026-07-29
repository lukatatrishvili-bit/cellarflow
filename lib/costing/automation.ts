import type {
  CellarOperationType,
  CostAutomationSettings,
  OperationCostProfile,
} from '../wineryState';
import { round2 } from './engine';
import type { CostEntry } from './types';

const ZERO_PROFILE: OperationCostProfile = { laborHours: 0, energyKwh: 0 };

export const DEFAULT_OPERATION_COST_PROFILES: Record<CellarOperationType, OperationCostProfile> = {
  crush_destem: { laborHours: 1.5, energyKwh: 8 },
  pressing: { laborHours: 2, energyKwh: 12 },
  ferment_start: { laborHours: 1, energyKwh: 2 },
  measurement: { laborHours: 0.25, energyKwh: 0 },
  pumpover: { laborHours: 0.35, energyKwh: 1.5 },
  punchdown: { laborHours: 0.5, energyKwh: 0 },
  racking: { laborHours: 1.5, energyKwh: 5 },
  blending: { laborHours: 1.5, energyKwh: 5 },
  sulfitation: { laborHours: 0.35, energyKwh: 0 },
  additive: { laborHours: 0.35, energyKwh: 0 },
  fining: { laborHours: 0.75, energyKwh: 1 },
  filtration: { laborHours: 2, energyKwh: 10 },
  stabilization: { laborHours: 1, energyKwh: 18 },
  vessel_filling: { laborHours: 1, energyKwh: 3 },
  bottling: { laborHours: 4, energyKwh: 20 },
  cleaning: { laborHours: 1, energyKwh: 4 },
  correction: { laborHours: 0.5, energyKwh: 0 },
  custom: { laborHours: 1, energyKwh: 0 },
};

export const DEFAULT_COST_AUTOMATION_SETTINGS: CostAutomationSettings = {
  enabled: false,
  laborRatePerHour: 15,
  energyRatePerKwh: 0.25,
  overheadPercent: 8,
  ownGrapeCostPerKg: 0.7,
  labAnalysisCost: 20,
  operationProfiles: DEFAULT_OPERATION_COST_PROFILES,
};

function safeNonNegative(value: unknown, fallback: number, maximum = 1_000_000): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : fallback;
}

export function resolveCostAutomationSettings(value: unknown): CostAutomationSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<CostAutomationSettings>
    : {};
  const rawProfiles = input.operationProfiles && typeof input.operationProfiles === 'object'
    ? input.operationProfiles
    : {};
  const operationProfiles = Object.fromEntries(
    (Object.keys(DEFAULT_OPERATION_COST_PROFILES) as CellarOperationType[]).map(type => {
      const profile = rawProfiles[type];
      return [type, {
        laborHours: safeNonNegative(profile?.laborHours, DEFAULT_OPERATION_COST_PROFILES[type].laborHours, 10_000),
        energyKwh: safeNonNegative(profile?.energyKwh, DEFAULT_OPERATION_COST_PROFILES[type].energyKwh, 10_000_000),
      }];
    }),
  ) as Record<CellarOperationType, OperationCostProfile>;
  return {
    enabled: input.enabled === true,
    laborRatePerHour: safeNonNegative(input.laborRatePerHour, DEFAULT_COST_AUTOMATION_SETTINGS.laborRatePerHour),
    energyRatePerKwh: safeNonNegative(input.energyRatePerKwh, DEFAULT_COST_AUTOMATION_SETTINGS.energyRatePerKwh),
    overheadPercent: safeNonNegative(input.overheadPercent, DEFAULT_COST_AUTOMATION_SETTINGS.overheadPercent, 100),
    ownGrapeCostPerKg: safeNonNegative(input.ownGrapeCostPerKg, DEFAULT_COST_AUTOMATION_SETTINGS.ownGrapeCostPerKg),
    labAnalysisCost: safeNonNegative(input.labAnalysisCost, DEFAULT_COST_AUTOMATION_SETTINGS.labAnalysisCost),
    operationProfiles,
  };
}

export function operationCostProfile(
  settings: CostAutomationSettings,
  operationType: CellarOperationType,
): OperationCostProfile {
  return settings.operationProfiles[operationType] || DEFAULT_OPERATION_COST_PROFILES[operationType] || ZERO_PROFILE;
}

export interface AutomaticOperationCostInput {
  operationId: string;
  date: string;
  lotId: string;
  operationType: CellarOperationType;
  laborHours?: number;
  energyKwh?: number;
  materialCostTotal?: number;
  currency: string;
  createdBy?: string;
  settings: CostAutomationSettings;
}

export function automaticOperationCostEntries(input: AutomaticOperationCostInput): CostEntry[] {
  if (!input.settings.enabled || !input.lotId) return [];
  const profile = operationCostProfile(input.settings, input.operationType);
  const laborHours = safeNonNegative(input.laborHours, profile.laborHours, 10_000);
  const energyKwh = safeNonNegative(input.energyKwh, profile.energyKwh, 10_000_000);
  const laborAmount = round2(laborHours * input.settings.laborRatePerHour);
  const energyAmount = round2(energyKwh * input.settings.energyRatePerKwh);
  const materialAmount = safeNonNegative(input.materialCostTotal, 0);
  const entries: CostEntry[] = [];

  if (laborAmount > 0) {
    entries.push({
      id: `cost-labor-${input.operationId}`,
      date: input.date.slice(0, 10),
      lotId: input.lotId,
      category: 'labor',
      description: `Automatic labor: ${input.operationType.replace(/_/g, ' ')}`,
      amount: laborAmount,
      currency: input.currency,
      quantity: laborHours,
      unitCost: input.settings.laborRatePerHour,
      sourceRef: input.operationId,
      createdBy: input.createdBy,
    });
  }
  if (energyAmount > 0) {
    entries.push({
      id: `cost-energy-${input.operationId}`,
      date: input.date.slice(0, 10),
      lotId: input.lotId,
      category: 'energy',
      description: `Automatic energy: ${input.operationType.replace(/_/g, ' ')}`,
      amount: energyAmount,
      currency: input.currency,
      quantity: energyKwh,
      unitCost: input.settings.energyRatePerKwh,
      sourceRef: input.operationId,
      createdBy: input.createdBy,
    });
  }

  const directCost = round2(materialAmount + laborAmount + energyAmount);
  const overheadAmount = round2(directCost * (input.settings.overheadPercent / 100));
  if (overheadAmount > 0) {
    entries.push({
      id: `cost-overhead-${input.operationId}`,
      date: input.date.slice(0, 10),
      lotId: input.lotId,
      category: 'overhead',
      description: `Automatic overhead (${input.settings.overheadPercent}%)`,
      amount: overheadAmount,
      currency: input.currency,
      quantity: directCost,
      unitCost: input.settings.overheadPercent / 100,
      sourceRef: input.operationId,
      createdBy: input.createdBy,
    });
  }
  return entries;
}

export function automaticLabCostEntry(input: {
  analysisId: string;
  date: string;
  lotId: string;
  currency: string;
  createdBy?: string;
  settings: CostAutomationSettings;
}): CostEntry | null {
  if (!input.settings.enabled || input.settings.labAnalysisCost <= 0 || !input.lotId) return null;
  return {
    id: `cost-lab-${input.analysisId}`,
    date: input.date.slice(0, 10),
    lotId: input.lotId,
    category: 'other',
    description: 'Automatic laboratory analysis cost',
    amount: round2(input.settings.labAnalysisCost),
    currency: input.currency,
    quantity: 1,
    unitCost: round2(input.settings.labAnalysisCost),
    sourceRef: input.analysisId,
    createdBy: input.createdBy,
  };
}
