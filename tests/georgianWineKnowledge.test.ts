import { describe, expect, it } from 'vitest';
import {
  findGeorgianRegion,
  findGeorgianVariety,
  inferWineClassForVariety,
  suggestMicrozonesForRegion,
  suggestRegionsForVariety,
  suggestVarietiesForRegion
} from '../lib/georgianWineKnowledge';

describe('Georgian wine knowledge base', () => {
  it('matches Georgian wine regions by aliases and suggests microzones', () => {
    const region = findGeorgianRegion('Telavi');

    expect(region?.name).toBe('Kakheti');
    expect(suggestMicrozonesForRegion('kacheti')).toEqual(expect.arrayContaining([
      'Tsinandali',
      'Mukuzani',
      'Kindzmarauli'
    ]));
  });

  it('matches varieties by aliases and infers operational wine class', () => {
    const variety = findGeorgianVariety('Mtsvane Kakhuri');

    expect(variety?.name).toBe('Kakhuri Mtsvane');
    expect(inferWineClassForVariety('Saperavi Budeshuri')).toBe('red');
    expect(inferWineClassForVariety('Rkatsiteli')).toBe('white');
  });

  it('suggests likely varieties for a region and likely regions for a variety', () => {
    expect(suggestVarietiesForRegion('Imereti').map(v => v.name)).toEqual(expect.arrayContaining([
      'Tsolikouri',
      'Tsitska',
      'Krakhuna'
    ]));

    expect(suggestRegionsForVariety('Ojaleshi').map(region => region.name)).toEqual(expect.arrayContaining([
      'Samegrelo',
      'Lechkhumi'
    ]));
  });
});
