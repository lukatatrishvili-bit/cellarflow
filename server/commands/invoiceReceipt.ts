import { Prisma, type PrismaClient } from '@prisma/client';
import {
  applyInvoiceReceiptCommand,
  applyInvoiceReceiptReversalCommand,
  INVOICE_RECEIPT_COMMAND_TYPE,
  INVOICE_RECEIPT_REVERSAL_COMMAND_TYPE,
  InvoiceReceiptCommandError,
  type InvoiceReceiptCommandResult,
  type InvoiceReceiptReversalCommandResult,
} from '../../lib/commands/invoiceReceipt';
import {
  executeIdempotentCommand,
  validateCommandId,
  type IdempotentCommandOutcome,
} from '../idempotentCommands';

interface ExecuteInvoiceCommandInput {
  organizationId: string;
  commandId: string;
  actorUsername: string;
  payload: unknown;
  performedAt?: Date;
}

async function lockedOrganizationState(
  transaction: Prisma.TransactionClient,
  organizationId: string,
): Promise<{ storedData: Record<string, unknown> }> {
  const lockedState = await transaction.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
    SELECT "organizationId"
    FROM "OrganizationState"
    WHERE "organizationId" = ${organizationId}
    FOR UPDATE
  `);
  if (lockedState.length === 0) {
    throw new InvoiceReceiptCommandError(
      'organization_state_not_found',
      'Organization state was not found for this command.',
      404,
    );
  }
  const stored = await transaction.organizationState.findUniqueOrThrow({
    where: { organizationId },
  });
  return {
    storedData: stored.data && typeof stored.data === 'object' && !Array.isArray(stored.data)
      ? stored.data as Record<string, unknown>
      : {},
  };
}

function commandState(storedData: Record<string, unknown>) {
  return {
    inventory: Array.isArray(storedData.inventory) ? storedData.inventory as any[] : [],
    invoiceReceipts: Array.isArray(storedData.invoiceReceipts) ? storedData.invoiceReceipts as any[] : [],
    inventoryMovements: Array.isArray(storedData.inventoryMovements) ? storedData.inventoryMovements as any[] : [],
  };
}

export async function executeInvoiceReceiptCommand(
  prisma: PrismaClient,
  input: ExecuteInvoiceCommandInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: INVOICE_RECEIPT_COMMAND_TYPE,
      actorUsername: input.actorUsername,
      payload: input.payload,
    },
    async (transaction) => {
      const { storedData } = await lockedOrganizationState(transaction, input.organizationId);
      const applied = applyInvoiceReceiptCommand(commandState(storedData), input.payload, {
        commandId: validateCommandId(input.commandId),
        actorUsername: input.actorUsername,
        performedAt: input.performedAt || new Date(),
      });
      const updated = await transaction.organizationState.update({
        where: { organizationId: input.organizationId },
        data: {
          data: {
            ...storedData,
            inventory: applied.state.inventory,
            invoiceReceipts: applied.state.invoiceReceipts,
            inventoryMovements: applied.state.inventoryMovements,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${INVOICE_RECEIPT_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return { ...applied.result, stateVersion: updated.version } as unknown as Prisma.JsonValue;
    },
  );
}

export async function executeInvoiceReceiptReversalCommand(
  prisma: PrismaClient,
  input: ExecuteInvoiceCommandInput,
): Promise<IdempotentCommandOutcome<Prisma.JsonValue>> {
  return executeIdempotentCommand(
    prisma,
    {
      organizationId: input.organizationId,
      commandId: input.commandId,
      commandType: INVOICE_RECEIPT_REVERSAL_COMMAND_TYPE,
      actorUsername: input.actorUsername,
      payload: input.payload,
    },
    async (transaction) => {
      const { storedData } = await lockedOrganizationState(transaction, input.organizationId);
      const applied = applyInvoiceReceiptReversalCommand(commandState(storedData), input.payload, {
        commandId: validateCommandId(input.commandId),
        actorUsername: input.actorUsername,
        performedAt: input.performedAt || new Date(),
      });
      const updated = await transaction.organizationState.update({
        where: { organizationId: input.organizationId },
        data: {
          data: {
            ...storedData,
            inventory: applied.state.inventory,
            invoiceReceipts: applied.state.invoiceReceipts,
            inventoryMovements: applied.state.inventoryMovements,
          } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
          updatedBy: `command:${INVOICE_RECEIPT_REVERSAL_COMMAND_TYPE}:${input.actorUsername}`,
        },
      });
      return { ...applied.result, stateVersion: updated.version } as unknown as Prisma.JsonValue;
    },
  );
}

export function invoiceReceiptCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): InvoiceReceiptCommandResult {
  return outcome.result as unknown as InvoiceReceiptCommandResult;
}

export function invoiceReceiptReversalCommandResult(
  outcome: IdempotentCommandOutcome<Prisma.JsonValue>,
): InvoiceReceiptReversalCommandResult {
  return outcome.result as unknown as InvoiceReceiptReversalCommandResult;
}
