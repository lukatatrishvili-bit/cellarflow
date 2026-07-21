import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CellarOperationsTab, {
  permittedCellarOperationInput,
  type CellarOperationInput,
} from '../components/CellarOperationsTab';
import type { CellarOperation, InventoryItem, Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 920,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01',
  history: [],
};

const vessel: Vessel = {
  id: 'T-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 1_200,
  currentVolume: 920,
  assignedLotId: lot.id,
  cleaningStatus: 'clean',
  lastCleaned: '2026-09-01',
  temperature: 16,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
};

const material: InventoryItem = {
  id: 'INV-SO2',
  name: 'Potassium metabisulfite',
  category: 'additives',
  stock: 5,
  minThreshold: 1,
  unit: 'kg',
  costPerUnit: 20,
  supplierName: 'QA Enology',
  details: 'SO2 additive',
};

const operation: CellarOperation = {
  id: 'OP-1',
  date: '2026-09-06',
  type: 'measurement',
  lotId: lot.id,
  lotName: lot.name,
  vesselId: vessel.id,
  volumeBeforeL: 920,
  operator: 'Nino',
  notes: 'Temperature and density reviewed.',
};

const reversibleOperation: CellarOperation = {
  ...operation,
  id: 'OP-REVERSIBLE',
  commandId: 'cmd-operation-reversible',
  recordKind: 'operation',
  lastModified: '2026-09-06T10:00:00.000Z',
  reversalSnapshot: {
    version: 1,
    lot: { id: lot.id, currentVolume: 920, stage: 'aging' },
    vessel: { id: vessel.id, currentVolume: 920, lastOperation: 'Filled' },
    auditId: 'AUDIT-REVERSIBLE',
    operationDescription: 'Temperature and density reviewed.',
  },
};

const operationInput: CellarOperationInput = {
  date: '2026-09-07',
  type: 'sulfitation',
  lotId: lot.id,
  vesselId: vessel.id,
  vesselToId: 'T-2',
  volumeAfterL: 918,
  materialId: material.id,
  dose: 0.2,
  operator: 'Nino',
  notes: 'Post-racking protection.',
};

function props(
  overrides: Partial<ComponentProps<typeof CellarOperationsTab>> = {},
): ComponentProps<typeof CellarOperationsTab> {
  return {
    lang: 'en',
    lots: [lot],
    vessels: [vessel],
    inventory: [material],
    ops: [operation],
    currentUserName: 'Nino',
    onAddOperation: vi.fn(() => 'OP-2'),
    ...overrides,
  };
}

function renderOperations(
  overrides: Partial<ComponentProps<typeof CellarOperationsTab>> = {},
): string {
  return renderToStaticMarkup(React.createElement(CellarOperationsTab, props(overrides)));
}

describe('CellarOperationsTab action permissions', () => {
  it('keeps operation history visible while hiding every logging control in read-only mode', () => {
    const markup = renderOperations({
      canLogCellarOperation: false,
      canUseOperationVessels: false,
      canConsumeOperationMaterials: false,
    });

    expect(markup).toContain('Read-only operation access');
    expect(markup).toContain('Recent operations');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('Temperature and density reviewed.');
    expect(markup).not.toContain('Operation type');
    expect(markup).not.toContain('Log operation</button>');
  });

  it('keeps core logging available while explaining and hiding forbidden vessel tools', () => {
    const markup = renderOperations({
      canLogCellarOperation: true,
      canUseOperationVessels: false,
      canConsumeOperationMaterials: false,
    });

    expect(markup).toContain('Limited operation tools');
    expect(markup).toContain('Vessel-linked changes are unavailable.');
    expect(markup).toContain('Material deductions and cost posting are unavailable.');
    expect(markup).toContain('Operation type');
    expect(markup).toContain('Log operation</button>');
    expect(markup).not.toContain('Vessel (from)');
    expect(markup).not.toContain('>Vessel</label>');
  });

  it('uses permission-aware empty history guidance for read-only users', () => {
    const markup = renderOperations({
      ops: [],
      canLogCellarOperation: false,
      canUseOperationVessels: false,
      canConsumeOperationMaterials: false,
    });

    expect(markup).toContain('Recorded operations will appear here.');
    expect(markup).not.toContain('Pick a type and log your first.');
  });

  it('preserves every existing control by default', () => {
    const markup = renderOperations();

    expect(markup).not.toContain('Read-only operation access');
    expect(markup).not.toContain('Limited operation tools');
    expect(markup).toContain('Operation type');
    expect(markup).toContain('>Vessel</label>');
    expect(markup).toContain('Log operation</button>');
  });

  it('shows correction only for safely reversible command-created operations', () => {
    const allowed = renderOperations({ ops: [reversibleOperation], canReverseCellarOperation: true });
    const denied = renderOperations({ ops: [reversibleOperation], canReverseCellarOperation: false });

    expect(allowed).toContain('Correct operation for Saperavi Reserve');
    expect(denied).not.toContain('Correct operation for Saperavi Reserve');
  });

  it('localizes the read-only guidance in Georgian', () => {
    const markup = renderOperations({
      lang: 'ka',
      canLogCellarOperation: false,
      canUseOperationVessels: false,
      canConsumeOperationMaterials: false,
    });

    expect(markup).toContain('ოპერაციებზე მხოლოდ ნახვის წვდომა');
    expect(markup).toContain('შეგიძლიათ გადახედოთ ოპერაციების ისტორიას');
    expect(markup).not.toContain('Read-only operation access');
  });

  it('blocks callback input when the compound core permission is absent', () => {
    expect(permittedCellarOperationInput(operationInput, {
      canLogCellarOperation: false,
      canUseOperationVessels: true,
      canConsumeOperationMaterials: true,
    })).toBeNull();
  });

  it('strips stale vessel, inventory, and cost-triggering input when those writes are forbidden', () => {
    const permitted = permittedCellarOperationInput(operationInput, {
      canLogCellarOperation: true,
      canUseOperationVessels: false,
      canConsumeOperationMaterials: false,
    });

    expect(permitted).toMatchObject({
      lotId: lot.id,
      vesselId: null,
      vesselToId: null,
      volumeAfterL: 918,
    });
    expect(permitted?.materialId).toBeUndefined();
    expect(permitted?.dose).toBeUndefined();
  });

  it('preserves permitted compound input unchanged', () => {
    expect(permittedCellarOperationInput(operationInput, {
      canLogCellarOperation: true,
      canUseOperationVessels: true,
      canConsumeOperationMaterials: true,
    })).toEqual(operationInput);
  });
});
