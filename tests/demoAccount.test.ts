import { describe, expect, it } from 'vitest';
import { createDemoUser, readDemoAccountConfig } from '../server/demoAccount';

describe('demo account configuration', () => {
  it('is disabled unless the deployment explicitly enables it', () => {
    const config = readDemoAccountConfig({});
    expect(config.enabled).toBe(false);
    expect(config.username).toBe('demo');
    expect(config.role).toBe('Winemaker');
  });

  it('normalizes deployment-provided account details', () => {
    const config = readDemoAccountConfig({
      DEMO_LOGIN_ENABLED: 'YES',
      DEMO_USERNAME: '  Demo_Winery ',
      DEMO_EMAIL: ' DEMO@EXAMPLE.COM ',
      DEMO_FULL_NAME: 'Public Demo Winery',
      DEMO_ROLE: 'Read-Only',
    });

    expect(config).toMatchObject({
      enabled: true,
      username: 'demo_winery',
      email: 'demo@example.com',
      fullName: 'Public Demo Winery',
      role: 'Read-Only',
    });
  });

  it('creates a standard persisted user without sample operational records', () => {
    const config = readDemoAccountConfig({ DEMO_LOGIN_ENABLED: 'true' });
    const user = createDemoUser(config);

    expect(user.username).toBe('demo');
    expect(user.passwordHash).toMatch(/^\d+:[a-f0-9]+:[a-f0-9]+$/);
    expect(user.enabledModules).toEqual(['vazi', 'gvino']);
    expect(user).not.toHaveProperty('vessels');
    expect(user).not.toHaveProperty('lots');
  });
});
