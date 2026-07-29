import type { Language } from '../i18n';

/**
 * Every string the intelligence layer produces is authored as an English +
 * Georgian pair in code, never translated by the model at generation time.
 * A rule finding therefore reads identically well in both languages, and a
 * Georgian winemaker never sees an English fallback for deterministic output.
 */
export interface LocalizedText {
  en: string;
  ka: string;
}

export function text(en: string, ka: string): LocalizedText {
  return { en, ka };
}

export function localize(value: LocalizedText, lang: Language | undefined): string {
  return lang === 'ka' ? value.ka : value.en;
}

export function localizeAll(values: LocalizedText[], lang: Language | undefined): string[] {
  return values.map((value) => localize(value, lang));
}

/** Wraps a value that is identical in both languages (numbers, IDs, lot codes). */
export function plain(value: string): LocalizedText {
  return { en: value, ka: value };
}

/**
 * Model-authored text arrives as a single string in the requested language.
 * It is stored in both slots so downstream rendering stays uniform; the
 * `lang` the model wrote in is recorded by the caller on the finding.
 */
export function fromModel(value: string): LocalizedText {
  return { en: value, ka: value };
}

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.en === 'string' && typeof candidate.ka === 'string';
}

/** Georgian number formatting matches English here; kept central for future divergence. */
export function num(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export function pct(value: number, digits = 0): string {
  return `${num(value, digits)}%`;
}

/** Georgian day-count phrasing ("3 დღეში") differs from the English pattern. */
export function days(count: number): LocalizedText {
  const rounded = Math.max(0, Math.round(count));
  return text(`${rounded} day${rounded === 1 ? '' : 's'}`, `${rounded} დღე`);
}

/**
 * Enum-like values are stored in English. Interpolating one raw into a Georgian
 * sentence ("ის aging ეტაპზეა") is the most common way Georgian output quietly
 * degrades, so findings route every stored enum through here.
 */
export function enumText(value: string, labels: (raw: string, lang: Language) => string): LocalizedText {
  return text(labels(value, 'en'), labels(value, 'ka'));
}
