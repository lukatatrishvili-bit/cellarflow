import { describe, it, expect } from 'vitest';
import {
  listForms, getTemplate, buildDocument, buildFilename, type ExportContext,
} from '../lib/georgianForms';
import { applyRunningBalance, findNegativeBalances, litresToDal } from '../lib/georgianForms/balance';
import { FORM_TEMPLATES } from '../lib/georgianForms/templates';

// ── fixtures ─────────────────────────────────────────────────────────────────
const company: any = {
  companyName: 'ნიკალა ღვინო', wineryName: 'მარანი', country: 'Georgia', region: 'Kakheti',
  municipality: 'Telavi', address: 'Kondoli', contactEmail: '', phone: '', website: '', measurementUnits: 'metric',
};

const blocks: any[] = [
  { id: 'BLK-1', name: 'ქონდოლი 1', vineyardName: 'Kondoli', locationName: 'Telavi, Kakheti, Georgia',
    latitude: 41.9, longitude: 45.4, area: 1.5, elevation: 450, slope: 'S', aspect: 'S', soilType: 'clay',
    grapeVariety: 'საფერავი', plantingYear: 2015, spacing: '2.0 x 1.0', rowsCount: 30, vinesCount: 4500,
    trainingSystem: 'Guyot', pruningSystem: 'Cane', irrigationEnabled: true, farmingStatus: 'organic',
    currentPhenology: 'Veraison', estimatedHarvestDate: '2026-09-20', notes: '', rootstock: 'SO4' },
];

const harvests: any[] = [
  { id: 'H1', blockId: 'BLK-1', variety: 'საფერავი', estimatedHarvestDate: '2026-09-20', estimatedTons: 9,
    actualHarvestDate: '2026-09-22', actualHarvestedKg: 9000, pickingMethod: 'hand', grapeCondition: 'good',
    sentToGvino: true, notes: '' },
  { id: 'H2', blockId: 'BLK-1', variety: 'საფერავი', estimatedHarvestDate: '2025-09-18', estimatedTons: 8,
    actualHarvestDate: '2025-09-19', actualHarvestedKg: 8000, pickingMethod: 'hand', grapeCondition: 'good',
    sentToGvino: true, notes: '' }, // out of 2026 range
];

const lots: any[] = [
  { id: 'SAP-2026-01', name: 'საფერავი 2026', vintage: 2026, variety: 'საფერავი', vineyardBlock: 'BLK-1',
    region: 'Kakheti', initialVolume: 5000, currentVolume: 4800, wineClass: 'red', stage: 'aging',
    createdAt: '2026-10-01', history: [{ date: '2026-10-02', type: 'aging', description: 'to barrel', operator: 'A' }] },
];

const vessels: any[] = [
  { id: 'T-1', type: 'stainless_steel', shape: 'vertical', capacity: 6000, currentVolume: 4800,
    assignedLotId: 'SAP-2026-01', cleaningStatus: 'clean', lastCleaned: '2026-10-01', temperature: 16,
    coolingJacketActive: false, targetTemperature: null, lastOperation: '' },
];

const labLogs: any[] = [
  { id: 'L1', lotId: 'SAP-2026-01', tankId: 'T-1', date: '2026-10-05', alcoholPct: 13.5, volatileAcid: 0.4,
    freeSo2: 30, totalSo2: 80, residualSugar: 2, ph: 3.4, malicAcid: 0, lacticAcid: 1.2, turbidity: 10,
    technician: 'A', titratableAcidity: 5.8 },
];

const transfers: any[] = [
  { id: 'TR1', date: '2026-10-10', sourceTankId: 'T-2', destTankId: 'T-1', volume: 500, loss: 2, reason: 'topping', pumpModel: '', operator: 'A' },
  { id: 'TR2', date: '2026-10-15', sourceTankId: 'T-1', destTankId: 'T-3', volume: 300, loss: 1, reason: 'racking', pumpModel: '', operator: 'A' },
];

function makeCtx(over: Partial<ExportContext> = {}): ExportContext {
  return {
    lang: 'ka', mode: 'filled', blankRows: 12, company, generatedBy: 'ტესტერი',
    dateRange: { from: '2026-01-01', to: '2026-12-31' }, accountingYear: '2026',
    blocks, lots, vessels, harvests, samplings: [], inventory: [], labLogs, transfers, grapeIntakes: [], cellarOps: [], bottlingRuns: [], salesDispatches: [],
    ...over,
  };
}

// ── template integrity ───────────────────────────────────────────────────────
describe('form templates', () => {
  it('defines exactly annexes №1–№20, unique ids and numbers', () => {
    const forms = listForms();
    expect(forms).toHaveLength(20);
    expect(forms.map(f => f.annexNumber)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(forms.map(f => f.id)).size).toBe(20);
  });

  it('every totals key and column key is valid and unique within a form', () => {
    for (const f of FORM_TEMPLATES) {
      const keys = f.columns.map(c => c.key);
      expect(new Set(keys).size, `dup column in ${f.id}`).toBe(keys.length);
      for (const tk of f.totals) {
        expect(keys, `total '${tk}' missing in ${f.id}`).toContain(tk);
      }
    }
  });

  it('has ascii-safe filename slugs and a version + source per form', () => {
    for (const f of FORM_TEMPLATES) {
      expect(f.filenameSlug).toMatch(/^[a-z0-9_]+$/);
      expect(f.version).toBeTruthy();
      expect(f.sourceDoc).toBeTruthy();
      expect(f.titleKa.length).toBeGreaterThan(3);
    }
  });
});

// ── balance ──────────────────────────────────────────────────────────────────
describe('running balance', () => {
  it('computes closing = opening + in − out per row', () => {
    const rows = [
      { incoming: 100, outgoing: 0, balance: 0 },
      { incoming: 0, outgoing: 30, balance: 0 },
      { incoming: 50, outgoing: 20, balance: 0 },
    ];
    const close = applyRunningBalance(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
    expect(rows.map(r => r.balance)).toEqual([100, 70, 100]);
    expect(close).toBe(100);
  });

  it('flags rows that drive the balance negative', () => {
    const rows = [
      { incoming: 10, outgoing: 0, balance: 0 },
      { incoming: 0, outgoing: 25, balance: 0 },
    ];
    expect(findNegativeBalances(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' })).toEqual([1]);
  });

  it('converts litres to decalitres', () => {
    expect(litresToDal(5000)).toBe(500);
  });
});

// ── mapping ──────────────────────────────────────────────────────────────────
describe('data mapping', () => {
  it('Annex 1 maps a vineyard block (ha → sq.m, spacing split)', () => {
    const doc = buildDocument('annex_01_vineyard_journal', makeCtx());
    expect(doc.rows).toHaveLength(1);
    const r = doc.rows[0];
    expect(r.areaSqm).toBe(15000); // 1.5 ha
    expect(r.variety).toBe('საფერავი');
    expect(r.rowDistance).toBe('2.0');
    expect(r.vineDistance).toBe('1.0');
    expect(r.irrigation).toBe('დიახ');
    expect(doc.totalsRow?.areaSqm).toBe(15000);
  });

  it('Annex 2 includes only harvests inside the date range', () => {
    const doc = buildDocument('annex_02_harvest_journal', makeCtx());
    expect(doc.rows).toHaveLength(1); // 2026 only
    expect(doc.rows[0].tons).toBe(9); // 9000 kg
    expect(doc.totalsRow?.tons).toBe(9);
  });

  it('Annex 4 builds a running wine-movement ledger from production + transfers', () => {
    const doc = buildDocument('annex_04_wine_movement', makeCtx({ lotId: 'SAP-2026-01' }));
    // production-in 500 dal, +50 dal in, −30 dal out
    const last = doc.rows[doc.rows.length - 1];
    expect(Number(last.balance)).toBeCloseTo(520, 1);
    expect(doc.totalsRow?.incoming).toBeCloseTo(550, 1);
    expect(doc.totalsRow?.outgoing).toBeCloseTo(30, 1);
  });

  it('Annex 5 maps an aging lot with lab analytics', () => {
    const doc = buildDocument('annex_05_wine_aging_act', makeCtx({ lotId: 'SAP-2026-01' }));
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].placeAlc).toBe(13.5);
    expect(doc.rows[0].placeQty).toBe(480); // 4800 L
  });

  it('Annex 7 uses recorded bottling runs (per-format counts) when present', () => {
    const bottlingRuns: any[] = [
      { id: 'BR1', lotId: 'SAP-2026-01', lotName: 'საფერავი 2026', date: '2026-06-15', lotNumber: 'L-26-07',
        operator: 'A', formats: { '0.75': 1200 }, volumeBottledL: 900, totalBottles: 1200, totalCeramic: 0 },
    ];
    const doc = buildDocument('annex_07_bottling_act', makeCtx({ bottlingRuns }));
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].bottles).toBe(1200);
    expect(doc.rows[0].fillQty).toBe(90); // 900 L → dal
    expect(doc.rows[0].lotNo).toBe('L-26-07');
  });

  it('Annex 7 (bottling act) and Annex 8 (finished-goods warehouse) reconcile', () => {
    const bottlingRuns: any[] = [
      { id: 'BR1', lotId: 'SAP-2026-01', lotName: 'საფერავი 2026', date: '2026-06-15', lotNumber: 'L-26-07',
        operator: 'A', formats: { '0.75': 1200 }, volumeBottledL: 900, totalBottles: 1200, totalCeramic: 0 },
      { id: 'BR2', lotId: 'SAP-2026-01', lotName: 'საფერავი 2026', date: '2026-07-01', lotNumber: 'L-26-08',
        operator: 'A', formats: { '0.75': 800 }, volumeBottledL: 600, totalBottles: 800, totalCeramic: 0 },
    ];
    const ctx = makeCtx({ bottlingRuns });
    const annex7 = buildDocument('annex_07_bottling_act', ctx);
    const annex8 = buildDocument('annex_08_warehouse_movement', ctx);
    // Finished goods received (Annex 8 incoming) === volume bottled (Annex 7 fill).
    expect(annex8.totalsRow?.incoming).toBe(annex7.totalsRow?.fillQty);
    expect(annex8.totalsRow?.incoming).toBe(150); // (900 + 600) L → 150 dal
    // Closing finished-goods balance equals everything bottled (no sales tracked).
    expect(annex8.rows[annex8.rows.length - 1].balance).toBe(150);
  });

  it('Annex 8 reflects sales dispatches in the outgoing column and balance', () => {
    const bottlingRuns: any[] = [
      { id: 'BR1', lotId: 'SAP-2026-01', lotName: 'საფერავი 2026', date: '2026-06-15', lotNumber: 'L-26-07',
        operator: 'A', formats: { '0.75': 1200 }, volumeBottledL: 900, totalBottles: 1200, totalCeramic: 0 },
    ];
    const salesDispatches: any[] = [
      { id: 'SD1', date: '2026-06-20', customerName: 'Wine Bar', lotId: 'SAP-2026-01', lotName: 'საფერავი 2026',
        locationId: 'WH-1', locationName: 'WH', bottles: 400, pricePerBottle: 25, currency: 'GEL',
        revenue: 10000, stockMovementId: 'SM1', operator: 'A' },
    ];
    const doc = buildDocument('annex_08_warehouse_movement', makeCtx({ bottlingRuns, salesDispatches }));
    // 1200 bottles → 900 L → 0.75 L/bottle; 400 dispatched → 300 L → 30 dal out.
    expect(doc.totalsRow?.incoming).toBe(90);  // 900 L bottled
    expect(doc.totalsRow?.outgoing).toBe(30);  // 300 L sold
    expect(doc.rows[doc.rows.length - 1].balance).toBe(60); // 90 − 30 dal on hand
  });

  it('Annex 3 maps structured grape intakes with gross/tare/net + reception sugar', () => {
    const grapeIntakes: any[] = [
      { id: 'GI1', date: '2026-09-23', source: 'own', blockId: 'BLK-1', blockName: 'ქონდოლი 1', variety: 'საფერავი',
        vintage: 2026, grossWeightKg: 9500, tareWeightKg: 500, netWeightKg: 9000, brix: 23.4, ph: 3.45,
        transportName: 'Truck', transportNumber: 'AA-001-AA', weighingDocumentNumber: 'W-001', labAnalysisNumber: 'LAB-001',
        cadastralCode: '53.01.01.001', village: 'Kondoli', municipality: 'Telavi', microzone: 'Tsinandali',
        titratableAcidity: 5.8, temperatureC: 18, condition: 'excellent', pickingMethod: 'hand', wineClass: 'red',
        juiceYieldPct: 70, estimatedVolumeL: 6300, destinationVesselId: 'T-1', createdLotId: 'SAP-2026-01',
        operator: 'A', notes: 'clean' },
      { id: 'GI2', date: '2026-09-30', source: 'supplier', supplierName: 'გ. ნადირაძე', variety: 'რქაწითელი',
        vintage: 2026, grossWeightKg: 5200, tareWeightKg: 200, netWeightKg: 5000, brix: 21.0, ph: 3.2,
        titratableAcidity: 6.4, temperatureC: 20, condition: 'good', pickingMethod: 'hand', wineClass: 'amber',
        juiceYieldPct: 68, estimatedVolumeL: 3400, destinationVesselId: null, createdLotId: 'RKA-2026-01',
        operator: 'A', notes: '' },
    ];
    const doc = buildDocument('annex_03_grape_reception', makeCtx({ grapeIntakes }));
    expect(doc.rows).toHaveLength(2);
    const [r1, r2] = doc.rows;
    expect(r1.brutto).toBe(9500);
    expect(r1.tara).toBe(500);
    expect(r1.netto).toBe(9000);
    expect(r1.sugar).toBe(23.4);          // reception Brix, not block sampling
    expect(r1.transport).toBe('Truck / AA-001-AA');
    expect(r1.analysisNo).toBe('LAB-001');
    expect(String(r1.note)).toContain('weighing W-001');
    expect(String(r1.note)).toContain('cadastre 53.01.01.001');
    expect(r2.supplier).toBe('გ. ნადირაძე'); // third-party supplier name
    expect(doc.totalsRow?.netto).toBe(14000); // 9000 + 5000
  });

  it('Annex 3 falls back to harvest dispatches when no structured intakes exist', () => {
    const doc = buildDocument('annex_03_grape_reception', makeCtx()); // grapeIntakes: []
    expect(doc.rows).toHaveLength(1); // only the in-range, sentToGvino harvest
    expect(doc.rows[0].netto).toBe(9000);
    expect(doc.rows[0].brutto).toBe(''); // gross/tare unknown for legacy dispatch
  });

  it('Annex 13 builds a materials ledger from additive usage that closes at current stock', () => {
    const inventory: any[] = [
      { id: 'INV-B', name: 'ბენტონიტი', category: 'additives', stock: 26, minThreshold: 10, unit: 'კგ', costPerUnit: 6, supplierName: 'Enartis', details: '' },
    ];
    const cellarOps: any[] = [
      { id: 'OP-A', date: '2026-10-07', type: 'fining', lotId: 'SAP-2026-01', lotName: 'საფერავი 2026',
        vesselId: 'T-1', materialId: 'INV-B', materialName: 'ბენტონიტი', dose: 4, unit: 'კგ', operator: 'A', notes: '' },
    ];
    const doc = buildDocument('annex_13_materials_movement', makeCtx({ inventory, cellarOps }));
    // opening row + one usage row
    expect(doc.rows).toHaveLength(2);
    expect(doc.rows[0].incoming).toBe(30); // opening = current 26 + usage 4
    expect(doc.rows[1].outgoing).toBe(4);
    expect(doc.rows[1].balance).toBe(26);  // closes at current stock
    expect(doc.totalsRow?.outgoing).toBe(4);
  });

  it('Annex 13 falls back to a stock snapshot when a material has no usage', () => {
    const inventory: any[] = [
      { id: 'INV-Y', name: 'საფუარი QA23', category: 'yeasts', stock: 4.5, minThreshold: 2, unit: 'კგ', costPerUnit: 95, supplierName: 'Lallemand', details: '' },
    ];
    const doc = buildDocument('annex_13_materials_movement', makeCtx({ inventory })); // cellarOps: []
    expect(doc.rows).toHaveLength(1);
    expect(doc.rows[0].balance).toBe(4.5);
    expect(doc.rows[0].outgoing).toBe(0);
  });
});

// ── blank + validation + filenames ───────────────────────────────────────────
describe('blank forms, validation, filenames', () => {
  it('blank mode emits N empty rows and no totals', () => {
    const doc = buildDocument('annex_03_grape_reception', makeCtx({ mode: 'blank', blankRows: 8 }));
    expect(doc.rows).toHaveLength(8);
    expect(doc.totalsRow).toBeNull();
    expect(doc.rows.every(r => Object.values(r).every(v => v === ''))).toBe(true);
  });

  it('warns when a data-less distillation form is exported filled', () => {
    const doc = buildDocument('annex_09_distillation_act', makeCtx());
    expect(doc.warnings.some(w => /data source|მონაცემები/.test(w.messageEn + w.messageKa))).toBe(true);
  });

  it('flags a negative balance as an error in a movement journal', () => {
    const badTransfers = [
      { id: 'X', date: '2026-10-02', sourceTankId: 'T-1', destTankId: 'T-9', volume: 999999, loss: 0, reason: '', pumpModel: '', operator: '' },
    ];
    const doc = buildDocument('annex_04_wine_movement', makeCtx({ lotId: 'SAP-2026-01', transfers: badTransfers as any }));
    expect(doc.warnings.some(w => w.level === 'error')).toBe(true);
  });

  it('builds a unicode-safe, date-stamped filename', () => {
    const ctx = makeCtx();
    const name = buildFilename(getTemplate('annex_04_wine_movement')!, ctx, 'pdf');
    expect(name).toBe('annex_04_wine_movement_journal_2026-01-01_2026-12-31.pdf');
  });
});
