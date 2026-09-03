import fs from 'node:fs';
import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { executeIdempotentCommand } from '../../server/idempotentCommands';
import { executeCellarBottlingCommand } from '../../server/commands/bottling';
import { executeBottlingReversalCommand } from '../../server/commands/bottlingReversal';
import { executeCellarOperationCommand } from '../../server/commands/cellarOperation';
import { executeCellarOperationReversalCommand } from '../../server/commands/cellarOperationReversal';
import { executeFermentationCompletionCommand } from '../../server/commands/fermentationCompletion';
import { executeFermentationCompletionReversalCommand } from '../../server/commands/fermentationCompletionReversal';
import { executeHarvestIntakeCommand } from '../../server/commands/harvestIntake';
import { executeHarvestIntakeReversalCommand } from '../../server/commands/harvestIntakeReversal';
import { executeSalesStockCommand } from '../../server/commands/salesStock';
import { executeSalesStockReversalCommand } from '../../server/commands/salesStockReversal';
import { executeStorageMovementCommand } from '../../server/commands/storageMovement';
import { executeCellarTransferCommand } from '../../server/commands/transfer';
import { executeCellarTransferReversalCommand } from '../../server/commands/transferReversal';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'PostgreSQL integration tests require TEST_DATABASE_URL or DATABASE_URL. '
    + 'Use an isolated disposable database.',
  );
}

const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

const runPrefix = `pg-it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function organizationId(suffix: string): string {
  return `${runPrefix}-org-${suffix}`;
}

function username(suffix: string): string {
  return `${runPrefix}-user-${suffix}`;
}

async function cleanTestRows(): Promise<void> {
  await prisma.organization.deleteMany({
    where: { id: { startsWith: runPrefix } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: runPrefix } },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(cleanTestRows);

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

describe('committed PostgreSQL migrations', () => {
  it('records every committed migration as successfully applied', async () => {
    const expectedMigrations = fs.readdirSync(path.resolve('prisma/migrations'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    const appliedMigrations = await prisma.$queryRaw<Array<{
      migration_name: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>>(Prisma.sql`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY migration_name
    `);

    expect(appliedMigrations.map(migration => migration.migration_name)).toEqual(expectedMigrations);
    expect(appliedMigrations.every(migration => migration.finished_at instanceof Date)).toBe(true);
    expect(appliedMigrations.every(migration => migration.rolled_back_at === null)).toBe(true);
  });
});

describe('authoritative organization-state isolation', () => {
  it('keeps duplicate human-readable record IDs isolated by organization', async () => {
    const orgA = organizationId('state-a');
    const orgB = organizationId('state-b');

    await prisma.$transaction([
      prisma.organization.create({ data: { id: orgA, name: 'Integration Estate A' } }),
      prisma.organization.create({ data: { id: orgB, name: 'Integration Estate B' } }),
    ]);
    await prisma.$transaction([
      prisma.organizationState.create({
        data: {
          organizationId: orgA,
          version: 1,
          updatedBy: 'postgres-integration',
          data: {
            lots: [{ id: 'LOT-001', name: 'Estate A Saperavi' }],
            vessels: [{ id: 'T-001', name: 'Estate A Tank' }],
          },
        },
      }),
      prisma.organizationState.create({
        data: {
          organizationId: orgB,
          version: 1,
          updatedBy: 'postgres-integration',
          data: {
            lots: [{ id: 'LOT-001', name: 'Estate B Rkatsiteli' }],
            vessels: [{ id: 'T-001', name: 'Estate B Tank' }],
          },
        },
      }),
    ]);

    const [stateA, stateB] = await Promise.all([
      prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgA } }),
      prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgB } }),
    ]);

    expect(stateA.data).toMatchObject({
      lots: [{ id: 'LOT-001', name: 'Estate A Saperavi' }],
      vessels: [{ id: 'T-001', name: 'Estate A Tank' }],
    });
    expect(stateB.data).toMatchObject({
      lots: [{ id: 'LOT-001', name: 'Estate B Rkatsiteli' }],
      vessels: [{ id: 'T-001', name: 'Estate B Tank' }],
    });
  });

  it('keeps duplicate vessel and lot projection IDs isolated by organization', async () => {
    const orgA = organizationId('projection-a');
    const orgB = organizationId('projection-b');
    await prisma.$transaction([
      prisma.organization.create({ data: { id: orgA, name: 'Projection Estate A' } }),
      prisma.organization.create({ data: { id: orgB, name: 'Projection Estate B' } }),
    ]);

    const vessel = (organizationId: string, capacity: number) => ({
      organizationId,
      id: 'T-01',
      type: 'tank',
      shape: 'vertical',
      capacity,
      currentVolume: 0,
      cleaningStatus: 'clean',
      lastCleaned: '2026-07-26',
      temperature: 18,
      coolingJacketActive: false,
      lastOperation: '',
    });
    const lot = (organizationId: string, name: string) => ({
      organizationId,
      id: 'LOT-01',
      name,
      vintage: 2026,
      variety: 'Saperavi',
      vineyardBlock: 'Block 1',
      region: 'Kakheti',
      initialVolume: 1000,
      currentVolume: 1000,
      wineClass: 'red',
      stage: 'fermenting',
      createdAt: '2026-07-26',
    });

    await prisma.$transaction([
      prisma.vessel.create({ data: vessel(orgA, 1_000) }),
      prisma.vessel.create({ data: vessel(orgB, 2_000) }),
      prisma.wineLot.create({ data: lot(orgA, 'Estate A Saperavi') }),
      prisma.wineLot.create({ data: lot(orgB, 'Estate B Saperavi') }),
    ]);
    await prisma.vessel.update({
      where: { organizationId_id: { organizationId: orgA, id: 'T-01' } },
      data: { capacity: 1_250 },
    });

    await expect(prisma.vessel.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgA, id: 'T-01' } },
    })).resolves.toMatchObject({ capacity: 1_250 });
    await expect(prisma.vessel.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgB, id: 'T-01' } },
    })).resolves.toMatchObject({ capacity: 2_000 });
    await expect(prisma.wineLot.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgA, id: 'LOT-01' } },
    })).resolves.toMatchObject({ name: 'Estate A Saperavi' });
    await expect(prisma.wineLot.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: orgB, id: 'LOT-01' } },
    })).resolves.toMatchObject({ name: 'Estate B Saperavi' });
  });

  it('applies compare-and-swap updates to only the targeted organization', async () => {
    const orgA = organizationId('cas-a');
    const orgB = organizationId('cas-b');

    await prisma.$transaction([
      prisma.organization.create({ data: { id: orgA, name: 'CAS Estate A' } }),
      prisma.organization.create({ data: { id: orgB, name: 'CAS Estate B' } }),
    ]);
    await prisma.$transaction([
      prisma.organizationState.create({
        data: { organizationId: orgA, version: 1, data: { marker: 'a-v1' } },
      }),
      prisma.organizationState.create({
        data: { organizationId: orgB, version: 1, data: { marker: 'b-v1' } },
      }),
    ]);

    const accepted = await prisma.organizationState.updateMany({
      where: { organizationId: orgA, version: 1 },
      data: {
        data: { marker: 'a-v2' },
        version: { increment: 1 },
        updatedBy: 'postgres-integration',
      },
    });
    const staleRetry = await prisma.organizationState.updateMany({
      where: { organizationId: orgA, version: 1 },
      data: { data: { marker: 'must-not-commit' }, version: { increment: 1 } },
    });

    const [stateA, stateB] = await Promise.all([
      prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgA } }),
      prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgB } }),
    ]);

    expect(accepted.count).toBe(1);
    expect(staleRetry.count).toBe(0);
    expect(stateA).toMatchObject({ version: 2, data: { marker: 'a-v2' } });
    expect(stateB).toMatchObject({ version: 1, data: { marker: 'b-v1' } });
  });

  it('cascades organization-owned rows without affecting another tenant', async () => {
    const orgA = organizationId('cascade-a');
    const orgB = organizationId('cascade-b');
    const userA = username('cascade-a');
    const userB = username('cascade-b');

    await prisma.$transaction([
      prisma.user.create({
        data: {
          id: `${runPrefix}-user-id-a`,
          username: userA,
          email: `${userA}@example.test`,
          fullName: 'Integration Owner A',
          role: 'Owner/Admin',
          passwordHash: 'integration-only',
        },
      }),
      prisma.user.create({
        data: {
          id: `${runPrefix}-user-id-b`,
          username: userB,
          email: `${userB}@example.test`,
          fullName: 'Integration Owner B',
          role: 'Owner/Admin',
          passwordHash: 'integration-only',
        },
      }),
      prisma.organization.create({ data: { id: orgA, name: 'Cascade Estate A' } }),
      prisma.organization.create({ data: { id: orgB, name: 'Cascade Estate B' } }),
    ]);
    await prisma.$transaction([
      prisma.membership.create({
        data: { id: `${runPrefix}-membership-a`, userId: userA, organizationId: orgA, role: 'Owner/Admin' },
      }),
      prisma.membership.create({
        data: { id: `${runPrefix}-membership-b`, userId: userB, organizationId: orgB, role: 'Owner/Admin' },
      }),
      prisma.organizationState.create({ data: { organizationId: orgA, data: { tenant: 'a' } } }),
      prisma.organizationState.create({ data: { organizationId: orgB, data: { tenant: 'b' } } }),
    ]);

    await prisma.organization.delete({ where: { id: orgA } });

    expect(await prisma.organizationState.findUnique({ where: { organizationId: orgA } })).toBeNull();
    expect(await prisma.membership.count({ where: { organizationId: orgA } })).toBe(0);
    await expect(prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgB } }))
      .resolves.toMatchObject({ data: { tenant: 'b' } });
    expect(await prisma.membership.count({ where: { organizationId: orgB } })).toBe(1);
  });
});

describe('durable idempotent command execution', () => {
  it('commits one domain mutation when duplicate requests race concurrently', async () => {
    const orgId = organizationId('command-race');
    await prisma.organization.create({ data: { id: orgId, name: 'Command Race Estate' } });
    await prisma.organizationState.create({
      data: { organizationId: orgId, version: 1, data: { transfers: [] } },
    });

    let executions = 0;
    const command = {
      organizationId: orgId,
      commandId: `${runPrefix}-command-race`,
      commandType: 'cellar.transfer',
      actorUsername: username('command-race'),
      payload: { sourceId: 'T-1', destinationId: 'T-2', volume: 250 },
    };
    const execute = async (transaction: Prisma.TransactionClient) => {
      executions += 1;
      await new Promise(resolve => setTimeout(resolve, 75));
      const updated = await transaction.organizationState.update({
        where: { organizationId: orgId },
        data: {
          version: { increment: 1 },
          data: { transfers: [{ id: 'TR-001', volume: 250 }] },
          updatedBy: command.actorUsername,
        },
      });
      return { transferId: 'TR-001', stateVersion: updated.version };
    };

    const outcomes = await Promise.all([
      executeIdempotentCommand(prisma, command, execute),
      executeIdempotentCommand(prisma, command, execute),
    ]);

    expect(executions).toBe(1);
    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(outcomes[0].result).toEqual(outcomes[1].result);
    await expect(prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } }))
      .resolves.toMatchObject({ version: 2, data: { transfers: [{ id: 'TR-001', volume: 250 }] } });
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('rejects a changed request that reuses a completed command id', async () => {
    const orgId = organizationId('command-reuse');
    await prisma.organization.create({ data: { id: orgId, name: 'Command Reuse Estate' } });
    const base = {
      organizationId: orgId,
      commandId: `${runPrefix}-command-reuse`,
      commandType: 'cellar.transfer',
      actorUsername: username('command-reuse'),
      payload: { volume: 100 },
    };

    await executeIdempotentCommand(prisma, base, async () => ({ acceptedVolume: 100 }));
    await expect(executeIdempotentCommand(
      prisma,
      { ...base, payload: { volume: 200 } },
      async () => ({ acceptedVolume: 200 }),
    )).rejects.toMatchObject({ code: 'idempotency_key_reused', statusCode: 409 });
  });

  it('rolls back the domain write and command claim together when execution fails', async () => {
    const orgId = organizationId('command-rollback');
    await prisma.organization.create({ data: { id: orgId, name: 'Command Rollback Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: { marker: 'before' } } });
    const command = {
      organizationId: orgId,
      commandId: `${runPrefix}-command-rollback`,
      commandType: 'cellar.transfer',
      actorUsername: username('command-rollback'),
      payload: { volume: 100 },
    };

    await expect(executeIdempotentCommand(prisma, command, async (transaction) => {
      await transaction.organizationState.update({
        where: { organizationId: orgId },
        data: { version: { increment: 1 }, data: { marker: 'must-rollback' } },
      });
      throw new Error('simulated command failure');
    })).rejects.toThrow('simulated command failure');

    await expect(prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } }))
      .resolves.toMatchObject({ version: 1, data: { marker: 'before' } });
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(0);

    const retry = await executeIdempotentCommand(prisma, command, async (transaction) => {
      const updated = await transaction.organizationState.update({
        where: { organizationId: orgId },
        data: { version: { increment: 1 }, data: { marker: 'after-retry' } },
      });
      return { stateVersion: updated.version };
    });
    expect(retry).toMatchObject({ disposition: 'executed', result: { stateVersion: 2 } });
  });
});

describe('cellar.transfer PostgreSQL transaction', () => {
  function transferState(sourceVolume = 1_000) {
    const vessel = (id: string, currentVolume: number, assignedLotId: string | null, capacity = 1_000) => ({
      id,
      type: 'stainless_steel',
      shape: 'vertical',
      capacity,
      currentVolume,
      assignedLotId,
      cleaningStatus: 'clean',
      lastCleaned: '2026-07-19',
      temperature: 16,
      coolingJacketActive: false,
      targetTemperature: null,
      lastOperation: '',
    });
    return {
      vessels: [
        vessel('T-1', sourceVolume, 'LOT-A'),
        vessel('T-2', 0, null),
        vessel('T-3', 0, null),
      ],
      lots: [{
        id: 'LOT-A',
        name: 'Integration Saperavi',
        vintage: 2025,
        variety: 'Saperavi',
        vineyardBlock: 'Block A',
        region: 'Kakheti',
        initialVolume: sourceVolume,
        currentVolume: sourceVolume,
        wineClass: 'red',
        stage: 'aging',
        createdAt: '2025-10-01',
        history: [],
      }],
      transfers: [],
    };
  }

  function transferPayload(suffix: string, destinationVesselId = 'T-2', volumeLiters = 400) {
    return {
      transferId: `${runPrefix}-xfer-${suffix}`,
      blendLotId: `${runPrefix}-blend-${suffix}`,
      sourceVesselId: 'T-1',
      destinationVesselId,
      volumeLiters,
      lossLiters: 5,
      operator: 'Integration Winemaker',
      category: 'racking',
      pump: 'Integration Pump',
    };
  }

  it('replays a racing duplicate without duplicating vessel, lot, or ledger effects', async () => {
    const orgId = organizationId('transfer-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Transfer Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: transferState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-transfer-duplicate`,
      actorUsername: username('transfer-duplicate'),
      payload: transferPayload('duplicate'),
      performedAt: new Date('2026-07-20T09:00:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeCellarTransferCommand(prisma, input),
      executeCellarTransferCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.transfers).toHaveLength(1);
    expect(data.vessels.find((item: any) => item.id === 'T-1').currentVolume).toBe(600);
    expect(data.vessels.find((item: any) => item.id === 'T-2').currentVolume).toBe(395);
    expect(data.lots.find((item: any) => item.id === 'LOT-A').currentVolume).toBe(995);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct commands on the organization row so stale volume cannot double-spend', async () => {
    const orgId = organizationId('transfer-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Transfer Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: transferState() } });
    const base = {
      organizationId: orgId,
      actorUsername: username('transfer-serialize'),
      performedAt: new Date('2026-07-20T09:05:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeCellarTransferCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-transfer-serialize-a`,
        payload: transferPayload('serialize-a', 'T-2', 600),
      }),
      executeCellarTransferCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-transfer-serialize-b`,
        payload: transferPayload('serialize-b', 'T-3', 600),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'insufficient_source_volume', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.transfers).toHaveLength(1);
    expect(data.vessels.find((item: any) => item.id === 'T-1').currentVolume).toBe(400);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('replays a racing transfer reversal without duplicating compensation', async () => {
    const orgId = organizationId('transfer-reversal-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Transfer Reversal Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: transferState() } });
    const originalCommandId = `${runPrefix}-transfer-reversal-original`;
    await executeCellarTransferCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('transfer-reversal-original'),
      payload: transferPayload('reversal-original'),
      performedAt: new Date('2026-07-20T09:10:00.000Z'),
    });
    const reversalInput = {
      organizationId: orgId,
      commandId: `${runPrefix}-transfer-reversal-duplicate`,
      actorUsername: username('transfer-reversal-duplicate'),
      payload: {
        reversalId: `${runPrefix}-xfer-reversal-duplicate`,
        originalCommandId,
        reason: 'Integration correction.',
      },
      performedAt: new Date('2026-07-20T09:11:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeCellarTransferReversalCommand(prisma, reversalInput),
      executeCellarTransferReversalCommand(prisma, reversalInput),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(3);
    expect(data.transfers).toHaveLength(2);
    expect(data.vessels.find((item: any) => item.id === 'T-1').currentVolume).toBe(1_000);
    expect(data.vessels.find((item: any) => item.id === 'T-2').currentVolume).toBe(0);
    expect(data.lots.find((item: any) => item.id === 'LOT-A').currentVolume).toBe(1_000);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it('serializes a reversal against dependent transfer work with no stale compensation', async () => {
    const orgId = organizationId('transfer-reversal-dependent-race');
    await prisma.organization.create({ data: { id: orgId, name: 'Transfer Reversal Race Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: transferState() } });
    const originalCommandId = `${runPrefix}-transfer-reversal-race-original`;
    await executeCellarTransferCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('transfer-reversal-race-original'),
      payload: transferPayload('reversal-race-original'),
      performedAt: new Date('2026-07-20T09:15:00.000Z'),
    });

    const outcomes = await Promise.allSettled([
      executeCellarTransferReversalCommand(prisma, {
        organizationId: orgId,
        commandId: `${runPrefix}-transfer-reversal-race`,
        actorUsername: username('transfer-reversal-race'),
        payload: {
          reversalId: `${runPrefix}-xfer-reversal-race`,
          originalCommandId,
          reason: 'Race-safe correction.',
        },
        performedAt: new Date('2026-07-20T09:16:00.000Z'),
      }),
      executeCellarTransferCommand(prisma, {
        organizationId: orgId,
        commandId: `${runPrefix}-transfer-dependent-race`,
        actorUsername: username('transfer-dependent-race'),
        payload: {
          ...transferPayload('dependent-race', 'T-3', 100),
          sourceVesselId: 'T-2',
          lossLiters: 1,
        },
        performedAt: new Date('2026-07-20T09:16:00.000Z'),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(['transfer_reversal_dependency_conflict', 'insufficient_source_volume'])
      .toContain(rejection.reason.code);
    expect(stored.version).toBe(3);
    expect(data.transfers).toHaveLength(2);
    expect(data.vessels.every((item: any) => item.currentVolume >= 0)).toBe(true);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });
});

describe('cellar.bottling PostgreSQL transaction', () => {
  function bottlingState(packagingStock = 500) {
    return {
      companyProfile: { currency: 'GEL' },
      lots: [{
        id: 'LOT-A',
        name: 'Integration Saperavi',
        vintage: 2025,
        variety: 'Saperavi',
        vineyardBlock: 'Block A',
        region: 'Kakheti',
        initialVolume: 200,
        currentVolume: 200,
        wineClass: 'red',
        stage: 'aging',
        createdAt: '2025-10-01',
        history: [],
      }],
      vessels: [{
        id: 'TANK-A',
        type: 'stainless_steel',
        shape: 'vertical',
        capacity: 300,
        currentVolume: 200,
        assignedLotId: 'LOT-A',
        cleaningStatus: 'clean',
        lastCleaned: '2026-07-01',
        temperature: 16,
        coolingJacketActive: false,
        targetTemperature: null,
        lastOperation: 'Filled',
      }],
      bottlingRuns: [],
      inventory: [{
        id: 'BOTTLE',
        name: 'Integration bottle',
        category: 'packaging',
        stock: packagingStock,
        minThreshold: 0,
        unit: 'unit',
        costPerUnit: 0.5,
        supplierName: 'Integration Glass',
      }],
      costEntries: [],
      storageLocations: [{
        id: 'STORE-A',
        name: 'Integration warehouse',
        type: 'warehouse',
        capacityBottles: 1_000,
      }],
      stockMovements: [],
    };
  }

  function bottlingPayload(suffix: string) {
    return {
      runId: `${runPrefix}-bot-${suffix}`,
      lotId: 'LOT-A',
      sourceVesselId: 'TANK-A',
      date: '2026-07-20',
      lotNumber: `PG-${suffix}`,
      operator: 'Integration Winemaker',
      formats: { '0.75': 100 },
      packagingSelections: { bottle: 'BOTTLE' },
      bottlesPerBox: 6,
      bottlingServiceCost: 25,
      storageLocationId: 'STORE-A',
    };
  }

  it('replays a racing duplicate without duplicating any bottling ledger effect', async () => {
    const orgId = organizationId('bottling-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Bottling Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: bottlingState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-bottling-duplicate`,
      actorUsername: username('bottling-duplicate'),
      payload: bottlingPayload('duplicate'),
      performedAt: new Date('2026-07-20T09:10:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeCellarBottlingCommand(prisma, input),
      executeCellarBottlingCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.bottlingRuns).toHaveLength(1);
    expect(data.lots[0].currentVolume).toBe(125);
    expect(data.vessels[0].currentVolume).toBe(125);
    expect(data.inventory[0].stock).toBe(400);
    expect(data.costEntries).toHaveLength(2);
    expect(data.stockMovements).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct bottling commands so packaging stock cannot be double-spent', async () => {
    const orgId = organizationId('bottling-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Bottling Serialization Estate' } });
    await prisma.organizationState.create({
      data: { organizationId: orgId, version: 1, data: bottlingState(150) },
    });
    const base = {
      organizationId: orgId,
      actorUsername: username('bottling-serialize'),
      performedAt: new Date('2026-07-20T09:15:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeCellarBottlingCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-bottling-serialize-a`,
        payload: bottlingPayload('serialize-a'),
      }),
      executeCellarBottlingCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-bottling-serialize-b`,
        payload: bottlingPayload('serialize-b'),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'insufficient_packaging_stock', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.bottlingRuns).toHaveLength(1);
    expect(data.lots[0].currentVolume).toBe(125);
    expect(data.vessels[0].currentVolume).toBe(125);
    expect(data.inventory[0].stock).toBe(50);
    expect(data.costEntries).toHaveLength(2);
    expect(data.stockMovements).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('replays a racing bottling correction without duplicating compensation', async () => {
    const orgId = organizationId('bottling-reversal-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Bottling Reversal Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: bottlingState() } });
    const originalCommandId = `${runPrefix}-bottling-reversal-original`;
    await executeCellarBottlingCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('bottling-reversal-original'),
      payload: bottlingPayload('reversal-original'),
      performedAt: new Date('2026-07-20T09:20:00.000Z'),
    });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-bottling-reversal-duplicate`,
      actorUsername: username('bottling-reversal-duplicate'),
      payload: {
        reversalRunId: `${runPrefix}-bot-reversal-duplicate`,
        storageReturnMovementId: `${runPrefix}-mov-bot-reversal-duplicate`,
        packagingCostReversalId: `${runPrefix}-cost-pack-reversal-duplicate`,
        serviceCostReversalId: `${runPrefix}-cost-service-reversal-duplicate`,
        originalCommandId,
        reason: 'Duplicate posting.',
      },
      performedAt: new Date('2026-07-21T09:20:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeBottlingReversalCommand(prisma, input),
      executeBottlingReversalCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;
    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(3);
    expect(data.bottlingRuns).toHaveLength(2);
    expect(data.lots[0]).toMatchObject({ currentVolume: 200, stage: 'aging' });
    expect(data.vessels[0]).toMatchObject({ currentVolume: 200, assignedLotId: 'LOT-A' });
    expect(data.inventory[0].stock).toBe(500);
    expect(data.costEntries).toHaveLength(4);
    expect(data.stockMovements).toHaveLength(2);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it('serializes distinct corrections so only one can compensate a bottling run', async () => {
    const orgId = organizationId('bottling-reversal-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Bottling Reversal Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: bottlingState() } });
    const originalCommandId = `${runPrefix}-bottling-reversal-serialize-original`;
    await executeCellarBottlingCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('bottling-reversal-serialize-original'),
      payload: bottlingPayload('reversal-serialize-original'),
      performedAt: new Date('2026-07-20T09:25:00.000Z'),
    });
    const reversal = (suffix: string) => ({
      organizationId: orgId,
      commandId: `${runPrefix}-bottling-reversal-serialize-${suffix}`,
      actorUsername: username('bottling-reversal-serialize'),
      payload: {
        reversalRunId: `${runPrefix}-bot-reversal-${suffix}`,
        storageReturnMovementId: `${runPrefix}-mov-bot-reversal-${suffix}`,
        packagingCostReversalId: `${runPrefix}-cost-pack-reversal-${suffix}`,
        serviceCostReversalId: `${runPrefix}-cost-service-reversal-${suffix}`,
        originalCommandId,
        reason: `Duplicate posting ${suffix}.`,
      },
      performedAt: new Date('2026-07-21T09:25:00.000Z'),
    });

    const outcomes = await Promise.allSettled([
      executeBottlingReversalCommand(prisma, reversal('a')),
      executeBottlingReversalCommand(prisma, reversal('b')),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'bottling_run_already_reversed', statusCode: 409 });
    expect(stored.version).toBe(3);
    expect(data.bottlingRuns).toHaveLength(2);
    expect(data.vessels[0]).toMatchObject({ currentVolume: 200, assignedLotId: 'LOT-A' });
    expect(data.inventory[0].stock).toBe(500);
    expect(data.costEntries).toHaveLength(4);
    expect(data.stockMovements).toHaveLength(2);
  });
});

describe('sales.stock PostgreSQL transaction', () => {
  function salesState() {
    return {
      companyProfile: { currency: 'GEL' },
      lots: [{
        id: 'LOT-A',
        name: 'Integration Saperavi',
        vintage: 2025,
        variety: 'Saperavi',
        vineyardBlock: 'Block A',
        region: 'Kakheti',
        initialVolume: 100,
        currentVolume: 0,
        wineClass: 'red',
        stage: 'bottled',
        createdAt: '2025-10-01',
        history: [],
      }],
      bottlingRuns: [{
        id: 'BOT-A',
        lotId: 'LOT-A',
        lotName: 'Integration Saperavi',
        date: '2026-07-01',
        lotNumber: 'BOT-A',
        operator: 'Integration Winemaker',
        formats: { '0.75': 100 },
        totalBottles: 100,
        totalCeramic: 0,
        volumeBottledL: 75,
      }],
      costEntries: [],
      storageLocations: [{ id: 'STORE-A', name: 'Integration warehouse', type: 'warehouse' }],
      stockMovements: [{
        id: 'IN-A',
        date: '2026-07-01',
        lotId: 'LOT-A',
        locationId: 'STORE-A',
        direction: 'in',
        bottles: 100,
      }],
      salesDispatches: [],
      salesOrders: [],
    };
  }

  function reservePayload(suffix: string, bottles = 60) {
    return {
      action: 'reserve',
      orderId: `${runPrefix}-so-${suffix}`,
      orderNumber: `SO-${suffix}`,
      orderDate: '2026-07-20',
      requestedDispatchDate: '',
      reservedUntil: '2099-07-25',
      customerName: `Integration Buyer ${suffix}`,
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles,
      pricePerBottle: 20,
      operator: 'Integration Owner',
      notes: '',
    };
  }

  it('replays a racing reservation duplicate without reserving stock twice', async () => {
    const orgId = organizationId('sales-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Sales Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: salesState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-sales-duplicate`,
      actorUsername: username('sales-duplicate'),
      payload: reservePayload('duplicate'),
      performedAt: new Date('2026-07-20T10:00:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeSalesStockCommand(prisma, input),
      executeSalesStockCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.salesOrders).toHaveLength(1);
    expect(data.salesOrders[0].bottles).toBe(60);
    expect(data.stockMovements).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct reservations so finished-goods stock cannot be oversubscribed', async () => {
    const orgId = organizationId('sales-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Sales Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: salesState() } });
    const base = {
      organizationId: orgId,
      actorUsername: username('sales-serialize'),
      performedAt: new Date('2026-07-20T10:05:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeSalesStockCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-sales-serialize-a`,
        payload: reservePayload('serialize-a'),
      }),
      executeSalesStockCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-sales-serialize-b`,
        payload: reservePayload('serialize-b'),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'insufficient_sellable_stock', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.salesOrders).toHaveLength(1);
    expect(data.salesOrders[0].bottles).toBe(60);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('replays a racing sales return without duplicating stock or financial compensation', async () => {
    const orgId = organizationId('sales-reversal-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Sales Reversal Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: salesState() } });
    const originalCommandId = `${runPrefix}-sales-reversal-original`;
    await executeSalesStockCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('sales-reversal-original'),
      payload: {
        action: 'dispatch', dispatchId: `${runPrefix}-sale-original`, date: '2026-07-20',
        customerName: 'Integration Buyer', lotId: 'LOT-A', locationId: 'STORE-A',
        bottles: 30, pricePerBottle: 20, operator: 'Integration Owner', notes: '',
      },
      performedAt: new Date('2026-07-20T10:10:00.000Z'),
    });
    const reversalInput = {
      organizationId: orgId,
      commandId: `${runPrefix}-sales-reversal-duplicate`,
      actorUsername: username('sales-reversal-duplicate'),
      payload: {
        reversalDispatchId: `${runPrefix}-sale-reversal`,
        returnMovementId: `${runPrefix}-move-sale-return`,
        originalCommandId,
        reason: 'Integration return.',
      },
      performedAt: new Date('2026-07-20T10:11:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeSalesStockReversalCommand(prisma, reversalInput),
      executeSalesStockReversalCommand(prisma, reversalInput),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(3);
    expect(data.salesDispatches).toHaveLength(2);
    expect(data.stockMovements).toHaveLength(3);
    expect(data.stockMovements.reduce((sum: number, movement: any) => (
      sum + (movement.direction === 'in' ? movement.bottles : -movement.bottles)
    ), 0)).toBe(100);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it('serializes distinct reversals so only one return can compensate a dispatch', async () => {
    const orgId = organizationId('sales-reversal-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Sales Reversal Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: salesState() } });
    const originalCommandId = `${runPrefix}-sales-reversal-serialize-original`;
    await executeSalesStockCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('sales-reversal-serialize-original'),
      payload: {
        action: 'dispatch', dispatchId: `${runPrefix}-sale-serialize-original`, date: '2026-07-20',
        customerName: 'Integration Buyer', lotId: 'LOT-A', locationId: 'STORE-A',
        bottles: 30, pricePerBottle: 20, operator: 'Integration Owner', notes: '',
      },
      performedAt: new Date('2026-07-20T10:15:00.000Z'),
    });
    const base = {
      organizationId: orgId,
      actorUsername: username('sales-reversal-serialize'),
      performedAt: new Date('2026-07-20T10:16:00.000Z'),
    };

    const outcomes = await Promise.allSettled(['a', 'b'].map(suffix => executeSalesStockReversalCommand(prisma, {
      ...base,
      commandId: `${runPrefix}-sales-reversal-serialize-${suffix}`,
      payload: {
        reversalDispatchId: `${runPrefix}-sale-reversal-${suffix}`,
        returnMovementId: `${runPrefix}-move-sale-return-${suffix}`,
        originalCommandId,
        reason: `Integration return ${suffix}.`,
      },
    })));
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'sales_dispatch_already_reversed', statusCode: 409 });
    expect(stored.version).toBe(3);
    expect(data.salesDispatches).toHaveLength(2);
    expect(data.stockMovements).toHaveLength(3);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });
});

describe('cellar.harvest-intake PostgreSQL transaction', () => {
  function intakeState() {
    return {
      companyProfile: { currency: 'GEL', region: 'Kakheti' },
      blocks: [{
        id: 'BLOCK-A',
        name: 'Integration Block',
        vineyardName: 'Integration Estate',
        cadastralCode: 'CAD-PG',
        municipality: 'Gurjaani',
        village: 'Mukuzani',
        microzone: 'Mukuzani',
        grapeVariety: 'Saperavi',
      }],
      harvests: [{
        id: 'HARVEST-A',
        blockId: 'BLOCK-A',
        variety: 'Saperavi',
        estimatedHarvestDate: '2026-09-15',
        estimatedTons: 1,
        pickingMethod: 'hand',
        grapeCondition: 'good',
        sentToGvino: false,
        notes: '',
      }],
      lots: [],
      vessels: [{
        id: 'T-1',
        type: 'stainless_steel',
        shape: 'vertical',
        capacity: 1_000,
        currentVolume: 0,
        assignedLotId: null,
        cleaningStatus: 'clean',
        lastCleaned: '2026-09-14',
        temperature: 18,
        coolingJacketActive: false,
        targetTemperature: null,
        lastOperation: 'Sanitized',
      }],
      grapeIntakes: [],
      costEntries: [],
      auditLogs: [],
    };
  }

  function intakePayload(suffix: string) {
    return {
      intakeId: `${runPrefix}-intake-${suffix}`,
      lotId: `${runPrefix}-lot-${suffix}`,
      auditId: `${runPrefix}-audit-intake-${suffix}`,
      intake: {
        date: '2026-09-15',
        source: 'own',
        blockId: 'BLOCK-A',
        variety: 'Saperavi',
        vintage: 2026,
        grossWeightKg: 1_100,
        tareWeightKg: 100,
        brix: 23.5,
        ph: 3.45,
        titratableAcidity: 6.1,
        temperatureC: 18,
        condition: 'good',
        pickingMethod: 'hand',
        wineClass: 'red',
        juiceYieldPct: 70,
        costPerKg: 2.5,
        totalCost: 2_500,
        grapePrice: 2.5,
        paymentStatus: 'unpaid',
        destinationVesselId: 'T-1',
        harvestRecordId: 'HARVEST-A',
        operator: 'Integration Owner',
        notes: '',
      },
    };
  }

  it('replays a racing duplicate without duplicating intake, lot, cost, audit, or physical effects', async () => {
    const orgId = organizationId('intake-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Intake Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: intakeState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-intake-duplicate`,
      actorUsername: username('intake-duplicate'),
      payload: intakePayload('duplicate'),
      performedAt: new Date('2026-09-15T09:00:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeHarvestIntakeCommand(prisma, input),
      executeHarvestIntakeCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.grapeIntakes).toHaveLength(1);
    expect(data.lots).toHaveLength(1);
    expect(data.costEntries).toHaveLength(1);
    expect(data.auditLogs).toHaveLength(1);
    expect(data.harvests[0]).toMatchObject({ sentToGvino: true, associatedLotId: input.payload.lotId });
    expect(data.vessels[0]).toMatchObject({ currentVolume: 700, assignedLotId: input.payload.lotId });
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct commands so one harvest cannot create two intakes', async () => {
    const orgId = organizationId('intake-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Intake Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: intakeState() } });
    const base = {
      organizationId: orgId,
      actorUsername: username('intake-serialize'),
      performedAt: new Date('2026-09-15T09:05:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeHarvestIntakeCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-intake-serialize-a`,
        payload: intakePayload('serialize-a'),
      }),
      executeHarvestIntakeCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-intake-serialize-b`,
        payload: intakePayload('serialize-b'),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'harvest_already_received', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.grapeIntakes).toHaveLength(1);
    expect(data.lots).toHaveLength(1);
    expect(data.costEntries).toHaveLength(1);
    expect(data.auditLogs).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes competing intake corrections so compensation is appended exactly once', async () => {
    const orgId = organizationId('intake-reversal-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Intake Reversal Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: intakeState() } });
    const originalCommandId = `${runPrefix}-intake-reversal-original`;
    await executeHarvestIntakeCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('intake-reversal-original'),
      payload: intakePayload('reversal-original'),
      performedAt: new Date('2026-09-15T09:00:00.000Z'),
    });

    const base = {
      organizationId: orgId,
      actorUsername: username('intake-reversal'),
      performedAt: new Date('2026-09-16T10:00:00.000Z'),
    };
    const outcomes = await Promise.allSettled(['a', 'b'].map(suffix => executeHarvestIntakeReversalCommand(prisma, {
      ...base,
      commandId: `${runPrefix}-intake-reversal-${suffix}`,
      payload: {
        reversalIntakeId: `${runPrefix}-intake-correction-${suffix}`,
        auditId: `${runPrefix}-audit-intake-correction-${suffix}`,
        costReversalId: `${runPrefix}-cost-intake-correction-${suffix}`,
        originalCommandId,
        reason: `Duplicate receipt ${suffix}.`,
      },
    })));
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'harvest_intake_already_reversed', statusCode: 409 });
    expect(stored.version).toBe(3);
    expect(data.grapeIntakes).toHaveLength(2);
    expect(data.costEntries).toHaveLength(2);
    expect(data.auditLogs).toHaveLength(2);
    expect(data.lots[0]).toMatchObject({ currentVolume: 0, voidedByCommandId: expect.any(String) });
    expect(data.harvests[0]).toMatchObject({ sentToGvino: false });
    expect(data.vessels[0]).toMatchObject({ currentVolume: 0, assignedLotId: null });
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });
});

describe('cellar.fermentation-complete PostgreSQL transaction', () => {
  function fermentationState() {
    return {
      lots: [{
        id: 'LOT-FERM-1', name: 'Integration Saperavi', vintage: 2026, variety: 'Saperavi',
        vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
        wineClass: 'red', stage: 'fermenting', createdAt: '2026-09-01', history: [],
      }],
      vessels: [{
        id: 'TANK-FERM-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
        currentVolume: 920, assignedLotId: 'LOT-FERM-1', cleaningStatus: 'clean',
        lastCleaned: '2026-08-31', temperature: 20.5, coolingJacketActive: true,
        targetTemperature: 20, lastOperation: 'Final reading recorded',
      }],
      fermlogs: [{
        id: 'FLOG-FINAL-1', tankId: 'TANK-FERM-1', lotId: 'LOT-FERM-1', date: '2026-09-14',
        temperature: 20.5, density: 0.996, sugar: 2, ph: 3.48,
        tastingNotes: 'Dry and clean', capManagement: 'None', additives: 'None',
      }],
      auditLogs: [],
    };
  }

  function fermentationPayload(suffix: string) {
    return {
      lotId: 'LOT-FERM-1',
      vesselId: 'TANK-FERM-1',
      finalLogId: 'FLOG-FINAL-1',
      auditId: `${runPrefix}-audit-fermentation-${suffix}`,
      operator: 'Integration Winemaker',
    };
  }

  it('replays a racing duplicate without duplicating final reading, history, or audit evidence', async () => {
    const orgId = organizationId('fermentation-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Fermentation Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: fermentationState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-fermentation-duplicate`,
      actorUsername: username('fermentation-duplicate'),
      payload: fermentationPayload('duplicate'),
      performedAt: new Date('2026-09-14T16:30:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeFermentationCompletionCommand(prisma, input),
      executeFermentationCompletionCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.lots[0]).toMatchObject({ stage: 'stabilization', history: [expect.any(Object)] });
    expect(data.fermlogs).toHaveLength(1);
    expect(data.fermlogs[0]).toMatchObject({ isCompletion: true, commandId: input.commandId });
    expect(data.auditLogs).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct commands so one fermentation cannot complete twice', async () => {
    const orgId = organizationId('fermentation-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Fermentation Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: fermentationState() } });
    const base = {
      organizationId: orgId,
      actorUsername: username('fermentation-serialize'),
      performedAt: new Date('2026-09-14T16:35:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeFermentationCompletionCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-fermentation-serialize-a`,
        payload: fermentationPayload('serialize-a'),
      }),
      executeFermentationCompletionCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-fermentation-serialize-b`,
        payload: fermentationPayload('serialize-b'),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'fermentation_already_completed', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.lots[0].history).toHaveLength(1);
    expect(data.fermlogs).toHaveLength(1);
    expect(data.auditLogs).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes competing completion reversals so only one correction is appended', async () => {
    const orgId = organizationId('fermentation-reversal-race');
    await prisma.organization.create({ data: { id: orgId, name: 'Fermentation Reversal Race Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: fermentationState() } });
    const originalCommandId = `${runPrefix}-fermentation-reversal-original`;
    await executeFermentationCompletionCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('fermentation-reversal-race'),
      payload: fermentationPayload('reversal-original'),
      performedAt: new Date('2026-09-14T16:30:00.000Z'),
    });

    const outcomes = await Promise.allSettled(['a', 'b'].map(suffix => (
      executeFermentationCompletionReversalCommand(prisma, {
        organizationId: orgId,
        commandId: `${runPrefix}-fermentation-reversal-${suffix}`,
        actorUsername: username('fermentation-reversal-race'),
        payload: {
          reversalLogId: `${runPrefix}-ferm-correction-${suffix}`,
          auditId: `${runPrefix}-audit-ferm-correction-${suffix}`,
          originalCommandId,
          reason: `Completion was premature ${suffix}.`,
        },
        performedAt: new Date('2026-09-15T09:00:00.000Z'),
      })
    )));
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'fermentation_completion_already_reversed', statusCode: 409 });
    expect(stored.version).toBe(3);
    expect(data.lots[0]).toMatchObject({ stage: 'fermenting', lastCommandId: expect.any(String) });
    expect(data.fermlogs).toHaveLength(2);
    expect(data.fermlogs.filter((log: any) => log.recordKind === 'reversal')).toHaveLength(1);
    expect(data.auditLogs).toHaveLength(2);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });
});

describe('cellar.operation PostgreSQL transaction', () => {
  function operationState() {
    return {
      companyProfile: { currency: 'USD' },
      lots: [{
        id: 'LOT-CELLAR-1', name: 'Integration Saperavi', vintage: 2026, variety: 'Saperavi',
        vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 1_000, currentVolume: 920,
        wineClass: 'red', stage: 'aging', createdAt: '2026-09-01', history: [],
      }],
      vessels: [{
        id: 'TANK-CELLAR-1', type: 'stainless_steel', shape: 'vertical', capacity: 1_200,
        currentVolume: 920, assignedLotId: 'LOT-CELLAR-1', cleaningStatus: 'clean',
        lastCleaned: '2026-09-01', temperature: 16, coolingJacketActive: false,
        targetTemperature: null, lastOperation: 'Filled',
      }],
      inventory: [{
        id: 'INV-SO2', name: 'Potassium metabisulfite', category: 'additives', stock: 5,
        minThreshold: 1, unit: 'kg', costPerUnit: 20, supplierName: 'Integration Enology',
      }],
      cellarOps: [],
      costEntries: [],
      auditLogs: [],
    };
  }

  function operationPayload(suffix: string, dose = 0.2) {
    return {
      operationId: `${runPrefix}-operation-${suffix}`,
      auditId: `${runPrefix}-audit-operation-${suffix}`,
      operation: {
        date: '2026-09-10', type: 'sulfitation', lotId: 'LOT-CELLAR-1',
        vesselId: 'TANK-CELLAR-1', vesselToId: null, materialId: 'INV-SO2', dose,
        operator: 'Integration Winemaker', notes: 'Protection dose.',
      },
    };
  }

  it('replays a racing duplicate without deducting material or posting cost twice', async () => {
    const orgId = organizationId('operation-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Operation Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: operationState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-operation-duplicate`,
      actorUsername: username('operation-duplicate'),
      payload: operationPayload('duplicate'),
      performedAt: new Date('2026-09-10T11:15:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeCellarOperationCommand(prisma, input),
      executeCellarOperationCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.inventory[0].stock).toBe(4.8);
    expect(data.cellarOps).toHaveLength(1);
    expect(data.costEntries).toHaveLength(1);
    expect(data.auditLogs).toHaveLength(1);
    expect(data.lots[0].history).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct material commands so inventory cannot be overdrawn', async () => {
    const orgId = organizationId('operation-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Operation Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: operationState() } });
    const base = {
      organizationId: orgId,
      actorUsername: username('operation-serialize'),
      performedAt: new Date('2026-09-10T11:20:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeCellarOperationCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-operation-serialize-a`,
        payload: operationPayload('serialize-a', 3),
      }),
      executeCellarOperationCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-operation-serialize-b`,
        payload: operationPayload('serialize-b', 3),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'insufficient_operation_material', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.inventory[0].stock).toBe(2);
    expect(data.cellarOps).toHaveLength(1);
    expect(data.costEntries).toHaveLength(1);
    expect(data.auditLogs).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('replays a racing operation correction without duplicating compensation', async () => {
    const orgId = organizationId('operation-reversal-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Operation Reversal Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: operationState() } });
    const originalCommandId = `${runPrefix}-operation-reversal-original`;
    await executeCellarOperationCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('operation-reversal-original'),
      payload: operationPayload('reversal-original'),
      performedAt: new Date('2026-09-10T11:25:00.000Z'),
    });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-operation-reversal-duplicate`,
      actorUsername: username('operation-reversal-duplicate'),
      payload: {
        reversalOperationId: `${runPrefix}-operation-reversal-duplicate`,
        auditId: `${runPrefix}-audit-operation-reversal-duplicate`,
        costReversalId: `${runPrefix}-cost-operation-reversal-duplicate`,
        originalCommandId,
        reason: 'Wrong lot selected.',
      },
      performedAt: new Date('2026-09-11T09:00:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeCellarOperationReversalCommand(prisma, input),
      executeCellarOperationReversalCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;
    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(3);
    expect(data.inventory[0].stock).toBe(5);
    expect(data.vessels[0]).toMatchObject({ currentVolume: 920, lastOperation: 'Filled' });
    expect(data.cellarOps).toHaveLength(2);
    expect(data.costEntries).toHaveLength(2);
    expect(data.auditLogs).toHaveLength(2);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it('serializes distinct corrections so only one can compensate an operation', async () => {
    const orgId = organizationId('operation-reversal-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Operation Reversal Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: operationState() } });
    const originalCommandId = `${runPrefix}-operation-reversal-serialize-original`;
    await executeCellarOperationCommand(prisma, {
      organizationId: orgId,
      commandId: originalCommandId,
      actorUsername: username('operation-reversal-serialize-original'),
      payload: operationPayload('reversal-serialize-original'),
      performedAt: new Date('2026-09-10T11:30:00.000Z'),
    });
    const reversal = (suffix: string) => ({
      organizationId: orgId,
      commandId: `${runPrefix}-operation-reversal-serialize-${suffix}`,
      actorUsername: username('operation-reversal-serialize'),
      payload: {
        reversalOperationId: `${runPrefix}-operation-reversal-${suffix}`,
        auditId: `${runPrefix}-audit-operation-reversal-${suffix}`,
        costReversalId: `${runPrefix}-cost-operation-reversal-${suffix}`,
        originalCommandId,
        reason: `Wrong lot selected ${suffix}.`,
      },
      performedAt: new Date('2026-09-11T09:05:00.000Z'),
    });

    const outcomes = await Promise.allSettled([
      executeCellarOperationReversalCommand(prisma, reversal('a')),
      executeCellarOperationReversalCommand(prisma, reversal('b')),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'cellar_operation_already_reversed', statusCode: 409 });
    expect(stored.version).toBe(3);
    expect(data.inventory[0].stock).toBe(5);
    expect(data.cellarOps).toHaveLength(2);
    expect(data.costEntries).toHaveLength(2);
    expect(data.auditLogs).toHaveLength(2);
  });
});

describe('storage.movement PostgreSQL transaction', () => {
  function storageState() {
    return {
      lots: [{
        id: 'LOT-A', name: 'Integration Saperavi', vintage: 2026, variety: 'Saperavi',
        vineyardBlock: 'Block A', region: 'Kakheti', initialVolume: 75, currentVolume: 0,
        wineClass: 'red', stage: 'bottled', createdAt: '2026-09-01', history: [],
      }],
      bottlingRuns: [{
        id: 'RUN-A', lotId: 'LOT-A', lotName: 'Integration Saperavi', date: '2026-10-01',
        lotNumber: 'SAP-26', operator: 'Integration Winemaker', formats: { '0.75': 100 },
        totalBottles: 100, totalCeramic: 0, volumeBottledL: 75,
      }],
      storageLocations: [{
        id: 'STORE-A', name: 'Integration warehouse', type: 'warehouse', capacityBottles: 100,
      }],
      stockMovements: [],
      salesOrders: [],
    };
  }

  function receivePayload(suffix: string, bottles = 60) {
    return {
      action: 'receive',
      movementId: `${runPrefix}-storage-movement-${suffix}`,
      bottlingRunId: 'RUN-A',
      date: '2026-10-02',
      lotId: 'LOT-A',
      locationId: 'STORE-A',
      bottles,
      note: '',
    };
  }

  it('replays a racing duplicate without duplicating movement or run placement evidence', async () => {
    const orgId = organizationId('storage-duplicate');
    await prisma.organization.create({ data: { id: orgId, name: 'Storage Duplicate Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: storageState() } });
    const input = {
      organizationId: orgId,
      commandId: `${runPrefix}-storage-duplicate`,
      actorUsername: username('storage-duplicate'),
      payload: receivePayload('duplicate'),
      performedAt: new Date('2026-10-02T09:00:00.000Z'),
    };

    const outcomes = await Promise.all([
      executeStorageMovementCommand(prisma, input),
      executeStorageMovementCommand(prisma, input),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.map(outcome => outcome.disposition).sort()).toEqual(['executed', 'replayed']);
    expect(stored.version).toBe(2);
    expect(data.stockMovements).toHaveLength(1);
    expect(data.bottlingRuns[0].storagePlacements).toHaveLength(1);
    expect(data.bottlingRuns[0].placedInStorageBottles).toBe(60);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('serializes distinct receipts so one bottling run cannot be placed twice', async () => {
    const orgId = organizationId('storage-serialize');
    await prisma.organization.create({ data: { id: orgId, name: 'Storage Serialization Estate' } });
    await prisma.organizationState.create({ data: { organizationId: orgId, version: 1, data: storageState() } });
    const base = {
      organizationId: orgId,
      actorUsername: username('storage-serialize'),
      performedAt: new Date('2026-10-02T09:05:00.000Z'),
    };

    const outcomes = await Promise.allSettled([
      executeStorageMovementCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-storage-serialize-a`,
        payload: receivePayload('serialize-a'),
      }),
      executeStorageMovementCommand(prisma, {
        ...base,
        commandId: `${runPrefix}-storage-serialize-b`,
        payload: receivePayload('serialize-b'),
      }),
    ]);
    const stored = await prisma.organizationState.findUniqueOrThrow({ where: { organizationId: orgId } });
    const data = stored.data as any;

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: 'storage_bottling_run_fully_placed', statusCode: 409 });
    expect(stored.version).toBe(2);
    expect(data.stockMovements).toHaveLength(1);
    expect(data.bottlingRuns[0].storagePlacements).toHaveLength(1);
    expect(await prisma.commandExecution.count({ where: { organizationId: orgId } })).toBe(1);
  });
});
