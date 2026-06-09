import React, { useMemo, useRef, useEffect } from 'react';
import { WineLot, DailyFermLog, LabAnalysis, CompanyProfile } from '../lib/wineryState';
import { buildPassportHtml } from '../lib/lotPassport';
import { X, Printer, FileText } from 'lucide-react';

interface Props {
  lot: WineLot;
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  company: CompanyProfile;
  generatedBy: string;
  onClose: () => void;
}

export default function LotPassport({ lot, fermLogs, labLogs, company, generatedBy, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const html = useMemo(
    () => buildPassportHtml({ lot, fermLogs, labLogs, company, generatedBy }),
    [lot, fermLogs, labLogs, company, generatedBy]
  );

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 bg-[#4e0e15] text-amber-50 flex items-center justify-between shrink-0">
          <span className="text-sm font-serif font-black uppercase tracking-widest flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="truncate">Lot Passport — {lot.id}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
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
