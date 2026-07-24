import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RegistrationPanel, SignInPanel, WorkspaceSetupDialog } from '../components/RegistrationExperience';

describe('progressive registration experience', () => {
  it('keeps account creation focused on four essential fields', () => {
    const markup = renderToStaticMarkup(
      <RegistrationPanel
        lang="en"
        onSubmit={vi.fn()}
        onGoogle={vi.fn()}
        onSignIn={vi.fn()}
        onLanguageChange={vi.fn()}
      />,
    );

    expect(markup).toContain('name="fullName"');
    expect(markup).toContain('name="email"');
    expect(markup).toContain('name="companyName"');
    expect(markup).toContain('name="passcode"');
    expect(markup).not.toContain('name="username"');
    expect(markup).not.toContain('name="enabledModules"');
    expect(markup).toContain('Continue with Google');
  });

  it('presents product focus as personalization instead of a permission role', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSetupDialog
        lang="en"
        required
        user={{
          username: 'owner',
          email: 'owner@example.com',
          fullName: 'Estate Owner',
          role: 'Owner/Admin',
          language: 'en',
          enabledModules: ['vazi', 'gvino'],
        }}
        companyProfile={{ companyName: 'Kvareli Estate' }}
        onSubmit={vi.fn(async () => true)}
        onClose={vi.fn()}
      />,
    );

    expect(markup).toContain('What do you manage?');
    expect(markup).toContain('Vineyard');
    expect(markup).toContain('Cellar');
    expect(markup).not.toContain('Winemaker');
    expect(markup).not.toContain('Viticulturist');
  });

  it('keeps sign-in focused and excludes technical OAuth configuration controls', () => {
    const markup = renderToStaticMarkup(
      <SignInPanel
        lang="en"
        demoEnabled
        onSubmit={vi.fn()}
        onGoogle={vi.fn()}
        onForgotPassword={vi.fn()}
        onRegister={vi.fn()}
        onDemo={vi.fn()}
        onLanguageChange={vi.fn()}
      />,
    );

    expect(markup).toContain('name="identifier"');
    expect(markup).toContain('name="passcode"');
    expect(markup).toContain('Forgot password?');
    expect(markup).toContain('Continue with Google');
    expect(markup).toContain('Open demo workspace');
    expect(markup).not.toContain('Manage Google OAuth Credentials');
  });
});
