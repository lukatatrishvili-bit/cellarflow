import type { GrapeIntakeRecord, VineyardBlock, WineLot } from './wineryState';

export interface PdoRule {
  id: string;
  name: string;
  region: string;
  microzones: string[];
  villages?: string[];
  allowedVarieties: string[];
  wineClass: string[];
  minimumSugarBrix?: number;
  maximumYieldTHa?: number;
  maximumWineYieldLPerT?: number;
  productionMethodNotes: string;
  labelingNotes: string;
}

export interface PdoCheckInput {
  pdoId: string;
  block?: VineyardBlock;
  intake?: GrapeIntakeRecord;
  lot?: WineLot;
}

export interface PdoCheckResult {
  pdo: PdoRule;
  eligible: boolean;
  warnings: string[];
  missing: string[];
}

const norm = (value: unknown): string => String(value || '').trim().toLowerCase();
const includesLoose = (allowed: string[], value: unknown): boolean => {
  const v = norm(value);
  return Boolean(v) && allowed.some(item => v.includes(norm(item)) || norm(item).includes(v));
};

const textScore = (allowed: string[], value: unknown): number => {
  const v = norm(value);
  if (!v) return 0;
  return allowed.some(item => norm(item) === v) ? 3 : includesLoose(allowed, value) ? 2 : 0;
};

export const PDO_RULES: PdoRule[] = [
  {
    id: 'mukuzani',
    name: 'Mukuzani',
    region: 'Kakheti',
    microzones: ['Mukuzani'],
    villages: ['Mukuzani', 'Velistsikhe', 'Vazisubani', 'Chumlaki'],
    allowedVarieties: ['Saperavi'],
    wineClass: ['red'],
    minimumSugarBrix: 19,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Dry red wine from Saperavi in the Mukuzani microzone.',
    labelingNotes: 'Use PDO name only when origin and certification are complete.',
  },
  {
    id: 'kindzmarauli',
    name: 'Kindzmarauli',
    region: 'Kakheti',
    microzones: ['Kindzmarauli', 'Kvareli'],
    villages: ['Kindzmarauli', 'Kvareli', 'Eniseli', 'Shilda'],
    allowedVarieties: ['Saperavi', 'Saperavi Budeshuri'],
    wineClass: ['red'],
    minimumSugarBrix: 22,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Naturally semi-sweet red wine from Saperavi-family grapes.',
    labelingNotes: 'Keep residual sugar and certification evidence with the lot.',
  },
  {
    id: 'tsinandali',
    name: 'Tsinandali',
    region: 'Kakheti',
    microzones: ['Tsinandali', 'Telavi'],
    villages: ['Tsinandali', 'Kisiskhevi', 'Kondoli', 'Vardisubani'],
    allowedVarieties: ['Rkatsiteli', 'Mtsvane', 'Kakhuri Mtsvane'],
    wineClass: ['white'],
    minimumSugarBrix: 19,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Dry white wine traditionally based on Rkatsiteli and Mtsvane.',
    labelingNotes: 'Keep blend composition and origin proof together.',
  },
  {
    id: 'akhasheni',
    name: 'Akhasheni',
    region: 'Kakheti',
    microzones: ['Akhasheni', 'Gurjaani'],
    villages: ['Akhasheni'],
    allowedVarieties: ['Saperavi'],
    wineClass: ['red'],
    minimumSugarBrix: 22,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Naturally semi-sweet red wine from Saperavi.',
    labelingNotes: 'PDO label depends on origin and certification approval.',
  },
  {
    id: 'khvanchkara',
    name: 'Khvanchkara',
    region: 'Racha',
    microzones: ['Khvanchkara', 'Racha'],
    villages: ['Khvanchkara', 'Chrebalo', 'Sadmeli', 'Bugeuli'],
    allowedVarieties: ['Aleksandrouli', 'Mujuretuli'],
    wineClass: ['red'],
    minimumSugarBrix: 22,
    maximumYieldTHa: 8,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Naturally semi-sweet red wine from Aleksandrouli and Mujuretuli.',
    labelingNotes: 'Track blend share by variety.',
  },
  {
    id: 'tvishi',
    name: 'Tvishi',
    region: 'Lechkhumi',
    microzones: ['Tvishi'],
    villages: ['Tvishi'],
    allowedVarieties: ['Tsolikouri'],
    wineClass: ['white'],
    minimumSugarBrix: 21,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'White wine from Tsolikouri in the Tvishi microzone.',
    labelingNotes: 'Keep harvest sugar and village data attached.',
  },
  {
    id: 'kisi_magraani',
    name: 'Kisi Magraani',
    region: 'Kakheti',
    microzones: ['Magraani', 'Akhmeta'],
    villages: ['Magraani'],
    allowedVarieties: ['Kisi'],
    wineClass: ['white', 'amber'],
    minimumSugarBrix: 19,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Kisi wine from the Magraani area.',
    labelingNotes: 'Track qvevri/European method on the lot if relevant.',
  },
  {
    id: 'kvareli',
    name: 'Kvareli',
    region: 'Kakheti',
    microzones: ['Kvareli'],
    villages: ['Kvareli', 'Shilda', 'Eniseli'],
    allowedVarieties: ['Saperavi'],
    wineClass: ['red'],
    minimumSugarBrix: 19,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Dry red Saperavi from the Kvareli area.',
    labelingNotes: 'Separate from Kindzmarauli when wine style/certification differs.',
  },
  {
    id: 'napareuli',
    name: 'Napareuli',
    region: 'Kakheti',
    microzones: ['Napareuli', 'Telavi'],
    villages: ['Napareuli'],
    allowedVarieties: ['Saperavi', 'Rkatsiteli'],
    wineClass: ['red', 'white'],
    minimumSugarBrix: 19,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Dry red or white wine depending on variety.',
    labelingNotes: 'Wine class should match the selected variety and final wine.',
  },
  {
    id: 'manavi',
    name: 'Manavi',
    region: 'Kakheti',
    microzones: ['Manavi', 'Sagarejo'],
    villages: ['Manavi', 'Tokhliauri', 'Giorgitsminda'],
    allowedVarieties: ['Kakhuri Mtsvane', 'Mtsvane', 'Rkatsiteli'],
    wineClass: ['white'],
    minimumSugarBrix: 19,
    maximumYieldTHa: 10,
    maximumWineYieldLPerT: 650,
    productionMethodNotes: 'Dry white wine led by Kakhuri Mtsvane.',
    labelingNotes: 'Track variety composition before PDO labeling.',
  },
];

export function getPdoRule(pdoId: string): PdoRule | undefined {
  const id = norm(pdoId).replace(/\s+/g, '_');
  return PDO_RULES.find(rule => rule.id === id || norm(rule.name) === norm(pdoId));
}

export function checkPdoEligibility(input: PdoCheckInput): PdoCheckResult {
  const pdo = getPdoRule(input.pdoId);
  if (!pdo) throw new Error(`Unknown PDO rule: ${input.pdoId}`);

  const block = input.block;
  const intake = input.intake;
  const lot = input.lot;
  const warnings: string[] = [];
  const missing: string[] = [];

  const variety = intake?.variety || lot?.variety || block?.grapeVariety;
  const wineClass = lot?.wineClass || intake?.wineClass;
  const microzone = intake?.microzone || block?.microzone || lot?.intendedAppellation;
  const village = intake?.village || block?.village;
  const areaHa = block?.parcelArea ?? block?.area;
  const grapeTons = intake?.netWeightKg ? intake.netWeightKg / 1000 : undefined;
  const wineYield = grapeTons && lot?.initialVolume ? lot.initialVolume / grapeTons : undefined;

  if (!block && !intake) missing.push('vineyard/cadastre data');
  if (!microzone) missing.push('microzone');
  else if (!includesLoose(pdo.microzones, microzone)) warnings.push('vineyard outside microzone');

  if (pdo.villages?.length && !village) missing.push('village');
  else if (village && pdo.villages?.length && !includesLoose(pdo.villages, village)) warnings.push('village outside listed PDO villages');

  if (!variety) missing.push('grape variety');
  else if (!includesLoose(pdo.allowedVarieties, variety)) warnings.push('wrong variety');

  if (!wineClass) missing.push('classification / wine class');
  else if (!includesLoose(pdo.wineClass, wineClass)) warnings.push('wrong wine class');

  if (pdo.minimumSugarBrix != null) {
    if (intake?.brix == null || intake.brix === 0) missing.push('grape sugar');
    else if (intake.brix < pdo.minimumSugarBrix) warnings.push('sugar too low');
  }

  if (pdo.maximumYieldTHa != null) {
    if (!areaHa || !grapeTons) missing.push('yield data');
    else if (grapeTons / areaHa > pdo.maximumYieldTHa) warnings.push('yield too high');
  }

  if (pdo.maximumWineYieldLPerT != null) {
    if (!wineYield) missing.push('wine yield data');
    else if (wineYield > pdo.maximumWineYieldLPerT) warnings.push('produced wine volume too high from grape quantity');
  }

  if (lot && !lot.classification) missing.push('missing classification');
  if (block && !(block.cadastralCode || block.id) && !intake?.cadastralCode) missing.push('cadastral code');

  return {
    pdo,
    eligible: warnings.length === 0 && missing.length === 0,
    warnings,
    missing,
  };
}

export interface PdoCandidate extends PdoCheckResult {
  score: number;
  matchedSignals: string[];
}

export function findPdoCandidates(input: Omit<PdoCheckInput, 'pdoId'>): PdoCandidate[] {
  const variety = input.intake?.variety || input.lot?.variety || input.block?.grapeVariety;
  const wineClass = input.lot?.wineClass || input.intake?.wineClass;
  const microzone = input.intake?.microzone || input.block?.microzone || input.lot?.intendedAppellation;
  const village = input.intake?.village || input.block?.village;
  const intended = input.lot?.intendedAppellation;

  return PDO_RULES.map((rule): PdoCandidate => {
    const result = checkPdoEligibility({ ...input, pdoId: rule.id });
    const matchedSignals: string[] = [];
    let score = 0;

    const intendedScore = textScore([rule.name, rule.id, ...rule.microzones], intended);
    if (intendedScore > 0) {
      score += intendedScore + 3;
      matchedSignals.push('intended appellation');
    }

    const microzoneScore = textScore(rule.microzones, microzone);
    if (microzoneScore > 0) {
      score += microzoneScore + 3;
      matchedSignals.push('microzone');
    }

    const villageScore = textScore(rule.villages || [], village);
    if (villageScore > 0) {
      score += villageScore + 1;
      matchedSignals.push('village');
    }

    if (includesLoose(rule.allowedVarieties, variety)) {
      score += 2;
      matchedSignals.push('variety');
    }
    if (includesLoose(rule.wineClass, wineClass)) {
      score += 1;
      matchedSignals.push('wine class');
    }
    if (result.eligible) score += 3;
    score -= result.warnings.length * 2;
    score -= result.missing.length;

    return {
      ...result,
      score,
      matchedSignals,
    };
  }).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aIssues = a.warnings.length + a.missing.length;
    const bIssues = b.warnings.length + b.missing.length;
    if (aIssues !== bIssues) return aIssues - bIssues;
    return a.pdo.name.localeCompare(b.pdo.name);
  });
}

export function suggestPdoCandidate(input: Omit<PdoCheckInput, 'pdoId'>): PdoCandidate | null {
  const [first] = findPdoCandidates(input);
  return first && first.score > 0 ? first : null;
}
