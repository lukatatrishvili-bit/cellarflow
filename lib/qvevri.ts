import type { Vessel, WineLot, CellarOperation, DailyFermLog } from './wineryState';

export interface QvevriPassportInput {
  vessel: Vessel;
  lot?: WineLot;
  operations?: CellarOperation[];
  fermentationLogs?: DailyFermLog[];
}

export interface QvevriDurationSummary {
  skinContactDays: number | null;
  daysToFirstRacking: number | null;
  sealedDays: number | null;
}

export interface QvevriPassportReadiness {
  score: number;
  status: 'ready' | 'needs_review' | 'missing_critical';
  missing: string[];
  requirements: Array<{ key: string; label: string; complete: boolean }>;
}

const dayMs = 24 * 60 * 60 * 1000;

function daysBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const start = new Date(from.slice(0, 10)).getTime();
  const end = new Date(to.slice(0, 10)).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / dayMs);
}

export function calculateQvevriDurations(vessel: Vessel): QvevriDurationSummary {
  return {
    skinContactDays: vessel.skinContactDurationDays ?? daysBetween(vessel.fillingDate, vessel.openingDate),
    daysToFirstRacking: daysBetween(vessel.fillingDate, vessel.firstRackingDate),
    sealedDays: daysBetween(vessel.sealingDate || vessel.lastSealedDate, vessel.openingDate),
  };
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null && value !== '';
}

export function evaluateQvevriPassport(vessel: Vessel, lot?: WineLot): QvevriPassportReadiness {
  const requirements = [
    { key: 'qvevriNumber', label: 'Qvevri number', complete: hasValue(vessel.qvevriNumber || vessel.id) },
    { key: 'maraniLocation', label: 'Marani location', complete: hasValue(vessel.maraniLocation || vessel.locationDetails) },
    { key: 'capacity', label: 'Capacity', complete: vessel.capacity > 0 },
    { key: 'lastWashingDate', label: 'Last washing date', complete: hasValue(vessel.lastWashingDate || vessel.lastCleaned) },
    { key: 'limeWashStatus', label: 'Lime wash status', complete: vessel.limeWashStatus === 'done' },
    { key: 'waxingStatus', label: 'Waxing status', complete: vessel.waxingStatus === 'done' },
    { key: 'inspectionNotes', label: 'Inspection notes', complete: hasValue(vessel.inspectionNotes) },
    { key: 'fillingDate', label: 'Filling date', complete: hasValue(vessel.fillingDate || lot?.createdAt) },
    { key: 'grapeVariety', label: 'Grape variety', complete: hasValue(vessel.grapeVariety || lot?.variety) },
    { key: 'sealingDate', label: 'Sealing date', complete: hasValue(vessel.sealingDate || vessel.lastSealedDate) },
    { key: 'soilTemperature', label: 'Soil temperature', complete: Number.isFinite(vessel.soilTemperature) },
  ];
  const completeCount = requirements.filter(item => item.complete).length;
  const score = Math.round((completeCount / requirements.length) * 100);
  const missing = requirements.filter(item => !item.complete).map(item => item.label);
  return {
    score,
    status: score >= 90 ? 'ready' : score >= 65 ? 'needs_review' : 'missing_critical',
    missing,
    requirements,
  };
}

export function buildQvevriPassportSummary(input: QvevriPassportInput) {
  const { vessel, lot, operations = [], fermentationLogs = [] } = input;
  const durations = calculateQvevriDurations(vessel);
  const sanitationCount = (vessel.sanitationHistory || []).length +
    operations.filter(op => op.type === 'cleaning' && op.vesselId === vessel.id).length;
  return {
    vesselId: vessel.id,
    qvevriNumber: vessel.qvevriNumber || vessel.id,
    maraniLocation: vessel.maraniLocation || vessel.locationDetails || '',
    lotId: lot?.id || vessel.assignedLotId || null,
    variety: vessel.grapeVariety || lot?.variety || '',
    capacity: vessel.capacity,
    currentVolume: vessel.currentVolume,
    buried: vessel.buried ?? vessel.type === 'qvevri',
    limeWashStatus: vessel.limeWashStatus || 'unknown',
    waxingStatus: vessel.waxingStatus || 'unknown',
    inspectionNotes: vessel.inspectionNotes || '',
    soilTemperature: vessel.soilTemperature ?? null,
    durations,
    sanitationCount,
    fermentationLogCount: fermentationLogs.filter(log => log.tankId === vessel.id || (lot && log.lotId === lot.id)).length,
  };
}
