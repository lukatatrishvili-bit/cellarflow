/**
 * Client persistence for the cost ledger. Mirrors the transfers/bottling
 * pattern (localStorage, user-device scoped) so it needs no server schema
 * change. The ledger is append-mostly; entries can be deleted to correct
 * mistakes but are otherwise treated as immutable records.
 */

import type { CostEntry } from './types';

const KEY = 'cf_cost_entries';

export function loadCostEntries(): CostEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCostEntries(entries: CostEntry[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* ignore */ }
}

export function addCostEntry(entry: Omit<CostEntry, 'id'>): CostEntry[] {
  const full: CostEntry = { ...entry, id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  const next = [full, ...loadCostEntries()];
  saveCostEntries(next);
  return next;
}

export function deleteCostEntry(id: string): CostEntry[] {
  const next = loadCostEntries().filter(e => e.id !== id);
  saveCostEntries(next);
  return next;
}
