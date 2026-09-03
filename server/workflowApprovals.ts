import crypto from 'node:crypto';
import type express from 'express';
import {
  getPrismaClientForAdmin,
  getUserData,
  OrganizationStateVersionConflictError,
  reloadUserOrganizationDataFromPostgres,
  saveUserData,
  type UserDataState,
} from './db';
import { organizationHasFeature } from './billing/service';
import { canAccess, type PermissionAction, type PermissionModule } from './permissions';
import {
  APPROVABLE_COMMAND_TYPES,
  type ApprovableCommandType,
  type WorkflowApprovalPolicy,
  type WorkflowApprovalRecord,
} from '../lib/operationsControl';

const APPROVAL_RECORD_LIMIT = 1_000;

const permissionForCommand: Record<ApprovableCommandType, { module: PermissionModule; action: PermissionAction }> = {
  'cellar.operation': { module: 'operations', action: 'create' },
  'cellar.operation.reverse': { module: 'operations', action: 'delete' },
  'cellar.transfer': { module: 'transfers', action: 'create' },
  'cellar.transfer.reverse': { module: 'transfers', action: 'delete' },
  'cellar.bottling': { module: 'bottling', action: 'create' },
  'cellar.bottling.reverse': { module: 'bottling', action: 'delete' },
  'sales.stock': { module: 'sales', action: 'create' },
  'sales.stock.reverse': { module: 'sales', action: 'delete' },
};

export function isApprovableCommandType(value: unknown): value is ApprovableCommandType {
  return typeof value === 'string' && (APPROVABLE_COMMAND_TYPES as readonly string[]).includes(value);
}

export function normalizeWorkflowApprovalPolicy(value: unknown): WorkflowApprovalPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { enabled: false, commandTypes: [] };
  }
  const input = value as Record<string, unknown>;
  return {
    enabled: input.enabled === true,
    commandTypes: Array.isArray(input.commandTypes)
      ? [...new Set(input.commandTypes.filter(isApprovableCommandType))]
      : [],
  };
}

function approvalRecords(data: UserDataState): WorkflowApprovalRecord[] {
  return Array.isArray(data.workflowApprovals) ? data.workflowApprovals : [];
}

function payloadHash(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function summarizeApprovalRequest(commandType: ApprovableCommandType, payload: any): string {
  if (commandType === 'cellar.operation') {
    const operation = payload?.operation || {};
    return `${text(operation.customLabel || operation.type) || 'Cellar operation'} · ${text(operation.lotId) || 'unassigned lot'}${text(operation.vesselId) ? ` · ${text(operation.vesselId)}` : ''}`;
  }
  if (commandType === 'cellar.transfer') {
    return `Transfer ${Number(payload?.volume || 0).toLocaleString()} L · ${text(payload?.sourceVesselId || payload?.sourceId) || '?'} → ${text(payload?.destinationVesselId || payload?.destId) || '?'}`;
  }
  if (commandType === 'cellar.bottling') {
    return `Bottling · ${text(payload?.lotId) || 'unassigned lot'} · ${Number(payload?.totalBottles || 0).toLocaleString()} bottles`;
  }
  if (commandType === 'sales.stock') {
    const action = text(payload?.action) || 'sales action';
    const record = payload?.order || payload?.dispatch || {};
    return `${action.replace(/_/g, ' ')} · ${text(record.customerName || payload?.customerName) || 'customer'} · ${Number(record.bottles || payload?.bottles || 0).toLocaleString()} bottles`;
  }
  const original = text(payload?.originalCommandId || payload?.receiptId || payload?.dispatchId);
  return `${commandType.replace(/\./g, ' ')}${original ? ` · ${original}` : ''}`;
}

async function completedCommandExists(organizationId: string, commandId: string): Promise<boolean> {
  const prisma = getPrismaClientForAdmin();
  const model = (prisma as any)?.commandExecution;
  if (!model) return false;
  const row = await model.findUnique({
    where: { organizationId_commandId: { organizationId, commandId } },
    select: { status: true },
  });
  return row?.status === 'completed';
}

export type ApprovalGateResult =
  | { outcome: 'not_required' | 'approved' | 'executed'; approval?: WorkflowApprovalRecord }
  | { outcome: 'pending' | 'rejected' | 'cancelled' | 'payload_changed'; approval: WorkflowApprovalRecord };

export async function gateWorkflowApproval(input: {
  username: string;
  organizationId: string;
  actorUsername: string;
  commandId: string;
  commandType: ApprovableCommandType;
  payload: unknown;
}): Promise<ApprovalGateResult> {
  if (await completedCommandExists(input.organizationId, input.commandId)) {
    return { outcome: 'executed' };
  }
  const hash = payloadHash(input.payload);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const refreshed = await reloadUserOrganizationDataFromPostgres(input.username);
    const data = refreshed?.data || await getUserData(input.username);
    if (!data) return { outcome: 'not_required' };
    const policy = normalizeWorkflowApprovalPolicy(data.companyProfile?.workflowApprovals);
    if (!policy.enabled || !policy.commandTypes.includes(input.commandType)) {
      return { outcome: 'not_required' };
    }
    const records = approvalRecords(data);
    const existing = records.find(record => record.commandId === input.commandId);
    if (existing) {
      if (existing.payloadHash !== hash) return { outcome: 'payload_changed', approval: existing };
      if (existing.status === 'approved') return { outcome: 'approved', approval: existing };
      if (existing.status === 'executed') return { outcome: 'executed', approval: existing };
      return { outcome: existing.status as 'pending' | 'rejected' | 'cancelled', approval: existing };
    }
    const now = new Date().toISOString();
    const approval: WorkflowApprovalRecord = {
      id: `approval-${crypto.randomUUID()}`,
      commandId: input.commandId,
      commandType: input.commandType,
      status: 'pending',
      requestedAt: now,
      requestedBy: input.actorUsername,
      requestSummary: summarizeApprovalRequest(input.commandType, input.payload),
      payloadHash: hash,
    };
    data.workflowApprovals = [approval, ...records].slice(0, APPROVAL_RECORD_LIMIT);
    try {
      await saveUserData(input.username, data, {
        expectedVersion: refreshed?.meta.version ?? null,
        updatedBy: `workflow-approval:${input.actorUsername}`,
      });
      return { outcome: 'pending', approval };
    } catch (error) {
      if (error instanceof OrganizationStateVersionConflictError && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error('The approval queue changed concurrently. Retry the same command.');
}

export async function listWorkflowApprovals(username: string, organizationId: string): Promise<WorkflowApprovalRecord[]> {
  const refreshed = await reloadUserOrganizationDataFromPostgres(username);
  const data = refreshed?.data || await getUserData(username);
  const records = approvalRecords(data || ({} as UserDataState));
  const prisma = getPrismaClientForAdmin();
  const model = (prisma as any)?.commandExecution;
  if (!model || !records.length) return records;
  const completed = await model.findMany({
    where: { organizationId, commandId: { in: records.map(record => record.commandId) }, status: 'completed' },
    select: { commandId: true, completedAt: true },
  });
  const completedById = new Map(completed.map((row: any) => [row.commandId, row.completedAt]));
  return records.map(record => {
    const completedAt = completedById.get(record.commandId);
    return completedAt
      ? { ...record, status: 'executed' as const, executedAt: new Date(completedAt as any).toISOString() }
      : record;
  });
}

export async function decideWorkflowApproval(input: {
  username: string;
  approvalId: string;
  status: 'approved' | 'rejected' | 'cancelled';
  decidedBy: string;
  reason?: string;
}): Promise<WorkflowApprovalRecord> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const refreshed = await reloadUserOrganizationDataFromPostgres(input.username);
    const data = refreshed?.data || await getUserData(input.username);
    if (!data) throw new Error('Winery state is unavailable.');
    const records = approvalRecords(data);
    const index = records.findIndex(record => record.id === input.approvalId);
    if (index < 0) throw new Error('Approval request was not found.');
    const existing = records[index];
    if (existing.status !== 'pending') throw new Error(`Approval request is already ${existing.status}.`);
    const updated: WorkflowApprovalRecord = {
      ...existing,
      status: input.status,
      decidedAt: new Date().toISOString(),
      decidedBy: input.decidedBy,
      decisionReason: text(input.reason).slice(0, 500) || undefined,
    };
    data.workflowApprovals = records.map((record, recordIndex) => recordIndex === index ? updated : record);
    try {
      await saveUserData(input.username, data, {
        expectedVersion: refreshed?.meta.version ?? null,
        updatedBy: `workflow-approval-decision:${input.decidedBy}`,
      });
      return updated;
    } catch (error) {
      if (error instanceof OrganizationStateVersionConflictError && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error('The approval request changed concurrently. Reload and retry.');
}

export function workflowApprovalGate(commandType: ApprovableCommandType) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const session = (req as any).wineryContext;
    if (!session) return next();
    const permission = permissionForCommand[commandType];
    if (!canAccess(session.role, permission.module, permission.action)) return next();
    if (!await organizationHasFeature(String(session.organizationId || ''), 'workflow_approvals')) return next();
    const commandId = text(req.body?.commandId);
    const payload = req.body?.payload;
    if (!commandId || !payload || typeof payload !== 'object' || Array.isArray(payload)) return next();
    try {
      const result = await gateWorkflowApproval({
        username: session.username,
        organizationId: String(session.organizationId || ''),
        actorUsername: session.username,
        commandId,
        commandType,
        payload,
      });
      if (result.outcome === 'not_required' || result.outcome === 'approved' || result.outcome === 'executed') {
        if (result.approval) res.locals.workflowApprovalId = result.approval.id;
        return next();
      }
      if (result.outcome === 'pending') {
        return res.status(409).json({
          ok: false,
          approval: result.approval,
          error: {
            code: 'workflow_approval_required',
            message: `Submitted for approval: ${result.approval.requestSummary}. Keep this command pending and resubmit it after approval.`,
            retryable: true,
          },
        });
      }
      if (result.outcome === 'payload_changed') {
        return res.status(409).json({
          ok: false,
          approval: result.approval,
          error: {
            code: 'workflow_approval_payload_changed',
            message: 'The approved payload cannot be changed. Cancel it and submit a new command for review.',
            retryable: false,
          },
        });
      }
      const decision = result.approval;
      return res.status(409).json({
        ok: false,
        approval: decision,
        error: {
          code: `workflow_approval_${result.outcome}`,
          message: `This command was ${result.outcome}${decision?.decisionReason ? `: ${decision.decisionReason}` : '.'}`,
          retryable: false,
        },
      });
    } catch (error) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'workflow_approval_retry_required',
          message: error instanceof Error ? error.message : 'The approval queue changed. Retry the same command.',
          retryable: true,
        },
      });
    }
  };
}
