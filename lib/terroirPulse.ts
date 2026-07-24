export type TerroirPrivacyMode = 'anonymous' | 'attributed';

export interface TerroirSharingSettings {
  enabled: boolean;
  privacyMode: TerroirPrivacyMode;
  selectedBlockIds: string[];
  shareSampling: boolean;
  shareHarvest: boolean;
  attributionName: string;
  consentVersion: 1;
  acceptedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_TERROIR_SHARING_SETTINGS: TerroirSharingSettings = {
  enabled: false,
  privacyMode: 'anonymous',
  selectedBlockIds: [],
  shareSampling: true,
  shareHarvest: true,
  attributionName: '',
  consentVersion: 1,
};

export const TERROIR_PULSE_DEFAULTS = {
  minimumContributors: 5,
  minimumHectares: 5,
  maximumContributorShare: 0.4,
  publicationDelayDays: 7,
} as const;

export interface TerroirPulseMethodology {
  minimumContributors: number;
  minimumHectares: number;
  maximumContributorSharePct: number;
  publicationDelayDays: number;
  aggregation: 'organization_medians';
}

export interface TerroirPulseGroup {
  id: string;
  level: 'region' | 'terroir';
  country: string;
  region: string;
  terroir: string;
  variety: string;
  vintage: number;
  contributors: number;
  blocks: number;
  representedHectares: number;
  attributedContributors: string[];
  lastObservationDate: string;
  metrics: {
    medianBrix: number | null;
    medianPh: number | null;
    medianTotalAcidityGL: number | null;
    harvestProgressPct: number | null;
    medianHarvestDate: string | null;
    harvestWindowStart: string | null;
    harvestWindowEnd: string | null;
    phenologyStage: string | null;
    diseasePressure: 'low' | 'medium' | 'high' | null;
  };
}

export interface TerroirPulsePublication {
  generatedAt: string;
  publishedThrough: string;
  methodology: TerroirPulseMethodology;
  groups: TerroirPulseGroup[];
}

export interface TerroirPulseSource {
  organizationId: string;
  data: {
    terroirSharing?: Partial<TerroirSharingSettings> | null;
    companyProfile?: Record<string, unknown> | null;
    blocks?: Array<Record<string, unknown>> | null;
    samplings?: Array<Record<string, unknown>> | null;
    harvests?: Array<Record<string, unknown>> | null;
    phenologyLogs?: Array<Record<string, unknown>> | null;
    scoutings?: Array<Record<string, unknown>> | null;
  };
}

export interface BuildTerroirPulseOptions {
  asOf?: Date;
  minimumContributors?: number;
  minimumHectares?: number;
  maximumContributorShare?: number;
  publicationDelayDays?: number;
}

const text = (value: unknown, maxLength = 120): string => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const finiteNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const positiveNumber = (value: unknown): number | null => {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const isoDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const short = value.slice(0, 10);
  return Number.isFinite(Date.parse(`${short}T00:00:00.000Z`)) ? short : null;
};

const vintageForDate = (value: unknown): number | null => {
  const date = isoDate(value);
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return year >= 1900 && year <= 2200 ? year : null;
};

const rounded = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const median = (values: Array<number | null | undefined>): number | null => {
  const sorted = values.filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  )).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const percentile = (values: number[], quantile: number): number | null => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const mode = <T extends string>(values: Array<T | null | undefined>): T | null => {
  const counts = new Map<T, number>();
  values.forEach(value => {
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort(([leftValue, leftCount], [rightValue, rightCount]) => (
      rightCount - leftCount || leftValue.localeCompare(rightValue)
    ))[0]?.[0] || null;
};

const uniqueStrings = (values: unknown, limit = 500): string[] => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(value => text(value, 160))
    .filter(Boolean))]
    .slice(0, limit);
};

export function normalizeTerroirSharingSettings(
  value: unknown,
  availableBlockIds?: Iterable<string>,
): TerroirSharingSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const available = availableBlockIds ? new Set(availableBlockIds) : null;
  const selectedBlockIds = uniqueStrings(raw.selectedBlockIds)
    .filter(blockId => !available || available.has(blockId));
  return {
    enabled: raw.enabled === true,
    privacyMode: raw.privacyMode === 'attributed' ? 'attributed' : 'anonymous',
    selectedBlockIds,
    shareSampling: raw.shareSampling !== false,
    shareHarvest: raw.shareHarvest !== false,
    attributionName: text(raw.attributionName, 100),
    consentVersion: 1,
    ...(isoDateTime(raw.acceptedAt) ? { acceptedAt: String(raw.acceptedAt) } : {}),
    ...(isoDateTime(raw.updatedAt) ? { updatedAt: String(raw.updatedAt) } : {}),
    ...(text(raw.updatedBy, 100) ? { updatedBy: text(raw.updatedBy, 100) } : {}),
  };
}

function isoDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

type Pressure = 'low' | 'medium' | 'high';

function pressureFromText(value: unknown): Pressure | null {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  if (/high|severe|damag|rot|disease|poor|critical|infect/.test(normalized)) return 'high';
  if (/medium|moderate|fair|watch|some|partial/.test(normalized)) return 'medium';
  if (/low|none|clean|healthy|excellent|good|clear/.test(normalized)) return 'low';
  return null;
}

interface OrganizationContribution {
  organizationId: string;
  attributedName: string;
  area: number;
  blocks: Set<string>;
  brix: number[];
  ph: number[];
  acidity: number[];
  estimatedKg: number;
  actualKg: number;
  harvestDates: number[];
  phenologyStages: string[];
  pressures: Pressure[];
  observationDates: string[];
}

interface GroupAccumulator {
  level: 'region' | 'terroir';
  country: string;
  region: string;
  terroir: string;
  variety: string;
  vintage: number;
  organizations: Map<string, OrganizationContribution>;
}

function createContribution(organizationId: string, attributedName: string): OrganizationContribution {
  return {
    organizationId,
    attributedName,
    area: 0,
    blocks: new Set(),
    brix: [],
    ph: [],
    acidity: [],
    estimatedKg: 0,
    actualKg: 0,
    harvestDates: [],
    phenologyStages: [],
    pressures: [],
    observationDates: [],
  };
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'unknown';
}

function groupKey(
  level: 'region' | 'terroir',
  country: string,
  region: string,
  terroir: string,
  variety: string,
  vintage: number,
): string {
  return [level, country, region, terroir, variety, String(vintage)].join('\u0000');
}

function getOrCreateGroup(
  groups: Map<string, GroupAccumulator>,
  descriptor: Omit<GroupAccumulator, 'organizations'>,
): GroupAccumulator {
  const key = groupKey(
    descriptor.level,
    descriptor.country,
    descriptor.region,
    descriptor.terroir,
    descriptor.variety,
    descriptor.vintage,
  );
  const existing = groups.get(key);
  if (existing) return existing;
  const created = { ...descriptor, organizations: new Map<string, OrganizationContribution>() };
  groups.set(key, created);
  return created;
}

function addBlockYearToGroup(
  group: GroupAccumulator,
  organizationId: string,
  attributedName: string,
  block: Record<string, unknown>,
  sampling: Record<string, unknown> | undefined,
  harvests: Array<Record<string, unknown>>,
  phenology: Record<string, unknown> | undefined,
  scoutings: Array<Record<string, unknown>>,
): void {
  let contribution = group.organizations.get(organizationId);
  if (!contribution) {
    contribution = createContribution(organizationId, attributedName);
    group.organizations.set(organizationId, contribution);
  }

  const blockId = text(block.id, 160);
  if (!contribution.blocks.has(blockId)) {
    contribution.blocks.add(blockId);
    contribution.area += positiveNumber(block.area) || positiveNumber(block.parcelArea) || 0;
  }

  if (sampling) {
    const brix = finiteNumber(sampling.brix);
    const ph = finiteNumber(sampling.pH ?? sampling.ph);
    const acidity = finiteNumber(sampling.totalAcidityGL);
    if (brix !== null && brix >= 0 && brix <= 45) contribution.brix.push(brix);
    if (ph !== null && ph >= 2 && ph <= 5) contribution.ph.push(ph);
    if (acidity !== null && acidity >= 0 && acidity <= 40) contribution.acidity.push(acidity);
    const samplingPressure = pressureFromText(sampling.diseaseCondition);
    if (samplingPressure) contribution.pressures.push(samplingPressure);
    const samplingDate = isoDate(sampling.date);
    if (samplingDate) contribution.observationDates.push(samplingDate);
  }

  harvests.forEach(harvest => {
    contribution.estimatedKg += (positiveNumber(harvest.estimatedTons) || 0) * 1000;
    contribution.actualKg += positiveNumber(harvest.actualHarvestedKg) || 0;
    const harvestDate = isoDate(harvest.actualHarvestDate);
    if (harvestDate) {
      contribution.harvestDates.push(Date.parse(`${harvestDate}T00:00:00.000Z`));
      contribution.observationDates.push(harvestDate);
    } else {
      const plannedDate = isoDate(harvest.estimatedHarvestDate);
      if (plannedDate) contribution.observationDates.push(plannedDate);
    }
    const harvestPressure = pressureFromText(harvest.grapeCondition);
    if (harvestPressure) contribution.pressures.push(harvestPressure);
  });

  if (phenology) {
    const stage = text(phenology.stage, 80);
    if (stage) contribution.phenologyStages.push(stage);
    const phenologyDate = isoDate(phenology.date);
    if (phenologyDate) contribution.observationDates.push(phenologyDate);
  }

  scoutings.forEach(scouting => {
    const scoutingPressure = pressureFromText(scouting.severity);
    if (scoutingPressure) contribution.pressures.push(scoutingPressure);
    const scoutingDate = isoDate(scouting.date);
    if (scoutingDate) contribution.observationDates.push(scoutingDate);
  });
}

function latestByDate(records: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  return [...records].sort((left, right) => (
    (isoDate(right.date) || '').localeCompare(isoDate(left.date) || '')
  ))[0];
}

function dateForEpoch(value: number | null): string | null {
  if (value === null) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function strongestPressure(values: Pressure[]): Pressure | null {
  if (values.includes('high')) return 'high';
  if (values.includes('medium')) return 'medium';
  return values.includes('low') ? 'low' : null;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value as number)));
}

function clampNumber(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value as number));
}

export function buildTerroirPulse(
  sources: TerroirPulseSource[],
  options: BuildTerroirPulseOptions = {},
): TerroirPulsePublication {
  const asOf = options.asOf && Number.isFinite(options.asOf.getTime()) ? options.asOf : new Date();
  const minimumContributors = clampInteger(
    options.minimumContributors,
    TERROIR_PULSE_DEFAULTS.minimumContributors,
    3,
    50,
  );
  const minimumHectares = clampNumber(
    options.minimumHectares,
    TERROIR_PULSE_DEFAULTS.minimumHectares,
    0,
    100_000,
  );
  const maximumContributorShare = clampNumber(
    options.maximumContributorShare,
    TERROIR_PULSE_DEFAULTS.maximumContributorShare,
    0.2,
    1,
  );
  const publicationDelayDays = clampInteger(
    options.publicationDelayDays,
    TERROIR_PULSE_DEFAULTS.publicationDelayDays,
    0,
    90,
  );
  const cutoff = new Date(asOf.getTime() - publicationDelayDays * 86_400_000);
  const publishedThrough = cutoff.toISOString().slice(0, 10);
  const groups = new Map<string, GroupAccumulator>();

  sources.forEach(source => {
    const data = source?.data || {};
    const blocks = Array.isArray(data.blocks) ? data.blocks : [];
    const availableBlockIds = blocks.map(block => text(block.id, 160)).filter(Boolean);
    const settings = normalizeTerroirSharingSettings(data.terroirSharing, availableBlockIds);
    if (!settings.enabled || settings.selectedBlockIds.length === 0) return;

    const selectedIds = new Set(settings.selectedBlockIds);
    const profile = data.companyProfile && typeof data.companyProfile === 'object'
      ? data.companyProfile
      : {};
    const country = text(profile.country, 80) || 'Unspecified country';
    const region = text(profile.region, 100);
    if (!region) return;
    const attributedName = settings.privacyMode === 'attributed'
      ? settings.attributionName || text(profile.wineryName, 100) || text(profile.companyName, 100)
      : '';
    const allSamplings = settings.shareSampling && Array.isArray(data.samplings) ? data.samplings : [];
    const allHarvests = settings.shareHarvest && Array.isArray(data.harvests) ? data.harvests : [];
    const allPhenology = settings.shareSampling && Array.isArray(data.phenologyLogs) ? data.phenologyLogs : [];
    const allScoutings = settings.shareSampling && Array.isArray(data.scoutings) ? data.scoutings : [];

    blocks.filter(block => selectedIds.has(text(block.id, 160))).forEach(block => {
      const blockId = text(block.id, 160);
      const variety = text(block.grapeVariety, 100);
      if (!blockId || !variety) return;
      const terroir = text(block.microzone, 100)
        || text(block.village, 100)
        || text(block.community, 100)
        || text(block.municipality, 100)
        || region;

      const delayedSamplings = allSamplings.filter(record => (
        text(record.blockId, 160) === blockId
        && Boolean(isoDate(record.date))
        && String(record.date).slice(0, 10) <= publishedThrough
      ));
      const delayedHarvests = allHarvests.filter(record => {
        if (text(record.blockId, 160) !== blockId) return false;
        const effectiveDate = isoDate(record.actualHarvestDate) || isoDate(record.estimatedHarvestDate);
        return Boolean(effectiveDate && effectiveDate <= publishedThrough);
      });
      const delayedPhenology = allPhenology.filter(record => (
        text(record.blockId, 160) === blockId
        && Boolean(isoDate(record.date))
        && String(record.date).slice(0, 10) <= publishedThrough
      ));
      const delayedScoutings = allScoutings.filter(record => (
        text(record.blockId, 160) === blockId
        && Boolean(isoDate(record.date))
        && String(record.date).slice(0, 10) <= publishedThrough
      ));

      const vintages = new Set<number>();
      delayedSamplings.forEach(record => {
        const vintage = vintageForDate(record.date);
        if (vintage) vintages.add(vintage);
      });
      delayedHarvests.forEach(record => {
        const vintage = vintageForDate(record.actualHarvestDate) || vintageForDate(record.estimatedHarvestDate);
        if (vintage) vintages.add(vintage);
      });
      delayedPhenology.forEach(record => {
        const vintage = vintageForDate(record.date);
        if (vintage) vintages.add(vintage);
      });
      delayedScoutings.forEach(record => {
        const vintage = vintageForDate(record.date);
        if (vintage) vintages.add(vintage);
      });

      vintages.forEach(vintage => {
        const sampling = latestByDate(delayedSamplings.filter(record => vintageForDate(record.date) === vintage));
        const harvests = delayedHarvests.filter(record => (
          (vintageForDate(record.actualHarvestDate) || vintageForDate(record.estimatedHarvestDate)) === vintage
        ));
        const phenology = latestByDate(delayedPhenology.filter(record => vintageForDate(record.date) === vintage));
        const scoutings = delayedScoutings.filter(record => vintageForDate(record.date) === vintage);
        if (!sampling && harvests.length === 0 && !phenology && scoutings.length === 0) return;

        const descriptors: Array<Omit<GroupAccumulator, 'organizations'>> = [{
          level: 'region', country, region, terroir: region, variety, vintage,
        }];
        if (terroir.localeCompare(region, undefined, { sensitivity: 'accent' }) !== 0) {
          descriptors.push({ level: 'terroir', country, region, terroir, variety, vintage });
        }
        descriptors.forEach(descriptor => {
          addBlockYearToGroup(
            getOrCreateGroup(groups, descriptor),
            source.organizationId,
            attributedName,
            block,
            sampling,
            harvests,
            phenology,
            scoutings,
          );
        });
      });
    });
  });

  const publishedGroups = [...groups.values()].flatMap((group): TerroirPulseGroup[] => {
    const contributions = [...group.organizations.values()];
    if (contributions.length < minimumContributors) return [];
    const representedHectares = contributions.reduce((sum, contribution) => sum + contribution.area, 0);
    if (representedHectares < minimumHectares) return [];
    const largestAreaShare = representedHectares > 0
      ? Math.max(...contributions.map(contribution => contribution.area / representedHectares))
      : 1;
    if (largestAreaShare > maximumContributorShare) return [];

    const organizationBrix = contributions.map(contribution => median(contribution.brix));
    const organizationPh = contributions.map(contribution => median(contribution.ph));
    const organizationAcidity = contributions.map(contribution => median(contribution.acidity));
    const organizationProgress = contributions.map(contribution => (
      contribution.estimatedKg > 0
        ? Math.min(100, Math.max(0, contribution.actualKg / contribution.estimatedKg * 100))
        : null
    ));
    const organizationHarvestDates = contributions
      .map(contribution => median(contribution.harvestDates))
      .filter((value): value is number => value !== null);
    const observationDates = contributions.flatMap(contribution => contribution.observationDates).sort();
    const medianBrix = median(organizationBrix);
    const medianPh = median(organizationPh);
    const medianAcidity = median(organizationAcidity);
    const harvestProgress = median(organizationProgress);
    const medianHarvestDate = median(organizationHarvestDates);
    const harvestWindowStart = percentile(organizationHarvestDates, 0.25);
    const harvestWindowEnd = percentile(organizationHarvestDates, 0.75);

    return [{
      id: [
        group.level,
        slugPart(group.country),
        slugPart(group.region),
        slugPart(group.terroir),
        slugPart(group.variety),
        group.vintage,
      ].join('-'),
      level: group.level,
      country: group.country,
      region: group.region,
      terroir: group.terroir,
      variety: group.variety,
      vintage: group.vintage,
      contributors: contributions.length,
      blocks: contributions.reduce((sum, contribution) => sum + contribution.blocks.size, 0),
      representedHectares: rounded(representedHectares, 1),
      attributedContributors: [...new Set(contributions
        .map(contribution => contribution.attributedName)
        .filter(Boolean))]
        .sort((left, right) => left.localeCompare(right)),
      lastObservationDate: observationDates.at(-1) || publishedThrough,
      metrics: {
        medianBrix: medianBrix === null ? null : rounded(medianBrix, 1),
        medianPh: medianPh === null ? null : rounded(medianPh, 2),
        medianTotalAcidityGL: medianAcidity === null ? null : rounded(medianAcidity, 1),
        harvestProgressPct: harvestProgress === null ? null : Math.round(harvestProgress),
        medianHarvestDate: dateForEpoch(medianHarvestDate),
        harvestWindowStart: dateForEpoch(harvestWindowStart),
        harvestWindowEnd: dateForEpoch(harvestWindowEnd),
        phenologyStage: mode(contributions.map(contribution => mode(contribution.phenologyStages))),
        diseasePressure: mode(contributions.map(contribution => strongestPressure(contribution.pressures))),
      },
    }];
  }).sort((left, right) => (
    right.vintage - left.vintage
    || left.country.localeCompare(right.country)
    || left.region.localeCompare(right.region)
    || (left.level === right.level ? 0 : left.level === 'terroir' ? -1 : 1)
    || left.terroir.localeCompare(right.terroir)
    || left.variety.localeCompare(right.variety)
  ));

  return {
    generatedAt: asOf.toISOString(),
    publishedThrough,
    methodology: {
      minimumContributors,
      minimumHectares,
      maximumContributorSharePct: Math.round(maximumContributorShare * 100),
      publicationDelayDays,
      aggregation: 'organization_medians',
    },
    groups: publishedGroups,
  };
}
