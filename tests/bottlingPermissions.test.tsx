import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import BottlingTab from '../components/BottlingTab';
import type { BottlingRunRecord, InventoryItem, WineLot } from '../lib/wineryState';
import type { StorageLocation } from '../lib/storage';

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
  history: [],
};

const run: BottlingRunRecord = {
  id: 'BOT-2026-01',
  commandId: 'cmd-bottling-2026-01',
  lotId: lot.id,
  lotName: lot.name,
  date: '2026-11-04',
  lotNumber: 'SAP-26-01',
  operator: 'Nino',
  formats: { '0.75': 120 },
  totalBottles: 120,
  totalCeramic: 0,
  volumeBottledL: 90,
};

const packaging: InventoryItem = {
  id: 'INV-BOTTLE-075',
  name: '750 ml bottle',
  category: 'bottles',
  stock: 500,
  minThreshold: 100,
  unit: 'pcs',
  costPerUnit: 1.2,
  supplierName: 'QA Glass',
  details: 'Dark glass',
};

const location: StorageLocation = {
  id: 'STORE-MAIN',
  name: 'Main finished-goods store',
  type: 'warehouse',
  capacityBottles: 10_000,
  targetTempC: 15,
  targetHumidity: 65,
};

const vessel = {
  id: 'TANK-SAP-1', type: 'stainless_steel' as const, shape: 'vertical' as const,
  capacity: 1_000, currentVolume: 900, assignedLotId: lot.id,
  cleaningStatus: 'clean' as const, lastCleaned: '2026-10-01', temperature: 14,
  coolingJacketActive: false, targetTemperature: null, lastOperation: 'Aging',
};

function props(overrides: Partial<ComponentProps<typeof BottlingTab>> = {}): ComponentProps<typeof BottlingTab> {
  return {
    lang: 'en',
    lots: [lot],
    onUpdateLots: vi.fn(),
    vessels: [vessel],
    onUpdateVessels: vi.fn(),
    history: [run],
    onUpdateHistory: vi.fn(),
    inventory: [packaging],
    onUpdateInventory: vi.fn(),
    costEntries: [],
    onUpdateCostEntries: vi.fn(),
    storageLocations: [location],
    stockMovements: [],
    onUpdateStockMovements: vi.fn(),
    currency: 'GEL',
    currentUserName: 'QA Operator',
    setToastMessage: vi.fn(),
    ...overrides,
  };
}

function renderBottling(overrides: Partial<ComponentProps<typeof BottlingTab>> = {}): string {
  return renderToStaticMarkup(React.createElement(BottlingTab, props(overrides)));
}

describe('BottlingTab action permissions', () => {
  it('keeps bottling history visible without exposing mutation controls in read-only mode', () => {
    const markup = renderBottling({
      canCreateBottling: false,
      canReverseBottling: false,
      canUseBottlingCosting: false,
      canPlaceFinishedGoods: false,
    });

    expect(markup).toContain('Read-only access');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('SAP-26-01');
    expect(markup).not.toContain('Record bottling</button>');
    expect(markup).not.toContain('Packaging &amp; bottling cost');
    expect(markup).not.toContain('Place finished goods');
    expect(markup).not.toContain('Correct bottling run for Saperavi Reserve');
  });

  it('allows core bottling without owner-only rollback or unauthorized ledgers', () => {
    const markup = renderBottling({
      canCreateBottling: true,
      canReverseBottling: false,
      canUseBottlingCosting: false,
      canPlaceFinishedGoods: false,
    });

    expect(markup).toContain('You can record bottling runs');
    expect(markup).toContain('Core bottling remains available');
    expect(markup).toContain('Record bottling</button>');
    expect(markup).not.toContain('Packaging &amp; bottling cost');
    expect(markup).not.toContain('Place finished goods');
    expect(markup).not.toContain('Correct bottling run for Saperavi Reserve');
  });

  it('preserves all existing controls by default for an owner', () => {
    const markup = renderBottling();

    expect(markup).toContain('Record bottling</button>');
    expect(markup).toContain('Packaging &amp; bottling cost');
    expect(markup).toContain('Place finished goods');
    expect(markup).toContain('Correct bottling run for Saperavi Reserve');
  });

  it('localizes the read-only explanation in Georgian', () => {
    const markup = renderBottling({
      lang: 'ka',
      canCreateBottling: false,
      canReverseBottling: false,
      canUseBottlingCosting: false,
      canPlaceFinishedGoods: false,
    });

    expect(markup).toContain('მხოლოდ ნახვის წვდომა');
    expect(markup).not.toContain('Read-only access');
  });
});
