import { describe, expect, it } from 'vitest';
import { getDeploymentStatus } from '../server/deploymentStatus';

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
    expect(status.integrations.runtimeOAuthConfigAllowed).toBe(false);
    expect(status.ok).toBe(true);
    expect(status.warnings.some((warning) => warning.includes('max instances at 1'))).toBe(true);
    expect(JSON.stringify(status)).not.toContain('secret');
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
});
