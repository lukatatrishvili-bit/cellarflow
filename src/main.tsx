import React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App';
import ErrorBoundary from '../components/ErrorBoundary';
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
          <App />
        </MotionConfig>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// Register the service worker only in production builds so it never interferes
// with the Vite dev server's hot-module reloading.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort */
    });
  });
}
