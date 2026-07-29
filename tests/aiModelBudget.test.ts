import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  getPrismaClientForAdmin: vi.fn(async () => null),
}));

import {
  __resetInMemoryAiModelBudget,
  getAiModelBudget,
  reserveAiModelCalls,
} from '../server/aiModelBudget';

describe('AI model-call budget fallback', () => {
  beforeEach(() => {
    __resetInMemoryAiModelBudget();
  });

  it('reserves the requested calls atomically against one UTC-day ceiling', async () => {
    const now = new Date('2026-07-29T10:00:00.000Z');
    await expect(reserveAiModelCalls('org-1', 3, 2, now)).resolves.toMatchObject({
      granted: true,
      used: 2,
      remaining: 1,
    });
    await expect(reserveAiModelCalls('org-1', 3, 2, now)).resolves.toMatchObject({
      granted: false,
      used: 2,
      remaining: 1,
    });
    await expect(reserveAiModelCalls('org-1', 3, 1, now)).resolves.toMatchObject({
      granted: true,
      used: 3,
      remaining: 0,
    });
  });

  it('keeps organizations separate and resets at the next UTC date', async () => {
    const firstDay = new Date('2026-07-29T23:59:59.000Z');
    const nextDay = new Date('2026-07-30T00:00:00.000Z');
    await reserveAiModelCalls('org-1', 1, 1, firstDay);
    expect((await getAiModelBudget('org-2', 1, firstDay)).used).toBe(0);
    expect((await getAiModelBudget('org-1', 1, nextDay)).used).toBe(0);
  });

  it('fails closed when a request itself exceeds the configured limit', async () => {
    await expect(
      reserveAiModelCalls('org-1', 2, 3, new Date('2026-07-29T10:00:00.000Z')),
    ).resolves.toMatchObject({ granted: false, used: 0, remaining: 2 });
  });
});
