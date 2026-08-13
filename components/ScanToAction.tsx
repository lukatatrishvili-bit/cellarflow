import React from 'react';
import { Camera, Keyboard, ScanLine, X } from 'lucide-react';
import type { Language } from '../lib/language';

export type CellarScanTarget = { kind: 'vessel' | 'lot'; id: string };

export function parseCellarScanValue(rawValue: string, vesselIds: string[], lotIds: string[]): CellarScanTarget | null {
  const raw = rawValue.trim();
  if (!raw) return null;
  let candidate = raw;
  let explicitKind: CellarScanTarget['kind'] | null = null;
  try {
    const decoded = JSON.parse(raw) as { kind?: unknown; type?: unknown; id?: unknown; vesselId?: unknown; tankId?: unknown; lotId?: unknown };
    if (typeof decoded.vesselId === 'string' || typeof decoded.tankId === 'string') {
      candidate = String(decoded.vesselId || decoded.tankId);
      explicitKind = 'vessel';
    } else if (typeof decoded.lotId === 'string') {
      candidate = decoded.lotId;
      explicitKind = 'lot';
    } else if (typeof decoded.id === 'string' && ['vessel', 'tank', 'lot'].includes(String(decoded.kind || decoded.type).toLowerCase())) {
      candidate = decoded.id;
      explicitKind = String(decoded.kind || decoded.type).toLowerCase() === 'lot' ? 'lot' : 'vessel';
    }
  } catch {
    // Most QR values are URLs or compact identifiers.
  }
  try {
    const url = new URL(raw, typeof window === 'undefined' ? 'https://cellarflow.local' : window.location.origin);
    const vessel = url.searchParams.get('tank') || url.searchParams.get('vessel');
    const lot = url.searchParams.get('lot');
    if (vessel) { candidate = vessel; explicitKind = 'vessel'; }
    else if (lot) { candidate = lot; explicitKind = 'lot'; }
  } catch {
    // Continue with prefix and direct-ID matching.
  }
  const prefix = candidate.match(/^(tank|vessel|lot)\s*[:#/]\s*(.+)$/i);
  if (prefix) {
    explicitKind = prefix[1].toLowerCase() === 'lot' ? 'lot' : 'vessel';
    candidate = prefix[2].trim();
  }
  const exact = (ids: string[]) => ids.find(id => id.toLowerCase() === candidate.toLowerCase());
  if (explicitKind === 'vessel') return exact(vesselIds) ? { kind: 'vessel', id: exact(vesselIds)! } : null;
  if (explicitKind === 'lot') return exact(lotIds) ? { kind: 'lot', id: exact(lotIds)! } : null;
  const vesselId = exact(vesselIds);
  if (vesselId) return { kind: 'vessel', id: vesselId };
  const lotId = exact(lotIds);
  return lotId ? { kind: 'lot', id: lotId } : null;
}

interface ScanToActionProps {
  open: boolean;
  lang: Language;
  vesselIds: string[];
  lotIds: string[];
  onResolve: (target: CellarScanTarget) => void;
  onClose: () => void;
}

export default function ScanToAction(props: ScanToActionProps) {
  const { open, lang, vesselIds, lotIds, onResolve, onClose } = props;
  const ka = lang === 'ka';
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const resolvingRef = React.useRef(false);
  const [manualValue, setManualValue] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [cameraReady, setCameraReady] = React.useState(false);

  const stopCamera = React.useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const resolve = React.useCallback((value: string) => {
    const target = parseCellarScanValue(value, vesselIds, lotIds);
    if (!target) {
      setStatus(ka ? 'კოდი ამ სამუშაო სივრცეში არსებულ ჭურჭელს ან პარტიას არ ემთხვევა.' : 'This code does not match a vessel or lot in this workspace.');
      return false;
    }
    resolvingRef.current = true;
    stopCamera();
    onResolve(target);
    onClose();
    return true;
  }, [ka, lotIds, onClose, onResolve, stopCamera, vesselIds]);

  React.useEffect(() => {
    if (!open) { stopCamera(); return undefined; }
    resolvingRef.current = false;
    setStatus('');
    setManualValue('');
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus(ka ? 'კამერა მიუწვდომელია; შეიყვანეთ კოდი ხელით.' : 'Camera access is unavailable; enter the code manually.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCameraReady(true);
        }
        const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
        if (!Detector) {
          setStatus(ka ? 'ამ ბრაუზერს QR-ის ავტომატური ამოცნობა არ აქვს; გამოიყენეთ ხელით შეყვანა.' : 'This browser cannot decode QR codes automatically; use manual entry.');
          return;
        }
        const detector = new Detector({ formats: ['qr_code', 'data_matrix', 'code_128'] });
        const scan = async () => {
          if (cancelled || resolvingRef.current || !videoRef.current) return;
          try {
            const results = await detector.detect(videoRef.current);
            const value = results.find(result => result.rawValue)?.rawValue;
            if (value && resolve(value)) return;
          } catch {
            // Frames can fail while the camera is warming up; the next frame retries.
          }
          frameRef.current = requestAnimationFrame(() => void scan());
        };
        frameRef.current = requestAnimationFrame(() => void scan());
      } catch (error) {
        setStatus(error instanceof Error ? error.message : (ka ? 'კამერა ვერ გაიხსნა.' : 'Camera could not be opened.'));
      }
    };
    void start();
    return () => { cancelled = true; stopCamera(); };
  }, [ka, open, resolve, stopCamera]);

  if (!open) return null;
  return <div role="dialog" aria-modal="true" aria-label={ka ? 'კოდის სკანერი' : 'Cellar code scanner'} className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-stone-950 text-white shadow-2xl"><header className="flex items-center justify-between border-b border-white/10 p-4"><div className="flex items-center gap-2 text-sm font-black"><ScanLine className="h-5 w-5 text-amber-300" />{ka ? 'სკანირება და მოქმედება' : 'Scan to action'}</div><button type="button" onClick={onClose} className="rounded-xl p-2 text-stone-300 hover:bg-white/10"><X className="h-5 w-5" /></button></header><div className="p-5"><div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black"><video ref={videoRef} muted playsInline className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-[15%] rounded-2xl border-2 border-amber-300/90 shadow-[0_0_0_999px_rgba(0,0,0,.22)]" />{!cameraReady && <div className="absolute inset-0 flex items-center justify-center"><Camera className="h-9 w-9 animate-pulse text-stone-500" /></div>}</div><p className="mt-3 text-center text-xs text-stone-400">{ka ? 'მოათავსეთ ჭურჭლის ან პარტიის QR კოდი ჩარჩოში.' : 'Point the camera at a vessel or lot QR code.'}</p>{status && <div className="mt-3 rounded-xl border border-amber-700/50 bg-amber-950/50 p-3 text-xs text-amber-100">{status}</div>}<form onSubmit={event => { event.preventDefault(); resolve(manualValue); }} className="mt-5"><label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-stone-400"><Keyboard className="h-4 w-4" />{ka ? 'ხელით შეყვანა' : 'Manual fallback'}</label><div className="mt-2 flex gap-2"><input value={manualValue} onChange={event => setManualValue(event.target.value)} placeholder="?tank=T-01 or lot:LOT-2026-01" className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-amber-300" /><button type="submit" className="rounded-xl bg-amber-300 px-4 text-xs font-black text-stone-950">{ka ? 'გახსნა' : 'Open'}</button></div></form></div></div></div>;
}
