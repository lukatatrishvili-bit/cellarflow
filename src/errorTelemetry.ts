/**
 * Fire-and-forget client crash reporting to /api/telemetry/client-error.
 * Never throws, never blocks rendering; keepalive lets the request survive an
 * imminent page reload (lazyRetry's recovery path). Server keeps a ring buffer
 * surfaced at /api/admin/client-errors for the master admin.
 */
export function privacySafeErrorLocation(pathname: string): string {
  const firstSegment = String(pathname || '')
    .split(/[?#]/, 1)[0]
    .split('/')
    .filter(Boolean)[0];
  return firstSegment ? `/${firstSegment.slice(0, 80)}` : '/';
}

export function reportClientError(source: string, error: unknown): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    void fetch('/api/telemetry/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        source,
        message: err.message,
        stack: err.stack || '',
        // Keep query tokens, entity identifiers, and nested business routes
        // out of crash telemetry. The top-level destination is enough to
        // correlate a release regression.
        url: typeof location !== 'undefined' ? privacySafeErrorLocation(location.pathname) : '',
        appVersion: (import.meta as any).env?.MODE || '',
      }),
    }).catch(() => {});
  } catch {
    /* reporting must never make things worse */
  }
}
