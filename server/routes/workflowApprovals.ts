import express from 'express';
import { checkWineryScope, setOrganizationStateHeaders } from '../middleware/auth';
import { can } from '../permissions';
import { organizationHasFeature } from '../billing/service';
import {
  decideWorkflowApproval,
  listWorkflowApprovals,
  normalizeWorkflowApprovalPolicy,
} from '../workflowApprovals';
import {
  getUserData,
  OrganizationStateVersionConflictError,
  reloadUserOrganizationDataFromPostgres,
  saveUserData,
} from '../db';

const router = express.Router();

router.get('/', checkWineryScope('read'), async (req, res) => {
  const session = (req as any).wineryContext;
  const entitled = await organizationHasFeature(session.organizationId, 'workflow_approvals');
  const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
  const data = refreshed?.data || await getUserData(session.username);
  const policy = normalizeWorkflowApprovalPolicy(data?.companyProfile?.workflowApprovals);
  const approvals = entitled
    ? await listWorkflowApprovals(session.username, session.organizationId)
    : [];
  await setOrganizationStateHeaders(res, session.username);
  res.json({
    ok: true,
    entitled,
    policy,
    approvals: can(session.role, 'admin')
      ? approvals
      : approvals.filter(approval => approval.requestedBy === session.username),
  });
});

router.put('/policy', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!await organizationHasFeature(session.organizationId, 'workflow_approvals')) {
    return res.status(403).json({
      code: 'subscription_feature_required',
      feature: 'workflow_approvals',
      error: 'Workflow approvals are not included in the current subscription plan.',
    });
  }
  const policy = normalizeWorkflowApprovalPolicy(req.body);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const refreshed = await reloadUserOrganizationDataFromPostgres(session.username);
    const data = refreshed?.data || await getUserData(session.username);
    if (!data) return res.status(503).json({ error: 'Winery state is unavailable.' });
    data.companyProfile = { ...(data.companyProfile || {}), workflowApprovals: policy };
    try {
      await saveUserData(session.username, data, {
        expectedVersion: refreshed?.meta.version ?? null,
        updatedBy: `workflow-approval-policy:${session.username}`,
      });
      await setOrganizationStateHeaders(res, session.username);
      return res.json({ ok: true, policy });
    } catch (error) {
      if (error instanceof OrganizationStateVersionConflictError && attempt < 3) continue;
      throw error;
    }
  }
  return res.status(409).json({ error: 'The approval policy changed concurrently. Reload and retry.' });
});

router.post('/:approvalId/decision', checkWineryScope('admin'), async (req, res) => {
  const session = (req as any).wineryContext;
  if (!await organizationHasFeature(session.organizationId, 'workflow_approvals')) {
    return res.status(403).json({
      code: 'subscription_feature_required',
      feature: 'workflow_approvals',
      error: 'Workflow approvals are not included in the current subscription plan.',
    });
  }
  const status = req.body?.status;
  if (!['approved', 'rejected', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Decision must be approved, rejected, or cancelled.' });
  }
  try {
    const approval = await decideWorkflowApproval({
      username: session.username,
      approvalId: String(req.params.approvalId || ''),
      status,
      decidedBy: session.username,
      reason: req.body?.reason,
    });
    await setOrganizationStateHeaders(res, session.username);
    return res.json({ ok: true, approval });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'Approval decision failed.' });
  }
});

export default router;
