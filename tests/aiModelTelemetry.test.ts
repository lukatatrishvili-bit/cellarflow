import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  prisma: null as any,
}));

vi.mock('../server/db', () => ({
  getPrismaClientForAdmin: vi.fn(async () => mocks.prisma),
}));

import {
  __resetInMemoryAiModelTelemetry,
  getAiModelCallOperations,
  withAiModelCallTelemetry,
} from '../server/aiModelTelemetry';

function clock(...values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

describe('AI model-call telemetry', () => {
  beforeEach(() => {
    mocks.prisma = null;
    __resetInMemoryAiModelTelemetry();
  });

  it('records purpose, outcome, and latency without model content', async () => {
    const value = await withAiModelCallTelemetry({
      organizationId: 'org-1',
      purpose: 'analysis',
      agent: 'laboratory',
      model: 'test-model',
      now: clock(
        '2026-07-30T10:00:00.000Z',
        '2026-07-30T10:00:00.250Z',
      ),
    }, async () => ({
      value: { secretAnswer: 'must never be retained' },
      valid: true,
    }));

    expect(value).toEqual({ secretAnswer: 'must never be retained' });
    const snapshot = await getAiModelCallOperations(
      20,
      new Date('2026-07-30T12:00:00.000Z'),
    );
    expect(snapshot.today).toEqual(expect.objectContaining({
      total: 1,
      succeeded: 1,
      successRate: 1,
      averageLatencyMs: 250,
    }));
    expect(snapshot.byPurpose.analysis.total).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('secretAnswer');
    expect(JSON.stringify(snapshot)).not.toContain('must never be retained');
  });

  it('separates invalid responses from provider failures and stores no error text', async () => {
    await withAiModelCallTelemetry({
      organizationId: 'org-1',
      purpose: 'ask_planner',
      model: 'test-model',
      now: clock(
        '2026-07-30T10:00:00.000Z',
        '2026-07-30T10:00:00.100Z',
      ),
    }, async () => ({ value: null, valid: false }));

    await expect(withAiModelCallTelemetry({
      organizationId: 'org-1',
      purpose: 'ask_explanation',
      model: 'test-model',
      now: clock(
        '2026-07-30T10:01:00.000Z',
        '2026-07-30T10:01:00.200Z',
      ),
    }, async () => {
      throw Object.assign(new Error('private provider payload echoed here'), { status: 429 });
    })).rejects.toThrow('private provider payload');

    const snapshot = await getAiModelCallOperations(
      20,
      new Date('2026-07-30T12:00:00.000Z'),
    );
    expect(snapshot.today).toEqual(expect.objectContaining({
      total: 2,
      invalidResponse: 1,
      failed: 1,
      successRate: 0,
    }));
    expect(snapshot.recentFailures).toEqual([
      expect.objectContaining({
        purpose: 'ask_explanation',
        status: 'failed',
        errorCategory: 'rate_limited',
      }),
      expect.objectContaining({
        purpose: 'ask_planner',
        status: 'invalid_response',
      }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('private provider payload');
  });

  it('prunes fallback telemetry after the 90-day retention window', async () => {
    await withAiModelCallTelemetry({
      organizationId: 'org-1',
      purpose: 'analysis',
      model: 'test-model',
      now: clock(
        '2026-01-01T10:00:00.000Z',
        '2026-01-01T10:00:00.010Z',
      ),
    }, async () => ({ value: true, valid: true }));
    await withAiModelCallTelemetry({
      organizationId: 'org-1',
      purpose: 'analysis',
      model: 'test-model',
      now: clock(
        '2026-07-30T10:00:00.000Z',
        '2026-07-30T10:00:00.010Z',
      ),
    }, async () => ({ value: true, valid: true }));

    expect((await getAiModelCallOperations(
      20,
      new Date('2026-01-01T12:00:00.000Z'),
    )).today.total).toBe(0);
    expect((await getAiModelCallOperations(
      20,
      new Date('2026-07-30T12:00:00.000Z'),
    )).today.total).toBe(1);
  });

  it('records concurrent calls independently', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, index) => (
      withAiModelCallTelemetry({
        organizationId: 'org-1',
        purpose: index % 2 === 0 ? 'analysis' : 'ask_explanation',
        model: 'test-model',
        now: clock(
          '2026-07-30T10:00:00.000Z',
          '2026-07-30T10:00:00.025Z',
        ),
      }, async () => ({ value: index, valid: true }))
    )));

    const snapshot = await getAiModelCallOperations(
      100,
      new Date('2026-07-30T12:00:00.000Z'),
    );
    expect(snapshot.today.total).toBe(25);
    expect(snapshot.today.succeeded).toBe(25);
    expect(snapshot.byPurpose.analysis.total).toBe(13);
    expect(snapshot.byPurpose.ask_explanation.total).toBe(12);
  });

  it('defines no database columns capable of retaining model content', () => {
    const migration = fs.readFileSync(path.resolve(
      'prisma/migrations/20260730100000_ai_model_call_telemetry/migration.sql',
    ), 'utf8');
    for (const forbiddenColumn of [
      '"prompt"',
      '"response"',
      '"question"',
      '"entityId"',
      '"sourceRef"',
      '"payload"',
      '"errorMessage"',
    ]) {
      expect(migration).not.toContain(forbiddenColumn);
    }
  });

  it('does not block the provider call when telemetry storage is unavailable', async () => {
    mocks.prisma = {};
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await withAiModelCallTelemetry({
      organizationId: 'org-1',
      purpose: 'analysis',
      model: 'test-model',
    }, async () => ({ value: 'completed', valid: true }));

    expect(result).toBe('completed');
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('Could not start call telemetry'),
      expect.any(String),
    );
    warning.mockRestore();
  });
});
