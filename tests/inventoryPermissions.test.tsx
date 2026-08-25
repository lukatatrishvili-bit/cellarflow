import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import InventoryTab from '../components/InventoryTab';
import type { InventoryItem } from '../lib/wineryState';

const item: InventoryItem = {
  id: 'inv-1',
  name: 'QA Yeast',
  category: 'yeasts',
  stock: 10,
  minThreshold: 5,
  unit: 'kg',
  costPerUnit: 20,
  supplierName: 'QA Supplier',
  details: 'Selected strain',
};

function renderInventory(permissions: {
  create: boolean;
  update: boolean;
  delete: boolean;
}): string {
  return renderToStaticMarkup(React.createElement(InventoryTab, {
    inventory: [item],
    onUpdateInventory: vi.fn(),
    canCreateInventory: permissions.create,
    canUpdateInventory: permissions.update,
    canDeleteInventory: permissions.delete,
  }));
}

describe('InventoryTab action permissions', () => {
  it('keeps stock data visible without mutation controls for a read-only role', () => {
    const markup = renderInventory({ create: false, update: false, delete: false });

    expect(markup).toContain('Inventory is read-only for your workspace role');
    expect(markup).toContain('QA Yeast');
    expect(markup).not.toContain('Add New Material');
    expect(markup).not.toContain('Create Custom Material Category');
    expect(markup).not.toContain('title="Edit Material"');
    expect(markup).not.toContain('title="Delete Item"');
    expect(markup).not.toContain('Consume Item');
    expect(markup).not.toContain('Refill Stock');
  });

  it('allows create and update without exposing delete to a winemaker-style role', () => {
    const markup = renderInventory({ create: true, update: true, delete: false });

    expect(markup).toContain('Add New Material');
    expect(markup).toContain('title="Edit Material"');
    expect(markup).not.toContain('Manual stock correction');
    expect(markup).toContain('Receive invoice');
    expect(markup).not.toContain('title="Delete Item"');
  });

  it('keeps all actions for an owner', () => {
    const markup = renderInventory({ create: true, update: true, delete: true });

    expect(markup).toContain('title="Edit Material"');
    expect(markup).toContain('title="Delete Item"');
  });

  it('localizes the read-only explanation in Georgian', () => {
    const markup = renderToStaticMarkup(React.createElement(InventoryTab, {
      lang: 'ka',
      inventory: [item],
      onUpdateInventory: vi.fn(),
      canCreateInventory: false,
      canUpdateInventory: false,
      canDeleteInventory: false,
    }));

    expect(markup).toContain('ინვენტარი მხოლოდ სანახავია');
    expect(markup).not.toContain('Inventory is read-only');
  });
});
