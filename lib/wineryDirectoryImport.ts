import type { CompanyProfile } from './wineryState';
import { findGeorgianRegion } from './georgianWineKnowledge';

export interface WineryDirectoryRecord {
  directoryId: string;
  companyName?: string;
  wineryName?: string;
  identificationCode?: string;
  wineAgencyRegistrationCode?: string;
  country?: string;
  region?: string;
  municipality?: string;
  address?: string;
  legalAddress?: string;
  factualAddress?: string;
  contactEmail?: string;
  phone?: string;
  website?: string;
  certificateContactPerson?: string;
  certificatePhone?: string;
  certificateEmail?: string;
  producerRegistrationNotes?: string;
  latitude?: number;
  longitude?: number;
  raw: Record<string, string>;
}

export interface WineryDirectoryParseResult {
  records: WineryDirectoryRecord[];
  warnings: string[];
}

export interface WineryDirectoryImportResult {
  profile: CompanyProfile;
  changes: Array<{ field: keyof CompanyProfile; previous: CompanyProfile[keyof CompanyProfile]; next: CompanyProfile[keyof CompanyProfile] }>;
  warnings: string[];
}

export interface WineryCrmLead {
  id: string;
  displayName: string;
  companyName: string;
  wineryName: string;
  region?: string;
  municipality?: string;
  address?: string;
  contactEmail?: string;
  phone?: string;
  website?: string;
  source: string;
  tags: string[];
  notes: string;
}

const HEADER_ALIASES: Record<keyof Omit<WineryDirectoryRecord, 'directoryId' | 'raw'>, string[]> = {
  companyName: ['company', 'companyname', 'legalname', 'producer', 'producername', 'organization', 'organisation', 'entityname'],
  wineryName: ['winery', 'wineryname', 'brand', 'tradename', 'cellar', 'marani'],
  identificationCode: ['identificationcode', 'idcode', 'taxid', 'taxcode', 'companycode', 'personalid', 'registrationid'],
  wineAgencyRegistrationCode: ['wineagencycode', 'agencycode', 'wineagencyregistrationcode', 'producerregistration', 'registrationcode', 'registrycode'],
  country: ['country', 'state'],
  region: ['region', 'winegrowingregion', 'pdo', 'appellation', 'microregion'],
  municipality: ['municipality', 'district', 'city', 'town'],
  address: ['address', 'streetaddress', 'physicaladdress', 'location'],
  legalAddress: ['legaladdress', 'registeredaddress'],
  factualAddress: ['factualaddress', 'actualaddress', 'productionaddress', 'facilityaddress'],
  contactEmail: ['email', 'contactemail', 'mail'],
  phone: ['phone', 'telephone', 'mobile', 'contactphone'],
  website: ['website', 'web', 'url'],
  certificateContactPerson: ['contactperson', 'certificatecontact', 'representative', 'director'],
  certificatePhone: ['certificatephone', 'certphone'],
  certificateEmail: ['certificateemail', 'certemail'],
  producerRegistrationNotes: ['notes', 'producernotes', 'registrationnotes', 'status'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long']
};

const REQUIRED_PROFILE_DEFAULTS: CompanyProfile = {
  companyName: '',
  wineryName: '',
  country: 'Georgia',
  region: '',
  municipality: '',
  address: '',
  contactEmail: '',
  phone: '',
  website: '',
  measurementUnits: 'metric',
  currency: 'GEL'
};

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u10a0-\u10ff]+/g, '');
}

function cleanCell(value: unknown): string {
  return String(value || '').trim();
}

function parseNumber(value: string): number | undefined {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function detectDelimiter(headerLine: string): string {
  const candidates = ['\t', ';', ','];
  return candidates
    .map(delimiter => ({ delimiter, count: headerLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

function parseDelimited(text: string): string[][] {
  const delimiter = detectDelimiter(text.split(/\r?\n/)[0] || ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
}

function fieldForHeader(header: string): keyof Omit<WineryDirectoryRecord, 'directoryId' | 'raw'> | undefined {
  const normalized = normalizeHeader(header);
  const entries = Object.entries(HEADER_ALIASES) as Array<[keyof Omit<WineryDirectoryRecord, 'directoryId' | 'raw'>, string[]]>;
  return entries.find(([, aliases]) => aliases.includes(normalized))?.[0];
}

function pickRecordId(record: Partial<WineryDirectoryRecord>, index: number): string {
  return cleanCell(record.wineAgencyRegistrationCode)
    || cleanCell(record.identificationCode)
    || cleanCell(record.companyName)
    || cleanCell(record.wineryName)
    || `directory-row-${index + 1}`;
}

export function parseWineryDirectoryText(text: string): WineryDirectoryParseResult {
  const warnings: string[] = [];
  const rows = parseDelimited(text.trim());
  if (rows.length < 2) {
    return { records: [], warnings: ['Directory import needs a header row and at least one data row.'] };
  }

  const headers = rows[0];
  const mappedFields = headers.map(fieldForHeader);
  if (mappedFields.every(field => !field)) {
    return { records: [], warnings: ['No recognized winery directory headers were found.'] };
  }

  const records = rows.slice(1).map((row, rowIndex): WineryDirectoryRecord => {
    const raw: Record<string, string> = {};
    const partial: Partial<WineryDirectoryRecord> = {};

    headers.forEach((header, colIndex) => {
      const value = cleanCell(row[colIndex]);
      raw[header] = value;
      const field = mappedFields[colIndex];
      if (!field || !value) return;
      if (field === 'latitude' || field === 'longitude') {
        const parsed = parseNumber(value);
        if (parsed != null) partial[field] = parsed;
      } else {
        partial[field] = value as never;
      }
    });

    const knownRegion = findGeorgianRegion(partial.region);
    if (partial.region && knownRegion) partial.region = knownRegion.name;
    if (!partial.country && knownRegion) partial.country = 'Georgia';

    return {
      directoryId: pickRecordId(partial, rowIndex),
      raw,
      ...partial
    };
  }).filter(record => Object.values(record.raw).some(Boolean));

  if (records.length === 0) warnings.push('No usable winery directory records were found.');
  const missingCodes = records.filter(record => !record.identificationCode && !record.wineAgencyRegistrationCode).length;
  if (missingCodes > 0) warnings.push(`${missingCodes} record(s) are missing identification or agency registration codes.`);

  return { records, warnings };
}

export function directoryRecordLabel(record: WineryDirectoryRecord): string {
  const name = record.wineryName || record.companyName || record.directoryId;
  const place = [record.region, record.municipality].filter(Boolean).join(', ');
  const code = record.wineAgencyRegistrationCode || record.identificationCode;
  return [name, place, code].filter(Boolean).join(' - ');
}

export function importWineryDirectoryRecord(
  record: WineryDirectoryRecord,
  existing: Partial<CompanyProfile> = {},
  options: { overwrite?: boolean } = {}
): WineryDirectoryImportResult {
  const overwrite = options.overwrite ?? true;
  const warnings: string[] = [];
  const base: CompanyProfile = { ...REQUIRED_PROFILE_DEFAULTS, ...existing };
  const profile: CompanyProfile = { ...base };
  const changes: WineryDirectoryImportResult['changes'] = [];

  const apply = <K extends keyof CompanyProfile>(field: K, value: CompanyProfile[K] | undefined) => {
    if (value == null || value === '') return;
    if (!overwrite && profile[field]) return;
    if (profile[field] === value) return;
    const previous = profile[field];
    profile[field] = value;
    changes.push({ field, previous, next: value });
  };

  const knownRegion = findGeorgianRegion(record.region);
  if (record.region && !knownRegion) warnings.push(`Unknown Georgian wine region: ${record.region}`);

  apply('companyName', record.companyName || record.wineryName || '');
  apply('wineryName', record.wineryName || record.companyName || '');
  apply('identificationCode', record.identificationCode || '');
  apply('wineAgencyRegistrationCode', record.wineAgencyRegistrationCode || '');
  apply('country', record.country || (knownRegion ? 'Georgia' : undefined));
  apply('region', knownRegion?.name || record.region || '');
  apply('municipality', record.municipality || '');
  apply('address', record.address || record.factualAddress || record.legalAddress || '');
  apply('legalAddress', record.legalAddress || record.address || '');
  apply('factualAddress', record.factualAddress || record.address || '');
  apply('certificateContactPerson', record.certificateContactPerson || '');
  apply('certificatePhone', record.certificatePhone || record.phone || '');
  apply('certificateEmail', record.certificateEmail || record.contactEmail || '');
  apply('producerRegistrationNotes', record.producerRegistrationNotes || '');
  apply('contactEmail', record.contactEmail || record.certificateEmail || '');
  apply('phone', record.phone || record.certificatePhone || '');
  apply('website', record.website || '');
  apply('latitude', record.latitude);
  apply('longitude', record.longitude);

  if (!profile.identificationCode && !profile.wineAgencyRegistrationCode) {
    warnings.push('Imported profile has no identification or Wine Agency registration code.');
  }

  return { profile, changes, warnings };
}

export function directoryRecordToCrmLead(record: WineryDirectoryRecord, source = 'winery_directory'): WineryCrmLead {
  const companyName = record.companyName || record.wineryName || 'Unknown winery';
  const wineryName = record.wineryName || record.companyName || companyName;
  const tags = ['winery'];
  if (record.region) tags.push(record.region);
  if (record.wineAgencyRegistrationCode) tags.push('wine-agency-registered');
  if (record.identificationCode) tags.push('has-id-code');

  const notes = [
    record.wineAgencyRegistrationCode ? `Wine Agency registration: ${record.wineAgencyRegistrationCode}` : '',
    record.identificationCode ? `Identification code: ${record.identificationCode}` : '',
    record.producerRegistrationNotes ? `Directory notes: ${record.producerRegistrationNotes}` : '',
    record.certificateContactPerson ? `Contact person: ${record.certificateContactPerson}` : ''
  ].filter(Boolean).join('\n');

  return {
    id: `lead-${record.directoryId.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'winery'}`,
    displayName: directoryRecordLabel(record),
    companyName,
    wineryName,
    region: record.region,
    municipality: record.municipality,
    address: record.address || record.factualAddress || record.legalAddress,
    contactEmail: record.contactEmail || record.certificateEmail,
    phone: record.phone || record.certificatePhone,
    website: record.website,
    source,
    tags,
    notes
  };
}
