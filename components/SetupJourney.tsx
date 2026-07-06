import React from 'react';
import { motion } from 'motion/react';
import { Check, ArrowRight, X, Sparkles } from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { SetupJourneyState, SetupStep } from '../lib/onboarding';

interface Props {
  lang: Language;
  journey: SetupJourneyState;
  onNavigate: (step: SetupStep) => void;
  onDismiss: () => void;
}

/**
 * Guided zero-to-productive checklist for a young winery. Progress is computed
 * from real records (see lib/onboarding.ts), so it advances no matter where the
 * work happens — forms, sync, or a teammate's edits.
 */
export default function SetupJourney({ lang, journey, onNavigate, onDismiss }: Props) {
  const ka = lang === 'ka';
  const { steps, done, total, pct, nextStep } = journey;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      aria-label={ka ? 'მარნის გამართვის გზამკვლევი' : 'Winery setup journey'}
      className="relative overflow-hidden bg-white border border-[#e8dfd5] rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800"
    >
      {/* Ambient corner glow — atmospheric zone, compositor-only */}
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-gradient-to-br from-[#c5a059]/15 via-[#801323]/10 to-transparent blur-2xl" />

      <div className="p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold font-mono dark:bg-amber-950/40 dark:text-amber-200">
              {ka ? 'გამართვის გზამკვლევი' : 'Setup journey'} · {done}/{total}
            </span>
            <h3 className="mt-1.5 text-xl font-serif font-black text-stone-900 dark:text-amber-100 flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-[#c5a059]" />
              {ka ? 'აამუშავეთ თქვენი მარანი' : 'Bring your marani online'}
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400 font-semibold mt-0.5 max-w-md">
              {ka
                ? 'ექვსი ნაბიჯი სრულ მიკვლევადობამდე — ვენახიდან ლაბორატორიამდე.'
                : 'Six steps to full traceability — from vineyard to lab.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            title={ka ? 'დამალვა' : 'Hide for now'}
            aria-label={ka ? 'გზამკვლევის დამალვა' : 'Dismiss setup journey'}
            className="p-1.5 rounded-lg text-stone-300 hover:text-stone-500 hover:bg-stone-100 transition-colors cursor-pointer dark:hover:bg-stone-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1.5 rounded-full bg-stone-100 overflow-hidden dark:bg-stone-800" role="progressbar"
          aria-label={lang === 'ka' ? 'გამართვის პროგრესი' : 'Setup progress'}
          aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#c5a059] to-[#801323]"
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(pct, 3)}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>

        {/* Steps */}
        <ol className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {steps.map((step, i) => {
            const isNext = nextStep?.id === step.id;
            return (
              <motion.li
                key={step.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08 * i, duration: 0.35 }}
              >
                <button
                  type="button"
                  onClick={() => !step.done && onNavigate(step)}
                  disabled={step.done}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors group ${
                    step.done
                      ? 'border-transparent bg-stone-50/60 cursor-default dark:bg-stone-950/40'
                      : isNext
                        ? 'border-[#c5a059]/50 bg-gradient-to-r from-[#c5a059]/10 to-transparent hover:border-[#c5a059] cursor-pointer'
                        : 'border-stone-100 hover:border-stone-300 hover:bg-stone-50 cursor-pointer dark:border-stone-800 dark:hover:bg-stone-800/40'
                  }`}
                >
                  {/* Status circle */}
                  <span
                    aria-hidden
                    className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center border-2 transition-colors ${
                      step.done
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : isNext
                          ? 'border-[#801323] text-[#801323]'
                          : 'border-stone-250 text-stone-300 dark:border-stone-700'
                    }`}
                  >
                    {step.done
                      ? <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      : <span className="text-[10px] font-mono font-bold">{i + 1}</span>}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] font-bold leading-tight ${
                      step.done ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-amber-50'
                    }`}>
                      {ka ? step.ka : step.en}
                    </span>
                    {isNext && (
                      <span className="block text-[11px] text-stone-500 dark:text-stone-400 leading-snug mt-0.5">
                        {ka ? step.kaHint : step.enHint}
                      </span>
                    )}
                  </span>

                  {!step.done && (
                    <ArrowRight className={`shrink-0 w-4 h-4 transition-transform group-hover:translate-x-0.5 ${
                      isNext ? 'text-[#801323]' : 'text-stone-300'
                    }`} />
                  )}
                </button>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </motion.section>
  );
}
