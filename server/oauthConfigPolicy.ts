const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'production';
}

export function isRuntimeOAuthConfigAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isProductionEnv(env)) return true;
  return TRUE_VALUES.has(String(env.ALLOW_RUNTIME_OAUTH_CONFIG || '').trim().toLowerCase());
}

export function oauthConfigBlockedMessage(): string {
  return 'Runtime Google OAuth credential configuration is disabled in production. Configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET through Secret Manager or Cloud Run environment variables.';
}
