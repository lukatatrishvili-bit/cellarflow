export interface UniqueRecordIdOptions {
  now?: number;
  entropy?: string;
}

const safeFragment = (value: string, fallback: string): string => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
  return normalized || fallback;
};

const randomEntropy = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    return `${values[0].toString(36)}${values[1].toString(36)}`.slice(0, 10);
  }
  return Math.random().toString(36).slice(2, 12);
};

/**
 * Creates a server-safe id with enough entropy for rapid/offline double submits,
 * then deterministically suffixes it if the proposed id already exists locally.
 */
export function createUniqueRecordId(
  prefix: string,
  existingIds: Iterable<string>,
  options: UniqueRecordIdOptions = {},
): string {
  const safePrefix = safeFragment(prefix, 'record');
  const timestamp = Number.isSafeInteger(options.now) ? options.now : Date.now();
  const entropy = safeFragment(options.entropy ?? randomEntropy(), 'unique');
  const base = `${safePrefix}-${timestamp}-${entropy}`.slice(0, 120);
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;

  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function createUniqueLotId(
  variety: string,
  vintage: number,
  existingIds: Iterable<string>,
  options: UniqueRecordIdOptions = {},
): string {
  const varietyCode = safeFragment(variety, 'XX').slice(0, 3).toUpperCase();
  return createUniqueRecordId(
    `LOT-${varietyCode}-${vintage}`,
    existingIds,
    options,
  );
}
