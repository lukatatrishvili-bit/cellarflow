import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ProfileSettingsTab, { profileWorkspaceFormKey } from '../components/ProfileSettingsTab';
import type { UserProfile } from '../lib/wineryState';

function settingsProps(
  userRole: UserProfile['role'],
  activeMembershipRole?: UserProfile['role'],
): ComponentProps<typeof ProfileSettingsTab> {
  const effectiveRole = activeMembershipRole || userRole;
  return {
    lang: 'en',
    currentUser: {
      username: 'cellar-user',
      email: 'cellar@example.com',
      fullName: 'Cellar User',
      role: userRole,
      language: 'en',
    },
    setCurrentUser: vi.fn(),
    companyProfile: {
      companyName: 'Example Estate',
      wineryName: 'Example Cellar',
      country: 'Georgia',
      region: 'Kakheti',
      municipality: 'Telavi',
      address: '1 Vineyard Road',
      contactEmail: 'estate@example.com',
      phone: '',
      website: '',
      measurementUnits: 'metric',
    },
    setCompanyProfile: vi.fn(),
    setToastMessage: vi.fn(),
    onUpdateProfile: vi.fn().mockResolvedValue(undefined),
    onClearAllData: vi.fn(),
    canManageProfile: effectiveRole === 'Owner/Admin',
    canManageCrm: effectiveRole === 'Owner/Admin',
    organizations: activeMembershipRole
      ? [{ id: 'org-1', name: 'Example Estate', role: activeMembershipRole, isActive: true }]
      : undefined,
    manualLowPower: false,
    onToggleLowPower: vi.fn(),
  };
}

describe('ProfileSettingsTab effective-role controls', () => {
  it('remounts uncontrolled company fields when the active workspace changes', () => {
    expect(profileWorkspaceFormKey('org-a', 0)).not.toBe(profileWorkspaceFormKey('org-b', 0));
    expect(profileWorkspaceFormKey('org-a', 1)).not.toBe(profileWorkspaceFormKey('org-a', 0));
    expect(profileWorkspaceFormKey('org-a', 0, 'Estate A')).not.toBe(
      profileWorkspaceFormKey('org-a', 0, 'Estate B'),
    );
  });

  it('uses the active membership role and hides owner-only surfaces from non-owners', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileSettingsTab, settingsProps('Owner/Admin', 'Read-Only')),
    );

    expect(markup).toContain('Effective workspace role');
    expect(markup).toContain('Read-only');
    expect(markup).toContain('cannot be changed here');
    expect(markup).not.toContain('Simulated Clearance Role Privilege');
    expect(markup).not.toContain('<option value="Owner/Admin"');
    expect(markup).not.toContain('Administrative Database Export');
    expect(markup).not.toContain('Initialize Clean Estate');
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toContain('Save Personal Preferences');
  });

  it('shows owner-only surfaces for an authoritative Owner/Admin membership', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProfileSettingsTab, settingsProps('Read-Only', 'Owner/Admin')),
    );

    expect(markup).toContain('Owner &amp; ERP Admin');
    expect(markup).toContain('Administrative Database Export');
    expect(markup).toContain('Initialize Clean Estate');
    expect(markup).not.toMatch(/<fieldset[^>]*disabled=""/);
  });

  it('renders the effective-role explanation in Georgian', () => {
    const props = settingsProps('Winemaker');
    props.lang = 'ka';
    const markup = renderToStaticMarkup(React.createElement(ProfileSettingsTab, props));

    expect(markup).toContain('მოქმედი როლი');
    expect(markup).toContain('მთავარი მეღვინე');
    expect(markup).toContain('აქ ვერ შეიცვლება');
  });
});
