import { parseCsvRows } from './csv';
import type { Vessel, VesselType, WineLot, WineClass, WinemakingStage } from './wineryState';

/**
 * Bulk import for onboarding a cellar from a spreadsheet.
 *
 * Nobody moves winery software mid-vintage by retyping their tank inventory,
 * which makes this less a convenience than the thing that decides whether a
 * migration happens at all.
 *
 * Two rules shape it. It always produces a **preview** first — every row
 * classified, every problem named, nothing written until someone looks at it —
 * because an import that half-succeeds against live cellar records is worse
 * than one that refuses. And it reports problems per row rather than failing
 * the file: one bad line out of four hundred should not send someone back to
 * the spreadsheet blind.
 */

export type ImportAction = 'create' | 'update' | 'skip';

export interface ImportRow<T> {
  /** 1-based line in the source file, counting the header. */
  line: number;
  action: ImportAction;
  /** Present unless the row could not be understood at all. */
  record?: T;
  /** Human-readable reasons this row will not be imported as-is. */
  issues: string[];
}

export interface ImportPreview<T> {
  rows: ImportRow<T>[];
  created: number;
  updated: number;
  skipped: number;
  /** Headers present in the file that this importer does not use. */
  unknownColumns: string[];
  /** Required headers the file is missing; when non-empty nothing can import. */
  missingColumns: string[];
}

/**
 * Accepts the header a person would actually type, in either language.
 * Punctuation is dropped entirely: a real export says "Capacity (L)", and
 * refusing that would send someone back to edit the spreadsheet by hand.
 */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function buildIndex(headers: string[], aliases: Record<string, string[]>): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const index: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const position = normalized.findIndex(header => names.some(name => normalizeHeader(name) === header));
    if (position >= 0) index[field] = position;
  }
  return index;
}

function cell(row: string[], position: number | undefined): string {
  return position === undefined ? '' : (row[position] ?? '').trim();
}

function numberFrom(raw: string): number | null {
  if (!raw) return null;
  // Spreadsheets in many locales export "1 234,5"; accept it rather than
  // rejecting a file for punctuation.
  const cleaned = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const VESSEL_TYPES: VesselType[] = ['stainless_steel', 'qvevri', 'barrel', 'plastic', 'concrete', 'other'];
const VESSEL_SHAPES: Vessel['shape'][] = ['vertical', 'horizontal', 'conical'];
const WINE_CLASSES: WineClass[] = ['white', 'red', 'rose', 'amber', 'qvevri', 'sparkling', 'fortified', 'base_wine'];
const STAGES: WinemakingStage[] = [
  'crushing', 'fermenting', 'maceration', 'pressing', 'aging', 'stabilization', 'filtration', 'bottled', 'sold',
];

function matchEnum<T extends string>(raw: string, allowed: T[]): T | null {
  if (!raw) return null;
  const wanted = normalizeHeader(raw);
  return allowed.find(entry => normalizeHeader(entry) === wanted) ?? null;
}

const VESSEL_ALIASES: Record<string, string[]> = {
  id: ['id', 'vessel', 'vessel id', 'tank', 'tank id', 'ჭურჭელი'],
  type: ['type', 'vessel type', 'ტიპი'],
  shape: ['shape', 'ფორმა'],
  capacity: ['capacity', 'capacity l', 'capacity litres', 'ტევადობა'],
  currentVolume: ['volume', 'current volume', 'current volume l', 'მოცულობა'],
  assignedLotId: ['lot', 'lot id', 'assigned lot', 'პარტია'],
  locationDetails: ['location', 'location details', 'ადგილმდებარეობა'],
};

export function previewVesselImport(input: {
  csv: string;
  existing: Vessel[];
}): ImportPreview<Vessel> {
  const rows = parseCsvRows(input.csv).filter(row => row.some(value => value.trim()));
  if (rows.length === 0) {
    return { rows: [], created: 0, updated: 0, skipped: 0, unknownColumns: [], missingColumns: ['id', 'capacity'] };
  }

  const headers = rows[0];
  const index = buildIndex(headers, VESSEL_ALIASES);
  const missingColumns = ['id', 'capacity'].filter(field => index[field] === undefined);
  const knownPositions = new Set(Object.values(index));
  const unknownColumns = headers
    .map((header, position) => ({ header: header.trim(), position }))
    .filter(entry => entry.header && !knownPositions.has(entry.position))
    .map(entry => entry.header);

  const existingById = new Map(input.existing.map(vessel => [vessel.id.toLowerCase(), vessel]));
  const seen = new Set<string>();
  const out: ImportRow<Vessel>[] = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 1;
    const issues: string[] = [];

    const id = cell(row, index.id);
    if (!id) issues.push('Missing vessel id.');
    if (id && seen.has(id.toLowerCase())) issues.push(`Duplicate vessel id "${id}" earlier in this file.`);

    const capacity = numberFrom(cell(row, index.capacity));
    if (capacity === null) issues.push('Capacity must be a number.');
    else if (capacity <= 0) issues.push('Capacity must be greater than zero.');

    const rawVolume = cell(row, index.currentVolume);
    const currentVolume = rawVolume ? numberFrom(rawVolume) : 0;
    if (currentVolume === null) issues.push('Volume must be a number.');
    else if (currentVolume < 0) issues.push('Volume cannot be negative.');
    else if (capacity !== null && currentVolume > capacity) {
      issues.push('Volume is greater than the capacity.');
    }

    const rawType = cell(row, index.type);
    const type = rawType ? matchEnum(rawType, VESSEL_TYPES) : 'stainless_steel';
    if (rawType && !type) issues.push(`Unknown vessel type "${rawType}".`);

    const rawShape = cell(row, index.shape);
    const shape = rawShape ? matchEnum(rawShape, VESSEL_SHAPES) : 'vertical';
    if (rawShape && !shape) issues.push(`Unknown shape "${rawShape}".`);

    if (id) seen.add(id.toLowerCase());

    if (issues.length || missingColumns.length) {
      out.push({ line, action: 'skip', issues });
      continue;
    }

    const previous = existingById.get(id.toLowerCase());
    const assignedLotId = cell(row, index.assignedLotId);
    const location = cell(row, index.locationDetails);

    out.push({
      line,
      action: previous ? 'update' : 'create',
      issues: [],
      record: {
        // An update keeps everything the file does not speak about — cleaning
        // state, temperature, plan position — rather than resetting it.
        ...(previous ?? {}),
        id,
        type: type as VesselType,
        shape: shape as Vessel['shape'],
        capacity: capacity as number,
        currentVolume: currentVolume as number,
        assignedLotId: assignedLotId || previous?.assignedLotId || null,
        cleaningStatus: previous?.cleaningStatus ?? 'clean',
        lastCleaned: previous?.lastCleaned ?? '',
        temperature: previous?.temperature ?? 0,
        coolingJacketActive: previous?.coolingJacketActive ?? false,
        targetTemperature: previous?.targetTemperature ?? null,
        lastOperation: previous?.lastOperation ?? 'Imported',
        ...(location ? { locationDetails: location } : {}),
      },
    });
  }

  return {
    rows: out,
    created: out.filter(row => row.action === 'create').length,
    updated: out.filter(row => row.action === 'update').length,
    skipped: out.filter(row => row.action === 'skip').length,
    unknownColumns,
    missingColumns,
  };
}

const LOT_ALIASES: Record<string, string[]> = {
  id: ['id', 'lot', 'lot id', 'lot code', 'პარტია'],
  name: ['name', 'lot name', 'დასახელება'],
  vintage: ['vintage', 'year', 'მოსავალი'],
  variety: ['variety', 'grape', 'ჯიში'],
  vineyardBlock: ['block', 'vineyard block', 'ნაკვეთი'],
  region: ['region', 'appellation', 'რეგიონი'],
  currentVolume: ['volume', 'current volume', 'current volume l', 'მოცულობა'],
  initialVolume: ['initial volume', 'starting volume'],
  wineClass: ['class', 'wine class', 'colour', 'color', 'ტიპი'],
  stage: ['stage', 'ეტაპი'],
};

export function previewLotImport(input: {
  csv: string;
  existing: WineLot[];
  now: string;
}): ImportPreview<WineLot> {
  const rows = parseCsvRows(input.csv).filter(row => row.some(value => value.trim()));
  if (rows.length === 0) {
    return { rows: [], created: 0, updated: 0, skipped: 0, unknownColumns: [], missingColumns: ['id', 'volume'] };
  }

  const headers = rows[0];
  const index = buildIndex(headers, LOT_ALIASES);
  const missingColumns = ['id', 'currentVolume'].filter(field => index[field] === undefined);
  const knownPositions = new Set(Object.values(index));
  const unknownColumns = headers
    .map((header, position) => ({ header: header.trim(), position }))
    .filter(entry => entry.header && !knownPositions.has(entry.position))
    .map(entry => entry.header);

  const existingById = new Map(input.existing.map(lot => [lot.id.toLowerCase(), lot]));
  const seen = new Set<string>();
  const out: ImportRow<WineLot>[] = [];
  const defaultVintage = Number(input.now.slice(0, 4));

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const line = i + 1;
    const issues: string[] = [];

    const id = cell(row, index.id);
    if (!id) issues.push('Missing lot id.');
    if (id && seen.has(id.toLowerCase())) issues.push(`Duplicate lot id "${id}" earlier in this file.`);

    const currentVolume = numberFrom(cell(row, index.currentVolume));
    if (currentVolume === null) issues.push('Volume must be a number.');
    else if (currentVolume < 0) issues.push('Volume cannot be negative.');

    const rawVintage = cell(row, index.vintage);
    const vintage = rawVintage ? numberFrom(rawVintage) : defaultVintage;
    if (rawVintage && (vintage === null || !Number.isInteger(vintage) || vintage < 1900 || vintage > 2200)) {
      issues.push(`Unrecognised vintage "${rawVintage}".`);
    }

    const rawClass = cell(row, index.wineClass);
    const wineClass = rawClass ? matchEnum(rawClass, WINE_CLASSES) : 'red';
    if (rawClass && !wineClass) issues.push(`Unknown wine class "${rawClass}".`);

    const rawStage = cell(row, index.stage);
    const stage = rawStage ? matchEnum(rawStage, STAGES) : 'aging';
    if (rawStage && !stage) issues.push(`Unknown stage "${rawStage}".`);

    if (id) seen.add(id.toLowerCase());

    if (issues.length || missingColumns.length) {
      out.push({ line, action: 'skip', issues });
      continue;
    }

    const previous = existingById.get(id.toLowerCase());
    const initial = numberFrom(cell(row, index.initialVolume));

    out.push({
      line,
      action: previous ? 'update' : 'create',
      issues: [],
      record: {
        ...(previous ?? {}),
        id,
        name: cell(row, index.name) || previous?.name || id,
        vintage: (vintage ?? defaultVintage) as number,
        variety: cell(row, index.variety) || previous?.variety || '',
        vineyardBlock: cell(row, index.vineyardBlock) || previous?.vineyardBlock || '',
        region: cell(row, index.region) || previous?.region || '',
        // Onboarding a lot mid-life has no earlier volume to remember, so the
        // opening balance is what is in the cellar today.
        initialVolume: initial ?? previous?.initialVolume ?? (currentVolume as number),
        currentVolume: currentVolume as number,
        wineClass: wineClass as WineClass,
        stage: stage as WinemakingStage,
        createdAt: previous?.createdAt ?? input.now,
        history: previous?.history ?? [],
      },
    });
  }

  return {
    rows: out,
    created: out.filter(row => row.action === 'create').length,
    updated: out.filter(row => row.action === 'update').length,
    skipped: out.filter(row => row.action === 'skip').length,
    unknownColumns,
    missingColumns,
  };
}

/**
 * Merge an accepted preview into a collection.
 *
 * Only rows the preview marked importable are applied, so the thing a person
 * approved on screen is exactly the thing that lands.
 */
export function applyImport<T extends { id: string }>(existing: T[], preview: ImportPreview<T>): T[] {
  const importable = preview.rows.filter(row => row.record && row.action !== 'skip');
  if (!importable.length) return existing;

  const byId = new Map(importable.map(row => [row.record!.id.toLowerCase(), row.record!]));
  const merged = existing.map(entry => byId.get(entry.id.toLowerCase()) ?? entry);
  const existingIds = new Set(existing.map(entry => entry.id.toLowerCase()));

  return [
    ...importable
      .filter(row => !existingIds.has(row.record!.id.toLowerCase()))
      .map(row => row.record!),
    ...merged,
  ];
}

/** A starter file, so the first question is never "what columns?". */
export function importTemplateCsv(kind: 'vessels' | 'lots'): string {
  return kind === 'vessels'
    ? 'id,type,shape,capacity,volume,lot,location\nT-01,stainless_steel,vertical,5000,3200,LOT-2026-01,Main cellar\nB-01,barrel,horizontal,225,220,LOT-2026-01,Barrel room\n'
    : 'id,name,vintage,variety,block,region,volume,class,stage\nLOT-2026-01,Saperavi 2026,2026,Saperavi,Block A,Kakheti,3200,red,aging\n';
}
