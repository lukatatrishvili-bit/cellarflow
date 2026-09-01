import { describe, expect, it } from 'vitest';
import type { CellarFloor, Vessel } from '../lib/wineryState';
import {
  applyVesselPlan3dSettings,
  inferVesselPlanModel,
  vesselPlan3dSettings,
  vesselPlanCollisions,
  vesselPlanGridPosition,
  vesselPlanWorldPosition,
} from '../lib/wineryPlan3d';

const floor: CellarFloor = {
  id: 'ground', name: 'Ground', level: 0, widthMeters: 30, heightMeters: 20, gridMeters: 1,
};

const vessel = (fields: Partial<Vessel> = {}): Vessel => ({
  id: 'T-1', type: 'stainless_steel', shape: 'vertical', capacity: 5_000,
  currentVolume: 4_000, assignedLotId: 'LOT-1', cleaningStatus: 'clean',
  lastCleaned: '2026-08-30', temperature: 18, coolingJacketActive: true,
  targetTemperature: 18, lastOperation: 'Filled', xGrid: 50, yGrid: 50,
  ...fields,
});

describe('winery plan 3D geometry', () => {
  it('infers a useful model and physical dimensions from vessel facts', () => {
    expect(inferVesselPlanModel(vessel())).toBe('closed_top_jacket');
    expect(inferVesselPlanModel(vessel({ type: 'qvevri', coolingJacketActive: false, targetTemperature: null }))).toBe('qvevri');
    const settings = vesselPlan3dSettings(vessel());
    expect(settings.widthMeters).toBeGreaterThan(0.6);
    expect(settings.heightMeters).toBeGreaterThan(settings.widthMeters);
  });

  it('round-trips between saved grid percentages and floor-world meters', () => {
    const position = vesselPlanWorldPosition(vessel({ xGrid: 25, yGrid: 75 }), floor);
    expect(position).toEqual({ x: -7.5, z: 5 });
    expect(vesselPlanGridPosition(position.x, position.z, floor)).toEqual({ xGrid: 25, yGrid: 75 });
  });

  it('normalizes persisted dimensions and free rotation', () => {
    const updated = applyVesselPlan3dSettings(vessel(), {
      model: 'open_top', widthMeters: 1.8, depthMeters: 1.7, heightMeters: 3.4,
      elevationMeters: 0.2, rotationDegrees: 405,
    });
    expect(updated).toMatchObject({
      planModel: 'open_top', planWidthMeters: 1.8, planDepthMeters: 1.7,
      planHeightMeters: 3.4, planElevationMeters: 0.2, planRotationDegrees: 45,
    });
  });

  it('reports intersecting vessel footprints in both directions', () => {
    const left = vessel({ id: 'T-1', xGrid: 50, yGrid: 50, planWidthMeters: 2, planDepthMeters: 2 });
    const right = vessel({ id: 'T-2', xGrid: 53, yGrid: 50, planWidthMeters: 2, planDepthMeters: 2 });
    const far = vessel({ id: 'T-3', xGrid: 90, yGrid: 90, planWidthMeters: 1, planDepthMeters: 1 });
    const collisions = vesselPlanCollisions([left, right, far], floor);
    expect(collisions.get('T-1')).toEqual(['T-2']);
    expect(collisions.get('T-2')).toEqual(['T-1']);
    expect(collisions.has('T-3')).toBe(false);
  });
});
