import type { VineyardBlock } from './wineryState';

export type CadastreBadge =
  | 'Complete'
  | 'Good'
  | 'Needs review'
  | 'Missing critical data'
  | 'Not started';

export interface CadastreRequirement {
  id: string;
  labelEn: string;
  labelKa: string;
  met: boolean;
  critical?: boolean;
}

export interface CadastreCompleteness {
  score: number;
  badge: CadastreBadge;
  missing: string[];
  missingCritical: string[];
  requirements: CadastreRequirement[];
}

const hasValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const isValidCoordinate = (value: unknown): boolean => (
  typeof value === 'number' && Number.isFinite(value)
);

const hasPolygon = (block: VineyardBlock): boolean => {
  const polygon = block.gpsPolygon || block.boundary;
  return Array.isArray(polygon)
    && polygon.length >= 3
    && polygon.every(point => isValidCoordinate(point?.lat) && isValidCoordinate(point?.lng));
};

function req(
  id: string,
  labelEn: string,
  labelKa: string,
  value: unknown,
  critical = false,
): CadastreRequirement {
  return { id, labelEn, labelKa, met: hasValue(value), critical };
}

/** Georgian display names for the completeness badges (canonical values stay English). */
export function cadastreBadgeLabel(badge: CadastreBadge, lang: string): string {
  if (lang !== 'ka') return badge;
  const ka: Record<CadastreBadge, string> = {
    'Complete': 'სრული',
    'Good': 'კარგი',
    'Needs review': 'გადასამოწმებელი',
    'Missing critical data': 'აკლია კრიტიკული მონაცემები',
    'Not started': 'დაუწყებელი',
  };
  return ka[badge] || badge;
}

export function calculateCadastreCompleteness(block: VineyardBlock): CadastreCompleteness {
  const hasCoordinates = isValidCoordinate(block.latitude) && isValidCoordinate(block.longitude);
  const requirements: CadastreRequirement[] = [
    req('cadastral_code', 'cadastral code', 'საკადასტრო კოდი', block.cadastralCode, true),
    req('municipality', 'municipality', 'მუნიციპალიტეტი', block.municipality, true),
    req('village', 'village', 'სოფელი', block.village, true),
    req('microzone', 'microzone / appellation area', 'მიკროზონა / დასახელების ზონა', block.microzone, true),
    req('parcel_area', 'parcel or block area', 'ნაკვეთის ფართობი', block.parcelArea || block.area, true),
    req('grape_variety', 'grape variety', 'ყურძნის ჯიში', block.grapeVariety, true),
    req('planting_year', 'planting year', 'დარგვის წელი', block.plantingYear, true),
    req('spacing', 'row and vine spacing', 'დარგვის სქემა', block.spacing, true),
    req('coordinates', 'GPS coordinates', 'GPS კოორდინატები', hasCoordinates, true),
    req('official_document', 'official cadastre document', 'ოფიციალური საკადასტრო დოკუმენტი', block.officialCadastreDocumentName),
    req('land_owner', 'land owner or grower', 'მიწის მესაკუთრე ან მევენახე', block.landOwner || block.grower),
    req('community', 'community', 'თემი', block.community, true),
    req('parcel_name', 'parcel name', 'ნაკვეთის დასახელება', block.parcelName),
    req('polygon', 'GPS polygon / boundary', 'GPS პოლიგონი / საზღვარი', hasPolygon(block)),
    req('elevation', 'elevation', 'სიმაღლე', block.elevation),
    req('slope', 'slope profile', 'დაქანება', block.slope),
    req('aspect', 'aspect exposure', 'ექსპოზიცია', block.aspect),
    req('soil_type', 'soil profile', 'ნიადაგის პროფილი', block.soilType),
    req('rootstock', 'rootstock', 'საძირე', block.rootstock),
    req('clone', 'clone', 'კლონი', block.clone),
    req('irrigation', 'irrigation status', 'მორწყვის სტატუსი', block.irrigationEnabled),
    req('vineyard_condition', 'vineyard condition', 'ვენახის მდგომარეობა', block.vineyardCondition),
  ];

  const total = requirements.length || 1;
  const metCount = requirements.filter(item => item.met).length;
  const score = Math.round((metCount / total) * 100);
  const missingReqs = requirements.filter(item => !item.met);
  const missingCritical = missingReqs.filter(item => item.critical).map(item => item.labelEn);

  let badge: CadastreBadge;
  if (score === 0) badge = 'Not started';
  else if (missingCritical.length > 0) badge = score < 50 ? 'Missing critical data' : 'Needs review';
  else if (score >= 85) badge = 'Complete';
  else badge = 'Good';

  return {
    score,
    badge,
    missing: missingReqs.map(item => item.labelEn),
    missingCritical,
    requirements,
  };
}

export function cadastreSummaryLine(block: VineyardBlock): string {
  const readiness = calculateCadastreCompleteness(block);
  const criticalSuffix = readiness.missingCritical.length
    ? `, missing ${readiness.missingCritical.join(', ')}`
    : '';
  return `${readiness.score}% cadastre mirror (${readiness.badge}${criticalSuffix})`;
}
