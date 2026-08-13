import React, { useMemo, useRef, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  CompanyProfile,
  DailyFermLog,
  GrapeIntakeRecord,
  HarvestRecord,
  LabAnalysis,
  MaraniOSAuditLog,
  SalesDispatchRecord,
  SalesOrderRecord,
  Vessel,
  VineyardBlock,
  WineLot,
  DocumentAttachment,
} from '../lib/wineryState';
import type { StorageLocation, StockMovement } from '../lib/storage';
import { buildPassportHtml } from '../lib/lotPassport';
import { AUDIT_TRAIL_MAX_LIMIT, type AuditTrailPage } from '../lib/auditTrailPage';
import { GitMerge, X, Printer, FileText } from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';

interface Props {
  lot: WineLot;
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  company: CompanyProfile;
  generatedBy: string;
  blocks?: VineyardBlock[];
  harvests?: HarvestRecord[];
  grapeIntakes?: GrapeIntakeRecord[];
  vessels?: Vessel[];
  cellarOps?: CellarOperation[];
  transfers?: CellarTransferRecord[];
  bottlingRuns?: BottlingRunRecord[];
  storageLocations?: StorageLocation[];
  stockMovements?: StockMovement[];
  salesOrders?: SalesOrderRecord[];
  salesDispatches?: SalesDispatchRecord[];
  certificationRecords?: CertificationRecord[];
  attachments?: DocumentAttachment[];
  auditLogs?: MaraniOSAuditLog[];
  onOpenLineage?: (lotId: string) => void;
  onClose: () => void;
}

export default function LotPassport({
  lot,
  fermLogs,
  labLogs,
  company,
  generatedBy,
  blocks = [],
  harvests = [],
  grapeIntakes = [],
  vessels = [],
  cellarOps = [],
  transfers = [],
  bottlingRuns = [],
  storageLocations = [],
  stockMovements = [],
  salesOrders = [],
  salesDispatches = [],
  certificationRecords = [],
  attachments = [],
  auditLogs = [],
  onOpenLineage,
  onClose,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  /**
   * This lot's audit entries, fetched from the server.
   *
   * The passport cannot filter the locally held `auditLogs` for these: the
   * client keeps only a recent window of the chain, while a lot's entries reach
   * back to its harvest — a 2019 lot would silently lose every row. `null`
   * means the fetch has not succeeded, and the document says so.
   */
  const [lotAuditLogs, setLotAuditLogs] = useState<MaraniOSAuditLog[] | null>(null);
  useFocusTrap(dialogRef, { active: true, onClose });

  const deepLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?lot=${encodeURIComponent(lot.id)}`
      : `/?lot=${encodeURIComponent(lot.id)}`;

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(deepLink, { margin: 1, width: 168, color: { dark: '#4e0e15', light: '#ffffffff' } })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        /* QR is decorative; ignore failures */
      });
    return () => {
      active = false;
    };
  }, [deepLink]);

  /**
   * `relatedAuditLogs` matches a lot by id *or* name across several free-text
   * fields, so both terms are queried and the results unioned — the server
   * search covers the same fields, and the passport still applies its own
   * matching to what comes back.
   */
  useEffect(() => {
    let active = true;
    const terms = [lot.id, lot.name].filter((term): term is string => !!term);

    Promise.all(terms.map(async term => {
      const params = new URLSearchParams({ search: term, limit: String(AUDIT_TRAIL_MAX_LIMIT) });
      const res = await fetch(`/api/audit-trail?${params.toString()}`);
      if (!res.ok) throw new Error(`Audit history unavailable: ${res.status}`);
      const page: AuditTrailPage = await res.json();
      return page.entries.map(entry => entry.log);
    }))
      .then(pages => {
        if (!active) return;
        const byId = new Map<string, MaraniOSAuditLog>();
        for (const log of pages.flat()) byId.set(log.id, log);
        setLotAuditLogs([...byId.values()]);
      })
      .catch(() => { /* offline: fall back to the local window, flagged below */ });

    return () => { active = false; };
  }, [lot.id, lot.name]);

  const html = useMemo(
    () => buildPassportHtml({
      lot,
      fermLogs,
      labLogs,
      company,
      generatedBy,
      qrDataUrl,
      blocks,
      harvests,
      grapeIntakes,
      vessels,
      cellarOps,
      transfers,
      bottlingRuns,
      storageLocations,
      stockMovements,
      salesOrders,
      salesDispatches,
      certificationRecords,
      attachments,
      auditLogs: lotAuditLogs ?? auditLogs,
      auditHistoryComplete: lotAuditLogs !== null,
    }),
    [
      lot,
      fermLogs,
      labLogs,
      company,
      generatedBy,
      qrDataUrl,
      blocks,
      harvests,
      grapeIntakes,
      vessels,
      cellarOps,
      transfers,
      bottlingRuns,
      storageLocations,
      stockMovements,
      salesOrders,
      salesDispatches,
      certificationRecords,
      attachments,
      auditLogs,
      lotAuditLogs,
    ]
  );

  const handlePrint = () => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lot-passport-title"
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 bg-[#4e0e15] text-amber-50 flex items-center justify-between shrink-0">
          <span id="lot-passport-title" className="text-sm font-serif font-black uppercase tracking-widest flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="truncate">Lot Passport — {lot.id}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenLineage && (
              <button
                onClick={() => onOpenLineage(lot.id)}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/15 text-amber-50 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
              >
                <GitMerge className="w-3.5 h-3.5" /> Open lineage
              </button>
            )}
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 bg-amber-400/90 hover:bg-amber-300 text-[#4e0e15] text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
            >
              <Printer className="w-3.5 h-3.5" /> Print / Save PDF
            </button>
            <button onClick={onClose} aria-label="Close" className="p-1.5 hover:bg-white/10 rounded-lg cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-stone-200/60 overflow-hidden">
          <iframe
            ref={iframeRef}
            srcDoc={html}
            title={`Lot Passport ${lot.id}`}
            className="w-full h-full border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
}
