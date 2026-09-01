import { describe, expect, it } from 'vitest';
import type { Vessel, WineLot } from '../lib/wineryState';
import {
  buildWineryPlanProductionItem,
  productionPlanKindForCellarOperation,
  suggestedWineryPlanQuantity,
  wineryPlanDraftIssue,
} from '../lib/wineryPlan';

const lot: WineLot = {
  id: 'LOT-1', name: 'Saperavi', vintage: 2026, variety: 'Saperavi', vineyardBlock: 'A',
  region: 'Kakheti', initialVolume: 900, currentVolume: 900, wineClass: 'red', stage: 'aging',
  createdAt: '2026-08-01', history: [],
};

const vessel = (id: string, patch: Partial<Vessel> = {}): Vessel => ({
  id, type: 'stainless_steel', shape: 'vertical', capacity: 1_000, currentVolume: 900,
  assignedLotId: lot.id, cleaningStatus: 'clean', lastCleaned: '2026-08-01', temperature: 16,
  coolingJacketActive: false, targetTemperature: null, lastOperation: 'Filled', ...patch,
});

describe('winery plan operation assignment', () => {
  it('keeps a specific wine operation executable while grouping it for the production calendar', () => {
    expect(productionPlanKindForCellarOperation('pumpover')).toBe('fermentation');
    expect(productionPlanKindForCellarOperation('sulfitation')).toBe('other');

    const item = buildWineryPlanProductionItem({
      operationType: 'sulfitation', vesselId: 'T-1', lotId: 'LOT-1', startDate: '2026-09-01',
      endDate: '2026-09-01', assignedTo: 'ana', notes: 'Confirm free SO2 first.',
    }, 'ana', '2026-08-31T10:00:00.000Z');

    expect(item).toMatchObject({
      kind: 'other', operationType: 'sulfitation', lotId: 'LOT-1', vesselIds: ['T-1'],
      assignedTo: 'ana', status: 'planned',
    });
  });

  it('calculates a transfer volume from source stock and destination headroom', () => {
    const source = vessel('T-1');
    const destination = vessel('T-2', { currentVolume: 300, assignedLotId: null });
    expect(suggestedWineryPlanQuantity(source, destination)).toBe(700);
  });

  it('blocks wine moves into a vessel that is not clean', () => {
    const source = vessel('T-1');
    const destination = vessel('T-2', { currentVolume: 0, assignedLotId: null, cleaningStatus: 'dirty' });
    const issue = wineryPlanDraftIssue({
      operationType: 'racking', vesselId: source.id, destinationVesselId: destination.id,
      lotId: lot.id, quantityLiters: 500, startDate: '2026-09-01', endDate: '2026-09-01',
      assignedTo: 'ana',
    }, [source, destination], [lot], []);

    expect(issue?.code).toBe('dirty_destination');
  });
});
