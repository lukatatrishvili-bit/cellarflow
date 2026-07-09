import { describe, expect, it } from 'vitest';
import { cadastreSummaryLine, calculateCadastreCompleteness } from '../lib/cadastre';
import type { VineyardBlock } from '../lib/wineryState';

const baseBlock: VineyardBlock = {
  id: 'BLK-1',
  name: 'Mukuzani Sector A',
  vineyardName: 'Mukuzani Estate',
  locationName: 'Mukuzani, Gurjaani',
  latitude: 41.8,
  longitude: 45.7,
  area: 1.5,
  elevation: 480,
  slope: '12% south-west',
  aspect: 'South-West',
  soilType: 'clay and limestone',
  grapeVariety: 'Saperavi',
  plantingYear: 2015,
  spacing: '2.2 x 1.0',
  rowsCount: 24,
  vinesCount: 4200,
  trainingSystem: 'Guyot',
  pruningSystem: 'cane',
  irrigationEnabled: false,
  farmingStatus: 'organic',
  currentPhenology: 'Ripening',
  estimatedHarvestDate: '2026-09-20',
  notes: '',
};

describe('cadastre mirror readiness', () => {
  it('flags missing official geography on a basic vineyard block', () => {
    const readiness = calculateCadastreCompleteness(baseBlock);

    expect(readiness.badge).toBe('Needs review');
    expect(readiness.missingCritical).toEqual(expect.arrayContaining([
      'cadastral code',
      'municipality',
      'village',
      'microzone / appellation area',
    ]));
    expect(readiness.score).toBeLessThan(70);
  });

  it('scores a complete cadastre mirror without missing critical fields', () => {
    const readiness = calculateCadastreCompleteness({
      ...baseBlock,
      cadastralCode: '51.01.01.001',
      officialCadastreDocumentName: 'cadastre-map.pdf',
      landOwner: 'VinOS Estate LLC',
      grower: 'VinOS Estate',
      municipality: 'Gurjaani',
      community: 'Mukuzani Community',
      village: 'Mukuzani',
      microzone: 'Mukuzani',
      parcelName: 'Sector A',
      parcelArea: 1.5,
      rootstock: '5C',
      clone: 'Saperavi 06',
      vineyardCondition: 'productive',
      boundary: [
        { lat: 41.8001, lng: 45.7001 },
        { lat: 41.8005, lng: 45.7001 },
        { lat: 41.8005, lng: 45.7007 },
      ],
    });

    expect(readiness.badge).toBe('Complete');
    expect(readiness.missingCritical).toEqual([]);
    expect(readiness.score).toBe(100);
  });

  it('summarizes readiness for traceability notes', () => {
    expect(cadastreSummaryLine({ ...baseBlock, cadastralCode: '51.01.01.001' })).toContain('cadastre mirror');
  });
});
