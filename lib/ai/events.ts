import type { WineryIntelligenceSnapshot } from './snapshot';
import { daysBetween } from './snapshot';
import type { AiEntityRef, AiEntityType, AiEvent, AiEventType, AiMonitoringArea, AiSeverity } from './types';

/**
 * The event engine. Everything the layer reacts to becomes a normalized
 * `AiEvent`, whether it was derived by diffing two state snapshots on the
 * client or emitted directly by a command handler on the server.
 *
 * Events are deliberately cheap and lossy: they say *what changed*, not what it
 * means. Meaning is the rule engine's job, and only what survives triage ever
 * reaches a model.
 */

let sequence = 0;

export interface MakeEventInput {
  eventType: AiEventType;
  entityType: AiEntityType;
  entityId: string;
  entityLabel?: string;
  area: AiMonitoringArea;
  severityHint?: AiSeverity;
  timestamp?: string;
  previousValue?: string | number | null;
  newValue?: string | number | null;
  userId?: string;
  relatedEntities?: AiEntityRef[];
  metadata?: Record<string, string | number | boolean | null>;
}

export function makeEvent(input: MakeEventInput): AiEvent {
  sequence += 1;
  const timestamp = input.timestamp || new Date().toISOString();
  return {
    id: `evt-${timestamp.replace(/[^0-9]/g, '').slice(0, 14)}-${sequence.toString(36)}`,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    entityLabel: input.entityLabel,
    timestamp,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.userId,
    relatedEntities: input.relatedEntities || [],
    severityHint: input.severityHint || 'info',
    area: input.area,
    metadata: input.metadata,
  };
}

interface Identified {
  id: string;
}

interface CollectionDiff<T> {
  added: T[];
  changed: Array<{ before: T; after: T }>;
}

function diffById<T extends Identified>(before: T[], after: T[]): CollectionDiff<T> {
  const beforeById = new Map(before.map((row) => [row.id, row]));
  const added: T[] = [];
  const changed: Array<{ before: T; after: T }> = [];
  for (const row of after) {
    const previous = beforeById.get(row.id);
    if (!previous) added.push(row);
    else if (previous !== row) changed.push({ before: previous, after: row });
  }
  return { added, changed };
}

/** Meaningful movement thresholds — below these, a change is measurement noise. */
const TEMPERATURE_DELTA_C = 2;
const PH_DELTA = 0.1;
const VA_DELTA_GL = 0.1;

/**
 * Derives events from two consecutive snapshots of the same winery. The caller
 * owns snapshot cadence; this function is pure and produces the same events for
 * the same pair every time.
 */
export function deriveEvents(
  before: WineryIntelligenceSnapshot,
  after: WineryIntelligenceSnapshot,
): AiEvent[] {
  const events: AiEvent[] = [];
  const lotLabelOf = (id: string) => after.lots.find((l) => l.id === id)?.name || id;

  // --- Fermentation readings ------------------------------------------------
  const ferm = diffById(before.fermLogs, after.fermLogs);
  for (const log of ferm.added) {
    const related: AiEntityRef[] = [
      { type: 'lot', id: log.lotId, label: lotLabelOf(log.lotId) },
      ...(log.tankId ? [{ type: 'vessel' as const, id: log.tankId, label: log.tankId }] : []),
    ];
    events.push(makeEvent({
      eventType: log.isCompletion ? 'fermentation_completed' : 'fermentation_reading_added',
      entityType: 'lot',
      entityId: log.lotId,
      entityLabel: lotLabelOf(log.lotId),
      area: 'fermentation',
      timestamp: log.date,
      newValue: log.density,
      relatedEntities: related,
      metadata: { density: log.density, temperature: log.temperature, sugar: log.sugar },
    }));

    // A new reading is also a density observation for the same lot; the rule
    // engine decides whether the movement is a slowdown.
    const priorForLot = before.fermLogs
      .filter((row) => row.lotId === log.lotId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (priorForLot && Number.isFinite(priorForLot.density) && Number.isFinite(log.density)) {
      events.push(makeEvent({
        eventType: 'density_changed',
        entityType: 'lot',
        entityId: log.lotId,
        entityLabel: lotLabelOf(log.lotId),
        area: 'fermentation',
        timestamp: log.date,
        previousValue: priorForLot.density,
        newValue: log.density,
        relatedEntities: related,
      }));
    }
  }

  // --- Laboratory analyses --------------------------------------------------
  const labs = diffById(before.labLogs, after.labLogs);
  for (const lab of labs.added) {
    const related: AiEntityRef[] = [
      { type: 'lot', id: lab.lotId, label: lotLabelOf(lab.lotId) },
      ...(lab.tankId ? [{ type: 'vessel' as const, id: lab.tankId, label: lab.tankId }] : []),
    ];
    events.push(makeEvent({
      eventType: 'lab_analysis_added',
      entityType: 'lot',
      entityId: lab.lotId,
      entityLabel: lotLabelOf(lab.lotId),
      area: 'laboratory',
      timestamp: lab.date,
      relatedEntities: related,
      metadata: { freeSo2: lab.freeSo2, ph: lab.ph, volatileAcid: lab.volatileAcid },
    }));

    const previous = before.labLogs
      .filter((row) => row.lotId === lab.lotId)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (Number.isFinite(lab.freeSo2)) {
      events.push(makeEvent({
        eventType: 'so2_measured',
        entityType: 'lot',
        entityId: lab.lotId,
        entityLabel: lotLabelOf(lab.lotId),
        area: 'laboratory',
        timestamp: lab.date,
        previousValue: previous?.freeSo2 ?? null,
        newValue: lab.freeSo2,
        relatedEntities: related,
      }));
    }
    if (previous && Math.abs(lab.volatileAcid - previous.volatileAcid) >= VA_DELTA_GL) {
      events.push(makeEvent({
        eventType: 'volatile_acidity_changed',
        entityType: 'lot',
        entityId: lab.lotId,
        entityLabel: lotLabelOf(lab.lotId),
        area: 'laboratory',
        timestamp: lab.date,
        previousValue: previous.volatileAcid,
        newValue: lab.volatileAcid,
        severityHint: lab.volatileAcid > previous.volatileAcid ? 'attention' : 'info',
        relatedEntities: related,
      }));
    }
    if (previous && Math.abs(lab.ph - previous.ph) >= PH_DELTA) {
      events.push(makeEvent({
        eventType: 'ph_changed',
        entityType: 'lot',
        entityId: lab.lotId,
        entityLabel: lotLabelOf(lab.lotId),
        area: 'laboratory',
        timestamp: lab.date,
        previousValue: previous.ph,
        newValue: lab.ph,
        relatedEntities: related,
      }));
    }
  }

  // --- Vessels: temperature and fill ---------------------------------------
  for (const { before: was, after: now } of diffById(before.vessels, after.vessels).changed) {
    if (Number.isFinite(was.temperature) && Number.isFinite(now.temperature)
      && Math.abs(now.temperature - was.temperature) >= TEMPERATURE_DELTA_C) {
      events.push(makeEvent({
        eventType: 'temperature_changed',
        entityType: 'vessel',
        entityId: now.id,
        entityLabel: now.id,
        area: 'fermentation',
        previousValue: was.temperature,
        newValue: now.temperature,
        severityHint: 'attention',
        relatedEntities: now.assignedLotId
          ? [{ type: 'lot', id: now.assignedLotId, label: lotLabelOf(now.assignedLotId) }]
          : [],
      }));
    }
    if (was.currentVolume <= 0 && now.currentVolume > 0) {
      events.push(makeEvent({
        eventType: 'vessel_filled',
        entityType: 'vessel',
        entityId: now.id,
        entityLabel: now.id,
        area: 'operations',
        previousValue: was.currentVolume,
        newValue: now.currentVolume,
      }));
    } else if (was.currentVolume > 0 && now.currentVolume <= 0) {
      events.push(makeEvent({
        eventType: 'vessel_emptied',
        entityType: 'vessel',
        entityId: now.id,
        entityLabel: now.id,
        area: 'operations',
        previousValue: was.currentVolume,
        newValue: now.currentVolume,
      }));
    }
  }

  // --- Movements and treatments --------------------------------------------
  for (const transfer of diffById(before.transfers, after.transfers).added) {
    const blend = Boolean(transfer.destinationLotId && transfer.resultLotId
      && transfer.resultLotId !== transfer.sourceLotId);
    events.push(makeEvent({
      eventType: blend ? 'blend_created' : 'transfer_completed',
      entityType: 'transfer',
      entityId: transfer.id,
      entityLabel: `${transfer.sourceId} → ${transfer.destId}`,
      area: 'operations',
      timestamp: transfer.date,
      newValue: transfer.volume,
      relatedEntities: [
        { type: 'vessel', id: transfer.sourceId, label: transfer.sourceId },
        { type: 'vessel', id: transfer.destId, label: transfer.destId },
      ],
      metadata: { volume: transfer.volume, loss: transfer.loss },
    }));
  }

  for (const op of diffById(before.cellarOps, after.cellarOps).added) {
    events.push(makeEvent({
      eventType: 'treatment_applied',
      entityType: 'lot',
      entityId: op.lotId,
      entityLabel: op.lotName || lotLabelOf(op.lotId),
      area: 'operations',
      timestamp: op.date,
      newValue: op.type,
      relatedEntities: op.vesselId ? [{ type: 'vessel', id: op.vesselId, label: op.vesselId }] : [],
      metadata: { operationType: op.type },
    }));
  }

  for (const intake of diffById(before.grapeIntakes, after.grapeIntakes).added) {
    events.push(makeEvent({
      eventType: 'grape_intake_received',
      entityType: 'intake',
      entityId: intake.id,
      entityLabel: `${intake.variety} · ${intake.netWeightKg} kg`,
      area: 'operations',
      timestamp: intake.date,
      newValue: intake.netWeightKg,
      relatedEntities: intake.createdLotId
        ? [{ type: 'lot', id: intake.createdLotId, label: lotLabelOf(intake.createdLotId) }]
        : [],
      metadata: { brix: intake.brix, ph: intake.ph, variety: intake.variety },
    }));
  }

  // --- Inventory ------------------------------------------------------------
  for (const { before: was, after: now } of diffById(before.inventory, after.inventory).changed) {
    if (was.stock === now.stock) continue;
    const crossedThreshold = was.stock > now.minThreshold && now.stock <= now.minThreshold;
    events.push(makeEvent({
      eventType: crossedThreshold ? 'stock_low' : 'inventory_level_changed',
      entityType: 'inventory_item',
      entityId: now.id,
      entityLabel: now.name,
      area: 'inventory',
      previousValue: was.stock,
      newValue: now.stock,
      severityHint: crossedThreshold ? 'attention' : 'info',
      metadata: { unit: now.unit, minThreshold: now.minThreshold },
    }));
  }

  // --- Vineyard -------------------------------------------------------------
  for (const scouting of diffById(before.scoutings, after.scoutings).added) {
    events.push(makeEvent({
      eventType: 'vineyard_observation_added',
      entityType: 'block',
      entityId: scouting.blockId,
      entityLabel: after.blocks.find((b) => b.id === scouting.blockId)?.name || scouting.blockId,
      area: 'vineyard',
      timestamp: scouting.date,
      newValue: scouting.problemType,
      severityHint: scouting.severity === 'high' ? 'warning' : scouting.severity === 'medium' ? 'attention' : 'info',
      metadata: { problemType: scouting.problemType, severity: scouting.severity },
    }));
  }

  // --- Tasks ----------------------------------------------------------------
  for (const { before: was, after: now } of diffById(before.tasks, after.tasks).changed) {
    if (was.status !== 'completed' && now.status === 'completed') {
      events.push(makeEvent({
        eventType: 'task_completed',
        entityType: 'task',
        entityId: now.id,
        entityLabel: now.title,
        area: 'operations',
        previousValue: was.status,
        newValue: now.status,
      }));
    }
  }

  return events;
}

/**
 * Time-based events that no state diff can produce: a task does not change when
 * its due date passes, but the winery's situation does. Called by the scheduled
 * monitoring pass.
 */
export function deriveScheduledEvents(snapshot: WineryIntelligenceSnapshot): AiEvent[] {
  const events: AiEvent[] = [];

  for (const task of snapshot.tasks) {
    if (task.status !== 'pending' || !task.dueDate || task.dueDate >= snapshot.today) continue;
    const overdueDays = daysBetween(task.dueDate, snapshot.today);
    events.push(makeEvent({
      eventType: 'task_overdue',
      entityType: 'task',
      entityId: task.id,
      entityLabel: task.title,
      area: 'operations',
      timestamp: `${snapshot.today}T00:00:00.000Z`,
      newValue: overdueDays,
      severityHint: task.priority === 'high' || overdueDays > 7 ? 'warning' : 'attention',
      metadata: { dueDate: task.dueDate, priority: task.priority },
    }));
  }

  for (const block of snapshot.blocks) {
    if (!block.estimatedHarvestDate) continue;
    const away = daysBetween(snapshot.today, block.estimatedHarvestDate);
    if (away < 0 || away > 21) continue;
    events.push(makeEvent({
      eventType: 'harvest_window_approaching',
      entityType: 'block',
      entityId: block.id,
      entityLabel: block.name,
      area: 'vineyard',
      timestamp: `${snapshot.today}T00:00:00.000Z`,
      newValue: away,
      severityHint: away <= 7 ? 'warning' : 'attention',
      metadata: { estimatedHarvestDate: block.estimatedHarvestDate, variety: block.grapeVariety },
    }));
  }

  return events;
}
