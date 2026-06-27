import { describe, it, expect } from 'vitest';
import { can, isKnownRole, type Role } from '../server/permissions';

describe('server permissions (RBAC)', () => {
  it('Owner/Admin can write and perform admin actions', () => {
    expect(can('Owner/Admin', 'read')).toBe(true);
    expect(can('Owner/Admin', 'write')).toBe(true);
    expect(can('Owner/Admin', 'admin')).toBe(true);
    expect(can('Owner/Admin', 'manage_users')).toBe(true);
  });

  it('production roles can write but not run admin actions', () => {
    for (const role of ['Winemaker', 'Viticulturist', 'Lab Technician', 'Cellar Worker'] as Role[]) {
      expect(can(role, 'write'), `${role} write`).toBe(true);
      expect(can(role, 'admin'), `${role} admin`).toBe(false);
      expect(can(role, 'manage_users'), `${role} manage_users`).toBe(false);
    }
  });

  it('Read-Only can read but never write', () => {
    expect(can('Read-Only', 'read')).toBe(true);
    expect(can('Read-Only', 'write')).toBe(false);
    expect(can('Read-Only', 'admin')).toBe(false);
  });

  it('unknown / missing roles are denied write by default (treated as read-only)', () => {
    expect(can(undefined, 'write')).toBe(false);
    expect(can(null, 'write')).toBe(false);
    expect(can('Hacker', 'write')).toBe(false);
    expect(can('', 'admin')).toBe(false);
    expect(can(undefined, 'read')).toBe(true);
  });

  it('recognises the known role set', () => {
    expect(isKnownRole('Winemaker')).toBe(true);
    expect(isKnownRole('Nonsense')).toBe(false);
    expect(isKnownRole(undefined)).toBe(false);
  });
});
