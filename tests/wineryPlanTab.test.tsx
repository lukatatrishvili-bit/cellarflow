import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WineryPlanTab from '../components/WineryPlanTab';
import type { Vessel, WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-MAP-1', name: 'Reserve Saperavi', vintage: 2026, variety: 'Saperavi',
  vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 800, currentVolume: 800,
  wineClass: 'red', stage: 'aging', createdAt: '2026-08-01', history: [],
};

const vessels: Vessel[] = [{
  id: 'TK-MAP-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 800,
  assignedLotId: lot.id, cleaningStatus: 'clean', lastCleaned: '2026-08-01', temperature: 16,
  coolingJacketActive: false, targetTemperature: null, lastOperation: 'Filled',
}, {
  id: 'TK-MAP-2', type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 0,
  assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2026-08-20', temperature: 16,
  coolingJacketActive: false, targetTemperature: null, lastOperation: 'Sanitized',
}];

function renderTab(): string {
  return renderToStaticMarkup(<WineryPlanTab
    lang="en"
    vessels={vessels}
    lots={[lot]}
    productionPlans={[]}
    currentUsername="ana"
    wineryName="Gorge Wine Company"
    onUpdateVessels={vi.fn()}
    onUpdateProductionPlans={vi.fn()}
    onOpenVessel={vi.fn()}
    onOpenLot={vi.fn()}
    onLogOperation={vi.fn()}
    onStartTransfer={vi.fn()}
    onStartFilling={vi.fn()}
    onOpenBottling={vi.fn()}
    onOpenPlanner={vi.fn()}
    onBackToWinery={vi.fn()}
    canUpdateLayout
    canScheduleWork
  />);
}

describe('WineryPlanTab', () => {
  it('uses an immersive top navigation while keeping every operational shortcut in reach', () => {
    const markup = renderToStaticMarkup(<WineryPlanTab
      lang="en"
      vessels={vessels}
      lots={[lot]}
      productionPlans={[]}
      currentUsername="ana"
      wineryName="Gorge Wine Company"
      onUpdateVessels={vi.fn()}
      onUpdateProductionPlans={vi.fn()}
      onOpenVessel={vi.fn()}
      onOpenLot={vi.fn()}
      onLogOperation={vi.fn()}
      onStartTransfer={vi.fn()}
      onStartFilling={vi.fn()}
      onOpenBottling={vi.fn()}
      onOpenPlanner={vi.fn()}
      onBackToWinery={vi.fn()}
      canUpdateLayout
      canScheduleWork
    />);

    expect(markup).toContain('Gorge Wine Company');
    expect(markup).toContain('Winery Plan');
    expect(markup).toContain('Top-down');
    expect(markup).toContain('3D');
    expect(markup).not.toContain('3D view is planned');
    expect(markup).toContain('Production plan');
    expect(markup).toContain('Back to winery');
    expect(markup).toContain('Open wine lot');
    expect(markup).toContain('Record operation');
    expect(markup).toContain('Assign work');
    expect(markup).toContain('Start transfer');
    expect(markup).toContain('data-operation-type="bottling"');
    expect(markup).toContain('data-view-transition="top-down"');
  });

  it('offers the headline figures as filters over the room', () => {
    const markup = renderTab();

    // Each figure is a control, not a caption: pressing one spotlights the
    // vessels behind the number.
    expect(markup).toContain('Spotlight the vessels holding wine');
    expect(markup).toContain('Spotlight the empty, clean vessels');
    expect(markup).toContain('Spotlight the vessels carrying a lot');
    expect(markup).toContain('Spotlight the vessels with work booked');
    expect(markup).toContain('press a figure to filter the room');
    expect(markup).toContain('aria-pressed="false"');
  });
});
