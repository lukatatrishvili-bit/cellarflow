import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import FermentationTab, { dispatchFermentationReadingUpdates } from '../components/FermentationTab';
import type { DailyFermLog, UserProfile, Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Ferment',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 920,
  wineClass: 'red',
  stage: 'fermenting',
  createdAt: '2026-09-01',
  history: [],
};

const vessel: Vessel = {
  id: 'TANK-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 1_500,
  currentVolume: 920,
  assignedLotId: lot.id,
  cleaningStatus: 'clean',
  lastCleaned: '2026-08-31',
  temperature: 21,
  coolingJacketActive: true,
  targetTemperature: 20,
  lastOperation: 'Filled',
};

const log: DailyFermLog = {
  id: 'FERM-1',
  tankId: vessel.id,
  lotId: lot.id,
  date: '2026-09-05',
  temperature: 21,
  density: 1.035,
  sugar: 72,
  ph: 3.45,
  tastingNotes: 'Healthy fruit and steady kinetics.',
  capManagement: 'Punchdowns - 2X Daily',
  additives: 'None',
};

const currentUser: UserProfile = {
  username: 'qa-winemaker',
  email: 'qa@example.com',
  fullName: 'QA Winemaker',
  role: 'Owner/Admin',
  language: 'en',
};

function fermentationProps(
  overrides: Partial<ComponentProps<typeof FermentationTab>> = {},
): ComponentProps<typeof FermentationTab> {
  return {
    lang: 'en',
    vessels: [vessel],
    lots: [lot],
    fermLogs: [log],
    currentUser,
    setActiveTab: vi.fn(),
    onUpdateLots: vi.fn(),
    onUpdateVessels: vi.fn(),
    onUpdateFermLogs: vi.fn(),
    ...overrides,
  };
}

function renderFermentation(overrides: Partial<ComponentProps<typeof FermentationTab>> = {}): string {
  return renderToStaticMarkup(React.createElement(FermentationTab, fermentationProps(overrides)));
}

describe('FermentationTab action permissions', () => {
  it('preserves telemetry, curves, and journal history in read-only mode', () => {
    const markup = renderFermentation({
      canCreateFermentationLog: false,
      canUpdateFermentationLot: false,
      canUpdateFermentationVessel: false,
      canDeleteFermentationLog: false,
    });

    expect(markup).toContain('Fermentation data is read-only for your workspace role');
    expect(markup).toContain('Saperavi Ferment');
    expect(markup).toContain('Healthy fruit and steady kinetics.');
    expect(markup).toContain('Live Kinetic Fermentation Curves');
    expect(markup).toContain('Posted Primary Fermentation Journal');
    expect(markup).not.toContain('Standard Log Entry');
    expect(markup).not.toContain('Log Today');
    expect(markup).not.toContain('✓ Completed');
    expect(markup).not.toContain('title="Delete Entry"');
  });

  it('keeps reading creation while preventing forbidden lot and delete actions', () => {
    const markup = renderFermentation({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: false,
      canUpdateFermentationVessel: true,
      canDeleteFermentationLog: false,
    });

    expect(markup).toContain('Standard Log Entry');
    expect(markup).toContain('Log Today');
    expect(markup).not.toContain('✓ Completed');
    expect(markup).not.toContain('title="Delete Entry"');
    expect(markup).toContain('Marking fermentation campaigns complete is restricted');
    expect(markup).toContain('Deleting journal entries is restricted');
  });

  it('retains the original fully interactive controls by default', () => {
    const markup = renderFermentation();

    expect(markup).toContain('Standard Log Entry');
    expect(markup).toContain('Log Today');
    expect(markup).toContain('✓ Completed');
    expect(markup).toContain('title="Delete Entry"');
    expect(markup).not.toContain('workspace role');
  });

  it('honors the compound completion permission even when individual reading writes remain allowed', () => {
    const markup = renderFermentation({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: true,
      canUpdateFermentationVessel: true,
      canCompleteFermentation: false,
    });

    expect(markup).toContain('Standard Log Entry');
    expect(markup).toContain('Log Today');
    expect(markup).not.toContain('✓ Completed');
    expect(markup).toContain('Marking fermentation campaigns complete is restricted');
  });

  it('offers append-only reopening only for eligible command-created completions', () => {
    const completedLog: DailyFermLog = {
      ...log,
      commandId: 'cmd-fermentation-complete-ui',
      recordKind: 'completion',
      isCompletion: true,
      completedAt: '2026-09-05T12:00:00.000Z',
      completedBy: currentUser.fullName,
      lastModified: '2026-09-05T12:00:00.000Z',
      completionSnapshot: {
        version: 1,
        lot: { id: lot.id, stage: 'fermenting', currentVolume: 920, historyDescription: 'Completed' },
        vessel: { id: vessel.id, currentVolume: 920, assignedLotId: lot.id, lastOperation: 'Filled' },
        finalLog: {
          id: log.id, date: log.date, temperature: log.temperature, density: log.density,
          sugar: log.sugar, ph: log.ph, tastingNotes: log.tastingNotes,
          capManagement: log.capManagement, additives: log.additives,
        },
        auditId: 'audit-fermentation-complete-ui',
      },
    };
    const markup = renderFermentation({
      lots: [{ ...lot, stage: 'stabilization' }],
      fermLogs: [completedLog],
      canReverseFermentationCompletion: true,
      canDeleteFermentationLog: true,
    });

    expect(markup).toContain('Final reading');
    expect(markup).toContain('Reopen');
    expect(markup).not.toContain('title="Delete Entry"');
  });

  it('labels correction rows without presenting them as physical chemistry', () => {
    const correction: DailyFermLog = {
      ...log,
      id: 'FERM-CORRECTION-1',
      commandId: 'cmd-fermentation-complete-reversal-ui',
      recordKind: 'reversal',
      isCompletion: false,
      reversalOfLogId: log.id,
      reversalOfCommandId: 'cmd-fermentation-complete-ui',
      reversalReason: 'Completion was premature.',
      tastingNotes: 'Reversal of fermentation completion: Completion was premature.',
      capManagement: 'correction',
    };
    const markup = renderFermentation({ fermLogs: [correction] });

    expect(markup).toContain('Correction');
    expect(markup).toContain('Completion was premature');
    expect(markup).not.toContain(`${correction.density} SG`);
    expect(markup).not.toContain('title="Delete Entry"');
  });

  it('localizes the read-only guidance in Georgian', () => {
    const markup = renderFermentation({
      lang: 'ka',
      canCreateFermentationLog: false,
      canUpdateFermentationLot: false,
      canUpdateFermentationVessel: false,
      canDeleteFermentationLog: false,
    });

    expect(markup).toContain('დუღილის მონაცემები თქვენი როლისთვის მხოლოდ სანახავია');
    expect(markup).not.toContain('Fermentation data is read-only');
  });

  it('dispatches only collection updates allowed by the compound reading path', () => {
    const fermentationLog = vi.fn();
    const lotHistory = vi.fn();
    const vesselTelemetry = vi.fn();

    expect(dispatchFermentationReadingUpdates({
      canCreateFermentationLog: true,
      canUpdateFermentationLot: false,
      canUpdateFermentationVessel: true,
    }, { fermentationLog, lotHistory, vesselTelemetry })).toBe(true);

    expect(fermentationLog).toHaveBeenCalledOnce();
    expect(lotHistory).not.toHaveBeenCalled();
    expect(vesselTelemetry).toHaveBeenCalledOnce();
  });

  it('guards every reading update when creation is forbidden', () => {
    const fermentationLog = vi.fn();
    const lotHistory = vi.fn();
    const vesselTelemetry = vi.fn();

    expect(dispatchFermentationReadingUpdates({
      canCreateFermentationLog: false,
      canUpdateFermentationLot: true,
      canUpdateFermentationVessel: true,
    }, { fermentationLog, lotHistory, vesselTelemetry })).toBe(false);

    expect(fermentationLog).not.toHaveBeenCalled();
    expect(lotHistory).not.toHaveBeenCalled();
    expect(vesselTelemetry).not.toHaveBeenCalled();
  });
});
