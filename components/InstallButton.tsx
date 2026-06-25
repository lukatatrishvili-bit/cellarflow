import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Language } from '../lib/i18n';

/**
 * PWA install affordance. Renders nothing until the browser fires
 * `beforeinstallprompt` (i.e. the app is installable and not yet installed),
 * then shows an Install button that triggers the native prompt. Hides itself
 * once installed or when already running standalone.
 */
export default function InstallButton({ lang }: { lang: Language }) {
  const [deferred, setDeferred] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (navigator as any).standalone === true;
    if (standalone) { setInstalled(true); return; }

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !deferred) return null;

  const ka = lang === 'ka';
  const install = async () => {
    try {
      deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user dismissed */
    } finally {
      setDeferred(null);
    }
  };

  return (
    <button
      onClick={install}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors shadow-2xs"
      title={ka ? 'აპლიკაციის ინსტალაცია' : 'Install app'}
      aria-label={ka ? 'აპლიკაციის ინსტალაცია' : 'Install app'}
    >
      <Download className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{ka ? 'ინსტალაცია' : 'Install'}</span>
    </button>
  );
}
