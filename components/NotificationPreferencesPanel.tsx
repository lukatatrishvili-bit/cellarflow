import React from 'react';
import { Bell, BellOff, BellRing, Clock3, Mail } from 'lucide-react';
import type { Language } from '../lib/i18n';
import {
  announceNotificationPreferenceChange,
  normalizeNotificationQuietMode,
  notificationPauseUntil,
  notificationQuietModeIsActive,
  NOTIFICATION_PREFERENCES_CHANGED_EVENT,
} from '../lib/notificationQuietMode';
import { registerBrowserForPush } from '../lib/webPushClient';

interface NotificationPreferenceState {
  emailEnabled: boolean;
  pushEnabled: boolean;
  notificationsEnabled: boolean;
  notificationsPausedUntil: string | null;
}

interface NotificationAccountState {
  emailConfigured: boolean;
  emailVerified: boolean;
  hasEmail: boolean;
  pushConfigured: boolean;
  pushPublicKey: string;
  pushSubscriptionCount: number;
}

const EMPTY_PREFERENCE: NotificationPreferenceState = {
  emailEnabled: false,
  pushEnabled: false,
  notificationsEnabled: true,
  notificationsPausedUntil: null,
};

const EMPTY_ACCOUNT: NotificationAccountState = {
  emailConfigured: false,
  emailVerified: false,
  hasEmail: false,
  pushConfigured: false,
  pushPublicKey: '',
  pushSubscriptionCount: 0,
};

export default function NotificationPreferencesPanel({
  lang,
  onMessage,
  preferenceScopeKey = '',
}: {
  lang: Language;
  onMessage: (message: string | null) => void;
  preferenceScopeKey?: string;
}) {
  const isKa = lang === 'ka';
  const [preference, setPreference] = React.useState(EMPTY_PREFERENCE);
  const [account, setAccount] = React.useState(EMPTY_ACCOUNT);
  const [loading, setLoading] = React.useState(true);
  const [quietClock, setQuietClock] = React.useState(() => Date.now());
  const [savingChannel, setSavingChannel] = React.useState<'email' | 'push' | 'quiet' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const preferenceScopeRef = React.useRef(preferenceScopeKey);
  preferenceScopeRef.current = preferenceScopeKey;

  const load = React.useCallback(async (scopeKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/notifications/preferences', { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Notification preferences could not be loaded.');
      if (preferenceScopeRef.current !== scopeKey) return;
      setPreference({
        emailEnabled: payload?.preference?.emailEnabled === true,
        pushEnabled: payload?.preference?.pushEnabled === true,
        ...normalizeNotificationQuietMode(payload?.preference),
      });
      setQuietClock(Date.now());
      setAccount({
        emailConfigured: payload?.account?.emailConfigured === true,
        emailVerified: payload?.account?.emailVerified === true,
        hasEmail: payload?.account?.hasEmail === true,
        pushConfigured: payload?.account?.pushConfigured === true,
        pushPublicKey: typeof payload?.account?.pushPublicKey === 'string'
          ? payload.account.pushPublicKey
          : '',
        pushSubscriptionCount: Math.max(0, Number(payload?.account?.pushSubscriptionCount) || 0),
      });
    } catch (loadError) {
      if (preferenceScopeRef.current !== scopeKey) return;
      setError(loadError instanceof Error
        ? loadError.message
        : (isKa ? 'შეტყობინებების პარამეტრები ვერ ჩაიტვირთა.' : 'Notification preferences could not be loaded.'));
    } finally {
      if (preferenceScopeRef.current === scopeKey) setLoading(false);
    }
  }, [isKa]);

  React.useEffect(() => {
    void load(preferenceScopeKey);
    const onPreferenceChanged = (event: Event) => {
      const quiet = normalizeNotificationQuietMode((event as CustomEvent).detail);
      setPreference(current => ({ ...current, ...quiet }));
      setQuietClock(Date.now());
    };
    window.addEventListener(NOTIFICATION_PREFERENCES_CHANGED_EVENT, onPreferenceChanged);
    return () => window.removeEventListener(NOTIFICATION_PREFERENCES_CHANGED_EVENT, onPreferenceChanged);
  }, [load, preferenceScopeKey]);

  React.useEffect(() => {
    if (!preference.notificationsPausedUntil) return;
    const remaining = new Date(preference.notificationsPausedUntil).getTime() - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setQuietClock(Date.now()), Math.min(remaining + 50, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [preference.notificationsPausedUntil]);

  const update = async (channel: 'email' | 'push', enabled: boolean) => {
    setSavingChannel(channel);
    setError(null);
    try {
      if (channel === 'push' && enabled && account.pushSubscriptionCount === 0) {
        if (!account.pushConfigured || !account.pushPublicKey) {
          throw new Error(isKa
            ? 'ბრაუზერის შეტყობინებები ჯერ არ არის კონფიგურირებული.'
            : 'Browser push is not configured yet.');
        }
        await registerBrowserForPush(account.pushPublicKey);
      }
      const next = {
        ...preference,
        [channel === 'email' ? 'emailEnabled' : 'pushEnabled']: enabled,
      };
      const response = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Notification preference could not be saved.');
      setPreference({
        emailEnabled: payload?.preference?.emailEnabled === true,
        pushEnabled: payload?.preference?.pushEnabled === true,
        ...normalizeNotificationQuietMode(payload?.preference),
      });
      setQuietClock(Date.now());
      setAccount(current => ({
        ...current,
        pushSubscriptionCount: Math.max(
          current.pushSubscriptionCount,
          Number(payload?.account?.pushSubscriptionCount) || 0,
        ),
      }));
      onMessage(isKa
        ? 'შეტყობინებების პარამეტრი შენახულია.'
        : 'Notification preference saved.');
    } catch (saveError) {
      const message = saveError instanceof Error
        ? saveError.message
        : (isKa ? 'პარამეტრი ვერ შეინახა.' : 'The preference could not be saved.');
      setError(message);
      onMessage(`⚠️ ${message}`);
    } finally {
      setSavingChannel(null);
    }
  };

  const updateQuietMode = async (patch: { notificationsEnabled: boolean; notificationsPausedUntil: string | null }) => {
    setSavingChannel('quiet');
    setError(null);
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Notification preference could not be saved.');
      const quiet = normalizeNotificationQuietMode(payload?.preference);
      setPreference(current => ({ ...current, ...quiet }));
      setQuietClock(Date.now());
      announceNotificationPreferenceChange(quiet);
      onMessage(isKa ? 'შეტყობინებების რეჟიმი განახლდა.' : 'Notification mode updated.');
    } catch (saveError) {
      const message = saveError instanceof Error
        ? saveError.message
        : (isKa ? 'დადუმება ვერ შეინახა.' : 'Quiet mode could not be saved.');
      setError(message);
      onMessage(`⚠️ ${message}`);
    } finally {
      setSavingChannel(null);
    }
  };

  const pushSupported = typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator;
  const emailAvailable = account.emailConfigured && account.emailVerified && account.hasEmail;
  const pushAvailable = account.pushConfigured && pushSupported;
  const quietActive = notificationQuietModeIsActive(preference, new Date(quietClock));
  const pauseLabel = preference.notificationsPausedUntil
    ? new Date(preference.notificationsPausedUntil).toLocaleString(isKa ? 'ka-GE' : undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : '';

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 dark:border-sky-900/60 dark:bg-sky-950/20">
      <div className="mb-3">
        <h4 className="font-serif text-sm font-black text-[#4e0e15] dark:text-amber-100">
          {isKa ? 'პირადი შეტყობინებები' : 'Personal notifications'}
        </h4>
        <p className="mt-1 text-[9.5px] leading-relaxed text-stone-500 dark:text-stone-400">
          {isKa
            ? 'ეს პარამეტრები მოქმედებს ამ მარანში დანიშნულ დავალებებსა და თქვენთვის განკუთვნილ ინტელექტის შეტყობინებებზე.'
            : 'These switches control task assignments and routed intelligence alerts for this winery.'}
        </p>
      </div>

      <div className={`mb-3 rounded-xl border p-3 ${quietActive ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30' : 'border-sky-200 bg-white dark:border-sky-900 dark:bg-stone-950/40'}`}>
        <div className="flex items-start gap-3">
          {quietActive
            ? <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            : <Bell className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />}
          <div className="min-w-0 flex-1">
            <strong className="block text-[10.5px] text-stone-800 dark:text-stone-100">
              {quietActive
                ? (preference.notificationsEnabled ? (isKa ? 'დროებით დადუმებულია' : 'Temporarily paused') : (isKa ? 'სრულად გამორთულია' : 'Notifications off'))
                : (isKa ? 'ყველა შეტყობინება აქტიურია' : 'Notifications are active')}
            </strong>
            <span className="mt-0.5 block text-[9px] leading-relaxed text-stone-500 dark:text-stone-400">
              {quietActive
                ? (preference.notificationsEnabled
                  ? (isKa ? `აპი, ელფოსტა და Push დადუმებულია ${pauseLabel}-მდე.` : `In-app, email, and push are paused until ${pauseLabel}.`)
                  : (isKa ? 'არცერთი არხით შეტყობინება არ გაიგზავნება.' : 'No channel will deliver notifications.'))
                : (isKa ? 'შეგიძლიათ დროებით შეაჩეროთ ყველა არხი ან სრულად გამორთოთ.' : 'Pause every channel temporarily or turn all notifications off.')}
            </span>
          </div>
        </div>
        <div className={`mt-3 grid gap-2 ${quietActive ? 'grid-cols-1' : 'grid-cols-3'}`}>
          {quietActive ? (
            <button type="button" disabled={loading || savingChannel !== null} onClick={() => void updateQuietMode({ notificationsEnabled: true, notificationsPausedUntil: null })} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-sky-700 px-3 text-[10px] font-black text-white disabled:opacity-50">
              <BellRing className="h-3.5 w-3.5" />{isKa ? 'ახლავე ჩართვა' : 'Resume now'}
            </button>
          ) : (
            <>
              <button type="button" disabled={loading || savingChannel !== null} onClick={() => void updateQuietMode({ notificationsEnabled: true, notificationsPausedUntil: notificationPauseUntil('hour') })} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-[9px] font-bold text-stone-700 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
                <Clock3 className="h-3.5 w-3.5" />{isKa ? '1 საათი' : '1 hour'}
              </button>
              <button type="button" disabled={loading || savingChannel !== null} onClick={() => void updateQuietMode({ notificationsEnabled: true, notificationsPausedUntil: notificationPauseUntil('today') })} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-[9px] font-bold text-stone-700 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200">
                <Clock3 className="h-3.5 w-3.5" />{isKa ? 'დღის ბოლომდე' : 'Rest of day'}
              </button>
              <button type="button" disabled={loading || savingChannel !== null} onClick={() => void updateQuietMode({ notificationsEnabled: false, notificationsPausedUntil: null })} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-[9px] font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                <BellOff className="h-3.5 w-3.5" />{isKa ? 'გამორთვა' : 'Turn off'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`flex items-start justify-between gap-3 rounded-lg border bg-white p-3 ${emailAvailable ? 'cursor-pointer border-sky-200' : 'border-stone-200 opacity-70'}`}>
          <span className="flex min-w-0 gap-2.5">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
            <span>
              <span className="block text-[10.5px] font-bold text-stone-800">
                {isKa ? 'ელფოსტის შეტყობინებები' : 'Email notifications'}
              </span>
              <span className="mt-0.5 block text-[9px] font-normal leading-relaxed text-stone-500">
                {emailAvailable
                  ? (isKa ? 'იგზავნება თქვენი დადასტურებული ანგარიშის ელფოსტაზე.' : 'Sent to your verified account email.')
                  : (isKa ? 'ჯერ დაადასტურეთ ელფოსტა ან დააკონფიგურირეთ ელფოსტის სერვისი.' : 'Verify your email or configure the email service first.')}
              </span>
            </span>
          </span>
          <input
            type="checkbox"
            checked={preference.emailEnabled}
            disabled={loading || savingChannel !== null || !emailAvailable}
            onChange={(event) => void update('email', event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-sky-700"
          />
        </label>

        <label className={`flex items-start justify-between gap-3 rounded-lg border bg-white p-3 ${pushAvailable ? 'cursor-pointer border-sky-200' : 'border-stone-200 opacity-70'}`}>
          <span className="flex min-w-0 gap-2.5">
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
            <span>
              <span className="block text-[10.5px] font-bold text-stone-800">
                {isKa ? 'ბრაუზერის Push შეტყობინებები' : 'Browser push notifications'}
              </span>
              <span className="mt-0.5 block text-[9px] font-normal leading-relaxed text-stone-500">
                {pushAvailable
                  ? (isKa ? 'პირველად ჩართვისას ბრაუზერი ნებართვას მოგთხოვთ.' : 'Your browser asks for permission the first time you enable this.')
                  : (isKa ? 'ამ ბრაუზერში Push შეტყობინებები მიუწვდომელია ან ჯერ არ არის კონფიგურირებული.' : 'Push is unavailable in this browser or is not configured yet.')}
              </span>
            </span>
          </span>
          <input
            type="checkbox"
            checked={preference.pushEnabled}
            disabled={loading || savingChannel !== null || !pushAvailable}
            onChange={(event) => void update('push', event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-sky-700"
          />
        </label>
      </div>

      {error && <p role="alert" className="mt-3 text-[9.5px] font-semibold text-rose-700">{error}</p>}
    </section>
  );
}
