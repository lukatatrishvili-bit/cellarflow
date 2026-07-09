import { describe, it, expect } from 'vitest';
import { can, canAccess, canSyncCollection, isKnownRole, moduleForAttachmentKind, moduleForSyncCollection, permissionsForRole, type Role } from '../server/permissions';

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

  it('enforces module/action permissions for winery roles', () => {
    expect(canAccess('Winemaker', 'operations', 'create')).toBe(true);
    expect(canAccess('Winemaker', 'vineyard', 'create')).toBe(false);
    expect(canAccess('Winemaker', 'grape_intake', 'create')).toBe(true);
    expect(canAccess('Winemaker', 'inventory', 'update')).toBe(true);
    expect(canAccess('Lab Technician', 'lab', 'update')).toBe(true);
    expect(canAccess('Lab Technician', 'certification', 'create')).toBe(true);
    expect(canAccess('Lab Technician', 'lots', 'delete')).toBe(false);
    expect(canAccess('Cellar Worker', 'transfers', 'create')).toBe(true);
    expect(canAccess('Cellar Worker', 'official_docs', 'export')).toBe(false);
    expect(canAccess('Viticulturist', 'vineyard_projects', 'create')).toBe(true);
    expect(canAccess('Viticulturist', 'grape_intake', 'create')).toBe(true);
    expect(canAccess('Viticulturist', 'bottling', 'update')).toBe(false);
  });

  it('maps sync collections to module permissions', () => {
    expect(moduleForSyncCollection('vineyardProjects')).toBe('vineyard_projects');
    expect(moduleForSyncCollection('fermlogs')).toBe('fermentation');
    expect(moduleForSyncCollection('companyProfile')).toBe('company_profile');
    expect(moduleForSyncCollection('attachments')).toBe('certification');
    expect(moduleForSyncCollection('crmLeads')).toBe('sales');
    expect(moduleForSyncCollection('aiDrafts')).toBe('tasks');
    expect(canSyncCollection('Viticulturist', 'vineyardProjects', 'create')).toBe(true);
    expect(canSyncCollection('Viticulturist', 'bottlingRuns', 'update')).toBe(false);
    expect(canSyncCollection('Lab Technician', 'lablogs', 'create')).toBe(true);
    expect(canSyncCollection('Cellar Worker', 'vessels', 'update')).toBe(true);
    expect(canSyncCollection('Cellar Worker', 'vessels', 'delete')).toBe(false);
    expect(canSyncCollection('Winemaker', 'attachments', 'create')).toBe(true);
    expect(canSyncCollection('Owner/Admin', 'crmLeads', 'create')).toBe(true);
    expect(canSyncCollection('Winemaker', 'aiDrafts', 'create')).toBe(true);
    expect(canSyncCollection('Read-Only', 'notes', 'create')).toBe(false);
  });

  it('maps attachment records to their target permission module', () => {
    expect(moduleForAttachmentKind('official_docs')).toBe('official_docs');
    expect(moduleForAttachmentKind('certification')).toBe('certification');
    expect(moduleForAttachmentKind('cadastre')).toBe('vineyard');
    expect(moduleForAttachmentKind('crm')).toBe('sales');
    expect(moduleForAttachmentKind('unknown')).toBeNull();
  });

  it('allows writer roles to create audit logs but not mutate audit history', () => {
    expect(canSyncCollection('Winemaker', 'auditLogs', 'create')).toBe(true);
    expect(canSyncCollection('Cellar Worker', 'auditLogs', 'create')).toBe(true);
    expect(canSyncCollection('Winemaker', 'auditLogs', 'update')).toBe(false);
    expect(canSyncCollection('Read-Only', 'auditLogs', 'create')).toBe(false);
  });

  it('allows auditors to view/export only', () => {
    expect(canAccess('Read-Only', 'official_docs', 'view')).toBe(true);
    expect(canAccess('Read-Only', 'official_docs', 'export')).toBe(true);
    expect(canAccess('Read-Only', 'official_docs', 'update')).toBe(false);
    expect(canAccess('Read-Only', 'audit', 'delete')).toBe(false);
  });

  it('exposes a read-only policy for unknown roles', () => {
    const policy = permissionsForRole('Unknown');
    expect(policy.official_docs).toContain('view');
    expect(canAccess('Unknown', 'sales', 'update')).toBe(false);
  });
});
