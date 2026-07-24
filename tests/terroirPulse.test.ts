import { describe, expect, it } from 'vitest';
import {
  buildTerroirPulse,
  normalizeTerroirSharingSettings,
  type TerroirPulseSource,
} from '../lib/terroirPulse';

function source(
  index: number,
  overrides: {
    area?: number;
    sampleDate?: string;
    anonymous?: boolean;
    includeHarvest?: boolean;
    samplingOnly?: boolean;
  } = {},
): TerroirPulseSource {
  const blockId = `private-block-${index}`;
  return {
    organizationId: `private-org-${index}`,
    data: {
      terroirSharing: {
        enabled: true,
        privacyMode: overrides.anonymous === false ? 'attributed' : 'anonymous',
        selectedBlockIds: [blockId],
        shareSampling: true,
        shareHarvest: overrides.includeHarvest !== false,
        attributionName: overrides.anonymous === false ? `Winery ${index}` : '',
        consentVersion: 1,
      },
      companyProfile: {
        companyName: `Secret company ${index}`,
        wineryName: `Secret winery ${index}`,
        country: 'Georgia',
        region: 'Kakheti',
      },
      blocks: [{
        id: blockId,
        name: `Secret block ${index}`,
        grapeVariety: 'Saperavi',
        microzone: 'Mukuzani',
        area: overrides.area ?? 2,
        latitude: 41.123 + index,
        longitude: 45.456 + index,
      }],
      samplings: [{
        id: `sample-${index}`,
        blockId,
        date: overrides.sampleDate || '2026-09-08',
        brix: 20 + index,
        pH: 3.1 + index * 0.05,
        totalAcidityGL: 7 - index * 0.25,
        diseaseCondition: 'clean',
      }],
      harvests: overrides.includeHarvest === false ? [] : [{
        id: `harvest-${index}`,
        blockId,
        estimatedHarvestDate: `2026-09-${String(18 + index).padStart(2, '0')}`,
        actualHarvestDate: `2026-09-${String(10 + index).padStart(2, '0')}`,
        estimatedTons: 2,
        actualHarvestedKg: 600 + index * 200,
        grapeCondition: 'good',
      }],
      phenologyLogs: overrides.samplingOnly ? [] : [{
        id: `phenology-${index}`,
        blockId,
        date: '2026-09-05',
        stage: 'Ripening',
      }],
      scoutings: overrides.samplingOnly ? [] : [{
        id: `scouting-${index}`,
        blockId,
        date: '2026-09-06',
        severity: 'low',
      }],
    },
  };
}

describe('Terroir Pulse privacy-safe aggregation', () => {
  it('keeps sharing disabled by default and drops unavailable block IDs', () => {
    expect(normalizeTerroirSharingSettings({
      enabled: true,
      privacyMode: 'unexpected',
      selectedBlockIds: ['existing', 'deleted'],
    }, ['existing'])).toMatchObject({
      enabled: true,
      privacyMode: 'anonymous',
      selectedBlockIds: ['existing'],
      shareSampling: true,
      shareHarvest: true,
    });
    expect(normalizeTerroirSharingSettings(null)).toMatchObject({
      enabled: false,
      selectedBlockIds: [],
    });
  });

  it('suppresses every group below the minimum contributor threshold', () => {
    const publication = buildTerroirPulse(
      [1, 2, 3, 4].map(index => source(index)),
      { asOf: new Date('2026-10-20T12:00:00.000Z') },
    );
    expect(publication.groups).toEqual([]);
  });

  it('publishes organization-weighted regional and terroir medians without private identifiers', () => {
    const publication = buildTerroirPulse(
      [1, 2, 3, 4, 5].map(index => source(index)),
      { asOf: new Date('2026-10-20T12:00:00.000Z') },
    );
    expect(publication.groups).toHaveLength(2);
    const terroir = publication.groups.find(group => group.level === 'terroir');
    expect(terroir).toMatchObject({
      country: 'Georgia',
      region: 'Kakheti',
      terroir: 'Mukuzani',
      variety: 'Saperavi',
      vintage: 2026,
      contributors: 5,
      blocks: 5,
      representedHectares: 10,
      attributedContributors: [],
      metrics: {
        medianBrix: 23,
        medianPh: 3.25,
        medianTotalAcidityGL: 6.3,
        harvestProgressPct: 60,
        medianHarvestDate: '2026-09-13',
        phenologyStage: 'Ripening',
        diseasePressure: 'low',
      },
    });
    const serialized = JSON.stringify(publication);
    expect(serialized).not.toContain('private-org');
    expect(serialized).not.toContain('private-block');
    expect(serialized).not.toContain('Secret block');
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
  });

  it('suppresses a group when one contributor represents more than forty percent', () => {
    const sources = [
      source(1, { area: 20 }),
      source(2, { area: 1 }),
      source(3, { area: 1 }),
      source(4, { area: 1 }),
      source(5, { area: 1 }),
    ];
    expect(buildTerroirPulse(sources, {
      asOf: new Date('2026-10-20T12:00:00.000Z'),
    }).groups).toEqual([]);
  });

  it('excludes observations inside the publication delay window', () => {
    const sources = [
      source(1, { includeHarvest: false, samplingOnly: true }),
      source(2, { includeHarvest: false, samplingOnly: true }),
      source(3, { includeHarvest: false, samplingOnly: true }),
      source(4, { includeHarvest: false, samplingOnly: true }),
      source(5, { includeHarvest: false, samplingOnly: true, sampleDate: '2026-10-18' }),
    ];
    const publication = buildTerroirPulse(sources, {
      asOf: new Date('2026-10-20T12:00:00.000Z'),
      publicationDelayDays: 7,
    });
    expect(publication.publishedThrough).toBe('2026-10-13');
    // The fifth organization's only maturity observation is too recent, so
    // the remaining cohort of four cannot be published.
    expect(publication.groups).toEqual([]);
  });

  it('lists only contributors that explicitly choose attributed publication', () => {
    const publication = buildTerroirPulse([
      source(1, { anonymous: false }),
      source(2), source(3), source(4), source(5),
    ], { asOf: new Date('2026-10-20T12:00:00.000Z') });
    expect(publication.groups.every(group => (
      JSON.stringify(group.attributedContributors) === JSON.stringify(['Winery 1'])
    ))).toBe(true);
  });
});
