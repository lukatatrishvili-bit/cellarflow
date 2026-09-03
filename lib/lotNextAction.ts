import type { Language } from './i18n';
import type {
  BottlingRunRecord,
  DailyFermLog,
  LabAnalysis,
  Vessel,
  WineLot,
  WinemakingStage,
} from './wineryState';
import { stageLabel } from './enumLabels';
import { nextStageForWineClass } from './winemakingWorkflow';
import { isActiveBottlingRun } from './bottlingIntegrity';

export type LotNextActionStatus = 'ready' | 'needs_data' | 'blocked' | 'complete';

export type LotNextActionIntent =
  | 'transition'
  | 'open_fermentation'
  | 'open_lab'
  | 'open_vessels'
  | 'open_bottling'
  | 'open_lineage'
  | 'none';

export interface LotNextAction {
  status: LotNextActionStatus;
  intent: LotNextActionIntent;
  label: string;
  shortLabel: string;
  description: string;
  ctaLabel: string;
  targetStage?: WinemakingStage;
  destinationTab?: string;
}

export interface LotNextActionContext {
  vessels?: Vessel[];
  fermLogs?: DailyFermLog[];
  labLogs?: LabAnalysis[];
  bottlingRuns?: BottlingRunRecord[];
  /** ISO date or timestamp. Injectable so readiness remains deterministic in tests. */
  now?: string;
}

const activeVesselForLot = (lotId: string, vessels: Vessel[]): Vessel | undefined => (
  vessels.find(vessel => vessel.assignedLotId === lotId && vessel.currentVolume > 0)
);

const latestFermentationReading = (lotId: string, fermLogs: DailyFermLog[]): DailyFermLog | undefined => (
  fermLogs
    .filter(log => (
      log.lotId === lotId
      && log.recordKind !== 'reversal'
      && !log.reversedByCommandId
      && !log.reversedAt
    ))
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0]
);

const latestLabForLot = (lotId: string, labLogs: LabAnalysis[]): LabAnalysis | undefined => (
  labLogs
    .filter(log => log.lotId === lotId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))[0]
);

const transitionActionLabel = (target: WinemakingStage, lang: Language): string => {
  const labels: Record<WinemakingStage, { en: string; ka: string }> = {
    crushing: { en: 'Return to crushing', ka: 'დაწურვის ეტაპზე დაბრუნება' },
    fermenting: { en: 'Start fermentation', ka: 'დუღილის დაწყება' },
    maceration: { en: 'Start maceration', ka: 'მაცერაციის დაწყება' },
    pressing: { en: 'Move to pressing', ka: 'დაწნეხვაზე გადასვლა' },
    aging: { en: 'Start aging', ka: 'დაძველების დაწყება' },
    stabilization: { en: 'Start stabilization', ka: 'სტაბილიზაციის დაწყება' },
    filtration: { en: 'Start filtration', ka: 'ფილტრაციის დაწყება' },
    bottled: { en: 'Prepare bottling', ka: 'ჩამოსხმის მომზადება' },
    sold: { en: 'Complete the lot', ka: 'პარტიის დასრულება' },
  };
  return lang === 'ka' ? labels[target].ka : labels[target].en;
};

const transitionAction = (
  lot: WineLot,
  targetStage: WinemakingStage,
  lang: Language,
): LotNextAction => {
  const label = transitionActionLabel(targetStage, lang);
  return {
    status: 'ready',
    intent: 'transition',
    label,
    shortLabel: label,
    description: lang === 'ka'
      ? `${stageLabel(lot.stage, lang)} ეტაპის ჩანაწერები მზადაა. გადაამოწმეთ დეტალები და ჩაწერეთ გადასვლა ${stageLabel(targetStage, lang)} ეტაპზე.`
      : `${stageLabel(lot.stage, lang)} records are available. Review the details and log the move to ${stageLabel(targetStage, lang)}.`,
    ctaLabel: lang === 'ka' ? 'გადასვლის გადამოწმება' : 'Review transition',
    targetStage,
  };
};

export function lotNextActionStatusLabel(status: LotNextActionStatus, lang: Language): string {
  const labels: Record<LotNextActionStatus, { en: string; ka: string }> = {
    ready: { en: 'Ready', ka: 'მზადაა' },
    needs_data: { en: 'Needs data', ka: 'საჭიროა მონაცემი' },
    blocked: { en: 'Blocked', ka: 'დაბლოკილია' },
    complete: { en: 'Complete', ka: 'დასრულებულია' },
  };
  return lang === 'ka' ? labels[status].ka : labels[status].en;
}

/**
 * Returns one operationally useful action for a lot. The recommendation uses
 * recorded evidence instead of treating the next stage in the sequence as an
 * automatic instruction.
 */
export function nextActionForWineLot(
  lot: WineLot,
  context: LotNextActionContext = {},
  lang: Language = 'en',
): LotNextAction {
  const vessels = context.vessels || [];
  const fermLogs = context.fermLogs || [];
  const labLogs = context.labLogs || [];
  const bottlingRuns = context.bottlingRuns || [];
  const today = (context.now || new Date().toISOString()).slice(0, 10);
  const nextStage = nextStageForWineClass(lot.wineClass, lot.stage);

  if (lot.voidedAt) {
    return {
      status: 'blocked',
      intent: 'open_lineage',
      label: lang === 'ka' ? 'გაუქმებული პარტიის ისტორიის ნახვა' : 'Review voided lot history',
      shortLabel: lang === 'ka' ? 'ისტორიის ნახვა' : 'Review history',
      description: lang === 'ka'
        ? 'ეს პარტია შენარჩუნებულია მხოლოდ აუდიტის კვალისთვის და საწარმოო ეტაპზე ვერ გადავა.'
        : 'This lot is retained for audit history and cannot advance through production.',
      ctaLabel: lang === 'ka' ? 'გენეალოგიის გახსნა' : 'Open lineage',
      destinationTab: 'lineage',
    };
  }

  if (lot.stage === 'sold') {
    return {
      status: 'complete',
      intent: 'open_lineage',
      label: lang === 'ka' ? 'პარტიის გზა დასრულებულია' : 'Lot lifecycle complete',
      shortLabel: lang === 'ka' ? 'დასრულებულია' : 'Lifecycle complete',
      description: lang === 'ka'
        ? 'საწარმოო ეტაპები დასრულებულია. პარტიის სრული კვალი ხელმისაწვდომია გენეალოგიასა და პასპორტში.'
        : 'Production is complete. The full lot trail remains available in lineage and the lot passport.',
      ctaLabel: lang === 'ka' ? 'გენეალოგიის ნახვა' : 'View lineage',
      destinationTab: 'lineage',
    };
  }

  if (lot.stage === 'bottled') {
    const hasBottlingRecord = bottlingRuns.some(run => run.lotId === lot.id && isActiveBottlingRun(run));
    return {
      status: hasBottlingRecord ? 'ready' : 'needs_data',
      intent: 'open_lineage',
      label: hasBottlingRecord
        ? (lang === 'ka' ? 'მარაგისა და გაყიდვების კვალის ნახვა' : 'Trace stock and sales')
        : (lang === 'ka' ? 'ჩამოსხმის ჩანაწერის გადამოწმება' : 'Verify the bottling record'),
      shortLabel: hasBottlingRecord
        ? (lang === 'ka' ? 'მარაგის კვალი' : 'Trace stock')
        : (lang === 'ka' ? 'ჩამოსხმის შემოწმება' : 'Verify bottling'),
      description: hasBottlingRecord
        ? (lang === 'ka'
          ? 'ჩამოსხმის ჩანაწერი არსებობს. შემდეგ აკონტროლეთ მზა პროდუქციის მარაგი, შეკვეთები და გატანა.'
          : 'A bottling record exists. Continue with finished-goods stock, reservations, and dispatches.')
        : (lang === 'ka'
          ? 'პარტია მონიშნულია ჩამოსხმულად, მაგრამ აქტიური ჩამოსხმის ჩანაწერი ვერ მოიძებნა.'
          : 'The lot is marked bottled, but no active bottling run was found.'),
      ctaLabel: lang === 'ka' ? 'კვალის გახსნა' : 'Open trace',
      destinationTab: 'lineage',
    };
  }

  if (lot.currentVolume <= 0) {
    return {
      status: 'blocked',
      intent: 'open_lineage',
      label: lang === 'ka' ? 'პარტიის ბალანსის გადამოწმება' : 'Resolve the lot balance',
      shortLabel: lang === 'ka' ? 'ბალანსის შემოწმება' : 'Check balance',
      description: lang === 'ka'
        ? 'აქტიური საწარმოო ეტაპისთვის პარტიას დადებითი მოცულობა არ აქვს. გადაამოწმეთ გადატანები, ჩამოსხმა და უკუქცევები.'
        : 'This active production stage has no positive lot volume. Review transfers, bottling, and reversals.',
      ctaLabel: lang === 'ka' ? 'კვალის გახსნა' : 'Open trace',
      destinationTab: 'lineage',
    };
  }

  const vessel = activeVesselForLot(lot.id, vessels);
  if (lot.stage === 'crushing' || lot.stage === 'fermenting' || lot.stage === 'maceration') {
    if (!vessel) {
      return {
        status: 'blocked',
        intent: 'open_vessels',
        label: lang === 'ka' ? 'პარტიისთვის ჭურჭლის მიბმა' : 'Assign a vessel to this lot',
        shortLabel: lang === 'ka' ? 'ჭურჭლის მიბმა' : 'Assign vessel',
        description: lang === 'ka'
          ? 'შემდეგი საწარმოო მოქმედებისთვის პარტია უნდა იყოს მიბმული ცარიელზე მეტ მოცულობის ჭურჭელზე.'
          : 'The lot must be assigned to a non-empty vessel before the next production action.',
        ctaLabel: lang === 'ka' ? 'ჭურჭლების გახსნა' : 'Open vessels',
        destinationTab: 'vessels',
      };
    }
  }

  if (lot.stage === 'fermenting') {
    const latestReading = latestFermentationReading(lot.id, fermLogs);
    const hasReadingToday = latestReading?.date === today;
    return {
      status: hasReadingToday ? 'ready' : 'needs_data',
      intent: 'open_fermentation',
      label: hasReadingToday
        ? (lang === 'ka' ? 'დუღილის დასრულების მზადყოფნის გადამოწმება' : 'Review fermentation completion')
        : (lang === 'ka' ? 'დღევანდელი დუღილის მაჩვენებლის ჩაწერა' : "Log today's fermentation reading"),
      shortLabel: hasReadingToday
        ? (lang === 'ka' ? 'დუღილის გადამოწმება' : 'Review fermentation')
        : (lang === 'ka' ? 'დღის მაჩვენებელი' : 'Log today'),
      description: hasReadingToday
        ? (lang === 'ka'
          ? `დღევანდელი მაჩვენებელი ჩაწერილია ${vessel?.id || ''}-ში. შეამოწმეთ სამიზნე სიმკვრივე და დაასრულეთ დუღილი მხოლოდ მზადყოფნისას.`
          : `Today's reading is recorded in ${vessel?.id || 'the assigned vessel'}. Check the target density and complete fermentation only when ready.`)
        : (lang === 'ka'
          ? `დღევანდელი მაჩვენებელი ${vessel?.id || ''}-ისთვის ჯერ არ არის ჩაწერილი. სიმკვრივე, შაქარი, ტემპერატურა და pH განსაზღვრავს შემდეგ ნაბიჯს.`
          : `No reading is recorded today for ${vessel?.id || 'the assigned vessel'}. Density, sugar, temperature, and pH determine the next step.`),
      ctaLabel: lang === 'ka' ? 'დუღილის გახსნა' : 'Open fermentation',
      destinationTab: 'fermentation',
    };
  }

  if (lot.stage === 'aging' || lot.stage === 'stabilization') {
    const latestLab = latestLabForLot(lot.id, labLogs);
    if (!latestLab) {
      const stageName = stageLabel(lot.stage, lang).toLocaleLowerCase();
      const article = /^[aeiou]/i.test(stageName) ? 'an' : 'a';
      return {
        status: 'needs_data',
        intent: 'open_lab',
        label: lang === 'ka'
          ? `${stageName} ეტაპის ლაბორატორიული პანელის დამატება`
          : `Add ${article} ${stageName} lab panel`,
        shortLabel: lang === 'ka' ? 'ლაბორატორიული პანელი' : 'Add lab panel',
        description: lang === 'ka'
          ? 'შემდეგ ეტაპზე გადასვლამდე საჭიროა პარტიის ბოლო ქიმიური მდგომარეობის დადასტურება.'
          : 'Confirm the lot’s latest chemistry before moving it to the next stage.',
        ctaLabel: lang === 'ka' ? 'ლაბორატორიის გახსნა' : 'Open laboratory',
        destinationTab: 'labs',
      };
    }
  }

  if (lot.stage === 'filtration' || (lot.stage === 'stabilization' && nextStage === 'bottled')) {
    return {
      status: 'ready',
      intent: 'open_bottling',
      label: lang === 'ka' ? 'ჩამოსხმის პარტიის მომზადება' : 'Prepare the bottling run',
      shortLabel: lang === 'ka' ? 'ჩამოსხმის მომზადება' : 'Prepare bottling',
      description: lang === 'ka'
        ? 'ჩამოსხმა არის შემდეგი ავტორიტეტული ოპერაცია და ერთდროულად განაახლებს პარტიას, შეფუთვასა და მზა მარაგს.'
        : 'Bottling is the next authoritative operation and will update the lot, packaging, and finished stock together.',
      ctaLabel: lang === 'ka' ? 'ჩამოსხმის გახსნა' : 'Open bottling',
      destinationTab: 'bottling',
    };
  }

  return transitionAction(lot, nextStage, lang);
}
