import type { CompanyProfile, WineAgencyVerificationEvidence } from '../lib/wineryState';

const SEARCH_ENDPOINT = 'https://www.wine.gov.ge/En/Companies/SearchCompany';
export const WINE_AGENCY_DIRECTORY_URL = 'https://www.wine.gov.ge/En/WineCompaniesAndWineries';
export const WINE_AGENCY_PORTAL_URL = 'https://portal.wine.gov.ge/';
export const WINE_AGENCY_RECHECK_INTERVAL_DAYS = 90;

const MAX_HTML_CHARS = 750_000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const MAX_RESULTS = 20;

export interface WineAgencyRegistryQuery {
  registrationNumber?: string;
  companyName?: string;
}

export interface WineAgencyRegistryEntry {
  registrationNumber: string;
  name: string;
  legalForm?: string;
  identificationCode?: string;
  address?: string;
  website?: string;
  sourceUrl: string;
  verifiedAt: string;
}

export interface WineAgencyRegistrySearchResult {
  query: Required<WineAgencyRegistryQuery>;
  results: WineAgencyRegistryEntry[];
  sourceUrl: string;
  verifiedAt: string;
  officialApi: false;
  transport: 'public_html_registry';
}

export interface WineAgencyIdentityMismatch {
  field: 'registrationNumber' | 'identificationCode';
  localValue: string;
  registryValue: string;
}

export interface WineAgencyVerificationStatus {
  state: 'not_linked' | 'current' | 'recheck_due' | 'identity_mismatch';
  policy: 'cellarflow_internal';
  recheckIntervalDays: number;
  checkedAt?: string;
  recheckDueAt?: string;
}

export class WineAgencyRegistryError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'WineAgencyRegistryError';
  }
}

const cache = new Map<string, { expiresAt: number; value: WineAgencyRegistrySearchResult }>();

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"', ldquo: '“', rdquo: '”',
  };
  return value
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (match, entity: string) => named[entity.toLowerCase()] ?? match);
}

function textFromHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstMatch(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match ? textFromHtml(match[1] || '') || undefined : undefined;
}

export function validateWineAgencyRegistryQuery(input: WineAgencyRegistryQuery): Required<WineAgencyRegistryQuery> {
  const registrationNumber = String(input.registrationNumber || '').trim();
  const companyName = String(input.companyName || '').trim().replace(/\s+/g, ' ');
  if (!registrationNumber && !companyName) {
    throw new WineAgencyRegistryError('Registration number or company name is required.', 400);
  }
  if (registrationNumber && !/^\d{1,20}$/.test(registrationNumber)) {
    throw new WineAgencyRegistryError('Registration number must contain 1 to 20 digits.', 400);
  }
  const hasControlCharacter = Array.from(companyName).some(character => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
  if (companyName.length > 120 || hasControlCharacter) {
    throw new WineAgencyRegistryError('Company name is invalid or too long.', 400);
  }
  if (!registrationNumber && companyName.length < 2) {
    throw new WineAgencyRegistryError('Company name must contain at least 2 characters.', 400);
  }
  return { registrationNumber, companyName };
}

export function parseWineAgencyRegistryHtml(html: string, verifiedAt = new Date().toISOString()): WineAgencyRegistryEntry[] {
  if (html.length > MAX_HTML_CHARS) {
    throw new WineAgencyRegistryError('Wine Agency registry response exceeded the safe size limit.', 502);
  }
  const blocks = html.split(/<div\s+class=["'](?=[^"']*\bfileBlock\b)(?=[^"']*\bwineCompany\b)[^"']*["'][^>]*>/i).slice(1);
  const entries: WineAgencyRegistryEntry[] = [];
  const seen = new Set<string>();

  for (const block of blocks.slice(0, MAX_RESULTS * 2)) {
    const registrationNumber = firstMatch(block, /<div\s+class=["'][^"']*contactIcon[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    const name = firstMatch(block, /<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!registrationNumber || !name || seen.has(registrationNumber)) continue;

    const headingMatches = Array.from(block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi))
      .map(match => textFromHtml(match[1] || ''))
      .filter(Boolean);
    const identificationHeading = headingMatches.find(text => /Identification Code|საიდენტიფიკაციო კოდი/i.test(text));
    const identificationCode = identificationHeading
      ?.replace(/^.*?(?:Identification Code|საიდენტიფიკაციო კოდი)\s*:*/i, '')
      .trim() || undefined;
    const address = headingMatches.find(text => !/Identification Code|საიდენტიფიკაციო კოდი/i.test(text));
    const legalForm = firstMatch(block, /<div\s+class=["']wineCompanyDesc["'][^>]*>[\s\S]*?<h2[^>]*>\s*([^<&]+?)(?:&nbsp;|<)/i);
    const website = block.match(/<a\s+href=["'](https?:\/\/[^"']+)["'][^>]*>/i)?.[1];

    seen.add(registrationNumber);
    entries.push({
      registrationNumber,
      name,
      legalForm,
      identificationCode,
      address,
      website: website ? decodeHtml(website) : undefined,
      sourceUrl: WINE_AGENCY_DIRECTORY_URL,
      verifiedAt,
    });
    if (entries.length >= MAX_RESULTS) break;
  }
  return entries;
}

export function wineAgencyVerificationEvidence(entry: WineAgencyRegistryEntry): WineAgencyVerificationEvidence {
  return {
    registrationNumber: entry.registrationNumber,
    name: entry.name,
    sourceUrl: entry.sourceUrl,
    verifiedAt: entry.verifiedAt,
    officialApi: false,
    transport: 'public_html_registry',
    ...(entry.legalForm ? { legalForm: entry.legalForm } : {}),
    ...(entry.identificationCode ? { identificationCode: entry.identificationCode } : {}),
    ...(entry.address ? { address: entry.address } : {}),
    ...(entry.website ? { website: entry.website } : {}),
  };
}

export function wineAgencyIdentityMismatches(
  profile: Pick<CompanyProfile, 'wineAgencyRegistrationCode' | 'identificationCode'>,
  entry: Pick<WineAgencyRegistryEntry, 'registrationNumber' | 'identificationCode'>,
): WineAgencyIdentityMismatch[] {
  const mismatches: WineAgencyIdentityMismatch[] = [];
  const registrationNumber = String(profile.wineAgencyRegistrationCode || '').trim();
  const identificationCode = String(profile.identificationCode || '').trim();
  if (registrationNumber && registrationNumber !== entry.registrationNumber) {
    mismatches.push({ field: 'registrationNumber', localValue: registrationNumber, registryValue: entry.registrationNumber });
  }
  if (identificationCode && entry.identificationCode && identificationCode !== entry.identificationCode) {
    mismatches.push({ field: 'identificationCode', localValue: identificationCode, registryValue: entry.identificationCode });
  }
  return mismatches;
}

/**
 * CellarFlow's operational re-check policy, not a National Wine Agency rule.
 * Identity conflicts always take priority over age so they cannot be hidden by
 * a recent directory lookup.
 */
export function wineAgencyVerificationStatus(
  profile: Pick<CompanyProfile, 'wineAgencyRegistrationCode' | 'identificationCode' | 'wineAgencyVerification'>,
  now = new Date(),
): WineAgencyVerificationStatus {
  const verification = profile.wineAgencyVerification;
  const base = {
    policy: 'cellarflow_internal' as const,
    recheckIntervalDays: WINE_AGENCY_RECHECK_INTERVAL_DAYS,
  };
  if (!verification) return { ...base, state: 'not_linked' };

  const checkedAtMs = Date.parse(verification.verifiedAt);
  const recheckDueMs = Number.isFinite(checkedAtMs)
    ? checkedAtMs + (WINE_AGENCY_RECHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000)
    : Number.NaN;
  const dates = {
    checkedAt: verification.verifiedAt,
    ...(Number.isFinite(recheckDueMs) ? { recheckDueAt: new Date(recheckDueMs).toISOString() } : {}),
  };
  if (wineAgencyIdentityMismatches(profile, verification).length > 0) {
    return { ...base, ...dates, state: 'identity_mismatch' };
  }
  if (!Number.isFinite(recheckDueMs) || now.getTime() >= recheckDueMs) {
    return { ...base, ...dates, state: 'recheck_due' };
  }
  return { ...base, ...dates, state: 'current' };
}

export function applyWineAgencyVerification(
  profile: CompanyProfile,
  entry: WineAgencyRegistryEntry,
): { profile: CompanyProfile; verification: WineAgencyVerificationEvidence; mismatches: WineAgencyIdentityMismatch[] } {
  const verification = wineAgencyVerificationEvidence(entry);
  const mismatches = wineAgencyIdentityMismatches(profile, entry);
  const existingRegistrationNumber = String(profile.wineAgencyRegistrationCode || '').trim();
  return {
    profile: {
      ...profile,
      ...(!existingRegistrationNumber || existingRegistrationNumber === entry.registrationNumber
        ? { wineAgencyRegistrationCode: entry.registrationNumber }
        : {}),
      ...(!String(profile.identificationCode || '').trim() && entry.identificationCode
        ? { identificationCode: entry.identificationCode }
        : {}),
      wineAgencyVerification: verification,
    },
    verification,
    mismatches,
  };
}

export async function searchWineAgencyRegistry(
  input: WineAgencyRegistryQuery,
  options: { fetchImpl?: typeof fetch; now?: Date; useCache?: boolean } = {},
): Promise<WineAgencyRegistrySearchResult> {
  const query = validateWineAgencyRegistryQuery(input);
  const now = options.now || new Date();
  const key = `${query.registrationNumber}\u0000${query.companyName.toLocaleLowerCase('en')}`;
  if (options.useCache !== false) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now.getTime()) return cached.value;
    if (cached) cache.delete(key);
  }

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('lotNumber', query.registrationNumber);
  url.searchParams.set('companyName', query.companyName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let response: Response;
  try {
    response = await (options.fetchImpl || fetch)(url, {
      method: 'GET',
      headers: { Accept: 'text/html;charset=utf-8' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    throw new WineAgencyRegistryError(
      timedOut ? 'Wine Agency registry lookup timed out.' : 'Wine Agency registry is temporarily unavailable.',
      502,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new WineAgencyRegistryError(`Wine Agency registry returned HTTP ${response.status}.`, 502);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new WineAgencyRegistryError('Wine Agency registry returned an unexpected response type.', 502);
  }
  const html = await response.text();
  const verifiedAt = now.toISOString();
  const value: WineAgencyRegistrySearchResult = {
    query,
    results: parseWineAgencyRegistryHtml(html, verifiedAt),
    sourceUrl: WINE_AGENCY_DIRECTORY_URL,
    verifiedAt,
    officialApi: false,
    transport: 'public_html_registry',
  };
  if (options.useCache !== false) {
    for (const [cacheKey, cached] of cache) {
      if (cached.expiresAt <= now.getTime()) cache.delete(cacheKey);
    }
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(key, { expiresAt: now.getTime() + CACHE_TTL_MS, value });
  }
  return value;
}
