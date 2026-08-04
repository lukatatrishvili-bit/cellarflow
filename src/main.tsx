import React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App';
import ErrorBoundary from '../components/ErrorBoundary';
import { StatusToastProvider } from '../hooks/useStatusToast';
import './globals.css';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      {/* reducedMotion="user" makes every Framer Motion animation respect the
          OS "reduce motion" setting globally — accessibility + battery on tablets. */}
      <ErrorBoundary>
        <MotionConfig reducedMotion="user">
          {/* Must sit ABOVE App: useWineryState reads the toast controls during
              App's own render, and keeping the message in a provider up here is
              what stops a toast from re-rendering the whole shell. */}
          <StatusToastProvider>
            <App />
          </StatusToastProvider>
        </MotionConfig>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

if (import.meta.env.PROD) {
  const startTelemetry = () => {
    void import('./performanceTelemetry')
      .then(({ startPerformanceTelemetry }) => startPerformanceTelemetry())
      .catch(() => {});
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(startTelemetry, { timeout: 2_000 });
  } else {
    setTimeout(startTelemetry, 0);
  }
}

// Register the service worker only in production builds so it never interferes
// with the Vite dev server's hot-module reloading.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Cellar tablets keep one session open for days; without a periodic
        // check they only discover new deploys on a manual reload.
        setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      })
      .catch(() => {
        /* offline support is best-effort */
      });

    // sw.js calls skipWaiting()+clients.claim(), so a new version taking over
    // fires `controllerchange`. The first claim on an uncontrolled page also
    // fires it — that's the fresh-install case, not an update, so skip it.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      // App.tsx listens and shows a non-blocking "new version ready" banner —
      // never auto-reload: a cellar worker may be mid-form.
      window.dispatchEvent(new CustomEvent('vinos:sw-updated'));
    });
  });
}
