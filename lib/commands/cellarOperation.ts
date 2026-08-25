import { signAuditEntries } from '../auditHash';
import {
  automaticOperationCostEntries,
  materialCostEntryFromOperation,
  resolveCostAutomationSettings,
  type CostEntry,
} from '../costing';
import { CELLAR_OPERATIONS, isQuickCellarOperation } from '../wineryOperations';
import type {
  CellarOperation,
  CellarOperationReversalSnapshot,
  CellarOperationType,
  InventoryItem,
  MaraniOSAuditLog,
  OperationMaterialUsage,
  Vessel,
  WineLot,
} from '../wineryState';

export const CELLAR_OPERATION_COMMAND_TYPE = 'cellar.operation' as const;

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 0.000_001;
const MAX_QUANTITY = 1_000_000_000;
const OPERATION_TYPES = CELLAR_OPERATIONS.map(item => item.key);
const LOSS_ONLY_TYPES = new Set<CellarOperationType>(['pressing', 'racking', 'filtration', 'bottling']);

export type CellarOperationInput = Omit<
  CellarOperation,
  'id' | 'commandId' | 'recordKind' | 'lastModified' | 'lotName' | 'volumeBeforeL'
  | 'materialName' | 'unit' | 'reversalSnapshot' | 'reversalOfOperationId'
  | 'reversalOfCommandId' | 'reversedByCommandId' | 'reversedAt' | 'reversalReason'
>;

export interface CellarOperationCommandPayload {
  operationId: string;
  auditId: string;
  operation: CellarOperationInput;
}

export interface CellarOperationCommandState {
  lots: WineLot[];
  vessels: Vessel[];
  inventory: InventoryItem[];
  cellarOps: CellarOperation[];
  costEntries: CostEntry[];
  auditLogs: MaraniOSAuditLog[];
}

export interface CellarOperationCommandContext {
  commandId: string;
  actorUsername: string;
  currency: string;
  costAutomation?: unknown;
  performedAt: Date;
}

export interface CellarOperationCommandResult {
  operation: CellarOperation;
  lot: WineLot;
  vessel?: Vessel;
  /** All changed inventory records. Singular alias remains for older clients. */
  inventoryItems: InventoryItem[];
  inventoryItem?: InventoryItem;
  /** All generated material costs. Singular alias remains for older clients. */
  costEntries: CostEntry[];
  costEntry?: CostEntry;
  auditLog: MaraniOSAuditLog;
  stateVersion?: number;
  receipt: {
    operationId: string;
    lotId: string;
    vesselId?: string;
    materialId?: string;
    materialDeducted: number;
    materialDeductions?: Array<{
      materialId: string;
      materialName: string;
      quantity: number;
      unit: string;
    }>;
    costPosted: number;
    volumeBeforeL: number;
    volumeAfterL?: number;
  };
}

export interface AppliedCellarOperationCommand {
  state: CellarOperationCommandState;
  result: CellarOperationCommandResult;
}

export type CellarOperationCommandErrorCode =
  | 'invalid_cellar_operation_payload'
  | 'organization_state_not_found'
  | 'cellar_operation_id_conflict'
  | 'cellar_operation_audit_id_conflict'
  | 'cellar_operation_cost_id_conflict'
  | 'cellar_operation_lot_not_found'
  | 'cellar_operation_lot_inactive'
  | 'cellar_operation_vessel_not_found'
  | 'cellar_operation_destination_vessel_not_found'
  | 'cellar_operation_vessel_mismatch'
  | 'cellar_operation_same_vessel'
  | 'cellar_operation_volume_inconsistent'
  | 'cellar_operation_vessel_capacity_exceeded'
  | 'cellar_operation_material_not_found'
  | 'insufficient_operation_material'
  | 'cellar_operation_state_inconsistent';

export class CellarOperationCommandError extends Error {
  constructor(
    public readonly code: CellarOperationCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CellarOperationCommandError';
  }
}

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      `${field} must be 1-128 characters using letters, numbers, dot, colon, underscore, or hyphen.`,
      400,
    );
  }
  return normalized;
}

function optionalRecordId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requiredRecordId(value, field);
}

function textValue(value: unknown, field: string, maxLength: number, required = false): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if ((required && !normalized) || normalized.length > maxLength) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      `${field} ${required ? 'is required and ' : ''}must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function finiteNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  required = false,
): number | undefined {
  if (!required && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      `${field} must be a finite number between ${minimum} and ${maximum}.`,
      400,
    );
  }
  return value;
}

function validDate(value: unknown): string {
  const date = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.date must be a valid calendar date in YYYY-MM-DD format.',
      400,
    );
  }
  return date;
}

function stamped<T extends object>(record: T, timestamp: string): T {
  return { ...record, lastModified: timestamp };
}

function storedQuantity(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_QUANTITY) {
    throw new CellarOperationCommandError(
      'cellar_operation_state_inconsistent',
      `${label} has an invalid stored quantity.`,
      409,
    );
  }
  return value;
}

function roundedQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function parseMaterials(value: unknown): OperationMaterialUsage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 25) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.materials must be an array with at most 25 entries.',
      400,
    );
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new CellarOperationCommandError(
        'invalid_cellar_operation_payload',
        `operation.materials[${index}] must be an object.`,
        400,
      );
    }
    const input = raw as Record<string, unknown>;
    const materialId = requiredRecordId(
      input.materialId,
      `operation.materials[${index}].materialId`,
    );
    if (seen.has(materialId)) {
      throw new CellarOperationCommandError(
        'invalid_cellar_operation_payload',
        `operation.materials repeats material ${materialId}; combine it into one quantity.`,
        400,
      );
    }
    seen.add(materialId);
    return {
      materialId,
      quantity: finiteNumber(
        input.quantity,
        `operation.materials[${index}].quantity`,
        EPSILON,
        MAX_QUANTITY,
        true,
      ) as number,
      ...(textValue(input.purpose, `operation.materials[${index}].purpose`, 120)
        ? { purpose: textValue(input.purpose, `operation.materials[${index}].purpose`, 120) }
        : {}),
    };
  });
}

function parseOperation(value: unknown): CellarOperationInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  if (typeof input.type !== 'string' || !OPERATION_TYPES.includes(input.type as CellarOperationType)) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.type is not supported.',
      400,
    );
  }
  const type = input.type as CellarOperationType;
  if (!isQuickCellarOperation(type)) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'This operation requires its dedicated transfer, bottling, or sanitation workflow.',
      400,
    );
  }
  const meta = CELLAR_OPERATIONS.find(item => item.key === type)!;
  const customLabel = textValue(input.customLabel, 'operation.customLabel', 160);
  if (type === 'custom' && !customLabel) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.customLabel is required for a custom operation.',
      400,
    );
  }

  const vesselId = optionalRecordId(input.vesselId, 'operation.vesselId');
  const vesselToId = optionalRecordId(input.vesselToId, 'operation.vesselToId');
  if (vesselToId && !meta.needsVesselTo) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.vesselToId is not supported for this operation type.',
      400,
    );
  }
  const volumeAfterL = finiteNumber(input.volumeAfterL, 'operation.volumeAfterL', 0, MAX_QUANTITY);
  if (volumeAfterL !== undefined && !meta.affectsVolume) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.volumeAfterL is not supported for this operation type.',
      400,
    );
  }
  const materialId = optionalRecordId(input.materialId, 'operation.materialId');
  const dose = finiteNumber(input.dose, 'operation.dose', EPSILON, MAX_QUANTITY);
  if (Boolean(materialId) !== (dose !== undefined)) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'operation.materialId and operation.dose must be supplied together.',
      400,
    );
  }
  const materials = parseMaterials(input.materials);
  const laborHours = finiteNumber(input.laborHours, 'operation.laborHours', 0, 10_000);
  const energyKwh = finiteNumber(input.energyKwh, 'operation.energyKwh', 0, 10_000_000);
  if (materials.length > 0 && materialId) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'Use operation.materials for multiple additions or the legacy materialId/dose pair, not both.',
      400,
    );
  }

  return {
    date: validDate(input.date),
    type,
    ...(customLabel ? { customLabel } : {}),
    lotId: requiredRecordId(input.lotId, 'operation.lotId'),
    vesselId: vesselId || null,
    vesselToId: vesselToId || null,
    ...(volumeAfterL !== undefined ? { volumeAfterL } : {}),
    ...(materialId ? { materialId, dose: dose as number } : {}),
    ...(materials.length ? { materials } : {}),
    ...(laborHours !== undefined ? { laborHours } : {}),
    ...(energyKwh !== undefined ? { energyKwh } : {}),
    operator: textValue(input.operator, 'operation.operator', 120, true),
    notes: textValue(input.notes, 'operation.notes', 2_000),
  };
}

export function parseCellarOperationCommandPayload(value: unknown): CellarOperationCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'Cellar operation payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  return {
    operationId: requiredRecordId(input.operationId, 'operationId'),
    auditId: requiredRecordId(input.auditId, 'auditId'),
    operation: parseOperation(input.operation),
  };
}

export function cellarOperationPayloadUsesVessels(payload: CellarOperationCommandPayload): boolean {
  return Boolean(payload.operation.vesselId || payload.operation.vesselToId);
}

export function cellarOperationPayloadUsesMaterial(payload: CellarOperationCommandPayload): boolean {
  return Boolean(
    (payload.operation.materialId && payload.operation.dose)
    || payload.operation.materials?.length,
  );
}

export function applyCellarOperationCommand(
  currentState: CellarOperationCommandState,
  rawPayload: unknown,
  context: CellarOperationCommandContext,
): AppliedCellarOperationCommand {
  const payload = parseCellarOperationCommandPayload(rawPayload);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new CellarOperationCommandError(
      'invalid_cellar_operation_payload',
      'Cellar operation execution time is invalid.',
      400,
    );
  }
  if (!currentState || !Array.isArray(currentState.lots) || !Array.isArray(currentState.vessels)
    || !Array.isArray(currentState.inventory) || !Array.isArray(currentState.cellarOps)
    || !Array.isArray(currentState.costEntries) || !Array.isArray(currentState.auditLogs)) {
    throw new CellarOperationCommandError(
      'cellar_operation_state_inconsistent',
      'Organization cellar-operation state is unavailable.',
      400,
    );
  }
  if (currentState.cellarOps.some(item => item.id === payload.operationId)) {
    throw new CellarOperationCommandError('cellar_operation_id_conflict', 'Cellar operation id already exists.', 409);
  }
  if (currentState.auditLogs.some(item => item.id === payload.auditId)) {
    throw new CellarOperationCommandError('cellar_operation_audit_id_conflict', 'Audit record id already exists.', 409);
  }

  const input = payload.operation;
  const lot = currentState.lots.find(item => item.id === input.lotId);
  if (!lot) {
    throw new CellarOperationCommandError('cellar_operation_lot_not_found', 'The wine lot was not found.', 404);
  }
  if (lot.stage === 'sold') {
    throw new CellarOperationCommandError(
      'cellar_operation_lot_inactive',
      'Cellar operations cannot be posted to a sold lot.',
      409,
    );
  }
  const volumeBeforeL = storedQuantity(lot.currentVolume, `Lot ${lot.id}`);

  let vessel: Vessel | undefined;
  let vesselVolumeBefore: number | undefined;
  if (input.vesselId) {
    vessel = currentState.vessels.find(item => item.id === input.vesselId);
    if (!vessel) {
      throw new CellarOperationCommandError('cellar_operation_vessel_not_found', 'The operating vessel was not found.', 404);
    }
    vesselVolumeBefore = storedQuantity(vessel.currentVolume, `Vessel ${vessel.id}`);
    if (vessel.assignedLotId !== lot.id) {
      throw new CellarOperationCommandError(
        'cellar_operation_vessel_mismatch',
        'The operating vessel must be assigned to the selected lot.',
        409,
      );
    }
  }

  if (input.vesselToId) {
    if (input.vesselToId === input.vesselId) {
      throw new CellarOperationCommandError(
        'cellar_operation_same_vessel',
        'Source and destination vessel references must be different.',
        409,
      );
    }
    if (!currentState.vessels.some(item => item.id === input.vesselToId)) {
      throw new CellarOperationCommandError(
        'cellar_operation_destination_vessel_not_found',
        'The referenced destination vessel was not found.',
        404,
      );
    }
  }

  if (input.volumeAfterL !== undefined) {
    if (LOSS_ONLY_TYPES.has(input.type) && input.volumeAfterL > volumeBeforeL + EPSILON) {
      throw new CellarOperationCommandError(
        'cellar_operation_volume_inconsistent',
        'Volume after this operation cannot exceed the current lot volume.',
        409,
      );
    }
    if (vessel && vesselVolumeBefore !== undefined) {
      const capacity = storedQuantity(vessel.capacity, `Vessel ${vessel.id} capacity`);
      const volumeDelta = input.volumeAfterL - volumeBeforeL;
      const resultingVesselVolume = vesselVolumeBefore + volumeDelta;
      if (resultingVesselVolume < -EPSILON) {
        throw new CellarOperationCommandError(
          'cellar_operation_volume_inconsistent',
          'The volume change exceeds the amount held in the operating vessel.',
          409,
        );
      }
      if (resultingVesselVolume > capacity + EPSILON) {
        throw new CellarOperationCommandError(
          'cellar_operation_vessel_capacity_exceeded',
          'The resulting volume exceeds the operating vessel capacity.',
          409,
        );
      }
    }
  }

  const requestedMaterials: OperationMaterialUsage[] = input.materials?.length
    ? input.materials
    : input.materialId && input.dose
      ? [{ materialId: input.materialId, quantity: input.dose }]
      : [];
  const materialRecords = requestedMaterials.map(usage => {
    const material = currentState.inventory.find(item => item.id === usage.materialId);
    if (!material) {
      throw new CellarOperationCommandError(
        'cellar_operation_material_not_found',
        `The consumed inventory material ${usage.materialId} was not found.`,
        404,
      );
    }
    const stock = storedQuantity(material.stock, `Inventory item ${material.id}`);
    storedQuantity(material.costPerUnit, `Inventory item ${material.id} unit cost`);
    if (usage.quantity > stock + EPSILON) {
      throw new CellarOperationCommandError(
        'insufficient_operation_material',
        `Only ${stock} ${material.unit || 'units'} of ${material.name} remains.`,
        409,
      );
    }
    return {
      material,
      usage: {
        ...usage,
        materialName: material.name,
        category: material.category,
        unit: material.unit,
      } satisfies OperationMaterialUsage,
    };
  });

  const timestamp = context.performedAt.toISOString();
  const meta = CELLAR_OPERATIONS.find(item => item.key === input.type)!;
  const operationLabel = input.type === 'custom' ? (input.customLabel as string) : meta.en;
  const hasVolumeChange = input.volumeAfterL !== undefined;
  const descriptionParts: string[] = [operationLabel];
  if (materialRecords.length) {
    descriptionParts.push(materialRecords.map(({ material, usage }) => (
      `${material.name} ${usage.quantity}${material.unit || ''}${usage.purpose ? ` (${usage.purpose})` : ''}`
    )).join(', '));
  }
  if (input.vesselId) {
    descriptionParts.push(input.vesselToId ? `${input.vesselId} → ${input.vesselToId}` : input.vesselId);
  }
  if (hasVolumeChange) descriptionParts.push(`${volumeBeforeL} → ${input.volumeAfterL} L`);
  if (input.laborHours !== undefined) descriptionParts.push(`labor ${input.laborHours} h`);
  if (input.energyKwh !== undefined) descriptionParts.push(`energy ${input.energyKwh} kWh`);
  if (input.notes) descriptionParts.push(input.notes);
  const description = descriptionParts.join(' · ');

  const baseOperation = stamped<CellarOperation>({
    ...input,
    id: payload.operationId,
    commandId: context.commandId,
    recordKind: 'operation',
    lotName: lot.name,
    volumeBeforeL,
    ...(materialRecords.length ? { materials: materialRecords.map(item => item.usage) } : {}),
    ...(materialRecords.length === 1 && input.materialId ? {
      materialName: materialRecords[0].material.name,
      unit: materialRecords[0].material.unit,
    } : {}),
  }, timestamp);

  const generatedMaterialCosts = materialRecords.flatMap(({ material, usage }) => {
    const generated = materialCostEntryFromOperation({
      ...baseOperation,
      materialId: material.id,
      materialName: material.name,
      dose: usage.quantity,
      unit: material.unit,
    }, material, {
      currency: context.currency || 'GEL',
      createdBy: input.operator || context.actorUsername,
    });
    return generated ? [generated] : [];
  });
  const generatedAutomaticCosts = automaticOperationCostEntries({
    operationId: baseOperation.id,
    date: baseOperation.date,
    lotId: baseOperation.lotId,
    operationType: baseOperation.type,
    laborHours: baseOperation.laborHours,
    energyKwh: baseOperation.energyKwh,
    materialCostTotal: generatedMaterialCosts.reduce((sum, item) => sum + item.amount, 0),
    currency: context.currency || 'GEL',
    createdBy: input.operator || context.actorUsername,
    settings: resolveCostAutomationSettings(context.costAutomation),
  });
  const generatedCosts = [...generatedMaterialCosts, ...generatedAutomaticCosts];
  const generatedCostIds = new Set<string>();
  for (const generated of generatedCosts) {
    if (generatedCostIds.has(generated.id)
      || currentState.costEntries.some(item => item.id === generated.id)) {
      throw new CellarOperationCommandError(
        'cellar_operation_cost_id_conflict',
        'A derived operation-cost entry already exists.',
        409,
      );
    }
    generatedCostIds.add(generated.id);
  }
  const costEntries = generatedCosts.map(generated => stamped<CostEntry>({
      ...generated,
      commandId: context.commandId,
      recordKind: 'cost',
    }, timestamp));

  const unsignedAudit = stamped<MaraniOSAuditLog>({
    id: payload.auditId,
    commandId: context.commandId,
    timestamp,
    user: input.operator || context.actorUsername,
    module: 'GVINO',
    actionType: `Cellar Operation: ${operationLabel}`,
    changedItem: `Lot ${lot.id}`,
    oldValue: hasVolumeChange ? `${volumeBeforeL} L` : '',
    newValue: hasVolumeChange ? `${input.volumeAfterL} L` : description,
    notes: description,
  }, timestamp);
  const auditLog = signAuditEntries([unsignedAudit], currentState.auditLogs)[0];
  const useV2Snapshot = materialRecords.length > 1 || costEntries.length > 1;
  const reversalSnapshot: CellarOperationReversalSnapshot = useV2Snapshot
    ? {
      version: 2,
      lot: {
        id: lot.id,
        currentVolume: volumeBeforeL,
        stage: lot.stage,
      },
      ...(vessel ? {
        vessel: {
          id: vessel.id,
          currentVolume: vessel.currentVolume,
          lastOperation: vessel.lastOperation,
        },
      } : {}),
      inventory: materialRecords.map(({ material }) => ({
        id: material.id,
        stock: material.stock,
      })),
      costEntries: costEntries.map(costEntry => ({
        id: costEntry.id,
        amount: costEntry.amount,
        currency: costEntry.currency,
        ...(typeof costEntry.quantity === 'number' ? { quantity: costEntry.quantity } : {}),
      })),
      auditId: auditLog.id,
      operationDescription: description,
    }
    : {
      version: 1,
      lot: {
        id: lot.id,
        currentVolume: volumeBeforeL,
        stage: lot.stage,
      },
      ...(vessel ? {
        vessel: {
          id: vessel.id,
          currentVolume: vessel.currentVolume,
          lastOperation: vessel.lastOperation,
        },
      } : {}),
      ...(materialRecords[0] ? {
        inventory: {
          id: materialRecords[0].material.id,
          stock: materialRecords[0].material.stock,
        },
      } : {}),
      ...(costEntries[0] ? {
        costEntry: {
          id: costEntries[0].id,
          amount: costEntries[0].amount,
          currency: costEntries[0].currency,
          ...(typeof costEntries[0].quantity === 'number' ? { quantity: costEntries[0].quantity } : {}),
        },
      } : {}),
      auditId: auditLog.id,
      operationDescription: description,
    };
  const operation: CellarOperation = {
    ...baseOperation,
    reversalSnapshot,
  };
  const updatedLot = stamped<WineLot>({
    ...lot,
    currentVolume: hasVolumeChange ? input.volumeAfterL as number : lot.currentVolume,
    lastCommandId: context.commandId,
    history: [{
      date: input.date,
      type: operationLabel,
      description,
      operator: input.operator,
      sourceRef: operation.id,
    }, ...(lot.history || [])],
  }, timestamp);
  const resultingVesselVolume = vessel && vesselVolumeBefore !== undefined && hasVolumeChange
    ? roundedQuantity(vesselVolumeBefore + ((input.volumeAfterL as number) - volumeBeforeL))
    : vessel?.currentVolume;
  const updatedVessel = vessel ? stamped<Vessel>({
    ...vessel,
    ...(hasVolumeChange ? { currentVolume: resultingVesselVolume as number } : {}),
    lastCommandId: context.commandId,
    lastOperation: description,
  }, timestamp) : undefined;
  const updatedInventoryItems = materialRecords.map(({ material, usage }) => stamped<InventoryItem>({
    ...material,
    stock: roundedQuantity(material.stock - usage.quantity),
    lastCommandId: context.commandId,
  }, timestamp));
  const updatedInventoryById = new Map(
    updatedInventoryItems.map(item => [item.id, item]),
  );
  const materialDeductions = materialRecords.map(({ material, usage }) => ({
    materialId: material.id,
    materialName: material.name,
    quantity: usage.quantity,
    unit: material.unit || '',
  }));
  const materialDeducted = materialDeductions.reduce((sum, item) => sum + item.quantity, 0);
  const costPosted = costEntries.reduce((sum, item) => sum + item.amount, 0);

  return {
    state: {
      lots: currentState.lots.map(item => item.id === updatedLot.id ? updatedLot : item),
      vessels: updatedVessel
        ? currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item)
        : currentState.vessels,
      inventory: currentState.inventory.map(item => updatedInventoryById.get(item.id) || item),
      cellarOps: [operation, ...currentState.cellarOps],
      costEntries: [...costEntries, ...currentState.costEntries],
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      operation,
      lot: updatedLot,
      ...(updatedVessel ? { vessel: updatedVessel } : {}),
      inventoryItems: updatedInventoryItems,
      ...(updatedInventoryItems[0] ? { inventoryItem: updatedInventoryItems[0] } : {}),
      costEntries,
      ...(costEntries[0] ? { costEntry: costEntries[0] } : {}),
      auditLog,
      receipt: {
        operationId: operation.id,
        lotId: lot.id,
        ...(vessel ? { vesselId: vessel.id } : {}),
        ...(materialRecords[0] ? { materialId: materialRecords[0].material.id } : {}),
        materialDeducted,
        ...(input.materials?.length ? { materialDeductions } : {}),
        costPosted,
        volumeBeforeL,
        ...(input.volumeAfterL !== undefined ? { volumeAfterL: input.volumeAfterL } : {}),
      },
    },
  };
}
