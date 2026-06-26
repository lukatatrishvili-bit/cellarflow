/**
 * Client persistence for storage locations + movements (localStorage, matching
 * the costing/bottling pattern — no server schema change).
 */

import type { StorageLocation, StockMovement } from './types';

const LOC_KEY = 'cf_storage_locations';
const MOV_KEY = 'cf_storage_movements';

function load<T>(key: string): T[] {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : []; } catch { return []; }
}
function save<T>(key: string, v: T[]) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

export const loadLocations = () => load<StorageLocation>(LOC_KEY);
export const loadMovements = () => load<StockMovement>(MOV_KEY);

export function addLocation(loc: Omit<StorageLocation, 'id'>): StorageLocation[] {
  const next = [...loadLocations(), { ...loc, id: `loc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }];
  save(LOC_KEY, next);
  return next;
}
export function deleteLocation(id: string): StorageLocation[] {
  const next = loadLocations().filter(l => l.id !== id);
  save(LOC_KEY, next);
  return next;
}

export function addMovement(m: Omit<StockMovement, 'id'>): StockMovement[] {
  const next = [{ ...m, id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }, ...loadMovements()];
  save(MOV_KEY, next);
  return next;
}
export function deleteMovement(id: string): StockMovement[] {
  const next = loadMovements().filter(m => m.id !== id);
  save(MOV_KEY, next);
  return next;
}
