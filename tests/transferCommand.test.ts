import { describe, expect, it } from 'vitest';
import type { Vessel, WineLot } from '../lib/wineryState';
import {
  applyTransferCommand,
  parseTransferCommandPayload,
  type TransferCommandPayload,
  type TransferCommandState,
} from '../lib/commands/transfer';

function vessel(overrides: Partial<Vessel> & Pick<Vessel, 'id'>): Vessel {
  return {
    id: overrides.id,
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 1_000,
    currentVolume: 0,
    assignedLotId: null,
    cleaningStatus: 'clean',
    lastCleaned: '2026-07-19',
    temperature: 16,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: '',
    ...overrides,
  };
}

function lot(overrides: Partial<WineLot> & Pick<WineLot, 'id' | 'name'>): WineLot {
  return {
    id: overrides.id,
    name: overrides.name,
    vintage: 2025,
    variety: 'Saperavi',
    vineyardBlock: 'Block A',
    region: 'Kakheti',
    initialVolume: 1_000,
    currentVolume: 1_000,
    wineClass: 'red',
    stage: 'aging',
    createdAt: '2025-10-01',
    history: [],
    ...overrides,
  };
}

function state(overrides: Partial<TransferCommandState> = {}): TransferCommandState {
  return {
    vessels: [
      vessel({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' }),
      vessel({ id: 'T-2', capacity: 500 }),
    ],
    lots: [lot({ id: 'LOT-A', name: 'Estate Saperavi' })],
    transfers: [],
    ...overrides,
  };
}

const payload: TransferCommandPayload = {
  transferId: 'xfer-test-0001',
  blendLotId: 'blend-test-0001',
  sourceVesselId: 'T-1',
  destinationVesselId: 'T-2',
  volumeLiters: 200,
  lossLiters: 5,
  operator: 'Nino',
  category: 'racking',
  pump: 'Pump A',
};

const context = {
  commandId: 'cmd-transfer-test-0001',
  actorUsername: 'nino',
  performedAt: new Date('2026-07-20T08:30:00.000Z'),
};

describe('cellar.transfer domain command', () => {
  it('updates both vessels, the lot balance, history, and transfer ledger atomically', () => {
    const applied = applyTransferCommand(state(), payload, context);

    expect(applied.result.receipt).toMatchObject({
      kind: 'transfer',
      volumeLiters: 200,
      arrivalLiters: 195,
      destinationLotId: 'LOT-A',
    });
    expect(applied.state.vessels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'T-1', currentVolume: 400, assignedLotId: 'LOT-A' }),
      expect.objectContaining({ id: 'T-2', currentVolume: 195, assignedLotId: 'LOT-A' }),
    ]));
    expect(applied.state.lots[0]).toMatchObject({
      id: 'LOT-A',
      currentVolume: 995,
      history: [expect.objectContaining({ sourceRef: 'xfer-test-0001', type: 'Liquid Transfer' })],
    });
    expect(applied.state.transfers[0]).toMatchObject({
      id: 'xfer-test-0001',
      commandId: 'cmd-transfer-test-0001',
      recordKind: 'transfer',
      category: 'racking',
      date: '2026-07-20',
      reversalSnapshot: {
        version: 1,
        sourceVessel: { id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' },
        destinationVessel: { id: 'T-2', currentVolume: 0, assignedLotId: null },
        sourceLot: { id: 'LOT-A', currentVolume: 1_000 },
      },
    });
  });

  it('uses arriving volume for destination capacity after process loss', () => {
    const current = state({
      vessels: [
        vessel({ id: 'T-1', currentVolume: 100, assignedLotId: 'LOT-A' }),
        vessel({ id: 'T-2', capacity: 95 }),
      ],
    });
    const applied = applyTransferCommand(current, {
      ...payload,
      volumeLiters: 100,
      lossLiters: 5,
    }, context);

    expect(applied.result.destinationVessel.currentVolume).toBe(95);
    expect(applied.result.sourceVessel).toMatchObject({ currentVolume: 0, assignedLotId: null, cleaningStatus: 'dirty' });
  });

  it('creates a genealogy lot and removes both physical blend contributions from parent lots', () => {
    const current = state({
      vessels: [
        vessel({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' }),
        vessel({ id: 'T-2', capacity: 1_000, currentVolume: 400, assignedLotId: 'LOT-B' }),
      ],
      lots: [
        lot({ id: 'LOT-A', name: 'Saperavi', currentVolume: 1_000 }),
        lot({ id: 'LOT-B', name: 'Cabernet', variety: 'Cabernet Sauvignon', currentVolume: 400 }),
      ],
    });
    const applied = applyTransferCommand(current, { ...payload, lossLiters: 10 }, context);

    expect(applied.result.receipt).toMatchObject({ kind: 'blend', arrivalLiters: 190 });
    expect(applied.result.transfer).toMatchObject({
      lineageVersion: 1,
      sourceLotId: 'LOT-A',
      destinationLotId: 'LOT-B',
      resultLotId: 'blend-test-0001',
      sourceContributionL: 200,
      destinationContributionL: 400,
      arrivalVolumeL: 190,
    });
    expect(applied.result.destinationVessel).toMatchObject({ currentVolume: 590, assignedLotId: 'blend-test-0001' });
    expect(applied.state.lots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'LOT-A', currentVolume: 800 }),
      expect.objectContaining({ id: 'LOT-B', currentVolume: 0 }),
      expect.objectContaining({ id: 'blend-test-0001', initialVolume: 590, currentVolume: 590 }),
    ]));
    const resultingTotal = applied.state.lots.reduce((sum, item) => sum + item.currentVolume, 0);
    expect(resultingTotal).toBe(1_390);
  });

  it('rejects insufficient source volume and destination overflow', () => {
    expect(() => applyTransferCommand(state(), { ...payload, volumeLiters: 700 }, context))
      .toThrowError(expect.objectContaining({ code: 'insufficient_source_volume', statusCode: 409 }));
    expect(() => applyTransferCommand(state(), { ...payload, volumeLiters: 550, lossLiters: 5 }, context))
      .toThrowError(expect.objectContaining({ code: 'destination_capacity_exceeded', statusCode: 409 }));
  });

  it('rejects an empty dirty destination and ambiguous vessel selection', () => {
    const dirtyDestination = state({
      vessels: [
        vessel({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' }),
        vessel({ id: 'T-2', capacity: 500, cleaningStatus: 'dirty' }),
      ],
    });
    expect(() => applyTransferCommand(dirtyDestination, payload, context))
      .toThrowError(expect.objectContaining({ code: 'destination_not_clean' }));
    expect(() => applyTransferCommand(state(), { ...payload, destinationVesselId: 'T-1' }, context))
      .toThrowError(expect.objectContaining({ code: 'same_transfer_vessel' }));
  });

  it('rejects invalid loss values and unsupported categories at the boundary', () => {
    expect(() => parseTransferCommandPayload({ ...payload, lossLiters: 200 }))
      .toThrowError(expect.objectContaining({ code: 'invalid_transfer_payload' }));
    expect(() => parseTransferCommandPayload({ ...payload, category: 'unknown' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_transfer_payload' }));
  });

  it('rejects duplicate transfer and blend record identifiers', () => {
    expect(() => applyTransferCommand(state({
      transfers: [{
        id: payload.transferId,
        sourceId: 'T-X',
        destId: 'T-Y',
        volume: 1,
        loss: 0,
        operator: 'Existing',
        category: 'racking',
        date: '2026-07-19',
        pump: 'Pump',
        details: '',
      }],
    }), payload, context)).toThrowError(expect.objectContaining({ code: 'transfer_id_conflict' }));

    const blendState = state({
      vessels: [
        vessel({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' }),
        vessel({ id: 'T-2', currentVolume: 100, assignedLotId: 'LOT-B' }),
      ],
      lots: [
        lot({ id: 'LOT-A', name: 'A' }),
        lot({ id: 'LOT-B', name: 'B', currentVolume: 100 }),
        lot({ id: payload.blendLotId, name: 'Existing blend' }),
      ],
    });
    expect(() => applyTransferCommand(blendState, payload, context))
      .toThrowError(expect.objectContaining({ code: 'blend_lot_id_conflict' }));
  });
});
