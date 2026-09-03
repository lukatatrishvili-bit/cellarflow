import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;
const COMMAND_TYPE_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/;

export type CommandErrorCode =
  | 'invalid_command_id'
  | 'invalid_command_type'
  | 'invalid_command_payload'
  | 'invalid_command_result'
  | 'idempotency_key_reused'
  | 'command_in_progress';

export class CommandContractError extends Error {
  constructor(
    public readonly code: CommandErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'CommandContractError';
  }
}

export interface IdempotentCommandInput {
  organizationId: string;
  commandId: string;
  commandType: string;
  actorUsername: string;
  payload: unknown;
}

export interface IdempotentCommandOutcome<TResult extends Prisma.JsonValue = Prisma.JsonValue> {
  disposition: 'executed' | 'replayed';
  commandId: string;
  commandType: string;
  result: TResult;
  completedAt: Date;
}

function invalidJsonValue(kind: 'payload' | 'result', path: string): never {
  const code = kind === 'payload' ? 'invalid_command_payload' : 'invalid_command_result';
  const statusCode = kind === 'payload' ? 400 : 500;
  throw new CommandContractError(code, `Command ${kind} contains a non-JSON value at ${path}.`, statusCode);
}

function normalizeJson(value: unknown, kind: 'payload' | 'result', path = '$'): Prisma.JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidJsonValue(kind, path);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJson(item, kind, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalidJsonValue(kind, path);

    const normalized: Prisma.JsonObject = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      normalized[key] = normalizeJson((value as Record<string, unknown>)[key], kind, `${path}.${key}`);
    }
    return normalized;
  }
  return invalidJsonValue(kind, path);
}

export function validateCommandId(commandId: string): string {
  const normalized = commandId.trim();
  if (!COMMAND_ID_PATTERN.test(normalized)) {
    throw new CommandContractError(
      'invalid_command_id',
      'Command id must be 8-128 characters using letters, numbers, colon, underscore, or hyphen.',
      400,
    );
  }
  return normalized;
}

export function validateCommandType(commandType: string): string {
  const normalized = commandType.trim();
  if (!COMMAND_TYPE_PATTERN.test(normalized)) {
    throw new CommandContractError(
      'invalid_command_type',
      'Command type must be 3-64 lowercase characters using letters, numbers, dot, underscore, or hyphen.',
      400,
    );
  }
  return normalized;
}

export function commandRequestHash(commandType: string, payload: unknown): string {
  const normalizedType = validateCommandType(commandType);
  const normalizedPayload = normalizeJson(payload, 'payload');
  return createHash('sha256')
    .update(JSON.stringify({ commandType: normalizedType, payload: normalizedPayload }))
    .digest('hex');
}

function assertReusableClaim(
  existing: { commandType: string; requestHash: string; status: string },
  commandType: string,
  requestHash: string,
): void {
  if (existing.commandType !== commandType || existing.requestHash !== requestHash) {
    throw new CommandContractError(
      'idempotency_key_reused',
      'This command id was already used with a different command type or payload.',
      409,
    );
  }
  if (existing.status !== 'completed') {
    throw new CommandContractError(
      'command_in_progress',
      'This command is still in progress. Retry the same command id and payload.',
      409,
      true,
    );
  }
}

/**
 * Claims and executes one organization-scoped command. The callback must make
 * every domain write through the supplied transaction client. If it throws,
 * PostgreSQL rolls back both those writes and the idempotency claim.
 */
export async function executeIdempotentCommand<TResult extends Prisma.JsonValue>(
  prisma: PrismaClient,
  input: IdempotentCommandInput,
  execute: (transaction: Prisma.TransactionClient) => Promise<TResult>,
): Promise<IdempotentCommandOutcome<TResult>> {
  const commandId = validateCommandId(input.commandId);
  const commandType = validateCommandType(input.commandType);
  const organizationId = input.organizationId.trim();
  const actorUsername = input.actorUsername.trim();
  if (!organizationId || !actorUsername) {
    throw new CommandContractError('invalid_command_payload', 'Command organization and actor are required.', 400);
  }
  const requestHash = commandRequestHash(commandType, input.payload);

  return prisma.$transaction(async (transaction) => {
    // PostgreSQL unique violations abort the current transaction, even when
    // application code catches them. skipDuplicates maps to ON CONFLICT DO
    // NOTHING, so a racing replay can safely read the winner in this same
    // transaction after the insert statement waits for it to commit.
    const claim = await transaction.commandExecution.createMany({
      data: {
        organizationId,
        commandId,
        commandType,
        actorUsername,
        requestHash,
        status: 'pending',
      },
      skipDuplicates: true,
    });
    if (claim.count === 0) {
      const existing = await transaction.commandExecution.findUnique({
        where: { organizationId_commandId: { organizationId, commandId } },
      });
      if (!existing) {
        throw new CommandContractError(
          'command_in_progress',
          'The command claim could not be read yet. Retry the same command id and payload.',
          409,
          true,
        );
      }
      assertReusableClaim(existing, commandType, requestHash);
      return {
        disposition: 'replayed' as const,
        commandId,
        commandType,
        result: existing.result as TResult,
        completedAt: existing.completedAt || existing.updatedAt,
      };
    }

    const result = normalizeJson(await execute(transaction), 'result') as TResult;
    const completedAt = new Date();
    await transaction.commandExecution.update({
      where: { organizationId_commandId: { organizationId, commandId } },
      data: {
        status: 'completed',
        result: result as Prisma.InputJsonValue,
        completedAt,
      },
    });

    return {
      disposition: 'executed' as const,
      commandId,
      commandType,
      result,
      completedAt,
    };
  });
}
