import type { VineyardPlantingProject } from './wineryState';

export interface VineyardProjectRequirement {
  key: keyof VineyardPlantingProject | 'plannedVarieties';
  label: string;
  complete: boolean;
  critical?: boolean;
}

export interface VineyardProjectReadiness {
  score: number;
  status: 'ready' | 'needs_review' | 'missing_critical' | 'approved' | 'submitted' | 'rejected';
  missing: string[];
  requirements: VineyardProjectRequirement[];
  daysUntilApprovalExpiry: number | null;
  approvalExpiryStatus: 'not_applicable' | 'valid' | 'expiring' | 'expired';
}

const DAY_MS = 24 * 60 * 60 * 1000;

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function daysUntil(date?: string, now = new Date()): number | null {
  if (!date) return null;
  const target = new Date(date.slice(0, 10)).getTime();
  const start = new Date(now.toISOString().slice(0, 10)).getTime();
  if (!Number.isFinite(target) || !Number.isFinite(start)) return null;
  return Math.ceil((target - start) / DAY_MS);
}

export function evaluateVineyardProjectReadiness(
  project: VineyardPlantingProject,
  now = new Date(),
): VineyardProjectReadiness {
  const requirements: VineyardProjectRequirement[] = [
    { key: 'projectName', label: 'Project name', complete: hasText(project.projectName), critical: true },
    { key: 'landOwnershipDocumentName', label: 'Land ownership/use document', complete: hasText(project.landOwnershipDocumentName), critical: true },
    { key: 'cadastralMapDocumentName', label: 'Cadastral map', complete: hasText(project.cadastralMapDocumentName), critical: true },
    { key: 'soilAnalysisDocumentName', label: 'Soil analysis document', complete: hasText(project.soilAnalysisDocumentName), critical: true },
    { key: 'agrotechnicalQuestionnaireName', label: 'Agrotechnical questionnaire', complete: hasText(project.agrotechnicalQuestionnaireName), critical: true },
    { key: 'plannedVarieties', label: 'Planned varieties', complete: Array.isArray(project.plannedVarieties) && project.plannedVarieties.length > 0, critical: true },
    { key: 'rootstock', label: 'Rootstock', complete: hasText(project.rootstock) },
    { key: 'spacing', label: 'Spacing', complete: hasText(project.spacing) },
    { key: 'rowDirection', label: 'Row direction', complete: hasText(project.rowDirection) },
    { key: 'irrigationPlan', label: 'Irrigation plan', complete: hasText(project.irrigationPlan) },
    { key: 'nurseryInvoiceDocumentName', label: 'Nursery invoice/intent document', complete: hasText(project.nurseryInvoiceDocumentName), critical: true },
    { key: 'soilDepth', label: 'Soil depth', complete: hasNumber(project.soilDepth) },
    { key: 'pH', label: 'Soil pH', complete: hasNumber(project.pH) },
    { key: 'organicMatter', label: 'Organic matter', complete: hasNumber(project.organicMatter) },
    { key: 'caco3', label: 'CaCO3', complete: hasNumber(project.caco3) },
    { key: 'texture', label: 'Texture', complete: hasText(project.texture) },
    { key: 'ec', label: 'EC', complete: hasNumber(project.ec) },
    { key: 'exchangeableCa', label: 'Exchangeable Ca', complete: hasNumber(project.exchangeableCa) },
    { key: 'exchangeableMg', label: 'Exchangeable Mg', complete: hasNumber(project.exchangeableMg) },
    { key: 'exchangeableNa', label: 'Exchangeable Na', complete: hasNumber(project.exchangeableNa) },
    { key: 'hygroscopicWater', label: 'Hygroscopic water', complete: hasNumber(project.hygroscopicWater) },
  ];

  const completeCount = requirements.filter(item => item.complete).length;
  const score = Math.round((completeCount / requirements.length) * 100);
  const missing = requirements.filter(item => !item.complete).map(item => item.label);
  const missingCritical = requirements.some(item => item.critical && !item.complete);
  const expiryDays = daysUntil(project.approvalValidUntil, now);
  const approvalExpiryStatus = expiryDays === null
    ? 'not_applicable'
    : expiryDays < 0
      ? 'expired'
      : expiryDays <= 30
        ? 'expiring'
        : 'valid';

  let status: VineyardProjectReadiness['status'];
  if (project.applicationStatus === 'rejected') status = 'rejected';
  else if (project.applicationStatus === 'approved') status = 'approved';
  else if (project.applicationStatus === 'submitted') status = 'submitted';
  else if (missingCritical || score < 65) status = 'missing_critical';
  else if (score >= 90) status = 'ready';
  else status = 'needs_review';

  return {
    score,
    status,
    missing,
    requirements,
    daysUntilApprovalExpiry: expiryDays,
    approvalExpiryStatus,
  };
}
