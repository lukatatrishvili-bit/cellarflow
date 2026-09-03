import React from 'react';
import { Wine } from 'lucide-react';
import { motion } from 'motion/react';
import { useStatusToastMessage } from '../hooks/useStatusToast';

/**
 * The only subscriber to the current toast message.
 *
 * Rendering the toast inline in `App` meant every raise and every five-second
 * auto-dismiss re-rendered the whole shell and the open module. Isolating it
 * here confines that to this component.
 */

const SYNC_ISSUE_MARKERS = [
  'Sync conflict',
  'Sync rejected',
  'rejected',
  'კონფლიქტი',
  'უარყოფილია',
];

/** Sync problems get an escalation affordance; ordinary confirmations do not. */
export function isSyncIssueToast(message: string | null): boolean {
  if (typeof message !== 'string') return false;
  return SYNC_ISSUE_MARKERS.some(marker => message.includes(marker));
}

interface StatusToastHostProps {
  lang: string;
  onTroubleshoot: () => void;
}

function StatusToastHost({ lang, onTroubleshoot }: StatusToastHostProps) {
  const toastMessage = useStatusToastMessage();
  if (!toastMessage) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -16, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      role="status"
      aria-live="polite"
      className="fixed top-20 right-6 z-50 bg-[#4e0e15] border border-[#801323] text-amber-100 rounded-xl px-4 py-2.5 shadow-lg font-bold text-xs flex items-center gap-3 elev-float"
    >
      <div className="flex items-center gap-2">
        <Wine className="h-4 w-4" aria-hidden="true" />
        <span>{toastMessage}</span>
      </div>
      {isSyncIssueToast(toastMessage) && (
        <button
          onClick={onTroubleshoot}
          className="ml-2 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-[#4e0e15] rounded-lg text-[10px] font-black tracking-wide uppercase transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
        >
          ⚡ {lang === 'ka' ? 'მოგვარება' : 'Trace & Fix'}
        </button>
      )}
    </motion.div>
  );
}

export default React.memo(StatusToastHost);
