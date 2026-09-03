import type express from 'express';
import type { BillingFeature } from '../../lib/billing/planCatalog';
import { BillingStorageError, organizationHasFeature } from './service';

/** Must run after checkWineryScope so the trusted organization context exists. */
export function requireBillingFeature(feature: BillingFeature) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const context = (req as any).wineryContext;
    if (!context?.organizationId) return res.status(401).json({ error: 'Unauthorized' });
    try {
      if (!await organizationHasFeature(context.organizationId, feature)) {
        return res.status(403).json({
          code: 'subscription_feature_required',
          feature,
          error: 'Your organization plan does not include this feature. Existing data remains preserved.',
        });
      }
      return next();
    } catch (error) {
      if (error instanceof BillingStorageError) {
        return res.status(503).json({ code: 'billing_storage_unavailable', error: error.message });
      }
      return res.status(500).json({ error: 'Unable to resolve subscription entitlements.' });
    }
  };
}
