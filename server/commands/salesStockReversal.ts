import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applySalesStockReversalCommand,
  SALES_STOCK_REVERSAL_COMMAND_TYPE,
  SalesStockReversalCommandError,
  type SalesStockReversalCommandResult,
} from '../../lib/commands/salesStockReversal';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteSalesStockReversalInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Return stock and compensate the sales ledger under the organization row lock. */
export async function executeSalesStockReversalCommand(
  prisma: PrismaClient,
  input: ExecuteSalesStockReversalInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: SALES_STOCK_REVERSAL_COMMAND_TYPE,
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
        throw new SalesStockReversalCommandError(
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
      const applied = applySalesStockReversalCommand(
        {
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          storageLocations: Array.isArray(storedData.storageLocations) ? storedData.storageLocations as any[] : [],
          stockMovements: Array.isArray(storedData.stockMovements) ? storedData.stockMovements as any[] : [],
          salesDispatches: Array.isArray(storedData.salesDispatches) ? storedData.salesDispatches as any[] : [],
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
            ...applied.state,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${SALES_STOCK_REVERSAL_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function salesStockReversalCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): SalesStockReversalCommandResult {
  return outcome.result as unknown as SalesStockReversalCommandResult;
}
