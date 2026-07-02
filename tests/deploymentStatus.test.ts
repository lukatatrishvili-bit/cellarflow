import { describe, expect, it } from 'vitest';
import { applyRuntimeScaleReadinessProbe, getDeploymentStatus } from '../server/deploymentStatus';

describe('deployment status', () => {
  it('warns when production uses ephemeral local storage', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      K_SERVICE: 'cellarflow-app',
    });

    expect(status.runtime.isCloudRun).toBe(true);
    expect(status.persistence.databaseBackend).toBe('local');
    expect(status.ok).toBe(false);
    expect(status.warnings.some((warning) => warning.includes('ephemeral'))).toBe(true);
  });

  it('reports GCS-backed Cloud Run persistence without exposing secrets', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      K_SERVICE: 'cellarflow-app',
      K_REVISION: 'cellarflow-app-00001-abc',
      K_CONFIGURATION: 'cellarflow-app',
      GOOGLE_CLOUD_REGION: 'europe-west1',
      GCS_BUCKET: 'cellarflow-db',
      GCS_DB_OBJECT: 'prod/db.json',
      APP_URL: 'https://example.run.app',
      GEMINI_API_KEY: 'secret',
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
    });

    expect(status.runtime).toMatchObject({
      isCloudRun: true,
      service: 'cellarflow-app',
      revision: 'cellarflow-app-00001-abc',
      region: 'europe-west1',
    });
    expect(status.persistence).toMatchObject({
      databaseBackend: 'gcs',
      target: 'gs://cellarflow-db/prod/db.json',
      maxInstancesRecommendation: '1',
    });
    expect(status.scaleReadiness).toMatchObject({
      safeToRaiseMaxInstances: false,
      currentRecommendation: 'keep Cloud Run max-instances=1',
    });
    expect(status.scaleReadiness.blockers.some((blocker) => blocker.includes('single JSON object'))).toBe(true);
    expect(status.integrations.runtimeOAuthConfigAllowed).toBe(false);
    expect(status.ok).toBe(true);
    expect(status.warnings.some((warning) => warning.includes('max instances at 1'))).toBe(true);
    expect(JSON.stringify(status)).not.toContain('secret');
  });

  it('reports Cloud SQL PostgreSQL JSONB as the authoritative production backend', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      K_SERVICE: 'cellarflow-app',
      GOOGLE_CLOUD_REGION: 'europe-west1',
      DATABASE_URL: 'postgresql://cellarflow:super-secret@10.1.2.3:5432/cellarflow',
      GCS_BUCKET: 'cellarflow-db',
      APP_URL: 'https://example.run.app',
      GEMINI_API_KEY: 'secret',
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
    });

    expect(status.persistence).toMatchObject({
      databaseBackend: 'postgresql-jsonb',
      userDataBackend: 'postgres-jsonb',
      target: 'postgresql://10.1.2.3:5432/cellarflow',
      maxInstancesRecommendation: '>1 after load testing',
    });
    expect(status.scaleReadiness.safeToRaiseMaxInstances).toBe(true);
    expect(status.scaleReadiness.completed.some((item) => item.includes('versioned writes'))).toBe(true);
    expect(status.scaleReadiness.completed.some((item) => item.includes('/api/db and /api/sync'))).toBe(true);
    expect(status.scaleReadiness.completed.some((item) => item.includes('Auth, organization, membership'))).toBe(true);
    expect(status.scaleReadiness.completed.some((item) => item.includes('Login brute-force'))).toBe(true);
    expect(status.scaleReadiness.blockers).toEqual([]);
    expect(status.ok).toBe(true);
    expect(status.warnings.some((warning) => warning.includes('multi-instance ready'))).toBe(true);
    expect(status.warnings.some((warning) => warning.includes('backup/export'))).toBe(true);
    expect(JSON.stringify(status)).not.toContain('super-secret');
  });

  it('flags partial Google OAuth configuration', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      GCS_BUCKET: 'cellarflow-db',
      APP_URL: 'https://example.run.app',
      GEMINI_API_KEY: 'secret',
      GOOGLE_CLIENT_ID: 'client',
    });

    expect(status.integrations.googleOAuthConfigured).toBe(false);
    expect(status.ok).toBe(false);
    expect(status.warnings.some((warning) => warning.includes('partially configured'))).toBe(true);
  });

  it('flags runtime OAuth configuration when enabled in production', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      GCS_BUCKET: 'cellarflow-db',
      APP_URL: 'https://example.run.app',
      GEMINI_API_KEY: 'secret',
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
      ALLOW_RUNTIME_OAUTH_CONFIG: 'true',
    });

    expect(status.integrations.runtimeOAuthConfigAllowed).toBe(true);
    expect(status.ok).toBe(false);
    expect(status.warnings.some((warning) => warning.includes('Runtime Google OAuth'))).toBe(true);
  });

  it('keeps PostgreSQL scaling ready when the live schema probe passes', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://cellarflow:super-secret@10.1.2.3:5432/cellarflow',
      APP_URL: 'https://example.run.app',
      GEMINI_API_KEY: 'secret',
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
    });

    const probed = applyRuntimeScaleReadinessProbe(status, {
      ok: true,
      configured: true,
      checks: {
        coreMetadataRead: true,
        organizationStateRead: true,
        loginAttemptStoreRead: true,
      },
      errors: [],
    });

    expect(probed.scaleReadiness.safeToRaiseMaxInstances).toBe(true);
    expect(probed.persistence.maxInstancesRecommendation).toBe('>1 after load testing');
    expect(probed.scaleReadiness.completed.some((item) => item.includes('Live PostgreSQL probe confirmed'))).toBe(true);
    expect(probed.scaleReadiness.blockers).toEqual([]);
  });

  it('blocks PostgreSQL scaling when the live login-attempt table probe fails', () => {
    const status = getDeploymentStatus({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://cellarflow:super-secret@10.1.2.3:5432/cellarflow',
      APP_URL: 'https://example.run.app',
      GEMINI_API_KEY: 'secret',
      GOOGLE_CLIENT_ID: 'client',
      GOOGLE_CLIENT_SECRET: 'secret',
    });

    const probed = applyRuntimeScaleReadinessProbe(status, {
      ok: false,
      configured: true,
      checks: {
        coreMetadataRead: true,
        organizationStateRead: true,
        loginAttemptStoreRead: false,
      },
      errors: ['LoginAttempt Prisma model is not available in the generated client.'],
    });

    expect(probed.scaleReadiness.safeToRaiseMaxInstances).toBe(false);
    expect(probed.persistence.maxInstancesRecommendation).toBe('1');
    expect(probed.scaleReadiness.currentRecommendation).toBe('keep Cloud Run max-instances=1');
    expect(probed.scaleReadiness.blockers.some((blocker) => blocker.includes('LoginAttempt'))).toBe(true);
  });
});
