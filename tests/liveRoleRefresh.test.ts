import { describe, expect, it, vi } from 'vitest';
import { applyLiveSessionProfile } from '../hooks/useWineryState';
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
    expect(storage.setItem).toHaveBeenCalledWith('vinea_curr_user', JSON.stringify(updated));
    expect(owner.role).toBe('Owner/Admin');
  });

  it('rejects malformed roles and a profile for a different session user', () => {
    const storage = { setItem: vi.fn() };

    expect(applyLiveSessionProfile(owner, { username: 'nino', role: 'Superuser' }, storage)).toBeNull();
    expect(applyLiveSessionProfile(owner, { username: 'other', role: 'Read-Only' }, storage)).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
