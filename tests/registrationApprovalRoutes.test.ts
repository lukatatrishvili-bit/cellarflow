import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailMessage } from '../server/mailer';

const originalEnv = { ...process.env };
const sentMail: MailMessage[] = [];
let server: Server;
let baseUrl = '';
let dbModule: typeof import('../server/db');
let authModule: typeof import('../server/auth');

const APPLICANT = {
  email: 'nino@estate.test',
  fullName: 'Nino Kharaishvili',
  passcode: 'vintage-2026-cellar',
  companyProfile: { companyName: 'Kharaishvili Marani', country: 'Georgia', region: 'Kakheti' },
};

function resetDb(): ReturnType<typeof dbModule.getDB> {
  const db = dbModule.getDB();
  db.users = [];
  db.organizations = [];
  db.memberships = [];
  db.invitations = [];
  db.securityAuditEvents = [];
  db.orgData = {};
  sentMail.length = 0;
  return db;
}

async function request(pathname: string, init: RequestInit = {}, forwardedFor = '203.0.113.7'): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': forwardedFor,
      ...(init.headers || {}),
    },
  });
}

/** Most recent message sent to an address. */
function mailTo(address: string): MailMessage | undefined {
  return [...sentMail].reverse().find(message => message.to === address);
}

function linkFrom(message: MailMessage | undefined, pattern: RegExp): string {
  const match = String(message?.text || '').match(pattern);
  if (!match) throw new Error(`Expected a link matching ${pattern} in: ${message?.text ?? '<no message>'}`);
  return match[0];
}

async function registerApplicant(): Promise<Response> {
  return request('/api/auth/register', { method: 'POST', body: JSON.stringify(APPLICANT) });
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

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-approval-routes-'));
  process.env = {
    ...originalEnv,
    NODE_ENV: 'production',
    SESSION_SECRET: 'registration-approval-route-test-secret-32b',
    ADMIN_USERNAME: 'master',
    REGISTRATION_APPROVAL_EMAIL: 'owner@vinos.test',
    DATABASE_URL: '',
    DATABASE_PATH: path.join(root, 'db.json'),
    GCS_BUCKET: '',
  };

  const routes = await import('../server/routes/auth');
  const adminRoutes = await import('../server/routes/admin');
  dbModule = await import('../server/db');
  authModule = await import('../server/auth');

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/auth', routes.default);
  app.use('/api/admin', adminRoutes.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  process.env = { ...originalEnv };
  vi.doUnmock('../server/mailer');
  vi.resetModules();
});

beforeEach(() => {
  resetDb();
});

describe.sequential('registration approval gate', () => {
  it('locks a new signup and emails the reviewer the applicant details', async () => {
    const response = await registerApplicant();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      requiresVerification: true,
      requiresApproval: true,
      email: APPLICANT.email,
    }));

    const stored = dbModule.getDB().users[0] as any;
    expect(stored.approvalStatus).toBe('pending');
    expect(stored.approvalTokenHash).toBeTruthy();

    const reviewerMail = mailTo('owner@vinos.test');
    expect(reviewerMail?.subject).toContain(APPLICANT.fullName);
    expect(reviewerMail?.text).toContain(APPLICANT.fullName);
    expect(reviewerMail?.text).toContain(APPLICANT.email);
    expect(reviewerMail?.text).toContain('Kharaishvili Marani');
    expect(mailTo(APPLICANT.email)?.text).toContain('/api/auth/verify-email?token=');
  });

  it('refuses sign-in and withholds the session until an operator approves', async () => {
    await registerApplicant();

    const unverified = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: APPLICANT.email, passcode: APPLICANT.passcode }),
    });
    expect(unverified.status).toBe(403);
    expect((await unverified.json()).code).toBe('email_unverified');

    // Confirming the address proves ownership — it must not create a session.
    const verifyLink = linkFrom(mailTo(APPLICANT.email), /http:\/\/\S+\/api\/auth\/verify-email\?token=\S+/);
    const verified = await request(verifyLink.replace(baseUrl, ''));
    expect(verified.status).toBe(302);
    expect(verified.headers.get('location')).toBe('/?verified=1&approval=pending');
    expect(verified.headers.get('set-cookie')).toBeNull();

    const pending = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: APPLICANT.email, passcode: APPLICANT.passcode }),
    });
    expect(pending.status).toBe(403);
    expect((await pending.json()).code).toBe('approval_pending');
    expect(pending.headers.get('set-cookie')).toBeNull();
  });

  it('renders the emailed review page without deciding anything', async () => {
    await registerApplicant();
    const reviewLink = linkFrom(mailTo('owner@vinos.test'), /http:\/\/\S+\/api\/auth\/registration-approval\?token=\S+/);

    const page = await request(reviewLink.replace(baseUrl, ''));
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain(APPLICANT.fullName);
    expect(html).toContain('Kharaishvili Marani');

    // A mailbox link scanner prefetching the URL must not grant access.
    expect((dbModule.getDB().users[0] as any).approvalStatus).toBe('pending');
  });

  it('approves through the emailed decision and then allows sign-in', async () => {
    await registerApplicant();
    const reviewLink = linkFrom(mailTo('owner@vinos.test'), /http:\/\/\S+\/api\/auth\/registration-approval\?token=\S+/);
    const token = new URL(reviewLink).searchParams.get('token') || '';
    const user = dbModule.getDB().users[0] as any;
    user.emailVerified = true;

    const decided = await request('/api/auth/registration-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, decision: 'approve' }).toString(),
    });
    expect(decided.status).toBe(200);
    expect(await decided.text()).toContain('Account approved');
    expect(user.approvalStatus).toBe('approved');
    expect(mailTo(APPLICANT.email)?.subject).toContain('approved');

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: APPLICANT.email, passcode: APPLICANT.passcode }),
    });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('maranios_session=');

    // The review link is single use.
    const replay = await request('/api/auth/registration-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, decision: 'reject' }).toString(),
    });
    expect(replay.status).toBe(404);
    expect(user.approvalStatus).toBe('approved');
  });

  it('rejects an unknown review token without touching any account', async () => {
    await registerApplicant();
    const page = await request('/api/auth/registration-approval?token=not-a-real-token');
    expect(page.status).toBe(404);
    expect((dbModule.getDB().users[0] as any).approvalStatus).toBe('pending');
  });

  it('lists and decides pending requests from the master console only', async () => {
    await registerApplicant();
    const masterCookie = `maranios_session=${authModule.createSessionToken({ username: 'master', role: 'Owner/Admin' })}`;

    const anonymous = await request('/api/admin/registrations/pending');
    expect(anonymous.status).toBe(401);

    const listed = await request('/api/admin/registrations/pending', { headers: { cookie: masterCookie } });
    expect(listed.status).toBe(200);
    expect((await listed.json()).pending).toEqual([
      expect.objectContaining({ email: APPLICANT.email, fullName: APPLICANT.fullName, companyName: 'Kharaishvili Marani' }),
    ]);

    const user = dbModule.getDB().users[0] as any;
    const rejected = await request('/api/admin/registrations/decide', {
      method: 'POST',
      headers: { cookie: masterCookie },
      body: JSON.stringify({ username: user.username, decision: 'reject' }),
    });
    expect(rejected.status).toBe(200);
    expect(user.approvalStatus).toBe('rejected');
    expect(user.sessionVersion).toBe(2);

    user.emailVerified = true;
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: APPLICANT.email, passcode: APPLICANT.passcode }),
    });
    expect(login.status).toBe(403);
    expect((await login.json()).code).toBe('approval_rejected');
  });

  it('keeps accounts created before the gate signing in normally', async () => {
    const db = resetDb();
    db.users.push({
      username: 'legacy_owner',
      email: 'legacy@estate.test',
      fullName: 'Legacy Owner',
      role: 'Owner/Admin',
      language: 'en',
      emailVerified: true,
      passwordHash: authModule.hashPassword(APPLICANT.passcode),
      accountEnabled: true,
      sessionVersion: 1,
    });

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: 'legacy@estate.test', passcode: APPLICANT.passcode }),
    }, '203.0.113.9');
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('maranios_session=');
  });
});
