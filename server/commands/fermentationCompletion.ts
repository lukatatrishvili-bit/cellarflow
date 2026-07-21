import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyFermentationCompletionCommand,
  FERMENTATION_COMPLETION_COMMAND_TYPE,
  FermentationCompletionCommandError,
  type FermentationCompletionCommandResult,
} from '../../lib/commands/fermentationCompletion';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteFermentationCompletionInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Complete one fermentation while holding the organization's authoritative state row. */
export async function executeFermentationCompletionCommand(
  prisma: PrismaClient,
  input: ExecuteFermentationCompletionInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: FERMENTATION_COMPLETION_COMMAND_TYPE,
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
        throw new FermentationCompletionCommandError(
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
      const applied = applyFermentationCompletionCommand(
        {
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          vessels: Array.isArray(storedData.vessels) ? storedData.vessels as any[] : [],
          fermlogs: Array.isArray(storedData.fermlogs) ? storedData.fermlogs as any[] : [],
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
          updatedBy: `command:${FERMENTATION_COMPLETION_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function fermentationCompletionCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): FermentationCompletionCommandResult {
  return outcome.result as unknown as FermentationCompletionCommandResult;
}
