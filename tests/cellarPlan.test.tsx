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

    expect(markup).toContain('Cellar plan');
    expect(markup).toContain('aria-label="TK-1 · 80% full"');
    expect(markup).toContain('Contents');
    expect(markup).toContain('Temp.');
    expect(markup).toContain('Hygiene');
    expect(markup).toContain('Edit plan');
    expect(markup).toContain('Open vessel');
  });

  it('keeps layout mutation controls out of read-only workspaces', () => {
    const markup = renderPlan({ canUpdate: false });

    expect(markup).not.toContain('Edit plan');
    expect(markup).not.toContain('Save plan');
    expect(markup).toContain('Physical vessel layout');
  });
});
