import { describe, expect, it } from 'vitest';
import {
  VINEYARD_SATELLITE_BASEMAP,
  VINEYARD_SATELLITE_LABELS,
} from '../lib/vineyardBasemap';

describe('vineyard satellite basemap', () => {
  it('uses satellite imagery as the primary vineyard map layer', () => {
    expect(VINEYARD_SATELLITE_BASEMAP.url).toContain('/World_Imagery/MapServer/tile/');
    expect(VINEYARD_SATELLITE_BASEMAP.attribution).toContain('Esri');
    expect(VINEYARD_SATELLITE_BASEMAP.attribution).toContain('Vantor');
  });

  it('keeps geographic labels above the imagery for easier orientation', () => {
    expect(VINEYARD_SATELLITE_LABELS.url).toContain('/World_Boundaries_and_Places/MapServer/tile/');
    expect(VINEYARD_SATELLITE_LABELS.maxZoom).toBeGreaterThanOrEqual(18);
  });
});
