import {
  computeBottlingCostPosting,
  type BottlingPackagingComponent,
  type BottlingPackagingSelections,
  type CostEntry,
} from '../costing';
import { computeStock, stockMovementFromBottlingRun, type StockMovement, type StorageLocation } from '../storage';
import { isInventoryItemForPackagingComponent } from '../inventoryCategories';
import type { BottlingRunRecord, InventoryItem, WineLot } from '../wineryState';

export const BOTTLING_COMMAND_TYPE = 'cellar.bottling' as const;

export const BOTTLING_FORMATS = [
  { key: '0.75', litres: 0.75, kind: 'bottle' },
  { key: '0.5', litres: 0.5, kind: 'bottle' },
  { key: '0.375', litres: 0.375, kind: 'bottle' },
  { key: '0.2', litres: 0.2, kind: 'bottle' },
  { key: '1.5', litres: 1.5, kind: 'bottle' },
  { key: '3.0', litres: 3, kind: 'bottle' },
  { key: 'ceramic', litres: 0.75, kind: 'ceramic' },
] as const;

const PACKAGING_COMPONENTS = ['bottle', 'closure', 'capsule', 'label', 'box'] as const;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 0.000_001;
const MAX_UNITS = 100_000_000;
const MAX_AMOUNT = 1_000_000_000;

export interface BottlingCommandPayload {
  runId: string;
  lotId: string;
  date: string;
  lotNumber: string;
  operator: string;
  formats: Record<string, number>;
  packagingSelections: BottlingPackagingSelections;
  bottlesPerBox: number;
  bottlingServiceCost: number;
  storageLocationId: string;
}

export interface BottlingCommandState {
  lots: WineLot[];
  bottlingRuns: BottlingRunRecord[];
  inventory: InventoryItem[];
  costEntries: CostEntry[];
  storageLocations: StorageLocation[];
  stockMovements: StockMovement[];
}

export interface BottlingCommandContext {
  commandId: string;
  actorUsername: string;
  currency: string;
  performedAt: Date;
}

export interface BottlingCommandResult {
  run: BottlingRunRecord;
  updatedLot: WineLot;
  updatedInventoryItems: InventoryItem[];
  createdCostEntries: CostEntry[];
  storageMovement?: StockMovement;
  stateVersion?: number;
  receipt: {
    lotId: string;
    totalUnits: number;
    volumeBottledL: number;
    remainingLotVolumeL: number;
    packagingCostTotal: number;
    bottlingServiceCost: number;
    storageLocationId?: string;
  };
}

export interface AppliedBottlingCommand {
  state: BottlingCommandState;
  result: BottlingCommandResult;
}

export type BottlingCommandErrorCode =
  | 'invalid_bottling_payload'
  | 'organization_state_not_found'
  | 'bottling_run_id_conflict'
  | 'bottling_lot_not_found'
  | 'bottling_lot_unavailable'
  | 'insufficient_lot_volume'
  | 'packaging_material_not_found'
  | 'packaging_category_mismatch'
  | 'insufficient_packaging_stock'
  | 'cost_entry_id_conflict'
  | 'storage_location_not_found'
  | 'storage_capacity_exceeded'
  | 'stock_movement_id_conflict'
  | 'bottling_state_inconsistent';

export class BottlingCommandError extends Error {
  constructor(
    public readonly code: BottlingCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'BottlingCommandError';
  }
}

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new BottlingCommandError(
      'invalid_bottling_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function optionalRecordId(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return '';
  return requiredRecordId(value, field);
}

function boundedText(value: unknown, field: string, maxLength: number, required: boolean): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new BottlingCommandError(
      'invalid_bottling_payload',
      `${field} ${required ? 'is required and ' : ''}must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function validDate(value: unknown): string {
  const date = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BottlingCommandError('invalid_bottling_payload', 'date must be a valid calendar date in YYYY-MM-DD format.', 400);
  }
  return date;
}

function finiteAmount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
    throw new BottlingCommandError(
      'invalid_bottling_payload',
      `${field} must be a non-negative finite number no greater than ${MAX_AMOUNT}.`,
      400,
    );
  }
  return value;
}

function parseFormats(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BottlingCommandError('invalid_bottling_payload', 'formats must be an object.', 400);
  }
  const supportedKeys = new Set<string>(BOTTLING_FORMATS.map(format => format.key));
  const formats: Record<string, number> = {};
  let totalUnits = 0;
  for (const [key, rawCount] of Object.entries(value)) {
    if (!supportedKeys.has(key) || typeof rawCount !== 'number' || !Number.isSafeInteger(rawCount)
      || rawCount < 0 || rawCount > MAX_UNITS) {
      throw new BottlingCommandError(
        'invalid_bottling_payload',
        `formats.${key} must be a supported non-negative whole-unit count.`,
        400,
      );
    }
    formats[key] = rawCount;
    totalUnits += rawCount;
  }
  if (totalUnits <= 0 || totalUnits > MAX_UNITS) {
    throw new BottlingCommandError(
      'invalid_bottling_payload',
      `formats must contain between 1 and ${MAX_UNITS} total units.`,
      400,
    );
  }
  return formats;
}

function parsePackagingSelections(value: unknown): BottlingPackagingSelections {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BottlingCommandError('invalid_bottling_payload', 'packagingSelections must be an object.', 400);
  }
  const selections: BottlingPackagingSelections = {};
  for (const [component, materialId] of Object.entries(value)) {
    if (!PACKAGING_COMPONENTS.includes(component as BottlingPackagingComponent)) {
      throw new BottlingCommandError('invalid_bottling_payload', `Unsupported packaging component: ${component}.`, 400);
    }
    selections[component as BottlingPackagingComponent] = requiredRecordId(
      materialId,
      `packagingSelections.${component}`,
    );
  }
  return selections;
}

function stamped<T extends object>(record: T, timestamp: string): T {
  return { ...record, lastModified: timestamp };
}

const round1 = (value: number): number => Math.round((value + Number.EPSILON) * 10) / 10;
const round3 = (value: number): number => Math.round((value + Number.EPSILON) * 1000) / 1000;

export function parseBottlingCommandPayload(value: unknown): BottlingCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BottlingCommandError('invalid_bottling_payload', 'Bottling payload must be an object.', 400);
  }
  const input = value as Record<string, unknown>;
  const bottlesPerBox = input.bottlesPerBox;
  if (typeof bottlesPerBox !== 'number' || !Number.isSafeInteger(bottlesPerBox)
    || bottlesPerBox <= 0 || bottlesPerBox > 1_000_000) {
    throw new BottlingCommandError(
      'invalid_bottling_payload',
      'bottlesPerBox must be a positive whole number no greater than 1000000.',
      400,
    );
  }
  return {
    runId: requiredRecordId(input.runId, 'runId'),
    lotId: requiredRecordId(input.lotId, 'lotId'),
    date: validDate(input.date),
    lotNumber: boundedText(input.lotNumber, 'lotNumber', 120, false),
    operator: boundedText(input.operator, 'operator', 120, true),
    formats: parseFormats(input.formats),
    packagingSelections: parsePackagingSelections(input.packagingSelections),
    bottlesPerBox,
    bottlingServiceCost: finiteAmount(input.bottlingServiceCost, 'bottlingServiceCost'),
    storageLocationId: optionalRecordId(input.storageLocationId, 'storageLocationId'),
  };
}

export function bottlingPayloadUsesCosting(payload: Pick<BottlingCommandPayload, 'packagingSelections' | 'bottlingServiceCost'>): boolean {
  return Object.keys(payload.packagingSelections).length > 0 || payload.bottlingServiceCost > 0;
}

export function applyBottlingCommand(
  currentState: BottlingCommandState,
  rawPayload: unknown,
  context: BottlingCommandContext,
): AppliedBottlingCommand {
  const payload = parseBottlingCommandPayload(rawPayload);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new BottlingCommandError('invalid_bottling_payload', 'Bottling execution time is invalid.', 400);
  }
  if (!currentState || !Array.isArray(currentState.lots) || !Array.isArray(currentState.bottlingRuns)
    || !Array.isArray(currentState.inventory) || !Array.isArray(currentState.costEntries)
    || !Array.isArray(currentState.storageLocations) || !Array.isArray(currentState.stockMovements)) {
    throw new BottlingCommandError('bottling_state_inconsistent', 'Organization bottling state is unavailable.', 400);
  }
  if (currentState.bottlingRuns.some(run => run.id === payload.runId)) {
    throw new BottlingCommandError('bottling_run_id_conflict', 'Bottling run id already exists.', 409);
  }

  const lot = currentState.lots.find(item => item.id === payload.lotId);
  if (!lot) throw new BottlingCommandError('bottling_lot_not_found', 'The wine lot was not found.', 404);
  if (lot.stage === 'sold' || !(lot.currentVolume > 0)) {
    throw new BottlingCommandError('bottling_lot_unavailable', 'The wine lot is not available for bottling.', 409);
  }
  if (!Number.isFinite(lot.currentVolume) || lot.currentVolume < 0) {
    throw new BottlingCommandError('bottling_state_inconsistent', 'The wine lot has an invalid stored volume.', 409);
  }

  const totalBottles = BOTTLING_FORMATS
    .filter(format => format.kind === 'bottle')
    .reduce((sum, format) => sum + (payload.formats[format.key] || 0), 0);
  const totalCeramic = BOTTLING_FORMATS
    .filter(format => format.kind === 'ceramic')
    .reduce((sum, format) => sum + (payload.formats[format.key] || 0), 0);
  const totalUnits = totalBottles + totalCeramic;
  const volumeBottledL = round1(BOTTLING_FORMATS.reduce(
    (sum, format) => sum + (payload.formats[format.key] || 0) * format.litres,
    0,
  ));
  if (volumeBottledL > lot.currentVolume + EPSILON) {
    throw new BottlingCommandError(
      'insufficient_lot_volume',
      `Lot ${lot.id} contains ${lot.currentVolume} L, less than the requested ${volumeBottledL} L.`,
      409,
    );
  }

  const costPosting = computeBottlingCostPosting({
    runId: payload.runId,
    date: payload.date,
    lotId: lot.id,
    totalUnits,
    packagingSelections: payload.packagingSelections,
    inventory: currentState.inventory,
    bottlesPerBox: payload.bottlesPerBox,
    bottlingServiceCost: payload.bottlingServiceCost,
    currency: context.currency,
    createdBy: payload.operator || context.actorUsername,
  });

  const inventoryById = new Map(currentState.inventory.map(item => [item.id, item]));
  for (const [component, materialId] of Object.entries(payload.packagingSelections) as Array<[BottlingPackagingComponent, string]>) {
    const material = materialId ? inventoryById.get(materialId) : undefined;
    if (!material) {
      throw new BottlingCommandError(
        'packaging_material_not_found',
        `Packaging material ${materialId || '(missing)'} was not found.`,
        404,
      );
    }
    if (!isInventoryItemForPackagingComponent(material, component)) {
      throw new BottlingCommandError(
        'packaging_category_mismatch',
        `${material.name} is not categorized for the ${component} packaging component.`,
        409,
      );
    }
  }
  for (const [materialId, required] of Object.entries(costPosting.deductions)) {
    const material = inventoryById.get(materialId);
    if (!material || !Number.isFinite(material.stock) || material.stock < 0) {
      throw new BottlingCommandError('bottling_state_inconsistent', `Packaging material ${materialId} has invalid stock.`, 409);
    }
    if (material.stock + EPSILON < required) {
      throw new BottlingCommandError(
        'insufficient_packaging_stock',
        `${material.name} has ${material.stock} available; ${required} is required.`,
        409,
      );
    }
  }
  for (const entry of costPosting.entries) {
    if (currentState.costEntries.some(existing => existing.id === entry.id)) {
      throw new BottlingCommandError('cost_entry_id_conflict', `Cost entry ${entry.id} already exists.`, 409);
    }
  }

  let storageMovement: StockMovement | undefined;
  if (payload.storageLocationId) {
    const location = currentState.storageLocations.find(item => item.id === payload.storageLocationId);
    if (!location) {
      throw new BottlingCommandError('storage_location_not_found', 'The finished-goods storage location was not found.', 404);
    }
    const currentStored = computeStock(currentState.stockMovements).get(location.id)?.totalBottles || 0;
    if (currentStored < 0) {
      throw new BottlingCommandError('bottling_state_inconsistent', 'The storage location has an invalid negative balance.', 409);
    }
    if (location.capacityBottles && currentStored + totalUnits > location.capacityBottles) {
      throw new BottlingCommandError(
        'storage_capacity_exceeded',
        `${location.name} has only ${Math.max(0, location.capacityBottles - currentStored)} bottle spaces available.`,
        409,
      );
    }
    const generated = stockMovementFromBottlingRun({
      runId: payload.runId,
      date: payload.date,
      lotId: lot.id,
      locationId: location.id,
      bottles: totalUnits,
      lotName: lot.name,
    });
    if (!generated) {
      throw new BottlingCommandError('bottling_state_inconsistent', 'The storage movement could not be created.', 409);
    }
    if (currentState.stockMovements.some(existing => existing.id === generated.id)) {
      throw new BottlingCommandError('stock_movement_id_conflict', `Stock movement ${generated.id} already exists.`, 409);
    }
    storageMovement = stamped({ ...generated, commandId: context.commandId }, context.performedAt.toISOString());
  }

  const timestamp = context.performedAt.toISOString();
  const remainingLotVolumeL = Math.max(0, round1(lot.currentVolume - volumeBottledL));
  const fullyBottled = remainingLotVolumeL <= 0.5;
  const breakdown = BOTTLING_FORMATS
    .filter(format => (payload.formats[format.key] || 0) > 0)
    .map(format => `${payload.formats[format.key]}×${format.key === 'ceramic' ? 'ceramic 0.75 L' : `${format.key} L`}`)
    .join(', ');
  const updatedLot = stamped<WineLot>({
    ...lot,
    lastCommandId: context.commandId,
    currentVolume: remainingLotVolumeL,
    stage: fullyBottled ? 'bottled' : lot.stage,
    history: [{
      date: payload.date,
      type: 'bottling',
      description: `Bottling: ${breakdown}${payload.lotNumber ? ` (lot ${payload.lotNumber})` : ''}`,
      operator: payload.operator,
      sourceRef: payload.runId,
    }, ...(lot.history || [])],
  }, timestamp);

  const updatedInventoryItems: InventoryItem[] = [];
  const inventory = currentState.inventory.map(item => {
    const used = costPosting.deductions[item.id] || 0;
    if (used <= 0) return item;
    const updated = stamped({ ...item, stock: round3(item.stock - used), lastCommandId: context.commandId }, timestamp);
    updatedInventoryItems.push(updated);
    return updated;
  });
  const createdCostEntries = costPosting.entries.map(entry => stamped({
    ...entry,
    commandId: context.commandId,
    recordKind: 'cost' as const,
  }, timestamp));
  const run = stamped<BottlingRunRecord>({
    id: payload.runId,
    commandId: context.commandId,
    recordKind: 'bottling',
    createdAt: timestamp,
    lotId: lot.id,
    lotName: lot.name,
    date: payload.date,
    lotNumber: payload.lotNumber,
    operator: payload.operator,
    formats: { ...payload.formats },
    totalBottles,
    totalCeramic,
    volumeBottledL,
    previousLotVolumeL: lot.currentVolume,
    previousLotStage: lot.stage,
    ...(Object.keys(payload.packagingSelections).length > 0
      ? { packagingMaterialIds: { ...payload.packagingSelections } }
      : {}),
    ...(Object.keys(costPosting.deductions).length > 0 ? { packagingDeductions: costPosting.deductions } : {}),
    bottlesPerBox: payload.bottlesPerBox,
    ...(costPosting.packagingCostTotal > 0 ? { packagingCostTotal: costPosting.packagingCostTotal } : {}),
    ...(costPosting.bottlingServiceCost > 0 ? { bottlingServiceCost: costPosting.bottlingServiceCost } : {}),
    ...(storageMovement ? {
      storageLocationId: storageMovement.locationId,
      storageMovementId: storageMovement.id,
      placedInStorageBottles: storageMovement.bottles,
    } : {}),
  }, timestamp);

  return {
    state: {
      lots: currentState.lots.map(item => item.id === updatedLot.id ? updatedLot : item),
      bottlingRuns: [run, ...currentState.bottlingRuns],
      inventory,
      costEntries: [...createdCostEntries, ...currentState.costEntries],
      storageLocations: currentState.storageLocations,
      stockMovements: storageMovement ? [storageMovement, ...currentState.stockMovements] : currentState.stockMovements,
    },
    result: {
      run,
      updatedLot,
      updatedInventoryItems,
      createdCostEntries,
      ...(storageMovement ? { storageMovement } : {}),
      receipt: {
        lotId: lot.id,
        totalUnits,
        volumeBottledL,
        remainingLotVolumeL,
        packagingCostTotal: costPosting.packagingCostTotal,
        bottlingServiceCost: costPosting.bottlingServiceCost,
        ...(storageMovement ? { storageLocationId: storageMovement.locationId } : {}),
      },
    },
  };
}
