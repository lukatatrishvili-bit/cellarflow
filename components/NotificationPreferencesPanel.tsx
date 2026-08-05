import React from 'react';
import { BellRing, Mail } from 'lucide-react';
import type { Language } from '../lib/i18n';
import { registerBrowserForPush } from '../lib/webPushClient';

interface NotificationPreferenceState {
  emailEnabled: boolean;
  pushEnabled: boolean;
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
}: {
  lang: Language;
  onMessage: (message: string | null) => void;
}) {
  const isKa = lang === 'ka';
  const [preference, setPreference] = React.useState(EMPTY_PREFERENCE);
  const [account, setAccount] = React.useState(EMPTY_ACCOUNT);
  const [loading, setLoading] = React.useState(true);
  const [savingChannel, setSavingChannel] = React.useState<'email' | 'push' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/notifications/preferences', { credentials: 'include' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Notification preferences could not be loaded.');
      setPreference({
        emailEnabled: payload?.preference?.emailEnabled === true,
        pushEnabled: payload?.preference?.pushEnabled === true,
      });
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
      setError(loadError instanceof Error
        ? loadError.message
        : (isKa ? 'შეტყობინებების პარამეტრები ვერ ჩაიტვირთა.' : 'Notification preferences could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [isKa]);

  React.useEffect(() => {
    void load();
  }, [load]);

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
      });
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

  const pushSupported = typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator;
  const emailAvailable = account.emailConfigured && account.emailVerified && account.hasEmail;
  const pushAvailable = account.pushConfigured && pushSupported;

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
