'use client';

import React, { useState, useEffect } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { WineLot, WinemakingStage, WineSugarCategory, Vessel, LabAnalysis, BottlingRunRecord, SalesOrderRecord, SalesDispatchRecord, DailyFermLog, MaraniOSAuditLog } from '../lib/wineryState';
import type { CostEntry } from '../lib/costing';
import type { StockMovement } from '../lib/storage';
import { stageLabel, vesselTypeLabel, wineClassLabel } from '../lib/enumLabels';
import {
  nextStageForWineClass,
  stagesForCurrentLot,
  winemakingWorkflowLabel,
} from '../lib/winemakingWorkflow';
import {
  lotNextActionStatusLabel,
  nextActionForWineLot,
  type LotNextAction,
  type LotNextActionStatus,
} from '../lib/lotNextAction';
import WineLotCommandCenter from './WineLotCommandCenter';
import { AlertTriangle, ChevronRight, Compass, Plus, ListFilter, FileText, MapPin, Activity, X } from 'lucide-react';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyLotStageTransitionCommand,
  type LotStageTransitionCommandPayload,
} from '../lib/commands/lotStageTransition';
import {
  CommandRequestError,
  createLotStageTransitionCommandIntent,
  pendingLotStageTransitionCommandIntent,
  submitLotStageTransitionCommand,
  type LotStageTransitionCommandResponse,
} from '../lib/commands/client';
import { localISODate } from '../lib/weatherApi';

interface Props {
  lang: Language;
  lots: WineLot[];
  onUpdateLots: (newLots: WineLot[]) => void;
  canCreateLot?: boolean;
  canUpdateLot?: boolean;
  onOpenPassport?: (lotId: string) => void;
  vessels?: Vessel[];
  fermLogs?: DailyFermLog[];
  labLogs?: LabAnalysis[];
  costEntries?: CostEntry[];
  bottlingRuns?: BottlingRunRecord[];
  stockMovements?: StockMovement[];
  salesOrders?: SalesOrderRecord[];
  salesDispatches?: SalesDispatchRecord[];
  currency?: string;
  setActiveTab?: (tab: string) => void;
  setSelectedTankId?: (tankId: string | null) => void;
  setCalculatorLotId?: (lotId: string) => void;
  setCalculatorLotIdA?: (lotId: string) => void;
  setChartLotId?: (lotId: string) => void;
  setLabLotId?: (lotId: string) => void;
  currentUserName?: string;
  currentUsername?: string;
  auditLogs?: MaraniOSAuditLog[];
  onUpdateAuditLogs?: (logs: MaraniOSAuditLog[]) => void;
  onApplyLotStageTransitionCommandResponse?: (response: LotStageTransitionCommandResponse) => void;
  setToastMessage?: (message: string) => void;
}

export function commitWineLotMutationIfAllowed(
  allowed: boolean,
  nextLots: WineLot[],
  onUpdateLots: (newLots: WineLot[]) => void,
): boolean {
  if (!allowed) return false;
  onUpdateLots(nextLots);
  return true;
}

export function WineLotsTrace({
  lang,
  lots,
  onUpdateLots,
  canCreateLot = true,
  canUpdateLot = true,
  onOpenPassport,
  vessels = [],
  fermLogs = [],
  labLogs = [],
  costEntries = [],
  bottlingRuns = [],
  stockMovements = [],
  salesOrders = [],
  salesDispatches = [],
  currency = 'GEL',
  setActiveTab,
  setSelectedTankId,
  setCalculatorLotId,
  setCalculatorLotIdA,
  setChartLotId,
  setLabLotId,
  currentUserName = 'Current cellar operator',
  currentUsername = currentUserName,
  auditLogs = [],
  onUpdateAuditLogs,
  onApplyLotStageTransitionCommandResponse,
  setToastMessage,
}: Props) {
  const t = translations[lang];
  const [selectedLotId, setSelectedLotId] = useState<string | null>(lots[0]?.id || null);
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterVintage, setFilterVintage] = useState<string>('all');

  // Lot Edit States
  const [isEditingLot, setIsEditingLot] = useState(false);
  const [editName, setEditName] = useState('');
  const [editVariety, setEditVariety] = useState('');
  const [editVintage, setEditVintage] = useState(new Date().getFullYear());
  const [editBlock, setEditBlock] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [editSugarCategory, setEditSugarCategory] = useState<WineSugarCategory | ''>('');

  const selectedLot = lots.find(l => l.id === selectedLotId);
  const stagesOrdered = selectedLot
    ? stagesForCurrentLot(selectedLot.wineClass, selectedLot.stage)
    : [];
  const transitionStages: WinemakingStage[] = stagesOrdered
    .filter(stage => stage !== 'bottled' && stage !== 'sold');
  const nextActionContext = { vessels, fermLogs, labLogs, bottlingRuns };
  const selectedNextAction = selectedLot
    ? nextActionForWineLot(selectedLot, nextActionContext, lang)
    : null;

  useEffect(() => {
    if (selectedLot) {
      setEditName(selectedLot.name);
      setEditVariety(selectedLot.variety);
      setEditVintage(selectedLot.vintage);
      setEditBlock(selectedLot.vineyardBlock);
      setEditRegion(selectedLot.region);
      setEditSugarCategory(selectedLot.sugarCategory || '');
      setIsEditingLot(false);
    }
  }, [selectedLotId, selectedLot]);

  // Stage transition states
  const [showTransitionForm, setShowTransitionForm] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<WinemakingStage>('crushing');
  const [transitionOperator, setTransitionOperator] = useState(currentUserName);
  const [transitionNotes, setTransitionNotes] = useState('');
  const [pendingTransitionIntent, setPendingTransitionIntent] = useState<PendingCommandIntent<LotStageTransitionCommandPayload> | null>(null);
  const [transitionCommandError, setTransitionCommandError] = useState<string | null>(null);
  const [isSubmittingTransition, setIsSubmittingTransition] = useState(false);

  useEffect(() => {
    setShowTransitionForm(false);
  }, [selectedLotId]);

  useEffect(() => {
    const recovered = pendingLotStageTransitionCommandIntent();
    if (!recovered || !lots.some(lot => lot.id === recovered.payload.lotId)) return;
    setPendingTransitionIntent(recovered);
    setSelectedLotId(recovered.payload.lotId);
    setTransitionTarget(recovered.payload.targetStage);
    setTransitionOperator(recovered.payload.operator);
    setTransitionNotes(recovered.payload.notes);
    setTransitionCommandError(lang === 'ka'
      ? 'სერვერის დაუდასტურებელი ეტაპის ცვლილება აღდგა. ხელახლა სცადეთ იგივე ბრძანება.'
      : 'An unacknowledged stage transition was recovered. Retry the same command.');
    setShowTransitionForm(true);
  // Recover exactly once; the durable intent is immutable until acknowledged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTransitionForm = (targetStage?: WinemakingStage) => {
    if (!canUpdateLot || !selectedLot) return;
    const target = targetStage || nextStageForWineClass(selectedLot.wineClass, selectedLot.stage);
    if (target === 'bottled') {
      setActiveTab?.('bottling');
      return;
    }
    if (target === 'sold') {
      setToastMessage?.(lang === 'ka'
        ? 'გაყიდული სტატუსი დგინდება გაყიდვისა და გაცემის პროცესიდან.'
        : 'Sold status is set by the sales and dispatch workflow.');
      return;
    }
    setTransitionTarget(target);
    setTransitionOperator(currentUserName);
    setTransitionNotes('');
    setTransitionCommandError(null);
    setShowTransitionForm(true);
  };

  useEffect(() => {
    if (!showTransitionForm) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowTransitionForm(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showTransitionForm]);

  const handleRecommendedAction = (action: LotNextAction) => {
    if (!selectedLot) return;
    if (action.intent === 'transition') {
      openTransitionForm(action.targetStage);
      return;
    }
    if (action.destinationTab) {
      if (action.destinationTab === 'fermentation') setChartLotId?.(selectedLot.id);
      if (action.destinationTab === 'labs') setLabLotId?.(selectedLot.id);
      setActiveTab?.(action.destinationTab);
    }
  };

  const closeTransitionDialog = () => {
    if (isSubmittingTransition) return;
    setShowTransitionForm(false);
  };

  const finishStageTransition = () => {
    setPendingTransitionIntent(null);
    setTransitionCommandError(null);
    setIsSubmittingTransition(false);
    setShowTransitionForm(false);
  };

  const applyStageTransitionLocally = (intent: PendingCommandIntent<LotStageTransitionCommandPayload>) => {
    const applied = applyLotStageTransitionCommand(
      { lots, auditLogs },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: currentUsername,
        performedAt: new Date(intent.capturedAt),
      },
    );
    onUpdateLots(applied.state.lots);
    onUpdateAuditLogs?.(applied.state.auditLogs);
    setToastMessage?.(lang === 'ka'
      ? `პარტია გადავიდა ეტაპზე: ${stageLabel(applied.result.updatedLot.stage, lang)}`
      : `Lot moved to: ${stageLabel(applied.result.updatedLot.stage, lang)}`);
    finishStageTransition();
  };

  const confirmStageTransition = async () => {
    if (!canUpdateLot || !selectedLot) return;
    if (!transitionOperator.trim() || transitionNotes.trim().length < 5) {
      setTransitionCommandError(lang === 'ka'
        ? 'მიუთითეთ ოპერატორი და მინიმუმ 5 სიმბოლოს განმარტება.'
        : 'Provide the operator and at least 5 characters of readiness evidence.');
      return;
    }
    const intent = pendingTransitionIntent || createLotStageTransitionCommandIntent({
      lotId: selectedLot.id,
      expectedStage: selectedLot.stage,
      targetStage: transitionTarget,
      date: localISODate(),
      operator: transitionOperator.trim(),
      notes: transitionNotes.trim(),
    });
    setTransitionCommandError(null);

    if (!onApplyLotStageTransitionCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingTransitionIntent) {
        setTransitionCommandError(lang === 'ka'
          ? 'დაუდასტურებელი ცვლილების აღდგენას ინტერნეტთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged transition requires a server connection.');
        return;
      }
      try {
        applyStageTransitionLocally(intent);
      } catch (error) {
        setTransitionCommandError(error instanceof Error ? error.message : 'Stage transition validation failed.');
      }
      return;
    }

    setPendingTransitionIntent(intent);
    setIsSubmittingTransition(true);
    try {
      const response = await submitLotStageTransitionCommand(intent);
      onApplyLotStageTransitionCommandResponse(response);
      setToastMessage?.(lang === 'ka'
        ? `პარტია გადავიდა ეტაპზე: ${stageLabel(response.result.updatedLot.stage, lang)}`
        : `Lot moved to: ${stageLabel(response.result.updatedLot.stage, lang)}`);
      finishStageTransition();
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingTransitionIntent) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyStageTransitionLocally(intent);
          return;
        } catch (fallbackError) {
          setTransitionCommandError(fallbackError instanceof Error
            ? fallbackError.message
            : 'Stage transition validation failed.');
          setPendingTransitionIntent(null);
          return;
        }
      }
      setTransitionCommandError(error instanceof Error ? error.message : 'Stage transition failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingTransitionIntent(null);
    } finally {
      setIsSubmittingTransition(false);
    }
  };



  const filteredLots = lots.filter(l => {
    if (filterClass !== 'all' && l.wineClass !== filterClass) return false;
    if (filterVintage !== 'all' && l.vintage.toString() !== filterVintage) return false;
    return true;
  });

  const uniqueVintages = Array.from(new Set(lots.map(l => l.vintage))).sort((a, b) => b - a);
  const isReadOnly = !canCreateLot && !canUpdateLot;
  const readOnlyNotice = lang === 'ka'
    ? {
        title: 'ღვინის პარტიებზე მხოლოდ ნახვის წვდომა',
        body: 'შეგიძლიათ დაათვალიეროთ პარტიის დეტალები, მიკვლევადობა, წარმოშობის კავშირები, პასპორტები და მარნის დაკავშირებული ჩანაწერები, მაგრამ თქვენი როლი ვერ ქმნის ან ცვლის ღვინის პარტიებს.',
      }
    : {
        title: 'Read-only wine lot access',
        body: 'You can browse lot details, traceability, lineage, passports, and linked cellar records, but your role cannot create or change wine lots.',
      };

  const preferredTransitionTarget = selectedLot
    ? nextStageForWineClass(selectedLot.wineClass, selectedLot.stage)
    : null;
  const isNonSequentialTransition = preferredTransitionTarget != null
    && transitionTarget !== preferredTransitionTarget;

  return (
    <>
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
      {isReadOnly && (
        <div role="status" className="xl:col-span-3 2xl:col-span-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100">
          <strong className="block text-xs font-bold">{readOnlyNotice.title}</strong>
          <span className="mt-0.5 block text-[11px] leading-relaxed">
            {readOnlyNotice.body}
          </span>
        </div>
      )}
      {/* List Panel */}
      <div className="xl:col-span-1 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-serif text-[#4e0e15] flex items-center gap-1">
            <ListFilter className="w-4 h-4" />
            {{
              en: 'Active Lots',
              ka: 'აქტიური პარტიები',
              it: 'Lotti Attivi',
              fr: 'Lots Actifs',
              de: 'Aktive Chargen'
            }[lang] || 'Active Lots'} ({filteredLots.length})
          </h3>
          {canCreateLot && <button
            onClick={() => setActiveTab?.('intake')}
            disabled={!setActiveTab}
            title={lang === 'ka'
              ? 'ახალი პარტია იქმნება ყურძნის მიღებიდან, რათა წონა, გამოსავლიანობა, ჭურჭელი და ხარჯი ერთად აღირიცხოს.'
              : 'New lots start at grape intake so weight, yield, vessel, and cost stay traceable.'}
            className="inline-flex items-center gap-0.5 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            {{
              en: 'New grape intake',
              ka: 'ახალი მიღება',
              it: 'Nuovo ricevimento',
              fr: 'Nouvelle réception',
              de: 'Neue Traubenannahme'
            }[lang] || 'New grape intake'}
          </button>}
        </div>

        {/* Filters */}
        <div className="space-y-2 bg-[#FAF8F5] p-3 border border-[#e8dfd5] rounded-xl">
          <div>
            <span className="block text-[9px] font-mono uppercase text-slate-500 font-bold mb-1">
              {{
                en: 'Wine Style / Class',
                ka: 'ღვინის ტიპი / კლასი',
                it: 'Stile / Classe di Vino',
                fr: 'Style / Classe de Vin',
                de: 'Weinstil / -klasse'
              }[lang] || 'Wine Style / Class'}
            </span>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-5 xl:grid-cols-2 2xl:grid-cols-5">
              {['all', 'red', 'white', 'amber', 'qvevri'].map(cls => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => setFilterClass(cls)}
                  className={`text-[10px] py-1 border rounded capitalize cursor-pointer font-medium font-sans ${
                    filterClass === cls
                      ? 'bg-[#4e0e15] text-white border-[#4e0e15]'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {lang === 'ka'
                    ? ({all: 'ყველა', red: 'წითელი', white: 'თეთრი', amber: 'ქარვისფერი', qvevri: 'ქვევრის'} as Record<string, string>)[cls] || cls
                    : cls === 'all' ? 'All' : wineClassLabel(cls, lang)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-[9px] font-mono uppercase text-slate-500 font-bold mb-1">
              {{
                en: 'Vintage Year',
                ka: 'მოსავლის წელი',
                it: 'Anno di Vendemmia',
                fr: 'Millésime',
                de: 'Jahrgang'
              }[lang] || 'Vintage Year'}
            </span>
            <select
              value={filterVintage}
              onChange={(e) => setFilterVintage(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white text-stone-750 font-medium outline-none"
            >
              <option value="all">
                {{
                  en: '📅 All Vintages',
                  ka: '📅 ყველა მოსავალი',
                  it: '📅 Tutte le Vendemmie',
                  fr: '📅 Tous les Millésimes',
                  de: '📅 Alle Jahrgänge'
                }[lang] || '📅 All Vintages'}
              </option>
              {uniqueVintages.map(v => (
                <option key={v} value={v.toString()}>
                  🍇 {{
                    en: 'Vintage',
                    ka: 'მოსავალი',
                    it: 'Vendemmia',
                    fr: 'Millésime',
                    de: 'Jahrgang'
                  }[lang] || 'Vintage'} {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* List items representation */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {filteredLots.map(l => {
            const isSelected = l.id === selectedLotId;
            const nextAction = nextActionForWineLot(l, nextActionContext, lang);
            const statusClasses: Record<LotNextActionStatus, string> = {
              ready: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/60',
              needs_data: 'bg-amber-50 text-amber-750 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/60',
              blocked: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/60',
              complete: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:border-sky-900/60',
            };
            return (
              <button
                type="button"
                key={l.id}
                onClick={() => setSelectedLotId(l.id)}
                aria-pressed={isSelected}
                className={`w-full p-3 border rounded-xl cursor-pointer transition-all flex items-center justify-between text-left ${
                  isSelected
                    ? 'bg-[#f5efe9] border-[#4e0e15] shadow-sm'
                    : 'bg-white border-[#e8dfd5] hover:border-slate-300 hover:shadow-2xs dark:bg-stone-900 dark:border-stone-800'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800 truncate block">{l.name}</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 bg-slate-100 text-slate-500 border rounded font-bold shrink-0">{l.id}</span>
                    {l.voidedAt && <span className="text-[8px] uppercase font-bold rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Voided</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    <span className="text-[10px] text-slate-400 capitalize">
                      {wineClassLabel(l.wineClass, lang)} {lang === 'ka' ? 'ღვინო' : 'wine'}
                    </span>
                    <span className="text-[10px] font-bold text-stone-600 dark:text-stone-300">{stageLabel(l.stage, lang)}</span>
                    <span className="text-[10px] text-slate-400 font-medium">{l.currentVolume.toLocaleString()} L</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${statusClasses[nextAction.status]}`}>
                      {lotNextActionStatusLabel(nextAction.status, lang)}
                    </span>
                    <span className="truncate text-[9px] font-semibold text-stone-500 dark:text-stone-400">
                      {nextAction.shortLabel}
                    </span>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'translate-x-1 text-[#4e0e15]' : 'text-slate-300'}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Details/Timeline Trace Panel */}
      <div className="xl:col-span-2 2xl:col-span-3 space-y-6">
        {selectedLot ? (
          <div className="p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-xs text-stone-900 dark:text-stone-200 space-y-8">
            <WineLotCommandCenter
              lang={lang}
              lot={selectedLot}
              vessels={vessels}
              labLogs={labLogs}
              costEntries={costEntries}
              bottlingRuns={bottlingRuns}
              stockMovements={stockMovements}
              salesOrders={salesOrders}
              salesDispatches={salesDispatches}
              currency={currency}
              nextAction={selectedNextAction!}
              onEdit={canUpdateLot && !selectedLot.voidedAt ? () => setIsEditingLot(!isEditingLot) : undefined}
              onNextAction={selectedNextAction?.intent === 'transition'
                ? (canUpdateLot && !selectedLot.voidedAt ? () => handleRecommendedAction(selectedNextAction) : undefined)
                : (selectedNextAction ? () => handleRecommendedAction(selectedNextAction) : undefined)}
              onChangeStage={canUpdateLot && !selectedLot.voidedAt ? () => openTransitionForm() : undefined}
              onOpenPassport={onOpenPassport}
              setActiveTab={setActiveTab}
              setSelectedTankId={setSelectedTankId}
              setCalculatorLotId={setCalculatorLotId}
            />
            {/* Header info */}
            <div className="hidden">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-bold text-[#4e0e15]">{selectedLot.name}</h2>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 font-bold bg-[#f5efe9] border border-[#e3d7cb] text-[#4e0e15] rounded">
                    {selectedLot.id}
                  </span>
                  {canUpdateLot && <button
                    type="button"
                    onClick={() => setIsEditingLot(!isEditingLot)}
                    className="text-stone-500 hover:text-[#4e0e15] text-[10px] font-mono font-bold transition-colors cursor-pointer select-none border border-stone-250 px-1.5 rounded"
                    title={lang === 'ka' ? 'პარტიის თვისებების რედაქტირება' : 'Edit Lot Properties'}
                  >
                    ✏️ {lang === 'ka' ? 'შეცვლა' : 'Edit'}
                  </button>}
                </div>
                <p className="text-xs text-slate-400 mt-1 font-medium font-sans">
                  Vintage {selectedLot.vintage} • Traditional Single-Lot Mapping trace
                </p>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-mono text-slate-400 block uppercase">Current Processing Stage</span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#4e0e15] bg-[#FAF8F5] border border-[#e8dfd5] px-2.5 py-1 rounded inline-block mt-1">
                  {selectedLot.stage.replace('_', ' ')}
                </span>
                {onOpenPassport && (
                  <button
                    onClick={() => onOpenPassport(selectedLot.id)}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded-lg transition-colors cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" /> Passport (PDF)
                  </button>
                )}
              </div>
            </div>

            {canUpdateLot && !selectedLot.voidedAt && isEditingLot ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!canUpdateLot) return;
                const updatedLots = lots.map(l => {
                  if (l.id === selectedLot.id) {
                    return {
                      ...l,
                      name: editName,
                      variety: editVariety,
                      vintage: Number(editVintage) || new Date().getFullYear(),
                      vineyardBlock: editBlock,
                      region: editRegion,
                      sugarCategory: editSugarCategory || undefined,
                    };
                  }
                  return l;
                });
                if (!commitWineLotMutationIfAllowed(canUpdateLot, updatedLots, onUpdateLots)) return;
                setIsEditingLot(false);
              }} className="space-y-4 bg-[#FAF8F5] p-5 border border-[#e8dfd5] rounded-xl text-xs text-stone-700">
                <h3 className="text-xs uppercase font-mono tracking-widest text-[#4e0e15] font-black border-b pb-1.5 mb-3 flex justify-between items-center">
                  <span>✏️ {lang === 'ka' ? 'პარტიის რედაქტირება' : 'Edit Wine Lot Properties'}</span>
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                      {lang === 'ka' ? 'სახელი' : 'Lot Name'}
                    </label>
                    <input
                      type="text" required
                      value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                    />
                  </div>
                  <div>
                    <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                      {lang === 'ka' ? 'კატეგორია შაქრიანობის მიხედვით' : 'Category by sugar'}
                    </label>
                    <select value={editSugarCategory} onChange={(e) => setEditSugarCategory(e.target.value as WineSugarCategory | '')} className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]">
                      <option value="">—</option>
                      <option value="dry">{lang === 'ka' ? 'მშრალი' : 'Dry'}</option>
                      <option value="semi_dry">{lang === 'ka' ? 'ნახევრად მშრალი' : 'Semi-dry'}</option>
                      <option value="semi_sweet">{lang === 'ka' ? 'ნახევრად ტკბილი' : 'Semi-sweet'}</option>
                      <option value="sweet">{lang === 'ka' ? 'ტკბილი' : 'Sweet'}</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'ჯიში' : 'Grape Variety'}
                      </label>
                      <input
                        type="text" required
                        value={editVariety} onChange={(e) => setEditVariety(e.target.value)}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'წელი' : 'Vintage'}
                      </label>
                      <input
                        type="number" required
                        value={editVintage} onChange={(e) => setEditVintage(Number(e.target.value) || new Date().getFullYear())}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'ნაკვეთი' : 'Vineyard Block'}
                      </label>
                      <input
                        type="text" required
                        value={editBlock} onChange={(e) => setEditBlock(e.target.value)}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                      {lang === 'ka' ? 'რეგიონი / PDO' : 'Origin Region / PDO'}
                    </label>
                    <input
                      type="text" required
                      value={editRegion} onChange={(e) => setEditRegion(e.target.value)}
                      className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingLot(false)}
                    className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-700 font-mono font-bold uppercase py-2 rounded text-[10px] cursor-pointer transition-colors"
                  >
                    {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase py-2 rounded text-[10px] cursor-pointer transition-colors"
                  >
                    {lang === 'ka' ? 'შენახვა' : 'Save Changes'}
                  </button>
                </div>
              </form>
            ) : (
              <>

            {/* General Chemistry specs summary */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 p-3 bg-gradient-to-br from-[#FAF8F5] to-[#f5efe9]/30 border border-[#f0e6da] rounded-lg">
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase">Grape Variety</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.variety}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase">Vineyard Block Source</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.vineyardBlock}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase text-amber-800/80">Est Origin PDO</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.region}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase text-red-800/80">Active Balance</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.currentVolume} {lang === 'ka' ? 'ლიტრი' : 'Liters'}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase">{lang === 'ka' ? 'შაქრიანობის კატეგორია' : 'Sugar category'}</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.sugarCategory || '—'}</strong>
              </div>
            </div>

            {/* Live Location and Chemistry Metrics card */}
            {(() => {
              const containingVessels = vessels.filter(v => v.assignedLotId === selectedLot.id);
              const lotLabs = labLogs.filter(log => log.lotId === selectedLot.id);
              const latestLab = lotLabs[0];

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-stone-200 bg-[#FCFAF8] p-4 rounded-xl shadow-2xs dark:bg-stone-900/50 dark:border-stone-800">
                  {/* Left Column: Containing Vessel info */}
                  <div className="space-y-3">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-bold text-stone-550 flex items-center gap-1.5 dark:text-stone-400">
                      <MapPin className="w-4 h-4 text-[#801323]" /> Live Location Containment
                    </h4>

                    {containingVessels.length > 0 ? (
                      <div className="space-y-2">
                        {containingVessels.map(v => (
                          <div key={v.id} className="p-3 bg-white border border-stone-200 rounded-lg flex items-center justify-between shadow-3xs dark:bg-stone-950 dark:border-stone-850">
                            <div>
                              <strong className="text-xs font-sans text-stone-900 block dark:text-amber-100">{v.id} ({vesselTypeLabel(v.type, lang)})</strong>
                              <span className="text-[10px] text-slate-400 block font-mono">{lang === 'ka' ? 'ტემპ.' : 'Temp'}: {v.temperature}°C • {lang === 'ka' ? 'მოც.' : 'Vol'}: {v.currentVolume} L</span>
                            </div>
                            {setSelectedTankId && (
                              <button
                                onClick={() => setSelectedTankId(v.id)}
                                className="px-2 py-1 text-[9px] font-bold text-white bg-[#4e0e15] hover:bg-[#801323] rounded transition-colors cursor-pointer"
                              >
                                {lang === 'ka' ? 'დეტალების ნახვა' : 'View Drawer'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-450 italic font-mono py-2">
                        Liquid is currently unallocated to specific cellar vessels (bulk dry storage).
                      </p>
                    )}
                  </div>

                  {/* Right Column: Latest Chemistry */}
                  <div className="space-y-3 border-t md:border-t-0 md:border-l border-stone-200/80 pt-3 md:pt-0 md:pl-4 dark:border-stone-800">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-bold text-stone-550 flex items-center gap-1.5 dark:text-stone-400">
                      <Activity className="w-4 h-4 text-[#801323]" /> Latest Laboratory Chemistry
                    </h4>

                    {latestLab ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-semibold text-slate-700 dark:text-stone-300 font-mono">
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">ABV:</span>
                            <span>{latestLab.alcoholPct}%</span>
                          </div>
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">pH:</span>
                            <span>{latestLab.ph || '--'}</span>
                          </div>
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">Free SO₂:</span>
                            <span className={latestLab.freeSo2 < 15 ? 'text-red-700 font-bold' : ''}>{latestLab.freeSo2} mg/L</span>
                          </div>
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">VA Level:</span>
                            <span className={latestLab.volatileAcid > 0.8 ? 'text-red-700 font-bold' : ''}>{latestLab.volatileAcid} g/L</span>
                          </div>
                        </div>

                        {/* Integration buttons */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {setActiveTab && (
                            <button
                              onClick={() => {
                                setActiveTab('labs');
                              }}
                              className="px-2 py-1 bg-white border border-stone-200 text-stone-700 hover:border-[#4e0e15] hover:text-[#4e0e15] text-[9.5px] font-bold rounded transition-colors cursor-pointer dark:bg-stone-950 dark:border-stone-850 dark:text-stone-300 dark:hover:border-amber-400"
                            >
                              🧬 Log Lab panel
                            </button>
                          )}
                          {setActiveTab && setCalculatorLotId && (
                            <button
                              onClick={() => {
                                setCalculatorLotId(selectedLot.id);
                                setActiveTab('calculators');
                              }}
                              className="px-2 py-1 bg-white border border-stone-200 text-stone-700 hover:border-[#4e0e15] hover:text-[#4e0e15] text-[9.5px] font-bold rounded transition-colors cursor-pointer dark:bg-stone-950 dark:border-stone-850 dark:text-stone-300 dark:hover:border-amber-400"
                            >
                              🧪 SO₂ Calculator
                            </button>
                          )}
                          {setActiveTab && setCalculatorLotIdA && (
                            <button
                              onClick={() => {
                                setCalculatorLotIdA(selectedLot.id);
                                setActiveTab('calculators');
                              }}
                              className="px-2 py-1 bg-white border border-stone-200 text-stone-700 hover:border-[#4e0e15] hover:text-[#4e0e15] text-[9.5px] font-bold rounded transition-colors cursor-pointer dark:bg-stone-950 dark:border-stone-850 dark:text-stone-300 dark:hover:border-amber-400"
                            >
                              ⚖ Blending Simulation
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-center py-2">
                        <p className="text-xs text-slate-455 italic font-mono">
                          {lang === 'ka' ? 'ამ პარტიაზე ლაბორატორიული ანალიზები არ არის ჩაწერილი.' : 'No lab measurements logged for this lot code.'}
                        </p>
                        {setActiveTab && (
                          <button
                            onClick={() => setActiveTab('labs')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-white bg-[#4e0e15] hover:bg-[#801323] rounded transition-colors cursor-pointer"
                          >
                            ➕ {lang === 'ka' ? 'ქიმიური პანელის დაწყება' : 'Initialize Chemistry Panel'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Stage Progress Stepper */}
            {(() => {
              return (
                <div className="space-y-4 border border-stone-200/80 bg-stone-50/50 p-4 rounded-xl dark:bg-stone-900/50 dark:border-stone-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xs uppercase font-mono tracking-wider font-bold text-stone-550 flex items-center gap-1.5 dark:text-stone-400">
                        🍇 {winemakingWorkflowLabel(selectedLot.wineClass, lang)}
                      </h4>
                    </div>
                    {canUpdateLot && <button
                      onClick={() => openTransitionForm()}
                      className="px-2 py-1 text-[10px] font-bold text-white bg-[#801323] hover:bg-[#4e0e15] rounded transition-all cursor-pointer shadow-2xs"
                    >
                      {lang === 'ka' ? 'ეტაპის შეცვლა' : 'Advance / Modify Stage'}
                    </button>}
                  </div>

                  {/* Stage Progress Stepper (Flex row) */}
                  <div className="overflow-x-auto pb-2 -mx-2 px-2 no-scrollbar">
                    <div className="flex items-center justify-between min-w-[700px] relative py-2">
                      {/* Connection Line */}
                      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-stone-200 z-0 -translate-y-1/2 dark:bg-stone-800" />

                      {stagesOrdered.map((st, idx) => {
                        const currentStageIndex = stagesOrdered.indexOf(selectedLot.stage);
                        const isCompleted = idx < currentStageIndex;
                        const isActive = idx === currentStageIndex;
                        const label = stageLabel(st, lang);

                        return (
                          <div key={st} className="flex flex-col items-center z-10 relative">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-emerald-600 text-white ring-4 ring-emerald-50 border border-white dark:ring-emerald-950/20'
                                  : isActive
                                  ? 'bg-[#4e0e15] text-white ring-4 ring-rose-100 border border-white scale-110 animate-pulse dark:ring-rose-950/30'
                                  : 'bg-stone-200 text-stone-400 border border-white dark:bg-stone-800 dark:text-stone-600'
                              }`}
                              title={st}
                            >
                              {isCompleted ? '✓' : idx + 1}
                            </div>
                            <span className={`text-[9.5px] font-medium mt-1.5 tracking-tight ${
                              isActive ? 'text-[#4e0e15] font-black dark:text-amber-100' : isCompleted ? 'text-emerald-700' : 'text-stone-400 dark:text-stone-500'
                            }`}>
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              );
            })()}

            {/* Traceability chronological timeline sequence (THE SYSTEM MUST DISPLAY HISTORIC TIMELINE AS MAPPED) */}
            <div className="space-y-4">
              <h4 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                <Compass className="w-4 h-4 text-[#4e0e15]" />
                {t.traceability_timeline}{lang === 'ka' ? '' : ' Chronology'}
              </h4>

              <div className="relative pl-6 border-l border-[#f5efe9] space-y-5">
                {/* Guard: lots hydrated from imports/API can arrive without history —
                    a missing array must not crash the whole app (root ErrorBoundary). */}
                {(selectedLot.history || []).map((hist, index) => (
                  <div key={index} className="relative">
                    {/* Circle Node indicator */}
                    <div className="absolute -left-[30px] top-1 w-3 h-3 bg-[#4e0e15] ring-4 ring-[#FAF8F5] rounded-full flex items-center justify-center border border-white" />

                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg hover:border-slate-200 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1">{hist.type}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-400 font-mono font-medium">{hist.date}</span>
                          <span className="text-[9px] px-1.5 py-0.2 bg-white border rounded font-mono text-slate-500 font-bold">Operator: {hist.operator}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed font-sans">{hist.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    ) : (
          <div className="p-12 text-center border-2 border-dashed border-[#e8dfd5] rounded-xl text-slate-400 italic font-serif">
            Configure or select an active wine lot to audit traceability history pathways.
          </div>
        )}
      </div>
    </div>

    {canUpdateLot && showTransitionForm && selectedLot && (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-[2px]"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeTransitionDialog();
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="lot-stage-transition-title"
          className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl dark:border-stone-800 dark:bg-stone-950"
        >
          <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#f5efe9] px-2 py-1 text-[9px] font-mono font-black text-[#4e0e15]">
                  {selectedLot.id}
                </span>
                <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-stone-400">
                  {stageLabel(selectedLot.stage, lang)} → {stageLabel(transitionTarget, lang)}
                </span>
              </div>
              <h3 id="lot-stage-transition-title" className="mt-2 text-xl font-serif font-black text-stone-950 dark:text-amber-100">
                {lang === 'ka' ? 'ეტაპის გადასვლის ჩაწერა' : 'Log stage transition'}
              </h3>
              <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                {selectedLot.name} · {selectedLot.currentVolume.toLocaleString()} L
              </p>
            </div>
            <button
              type="button"
              onClick={closeTransitionDialog}
              aria-label={lang === 'ka' ? 'ფანჯრის დახურვა' : 'Close transition dialog'}
              className="rounded-xl border border-stone-200 p-2 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:border-stone-800 dark:hover:bg-stone-900"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="space-y-4 overflow-y-auto px-5 py-4 text-xs">
            {isNonSequentialTransition && (
              <div role="alert" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-[10px] leading-relaxed">
                  {lang === 'ka'
                    ? `რეკომენდებული შემდეგი ეტაპია ${stageLabel(preferredTransitionTarget!, lang)}. სხვა ეტაპის არჩევისას შენიშვნებში მიუთითეთ მიზეზი.`
                    : `The recommended next stage is ${stageLabel(preferredTransitionTarget!, lang)}. Explain why you are skipping or moving backward in the notes.`}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="lot-transition-target" className="mb-1 block text-[9.5px] font-mono font-bold uppercase text-slate-400">
                  {lang === 'ka' ? 'სამიზნე ეტაპი' : 'Target stage'}
                </label>
                <select
                  id="lot-transition-target"
                  value={transitionTarget}
                  onChange={(e) => setTransitionTarget(e.target.value as WinemakingStage)}
                  className="w-full rounded-lg border border-stone-200 bg-[#FAF8F5] px-2.5 py-2 text-stone-800 outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
                >
                  {transitionStages.map(stage => (
                    <option key={stage} value={stage}>
                      {stageLabel(stage, lang)}{stage === preferredTransitionTarget ? (lang === 'ka' ? ' · რეკომენდებული' : ' · Recommended') : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="lot-transition-operator" className="mb-1 block text-[9.5px] font-mono font-bold uppercase text-slate-400">
                  {lang === 'ka' ? 'ოპერატორი / მემარნე' : 'Operator / Cellarer'}
                </label>
                <input
                  id="lot-transition-operator"
                  type="text"
                  value={transitionOperator}
                  onChange={(e) => setTransitionOperator(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 bg-[#FAF8F5] px-2.5 py-2 text-stone-800 outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
                  placeholder={lang === 'ka' ? 'მაგ. პასუხისმგებელი პირი' : 'e.g. Responsible person'}
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="lot-transition-notes" className="mb-1 block text-[9.5px] font-mono font-bold uppercase text-slate-400">
                {lang === 'ka' ? 'რა შესრულდა და რატომ არის პარტია მზად?' : 'What was completed, and why is the lot ready?'}
              </label>
              <textarea
                id="lot-transition-notes"
                value={transitionNotes}
                onChange={(e) => setTransitionNotes(e.target.value)}
                className="h-24 w-full rounded-lg border border-stone-200 bg-[#FAF8F5] p-2.5 text-stone-800 outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
                placeholder={lang === 'ka'
                  ? 'ჩაწერეთ ლაბორატორიული შედეგი, ოპერაცია, გადატანა ან სხვა მზადყოფნის მტკიცებულება...'
                  : 'Record the lab result, cellar operation, transfer, or other readiness evidence...'}
                required
              />
            </div>

            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[10px] font-semibold text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
              {lang === 'ka'
                ? 'ეტაპის შეცვლა მარაგს ან მოცულობას არ ცვლის. დანამატი აღრიცხეთ ოპერაციებში, ხოლო ღვინის მოძრაობა — გადატანებში.'
                : 'A stage change does not alter stock or volume. Record additions in Operations and wine movement in Transfers.'}
            </div>
            {transitionCommandError && (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/25 dark:text-rose-200">
                {transitionCommandError}
              </div>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 bg-stone-50/80 px-5 py-4 dark:border-stone-800 dark:bg-stone-900/50">
            <p className="text-[9px] leading-relaxed text-stone-400">
              {lang === 'ka'
                ? 'დადასტურება განაახლებს პარტიის ეტაპს და დაამატებს ჩანაწერს ქრონოლოგიაში.'
                : 'Confirmation updates the lot stage and adds a traceability timeline entry.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={closeTransitionDialog}
                disabled={isSubmittingTransition}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-[10px] font-bold text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300"
              >
                {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => void confirmStageTransition()}
                disabled={isSubmittingTransition || !transitionOperator.trim() || transitionNotes.trim().length < 5}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-[10px] font-black text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSubmittingTransition
                  ? (lang === 'ka' ? 'ინახება…' : 'Saving…')
                  : pendingTransitionIntent
                    ? (lang === 'ka' ? 'იგივე ბრძანების გამეორება' : 'Retry same command')
                    : (lang === 'ka' ? 'გადასვლის დადასტურება' : 'Confirm transition')}
              </button>
            </div>
          </footer>
        </section>
      </div>
    )}
    </>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(WineLotsTrace);
