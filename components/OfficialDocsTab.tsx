import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  FileSpreadsheet, FileText, Printer, AlertTriangle, ShieldCheck, FileDown, Loader2, Info,
} from 'lucide-react';
import { Language } from '../lib/i18n';
import type {
  CompanyProfile, UserProfile, VineyardBlock, WineLot, Vessel, HarvestRecord,
  GrapeSamplingRecord, InventoryItem, LabAnalysis, TransferEvent, GrapeIntakeRecord, CellarOperation,
  BottlingRunRecord, SalesDispatchRecord,
} from '../lib/wineryState';
import {
  listForms, buildDocument, buildFilename, type ExportContext, type FilterId, type FormTemplate,
} from '../lib/georgianForms';
import { renderDocumentHtml } from '../lib/georgianForms/renderHtml';
import { demoPools } from '../lib/georgianForms/demoData';

interface Props {
  lang: Language;
  company: CompanyProfile;
  currentUser: UserProfile;
  blocks: VineyardBlock[];
  lots: WineLot[];
  vessels: Vessel[];
  harvests: HarvestRecord[];
  samplings: GrapeSamplingRecord[];
  inventory: InventoryItem[];
  labLogs: LabAnalysis[];
  grapeIntakes: GrapeIntakeRecord[];
  cellarOps: CellarOperation[];
  bottlingRuns: BottlingRunRecord[];
  salesDispatches: SalesDispatchRecord[];
}

function loadTransfers(): TransferEvent[] {
  try {
    const raw = localStorage.getItem('cf_transfers_history');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

const yearStartISO = () => `${new Date().getFullYear()}-01-01`;
// Annual traceability forms default to the full accounting year, so a whole
// season's data (e.g. an autumn harvest) is captured without adjusting dates.
const yearEndISO = () => `${new Date().getFullYear()}-12-31`;

export default function OfficialDocsTab(props: Props) {
  const { lang, company, currentUser } = props;
  const ka = lang === 'ka';
  const forms = useMemo(() => listForms(), []);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [formId, setFormId] = useState(forms[0].id);
  const [mode, setMode] = useState<'filled' | 'blank'>('filled');
  const [from, setFrom] = useState(yearStartISO());
  const [to, setTo] = useState(yearEndISO());
  const [accountingYear, setAccountingYear] = useState(String(new Date().getFullYear()));
  const [blockId, setBlockId] = useState('');
  const [lotId, setLotId] = useState('');
  const [tankId, setTankId] = useState('');
  const [productName, setProductName] = useState('');
  const [materialId, setMaterialId] = useState('');
  const [blankRows, setBlankRows] = useState(12);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxError, setXlsxError] = useState<string | null>(null);
  const [useDemo, setUseDemo] = useState(false);

  const realTransfers = useMemo(loadTransfers, []);
  const template = useMemo(() => forms.find(f => f.id === formId)!, [forms, formId]);

  // Data pools: the user's real (synced) data, or a self-contained demo set.
  const pools = useDemo ? demoPools : {
    blocks: props.blocks, lots: props.lots, vessels: props.vessels, harvests: props.harvests,
    samplings: props.samplings, inventory: props.inventory, labLogs: props.labLogs, transfers: realTransfers,
    grapeIntakes: props.grapeIntakes, cellarOps: props.cellarOps, bottlingRuns: props.bottlingRuns,
    salesDispatches: props.salesDispatches,
  };

  const ctx: ExportContext = useMemo(() => ({
    lang: ka ? 'ka' : 'en',
    mode,
    blankRows,
    company,
    generatedBy: currentUser.fullName,
    dateRange: { from, to },
    accountingYear,
    blockId: blockId || undefined,
    lotId: lotId || undefined,
    tankId: tankId || undefined,
    productName: productName || undefined,
    materialId: materialId || undefined,
    blocks: pools.blocks,
    lots: pools.lots,
    vessels: pools.vessels,
    harvests: pools.harvests,
    samplings: pools.samplings,
    inventory: pools.inventory,
    labLogs: pools.labLogs,
    transfers: pools.transfers,
    grapeIntakes: pools.grapeIntakes,
    cellarOps: pools.cellarOps,
    bottlingRuns: pools.bottlingRuns,
    salesDispatches: pools.salesDispatches,
  }), [ka, mode, blankRows, company, currentUser, from, to, accountingYear, blockId, lotId, tankId,
      productName, materialId, pools]);

  const doc = useMemo(() => {
    try { return buildDocument(formId, ctx); } catch { return null; }
  }, [formId, ctx]);

  const html = useMemo(() => (doc ? renderDocumentHtml(doc) : ''), [doc]);

  // Keep the preview iframe in sync.
  useEffect(() => {
    const w = iframeRef.current;
    if (w) w.srcdoc = html;
  }, [html]);

  const has = (f: FilterId) => template.filters.includes(f);

  const exportPdf = () => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  const exportXlsx = async () => {
    if (!doc) return;
    setXlsxBusy(true);
    setXlsxError(null);
    try {
      const { renderDocumentXlsx } = await import('../lib/georgianForms/renderXlsx');
      const blob = await renderDocumentXlsx(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = buildFilename(template, ctx, 'xlsx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setXlsxError(e?.message || 'XLSX export failed');
    } finally {
      setXlsxBusy(false);
    }
  };

  const errorCount = doc?.warnings.filter(w => w.level === 'error').length ?? 0;
  const warnCount = doc?.warnings.filter(w => w.level === 'warning').length ?? 0;

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col space-y-5 font-sans animate-fade-in">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded font-bold">
          {ka ? 'ოფიციალური მიკვლევადობა' : 'Official traceability'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <ShieldCheck className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'ოფიციალური დოკუმენტები' : 'Official Documents'}
        </h3>
        <p className="text-xs text-stone-400 font-semibold mt-0.5">
          {ka
            ? 'მევენახეობა-მეღვინეობის ტექნოლოგიური პროცესების აღრიცხვა — დანართები №1–№20'
            : 'Viticulture & winemaking traceability forms — Annexes №1–№20'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* ── Controls ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Form picker */}
          <div className="bg-white border border-[#e8dfd5] p-4 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
            <label className={labelCls}>{ka ? 'დოკუმენტის ტიპი' : 'Document type'}</label>
            <select value={formId} onChange={e => setFormId(e.target.value)} className={inputCls}>
              {forms.map(f => (
                <option key={f.id} value={f.id}>
                  №{f.annexNumber} — {ka ? f.titleKa : f.titleEn}
                </option>
              ))}
            </select>
            {template.notes && (
              <p className="mt-2 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex gap-1.5 dark:bg-amber-950/40 dark:border-amber-900/50">
                <Info className="w-3 h-3 shrink-0 mt-0.5" /> {template.notes}
              </p>
            )}
          </div>

          {/* Mode */}
          <div className="bg-white border border-[#e8dfd5] p-4 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
            <label className={labelCls}>{ka ? 'ექსპორტის რეჟიმი' : 'Export mode'}</label>
            <div className="inline-flex rounded-lg border border-stone-200 overflow-hidden w-full dark:border-stone-800">
              {([
                { id: 'filled', label: ka ? 'შევსებული' : 'Filled from data' },
                { id: 'blank', label: ka ? 'ცარიელი ფორმა' : 'Blank form' },
              ] as const).map(opt => (
                <button key={opt.id} type="button" onClick={() => setMode(opt.id)}
                  className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                    mode === opt.id ? 'bg-[#4e0e15] text-amber-50' : 'bg-stone-50 text-stone-500 hover:bg-stone-100 dark:bg-stone-900'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
            {mode === 'blank' && (
              <div className="mt-3">
                <label className={labelCls}>{ka ? 'ცარიელი სტრიქონები' : 'Blank rows'}</label>
                <input type="number" min={1} max={60} value={blankRows}
                  onChange={e => setBlankRows(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))}
                  className={inputCls} />
              </div>
            )}
            {/* Demo data — preview/test exports without touching real synced data */}
            <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={useDemo} onChange={e => setUseDemo(e.target.checked)}
                className="w-3.5 h-3.5 accent-[#4e0e15] cursor-pointer" />
              <span className="text-[11px] font-bold text-stone-600 dark:text-stone-300">
                {ka ? 'სადემონსტრაციო მონაცემები' : 'Use sample / demo data'}
              </span>
            </label>
          </div>

          {/* Filters */}
          <div className="bg-white border border-[#e8dfd5] p-4 rounded-2xl shadow-sm space-y-3 dark:bg-stone-900 dark:border-stone-800">
            <label className={labelCls}>{ka ? 'ფილტრები' : 'Filters'}</label>

            {has('dateRange') && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'დან' : 'From'}</label>
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'მდე' : 'To'}</label>
                  <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
                </div>
              </div>
            )}

            {(has('accountingYear') || has('season')) && (
              <div>
                <label className={labelCls}>{ka ? 'სააღრიცხვო წელი' : 'Accounting year'}</label>
                <input type="number" value={accountingYear} onChange={e => setAccountingYear(e.target.value)} className={inputCls} />
              </div>
            )}

            {has('vineyardBlock') && (
              <div>
                <label className={labelCls}>{ka ? 'ნაკვეთი' : 'Vineyard block'}</label>
                <select value={blockId} onChange={e => setBlockId(e.target.value)} className={inputCls}>
                  <option value="">{ka ? 'ყველა' : 'All blocks'}</option>
                  {pools.blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}

            {has('wineLot') && (
              <div>
                <label className={labelCls}>{ka ? 'ღვინის ლოტი' : 'Wine lot'}</label>
                <select value={lotId} onChange={e => setLotId(e.target.value)} className={inputCls}>
                  <option value="">{ka ? 'ყველა ლოტი' : 'All lots'}</option>
                  {pools.lots.map(l => <option key={l.id} value={l.id}>{l.name} ({l.id})</option>)}
                </select>
              </div>
            )}

            {has('tank') && (
              <div>
                <label className={labelCls}>{ka ? 'ჭურჭელი / ცისტერნა' : 'Tank / vessel'}</label>
                <select value={tankId} onChange={e => setTankId(e.target.value)} className={inputCls}>
                  <option value="">{ka ? 'ყველა' : 'All tanks'}</option>
                  {pools.vessels.map(v => <option key={v.id} value={v.id}>{v.id}</option>)}
                </select>
              </div>
            )}

            {has('material') && (
              <div>
                <label className={labelCls}>{ka ? 'მასალა' : 'Material'}</label>
                <select value={materialId} onChange={e => setMaterialId(e.target.value)} className={inputCls}>
                  <option value="">{ka ? 'ყველა მასალა' : 'All materials'}</option>
                  {pools.inventory.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </div>
            )}

            {(has('product') || has('wineLot')) && (
              <div>
                <label className={labelCls}>{ka ? 'პროდუქციის დასახელება' : 'Product name'}</label>
                <input type="text" value={productName} placeholder={ka ? 'მაგ. საფერავი 2024' : 'e.g. Saperavi 2024'}
                  onChange={e => setProductName(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>

          {/* Export actions */}
          <div className="bg-white border border-[#e8dfd5] p-4 rounded-2xl shadow-sm space-y-2 dark:bg-stone-900 dark:border-stone-800">
            <button onClick={exportPdf}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#4e0e15] hover:bg-[#34070a] text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
              <Printer className="w-4 h-4" /> {ka ? 'PDF ექსპორტი / ბეჭდვა' : 'Export PDF / Print'}
            </button>
            <button onClick={exportXlsx} disabled={xlsxBusy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-60 text-white rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
              {xlsxBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {ka ? 'Excel (XLSX) ექსპორტი' : 'Export Excel (XLSX)'}
            </button>
            {xlsxError && <p className="text-[10px] text-rose-600 font-bold">{xlsxError}</p>}
            <p className="text-[9px] text-stone-400 font-mono pt-1">
              <FileDown className="w-3 h-3 inline mr-1" />
              {buildFilename(template, ctx, 'pdf')}
            </p>
          </div>
        </div>

        {/* ── Preview + warnings ──────────────────────────────── */}
        <div className="space-y-4">
          {/* Validation */}
          {doc && mode === 'filled' && doc.warnings.length > 0 && (
            <div className="bg-white border border-[#e8dfd5] p-4 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-xs font-bold text-stone-800 dark:text-amber-100">
                  {ka ? 'შემოწმება ექსპორტამდე' : 'Pre-export validation'}
                </span>
                {errorCount > 0 && <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{errorCount} {ka ? 'შეცდომა' : 'errors'}</span>}
                {warnCount > 0 && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{warnCount} {ka ? 'გაფრთხილება' : 'warnings'}</span>}
              </div>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {doc.warnings.slice(0, 40).map((w, i) => (
                  <li key={i} className={`text-[11px] flex gap-1.5 ${w.level === 'error' ? 'text-rose-700' : 'text-amber-700'}`}>
                    <span className="shrink-0">{w.level === 'error' ? '⛔' : '⚠️'}</span>
                    <span>{ka ? w.messageKa : w.messageEn}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Preview */}
          <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
            <div className="px-4 py-2.5 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
              <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
                <FileText className="w-4 h-4" /> {ka ? 'წინასწარი ხედი' : 'Preview'} — დანართი №{template.annexNumber}
              </span>
              <span className="text-[9px] font-mono text-stone-400 uppercase">
                {template.orientation === 'landscape' ? (ka ? 'ჰორიზონტალური' : 'Landscape') : (ka ? 'ვერტიკალური' : 'Portrait')} · A4 · v{template.version}
              </span>
            </div>
            <iframe ref={iframeRef} title="document-preview" className="w-full bg-white" style={{ height: '70vh', border: 'none' }} />
          </div>
        </div>
      </div>
    </main>
  );
}
