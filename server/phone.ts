/** Normalizes an international contact number without tying it to a provider. */
export function normalizeInternationalPhone(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const prefixed = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  const normalized = `+${prefixed.replace(/^\+/, '').replace(/\D/g, '')}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
