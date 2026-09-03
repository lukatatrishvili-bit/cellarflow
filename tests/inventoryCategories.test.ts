import { describe, expect, it } from 'vitest';
import {
  inventoryItemsForPackagingComponent,
  isInventoryItemForPackagingComponent,
  packagingComponentForItem,
} from '../lib/inventoryCategories';

const products = [
  { id: 'bottle', name: '750 ml bottle', category: 'bottles' },
  { id: 'cork', name: 'Natural cork 44 mm', category: 'closures' },
  { id: 'capsule', name: 'Tin capsule', category: 'capsules' },
  { id: 'label', name: 'Front label', category: 'labels' },
  { id: 'box', name: '6-bottle case', category: 'boxes' },
  { id: 'bentonite', name: 'Bentonite', category: 'additives' },
];

describe('inventory packaging categories', () => {
  it('maps every canonical bottling category to one component only', () => {
    expect(products.map(packagingComponentForItem)).toEqual([
      'bottle',
      'closure',
      'capsule',
      'label',
      'box',
      null,
    ]);
    expect(inventoryItemsForPackagingComponent(products, 'closure').map(item => item.id)).toEqual(['cork']);
  });

  it('supports deterministically named legacy products in the generic packaging category', () => {
    expect(packagingComponentForItem({ name: 'Natural cork', category: 'packaging' })).toBe('closure');
    expect(packagingComponentForItem({ name: '750 ml bottle', category: 'packaging' })).toBe('bottle');
    expect(packagingComponentForItem({ name: 'Generic packaging', category: 'packaging' })).toBeNull();
  });

  it('never treats additives as closures based on a loose global inventory fallback', () => {
    expect(isInventoryItemForPackagingComponent(
      { name: 'Cork aroma treatment', category: 'additives' },
      'closure',
    )).toBe(false);
  });
});
