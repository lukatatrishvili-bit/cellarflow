import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTHENTICATED_ROUTE,
  LOGIN_ROUTE,
  authRedirectTarget,
  isPublicAppRoute,
  resolveAuthRoute,
  safeProtectedReturnTo,
} from '../lib/authRouting';

describe('authentication route decisions', () => {
  it('sends signed-out root and protected visits to login', () => {
    expect(authRedirectTarget('/', false)).toBe(LOGIN_ROUTE);
    expect(authRedirectTarget('/dashboard', false)).toBe(LOGIN_ROUTE);
    expect(authRedirectTarget('/tasks?task=task-1', false)).toBe(LOGIN_ROUTE);
  });

  it('preserves public and account-access routes', () => {
    for (const pathname of ['/welcome', '/pricing', '/terroir-pulse', '/reset-password', '/accept-invite']) {
      expect(isPublicAppRoute(pathname), pathname).toBe(true);
      expect(authRedirectTarget(pathname, false), pathname).toBeNull();
    }
  });

  it('moves authenticated login and callback landings to the dashboard', () => {
    expect(authRedirectTarget('/login', true)).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(authRedirectTarget('/', true)).toBe(DEFAULT_AUTHENTICATED_ROUTE);
    expect(authRedirectTarget('/?complete_registration=1', true))
      .toBe('/dashboard?complete_registration=1');
  });

  it('returns to a protected deep link after authentication', () => {
    const deepLink = '/tasks?task=task-1#details';
    expect(authRedirectTarget('/login', true, deepLink)).toBe(deepLink);
    expect(authRedirectTarget('/', true, deepLink)).toBe(deepLink);
  });

  it('rejects unsafe, public, login, root, and API return targets', () => {
    for (const value of [
      'https://attacker.example/dashboard',
      '//attacker.example/dashboard',
      '/login',
      '/',
      '/welcome',
      '/api/auth/logout',
    ]) {
      expect(safeProtectedReturnTo(value), value).toBeNull();
    }
  });

  it('normalizes a protected route before storing it', () => {
    expect(safeProtectedReturnTo('/tasks/?task=task-1#details'))
      .toBe('/tasks?task=task-1#details');
  });

  it('stores and consumes a protected destination during route resolution', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };

    expect(resolveAuthRoute('/tasks?task=task-1', false, storage)).toBe('/login');
    expect([...values.values()]).toEqual(['/tasks?task=task-1']);
    expect(resolveAuthRoute('/login', true, storage)).toBe('/tasks?task=task-1');
    expect(values.size).toBe(0);
  });
});
