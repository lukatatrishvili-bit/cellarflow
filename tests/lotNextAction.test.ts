import { describe, expect, it } from 'vitest';
import { nextActionForWineLot } from '../lib/lotNextAction';
import type { DailyFermLog, LabAnalysis, Vessel, WineLot } from '../lib/wineryState';

const lot = (overrides: Partial<WineLot> = {}): WineLot => ({
  id: 'LOT-1',
  name: 'Saperavi 2026',
  vintage: 2026,
  variety: 'Saperavi',
  vineyardBlock: 'Block 1',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 900,
  wineClass: 'red',
  stage: 'fermenting',
  createdAt: '2026-08-01',
  history: [],
  ...overrides,
});

const vessel: Vessel = {
  id: 'T-1',
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 1_000,
  currentVolume: 900,
  assignedLotId: 'LOT-1',
  cleaningStatus: 'clean',
  lastCleaned: '2026-08-01',
  temperature: 20,
  coolingJacketActive: false,
  targetTemperature: 20,
  lastOperation: 'Filled',
};

const fermLog = (date: string): DailyFermLog => ({
  id: `FERM-${date}`,
  tankId: 'T-1',
  lotId: 'LOT-1',
  date,
  temperature: 21,
  density: 1.01,
  sugar: 18,
  ph: 3.5,
  tastingNotes: '',
  capManagement: 'Punchdown',
  additives: '',
});

const labLog: LabAnalysis = {
  id: 'LAB-1',
  lotId: 'LOT-1',
  tankId: 'T-1',
  date: '2026-08-22',
  alcoholPct: 12,
  volatileAcid: 0.3,
  freeSo2: 25,
  totalSo2: 70,
  residualSugar: 2,
  ph: 3.5,
  malicAcid: 0.2,
  lacticAcid: 1.2,
  turbidity: 4,
  technician: 'Nino',
  titratableAcidity: 5.5,
};

describe('lot next action', () => {
  it('blocks early-stage work until the lot has a non-empty vessel', () => {
    const action = nextActionForWineLot(lot(), { now: '2026-08-22' });

    expect(action.status).toBe('blocked');
    expect(action.intent).toBe('open_vessels');
    expect(action.label).toBe('Assign a vessel to this lot');
  });

  it('asks for today\'s fermentation evidence before recommending completion', () => {
    const action = nextActionForWineLot(lot(), {
      vessels: [vessel],
      fermLogs: [fermLog('2026-08-21')],
      now: '2026-08-22T10:00:00Z',
    });

    expect(action.status).toBe('needs_data');
    expect(action.intent).toBe('open_fermentation');
    expect(action.shortLabel).toBe('Log today');
  });

  it('recommends reviewing completion when today\'s reading exists', () => {
    const action = nextActionForWineLot(lot(), {
      vessels: [vessel],
      fermLogs: [fermLog('2026-08-22')],
      now: '2026-08-22T10:00:00Z',
    });

    expect(action.status).toBe('ready');
    expect(action.label).toBe('Review fermentation completion');
  });

  it('requires chemistry evidence during aging before the next stage', () => {
    const missing = nextActionForWineLot(lot({ stage: 'aging' }), { now: '2026-08-22' });
    const ready = nextActionForWineLot(lot({ stage: 'aging' }), {
      labLogs: [labLog],
      now: '2026-08-22',
    });

    expect(missing).toMatchObject({ status: 'needs_data', intent: 'open_lab' });
    expect(ready).toMatchObject({
      status: 'ready',
      intent: 'transition',
      targetStage: 'stabilization',
    });
  });

  it('routes filtration to the authoritative bottling operation', () => {
    const action = nextActionForWineLot(lot({ stage: 'filtration' }));

    expect(action).toMatchObject({
      status: 'ready',
      intent: 'open_bottling',
      destinationTab: 'bottling',
    });
  });

  it('marks sold lots complete without recommending another stage', () => {
    const action = nextActionForWineLot(lot({ stage: 'sold', currentVolume: 0 }));

    expect(action.status).toBe('complete');
    expect(action.targetStage).toBeUndefined();
  });
});
