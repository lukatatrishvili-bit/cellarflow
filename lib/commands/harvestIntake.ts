import { signAuditEntries } from '../auditHash';
import {
  grapeIntakeCostEntry,
  resolveCostAutomationSettings,
  type CostEntry,
} from '../costing';
import { PDO_RULES } from '../pdo';
import { estimateMustVolumeL } from '../wineryOperations';
import type {
  GrapeIntakeCondition,
  GrapeIntakeRecord,
  GrapeSource,
  HarvestIntakeReversalSnapshot,
  HarvestRecord,
  MaraniOSAuditLog,
  Vessel,
  VineyardBlock,
  WineClass,
  WineLot,
} from '../wineryState';

export const HARVEST_INTAKE_COMMAND_TYPE = 'cellar.harvest-intake' as const;

const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 0.000_001;
const MAX_WEIGHT_KG = 100_000_000;
const MAX_AMOUNT = 1_000_000_000;

export type HarvestIntakeInput = Omit<
  GrapeIntakeRecord,
  'id' | 'createdLotId' | 'netWeightKg' | 'estimatedVolumeL' | 'currency' | 'commandId'
  | 'recordKind' | 'lastModified' | 'reversalSnapshot' | 'reversalOfIntakeId'
  | 'reversalOfCommandId' | 'reversedByCommandId' | 'reversedAt' | 'reversalReason'
>;

export interface HarvestIntakeCommandPayload {
  intakeId: string;
  lotId: string;
  auditId: string;
  intake: HarvestIntakeInput;
}

export interface HarvestIntakeCommandState {
  blocks: VineyardBlock[];
  harvests: HarvestRecord[];
  lots: WineLot[];
  vessels: Vessel[];
  grapeIntakes: GrapeIntakeRecord[];
  costEntries: CostEntry[];
  auditLogs: MaraniOSAuditLog[];
}

export interface HarvestIntakeCommandContext {
  commandId: string;
  actorUsername: string;
  currency: string;
  region: string;
  costAutomation?: unknown;
  performedAt: Date;
}

export interface HarvestIntakeCommandResult {
  intake: GrapeIntakeRecord;
  lot: WineLot;
  auditLog: MaraniOSAuditLog;
  updatedHarvest?: HarvestRecord;
  updatedVessel?: Vessel;
  costEntry?: CostEntry;
  stateVersion?: number;
  receipt: {
    intakeId: string;
    lotId: string;
    netWeightKg: number;
    estimatedVolumeL: number;
    harvestRecordId?: string;
    destinationVesselId?: string;
    costPosted: number;
  };
}

export interface AppliedHarvestIntakeCommand {
  state: HarvestIntakeCommandState;
  result: HarvestIntakeCommandResult;
}

export type HarvestIntakeCommandErrorCode =
  | 'invalid_harvest_intake_payload'
  | 'organization_state_not_found'
  | 'intake_id_conflict'
  | 'intake_lot_id_conflict'
  | 'intake_audit_id_conflict'
  | 'intake_cost_id_conflict'
  | 'intake_block_not_found'
  | 'intake_harvest_not_found'
  | 'harvest_already_received'
  | 'harvest_intake_mismatch'
  | 'intake_vessel_not_found'
  | 'intake_vessel_unavailable'
  | 'intake_vessel_capacity_exceeded'
  | 'harvest_intake_state_inconsistent';

export class HarvestIntakeCommandError extends Error {
  constructor(
    public readonly code: HarvestIntakeCommandErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HarvestIntakeCommandError';
  }
}

function requiredRecordId(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!RECORD_ID_PATTERN.test(normalized)) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
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
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      `${field} ${required ? 'is required and ' : ''}must not exceed ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  const normalized = textValue(value, field, maxLength);
  return normalized || undefined;
}

function validDate(value: unknown): string {
  const date = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'intake.date must be a valid calendar date in YYYY-MM-DD format.',
      400,
    );
  }
  return date;
}

function finiteNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  required = true,
): number | undefined {
  if (!required && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      `${field} must be a finite number between ${minimum} and ${maximum}.`,
      400,
    );
  }
  return value;
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      `${field} must be one of: ${allowed.join(', ')}.`,
      400,
    );
  }
  return value as T;
}

function cleanText(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function textMatches(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: 'accent' }) === 0;
}

function inferPdoClassification(microzone: string | undefined): WineLot['classification'] | undefined {
  if (!microzone) return undefined;
  const normalized = microzone.trim().toLocaleLowerCase();
  return PDO_RULES.some(rule => rule.microzones.some(zone => {
    const candidate = zone.trim().toLocaleLowerCase();
    return candidate.includes(normalized) || normalized.includes(candidate);
  })) ? 'PDO' : undefined;
}

function inferOriginProofStatus(...values: Array<string | undefined>): WineLot['originProofStatus'] {
  return values.some(Boolean) ? 'partial' : 'missing';
}

function stamped<T extends object>(record: T, timestamp: string): T {
  return { ...record, lastModified: timestamp };
}

function compactRecord<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

function parseIntake(value: unknown): HarvestIntakeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'intake must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  const source = enumValue<GrapeSource>(input.source, 'intake.source', ['own', 'supplier']);
  const grossWeightKg = finiteNumber(input.grossWeightKg, 'intake.grossWeightKg', 0, MAX_WEIGHT_KG) as number;
  const tareWeightKg = finiteNumber(input.tareWeightKg, 'intake.tareWeightKg', 0, MAX_WEIGHT_KG) as number;
  if (grossWeightKg <= tareWeightKg) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'intake.grossWeightKg must be greater than intake.tareWeightKg.',
      400,
    );
  }
  const vintage = input.vintage;
  if (typeof vintage !== 'number' || !Number.isSafeInteger(vintage) || vintage < 1900 || vintage > 2200) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'intake.vintage must be a whole year between 1900 and 2200.',
      400,
    );
  }

  const costPerKg = finiteNumber(input.costPerKg, 'intake.costPerKg', 0, MAX_AMOUNT, false);
  const totalCost = finiteNumber(input.totalCost, 'intake.totalCost', 0, MAX_AMOUNT, false);
  const grapePrice = finiteNumber(input.grapePrice, 'intake.grapePrice', 0, MAX_AMOUNT, false);
  const paymentStatus = input.paymentStatus === undefined
    ? 'not_applicable'
    : enumValue<NonNullable<GrapeIntakeRecord['paymentStatus']>>(
      input.paymentStatus,
      'intake.paymentStatus',
      ['not_applicable', 'unpaid', 'partial', 'paid'],
    );

  return compactRecord({
    date: validDate(input.date),
    time: optionalText(input.time, 'intake.time', 8),
    source,
    supplierName: optionalText(input.supplierName, 'intake.supplierName', 180),
    supplierIdCode: optionalText(input.supplierIdCode, 'intake.supplierIdCode', 120),
    blockId: optionalRecordId(input.blockId, 'intake.blockId'),
    blockName: optionalText(input.blockName, 'intake.blockName', 180),
    transportName: optionalText(input.transportName, 'intake.transportName', 180),
    transportNumber: optionalText(input.transportNumber, 'intake.transportNumber', 120),
    weighingDocumentNumber: optionalText(input.weighingDocumentNumber, 'intake.weighingDocumentNumber', 120),
    labAnalysisNumber: optionalText(input.labAnalysisNumber, 'intake.labAnalysisNumber', 120),
    cadastralCode: optionalText(input.cadastralCode, 'intake.cadastralCode', 120),
    village: optionalText(input.village, 'intake.village', 180),
    community: optionalText(input.community, 'intake.community', 180),
    municipality: optionalText(input.municipality, 'intake.municipality', 180),
    microzone: optionalText(input.microzone, 'intake.microzone', 180),
    variety: textValue(input.variety, 'intake.variety', 180, true),
    vintage,
    grossWeightKg,
    tareWeightKg,
    brix: finiteNumber(input.brix, 'intake.brix', 0, 50) as number,
    ph: finiteNumber(input.ph, 'intake.ph', 0, 14) as number,
    titratableAcidity: finiteNumber(input.titratableAcidity, 'intake.titratableAcidity', 0, 100) as number,
    temperatureC: finiteNumber(input.temperatureC, 'intake.temperatureC', -50, 100) as number,
    condition: enumValue<GrapeIntakeCondition>(input.condition, 'intake.condition', ['excellent', 'good', 'fair', 'damaged']),
    pickingMethod: enumValue<'hand' | 'machine'>(input.pickingMethod, 'intake.pickingMethod', ['hand', 'machine']),
    wineClass: enumValue<WineClass>(
      input.wineClass,
      'intake.wineClass',
      ['white', 'red', 'rose', 'amber', 'sparkling', 'fortified', 'base_wine'],
    ),
    juiceYieldPct: finiteNumber(input.juiceYieldPct, 'intake.juiceYieldPct', EPSILON, 100) as number,
    ...(costPerKg !== undefined && costPerKg > 0 ? { costPerKg } : {}),
    ...(totalCost !== undefined && totalCost > 0 ? { totalCost } : {}),
    ...(grapePrice !== undefined && grapePrice > 0 ? { grapePrice } : {}),
    paymentStatus,
    destinationVesselId: optionalRecordId(input.destinationVesselId, 'intake.destinationVesselId') || null,
    harvestRecordId: optionalRecordId(input.harvestRecordId, 'intake.harvestRecordId'),
    operator: textValue(input.operator, 'intake.operator', 120, true),
    notes: textValue(input.notes, 'intake.notes', 2_000),
  });
}

export function parseHarvestIntakeCommandPayload(value: unknown): HarvestIntakeCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'Harvest intake payload must be an object.',
      400,
    );
  }
  const input = value as Record<string, unknown>;
  return {
    intakeId: requiredRecordId(input.intakeId, 'intakeId'),
    lotId: requiredRecordId(input.lotId, 'lotId'),
    auditId: requiredRecordId(input.auditId, 'auditId'),
    intake: parseIntake(input.intake),
  };
}

export function harvestIntakePayloadUsesCosting(payload: HarvestIntakeCommandPayload): boolean {
  const intake = payload.intake;
  return Boolean((intake.costPerKg || 0) > 0
    || (intake.totalCost || 0) > 0
    || (intake.grapePrice || 0) > 0
    || (intake.paymentStatus && intake.paymentStatus !== 'not_applicable'));
}

export function applyHarvestIntakeCommand(
  currentState: HarvestIntakeCommandState,
  rawPayload: unknown,
  context: HarvestIntakeCommandContext,
): AppliedHarvestIntakeCommand {
  const payload = parseHarvestIntakeCommandPayload(rawPayload);
  if (!(context.performedAt instanceof Date) || Number.isNaN(context.performedAt.getTime())) {
    throw new HarvestIntakeCommandError('invalid_harvest_intake_payload', 'Harvest intake execution time is invalid.', 400);
  }
  if (!currentState || !Array.isArray(currentState.blocks) || !Array.isArray(currentState.harvests)
    || !Array.isArray(currentState.lots) || !Array.isArray(currentState.vessels)
    || !Array.isArray(currentState.grapeIntakes) || !Array.isArray(currentState.costEntries)
    || !Array.isArray(currentState.auditLogs)) {
    throw new HarvestIntakeCommandError(
      'harvest_intake_state_inconsistent',
      'Organization harvest intake state is unavailable.',
      400,
    );
  }
  if (currentState.grapeIntakes.some(item => item.id === payload.intakeId)) {
    throw new HarvestIntakeCommandError('intake_id_conflict', 'Grape intake id already exists.', 409);
  }
  if (currentState.lots.some(item => item.id === payload.lotId)) {
    throw new HarvestIntakeCommandError('intake_lot_id_conflict', 'Wine lot id already exists.', 409);
  }
  if (currentState.auditLogs.some(item => item.id === payload.auditId)) {
    throw new HarvestIntakeCommandError('intake_audit_id_conflict', 'Audit record id already exists.', 409);
  }

  const input = payload.intake;
  const costAutomation = resolveCostAutomationSettings(context.costAutomation);
  let block: VineyardBlock | undefined;
  if (input.source === 'own') {
    if (!input.blockId) {
      throw new HarvestIntakeCommandError(
        'invalid_harvest_intake_payload',
        'An own-vineyard intake requires intake.blockId.',
        400,
      );
    }
    block = currentState.blocks.find(item => item.id === input.blockId);
    if (!block) {
      throw new HarvestIntakeCommandError('intake_block_not_found', 'The vineyard block was not found.', 404);
    }
  } else if (!input.supplierName) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'A supplier intake requires intake.supplierName.',
      400,
    );
  }

  let harvest: HarvestRecord | undefined;
  if (input.harvestRecordId) {
    harvest = currentState.harvests.find(item => item.id === input.harvestRecordId);
    if (!harvest) {
      throw new HarvestIntakeCommandError('intake_harvest_not_found', 'The linked harvest record was not found.', 404);
    }
    if (harvest.sentToGvino || harvest.associatedLotId) {
      throw new HarvestIntakeCommandError(
        'harvest_already_received',
        'The linked harvest was already received into the winery.',
        409,
      );
    }
    if (input.source !== 'own' || !block || harvest.blockId !== block.id || !textMatches(harvest.variety, input.variety)) {
      throw new HarvestIntakeCommandError(
        'harvest_intake_mismatch',
        'The linked harvest must match the intake block, source, and grape variety.',
        409,
      );
    }
  }

  const netWeightKg = Math.round((input.grossWeightKg - input.tareWeightKg + Number.EPSILON) * 1000) / 1000;
  const estimatedVolumeL = estimateMustVolumeL(netWeightKg, input.juiceYieldPct);
  if (!(netWeightKg > 0) || !(estimatedVolumeL > 0)) {
    throw new HarvestIntakeCommandError(
      'invalid_harvest_intake_payload',
      'The intake must produce positive net fruit weight and estimated must volume.',
      400,
    );
  }

  const timestamp = context.performedAt.toISOString();
  let updatedVessel: Vessel | undefined;
  let destinationVessel: Vessel | undefined;
  if (input.destinationVesselId) {
    const vessel = currentState.vessels.find(item => item.id === input.destinationVesselId);
    if (!vessel) {
      throw new HarvestIntakeCommandError('intake_vessel_not_found', 'The destination vessel was not found.', 404);
    }
    if (!Number.isFinite(vessel.capacity) || !Number.isFinite(vessel.currentVolume)
      || vessel.capacity <= 0 || vessel.currentVolume < 0 || vessel.currentVolume > vessel.capacity + EPSILON) {
      throw new HarvestIntakeCommandError(
        'harvest_intake_state_inconsistent',
        'The destination vessel has invalid stored capacity or volume.',
        409,
      );
    }
    if (vessel.cleaningStatus !== 'clean' || vessel.currentVolume > EPSILON || vessel.assignedLotId) {
      throw new HarvestIntakeCommandError(
        'intake_vessel_unavailable',
        'The destination vessel must be clean, empty, and unassigned before receiving a new lot.',
        409,
      );
    }
    if (estimatedVolumeL > vessel.capacity + EPSILON) {
      throw new HarvestIntakeCommandError(
        'intake_vessel_capacity_exceeded',
        `The destination vessel holds ${vessel.capacity} L, less than the estimated ${estimatedVolumeL} L.`,
        409,
      );
    }
    destinationVessel = vessel;
    updatedVessel = stamped<Vessel>({
      ...vessel,
      currentVolume: Math.round((estimatedVolumeL + Number.EPSILON) * 10) / 10,
      assignedLotId: payload.lotId,
      temperature: input.temperatureC,
      lastOperation: `Grape intake: ${input.variety} (${estimatedVolumeL} L must)`,
      lastCommandId: context.commandId,
    }, timestamp);
  }

  const blockName = block?.name || input.blockName;
  const cadastralCode = cleanText(block?.cadastralCode) || input.cadastralCode;
  const municipality = cleanText(block?.municipality) || input.municipality;
  const community = cleanText(block?.community) || input.community;
  const village = cleanText(block?.village) || cleanText(block?.vineyardName) || input.village;
  const microzone = cleanText(block?.microzone) || input.microzone;
  const origin = input.source === 'own' ? (blockName || 'Own vineyard') : (input.supplierName || 'Supplier');
  const lot = stamped<WineLot>(compactRecord({
    id: payload.lotId,
    commandId: context.commandId,
    lastCommandId: context.commandId,
    name: `${input.variety} — ${origin} ${input.vintage}`,
    vintage: input.vintage,
    variety: input.variety,
    vineyardBlock: origin,
    region: context.region || 'Kakheti',
    initialVolume: estimatedVolumeL,
    currentVolume: estimatedVolumeL,
    wineClass: input.wineClass,
    stage: 'crushing',
    createdAt: input.date,
    intendedAppellation: microzone,
    classification: inferPdoClassification(microzone),
    originProofStatus: inferOriginProofStatus(cadastralCode, municipality, village, microzone),
    marketStatus: 'unknown',
    history: [{
      date: input.date,
      type: 'Grape Receiving',
      description: `Intake of ${netWeightKg.toLocaleString()} kg ${input.variety} (${origin}) — ${input.brix}°Brix, pH ${input.ph}, TA ${input.titratableAcidity} g/L. Est. ${estimatedVolumeL} L must.`,
      operator: input.operator || context.actorUsername,
      sourceRef: payload.intakeId,
    }],
  }), timestamp);

  const baseIntake = stamped<GrapeIntakeRecord>(compactRecord({
    ...input,
    id: payload.intakeId,
    commandId: context.commandId,
    recordKind: 'intake',
    blockName,
    cadastralCode,
    municipality,
    community,
    village,
    microzone,
    netWeightKg,
    estimatedVolumeL,
    createdLotId: payload.lotId,
    currency: context.currency || 'GEL',
    ...(
      input.costPerKg
        ? { grapePrice: input.grapePrice || input.costPerKg }
        : input.source === 'own' && costAutomation.enabled && !input.totalCost && !input.grapePrice
          ? {
              costPerKg: costAutomation.ownGrapeCostPerKg,
              grapePrice: costAutomation.ownGrapeCostPerKg,
            }
          : {}
    ),
  }), timestamp);

  let costEntry = grapeIntakeCostEntry(baseIntake, {
    currency: context.currency || 'GEL',
    createdBy: input.operator || context.actorUsername,
  }) || undefined;
  if (costEntry) {
    if (currentState.costEntries.some(item => item.id === costEntry?.id)) {
      throw new HarvestIntakeCommandError('intake_cost_id_conflict', 'The intake cost entry id already exists.', 409);
    }
    costEntry = stamped<CostEntry>({ ...costEntry, commandId: context.commandId, recordKind: 'cost' }, timestamp);
  }

  const updatedHarvest = harvest ? stamped<HarvestRecord>({
    ...harvest,
    sentToGvino: true,
    actualHarvestedKg: netWeightKg,
    actualHarvestDate: input.date,
    associatedLotId: payload.lotId,
    lastCommandId: context.commandId,
  }, timestamp) : undefined;

  const unsignedAudit = stamped<MaraniOSAuditLog>({
    id: payload.auditId,
    commandId: context.commandId,
    timestamp,
    user: input.operator || context.actorUsername,
    module: 'GVINO',
    actionType: 'Grape Receiving',
    changedItem: `WineLot ${payload.lotId}`,
    oldValue: 'None',
    newValue: `${netWeightKg} kg ${input.variety} → ${estimatedVolumeL} L must${input.destinationVesselId ? ` in ${input.destinationVesselId}` : ''}`,
    notes: `Source: ${origin}. ${input.brix}°Brix, pH ${input.ph}, TA ${input.titratableAcidity} g/L.`,
  }, timestamp);
  const auditLog = signAuditEntries([unsignedAudit], currentState.auditLogs)[0];
  const lotHistoryDescription = lot.history[0]?.description || '';
  const reversalSnapshot: HarvestIntakeReversalSnapshot = {
    version: 1,
    lot: {
      id: lot.id,
      initialVolume: lot.initialVolume,
      currentVolume: lot.currentVolume,
      stage: lot.stage,
      historyDescription: lotHistoryDescription,
    },
    ...(harvest ? {
      harvest: {
        id: harvest.id,
        sentToGvino: harvest.sentToGvino,
        actualHarvestedKg: harvest.actualHarvestedKg ?? null,
        actualHarvestDate: harvest.actualHarvestDate ?? null,
        associatedLotId: harvest.associatedLotId ?? null,
      },
    } : {}),
    ...(destinationVessel ? {
      vessel: {
        id: destinationVessel.id,
        currentVolume: destinationVessel.currentVolume,
        assignedLotId: destinationVessel.assignedLotId ?? null,
        temperature: destinationVessel.temperature,
        lastOperation: destinationVessel.lastOperation,
      },
    } : {}),
    ...(costEntry ? {
      costEntry: {
        id: costEntry.id,
        amount: costEntry.amount,
        currency: costEntry.currency,
        ...(typeof costEntry.quantity === 'number' ? { quantity: costEntry.quantity } : {}),
      },
    } : {}),
    auditId: auditLog.id,
  };
  const intake: GrapeIntakeRecord = {
    ...baseIntake,
    reversalSnapshot,
  };

  return {
    state: {
      blocks: currentState.blocks,
      harvests: updatedHarvest
        ? currentState.harvests.map(item => item.id === updatedHarvest.id ? updatedHarvest : item)
        : currentState.harvests,
      lots: [lot, ...currentState.lots],
      vessels: updatedVessel
        ? currentState.vessels.map(item => item.id === updatedVessel.id ? updatedVessel : item)
        : currentState.vessels,
      grapeIntakes: [intake, ...currentState.grapeIntakes],
      costEntries: costEntry ? [costEntry, ...currentState.costEntries] : currentState.costEntries,
      auditLogs: [auditLog, ...currentState.auditLogs],
    },
    result: {
      intake,
      lot,
      auditLog,
      ...(updatedHarvest ? { updatedHarvest } : {}),
      ...(updatedVessel ? { updatedVessel } : {}),
      ...(costEntry ? { costEntry } : {}),
      receipt: {
        intakeId: payload.intakeId,
        lotId: payload.lotId,
        netWeightKg,
        estimatedVolumeL,
        ...(input.harvestRecordId ? { harvestRecordId: input.harvestRecordId } : {}),
        ...(input.destinationVesselId ? { destinationVesselId: input.destinationVesselId } : {}),
        costPosted: costEntry?.amount || 0,
      },
    },
  };
}
