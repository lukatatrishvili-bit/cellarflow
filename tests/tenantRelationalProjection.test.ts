import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('.');

describe('tenant-safe relational projection contracts', () => {
  it('keys vessel and lot rows by organization plus business identifier', () => {
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const db = fs.readFileSync(path.join(root, 'server/db.ts'), 'utf8');
    const projection = fs.readFileSync(path.join(root, 'server/relationalProjection.ts'), 'utf8');
    const migration = fs.readFileSync(path.join(
      root,
      'prisma/migrations/20260726173000_tenant_safe_vessel_lot_keys/migration.sql',
    ), 'utf8');

    const vesselModel = schema.slice(schema.indexOf('model Vessel {'), schema.indexOf('model SecurityAuditEvent {'));
    const lotModel = schema.slice(schema.indexOf('model WineLot {'), schema.indexOf('model DailyFermLog {'));
    expect(vesselModel).toContain('@@id([organizationId, id])');
    expect(lotModel).toContain('@@id([organizationId, id])');
    expect(projection.match(/organizationId_id:/g)).toHaveLength(2);
    expect(db).toContain('await syncVesselLotProjection(tx, orgId, state)');
    expect(db).toContain('await syncVesselLotProjection(tx, orgId, db.orgData[orgId])');
    expect(db).not.toContain('background relational double-write');
    expect(migration).toContain('PRIMARY KEY ("organizationId", "id")');
    expect(migration).not.toMatch(/\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b/);
  });
});
