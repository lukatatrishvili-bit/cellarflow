import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applySalesStockCommand,
  SALES_STOCK_COMMAND_TYPE,
  SalesStockCommandError,
  type SalesStockCommandResult,
} from '../../lib/commands/salesStock';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteSalesStockInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Execute a reservation, dispatch, fulfillment, or cancellation under one winery row lock. */
export async function executeSalesStockCommand(
  prisma: PrismaClient,
  input: ExecuteSalesStockInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: SALES_STOCK_COMMAND_TYPE,
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
        throw new SalesStockCommandError(
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
      const profile = storedData.companyProfile && typeof storedData.companyProfile === 'object'
        && !Array.isArray(storedData.companyProfile)
        ? storedData.companyProfile as Record<string, unknown>
        : {};
      const currency = typeof profile.currency === 'string' && profile.currency.trim()
        ? profile.currency.trim().slice(0, 12)
        : 'GEL';
      const applied = applySalesStockCommand(
        {
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          bottlingRuns: Array.isArray(storedData.bottlingRuns) ? storedData.bottlingRuns as any[] : [],
          costEntries: Array.isArray(storedData.costEntries) ? storedData.costEntries as any[] : [],
          storageLocations: Array.isArray(storedData.storageLocations) ? storedData.storageLocations as any[] : [],
          stockMovements: Array.isArray(storedData.stockMovements) ? storedData.stockMovements as any[] : [],
          salesDispatches: Array.isArray(storedData.salesDispatches) ? storedData.salesDispatches as any[] : [],
          salesOrders: Array.isArray(storedData.salesOrders) ? storedData.salesOrders as any[] : [],
        },
        input.payload,
        {
          commandId: validateCommandId(input.commandId),
          actorUsername: input.actorUsername,
          currency,
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
          updatedBy: `command:${SALES_STOCK_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function salesStockCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): SalesStockCommandResult {
  return outcome.result as unknown as SalesStockCommandResult;
}
