import type {
  CertificationProductType,
  CertificationRecord,
  LabAnalysis,
  WineLot,
} from './wineryState';
import { scoreRequirements, type ComplianceReadiness, type RequirementCheck } from './compliance';

export interface CertificationChecklistInput {
  productType: CertificationProductType;
  lot: WineLot;
  latestLab?: LabAnalysis;
  certification?: Partial<CertificationRecord>;
}

const LAB_REQUIREMENTS: Record<CertificationProductType, Array<keyof LabAnalysis>> = {
  wine: ['alcoholPct', 'residualSugar', 'titratableAcidity', 'volatileAcid', 'freeSo2', 'totalSo2', 'ph'],
  sparkling_wine: ['alcoholPct', 'residualSugar', 'titratableAcidity', 'volatileAcid', 'freeSo2', 'totalSo2', 'ph', 'pressure'],
  chacha_spirit: ['alcoholPct', 'methanol'],
  grape_must_juice: ['residualSugar', 'titratableAcidity', 'ph', 'density'],
  fortified_wine: ['alcoholPct', 'residualSugar', 'titratableAcidity', 'volatileAcid', 'freeSo2', 'totalSo2', 'ph'],
};

const PRODUCT_LABELS: Record<CertificationProductType, string> = {
  wine: 'wine',
  sparkling_wine: 'sparkling wine',
  chacha_spirit: 'chacha/spirit',
  grape_must_juice: 'grape must/juice',
  fortified_wine: 'fortified wine',
};

const has = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
};

function check(id: string, label: string, value: unknown, critical = false): RequirementCheck {
  return { id, labelEn: label, labelKa: label, met: has(value), critical };
}

export function requiredLabParameters(productType: CertificationProductType): Array<keyof LabAnalysis> {
  return [...LAB_REQUIREMENTS[productType]];
}

export function evaluateCertificationChecklist(input: CertificationChecklistInput): ComplianceReadiness {
  const { productType, lot, latestLab, certification } = input;
  const labChecks = requiredLabParameters(productType).map(field =>
    check(`lab_${String(field)}`, `lab parameter: ${String(field)}`, latestLab?.[field], true),
  );
  const organolepticRequired = certification?.organolepticCheckRequired ?? (productType !== 'grape_must_juice');
  return scoreRequirements('lot', [
    check('product_type', `product type: ${PRODUCT_LABELS[productType]}`, productType, true),
    check('lot', 'linked wine lot', lot.id, true),
    check('sample_prepared', 'sample prepared', certification?.samplePrepared, true),
    check('sample_date', 'sample date', certification?.sampleDate, true),
    check('sample_quantity', 'bottle/sample quantity', certification?.sampleQuantity, true),
    check('lab_protocol', 'lab protocol uploaded', certification?.labProtocolUploaded || certification?.labProtocolFileName, true),
    ...labChecks,
    check('organoleptic_result', 'organoleptic result', organolepticRequired ? certification?.organolepticResult === 'passed' : 'not required'),
    check('balance_check', 'balance check status', certification?.balanceCheckStatus === 'passed'),
    check('application_status', 'application submitted/approved', ['submitted', 'approved'].includes(certification?.applicationStatus || '')),
    check('certificate_number', 'certificate number', certification?.certificateNumber || lot.certificateNumber),
    check('certificate_file', 'certificate file upload', certification?.certificateFileName || lot.certificateFileName),
    check('purpose', 'local market/export purpose', certification?.purpose || lot.marketStatus),
  ]);
}
