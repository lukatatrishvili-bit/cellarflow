import { gcsEnabled, gcsTarget } from './gcsStore';
import { readDemoAccountConfig } from './demoAccount';
import { isRuntimeOAuthConfigAllowed } from './oauthConfigPolicy';

export interface DeploymentStatus {
  ok: boolean;
  checkedAt: string;
  runtime: {
    nodeEnv: string;
    isCloudRun: boolean;
    service?: string;
    revision?: string;
    configuration?: string;
    region?: string;
  };
  persistence: {
    databaseBackend: 'postgresql-jsonb' | 'gcs' | 'local';
    userDataBackend: 'postgres-jsonb' | 'db-json';
    target: string;
    maxInstancesRecommendation: string;
  };
  scaleReadiness: {
    safeToRaiseMaxInstances: boolean;
    currentRecommendation: string;
    completed: string[];
    blockers: string[];
    nextMilestone: string;
  };
  integrations: {
    geminiConfigured: boolean;
    googleOAuthConfigured: boolean;
    appUrlConfigured: boolean;
    smtpConfigured: boolean;
    demoLoginEnabled: boolean;
    runtimeOAuthConfigAllowed: boolean;
  };
  warnings: string[];
}

export interface RuntimeScaleProbe {
  ok: boolean;
  configured: boolean;
  checks?: {
    coreMetadataRead?: boolean;
    organizationStateRead?: boolean;
    loginAttemptStoreRead?: boolean;
    securityAuditStoreRead?: boolean;
  };
  errors?: string[];
}

function truthy(value: string | undefined): boolean {
  return !!value && value.trim().length > 0 && value !== 'false';
}

function maskDatabaseUrl(value: string | undefined): string {
  if (!value) return '(not configured)';
  try {
    const url = new URL(value);
    const port = url.port ? `:${url.port}` : '';
    const database = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${url.protocol}//${url.hostname}${port}${database}`;
  } catch {
    return '(configured)';
  }
}

function computeScaleReadiness(opts: {
  postgresConfigured: boolean;
  gcsConfigured: boolean;
  isProduction: boolean;
}): DeploymentStatus['scaleReadiness'] {
  const completed: string[] = [];
  const blockers: string[] = [];

  if (opts.postgresConfigured) {
    completed.push('Cloud SQL PostgreSQL is configured as the authoritative database.');
    completed.push('Operational winery state is stored as per-organization JSONB snapshots.');
    completed.push('Organization state sync uses versioned writes and stale-write conflict detection.');
    completed.push('Authenticated /api/db and /api/sync paths refresh organization state from PostgreSQL before serving or merging data.');
    completed.push('Auth, organization, membership, and invitation metadata are refreshed from PostgreSQL during permission checks and key auth/org requests.');
    completed.push('Auth and organization metadata mutations persist durably to PostgreSQL before success responses.');
    completed.push('Login brute-force limiting uses a PostgreSQL-backed shared attempt store when DATABASE_URL is configured.');
  } else if (opts.gcsConfigured) {
    completed.push('Cloud Storage backup/fallback is configured.');
    blockers.push('Primary persistence is still a single JSON object, which is not safe for concurrent Cloud Run instances.');
  } else {
    blockers.push(opts.isProduction
      ? 'Production has no durable PostgreSQL or GCS backend configured.'
      : 'No durable shared backend is configured.');
  }

  return {
    safeToRaiseMaxInstances: blockers.length === 0,
    currentRecommendation: blockers.length === 0 ? 'safe to test >1 with load testing' : 'keep Cloud Run max-instances=1',
    completed,
    blockers,
    nextMilestone: blockers.length === 0
      ? 'Run multi-instance smoke/load tests, then raise Cloud Run max-instances gradually.'
      : 'Move auth/org metadata reads and writes to request-scoped PostgreSQL access, then externalize login rate limiting.',
  };
}

export function getDeploymentStatus(env: NodeJS.ProcessEnv = process.env): DeploymentStatus {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const demo = readDemoAccountConfig(env);
  const isCloudRun = truthy(env.K_SERVICE);
  const gcsConfigured = gcsEnabled || truthy(env.GCS_BUCKET);
  const postgresConfigured = truthy(env.DATABASE_URL);
  const runtimeOAuthConfigAllowed = isRuntimeOAuthConfigAllowed(env);
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  const warn = (message: string, blocking = false) => {
    warnings.push(message);
    if (blocking) blockingIssues.push(message);
  };

  if (isProduction && !postgresConfigured && !gcsConfigured) {
    warn('Production is using local db.json storage. Cloud Run filesystems are ephemeral; configure DATABASE_URL or GCS_BUCKET before real use.', true);
  }
  if (!postgresConfigured && gcsConfigured) {
    warn('GCS db.json persistence is single-object storage. Keep Cloud Run max instances at 1 until PostgreSQL is authoritative.');
  }
  const scaleReadiness = computeScaleReadiness({ postgresConfigured, gcsConfigured, isProduction });

  if (postgresConfigured && !scaleReadiness.safeToRaiseMaxInstances) {
    warn('PostgreSQL JSONB protects operational winery state, but deployment is not yet cleared for multi-instance scaling. Keep Cloud Run max instances at 1.');
    if (gcsConfigured) {
      warn('GCS is configured as a backup/export target after successful PostgreSQL saves.');
    }
  } else if (postgresConfigured) {
    warn('Cloud SQL PostgreSQL paths are multi-instance ready; raise Cloud Run max instances gradually only after smoke/load testing.');
    if (gcsConfigured) {
      warn('GCS is configured as a backup/export target after successful PostgreSQL saves.');
    }
  }
  if (isProduction && !truthy(env.APP_URL)) {
    warn('APP_URL is not configured. OAuth redirects and verification links will fall back to request headers.');
  }
  if (isProduction && !truthy(env.GEMINI_API_KEY)) {
    warn('GEMINI_API_KEY is not configured. AI winemaker features will be unavailable.');
  }
  if (truthy(env.GOOGLE_CLIENT_ID) !== truthy(env.GOOGLE_CLIENT_SECRET)) {
    warn('Google OAuth is partially configured. Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', true);
  }
  if (isProduction && runtimeOAuthConfigAllowed) {
    warn('Runtime Google OAuth credential configuration is enabled in production. Disable ALLOW_RUNTIME_OAUTH_CONFIG and use Secret Manager after maintenance.', true);
  }

  return {
    ok: blockingIssues.length === 0,
    checkedAt: new Date().toISOString(),
    runtime: {
      nodeEnv,
      isCloudRun,
      ...(env.K_SERVICE ? { service: env.K_SERVICE } : {}),
      ...(env.K_REVISION ? { revision: env.K_REVISION } : {}),
      ...(env.K_CONFIGURATION ? { configuration: env.K_CONFIGURATION } : {}),
      ...(env.GOOGLE_CLOUD_REGION ? { region: env.GOOGLE_CLOUD_REGION } : {}),
    },
    persistence: {
      databaseBackend: postgresConfigured ? 'postgresql-jsonb' : gcsConfigured ? 'gcs' : 'local',
      userDataBackend: postgresConfigured ? 'postgres-jsonb' : 'db-json',
      target: postgresConfigured
        ? maskDatabaseUrl(env.DATABASE_URL)
        : gcsConfigured
          ? `gs://${env.GCS_BUCKET || gcsTarget().replace(/^gs:\/\//, '').split('/')[0]}/${env.GCS_DB_OBJECT || 'db.json'}`
          : '(local file)',
      maxInstancesRecommendation: postgresConfigured
        ? (scaleReadiness.safeToRaiseMaxInstances ? '>1 after load testing' : '1')
        : gcsConfigured ? '1' : 'not applicable',
    },
    scaleReadiness,
    integrations: {
      geminiConfigured: truthy(env.GEMINI_API_KEY),
      googleOAuthConfigured: truthy(env.GOOGLE_CLIENT_ID) && truthy(env.GOOGLE_CLIENT_SECRET),
      appUrlConfigured: truthy(env.APP_URL),
      smtpConfigured: truthy(env.SMTP_HOST),
      demoLoginEnabled: demo.enabled,
      runtimeOAuthConfigAllowed,
    },
    warnings,
  };
}

export function applyRuntimeScaleReadinessProbe(
  status: DeploymentStatus,
  probe: RuntimeScaleProbe
): DeploymentStatus {
  if (status.persistence.databaseBackend !== 'postgresql-jsonb' || !probe.configured) {
    return status;
  }

  const completed = [...status.scaleReadiness.completed];
  const blockers = [...status.scaleReadiness.blockers];
  const addCompleted = (message: string) => {
    if (!completed.includes(message)) completed.push(message);
  };
  const addBlocker = (message: string) => {
    if (!blockers.includes(message)) blockers.push(message);
  };

  if (probe.checks?.coreMetadataRead) {
    addCompleted('Live PostgreSQL probe confirmed auth/org metadata tables are readable.');
  } else {
    addBlocker('Live PostgreSQL probe could not read auth/org metadata tables.');
  }

  if (probe.checks?.organizationStateRead) {
    addCompleted('Live PostgreSQL probe confirmed OrganizationState JSONB snapshots are readable.');
  } else {
    addBlocker('Live PostgreSQL probe could not read OrganizationState JSONB snapshots.');
  }

  if (probe.checks?.loginAttemptStoreRead) {
    addCompleted('Live PostgreSQL probe confirmed the shared LoginAttempt limiter table is readable.');
  } else {
    addBlocker('Live PostgreSQL probe could not read the shared LoginAttempt limiter table.');
  }

  if (probe.checks?.securityAuditStoreRead === true) {
    addCompleted('Live PostgreSQL probe confirmed the SecurityAuditEvent table is readable.');
  } else if (probe.checks?.securityAuditStoreRead === false) {
    addBlocker('Live PostgreSQL probe could not read the SecurityAuditEvent table.');
  }

  for (const error of probe.errors || []) {
    addBlocker(error);
  }

  const safeToRaiseMaxInstances = status.scaleReadiness.safeToRaiseMaxInstances && blockers.length === 0;

  return {
    ...status,
    persistence: {
      ...status.persistence,
      maxInstancesRecommendation: safeToRaiseMaxInstances ? '>1 after load testing' : '1',
    },
    scaleReadiness: {
      ...status.scaleReadiness,
      safeToRaiseMaxInstances,
      currentRecommendation: safeToRaiseMaxInstances
        ? 'safe to test >1 with load testing'
        : 'keep Cloud Run max-instances=1',
      completed,
      blockers,
      nextMilestone: safeToRaiseMaxInstances
        ? 'Run multi-instance smoke/load tests, then raise Cloud Run max-instances gradually.'
        : 'Apply the latest Prisma schema, verify Cloud SQL readiness, then rerun the readiness probe.',
    },
  };
}
