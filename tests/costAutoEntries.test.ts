import { describe, expect, it } from 'vitest';
import {
  automaticLabCostEntry,
  automaticOperationCostEntries,
  classifyInventoryCostCategory,
  computeBottlingCostPosting,
  DEFAULT_COST_AUTOMATION_SETTINGS,
  grapeIntakeCostEntry,
  materialCostEntryFromOperation,
} from '../lib/costing';

describe('automatic cost entries', () => {
  it('calculates labor, energy, and overhead from an operation profile', () => {
    const entries = automaticOperationCostEntries({
      operationId: 'op-auto-1',
      date: '2026-10-03',
      lotId: 'LOT-SAP-2026',
      operationType: 'racking',
      laborHours: 2,
      energyKwh: 6,
      materialCostTotal: 10,
      currency: 'GEL',
      settings: {
        ...DEFAULT_COST_AUTOMATION_SETTINGS,
        enabled: true,
        laborRatePerHour: 20,
        energyRatePerKwh: 0.5,
        overheadPercent: 10,
      },
    });

    expect(entries).toEqual([
      expect.objectContaining({ id: 'cost-labor-op-auto-1', category: 'labor', amount: 40 }),
      expect.objectContaining({ id: 'cost-energy-op-auto-1', category: 'energy', amount: 3 }),
      expect.objectContaining({ id: 'cost-overhead-op-auto-1', category: 'overhead', amount: 5.3 }),
    ]);
  });

  it('posts a configured laboratory charge once per analysis id', () => {
    expect(automaticLabCostEntry({
      analysisId: 'lab-42',
      date: '2026-10-04',
      lotId: 'LOT-SAP-2026',
      currency: 'GEL',
      settings: {
        ...DEFAULT_COST_AUTOMATION_SETTINGS,
        enabled: true,
        labAnalysisCost: 32.5,
      },
    })).toMatchObject({
      id: 'cost-lab-lab-42',
      category: 'other',
      amount: 32.5,
      sourceRef: 'lab-42',
    });
  });

  it('creates a grape cost entry from intake cost per kg', () => {
    const entry = grapeIntakeCostEntry({
      id: 'intake-1',
      date: '2026-09-10',
      createdLotId: 'LOT-SAP-2026',
      source: 'supplier',
      supplierName: 'Telavi Grower',
      variety: 'Saperavi',
      netWeightKg: 12000,
      costPerKg: 1.35,
    }, { currency: 'GEL', createdBy: 'QA Winemaker' });

    expect(entry).toMatchObject({
      id: 'cost-grape-intake-1',
      lotId: 'LOT-SAP-2026',
      category: 'grape',
      amount: 16200,
      currency: 'GEL',
      quantity: 12000,
      unitCost: 1.35,
      sourceRef: 'intake-1',
      createdBy: 'QA Winemaker',
    });
  });

  it('uses explicit total fruit cost when provided', () => {
    const entry = grapeIntakeCostEntry({
      id: 'intake-2',
      date: '2026-09-10',
      createdLotId: 'LOT-RKT-2026',
      source: 'own',
      blockName: 'Block A',
      variety: 'Rkatsiteli',
      netWeightKg: 8000,
      costPerKg: 1,
      totalCost: 9500,
      currency: 'EUR',
    }, { currency: 'GEL' });

    expect(entry?.amount).toBe(9500);
    expect(entry?.currency).toBe('EUR');
  });

  it('returns null when an event has no real cost', () => {
    expect(grapeIntakeCostEntry({
      id: 'intake-3',
      date: '2026-09-10',
      createdLotId: 'LOT-FREE',
      source: 'own',
      variety: 'Mtsvane',
      netWeightKg: 1000,
    }, { currency: 'GEL' })).toBeNull();
  });

  it('posts material consumed by cellar operations at inventory unit cost', () => {
    const entry = materialCostEntryFromOperation({
      id: 'op-1',
      date: '2026-10-02',
      type: 'sulfitation',
      lotId: 'LOT-SAP-2026',
      materialId: 'INV-SO2',
      materialName: 'SO2 solution',
      dose: 2.5,
      unit: 'L',
    }, {
      id: 'INV-SO2',
      name: 'SO2 solution',
      category: 'additives',
      costPerUnit: 18,
    }, { currency: 'GEL', createdBy: 'Nino' });

    expect(entry).toMatchObject({
      id: 'cost-material-op-1-INV-SO2',
      lotId: 'LOT-SAP-2026',
      category: 'additive',
      amount: 45,
      quantity: 2.5,
      unitCost: 18,
      sourceRef: 'op-1',
      createdBy: 'Nino',
    });
  });

  it('classifies bottle/label/cork inventory as packaging cost', () => {
    expect(classifyInventoryCostCategory({ name: 'Natural cork 44mm', category: 'closures' })).toBe('packaging');
    expect(classifyInventoryCostCategory({ name: 'Bentonite', category: 'additives' })).toBe('additive');
  });

  it('creates packaging and bottling service entries for a bottling run', () => {
    const result = computeBottlingCostPosting({
      runId: 'bot-1',
      date: '2026-12-01',
      lotId: 'LOT-SAP-2026',
      totalUnits: 120,
      packagingSelections: {
        bottle: 'INV-BOTTLE',
        closure: 'INV-CORK',
        label: 'INV-LABEL',
        box: 'INV-BOX',
      },
      inventory: [
        { id: 'INV-BOTTLE', name: 'Burgundy bottle 750ml', category: 'bottles', stock: 500, unit: 'pcs', costPerUnit: 1.2 },
        { id: 'INV-CORK', name: 'Natural cork', category: 'closures', stock: 500, unit: 'pcs', costPerUnit: 0.35 },
        { id: 'INV-LABEL', name: 'Front label', category: 'labels', stock: 500, unit: 'pcs', costPerUnit: 0.18 },
        { id: 'INV-BOX', name: '6-pack case', category: 'boxes', stock: 100, unit: 'pcs', costPerUnit: 2.5 },
      ],
      bottlesPerBox: 6,
      bottlingServiceCost: 84,
      currency: 'GEL',
      createdBy: 'Nino',
    });

    expect(result.deductions).toEqual({
      'INV-BOTTLE': 120,
      'INV-CORK': 120,
      'INV-LABEL': 120,
      'INV-BOX': 20,
    });
    expect(result.packagingCostTotal).toBe(257.6);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      id: 'cost-packaging-bot-1',
      category: 'packaging',
      amount: 257.6,
      sourceRef: 'bot-1',
    });
    expect(result.entries[1]).toMatchObject({
      id: 'cost-bottling-bot-1',
      category: 'bottling',
      amount: 84,
      unitCost: 0.7,
    });
  });
});
