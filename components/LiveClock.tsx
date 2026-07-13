import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';

interface Props {
  className?: string;
  fallback?: string;
  lang?: Language;
}

/**
 * Self-contained live UTC clock. Owning the per-second interval here means the
 * tick only re-renders this small component instead of the entire App tree.
 */
export default function LiveClock({ className, fallback, lang = 'en' }: Props) {
  const [time, setTime] = useState('');

  useEffect(() => {
    const locale = lang === 'ka' ? 'ka-GE' : 'en-GB';
    const fmt = new Intl.DateTimeFormat(locale, {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZone: 'UTC',
    });
    const update = () => setTime(`${fmt.format(new Date())} UTC`);
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [lang]);

  return <span className={className}>{time || fallback || (lang === 'ka' ? 'იტვირთება UTC...' : 'LOADING UTC...')}</span>;
}
