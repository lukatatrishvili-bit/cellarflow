import React, { useMemo } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  CellarOperationType,
  InventoryItem,
  OperationMaterialUsage,
} from '../lib/wineryState';

export interface MaterialUsageDraft {
  key: string;
  materialId: string;
  quantity: string;
  purpose: string;
}

let materialDraftSequence = 0;

export function newMaterialUsageDraft(
  overrides: Partial<Omit<MaterialUsageDraft, 'key'>> = {},
): MaterialUsageDraft {
  materialDraftSequence += 1;
  return {
    key: `material-draft-${materialDraftSequence}`,
    materialId: '',
    quantity: '',
    purpose: '',
    ...overrides,
  };
}

export function materialDraftsToUsages(
  drafts: MaterialUsageDraft[],
  inventory: InventoryItem[],
): OperationMaterialUsage[] {
  const inventoryById = new Map(inventory.map(item => [item.id, item]));
  return drafts.flatMap(draft => {
    const item = inventoryById.get(draft.materialId);
    const quantity = Number(draft.quantity);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) return [];
    return [{
      materialId: item.id,
      materialName: item.name,
      category: item.category,
      quantity,
      unit: item.unit,
      ...(draft.purpose.trim() ? { purpose: draft.purpose.trim() } : {}),
    }];
  });
}

export function materialUsagesToDrafts(
  usages: OperationMaterialUsage[] | undefined,
): MaterialUsageDraft[] {
  return (usages || []).map(usage => newMaterialUsageDraft({
    materialId: usage.materialId,
    quantity: String(usage.quantity),
    purpose: usage.purpose || '',
  }));
}

export function materialDraftIssue(
  drafts: MaterialUsageDraft[],
  inventory: InventoryItem[],
): string | null {
  const inventoryById = new Map(inventory.map(item => [item.id, item]));
  const totals = new Map<string, number>();
  for (const draft of drafts) {
    if (!draft.materialId && !draft.quantity) continue;
    const item = inventoryById.get(draft.materialId);
    const quantity = Number(draft.quantity);
    if (!item) return 'missing_material';
    if (!Number.isFinite(quantity) || quantity <= 0) return 'invalid_quantity';
    totals.set(item.id, (totals.get(item.id) || 0) + quantity);
  }
  for (const [itemId, total] of totals) {
    const item = inventoryById.get(itemId);
    if (item && total > item.stock + 0.000_1) return `insufficient:${itemId}`;
  }
  return null;
}

const OPERATION_CATEGORY_PRIORITY: Partial<Record<CellarOperationType, string[]>> = {
  ferment_start: ['yeasts', 'nutritions', 'additives', 'enzymes'],
  racking: ['additives', 'sulfur', 'fining', 'nutritions'],
  sulfitation: ['additives', 'sulfur'],
  fining: ['fining', 'additives'],
  stabilization: ['additives', 'stabilization'],
  filtration: ['filtration', 'additives'],
  cleaning: ['sanitation', 'cleaning'],
  bottling: ['additives', 'packaging', 'bottles', 'closures', 'labels', 'boxes'],
};

function orderedInventory(
  inventory: InventoryItem[],
  operationType: CellarOperationType,
): InventoryItem[] {
  const priorities = OPERATION_CATEGORY_PRIORITY[operationType] || [];
  const priorityOf = (category: string) => {
    const normalized = category.toLowerCase();
    const index = priorities.findIndex(item => normalized.includes(item));
    return index === -1 ? priorities.length + 1 : index;
  };
  return [...inventory].sort((a, b) => (
    priorityOf(a.category) - priorityOf(b.category)
    || a.name.localeCompare(b.name)
  ));
}

function doseRate(
  item: InventoryItem | undefined,
  quantity: number,
  lotVolumeL: number | undefined,
): string | null {
  if (!item || !(quantity > 0) || !(lotVolumeL && lotVolumeL > 0)) return null;
  const hectolitres = lotVolumeL / 100;
  const unit = item.unit.trim().toLowerCase();
  if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') {
    return `${Math.round((quantity * 1000 / hectolitres) * 100) / 100} g/hL`;
  }
  if (unit === 'g' || unit === 'gram' || unit === 'grams') {
    return `${Math.round((quantity / hectolitres) * 100) / 100} g/hL`;
  }
  if (unit === 'l' || unit === 'liter' || unit === 'litre' || unit === 'liters' || unit === 'litres') {
    return `${Math.round((quantity * 1000 / hectolitres) * 100) / 100} mL/hL`;
  }
  if (unit === 'ml') {
    return `${Math.round((quantity / hectolitres) * 100) / 100} mL/hL`;
  }
  return null;
}

interface Props {
  lang: Language;
  inventory: InventoryItem[];
  value: MaterialUsageDraft[];
  onChange: (value: MaterialUsageDraft[]) => void;
  operationType: CellarOperationType;
  lotVolumeL?: number;
  compact?: boolean;
}

export default function OperationMaterialsEditor({
  lang,
  inventory,
  value,
  onChange,
  operationType,
  lotVolumeL,
  compact = false,
}: Props) {
  const ka = lang === 'ka';
  const ordered = useMemo(
    () => orderedInventory(inventory, operationType),
    [inventory, operationType],
  );
  const issue = materialDraftIssue(value, inventory);
  const update = (key: string, patch: Partial<MaterialUsageDraft>) => {
    onChange(value.map(line => line.key === key ? { ...line, ...patch } : line));
  };

  return (
    <div className={`rounded-xl border border-indigo-100 bg-indigo-50/30 ${compact ? 'p-2.5' : 'p-3'} space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold text-indigo-950">
            {ka ? 'მასალები და დანამატები (არასავალდებულო)' : 'Materials & additives (optional)'}
          </p>
          <p className="text-[9px] text-indigo-700/70">
            {ka
              ? 'გამოყენებული მარაგი ავტომატურად ჩამოიწერება და პარტიის ისტორიას მიებმება.'
              : 'Used stock is deducted automatically and linked to this batch record.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, newMaterialUsageDraft()])}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-indigo-900 px-2 py-1 text-[9px] font-bold text-white hover:bg-indigo-800"
        >
          <Plus className="h-3 w-3" />
          {ka ? 'მასალის დამატება' : 'Add material'}
        </button>
      </div>

      {value.length === 0 && (
        <button
          type="button"
          onClick={() => onChange([newMaterialUsageDraft()])}
          className="w-full rounded-lg border border-dashed border-indigo-200 bg-white/70 px-3 py-2 text-left text-[10px] font-medium text-indigo-800 hover:border-indigo-400"
        >
          {operationType === 'ferment_start'
            ? (ka ? '+ საფუარი, სტარტერი ან საკვები' : '+ Yeast, starter, nutrient, or another addition')
            : operationType === 'racking'
              ? (ka ? '+ გოგირდი ან სხვა დაცვითი დანამატი' : '+ Sulfur or another post-racking treatment')
              : (ka ? '+ ამ ოპერაციაში გამოყენებული მასალა' : '+ Material used during this operation')}
        </button>
      )}

      {value.map(line => {
        const selected = inventory.find(item => item.id === line.materialId);
        const quantity = Number(line.quantity);
        const rate = doseRate(selected, quantity, lotVolumeL);
        const remaining = selected && Number.isFinite(quantity)
          ? Math.round((selected.stock - quantity) * 1000) / 1000
          : null;
        return (
          <div key={line.key} className="rounded-lg border border-indigo-100 bg-white p-2">
            <div className={`grid gap-2 ${compact ? 'grid-cols-1 sm:grid-cols-[1.4fr_.7fr_auto]' : 'grid-cols-1 sm:grid-cols-[1.5fr_.65fr_1fr_auto]'}`}>
              <label className="text-[8px] font-bold uppercase tracking-wider text-stone-400">
                {ka ? 'მარაგის მასალა' : 'Inventory material'}
                <select
                  value={line.materialId}
                  onChange={event => update(line.key, { materialId: event.target.value })}
                  className="mt-1 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-[10px] font-semibold normal-case tracking-normal text-stone-700"
                >
                  <option value="">{ka ? '— აირჩიეთ —' : '— select —'}</option>
                  {ordered.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.stock} {item.unit} · {item.category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[8px] font-bold uppercase tracking-wider text-stone-400">
                {ka ? 'რაოდენობა' : 'Amount'}{selected ? ` (${selected.unit})` : ''}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity}
                  onChange={event => update(line.key, { quantity: event.target.value })}
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-[10px] font-semibold normal-case tracking-normal text-stone-700"
                />
              </label>
              {!compact && (
                <label className="text-[8px] font-bold uppercase tracking-wider text-stone-400">
                  {ka ? 'დანიშნულება' : 'Purpose'}
                  <input
                    type="text"
                    value={line.purpose}
                    onChange={event => update(line.key, { purpose: event.target.value })}
                    placeholder={ka ? 'მაგ. საფუარი, სტარტერი, SO₂' : 'e.g. yeast, starter, SO₂'}
                    className="mt-1 w-full rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-[10px] font-semibold normal-case tracking-normal text-stone-700"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter(item => item.key !== line.key))}
                aria-label={ka ? 'მასალის წაშლა' : 'Remove material'}
                className="self-end rounded-md p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {selected && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-medium text-stone-500">
                <span>
                  {ka ? 'დარჩება' : 'Projected stock'}:{' '}
                  <strong className={remaining != null && remaining < selected.minThreshold ? 'text-rose-700' : 'text-emerald-700'}>
                    {remaining} {selected.unit}
                  </strong>
                </span>
                {rate && <span>{ka ? 'დოზა' : 'Dose rate'}: <strong className="text-indigo-800">{rate}</strong></span>}
                {selected.costPerUnit > 0 && quantity > 0 && (
                  <span>{ka ? 'მასალის ღირებულება' : 'Material cost'}: <strong>{Math.round(quantity * selected.costPerUnit * 100) / 100}</strong></span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {issue && (
        <div role="alert" className="flex items-center gap-1.5 text-[9px] font-bold text-rose-700">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {issue.startsWith('insufficient:')
            ? (ka ? 'ერთ-ერთი რაოდენობა ხელმისაწვდომ მარაგს აღემატება.' : 'One or more quantities exceed available stock.')
            : (ka ? 'აირჩიეთ მასალა და შეიყვანეთ ნულზე მეტი რაოდენობა.' : 'Select a material and enter an amount greater than zero.')}
        </div>
      )}
    </div>
  );
}
