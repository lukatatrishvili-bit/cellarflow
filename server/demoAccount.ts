import { hashPassword } from './auth';

export type DemoRole = 'Winemaker' | 'Viticulturist' | 'Lab Technician' | 'Cellar Worker' | 'Read-Only';

export interface DemoAccountConfig {
  enabled: boolean;
  username: string;
  email: string;
  fullName: string;
  role: DemoRole;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const ALLOWED_ROLES = new Set<DemoRole>([
  'Winemaker',
  'Viticulturist',
  'Lab Technician',
  'Cellar Worker',
  'Read-Only',
]);

export function readDemoAccountConfig(env: NodeJS.ProcessEnv = process.env): DemoAccountConfig {
  const requestedRole = String(env.DEMO_ROLE || 'Winemaker') as DemoRole;
  return {
    enabled: TRUE_VALUES.has(String(env.DEMO_LOGIN_ENABLED || '').trim().toLowerCase()),
    username: String(env.DEMO_USERNAME || 'demo').trim().toLowerCase(),
    email: String(env.DEMO_EMAIL || 'demo@vinos.app').trim().toLowerCase(),
    fullName: String(env.DEMO_FULL_NAME || 'Demo Cellar').trim(),
    role: ALLOWED_ROLES.has(requestedRole) ? requestedRole : 'Winemaker',
  };
}

export function createDemoUser(config: DemoAccountConfig) {
  return {
    username: config.username,
    email: config.email,
    fullName: config.fullName,
    role: config.role,
    language: 'en',
    // The public demo route creates the session directly. A random-looking,
    // non-advertised password hash keeps this a normal stored account without
    // publishing reusable credentials.
    passwordHash: hashPassword(`demo-route-only:${config.username}`),
    enabledModules: ['vazi', 'gvino'],
    enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'],
    isDemo: true,
    emailVerified: true,
  };
}
