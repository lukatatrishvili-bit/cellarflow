import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_LANGUAGES,
  normalizeSupportedLanguage,
  translations,
} from '../lib/i18n';

describe('runtime localization contract', () => {
  it('supports only launch-complete English and Georgian locales', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'ka']);
    expect(normalizeSupportedLanguage('ka')).toBe('ka');
    expect(normalizeSupportedLanguage('en')).toBe('en');
    expect(normalizeSupportedLanguage('it')).toBe('en');
    expect(normalizeSupportedLanguage(null)).toBe('en');
  });

  it('keeps every English and Georgian runtime translation key in parity', () => {
    expect(Object.keys(translations.ka).sort()).toEqual(Object.keys(translations.en).sort());
  });
});
