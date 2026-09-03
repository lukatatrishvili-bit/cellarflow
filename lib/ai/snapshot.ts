import type { Language } from '../i18n';
import type { VaziWeatherRiskInput } from '../vaziRisk';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  CompanyProfile,
  DailyFermLog,
  GrapeIntakeRecord,
  GrapeSamplingRecord,
  HarvestRecord,
  InventoryItem,
  LabAnalysis,
  SalesOrderRecord,
  ScoutingRecord,
  SprayRecord,
  Task,
  Vessel,
  VineyardBlock,
  WineLot,
} from '../wineryState';
import { resolveAiConfig } from './config';
import type { AiWineryConfig } from './types';

/**
 * The single read-model the intelligence layer runs against. Rules, baselines,
 * the context builder and the query tools all take this and nothing else, so
 * the same code runs identically in the browser (live state) and on the server
 * (org data) with no data-access layer in between.
 */
/**
 * Data areas a role-filtered snapshot has had removed. An emptied collection is
 * otherwise indistinguishable from one that was never populated, and the
 * context builder would report withheld records as "never recorded".
 */
export type AiWithheldArea =
  | 'vessels'
  | 'lots'
  | 'fermentation'
  | 'laboratory'
  | 'inventory'
  | 'operations'
  | 'vineyard';

export interface WineryIntelligenceSnapshot {
  /** ISO yyyy-mm-dd. Injected so every evaluation is deterministic and testable. */
  today: string;
  /** ISO timestamp injected by callers; defaults to the start of `today`. */
  evaluatedAt: string;
  lang: Language;
  config: AiWineryConfig;
  vessels: Vessel[];
  lots: WineLot[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  inventory: InventoryItem[];
  tasks: Task[];
  cellarOps: CellarOperation[];
  transfers: CellarTransferRecord[];
  bottlingRuns: BottlingRunRecord[];
  grapeIntakes: GrapeIntakeRecord[];
  blocks: VineyardBlock[];
  scoutings: ScoutingRecord[];
  sprays: SprayRecord[];
  samplings: GrapeSamplingRecord[];
  harvests: HarvestRecord[];
  certifications: CertificationRecord[];
  salesOrders: SalesOrderRecord[];
  /** Latest fetched conditions per vineyard block, keyed by block id. */
  weatherByBlock: Record<string, VaziWeatherRiskInput>;
  companyProfile?: CompanyProfile;
  /** Set when this snapshot was narrowed to one role's permissions. */
  withheld?: AiWithheldArea[];
}

export type WineryIntelligenceSnapshotInput =
  Partial<Omit<WineryIntelligenceSnapshot, 'config'>> & { config?: unknown };

function list<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/** Fills every collection so rules can iterate without null guards. */
export function normalizeSnapshot(input: WineryIntelligenceSnapshotInput): WineryIntelligenceSnapshot {
  const today = input.today || new Date().toISOString().slice(0, 10);
  return {
    today,
    evaluatedAt: input.evaluatedAt || `${today}T00:00:00.000Z`,
    lang: input.lang === 'ka' ? 'ka' : 'en',
    config: resolveAiConfig(input.config),
    vessels: list(input.vessels),
    lots: list(input.lots),
    fermLogs: list(input.fermLogs),
    labLogs: list(input.labLogs),
    inventory: list(input.inventory),
    tasks: list(input.tasks),
    cellarOps: list(input.cellarOps),
    transfers: list(input.transfers),
    bottlingRuns: list(input.bottlingRuns),
    grapeIntakes: list(input.grapeIntakes),
    blocks: list(input.blocks),
    scoutings: list(input.scoutings),
    sprays: list(input.sprays),
    samplings: list(input.samplings),
    harvests: list(input.harvests),
    certifications: list(input.certifications),
    salesOrders: list(input.salesOrders),
    weatherByBlock: (input.weatherByBlock && typeof input.weatherByBlock === 'object')
      ? input.weatherByBlock
      : {},
    companyProfile: input.companyProfile,
    ...(Array.isArray(input.withheld) && input.withheld.length > 0
      ? { withheld: input.withheld }
      : {}),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two ISO dates; negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / DAY_MS);
}

export function addDays(iso: string, count: number): string {
  const base = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(base)) return iso;
  return new Date(base + count * DAY_MS).toISOString().slice(0, 10);
}

/** Newest-first by ISO date string; ties keep input order. */
export function sortByDateDesc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function lotLabel(snapshot: WineryIntelligenceSnapshot, lotId: string): string {
  const lot = snapshot.lots.find((l) => l.id === lotId);
  return lot ? `${lot.name} (${lot.id})` : lotId;
}

export function blockLabel(snapshot: WineryIntelligenceSnapshot, blockId: string): string {
  return snapshot.blocks.find((b) => b.id === blockId)?.name || blockId;
}

/** Reversal rows are compensating ledger facts, never physical events. */
export function isLiveRecord(record: { recordKind?: string; reversedByCommandId?: string }): boolean {
  return record.recordKind !== 'reversal' && !record.reversedByCommandId;
}
