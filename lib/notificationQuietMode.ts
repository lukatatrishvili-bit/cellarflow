export const NOTIFICATION_PREFERENCES_CHANGED_EVENT = 'vinos:notification-preferences-changed';

export interface NotificationQuietMode {
  notificationsEnabled: boolean;
  notificationsPausedUntil: string | null;
}

export function normalizeNotificationQuietMode(value: unknown): NotificationQuietMode {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const candidate = typeof raw.notificationsPausedUntil === 'string'
    ? new Date(raw.notificationsPausedUntil)
    : null;
  return {
    notificationsEnabled: raw.notificationsEnabled !== false,
    notificationsPausedUntil: candidate && !Number.isNaN(candidate.getTime())
      ? candidate.toISOString()
      : null,
  };
}

export function notificationQuietModeIsActive(
  preference: NotificationQuietMode,
  now: Date = new Date(),
): boolean {
  if (!preference.notificationsEnabled) return true;
  if (!preference.notificationsPausedUntil) return false;
  return new Date(preference.notificationsPausedUntil).getTime() > now.getTime();
}

export function notificationPauseUntil(
  duration: 'hour' | 'today',
  now: Date = new Date(),
): string {
  if (duration === 'hour') {
    return new Date(now.getTime() + 60 * 60 * 1_000).toISOString();
  }
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return endOfDay.toISOString();
}

export function announceNotificationPreferenceChange(preference: NotificationQuietMode): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFICATION_PREFERENCES_CHANGED_EVENT, {
    detail: preference,
  }));
}
