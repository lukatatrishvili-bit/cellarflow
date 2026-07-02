/**
 * Rtveli (harvest season) engine — pure, framework-free math over intakes,
 * payments and vessels. Everything is derived from the records so the command
 * center stays truthful after corrections, sync, or a teammate's edits.
 *
 * A "season" is the calendar year of the intake date: Georgian rtveli runs
 * August–October, so a year uniquely identifies a harvest campaign.
 */

import type { GrapeIntakeRecord, SupplierPayment, Vessel } from '../wineryState';

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Fruit cost of one intake: explicit total wins, else price × net weight. */
export function intakeFruitCost(intake: Pick<GrapeIntakeRecord, 'netWeightKg' | 'costPerKg' | 'totalCost'>): number {
  if (typeof intake.totalCost === 'number' && Number.isFinite(intake.totalCost) && intake.totalCost > 0) {
    return round2(intake.totalCost);
  }
  const perKg = typeof intake.costPerKg === 'number' && Number.isFinite(intake.costPerKg) && intake.costPerKg > 0
    ? intake.costPerKg : 0;
  const net = intake.netWeightKg > 0 ? intake.netWeightKg : 0;
  return round2(perKg * net);
}

export function seasonOf(date: string | undefined): number {
  const y = parseInt(String(date || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

/** Distinct seasons present in the intake log, newest first. */
export function seasonYears(intakes: Array<Pick<GrapeIntakeRecord, 'date'>>): number[] {
  const years = new Set<number>();
  for (const i of intakes) {
    const y = seasonOf(i.date);
    if (y > 0) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

export interface SupplierLedgerRow {
  supplierName: string;
  deliveries: number;
  totalKg: number;
  varieties: string[];        // distinct, delivery order
  totalOwed: number;          // Σ fruit cost of intakes with a price
  unpricedKg: number;         // kg delivered without any price captured
  totalPaid: number;
  balance: number;            // owed − paid (can be negative = advance)
  lastDeliveryDate: string;
}

/**
 * Per-supplier settlement ledger for one season. Only third-party fruit
 * (source === 'supplier') participates; own-vineyard intakes carry no payable.
 */
export function computeSupplierLedger(
  intakes: GrapeIntakeRecord[],
  payments: SupplierPayment[],
  season: number,
): SupplierLedgerRow[] {
  const rows = new Map<string, SupplierLedgerRow>();

  for (const i of intakes) {
    if (i.source !== 'supplier' || seasonOf(i.date) !== season) continue;
    const name = (i.supplierName || '').trim();
    if (!name) continue;
    const row = rows.get(name) || {
      supplierName: name, deliveries: 0, totalKg: 0, varieties: [], totalOwed: 0,
      unpricedKg: 0, totalPaid: 0, balance: 0, lastDeliveryDate: '',
    };
    row.deliveries += 1;
    row.totalKg = round1(row.totalKg + (i.netWeightKg || 0));
    if (i.variety && !row.varieties.includes(i.variety)) row.varieties.push(i.variety);
    const cost = intakeFruitCost(i);
    if (cost > 0) row.totalOwed = round2(row.totalOwed + cost);
    else row.unpricedKg = round1(row.unpricedKg + (i.netWeightKg || 0));
    if ((i.date || '') > row.lastDeliveryDate) row.lastDeliveryDate = i.date || '';
    rows.set(name, row);
  }

  for (const p of payments) {
    if (seasonOf(p.date) !== season) continue;
    const name = (p.supplierName || '').trim();
    const row = rows.get(name);
    // Payments to suppliers with no deliveries this season still show up, so a
    // mistyped supplier name is visible instead of silently vanishing.
    if (row) {
      row.totalPaid = round2(row.totalPaid + (p.amount || 0));
    } else if (name) {
      rows.set(name, {
        supplierName: name, deliveries: 0, totalKg: 0, varieties: [], totalOwed: 0,
        unpricedKg: 0, totalPaid: round2(p.amount || 0), balance: 0, lastDeliveryDate: '',
      });
    }
  }

  const out = [...rows.values()];
  for (const r of out) r.balance = round2(r.totalOwed - r.totalPaid);
  // Largest outstanding balance first — that's who is waiting for money.
  return out.sort((a, b) => b.balance - a.balance || b.totalKg - a.totalKg);
}

export interface SeasonVarietyStat {
  variety: string;
  kg: number;
  weightedBrix: number | null; // kg-weighted mean of measured deliveries
}

export interface SeasonStats {
  season: number;
  totalKg: number;
  supplierKg: number;
  ownKg: number;
  deliveries: number;
  todayKg: number;
  todayDeliveries: number;
  weightedAvgBrix: number | null;
  byVariety: SeasonVarietyStat[];
  firstDate: string | null;
  lastDate: string | null;
}

export function computeSeasonStats(
  intakes: GrapeIntakeRecord[],
  season: number,
  today: string = new Date().toISOString().slice(0, 10),
): SeasonStats {
  const inSeason = intakes.filter(i => seasonOf(i.date) === season);
  const byVariety = new Map<string, { kg: number; brixKg: number; measuredKg: number }>();
  let totalKg = 0, supplierKg = 0, ownKg = 0, todayKg = 0, todayDeliveries = 0;
  let brixKgAll = 0, measuredKgAll = 0;
  let firstDate: string | null = null, lastDate: string | null = null;

  for (const i of inSeason) {
    const kg = i.netWeightKg || 0;
    totalKg += kg;
    if (i.source === 'supplier') supplierKg += kg; else ownKg += kg;
    if ((i.date || '').slice(0, 10) === today) { todayKg += kg; todayDeliveries += 1; }
    if (!firstDate || (i.date || '') < firstDate) firstDate = i.date || null;
    if (!lastDate || (i.date || '') > lastDate) lastDate = i.date || null;

    const v = byVariety.get(i.variety || '—') || { kg: 0, brixKg: 0, measuredKg: 0 };
    v.kg += kg;
    if (i.brix > 0 && kg > 0) { v.brixKg += i.brix * kg; v.measuredKg += kg; brixKgAll += i.brix * kg; measuredKgAll += kg; }
    byVariety.set(i.variety || '—', v);
  }

  return {
    season,
    totalKg: round1(totalKg),
    supplierKg: round1(supplierKg),
    ownKg: round1(ownKg),
    deliveries: inSeason.length,
    todayKg: round1(todayKg),
    todayDeliveries,
    weightedAvgBrix: measuredKgAll > 0 ? round1(brixKgAll / measuredKgAll) : null,
    byVariety: [...byVariety.entries()]
      .map(([variety, v]): SeasonVarietyStat => ({
        variety, kg: round1(v.kg),
        weightedBrix: v.measuredKg > 0 ? round1(v.brixKg / v.measuredKg) : null,
      }))
      .sort((a, b) => b.kg - a.kg),
    firstDate,
    lastDate,
  };
}

export interface CapacityPlan {
  totalCapacityL: number;
  usedL: number;
  freeL: number;
  /** Vessels with usable free space, roomiest first. */
  freeVessels: Array<{ id: string; type: Vessel['type']; capacity: number; freeL: number; empty: boolean }>;
}

/** "Which vessels have room tonight" — free space across the cellar. */
export function computeCapacityPlan(vessels: Vessel[]): CapacityPlan {
  let totalCapacityL = 0, usedL = 0;
  const freeVessels: CapacityPlan['freeVessels'] = [];
  for (const v of vessels) {
    const cap = v.capacity > 0 ? v.capacity : 0;
    const used = Math.max(0, Math.min(cap, v.currentVolume || 0));
    totalCapacityL += cap;
    usedL += used;
    const freeL = round1(cap - used);
    if (freeL > 0) freeVessels.push({ id: v.id, type: v.type, capacity: cap, freeL, empty: used === 0 });
  }
  freeVessels.sort((a, b) => b.freeL - a.freeL);
  return { totalCapacityL: round1(totalCapacityL), usedL: round1(usedL), freeL: round1(totalCapacityL - usedL), freeVessels };
}
