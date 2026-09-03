import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  data: null as any,
  version: 1,
  completed: new Set<string>(),
}));

vi.mock('../server/billing/service', () => ({
  organizationHasFeature: vi.fn(async () => true),
}));

vi.mock('../server/db', () => ({
  OrganizationStateVersionConflictError: class OrganizationStateVersionConflictError extends Error {},
  getUserData: vi.fn(async () => structuredClone(harness.data)),
  reloadUserOrganizationDataFromPostgres: vi.fn(async () => ({
    data: structuredClone(harness.data),
    meta: { version: harness.version },
  })),
  saveUserData: vi.fn(async (_username: string, data: any) => {
    harness.data = structuredClone(data);
    harness.version += 1;
  }),
  getPrismaClientForAdmin: vi.fn(() => ({
    commandExecution: {
      findUnique: vi.fn(async ({ where }: any) => {
        const commandId = where.organizationId_commandId.commandId;
        return harness.completed.has(commandId) ? { status: 'completed' } : null;
      }),
      findMany: vi.fn(async () => []),
    },
  })),
}));

import {
  decideWorkflowApproval,
  gateWorkflowApproval,
  normalizeWorkflowApprovalPolicy,
  summarizeApprovalRequest,
} from '../server/workflowApprovals';

describe('workflow approval gate', () => {
  beforeEach(() => {
    harness.data = {
      companyProfile: { workflowApprovals: { enabled: true, commandTypes: ['cellar.operation'] } },
      workflowApprovals: [],
    };
    harness.version = 1;
    harness.completed.clear();
  });

  it('normalizes policy input to the supported command allowlist', () => {
    expect(normalizeWorkflowApprovalPolicy({
      enabled: true,
      commandTypes: ['cellar.operation', 'cellar.operation', 'unknown'],
    })).toEqual({ enabled: true, commandTypes: ['cellar.operation'] });
    expect(normalizeWorkflowApprovalPolicy(null)).toEqual({ enabled: false, commandTypes: [] });
  });

  it('creates one pending request and releases only the same approved payload', async () => {
    const request = {
      username: 'ana', organizationId: 'org-1', actorUsername: 'ana',
      commandId: 'cmd-1', commandType: 'cellar.operation' as const,
      payload: { operation: { type: 'racking', lotId: 'LOT-1', vesselId: 'T-1' } },
    };
    const first = await gateWorkflowApproval(request);
    expect(first.outcome).toBe('pending');
    const second = await gateWorkflowApproval(request);
    expect(second).toMatchObject({ outcome: 'pending', approval: { commandId: 'cmd-1' } });
    expect(harness.data.workflowApprovals).toHaveLength(1);

    const approvalId = harness.data.workflowApprovals[0].id;
    await decideWorkflowApproval({ username: 'ana', approvalId, status: 'approved', decidedBy: 'owner', reason: 'Verified' });
    await expect(gateWorkflowApproval(request)).resolves.toMatchObject({ outcome: 'approved' });
    await expect(gateWorkflowApproval({ ...request, payload: { operation: { type: 'racking', lotId: 'LOT-2' } } }))
      .resolves.toMatchObject({ outcome: 'payload_changed' });
  });

  it('short-circuits completed command replays before creating approval work', async () => {
    harness.completed.add('cmd-done');
    await expect(gateWorkflowApproval({
      username: 'ana', organizationId: 'org-1', actorUsername: 'ana', commandId: 'cmd-done',
      commandType: 'cellar.operation', payload: { operation: { type: 'racking' } },
    })).resolves.toEqual({ outcome: 'executed' });
    expect(harness.data.workflowApprovals).toHaveLength(0);
  });

  it('creates concise operator-facing request summaries', () => {
    expect(summarizeApprovalRequest('cellar.operation', { operation: { type: 'racking', lotId: 'LOT-1', vesselId: 'T-1' } }))
      .toContain('LOT-1');
    expect(summarizeApprovalRequest('cellar.transfer', { volume: 500, sourceId: 'T-1', destId: 'T-2' }))
      .toContain('500');
  });
});
