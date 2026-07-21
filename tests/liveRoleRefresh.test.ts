import { describe, expect, it, vi } from 'vitest';
import { applyLiveSessionProfile, cacheSafeUserProfile } from '../hooks/useWineryState';
import type { UserProfile } from '../lib/wineryState';

const owner: UserProfile = {
  username: 'nino',
  email: 'old@example.com',
  fullName: 'Nino',
  role: 'Owner/Admin',
  language: 'en',
  enabledModules: ['dashboard', 'sales'],
};

describe('live session profile refresh', () => {
  it('applies and persists a validated role downgrade without discarding the profile', () => {
    const storage = { setItem: vi.fn() };
    const updated = applyLiveSessionProfile(owner, {
      username: 'nino',
      email: 'new@example.com',
      fullName: 'Nino Updated',
      role: 'Read-Only',
      language: 'ka',
      enabledModules: ['dashboard', 42, 'reports'],
    }, storage);

    expect(updated).toMatchObject({
      username: 'nino',
      email: 'new@example.com',
      fullName: 'Nino Updated',
      role: 'Read-Only',
      language: 'ka',
      enabledModules: ['dashboard', 'reports'],
    });
    expect(storage.setItem).toHaveBeenCalledWith('vinea_curr_user', JSON.stringify(cacheSafeUserProfile(updated!)));
    expect(owner.role).toBe('Owner/Admin');
  });

  it('never restores or persists server-issued master and impersonation capabilities', () => {
    const privileged: UserProfile = {
      ...owner,
      isMasterAdmin: true,
      impersonatedBy: 'root-admin',
    };
    const storage = { setItem: vi.fn() };

    expect(cacheSafeUserProfile(privileged)).toEqual(owner);

    const refreshed = applyLiveSessionProfile(privileged, {
      username: owner.username,
      role: owner.role,
      isMasterAdmin: false,
    }, storage);
    expect(refreshed?.isMasterAdmin).toBe(false);
    expect(refreshed?.impersonatedBy).toBeUndefined();
    expect(storage.setItem).toHaveBeenCalledWith('vinea_curr_user', JSON.stringify(owner));
  });

  it('rejects malformed roles and a profile for a different session user', () => {
    const storage = { setItem: vi.fn() };

    expect(applyLiveSessionProfile(owner, { username: 'nino', role: 'Superuser' }, storage)).toBeNull();
    expect(applyLiveSessionProfile(owner, { username: 'other', role: 'Read-Only' }, storage)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
