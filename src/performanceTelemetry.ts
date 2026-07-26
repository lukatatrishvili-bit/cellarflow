type MetricName = 'LCP' | 'INP' | 'CLS' | 'route_load' | 'offline_start';
type MetricRating = 'good' | 'needs_improvement' | 'poor';

interface PendingMetric {
  name: MetricName;
  value: number;
  rating: MetricRating;
  deviceClass: 'mobile' | 'tablet' | 'desktop';
  networkClass: 'offline' | 'slow' | 'standard' | 'unknown';
  routeClass: 'landing' | 'auth' | 'tasks' | 'billing' | 'public' | 'workspace';
}

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface NetworkInformation {
  effectiveType?: string;
}

interface InteractionPerformanceEntry extends PerformanceEventTiming {
  interactionId?: number;
}

export function performanceRating(name: MetricName, value: number): MetricRating {
  const thresholds: Record<MetricName, [number, number]> = {
    LCP: [2_500, 4_000],
    INP: [200, 500],
    CLS: [0.1, 0.25],
    route_load: [1_500, 3_000],
    offline_start: [2_000, 4_000],
  };
  const [good, poor] = thresholds[name];
  return value <= good ? 'good' : value <= poor ? 'needs_improvement' : 'poor';
}

export function classifyRoute(pathname: string): PendingMetric['routeClass'] {
  if (pathname === '/') return 'landing';
  if (/^\/(?:login|register|forgot-password|reset-password|verify-email|accept-invite)/.test(pathname)) {
    return 'auth';
  }
  if (pathname.startsWith('/tasks')) return 'tasks';
  if (pathname.startsWith('/pricing') || pathname.startsWith('/billing')) return 'billing';
  if (pathname.startsWith('/public')) return 'public';
  return 'workspace';
}

function deviceClass(): PendingMetric['deviceClass'] {
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1_120) return 'tablet';
  return 'desktop';
}

function networkClass(): PendingMetric['networkClass'] {
  if (!navigator.onLine) return 'offline';
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!connection?.effectiveType) return 'unknown';
  return ['slow-2g', '2g', '3g'].includes(connection.effectiveType) ? 'slow' : 'standard';
}

export function startPerformanceTelemetry(): void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  const values = new Map<MetricName, number>();
  const observers: PerformanceObserver[] = [];
  let sent = false;
  let cumulativeLayoutShift = 0;

  const observe = (
    options: PerformanceObserverInit,
    callback: (entry: PerformanceEntry) => void,
  ) => {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) callback(entry);
      });
      observer.observe(options);
      observers.push(observer);
    } catch {
      // Unsupported metric types are expected on older cellar tablets.
    }
  };

  observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit, entry => {
    values.set('LCP', entry.startTime);
  });
  observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit, entry => {
    const shift = entry as LayoutShiftEntry;
    if (!shift.hadRecentInput) {
      cumulativeLayoutShift += shift.value;
      values.set('CLS', cumulativeLayoutShift);
    }
  });
  observe(
    { type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit,
    entry => {
      const event = entry as InteractionPerformanceEntry;
      if (event.interactionId && event.duration > (values.get('INP') || 0)) {
        values.set('INP', event.duration);
      }
    },
  );

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation) {
    const navigationDuration = Math.max(0, navigation.duration);
    values.set(navigator.onLine ? 'route_load' : 'offline_start', navigationDuration);
  }

  const flush = () => {
    if (sent || values.size === 0) return;
    sent = true;
    const common = {
      deviceClass: deviceClass(),
      networkClass: networkClass(),
      routeClass: classifyRoute(window.location.pathname),
    };
    const metrics: PendingMetric[] = [...values].map(([name, value]) => ({
      name,
      value: Math.round(Math.max(0, value) * 1_000) / 1_000,
      rating: performanceRating(name, value),
      ...common,
    }));
    void fetch('/api/telemetry/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ metrics }),
    }).catch(() => {});
    for (const observer of observers) observer.disconnect();
  };

  window.setTimeout(flush, 10_000);
  window.addEventListener('pagehide', flush, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  }, { once: true });
}
