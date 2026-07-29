import { describe, expect, it } from 'vitest';
import { buildAgencyDeadlineCalendar, nextAgencyDeadline } from '../lib/agencyCalendar';
import { evaluateCertificationChecklist, requiredLabParameters } from '../lib/certification';
import { evaluateCompanyProfile, evaluateLotCompliance, scoreRequirements } from '../lib/compliance';
import { checkPdoEligibility, findPdoCandidates, suggestPdoCandidate } from '../lib/pdo';
import { calculateQvevriDurations, evaluateQvevriPassport } from '../lib/qvevri';
import type { CompanyProfile, GrapeIntakeRecord, LabAnalysis, Vessel, VineyardBlock, WineLot } from '../lib/wineryState';

const company: CompanyProfile = {
  companyName: 'VinOS Estate',
  wineryName: 'Main Marani',
  country: 'Georgia',
  region: 'Kakheti',
  municipality: 'Gurjaani',
  address: 'Mukuzani',
  legalAddress: 'Legal 1',
  factualAddress: 'Marani 1',
  identificationCode: '404000000',
  wineAgencyRegistrationCode: 'WA-1',
  certificateContactPerson: 'Nino',
  certificatePhone: '+995555000000',
  certificateEmail: 'cert@example.com',
  contactEmail: 'info@example.com',
  phone: '+995555000001',
  website: '',
  measurementUnits: 'metric',
  currency: 'GEL',
};

const block: VineyardBlock = {
  id: 'BLK-1',
  name: 'Mukuzani 1',
  vineyardName: 'Mukuzani',
  locationName: 'Mukuzani, Gurjaani, Kakheti',
  cadastralCode: '51.01.01.001',
  municipality: 'Gurjaani',
  village: 'Mukuzani',
  microzone: 'Mukuzani',
  latitude: 41.8,
  longitude: 45.7,
  area: 1.5,
  elevation: 480,
  slope: 'S',
  aspect: 'S',
  soilType: 'clay',
  grapeVariety: 'Saperavi',
  plantingYear: 2015,
  spacing: '2.0 x 1.0',
  rowsCount: 20,
  vinesCount: 4000,
  trainingSystem: 'Guyot',
  pruningSystem: 'cane',
  irrigationEnabled: false,
  farmingStatus: 'conventional',
  currentPhenology: 'ripe',
  estimatedHarvestDate: '2026-09-20',
  notes: '',
};

const lot: WineLot = {
  id: 'LOT-1',
  name: 'Mukuzani 2026',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'BLK-1',
  region: 'Kakheti',
  initialVolume: 850,
  currentVolume: 820,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-23',
  intendedAppellation: 'Mukuzani',
  classification: 'PDO',
  originProofStatus: 'verified',
  certificateNumber: 'CERT-1',
  marketStatus: 'export',
  history: [],
};

const intake: GrapeIntakeRecord = {
  id: 'GI-1',
  date: '2026-09-23',
  source: 'own',
  blockId: 'BLK-1',
  blockName: 'Mukuzani 1',
  transportName: 'Truck',
  transportNumber: 'AA-001-AA',
  weighingDocumentNumber: 'W-1',
  labAnalysisNumber: 'LAB-1',
  cadastralCode: '51.01.01.001',
  municipality: 'Gurjaani',
  village: 'Mukuzani',
  microzone: 'Mukuzani',
  variety: 'Saperavi',
  vintage: 2026,
  grossWeightKg: 1600,
  tareWeightKg: 100,
  netWeightKg: 1500,
  brix: 23,
  ph: 3.4,
  titratableAcidity: 5.6,
  temperatureC: 18,
  condition: 'excellent',
  pickingMethod: 'hand',
  wineClass: 'red',
  juiceYieldPct: 60,
  estimatedVolumeL: 900,
  destinationVesselId: null,
  createdLotId: 'LOT-1',
  operator: 'Nino',
  notes: '',
};

const lab: LabAnalysis = {
  id: 'LAB-1',
  lotId: 'LOT-1',
  tankId: 'T-1',
  date: '2026-10-01',
  alcoholPct: 13,
  volatileAcid: 0.4,
  freeSo2: 25,
  totalSo2: 80,
  residualSugar: 2,
  ph: 3.45,
  malicAcid: 0,
  lacticAcid: 1,
  turbidity: 10,
  technician: 'Ana',
  titratableAcidity: 5.7,
};

describe('compliance readiness', () => {
  it('scores company profile completeness and reports missing critical fields', () => {
    const ready = evaluateCompanyProfile(company);
    expect(ready.score).toBe(100);
    const incomplete = evaluateCompanyProfile({ ...company, identificationCode: '' });
    expect(incomplete.badge).toBe('Missing critical data');
    expect(incomplete.missingCritical).toContain('company ID code');
  });

  it('scores lot compliance from linked intake, lab, origin, and certificate data', () => {
    const result = evaluateLotCompliance({
      lot,
      company,
      grapeIntakes: [intake],
      blocks: [block],
      labLogs: [lab],
      bottlingRuns: [],
    });
    expect(result.score).toBeGreaterThan(80);
    expect(result.missing).not.toContain('transport number');
  });
});

describe('agency deadline calendar', () => {
  it('creates the required annual Georgian Wine Agency reminders', () => {
    const readiness = scoreRequirements('document', []);
    const reminders = buildAgencyDeadlineCalendar(2026, {
      annex_16_vineyard_notification: readiness,
    });
    expect(reminders.map(r => r.deadline)).toEqual([
      '2026-01-10',
      '2026-01-10',
      '2026-01-10',
      '2026-07-01',
      '2026-12-01',
    ]);
    expect(reminders.find(r => r.formId === 'annex_17_processing_notification')?.labelEn).toContain('Grape processing');
    expect(nextAgencyDeadline('2026-06-30', reminders)?.formId).toBe('annex_15_seedlings_notification');
  });
});

describe('certification checklist', () => {
  it('uses product-specific lab parameter presets', () => {
    expect(requiredLabParameters('wine')).toContain('freeSo2');
    expect(requiredLabParameters('chacha_spirit')).toContain('methanol');
    expect(requiredLabParameters('chacha_spirit')).not.toContain('freeSo2');
  });

  it('does not force sparkling pressure on ordinary wine', () => {
    const result = evaluateCertificationChecklist({
      productType: 'wine',
      lot,
      latestLab: lab,
      certification: {
        samplePrepared: true,
        sampleDate: '2026-10-01',
        sampleQuantity: 4,
        labProtocolUploaded: true,
        organolepticResult: 'passed',
        balanceCheckStatus: 'passed',
        applicationStatus: 'submitted',
        certificateNumber: 'CERT-1',
        certificateFileName: 'cert.pdf',
        purpose: 'export',
      },
    });
    expect(result.missing.some(item => item.includes('pressure'))).toBe(false);
  });
});

describe('PDO checker', () => {
  it('accepts a Mukuzani Saperavi lot inside the microzone', () => {
    const result = checkPdoEligibility({ pdoId: 'Mukuzani', block, intake, lot });
    expect(result.eligible).toBe(true);
  });

  it('warns when sugar is too low or variety is wrong', () => {
    const result = checkPdoEligibility({
      pdoId: 'Mukuzani',
      block,
      intake: { ...intake, variety: 'Rkatsiteli', brix: 17 },
      lot: { ...lot, variety: 'Rkatsiteli' },
    });
    expect(result.warnings).toEqual(expect.arrayContaining(['wrong variety', 'sugar too low']));
  });

  it('ranks likely PDO candidates from linked vineyard and lot evidence', () => {
    const candidates = findPdoCandidates({ block, intake, lot });
    expect(candidates[0].pdo.name).toBe('Mukuzani');
    expect(candidates[0].matchedSignals).toEqual(expect.arrayContaining(['microzone', 'variety']));
    expect(suggestPdoCandidate({ block, intake, lot })?.pdo.id).toBe('mukuzani');
  });
});

describe('qvevri durations', () => {
  const baseVessel: Vessel = {
    id: 'Q-1',
    type: 'qvevri',
    shape: 'conical',
    capacity: 1000,
    currentVolume: 900,
    assignedLotId: 'LOT-1',
    cleaningStatus: 'clean',
    lastCleaned: '2026-09-01',
    temperature: 16,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: '',
  };

  it('calculates skin contact, sealed days, and first racking timing', () => {
    const vessel: Vessel = {
      ...baseVessel,
      fillingDate: '2026-09-20',
      sealingDate: '2026-09-25',
      openingDate: '2026-10-20',
      firstRackingDate: '2026-10-22',
    };
    expect(calculateQvevriDurations(vessel)).toEqual({
      skinContactDays: 30,
      sealedDays: 25,
      daysToFirstRacking: 32,
    });
  });

  it('marks a complete qvevri passport as ready', () => {
    const readiness = evaluateQvevriPassport({
      ...baseVessel,
      qvevriNumber: 'Q-1',
      maraniLocation: 'Marani row 1',
      lastWashingDate: '2026-09-01',
      limeWashStatus: 'done',
      waxingStatus: 'done',
      inspectionNotes: 'Interior intact after washing.',
      fillingDate: '2026-09-20',
      grapeVariety: 'Rkatsiteli',
      sealingDate: '2026-09-25',
      soilTemperature: 14.8,
    });

    expect(readiness.status).toBe('ready');
    expect(readiness.score).toBe(100);
    expect(readiness.missing).toEqual([]);
  });

  it('reports missing qvevri passport evidence', () => {
    const readiness = evaluateQvevriPassport({
      ...baseVessel,
      limeWashStatus: 'needed',
      waxingStatus: 'unknown',
    });

    expect(readiness.status).toBe('missing_critical');
    expect(readiness.missing).toEqual(expect.arrayContaining([
      'Marani location',
      'Lime wash status',
      'Inspection notes',
      'Filling date',
      'Grape variety',
      'Sealing date',
      'Soil temperature',
    ]));
  });
});
