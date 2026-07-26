import '../server/loadEnv';
import { getPrismaClientForAdmin } from '../server/db';
import {
  compareVesselLotProjection,
  syncVesselLotProjection,
} from '../server/relationalProjection';

function numericArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

type AdminPrismaClient = NonNullable<Awaited<ReturnType<typeof getPrismaClientForAdmin>>>;

async function main(prisma: AdminPrismaClient): Promise<void> {
  const repair = process.argv.includes('--repair');
  if (repair && process.env.ALLOW_RELATIONAL_PROJECTION_REPAIR !== 'true') {
    throw new Error('Set ALLOW_RELATIONAL_PROJECTION_REPAIR=true to run an explicit repair.');
  }
  const limit = Math.min(500, numericArg('limit', 100));
  const after = process.argv
    .find(arg => arg.startsWith('--after='))
    ?.slice('--after='.length)
    .trim();
  const rows = await (prisma as any).organizationState.findMany({
    where: after ? { organizationId: { gt: after } } : undefined,
    orderBy: { organizationId: 'asc' },
    take: limit,
  });

  let mismatchedOrganizations = 0;
  let mismatchesBeforeRepair = 0;
  let mismatchesAfterRepair = 0;
  for (const row of rows) {
    const state = row.data && typeof row.data === 'object' ? row.data : {};
    const before = await compareVesselLotProjection(prisma, row.organizationId, state);
    if (before.totalMismatches > 0) {
      mismatchedOrganizations += 1;
      mismatchesBeforeRepair += before.totalMismatches;
      if (repair) {
        await (prisma as any).$transaction((tx: any) => (
          syncVesselLotProjection(tx, row.organizationId, state)
        ));
      }
    }
    const afterRepair = repair && before.totalMismatches > 0
      ? await compareVesselLotProjection(prisma, row.organizationId, state)
      : before;
    mismatchesAfterRepair += afterRepair.totalMismatches;
  }

  const summary = {
    operation: repair ? 'relational-projection-repair' : 'relational-projection-check',
    scannedOrganizations: rows.length,
    mismatchedOrganizations,
    mismatchesBeforeRepair,
    mismatchesAfterRepair,
    limit,
    hasMore: rows.length === limit,
    nextCursor: rows.length === limit ? rows.at(-1)?.organizationId : null,
  };
  console.log(JSON.stringify(summary));
  if (mismatchesAfterRepair > 0) process.exitCode = 2;
}

let prisma: Awaited<ReturnType<typeof getPrismaClientForAdmin>> = null;
try {
  prisma = await getPrismaClientForAdmin();
  if (!prisma) throw new Error('DATABASE_URL is required for relational projection checks.');
  await main(prisma);
} catch (error) {
  console.error('[relational-projection] check failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect().catch(() => undefined);
}
