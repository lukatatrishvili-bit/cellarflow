import { describe, expect, it } from 'vitest';
import { buildServiceReadiness } from '../server/readiness';
import type { PostgresReadinessProbe } from '../server/db';

type DbStatus = Parameters<typeof buildServiceReadiness>[0];

function dbStatus(overrides: {
  persistenceMode?: 'postgresql-jsonb' | 'gcs-json' | 'local-json';
  memoryLoaded?: boolean;
  postgresSaveError?: string | null;
  postgresSyncError?: string | null;
  localSaveError?: string | null;
  gcsEnabled?: boolean;
  gcsUploadError?: string | null;
} = {}): DbStatus {
  return {
    persistenceMode: overrides.persistenceMode ?? 'postgresql-jsonb',
    memory: { loaded: overrides.memoryLoaded ?? true },
    postgres: {
      configured: (overrides.persistenceMode ?? 'postgresql-jsonb') === 'postgresql-jsonb',
      lastSaveError: overrides.postgresSaveError ?? null,
      lastMetadataSyncError: overrides.postgresSyncError ?? null,
    },
    json: {
      lastLocalSaveError: overrides.localSaveError ?? null,
      gcsEnabled: overrides.gcsEnabled ?? false,
      lastGcsUploadError: overrides.gcsUploadError ?? null,
    },
  } as unknown as DbStatus;
}

function postgresProbe(overrides: Partial<PostgresReadinessProbe> = {}): PostgresReadinessProbe {
  return {
    ok: true,
    checkedAt: '2026-07-20T12:00:00.000Z',
    configured: true,
    usable: true,
    target: 'postgresql://db.example.test:5432/cellarflow',
    checks: {
      coreMetadataRead: true,
      organizationStateRead: true,
      loginAttemptStoreRead: true,
      securityAuditStoreRead: true,
      relationalProjectionRead: true,
    },
    errors: [],
    ...overrides,
  };
}

const checkedAt = '2026-07-20T12:34:56.000Z';

describe('service readiness contract', () => {
  it('reports a healthy PostgreSQL database as ready without requiring optional integrations', () => {
    const result = buildServiceReadiness(
      dbStatus(),
      postgresProbe(),
      { NODE_ENV: 'production' },
      checkedAt,
    );

    expect(result).toEqual({
      ok: true,
      checkedAt,
      database: {
        status: 'ready',
        backend: 'postgresql',
        schemaReady: true,
      },
      optionalIntegrations: {
        status: 'ready',
        storageBackup: 'not_configured',
        aiAssistant: 'not_configured',
        email: 'not_configured',
        browserPush: 'not_configured',
        googleOAuth: 'not_configured',
      },
    });
  });

  it('fails readiness generically when the PostgreSQL schema probe fails', () => {
    const result = buildServiceReadiness(
      dbStatus(),
      postgresProbe({
        ok: false,
        usable: false,
        errors: ['relation "OrganizationState" does not exist'],
      }),
      { NODE_ENV: 'production' },
      checkedAt,
    );

    expect(result.ok).toBe(false);
    expect(result.database).toEqual({
      status: 'not_ready',
      backend: 'postgresql',
      schemaReady: false,
      failureClass: 'database_unavailable_or_schema_mismatch',
    });
    expect(JSON.stringify(result)).not.toMatch(/db\.example|OrganizationState|target|errors/);
  });

  it('keeps liveness separate by rejecting local JSON as a production write backend', () => {
    const result = buildServiceReadiness(
      dbStatus({ persistenceMode: 'local-json' }),
      postgresProbe({ configured: false, usable: false }),
      { NODE_ENV: 'production' },
      checkedAt,
    );

    expect(result.ok).toBe(false);
    expect(result.database).toEqual({
      status: 'not_ready',
      backend: 'local_json',
      schemaReady: true,
      failureClass: 'production_local_storage_unsafe',
    });
  });

  it('allows local JSON in development when memory is loaded and writes are healthy', () => {
    const result = buildServiceReadiness(
      dbStatus({ persistenceMode: 'local-json' }),
      postgresProbe({ configured: false, usable: false }),
      { NODE_ENV: 'development' },
      checkedAt,
    );

    expect(result.ok).toBe(true);
    expect(result.database.status).toBe('ready');
  });

  it('reports a failed optional GCS backup as degraded without failing database readiness', () => {
    const result = buildServiceReadiness(
      dbStatus({
        persistenceMode: 'gcs-json',
        gcsEnabled: true,
        gcsUploadError: 'upload unavailable',
      }),
      postgresProbe({ configured: false, usable: false }),
      {
        NODE_ENV: 'production',
        GEMINI_API_KEY: 'configured',
        SMTP_HOST: 'smtp.example.test',
        GOOGLE_CLIENT_ID: 'client',
        GOOGLE_CLIENT_SECRET: 'secret',
      },
      checkedAt,
    );

    expect(result.ok).toBe(true);
    expect(result.database).toMatchObject({ status: 'ready', backend: 'gcs_json' });
    expect(result.optionalIntegrations).toEqual({
      status: 'degraded',
      storageBackup: 'degraded',
      aiAssistant: 'ready',
      email: 'ready',
      browserPush: 'not_configured',
      googleOAuth: 'ready',
    });
  });

  it('reports complete browser-push configuration as ready and partial configuration as degraded', () => {
    const ready = buildServiceReadiness(
      dbStatus(),
      postgresProbe(),
      {
        NODE_ENV: 'production',
        WEB_PUSH_VAPID_PUBLIC_KEY: 'public-key',
        WEB_PUSH_VAPID_PRIVATE_KEY: 'private-key',
        WEB_PUSH_VAPID_SUBJECT: 'mailto:alerts@example.com',
      },
      checkedAt,
    );
    const partial = buildServiceReadiness(
      dbStatus(),
      postgresProbe(),
      { NODE_ENV: 'production', WEB_PUSH_VAPID_PUBLIC_KEY: 'public-key' },
      checkedAt,
    );

    expect(ready.optionalIntegrations.browserPush).toBe('ready');
    expect(ready.optionalIntegrations.status).toBe('ready');
    expect(partial.optionalIntegrations.browserPush).toBe('degraded');
    expect(partial.optionalIntegrations.status).toBe('degraded');
    expect(partial.ok).toBe(true);
  });

  it('fails readiness after an active database write error or before hydration completes', () => {
    const failedWrite = buildServiceReadiness(
      dbStatus({ postgresSaveError: 'write failed' }),
      postgresProbe(),
      { NODE_ENV: 'production' },
      checkedAt,
    );
    const notHydrated = buildServiceReadiness(
      dbStatus({ memoryLoaded: false }),
      postgresProbe(),
      { NODE_ENV: 'production' },
      checkedAt,
    );

    expect(failedWrite.ok).toBe(false);
    expect(notHydrated.ok).toBe(false);
    expect(failedWrite.database.failureClass).toBe('database_unavailable_or_schema_mismatch');
    expect(notHydrated.database.failureClass).toBe('database_unavailable_or_schema_mismatch');
  });
});
