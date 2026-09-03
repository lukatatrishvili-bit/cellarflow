import { describe, expect, it } from 'vitest';
import type { CellarFloor, Vessel } from '../lib/wineryState';
import {
  bandTone,
  blendPose,
  circularSegmentArea,
  daysSince,
  DEFAULT_ORBIT_AZIMUTH,
  DEFAULT_ORBIT_POLAR,
  fitFrameRadius,
  focusMatches,
  frameDistance,
  horizontalFillLevel,
  insetProfile,
  layerBands,
  lerpAngle,
  ORBIT_FOV,
  orbitFrameRadius,
  orbitPose,
  PLAN_FOV,
  planPose,
  profileFillHeight,
  profileVolume,
  recentTransferRoutes,
  scaleProfile,
  unitProfile,
  vesselFillRatio,
  transferRun,
  vesselGeometrySignature,
  vesselInletHeight,
  vesselLiquidSurfaceHeight,
  vesselLayerSignal,
  vesselShellSpec,
  wineColorHex,
  type LayerContext,
  type PlanLayer,
  type ProfilePoint,
} from '../lib/wineryScene';

const floor: CellarFloor = { id: 'ground', name: 'Ground', level: 0, widthMeters: 30, heightMeters: 18, gridMeters: 1 };

const vessel = (fields: Partial<Vessel> = {}): Vessel => ({
  id: 'T-1', type: 'stainless_steel', shape: 'vertical', capacity: 5_000,
  currentVolume: 4_000, assignedLotId: 'LOT-1', cleaningStatus: 'clean',
  lastCleaned: '2026-08-30', temperature: 18, coolingJacketActive: true,
  targetTemperature: 18, lastOperation: 'Filled', xGrid: 50, yGrid: 50,
  ...fields,
});

const cylinder = (radius: number, length: number): ProfilePoint[] => [
  { r: radius, y: 0 }, { r: radius, y: length },
];

describe('winery scene geometry', () => {
  it('measures the solid of revolution rather than the silhouette', () => {
    const straight = cylinder(1, 2);
    expect(profileVolume(straight)).toBeCloseTo(Math.PI * 2, 6);
    expect(profileVolume(straight, 1)).toBeCloseTo(Math.PI, 6);
    // A cone of radius 1 and height 3 is a third of its bounding cylinder.
    expect(profileVolume([{ r: 0, y: 0 }, { r: 1, y: 3 }])).toBeCloseTo(Math.PI, 6);
  });

  it('stands wine higher than a linear reading wherever the vessel tapers', () => {
    const straight = cylinder(1, 2);
    expect(profileFillHeight(straight, 0.5)).toBeCloseTo(1, 3);

    // Closed tanks have a dished bottom, so the first litres occupy a narrower
    // cross-section and the surface sits above the naive height fraction.
    const tank = scaleProfile(unitProfile('closed_top'), 4, 1);
    const level = profileFillHeight(tank, 0.1);
    expect(level).toBeGreaterThan(4 * 0.1);
    expect(level).toBeLessThan(4 * 0.25);

    // A qvevri runs the argument the other way: its neck is narrow, so the top
    // fifth of the height holds only about a tenth of the wine.
    const qvevri = scaleProfile(unitProfile('qvevri'), 2, 0.8);
    expect(profileFillHeight(qvevri, 0.9)).toBeLessThan(2 * 0.85);
    expect(profileFillHeight(qvevri, 0.9)).toBeGreaterThan(2 * 0.7);
  });

  it('keeps the fill height monotonic across the whole range', () => {
    const tank = scaleProfile(unitProfile('closed_top'), 3, 0.9);
    let previous = -1;
    for (let ratio = 0; ratio <= 1.0001; ratio += 0.05) {
      const level = profileFillHeight(tank, ratio);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
    expect(profileFillHeight(tank, 1)).toBeCloseTo(3, 6);
    expect(profileFillHeight(tank, 0)).toBeCloseTo(0, 6);
  });

  it('describes the wetted area of a vessel lying on its side', () => {
    expect(circularSegmentArea(1, -1)).toBeCloseTo(0, 6);
    expect(circularSegmentArea(1, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(circularSegmentArea(1, 1)).toBeCloseTo(Math.PI, 6);
  });

  it('fills a barrel to its axis at half capacity, not to half its height', () => {
    const barrel = cylinder(0.5, 1.2);
    expect(horizontalFillLevel(barrel, 0.5)).toBeCloseTo(0, 3);
    expect(horizontalFillLevel(barrel, 0)).toBeCloseTo(-0.5, 3);
    expect(horizontalFillLevel(barrel, 1)).toBeCloseTo(0.5, 3);
    // A quarter full sits below the axis, but well above the bottom.
    const quarter = horizontalFillLevel(barrel, 0.25);
    expect(quarter).toBeLessThan(0);
    expect(quarter).toBeGreaterThan(-0.35);
  });

  it('insets a cavity that stays inside the shell and strictly ascending', () => {
    const outer = scaleProfile(unitProfile('closed_top'), 3, 1);
    const cavity = insetProfile(outer, 0.05, false);
    expect(cavity.length).toBeGreaterThan(2);
    cavity.forEach((point, index) => {
      expect(point.r).toBeLessThanOrEqual(1);
      if (index > 0) expect(point.y).toBeGreaterThan(cavity[index - 1].y);
    });
    expect(cavity[cavity.length - 1].y).toBeLessThanOrEqual(3 - 0.05 + 1e-9);
    expect(profileVolume(cavity)).toBeLessThan(profileVolume(outer));
  });

  it('reads the physical model of a vessel from its plan settings', () => {
    const qvevri = vesselShellSpec(vessel({ type: 'qvevri', planModel: 'qvevri', planElevationMeters: -1.2 }));
    expect(qvevri.openTop).toBe(true);
    expect(qvevri.material).toBe('clay');
    expect(qvevri.buried).toBe(true);

    const barrel = vesselShellSpec(vessel({ planModel: 'barrel' }));
    expect(barrel.axis).toBe('horizontal');
    expect(barrel.material).toBe('wood');

    const jacketed = vesselShellSpec(vessel({ planModel: 'closed_top_jacket' }));
    expect(jacketed.jacketed).toBe(true);
    expect(jacketed.sightGlass).toBe(true);
    expect(jacketed.axis).toBe('vertical');
  });

  it('treats a change of volume as an animation, not a rebuild', () => {
    const empty = vessel({ currentVolume: 0 });
    const full = vessel({ currentVolume: 5_000 });
    expect(vesselGeometrySignature(empty)).toBe(vesselGeometrySignature(full));
    expect(vesselFillRatio(empty)).toBe(0);
    expect(vesselFillRatio(full)).toBe(1);
    expect(vesselFillRatio(vessel({ capacity: 0, currentVolume: 10 }))).toBe(0);

    const resized = vessel({ planWidthMeters: 3 });
    expect(vesselGeometrySignature(resized)).not.toBe(vesselGeometrySignature(empty));
  });

  it('gives every wine class a colour and falls back to red', () => {
    expect(wineColorHex('white')).not.toBe(wineColorHex('red'));
    expect(wineColorHex(undefined)).toBe(wineColorHex('red'));
    expect(wineColorHex('not-a-class')).toBe(wineColorHex('red'));
  });
});

describe('winery plan transfers', () => {
  const tank = (fields: Partial<Vessel> = {}) => vessel({
    planModel: 'closed_top', planWidthMeters: 2, planDepthMeters: 2,
    planHeightMeters: 3, planElevationMeters: 0.4, ...fields,
  });

  it('puts the wine surface where the vessel actually holds it', () => {
    const full = tank({ currentVolume: 5_000, capacity: 5_000 });
    const empty = tank({ currentVolume: 0 });
    // Empty means the floor of the cavity, which sits at the vessel's stand.
    expect(vesselLiquidSurfaceHeight(empty)).toBeCloseTo(0.4, 6);
    expect(vesselLiquidSurfaceHeight(full)).toBeGreaterThan(3);
    expect(vesselLiquidSurfaceHeight(full)).toBeLessThanOrEqual(3.4);
    // Half full stands above half height, because the bottom is dished.
    const half = tank({ currentVolume: 2_500, capacity: 5_000 });
    expect(vesselLiquidSurfaceHeight(half)).toBeGreaterThan(0.4 + 1.5);
  });

  it('measures a barrel on its side from its axis, not its base', () => {
    const barrel = vessel({
      planModel: 'barrel', planWidthMeters: 0.95, planDepthMeters: 0.72,
      planHeightMeters: 0.72, planElevationMeters: 0.4, capacity: 225, currentVolume: 112,
    });
    // Half full fills to the axis: 0.4 stand + 0.36 radius.
    expect(vesselLiquidSurfaceHeight(barrel)).toBeCloseTo(0.76, 1);
    expect(vesselInletHeight(barrel)).toBeCloseTo(0.4 + 0.72, 6);
  });

  it('works out whether gravity can do the transfer or the pump is needed', () => {
    const floorPlan = { widthMeters: 30, heightMeters: 18 };
    const high = tank({ id: 'HIGH', xGrid: 20, yGrid: 50, currentVolume: 5_000, capacity: 5_000, planElevationMeters: 3 });
    const low = tank({ id: 'LOW', xGrid: 60, yGrid: 50, currentVolume: 0, planElevationMeters: 0 });

    const downhill = transferRun(high, low, floorPlan);
    expect(downhill.gravityFed).toBe(true);
    expect(downhill.liftMeters).toBe(0);
    // 40% of a 30 m room is 12 m of floor, plus the drop and the slack.
    expect(downhill.runMeters).toBeCloseTo(12, 6);
    expect(downhill.hoseMeters).toBeGreaterThan(downhill.runMeters);

    const uphill = transferRun(low, high, floorPlan);
    expect(uphill.gravityFed).toBe(false);
    expect(uphill.liftMeters).toBeGreaterThan(3);
    // Same two vessels either way round, so the floor run cannot change.
    expect(uphill.runMeters).toBeCloseTo(downhill.runMeters, 6);
  });

  it('picks the routes worth ghosting over the room', () => {
    const onFloor = new Set(['A', 'B', 'C']);
    const routes = recentTransferRoutes([
      { sourceId: 'A', destId: 'B', date: '2026-08-01' },
      { sourceId: 'A', destId: 'B', date: '2026-08-20' },
      { sourceId: 'B', destId: 'C', date: '2026-08-10' },
      // A reversal is a compensating ledger fact, not a journey wine made.
      { sourceId: 'C', destId: 'A', date: '2026-08-25', recordKind: 'reversal' },
      // Off this floor entirely.
      { sourceId: 'A', destId: 'ELSEWHERE', date: '2026-08-30' },
    ], onFloor);

    expect(routes).toEqual([
      { sourceId: 'A', destinationId: 'B' },
      { sourceId: 'B', destinationId: 'C' },
    ]);
  });

  it('caps the ghosts so a busy cellar does not turn into a cat cradle', () => {
    const ids = new Set(['S', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((destId, index) => ({
      sourceId: 'S', destId, date: `2026-08-0${index + 1}`,
    }));
    expect(recentTransferRoutes(entries, ids)).toHaveLength(6);
    expect(recentTransferRoutes(entries, ids, 2)).toEqual([
      { sourceId: 'S', destinationId: 'g' },
      { sourceId: 'S', destinationId: 'f' },
    ]);
  });

  it('counts the lift from the wine surface, not from the top of the tank', () => {
    const floorPlan = { widthMeters: 30, heightMeters: 18 };
    const nearlyEmpty = tank({ id: 'A', xGrid: 40, yGrid: 50, currentVolume: 100, capacity: 5_000 });
    const brimming = tank({ id: 'B', xGrid: 60, yGrid: 50, currentVolume: 4_900, capacity: 5_000 });
    // Two identical tanks: the one with wine near its top needs less lift to
    // reach the other's inlet than the one with a puddle in the bottom.
    expect(transferRun(brimming, nearlyEmpty, floorPlan).liftMeters)
      .toBeLessThan(transferRun(nearlyEmpty, brimming, floorPlan).liftMeters);
  });
});

describe('winery plan layers', () => {
  const context = (fields: Partial<LayerContext> = {}): LayerContext => ({
    activeWork: 0, scheduledWork: 0, daysSinceCleaned: 1, ...fields,
  });

  it('reads a vessel against its own set point before its absolute temperature', () => {
    // A red ferment at 26 °C is normal; the same tank two degrees off the set
    // point it is being held at is the thing worth walking over to.
    const hot = vessel({ temperature: 26, targetTemperature: null });
    expect(vesselLayerSignal('temperature', hot, context()).band).toBe('hot');
    const drifting = vessel({ temperature: 26, targetTemperature: 22 });
    const signal = vesselLayerSignal('temperature', drifting, context());
    expect(signal.band).toBe('drift');
    expect(signal.attention).toBe(1);
    // Inside tolerance the set point stops mattering.
    expect(vesselLayerSignal('temperature', vessel({ temperature: 23, targetTemperature: 22 }), context()).band).toBe('warm');
    expect(vesselLayerSignal('temperature', vessel({ temperature: 8, targetTemperature: null }), context()).band).toBe('cold');
    expect(vesselLayerSignal('temperature', vessel({ temperature: 15, targetTemperature: null }), context()).band).toBe('cool');
  });

  it('separates dirty vessels from clean ones that have been standing too long', () => {
    const dirty = vessel({ cleaningStatus: 'cleaning_needed' });
    expect(vesselLayerSignal('sanitation', dirty, context()).band).toBe('dirty');

    const standing = vessel({ currentVolume: 0, cleaningStatus: 'clean' });
    expect(vesselLayerSignal('sanitation', standing, context({ daysSinceCleaned: 90 })).band).toBe('stale');
    expect(vesselLayerSignal('sanitation', standing, context({ daysSinceCleaned: 3 })).band).toBe('clean');
    // A full vessel is not "standing empty", however long ago it was washed.
    expect(vesselLayerSignal('sanitation', vessel(), context({ daysSinceCleaned: 90 })).band).toBe('clean');
  });

  it('tells work under way apart from work merely booked', () => {
    const tank = vessel();
    expect(vesselLayerSignal('work', tank, context()).band).toBe('idle');
    expect(vesselLayerSignal('work', tank, context({ scheduledWork: 2 })).band).toBe('scheduled');
    const active = vesselLayerSignal('work', tank, context({ activeWork: 1, scheduledWork: 2 }));
    expect(active.band).toBe('active');
    expect(active.attention).toBeGreaterThan(vesselLayerSignal('work', tank, context({ scheduledWork: 2 })).attention);
  });

  it('colours contents by wine class and leaves empty vessels quiet', () => {
    const full = vesselLayerSignal('contents', vessel(), context({ wineClass: 'white' }));
    expect(full.band).toBe('wine');
    expect(full.tone).toBe(wineColorHex('white'));
    const empty = vesselLayerSignal('contents', vessel({ currentVolume: 0 }), context());
    expect(empty.band).toBe('empty');
    expect(empty.attention).toBeLessThan(full.attention);
  });

  it('gives every band a legend entry and a colour', () => {
    const layers: PlanLayer[] = ['contents', 'temperature', 'sanitation', 'work'];
    const listed = new Set(layers.flatMap(layer => layerBands(layer)));
    expect(listed.size).toBe(13);
    listed.forEach(band => {
      expect(bandTone(band)).toBeGreaterThan(0);
    });
    // Every signal a layer can produce has to be findable in that layer's key.
    layers.forEach(layer => {
      const bands = new Set(layerBands(layer));
      [
        vessel(), vessel({ currentVolume: 0 }), vessel({ cleaningStatus: 'dirty' }),
        vessel({ temperature: 5 }), vessel({ temperature: 30 }), vessel({ temperature: 30, targetTemperature: 20 }),
      ].forEach(item => {
        [context(), context({ activeWork: 1 }), context({ scheduledWork: 1 }), context({ daysSinceCleaned: 200 })]
          .forEach(each => expect(bands.has(vesselLayerSignal(layer, item, each).band)).toBe(true));
      });
    });
  });

  it('counts days between sanitation dates and shrugs off unusable ones', () => {
    expect(daysSince('2026-08-01', '2026-08-31')).toBe(30);
    expect(daysSince('2026-08-31', '2026-08-31')).toBe(0);
    expect(daysSince(undefined, '2026-08-31')).toBeNull();
    expect(daysSince('not-a-date', '2026-08-31')).toBeNull();
  });

  it('resolves each headline figure to the vessels behind it', () => {
    const full = vessel({ currentVolume: 800 });
    const emptyClean = vessel({ currentVolume: 0, assignedLotId: null });
    const emptyDirty = vessel({ currentVolume: 0, assignedLotId: null, cleaningStatus: 'cleaning_needed' });

    expect(focusMatches('occupied', full, context())).toBe(true);
    expect(focusMatches('occupied', emptyClean, context())).toBe(false);

    expect(focusMatches('available', emptyClean, context())).toBe(true);
    expect(focusMatches('available', emptyDirty, context())).toBe(false);
    expect(focusMatches('available', full, context())).toBe(false);

    expect(focusMatches('lots', full, context())).toBe(true);
    expect(focusMatches('lots', emptyClean, context())).toBe(false);

    expect(focusMatches('work', full, context())).toBe(false);
    expect(focusMatches('work', full, context({ scheduledWork: 1 }))).toBe(true);
    expect(focusMatches('work', emptyDirty, context({ activeWork: 1 }))).toBe(true);
  });
});

describe('winery plan camera', () => {
  it('flattens the room by trading field of view for distance', () => {
    const plan = planPose(floor);
    const orbit = orbitPose(floor);
    expect(plan.fov).toBe(PLAN_FOV);
    expect(orbit.fov).toBe(ORBIT_FOV);
    // Same room, far narrower lens: the plan camera has to stand much further
    // back, and that convergence is what makes the top-down view read as flat.
    expect(frameDistance(plan.frameRadius, plan.fov)).toBeGreaterThan(frameDistance(orbit.frameRadius, orbit.fov) * 3);
    expect(plan.polar).toBeLessThan(0.01);
    expect(orbit.polar).toBeGreaterThan(0.5);
  });

  it('blends the two poses continuously and without a spin', () => {
    const plan = planPose(floor);
    const orbit = orbitPose(floor, { azimuth: 3, polar: 1, targetX: 0, targetZ: 0 });
    const start = blendPose(plan, orbit, 0);
    expect(start.fov).toBeCloseTo(plan.fov, 6);
    expect(start.frameRadius).toBeCloseTo(plan.frameRadius, 6);
    const end = blendPose(plan, orbit, 1);
    expect(end.fov).toBeCloseTo(orbit.fov, 6);
    expect(end.frameRadius).toBeCloseTo(orbit.frameRadius, 6);
    const halfway = blendPose(plan, orbit, 0.5);
    expect(halfway.fov).toBeGreaterThan(plan.fov);
    expect(halfway.fov).toBeLessThan(orbit.fov);
    expect(halfway.polar).toBeGreaterThan(plan.polar);
    expect(halfway.polar).toBeLessThan(orbit.polar);
    // Interpolating the framing in log space keeps the dolly smooth.
    expect(halfway.frameRadius).toBeCloseTo(Math.sqrt(plan.frameRadius * orbit.frameRadius), 6);

    // 0 to 3 radians must go backwards through -pi, not forwards through +pi.
    expect(lerpAngle(0, 3, 0.5)).toBeCloseTo(1.5, 6);
    expect(lerpAngle(0, 3.3, 0.5)).toBeLessThan(0);
    // -3 to 3 is six radians the long way and a fraction of one the short way,
    // so the midpoint lands on the far side at -pi rather than at zero.
    expect(Math.abs(lerpAngle(-3, 3, 0.5))).toBeCloseTo(Math.PI, 6);
  });

  it('frames the whole room from every angle it can be orbited from', () => {
    // Furthest corner of the room from its centre, including the tank tops.
    const bounding = Math.hypot(floor.widthMeters / 2, 4.5, floor.heightMeters / 2);
    for (let azimuth = -Math.PI; azimuth < Math.PI; azimuth += Math.PI / 8) {
      for (const polar of [0.3, 0.8, 1.3]) {
        const radius = orbitFrameRadius(floor, azimuth, polar, 1.6);
        expect(Number.isFinite(radius)).toBe(true);
        // Never inside the room, and never further out than its bounding sphere.
        expect(radius).toBeGreaterThan(Math.min(floor.widthMeters, floor.heightMeters) / 4);
        expect(radius).toBeLessThanOrEqual(bounding * 1.05);
        // Looking at the room from the opposite side frames it identically.
        expect(orbitFrameRadius(floor, azimuth + Math.PI, polar, 1.6)).toBeCloseTo(radius, 6);
      }
    }
  });

  it('frames a square room the same way from each of its four sides', () => {
    const square = { widthMeters: 20, heightMeters: 20 };
    const base = orbitFrameRadius(square, 0.4, DEFAULT_ORBIT_POLAR, 1.6);
    [1, 2, 3].forEach(quarter => {
      expect(orbitFrameRadius(square, 0.4 + quarter * Math.PI / 2, DEFAULT_ORBIT_POLAR, 1.6)).toBeCloseTo(base, 6);
    });
  });

  it('widens the framing when the viewport gets narrower', () => {
    const wide = orbitFrameRadius(floor, DEFAULT_ORBIT_AZIMUTH, DEFAULT_ORBIT_POLAR, 2.2);
    const narrow = orbitFrameRadius(floor, DEFAULT_ORBIT_AZIMUTH, DEFAULT_ORBIT_POLAR, 0.8);
    expect(narrow).toBeGreaterThan(wide);
    expect(planPose(floor, 1, 0.8).frameRadius).toBeGreaterThan(planPose(floor, 1, 2.2).frameRadius);
    // A square-on plan of a 30 x 18 room is bounded by its depth, not its width.
    expect(fitFrameRadius(floor, 4, 1)).toBeCloseTo(floor.heightMeters / 2, 6);
    expect(fitFrameRadius(floor, 1, 1)).toBeCloseTo(floor.widthMeters / 2, 6);
  });

  it('keeps the zoom factor proportional to the framed radius', () => {
    expect(planPose(floor, 2).frameRadius).toBeCloseTo(planPose(floor).frameRadius * 2, 6);
    expect(orbitPose(floor, undefined, 0.5).frameRadius).toBeCloseTo(orbitPose(floor).frameRadius * 0.5, 6);
  });
});
