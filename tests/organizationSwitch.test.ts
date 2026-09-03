import { describe, expect, it, vi } from 'vitest';
import { applyOrganizationSwitchRole } from '../hooks/useWineryState';
import { buildOrganizationSwitchResponse, publicUserForActiveOrganization } from '../server/routes/auth';
import type { UserProfile } from '../lib/wineryState';

const owner: UserProfile = {
  username: 'owner',
  email: 'owner@example.com',
  fullName: 'Estate Owner',
  role: 'Owner/Admin',
  language: 'en',
  enabledModules: ['vazi', 'gvino'],
};

describe('organization switch role contract', () => {
  it('returns the authoritative membership role with the active organization', () => {
    expect(buildOrganizationSwitchResponse('org-cellar', 'Cellar Worker')).toEqual({
      ok: true,
      activeOrganizationId: 'org-cellar',
      role: 'Cellar Worker',
    });
  });

  it('replaces and persists the client role without changing the remaining profile', () => {
    const storage = { setItem: vi.fn() };
    const response = buildOrganizationSwitchResponse('org-readonly', 'Read-Only');

    const updated = applyOrganizationSwitchRole(owner, response, storage);

    expect(updated).toEqual({ ...owner, role: 'Read-Only' });
    expect(storage.setItem).toHaveBeenCalledWith(
      'vinea_curr_user',
      JSON.stringify({ ...owner, role: 'Read-Only' }),
    );
    expect(owner.role).toBe('Owner/Admin');
  });

  it('rejects a malformed or unknown role instead of retaining stale authority', () => {
    const storage = { setItem: vi.fn() };

    expect(applyOrganizationSwitchRole(owner, {}, storage)).toBeNull();
    expect(applyOrganizationSwitchRole(owner, { role: 'Superuser' }, storage)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps the active membership role when personal profile updates return a user', () => {
    const db = {
      memberships: [{ userId: 'owner', organizationId: 'org-lab', role: 'Lab Technician' }],
    };
    const user = { ...owner, activeOrganizationId: 'org-lab' };

    expect(publicUserForActiveOrganization(db, user)).toMatchObject({
      username: 'owner',
      fullName: 'Estate Owner',
      role: 'Lab Technician',
    });
  });
});
