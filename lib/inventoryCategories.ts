import type { InventoryItem } from './wineryState';

export type PackagingComponent = 'bottle' | 'closure' | 'capsule' | 'label' | 'box';

export const CORE_INVENTORY_CATEGORIES = [
  'yeasts',
  'nutritions',
  'additives',
  'bottles',
  'closures',
  'capsules',
  'labels',
  'boxes',
  'sanitation',
  'cleaning',
] as const;

const CATEGORY_COMPONENT_ALIASES: Record<PackagingComponent, string[]> = {
  bottle: [
    'bottle', 'bottles', 'ceramic', 'ceramics', 'glass bottles',
    'ბოთლი', 'ბოთლები', 'კერამიკა',
  ],
  closure: [
    'closure', 'closures', 'cork', 'corks', 'stopper', 'stoppers',
    'საცობი', 'საცობები',
  ],
  capsule: [
    'capsule', 'capsules', 'foil', 'foils',
    'კაფსულა', 'კაფსულები', 'ჩაჩი', 'ჩაჩები',
  ],
  label: [
    'label', 'labels',
    'ეტიკეტი', 'ეტიკეტები',
  ],
  box: [
    'box', 'boxes', 'case', 'cases', 'carton', 'cartons',
    'ყუთი', 'ყუთები', 'კოლოფი', 'კოლოფები',
  ],
};

const NAME_COMPONENT_PATTERNS: Record<PackagingComponent, RegExp[]> = {
  bottle: [/\bbottles?\b/i, /\bglass\b/i, /\bceramic\b/i, /ბოთლ/u, /კერამიკ/u],
  closure: [/\bclosures?\b/i, /\bcorks?\b/i, /\bstoppers?\b/i, /საცობ/u],
  capsule: [/\bcapsules?\b/i, /\bfoils?\b/i, /კაფსულ/u, /ჩაჩ/u],
  label: [/\blabels?\b/i, /ეტიკეტ/u],
  box: [/\bbox(?:es)?\b/i, /\bcases?\b/i, /\bcartons?\b/i, /ყუთ/u, /კოლოფ/u],
};

const GENERIC_PACKAGING_CATEGORIES = new Set([
  'packaging',
  'package',
  'bottling',
  'შესაფუთი',
  'შეფუთვა',
]);

function normalize(value: string | undefined): string {
  return (value || '').trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

export function packagingComponentForCategory(category: string | undefined): PackagingComponent | null {
  const normalized = normalize(category);
  for (const [component, aliases] of Object.entries(CATEGORY_COMPONENT_ALIASES) as Array<[PackagingComponent, string[]]>) {
    if (aliases.includes(normalized)) return component;
  }
  return null;
}

export function packagingComponentForItem(
  item: Pick<InventoryItem, 'category' | 'name'>,
): PackagingComponent | null {
  const categoryComponent = packagingComponentForCategory(item.category);
  if (categoryComponent) return categoryComponent;

  if (!GENERIC_PACKAGING_CATEGORIES.has(normalize(item.category))) return null;
  for (const component of Object.keys(NAME_COMPONENT_PATTERNS) as PackagingComponent[]) {
    if (NAME_COMPONENT_PATTERNS[component].some(pattern => pattern.test(item.name || ''))) {
      return component;
    }
  }
  return null;
}

export function isInventoryItemForPackagingComponent(
  item: Pick<InventoryItem, 'category' | 'name'>,
  component: PackagingComponent,
): boolean {
  return packagingComponentForItem(item) === component;
}

export function inventoryItemsForPackagingComponent<T extends Pick<InventoryItem, 'category' | 'name'>>(
  inventory: T[],
  component: PackagingComponent,
): T[] {
  return inventory.filter(item => isInventoryItemForPackagingComponent(item, component));
}
