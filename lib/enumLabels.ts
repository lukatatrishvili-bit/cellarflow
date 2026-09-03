// Localized display labels for enum-like data values (stored in English in
// state/DB; must never be shown raw in Georgian mode). Unknown values fall
// back to the raw string so new enum members degrade gracefully.
import { translations, type Language } from './i18n';
import type { WineClass, WinemakingStage } from './wineryState';

const STAGE_LABELS: Record<WinemakingStage, { en: string; ka: string }> = {
  crushing: { en: 'Crushing', ka: 'დაწურვა' },
  fermenting: { en: 'Fermenting', ka: 'დუღილი' },
  maceration: { en: 'Maceration', ka: 'მაცერაცია' },
  pressing: { en: 'Pressing', ka: 'დაწნეხა' },
  aging: { en: 'Aging', ka: 'დავარგება' },
  stabilization: { en: 'Stabilization', ka: 'სტაბილიზაცია' },
  filtration: { en: 'Filtration', ka: 'ფილტრაცია' },
  bottled: { en: 'Bottled', ka: 'ჩამოსხმული' },
  sold: { en: 'Sold', ka: 'გაყიდული' },
};

const WINE_CLASS_LABELS: Record<WineClass, { en: string; ka: string }> = {
  white: { en: 'White', ka: 'თეთრი' },
  red: { en: 'Red', ka: 'წითელი' },
  rose: { en: 'Rosé', ka: 'ვარდისფერი' },
  amber: { en: 'Amber', ka: 'ქარვისფერი' },
  qvevri: { en: 'Qvevri', ka: 'ქვევრის' },
  sparkling: { en: 'Sparkling', ka: 'ცქრიალა' },
  fortified: { en: 'Fortified', ka: 'შემაგრებული' },
  base_wine: { en: 'Base wine', ka: 'საბაზო ღვინო' },
};

const TASK_PRIORITY_LABELS: Record<'high' | 'medium' | 'low', { en: string; ka: string }> = {
  high: { en: 'High', ka: 'მაღალი' },
  medium: { en: 'Medium', ka: 'საშუალო' },
  low: { en: 'Low', ka: 'დაბალი' },
};

const TASK_STATUS_LABELS: Record<'pending' | 'completed', { en: string; ka: string }> = {
  pending: { en: 'Pending', ka: 'შესასრულებელი' },
  completed: { en: 'Completed', ka: 'შესრულებული' },
};

const RESERVATION_STATUS_LABELS: Record<'reserved' | 'fulfilled' | 'cancelled', { en: string; ka: string }> = {
  reserved: { en: 'Reserved', ka: 'დაჯავშნილი' },
  fulfilled: { en: 'Fulfilled', ka: 'შესრულებული' },
  cancelled: { en: 'Cancelled', ka: 'გაუქმებული' },
};

const ALERT_SEVERITY_LABELS: Record<'critical' | 'warning' | 'info', { en: string; ka: string }> = {
  critical: { en: 'Critical', ka: 'კრიტიკული' },
  warning: { en: 'Warning', ka: 'გაფრთხილება' },
  info: { en: 'Info', ka: 'ინფორმაცია' },
};

function pick(labels: { en: string; ka: string } | undefined, raw: string, lang: Language): string {
  if (!labels) return raw;
  return lang === 'ka' ? labels.ka : labels.en;
}

export function stageLabel(stage: string, lang: Language): string {
  return pick(STAGE_LABELS[stage as WinemakingStage], stage, lang);
}

export function wineClassLabel(wineClass: string, lang: Language): string {
  return pick(WINE_CLASS_LABELS[wineClass as WineClass], wineClass, lang);
}

export function taskPriorityLabel(priority: string, lang: Language): string {
  return pick(TASK_PRIORITY_LABELS[priority as 'high' | 'medium' | 'low'], priority, lang);
}

export function taskStatusLabel(status: string, lang: Language): string {
  return pick(TASK_STATUS_LABELS[status as 'pending' | 'completed'], status, lang);
}

export function reservationStatusLabel(status: string, lang: Language): string {
  return pick(RESERVATION_STATUS_LABELS[status as 'reserved' | 'fulfilled' | 'cancelled'], status, lang);
}

export function alertSeverityLabel(severity: string, lang: Language): string {
  return pick(ALERT_SEVERITY_LABELS[severity as 'critical' | 'warning' | 'info'], severity, lang);
}

// Vessel types are already in the main dictionary (stainless_steel, qvevri, …);
// resolve through it so all five languages keep working.
export function vesselTypeLabel(type: string, lang: Language): string {
  const dict = translations[lang] as Record<string, string> | undefined;
  const en = translations.en as Record<string, string>;
  return dict?.[type] || en[type] || type.replace(/_/g, ' ');
}

// Georgian names for the seeded inventory categories. Categories are
// user-extendable, so unknown keys fall back to the raw (user-entered) name.
const INVENTORY_CATEGORY_KA: Record<string, string> = {
  yeasts: 'საფუარები', nutritions: 'ნუტრიენტები', additives: 'დანამატები',
  packaging: 'შესაფუთი', bottles: 'ბოთლები', closures: 'საცობები',
  capsules: 'კაფსულები', labels: 'ეტიკეტები', boxes: 'ყუთები', sanitation: 'სანიტარია',
  cleaning: 'წმენდა', unassigned: 'მიუკუთვნებელი',
};

export function inventoryCategoryLabel(category: string, lang: Language): string {
  if (lang === 'ka' && INVENTORY_CATEGORY_KA[category]) return INVENTORY_CATEGORY_KA[category];
  return category.replace(/_/g, ' ');
}
