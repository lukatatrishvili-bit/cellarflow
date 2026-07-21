import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyTransferCommand,
  TRANSFER_COMMAND_TYPE,
  TransferCommandError,
  type TransferCommandResult,
} from '../../lib/commands/transfer';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteCellarTransferInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Execute and version one transfer while holding the organization's state row. */
export async function executeCellarTransferCommand(
  prisma: PrismaClient,
  input: ExecuteCellarTransferInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: TRANSFER_COMMAND_TYPE,
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
        throw new TransferCommandError(
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
      const applied = applyTransferCommand(
        {
          vessels: Array.isArray(storedData.vessels) ? storedData.vessels as any[] : [],
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          transfers: Array.isArray(storedData.transfers) ? storedData.transfers as any[] : [],
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
          updatedBy: `command:${TRANSFER_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function transferCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): TransferCommandResult {
  return outcome.result as unknown as TransferCommandResult;
}
