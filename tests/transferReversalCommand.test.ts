import { describe, expect, it } from 'vitest';
import type { Vessel, WineLot } from '../lib/wineryState';
import { applyTransferCommand, type TransferCommandState } from '../lib/commands/transfer';
import {
  applyTransferReversalCommand,
  parseTransferReversalCommandPayload,
} from '../lib/commands/transferReversal';

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

function initialState(blend = false): TransferCommandState {
  return {
    vessels: [
      vessel({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A', lastOperation: 'Filled from harvest' }),
      vessel({
        id: 'T-2',
        capacity: 1_000,
        currentVolume: blend ? 400 : 0,
        assignedLotId: blend ? 'LOT-B' : null,
        lastOperation: blend ? 'Aging Cabernet' : 'Sanitized',
      }),
    ],
    lots: [
      lot({ id: 'LOT-A', name: 'Saperavi', currentVolume: 1_000 }),
      ...(blend ? [lot({ id: 'LOT-B', name: 'Cabernet', currentVolume: 400 })] : []),
    ],
    transfers: [],
    costEntries: blend
      ? [
          {
            id: 'cost-a',
            date: '2026-07-01',
            lotId: 'LOT-A',
            category: 'grape',
            description: 'Source cost',
            amount: 1_000,
            currency: 'GEL',
          },
          {
            id: 'cost-b',
            date: '2026-07-01',
            lotId: 'LOT-B',
            category: 'grape',
            description: 'Destination cost',
            amount: 800,
            currency: 'GEL',
          },
        ]
      : [],
  };
}

const originalPayload = {
  transferId: 'xfer-reversal-source-0001',
  blendLotId: 'blend-reversal-source-0001',
  sourceVesselId: 'T-1',
  destinationVesselId: 'T-2',
  volumeLiters: 200,
  lossLiters: 5,
  operator: 'Nino',
  category: 'racking' as const,
  pump: 'Pump A',
};

const originalContext = {
  commandId: 'cmd-transfer-original-0001',
  actorUsername: 'nino',
  performedAt: new Date('2026-07-20T08:30:00.000Z'),
};

const reversalPayload = {
  reversalId: 'xfer-reversal-0001',
  originalCommandId: originalContext.commandId,
  reason: 'Wrong destination vessel selected.',
};

const reversalContext = {
  commandId: 'cmd-transfer-reversal-0001',
  actorUsername: 'owner',
  performedAt: new Date('2026-07-20T09:00:00.000Z'),
};

describe('cellar.transfer.reverse domain command', () => {
  it('restores a transfer exactly and appends correction evidence without deleting history', () => {
    const before = initialState();
    const transferred = applyTransferCommand(before, originalPayload, originalContext);
    const reversed = applyTransferReversalCommand(transferred.state, reversalPayload, reversalContext);

    expect(reversed.state.vessels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'T-1',
        currentVolume: 600,
        assignedLotId: 'LOT-A',
        cleaningStatus: 'clean',
        lastOperation: 'Filled from harvest',
        lastCommandId: reversalContext.commandId,
      }),
      expect.objectContaining({
        id: 'T-2',
        currentVolume: 0,
        assignedLotId: null,
        lastOperation: 'Sanitized',
      }),
    ]));
    expect(reversed.state.lots.find(item => item.id === 'LOT-A')).toMatchObject({
      currentVolume: 1_000,
      history: [
        expect.objectContaining({ type: 'Transfer Reversal', sourceRef: reversalPayload.reversalId }),
        expect.objectContaining({ type: 'Liquid Transfer', sourceRef: originalPayload.transferId }),
      ],
    });
    expect(reversed.state.transfers).toHaveLength(2);
    expect(reversed.result.originalTransfer).toMatchObject({
      id: originalPayload.transferId,
      reversedByCommandId: reversalContext.commandId,
      reversalReason: reversalPayload.reason,
    });
    expect(reversed.result.reversalTransfer).toMatchObject({
      recordKind: 'reversal',
      reversalOfTransferId: originalPayload.transferId,
      reversalOfCommandId: originalContext.commandId,
    });
  });

  it('restores both blend parents and retains the created blend as voided evidence', () => {
    const transferred = applyTransferCommand(
      initialState(true),
      { ...originalPayload, lossLiters: 10 },
      originalContext,
    );
    const reversed = applyTransferReversalCommand(transferred.state, reversalPayload, reversalContext);

    expect(reversed.state.vessels).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'T-1', currentVolume: 600, assignedLotId: 'LOT-A' }),
      expect.objectContaining({ id: 'T-2', currentVolume: 400, assignedLotId: 'LOT-B' }),
    ]));
    expect(reversed.state.lots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'LOT-A', currentVolume: 1_000 }),
      expect.objectContaining({ id: 'LOT-B', currentVolume: 400 }),
      expect.objectContaining({
        id: originalPayload.blendLotId,
        currentVolume: 0,
        voidedByCommandId: reversalContext.commandId,
        voidReason: reversalPayload.reason,
      }),
    ]));
    expect(reversed.state.lots).toHaveLength(3);
    expect(reversed.result.changedCostEntries.filter(entry => entry.recordKind === 'reversal'))
      .toEqual([
        expect.objectContaining({ lotId: 'LOT-A', category: 'blend_out', amount: 200 }),
        expect.objectContaining({ lotId: 'LOT-B', category: 'blend_out', amount: 800 }),
        expect.objectContaining({ lotId: originalPayload.blendLotId, category: 'blend_in', amount: -1_000 }),
      ]);
    expect(reversed.state.costEntries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(1_800);
  });

  it('rejects compensation when dependent work changed an affected resource', () => {
    const transferred = applyTransferCommand(initialState(), originalPayload, originalContext);
    const changed = {
      ...transferred.state,
      vessels: transferred.state.vessels.map(item => item.id === 'T-2'
        ? { ...item, lastModified: '2026-07-20T08:45:00.000Z', lastOperation: 'Sampled' }
        : item),
    };

    expect(() => applyTransferReversalCommand(changed, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({
        code: 'transfer_reversal_dependency_conflict',
        statusCode: 409,
      }));
  });

  it('rejects a second correction and transfers without complete snapshots', () => {
    const transferred = applyTransferCommand(initialState(), originalPayload, originalContext);
    const reversed = applyTransferReversalCommand(transferred.state, reversalPayload, reversalContext);

    expect(() => applyTransferReversalCommand(reversed.state, {
      ...reversalPayload,
      reversalId: 'xfer-reversal-0002',
    }, {
      ...reversalContext,
      commandId: 'cmd-transfer-reversal-0002',
    })).toThrowError(expect.objectContaining({ code: 'transfer_already_reversed' }));

    const withoutSnapshot = {
      ...transferred.state,
      transfers: transferred.state.transfers.map(item => ({ ...item, reversalSnapshot: undefined })),
    };
    expect(() => applyTransferReversalCommand(withoutSnapshot, reversalPayload, reversalContext))
      .toThrowError(expect.objectContaining({ code: 'transfer_reversal_snapshot_missing' }));
  });

  it('validates the shared reversal reference and reason at the boundary', () => {
    expect(parseTransferReversalCommandPayload(reversalPayload)).toEqual(reversalPayload);
    expect(() => parseTransferReversalCommandPayload({ ...reversalPayload, reason: '   ' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_transfer_reversal_payload', statusCode: 400 }));
  });
});
