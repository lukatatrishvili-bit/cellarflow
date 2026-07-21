import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyStorageMovementCommand,
  STORAGE_MOVEMENT_COMMAND_TYPE,
  StorageMovementCommandError,
  type StorageMovementCommandResult,
} from '../../lib/commands/storageMovement';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteStorageMovementInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Execute one finished-goods movement while holding the organization state row. */
export async function executeStorageMovementCommand(
  prisma: PrismaClient,
  input: ExecuteStorageMovementInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: STORAGE_MOVEMENT_COMMAND_TYPE,
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
        throw new StorageMovementCommandError(
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
      const applied = applyStorageMovementCommand(
        {
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          bottlingRuns: Array.isArray(storedData.bottlingRuns) ? storedData.bottlingRuns as any[] : [],
          storageLocations: Array.isArray(storedData.storageLocations) ? storedData.storageLocations as any[] : [],
          stockMovements: Array.isArray(storedData.stockMovements) ? storedData.stockMovements as any[] : [],
          salesOrders: Array.isArray(storedData.salesOrders) ? storedData.salesOrders as any[] : [],
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
            bottlingRuns: applied.state.bottlingRuns,
            stockMovements: applied.state.stockMovements,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${STORAGE_MOVEMENT_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function storageMovementCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): StorageMovementCommandResult {
  return outcome.result as unknown as StorageMovementCommandResult;
}
