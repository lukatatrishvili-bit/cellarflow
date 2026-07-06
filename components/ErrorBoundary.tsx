import React from 'react';
import { reportClientError } from '../src/errorTelemetry';

/**
 * Last-line-of-defense error boundary. Without it, ANY render error anywhere
 * unmounts the whole React tree — an offline cellar tablet shows a permanent
 * white screen with no way out short of clearing the tab. This renders a
 * branded, bilingual recovery card instead, with a reload action and the error
 * text available for support. Also the landing target for lazyRetry's
 * "persistent chunk failure" path.
 *
 * Class component by necessity: error boundaries have no hook equivalent.
 */

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] render error:', error, info.componentStack);
    reportClientError('render-error', error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24,
          background: '#fbf9f6', color: '#1e1915', textAlign: 'center',
          fontFamily: "'Outfit', ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: 9999, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            border: '2px solid rgba(78, 14, 21, 0.25)', color: '#4e0e15',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </div>
        <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 26, fontWeight: 600, color: '#4e0e15' }}>
          Something went wrong
        </div>
        <div style={{ fontSize: 14, maxWidth: 420, color: 'rgba(30,25,21,0.65)' }}>
          The screen hit an unexpected error. Your data is safe — offline work is
          stored locally and syncs on reconnect.
          <br />
          ეკრანზე მოულოდნელი შეცდომა მოხდა. თქვენი მონაცემები დაცულია.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 26px', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: '#4e0e15', color: '#fbf9f6', fontSize: 14, fontWeight: 600,
            letterSpacing: '0.06em',
          }}
        >
          Reload · გადატვირთვა
        </button>
        <details style={{ fontSize: 12, color: 'rgba(30,25,21,0.5)', maxWidth: 520 }}>
          <summary style={{ cursor: 'pointer' }}>Technical details</summary>
          <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left', marginTop: 8 }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        </details>
      </div>
    );
  }
}
