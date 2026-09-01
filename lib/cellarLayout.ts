import type {
  CellarFloor, CellarPlanObject, CellarPlanObjectKind, CellarZoneUse, Vessel,
} from './wineryState';

export const DEFAULT_CELLAR_FLOOR_ID = 'cellar-floor-main';

export const defaultCellarFloor = (): CellarFloor => ({
  id: DEFAULT_CELLAR_FLOOR_ID,
  name: 'Main cellar',
  level: 0,
  widthMeters: 30,
  heightMeters: 18,
  gridMeters: 1,
});

const finitePositive = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const PLAN_OBJECT_KINDS = new Set<CellarPlanObjectKind>(['zone', 'door', 'drain', 'water', 'power', 'pump', 'press']);
const ZONE_USES = new Set<CellarZoneUse>(['general', 'receiving', 'fermentation', 'aging', 'bottling', 'laboratory', 'storage', 'utility']);
const rightAngle = (value: unknown): 0 | 90 | 180 | 270 => {
  const normalized = ((Math.round(Number(value) / 90) * 90) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
};

export function normalizeCellarPlanObjects(
  value: CellarPlanObject[] | undefined,
  floor: Pick<CellarFloor, 'id' | 'widthMeters' | 'heightMeters'>,
): CellarPlanObject[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.slice(0, 250).flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || !PLAN_OBJECT_KINDS.has(raw.kind)) return [];
    const requestedId = String(raw.id || `${floor.id}-object-${index + 1}`).trim() || `${floor.id}-object-${index + 1}`;
    let id = requestedId;
    let suffix = 2;
    while (used.has(id)) id = `${requestedId}-${suffix++}`;
    used.add(id);
    const kind = raw.kind;
    const rotation = rightAngle(raw.rotation);
    const widthLimit = rotation === 90 || rotation === 270 ? floor.heightMeters : floor.widthMeters;
    const heightLimit = rotation === 90 || rotation === 270 ? floor.widthMeters : floor.heightMeters;
    const widthMeters = Math.max(0.25, Math.min(widthLimit, finitePositive(raw.widthMeters, kind === 'zone' ? 8 : 1)));
    const heightMeters = Math.max(0.25, Math.min(heightLimit, finitePositive(raw.heightMeters, kind === 'zone' ? 5 : 1)));
    const footprintWidth = rotation === 90 || rotation === 270 ? heightMeters : widthMeters;
    const footprintHeight = rotation === 90 || rotation === 270 ? widthMeters : heightMeters;
    const xMin = footprintWidth / 2;
    const yMin = footprintHeight / 2;
    const xMeters = Math.max(xMin, Math.min(floor.widthMeters - xMin, Number.isFinite(Number(raw.xMeters)) ? Number(raw.xMeters) : floor.widthMeters / 2));
    const yMeters = Math.max(yMin, Math.min(floor.heightMeters - yMin, Number.isFinite(Number(raw.yMeters)) ? Number(raw.yMeters) : floor.heightMeters / 2));
    const zoneUse = kind === 'zone' && ZONE_USES.has(raw.zoneUse || 'general') ? raw.zoneUse || 'general' : undefined;
    return [{
      id,
      kind,
      label: String(raw.label || (kind === 'zone' ? 'Work area' : kind)).trim().slice(0, 80) || (kind === 'zone' ? 'Work area' : kind),
      xMeters,
      yMeters,
      widthMeters,
      heightMeters,
      rotation,
      ...(zoneUse ? { zoneUse } : {}),
    }];
  });
}

export function normalizeCellarFloors(value: CellarFloor[] | undefined): CellarFloor[] {
  const source = Array.isArray(value) && value.length > 0 ? value : [defaultCellarFloor()];
  const used = new Set<string>();
  return source.map((floor, index) => {
    const fallbackId = index === 0 ? DEFAULT_CELLAR_FLOOR_ID : `cellar-floor-${index + 1}`;
    const requestedId = String(floor?.id || fallbackId).trim() || fallbackId;
    let id = requestedId;
    let suffix = 2;
    while (used.has(id)) id = `${requestedId}-${suffix++}`;
    used.add(id);
    const gridMeters = finitePositive(floor?.gridMeters, 1);
    const normalizedFloor: CellarFloor = {
      id,
      name: String(floor?.name || `Floor ${index + 1}`).trim() || `Floor ${index + 1}`,
      level: Number.isFinite(Number(floor?.level)) ? Number(floor.level) : index,
      widthMeters: Math.max(5, Math.min(250, finitePositive(floor?.widthMeters, 30))),
      heightMeters: Math.max(5, Math.min(250, finitePositive(floor?.heightMeters, 18))),
      gridMeters: Math.max(0.25, Math.min(10, gridMeters)),
      ...(floor?.notes?.trim() ? { notes: floor.notes.trim() } : {}),
    };
    const planObjects = normalizeCellarPlanObjects(floor?.planObjects, normalizedFloor);
    return planObjects.length > 0 ? { ...normalizedFloor, planObjects } : normalizedFloor;
  }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

export function floorIdForVessel(vessel: Vessel, floors: CellarFloor[]): string {
  return floors.some(floor => floor.id === vessel.cellarFloorId)
    ? vessel.cellarFloorId!
    : primaryCellarFloorId(floors);
}

export function primaryCellarFloorId(floors: CellarFloor[]): string {
  return floors.find(floor => floor.id === DEFAULT_CELLAR_FLOOR_ID)?.id
    || floors.find(floor => floor.level === 0)?.id
    || floors[0]?.id
    || DEFAULT_CELLAR_FLOOR_ID;
}

export function vesselsOnFloor(vessels: Vessel[], floors: CellarFloor[], floorId: string): Vessel[] {
  return vessels.filter(vessel => floorIdForVessel(vessel, floors) === floorId);
}

export interface CellarPlanPosition { x: number; y: number }

const planCoordinateKey = (position: CellarPlanPosition) => `${Math.round(position.x)}:${Math.round(position.y)}`;
const clampPlanCoordinate = (value: number) => Math.max(3, Math.min(97, value));

export function automaticCellarPlanPositions(vessels: Vessel[]): Record<string, CellarPlanPosition> {
  const count = Math.max(1, vessels.length);
  const columns = Math.min(7, Math.max(2, Math.ceil(Math.sqrt(count * 1.6))));
  const rows = Math.max(1, Math.ceil(count / columns));
  return Object.fromEntries(vessels.map((vessel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return [vessel.id, {
      x: columns === 1 ? 50 : 9 + (column / (columns - 1)) * 82,
      y: rows === 1 ? 50 : 13 + (row / (rows - 1)) * 74,
    }];
  }));
}

export function deriveCellarPlanPositions(vessels: Vessel[]): Record<string, CellarPlanPosition> {
  const fallback = automaticCellarPlanPositions(vessels);
  const used = new Set<string>();
  const result: Record<string, CellarPlanPosition> = {};
  const pending: Vessel[] = [];
  vessels.forEach(vessel => {
    const x = Number(vessel.xGrid);
    const y = Number(vessel.yGrid);
    const candidate = { x: clampPlanCoordinate(x), y: clampPlanCoordinate(y) };
    const valid = Number.isFinite(x) && Number.isFinite(y) && !used.has(planCoordinateKey(candidate));
    if (!valid) pending.push(vessel);
    else {
      result[vessel.id] = candidate;
      used.add(planCoordinateKey(candidate));
    }
  });
  const free = Object.values(fallback).filter(position => !used.has(planCoordinateKey(position)));
  pending.forEach((vessel, index) => {
    const position = free[index] || {
      x: clampPlanCoordinate(10 + ((index * 17) % 80)),
      y: clampPlanCoordinate(14 + ((index * 23) % 72)),
    };
    result[vessel.id] = position;
    used.add(planCoordinateKey(position));
  });
  return result;
}

export function snapPlanPosition(
  position: { x: number; y: number },
  floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters' | 'gridMeters'>,
  enabled: boolean,
): { x: number; y: number } {
  const clamp = (value: number) => Math.max(3, Math.min(97, value));
  if (!enabled) return { x: clamp(position.x), y: clamp(position.y) };
  const xMeters = (position.x / 100) * floor.widthMeters;
  const yMeters = (position.y / 100) * floor.heightMeters;
  return {
    x: clamp((Math.round(xMeters / floor.gridMeters) * floor.gridMeters / floor.widthMeters) * 100),
    y: clamp((Math.round(yMeters / floor.gridMeters) * floor.gridMeters / floor.heightMeters) * 100),
  };
}
