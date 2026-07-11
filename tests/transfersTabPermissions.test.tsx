import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TransfersTab from '../components/TransfersTab';
import type { CellarTransferRecord, Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 900,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01',
  history: [],
};

const vessels: Vessel[] = [
  {
    id: 'T-1',
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 1_200,
    currentVolume: 900,
    assignedLotId: lot.id,
    cleaningStatus: 'clean',
    lastCleaned: '2026-09-01',
    temperature: 16,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Filled',
  },
  {
    id: 'T-2',
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 1_200,
    currentVolume: 0,
    assignedLotId: null,
    cleaningStatus: 'dirty',
    lastCleaned: '2026-08-20',
    temperature: 18,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Emptied',
  },
];

const transfer: CellarTransferRecord = {
  id: 'xfer-1',
  sourceId: 'T-1',
  destId: 'T-2',
  volume: 500,
  loss: 4,
  operator: 'Nino',
  category: 'racking',
  date: '2026-09-06',
  pump: 'Enopump E-400',
  details: 'Routine racking completed.',
};

function transferProps(
  overrides: Partial<ComponentProps<typeof TransfersTab>> = {},
): ComponentProps<typeof TransfersTab> {
  return {
    lang: 'en',
    vessels,
    lots: [lot],
    onUpdateVessels: vi.fn(),
    onUpdateLots: vi.fn(),
    pastTransfers: [transfer],
    onUpdateTransfers: vi.fn(),
    ...overrides,
  };
}

function renderTransfers(
  overrides: Partial<ComponentProps<typeof TransfersTab>> = {},
): string {
  return renderToStaticMarkup(React.createElement(TransfersTab, transferProps(overrides)));
}

describe('TransfersTab action permissions', () => {
  it('keeps planning and movement history visible while hiding all mutations in read-only mode', () => {
    const markup = renderTransfers({
      canExecuteTransfer: false,
      canSanitizeVessels: false,
      canRollbackTransfer: false,
    });

    expect(markup).toContain('Read-only transfer access');
    expect(markup).toContain('AI Cellar Transfer Recommender');
    expect(markup).toContain('Safety &amp; Compatibility Check');
    expect(markup).toContain('Winery Translocation Movement Logs Ledger');
    expect(markup).toContain('Routine racking completed.');
    expect(markup).not.toContain('Racking &amp; Blending Form');
    expect(markup).not.toContain('Quick Sanitization Controls');
    expect(markup).not.toContain('Confirm &amp; Initiate Fluid Pump');
    expect(markup).not.toContain('title="Rollback / Undo Movement"');
  });

  it('applies execution, sanitation, and rollback permissions independently', () => {
    const rollbackRestricted = renderTransfers({
      canExecuteTransfer: true,
      canSanitizeVessels: true,
      canRollbackTransfer: false,
    });
    const executionRestricted = renderTransfers({
      canExecuteTransfer: false,
      canSanitizeVessels: true,
      canRollbackTransfer: true,
    });
    const sanitationRestricted = renderTransfers({
      canExecuteTransfer: true,
      canSanitizeVessels: false,
      canRollbackTransfer: true,
    });

    expect(rollbackRestricted).toContain('Limited transfer actions');
    expect(rollbackRestricted).toContain('cannot roll back transfer records');
    expect(rollbackRestricted).toContain('Racking &amp; Blending Form');
    expect(rollbackRestricted).toContain('Quick Sanitization Controls');
    expect(rollbackRestricted).not.toContain('title="Rollback / Undo Movement"');

    expect(executionRestricted).toContain('cannot initiate transfers');
    expect(executionRestricted).not.toContain('Racking &amp; Blending Form');
    expect(executionRestricted).toContain('Quick Sanitization Controls');
    expect(executionRestricted).toContain('title="Rollback / Undo Movement"');

    expect(sanitationRestricted).toContain('cannot sanitize vessels');
    expect(sanitationRestricted).toContain('Racking &amp; Blending Form');
    expect(sanitationRestricted).not.toContain('Quick Sanitization Controls');
    expect(sanitationRestricted).toContain('title="Rollback / Undo Movement"');
  });

  it('retains every existing action by default', () => {
    const markup = renderTransfers();

    expect(markup).not.toContain('Limited transfer actions');
    expect(markup).not.toContain('Read-only transfer access');
    expect(markup).toContain('Racking &amp; Blending Form');
    expect(markup).toContain('Quick Sanitization Controls');
    expect(markup).toContain('title="Rollback / Undo Movement"');
  });

  it('localizes the read-only guidance in Georgian', () => {
    const markup = renderTransfers({
      lang: 'ka',
      canExecuteTransfer: false,
      canSanitizeVessels: false,
      canRollbackTransfer: false,
    });

    expect(markup).toContain('ტრანსფერებზე მხოლოდ ნახვის წვდომა');
    expect(markup).toContain('შეგიძლიათ ნახოთ რეკომენდაციები და გადაადგილების ისტორია');
    expect(markup).not.toContain('Read-only transfer access');
  });
});
