import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationQuietMode,
  notificationPauseUntil,
  notificationQuietModeIsActive,
} from '../lib/notificationQuietMode';

describe('notification quiet mode', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');

  it('keeps existing accounts enabled and rejects malformed pause timestamps', () => {
    expect(normalizeNotificationQuietMode(null)).toEqual({
      notificationsEnabled: true,
      notificationsPausedUntil: null,
    });
    expect(normalizeNotificationQuietMode({ notificationsPausedUntil: 'not-a-date' })).toEqual({
      notificationsEnabled: true,
      notificationsPausedUntil: null,
    });
  });

  it('supports indefinite disable and automatically expires a temporary pause', () => {
    expect(notificationQuietModeIsActive({
      notificationsEnabled: false,
      notificationsPausedUntil: null,
    }, now)).toBe(true);
    expect(notificationQuietModeIsActive({
      notificationsEnabled: true,
      notificationsPausedUntil: '2026-08-24T13:00:00.000Z',
    }, now)).toBe(true);
    expect(notificationQuietModeIsActive({
      notificationsEnabled: true,
      notificationsPausedUntil: '2026-08-24T11:59:59.000Z',
    }, now)).toBe(false);
  });

  it('builds bounded one-hour and end-of-day pauses', () => {
    expect(notificationPauseUntil('hour', now)).toBe('2026-08-24T13:00:00.000Z');
    const endOfDay = new Date(notificationPauseUntil('today', now));
    expect(endOfDay.getTime()).toBeGreaterThan(now.getTime());
    expect(endOfDay.getHours()).toBe(23);
    expect(endOfDay.getMinutes()).toBe(59);
  });
});
