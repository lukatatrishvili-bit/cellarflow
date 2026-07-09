import { describe, expect, it } from 'vitest';
import { evaluateVineyardProjectReadiness } from '../lib/vineyardProjects';
import type { VineyardPlantingProject } from '../lib/wineryState';

const completeProject: VineyardPlantingProject = {
  id: 'VP-1',
  projectName: 'Mukuzani restoration',
  landOwnershipDocumentName: 'land-rights.pdf',
  cadastralMapDocumentName: 'cadastre-map.pdf',
  soilAnalysisDocumentName: 'soil-analysis.pdf',
  agrotechnicalQuestionnaireName: 'agro-questionnaire.pdf',
  plannedVarieties: ['Saperavi'],
  rootstock: '5C',
  spacing: '2.4m x 1.1m',
  rowDirection: 'North-South',
  irrigationPlan: 'Drip irrigation from estate reservoir',
  nurseryInvoiceDocumentName: 'nursery-intent.pdf',
  applicationStatus: 'ready',
  approvalDate: '2026-03-01',
  approvalValidUntil: '2026-08-05',
  soilDepth: 80,
  pH: 7.2,
  organicMatter: 2.1,
  caco3: 8,
  texture: 'loam',
  ec: 0.4,
  exchangeableCa: 18,
  exchangeableMg: 4.2,
  exchangeableNa: 0.3,
  hygroscopicWater: 5.5,
};

describe('vineyard planting project readiness', () => {
  it('marks a complete planting consent file as ready', () => {
    const result = evaluateVineyardProjectReadiness(completeProject, new Date('2026-07-10T00:00:00Z'));
    expect(result.score).toBe(100);
    expect(result.status).toBe('ready');
    expect(result.missing).toEqual([]);
    expect(result.approvalExpiryStatus).toBe('expiring');
    expect(result.daysUntilApprovalExpiry).toBe(26);
  });

  it('flags missing critical project documents and agronomic fields', () => {
    const result = evaluateVineyardProjectReadiness({
      id: 'VP-2',
      projectName: '',
      plannedVarieties: [],
      applicationStatus: 'draft',
    });

    expect(result.status).toBe('missing_critical');
    expect(result.missing).toEqual(expect.arrayContaining([
      'Project name',
      'Land ownership/use document',
      'Cadastral map',
      'Soil analysis document',
      'Agrotechnical questionnaire',
      'Planned varieties',
      'Nursery invoice/intent document',
      'Soil depth',
      'Soil pH',
    ]));
  });

  it('preserves submitted and approved lifecycle statuses', () => {
    expect(evaluateVineyardProjectReadiness({
      ...completeProject,
      applicationStatus: 'submitted',
    }).status).toBe('submitted');

    expect(evaluateVineyardProjectReadiness({
      ...completeProject,
      applicationStatus: 'approved',
      approvalValidUntil: '2026-06-01',
    }, new Date('2026-07-01T00:00:00Z')).approvalExpiryStatus).toBe('expired');
  });
});
