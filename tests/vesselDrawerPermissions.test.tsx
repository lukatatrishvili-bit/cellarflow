import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import VesselDrawer from '../components/VesselDrawer';
import type { CellarOperation, DailyFermLog, Vessel, WineLot } from '../lib/wineryState';

const vessel: Vessel = {
  id: 'T-DRAWER-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 2_500,
  currentVolume: 2_000,
  assignedLotId: 'LOT-DRAWER-1',
  cleaningStatus: 'dirty',
  lastCleaned: '2026-07-01',
  temperature: 17.8,
  coolingJacketActive: true,
  targetTemperature: 16,
  lastOperation: 'Transferred from press tank.',
  locationDetails: 'Cellar Room B',
};

const lot: WineLot = {
  id: 'LOT-DRAWER-1',
  name: 'Saperavi Drawer Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block S4',
  region: 'Kakheti',
  initialVolume: 2_200,
  currentVolume: 2_000,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-06-15',
  history: [],
};

const fermentationLog: DailyFermLog = {
  id: 'ferm-drawer-1',
  tankId: 'T-DRAWER-1',
  lotId: 'LOT-DRAWER-1',
  date: new Date().toISOString().slice(0, 10),
  temperature: 17.6,
  density: 0.997,
  sugar: 2,
  ph: 3.5,
  tastingNotes: 'Stable',
  capManagement: 'None',
  additives: '',
};

const recentOperation: CellarOperation = {
  id: 'OP-DRAWER-NEW',
  recordKind: 'operation',
  lastModified: '2026-08-24T12:00:00.000Z',
  date: '2026-08-24',
  type: 'measurement',
  lotId: lot.id,
  lotName: lot.name,
  vesselId: vessel.id,
  volumeBeforeL: 2_000,
  operator: 'Nino Winemaker',
  notes: 'Density and temperature confirmed.',
};

function drawerProps(
  overrides: Partial<ComponentProps<typeof VesselDrawer>> = {},
): ComponentProps<typeof VesselDrawer> {
  return {
    lang: 'en',
    selectedTankId: vessel.id,
    vessels: [vessel],
    lots: [lot],
    fermLogs: [fermentationLog],
    onClose: vi.fn(),
    onAdjustTargetTemp: vi.fn(),
    onToggleSanitation: vi.fn(),
    onToggleCoolingJacket: vi.fn(),
    onUpdateVessels: vi.fn(),
    ...overrides,
  };
}

function renderDrawer(overrides: Partial<ComponentProps<typeof VesselDrawer>> = {}): string {
  return renderToStaticMarkup(React.createElement(VesselDrawer, drawerProps(overrides)));
}

describe('VesselDrawer permissions', () => {
  it('preserves vessel review while hiding every direct mutation control', () => {
    const markup = renderDrawer({ canUpdateVessel: false });

    expect(markup).toContain('Read-only vessel details.');
    expect(markup).toContain('T-DRAWER-1');
    expect(markup).toContain('Cellar Room B');
    expect(markup).toContain('Saperavi Drawer Reserve');
    expect(markup).toContain('Thermal Intelligence Loop');
    expect(markup).toContain('17.8 °C');
    expect(markup).toContain('Active Cooling');
    expect(markup).toContain('7-Day Thermal History');
    expect(markup).toContain('Sanitation &amp; Hygiene Protocol');
    expect(markup).toContain('AI Winemaker Insights');
    expect(markup).toContain('Transferred from press tank.');
    expect(markup).toContain('aria-label="Close vessel details"');
    expect(markup).not.toContain('title="Edit Properties"');
    expect(markup).not.toContain('aria-label="Decrease target temperature"');
    expect(markup).not.toContain('aria-label="Increase target temperature"');
    expect(markup).not.toContain('Mark Sanitized Today');
    expect(markup).not.toContain('Save Changes');
  });

  it('retains all existing update actions by default', () => {
    const markup = renderDrawer();

    expect(markup).toContain('title="Edit Properties"');
    expect(markup).toContain('aria-label="Decrease target temperature"');
    expect(markup).toContain('aria-label="Increase target temperature"');
    expect(markup).toContain('Mark Sanitized Today');
    expect(markup).not.toContain('Read-only vessel details.');
  });

  it('adds a contextual operation launcher when operation logging is available', () => {
    const markup = renderDrawer({ onLogOperation: vi.fn() });

    expect(markup).toContain('Act from this vessel');
    expect(markup).toContain('Saperavi Drawer Reserve · choose an operation');
    expect(markup).toContain('T-DRAWER-1 and its assigned lot will stay preselected');
    expect(markup).toContain('Recommended operation');
    expect(markup).toContain('Temp / Brix check');
    expect(markup).toContain('Sulfitation (SO₂)');
    expect(markup).toContain('Transfer / racking');
    expect(markup).toContain('Additive addition');
    expect(markup).toContain('View all operations');
  });

  it('keeps operation controls absent when operation logging is unavailable', () => {
    const markup = renderDrawer({ onLogOperation: undefined });

    expect(markup).not.toContain('Act from this vessel');
    expect(markup).not.toContain('View all operations');
  });

  it('highlights a newly logged operation in the vessel context and ledger', () => {
    const markup = renderDrawer({
      onLogOperation: vi.fn(),
      operations: [recentOperation],
      recentlyLoggedOperationId: recentOperation.id,
    });

    expect(markup).toContain('Operation logged successfully');
    expect(markup).toContain('Temp / Brix check · Nino Winemaker');
    expect(markup).toContain('Density and temperature confirmed.');
    expect(markup).toContain('>New</span>');
    expect(markup).toContain('Nino Winemaker · Saperavi Drawer Reserve');
  });

  it('localizes read-only guidance and preserves the Georgian close action', () => {
    const markup = renderDrawer({ lang: 'ka', canUpdateVessel: false });

    expect(markup).toContain('ჭურჭლის დეტალები მხოლოდ სანახავია.');
    expect(markup).toContain('შეგიძლიათ ნახოთ ტელემეტრია, ტემპერატურის ისტორია');
    expect(markup).toContain('aria-label="დახურვა"');
    expect(markup).not.toContain('Read-only vessel details.');
    expect(markup).not.toContain('aria-label="სამიზნე ტემპერატურის შემცირება"');
  });
});
