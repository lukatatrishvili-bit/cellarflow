'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import {
  type InvoiceAnalysisDraft,
  type InvoiceLineDraft,
} from '../lib/invoiceAnalysis';
import { CORE_INVENTORY_CATEGORIES } from '../lib/inventoryCategories';
import type { InventoryItem } from '../lib/wineryState';
import {
  identityExchangeRateQuote,
  normalizeInvoiceCurrency,
  type ExchangeRateQuote,
  type SupportedInvoiceCurrency,
} from '../lib/currency';
import {
  createInvoiceReceiptCommandIntent,
  submitInvoiceReceiptCommand,
  type InvoiceReceiptCommandResponse,
} from '../lib/commands/client';
import type { InvoiceCostBasis } from '../lib/commands/invoiceReceipt';

const MAX_FILE_BYTES = 3_400_000;
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const NON_INVENTORY_CATEGORIES = new Set(['service', 'freight', 'discount', 'non_inventory']);

interface Props {
  lang: Language;
  inventory: InventoryItem[];
  canCreate: boolean;
  canUpdate: boolean;
  canPostCosts: boolean;
  accountingCurrency: string;
  onApplyCommandResponse: (response: InvoiceReceiptCommandResponse) => void;
  onClose: () => void;
}

type ImportMode = 'create' | 'receive';

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The invoice file could not be read.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function responseError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string') {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function money(value: number | undefined, currency: string): string {
  if (!Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.length === 3 ? currency : 'GEL',
      maximumFractionDigits: 2,
    }).format(Number(value));
  } catch {
    return `${Number(value).toFixed(2)} ${currency}`;
  }
}

function sameUnit(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

function sourceCost(line: InvoiceLineDraft, basis: InvoiceCostBasis): number {
  const fallbackNet = line.stockQuantity * line.unitCost;
  if (basis === 'gross') return Math.max(0, line.lineTotal ?? ((line.lineNetAmount ?? fallbackNet) + (line.taxAmount ?? 0)));
  return Math.max(0, line.lineNetAmount ?? fallbackNet);
}

async function sha256(file: File | null): Promise<string | undefined> {
  if (!file || !globalThis.crypto?.subtle) return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceLabel(status: InvoiceLineDraft['sourceStatus'], ka: boolean): string {
  if (status === 'official') return ka ? 'ოფიციალური წყარო' : 'Official source';
  if (status === 'grounded') return ka ? 'ონლაინ წყარო' : 'Grounded source';
  if (status === 'not_applicable') return ka ? 'არ გამოიყენება' : 'Not applicable';
  return ka ? 'წყარო ვერ მოიძებნა' : 'No verified source';
}

export default function InvoiceInventoryImporter({
  lang,
  inventory,
  canCreate,
  canUpdate,
  canPostCosts,
  accountingCurrency,
  onApplyCommandResponse,
  onClose,
}: Props) {
  const ka = lang === 'ka';
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [invoiceText, setInvoiceText] = useState('');
  const [enrichOnline, setEnrichOnline] = useState(true);
  const [draft, setDraft] = useState<InvoiceAnalysisDraft | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modes, setModes] = useState<Record<string, ImportMode>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [importedMessage, setImportedMessage] = useState('');
  const normalizedAccountingCurrency = normalizeInvoiceCurrency(accountingCurrency) || 'GEL';
  const [invoiceCurrency, setInvoiceCurrency] = useState<SupportedInvoiceCurrency>(normalizedAccountingCurrency);
  const [rateInput, setRateInput] = useState('1');
  const [rateQuote, setRateQuote] = useState<ExchangeRateQuote | null>(null);
  const [rateMode, setRateMode] = useState<'official' | 'manual' | 'identity'>('identity');
  const [rateBusy, setRateBusy] = useState(false);
  const [costBasis, setCostBasis] = useState<InvoiceCostBasis>('net');
  const [additionalCostsSource, setAdditionalCostsSource] = useState(0);
  const [confirmedConversions, setConfirmedConversions] = useState<Set<string>>(new Set());

  const categories = useMemo(() => Array.from(new Set([
    ...CORE_INVENTORY_CATEGORIES,
    ...inventory.map((item) => item.category).filter(Boolean),
    ...(draft?.lines.map((line) => line.category).filter(Boolean) || []),
    'oenology', 'laboratory', 'vineyard', 'equipment', 'unassigned',
  ])).sort(), [draft, inventory]);

  const sourcesById = useMemo(
    () => new Map((draft?.sources || []).map((source) => [source.id, source])),
    [draft],
  );

  const chosenLines = useMemo(
    () => draft?.lines.filter((line) => selectedIds.has(line.id)) || [],
    [draft, selectedIds],
  );

  const estimatedImportValue = chosenLines.reduce((sum, line) => sum + sourceCost(line, costBasis), 0)
    + Math.max(0, additionalCostsSource);
  const activeRate = Number(rateInput);
  const estimatedAccountingValue = Number.isFinite(activeRate) && activeRate > 0
    ? estimatedImportValue * activeRate
    : 0;

  const loadOfficialRate = async (
    fromCurrency: SupportedInvoiceCurrency,
    invoiceDate?: string,
  ) => {
    const requestedDate = invoiceDate && invoiceDate <= new Date().toISOString().slice(0, 10)
      ? invoiceDate
      : new Date().toISOString().slice(0, 10);
    if (fromCurrency === normalizedAccountingCurrency) {
      const quote = identityExchangeRateQuote(fromCurrency, requestedDate);
      setRateQuote(quote);
      setRateInput('1');
      setRateMode('identity');
      return;
    }
    setRateBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({
        from: fromCurrency,
        to: normalizedAccountingCurrency,
        date: requestedDate,
      });
      const response = await fetch(`/api/finance/exchange-rate?${params.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.quote) {
        throw new Error(responseError(payload, 'The official exchange rate is unavailable.'));
      }
      const quote = payload.quote as ExchangeRateQuote;
      setRateQuote(quote);
      setRateInput(String(Number(quote.rate.toFixed(8))));
      setRateMode('official');
    } catch (rateError) {
      setRateQuote(null);
      setRateMode('manual');
      setError(rateError instanceof Error ? rateError.message : 'The official exchange rate is unavailable.');
    } finally {
      setRateBusy(false);
    }
  };

  const chooseFile = (candidate: File | null) => {
    setError('');
    if (!candidate) {
      setFile(null);
      return;
    }
    if (!ACCEPTED_TYPES.has(candidate.type)) {
      setError(ka ? 'გამოიყენეთ PDF, JPEG, PNG ან WebP ინვოისი.' : 'Use a PDF, JPEG, PNG, or WebP invoice.');
      return;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      setError(ka ? 'ფაილი უნდა იყოს 3 MB-ზე ნაკლები.' : 'The invoice file must be smaller than 3 MB.');
      return;
    }
    setFile(candidate);
  };

  const initializeReview = (result: InvoiceAnalysisDraft) => {
    const selected = new Set<string>();
    const nextModes: Record<string, ImportMode> = {};
    const nextTargets: Record<string, string> = {};
    const conversions = new Set<string>();
    result.lines.forEach((line) => {
      const stockLine = !NON_INVENTORY_CATEGORIES.has(line.category) && line.stockQuantity > 0;
      const compatibleMatch = line.match
        ? inventory.find((item) => item.id === line.match?.inventoryItemId && sameUnit(item.unit, line.stockUnit))
        : undefined;
      const firstCompatible = compatibleMatch || inventory.find((item) => sameUnit(item.unit, line.stockUnit));
      if (stockLine && ((firstCompatible && canUpdate) || canCreate)) selected.add(line.id);
      if (compatibleMatch && canUpdate) {
        nextModes[line.id] = 'receive';
        nextTargets[line.id] = compatibleMatch.id;
      } else if (!canCreate && canUpdate && firstCompatible) {
        nextModes[line.id] = 'receive';
        nextTargets[line.id] = firstCompatible.id;
      } else {
        nextModes[line.id] = 'create';
      }
      if (sameUnit(line.invoiceUnit, line.stockUnit)) conversions.add(line.id);
    });
    setSelectedIds(selected);
    setModes(nextModes);
    setTargets(nextTargets);
    setConfirmedConversions(conversions);
    const nextCurrency = normalizeInvoiceCurrency(result.invoice.currency) || normalizedAccountingCurrency;
    setInvoiceCurrency(nextCurrency);
    void loadOfficialRate(nextCurrency, result.invoice.invoiceDate);
  };

  const analyze = async () => {
    if (!file && !invoiceText.trim()) {
      setError(ka ? 'ატვირთეთ ინვოისი ან ჩასვით მისი ტექსტი.' : 'Attach an invoice or paste its text first.');
      return;
    }
    setBusy(true);
    setError('');
    setImportedMessage('');
    try {
      const dataUrl = file ? await readAsDataUrl(file) : undefined;
      const response = await fetch('/api/ai/invoices/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(file && dataUrl ? {
            file: { fileName: file.name, mimeType: file.type, dataUrl },
          } : {}),
          invoiceText: invoiceText.trim(),
          enrichOnline,
          lang,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(payload, 'Invoice analysis failed.'));
      const result = payload as InvoiceAnalysisDraft;
      const normalizedResult: InvoiceAnalysisDraft = {
        ...result,
        invoice: {
          ...result.invoice,
          currency: normalizeInvoiceCurrency(result.invoice.currency) || normalizedAccountingCurrency,
        },
      };
      setDraft(normalizedResult);
      initializeReview(normalizedResult);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : 'Invoice analysis failed.');
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (id: string, patch: Partial<InvoiceLineDraft>) => {
    setDraft((current) => current ? {
      ...current,
      lines: current.lines.map((line) => line.id === id ? { ...line, ...patch } : line),
    } : current);
  };

  const setMode = (line: InvoiceLineDraft, mode: ImportMode) => {
    if (mode === 'create' && !canCreate) return;
    if (mode === 'receive' && !canUpdate) return;
    setModes((current) => ({ ...current, [line.id]: mode }));
    if (mode === 'receive' && !targets[line.id]) {
      const compatible = inventory.find((item) => sameUnit(item.unit, line.stockUnit));
      if (compatible) setTargets((current) => ({ ...current, [line.id]: compatible.id }));
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const importLines = async () => {
    if (!draft || !chosenLines.length || busy) return;
    if (!canPostCosts) {
      setError(ka
        ? 'ამ როლს ინვოისის ღირებულებისა და მარაგის ერთად დაპოსტვა არ შეუძლია.'
        : 'Your role cannot post acquisition costs and inventory together.');
      return;
    }
    const missingTarget = chosenLines.find(line => (modes[line.id] || 'create') === 'receive' && !targets[line.id]);
    if (missingTarget) {
      setError(`Choose an existing inventory item for ${missingTarget.productName}.`);
      return;
    }
    const unconfirmed = chosenLines.find(line => !sameUnit(line.invoiceUnit, line.stockUnit)
      && !confirmedConversions.has(line.id));
    if (unconfirmed) {
      setError(`Confirm the package conversion for ${unconfirmed.productName} before posting.`);
      return;
    }
    if (!Number.isFinite(activeRate) || activeRate <= 0) {
      setError('Enter a valid positive exchange rate.');
      return;
    }

    const requestedDate = draft.invoice.invoiceDate
      && draft.invoice.invoiceDate <= new Date().toISOString().slice(0, 10)
      ? draft.invoice.invoiceDate
      : new Date().toISOString().slice(0, 10);
    const exchangeRate: ExchangeRateQuote = invoiceCurrency === normalizedAccountingCurrency
      ? identityExchangeRateQuote(invoiceCurrency, requestedDate)
      : rateMode === 'official' && rateQuote
        ? rateQuote
        : {
          fromCurrency: invoiceCurrency,
          toCurrency: normalizedAccountingCurrency,
          rate: activeRate,
          requestedDate,
          rateDate: requestedDate,
          source: 'manual',
          sourceLabel: 'Manually confirmed exchange rate',
          retrievedAt: new Date().toISOString(),
        };

    setBusy(true);
    setError('');
    try {
      const intent = createInvoiceReceiptCommandIntent({
        analysisId: draft.analysisId,
        documentChecksum: await sha256(file),
        invoice: { ...draft.invoice, currency: invoiceCurrency },
        accountingCurrency: normalizedAccountingCurrency,
        exchangeRate,
        costBasis,
        additionalCostsSource: Math.max(0, additionalCostsSource),
        sources: draft.sources,
        lines: chosenLines.map((line) => ({
          lineId: line.id,
          mode: modes[line.id] || 'create',
          ...((modes[line.id] || 'create') === 'receive' ? { inventoryItemId: targets[line.id] } : {}),
          productName: line.productName,
          category: line.category || 'unassigned',
          supplierName: line.supplierName || draft.invoice.supplierName,
          sku: line.sku,
          brandName: line.brandName,
          manufacturerName: line.manufacturerName,
          invoiceDescription: line.invoiceDescription,
          invoiceQuantity: line.invoiceQuantity,
          invoiceUnit: line.invoiceUnit,
          stockQuantity: line.stockQuantity,
          stockUnit: line.stockUnit,
          conversionFactor: line.stockQuantity / line.invoiceQuantity,
          conversionConfirmed: sameUnit(line.invoiceUnit, line.stockUnit) || confirmedConversions.has(line.id),
          packageSize: line.packageSize,
          packageUnit: line.packageUnit,
          sourceCostPerStockUnit: line.unitCost,
          lineNetAmount: line.lineNetAmount,
          taxRatePct: line.taxRatePct,
          taxAmount: line.taxAmount,
          lineTotal: line.lineTotal,
          lotNumber: line.lotNumber,
          expiryDate: line.expiryDate,
          activeIngredients: line.activeIngredients,
          recommendedDosage: line.recommendedDosage,
          usageInstructions: line.usageInstructions,
          safetyNotes: line.safetyNotes,
          sourceIds: line.sourceIds,
        })),
      });
      const response = await submitInvoiceReceiptCommand(intent);
      onApplyCommandResponse(response);
      const parts = [
        response.result.created ? `${response.result.created} ${ka ? 'ახალი' : 'created'}` : '',
        response.result.updated ? `${response.result.updated} ${ka ? 'მიღებული' : 'received'}` : '',
      ].filter(Boolean);
      setImportedMessage(ka
        ? `ინვოისი დაპოსტილია: ${parts.join(', ')}.`
        : `Invoice posted atomically: ${parts.join(', ')}. Receipt ${response.result.receipt.id} is retained for audit and reversal.`);
      setSelectedIds(new Set());
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'The invoice receipt could not be posted.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDraft(null);
    setSelectedIds(new Set());
    setModes({});
    setTargets({});
    setError('');
    setImportedMessage('');
    setCostBasis('net');
    setAdditionalCostsSource(0);
    setRateQuote(null);
    setRateInput('1');
    setRateMode('identity');
    setConfirmedConversions(new Set());
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-[#cbb9a5] bg-[#fffdf9] shadow-[0_18px_50px_-30px_rgba(78,14,21,0.45)]">
      <div className="flex flex-col gap-3 border-b border-[#e8dfd5] bg-[linear-gradient(110deg,#4e0e15,#6f1824)] px-5 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-white/10 p-2 ring-1 ring-white/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-serif text-base font-black">{ka ? 'AI ინვოისის მიღება' : 'AI invoice receiving'}</h3>
            <p className="mt-0.5 max-w-3xl text-[11px] leading-relaxed text-rose-50/80">
              {ka
                ? 'ამოიღეთ პროდუქტები, კომპანიები, კატეგორიები, რაოდენობები და ხარჯები; შემდეგ გადაამოწმეთ ყველა ხაზი მარაგში დამატებამდე.'
                : 'Extract products, companies, categories, quantities, costs, and official-source specifications—then review every line before inventory changes.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="self-end rounded-lg p-1.5 text-white/75 transition hover:bg-white/10 hover:text-white sm:self-auto"
          aria-label={ka ? 'დახურვა' : 'Close invoice analyzer'}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!draft ? (
        <div className="grid gap-5 p-5 lg:grid-cols-[1.15fr_.85fr]">
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                chooseFile(event.dataTransfer.files?.[0] || null);
              }}
              className="group flex min-h-40 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#cbb9a5] bg-white px-6 py-7 text-center transition hover:border-[#801323] hover:bg-rose-50/30"
            >
              <span className="rounded-full bg-[#f4ece5] p-3 text-[#801323] transition group-hover:scale-105">
                <Upload className="h-6 w-6" />
              </span>
              <span className="mt-3 text-sm font-bold text-stone-800">
                {file ? file.name : (ka ? 'ატვირთეთ ან ჩააგდეთ ინვოისი' : 'Upload or drop an invoice')}
              </span>
              <span className="mt-1 text-[10px] text-stone-500">
                {file
                  ? `${(file.size / 1_000_000).toFixed(2)} MB`
                  : (ka ? 'PDF, JPEG, PNG ან WebP · მაქს. 3 MB' : 'PDF, JPEG, PNG, or WebP · max 3 MB')}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => chooseFile(event.target.files?.[0] || null)}
              />
            </button>
            <div>
              <label htmlFor="invoice-text" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-stone-500">
                {ka ? 'ან ჩასვით ინვოისის ტექსტი' : 'Or paste invoice text'}
              </label>
              <textarea
                id="invoice-text"
                value={invoiceText}
                onChange={(event) => setInvoiceText(event.target.value)}
                rows={5}
                placeholder={ka ? 'მომწოდებელი, ინვოისის ნომერი, პროდუქტის ხაზები, რაოდენობა, ფასი, გადასახადი…' : 'Supplier, invoice number, product lines, quantities, prices, tax…'}
                className="w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs leading-relaxed outline-none transition focus:border-[#801323] focus:ring-2 focus:ring-rose-100"
              />
            </div>
          </div>

          <div className="flex flex-col rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-center gap-2 text-xs font-black text-stone-800">
              <Search className="h-4 w-4 text-[#801323]" />
              {ka ? 'პროდუქტის პროფესიული გამდიდრება' : 'Professional product enrichment'}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-stone-600">
              {ka
                ? 'AI მოიძიებს მწარმოებლის ან მარეგულირებლის წყაროებს აქტიური ინგრედიენტების, დოზირებისა და გამოყენების ინსტრუქციისთვის. დაუდასტურებელი წყაროს მქონე მონაცემები აღინიშნება თქვენი შემოწმებისთვის.'
                : 'AI searches manufacturer or regulator sources for active ingredients, dosage, and use instructions. Findings without a verified source are flagged for your review.'}
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
              <input
                type="checkbox"
                checked={enrichOnline}
                onChange={(event) => setEnrichOnline(event.target.checked)}
                className="mt-0.5 accent-[#801323]"
              />
              <span>
                <span className="block text-[11px] font-bold text-stone-800">
                  {ka ? 'ოფიციალური ონლაინ წყაროების მოძიება' : 'Look up official online sources'}
                </span>
                <span className="mt-0.5 block text-[9px] leading-relaxed text-stone-500">
                  {ka ? 'იყენებს დამატებით AI მოთხოვნას და შეიძლება მეტ დროს საჭიროებდეს.' : 'Uses one additional AI call and may take a little longer.'}
                </span>
              </span>
            </label>
            <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-950">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>
                {ka
                  ? 'დოზა და გამოყენება საინფორმაციო მონახაზია. ყოველთვის გადაამოწმეთ მოქმედი ადგილობრივი ეტიკეტი, SDS და ენოლოგის გადაწყვეტილება.'
                  : 'Dosage and use remain informational drafts. Always verify the current local label, SDS, product registration, and qualified winemaker decision.'}
              </span>
            </div>
            <button
              type="button"
              onClick={analyze}
              disabled={busy || (!file && !invoiceText.trim())}
              className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#4e0e15] px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-[#6b151e] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy
                ? (ka ? 'ინვოისი მუშავდება…' : 'Analyzing invoice…')
                : (ka ? 'ინვოისის ანალიზი' : 'Analyze invoice')}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="grid gap-3 border-b border-[#e8dfd5] bg-white px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'მომწოდებელი' : 'Supplier'}</span>
              <div className="mt-0.5 truncate text-sm font-black text-stone-850">{draft.invoice.supplierName || '—'}</div>
              <div className="mt-0.5 truncate text-[10px] text-stone-500">{draft.invoice.supplierAddress || draft.invoice.supplierCompanyId || ''}</div>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'ინვოისი' : 'Invoice'}</span>
              <div className="mt-0.5 text-xs font-bold text-stone-800">{draft.invoice.invoiceNumber || '—'}</div>
              <div className="mt-0.5 text-[10px] text-stone-500">{draft.invoice.invoiceDate || '—'}</div>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'სულ' : 'Invoice total'}</span>
              <div className="mt-0.5 font-mono text-sm font-black text-[#4e0e15]">{money(draft.invoice.total, draft.invoice.currency)}</div>
              <div className="mt-0.5 text-[10px] text-stone-500">{draft.invoice.taxAmount ? `${ka ? 'გადასახადი' : 'Tax'} ${money(draft.invoice.taxAmount, draft.invoice.currency)}` : ''}</div>
            </div>
            <div>
              <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'ანალიზი' : 'Analysis'}</span>
              <div className="mt-0.5 text-xs font-bold text-stone-800">{draft.lines.length} {ka ? 'ხაზი' : 'lines'}</div>
              <div className="mt-0.5 text-[10px] text-stone-500">{draft.sources.length} {ka ? 'ონლაინ წყარო' : 'online sources'}</div>
            </div>
          </div>

          {(draft.warnings.length > 0 || error) && (
            <div className="space-y-1 border-b border-amber-200 bg-amber-50 px-5 py-3 text-[10px] text-amber-950">
              {[...(error ? [error] : []), ...draft.warnings].map((warning, index) => (
                <div key={`${warning}-${index}`} className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-b border-[#e8dfd5] bg-[#fffdf9] px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-black text-stone-850">Currency & landed-cost treatment</h4>
                <p className="mt-0.5 text-[9px] text-stone-500">Original invoice values remain unchanged; inventory is valued in the company currency.</p>
              </div>
              {rateQuote?.sourceUrl && rateMode === 'official' && (
                <a href={rateQuote.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[9px] font-bold text-blue-700 hover:underline">
                  <ExternalLink className="h-3 w-3" /> NBG rate source
                </a>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label>
                <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">Invoice currency</span>
                <select
                  value={invoiceCurrency}
                  onChange={(event) => {
                    const next = event.target.value as SupportedInvoiceCurrency;
                    setInvoiceCurrency(next);
                    setDraft(current => current ? { ...current, invoice: { ...current.invoice, currency: next } } : current);
                    void loadOfficialRate(next, draft.invoice.invoiceDate);
                  }}
                  className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs font-black outline-none focus:border-[#801323]"
                >
                  <option value="GEL">GEL — Georgian lari</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="USD">USD — US dollar</option>
                </select>
              </label>
              <div>
                <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">Company currency</span>
                <div className="mt-1 rounded-lg border border-stone-200 bg-stone-50 px-2 py-2 text-xs font-black text-stone-700">{normalizedAccountingCurrency}</div>
              </div>
              <label>
                <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">1 {invoiceCurrency} in {normalizedAccountingCurrency}</span>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min="0.00000001"
                    step="0.000001"
                    value={rateInput}
                    disabled={invoiceCurrency === normalizedAccountingCurrency}
                    onChange={(event) => {
                      setRateInput(event.target.value);
                      setRateMode(invoiceCurrency === normalizedAccountingCurrency ? 'identity' : 'manual');
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-stone-200 px-2 py-2 font-mono text-xs outline-none focus:border-[#801323] disabled:bg-stone-50"
                  />
                  {invoiceCurrency !== normalizedAccountingCurrency && (
                    <button
                      type="button"
                      onClick={() => void loadOfficialRate(invoiceCurrency, draft.invoice.invoiceDate)}
                      disabled={rateBusy}
                      className="rounded-lg border border-stone-200 bg-white px-2 text-[9px] font-bold text-[#4e0e15] hover:bg-stone-50 disabled:opacity-50"
                    >
                      {rateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'NBG'}
                    </button>
                  )}
                </div>
                <span className={`mt-1 block text-[8px] font-bold ${rateMode === 'manual' ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {rateMode === 'official' ? `Official · ${rateQuote?.rateDate || ''}` : rateMode === 'manual' ? 'Manual override · saved with receipt' : 'No conversion'}
                </span>
              </label>
              <label>
                <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">Inventory cost basis</span>
                <select
                  value={costBasis}
                  onChange={(event) => setCostBasis(event.target.value as InvoiceCostBasis)}
                  className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-2 py-2 text-xs outline-none focus:border-[#801323]"
                >
                  <option value="net">Net — exclude line tax</option>
                  <option value="gross">Gross — include line tax</option>
                </select>
                <span className="mt-1 block text-[8px] text-stone-500">Use net when VAT is recoverable.</span>
              </label>
              <label>
                <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">Freight / customs / other ({invoiceCurrency})</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={additionalCostsSource}
                  onChange={(event) => setAdditionalCostsSource(Math.max(0, Number(event.target.value) || 0))}
                  className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-2 font-mono text-xs outline-none focus:border-[#801323]"
                />
                <span className="mt-1 block text-[8px] text-stone-500">Allocated proportionally across selected lines.</span>
              </label>
            </div>
          </div>

          <div className="space-y-3 bg-[#f8f4ef] p-4">
            {draft.lines.map((line) => {
              const selected = selectedIds.has(line.id);
              const mode = modes[line.id] || (canCreate ? 'create' : 'receive');
              const compatibleInventory = inventory.filter((item) => sameUnit(item.unit, line.stockUnit));
              const selectedTarget = inventory.find((item) => item.id === targets[line.id]);
              const lineSources = line.sourceIds.map((id) => sourcesById.get(id)).filter(Boolean);
              const stockLine = !NON_INVENTORY_CATEGORIES.has(line.category);
              const canImportLine = stockLine && (canCreate || (canUpdate && compatibleInventory.length > 0));
              return (
                <article key={line.id} className={`rounded-xl border bg-white transition ${selected ? 'border-[#a6735f] shadow-sm' : 'border-stone-200 opacity-75'}`}>
                  <div className="flex flex-col gap-3 border-b border-stone-100 p-3 lg:flex-row lg:items-start">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!canImportLine}
                        onChange={() => toggleSelected(line.id)}
                        className="mt-1 accent-[#801323]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">#{line.lineNumber}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase ${
                            line.confidenceLabel === 'high'
                              ? 'bg-emerald-50 text-emerald-750'
                              : line.confidenceLabel === 'medium'
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-rose-50 text-rose-700'
                          }`}>
                            {Math.round(line.confidence * 100)}% {ka ? 'სანდოობა' : 'confidence'}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${
                            line.sourceStatus === 'official'
                              ? 'bg-blue-50 text-blue-750'
                              : 'bg-stone-100 text-stone-600'
                          }`}>
                            {sourceLabel(line.sourceStatus, ka)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-stone-500">{line.invoiceDescription}</span>
                      </span>
                    </label>

                    {stockLine ? (
                      <div className="flex flex-col gap-2 sm:flex-row lg:w-[430px]">
                        <select
                          value={mode}
                          onChange={(event) => setMode(line, event.target.value as ImportMode)}
                          className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-[10px] font-bold outline-none focus:border-[#801323]"
                        >
                          {canCreate && <option value="create">{ka ? 'ახალი პროდუქტი' : 'Create new item'}</option>}
                          {canUpdate && <option value="receive">{ka ? 'არსებულში მიღება' : 'Receive into existing'}</option>}
                        </select>
                        {mode === 'receive' && (
                          <select
                            value={targets[line.id] || ''}
                            onChange={(event) => setTargets((current) => ({ ...current, [line.id]: event.target.value }))}
                            className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[10px] outline-none focus:border-[#801323]"
                          >
                            <option value="">{ka ? 'აირჩიეთ თავსებადი პროდუქტი' : 'Choose compatible item'}</option>
                            {compatibleInventory.map((item) => (
                              <option key={item.id} value={item.id}>{item.name} · {item.stock} {item.unit}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ) : (
                      <span className="rounded-lg bg-stone-100 px-3 py-1.5 text-[9px] font-bold uppercase text-stone-500">
                        {ka ? 'მარაგში არ შევა' : 'Excluded from stock'}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-3 p-3 md:grid-cols-12">
                    <label className="md:col-span-4">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'პროდუქტი' : 'Product name'}</span>
                      <input
                        value={line.productName}
                        onChange={(event) => updateLine(line.id, { productName: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-bold outline-none focus:border-[#801323]"
                      />
                    </label>
                    <label className="md:col-span-2">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'კატეგორია' : 'Category'}</span>
                      <input
                        list="invoice-inventory-categories"
                        value={line.category}
                        onChange={(event) => updateLine(line.id, { category: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs outline-none focus:border-[#801323]"
                      />
                    </label>
                    <label className="md:col-span-2">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'მიღებული რაოდენობა' : 'Stock quantity'}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.stockQuantity}
                        onChange={(event) => updateLine(line.id, { stockQuantity: Number(event.target.value) || 0 })}
                        className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 font-mono text-xs outline-none focus:border-[#801323]"
                      />
                    </label>
                    <label className="md:col-span-1">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'ერთ.' : 'Unit'}</span>
                      <input
                        value={line.stockUnit}
                        onChange={(event) => updateLine(line.id, { stockUnit: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-xs outline-none focus:border-[#801323]"
                      />
                    </label>
                    <label className="md:col-span-2">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'მარაგის ერთეულის ფასი' : 'Cost / stock unit'}</span>
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.unitCost}
                        onChange={(event) => updateLine(line.id, { unitCost: Number(event.target.value) || 0 })}
                        className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 font-mono text-xs outline-none focus:border-[#801323]"
                      />
                    </label>
                    <div className="md:col-span-1">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'ხაზი' : 'Line'}</span>
                      <span className="mt-2 block truncate font-mono text-[10px] font-black text-stone-800">{money(line.lineTotal, line.currency)}</span>
                    </div>

                    <div className={`md:col-span-12 rounded-lg border px-3 py-2 ${
                      sameUnit(line.invoiceUnit, line.stockUnit)
                        ? 'border-stone-100 bg-stone-50'
                        : confirmedConversions.has(line.id)
                          ? 'border-emerald-200 bg-emerald-50/60'
                          : 'border-amber-250 bg-amber-50'
                    }`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[9px] text-stone-650">
                          Invoice: <strong>{line.invoiceQuantity} {line.invoiceUnit}</strong>
                          <span className="mx-2 text-stone-300">→</span>
                          Stock: <strong>{line.stockQuantity} {line.stockUnit}</strong> @ {money(line.unitCost, invoiceCurrency)} / {line.stockUnit}
                          <span className="ml-2 text-stone-500">({Number(line.stockQuantity / line.invoiceQuantity).toFixed(6)} {line.stockUnit} per {line.invoiceUnit})</span>
                        </p>
                        {!sameUnit(line.invoiceUnit, line.stockUnit) && (
                          <label className="flex cursor-pointer items-center gap-1.5 text-[9px] font-bold text-amber-900">
                            <input
                              type="checkbox"
                              checked={confirmedConversions.has(line.id)}
                              onChange={(event) => setConfirmedConversions(current => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(line.id); else next.delete(line.id);
                                return next;
                              })}
                              className="accent-[#801323]"
                            />
                            Confirm package conversion
                          </label>
                        )}
                      </div>
                    </div>

                    <label className="md:col-span-3">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'ბრენდი / მწარმოებელი' : 'Brand / manufacturer'}</span>
                      <div className="mt-1 grid grid-cols-2 gap-1">
                        <input
                          value={line.brandName || ''}
                          placeholder={ka ? 'ბრენდი' : 'Brand'}
                          onChange={(event) => updateLine(line.id, { brandName: event.target.value })}
                          className="min-w-0 rounded-lg border border-stone-200 px-2 py-1.5 text-[10px] outline-none focus:border-[#801323]"
                        />
                        <input
                          value={line.manufacturerName || ''}
                          placeholder={ka ? 'მწარმოებელი' : 'Manufacturer'}
                          onChange={(event) => updateLine(line.id, { manufacturerName: event.target.value })}
                          className="min-w-0 rounded-lg border border-stone-200 px-2 py-1.5 text-[10px] outline-none focus:border-[#801323]"
                        />
                      </div>
                    </label>
                    <label className="md:col-span-2">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">SKU</span>
                      <input
                        value={line.sku || ''}
                        onChange={(event) => updateLine(line.id, { sku: event.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 font-mono text-[10px] outline-none focus:border-[#801323]"
                      />
                    </label>
                    <div className="md:col-span-7">
                      <span className="block text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'ღირებულების აღრიცხვა' : 'Cost treatment'}</span>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-stone-600">
                        {mode === 'receive' && selectedTarget
                          ? (ka
                            ? `არსებული ${selectedTarget.stock} ${selectedTarget.unit} და მიღებული მარაგი გაერთიანდება შეწონილი საშუალო ფასით.`
                            : `Existing ${selectedTarget.stock} ${selectedTarget.unit} and this receipt will use a weighted-average unit cost.`)
                          : (ka
                            ? 'ახალი პროდუქტის საწყისი ფასი იქნება ინვოისიდან მიღებული ერთეულის ღირებულება.'
                            : 'A new item starts with the invoice-derived cost per stock unit.')}
                      </p>
                    </div>
                  </div>

                  {(line.activeIngredients.length > 0 || line.recommendedDosage || line.usageInstructions || lineSources.length > 0 || line.warnings.length > 0) && (
                    <div className="grid gap-3 border-t border-stone-100 bg-stone-50/70 p-3 lg:grid-cols-3">
                      <div>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'შემადგენლობა' : 'Active ingredients / composition'}</span>
                        <p className="mt-1 text-[10px] leading-relaxed text-stone-700">{line.activeIngredients.join(', ') || '—'}</p>
                      </div>
                      <div>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'დოზა და გამოყენება' : 'Dosage & use'}</span>
                        <p className="mt-1 text-[10px] leading-relaxed text-stone-700">{[line.recommendedDosage, line.usageInstructions].filter(Boolean).join(' · ') || '—'}</p>
                        {line.safetyNotes && <p className="mt-1 text-[9px] leading-relaxed text-amber-800">{line.safetyNotes}</p>}
                      </div>
                      <div>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-stone-400">{ka ? 'მტკიცებულება და შენიშვნები' : 'Sources & review notes'}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {lineSources.map((source) => source && (
                            <a
                              key={source.id}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[8px] font-bold text-blue-750 hover:underline"
                              title={source.title}
                            >
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{source.title}</span>
                            </a>
                          ))}
                        </div>
                        {line.warnings.map((warning, index) => (
                          <p key={`${warning}-${index}`} className="mt-1 text-[9px] leading-relaxed text-amber-800">• {warning}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            <datalist id="invoice-inventory-categories">
              {categories.map((category) => <option key={category} value={category} />)}
            </datalist>
          </div>

          <div className="sticky bottom-0 flex flex-col gap-3 border-t border-[#d9cabb] bg-white/95 px-5 py-4 shadow-[0_-10px_30px_-24px_rgba(0,0,0,.5)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div>
              {importedMessage ? (
                <p role="status" className="flex items-center gap-2 text-xs font-black text-emerald-750">
                  <Check className="h-4 w-4" /> {importedMessage}
                </p>
              ) : (
                <>
                  <p className="text-xs font-black text-stone-800">{chosenLines.length} {ka ? 'ხაზი არჩეულია' : 'lines selected'}</p>
                  <p className="mt-0.5 text-[10px] text-stone-500">
                    {ka ? 'სავარაუდო მიღების ღირებულება' : 'Estimated receipt value'}: {money(estimatedImportValue, invoiceCurrency)}
                    {invoiceCurrency !== normalizedAccountingCurrency && (
                      <span className="font-bold text-[#4e0e15]"> · {money(estimatedAccountingValue, normalizedAccountingCurrency)}</span>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[10px] font-bold text-stone-700 hover:bg-stone-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> {ka ? 'ხელახლა ანალიზი' : 'Analyze another'}
              </button>
              <button
                type="button"
                onClick={() => void importLines()}
                disabled={!chosenLines.length || Boolean(importedMessage) || busy || !canPostCosts}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-4 py-2 text-[10px] font-black text-white shadow-sm hover:bg-[#6b151e] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                {busy ? 'Posting…' : (ka ? 'არჩეულის მარაგში მიღება' : 'Post selected to inventory')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !draft && (
        <div role="alert" className="flex items-start gap-2 border-t border-rose-100 bg-rose-50 px-5 py-3 text-[10px] text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
