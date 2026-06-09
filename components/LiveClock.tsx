import React, { useState, useEffect } from 'react';

interface Props {
  className?: string;
  fallback?: string;
}

/**
 * Self-contained live UTC clock. Owning the per-second interval here means the
 * tick only re-renders this small component instead of the entire App tree.
 */
export default function LiveClock({ className, fallback = 'LOADING UTC...' }: Props) {
  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => setTime(new Date().toUTCString().replace('GMT', 'UTC'));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return <span className={className}>{time || fallback}</span>;
}
