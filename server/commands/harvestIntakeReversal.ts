import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyHarvestIntakeReversalCommand,
  HARVEST_INTAKE_REVERSAL_COMMAND_TYPE,
  HarvestIntakeReversalCommandError,
  type HarvestIntakeReversalCommandResult,
} from '../../lib/commands/harvestIntakeReversal';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteHarvestIntakeReversalInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Compensate receiving and its linked harvest, lot, vessel, cost, and audit ledgers under one row lock. */
export async function executeHarvestIntakeReversalCommand(
  prisma: PrismaClient,
  input: ExecuteHarvestIntakeReversalInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: HARVEST_INTAKE_REVERSAL_COMMAND_TYPE,
      actorUsername: input.actorUsername,
      payload: input.payload,
    },
    async (transaction) => {
      const lockedState = await transaction.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
        SELECT "organizationId"
        FROM "OrganizationState"
        WHERE "organizationId" = ${input.organizationId}
        FOR UPDATE
      `);
      if (lockedState.length === 0) {
        throw new HarvestIntakeReversalCommandError(
          'organization_state_not_found',
          'Organization state was not found for this command.',
          404,
        );
      }

      const stored = await transaction.organizationState.findUniqueOrThrow({
        where: { organizationId: input.organizationId },
      });
      const storedData = stored.data && typeof stored.data === 'object' && !Array.isArray(stored.data)
        ? stored.data as Record<string, unknown>
        : {};
      const list = (key: string): any[] => Array.isArray(storedData[key]) ? storedData[key] as any[] : [];
      const applied = applyHarvestIntakeReversalCommand(
        {
          harvests: list('harvests'),
          lots: list('lots'),
          vessels: list('vessels'),
          grapeIntakes: list('grapeIntakes'),
          costEntries: list('costEntries'),
          auditLogs: list('auditLogs'),
          cellarOps: list('cellarOps'),
          fermLogs: list('fermlogs'),
          labLogs: list('lablogs'),
          transfers: list('transfers'),
          bottlingRuns: list('bottlingRuns'),
          certificationRecords: list('certificationRecords'),
          stockMovements: list('stockMovements'),
          salesOrders: list('salesOrders'),
          salesDispatches: list('salesDispatches'),
          attachments: list('attachments'),
        },
        input.payload,
        {
          commandId: validateCommandId(input.commandId),
          actorUsername: input.actorUsername,
          performedAt: input.performedAt || new Date(),
        },
      );
      const updated = await transaction.organizationState.update({
        where: { organizationId: input.organizationId },
        data: {
          data: {
            ...storedData,
            harvests: applied.state.harvests,
            lots: applied.state.lots,
            vessels: applied.state.vessels,
            grapeIntakes: applied.state.grapeIntakes,
            costEntries: applied.state.costEntries,
            auditLogs: applied.state.auditLogs,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${HARVEST_INTAKE_REVERSAL_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return { ...applied.result, stateVersion: updated.version } as unknown as Prisma.JsonValue;
    },
  );
}

export function harvestIntakeReversalCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): HarvestIntakeReversalCommandResult {
  return outcome.result as unknown as HarvestIntakeReversalCommandResult;
}
