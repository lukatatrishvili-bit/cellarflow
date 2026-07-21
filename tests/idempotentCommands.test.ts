import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  commandRequestHash,
  executeIdempotentCommand,
  validateCommandId,
  validateCommandType,
} from '../server/idempotentCommands';

interface StoredCommand {
  organizationId: string;
  commandId: string;
  commandType: string;
  actorUsername: string;
  requestHash: string;
  status: string;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

function createMemoryPrisma() {
  let stored: StoredCommand | null = null;

  const prisma = {
    $transaction: async (callback: (transaction: any) => Promise<unknown>) => {
      let transactionRow = stored ? { ...stored } : null;
      const transaction = {
        commandExecution: {
          createMany: async ({ data }: any) => {
            if (transactionRow) return { count: 0 };
            const now = new Date();
            transactionRow = {
              ...data,
              result: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            };
            return { count: 1 };
          },
          findUnique: async () => transactionRow,
          update: async ({ data }: any) => {
            if (!transactionRow) throw new Error('missing command');
            transactionRow = { ...transactionRow, ...data, updatedAt: new Date() };
            return transactionRow;
          },
        },
      };

      const result = await callback(transaction);
      stored = transactionRow;
      return result;
    },
  } as unknown as PrismaClient;

  return { prisma, stored: () => stored };
}

const input = {
  organizationId: 'org-contract',
  commandId: 'cmd-contract-0001',
  commandType: 'cellar.transfer',
  actorUsername: 'winemaker',
  payload: { sourceId: 'T-1', destinationId: 'T-2', volume: 250 },
};

describe('idempotent command contract', () => {
  it('hashes semantically identical object payloads identically', () => {
    const left = commandRequestHash('cellar.transfer', {
      source: 'T-1',
      details: { volume: 250, tags: ['rack', 'clean'] },
    });
    const right = commandRequestHash('cellar.transfer', {
      details: { tags: ['rack', 'clean'], volume: 250 },
      source: 'T-1',
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects malformed identifiers, command types, and non-JSON values', () => {
    expect(() => validateCommandId('short')).toThrowError(expect.objectContaining({ code: 'invalid_command_id' }));
    expect(() => validateCommandType('Cellar Transfer')).toThrowError(
      expect.objectContaining({ code: 'invalid_command_type' }),
    );
    expect(() => commandRequestHash('cellar.transfer', { volume: Number.NaN })).toThrowError(
      expect.objectContaining({ code: 'invalid_command_payload' }),
    );
  });

  it('executes once and replays the durable result for the same request', async () => {
    const memory = createMemoryPrisma();
    const execute = vi.fn(async () => ({ transferId: 'TR-001', stateVersion: 2 }));

    const first = await executeIdempotentCommand(memory.prisma, input, execute);
    const replay = await executeIdempotentCommand(memory.prisma, input, execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ disposition: 'executed', result: { transferId: 'TR-001', stateVersion: 2 } });
    expect(replay).toMatchObject({ disposition: 'replayed', result: { transferId: 'TR-001', stateVersion: 2 } });
    expect(memory.stored()).toMatchObject({ status: 'completed', completedAt: expect.any(Date) });
  });

  it('rejects reuse of a command id with a different request', async () => {
    const memory = createMemoryPrisma();
    await executeIdempotentCommand(memory.prisma, input, async () => ({ stateVersion: 2 }));

    await expect(executeIdempotentCommand(
      memory.prisma,
      { ...input, payload: { ...input.payload, volume: 500 } },
      async () => ({ stateVersion: 3 }),
    )).rejects.toMatchObject({ code: 'idempotency_key_reused', statusCode: 409 });
  });

  it('rolls back the claim when the command callback fails so a retry can execute', async () => {
    const memory = createMemoryPrisma();
    await expect(executeIdempotentCommand(memory.prisma, input, async () => {
      throw new Error('domain mutation failed');
    })).rejects.toThrow('domain mutation failed');
    expect(memory.stored()).toBeNull();

    const retry = await executeIdempotentCommand(memory.prisma, input, async () => ({ stateVersion: 2 }));
    expect(retry.disposition).toBe('executed');
  });
});
