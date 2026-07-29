import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyHarvestIntakeCommand,
  HARVEST_INTAKE_COMMAND_TYPE,
  HarvestIntakeCommandError,
  type HarvestIntakeCommandResult,
} from '../../lib/commands/harvestIntake';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

export interface ExecuteHarvestIntakeInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

/** Commit grape receiving and every requested linked ledger under one organization-state lock. */
export async function executeHarvestIntakeCommand(
  prisma: PrismaClient,
  input: ExecuteHarvestIntakeInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: HARVEST_INTAKE_COMMAND_TYPE,
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
        throw new HarvestIntakeCommandError(
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
      const region = typeof profile.region === 'string' && profile.region.trim()
        ? profile.region.trim().slice(0, 180)
        : 'Kakheti';
      const applied = applyHarvestIntakeCommand(
        {
          blocks: Array.isArray(storedData.blocks) ? storedData.blocks as any[] : [],
          harvests: Array.isArray(storedData.harvests) ? storedData.harvests as any[] : [],
          lots: Array.isArray(storedData.lots) ? storedData.lots as any[] : [],
          vessels: Array.isArray(storedData.vessels) ? storedData.vessels as any[] : [],
          grapeIntakes: Array.isArray(storedData.grapeIntakes) ? storedData.grapeIntakes as any[] : [],
          costEntries: Array.isArray(storedData.costEntries) ? storedData.costEntries as any[] : [],
          auditLogs: Array.isArray(storedData.auditLogs) ? storedData.auditLogs as any[] : [],
        },
        input.payload,
        {
          commandId: validateCommandId(input.commandId),
          actorUsername: input.actorUsername,
          currency,
          region,
          costAutomation: profile.costAutomation,
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
          updatedBy: `command:${HARVEST_INTAKE_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return {
        ...applied.result,
        stateVersion: updated.version,
      } as unknown as Prisma.JsonValue;
    },
  );
}

export function harvestIntakeCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): HarvestIntakeCommandResult {
  return outcome.result as unknown as HarvestIntakeCommandResult;
}
