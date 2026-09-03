import { isPhysicalFermentationReading } from './fermentationIntegrity';
import type { ProductionPlanItem, ProductionPlanKind } from './operationsControl';
import type { DailyFermLog, LabAnalysis, Task, Vessel, WineLot } from './wineryState';

export type ProductionPlanSuggestionReason =
  | 'fermentation_reading_due'
  | 'lab_panel_due'
  | 'sanitation_required';

export interface ProductionPlanSuggestion {
  id: string;
  reason: ProductionPlanSuggestionReason;
  priority: 'high' | 'normal';
  kind: ProductionPlanKind;
  lotId?: string;
  vesselIds: string[];
  startDate: string;
  endDate: string;
  title: { en: string; ka: string };
  rationale: { en: string; ka: string };
  notes: { en: string; ka: string };
}

export interface ProductionPlanForecast {
  openCount: number;
  readinessPercent: number;
  plannedFlowLiters: number;
  cleanEmptyCapacityLiters: number;
  peakDate: string | null;
  peakCount: number;
}

interface SuggestionInput {
  today: string;
  lots: WineLot[];
  vessels: Vessel[];
  fermentationLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  productionPlans: ProductionPlanItem[];
}

const isOpen = (item: ProductionPlanItem): boolean => !['completed', 'cancelled'].includes(item.status);

export interface ProductionPlanTaskDraft {
  title: string;
  priority: Task['priority'];
  dueDate: string;
  description: string;
  assignedTo: string;
  source: NonNullable<Task['source']>;
}

export { linkedTaskForProductionPlan } from './planFulfilment';

export function taskDraftForProductionPlan(
  item: ProductionPlanItem,
  language: 'en' | 'ka',
  options: {
    priority?: Task['priority'] | 'automatic';
    dueDate?: 'start' | 'end';
    assignedTo?: string;
    today?: string;
  } = {},
): ProductionPlanTaskDraft {
  const currentDate = options.today || new Date().toISOString().slice(0, 10);
  const automaticPriority: Task['priority'] = item.status === 'blocked' || item.endDate < currentDate
    ? 'high'
    : item.startDate <= currentDate
      ? 'high'
      : item.startDate <= plusDays(currentDate, 7) ? 'medium' : 'low';
  const dueDate = options.dueDate === 'end' ? item.endDate : item.startDate;
  const links = [
    item.lotId ? `${language === 'ka' ? 'პარტია' : 'Lot'}: ${item.lotId}` : '',
    item.vesselIds.length ? `${language === 'ka' ? 'ჭურჭელი' : 'Vessels'}: ${item.vesselIds.join(', ')}` : '',
    item.blockId ? `${language === 'ka' ? 'ბლოკი' : 'Block'}: ${item.blockId}` : '',
  ].filter(Boolean);
  return {
    title: item.title,
    priority: options.priority && options.priority !== 'automatic' ? options.priority : automaticPriority,
    dueDate,
    assignedTo: options.assignedTo || item.assignedTo,
    description: [
      language === 'ka'
        ? `საწარმოო გეგმა · ${item.startDate}${item.endDate !== item.startDate ? ` — ${item.endDate}` : ''}`
        : `Production plan · ${item.startDate}${item.endDate !== item.startDate ? ` — ${item.endDate}` : ''}`,
      ...links,
      item.notes,
    ].filter(Boolean).join('\n'),
    source: {
      type: 'production_plan',
      id: item.id,
      ...(item.lotId ? { lotId: item.lotId } : {}),
      ...(item.vesselIds.length ? { vesselIds: [...item.vesselIds] } : {}),
      ...(item.blockId ? { blockId: item.blockId } : {}),
    },
  };
}

function latestDate(dates: string[]): string | null {
  return dates.reduce<string | null>((latest, date) => (!latest || date > latest ? date : latest), null);
}

function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(earlier + 'T00:00:00.000Z');
  const end = Date.parse(later + 'T00:00:00.000Z');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / 86_400_000);
}

function plusDays(date: string, days: number): string {
  const value = new Date(date + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Produces deterministic, evidence-based planning prompts. It never changes
 * cellar records or creates work until an operator explicitly accepts one.
 */
export function buildProductionPlanSuggestions(input: SuggestionInput): ProductionPlanSuggestion[] {
  const suggestions: ProductionPlanSuggestion[] = [];
  const openPlans = input.productionPlans.filter(isOpen);
  const activeLots = input.lots.filter(lot => !lot.voidedAt && lot.currentVolume > 0);

  for (const lot of activeLots) {
    const vessel = input.vessels.find(candidate => candidate.assignedLotId === lot.id && candidate.currentVolume > 0);
    if (lot.stage === 'fermenting' && vessel) {
      const latestReading = latestDate(input.fermentationLogs
        .filter(log => log.lotId === lot.id && isPhysicalFermentationReading(log))
        .map(log => log.date));
      const alreadyPlanned = openPlans.some(item => item.kind === 'fermentation' && item.lotId === lot.id);
      if (!alreadyPlanned && latestReading !== input.today) {
        const overdueDays = latestReading ? Math.max(1, daysBetween(latestReading, input.today)) : null;
        suggestions.push({
          id: `fermentation-${lot.id}-${input.today}`,
          reason: 'fermentation_reading_due',
          priority: overdueDays === null || overdueDays > 1 ? 'high' : 'normal',
          kind: 'fermentation',
          lotId: lot.id,
          vesselIds: [vessel.id],
          startDate: input.today,
          endDate: input.today,
          title: {
            en: `Fermentation reading · ${lot.name}`,
            ka: `დუღილის მაჩვენებელი · ${lot.name}`,
          },
          rationale: {
            en: latestReading
              ? `No physical reading has been recorded for ${overdueDays} day${overdueDays === 1 ? '' : 's'}.`
              : 'This fermenting lot has no physical reading yet.',
            ka: latestReading
              ? `ფიზიკური მაჩვენებელი ${overdueDays} დღეა არ ჩაწერილა.`
              : 'ამ დუღილის პროცესს ფიზიკური მაჩვენებელი ჯერ არ აქვს.',
          },
          notes: {
            en: `Record density, sugar, temperature and pH for ${vessel.id}.`,
            ka: `${vessel.id}-ისთვის ჩაწერეთ სიმკვრივე, შაქარი, ტემპერატურა და pH.`,
          },
        });
      }
    }

    if (['aging', 'stabilization', 'filtration'].includes(lot.stage)) {
      const latestLab = latestDate(input.labLogs.filter(log => log.lotId === lot.id).map(log => log.date));
      const thresholdDays = lot.stage === 'aging' ? 30 : 14;
      const labAge = latestLab ? daysBetween(latestLab, input.today) : null;
      const alreadyPlanned = openPlans.some(item => item.kind === 'lab' && item.lotId === lot.id);
      if (!alreadyPlanned && (labAge === null || labAge >= thresholdDays)) {
        suggestions.push({
          id: `lab-${lot.id}-${input.today}`,
          reason: 'lab_panel_due',
          priority: latestLab ? 'normal' : 'high',
          kind: 'lab',
          lotId: lot.id,
          vesselIds: vessel ? [vessel.id] : [],
          startDate: input.today,
          endDate: plusDays(input.today, 1),
          title: {
            en: `Quality panel · ${lot.name}`,
            ka: `ხარისხის პანელი · ${lot.name}`,
          },
          rationale: {
            en: latestLab
              ? `The latest lab panel is ${labAge} days old for the ${lot.stage} stage.`
              : `No lab panel is recorded for this ${lot.stage} lot.`,
            ka: latestLab
              ? `ამ ეტაპისთვის ბოლო ლაბორატორიული პანელი ${labAge} დღისაა.`
              : 'ამ პარტიისთვის ლაბორატორიული პანელი არ არის ჩაწერილი.',
          },
          notes: {
            en: 'Confirm the current chemistry before the next production decision.',
            ka: 'შემდეგ საწარმოო გადაწყვეტილებამდე დაადასტურეთ მიმდინარე ქიმიური მდგომარეობა.',
          },
        });
      }
    }
  }

  for (const vessel of input.vessels) {
    if (vessel.currentVolume > 0 || vessel.cleaningStatus === 'clean') continue;
    const alreadyPlanned = openPlans.some(item => item.kind === 'sanitation' && item.vesselIds.includes(vessel.id));
    if (alreadyPlanned) continue;
    suggestions.push({
      id: `sanitation-${vessel.id}-${input.today}`,
      reason: 'sanitation_required',
      priority: vessel.cleaningStatus === 'cleaning_needed' ? 'high' : 'normal',
      kind: 'sanitation',
      vesselIds: [vessel.id],
      startDate: input.today,
      endDate: input.today,
      title: {
        en: `Sanitize vessel · ${vessel.id}`,
        ka: `ჭურჭლის სანიტარია · ${vessel.id}`,
      },
      rationale: {
        en: 'The empty vessel is not marked clean and cannot be treated as ready capacity.',
        ka: 'ცარიელი ჭურჭელი სუფთად არ არის მონიშნული და მზად ტევადობად ვერ ჩაითვლება.',
      },
      notes: {
        en: 'Complete and record sanitation before the vessel is reserved for wine.',
        ka: 'ღვინისთვის დაჯავშნამდე დაასრულეთ და ჩაწერეთ სანიტარია.',
      },
    });
  }

  return suggestions.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority === 'high' ? -1 : 1;
    const operationalOrder: Record<ProductionPlanSuggestionReason, number> = {
      fermentation_reading_due: 0,
      sanitation_required: 1,
      lab_panel_due: 2,
    };
    if (left.reason !== right.reason) return operationalOrder[left.reason] - operationalOrder[right.reason];
    return left.id.localeCompare(right.id);
  });
}

export function forecastProductionPlan(input: {
  today: string;
  horizonDays?: number;
  productionPlans: ProductionPlanItem[];
  vessels: Vessel[];
  attentionItemIds: Iterable<string>;
}): ProductionPlanForecast {
  const horizonDays = Math.max(1, input.horizonDays || 14);
  const horizonEnd = plusDays(input.today, horizonDays - 1);
  const open = input.productionPlans.filter(isOpen);
  const attentionIds = new Set(input.attentionItemIds);
  const scheduled = open.filter(item => item.endDate >= input.today && item.startDate <= horizonEnd);
  let peakDate: string | null = null;
  let peakCount = 0;
  for (let index = 0; index < horizonDays; index += 1) {
    const date = plusDays(input.today, index);
    const count = scheduled.filter(item => item.startDate <= date && item.endDate >= date).length;
    if (count > peakCount) {
      peakDate = date;
      peakCount = count;
    }
  }
  return {
    openCount: open.length,
    readinessPercent: open.length
      ? Math.round((open.filter(item => !attentionIds.has(item.id)).length / open.length) * 100)
      : 100,
    plannedFlowLiters: scheduled.reduce((total, item) => total + Math.max(0, item.quantityLiters || 0), 0),
    cleanEmptyCapacityLiters: input.vessels
      .filter(vessel => vessel.currentVolume <= 0 && vessel.cleaningStatus === 'clean')
      .reduce((total, vessel) => total + Math.max(0, vessel.capacity), 0),
    peakDate,
    peakCount,
  };
}

/** Keeps an item's duration while moving it to the latest prerequisite finish. */
export function alignPlanAfterDependencies(
  item: ProductionPlanItem,
  productionPlans: ProductionPlanItem[],
): Pick<ProductionPlanItem, 'startDate' | 'endDate'> | null {
  const byId = new Map(productionPlans.map(candidate => [candidate.id, candidate]));
  const latestDependencyEnd = latestDate(item.dependencyIds
    .map(id => byId.get(id)?.endDate)
    .filter((date): date is string => Boolean(date)));
  if (!latestDependencyEnd || item.startDate >= latestDependencyEnd) return null;
  const durationDays = Math.max(0, daysBetween(item.startDate, item.endDate));
  return {
    startDate: latestDependencyEnd,
    endDate: plusDays(latestDependencyEnd, durationDays),
  };
}
