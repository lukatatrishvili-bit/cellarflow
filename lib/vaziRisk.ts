import type {
  GrapeSamplingRecord,
  HarvestRecord,
  IrrigationRecord,
  ScoutingRecord,
  SprayRecord,
  VineyardBlock,
} from './wineryState';

export type VaziRiskLevel = 'low' | 'moderate' | 'high' | 'critical';
export type VaziRiskCategory =
  | 'downyMildew'
  | 'powderyMildew'
  | 'botrytis'
  | 'waterStress'
  | 'harvestReadiness'
  | 'phiConflict';

export interface VaziWeatherRiskInput {
  temp?: number;
  tempMax?: number;
  tempMin?: number;
  rainMm?: number;
  wind?: number;
  humidity?: number;
}

export interface VaziRiskItem {
  category: VaziRiskCategory;
  label: string;
  score: number;
  level: VaziRiskLevel;
  reasons: string[];
  nextAction: string;
}

export interface VaziRiskSummary {
  blockId: string;
  overallScore: number;
  overallLevel: VaziRiskLevel;
  items: Record<VaziRiskCategory, VaziRiskItem>;
}

export interface VaziRiskInput {
  block: VineyardBlock;
  weather?: VaziWeatherRiskInput | null;
  sprays?: SprayRecord[];
  scoutings?: ScoutingRecord[];
  samplings?: GrapeSamplingRecord[];
  harvests?: HarvestRecord[];
  irrigationLogs?: IrrigationRecord[];
  today?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function levelFromScore(score: number): VaziRiskLevel {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 35) return 'moderate';
  return 'low';
}

function daysBetween(from?: string, to = new Date()): number | null {
  if (!from) return null;
  const start = new Date(from.slice(0, 10)).getTime();
  const end = new Date(to.toISOString().slice(0, 10)).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / DAY_MS);
}

function daysUntil(date?: string, today = new Date()): number | null {
  if (!date) return null;
  const target = new Date(date.slice(0, 10)).getTime();
  const start = new Date(today.toISOString().slice(0, 10)).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(start)) return null;
  return Math.ceil((target - start) / DAY_MS);
}

function latestByDate<T extends { date: string }>(items: T[]): T | null {
  return [...items].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function latestHarvestDate(block: VineyardBlock, harvests: HarvestRecord[]): string | undefined {
  const planned = [...harvests.filter(item => item.blockId === block.id)]
    .sort((a, b) => (b.actualHarvestDate || b.estimatedHarvestDate).localeCompare(a.actualHarvestDate || a.estimatedHarvestDate))[0];
  return planned?.actualHarvestDate || planned?.estimatedHarvestDate || block.estimatedHarvestDate;
}

function scoutingPressure(scoutings: ScoutingRecord[], problem: string, today: Date): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const matches = scoutings.filter(item => item.problemType.toLowerCase().includes(problem.toLowerCase()));
  const recent = matches.filter(item => {
    const age = daysBetween(item.date, today);
    return age !== null && age <= 21;
  });

  if (matches.length > recent.length) {
    score += 8;
    reasons.push(`${problem} history exists`);
  }
  for (const item of recent) {
    const add = item.severity === 'high' ? 40 : item.severity === 'medium' ? 25 : 12;
    score = Math.max(score, add);
    reasons.push(`${item.severity} scouting on ${item.date}`);
  }
  return { score, reasons };
}

function sprayProtection(sprays: SprayRecord[], target: string, today: Date): { reduction: number; reason?: string } {
  const last = latestByDate(sprays.filter(item => item.targetProblem.toLowerCase().includes(target.toLowerCase())));
  if (!last) return { reduction: 0 };
  const age = daysBetween(last.date, today);
  if (age === null) return { reduction: 0 };
  if (age <= 7) return { reduction: 22, reason: `recent ${target} protection ${age} days ago` };
  if (age <= 14) return { reduction: 12, reason: `${target} protection ${age} days ago` };
  return { reduction: 0, reason: `last ${target} protection ${age} days ago` };
}

function makeItem(category: VaziRiskCategory, label: string, score: number, reasons: string[], nextAction: string): VaziRiskItem {
  const safeScore = clampScore(score);
  return {
    category,
    label,
    score: safeScore,
    level: levelFromScore(safeScore),
    reasons: reasons.length ? reasons : ['No elevated signal'],
    nextAction,
  };
}

export function calculateVaziRisk(input: VaziRiskInput): VaziRiskSummary {
  const {
    block,
    weather,
    sprays = [],
    scoutings = [],
    samplings = [],
    harvests = [],
    irrigationLogs = [],
    today = new Date(),
  } = input;
  const blockSprays = sprays.filter(item => item.blockId === block.id);
  const blockScoutings = scoutings.filter(item => item.blockId === block.id);
  const blockSamples = samplings.filter(item => item.blockId === block.id);
  const blockHarvests = harvests.filter(item => item.blockId === block.id);
  const blockIrrigation = irrigationLogs.filter(item => item.blockId === block.id);
  const phenology = block.currentPhenology.toLowerCase();
  const temp = weather?.temp ?? weather?.tempMax ?? 0;
  const tempMax = weather?.tempMax ?? weather?.temp ?? 0;
  const rain = weather?.rainMm ?? 0;
  const humidity = weather?.humidity ?? 0;

  const susceptibleCanopy = /flower|fruit|veraison|ripen|berry|bunch|harvest/i.test(phenology);
  const ripeningCanopy = /veraison|ripen|harvest|maturity/i.test(phenology);

  const downyReasons: string[] = [];
  let downy = 12;
  if (rain >= 8) { downy += 28; downyReasons.push(`${rain} mm rain`); }
  else if (rain > 0) { downy += 16; downyReasons.push(`${rain} mm rain`); }
  if (humidity >= 85) { downy += 25; downyReasons.push(`${humidity}% humidity`); }
  else if (humidity >= 75) { downy += 15; downyReasons.push(`${humidity}% humidity`); }
  if (temp >= 12 && temp <= 28) { downy += 12; downyReasons.push('temperature in mildew window'); }
  if (susceptibleCanopy) { downy += 8; downyReasons.push(`susceptible stage: ${block.currentPhenology}`); }
  const downyScout = scoutingPressure(blockScoutings, 'Downy mildew', today);
  downy += downyScout.score;
  downyReasons.push(...downyScout.reasons);
  const downyProtection = sprayProtection(blockSprays, 'Downy', today);
  downy -= downyProtection.reduction;
  if (downyProtection.reason) downyReasons.push(downyProtection.reason);

  const powderyReasons: string[] = [];
  let powdery = 10;
  if (temp >= 20 && temp <= 30) { powdery += 22; powderyReasons.push('warm powdery mildew window'); }
  if (humidity >= 50 && humidity <= 85) { powdery += 14; powderyReasons.push(`${humidity}% humidity`); }
  if (rain === 0 && tempMax > 26) { powdery += 10; powderyReasons.push('dry warm canopy'); }
  if (susceptibleCanopy) { powdery += 8; powderyReasons.push(`susceptible stage: ${block.currentPhenology}`); }
  const powderyScout = scoutingPressure(blockScoutings, 'Powdery mildew', today);
  powdery += powderyScout.score;
  powderyReasons.push(...powderyScout.reasons);
  const powderyProtection = sprayProtection(blockSprays, 'Powdery', today);
  powdery -= powderyProtection.reduction;
  if (powderyProtection.reason) powderyReasons.push(powderyProtection.reason);

  const botrytisReasons: string[] = [];
  let botrytis = 8;
  if (ripeningCanopy) { botrytis += 20; botrytisReasons.push(`ripening stage: ${block.currentPhenology}`); }
  if (humidity >= 85) { botrytis += 20; botrytisReasons.push(`${humidity}% humidity`); }
  if (rain >= 5) { botrytis += 18; botrytisReasons.push(`${rain} mm rain`); }
  const botrytisScout = scoutingPressure(blockScoutings, 'Botrytis', today);
  botrytis += botrytisScout.score;
  botrytisReasons.push(...botrytisScout.reasons);

  const waterReasons: string[] = [];
  let waterStress = 12;
  const latestIrrigation = latestByDate(blockIrrigation);
  const irrigationAge = latestIrrigation ? daysBetween(latestIrrigation.date, today) : null;
  if (tempMax >= 35) { waterStress += 28; waterReasons.push(`${tempMax} C heat`); }
  else if (tempMax >= 31) { waterStress += 18; waterReasons.push(`${tempMax} C heat`); }
  if (rain <= 0.5) { waterStress += 18; waterReasons.push('no useful rain'); }
  if (block.irrigationEnabled && irrigationAge !== null && irrigationAge <= 7) {
    waterStress -= 18;
    waterReasons.push(`irrigated ${irrigationAge} days ago`);
  } else if (block.irrigationEnabled) {
    waterReasons.push('irrigation enabled, recent event not logged');
  } else {
    waterStress += 12;
    waterReasons.push('no irrigation system');
  }
  const waterScout = scoutingPressure(blockScoutings, 'Water stress', today);
  waterStress += waterScout.score;
  waterReasons.push(...waterScout.reasons);

  const harvestReasons: string[] = [];
  let harvestReadiness = 10;
  const latestSample = latestByDate(blockSamples);
  const harvestDate = latestHarvestDate(block, blockHarvests);
  const harvestDays = daysUntil(harvestDate, today);
  if (latestSample) {
    if (latestSample.brix >= 22) { harvestReadiness += 28; harvestReasons.push(`${latestSample.brix} Brix`); }
    else if (latestSample.brix >= 20) { harvestReadiness += 16; harvestReasons.push(`${latestSample.brix} Brix`); }
    if (latestSample.phenolicMaturity === 'Optimal') { harvestReadiness += 22; harvestReasons.push('optimal phenolic maturity'); }
    if (latestSample.diseaseCondition.toLowerCase().includes('rot')) { harvestReadiness += 18; harvestReasons.push('disease pressure on fruit'); }
  }
  if (harvestDays !== null && harvestDays <= 7 && harvestDays >= 0) { harvestReadiness += 24; harvestReasons.push(`harvest in ${harvestDays} days`); }
  if (ripeningCanopy) { harvestReadiness += 10; harvestReasons.push(`stage: ${block.currentPhenology}`); }

  const phiReasons: string[] = [];
  let phiConflict = 5;
  const lastSpray = latestByDate(blockSprays);
  if (lastSpray) {
    const sprayDate = new Date(`${lastSpray.date.slice(0, 10)}T12:00:00`);
    sprayDate.setDate(sprayDate.getDate() + lastSpray.preHarvestIntervalDays);
    const safeDate = sprayDate.toISOString().slice(0, 10);
    const daysToSafe = daysUntil(safeDate, today);
    const daysToHarvest = daysUntil(harvestDate, today);
    if (daysToSafe !== null && daysToSafe > 0) {
      phiConflict += daysToSafe <= 7 ? 35 : 20;
      phiReasons.push(`PHI open until ${safeDate}`);
    }
    if (daysToSafe !== null && daysToHarvest !== null && daysToHarvest < daysToSafe) {
      phiConflict += 45;
      phiReasons.push(`planned harvest before PHI clears`);
    }
  } else {
    phiReasons.push('no spray PHI record');
  }

  const items: VaziRiskSummary['items'] = {
    downyMildew: makeItem('downyMildew', 'Downy mildew', downy, downyReasons, 'Scout canopy and review protective interval before any treatment.'),
    powderyMildew: makeItem('powderyMildew', 'Powdery mildew', powdery, powderyReasons, 'Check leaves and clusters; record scouting before action.'),
    botrytis: makeItem('botrytis', 'Botrytis', botrytis, botrytisReasons, 'Inspect bunch zones and manage humidity/canopy airflow.'),
    waterStress: makeItem('waterStress', 'Water stress', waterStress, waterReasons, 'Check soil moisture and irrigation logs before scheduling water.'),
    harvestReadiness: makeItem('harvestReadiness', 'Harvest readiness', harvestReadiness, harvestReasons, 'Confirm sampling, fruit condition, and harvest crew timing.'),
    phiConflict: makeItem('phiConflict', 'PHI conflict', phiConflict, phiReasons, 'Do not harvest until the pre-harvest interval is clear.'),
  };
  const riskItems = [
    items.downyMildew,
    items.powderyMildew,
    items.botrytis,
    items.waterStress,
    items.phiConflict,
  ];
  const overallScore = Math.max(...riskItems.map(item => item.score), 0);
  return {
    blockId: block.id,
    overallScore,
    overallLevel: levelFromScore(overallScore),
    items,
  };
}

export function vaziRiskColor(level: VaziRiskLevel): string {
  if (level === 'critical') return '#b91c1c';
  if (level === 'high') return '#ef4444';
  if (level === 'moderate') return '#eab308';
  return '#10b981';
}
