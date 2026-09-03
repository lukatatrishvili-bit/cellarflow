import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import CellarPlan, { deriveCellarPlanPositions } from '../components/CellarPlan';
import type { Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-PLAN-1',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 800,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-08-01',
  history: [],
};

const vessel = (id: string, overrides: Partial<Vessel> = {}): Vessel => ({
  id,
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 1_000,
  currentVolume: 800,
  assignedLotId: lot.id,
  cleaningStatus: 'clean',
  lastCleaned: '2026-08-01',
  temperature: 16,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
  locationDetails: 'Main hall',
  ...overrides,
});

function renderPlan(overrides: Partial<ComponentProps<typeof CellarPlan>> = {}): string {
  return renderToStaticMarkup(React.createElement(CellarPlan, {
    lang: 'en',
    vessels: [vessel('TK-1'), vessel('TK-2', { currentVolume: 0, assignedLotId: null })],
    lots: [lot],
    selectedVesselId: 'TK-1',
    onSelectVessel: vi.fn(),
    onOpenVessel: vi.fn(),
    onUpdateVessels: vi.fn(),
    canUpdate: true,
    ...overrides,
  }));
}

describe('CellarPlan', () => {
  it('gives unplaced vessels deterministic, non-overlapping plan positions', () => {
    const positions = deriveCellarPlanPositions([
      vessel('TK-1', { xGrid: 50, yGrid: 50 }),
      vessel('TK-2', { xGrid: 50, yGrid: 50 }),
      vessel('TK-3'),
    ]);

    expect(positions['TK-1']).toEqual({ x: 50, y: 50 });
    expect(new Set(Object.values(positions).map(position => `${position.x}:${position.y}`)).size).toBe(3);
  });

  it('renders liquid levels, operational layers, and an explicit edit entry point', () => {
    const markup = renderPlan();

    expect(markup).toContain('Digital cellar plan');
    expect(markup).toContain('aria-label="TK-1 · 80% full"');
    expect(markup).toContain('Wine');
    expect(markup).toContain('Temp.');
    expect(markup).toContain('Hygiene');
    expect(markup).toContain('Work');
    expect(markup).toContain('X-ray');
    expect(markup).toContain('Vessel labels');
    expect(markup).toContain('map-metal-');
    expect(markup).toContain('Edit layout');
    expect(markup).toContain('Fit');
    expect(markup).toContain('Floor pulse');
    expect(markup).toContain('Navigator');
    expect(markup).toContain('Vessel details');
  });

  it('exposes lot, operation, scheduling, and transfer actions from a selected vessel', () => {
    const markup = renderPlan({
      onOpenLot: vi.fn(),
      onLogOperation: vi.fn(),
      onScheduleOperation: vi.fn(),
      onPlanTransfer: vi.fn(),
      onOpenBottling: vi.fn(),
    });

    expect(markup).toContain('Open wine lot');
    expect(markup).toContain('Record operation');
    expect(markup).toContain('Available vessel operations');
    expect(markup).toContain('data-operation-type="fining"');
    expect(markup).toContain('data-operation-type="custom"');
    expect(markup).toContain('data-operation-type="bottling"');
    expect(markup).toContain('Assign work');
    expect(markup).toContain('Start transfer');
  });

  it('draws the top-down footprint from the same physical model used in 3D', () => {
    const markup = renderPlan({
      vessels: [vessel('TK-PHYSICAL', {
        planModel: 'horizontal_tank',
        planWidthMeters: 3,
        planDepthMeters: 1.2,
        planHeightMeters: 1.4,
        planRotationDegrees: 37,
      })],
      selectedVesselId: 'TK-PHYSICAL',
    });

    expect(markup).toContain('Horizontal tank');
    expect(markup).toContain('3.0 × 1.2 m');
    expect(markup).toContain('transform:rotate(37deg)');
  });

  it('records sanitation as evidence for an empty vessel instead of a status toggle', () => {
    const dirty = vessel('TK-DIRTY', { currentVolume: 0, assignedLotId: null, cleaningStatus: 'cleaning_needed' });
    const markup = renderPlan({
      vessels: [dirty],
      selectedVesselId: dirty.id,
      onRecordSanitation: vi.fn(),
    });

    expect(markup).toContain('Record sanitation');
    expect(markup).not.toContain('Mark clean');
  });

  it('draws scaled winery work areas and utilities without obscuring vessel controls', () => {
    const markup = renderPlan({
      floors: [{
        id: 'cellar-floor-main', name: 'Main cellar', level: 0, widthMeters: 30, heightMeters: 18, gridMeters: 1,
        planObjects: [
          { id: 'fermentation-zone', kind: 'zone', label: 'Fermentation bay', zoneUse: 'fermentation', xMeters: 8, yMeters: 6, widthMeters: 8, heightMeters: 5 },
          { id: 'wash-point', kind: 'water', label: 'Wash point', xMeters: 15, yMeters: 4, widthMeters: 1, heightMeters: 1 },
        ],
      }],
      onUpdateFloors: vi.fn(),
    });

    expect(markup).toContain('Fermentation bay');
    expect(markup).toContain('Wash point');
    expect(markup).toContain('Areas');
    expect(markup).toContain('pointer-events-none');
  });

  it('keeps layout mutation controls out of read-only workspaces', () => {
    const markup = renderPlan({ canUpdate: false });

    expect(markup).not.toContain('Edit layout');
    expect(markup).not.toContain('Floor settings');
    expect(markup).toContain('scaled, multi-floor workspace');
  });
});
