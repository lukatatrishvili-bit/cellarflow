import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WineryPlanStage from '../components/WineryPlanStage';
import type { Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-STAGE-1', name: 'Saperavi Reserve', vintage: 2026, variety: 'Saperavi',
  vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 800,
  wineClass: 'red', stage: 'aging', createdAt: '2026-08-01', history: [],
};

const vessel = (id: string, overrides: Partial<Vessel> = {}): Vessel => ({
  id, type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 800,
  assignedLotId: lot.id, cleaningStatus: 'clean', lastCleaned: '2026-08-01', temperature: 16,
  coolingJacketActive: false, targetTemperature: null, lastOperation: 'Filled',
  ...overrides,
});

function renderStage(overrides: Partial<ComponentProps<typeof WineryPlanStage>> = {}): string {
  return renderToStaticMarkup(React.createElement(WineryPlanStage, {
    lang: 'en',
    view: 'top-down',
    vessels: [vessel('TK-1', { xGrid: 20, yGrid: 40 }), vessel('TK-2', { currentVolume: 0, assignedLotId: null })],
    lots: [lot],
    selectedVesselId: 'TK-1',
    onSelectVessel: vi.fn(),
    onUpdateVessels: vi.fn(),
    onOpenVessel: vi.fn(),
    canUpdate: true,
    ...overrides,
  }));
}

describe('WineryPlanStage', () => {
  it('serves both perspectives from one stage rather than two components', () => {
    const plan = renderStage();
    const orbit = renderStage({ view: '3d' });

    expect(plan).toContain('data-plan-view="top-down"');
    expect(orbit).toContain('data-plan-view="3d"');
    // Same chrome, same vessels: only the camera differs between the two.
    expect(plan).toContain('data-testid="winery-plan-stage"');
    expect(orbit).toContain('data-testid="winery-plan-stage"');
    expect(plan).toContain('aria-label="TK-1 · 80% full"');
    expect(orbit).toContain('aria-label="TK-1 · 80% full"');
  });

  it('lays the plan out flat when the canvas has not taken over yet', () => {
    const markup = renderStage();

    // Server markup and WebGL-less devices still get a usable plan: the chips
    // carry the floor coordinates the canvas would otherwise project.
    expect(markup).toContain('left:20%');
    expect(markup).toContain('top:40%');
  });

  it('keeps the operational surface on the plan', () => {
    const markup = renderStage({
      onOpenLot: vi.fn(),
      onLogOperation: vi.fn(),
      onScheduleOperation: vi.fn(),
      onPlanTransfer: vi.fn(),
      onOpenBottling: vi.fn(),
    });

    expect(markup).toContain('Open wine lot');
    expect(markup).toContain('Record operation');
    expect(markup).toContain('Assign work');
    expect(markup).toContain('Start transfer');
    expect(markup).toContain('Vessel details');
    expect(markup).toContain('data-operation-type="bottling"');
    expect(markup).toContain('X-ray');
    expect(markup).toContain('Vessel labels');
    expect(markup).toContain('Find vessel on plan');
    expect(markup).toContain('Edit layout');
  });

  it('reports overlapping footprints before a layout is committed', () => {
    const markup = renderStage({
      vessels: [
        vessel('TK-A', { xGrid: 50, yGrid: 50, planWidthMeters: 4, planDepthMeters: 4 }),
        vessel('TK-B', { xGrid: 51, yGrid: 50, planWidthMeters: 4, planDepthMeters: 4 }),
      ],
      selectedVesselId: 'TK-A',
    });

    expect(markup).toContain('Footprint overlaps TK-B');
  });

  it('keys the room with a legend for the active layer', () => {
    const markup = renderStage();

    // Colour on the vessels means nothing without a key, and the key has to
    // count what it is describing.
    expect(markup).toContain('Holding wine');
    expect(markup).toContain('Empty');
    expect(markup).not.toContain('Needs sanitation');
  });

  it('names the filter in the legend so an emptied room is explicable', () => {
    const plain = renderStage();
    expect(plain).not.toContain('Clean capacity');

    const filtered = renderStage({ focus: 'available', onFocusChange: vi.fn() });
    expect(filtered).toContain('Clean capacity');
  });

  it('keeps layout mutation out of read-only workspaces', () => {
    const markup = renderStage({ canUpdate: false });

    expect(markup).not.toContain('Edit layout');
    expect(markup).not.toContain('Floor settings');
  });
});
