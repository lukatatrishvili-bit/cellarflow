/**
 * Shared geometry for the winery plan.
 *
 * The plan draws one WebGL room and looks at it two ways: a near-orthographic
 * camera straight overhead (the "top-down" plan) and an orbiting perspective
 * camera (the "3D" walkthrough). Both views therefore need the same physical
 * truth about a vessel — its silhouette, its cavity, and where the wine surface
 * actually sits inside it — so all of that lives here as plain functions that
 * can be reasoned about and tested without a GPU.
 *
 * Profiles are lathe profiles: `y` runs along the vessel's own axis from its
 * base (0) to its far end (1 in unit form, metres once scaled) and `r` is the
 * radius at that station. A vertical tank spins its profile around world Y; a
 * barrel spins the same structure around world X.
 */
import type { CellarFloor, Vessel, VesselPlanModel } from './wineryState';
import { vesselPlan3dSettings, vesselPlanWorldPosition, type VesselPlan3dSettings } from './wineryPlan3d';

export interface ProfilePoint { r: number; y: number }

export type VesselForm = 'lathe' | 'box';
export type VesselMaterialKind = 'steel' | 'wood' | 'clay' | 'concrete' | 'plastic';

export interface VesselShellSpec {
  form: VesselForm;
  /** World axis the lathe profile is spun around. */
  axis: 'vertical' | 'horizontal';
  material: VesselMaterialKind;
  /** Outer silhouette in metres, measured from the base of the vessel body. */
  outer: ProfilePoint[];
  /** Wetted cavity in metres — where wine can actually stand. */
  cavity: ProfilePoint[];
  /** Length of the vessel along its own axis, in metres. */
  axisLength: number;
  /** Half-width of the cross section perpendicular to the axis, in metres. */
  crossRadiusA: number;
  crossRadiusB: number;
  openTop: boolean;
  jacketed: boolean;
  legs: boolean;
  sightGlass: boolean;
  buried: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/* ------------------------------------------------------------------ colour */

const WINE_CLASS_HEX: Record<string, number> = {
  red: 0x6d1226,
  white: 0xd9bd5c,
  amber: 0xc07520,
  rose: 0xd96f8c,
  sparkling: 0xdcc884,
  qvevri: 0xb3652a,
  fortified: 0x6b2716,
  base_wine: 0x9a8a58,
};

export function wineColorHex(wineClass: string | undefined): number {
  return WINE_CLASS_HEX[wineClass || ''] ?? WINE_CLASS_HEX.red;
}

const MATERIAL_BY_MODEL: Record<VesselPlanModel, VesselMaterialKind> = {
  closed_top_jacket: 'steel',
  closed_top: 'steel',
  open_top_jacket: 'steel',
  open_top: 'steel',
  portable: 'plastic',
  insulated: 'steel',
  horizontal_tank: 'steel',
  barrel: 'wood',
  qvevri: 'clay',
  concrete: 'concrete',
  plastic: 'plastic',
};

export function vesselMaterialKind(model: VesselPlanModel): VesselMaterialKind {
  return MATERIAL_BY_MODEL[model] || 'steel';
}

/* ---------------------------------------------------------------- profiles */

/** Straight-sided body with a dished bottom and a domed, closed top. */
const CLOSED_TOP: ProfilePoint[] = [
  { y: 0, r: 0 }, { y: 0.012, r: 0.38 }, { y: 0.03, r: 0.63 }, { y: 0.055, r: 0.83 },
  { y: 0.086, r: 0.945 }, { y: 0.12, r: 1 },
  { y: 0.88, r: 1 }, { y: 0.93, r: 0.98 }, { y: 0.965, r: 0.9 }, { y: 0.988, r: 0.72 },
  { y: 0.998, r: 0.42 }, { y: 1, r: 0 },
];

/** Same body, but the shell simply stops at the rim. */
const OPEN_TOP: ProfilePoint[] = [
  { y: 0, r: 0 }, { y: 0.012, r: 0.38 }, { y: 0.03, r: 0.63 }, { y: 0.055, r: 0.83 },
  { y: 0.086, r: 0.945 }, { y: 0.12, r: 1 }, { y: 1, r: 1 },
];

/** Clad tank: the insulation squares the shoulders off. */
const INSULATED: ProfilePoint[] = [
  { y: 0, r: 0 }, { y: 0.008, r: 0.55 }, { y: 0.022, r: 0.86 }, { y: 0.048, r: 0.975 },
  { y: 0.072, r: 1 }, { y: 0.93, r: 1 }, { y: 0.955, r: 0.975 }, { y: 0.98, r: 0.86 },
  { y: 0.995, r: 0.5 }, { y: 1, r: 0 },
];

const PLASTIC: ProfilePoint[] = [
  { y: 0, r: 0 }, { y: 0.014, r: 0.52 }, { y: 0.038, r: 0.8 }, { y: 0.075, r: 0.96 },
  { y: 0.115, r: 1 }, { y: 0.855, r: 1 }, { y: 0.915, r: 0.965 }, { y: 0.962, r: 0.85 },
  { y: 0.99, r: 0.55 }, { y: 1, r: 0 },
];

/** Horizontal tank lying on its side: dished heads at both ends. */
const HORIZONTAL_TANK: ProfilePoint[] = [
  { y: 0, r: 0 }, { y: 0.008, r: 0.44 }, { y: 0.02, r: 0.72 }, { y: 0.04, r: 0.91 },
  { y: 0.066, r: 1 }, { y: 0.934, r: 1 }, { y: 0.96, r: 0.91 }, { y: 0.98, r: 0.72 },
  { y: 0.992, r: 0.44 }, { y: 1, r: 0 },
];

/** Barrel: flat heads joined by a bulging bilge. */
function barrelProfile(): ProfilePoint[] {
  const bilge: ProfilePoint[] = [];
  for (let step = 0; step <= 14; step += 1) {
    const t = 0.014 + (step / 14) * 0.972;
    bilge.push({ y: t, r: 0.79 + 0.21 * Math.sin(Math.PI * t) });
  }
  return [
    { y: 0, r: 0 }, { y: 0.004, r: 0.66 }, { y: 0.012, r: 0.79 },
    ...bilge,
    { y: 0.988, r: 0.79 }, { y: 0.996, r: 0.66 }, { y: 1, r: 0 },
  ];
}

/** Qvevri: an ovoid that tapers to a point at the bottom and a small mouth. */
const QVEVRI: ProfilePoint[] = [
  { y: 0, r: 0 }, { y: 0.02, r: 0.17 }, { y: 0.055, r: 0.33 }, { y: 0.11, r: 0.51 },
  { y: 0.19, r: 0.69 }, { y: 0.29, r: 0.85 }, { y: 0.4, r: 0.955 }, { y: 0.5, r: 1 },
  { y: 0.6, r: 0.985 }, { y: 0.7, r: 0.91 }, { y: 0.79, r: 0.775 }, { y: 0.87, r: 0.59 },
  { y: 0.93, r: 0.41 }, { y: 0.975, r: 0.27 }, { y: 1, r: 0.21 },
];

const UNIT_PROFILES: Record<VesselPlanModel, ProfilePoint[]> = {
  closed_top: CLOSED_TOP,
  closed_top_jacket: CLOSED_TOP,
  open_top: OPEN_TOP,
  open_top_jacket: OPEN_TOP,
  insulated: INSULATED,
  plastic: PLASTIC,
  horizontal_tank: HORIZONTAL_TANK,
  barrel: barrelProfile(),
  qvevri: QVEVRI,
  // Boxes never spin a lathe; a straight cylinder keeps the record total.
  portable: [{ y: 0, r: 1 }, { y: 1, r: 1 }],
  concrete: [{ y: 0, r: 1 }, { y: 1, r: 1 }],
};

export function unitProfile(model: VesselPlanModel): ProfilePoint[] {
  return UNIT_PROFILES[model] || CLOSED_TOP;
}

export function scaleProfile(profile: ProfilePoint[], axisLength: number, radius: number): ProfilePoint[] {
  return profile.map(point => ({ y: point.y * axisLength, r: point.r * radius }));
}

/**
 * Insets a metric profile by a wall thickness to get the cavity the wine sits
 * in. The offset runs inwards from both ends of the axis unless the vessel is
 * open, in which case the cavity reaches the rim.
 */
export function insetProfile(profile: ProfilePoint[], wall: number, openEnd: boolean): ProfilePoint[] {
  if (profile.length < 2) return profile;
  const axisLength = profile[profile.length - 1].y;
  const half = axisLength / 2;
  const top = openEnd ? axisLength : axisLength - wall;
  const inset = profile.map(point => ({
    r: Math.max(0, point.r - wall),
    y: clamp(point.y < half ? point.y + wall : point.y - (openEnd ? 0 : wall), Math.min(wall, top), top),
  }));
  // Insetting can fold neighbouring stations onto each other; keep the profile
  // strictly ascending so the lathe and the volume integral stay well defined.
  const cleaned: ProfilePoint[] = [];
  inset.forEach(point => {
    const previous = cleaned[cleaned.length - 1];
    if (!previous) { cleaned.push({ ...point }); return; }
    if (point.y <= previous.y) { previous.r = Math.max(previous.r, point.r); return; }
    cleaned.push({ ...point });
  });
  return cleaned.length >= 2 ? cleaned : profile;
}

/* ------------------------------------------------------------------ volumes */

/** Volume of one truncated cone slice, in cubic metres. */
function sliceVolume(r0: number, r1: number, height: number): number {
  return (Math.PI / 3) * height * (r0 * r0 + r0 * r1 + r1 * r1);
}

function radiusAt(profile: ProfilePoint[], y: number): number {
  if (profile.length === 0) return 0;
  if (y <= profile[0].y) return profile[0].r;
  const last = profile[profile.length - 1];
  if (y >= last.y) return last.r;
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    if (y > current.y) continue;
    const span = current.y - previous.y;
    const t = span > 0 ? (y - previous.y) / span : 0;
    return previous.r + (current.r - previous.r) * t;
  }
  return last.r;
}

/** Volume of the solid of revolution up to `yMax`, in cubic metres. */
export function profileVolume(profile: ProfilePoint[], yMax = Number.POSITIVE_INFINITY): number {
  let total = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    if (yMax <= previous.y) break;
    const cut = Math.min(current.y, yMax);
    const span = current.y - previous.y;
    if (span <= 0) continue;
    const t = (cut - previous.y) / span;
    total += sliceVolume(previous.r, previous.r + (current.r - previous.r) * t, cut - previous.y);
  }
  return total;
}

/**
 * Height of the wine surface inside an upright vessel, in metres from the base
 * of the profile. The level is found by inverting the volume integral, not by
 * scaling the height: a dished or coned bottom holds less than its share, so a
 * tank at 10% of capacity stands visibly higher than a tenth of the way up,
 * and the neck of a qvevri exaggerates the same effect at the top.
 */
export function profileFillHeight(profile: ProfilePoint[], ratio: number): number {
  const bounded = clamp(ratio, 0, 1);
  if (profile.length < 2) return 0;
  const base = profile[0].y;
  const top = profile[profile.length - 1].y;
  if (bounded <= 0) return base;
  if (bounded >= 1) return top;
  const target = profileVolume(profile) * bounded;
  let low = base;
  let high = top;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (profileVolume(profile, middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Area of a disc of radius `r` lying below a chord `height` above its centre. */
export function circularSegmentArea(r: number, height: number): number {
  if (r <= 0) return 0;
  if (height <= -r) return 0;
  if (height >= r) return Math.PI * r * r;
  return r * r * Math.acos(-height / r) + height * Math.sqrt(Math.max(0, r * r - height * height));
}

function horizontalVolume(profile: ProfilePoint[], surface: number): number {
  let total = 0;
  for (let index = 1; index < profile.length; index += 1) {
    const previous = profile[index - 1];
    const current = profile[index];
    const span = current.y - previous.y;
    if (span <= 0) continue;
    total += circularSegmentArea((previous.r + current.r) / 2, surface) * span;
  }
  return total;
}

/**
 * Height of the wine surface in a vessel lying on its side, measured from the
 * axis centre (negative below it). A half-full barrel is filled to its axis,
 * not to half its height, and its surface narrows towards the heads.
 */
export function horizontalFillLevel(profile: ProfilePoint[], ratio: number): number {
  const bounded = clamp(ratio, 0, 1);
  const maxRadius = profile.reduce((largest, point) => Math.max(largest, point.r), 0);
  if (maxRadius <= 0) return 0;
  if (bounded <= 0) return -maxRadius;
  if (bounded >= 1) return maxRadius;
  const target = horizontalVolume(profile, maxRadius) * bounded;
  let low = -maxRadius;
  let high = maxRadius;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (horizontalVolume(profile, middle) < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export { radiusAt as profileRadiusAt };

/* ------------------------------------------------------------------ vessels */

export function vesselFillRatio(vessel: Pick<Vessel, 'capacity' | 'currentVolume'>): number {
  if (!(vessel.capacity > 0)) return 0;
  return clamp(vessel.currentVolume / vessel.capacity, 0, 1);
}

const BOX_MODELS = new Set<VesselPlanModel>(['portable', 'concrete']);
const HORIZONTAL_MODELS = new Set<VesselPlanModel>(['barrel', 'horizontal_tank']);
const OPEN_MODELS = new Set<VesselPlanModel>(['open_top', 'open_top_jacket', 'qvevri']);
const JACKETED_MODELS = new Set<VesselPlanModel>(['closed_top_jacket', 'open_top_jacket']);
const SIGHT_GLASS_MODELS = new Set<VesselPlanModel>(['closed_top', 'closed_top_jacket', 'insulated', 'plastic']);

/** Wall thickness used to derive the cavity, in metres. */
export function vesselWallThickness(settings: VesselPlan3dSettings): number {
  return clamp(0.02 * Math.min(settings.widthMeters, settings.depthMeters), 0.01, 0.06);
}

export function vesselShellSpec(vessel: Vessel, settings = vesselPlan3dSettings(vessel)): VesselShellSpec {
  const model = settings.model;
  const horizontal = HORIZONTAL_MODELS.has(model);
  const openTop = OPEN_MODELS.has(model);
  const wall = vesselWallThickness(settings);
  const axisLength = horizontal ? settings.widthMeters : settings.heightMeters;
  const crossRadiusA = (horizontal ? settings.depthMeters : settings.widthMeters) / 2;
  const crossRadiusB = (horizontal ? settings.heightMeters : settings.depthMeters) / 2;
  const outer = scaleProfile(unitProfile(model), axisLength, Math.max(crossRadiusA, crossRadiusB));
  return {
    form: BOX_MODELS.has(model) ? 'box' : 'lathe',
    axis: horizontal ? 'horizontal' : 'vertical',
    material: vesselMaterialKind(model),
    outer,
    cavity: insetProfile(outer, wall, openTop && !horizontal),
    axisLength,
    crossRadiusA,
    crossRadiusB,
    openTop,
    jacketed: JACKETED_MODELS.has(model),
    legs: !horizontal && settings.elevationMeters > 0.05 && model !== 'qvevri',
    sightGlass: SIGHT_GLASS_MODELS.has(model),
    buried: model === 'qvevri' && settings.elevationMeters < -0.05,
  };
}

/** Radius of the circle the vessel occupies on the floor, in metres. */
export function vesselFootprintRadius(settings: VesselPlan3dSettings): number {
  return Math.hypot(settings.widthMeters, settings.depthMeters) / 2;
}

/**
 * A stable fingerprint of everything that changes a vessel's meshes. Selection,
 * position, and fill level are animated in place, so only a change here is
 * worth rebuilding geometry for.
 */
export function vesselGeometrySignature(vessel: Vessel): string {
  const settings = vesselPlan3dSettings(vessel);
  return [
    settings.model,
    settings.widthMeters.toFixed(3),
    settings.depthMeters.toFixed(3),
    settings.heightMeters.toFixed(3),
    settings.elevationMeters.toFixed(3),
    vessel.assignedLotId || '',
  ].join('|');
}

/* ---------------------------------------------------------------- transfers */

/** Slack a real hose needs at both ends before it reaches a valve. */
export const HOSE_SLACK_METERS = 1.5;
/** Head the wine must clear before gravity can be relied on. */
const GRAVITY_MARGIN_METERS = 0.1;

/** Height of the wine surface above the floor, in metres. */
export function vesselLiquidSurfaceHeight(vessel: Vessel): number {
  const settings = vesselPlan3dSettings(vessel);
  const spec = vesselShellSpec(vessel, settings);
  const ratio = vesselFillRatio(vessel);
  if (ratio <= 0) return settings.elevationMeters;
  if (spec.form === 'box') return settings.elevationMeters + settings.heightMeters * ratio;
  if (spec.axis === 'horizontal') {
    const maxRadius = Math.max(spec.crossRadiusA, spec.crossRadiusB) || 1;
    const level = horizontalFillLevel(spec.cavity, ratio);
    // The profile is drawn at the larger cross radius, so a level measured on
    // it has to be scaled back onto the vessel's real height.
    return settings.elevationMeters + spec.crossRadiusB + level * (spec.crossRadiusB / maxRadius);
  }
  return settings.elevationMeters + profileFillHeight(spec.cavity, ratio);
}

/** Height wine has to be lifted to before it can enter this vessel. */
export function vesselInletHeight(vessel: Vessel): number {
  const settings = vesselPlan3dSettings(vessel);
  const spec = vesselShellSpec(vessel, settings);
  if (spec.form === 'box') return settings.elevationMeters + settings.heightMeters;
  if (spec.axis === 'horizontal') return settings.elevationMeters + spec.crossRadiusB * 2;
  return settings.elevationMeters + spec.axisLength;
}

/** Height of the racking valve the hose comes off. */
export function vesselOutletHeight(vessel: Vessel): number {
  return vesselPlan3dSettings(vessel).elevationMeters + 0.12;
}

export interface TransferRoute {
  sourceId: string;
  destinationId: string;
}

/** The shape of a transfer record this module needs to pick routes from. */
export interface TransferHistoryEntry {
  sourceId: string;
  destId: string;
  date: string;
  recordKind?: string;
}

/**
 * Picks the routes worth drawing as ghost hoses over the room: newest first,
 * one arc per pair, and only where both ends are on the floor being shown.
 * Reversals are skipped — a compensating ledger entry is not a journey wine
 * made — and a pair racked three times running leaves one ghost, not three
 * stacked on the same arc.
 */
export function recentTransferRoutes(
  transfers: readonly TransferHistoryEntry[],
  vesselIds: ReadonlySet<string>,
  limit = 6,
): TransferRoute[] {
  const seen = new Set<string>();
  return transfers
    .filter(entry => entry.recordKind !== 'reversal')
    .filter(entry => vesselIds.has(entry.sourceId) && vesselIds.has(entry.destId))
    .slice()
    .sort((left, right) => right.date.localeCompare(left.date))
    .filter(entry => {
      const route = `${entry.sourceId}>${entry.destId}`;
      if (seen.has(route)) return false;
      seen.add(route);
      return true;
    })
    .slice(0, limit)
    .map(entry => ({ sourceId: entry.sourceId, destinationId: entry.destId }));
}

export interface TransferRun {
  /** Metres of hose, floor-routed, including slack at both ends. */
  hoseMeters: number;
  /** True when the source's wine already stands above the destination inlet. */
  gravityFed: boolean;
  /** Metres the wine must be lifted; zero when gravity does the work. */
  liftMeters: number;
  /** Floor distance between the two vessels, in metres. */
  runMeters: number;
}

/**
 * What it takes to get wine from one vessel into another. Both facts come off
 * the same physical model the room is drawn from, so the readout and the hose
 * the plan draws cannot disagree.
 */
export function transferRun(
  source: Vessel,
  destination: Vessel,
  floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters'>,
): TransferRun {
  const from = vesselPlanWorldPosition(source, floor);
  const to = vesselPlanWorldPosition(destination, floor);
  const runMeters = Math.hypot(from.x - to.x, from.z - to.z);
  const lift = vesselInletHeight(destination) - vesselLiquidSurfaceHeight(source);
  return {
    runMeters,
    hoseMeters: runMeters + Math.abs(lift) + HOSE_SLACK_METERS,
    gravityFed: lift <= -GRAVITY_MARGIN_METERS,
    liftMeters: Math.max(0, lift),
  };
}

/* ------------------------------------------------------------------- layers */

/**
 * What the room is coloured by. Each layer answers one question the cellar
 * hand actually asks — what is in it, is it at temperature, is it fit to fill,
 * is anyone booked on it — and the answer has to be visible on the vessel
 * itself, not just in a legend.
 */
export type PlanLayer = 'contents' | 'temperature' | 'sanitation' | 'work';

export type LayerBand =
  | 'wine' | 'empty'
  | 'drift' | 'cold' | 'cool' | 'warm' | 'hot'
  | 'clean' | 'stale' | 'dirty'
  | 'idle' | 'scheduled' | 'active';

export interface VesselLayerSignal {
  band: LayerBand;
  tone: number;
  /** 0-1: how loudly this vessel should read on the active layer. */
  attention: number;
}

export interface LayerContext {
  wineClass?: string;
  /** Plans whose window covers today. */
  activeWork: number;
  /** Plans booked but not started. */
  scheduledWork: number;
  /** Whole days since the last recorded sanitation, or null when unknown. */
  daysSinceCleaned: number | null;
}

const BAND_TONE: Record<LayerBand, number> = {
  wine: 0x8a1c34,
  empty: 0x64748b,
  drift: 0xf43f5e,
  cold: 0x38bdf8,
  cool: 0x7dd3fc,
  warm: 0xfbbf24,
  hot: 0xfb7185,
  clean: 0x34d399,
  stale: 0xfacc15,
  dirty: 0xf59e0b,
  idle: 0x64748b,
  scheduled: 0x818cf8,
  active: 0xa78bfa,
};

/** Degrees away from a set point before the vessel is worth flagging. */
export const TEMPERATURE_DRIFT_C = 2;
/** An empty, clean vessel left standing this long wants re-sanitising. */
export const STALE_CLEAN_DAYS = 45;

export function bandTone(band: LayerBand): number {
  return BAND_TONE[band];
}

/** Whole days between two ISO dates, or null when either is unusable. */
export function daysSince(from: string | undefined, today: string): number | null {
  if (!from) return null;
  const start = Date.parse(from);
  const end = Date.parse(today);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.floor((end - start) / 86_400_000);
}

export function vesselLayerSignal(
  layer: PlanLayer,
  vessel: Vessel,
  context: LayerContext,
): VesselLayerSignal {
  const signal = (band: LayerBand, attention: number): VesselLayerSignal =>
    ({ band, tone: BAND_TONE[band], attention });

  if (layer === 'temperature') {
    const target = vessel.targetTemperature;
    // Drift beats the absolute band: a red ferment sitting at 26 °C is fine,
    // the same tank two degrees off its own set point is not.
    if (typeof target === 'number' && Math.abs(vessel.temperature - target) >= TEMPERATURE_DRIFT_C) {
      return signal('drift', 1);
    }
    // Cellar temperature is the normal case, so it washes the room quietly and
    // leaves the extremes room to shout.
    if (vessel.temperature < 10) return signal('cold', 0.45);
    if (vessel.temperature <= 17) return signal('cool', 0.22);
    if (vessel.temperature <= 24) return signal('warm', 0.4);
    return signal('hot', 0.85);
  }

  if (layer === 'sanitation') {
    if (vessel.cleaningStatus !== 'clean') return signal('dirty', 1);
    const standing = context.daysSinceCleaned;
    if (vessel.currentVolume <= 0 && standing !== null && standing > STALE_CLEAN_DAYS) {
      return signal('stale', 0.6);
    }
    return signal('clean', 0.15);
  }

  if (layer === 'work') {
    if (context.activeWork > 0) return signal('active', 1);
    if (context.scheduledWork > 0) return signal('scheduled', 0.6);
    return signal('idle', 0.08);
  }

  if (vessel.currentVolume > 0) {
    return { band: 'wine', tone: wineColorHex(context.wineClass), attention: 0.5 };
  }
  return signal('empty', 0.1);
}

/** Bands a layer can produce, quietest first, for building its legend. */
export function layerBands(layer: PlanLayer): LayerBand[] {
  if (layer === 'temperature') return ['cold', 'cool', 'warm', 'hot', 'drift'];
  if (layer === 'sanitation') return ['clean', 'stale', 'dirty'];
  if (layer === 'work') return ['idle', 'scheduled', 'active'];
  return ['wine', 'empty'];
}

/* -------------------------------------------------------------------- focus */

/**
 * The headline figures double as filters. Picking one spotlights the vessels
 * behind it and dims the rest, which turns the plan from a picture of the
 * cellar into a way of asking it questions.
 */
export type PlanFocus = 'occupied' | 'available' | 'lots' | 'work';

export function focusMatches(focus: PlanFocus, vessel: Vessel, context: LayerContext): boolean {
  if (focus === 'occupied') return vessel.currentVolume > 0;
  if (focus === 'available') return vessel.currentVolume <= 0 && vessel.cleaningStatus === 'clean';
  if (focus === 'lots') return Boolean(vessel.assignedLotId) && vessel.currentVolume > 0;
  return context.activeWork + context.scheduledWork > 0;
}

/* ------------------------------------------------------------------- camera */

export interface CameraPose {
  azimuth: number;
  polar: number;
  fov: number;
  /** World radius the camera frames vertically. */
  frameRadius: number;
  targetX: number;
  targetY: number;
  targetZ: number;
}

/**
 * The plan camera is a perspective camera with a very narrow field of view,
 * pulled far enough back to frame the same room. Convergence is what sells the
 * transition: at 8 degrees the vertical parallax across a 30 m cellar is under
 * a percent of the frame, so the room reads as a flat plan, and yet the camera
 * never stops being the same camera and can be tweened continuously.
 */
export const PLAN_FOV = 8;
export const ORBIT_FOV = 42;
export const PLAN_POLAR = 0.0015;
export const DEFAULT_ORBIT_POLAR = 1.02;
export const DEFAULT_ORBIT_AZIMUTH = -0.7;

export function floorFrameRadius(floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters'>): number {
  return Math.hypot(floor.widthMeters, floor.heightMeters) / 2;
}

/** Distance that frames a sphere of `frameRadius` at the given field of view. */
export function frameDistance(frameRadius: number, fov: number): number {
  return frameRadius / Math.sin((fov * Math.PI) / 360);
}

/**
 * Vertical world radius that frames the whole room. The camera frames a
 * vertical radius, so a wide viewport has to be asked for the room's width
 * divided by its aspect — otherwise a letterbox-shaped viewport crops the ends
 * of a long cellar.
 */
export function fitFrameRadius(
  floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters'>,
  aspect: number,
  margin = 1.14,
): number {
  const safeAspect = Math.max(0.4, aspect);
  return Math.max(
    (floor.heightMeters / 2) * margin,
    ((floor.widthMeters / 2) * margin) / safeAspect,
  );
}

export function planPose(
  floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters'>,
  zoom = 1,
  aspect = 1.6,
): CameraPose {
  return {
    azimuth: 0,
    polar: PLAN_POLAR,
    fov: PLAN_FOV,
    frameRadius: fitFrameRadius(floor, aspect) * clamp(zoom, 0.2, 5),
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  };
}

/**
 * Frame radius that holds the whole room when the camera looks at it from an
 * angle. An oblique view sees the floor turned and foreshortened, so fitting
 * its width head-on either strands the vessels in the distance or clips a
 * corner depending on the azimuth. Projecting the room's corners onto the
 * camera's own axes answers the question directly.
 */
export function orbitFrameRadius(
  floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters'>,
  azimuth: number,
  polar: number,
  aspect: number,
  ceilingMeters = 4.5,
  margin = 1.04,
): number {
  const sinPolar = Math.sin(polar);
  // The camera sits along this offset from its target (three's spherical
  // convention), so it looks back down the negated direction.
  const offset = [sinPolar * Math.sin(azimuth), Math.cos(polar), sinPolar * Math.cos(azimuth)];
  const length = Math.hypot(offset[0], offset[1], offset[2]) || 1;
  const forward = offset.map(value => -value / length);
  // right = normalise(forward x worldUp); up = right x forward.
  const rightRaw = [-forward[2], 0, forward[0]];
  const rightLength = Math.hypot(rightRaw[0], rightRaw[2]) || 1;
  const right = rightRaw.map(value => value / rightLength);
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const project = (corner: number[], axis: number[]) =>
    corner[0] * axis[0] + corner[1] * axis[1] + corner[2] * axis[2];

  let maxRight = 0;
  let maxUp = 0;
  [-1, 1].forEach(signX => [-1, 1].forEach(signZ => [0, ceilingMeters].forEach(y => {
    const corner = [(signX * floor.widthMeters) / 2, y, (signZ * floor.heightMeters) / 2];
    maxRight = Math.max(maxRight, Math.abs(project(corner, right)));
    maxUp = Math.max(maxUp, Math.abs(project(corner, up)));
  })));
  return Math.max(maxUp, maxRight / Math.max(0.4, aspect)) * margin;
}

export function orbitPose(
  floor: Pick<CellarFloor, 'widthMeters' | 'heightMeters'>,
  saved?: Partial<Pick<CameraPose, 'azimuth' | 'polar' | 'targetX' | 'targetZ'>>,
  zoom = 1,
  aspect = 1.6,
): CameraPose {
  const azimuth = saved?.azimuth ?? DEFAULT_ORBIT_AZIMUTH;
  const polar = saved?.polar ?? DEFAULT_ORBIT_POLAR;
  return {
    azimuth,
    polar,
    fov: ORBIT_FOV,
    frameRadius: orbitFrameRadius(floor, azimuth, polar, aspect) * clamp(zoom, 0.2, 5),
    targetX: saved?.targetX ?? 0,
    targetY: 1.1,
    targetZ: saved?.targetZ ?? 0,
  };
}

export function easeInOutCubic(t: number): number {
  const bounded = clamp(t, 0, 1);
  return bounded < 0.5 ? 4 * bounded ** 3 : 1 - ((-2 * bounded + 2) ** 3) / 2;
}

/** Interpolates two angles the short way round, so the room never spins. */
export function lerpAngle(from: number, to: number, t: number): number {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return from + delta * t;
}

export function blendPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    azimuth: lerpAngle(from.azimuth, to.azimuth, t),
    polar: lerp(from.polar, to.polar),
    fov: lerp(from.fov, to.fov),
    // Framing is interpolated in log space; a linear ramp between an 8 degree
    // and a 42 degree pose lurches, because distance goes as 1/sin(fov/2).
    frameRadius: Math.exp(lerp(Math.log(from.frameRadius), Math.log(to.frameRadius))),
    targetX: lerp(from.targetX, to.targetX),
    targetY: lerp(from.targetY, to.targetY),
    targetZ: lerp(from.targetZ, to.targetZ),
  };
}
