import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Language } from '../lib/i18n';
import { IndexedDBQueue, SyncQueueManager } from '../lib/syncQueue';

/**
 * Header connection chip with offline data-safety visibility: shows ONLINE/
 * OFFLINE and how many changes are queued locally waiting to sync — so field
 * users know nothing is lost when the connection drops.
 */
export default function SyncStatus({ lang }: { lang: Language }) {
  const ka = lang === 'ka';
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const queued = await IndexedDBQueue.getMutations();
        const dirty = SyncQueueManager.getDirtyCollections().size;
        if (active) setPending(queued.length + dirty);
      } catch { /* ignore */ }
    };
    const on = () => { setOnline(true); refresh(); };
    const off = () => { setOnline(false); refresh(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      active = false;
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(id);
    };
  }, []);

  const offline = !online;
  const cls = offline
    ? 'bg-amber-50 border-amber-250 text-amber-800 animate-pulse'
    : pending > 0
      ? 'bg-sky-50 border-sky-250 text-sky-800'
      : 'bg-emerald-50 border-emerald-250 text-emerald-800';
  const title = offline
    ? (ka ? 'ოფლაინ — ცვლილებები ინახება და დასინქრონდება' : 'Offline — changes are saved and will sync')
    : pending > 0
      ? (ka ? 'სინქრონიზაცია მიმდინარეობს' : 'Syncing pending changes')
      : (ka ? 'ყველაფერი სინქრონიზებულია' : 'All changes synced');

  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl shadow-2xs text-[10px] font-mono font-bold tracking-wider border transition-all duration-300 ${cls}`} title={title}>
      {offline ? <WifiOff className="w-3 h-3" /> : pending > 0 ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
      <span>{offline ? (ka ? 'ოფლაინ' : 'OFFLINE') : (ka ? 'ონლაინ' : 'ONLINE')}</span>
      {pending > 0 && (
        <span className="px-1.5 py-0.5 bg-white/70 rounded-full text-[9px]">{pending} {ka ? 'მოლოდინში' : 'queued'}</span>
      )}
    </div>
  );
}
