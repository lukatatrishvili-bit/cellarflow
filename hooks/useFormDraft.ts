import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearFormDraft,
  formDraftKey,
  readFormDraft,
  saveFormDraft,
} from '../lib/formDrafts';

interface UseFormDraftOptions<T> {
  formId: string;
  userId: string;
  value: T;
  isMeaningful: (value: T) => boolean;
  onRestore: (value: T) => void;
  autosaveMs?: number;
}

export function useFormDraft<T>({
  formId,
  userId,
  value,
  isMeaningful,
  onRestore,
  autosaveMs = 500,
}: UseFormDraftOptions<T>): {
  restored: boolean;
  clear: () => void;
} {
  const [restored, setRestored] = useState(false);
  const initializedKey = useRef<string | null>(null);
  const serializedValue = useMemo(() => JSON.stringify(value), [value]);
  const currentKey = typeof localStorage === 'undefined'
    ? null
    : formDraftKey(formId, userId);

  useEffect(() => {
    if (!currentKey || initializedKey.current === currentKey) return;
    initializedKey.current = currentKey;
    const draft = readFormDraft<T>(formId, userId);
    if (draft) {
      onRestore(draft);
      setRestored(true);
    }
  }, [currentKey, formId, onRestore, userId]);

  useEffect(() => {
    if (!currentKey || initializedKey.current !== currentKey) return;
    const timer = window.setTimeout(() => {
      if (isMeaningful(value)) {
        saveFormDraft(formId, userId, value);
      } else {
        clearFormDraft(formId, userId);
      }
    }, autosaveMs);
    return () => window.clearTimeout(timer);
  }, [autosaveMs, currentKey, formId, isMeaningful, serializedValue, userId, value]);

  const clear = useCallback(() => {
    if (typeof localStorage !== 'undefined') clearFormDraft(formId, userId);
    setRestored(false);
  }, [formId, userId]);

  return { restored, clear };
}
