import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailMessage } from '../server/mailer';

const originalEnv = { ...process.env };
const nativeFetch = globalThis.fetch;
const sentMail: MailMessage[] = [];
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');

function cookieValue(response: Response, name: string): string {
  const combined = response.headers.get('set-cookie') || '';
  const match = combined.match(new RegExp(`${name}=([^;,]*)`));
  return match?.[1] || '';
}

async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  return nativeFetch(`${baseUrl}${pathname}`, {
    ...init,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.81',
      ...(init.headers || {}),
    },
  });
}

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('../server/mailer', async () => {
    const actual = await vi.importActual<typeof import('../server/mailer')>('../server/mailer');
    return {
      ...actual,
      sendMail: vi.fn(async (message: MailMessage) => {
        sentMail.push(message);
        return { delivered: true, transport: 'smtp' as const };
      }),
    };
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-google-registration-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'google-registration-route-test-secret-32bytes',
    GOOGLE_CLIENT_ID: 'google-client-id.test',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    REGISTRATION_APPROVAL_EMAIL: 'owner@vinos.test',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') {
      return new Response(JSON.stringify({
        sub: 'google-subject-123',
        email: 'nino.google@example.com',
        given_name: 'Nino',
        family_name: 'Kharaishvili',
        name: 'Nino Kharaishvili',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return nativeFetch(input, init);
  }));

  const routes = await import('../server/routes/auth');
  dbModule = await import('../server/db');
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/auth', routes.default);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.doUnmock('../server/mailer');
  vi.resetModules();
});

beforeEach(() => {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.orgData = {};
  sentMail.length = 0;
});

describe.sequential('Google registration completion', () => {
  it('collects required profile data before creating an approval request', async () => {
    const login = await request('/api/auth/google/login');
    expect(login.status).toBe(302);
    const state = new URL(login.headers.get('location') || '').searchParams.get('state') || '';
    const stateCookie = cookieValue(login, 'vinos_google_oauth_state');
    expect(state).toBeTruthy();
    expect(stateCookie).toBe(state);

    const callback = await request(`/api/auth/google/callback?code=test-code&state=${state}`, {
      headers: { cookie: `vinos_google_oauth_state=${stateCookie}` },
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/login?google_registration=1');
    expect(dbModule.getDB().users).toHaveLength(0);

    const registrationCookie = cookieValue(callback, 'vinos_google_registration');
    expect(registrationCookie).toBeTruthy();
    const pendingProfile = await request('/api/auth/google/registration', {
      headers: { cookie: `vinos_google_registration=${registrationCookie}` },
    });
    expect(await pendingProfile.json()).toEqual({
      email: 'nino.google@example.com',
      firstName: 'Nino',
      lastName: 'Kharaishvili',
    });

    const missingPhone = await request('/api/auth/google/registration', {
      method: 'POST',
      headers: { cookie: `vinos_google_registration=${registrationCookie}` },
      body: JSON.stringify({
        firstName: 'Nino',
        lastName: 'Kharaishvili',
        companyName: 'Kharaishvili Marani',
        phone: '',
      }),
    });
    expect(missingPhone.status).toBe(400);
    expect((await missingPhone.json()).code).toBe('phone_required');
    expect(dbModule.getDB().users).toHaveLength(0);

    const submitted = await request('/api/auth/google/registration', {
      method: 'POST',
      headers: { cookie: `vinos_google_registration=${registrationCookie}` },
      body: JSON.stringify({
        firstName: 'Nino',
        lastName: 'Kharaishvili',
        companyName: 'Kharaishvili Marani',
        phone: '+995 555 12 34 56',
        language: 'en',
      }),
    });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toEqual(expect.objectContaining({
      email: 'nino.google@example.com',
      requiresApproval: true,
      authenticated: false,
    }));
    expect(submitted.headers.get('set-cookie')).not.toContain('maranios_session=');

    const user = dbModule.getDB().users[0] as any;
    expect(user).toEqual(expect.objectContaining({
      fullName: 'Nino Kharaishvili',
      phone: '+995555123456',
      emailVerified: true,
      approvalStatus: 'pending',
    }));
    expect(dbModule.getDB().organizations[0].name).toBe('Kharaishvili Marani');
    expect(sentMail.find(message => message.to === 'owner@vinos.test')?.text).toContain('+995555123456');
  });

  it('rejects a callback whose OAuth state does not match the secure cookie', async () => {
    const response = await request('/api/auth/google/callback?code=test-code&state=wrong-state', {
      headers: { cookie: 'vinos_google_oauth_state=expected-state' },
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('could not be verified');
    expect(dbModule.getDB().users).toHaveLength(0);
  });
});
