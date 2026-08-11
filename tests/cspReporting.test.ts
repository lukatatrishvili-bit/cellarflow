import { beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import telemetryRouter, { getCspViolations, resetCspViolations } from '../server/routes/telemetry';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telemetry', telemetryRouter);
  return app;
}

/** Minimal in-process request helper — avoids adding a supertest dependency. */
async function post(app: express.Express, path: string, contentType: string, body: unknown) {
  const { createServer } = await import('http');
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port;
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: JSON.stringify(body),
    });
  } finally {
    server.close();
  }
}

describe('CSP violation reporting', () => {
  beforeEach(() => resetCspViolations());

  it('accepts a legacy report-uri envelope sent as application/csp-report', async () => {
    const res = await post(makeApp(), '/api/telemetry/csp-report', 'application/csp-report', {
      'csp-report': {
        'document-uri': 'https://app.cellarflow.ge/cellar/lots?lot=secret-lot-id',
        'effective-directive': 'script-src',
        'blocked-uri': 'https://cdn.evil.example/x.js?token=abc',
      },
    });

    expect(res.status).toBe(204);
    const groups = getCspViolations();
    expect(groups).toHaveLength(1);
    expect(groups[0].directive).toBe('script-src');
    expect(groups[0].count).toBe(1);
  });

  it('accepts the modern Reporting API batch and ignores non-CSP report types', async () => {
    const res = await post(makeApp(), '/api/telemetry/csp-report', 'application/reports+json', [
      { type: 'csp-violation', body: { effectiveDirective: 'style-src', blockedURL: 'inline', documentURL: 'https://app.cellarflow.ge/' } },
      { type: 'deprecation', body: { id: 'something-else' } },
    ]);

    expect(res.status).toBe(204);
    const groups = getCspViolations();
    expect(groups).toHaveLength(1);
    expect(groups[0].directive).toBe('style-src');
    expect(groups[0].blockedUri).toBe('inline');
  });

  it('aggregates repeats into one group so a broken page cannot flood the buffer', async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i += 1) {
      await post(app, '/api/telemetry/csp-report', 'application/csp-report', {
        'csp-report': { 'effective-directive': 'img-src', 'blocked-uri': 'https://tracker.example/pixel.gif' },
      });
    }

    const groups = getCspViolations();
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(5);
    expect(groups[0].firstSeen).toBeTruthy();
    expect(groups[0].lastSeen).toBeTruthy();
  });

  it('reduces the blocked URI to an origin so tenant data never lands in the buffer', async () => {
    await post(makeApp(), '/api/telemetry/csp-report', 'application/csp-report', {
      'csp-report': {
        'document-uri': 'https://app.cellarflow.ge/cellar/lots/lot-7788?org=org_private',
        'effective-directive': 'connect-src',
        'blocked-uri': 'https://api.example/v1/upload?signature=SECRET&lot=lot-7788',
      },
    });

    const [group] = getCspViolations();
    expect(group.blockedUri).toBe('https://api.example');
    expect(group.blockedUri).not.toContain('SECRET');
    expect(group.documentPath).toBe('/cellar');
    expect(JSON.stringify(group)).not.toContain('org_private');
  });

  it('throttles a report flood from a single client', async () => {
    const app = makeApp();
    const statuses: number[] = [];
    // Distinct directives so the cap under test is the rate limit, not MAX_CSP_GROUPS.
    for (let i = 0; i < 25; i += 1) {
      const res = await post(app, '/api/telemetry/csp-report', 'application/csp-report', {
        'csp-report': { 'effective-directive': `script-src-${i}`, 'blocked-uri': 'inline' },
      });
      statuses.push(res.status);
    }

    expect(statuses.filter(s => s === 204).length).toBe(20);
    expect(statuses.filter(s => s === 429).length).toBe(5);
  });

  it('ignores a malformed body without recording anything', async () => {
    const app = makeApp();
    await post(app, '/api/telemetry/csp-report', 'application/csp-report', { unexpected: 'shape' });
    await post(app, '/api/telemetry/csp-report', 'application/csp-report', { 'csp-report': null });
    expect(getCspViolations()).toHaveLength(0);
  });
});
