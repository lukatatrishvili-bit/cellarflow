import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CellarWorkspace from '../components/CellarWorkspace';
import type { Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-CELLAR-1',
  name: 'Mukuzani Saperavi',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Mukuzani Block 4',
  region: 'Kakheti',
  initialVolume: 2_000,
  currentVolume: 1_800,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-08-01',
  history: [{
    date: '2026-08-01',
    type: 'Intake',
    description: 'Received and assigned to the main cellar.',
    operator: 'Nino',
  }],
};

const occupiedVessel: Vessel = {
  id: 'TK-CELLAR-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 2_500,
  currentVolume: 1_800,
  assignedLotId: lot.id,
  cleaningStatus: 'clean',
  lastCleaned: '2026-07-30',
  temperature: 16.5,
  coolingJacketActive: false,
  targetTemperature: 16,
  lastOperation: 'Filled',
  locationDetails: 'Main cellar · Row A',
};

const emptyVessel: Vessel = {
  ...occupiedVessel,
  id: 'TK-CELLAR-2',
  capacity: 1_500,
  currentVolume: 0,
  assignedLotId: null,
  lastOperation: 'Sanitized',
};

function props(overrides: Partial<ComponentProps<typeof CellarWorkspace>> = {}): ComponentProps<typeof CellarWorkspace> {
  return {
    lang: 'en',
    lots: [lot],
    vessels: [occupiedVessel, emptyVessel],
    operations: [],
    onUpdateLots: vi.fn(),
    onUpdateVessels: vi.fn(),
    onOpenPassport: vi.fn(),
    setActiveTab: vi.fn(),
    setSelectedTankId: vi.fn(),
    setCalculatorLotId: vi.fn(),
    setCalculatorLotIdA: vi.fn(),
    setLabLotId: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(overrides: Partial<ComponentProps<typeof CellarWorkspace>> = {}): string {
  return renderToStaticMarkup(React.createElement(CellarWorkspace, props(overrides)));
}

describe('CellarWorkspace', () => {
  it('presents the lot and its physical placement in one compact work surface', () => {
    const markup = renderWorkspace();

    expect(markup).toContain('Wine and vessels');
    expect(markup).toContain('By lot');
    expect(markup).toContain('By vessel');
    expect(markup).toContain('Mukuzani Saperavi');
    expect(markup).toContain('TK-CELLAR-1');
    expect(markup).toContain('1,800 L');
    expect(markup).toContain('Quick actions');
    expect(markup).toContain('Activity');
    expect(markup).not.toContain('Stock now');
    expect(markup).not.toContain('Lot cost');
    expect(markup).not.toContain('AI Winemaker Insights');
  });

  it('opens the vessel perspective without losing its assigned lot context', () => {
    const markup = renderWorkspace({ initialMode: 'vessels', initialVesselId: occupiedVessel.id });

    expect(markup).toContain('Vessel register');
    expect(markup).toContain('Main cellar · Row A');
    expect(markup).toContain('Mukuzani Saperavi');
    expect(markup).toContain('recorded setpoint 16°C');
    expect(markup).not.toContain('Active Cooling');
    expect(markup).not.toContain('Thermal Intelligence Loop');
  });

  it('filters the available perspectives and mutations by permission', () => {
    const lotOnly = renderWorkspace({
      canViewLots: true,
      canViewVessels: false,
      canCreateLot: false,
      canUpdateLot: false,
      canCreateVessel: false,
      onLogOperation: undefined,
    });

    expect(lotOnly).toContain('By lot');
    expect(lotOnly).not.toContain('By vessel');
    expect(lotOnly).not.toContain('TK-CELLAR-1');
    expect(lotOnly).not.toContain('New intake');
    expect(lotOnly).not.toContain('Add vessel');
    expect(lotOnly).not.toContain('>Edit</button>');
  });

  it('shows sanitation as a recorded operation rather than an instant status toggle', () => {
    const needsCleaning = { ...emptyVessel, cleaningStatus: 'cleaning_needed' as const };
    const markup = renderWorkspace({
      initialMode: 'vessels',
      initialVesselId: needsCleaning.id,
      vessels: [occupiedVessel, needsCleaning],
      onLogOperation: vi.fn(),
    });

    expect(markup).toContain('Sanitation required');
    expect(markup).toContain('Record sanitation');
    expect(markup).not.toContain('Mark Sanitized Today');
  });
});
