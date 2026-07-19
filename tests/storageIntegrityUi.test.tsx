import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import StorageTab from '../components/StorageTab';

const lot = {
  id: 'lot-1', name: 'Saperavi', vintage: 2027, variety: 'Saperavi', vineyardBlock: 'A', region: 'Kakheti',
  initialVolume: 75, currentVolume: 0, wineClass: 'red' as const, stage: 'bottled' as const, createdAt: '2027-01-01', history: [],
};
const location = { id: 'loc-1', name: 'Main Warehouse', type: 'warehouse' as const };
const receipt = { id: 'mov-in', date: '2027-01-10', lotId: lot.id, locationId: location.id, direction: 'in' as const, bottles: 100 };

const props = (overrides: Partial<ComponentProps<typeof StorageTab>> = {}): ComponentProps<typeof StorageTab> => ({
  lang: 'en',
  lots: [lot],
  bottlingRuns: [],
  locations: [location],
  movements: [],
  onUpdateLocations: vi.fn(),
  onUpdateMovements: vi.fn(),
  ...overrides,
});

const renderStorage = (overrides: Partial<ComponentProps<typeof StorageTab>> = {}) => (
  renderToStaticMarkup(React.createElement(StorageTab, props(overrides)))
);

describe('StorageTab deletion integrity guidance', () => {
  it('locks a referenced location and names each blocking record category', () => {
    const markup = renderStorage({
      movements: [receipt],
      bottlingRuns: [{
        id: 'run-1', lotId: lot.id, lotName: lot.name, date: '2027-01-10', lotNumber: 'SAP-27', operator: 'Nino',
        formats: {}, totalBottles: 100, totalCeramic: 0, volumeBottledL: 75, storageLocationId: location.id,
      }],
      orders: [{
        id: 'order-1', orderDate: '2027-01-11', createdAt: '2027-01-11T00:00:00Z', customerName: 'Wine Bar',
        lotId: lot.id, lotName: lot.name, locationId: location.id, locationName: location.name, bottles: 20,
        pricePerBottle: 20, currency: 'GEL', revenue: 400, status: 'reserved', operator: 'Nino',
      }],
      dispatches: [{
        id: 'dispatch-1', date: '2027-01-12', customerName: 'Restaurant', lotId: lot.id, lotName: lot.name,
        locationId: location.id, locationName: location.name, bottles: 10, pricePerBottle: 20, currency: 'GEL',
        revenue: 200, stockMovementId: 'mov-out', operator: 'Nino',
      }],
    });

    expect(markup).toContain('Deletion locked: 1 stock movement, 1 bottling run, 1 sales order, and 1 sales dispatch still reference this location');
    expect(markup).toContain('aria-label="Delete location Main Warehouse"');
    expect(markup).toContain('disabled=""');
  });

  it('explains why source-linked and reservation-critical movements cannot be deleted', () => {
    const linked = renderStorage({
      movements: [{ ...receipt, sourceRef: 'run-1' }],
      bottlingRuns: [{
        id: 'run-1', lotId: lot.id, lotName: lot.name, date: '2027-01-10', lotNumber: 'SAP-27', operator: 'Nino',
        formats: {}, totalBottles: 100, totalCeramic: 0, volumeBottledL: 75, storageMovementId: receipt.id,
      }],
    });
    const reserved = renderStorage({
      movements: [receipt, { ...receipt, id: 'mov-extra', bottles: 20 }],
      orders: [{
        id: 'order-1', orderDate: '2027-01-11', createdAt: '2027-01-11T00:00:00Z', customerName: 'Wine Bar',
        lotId: lot.id, lotName: lot.name, locationId: location.id, locationName: location.name, bottles: 110,
        pricePerBottle: 20, currency: 'GEL', revenue: 2200, status: 'reserved', operator: 'Nino',
      }],
    });

    expect(linked).toContain('Movement locked because it belongs to 1 bottling run');
    expect(linked).toContain('Delete the source record from its workflow instead');
    expect(reserved).toContain('Deletion would leave 100 bottles for 110 reserved');
    expect(reserved).toContain('Move or cancel the reservations first');
  });

  it('keeps deletion available for an unreferenced empty location', () => {
    const markup = renderStorage();

    expect(markup).toContain('Delete location Main Warehouse');
    expect(markup).not.toContain('Deletion locked:');
  });
});
