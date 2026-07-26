export const SUPPORTED_LANGUAGES = ['en', 'ka'] as const;
export type Language = typeof SUPPORTED_LANGUAGES[number];

export function normalizeSupportedLanguage(value: unknown): Language {
  return value === 'ka' ? 'ka' : 'en';
}
