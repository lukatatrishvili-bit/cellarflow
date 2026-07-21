import { describe, expect, it } from 'vitest';
import {
  buildOrganizationStateChecksumReport,
  canonicalJson,
  compareOrganizationStateChecksumReports,
} from '../scripts/organizationStateChecksums';

const capturedAt = '2026-07-20T18:00:00.000Z';

describe('OrganizationState recovery checksums', () => {
  it('canonicalizes JSON object keys while preserving array order and primitive types', () => {
    expect(canonicalJson({ b: 2, a: { z: true, y: null } })).toBe(
      canonicalJson({ a: { y: null, z: true }, b: 2 }),
    );
    expect(canonicalJson({ values: [1, 2] })).not.toBe(canonicalJson({ values: [2, 1] }));
    expect(canonicalJson({ value: '1' })).not.toBe(canonicalJson({ value: 1 }));
  });

  it('builds the same aggregate checksum regardless of database row order', () => {
    const rows = [
      {
        organizationId: 'winery-a',
        version: 4,
        updatedAt: '2026-07-20T10:00:00.000Z',
        data: { lots: [{ id: 'LOT-1', volume: 120 }], vessels: [] },
      },
      {
        organizationId: 'winery-b',
        version: 2,
        updatedAt: '2026-07-20T11:00:00.000Z',
        data: { vessels: [{ id: 'QV-1' }], lots: [] },
      },
    ];

    const first = buildOrganizationStateChecksumReport(rows, capturedAt);
    const second = buildOrganizationStateChecksumReport([...rows].reverse(), capturedAt);

    expect(first.aggregateChecksumSha256).toBe(second.aggregateChecksumSha256);
    expect(first.states).toEqual(second.states);
    expect(first.latestStateUpdatedAt).toBe('2026-07-20T11:00:00.000Z');
  });

  it('does not expose organization ids, names, or winery record contents', () => {
    const report = buildOrganizationStateChecksumReport([{
      organizationId: 'secret-winery-id',
      version: 1,
      updatedAt: '2026-07-20T10:00:00.000Z',
      data: { companyProfile: { name: 'Private Marani' }, lots: [{ id: 'SECRET-LOT' }] },
    }], capturedAt);
    const serialized = JSON.stringify(report);

    expect(report.states[0].organizationKey).toMatch(/^org_[a-f0-9]{20}$/);
    expect(serialized).not.toContain('secret-winery-id');
    expect(serialized).not.toContain('Private Marani');
    expect(serialized).not.toContain('SECRET-LOT');
  });

  it('reports exact matches even when the reports were captured at different times', () => {
    const row = {
      organizationId: 'winery-a',
      version: 4,
      updatedAt: '2026-07-20T10:00:00.000Z',
      data: { lots: [{ id: 'LOT-1', volume: 120 }] },
    };
    const source = buildOrganizationStateChecksumReport([row], capturedAt);
    const restored = buildOrganizationStateChecksumReport([row], '2026-07-20T19:00:00.000Z');

    expect(compareOrganizationStateChecksumReports(source, restored)).toEqual({
      matches: true,
      expectedOrganizationCount: 1,
      actualOrganizationCount: 1,
      changedOrganizationKeys: [],
      missingOrganizationKeys: [],
      unexpectedOrganizationKeys: [],
    });
  });

  it('classifies changed, missing, and unexpected organization states without exposing data', () => {
    const source = buildOrganizationStateChecksumReport([
      {
        organizationId: 'changed',
        version: 1,
        updatedAt: '2026-07-20T10:00:00.000Z',
        data: { volume: 10 },
      },
      {
        organizationId: 'missing',
        version: 1,
        updatedAt: '2026-07-20T10:00:00.000Z',
        data: { volume: 20 },
      },
    ], capturedAt);
    const restored = buildOrganizationStateChecksumReport([
      {
        organizationId: 'changed',
        version: 2,
        updatedAt: '2026-07-20T11:00:00.000Z',
        data: { volume: 11 },
      },
      {
        organizationId: 'unexpected',
        version: 1,
        updatedAt: '2026-07-20T10:00:00.000Z',
        data: { volume: 30 },
      },
    ], capturedAt);

    const comparison = compareOrganizationStateChecksumReports(source, restored);
    expect(comparison.matches).toBe(false);
    expect(comparison.changedOrganizationKeys).toHaveLength(1);
    expect(comparison.missingOrganizationKeys).toHaveLength(1);
    expect(comparison.unexpectedOrganizationKeys).toHaveLength(1);
    expect(JSON.stringify(comparison)).not.toContain('"changed"');
    expect(JSON.stringify(comparison)).not.toContain('"missing"');
    expect(JSON.stringify(comparison)).not.toContain('"unexpected"');
    expect(JSON.stringify(comparison)).not.toContain('volume');
  });

  it('rejects invalid values instead of producing ambiguous checksums', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/i);
    expect(() => canonicalJson(undefined)).toThrow(/unsupported undefined/i);
    expect(() => buildOrganizationStateChecksumReport([{
      organizationId: 'winery-a',
      version: -1,
      updatedAt: 'not-a-date',
      data: {},
    }], capturedAt)).toThrow(/invalid version/i);
  });
});
