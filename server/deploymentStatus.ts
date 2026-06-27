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
    databaseBackend: 'gcs' | 'local';
    userDataBackend: 'firestore' | 'db-json';
    target: string;
    maxInstancesRecommendation: string;
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

function truthy(value: string | undefined): boolean {
  return !!value && value.trim().length > 0 && value !== 'false';
}

export function getDeploymentStatus(env: NodeJS.ProcessEnv = process.env): DeploymentStatus {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const demo = readDemoAccountConfig(env);
  const isCloudRun = truthy(env.K_SERVICE);
  const gcsConfigured = gcsEnabled || truthy(env.GCS_BUCKET);
  const firestoreConfigured = env.USE_FIRESTORE === 'true';
  const runtimeOAuthConfigAllowed = isRuntimeOAuthConfigAllowed(env);
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  const warn = (message: string, blocking = false) => {
    warnings.push(message);
    if (blocking) blockingIssues.push(message);
  };

  if (isProduction && !gcsConfigured && !firestoreConfigured) {
    warn('Production is using local db.json storage. Cloud Run filesystems are ephemeral; configure GCS_BUCKET or Firestore before real use.', true);
  }
  if (gcsConfigured) {
    warn('GCS db.json persistence is single-object storage. Keep Cloud Run max instances at 1 until the app moves to per-user objects, Firestore, or SQL.');
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
      databaseBackend: gcsConfigured ? 'gcs' : 'local',
      userDataBackend: firestoreConfigured ? 'firestore' : 'db-json',
      target: gcsConfigured
        ? `gs://${env.GCS_BUCKET || gcsTarget().replace(/^gs:\/\//, '').split('/')[0]}/${env.GCS_DB_OBJECT || 'db.json'}`
        : '(local file)',
      maxInstancesRecommendation: gcsConfigured ? '1' : 'not applicable',
    },
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
