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
  value: unknown,
  critical = false,
): CadastreRequirement {
  return { id, labelEn, labelKa: labelEn, met: hasValue(value), critical };
}

export function calculateCadastreCompleteness(block: VineyardBlock): CadastreCompleteness {
  const hasCoordinates = isValidCoordinate(block.latitude) && isValidCoordinate(block.longitude);
  const requirements: CadastreRequirement[] = [
    req('cadastral_code', 'cadastral code', block.cadastralCode, true),
    req('municipality', 'municipality', block.municipality, true),
    req('village', 'village', block.village, true),
    req('microzone', 'microzone / appellation area', block.microzone, true),
    req('parcel_area', 'parcel or block area', block.parcelArea || block.area, true),
    req('grape_variety', 'grape variety', block.grapeVariety, true),
    req('planting_year', 'planting year', block.plantingYear, true),
    req('spacing', 'row and vine spacing', block.spacing, true),
    req('coordinates', 'GPS coordinates', hasCoordinates, true),
    req('official_document', 'official cadastre document', block.officialCadastreDocumentName),
    req('land_owner', 'land owner or grower', block.landOwner || block.grower),
    req('community', 'community', block.community),
    req('parcel_name', 'parcel name', block.parcelName),
    req('polygon', 'GPS polygon / boundary', hasPolygon(block)),
    req('elevation', 'elevation', block.elevation),
    req('slope', 'slope profile', block.slope),
    req('aspect', 'aspect exposure', block.aspect),
    req('soil_type', 'soil profile', block.soilType),
    req('rootstock', 'rootstock', block.rootstock),
    req('clone', 'clone', block.clone),
    req('irrigation', 'irrigation status', block.irrigationEnabled),
    req('vineyard_condition', 'vineyard condition', block.vineyardCondition),
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
