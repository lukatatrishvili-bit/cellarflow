import '../server/loadEnv';
import { getPrismaClientForAdmin } from '../server/db';
import { getBillingProvider } from '../server/billing/providers';
import { processDueRenewals } from '../server/billing/service';

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_NON_PRODUCTION_BILLING_JOB !== 'true') {
    throw new Error('The billing renewal job is production-only unless explicitly enabled for an isolated test environment.');
  }
  const provider = getBillingProvider();
  if (!provider.configured) throw new Error('The billing provider is not configured.');
  if (!provider.supportsRecurring) throw new Error('Recurring billing is not enabled for this merchant.');
  if (!(process.env.SESSION_SECRET || '').trim()) {
    throw new Error('SESSION_SECRET is required to open stored recurring billing tokens.');
  }

  const summary = await processDueRenewals(provider);
  // The summary contains only aggregate counts—never tenant or payment IDs.
  console.log(JSON.stringify({ operation: 'billing-renewals', ...summary }));
}

let prisma: Awaited<ReturnType<typeof getPrismaClientForAdmin>> = null;
try {
  prisma = await getPrismaClientForAdmin();
  await main();
} catch (error) {
  console.error('[billing-renewals] job failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect().catch(() => undefined);
}
