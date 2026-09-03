import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyCellarOperationReversalCommand,
  CELLAR_OPERATION_REVERSAL_COMMAND_TYPE,
  CellarOperationReversalCommandError,
  type CellarOperationReversalCommandResult,
} from '../../lib/commands/cellarOperationReversal';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteCellarOperationReversalInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Compensate an operation and every linked ledger under one organization row lock. */
export async function executeCellarOperationReversalCommand(
  prisma: PrismaClient,
  input: ExecuteCellarOperationReversalInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: CELLAR_OPERATION_REVERSAL_COMMAND_TYPE,
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
        throw new CellarOperationReversalCommandError(
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
      const applied = applyCellarOperationReversalCommand(
        {
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          vessels: Array.isArray(storedData.vessels) ? storedData.vessels as any[] : [],
          inventory: Array.isArray(storedData.inventory) ? storedData.inventory as any[] : [],
          cellarOps: Array.isArray(storedData.cellarOps) ? storedData.cellarOps as any[] : [],
          costEntries: Array.isArray(storedData.costEntries) ? storedData.costEntries as any[] : [],
          auditLogs: Array.isArray(storedData.auditLogs) ? storedData.auditLogs as any[] : [],
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
            ...applied.state,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${CELLAR_OPERATION_REVERSAL_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function cellarOperationReversalCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): CellarOperationReversalCommandResult {
  return outcome.result as unknown as CellarOperationReversalCommandResult;
}
