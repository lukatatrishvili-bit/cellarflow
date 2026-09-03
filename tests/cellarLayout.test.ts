import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CELLAR_FLOOR_ID,
  floorIdForVessel,
  normalizeCellarFloors,
  normalizeCellarPlanObjects,
  snapPlanPosition,
  vesselsOnFloor,
} from '../lib/cellarLayout';
import type { Vessel } from '../lib/wineryState';

const vessel = (id: string, cellarFloorId?: string): Vessel => ({
  id, type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 0,
  assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2026-08-01', temperature: 16,
  coolingJacketActive: false, targetTemperature: null, lastOperation: '', cellarFloorId,
});

describe('cellar layout model', () => {
  it('migrates existing wineries to a safe main floor without changing vessels', () => {
    const floors = normalizeCellarFloors(undefined);
    expect(floors).toEqual([expect.objectContaining({ id: DEFAULT_CELLAR_FLOOR_ID, widthMeters: 30, heightMeters: 18, gridMeters: 1 })]);
    expect(floorIdForVessel(vessel('T-1'), floors)).toBe(DEFAULT_CELLAR_FLOOR_ID);
  });

  it('assigns legacy and explicit vessels to the correct floor', () => {
    const floors = normalizeCellarFloors([
      { id: 'ground', name: 'Ground', level: 0, widthMeters: 30, heightMeters: 18, gridMeters: 1 },
      { id: 'basement', name: 'Basement', level: -1, widthMeters: 20, heightMeters: 12, gridMeters: 0.5 },
    ]);
    expect(vesselsOnFloor([vessel('T-1'), vessel('T-2', 'basement')], floors, 'ground').map(item => item.id)).toEqual(['T-1']);
    expect(vesselsOnFloor([vessel('T-1'), vessel('T-2', 'basement')], floors, 'basement').map(item => item.id)).toEqual(['T-2']);
  });

  it('snaps physical positions to the configured meter grid', () => {
    expect(snapPlanPosition({ x: 34, y: 29 }, { widthMeters: 20, heightMeters: 10, gridMeters: 1 }, true)).toEqual({ x: 35, y: 30 });
    expect(snapPlanPosition({ x: 34, y: 29 }, { widthMeters: 20, heightMeters: 10, gridMeters: 1 }, false)).toEqual({ x: 34, y: 29 });
  });

  it('normalizes winery-specific zones and utilities in real-world metres', () => {
    const floor = { id: 'ground', name: 'Ground', level: 0, widthMeters: 20, heightMeters: 12, gridMeters: 0.5 };
    const objects = normalizeCellarPlanObjects([
      { id: 'fermentation', kind: 'zone', label: 'Fermentation', xMeters: 50, yMeters: -4, widthMeters: 8, heightMeters: 5, zoneUse: 'fermentation' },
      { id: 'water', kind: 'water', label: 'Wash point', xMeters: 2, yMeters: 3, widthMeters: 1, heightMeters: 1, rotation: 91 },
    ], floor);
    expect(objects[0]).toMatchObject({ xMeters: 16, yMeters: 2.5, zoneUse: 'fermentation' });
    expect(objects[1]).toMatchObject({ xMeters: 2, yMeters: 3, rotation: 90 });
  });

  it('drops unknown plan objects and de-duplicates their ids safely', () => {
    const floor = { id: 'ground', name: 'Ground', level: 0, widthMeters: 20, heightMeters: 12, gridMeters: 1 };
    const objects = normalizeCellarPlanObjects([
      { id: 'utility', kind: 'drain', label: 'Drain', xMeters: 2, yMeters: 2, widthMeters: 1, heightMeters: 1 },
      { id: 'utility', kind: 'power', label: 'Power', xMeters: 3, yMeters: 3, widthMeters: 1, heightMeters: 1 },
      { id: 'bad', kind: 'tractor' as never, label: 'Bad', xMeters: 1, yMeters: 1, widthMeters: 1, heightMeters: 1 },
    ], floor);
    expect(objects.map(object => object.id)).toEqual(['utility', 'utility-2']);
  });
});
