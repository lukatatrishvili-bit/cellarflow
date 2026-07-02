/**
 * Setup Journey — data-driven onboarding progress for a new winery.
 *
 * Rather than a one-off wizard, progress is *computed from the real records*:
 * a step is done because the winery actually has a vessel / an intake / a lab
 * result, so the journey stays truthful after imports, sync, or team edits.
 * Pure and framework-free so it is unit-testable.
 */

import type {
  CompanyProfile, VineyardBlock, Vessel, WineLot, GrapeIntakeRecord,
  CellarOperation, DailyFermLog, LabAnalysis,
} from './wineryState';

export type SetupStepId =
  | 'profile'   // name + region identify the estate on documents
  | 'block'     // first vineyard block (Vazi)
  | 'vessel'    // first tank / qvevri / barrel
  | 'intake'    // first fruit received → first batch
  | 'operation' // first cellar action logged
  | 'lab';      // first lab analysis recorded

export interface SetupStep {
  id: SetupStepId;
  /** Deep-link target. */
  module: 'settings' | 'vazi' | 'gvino';
  tab?: string;
  en: string;
  ka: string;
  /** One-line motivation shown under the active step. */
  enHint: string;
  kaHint: string;
  done: boolean;
}

export interface SetupJourneyState {
  steps: SetupStep[];
  done: number;
  total: number;
  pct: number;          // 0..100, rounded
  complete: boolean;
  /** First incomplete step — the suggested next action. */
  nextStep: SetupStep | null;
}

export interface SetupJourneyInput {
  companyProfile: Pick<CompanyProfile, 'companyName' | 'wineryName' | 'region'>;
  blocks: Pick<VineyardBlock, 'id'>[];
  vessels: Pick<Vessel, 'id'>[];
  lots: Pick<WineLot, 'id'>[];
  grapeIntakes: Pick<GrapeIntakeRecord, 'id'>[];
  cellarOps: Pick<CellarOperation, 'id'>[];
  fermLogs: Pick<DailyFermLog, 'id'>[];
  labLogs: Pick<LabAnalysis, 'id'>[];
}

const hasText = (s: string | undefined | null): boolean => !!s && s.trim().length > 0;

export function computeSetupJourney(input: SetupJourneyInput): SetupJourneyState {
  const profileDone =
    hasText(input.companyProfile.wineryName) || hasText(input.companyProfile.companyName)
      ? hasText(input.companyProfile.region)
      : false;

  const steps: SetupStep[] = [
    {
      id: 'profile', module: 'settings',
      en: 'Name your winery', ka: 'დაასახელეთ თქვენი მარანი',
      enHint: 'The estate name and region appear on every official document.',
      kaHint: 'მარნის სახელი და რეგიონი აისახება ყველა ოფიციალურ დოკუმენტში.',
      done: profileDone,
    },
    {
      id: 'block', module: 'vazi',
      en: 'Add a vineyard block', ka: 'დაამატეთ ვენახის ნაკვეთი',
      enHint: 'Blocks anchor traceability from soil to bottle.',
      kaHint: 'ნაკვეთი მიკვლევადობის საწყისი წერტილია — ნიადაგიდან ბოთლამდე.',
      done: input.blocks.length > 0,
    },
    {
      id: 'vessel', module: 'gvino', tab: 'vessels',
      en: 'Register tanks & qvevri', ka: 'დაარეგისტრირეთ ჭურჭელი და ქვევრი',
      enHint: 'Vessels hold your batches and track capacity.',
      kaHint: 'ჭურჭელი ინახავს პარტიებს და აღრიცხავს ტევადობას.',
      done: input.vessels.length > 0,
    },
    {
      id: 'intake', module: 'gvino', tab: 'intake',
      en: 'Receive your first grapes', ka: 'მიიღეთ პირველი ყურძენი',
      enHint: 'An intake creates the wine batch automatically.',
      kaHint: 'მიღება ავტომატურად ქმნის ღვინის პარტიას.',
      done: input.grapeIntakes.length > 0 || input.lots.length > 0,
    },
    {
      id: 'operation', module: 'gvino', tab: 'operations',
      en: 'Log a cellar operation', ka: 'აღრიცხეთ პირველი ოპერაცია',
      enHint: 'Pressing, punch-downs, SO₂ — under 30 seconds each.',
      kaHint: 'დაწურვა, ჩაწნეხა, სულფიტაცია — თითო 30 წამში.',
      done: input.cellarOps.length > 0 || input.fermLogs.length > 0,
    },
    {
      id: 'lab', module: 'gvino', tab: 'labs',
      en: 'Record a lab analysis', ka: 'ჩაწერეთ ლაბორატორიული ანალიზი',
      enHint: 'pH, SO₂ and VA history powers alerts and documents.',
      kaHint: 'pH, SO₂ და VA ისტორია კვებავს გაფრთხილებებს და დოკუმენტებს.',
      done: input.labLogs.length > 0,
    },
  ];

  const done = steps.filter(s => s.done).length;
  const total = steps.length;
  return {
    steps,
    done,
    total,
    pct: Math.round((done / total) * 100),
    complete: done === total,
    nextStep: steps.find(s => !s.done) || null,
  };
}

const DISMISS_KEY = 'cf_setup_journey_dismissed';

export function isSetupJourneyDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
}

export function setSetupJourneyDismissed(dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(DISMISS_KEY, 'true');
    else localStorage.removeItem(DISMISS_KEY);
  } catch { /* ignore */ }
}
