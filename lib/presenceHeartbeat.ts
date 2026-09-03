export function startPresenceHeartbeat(): () => void {
  const signal = () => {
    if (document.visibilityState === 'visible') {
      void fetch('/api/auth/presence', { method: 'POST', keepalive: true }).catch(() => undefined);
    }
  };
  signal();
  const interval = window.setInterval(signal, 45_000);
  document.addEventListener('visibilitychange', signal);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', signal);
  };
}
