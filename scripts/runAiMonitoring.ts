import '../server/loadEnv';
import { initDB } from '../server/db';
import { runMonitoringPass, type MonitoringCadence } from '../server/aiMonitoring';

/**
 * Scheduled intelligence pass. Invoke from Cloud Scheduler (or any cron) as:
 *
 *   npm run ai:monitor -- hourly
 *   npm run ai:monitor -- daily
 *   npm run ai:monitor -- weekly
 *
 * Deterministic rules only: this job never calls a model, so its cost is
 * constant regardless of how many wineries it sweeps.
 */

const CADENCES: MonitoringCadence[] = ['hourly', 'daily', 'weekly'];

async function main(): Promise<void> {
  const requested = (process.argv[2] || 'daily') as MonitoringCadence;
  if (!CADENCES.includes(requested)) {
    throw new Error(`Unknown cadence "${requested}". Use one of: ${CADENCES.join(', ')}.`);
  }

  await initDB();
  const result = await runMonitoringPass(requested);

  // Aggregate counts only — no winery names, lot codes or user identities.
  console.log(JSON.stringify({
    operation: 'ai-monitoring',
    cadence: result.cadence,
    ranAt: result.ranAt,
    organizations: result.organizations.length,
    skipped: result.skipped,
    deduplicated: result.deduplicated,
    created: result.organizations.reduce((sum, org) => sum + org.created, 0),
    outboxQueued: result.organizations.reduce((sum, org) => sum + org.outboxQueued, 0),
    autoResolved: result.organizations.reduce((sum, org) => sum + org.autoResolved, 0),
    critical: result.organizations.filter((org) => org.status === 'critical').length,
  }));
}

try {
  await main();
} catch (error) {
  console.error('[ai-monitoring] job failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}
