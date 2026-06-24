/**
 * Type system for the official Georgian wine traceability documents
 * (მევენახეობა-მეღვინეობის ტექნოლოგიური პროცესების აღრიცხვისა და შეტყობინების წესი).
 *
 * Source of truth: the official annex forms №1–№20 in
 * docs/georgian-annexes-source.txt (extracted from დანართები.pdf).
 *
 * The engine is data-driven: a FormTemplate declares its Georgian title, annex
 * number, required filters, the exact column headers from the PDF, and which
 * columns carry running totals. Renderers (HTML/PDF/XLSX) and the UI consume
 * templates generically, so adding or amending a form is a data change, not a
 * code change.
 */

import type {
  CompanyProfile, VineyardBlock, WineLot, Vessel, HarvestRecord,
  GrapeSamplingRecord, InventoryItem, LabAnalysis, TransferEvent,
} from '../wineryState';

export type Language = 'en' | 'ka';

/** Which selector inputs a form needs in the UI. */
export type FilterId =
  | 'dateRange'
  | 'accountingYear'
  | 'season'
  | 'company'
  | 'vineyardBlock'
  | 'wineLot'
  | 'tank'
  | 'product'
  | 'material'
  | 'warehouse';

export type FormCategory =
  | 'vineyard'
  | 'harvest'
  | 'cellar'
  | 'bottling'
  | 'warehouse'
  | 'distillation'
  | 'materials'
  | 'notification';

export type Orientation = 'portrait' | 'landscape';

export type ColumnAlign = 'left' | 'center' | 'right';

/**
 * One table column. `group` lets several columns share a spanning header cell
 * (the official forms use two-level headers, e.g. შემოსავალი / გასავალი / ნაშთი
 * each spanning დალ + ა.ა. sub-columns).
 */
export interface ColumnDef {
  key: string;
  headerKa: string;
  headerEn?: string;
  /** Spanning parent header shared with adjacent columns of the same group. */
  group?: string;
  groupEn?: string;
  width?: number; // relative weight / Excel char width
  align?: ColumnAlign;
  /** Column accumulates a column total in the totals row. */
  total?: boolean;
  /** Numeric column — affects alignment, totals and Excel cell type. */
  numeric?: boolean;
}

/** A labelled field shown above the table (company name, accounting year, …). */
export interface HeaderFieldDef {
  key: string;
  labelKa: string;
  labelEn?: string;
  /** Where the value comes from at render time. 'input' = blank line to fill. */
  source:
    | 'companyName'
    | 'wineryName'
    | 'legalAddress'
    | 'factualAddress'
    | 'idCode'
    | 'region'
    | 'accountingYear'
    | 'dateRange'
    | 'product'
    | 'input';
}

export interface FormTemplate {
  id: string;
  annexNumber: number;
  titleKa: string;
  titleEn: string;
  category: FormCategory;
  orientation: Orientation;
  /** Form version + source reference, so legal changes can be tracked. */
  version: string;
  sourceDoc: string;
  filters: FilterId[];
  /** Logical data source used by the mapper; '' when no app data exists yet. */
  dataSource: string;
  headerFields: HeaderFieldDef[];
  columns: ColumnDef[];
  /** Keys of columns that should display a column total / closing balance. */
  totals: string[];
  /** Whether the form ends with a running balance (closing = opening + in − out). */
  hasRunningBalance?: boolean;
  /** Signature line label(s) at the foot of the form. */
  signatureLabelKa: string;
  /** filenames: annex_<n>_<slug>_<from>_<to>. */
  filenameSlug: string;
  notes?: string;
}

/** A single rendered data row: column key -> cell value. */
export type DocRow = Record<string, string | number>;

export interface ValidationWarning {
  level: 'warning' | 'error';
  messageKa: string;
  messageEn: string;
  /** 0-based row this warning refers to, when applicable. */
  rowIndex?: number;
}

export interface DateRange {
  from: string; // yyyy-mm-dd
  to: string;   // yyyy-mm-dd
}

/** Everything a mapper/renderer needs at runtime. */
export interface ExportContext {
  lang: Language;
  mode: 'filled' | 'blank';
  blankRows: number;
  company: CompanyProfile;
  generatedBy: string;
  dateRange: DateRange;
  accountingYear?: string;
  // selected entity ids (optional, depend on the form's filters)
  blockId?: string;
  lotId?: string;
  tankId?: string;
  productName?: string;
  materialId?: string;
  // data pools
  blocks: VineyardBlock[];
  lots: WineLot[];
  vessels: Vessel[];
  harvests: HarvestRecord[];
  samplings: GrapeSamplingRecord[];
  inventory: InventoryItem[];
  labLogs: LabAnalysis[];
  transfers: TransferEvent[];
}

/** Final renderable document produced by the engine. */
export interface RenderedDocument {
  template: FormTemplate;
  titleKa: string;
  headerFields: Array<{ label: string; value: string }>;
  columns: ColumnDef[];
  rows: DocRow[];
  /** Computed totals row, keyed by column key (only total columns present). */
  totalsRow: DocRow | null;
  warnings: ValidationWarning[];
  meta: {
    company: CompanyProfile;
    dateRange: DateRange;
    generatedAt: string;
    generatedBy: string;
    mode: 'filled' | 'blank';
  };
}
