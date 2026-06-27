/**
 * Self-contained sample dataset for trying the official-document exports
 * immediately, without depending on the user's own (possibly empty) account.
 *
 * Used only when the "Demo data" toggle is on in the Official Documents page;
 * it is never persisted or synced.
 */

import type {
  VineyardBlock, WineLot, Vessel, HarvestRecord, GrapeSamplingRecord,
  InventoryItem, LabAnalysis, TransferEvent, GrapeIntakeRecord, CellarOperation,
  BottlingRunRecord,
} from '../wineryState';

export const demoBlocks: VineyardBlock[] = [
  {
    id: 'GE-KAK-0001', name: 'ქონდოლის ნაკვეთი №1', vineyardName: 'ქონდოლი', locationName: 'ქონდოლი, თელავი, კახეთი',
    latitude: 41.92, longitude: 45.49, area: 2.4, elevation: 560, slope: 'სამხრეთი', aspect: 'S', soilType: 'თიხნარი',
    grapeVariety: 'საფერავი', rootstock: 'SO4', plantingYear: 2014, spacing: '2.0 x 1.0', rowsCount: 48, vinesCount: 11800,
    trainingSystem: 'ორმხრივი გიუო', pruningSystem: 'მოკლე', irrigationEnabled: true, farmingStatus: 'organic',
    currentPhenology: 'სიმწიფე', estimatedHarvestDate: '2026-09-22', notes: '',
  },
  {
    id: 'GE-KAK-0002', name: 'მუკუზნის ტერასა S-3', vineyardName: 'მუკუზანი', locationName: 'გურჯაანი, კახეთი',
    latitude: 41.78, longitude: 45.72, area: 1.1, elevation: 480, slope: 'სამხრეთ-აღმოსავლეთი', aspect: 'SE', soilType: 'კარბონატული',
    grapeVariety: 'რქაწითელი', rootstock: '5BB', plantingYear: 2017, spacing: '2.2 x 1.1', rowsCount: 22, vinesCount: 4400,
    trainingSystem: 'გიუო', pruningSystem: 'მოკლე', irrigationEnabled: false, farmingStatus: 'conventional',
    currentPhenology: 'სიმწიფე', estimatedHarvestDate: '2026-09-28', notes: '',
  },
];

export const demoHarvests: HarvestRecord[] = [
  {
    id: 'HV-2026-01', blockId: 'GE-KAK-0001', variety: 'საფერავი', estimatedHarvestDate: '2026-09-22',
    estimatedTons: 14, actualHarvestDate: '2026-09-23', actualHarvestedKg: 13800, pickingMethod: 'hand',
    crateQuantity: 690, grapeCondition: 'excellent', temperatureAtHarvest: 18, destinationWinery: 'მარანი',
    sentToGvino: true, associatedLotId: 'SAP-2026-01', notes: 'ხელით კრეფა, შერჩევითი',
  },
  {
    id: 'HV-2026-02', blockId: 'GE-KAK-0002', variety: 'რქაწითელი', estimatedHarvestDate: '2026-09-28',
    estimatedTons: 7, actualHarvestDate: '2026-09-29', actualHarvestedKg: 7200, pickingMethod: 'hand',
    crateQuantity: 360, grapeCondition: 'good', temperatureAtHarvest: 20, destinationWinery: 'მარანი',
    sentToGvino: true, associatedLotId: 'RKA-2026-01', notes: '',
  },
];

export const demoSamplings: GrapeSamplingRecord[] = [
  { id: 'GS-1', blockId: 'GE-KAK-0001', date: '2026-09-20', brix: 23.4, pH: 3.45, totalAcidityGL: 5.8, berryWeightG: 1.6,
    phenolicMaturity: 'Optimal', seedColor: 'Dark brown', tasteNotes: '', diseaseCondition: 'სუფთა', estimatedHarvestDate: '2026-09-22', notes: '' },
  { id: 'GS-2', blockId: 'GE-KAK-0002', date: '2026-09-26', brix: 21.1, pH: 3.2, totalAcidityGL: 6.4, berryWeightG: 1.8,
    phenolicMaturity: 'Optimal', seedColor: 'Yellow-brown', tasteNotes: '', diseaseCondition: 'სუფთა', estimatedHarvestDate: '2026-09-28', notes: '' },
];

export const demoLots: WineLot[] = [
  {
    id: 'SAP-2026-01', name: 'საფერავი ქონდოლი 2026', vintage: 2026, variety: 'საფერავი', vineyardBlock: 'GE-KAK-0001',
    region: 'კახეთი', initialVolume: 9800, currentVolume: 9400, wineClass: 'red', stage: 'aging', createdAt: '2026-10-02',
    history: [
      { date: '2026-09-23', type: 'crush', description: 'დაწურვა და ფერმენტაცია ქვევრში', operator: 'ლუკა' },
      { date: '2026-10-02', type: 'aging', description: 'დავარგებაზე ჩაყენება', operator: 'ლუკა' },
    ],
  },
  {
    id: 'RKA-2026-01', name: 'რქაწითელი მუკუზანი 2026', vintage: 2026, variety: 'რქაწითელი', vineyardBlock: 'GE-KAK-0002',
    region: 'კახეთი', initialVolume: 5100, currentVolume: 5000, wineClass: 'amber', stage: 'aging', createdAt: '2026-10-05',
    history: [{ date: '2026-09-29', type: 'crush', description: 'ქვევრის ფერმენტაცია ჭაჭაზე', operator: 'სოფიო' }],
  },
  {
    id: 'SAP-2025-02', name: 'საფერავი რეზერვი 2025', vintage: 2025, variety: 'საფერავი', vineyardBlock: 'GE-KAK-0001',
    region: 'კახეთი', initialVolume: 6000, currentVolume: 1200, wineClass: 'red', stage: 'bottled', createdAt: '2025-10-10',
    history: [{ date: '2026-05-12', type: 'bottling', description: 'ჩამოსხმა 0.75ლ ბოთლებში', operator: 'ლუკა' }],
  },
];

export const demoVessels: Vessel[] = [
  { id: 'ქვევრი Q-1', type: 'qvevri', shape: 'conical', capacity: 1500, currentVolume: 1400, assignedLotId: 'SAP-2026-01',
    cleaningStatus: 'clean', lastCleaned: '2026-09-20', temperature: 15, coolingJacketActive: false, targetTemperature: null,
    lastOperation: 'დალუქვა', lastSealedDate: '2026-10-02', soilTemperature: 13 },
  { id: 'ცისტერნა T-1', type: 'stainless_steel', shape: 'vertical', capacity: 10000, currentVolume: 9400, assignedLotId: 'SAP-2026-01',
    cleaningStatus: 'clean', lastCleaned: '2026-10-01', temperature: 16, coolingJacketActive: false, targetTemperature: 16, lastOperation: 'გადატანა' },
  { id: 'ცისტერნა T-2', type: 'stainless_steel', shape: 'vertical', capacity: 6000, currentVolume: 5000, assignedLotId: 'RKA-2026-01',
    cleaningStatus: 'clean', lastCleaned: '2026-10-04', temperature: 15, coolingJacketActive: false, targetTemperature: 15, lastOperation: 'გადატანა' },
];

export const demoTransfers: TransferEvent[] = [
  { id: 'TR-1', date: '2026-10-02', sourceTankId: 'ქვევრი Q-1', destTankId: 'ცისტერნა T-1', volume: 1350, loss: 8, reason: 'ქვევრიდან გადაღება', pumpModel: 'Liverani', operator: 'ლუკა' },
  { id: 'TR-2', date: '2026-10-18', sourceTankId: 'ცისტერნა T-1', destTankId: 'ცისტერნა T-2', volume: 400, loss: 3, reason: 'კუპაჟის მომზადება', pumpModel: 'Liverani', operator: 'ლუკა' },
];

export const demoInventory: InventoryItem[] = [
  { id: 'INV-1', name: 'საფუარი QA23', category: 'yeasts', stock: 4.5, minThreshold: 2, unit: 'კგ', costPerUnit: 95, supplierName: 'Lallemand', details: '' },
  { id: 'INV-2', name: 'ბენტონიტი', category: 'additives', stock: 30, minThreshold: 10, unit: 'კგ', costPerUnit: 6, supplierName: 'Enartis', details: '' },
  { id: 'INV-3', name: 'საფუარის საკვები (DAP)', category: 'nutritions', stock: 12, minThreshold: 5, unit: 'კგ', costPerUnit: 8, supplierName: 'Enartis', details: '' },
];

export const demoLabLogs: LabAnalysis[] = [
  { id: 'LAB-1', lotId: 'SAP-2026-01', tankId: 'ცისტერნა T-1', date: '2026-10-06', alcoholPct: 13.8, volatileAcid: 0.45,
    freeSo2: 28, totalSo2: 78, residualSugar: 2.1, ph: 3.5, malicAcid: 0, lacticAcid: 1.4, turbidity: 12, technician: 'ნ. ბერიძე', titratableAcidity: 5.6 },
  { id: 'LAB-2', lotId: 'RKA-2026-01', tankId: 'ცისტერნა T-2', date: '2026-10-08', alcoholPct: 12.6, volatileAcid: 0.5,
    freeSo2: 22, totalSo2: 70, residualSugar: 1.4, ph: 3.3, malicAcid: 0, lacticAcid: 1.1, turbidity: 30, technician: 'ნ. ბერიძე', titratableAcidity: 6.1 },
];

export const demoGrapeIntakes: GrapeIntakeRecord[] = [
  {
    id: 'GI-2026-01', date: '2026-09-23', source: 'own', blockId: 'GE-KAK-0001', blockName: 'ქონდოლის ნაკვეთი №1',
    variety: 'საფერავი', vintage: 2026, grossWeightKg: 14300, tareWeightKg: 500, netWeightKg: 13800,
    brix: 23.4, ph: 3.45, titratableAcidity: 5.8, temperatureC: 18, condition: 'excellent', pickingMethod: 'hand',
    wineClass: 'red', juiceYieldPct: 70, estimatedVolumeL: 9660, destinationVesselId: 'ქვევრი Q-1',
    createdLotId: 'SAP-2026-01', harvestRecordId: 'HV-2026-01', operator: 'ლუკა', notes: 'ხელით კრეფა, შერჩევითი',
  },
  {
    id: 'GI-2026-02', date: '2026-09-29', source: 'own', blockId: 'GE-KAK-0002', blockName: 'მუკუზნის ტერასა S-3',
    variety: 'რქაწითელი', vintage: 2026, grossWeightKg: 7500, tareWeightKg: 300, netWeightKg: 7200,
    brix: 21.1, ph: 3.2, titratableAcidity: 6.4, temperatureC: 20, condition: 'good', pickingMethod: 'hand',
    wineClass: 'amber', juiceYieldPct: 68, estimatedVolumeL: 4896, destinationVesselId: 'ცისტერნა T-2',
    createdLotId: 'RKA-2026-01', harvestRecordId: 'HV-2026-02', operator: 'სოფიო', notes: '',
  },
  {
    id: 'GI-2026-03', date: '2026-09-30', source: 'supplier', supplierName: 'გ. ნადირაძე — სოფ. ვაზისუბანი',
    variety: 'საფერავი', vintage: 2026, grossWeightKg: 5200, tareWeightKg: 220, netWeightKg: 4980,
    brix: 22.6, ph: 3.38, titratableAcidity: 6.0, temperatureC: 19, condition: 'good', pickingMethod: 'hand',
    wineClass: 'red', juiceYieldPct: 70, estimatedVolumeL: 3486, destinationVesselId: null,
    createdLotId: 'SAP-2026-03', operator: 'ლუკა', notes: 'შესყიდული ყურძენი, ხელშეკრულება №14',
  },
];

export const demoCellarOps: CellarOperation[] = [
  { id: 'OP-1', date: '2026-09-24', type: 'additive', lotId: 'SAP-2026-01', lotName: 'საფერავი ქონდოლი 2026',
    vesselId: 'ქვევრი Q-1', materialId: 'INV-1', materialName: 'საფუარი QA23', dose: 1.2, unit: 'კგ',
    operator: 'ლუკა', notes: 'ინოკულაცია' },
  { id: 'OP-2', date: '2026-10-07', type: 'fining', lotId: 'SAP-2026-01', lotName: 'საფერავი ქონდოლი 2026',
    vesselId: 'ცისტერნა T-1', materialId: 'INV-2', materialName: 'ბენტონიტი', dose: 4, unit: 'კგ',
    operator: 'ლუკა', notes: 'ცილოვანი სტაბილიზაცია' },
  { id: 'OP-3', date: '2026-09-26', type: 'additive', lotId: 'RKA-2026-01', lotName: 'რქაწითელი მუკუზანი 2026',
    vesselId: 'ცისტერნა T-2', materialId: 'INV-3', materialName: 'საფუარის საკვები (DAP)', dose: 1.5, unit: 'კგ',
    operator: 'სოფიო', notes: 'YAN კორექცია' },
  { id: 'OP-4', date: '2026-10-02', type: 'racking', lotId: 'SAP-2026-01', lotName: 'საფერავი ქონდოლი 2026',
    vesselId: 'ქვევრი Q-1', vesselToId: 'ცისტერნა T-1', volumeBeforeL: 9800, volumeAfterL: 9400,
    operator: 'ლუკა', notes: 'გადაღება ქვევრიდან' },
];

export const demoBottlingRuns: BottlingRunRecord[] = [
  {
    id: 'BR-2025-01', lotId: 'SAP-2025-02', lotName: 'საფერავი რეზერვი 2025', date: '2026-05-12',
    lotNumber: 'L-2025-02', operator: 'ლუკა', formats: { '0.75': 6400 }, totalBottles: 6400,
    totalCeramic: 0, volumeBottledL: 4800,
  },
];

export const demoPools = {
  blocks: demoBlocks,
  lots: demoLots,
  vessels: demoVessels,
  harvests: demoHarvests,
  samplings: demoSamplings,
  inventory: demoInventory,
  labLogs: demoLabLogs,
  transfers: demoTransfers,
  grapeIntakes: demoGrapeIntakes,
  cellarOps: demoCellarOps,
  bottlingRuns: demoBottlingRuns,
};
