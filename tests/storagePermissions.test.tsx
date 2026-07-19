import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import StorageTab from '../components/StorageTab';

const lot = {
  id: 'LOT-SAP-2026',
  name: 'Saperavi Reserve',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block A',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 0,
  wineClass: 'red' as const,
  stage: 'bottled' as const,
  createdAt: '2026-09-01',
  history: [],
};

const location = {
  id: 'loc-main',
  name: 'Main Warehouse',
  type: 'warehouse' as const,
  capacityBottles: 2_000,
  targetTempC: 14,
};

const movement = {
  id: 'mov-receive',
  date: '2026-09-10',
  lotId: lot.id,
  locationId: location.id,
  direction: 'in' as const,
  bottles: 120,
  reason: 'receive',
};

function storageProps(overrides: Partial<ComponentProps<typeof StorageTab>> = {}): ComponentProps<typeof StorageTab> {
  return {
    lang: 'en',
    lots: [lot],
    bottlingRuns: [{
      id: 'bottle-1',
      lotId: lot.id,
      lotName: lot.name,
      date: '2026-09-09',
      lotNumber: 'SAP-26',
      operator: 'Nino',
      formats: { '750ml': 150 },
      totalBottles: 150,
      totalCeramic: 0,
      volumeBottledL: 112.5,
    }],
    locations: [location],
    movements: [movement],
    onUpdateLocations: vi.fn(),
    onUpdateMovements: vi.fn(),
    ...overrides,
  };
}

function renderStorage(overrides: Partial<ComponentProps<typeof StorageTab>> = {}): string {
  return renderToStaticMarkup(React.createElement(StorageTab, storageProps(overrides)));
}

describe('StorageTab action permissions', () => {
  it('keeps locations, stock, availability, and movement history visible in read-only mode', () => {
    const markup = renderStorage({
      canCreateLocation: false,
      canDeleteLocation: false,
      canCreateMovement: false,
      canDeleteMovement: false,
    });

    expect(markup).toContain('Storage data is read-only');
    expect(markup).toContain('Main Warehouse');
    expect(markup).toContain('Saperavi Reserve');
    expect(markup).toContain('Recent movements');
    expect(markup).toContain('Available');
    expect(markup).toContain('Bottled but not yet placed in storage');
    expect(markup).not.toContain('Add location');
    expect(markup).not.toContain('Stock movement');
    expect(markup).not.toContain('Delete location Main Warehouse');
    expect(markup).not.toContain('Delete movement 2026-09-10');
  });

  it('retains every existing action by default', () => {
    const markup = renderStorage();

    expect(markup).toContain('Add location');
    expect(markup).toContain('Stock movement');
    expect(markup).toContain('Delete location Main Warehouse');
    expect(markup).toContain('Delete movement 2026-09-10');
    expect(markup).not.toContain('Some storage actions are unavailable');
    expect(markup).not.toContain('Storage data is read-only');
  });

  it('keeps bulk wine out of the finished-goods movement picker', () => {
    const bulkLot = {
      ...lot,
      id: 'LOT-BULK-2026',
      name: 'Unbottled Saperavi',
      stage: 'aging' as const,
      currentVolume: 500,
    };
    const withoutProvenance = renderStorage({
      lots: [bulkLot],
      bottlingRuns: [],
      movements: [],
    });
    const withPartialBottling = renderStorage({
      lots: [bulkLot],
      bottlingRuns: [{
        ...storageProps().bottlingRuns[0],
        id: 'partial-run',
        lotId: bulkLot.id,
        lotName: bulkLot.name,
        totalBottles: 24,
      }],
      movements: [],
    });

    expect(withoutProvenance).toContain('No bottled lots available');
    expect(withoutProvenance).not.toContain('<option value="LOT-BULK-2026"');
    expect(withPartialBottling).toContain('<option value="LOT-BULK-2026"');
  });

  it.each([
    {
      blockedProp: 'canCreateLocation' as const,
      blockedText: 'Add location',
      retainedText: 'Stock movement',
    },
    {
      blockedProp: 'canDeleteLocation' as const,
      blockedText: 'Delete location Main Warehouse',
      retainedText: 'Delete movement 2026-09-10',
    },
    {
      blockedProp: 'canCreateMovement' as const,
      blockedText: 'Stock movement',
      retainedText: 'Add location',
    },
    {
      blockedProp: 'canDeleteMovement' as const,
      blockedText: 'Delete movement 2026-09-10',
      retainedText: 'Delete location Main Warehouse',
    },
  ])('applies $blockedProp independently', ({ blockedProp, blockedText, retainedText }) => {
    const markup = renderStorage({ [blockedProp]: false });

    expect(markup).toContain('Some storage actions are unavailable for your role');
    expect(markup).not.toContain(blockedText);
    expect(markup).toContain(retainedText);
  });

  it('localizes read-only guidance in Georgian', () => {
    const markup = renderStorage({
      lang: 'ka',
      canCreateLocation: false,
      canDeleteLocation: false,
      canCreateMovement: false,
      canDeleteMovement: false,
    });

    expect(markup).toContain('შენახვის მონაცემები მხოლოდ სანახავია');
    expect(markup).toContain('მოძრაობების ისტორია');
    expect(markup).not.toContain('Storage data is read-only');
  });

  it('localizes partial-access guidance in Georgian', () => {
    const markup = renderStorage({
      lang: 'ka',
      canDeleteMovement: false,
    });

    expect(markup).toContain('შენახვის ზოგიერთი მოქმედება თქვენი როლისთვის მიუწვდომელია');
    expect(markup).not.toContain('Some storage actions are unavailable');
  });
});
