import { beforeEach, describe, expect, it } from 'vitest';
import {
  getOperationalTelemetrySnapshot,
  recordClientPerformanceMetric,
  resetOperationalTelemetryForTests,
} from '../server/operationalTelemetry';
import { classifyRoute, performanceRating } from '../src/performanceTelemetry';

beforeEach(() => resetOperationalTelemetryForTests());

describe('privacy-safe browser performance telemetry', () => {
  it('classifies only bounded route categories and standard Web Vital ratings', () => {
    expect(classifyRoute('/')).toBe('landing');
    expect(classifyRoute('/reset-password/private-token')).toBe('auth');
    expect(classifyRoute('/tasks')).toBe('tasks');
    expect(classifyRoute('/workspace/lot/secret-business-id')).toBe('workspace');
    expect(performanceRating('LCP', 2_500)).toBe('good');
    expect(performanceRating('INP', 350)).toBe('needs_improvement');
    expect(performanceRating('CLS', 0.3)).toBe('poor');
  });

  it('reports aggregate p75 and device counts without payload or tenant fields', () => {
    recordClientPerformanceMetric({
      name: 'LCP',
      value: 1_000,
      rating: 'good',
      deviceClass: 'mobile',
      networkClass: 'slow',
      routeClass: 'workspace',
    });
    recordClientPerformanceMetric({
      name: 'LCP',
      value: 3_000,
      rating: 'needs_improvement',
      deviceClass: 'desktop',
      networkClass: 'standard',
      routeClass: 'tasks',
    });

    const snapshot = getOperationalTelemetrySnapshot();
    expect(snapshot.clientPerformance).toMatchObject({
      samples: 2,
      byMetric: {
        LCP: { samples: 2, p75: 3_000, poorRate: 0 },
      },
      byDeviceClass: { mobile: 1, desktop: 1 },
    });
    expect(JSON.stringify(snapshot.clientPerformance)).not.toMatch(/organization|username|pathname|url|payload/i);
  });
});
