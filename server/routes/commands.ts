import express from 'express';
import { getPrismaClientForAdmin, reloadOrganizationDataFromPostgres } from '../db';
import { CommandContractError, validateCommandId } from '../idempotentCommands';
import { checkWineryScope, setOrganizationStateHeaders } from '../middleware/auth';
import { cellarWorkflowPermissions , salesWorkflowPermissions } from '../../lib/workflowPermissions';
import { BottlingCommandError } from '../../lib/commands/bottling';
import { BottlingReversalCommandError } from '../../lib/commands/bottlingReversal';
import {
  cellarOperationPayloadUsesMaterial,
  cellarOperationPayloadUsesVessels,
  CellarOperationCommandError,
  parseCellarOperationCommandPayload,
} from '../../lib/commands/cellarOperation';
import { CellarOperationReversalCommandError } from '../../lib/commands/cellarOperationReversal';
import { FermentationCompletionCommandError } from '../../lib/commands/fermentationCompletion';
import { FermentationCompletionReversalCommandError } from '../../lib/commands/fermentationCompletionReversal';
import { HarvestIntakeCommandError } from '../../lib/commands/harvestIntake';
import { HarvestIntakeReversalCommandError } from '../../lib/commands/harvestIntakeReversal';
import { SalesStockCommandError } from '../../lib/commands/salesStock';
import { SalesStockReversalCommandError } from '../../lib/commands/salesStockReversal';
import { StorageMovementCommandError } from '../../lib/commands/storageMovement';
import { TransferCommandError } from '../../lib/commands/transfer';
import { TransferReversalCommandError } from '../../lib/commands/transferReversal';
import { bottlingCommandResult, executeCellarBottlingCommand } from '../commands/bottling';
import {
  bottlingReversalCommandResult,
  executeBottlingReversalCommand,
} from '../commands/bottlingReversal';
import { cellarOperationCommandResult, executeCellarOperationCommand } from '../commands/cellarOperation';
import {
  cellarOperationReversalCommandResult,
  executeCellarOperationReversalCommand,
} from '../commands/cellarOperationReversal';
import {
  executeFermentationCompletionCommand,
  fermentationCompletionCommandResult,
} from '../commands/fermentationCompletion';
import {
  executeFermentationCompletionReversalCommand,
  fermentationCompletionReversalCommandResult,
} from '../commands/fermentationCompletionReversal';
import { executeHarvestIntakeCommand, harvestIntakeCommandResult } from '../commands/harvestIntake';
import {
  executeHarvestIntakeReversalCommand,
  harvestIntakeReversalCommandResult,
} from '../commands/harvestIntakeReversal';
import { executeSalesStockCommand, salesStockCommandResult } from '../commands/salesStock';
import {
  executeSalesStockReversalCommand,
  salesStockReversalCommandResult,
} from '../commands/salesStockReversal';
import { executeStorageMovementCommand, storageMovementCommandResult } from '../commands/storageMovement';
import { executeCellarTransferCommand, transferCommandResult } from '../commands/transfer';
import {
  executeCellarTransferReversalCommand,
  transferReversalCommandResult,
} from '../commands/transferReversal';
import {
  MAX_REPORTED_QUEUE_AGE_MS,
  recordCommandOperationalMetric,
} from '../operationalTelemetry';

const router = express.Router();

router.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const startedAt = Date.now();
  const commandType = req.path.replace(/^\//, '');
  const reportedQueueAge = Number(req.get('X-CellarFlow-Queue-Age-Ms'));
  const queueAgeMs = Number.isFinite(reportedQueueAge)
    ? Math.min(MAX_REPORTED_QUEUE_AGE_MS, Math.max(0, reportedQueueAge))
    : 0;
  res.once('finish', () => {
    recordCommandOperationalMetric({
      commandType,
      durationMs: Date.now() - startedAt,
      queueAgeMs,
      statusCode: res.statusCode,
      outcome: res.statusCode === 201
        ? 'executed'
        : res.statusCode === 200 ? 'replayed' : 'failed',
    });
  });
  next();
});

function commandError(res: express.Response, status: number, code: string, message: string, retryable = false) {
  return res.status(status).json({
    ok: false,
    error: { code, message, retryable },
  });
}

function handledCommandError(res: express.Response, error: unknown): express.Response | null {
  if (error instanceof CommandContractError) {
    return commandError(res, error.statusCode, error.code, error.message, error.retryable);
  }
  if (error instanceof TransferCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof TransferReversalCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof BottlingCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof BottlingReversalCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof CellarOperationCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof CellarOperationReversalCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof FermentationCompletionCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof FermentationCompletionReversalCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof HarvestIntakeCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof HarvestIntakeReversalCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof SalesStockCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof SalesStockReversalCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error instanceof StorageMovementCommandError) {
    return commandError(res, error.statusCode, error.code, error.message);
  }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
    return commandError(
      res,
      409,
      'command_retry_required',
      'The winery state changed during this command. Retry the same command id and payload.',
      true,
    );
  }
  return null;
}

// Grape intake, lot creation, audit signing, and optional harvest, vessel, and
// cost effects share one row lock and one durable idempotency claim.
router.post('/cellar.harvest-intake', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = cellarWorkflowPermissions(session.role).intake;
  if (!permissions.canReceiveGrapes) {
    return commandError(
      res,
      403,
      'forbidden_harvest_intake',
      'This role cannot create every core record required by grape receiving.',
    );
  }

  const payload = req.body?.payload;
  const rawPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const rawIntake = rawPayload.intake && typeof rawPayload.intake === 'object'
    && !Array.isArray(rawPayload.intake)
    ? rawPayload.intake as Record<string, unknown>
    : {};
  if (typeof rawIntake.harvestRecordId === 'string' && rawIntake.harvestRecordId.trim()
    && !permissions.canLinkHarvest) {
    return commandError(
      res,
      403,
      'forbidden_harvest_link',
      'This role cannot update the linked vineyard harvest.',
    );
  }
  if (typeof rawIntake.destinationVesselId === 'string' && rawIntake.destinationVesselId.trim()
    && !permissions.canFillDestinationVessel) {
    return commandError(
      res,
      403,
      'forbidden_intake_vessel',
      'This role cannot fill a destination vessel during grape receiving.',
    );
  }
  const requestsCosting = ['costPerKg', 'totalCost', 'grapePrice'].some(field => (
    typeof rawIntake[field] === 'number' && Number.isFinite(rawIntake[field] as number)
      && (rawIntake[field] as number) !== 0
  )) || (typeof rawIntake.paymentStatus === 'string' && rawIntake.paymentStatus !== 'not_applicable');
  if (requestsCosting && !permissions.canPostIntakeCost) {
    return commandError(
      res,
      403,
      'forbidden_intake_costing',
      'This role cannot post fruit acquisition costs during grape receiving.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const organizationId = String(session.organizationId || '');
  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeHarvestIntakeCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = harvestIntakeCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          harvests: refreshed.data.harvests,
          lots: refreshed.data.lots,
          vessels: refreshed.data.vessels,
          grapeIntakes: refreshed.data.grapeIntakes,
          costEntries: refreshed.data.costEntries,
          auditLogs: refreshed.data.auditLogs,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] harvest intake execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The grape intake could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Receiving corrections retain the original receipt and atomically restore
// its harvest, generated lot, vessel, cost, and signed audit consequences.
router.post('/cellar.harvest-intake.reverse', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = cellarWorkflowPermissions(session.role).intake;
  if (!permissions.canReverseHarvestIntake) {
    return commandError(
      res,
      403,
      'forbidden_harvest_intake_reversal',
      'This role cannot update every ledger required by a grape-intake reversal.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const organizationId = String(session.organizationId || '');
  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }
    const outcome = await executeHarvestIntakeReversalCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload: req.body?.payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = harvestIntakeReversalCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          harvests: refreshed.data.harvests,
          lots: refreshed.data.lots,
          vessels: refreshed.data.vessels,
          grapeIntakes: refreshed.data.grapeIntakes,
          costEntries: refreshed.data.costEntries,
          auditLogs: refreshed.data.auditLogs,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] harvest intake reversal execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The grape-intake reversal could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Lot history, vessel state, material stock, derived cost, operation ledger,
// and signed audit evidence share one row lock and idempotency claim.
router.post('/cellar.operation', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = cellarWorkflowPermissions(session.role).operations;
  if (!permissions.canLogCellarOperation) {
    return commandError(
      res,
      403,
      'forbidden_cellar_operation',
      'This role cannot create every core record required by a cellar operation.',
    );
  }

  const payload = req.body?.payload;
  let parsedPayload;
  try {
    parsedPayload = parseCellarOperationCommandPayload(payload);
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    throw error;
  }
  if (cellarOperationPayloadUsesVessels(parsedPayload) && !permissions.canUseOperationVessels) {
    return commandError(
      res,
      403,
      'forbidden_cellar_operation_vessel',
      'This role cannot update or reference vessels through a cellar operation.',
    );
  }
  if (cellarOperationPayloadUsesMaterial(parsedPayload) && !permissions.canConsumeOperationMaterials) {
    return commandError(
      res,
      403,
      'forbidden_cellar_operation_material',
      'This role cannot deduct material inventory or post its derived cost.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const organizationId = String(session.organizationId || '');
  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeCellarOperationCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload: parsedPayload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = cellarOperationCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          lots: refreshed.data.lots,
          vessels: refreshed.data.vessels,
          inventory: refreshed.data.inventory,
          cellarOps: refreshed.data.cellarOps,
          costEntries: refreshed.data.costEntries,
          auditLogs: refreshed.data.auditLogs,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] cellar operation execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The cellar operation could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Operation corrections restore the captured before-state and append cost and
// signed audit compensation without deleting the original treatment record.
router.post('/cellar.operation.reverse', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = cellarWorkflowPermissions(session.role).operations;
  if (!permissions.canReverseCellarOperation) {
    return commandError(
      res,
      403,
      'forbidden_cellar_operation_reversal',
      'This role cannot update every ledger required by a cellar-operation reversal.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const organizationId = String(session.organizationId || '');
  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }
    const outcome = await executeCellarOperationReversalCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload: req.body?.payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = cellarOperationReversalCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          lots: refreshed.data.lots,
          vessels: refreshed.data.vessels,
          inventory: refreshed.data.inventory,
          cellarOps: refreshed.data.cellarOps,
          costEntries: refreshed.data.costEntries,
          auditLogs: refreshed.data.auditLogs,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] cellar operation reversal execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The cellar-operation reversal could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Final reading, lot lifecycle, vessel operation state, and signed audit
// evidence commit together as one fermentation-completion event.
router.post('/cellar.fermentation-complete', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!cellarWorkflowPermissions(session.role).fermentation.canCompleteFermentation) {
    return commandError(
      res,
      403,
      'forbidden_fermentation_completion',
      'This role cannot update every record required to complete fermentation.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeFermentationCompletionCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = fermentationCompletionCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          lots: refreshed.data.lots,
          vessels: refreshed.data.vessels,
          fermlogs: refreshed.data.fermlogs,
          auditLogs: refreshed.data.auditLogs,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] fermentation completion execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'Fermentation could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Completion correction reopens the lot and restores the vessel operation while
// retaining the final physical reading and appending signed correction evidence.
router.post('/cellar.fermentation-complete.reverse', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!cellarWorkflowPermissions(session.role).fermentation.canReverseFermentationCompletion) {
    return commandError(
      res,
      403,
      'forbidden_fermentation_completion_reversal',
      'This role cannot update every record required to reverse fermentation completion.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeFermentationCompletionReversalCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = fermentationCompletionReversalCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          lots: refreshed.data.lots,
          vessels: refreshed.data.vessels,
          fermlogs: refreshed.data.fermlogs,
          auditLogs: refreshed.data.auditLogs,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] fermentation completion reversal execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'Fermentation completion could not be reversed. Keep the command id before retrying.',
      true,
    );
  }
});

// Execute one transfer as an organization-state transaction. The row lock
// serializes distinct commands for the same winery, while the durable command
// claim makes retries and concurrent duplicates return the original result.
router.post('/cellar.transfer', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!cellarWorkflowPermissions(session.role).transfers.canExecuteTransfer) {
    return commandError(
      res,
      403,
      'forbidden_transfer',
      'This role cannot update every collection required by a transfer.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeCellarTransferCommand(
      prisma,
      {
        organizationId,
        commandId,
        actorUsername: session.username,
        payload,
        performedAt: new Date(),
      },
    );

    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = transferCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          vessels: refreshed.data.vessels,
          lots: refreshed.data.lots,
          transfers: refreshed.data.transfers,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] transfer execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The transfer could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Reversal is a second immutable command: it restores the captured business
// state only when no dependent vessel or lot work has happened since transfer.
router.post('/cellar.transfer.reverse', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!cellarWorkflowPermissions(session.role).transfers.canReverseTransfer) {
    return commandError(
      res,
      403,
      'forbidden_transfer_reversal',
      'This role cannot compensate a cellar transfer.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the reversal command id and retry later.',
        true,
      );
    }

    const outcome = await executeCellarTransferReversalCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = transferReversalCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          vessels: refreshed.data.vessels,
          lots: refreshed.data.lots,
          transfers: refreshed.data.transfers,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] transfer reversal execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The transfer reversal could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Lot volume, packaging stock, costing, the bottling ledger, and optional
// finished-goods placement commit together under the same organization lock.
router.post('/cellar.bottling', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = cellarWorkflowPermissions(session.role).bottling;
  if (!permissions.canCreateBottling) {
    return commandError(
      res,
      403,
      'forbidden_bottling',
      'This role cannot update every collection required by a bottling run.',
    );
  }

  const payload = req.body?.payload;
  const rawPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const rawSelections = rawPayload.packagingSelections;
  const requestsCosting = (rawSelections && typeof rawSelections === 'object'
    && !Array.isArray(rawSelections) && Object.keys(rawSelections).length > 0)
    || (typeof rawPayload.bottlingServiceCost === 'number' && rawPayload.bottlingServiceCost !== 0);
  if (requestsCosting && !permissions.canUseBottlingCosting) {
    return commandError(
      res,
      403,
      'forbidden_bottling_costing',
      'This role cannot consume packaging inventory or create bottling costs.',
    );
  }
  if (typeof rawPayload.storageLocationId === 'string' && rawPayload.storageLocationId.trim()
    && !permissions.canPlaceFinishedGoods) {
    return commandError(
      res,
      403,
      'forbidden_bottling_storage',
      'This role cannot place finished goods into storage.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeCellarBottlingCommand(
      prisma,
      {
        organizationId,
        commandId,
        actorUsername: session.username,
        payload,
        performedAt: new Date(),
      },
    );
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = bottlingCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          lots: refreshed.data.lots,
          bottlingRuns: refreshed.data.bottlingRuns,
          inventory: refreshed.data.inventory,
          costEntries: refreshed.data.costEntries,
          stockMovements: refreshed.data.stockMovements,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] bottling execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The bottling run could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Bottling corrections append compensating lot, packaging, cost, and storage
// facts under the same organization lock; the original run remains auditable.
router.post('/cellar.bottling.reverse', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = cellarWorkflowPermissions(session.role).bottling;
  if (!permissions.canReverseBottling) {
    return commandError(
      res,
      403,
      'forbidden_bottling_reversal',
      'This role cannot update every ledger required by a bottling reversal.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const organizationId = String(session.organizationId || '');
  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }
    const outcome = await executeBottlingReversalCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload: req.body?.payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = bottlingReversalCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          lots: refreshed.data.lots,
          bottlingRuns: refreshed.data.bottlingRuns,
          inventory: refreshed.data.inventory,
          costEntries: refreshed.data.costEntries,
          stockMovements: refreshed.data.stockMovements,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] bottling reversal execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The bottling reversal could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Reservations, physical dispatches, fulfillment, and cancellation all use the
// same authoritative availability calculation under the organization row lock.
router.post('/sales.stock', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = salesWorkflowPermissions(session.role);
  const action = typeof req.body?.payload?.action === 'string' ? req.body.payload.action : '';
  const allowed = action === 'reserve'
    ? permissions.canCreateOrder
    : action === 'dispatch'
      ? permissions.canCreateDispatch && permissions.canCreateStockMovement
      : action === 'fulfill'
        ? permissions.canUpdateOrder && permissions.canCreateDispatch && permissions.canCreateStockMovement
        : action === 'cancel'
          ? permissions.canUpdateOrder
          : permissions.canCreateOrder;
  if (!allowed) {
    return commandError(
      res,
      403,
      'forbidden_sales_stock',
      'This role cannot update every collection required by this sales stock action.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeSalesStockCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = salesStockCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          stockMovements: refreshed.data.stockMovements,
          salesDispatches: refreshed.data.salesDispatches,
          salesOrders: refreshed.data.salesOrders,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] sales stock execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The sales stock action could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Sales corrections preserve the outbound dispatch and append a capacity-checked
// inbound return plus a compensating financial record.
router.post('/sales.stock.reverse', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  const permissions = salesWorkflowPermissions(session.role);
  if (!permissions.canReverseDispatch) {
    return commandError(
      res,
      403,
      'forbidden_sales_stock_reversal',
      'This role cannot update every collection required to reverse a sales dispatch.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeSalesStockReversalCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = salesStockReversalCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          stockMovements: refreshed.data.stockMovements,
          salesDispatches: refreshed.data.salesDispatches,
          salesOrders: refreshed.data.salesOrders,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] sales stock reversal execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The sales stock reversal could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// Receiving unplaced bottling output, paired internal relocations, and audited
// adjustments share one authoritative capacity/availability check and ledger.
router.post('/storage.movement', checkWineryScope('write'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!salesWorkflowPermissions(session.role).canCreateStockMovement) {
    return commandError(
      res,
      403,
      'forbidden_storage_movement',
      'This role cannot create finished-goods storage movements.',
    );
  }

  const commandId = typeof req.body?.commandId === 'string' ? req.body.commandId : '';
  const payload = req.body?.payload;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable. Keep the command id and retry later.',
        true,
      );
    }

    const outcome = await executeStorageMovementCommand(prisma, {
      organizationId,
      commandId,
      actorUsername: session.username,
      payload,
      performedAt: new Date(),
    });
    const refreshed = await reloadOrganizationDataFromPostgres(organizationId);
    await setOrganizationStateHeaders(res, session.username);
    const result = storageMovementCommandResult(outcome);
    return res.status(outcome.disposition === 'executed' ? 201 : 200).json({
      ok: true,
      disposition: outcome.disposition,
      commandId: outcome.commandId,
      commandType: outcome.commandType,
      result,
      ...(refreshed ? {
        collections: {
          bottlingRuns: refreshed.data.bottlingRuns,
          stockMovements: refreshed.data.stockMovements,
        },
      } : {}),
    });
  } catch (error) {
    const handled = handledCommandError(res, error);
    if (handled) return handled;
    console.error('[commands] storage movement execution failed', error);
    return commandError(
      res,
      500,
      'command_execution_failed',
      'The storage movement could not be completed. Keep the command id before retrying.',
      true,
    );
  }
});

// A client that times out after submitting a compound command can use this
// organization-scoped endpoint to recover its durable result before retrying.
router.get('/:commandId', checkWineryScope('read'), async (req, res) => {
  let commandId: string;
  try {
    commandId = validateCommandId(String(req.params.commandId || ''));
  } catch (error) {
    if (error instanceof CommandContractError) {
      return commandError(res, error.statusCode, error.code, error.message, error.retryable);
    }
    throw error;
  }

  const session = (req as any).wineryContext;
  const organizationId = String(session.organizationId || '');

  try {
    const prisma = await getPrismaClientForAdmin();
    if (!prisma) {
      return commandError(
        res,
        503,
        'command_store_unavailable',
        'Durable command storage is unavailable.',
        true,
      );
    }

    const command = await prisma.commandExecution.findUnique({
      where: { organizationId_commandId: { organizationId, commandId } },
      select: {
        commandId: true,
        commandType: true,
        status: true,
        result: true,
        createdAt: true,
        completedAt: true,
      },
    });
    if (!command) {
      return commandError(res, 404, 'command_not_found', 'Command was not found in this organization.');
    }

    return res.status(200).json({ ok: true, command });
  } catch (error) {
    console.error('[commands] status lookup failed', error);
    return commandError(
      res,
      503,
      'command_store_unavailable',
      'Durable command storage is temporarily unavailable.',
      true,
    );
  }
});

export default router;
