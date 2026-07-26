import { describe, expect, it } from 'vitest';
import {
  compareVesselLotProjection,
  syncVesselLotProjection,
} from '../server/relationalProjection';

function projectionClient() {
  const vessels: any[] = [];
  const lots: any[] = [];

  function delegate(rows: any[]) {
    return {
      async findMany({ where }: any) {
        return rows.filter(row => row.organizationId === where.organizationId);
      },
      async deleteMany({ where }: any) {
        const before = rows.length;
        const retained = rows.filter(row => {
          if (row.organizationId !== where.organizationId) return true;
          if (!where.id?.notIn) return false;
          return where.id.notIn.includes(row.id);
        });
        rows.splice(0, rows.length, ...retained);
        return { count: before - retained.length };
      },
      async upsert({ where, update, create }: any) {
        const key = where.organizationId_id;
        const index = rows.findIndex(row => (
          row.organizationId === key.organizationId && row.id === key.id
        ));
        if (index >= 0) {
          rows[index] = { ...rows[index], ...update };
          return rows[index];
        }
        rows.push({ ...create });
        return create;
      },
    };
  }

  return {
    vessel: delegate(vessels),
    wineLot: delegate(lots),
    rows: { vessels, lots },
  };
}

const sharedState = {
  vessels: [{
    id: 'shared-vessel',
    type: 'Qvevri',
    shape: 'egg',
    capacity: 1_000,
    currentVolume: 820,
    coolingJacketActive: false,
  }],
  lots: [{
    id: 'shared-lot',
    name: 'Saperavi Reserve',
    vintage: 2026,
    variety: 'Saperavi',
    currentVolume: 820,
  }],
};

describe('vessel and wine-lot relational projection', () => {
  it('allows duplicate business IDs across tenants and deletes only the selected tenant rows', async () => {
    const client = projectionClient();

    await syncVesselLotProjection(client, 'org-a', sharedState);
    await syncVesselLotProjection(client, 'org-b', sharedState);

    expect(client.rows.vessels).toHaveLength(2);
    expect(client.rows.lots).toHaveLength(2);
    expect(await compareVesselLotProjection(client, 'org-a', sharedState))
      .toMatchObject({ totalMismatches: 0 });
    expect(await compareVesselLotProjection(client, 'org-b', sharedState))
      .toMatchObject({ totalMismatches: 0 });

    await syncVesselLotProjection(client, 'org-a', { vessels: [], lots: [] });

    expect(client.rows.vessels).toEqual([
      expect.objectContaining({ id: 'shared-vessel', organizationId: 'org-b' }),
    ]);
    expect(client.rows.lots).toEqual([
      expect.objectContaining({ id: 'shared-lot', organizationId: 'org-b' }),
    ]);
  });

  it('detects a changed projected value and returns to parity after repair', async () => {
    const client = projectionClient();
    await syncVesselLotProjection(client, 'org-a', sharedState);
    client.rows.vessels[0].currentVolume = 700;

    expect(await compareVesselLotProjection(client, 'org-a', sharedState))
      .toMatchObject({ vesselMismatches: 1, totalMismatches: 1 });

    await syncVesselLotProjection(client, 'org-a', sharedState);

    expect(await compareVesselLotProjection(client, 'org-a', sharedState))
      .toMatchObject({ totalMismatches: 0 });
  });
});
