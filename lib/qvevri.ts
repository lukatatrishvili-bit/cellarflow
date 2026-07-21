import type { Vessel, WineLot, CellarOperation, DailyFermLog } from './wineryState';
import { isPhysicalFermentationReading } from './fermentationIntegrity';

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
  /** Georgian label list for the same missing items, index-aligned with `missing`. */
  missingKa: string[];
  requirements: Array<{ key: string; label: string; labelKa: string; complete: boolean }>;
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
    { key: 'qvevriNumber', label: 'Qvevri number', labelKa: 'ქვევრის ნომერი', complete: hasValue(vessel.qvevriNumber || vessel.id) },
    { key: 'maraniLocation', label: 'Marani location', labelKa: 'მარანი / ადგილი', complete: hasValue(vessel.maraniLocation || vessel.locationDetails) },
    { key: 'capacity', label: 'Capacity', labelKa: 'ტევადობა', complete: vessel.capacity > 0 },
    { key: 'lastWashingDate', label: 'Last washing date', labelKa: 'ბოლო რეცხვის თარიღი', complete: hasValue(vessel.lastWashingDate || vessel.lastCleaned) },
    { key: 'limeWashStatus', label: 'Lime wash status', labelKa: 'კირით დამუშავება', complete: vessel.limeWashStatus === 'done' },
    { key: 'waxingStatus', label: 'Waxing status', labelKa: 'ცვილის სტატუსი', complete: vessel.waxingStatus === 'done' },
    { key: 'inspectionNotes', label: 'Inspection notes', labelKa: 'ინსპექციის შენიშვნები', complete: hasValue(vessel.inspectionNotes) },
    { key: 'fillingDate', label: 'Filling date', labelKa: 'შევსების თარიღი', complete: hasValue(vessel.fillingDate || lot?.createdAt) },
    { key: 'grapeVariety', label: 'Grape variety', labelKa: 'ყურძნის ჯიში', complete: hasValue(vessel.grapeVariety || lot?.variety) },
    { key: 'sealingDate', label: 'Sealing date', labelKa: 'დალუქვის თარიღი', complete: hasValue(vessel.sealingDate || vessel.lastSealedDate) },
    { key: 'soilTemperature', label: 'Soil temperature', labelKa: 'ნიადაგის ტემპერატურა', complete: Number.isFinite(vessel.soilTemperature) },
  ];
  const completeCount = requirements.filter(item => item.complete).length;
  const score = Math.round((completeCount / requirements.length) * 100);
  const incomplete = requirements.filter(item => !item.complete);
  return {
    score,
    status: score >= 90 ? 'ready' : score >= 65 ? 'needs_review' : 'missing_critical',
    missing: incomplete.map(item => item.label),
    missingKa: incomplete.map(item => item.labelKa),
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
    fermentationLogCount: fermentationLogs.filter(log => (
      isPhysicalFermentationReading(log)
      && (log.tankId === vessel.id || (lot && log.lotId === lot.id))
    )).length,
  };
}
