import { describe, expect, it } from 'vitest';
import { paletteActionHints, parsePaletteAction } from '../lib/paletteActions';
import type { Vessel } from '../lib/wineryState';

const vessel = (id: string): Vessel => ({
  id,
  type: 'stainless_steel',
  shape: 'vertical',
  capacity: 5000,
  currentVolume: 3000,
  assignedLotId: 'LOT-A',
  cleaningStatus: 'clean',
  lastCleaned: '2026-09-01',
  temperature: 16,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Filled',
});

const vessels = [vessel('T-101'), vessel('T-204'), vessel('B-01'), vessel('T-1'), vessel('T-12')];

const parse = (query: string, lang?: string) => parsePaletteAction({ query, vessels, lang });

describe('parsePaletteAction — transfers', () => {
  it('reads a transfer with a volume', () => {
    expect(parse('rack T-101 T-204 1200')?.action).toEqual({
      kind: 'transfer',
      sourceVesselId: 'T-101',
      destinationVesselId: 'T-204',
      litres: 1200,
    });
  });

  it('reads a transfer without a volume', () => {
    expect(parse('transfer T-101 T-204')?.action).toEqual({
      kind: 'transfer',
      sourceVesselId: 'T-101',
      destinationVesselId: 'T-204',
    });
  });

  it('accepts every transfer verb', () => {
    for (const verb of ['rack', 'racking', 'transfer', 'move', 'გადატანა']) {
      expect(parse(`${verb} T-101 T-204`)?.action.kind).toBe('transfer');
    }
  });

  it('refuses a transfer into the same vessel', () => {
    expect(parse('rack T-101 T-101')).toBeNull();
  });

  it('refuses when a vessel does not exist', () => {
    expect(parse('rack T-999 T-204')).toBeNull();
    expect(parse('rack T-101 NOPE')).toBeNull();
  });

  it('says what it will do, and that it will not do it yet', () => {
    const parsed = parse('rack T-101 T-204 1200');

    expect(parsed?.title).toBe('Transfer T-101 → T-204 · 1200 L');
    expect(parsed?.detail).toMatch(/confirm/i);
  });
});

describe('parsePaletteAction — operations', () => {
  it('reads topping with litres', () => {
    expect(parse('top B-01 5')?.action).toEqual({
      kind: 'operation',
      vesselId: 'B-01',
      type: 'topping',
      litres: 5,
    });
  });

  it('maps the shorthand people actually type', () => {
    const cases: Array<[string, string]> = [
      ['so2 T-101', 'sulfitation'],
      ['sulfite T-101', 'sulfitation'],
      ['pump T-101', 'pumpover'],
      ['punch T-101', 'punchdown'],
      ['temp T-101', 'measurement'],
      ['brix T-101', 'measurement'],
      ['filter T-101', 'filtration'],
      ['fine T-101', 'fining'],
    ];
    for (const [query, type] of cases) {
      const action = parse(query)?.action;
      expect(action, query).toMatchObject({ kind: 'operation', type });
    }
  });

  it('refuses operations that have their own dedicated workflow', () => {
    // `rack` is a transfer, and bottling/blending/cleaning are not quick ops.
    for (const query of ['bottling T-101', 'blend T-101', 'clean T-101']) {
      expect(parse(query), query).toBeNull();
    }
  });

  it('refuses a verb it does not know', () => {
    expect(parse('frobnicate T-101')).toBeNull();
  });
});

describe('parsePaletteAction — vessel matching', () => {
  it('matches a unique prefix', () => {
    expect(parse('so2 B-0')?.action).toMatchObject({ vesselId: 'B-01' });
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    // "T-1" is exactly one vessel's id, so it wins as an exact match...
    expect(parse('so2 T-1')?.action).toMatchObject({ vesselId: 'T-1' });
    // ...but a prefix matching several resolves to nothing.
    expect(parse('so2 T-')).toBeNull();
  });

  it('ignores case', () => {
    expect(parse('SO2 t-101')?.action).toMatchObject({ vesselId: 'T-101' });
  });
});

describe('parsePaletteAction — non-actions', () => {
  it('returns nothing for a bare search', () => {
    expect(parse('')).toBeNull();
    expect(parse('saperavi')).toBeNull();
    expect(parse('T-101')).toBeNull();
  });

  it('returns nothing for a verb with no vessel', () => {
    expect(parse('rack')).toBeNull();
    expect(parse('rack T-101')).toBeNull();
  });

  it('ignores a volume that is not a positive number', () => {
    for (const bad of ['0', '-5', 'abc']) {
      const action = parse(`top B-01 ${bad}`)?.action;
      expect(action, bad).toEqual({ kind: 'operation', vesselId: 'B-01', type: 'topping' });
    }
  });

  it('reads a comma decimal the way a European keyboard types it', () => {
    expect(parse('top B-01 2,5')?.action).toMatchObject({ litres: 2.5 });
  });
});

describe('paletteActionHints', () => {
  it('offers examples its own parser accepts', () => {
    for (const hint of paletteActionHints(false)) {
      expect(parsePaletteAction({ query: hint, vessels }), hint).not.toBeNull();
    }
  });
});
