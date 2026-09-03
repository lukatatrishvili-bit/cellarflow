import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import WineLotsTrace, { commitWineLotMutationIfAllowed } from '../components/WineLotsTrace';
import type { WineLot } from '../lib/wineryState';

const lot: WineLot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Mukuzani Block 1',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 900,
  wineClass: 'red',
  stage: 'aging',
  createdAt: '2026-09-01',
  history: [{
    date: '2026-09-01',
    type: 'Intake',
    description: 'Received from Mukuzani Block 1.',
    operator: 'Nino',
  }],
};

function lotProps(overrides: Partial<ComponentProps<typeof WineLotsTrace>> = {}): ComponentProps<typeof WineLotsTrace> {
  return {
    lang: 'en',
    lots: [lot],
    onUpdateLots: vi.fn(),
    onOpenPassport: vi.fn(),
    setActiveTab: vi.fn(),
    setSelectedTankId: vi.fn(),
    setCalculatorLotId: vi.fn(),
    setCalculatorLotIdA: vi.fn(),
    ...overrides,
  };
}

function renderLots(overrides: Partial<ComponentProps<typeof WineLotsTrace>> = {}): string {
  return renderToStaticMarkup(React.createElement(WineLotsTrace, lotProps(overrides)));
}

describe('WineLotsTrace permissions', () => {
  it('keeps traceability and navigation available in a clear read-only view', () => {
    const markup = renderLots({ canCreateLot: false, canUpdateLot: false });

    expect(markup).toContain('Read-only wine lot access');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('Received from Mukuzani Block 1.');
    expect(markup).toContain('Lineage');
    expect(markup).toContain('Passport');
    expect(markup).not.toContain('New grape intake');
    expect(markup).not.toContain('Advance / Modify Stage');
    expect(markup).not.toContain('Save Changes');
    expect(markup).not.toContain('Confirm Transition');
    expect(markup).not.toContain('>Edit</button>');
  });

  it('applies create and update permissions independently', () => {
    const updateOnly = renderLots({ canCreateLot: false, canUpdateLot: true });
    expect(updateOnly).not.toContain('New grape intake');
    expect(updateOnly).toContain('Advance / Modify Stage');
    expect(updateOnly).toContain('>Edit</button>');

    const createOnly = renderLots({ canCreateLot: true, canUpdateLot: false });
    expect(createOnly).toContain('New grape intake');
    expect(createOnly).not.toContain('Advance / Modify Stage');
    expect(createOnly).not.toContain('>Edit</button>');
  });

  it('guards the persisted mutation callback even if a write path is invoked directly', () => {
    const onUpdateLots = vi.fn();
    const nextLots = [{ ...lot, currentVolume: 850 }];

    expect(commitWineLotMutationIfAllowed(false, nextLots, onUpdateLots)).toBe(false);
    expect(onUpdateLots).not.toHaveBeenCalled();

    expect(commitWineLotMutationIfAllowed(true, nextLots, onUpdateLots)).toBe(true);
    expect(onUpdateLots).toHaveBeenCalledOnce();
    expect(onUpdateLots).toHaveBeenCalledWith(nextLots);
  });

  it('localizes the read-only notice for Georgian users', () => {
    const markup = renderLots({ lang: 'ka', canCreateLot: false, canUpdateLot: false });

    expect(markup).toContain('ღვინის პარტიებზე მხოლოდ ნახვის წვდომა');
    expect(markup).not.toContain('Read-only wine lot access');
  });

  it('keeps the original create and update behavior enabled by default', () => {
    const markup = renderLots();

    expect(markup).toContain('New grape intake');
    expect(markup).toContain('Advance / Modify Stage');
    expect(markup).toContain('Add an aging lab panel');
    expect(markup).toContain('Needs data');
    expect(markup).toContain('Red wine workflow');
    expect(markup).toContain('>Qvevri</button>');
    expect(markup).not.toContain('Read-only wine lot access');
    expect(markup).toContain('>Edit</button>');
  });
});
