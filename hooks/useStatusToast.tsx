import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Toast state, deliberately kept OUT of `useWineryState`.
 *
 * Toasts are the most frequent state change in the app and the least connected
 * to what is on screen: every sync result, every save, every connectivity flip
 * raises one, and each auto-dismisses five seconds later. While the message
 * lived in the main state hook, both the raise and the dismiss re-rendered
 * `App` and — because no tab is memoized against new prop identities — whichever
 * module was open. A cellar worker mid-form paid a full re-render of the
 * fermentation tab because an unrelated toast timed out.
 *
 * The split into two contexts is what makes that stop. Writers subscribe to
 * `StatusToastControlsContext`, whose value is allocated once and never changes, so
 * they never re-render when a toast appears. Only `StatusToastHost` subscribes to the
 * message itself.
 *
 * Keep them separate. Merging the setter into the message context would restore
 * the original behaviour exactly, because context consumers re-render whenever
 * the provided value's identity changes.
 */

const TOAST_DISMISS_MS = 5000;

interface StatusToastControls {
  setToastMessage: (message: string | null) => void;
}

const StatusToastMessageContext = createContext<string | null>(null);
const StatusToastControlsContext = createContext<StatusToastControls | null>(null);

export function StatusToastProvider({ children }: { children: React.ReactNode }) {
  const [toastMessage, setToastMessageState] = useState<string | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setToastMessage = useCallback((message: string | null) => {
    setToastMessageState(message);
  }, []);

  // Auto-dismiss. Scheduling from the message keeps a later toast from being
  // cut short by an earlier one's timer.
  useEffect(() => {
    if (!toastMessage) return;
    dismissTimer.current = setTimeout(() => setToastMessageState(null), TOAST_DISMISS_MS);
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    };
  }, [toastMessage]);

  // Stable for the lifetime of the provider — this is the property that keeps
  // writers out of the re-render path.
  const controls = useMemo<StatusToastControls>(() => ({ setToastMessage }), [setToastMessage]);

  return (
    <StatusToastControlsContext.Provider value={controls}>
      <StatusToastMessageContext.Provider value={toastMessage}>
        {children}
      </StatusToastMessageContext.Provider>
    </StatusToastControlsContext.Provider>
  );
}

/**
 * Raise or clear a toast without subscribing to the current one.
 *
 * Safe to call outside a provider: it degrades to a no-op rather than throwing,
 * so tests and storybook-style harnesses can mount a subtree on its own.
 */
export function useStatusToastControls(): StatusToastControls {
  const controls = useContext(StatusToastControlsContext);
  const fallback = useMemo<StatusToastControls>(() => ({ setToastMessage: () => {} }), []);
  return controls ?? fallback;
}

/** Subscribe to the current toast. Only the rendering host should use this. */
export function useStatusToastMessage(): string | null {
  return useContext(StatusToastMessageContext);
}
