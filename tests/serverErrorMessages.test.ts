import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  hasLocalizedServerError,
  localizeServerError,
  SERVER_ERROR_MESSAGES,
} from '../lib/serverErrorMessages';

const GEORGIAN_LETTER = /[Ⴀ-ჿ]/;

describe('server error localization', () => {
  it('keeps English and Georgian in parity for every code', () => {
    for (const [code, message] of Object.entries(SERVER_ERROR_MESSAGES)) {
      expect(message.en.trim(), `${code} missing English`).not.toBe('');
      expect(message.ka.trim(), `${code} missing Georgian`).not.toBe('');
      expect(message.ka, `${code} Georgian is not Georgian text`).toMatch(GEORGIAN_LETTER);
      expect(message.ka, `${code} Georgian is a copy of English`).not.toBe(message.en);
    }
  });

  it('returns the requested language for a known code', () => {
    expect(localizeServerError('sync_payload_too_large', 'ignored English', 'ka'))
      .toBe(SERVER_ERROR_MESSAGES.sync_payload_too_large.ka);
    expect(localizeServerError('sync_payload_too_large', 'ignored English', 'en'))
      .toBe(SERVER_ERROR_MESSAGES.sync_payload_too_large.en);
  });

  it('falls back to the server text for an unknown code', () => {
    // A newly added server error degrades to previous behaviour, not to nothing.
    expect(localizeServerError('brand_new_code', 'Something specific failed.', 'ka'))
      .toBe('Something specific failed.');
  });

  it('falls back to a localized generic line when there is no message at all', () => {
    expect(localizeServerError(undefined, undefined, 'ka')).toMatch(GEORGIAN_LETTER);
    expect(localizeServerError(null, '   ', 'en')).toBe('The action could not be completed. Please try again.');
    // Never surfaces a bare code to a user.
    expect(localizeServerError('unknown_code', '', 'en')).not.toContain('unknown_code');
  });

  it('reports whether a code is translated', () => {
    expect(hasLocalizedServerError('org_state_conflict')).toBe(true);
    expect(hasLocalizedServerError('not_a_real_code')).toBe(false);
    expect(hasLocalizedServerError(undefined)).toBe(false);
  });

  /**
   * The point of the module is that codes the server can actually emit are
   * covered. This walks the server source rather than trusting a hand-kept
   * list, so a new `code:` that reaches the client is caught here.
   */
  it('covers every error code the server routes emit', () => {
    const serverDir = path.resolve(__dirname, '../server');
    const emitted = new Set<string>();

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.ts$/.test(entry.name)) continue;
        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(/\bcode: '([a-z][a-z0-9_]*)'/g)) {
          emitted.add(match[1]);
        }
      }
    };
    walk(serverDir);

    expect(emitted.size).toBeGreaterThan(5); // the scan found something real
    const untranslated = [...emitted].filter(code => !hasLocalizedServerError(code)).sort();
    expect(untranslated, `untranslated server error codes: ${untranslated.join(', ')}`).toEqual([]);
  });
});
