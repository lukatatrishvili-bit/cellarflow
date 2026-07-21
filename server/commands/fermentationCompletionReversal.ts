import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyFermentationCompletionReversalCommand,
  FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE,
  FermentationCompletionReversalCommandError,
  type FermentationCompletionReversalCommandResult,
} from '../../lib/commands/fermentationCompletionReversal';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteFermentationCompletionReversalInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Reopen a completed fermentation and append its correction evidence under one organization row lock. */
export async function executeFermentationCompletionReversalCommand(
  prisma: PrismaClient,
  input: ExecuteFermentationCompletionReversalInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE,
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
        throw new FermentationCompletionReversalCommandError(
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
      const applied = applyFermentationCompletionReversalCommand(
        {
          lots: list('lots'),
          vessels: list('vessels'),
          fermlogs: list('fermlogs'),
          auditLogs: list('auditLogs'),
          cellarOps: list('cellarOps'),
          transfers: list('transfers'),
          bottlingRuns: list('bottlingRuns'),
          certificationRecords: list('certificationRecords'),
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
            lots: applied.state.lots,
            vessels: applied.state.vessels,
            fermlogs: applied.state.fermlogs,
            auditLogs: applied.state.auditLogs,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${FERMENTATION_COMPLETION_REVERSAL_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return { ...applied.result, stateVersion: updated.version } as unknown as Prisma.JsonValue;
    },
  );
}

export function fermentationCompletionReversalCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): FermentationCompletionReversalCommandResult {
  return outcome.result as unknown as FermentationCompletionReversalCommandResult;
}
