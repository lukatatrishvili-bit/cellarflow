import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ORGANIZATION_STORAGE_KEY,
  FORM_DRAFT_MAX_CHARS,
  clearFormDraft,
  formDraftKey,
  readFormDraft,
  saveFormDraft,
} from '../lib/formDrafts';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values,
  };
}

describe('tenant- and user-scoped form drafts', () => {
  it('isolates drafts by organization, user, and form', () => {
    const storage = memoryStorage({ [ACTIVE_ORGANIZATION_STORAGE_KEY]: 'org-a' });
    expect(saveFormDraft('tasks', 'owner', { title: 'Inspect Q-01' }, { storage })).toBe(true);
    expect(readFormDraft('tasks', 'owner', { storage })).toEqual({ title: 'Inspect Q-01' });
    expect(readFormDraft('tasks', 'reader', { storage })).toBeNull();

    storage.setItem(ACTIVE_ORGANIZATION_STORAGE_KEY, 'org-b');
    expect(readFormDraft('tasks', 'owner', { storage })).toBeNull();
  });

  it('expires old drafts and removes malformed entries', () => {
    const storage = memoryStorage({ [ACTIVE_ORGANIZATION_STORAGE_KEY]: 'org-a' });
    const savedAt = new Date('2026-07-01T00:00:00.000Z');
    expect(saveFormDraft('tasks', 'owner', { title: 'Old' }, {
      storage,
      now: savedAt,
      ttlMs: 1_000,
    })).toBe(true);
    expect(readFormDraft('tasks', 'owner', {
      storage,
      now: new Date('2026-07-01T00:00:02.000Z'),
    })).toBeNull();

    const key = formDraftKey('tasks', 'owner', storage);
    expect(key).not.toBeNull();
    storage.setItem(key!, '{bad json');
    expect(readFormDraft('tasks', 'owner', { storage })).toBeNull();
    expect(storage.getItem(key!)).toBeNull();
  });

  it('rejects secrets, attachment-like fields, cycles, and oversized values', () => {
    const storage = memoryStorage({ [ACTIVE_ORGANIZATION_STORAGE_KEY]: 'org-a' });
    expect(saveFormDraft('unsafe', 'owner', { passcode: 'never-store-me' }, { storage })).toBe(false);
    expect(saveFormDraft('unsafe', 'owner', { attachment: 'data:application/pdf;base64,abc' }, { storage })).toBe(false);
    expect(saveFormDraft('unsafe', 'owner', { notes: 'x'.repeat(FORM_DRAFT_MAX_CHARS) }, { storage })).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(saveFormDraft('unsafe', 'owner', cyclic, { storage })).toBe(false);
  });

  it('clears only the current scoped draft', () => {
    const storage = memoryStorage({ [ACTIVE_ORGANIZATION_STORAGE_KEY]: 'org-a' });
    saveFormDraft('tasks', 'owner', { title: 'Keep nothing' }, { storage });
    clearFormDraft('tasks', 'owner', storage);
    expect(readFormDraft('tasks', 'owner', { storage })).toBeNull();
  });
});
