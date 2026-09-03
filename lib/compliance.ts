import type {
  BottlingRunRecord,
  CompanyProfile,
  GrapeIntakeRecord,
  LabAnalysis,
  VineyardBlock,
  WineLot,
} from './wineryState';
import type { FormTemplate, ValidationWarning, DocRow } from './georgianForms';
import { calculateCadastreCompleteness } from './cadastre';
import { isActiveBottlingRun } from './bottlingIntegrity';
import { isActiveHarvestIntake } from './harvestIntakeIntegrity';

export type ComplianceBadge =
  | 'Ready'
  | 'Needs review'
  | 'Missing critical data'
  | 'Exportable with warnings'
  | 'Not ready';

export interface RequirementCheck {
  id: string;
  labelEn: string;
  labelKa: string;
  met: boolean;
  critical?: boolean;
  detail?: string;
}

export interface ComplianceReadiness {
  scope: 'company' | 'lot' | 'document' | 'accounting_year';
  score: number;
  badge: ComplianceBadge;
  missing: string[];
  missingCritical: string[];
  requirements: RequirementCheck[];
}

const hasValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

function req(
  id: string,
  labelEn: string,
  labelKa: string,
  value: unknown,
  critical = false,
  detail?: string,
): RequirementCheck {
  return { id, labelEn, labelKa, met: hasValue(value), critical, detail };
}

export function scoreRequirements(scope: ComplianceReadiness['scope'], requirements: RequirementCheck[]): ComplianceReadiness {
  const total = requirements.length || 1;
  const met = requirements.filter(r => r.met).length;
  const score = Math.round((met / total) * 100);
  const missingReqs = requirements.filter(r => !r.met);
  const missingCritical = missingReqs.filter(r => r.critical).map(r => r.labelEn);
  let badge: ComplianceBadge;
  if (score >= 95 && missingCritical.length === 0) badge = 'Ready';
  else if (missingCritical.length > 0) badge = score < 45 ? 'Not ready' : 'Missing critical data';
  else if (score >= 75) badge = 'Exportable with warnings';
  else badge = 'Needs review';
  return {
    scope,
    score,
    badge,
    missing: missingReqs.map(r => r.labelEn),
    missingCritical,
    requirements,
  };
}

export function evaluateCompanyProfile(company: CompanyProfile): ComplianceReadiness {
  return scoreRequirements('company', [
    req('company_name', 'company name', 'კომპანიის სახელი', company.companyName, true),
    req('id_code', 'company ID code', 'საიდენტიფიკაციო კოდი', company.identificationCode, true),
    req('agency_code', 'Wine Agency registration code', 'ღვინის სააგენტოს რეგისტრაციის კოდი', company.wineAgencyRegistrationCode),
    req('legal_address', 'legal address', 'იურიდიული მისამართი', company.legalAddress || company.address, true),
    req('factual_address', 'factual address', 'ფაქტობრივი მისამართი', company.factualAddress || company.address),
    req('certificate_contact', 'certificate contact person', 'სერტიფიკატის საკონტაქტო პირი', company.certificateContactPerson),
    req('certificate_phone', 'certificate phone', 'სერტიფიკატის ტელეფონი', company.certificatePhone || company.phone),
    req('certificate_email', 'certificate email', 'სერტიფიკატის ელფოსტა', company.certificateEmail || company.contactEmail),
  ]);
}

function findLotBlock(lot: WineLot, blocks: VineyardBlock[]): VineyardBlock | undefined {
  return blocks.find(b => b.id === lot.vineyardBlock || b.name === lot.vineyardBlock || b.parcelName === lot.vineyardBlock);
}

export function evaluateLotCompliance(input: {
  lot: WineLot;
  company: CompanyProfile;
  grapeIntakes: GrapeIntakeRecord[];
  blocks: VineyardBlock[];
  labLogs: LabAnalysis[];
  bottlingRuns: BottlingRunRecord[];
}): ComplianceReadiness {
  const { lot, company, grapeIntakes, blocks, labLogs, bottlingRuns } = input;
  const intake = grapeIntakes.find(g => isActiveHarvestIntake(g) && g.createdLotId === lot.id);
  const block = intake?.blockId ? blocks.find(b => b.id === intake.blockId) : findLotBlock(lot, blocks);
  const isBottled = lot.stage === 'bottled' || lot.stage === 'sold';
  const pdoLike = lot.classification === 'PDO' || hasValue(lot.intendedAppellation);

  return scoreRequirements('lot', [
    req('company_id', 'company ID code', 'კომპანიის საიდენტიფიკაციო კოდი', company.identificationCode, true),
    req('lot_id', 'lot code', 'ლოტის კოდი', lot.id, true),
    req('intake_link', 'linked grape intake', 'დაკავშირებული ყურძნის მიღება', intake, true),
    req('transport', 'transport number', 'ტრანსპორტის ნომერი', intake?.transportNumber || intake?.transportName, true),
    req('lab_analysis_no', 'lab analysis number', 'ლაბორატორიული ანალიზის ნომერი', intake?.labAnalysisNumber),
    req('cadastre', 'cadastral code', 'საკადასტრო კოდი', intake?.cadastralCode || block?.cadastralCode, true),
    req('municipality', 'municipality', 'მუნიციპალიტეტი', intake?.municipality || block?.municipality, true),
    req('community', 'community', 'თემი', intake?.community || block?.community, true),
    req('village', 'village', 'სოფელი', intake?.village || block?.village, true),
    req('classification', 'PDO/PGI/table classification', 'PDO/PGI/სუფრის კლასიფიკაცია', lot.classification, true),
    req('intended_appellation', 'intended appellation/PDO', 'დაგეგმილი ადგილწარმოშობა/PDO', pdoLike ? lot.intendedAppellation : 'not required'),
    req('origin_proof', 'origin proof status', 'წარმოშობის დადასტურება', lot.originProofStatus === 'verified' ? lot.originProofStatus : ''),
    req('lab_result', 'latest lab result', 'ლაბორატორიული შედეგი', labLogs.some(l => l.lotId === lot.id)),
    req('certificate_file', 'certificate file', 'სერტიფიკატის ფაილი', lot.certificateFileName || lot.certificateNumber),
    req('bottling_act', 'bottling act', 'ჩამოსხმის აქტი', isBottled ? bottlingRuns.some(r => r.lotId === lot.id && isActiveBottlingRun(r)) : 'not required'),
  ]);
}

export function evaluateDocumentReadiness(input: {
  template: FormTemplate;
  rows: DocRow[];
  warnings: ValidationWarning[];
}): ComplianceReadiness {
  const errors = input.warnings.filter(w => w.level === 'error');
  const warnings = input.warnings.filter(w => w.level === 'warning');
  return scoreRequirements('document', [
    req('has_rows', 'document rows', 'დოკუმენტის სტრიქონები', input.rows.length > 0, true),
    req('no_errors', 'no blocking validation errors', 'ბლოკირების შეცდომების გარეშე', errors.length === 0, true),
    req('few_warnings', 'no missing-field warnings', 'აკლებული ველების გაფრთხილებების გარეშე', warnings.length === 0),
    req('data_source', 'app data source connected', 'აპის მონაცემების წყარო დაკავშირებულია', input.template.dataSource || ''),
  ]);
}

export function evaluateAccountingYear(input: {
  year: number;
  company: CompanyProfile;
  blocks: VineyardBlock[];
  lots: WineLot[];
  grapeIntakes: GrapeIntakeRecord[];
  bottlingRuns: BottlingRunRecord[];
}): ComplianceReadiness {
  const year = String(input.year);
  const yearIntakes = input.grapeIntakes.filter(g => isActiveHarvestIntake(g) && (g.date || '').startsWith(year));
  const yearLots = input.lots.filter(l => !l.voidedAt && (String(l.vintage) === year || (l.createdAt || '').startsWith(year)));
  return scoreRequirements('accounting_year', [
    req('company_ready', 'company profile ready', 'კომპანიის პროფილი მზადაა', evaluateCompanyProfile(input.company).missingCritical.length === 0, true),
    req('vineyard_blocks', 'vineyard blocks registered', 'ვენახის ნაკვეთები რეგისტრირებულია', input.blocks.length > 0),
    req('cadastre_blocks', 'cadastre fields on vineyard blocks', 'საკადასტრო ველები ნაკვეთებზე', input.blocks.length > 0 && input.blocks.every(b => calculateCadastreCompleteness(b).missingCritical.length === 0)),
    req('grape_intakes', 'grape intakes for year', 'წლის ყურძნის მიღებები', yearIntakes.length > 0, true),
    req('transport_intakes', 'transport/lab fields on intakes', 'ტრანსპორტი/ლაბ. ველები მიღებებზე', yearIntakes.length > 0 && yearIntakes.every(g => hasValue(g.transportNumber || g.transportName) && hasValue(g.labAnalysisNumber))),
    req('lots', 'wine lots for year', 'წლის ღვინის ლოტები', yearLots.length > 0),
    req('classifications', 'lot classifications set', 'ლოტის კლასიფიკაციები შევსებულია', yearLots.length > 0 && yearLots.every(l => hasValue(l.classification))),
    req('bottling_runs', 'bottling acts where applicable', 'ჩამოსხმის აქტები საჭიროებისამებრ', yearLots.every(l => !['bottled', 'sold'].includes(l.stage) || input.bottlingRuns.some(r => r.lotId === l.id && isActiveBottlingRun(r)))),
  ]);
}
