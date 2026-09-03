import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  clientEditableCollectionKeys,
  collectionForKey,
  collectionKeys,
  collectionStorageKeys,
  COLLECTIONS,
  serverCommandCollectionKeys,
} from '../lib/collectionRegistry';
import { TENANT_CACHE_KEYS } from '../lib/tenantCache';

/** Tenant keys that are not collections, mirrored from lib/tenantCache.ts. */
const NON_COLLECTION_TENANT_KEYS = ['vinea_company_profile', 'vinea_last_sync_at'];

/**
 * The registry is only worth having if it matches the code it describes. These
 * read `useWineryState` directly rather than trusting the registry, so the two
 * cannot drift.
 */

const registrySource = fs.readFileSync(
  path.resolve(__dirname, '../lib/collectionRegistry.ts'),
  'utf8',
);

const hookSource = fs.readFileSync(
  path.resolve(__dirname, '../hooks/useWineryState.ts'),
  'utf8',
);

/** `handleCollectionUpdate('key', 'storageKey', value)` — the persistence effects. */
function persistedCollections(): Array<{ key: string; storageKey: string }> {
  return [...hookSource.matchAll(/handleCollectionUpdate\('([a-zA-Z]+)',\s*'([a-z_]+)'/g)]
    .map(match => ({ key: match[1], storageKey: match[2] }));
}

/** Keys of the `setters` map that decides which collections get stamped back. */
function setterMapKeys(): string[] {
  const block = /const setters: Record<string, any> = \{([\s\S]*?)\n {4}\};/.exec(hookSource);
  if (!block) throw new Error('Could not locate the setters map in useWineryState.ts');
  return [...block[1].matchAll(/^\s{6}([a-zA-Z]+):/gm)].map(match => match[1]);
}

describe('collection registry', () => {
  it('covers exactly the collections the hook persists', () => {
    const persisted = persistedCollections();
    expect(persisted.length).toBeGreaterThan(30); // the scan found something real
    expect([...new Set(persisted.map(p => p.key))].sort()).toEqual(collectionKeys().sort());
  });

  it('records the same storage key the hook uses', () => {
    for (const { key, storageKey } of persistedCollections()) {
      expect(collectionForKey(key)?.storageKey, `storage key for ${key}`).toBe(storageKey);
    }
  });

  it('uses a unique key and storage key per collection', () => {
    expect(new Set(collectionKeys()).size).toBe(COLLECTIONS.length);
    expect(new Set(collectionStorageKeys()).size).toBe(COLLECTIONS.length);
  });

  /**
   * The property the registry exists to record. A client-editable collection
   * MUST have a setter entry: without one, `handleCollectionUpdate` never writes
   * the stamped record back into React state, so the value that reaches
   * `/api/sync` carries no `baselineTimestamp` — and `server/sync.ts` then takes
   * its "last-write-wins, never reported as conflict" path.
   */
  it('gives every client-editable collection a setter, and no server-command one', () => {
    const setters = new Set(setterMapKeys());

    const editableWithoutSetter = clientEditableCollectionKeys().filter(key => !setters.has(key));
    expect(
      editableWithoutSetter,
      'client-editable collections missing a setter would sync without a conflict baseline',
    ).toEqual([]);

    const commandWithSetter = serverCommandCollectionKeys().filter(key => setters.has(key));
    expect(
      commandWithSetter,
      'server-command collections must not be stamped as if the client had edited them',
    ).toEqual([]);
  });

  it('does not expose setters for server-command collections', () => {
    // Components must go through the command endpoints for these, so the hook
    // must not hand out a way to mutate them locally.
    for (const key of serverCommandCollectionKeys()) {
      const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      const returned = new RegExp(`^\\s{4}${setter},\\s*$`, 'm').test(hookSource);
      expect(returned, `${setter} must not be returned from useWineryState`).toBe(false);
    }
  });

  it('explains every server-command collection in the source', () => {
    // "Why is this one different?" must be answerable from the registry alone.
    // The rationale lives in comments rather than a `note` field because a
    // runtime string ships to every user: carrying them pushed the critical-path
    // bundle over its budget, for prose only developers read. Comments minify
    // away and stay just as close to the data.
    const lines = registrySource.split(/\r?\n/);
    for (const key of serverCommandCollectionKeys()) {
      const index = lines.findIndex(line => line.includes(`key: '${key}'`));
      expect(index, `no registry entry for ${key}`).toBeGreaterThan(-1);
      const preceding = lines[index - 1]?.trim() ?? '';
      expect(
        preceding.startsWith('//') && !preceding.startsWith('// ---'),
        `${key} needs a comment above it explaining why it is server-authoritative`,
      ).toBe(true);
    }
  });

  it('keeps the registry free of runtime-only documentation strings', () => {
    // Guards the bundle-size regression that motivated moving notes to comments.
    expect(registrySource).not.toMatch(/^\s*(readonly )?note\??:/m);
  });

  /**
   * `lib/tenantCache.ts` keeps its own flat list rather than importing this
   * registry: the registry's extra metadata is test-only, and pulling it into
   * the runtime put it in the critical-path bundle for every user.
   *
   * That duplication is only acceptable while it cannot drift, which is what
   * this asserts. A collection missing from the cache list survives an
   * organization switch and shows the previous tenant's records in the next
   * workspace — silently.
   */
  it('matches the tenant cache list exactly', () => {
    const cachedCollectionKeys = TENANT_CACHE_KEYS.filter(
      key => !NON_COLLECTION_TENANT_KEYS.includes(key),
    );
    expect([...cachedCollectionKeys].sort()).toEqual([...collectionStorageKeys()].sort());
  });

  it('does not pull the registry into the client runtime', () => {
    // The bundle-cost reason above only holds while nothing shipped imports it.
    const clientDirs = ['components', 'hooks', 'src'];
    const offenders: string[] = [];
    for (const dir of clientDirs) {
      const root = path.resolve(__dirname, '..', dir);
      const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!/\.tsx?$/.test(entry.name)) continue;
          if (/from '.*collectionRegistry'/.test(fs.readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(path.resolve(__dirname, '..'), full));
          }
        }
      };
      walk(root);
    }
    expect(offenders, 'importing the registry from client code ships it to users').toEqual([]);
  });

  it('leaves the hook as the only place that maps a collection to its setter', () => {
    // The registry deliberately holds no function references: setters live in
    // the hook's closure. This keeps that boundary from eroding into a second
    // source of truth that could disagree with the first.
    expect(registrySource).not.toMatch(/\bimport\b.*useWineryState/);
    expect(registrySource).not.toMatch(/\buseState\b|\bsetter\b\s*:/);
  });
});
