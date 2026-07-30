import { describe, expect, it } from 'vitest';
import type { Alert } from '../lib/alerts';
import {
  buildNotificationFeed,
  type AiNotificationFinding,
} from '../lib/notificationFeed';

function finding(
  overrides: Partial<AiNotificationFinding> = {},
): AiNotificationFinding {
  return {
    id: 'finding-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    source: 'rule',
    area: 'laboratory',
    findingType: 'so2_protection_low',
    severity: 'warning',
    entityType: 'lot',
    entityId: 'L1',
    entityLabel: 'Saperavi',
    relatedEntities: [{ type: 'vessel', id: 'T1' }],
    title: 'Low SO2 protection',
    observation: 'Molecular protection is below the winery target.',
    status: 'new',
    occurrences: 3,
    lastSeenAt: '2026-07-30T11:00:00.000Z',
    ...overrides,
  };
}

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'so2-L1',
    severity: 'warning',
    category: 'so2',
    title: 'Legacy low SO2 alert',
    message: 'Legacy calculation.',
    relatedEntityType: 'lot',
    relatedEntityId: 'L1',
    relatedLotId: 'L1',
    relatedTankId: 'T1',
    ...overrides,
  };
}

describe('buildNotificationFeed', () => {
  it('prefers the richer AI finding when an operational alert describes the same condition', () => {
    const feed = buildNotificationFeed(
      [
        alert(),
        alert({
          id: 'va-L1',
          category: 'va',
          title: 'High VA',
          relatedEntityId: 'L1',
          relatedLotId: 'L1',
        }),
      ],
      [finding()],
    );

    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({
      source: 'ai',
      findingId: 'finding-1',
      category: 'so2',
      relatedLotId: 'L1',
      relatedTankId: 'T1',
      occurrences: 3,
    });
    expect(feed.some((item) => item.category === 'va' && item.source === 'operational')).toBe(true);
    expect(feed.some((item) => item.title === 'Legacy low SO2 alert')).toBe(false);
  });

  it('keeps AI attention distinct while adapting it to the three-level bell severity', () => {
    const feed = buildNotificationFeed([], [
      finding({
        id: 'attention',
        severity: 'attention',
        findingType: 'lab_analysis_overdue',
      }),
    ]);

    expect(feed[0]).toMatchObject({
      source: 'ai',
      severity: 'info',
      aiSeverity: 'attention',
      category: 'intelligence',
    });
  });

  it('carries the server-owned acknowledgement state into the bell item', () => {
    const feed = buildNotificationFeed([], [
      finding({
        unread: false,
        readAt: '2026-07-30T12:00:00.000Z',
        notificationEventKey: 'event-1',
      }),
    ]);

    expect(feed[0]).toMatchObject({
      unread: false,
      readAt: '2026-07-30T12:00:00.000Z',
      notificationEventKey: 'event-1',
    });
  });

  it('keeps separate AI conclusions even when they concern the same lot and category', () => {
    const feed = buildNotificationFeed([], [
      finding({ id: 'pace', findingType: 'fermentation_slowdown', area: 'fermentation' }),
      finding({ id: 'correlation', findingType: 'cross_module_nutrient_risk', area: 'fermentation' }),
    ]);

    expect(feed.map((item) => item.findingId)).toEqual(['pace', 'correlation']);
  });

  it('sorts critical items first and maps temperature findings onto vessels', () => {
    const feed = buildNotificationFeed(
      [alert({ id: 'task', severity: 'warning', category: 'task', relatedLotId: undefined })],
      [
        finding({
          id: 'temperature',
          severity: 'critical',
          findingType: 'fermentation_temperature_high',
          area: 'fermentation',
          entityType: 'vessel',
          entityId: 'T9',
          relatedEntities: [{ type: 'lot', id: 'L9' }],
        }),
      ],
    );

    expect(feed[0]).toMatchObject({
      findingId: 'temperature',
      category: 'temperature',
      relatedTankId: 'T9',
      relatedLotId: 'L9',
      severity: 'critical',
    });
  });
});
