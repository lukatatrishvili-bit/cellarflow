import type { BottlingRunRecord, CellarOperation, GrapeIntakeRecord, InventoryItem } from '../wineryState';
import { round2 } from './engine';
import type { CostCategory, CostEntry } from './types';

const PACKAGING_HINTS = [
  'packaging', 'package', 'bottle', 'bottles', 'closure', 'closures',
  'cork', 'capsule', 'label', 'labels', 'box', 'boxes', 'carton',
];

export type BottlingPackagingComponent = 'bottle' | 'closure' | 'capsule' | 'label' | 'box';
export type BottlingPackagingSelections = Partial<Record<BottlingPackagingComponent, string>>;

const BOTTLING_COMPONENT_LABELS: Record<BottlingPackagingComponent, string> = {
  bottle: 'Bottles',
  closure: 'Closures',
  capsule: 'Capsules',
  label: 'Labels',
  box: 'Boxes',
};

function safeEntryId(...parts: Array<string | number | undefined>): string {
  const raw = parts.filter(p => p !== undefined && p !== '').join('-') || `cost-${Date.now()}`;
  return raw.replace(/[^\p{L}\p{N}_\- ]/gu, '-').slice(0, 128);
}

function dateOnly(value: string | undefined): string {
  return (value || new Date().toISOString()).slice(0, 10);
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function classifyInventoryCostCategory(item: Pick<InventoryItem, 'category' | 'name'>): CostCategory {
  const haystack = `${item.category || ''} ${item.name || ''}`.toLowerCase();
  if (PACKAGING_HINTS.some(hint => haystack.includes(hint))) return 'packaging';
  return 'additive';
}

export function grapeIntakeCostEntry(
  intake: Pick<GrapeIntakeRecord,
    'id' | 'date' | 'createdLotId' | 'source' | 'supplierName' | 'blockName' | 'variety' |
    'netWeightKg' | 'costPerKg' | 'totalCost' | 'currency'
  >,
  options: { currency: string; createdBy?: string },
): CostEntry | null {
  const netWeightKg = positiveNumber(intake.netWeightKg);
  const costPerKg = positiveNumber(intake.costPerKg);
  const explicitTotal = positiveNumber(intake.totalCost);
  const amount = round2(explicitTotal || (netWeightKg * costPerKg));
  if (!intake.createdLotId || amount <= 0) return null;

  const sourceLabel = intake.source === 'supplier'
    ? (intake.supplierName || 'Supplier grapes')
    : (intake.blockName || 'Own vineyard fruit');

  return {
    id: safeEntryId('cost', 'grape', intake.id),
    date: dateOnly(intake.date),
    lotId: intake.createdLotId,
    category: 'grape',
    description: `Grape intake: ${intake.variety || 'fruit'} from ${sourceLabel}`,
    amount,
    currency: intake.currency || options.currency,
    ...(netWeightKg > 0 ? { quantity: netWeightKg } : {}),
    ...(costPerKg > 0 ? { unitCost: costPerKg } : {}),
    sourceRef: intake.id,
    createdBy: options.createdBy,
  };
}

export function materialCostEntryFromOperation(
  operation: Pick<CellarOperation,
    'id' | 'date' | 'type' | 'customLabel' | 'lotId' | 'materialId' | 'materialName' | 'dose' | 'unit'
  >,
  material: Pick<InventoryItem, 'id' | 'name' | 'category' | 'costPerUnit'> | undefined,
  options: { currency: string; createdBy?: string },
): CostEntry | null {
  const dose = positiveNumber(operation.dose);
  const unitCost = positiveNumber(material?.costPerUnit);
  const amount = round2(dose * unitCost);
  if (!operation.lotId || !material || !operation.materialId || dose <= 0 || amount <= 0) return null;

  const materialName = operation.materialName || material.name;
  const opLabel = operation.type === 'custom'
    ? (operation.customLabel || 'Custom operation')
    : operation.type.replace(/_/g, ' ');

  return {
    id: safeEntryId('cost', 'material', operation.id, material.id),
    date: dateOnly(operation.date),
    lotId: operation.lotId,
    category: classifyInventoryCostCategory(material),
    description: `${opLabel}: ${materialName}`,
    amount,
    currency: options.currency,
    quantity: dose,
    unitCost,
    sourceRef: operation.id,
    createdBy: options.createdBy,
  };
}

export function computeBottlingCostPosting(input: {
  runId: string;
  date: string;
  lotId: string;
  totalUnits: number;
  packagingSelections?: BottlingPackagingSelections;
  inventory: Array<Pick<InventoryItem, 'id' | 'name' | 'category' | 'stock' | 'unit' | 'costPerUnit'>>;
  bottlesPerBox?: number;
  bottlingServiceCost?: number;
  currency: string;
  createdBy?: string;
}): {
  entries: CostEntry[];
  deductions: Record<string, number>;
  packagingCostTotal: number;
  bottlingServiceCost: number;
} {
  const totalUnits = Math.max(0, Math.floor(input.totalUnits || 0));
  const inventoryById = new Map(input.inventory.map(item => [item.id, item]));
  const deductions: Record<string, number> = {};
  const details: string[] = [];
  let packagingCostTotal = 0;

  const addComponent = (component: BottlingPackagingComponent, itemId: string | undefined) => {
    if (!itemId || totalUnits <= 0) return;
    const item = inventoryById.get(itemId);
    if (!item) return;

    const qty = component === 'box'
      ? Math.ceil(totalUnits / Math.max(1, Math.floor(input.bottlesPerBox || 6)))
      : totalUnits;
    if (qty <= 0) return;

    deductions[item.id] = round2((deductions[item.id] || 0) + qty);
    const amount = round2(qty * positiveNumber(item.costPerUnit));
    packagingCostTotal = round2(packagingCostTotal + amount);
    details.push(`${BOTTLING_COMPONENT_LABELS[component]}: ${item.name} × ${qty}`);
  };

  const selections = input.packagingSelections || {};
  addComponent('bottle', selections.bottle);
  addComponent('closure', selections.closure);
  addComponent('capsule', selections.capsule);
  addComponent('label', selections.label);
  addComponent('box', selections.box);

  const entries: CostEntry[] = [];
  if (packagingCostTotal > 0 && input.lotId) {
    entries.push({
      id: safeEntryId('cost', 'packaging', input.runId),
      date: dateOnly(input.date),
      lotId: input.lotId,
      category: 'packaging',
      description: details.length ? `Packaging for bottling: ${details.join('; ')}` : 'Packaging for bottling',
      amount: packagingCostTotal,
      currency: input.currency,
      quantity: totalUnits,
      sourceRef: input.runId,
      createdBy: input.createdBy,
    });
  }

  const bottlingServiceCost = round2(positiveNumber(input.bottlingServiceCost));
  if (bottlingServiceCost > 0 && input.lotId) {
    entries.push({
      id: safeEntryId('cost', 'bottling', input.runId),
      date: dateOnly(input.date),
      lotId: input.lotId,
      category: 'bottling',
      description: 'Bottling service / line cost',
      amount: bottlingServiceCost,
      currency: input.currency,
      quantity: totalUnits,
      unitCost: totalUnits > 0 ? round2(bottlingServiceCost / totalUnits) : undefined,
      sourceRef: input.runId,
      createdBy: input.createdBy,
    });
  }

  return { entries, deductions, packagingCostTotal, bottlingServiceCost };
}

export function bottlingRunCostEntries(
  run: Pick<BottlingRunRecord, 'id' | 'date' | 'lotId' | 'totalBottles' | 'totalCeramic' | 'packagingMaterialIds' | 'bottlesPerBox' | 'bottlingServiceCost'>,
  inventory: Array<Pick<InventoryItem, 'id' | 'name' | 'category' | 'stock' | 'unit' | 'costPerUnit'>>,
  options: { currency: string; createdBy?: string },
): ReturnType<typeof computeBottlingCostPosting> {
  return computeBottlingCostPosting({
    runId: run.id,
    date: run.date,
    lotId: run.lotId,
    totalUnits: (run.totalBottles || 0) + (run.totalCeramic || 0),
    packagingSelections: run.packagingMaterialIds,
    inventory,
    bottlesPerBox: run.bottlesPerBox,
    bottlingServiceCost: run.bottlingServiceCost,
    currency: options.currency,
    createdBy: options.createdBy,
  });
}
