import type { CellarFloor, Vessel, VesselPlanModel } from './wineryState';

/** Only a floor's extent matters for placing vessels on it. */
export type PlanFloorExtent = Pick<CellarFloor, 'widthMeters' | 'heightMeters'>;

export interface VesselPlan3dSettings {
  model: VesselPlanModel;
  widthMeters: number;
  depthMeters: number;
  heightMeters: number;
  elevationMeters: number;
  rotationDegrees: number;
}

export const VESSEL_PLAN_MODELS: Array<{ id: VesselPlanModel; en: string; ka: string }> = [
  { id: 'closed_top_jacket', en: 'Closed top · jacketed', ka: 'დახურული · პერანგით' },
  { id: 'closed_top', en: 'Closed top', ka: 'დახურული' },
  { id: 'open_top_jacket', en: 'Open top · jacketed', ka: 'ღია · პერანგით' },
  { id: 'open_top', en: 'Open top', ka: 'ღია' },
  { id: 'portable', en: 'Portable / IBC', ka: 'პორტატული / IBC' },
  { id: 'insulated', en: 'Insulated tank', ka: 'თბოიზოლირებული' },
  { id: 'horizontal_tank', en: 'Horizontal tank', ka: 'ჰორიზონტალური ავზი' },
  { id: 'barrel', en: 'Barrel', ka: 'კასრი' },
  { id: 'qvevri', en: 'Qvevri', ka: 'ქვევრი' },
  { id: 'concrete', en: 'Concrete vessel', ka: 'ბეტონის ჭურჭელი' },
  { id: 'plastic', en: 'Plastic tank', ka: 'პლასტმასის ავზი' },
];

const finite = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function inferVesselPlanModel(vessel: Vessel): VesselPlanModel {
  if (vessel.planModel) return vessel.planModel;
  if (vessel.type === 'qvevri') return 'qvevri';
  if (vessel.type === 'barrel') return 'barrel';
  if (vessel.type === 'concrete') return 'concrete';
  if (vessel.type === 'plastic') return 'plastic';
  if (vessel.shape === 'horizontal') return 'horizontal_tank';
  if (vessel.coolingJacketActive || vessel.targetTemperature !== null) return 'closed_top_jacket';
  return 'closed_top';
}

function inferredDimensions(vessel: Vessel, model: VesselPlanModel) {
  const cubicMeters = Math.max(0.05, vessel.capacity / 1_000);
  if (model === 'barrel') return { widthMeters: 0.72, depthMeters: 1, heightMeters: 0.72, elevationMeters: 0.35 };
  if (model === 'portable') return { widthMeters: 1, depthMeters: 1.2, heightMeters: 1.15, elevationMeters: 0.05 };
  if (model === 'qvevri') {
    const diameter = clamp(Math.cbrt(cubicMeters * 1.15), 0.8, 3.4);
    return { widthMeters: diameter, depthMeters: diameter, heightMeters: diameter * 1.35, elevationMeters: -diameter * 0.95 };
  }
  if (model === 'horizontal_tank') {
    const diameter = clamp(Math.cbrt(cubicMeters * 0.8), 0.65, 3.8);
    return { widthMeters: diameter * 1.9, depthMeters: diameter, heightMeters: diameter, elevationMeters: 0.35 };
  }
  if (model === 'concrete') {
    const edge = clamp(Math.cbrt(cubicMeters), 0.8, 4);
    return { widthMeters: edge, depthMeters: edge, heightMeters: edge * 1.2, elevationMeters: 0 };
  }
  const diameter = clamp(Math.cbrt(cubicMeters * 0.64), 0.65, 4.5);
  return { widthMeters: diameter, depthMeters: diameter, heightMeters: diameter * 1.85, elevationMeters: 0.3 };
}

export function vesselPlan3dSettings(vessel: Vessel): VesselPlan3dSettings {
  const model = inferVesselPlanModel(vessel);
  const defaults = inferredDimensions(vessel, model);
  return {
    model,
    widthMeters: clamp(finite(vessel.planWidthMeters, defaults.widthMeters), 0.2, 20),
    depthMeters: clamp(finite(vessel.planDepthMeters, defaults.depthMeters), 0.2, 20),
    heightMeters: clamp(finite(vessel.planHeightMeters, defaults.heightMeters), 0.2, 30),
    elevationMeters: clamp(finite(vessel.planElevationMeters, defaults.elevationMeters), -10, 15),
    rotationDegrees: ((finite(vessel.planRotationDegrees, 0) % 360) + 360) % 360,
  };
}

export function applyVesselPlan3dSettings(vessel: Vessel, settings: VesselPlan3dSettings): Vessel {
  return {
    ...vessel,
    planModel: settings.model,
    planWidthMeters: clamp(finite(settings.widthMeters, 1), 0.2, 20),
    planDepthMeters: clamp(finite(settings.depthMeters, 1), 0.2, 20),
    planHeightMeters: clamp(finite(settings.heightMeters, 1), 0.2, 30),
    planElevationMeters: clamp(finite(settings.elevationMeters, 0), -10, 15),
    planRotationDegrees: ((finite(settings.rotationDegrees, 0) % 360) + 360) % 360,
  };
}

export function vesselPlanWorldPosition(vessel: Vessel, floor: PlanFloorExtent): { x: number; z: number } {
  const xPct = clamp(finite(vessel.xGrid, 50), 0, 100);
  const yPct = clamp(finite(vessel.yGrid, 50), 0, 100);
  return {
    x: (xPct / 100) * floor.widthMeters - floor.widthMeters / 2,
    z: (yPct / 100) * floor.heightMeters - floor.heightMeters / 2,
  };
}

export function vesselPlanGridPosition(x: number, z: number, floor: PlanFloorExtent): { xGrid: number; yGrid: number } {
  return {
    xGrid: clamp(((x + floor.widthMeters / 2) / floor.widthMeters) * 100, 0, 100),
    yGrid: clamp(((z + floor.heightMeters / 2) / floor.heightMeters) * 100, 0, 100),
  };
}

/** Conservative circular footprint check; it remains valid under arbitrary rotation. */
export function vesselPlanCollisions(vessels: Vessel[], floor: PlanFloorExtent): Map<string, string[]> {
  const collisions = new Map<string, string[]>();
  for (let leftIndex = 0; leftIndex < vessels.length; leftIndex += 1) {
    const left = vessels[leftIndex];
    const leftPosition = vesselPlanWorldPosition(left, floor);
    const leftSettings = vesselPlan3dSettings(left);
    const leftRadius = Math.hypot(leftSettings.widthMeters, leftSettings.depthMeters) / 2;
    for (let rightIndex = leftIndex + 1; rightIndex < vessels.length; rightIndex += 1) {
      const right = vessels[rightIndex];
      const rightPosition = vesselPlanWorldPosition(right, floor);
      const rightSettings = vesselPlan3dSettings(right);
      const rightRadius = Math.hypot(rightSettings.widthMeters, rightSettings.depthMeters) / 2;
      const distance = Math.hypot(leftPosition.x - rightPosition.x, leftPosition.z - rightPosition.z);
      if (distance >= leftRadius + rightRadius) continue;
      collisions.set(left.id, [...(collisions.get(left.id) || []), right.id]);
      collisions.set(right.id, [...(collisions.get(right.id) || []), left.id]);
    }
  }
  return collisions;
}
