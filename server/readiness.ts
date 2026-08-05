import { getDbRuntimeStatus, getPostgresReadinessProbe, type PostgresReadinessProbe } from './db';

export const READINESS_PROBE_TIMEOUT_MS = 3_000;

type DbRuntimeStatus = ReturnType<typeof getDbRuntimeStatus>;
type OptionalState = 'ready' | 'degraded' | 'not_configured';

export interface ServiceReadiness {
  ok: boolean;
  checkedAt: string;
  database: {
    status: 'ready' | 'not_ready';
    backend: 'postgresql' | 'gcs_json' | 'local_json';
    schemaReady: boolean;
    failureClass?: 'database_unavailable_or_schema_mismatch' | 'production_local_storage_unsafe';
  };
  optionalIntegrations: {
    status: 'ready' | 'degraded';
    storageBackup: OptionalState;
    aiAssistant: OptionalState;
    email: OptionalState;
    browserPush: OptionalState;
    googleOAuth: OptionalState;
  };
}

export function buildServiceReadiness(
  dbStatus: DbRuntimeStatus,
  postgresProbe: PostgresReadinessProbe,
  env: NodeJS.ProcessEnv = process.env,
  checkedAt = new Date().toISOString(),
): ServiceReadiness {
  const isProduction = env.NODE_ENV === 'production';
  const backend = dbStatus.persistenceMode === 'postgresql-jsonb'
    ? 'postgresql'
    : dbStatus.persistenceMode === 'gcs-json' ? 'gcs_json' : 'local_json';
  const postgresReady = !postgresProbe.configured || postgresProbe.ok;
  const localProductionUnsafe = isProduction && backend === 'local_json';
  const activeWriteError = backend === 'postgresql'
    ? Boolean(dbStatus.postgres.lastSaveError || dbStatus.postgres.lastMetadataSyncError)
    : Boolean(dbStatus.json.lastLocalSaveError);
  const databaseReady = dbStatus.memory.loaded
    && postgresReady
    && !activeWriteError
    && !localProductionUnsafe;

  const storageBackup: OptionalState = dbStatus.json.gcsEnabled
    ? dbStatus.json.lastGcsUploadError ? 'degraded' : 'ready'
    : 'not_configured';
  const aiAssistant: OptionalState = env.GEMINI_API_KEY?.trim() ? 'ready' : 'not_configured';
  const email: OptionalState = env.SMTP_HOST?.trim() ? 'ready' : 'not_configured';
  const pushValues = [
    env.WEB_PUSH_VAPID_PUBLIC_KEY,
    env.WEB_PUSH_VAPID_PRIVATE_KEY,
    env.WEB_PUSH_VAPID_SUBJECT,
  ];
  const browserPush: OptionalState = pushValues.some(value => value?.trim())
    ? pushValues.every(value => value?.trim()) ? 'ready' : 'degraded'
    : 'not_configured';
  const googleOAuth: OptionalState = env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()
    ? 'ready'
    : 'not_configured';
  const optionalDegraded = [storageBackup, aiAssistant, email, browserPush, googleOAuth].includes('degraded');

  return {
    ok: databaseReady,
    checkedAt,
    database: {
      status: databaseReady ? 'ready' : 'not_ready',
      backend,
      schemaReady: postgresProbe.configured ? postgresProbe.ok : true,
      ...(!databaseReady ? {
        failureClass: localProductionUnsafe
          ? 'production_local_storage_unsafe' as const
          : 'database_unavailable_or_schema_mismatch' as const,
      } : {}),
    },
    optionalIntegrations: {
      status: optionalDegraded ? 'degraded' : 'ready',
      storageBackup,
      aiAssistant,
      email,
      browserPush,
      googleOAuth,
    },
  };
}

export async function getServiceReadiness(): Promise<ServiceReadiness> {
  const dbStatus = getDbRuntimeStatus();
  const timeoutProbe: PostgresReadinessProbe = {
    ok: false,
    checkedAt: new Date().toISOString(),
    configured: Boolean(dbStatus.postgres.configured),
    usable: false,
    target: null,
    checks: {
      coreMetadataRead: false,
      organizationStateRead: false,
      loginAttemptStoreRead: false,
      securityAuditStoreRead: false,
      billingStorageRead: false,
      relationalProjectionRead: false,
    },
    errors: ['Readiness database probe timed out.'],
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const postgresProbe = await Promise.race([
      getPostgresReadinessProbe(),
      new Promise<PostgresReadinessProbe>(resolve => {
        timeout = setTimeout(() => resolve(timeoutProbe), READINESS_PROBE_TIMEOUT_MS);
        timeout.unref?.();
      }),
    ]);
    return buildServiceReadiness(dbStatus, postgresProbe);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
