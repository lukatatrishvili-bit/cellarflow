import { beforeEach, describe, expect, it, vi } from 'vitest';

const featureCheck = vi.hoisted(() => vi.fn());

vi.mock('../server/billing/service', () => ({
  BillingStorageError: class BillingStorageError extends Error {},
  organizationHasFeature: featureCheck,
}));

import { requireBillingFeature } from '../server/billing/middleware';

function responseDouble() {
  return {
    statusCode: 200,
    body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(body: any) { this.body = body; return this; },
  };
}

describe('server-side subscription authorization', () => {
  beforeEach(() => featureCheck.mockReset());

  it('denies a server route when the active organization lacks the feature', async () => {
    featureCheck.mockResolvedValue(false);
    const req = { wineryContext: { organizationId: 'org-1' } } as any;
    const res = responseDouble();
    const next = vi.fn();

    await requireBillingFeature('custom_integrations')(req, res as any, next);

    expect(featureCheck).toHaveBeenCalledWith('org-1', 'custom_integrations');
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('subscription_feature_required');
    expect(next).not.toHaveBeenCalled();
  });

  it('continues only after resolving the organization entitlement on the server', async () => {
    featureCheck.mockResolvedValue(true);
    const req = { wineryContext: { organizationId: 'org-2' } } as any;
    const res = responseDouble();
    const next = vi.fn();

    await requireBillingFeature('custom_integrations')(req, res as any, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});
