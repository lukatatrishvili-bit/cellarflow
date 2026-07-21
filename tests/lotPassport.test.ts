import { describe, expect, it } from 'vitest';
import { buildPassportHtml } from '../lib/lotPassport';
import type {
  CertificationRecord,
  CompanyProfile,
  DocumentAttachment,
  GrapeIntakeRecord,
  HarvestRecord,
  LabAnalysis,
  VineyardBlock,
  WineLot,
} from '../lib/wineryState';

const company: CompanyProfile = {
  companyName: 'Kakheti Estate LLC',
  wineryName: 'Kakheti Estate',
  country: 'Georgia',
  region: 'Kakheti',
  municipality: 'Kvareli',
  address: 'Kvareli',
  identificationCode: '400000000',
  wineAgencyRegistrationCode: 'NWA-1',
  legalAddress: 'Kvareli legal address',
  factualAddress: 'Kvareli cellar',
  contactEmail: 'info@example.test',
  phone: '+995000000000',
  website: '',
  measurementUnits: 'metric',
};

const lot: WineLot = {
  id: 'LOT-KINDZ-1',
  name: 'Kindzmarauli Reserve',
  vintage: 2027,
  variety: 'Saperavi',
  vineyardBlock: 'BLOCK-1',
  region: 'Kakheti',
  initialVolume: 3000,
  currentVolume: 2600,
  wineClass: 'red',
  stage: 'bottled',
  createdAt: '2027-09-15',
  intendedAppellation: 'Kindzmarauli',
  classification: 'PDO',
  certificationStatus: 'approved',
  certificateNumber: 'CERT-2027',
  originProofStatus: 'verified',
  marketStatus: 'export',
  history: [],
};

const block: VineyardBlock = {
  id: 'BLOCK-1',
  name: 'Kindzmarauli Block',
  vineyardName: 'Estate Vineyard',
  locationName: 'Kvareli',
  cadastralCode: '57.01.01.001',
  municipality: 'Kvareli',
  village: 'Kvareli',
  microzone: 'Kvareli',
  latitude: 41.9,
  longitude: 45.8,
  area: 1,
  elevation: 420,
  slope: 'gentle',
  aspect: 'south',
  soilType: 'alluvial',
  grapeVariety: 'Saperavi',
  plantingYear: 2010,
  spacing: '2.4 x 1.2',
  rowsCount: 80,
  vinesCount: 2400,
  trainingSystem: 'Guyot',
  pruningSystem: 'cane',
  irrigationEnabled: false,
  farmingStatus: 'conventional',
  currentPhenology: 'harvested',
  estimatedHarvestDate: '2027-09-10',
  notes: '',
};

const intake: GrapeIntakeRecord = {
  id: 'INTAKE-1',
  date: '2027-09-15',
  source: 'own',
  blockId: 'BLOCK-1',
  blockName: 'Kindzmarauli Block',
  transportNumber: 'AA-001',
  labAnalysisNumber: 'LAB-1',
  cadastralCode: '57.01.01.001',
  village: 'Kvareli',
  municipality: 'Kvareli',
  microzone: 'Kvareli',
  variety: 'Saperavi',
  vintage: 2027,
  grossWeightKg: 5200,
  tareWeightKg: 200,
  netWeightKg: 5000,
  brix: 24,
  ph: 3.5,
  titratableAcidity: 5.6,
  temperatureC: 18,
  condition: 'excellent',
  pickingMethod: 'hand',
  wineClass: 'red',
  juiceYieldPct: 60,
  estimatedVolumeL: 3000,
  destinationVesselId: 'T-1',
  createdLotId: 'LOT-KINDZ-1',
  harvestRecordId: 'HARV-1',
  operator: 'Nino',
  notes: '',
};

const harvest: HarvestRecord = {
  id: 'HARV-1',
  blockId: 'BLOCK-1',
  variety: 'Saperavi',
  estimatedHarvestDate: '2027-09-12',
  estimatedTons: 5,
  actualHarvestDate: '2027-09-15',
  actualHarvestedKg: 5000,
  pickingMethod: 'hand',
  grapeCondition: 'excellent',
  sentToGvino: true,
  associatedLotId: 'LOT-KINDZ-1',
  notes: '',
};

const lab: LabAnalysis = {
  id: 'LAB-LOT-1',
  lotId: 'LOT-KINDZ-1',
  tankId: 'T-1',
  date: '2027-11-01',
  alcoholPct: 12.5,
  volatileAcid: 0.4,
  freeSo2: 28,
  totalSo2: 90,
  residualSugar: 35,
  ph: 3.45,
  malicAcid: 0.2,
  lacticAcid: 1.1,
  turbidity: 3,
  technician: 'Lika',
  titratableAcidity: 5.8,
  protocolNumber: 'LAB-1',
};

const certification: CertificationRecord = {
  id: 'CERT-REC-1',
  lotId: 'LOT-KINDZ-1',
  productType: 'wine',
  samplePrepared: true,
  sampleDate: '2027-11-02',
  sampleQuantity: 2,
  labProtocolUploaded: true,
  organolepticCheckRequired: true,
  organolepticResult: 'passed',
  applicationStatus: 'approved',
  balanceCheckStatus: 'passed',
  certificateNumber: 'CERT-2027',
  issueDate: '2027-11-10',
  purpose: 'export',
};

const certificateAttachment: DocumentAttachment = {
  id: 'att-cert-1',
  fileName: 'kindzmarauli-certificate.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  uploadedAt: '2027-11-10T10:00:00.000Z',
  uploadedBy: 'Nino',
  module: 'certification',
  linkedRecordType: 'certificationRecord',
  linkedRecordId: 'CERT-REC-1',
  description: 'Issued certification file',
  storage: { kind: 'metadata_only' },
  checksum: 'a'.repeat(64),
};

describe('lot passport report', () => {
  it('renders compliance, PDO, certification, official records, and downstream evidence', () => {
    const html = buildPassportHtml({
      lot,
      company,
      generatedBy: 'Nino',
      fermLogs: [],
      labLogs: [lab],
      blocks: [block],
      harvests: [harvest],
      grapeIntakes: [intake],
      cellarOps: [{
        id: 'OP-1', commandId: 'cmd-op', recordKind: 'operation', date: '2027-10-01',
        type: 'fining', lotId: lot.id, lotName: lot.name, operator: 'Nino', notes: '',
        reversedByCommandId: 'cmd-op-reversal', reversalReason: 'Wrong lot selected.',
      }, {
        id: 'OP-1-REV', commandId: 'cmd-op-reversal', recordKind: 'reversal', date: '2027-10-02',
        type: 'correction', customLabel: 'Reversal of fining', lotId: lot.id, lotName: lot.name,
        operator: 'Owner', notes: 'Wrong lot selected.', reversalOfOperationId: 'OP-1',
        reversalOfCommandId: 'cmd-op', reversalReason: 'Wrong lot selected.',
      }],
      bottlingRuns: [{ id: 'BOT-1', lotId: lot.id, lotName: lot.name, date: '2027-11-20', lotNumber: 'K-1', operator: 'Nino', formats: {}, totalBottles: 3000, totalCeramic: 0, volumeBottledL: 2250 }],
      stockMovements: [{ id: 'MOVE-1', date: '2027-11-20', lotId: lot.id, locationId: 'WH-1', direction: 'in', bottles: 3000, reason: 'bottling' }],
      storageLocations: [{ id: 'WH-1', name: 'Main Warehouse', type: 'warehouse' }],
      salesDispatches: [{ id: 'SALE-1', date: '2027-12-01', customerName: 'Restaurant', lotId: lot.id, lotName: lot.name, locationId: 'WH-1', locationName: 'Main Warehouse', bottles: 120, pricePerBottle: 24, currency: 'GEL', revenue: 2880, stockMovementId: 'MOVE-OUT-1', operator: 'Nino' }],
      certificationRecords: [certification],
      attachments: [certificateAttachment],
      auditLogs: [{ id: 'AUD-1', timestamp: '2027-09-15T10:00:00.000Z', user: 'Nino', module: 'GVINO', actionType: 'Grape Receiving', changedItem: 'WineLot LOT-KINDZ-1', oldValue: '', newValue: lot.name, notes: '' }],
    });

    expect(html).toContain('Lot compliance readiness');
    expect(html).toContain('Kindzmarauli');
    expect(html).toContain('CERT-2027');
    expect(html).toContain('Connected Official Records');
    expect(html).toContain('Annex 7');
    expect(html).toContain('Attachment Evidence');
    expect(html).toContain('kindzmarauli-certificate.pdf');
    expect(html).toContain('sha256:aaaaaaaaaaaa');
    expect(html).toContain('Restaurant');
    expect(html).toContain('Audit History');
    expect(html).toContain('Cellar operation (reversed)');
    expect(html).toContain('Cellar operation correction');
    expect(html).toContain('Wrong lot selected.');
  });
});
