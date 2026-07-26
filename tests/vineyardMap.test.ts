import { describe, expect, it } from 'vitest';
import type { VineyardBlock } from '../lib/wineryState';
import {
  appendBoundaryPoint,
  hasUsableBoundary,
  vineyardBlockBoundary,
  vineyardBlocksBounds,
  vineyardMapBounds,
} from '../lib/vineyardMap';

function block(overrides: Partial<VineyardBlock> = {}): VineyardBlock {
  return {
    id: 'BLOCK-1',
    name: 'North Saperavi',
    vineyardName: 'Demo Estate',
    locationName: 'Telavi',
    latitude: 41.92,
    longitude: 45.48,
    area: 2,
    elevation: 430,
    slope: '5%',
    aspect: 'South',
    soilType: 'Clay loam',
    grapeVariety: 'Saperavi',
    plantingYear: 2018,
    spacing: '2.2 x 1.2 m',
    rowsCount: 28,
    vinesCount: 5_400,
    trainingSystem: 'Guyot',
    pruningSystem: 'Cane pruned',
    irrigationEnabled: true,
    farmingStatus: 'organic',
    currentPhenology: 'Veraison',
    estimatedHarvestDate: '2026-09-20',
    notes: '',
    ...overrides,
  };
}

describe('vineyard map geometry', () => {
  it('uses a recorded cadastral boundary without altering its points', () => {
    const boundary = [
      { lat: 41.9, lng: 45.4 },
      { lat: 41.91, lng: 45.4 },
      { lat: 41.91, lng: 45.42 },
    ];

    expect(vineyardBlockBoundary(block({ boundary }))).toEqual(boundary);
    expect(hasUsableBoundary(boundary)).toBe(true);
  });

  it('uses a GPS polygon when the primary boundary is unavailable', () => {
    const gpsPolygon = [
      { lat: 41.8, lng: 45.7 },
      { lat: 41.81, lng: 45.7 },
      { lat: 41.81, lng: 45.72 },
    ];

    expect(vineyardBlockBoundary(block({ boundary: [], gpsPolygon }))).toEqual(gpsPolygon);
  });

  it('creates a selectable, area-aware approximation when no polygon exists', () => {
    const small = vineyardBlockBoundary(block({ area: 1 }));
    const large = vineyardBlockBoundary(block({ area: 9 }));

    expect(small).toHaveLength(4);
    expect(large).toHaveLength(4);
    expect(large[2].lat - large[0].lat).toBeGreaterThan(small[2].lat - small[0].lat);
    expect(large[2].lng - large[0].lng).toBeGreaterThan(small[2].lng - small[0].lng);
  });

  it('calculates bounds across every visible block', () => {
    const first = block({
      id: 'A',
      boundary: [
        { lat: 41.7, lng: 45.2 },
        { lat: 41.8, lng: 45.2 },
        { lat: 41.8, lng: 45.3 },
      ],
    });
    const second = block({
      id: 'B',
      boundary: [
        { lat: 42.1, lng: 46.1 },
        { lat: 42.2, lng: 46.1 },
        { lat: 42.2, lng: 46.3 },
      ],
    });

    expect(vineyardBlocksBounds([first, second])).toEqual([
      [41.7, 45.2],
      [42.2, 46.3],
    ]);
    expect(vineyardMapBounds([])).toBeNull();
  });

  it('adds valid boundary points while ignoring duplicates and invalid coordinates', () => {
    const first = { lat: 41.92, lng: 45.48 };
    const points = appendBoundaryPoint([], first);

    expect(appendBoundaryPoint(points, first)).toBe(points);
    expect(appendBoundaryPoint(points, { lat: 100, lng: 45 })).toBe(points);
    expect(appendBoundaryPoint(points, { lat: 41.93, lng: 45.49 })).toEqual([
      first,
      { lat: 41.93, lng: 45.49 },
    ]);
  });
});
