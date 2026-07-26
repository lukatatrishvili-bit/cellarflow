export const FORM_DRAFT_PREFIX = 'cellarflow_form_draft';
export const FORM_DRAFT_SCHEMA_VERSION = 1;
export const FORM_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const FORM_DRAFT_MAX_CHARS = 48_000;
export const ACTIVE_ORGANIZATION_STORAGE_KEY = 'cellarflow_org_state_org_id';

interface FormDraftEnvelope<T> {
  version: number;
  savedAt: string;
  expiresAt: string;
  value: T;
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const SENSITIVE_KEY = /(pass(word|code)?|secret|token|credential|api.?key|authorization|cookie|attachment|binary|blob|data.?url)/i;

function activeOrganizationId(storage: DraftStorage): string {
  return storage.getItem(ACTIVE_ORGANIZATION_STORAGE_KEY)?.trim() || '';
}

function safeScopePart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function formDraftKey(
  formId: string,
  userId: string,
  storage: DraftStorage = localStorage,
): string | null {
  const organizationId = activeOrganizationId(storage);
  if (!organizationId || !userId.trim() || !formId.trim()) return null;
  return [
    FORM_DRAFT_PREFIX,
    FORM_DRAFT_SCHEMA_VERSION,
    safeScopePart(organizationId),
    safeScopePart(userId),
    safeScopePart(formId),
  ].join(':');
}

function draftValueIsSafe(value: unknown, key = '', seen = new Set<object>()): boolean {
  if (SENSITIVE_KEY.test(key)) return false;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
  if (typeof value !== 'object') return false;
  if (typeof File !== 'undefined' && value instanceof File) return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.every(item => draftValueIsSafe(item, '', seen));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.entries(value as Record<string, unknown>)
    .every(([childKey, child]) => draftValueIsSafe(child, childKey, seen));
}

export function saveFormDraft<T>(
  formId: string,
  userId: string,
  value: T,
  options: {
    storage?: DraftStorage;
    now?: Date;
    ttlMs?: number;
  } = {},
): boolean {
  const storage = options.storage || localStorage;
  const key = formDraftKey(formId, userId, storage);
  if (!key || !draftValueIsSafe(value)) return false;
  const now = options.now || new Date();
  const envelope: FormDraftEnvelope<T> = {
    version: FORM_DRAFT_SCHEMA_VERSION,
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (options.ttlMs ?? FORM_DRAFT_TTL_MS)).toISOString(),
    value,
  };
  const serialized = JSON.stringify(envelope);
  if (serialized.length > FORM_DRAFT_MAX_CHARS) return false;
  try {
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function readFormDraft<T>(
  formId: string,
  userId: string,
  options: { storage?: DraftStorage; now?: Date } = {},
): T | null {
  const storage = options.storage || localStorage;
  const key = formDraftKey(formId, userId, storage);
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Partial<FormDraftEnvelope<T>>;
    const expiresAt = Date.parse(String(envelope.expiresAt || ''));
    if (
      envelope.version !== FORM_DRAFT_SCHEMA_VERSION
      || !Number.isFinite(expiresAt)
      || expiresAt <= (options.now || new Date()).getTime()
      || !draftValueIsSafe(envelope.value)
    ) {
      storage.removeItem(key);
      return null;
    }
    return envelope.value as T;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearFormDraft(
  formId: string,
  userId: string,
  storage: DraftStorage = localStorage,
): void {
  const key = formDraftKey(formId, userId, storage);
  if (!key) return;
  try {
    storage.removeItem(key);
  } catch {
    // Draft cleanup must never block a confirmed operational command.
  }
}
