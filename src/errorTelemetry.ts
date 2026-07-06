/**
 * Fire-and-forget client crash reporting to /api/telemetry/client-error.
 * Never throws, never blocks rendering; keepalive lets the request survive an
 * imminent page reload (lazyRetry's recovery path). Server keeps a ring buffer
 * surfaced at /api/admin/client-errors for the master admin.
 */
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
        url: typeof location !== 'undefined' ? location.href : '',
        appVersion: (import.meta as any).env?.MODE || '',
      }),
    }).catch(() => {});
  } catch {
    /* reporting must never make things worse */
  }
}
