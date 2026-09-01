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
  });
});
