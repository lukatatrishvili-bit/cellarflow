/**
 * Running-balance logic for movement journals (Annexes 4, 8, 12, 13, 14, 15).
 *
 * Rule: closing = opening + incoming − outgoing, carried row to row.
 * Transfers decrease the source and increase the destination; the ledger keeps
 * origin/destination explicit so the official "საიდან, სად" column is honest.
 */

import type { DocRow } from './types';

export interface BalanceColumns {
  incoming: string;
  outgoing: string;
  balance: string;
}

/**
 * Fill the `balance` column of each row in place with the running balance and
 * return the closing balance. Rows are assumed already sorted chronologically.
 */
export function applyRunningBalance(
  rows: DocRow[],
  cols: BalanceColumns,
  opening = 0,
): number {
  let running = opening;
  for (const row of rows) {
    const inc = toNum(row[cols.incoming]);
    const out = toNum(row[cols.outgoing]);
    running = round2(running + inc - out);
    row[cols.balance] = running;
  }
  return running;
}

/** Detect rows where an outgoing amount exceeds the balance available before it. */
export function findNegativeBalances(
  rows: DocRow[],
  cols: BalanceColumns,
  opening = 0,
): number[] {
  const bad: number[] = [];
  let running = opening;
  rows.forEach((row, i) => {
    running = round2(running + toNum(row[cols.incoming]) - toNum(row[cols.outgoing]));
    if (running < -0.0001) bad.push(i);
  });
  return bad;
}

export function toNum(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  return 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Litres → decalitres (დალ), the legal unit for wine volumes. */
export function litresToDal(litres: number): number {
  return round2(litres / 10);
}
