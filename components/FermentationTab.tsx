'use client';

import React, { useEffect, useState } from 'react';
import type { Language } from '../lib/i18n';
import type {
  WineLot,
  Vessel,
  DailyFermLog,
  InventoryItem,
  MaraniOSAuditLog,
  UserProfile,
} from '../lib/wineryState';
import type { CellarOperationInput } from '../lib/commands/cellarOperation';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyFermentationCompletionCommand,
  type FermentationCompletionCommandPayload,
} from '../lib/commands/fermentationCompletion';
import type { FermentationCompletionReversalCommandPayload } from '../lib/commands/fermentationCompletionReversal';
import {
  isCompletableFermentationReading,
  isFermentationCompletionReversal,
  isPhysicalFermentationReading,
} from '../lib/fermentationIntegrity';
import {
  CommandRequestError,
  createFermentationCompletionCommandIntent,
  createFermentationCompletionReversalCommandIntent,
  pendingFermentationCompletionCommandIntent,
  pendingFermentationCompletionReversalCommandIntent,
  submitFermentationCompletionCommand,
  submitFermentationCompletionReversalCommand,
  type FermentationCompletionCommandResponse,
  type FermentationCompletionReversalCommandResponse,
} from '../lib/commands/client';
import {
  Trash2,
  Flame,
  Activity,
  TrendingDown,
  Hourglass,
  FlaskConical,
  MessageSquare,
  Info,
  X
} from 'lucide-react';
import FermentationCurveChart from './FermentationCurveChart';
import OperationMaterialsEditor, {
  materialDraftIssue,
  materialDraftsToUsages,
  type MaterialUsageDraft,
} from './OperationMaterialsEditor';

interface Props {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  fermLogs: DailyFermLog[];
  inventory?: InventoryItem[];
  auditLogs?: MaraniOSAuditLog[];
  currentUser: UserProfile;
  setActiveTab: (tab: string) => void;
  onUpdateLots: (newLots: WineLot[]) => void;
  onUpdateVessels: (newVessels: Vessel[]) => void;
  onUpdateFermLogs: (newLogs: DailyFermLog[]) => void;
  onAddCellarOperation?: (input: CellarOperationInput) => string;
  onUpdateAuditLogs?: (newLogs: MaraniOSAuditLog[]) => void;
  onApplyFermentationCompletionCommandResponse?: (response: FermentationCompletionCommandResponse) => void;
  onApplyFermentationCompletionReversalCommandResponse?: (response: FermentationCompletionReversalCommandResponse) => void;
  setToastMessage?: (message: string) => void;
  canCreateFermentationLog?: boolean;
  canUpdateFermentationLot?: boolean;
  canUpdateFermentationVessel?: boolean;
  canCompleteFermentation?: boolean;
  canConsumeFermentationMaterials?: boolean;
  canReverseFermentationCompletion?: boolean;
  canDeleteFermentationLog?: boolean;
}

export interface FermentationReadingUpdatePermissions {
  canCreateFermentationLog: boolean;
  canUpdateFermentationLot: boolean;
  canUpdateFermentationVessel: boolean;
}

export function dispatchFermentationReadingUpdates(
  permissions: FermentationReadingUpdatePermissions,
  updates: {
    fermentationLog: () => void;
    lotHistory: () => void;
    vesselTelemetry: () => void;
  },
): boolean {
  if (!permissions.canCreateFermentationLog) return false;
  updates.fermentationLog();
  if (permissions.canUpdateFermentationLot) updates.lotHistory();
  if (permissions.canUpdateFermentationVessel) updates.vesselTelemetry();
  return true;
}

export default function FermentationTab({
  lang,
  vessels,
  lots,
  fermLogs,
  inventory = [],
  auditLogs = [],
  currentUser,
  setActiveTab,
  onUpdateLots,
  onUpdateVessels,
  onUpdateFermLogs,
  onAddCellarOperation,
  onUpdateAuditLogs,
  onApplyFermentationCompletionCommandResponse,
  onApplyFermentationCompletionReversalCommandResponse,
  setToastMessage,
  canCreateFermentationLog = true,
  canUpdateFermentationLot = true,
  canUpdateFermentationVessel = true,
  canCompleteFermentation,
  canConsumeFermentationMaterials = false,
  canReverseFermentationCompletion = false,
  canDeleteFermentationLog = true,
}: Props) {
  const canComplete = canCompleteFermentation
    ?? (canUpdateFermentationLot && canUpdateFermentationVessel);
  const permissionNotice = !canCreateFermentationLog && !canComplete && !canDeleteFermentationLog
    ? (lang === 'ka'
      ? 'დუღილის მონაცემები თქვენი როლისთვის მხოლოდ სანახავია. შეგიძლიათ შეამოწმოთ ტელემეტრია, მრუდები და სრული ჟურნალი.'
      : 'Fermentation data is read-only for your workspace role. You can still review telemetry, curves, and the complete journal.')
    : [
      !canCreateFermentationLog
        ? (lang === 'ka' ? 'თქვენს როლს ახალი მაჩვენებლების ჩაწერა არ შეუძლია.' : 'Your role cannot record new readings.')
        : '',
      !canComplete
        ? (lang === 'ka' ? 'დუღილის დასრულებულად მონიშვნა შეზღუდულია.' : 'Marking fermentation campaigns complete is restricted.')
        : '',
      !canDeleteFermentationLog
        ? (lang === 'ka' ? 'ჟურნალის ჩანაწერების წაშლა შეზღუდულია.' : 'Deleting journal entries is restricted.')
        : '',
    ].filter(Boolean).join(' ');

  // Active fermenting lots
  const activeFerments = lots.filter(l => l.stage === 'fermenting');
  const physicalFermLogs = fermLogs.filter(isPhysicalFermentationReading);

  // Chart lot selector state
  const [chartLotId, setChartLotId] = useState<string>(
    activeFerments[0]?.id || (physicalFermLogs.length > 0 ? physicalFermLogs[0].lotId : '')
  );

  // Expanded log input for specific lot card
  const [expLogFormLotId, setExpLogFormLotId] = useState<string | null>(null);

  // Unified logger states (for log forms)
  const [logTankId, setLogTankId] = useState('');
  const [logTemp, setLogTemp] = useState(19.5);
  const [logDensity, setLogDensity] = useState(1.012);
  const [logSugar, setLogSugar] = useState(24);
  const [logPH, setLogPH] = useState(3.45);
  const [logNotes, setLogNotes] = useState('');
  const [logCap, setLogCap] = useState('Punchdowns - 2X');
  const [materialDrafts, setMaterialDrafts] = useState<MaterialUsageDraft[]>([]);

  // General add log form state
  const [showGeneralForm, setShowGeneralForm] = useState(false);
  const [generalLotId, setGeneralLotId] = useState('');
  const [formError, setFormError] = useState('');
  const [pendingCompletion, setPendingCompletion] = useState<PendingCommandIntent<FermentationCompletionCommandPayload> | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const [pendingCompletionReversal, setPendingCompletionReversal] = useState<PendingCommandIntent<FermentationCompletionReversalCommandPayload> | null>(null);
  const [completionReversalError, setCompletionReversalError] = useState<string | null>(null);
  const [completionReversalTargetId, setCompletionReversalTargetId] = useState<string | null>(null);
  const [completionReversalReason, setCompletionReversalReason] = useState('');
  const [isReversingCompletion, setIsReversingCompletion] = useState(false);

  useEffect(() => {
    const restored = pendingFermentationCompletionCommandIntent();
    if (!restored) return;
    setPendingCompletion(restored);
    setCompletionError(lang === 'ka'
      ? 'წინა დუღილის დასრულების შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანება ხელახლა გაგზავნეთ.'
      : 'A previous fermentation completion is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [lang]);

  useEffect(() => {
    const restored = pendingFermentationCompletionReversalCommandIntent();
    if (!restored) return;
    setPendingCompletionReversal(restored);
    setCompletionReversalTargetId(
      fermLogs.find(log => log.commandId === restored.payload.originalCommandId)?.id || null,
    );
    setCompletionReversalReason(restored.payload.reason);
    setCompletionReversalError(lang === 'ka'
      ? 'წინა დასრულების გაუქმების შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანება ხელახლა გაგზავნეთ.'
      : 'A previous completion reversal is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [fermLogs, lang]);

  // Committing log entry
  const handleCommitLog = (lotId: string, tankId: string) => {
    if (!canCreateFermentationLog) return;
    if (!lotId || !tankId) {
      setFormError(lang === 'ka'
        ? 'ჩანაწერის შენახვამდე აქტიური პარტია ჭურჭელს უნდა იყოს მიბმული.'
        : 'An active wine lot must be assigned to a vessel before a fermentation reading can be saved.');
      return;
    }
    const materialsIssue = canConsumeFermentationMaterials
      ? materialDraftIssue(materialDrafts, inventory)
      : null;
    if (materialsIssue) {
      setFormError(lang === 'ka'
        ? 'შეამოწმეთ მასალის არჩევანი, რაოდენობა და ხელმისაწვდომი მარაგი.'
        : 'Check the selected materials, quantities, and available stock.');
      return;
    }
    setFormError('');

    const materialsUsed = canConsumeFermentationMaterials
      ? materialDraftsToUsages(materialDrafts, inventory)
      : [];
    if (materialsUsed.length && !onAddCellarOperation) {
      setFormError(lang === 'ka'
        ? 'მასალების ავტომატური ჩამოწერა ამ სამუშაო სივრცეში ხელმისაწვდომი არ არის.'
        : 'Automatic material deduction is not available in this workspace.');
      return;
    }
    const materialSummary = materialsUsed.length
      ? materialsUsed.map(item => (
        `${item.materialName || item.materialId} ${item.quantity}${item.unit || ''}${item.purpose ? ` (${item.purpose})` : ''}`
      )).join(', ')
      : 'None';
    const readingDate = new Date().toISOString().split('T')[0];
    const linkedOperationId = materialsUsed.length
      ? onAddCellarOperation?.({
        date: readingDate,
        type: physicalFermLogs.some(log => log.lotId === lotId) ? 'additive' : 'ferment_start',
        lotId,
        vesselId: tankId,
        vesselToId: null,
        materials: materialsUsed,
        operator: currentUser.fullName,
        notes: lang === 'ka'
          ? `დუღილის ჟურნალიდან: ${materialSummary}`
          : `From fermentation journal: ${materialSummary}`,
      })
      : undefined;
    const newLog: DailyFermLog = {
      id: `flog-${Date.now()}`,
      recordKind: 'reading',
      tankId: tankId,
      lotId: lotId,
      date: readingDate,
      temperature: logTemp,
      density: logDensity,
      sugar: logSugar,
      ph: logPH,
      tastingNotes: logNotes.trim(),
      capManagement: logCap,
      additives: materialSummary,
      ...(materialsUsed.length ? { materialsUsed } : {}),
      ...(linkedOperationId ? { linkedOperationId } : {}),
    };

    dispatchFermentationReadingUpdates(
      { canCreateFermentationLog, canUpdateFermentationLot, canUpdateFermentationVessel },
      {
        fermentationLog: () => onUpdateFermLogs([newLog, ...fermLogs]),
        lotHistory: () => onUpdateLots(lots.map(l => {
          if (l.id !== lotId) return l;
          return {
            ...l,
            history: [
              {
                date: new Date().toISOString().split('T')[0],
                type: lang === 'ka' ? 'დუღილის ჩანაწერი' : 'Fermentation Log Entry',
                description: lang === 'ka'
                  ? `სიმკვრივე: ${logDensity} SG, შაქარი: ${logSugar} გ/ლ, ტემპ.: ${logTemp}°C. ქუდი: ${logCap}. შენიშვნა: ${logNotes.trim() || 'შენიშვნის გარეშე'}`
                  : `Density: ${logDensity} SG, Sugar: ${logSugar} g/L, Temp: ${logTemp}°C. Cap: ${logCap}. Note: ${logNotes.trim() || 'No notes entered'}`,
                operator: currentUser.fullName
              },
              ...(l.history || [])
            ]
          };
        })),
        vesselTelemetry: () => onUpdateVessels(vessels.map(v => (
          v.id === tankId ? { ...v, temperature: logTemp } : v
        ))),
      },
    );

    // Reset log inputs
    setLogNotes('');
    setMaterialDrafts([]);
    setFormError('');
    setExpLogFormLotId(null);
    setShowGeneralForm(false);
  };

  const handleOpenLotLogForm = (lot: WineLot) => {
    if (!canCreateFermentationLog) return;
    // Find vessel this lot is assigned to
    const associatedVessel = vessels.find(v => v.assignedLotId === lot.id);
    setLogTankId(associatedVessel ? associatedVessel.id : '');
    setFormError(associatedVessel ? '' : (lang === 'ka' ? 'ჩანაწერის შენახვამდე მიაბით პარტია ჭურჭელს.' : 'Assign this lot to a vessel before saving a fermentation reading.'));
    setExpLogFormLotId(lot.id);

    // Default reasonable entries
    const lotLogs = physicalFermLogs.filter(log => log.lotId === lot.id);
    if (lotLogs.length > 0) {
      const lastLog = lotLogs[0];
      setLogTemp(lastLog.temperature);
      setLogDensity(lastLog.density);
      setLogSugar(lastLog.sugar);
      setLogPH(lastLog.ph);
    } else {
      setLogTemp(20.0);
      setLogDensity(1.085);
      setLogSugar(200);
      setLogPH(3.40);
    }
  };

  const finishCompletionCommand = () => {
    setPendingCompletion(null);
    setCompletionError(null);
  };

  const applyCompletionLocally = (
    intent: PendingCommandIntent<FermentationCompletionCommandPayload>,
  ) => {
    if (!onUpdateAuditLogs) {
      setCompletionError(lang === 'ka'
        ? 'აუდიტის ჟურნალი მიუწვდომელია; დუღილი არ შეცვლილა.'
        : 'The audit ledger is unavailable; fermentation was not changed.');
      return;
    }
    const applied = applyFermentationCompletionCommand(
      { lots, vessels, fermlogs: fermLogs, auditLogs },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: currentUser.username,
        performedAt: new Date(intent.capturedAt),
      },
    );
    onUpdateLots(applied.state.lots);
    onUpdateVessels(applied.state.vessels);
    onUpdateFermLogs(applied.state.fermlogs);
    onUpdateAuditLogs(applied.state.auditLogs);
    setToastMessage?.(lang === 'ka'
      ? `დუღილი დასრულდა: ${applied.result.lot.name} → სტაბილიზაცია`
      : `Fermentation completed: ${applied.result.lot.name} → stabilization`);
    finishCompletionCommand();
  };

  const executeCompletionCommand = async (
    intent: PendingCommandIntent<FermentationCompletionCommandPayload>,
  ) => {
    setCompletionError(null);
    if (!onApplyFermentationCompletionCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingCompletion) {
        setCompletionError(lang === 'ka'
          ? 'დაუდასტურებელი დასრულების აღდგენას ინტერნეტთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged fermentation completion requires a server connection.');
        return;
      }
      try {
        applyCompletionLocally(intent);
      } catch (error) {
        setCompletionError(error instanceof Error ? error.message : 'Fermentation completion validation failed.');
      }
      return;
    }

    setPendingCompletion(intent);
    setIsCompleting(true);
    try {
      const response = await submitFermentationCompletionCommand(intent);
      onApplyFermentationCompletionCommandResponse(response);
      setToastMessage?.(lang === 'ka'
        ? `დუღილი დასრულდა: ${response.result.lot.name} → სტაბილიზაცია`
        : `Fermentation completed: ${response.result.lot.name} → stabilization`);
      finishCompletionCommand();
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingCompletion) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyCompletionLocally(intent);
          return;
        } catch (fallbackError) {
          setCompletionError(fallbackError instanceof Error
            ? fallbackError.message
            : 'Fermentation completion validation failed.');
          setPendingCompletion(null);
          return;
        }
      }
      setCompletionError(error instanceof Error ? error.message : 'Fermentation completion failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingCompletion(null);
    } finally {
      setIsCompleting(false);
    }
  };

  const finishCompletionReversal = () => {
    setPendingCompletionReversal(null);
    setCompletionReversalError(null);
    setCompletionReversalTargetId(null);
    setCompletionReversalReason('');
  };

  const executeCompletionReversalCommand = async (
    intent: PendingCommandIntent<FermentationCompletionReversalCommandPayload>,
  ) => {
    setCompletionReversalError(null);
    if (!onApplyFermentationCompletionReversalCommandResponse || !SyncQueueManager.isOnline()) {
      setCompletionReversalError(lang === 'ka'
        ? 'დუღილის დასრულების გაუქმებას სერვერთან კავშირი სჭირდება.'
        : 'Reversing fermentation completion requires a server connection.');
      return;
    }

    setPendingCompletionReversal(intent);
    setIsReversingCompletion(true);
    try {
      const response = await submitFermentationCompletionReversalCommand(intent);
      onApplyFermentationCompletionReversalCommandResponse(response);
      setToastMessage?.(lang === 'ka'
        ? `დუღილი ხელახლა გაიხსნა: ${response.result.lot.name}`
        : `Fermentation reopened: ${response.result.lot.name}`);
      finishCompletionReversal();
    } catch (error) {
      setCompletionReversalError(error instanceof Error ? error.message : 'Fermentation-completion reversal failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingCompletionReversal(null);
    } finally {
      setIsReversingCompletion(false);
    }
  };

  const startCompletionReversal = (log: DailyFermLog) => {
    if (!canReverseFermentationCompletion || !log.commandId || log.reversedByCommandId
      || isFermentationCompletionReversal(log)) return;
    setCompletionReversalTargetId(log.id);
    setCompletionReversalReason('');
    setCompletionReversalError(null);
  };

  const confirmCompletionReversal = () => {
    const log = fermLogs.find(item => item.id === completionReversalTargetId);
    const reason = completionReversalReason.trim();
    if (!log?.commandId || !reason || isReversingCompletion) {
      if (!reason) {
        setCompletionReversalError(lang === 'ka'
          ? 'შეიყვანეთ გაუქმების მიზეზი.'
          : 'Enter a reason for reopening this fermentation.');
      }
      return;
    }
    void executeCompletionReversalCommand(createFermentationCompletionReversalCommandIntent({
      originalCommandId: log.commandId,
      reason,
    }));
  };

  // Promote the latest recorded measurement to final evidence and transition
  // the lot, vessel, and audit trail as one durable business event.
  const finishFermentationStage = (lotId: string) => {
    if (!canComplete || pendingCompletion || isCompleting) return;
    const associatedVessel = vessels.find(vessel => vessel.assignedLotId === lotId);
    const finalLog = fermLogs.find(log => (
      log.lotId === lotId
      && log.tankId === associatedVessel?.id
      && isCompletableFermentationReading(log)
    ));
    if (!associatedVessel || !finalLog) {
      setCompletionError(lang === 'ka'
        ? 'დასრულებამდე შეინახეთ საბოლოო მაჩვენებელი პარტიის მიბმულ ჭურჭელში.'
        : 'Save a final reading in the lot’s assigned vessel before completing fermentation.');
      return;
    }
    const confirmFinish = window.confirm(lang === 'ka'
      ? 'დავასრულოთ პირველადი დუღილი და პარტია გადავიდეს სტაბილიზაციაზე?'
      : 'Mark this primary fermentation as completed and move the lot to stabilization?');
    if (!confirmFinish) return;
    void executeCompletionCommand(createFermentationCompletionCommandIntent({
      lotId,
      vesselId: associatedVessel.id,
      finalLogId: finalLog.id,
      operator: currentUser.fullName,
    }));
  };

  // Delete a logged entry
  const handleDeleteLog = (logId: string) => {
    if (!canDeleteFermentationLog) return;
    const selected = fermLogs.find(log => log.id === logId);
    if (!selected || selected.commandId) return;
    if (window.confirm(lang === 'ka' ? 'წავშალოთ ეს დუღილის ჩანაწერი ისტორიული ჟურნალიდან?' : 'Delete this primary fermentation tracking point from historical ledger?')) {
      onUpdateFermLogs(fermLogs.filter(log => log.id !== logId));
    }
  };

  // Math helper stats
  const isSluggish = (lotId: string): boolean => {
    const lLogs = physicalFermLogs.filter(log => log.lotId === lotId);
    if (lLogs.length < 2) return false;
    const latest = lLogs[0];
    const prev = lLogs[1];
    return latest.sugar > 20 && Math.abs(latest.sugar - prev.sugar) < 2;
  };

  const hotTanksCount = vessels.filter(v => v.currentVolume > 0 && v.temperature && v.temperature > 28).length;
  const slowFermsCount = activeFerments.filter(l => isSluggish(l.id)).length;

  return (
    <div className="space-y-6 text-stone-850">

      {permissionNotice && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{permissionNotice}</p>
        </div>
      )}

      {completionError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950" role="alert">
          <span>{completionError}</span>
          {pendingCompletion && (
            <button
              type="button"
              disabled={isCompleting}
              onClick={() => void executeCompletionCommand(pendingCompletion)}
              className="rounded-lg bg-[#4e0e15] px-3 py-1.5 font-bold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isCompleting
                ? (lang === 'ka' ? 'მოწმდება…' : 'Checking…')
                : (lang === 'ka' ? 'იგივე ბრძანების ხელახლა გაგზავნა' : 'Resubmit same command')}
            </button>
          )}
        </div>
      )}

      {completionReversalError && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950" role="alert">
          <span>{completionReversalError}</span>
          {pendingCompletionReversal && (
            <button
              type="button"
              disabled={isReversingCompletion}
              onClick={() => void executeCompletionReversalCommand(pendingCompletionReversal)}
              className="rounded-lg bg-[#4e0e15] px-3 py-1.5 font-bold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isReversingCompletion
                ? (lang === 'ka' ? 'მოწმდება…' : 'Checking…')
                : (lang === 'ka' ? 'იგივე ბრძანების ხელახლა გაგზავნა' : 'Resubmit same command')}
            </button>
          )}
        </div>
      )}

      {completionReversalTargetId && (
        <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4" aria-label="Fermentation completion correction">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-rose-950">
                {lang === 'ka' ? 'დუღილის დასრულების გაუქმება' : 'Reopen completed fermentation'}
              </h3>
              <p className="mt-1 text-[11px] text-rose-800">
                {lang === 'ka'
                  ? 'საბოლოო მაჩვენებელი დარჩება ჟურნალში, ხოლო პარტია დაბრუნდება აქტიურ დუღილზე. შემდგომი სამუშაოების არსებობისას ბრძანება უსაფრთხოდ დაიბლოკება.'
                  : 'The final reading remains in the journal while the lot returns to active fermentation. The command is safely blocked if later cellar work depends on the completion.'}
              </p>
            </div>
            {!pendingCompletionReversal && (
              <button
                type="button"
                onClick={() => {
                  setCompletionReversalTargetId(null);
                  setCompletionReversalReason('');
                  setCompletionReversalError(null);
                }}
                className="rounded-full p-1 text-rose-500 hover:bg-rose-100"
                aria-label={lang === 'ka' ? 'დახურვა' : 'Close'}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <label className="mt-3 block text-[10px] font-bold uppercase tracking-wide text-rose-900" htmlFor="fermentation-reversal-reason">
            {lang === 'ka' ? 'გაუქმების მიზეზი' : 'Correction reason'}
          </label>
          <textarea
            id="fermentation-reversal-reason"
            value={completionReversalReason}
            disabled={Boolean(pendingCompletionReversal)}
            maxLength={500}
            onChange={event => setCompletionReversalReason(event.target.value)}
            className="mt-1 min-h-20 w-full rounded-lg border border-rose-200 bg-white p-2 text-xs text-stone-800 outline-none focus:border-rose-500 disabled:bg-stone-100"
            placeholder={lang === 'ka' ? 'მაგ. დასრულება შეცდომით დაფიქსირდა' : 'e.g. Completion was recorded prematurely'}
          />
          <button
            type="button"
            disabled={isReversingCompletion || Boolean(pendingCompletionReversal) || !completionReversalReason.trim()}
            onClick={confirmCompletionReversal}
            className="mt-2 rounded-lg bg-rose-800 px-3 py-2 text-[11px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isReversingCompletion
              ? (lang === 'ka' ? 'უქმდება…' : 'Reopening…')
              : (lang === 'ka' ? 'დასრულების გაუქმება' : 'Reopen fermentation')}
          </button>
        </section>
      )}

      {/* High-end stats widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">{lang === 'ka' ? 'აქტიური დუღილი' : 'Active Ferments'}</span>
            <strong className="text-xl font-sans font-black text-[#4e0e15]">{activeFerments.length} {lang === 'ka' ? 'კამპანია' : 'Campaigns'}</strong>
          </div>
          <div className="p-3.5 bg-rose-50 rounded-lg text-[#801323] shrink-0">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
        </div>

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">{lang === 'ka' ? 'ცხელი ჭურჭლის გაფრთხილება' : 'Hot Vessel Warning'}</span>
            <strong className="text-xl font-sans font-black text-amber-900">{hotTanksCount} {lang === 'ka' ? 'ჭურჭელი' : 'Tanks'} &gt;28°C</strong>
          </div>
          <div className={`p-3.5 rounded-lg shrink-0 ${hotTanksCount > 0 ? 'bg-amber-100 text-amber-700 animate-bounce' : 'bg-slate-50 text-slate-400'}`}>
            <Flame className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">{lang === 'ka' ? 'გაჩერების / შენელების რისკი' : 'Stuck / Sluggish Risk'}</span>
            <strong className="text-xl font-sans font-black text-rose-800">{slowFermsCount} {lang === 'ka' ? 'მონიშნული პარტია' : 'Lots Flagged'}</strong>
          </div>
          <div className={`p-3.5 rounded-lg shrink-0 ${slowFermsCount > 0 ? 'bg-red-50 text-red-650' : 'bg-slate-50 text-slate-400'}`}>
            <TrendingDown className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">{lang === 'ka' ? 'დუღილის ჩანაწერები' : 'Fermentation Logs'}</span>
            <strong className="text-xl font-sans font-black text-[#4e0e15]">{fermLogs.length} {lang === 'ka' ? 'ჩანაწერი' : 'Entries'}</strong>
          </div>
          <div className="p-3.5 bg-amber-50 rounded-lg text-amber-700 shrink-0">
            <Hourglass className="w-5 h-5" />
          </div>
        </div>

      </div>

      {/* Main interactive workflow and layouts grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">

        {/* Left column: Active Fermentations progress list with in-line input forms */}
        <div className="xl:col-span-4 space-y-4">
          <div className="flex items-center justify-between border-b border-[#e8dfd5] pb-2">
            <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-[#801323]" /> {lang === 'ka' ? 'აქტიური დუღილები' : 'Active Yeast Ferments'}
            </h3>
            {canCreateFermentationLog && (
              <button
                disabled={activeFerments.length === 0}
                onClick={() => {
                  setShowGeneralForm(!showGeneralForm);
                  setExpLogFormLotId(null);
                  setFormError('');
                  if (activeFerments.length > 0) {
                    setGeneralLotId(activeFerments[0].id);
                    const associated = vessels.find(v => v.assignedLotId === activeFerments[0].id);
                    setLogTankId(associated ? associated.id : '');
                    if (!associated) setFormError(lang === 'ka' ? 'ჩანაწერის შენახვამდე მიაბით პარტია ჭურჭელს.' : 'Assign the selected lot to a vessel before saving a reading.');
                  }
                }}
                className="px-2.5 py-1 text-[11px] font-bold text-[#4e0e15] bg-[#f5efe9] border border-[#dcd0c0] hover:bg-[#eadecd] rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
              >
                {lang === 'ka' ? '+ ახალი ჩანაწერი' : '+ Standard Log Entry'}
              </button>
            )}
          </div>

          {/* Quick-add general entry form drawer */}
          {canCreateFermentationLog && showGeneralForm && (
            <div className="p-4 bg-[#FCFAF8] border border-stone-250 rounded-xl space-y-3 shadow-xs">
              <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                <span className="text-[10px] font-mono font-bold uppercase text-[#4e0e15]">{lang === 'ka' ? 'დუღილის პარამეტრების ჩაწერა' : 'Register Ferment Parameters'}</span>
                <button onClick={() => setShowGeneralForm(false)} className="text-slate-400 hover:text-slate-700 p-0.5 rounded cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'აირჩიეთ აქტიური პარტია' : 'Select Active Wine Lot'}</label>
                  <select
                    value={generalLotId}
                    onChange={(e) => {
                      setGeneralLotId(e.target.value);
                      const associated = vessels.find(v => v.assignedLotId === e.target.value);
                      setLogTankId(associated ? associated.id : '');
                      setFormError(associated ? '' : (lang === 'ka' ? 'ჩანაწერის შენახვამდე მიაბით პარტია ჭურჭელს.' : 'Assign the selected lot to a vessel before saving a reading.'));
                    }}
                    className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-800"
                  >
                    {activeFerments.map(l => (
                      <option key={l.id} value={l.id}>{l.name} ({l.id})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'მიბმული ჭურჭელი' : 'Assigned Vessel / Tank'}</label>
                    <input
                      type="text"
                      disabled
                      value={logTankId || (lang === 'ka' ? 'არ არის მიბმული' : 'None assigned')}
                      className="w-full px-2 py-1 text-xs border bg-stone-100 rounded text-stone-500 font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'ტემპერატურა (°C)' : 'Temperature (°C)'}</label>
                    <input
                      type="number" step="0.1" value={logTemp}
                      onChange={(e) => setLogTemp(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-880"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'სიმკვრივე (SG)' : 'Specific Gravity (SG)'}</label>
                    <input
                      type="number" step="0.001" value={logDensity}
                      onChange={(e) => setLogDensity(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'ნარჩენი შაქარი (გ/ლ)' : 'Residual Sugar (g/L)'}</label>
                    <input
                      type="number" value={logSugar}
                      onChange={(e) => setLogSugar(parseInt(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">pH</label>
                    <input
                      type="number" step="0.01" value={logPH}
                      onChange={(e) => setLogPH(parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'ქუდის ოპერაციები' : 'Cap Operations'}</label>
                    <select
                      value={logCap}
                      onChange={(e) => setLogCap(e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-white text-stone-800"
                    >
                      <option value="None - Whites">{lang === 'ka' ? 'არაფერი / დალექვა (თეთრი)' : 'None / Sedimentation (Whites)'}</option>
                      <option value="Punchdowns - 1X Daily">{lang === 'ka' ? 'ქუდის ჩაწოლა — დღეში 1-ჯერ' : 'Punchdown - 1X daily'}</option>
                      <option value="Punchdowns - 2X Daily">{lang === 'ka' ? 'ქუდის ჩაწოლა — დღეში 2-ჯერ (წითელი)' : 'Punchdowns - 2X daily (Reds)'}</option>
                      <option value="Pumpover - Gentle 15m">{lang === 'ka' ? 'გადასხმა — რბილი (15 წთ)' : 'Pumpover - Gentle (15 min)'}</option>
                      <option value="Pumpover - Strong 30m">{lang === 'ka' ? 'გადასხმა — ინტენსიური (30 წთ)' : 'Pumpover - Strong (30 min)'}</option>
                      <option value="Délestage (Rack & Return)">{lang === 'ka' ? 'დელესტაჟი (გადაღება-დაბრუნება)' : 'Délestage (Rack & Return)'}</option>
                    </select>
                  </div>
                </div>

                {canConsumeFermentationMaterials && (
                  <OperationMaterialsEditor
                    lang={lang}
                    inventory={inventory}
                    value={materialDrafts}
                    onChange={setMaterialDrafts}
                    operationType="ferment_start"
                    lotVolumeL={lots.find(item => item.id === generalLotId)?.currentVolume}
                    compact
                  />
                )}

                <div>
                  <label className="block text-[10px] font-semibold text-stone-500 mb-0.5">{lang === 'ka' ? 'ორგანოლეპტიკური / დეგუსტაციის შენიშვნები' : 'Organoleptic / Tasting Notes'}</label>
                  <textarea
                    value={logNotes}
                    placeholder={lang === 'ka' ? 'შენიშვნები ქუდის მთლიანობაზე, გაზის გამოყოფასა და არომატებზე' : 'Notes on cap integrity, gas evolution, carbon dioxide aromas'}
                    onChange={(e) => setLogNotes(e.target.value)}
                    className="w-full px-2 py-1 text-xs border rounded h-14 bg-white text-stone-800"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleCommitLog(generalLotId, logTankId)}
                  disabled={!generalLotId || !logTankId}
                  className="w-full py-1.5 bg-[#4e0e15] hover:bg-[#6b151e] text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {lang === 'ka' ? 'ჩანაწერის შენახვა' : 'Commit Entry'}
                </button>
                {formError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
                    <p>{formError}</p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('vessels')}
                      className="mt-1 font-bold underline underline-offset-2 cursor-pointer"
                    >
                      {lang === 'ka' ? 'ჭურჭლის მიბმების გახსნა' : 'Open vessel assignments'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active lots list items container */}
          <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
            {activeFerments.map(lot => {
              const associatedVessel = vessels.find(v => v.assignedLotId === lot.id);
              const lotLogs = physicalFermLogs.filter(log => log.lotId === lot.id);
              const latestLog = lotLogs[0];
              const completableLog = lotLogs.find(log => (
                log.tankId === associatedVessel?.id && isCompletableFermentationReading(log)
              ));
              const isFormExp = canCreateFermentationLog && expLogFormLotId === lot.id;

              return (
                <div
                  key={lot.id}
                  className={`p-4 bg-white border border-[#e8dfd5] rounded-xl hover:shadow-xs transition-shadow space-y-4 ${
                    isFormExp ? 'ring-1.5 ring-[#4e0e15]' : ''
                  }`}
                >
                  {/* Lot details header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xs font-serif font-bold text-stone-900">{lot.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                        {lot.id} • {associatedVessel ? associatedVessel.id : (lang === 'ka' ? 'უჭურჭლო' : 'No Vessel')}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className="text-[9px] font-mono px-1.5 py-0.5 font-bold bg-[#FAF8F5] text-[#801323] border border-red-105 rounded uppercase">
                        🔬 {lang === 'ka'
                          ? ({red_dry: 'წითელი მშრალი', white_dry: 'თეთრი მშრალი', amber_dry: 'ქარვისფერი მშრალი', rose: 'ვარდისფერი', red_semi_sweet: 'წითელი ნახევრადტკბილი', white_semi_sweet: 'თეთრი ნახევრადტკბილი'} as Record<string, string>)[lot.wineClass] || lot.wineClass
                          : `${lot.wineClass} Wine`}
                      </span>
                      {isSluggish(lot.id) && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 font-black bg-rose-50 text-rose-700 border border-rose-200 rounded uppercase flex items-center gap-1 animate-pulse">
                          ⚠️ {lang === 'ka' ? 'შენელებული' : 'Sluggish'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chemistry overview widget */}
                  <div className="grid grid-cols-4 gap-1 p-2 bg-stone-50 rounded-lg text-center font-mono">
                    <div className="border-r border-stone-200">
                      <span className="text-[8px] text-slate-400 block uppercase">{lang === 'ka' ? 'ტემპ.' : 'Temp'}</span>
                      <strong className="text-[11px] text-stone-800 whitespace-nowrap">
                        {latestLog ? `${latestLog.temperature} °C` : '--'}
                      </strong>
                    </div>
                    <div className="border-r border-stone-200">
                      <span className="text-[8px] text-slate-400 block uppercase">{lang === 'ka' ? 'სიმკვრივე' : 'Density'}</span>
                      <strong className="text-[11px] text-stone-800 block leading-tight truncate">
                        {latestLog ? latestLog.density : '--'}
                      </strong>
                    </div>
                    <div className="border-r border-stone-200">
                      <span className="text-[8px] text-slate-400 block uppercase">{lang === 'ka' ? 'შაქარი' : 'Sugar'}</span>
                      <strong className="text-[11px] text-stone-800 leading-tight block">
                        {latestLog ? `${latestLog.sugar} g/L` : '--'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[8px] text-slate-400 block uppercase">pH</span>
                      <strong className="text-[11px] text-stone-800">
                        {latestLog ? latestLog.ph : '--'}
                      </strong>
                    </div>
                  </div>

                  {/* Sensory notes and operations status */}
                  {latestLog?.tastingNotes && (
                    <div className="space-y-1 bg-amber-50/20 border border-amber-100 p-2.5 rounded-lg text-xs leading-relaxed">
                      <div className="flex items-center gap-1 font-mono text-[9px] text-[#4e0e15] font-black uppercase">
                        <MessageSquare className="w-3 h-3 text-[#801323]" />
                        {lang === 'ka' ? 'ბოლო დეგუსტაციის შენიშვნები' : 'Latest Lot Tasting Remarks'}
                      </div>
                      <p className="text-[11px] text-stone-600 font-serif italic">
                        &ldquo;{latestLog.tastingNotes}&rdquo;
                      </p>
                    </div>
                  )}

                  {/* Actions Bar */}
                  {(canCreateFermentationLog || canComplete) && (
                    <div className="flex items-center gap-1.5 border-t border-dashed border-stone-205 pt-3">
                      {canCreateFermentationLog && (
                        <button
                          onClick={() => handleOpenLotLogForm(lot)}
                          className="flex-1 py-1 text-[10.5px] font-bold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded shadow-2xs transition-all cursor-pointer text-center"
                        >
                          📝 {lang === 'ka' ? 'დღის ჩანაწერი' : 'Log Today'}
                        </button>
                      )}
                      {canComplete && (
                        <button
                          onClick={() => finishFermentationStage(lot.id)}
                          disabled={!completableLog || Boolean(pendingCompletion) || isCompleting}
                          title={!completableLog
                            ? (lang === 'ka' ? 'ჯერ შეინახეთ საბოლოო მაჩვენებელი' : 'Save a final reading first')
                            : undefined}
                          className="px-2.5 py-1 text-[10px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          ✓ {isCompleting && pendingCompletion?.payload.lotId === lot.id
                            ? (lang === 'ka' ? 'სრულდება…' : 'Completing…')
                            : (lang === 'ka' ? 'დასრულება' : 'Completed')}
                        </button>
                      )}
                    </div>
                  )}

                  {/* In-line form specifically for this card */}
                  {isFormExp && (
                    <div className="border-t border-stone-200/80 pt-3 mt-3 space-y-3 bg-[#FCFAF8] p-3 rounded-lg border">
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#801323] font-bold">
                        <span>{lang === 'ka' ? `კინეტიკის ჩაწერა — ${lot.id}` : `Log kinetic stats for ${lot.id}`}</span>
                        <button onClick={() => setExpLogFormLotId(null)} className="text-stone-400 hover:text-stone-700">{lang === 'ka' ? 'გაუქმება' : 'Cancel'}</button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">{lang === 'ka' ? 'ტემპ. (°C)' : 'Temp (°C)'}</label>
                          <input
                            type="number" step="0.1" value={logTemp}
                            onChange={(e) => setLogTemp(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white text-stone-800 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">{lang === 'ka' ? 'სიმკვრივე / SG' : 'Density / SG'}</label>
                          <input
                            type="number" step="0.001" value={logDensity}
                            onChange={(e) => setLogDensity(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">{lang === 'ka' ? 'შაქარი (გ/ლ)' : 'Sugar (g/L)'}</label>
                          <input
                            type="number" value={logSugar}
                            onChange={(e) => setLogSugar(parseInt(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">pH</label>
                          <input
                            type="number" step="0.01" value={logPH}
                            onChange={(e) => setLogPH(parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-0.5 text-xs border rounded bg-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium text-slate-500">{lang === 'ka' ? 'ჭურჭელი' : 'Vessel'}</label>
                          <input
                            type="text" disabled value={logTankId || 'T-1'}
                            className="w-full px-2 py-0.5 text-xs border bg-stone-100 rounded text-stone-400 font-bold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] font-medium text-slate-500">{lang === 'ka' ? 'ქუდის მართვის რუტინა' : 'Cap Management Routine'}</label>
                        <select
                          value={logCap}
                          onChange={(e) => setLogCap(e.target.value)}
                          className="w-full px-2 py-1 text-xs border rounded bg-white"
                        >
                          <option value="Punchdowns - 2X Daily">{lang === 'ka' ? 'ქუდის ჩაწოლა — დღეში 2-ჯერ' : 'Punchdowns - 2X Daily'}</option>
                          <option value="Pumpover - Gentle 15m">{lang === 'ka' ? 'გადასხმა — რბილი 15წთ' : 'Pumpover - Gentle 15m'}</option>
                          <option value="Punchdown - Manual 1X">{lang === 'ka' ? 'ქუდის ჩაწოლა — ხელით 1-ჯერ' : 'Punchdown - Manual 1X'}</option>
                          <option value="Délestage (Rack & Return)">{lang === 'ka' ? 'დელესტაჟი (გადაღება-დაბრუნება)' : 'Délestage (Rack & Return)'}</option>
                          <option value="None (Inert static environment)">{lang === 'ka' ? 'არაფერი (თეთრი/ქვევრი)' : 'None (Whites/Clay)'}</option>
                        </select>
                      </div>

                      {canConsumeFermentationMaterials && (
                        <OperationMaterialsEditor
                          lang={lang}
                          inventory={inventory}
                          value={materialDrafts}
                          onChange={setMaterialDrafts}
                          operationType="ferment_start"
                          lotVolumeL={lot.currentVolume}
                          compact
                        />
                      )}

                      <div>
                        <label className="block text-[9px] font-medium text-slate-500">{lang === 'ka' ? 'დღიური დეგუსტაციის შენიშვნები' : 'Daily Tasting Reflections'}</label>
                        <textarea
                          value={logNotes}
                          placeholder={lang === 'ka' ? 'ხილის ესთერები, სიმკვრივის დინამიური ვარდნა...' : 'Arresting fruit esters, dynamic density decrease...'}
                          onChange={(e) => setLogNotes(e.target.value)}
                          className="w-full px-2 py-1 text-xs border rounded h-14 bg-white"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCommitLog(lot.id, associatedVessel?.id || '')}
                        disabled={!associatedVessel}
                        className="w-full py-1 bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {lang === 'ka' ? 'ჩანაწერის შენახვა' : 'Commit Log Entry'}
                      </button>
                      {!associatedVessel && (
                        <button
                          type="button"
                          onClick={() => setActiveTab('vessels')}
                          className="w-full text-[10px] font-bold text-amber-800 underline underline-offset-2 cursor-pointer"
                        >
                          {lang === 'ka' ? 'ჯერ მიაბით პარტია ჭურჭელს' : 'Assign this lot to a vessel first'}
                        </button>
                      )}
                    </div>
                  )}

                </div>
              );
            })}

            {activeFerments.length === 0 && (
              <div className="p-8 text-center border-2 border-dashed border-[#e8dfd5] rounded-xl text-slate-500">
                <p className="font-serif italic">{lang === 'ka' ? 'აქტიური დუღილის კამპანიები არ არის.' : 'No active fermentation campaigns.'}</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('lots')}
                  className="mt-3 rounded-lg bg-[#4e0e15] px-3 py-2 text-[11px] font-bold text-white cursor-pointer"
                >
                  {canUpdateFermentationLot
                    ? (lang === 'ka' ? 'გახსენით ღვინის პარტიები დუღილის დასაწყებად' : 'Open Wine Lots to start fermentation')
                    : (lang === 'ka' ? 'ღვინის პარტიების ნახვა' : 'Review Wine Lots')}
                </button>
              </div>
            )}
          </div>

        </div>

        {/* Right column: Charts & Ledgers */}
        <div className="xl:col-span-8 space-y-6">

          {/* Interactive curves visualizer */}
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-xs text-stone-850 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-100 pb-3">
              <div>
                <h3 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1">
                  <span className="text-red-800">📊</span> {lang === 'ka' ? 'დუღილის ცოცხალი კინეტიკური მრუდები' : 'Live Kinetic Fermentation Curves'}
                </h3>
                <p className="text-[10px] text-slate-400 font-medium">{lang === 'ka' ? 'ორღერძიანი მრუდები: შაქრის კლება (ლალისფერი) და სიმკვრივის ვარდნა (ქარვისფერი)' : 'Dual-axes real-time depletion curves for Sugar (ruby red) & Density drop (amber gold)'}</p>
              </div>

              <div>
                <select
                  value={chartLotId}
                  onChange={(e) => setChartLotId(e.target.value)}
                  className="text-xs font-semibold px-3 py-1 bg-[#FAF8F5] border border-stone-200 rounded-lg outline-none w-full sm:w-56 cursor-pointer"
                >
                  <option value="">{lang === 'ka' ? '-- აირჩიეთ პარტია გრაფიკისთვის --' : '-- Choose Lot to Chart --'}</option>
                  {Array.from(new Set(physicalFermLogs.map(l => l.lotId))).map(lId => {
                    const associatedLot = lots.find(lt => lt.id === lId);
                    return (
                      <option key={lId} value={lId}>
                        📈 {associatedLot ? associatedLot.name : lId} ({lId})
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {chartLotId ? (
              <FermentationCurveChart logs={physicalFermLogs} selectedLotId={chartLotId} lang={lang} />
            ) : (
              <div className="py-24 text-center border-2 border-dashed border-stone-100 text-stone-400 italic">
                {lang === 'ka' ? 'აირჩიეთ ღვინის პარტია ზემოთ მოცემული სიიდან კინეტიკური მრუდების სანახავად.' : 'Select a wine lot from the dropdown options above to inspect visual kinetic curves.'}
              </div>
            )}
          </div>

          {/* Master fermentation logs ledger list */}
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-xs text-stone-850 space-y-4">
            <h3 className="text-sm font-serif font-bold text-stone-900 flex items-center gap-1 border-b border-stone-100 pb-2">
              📋 {lang === 'ka' ? 'პირველადი დუღილის ჟურნალი' : 'Posted Primary Fermentation Journal'}
            </h3>

            <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
              {fermLogs.map(log => {
                const lot = lots.find(l => l.id === log.lotId);
                const isCorrection = isFermentationCompletionReversal(log);
                const isReversedCompletion = log.isCompletion === true && Boolean(log.reversedByCommandId || log.reversedAt);
                const canReopen = canReverseFermentationCompletion
                  && log.recordKind === 'completion'
                  && Boolean(log.commandId && log.completionSnapshot)
                  && !isReversedCompletion;
                return (
                  <div key={log.id} className={`p-3.5 border rounded-xl transition-colors ${isCorrection ? 'border-rose-200 bg-rose-50/60' : 'border-stone-150 bg-stone-50 hover:border-slate-305'}`}>
                    <div className="flex items-center justify-between text-xs font-bold text-slate-705">
                      <span className="flex flex-wrap items-center gap-1.5 font-sans">
                        <span className="text-purple-900">🍇</span>
                        <strong>{lot ? lot.name : log.lotId}</strong>
                        <span className="text-[10px] bg-white border px-1.5 py-0.2 rounded text-slate-455 font-mono">{lang === 'ka' ? 'ჭურჭელი' : 'Vessel'}: {log.tankId}</span>
                        {log.isCompletion && !isCorrection && (
                          <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${isReversedCompletion ? 'border-stone-300 bg-stone-100 text-stone-500' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                            {isReversedCompletion
                              ? (lang === 'ka' ? 'გაუქმებული დასრულება' : 'Completion reversed')
                              : (lang === 'ka' ? 'საბოლოო მაჩვენებელი' : 'Final reading')}
                          </span>
                        )}
                        {isCorrection && (
                          <span className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-[9px] uppercase text-rose-800">
                            {lang === 'ka' ? 'შესწორება' : 'Correction'}
                          </span>
                        )}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-mono">{log.date}</span>
                        {canReopen && (
                          <button
                            type="button"
                            title={lang === 'ka' ? 'დუღილის ხელახლა გახსნა' : 'Reopen fermentation'}
                            onClick={() => startCompletionReversal(log)}
                            className="rounded border border-rose-200 bg-white px-2 py-1 text-[9px] font-bold text-rose-800 hover:bg-rose-100"
                          >
                            {lang === 'ka' ? 'გაუქმება' : 'Reopen'}
                          </button>
                        )}
                        {canDeleteFermentationLog && !log.commandId && (
                          <button
                            title={lang === 'ka' ? 'ჩანაწერის წაშლა' : 'Delete Entry'}
                            onClick={() => handleDeleteLog(log.id)}
                            className="text-slate-300 hover:text-red-600 transition-colors p-1 rounded-full hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {!isCorrection && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] text-slate-500 font-mono mt-2 bg-white/70 p-2 border rounded-lg">
                      <div className="flex items-baseline gap-1">{lang === 'ka' ? 'ტემპ.' : 'Temp'}: <strong className="text-stone-800 text-xs font-black">{log.temperature} °C</strong></div>
                      <div className="flex items-baseline gap-1">{lang === 'ka' ? 'სიმკვრივე' : 'Density'}: <strong className="text-stone-850 text-xs font-bold">{log.density} SG</strong></div>
                      <div className="flex items-baseline gap-1 font-sans">{lang === 'ka' ? 'შაქარი' : 'Sugar'}: <strong className="text-stone-800 font-bold block">{log.sugar} g/L</strong></div>
                      <div className="flex items-baseline gap-1">pH: <strong className="text-slate-700 text-xs">{log.ph}</strong></div>
                    </div>}

                    {/* Cap & Additives specs block */}
                    {!isCorrection && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2 text-[10px] text-stone-600 font-medium">
                      <div className="bg-[#FAF8F5] px-2.5 py-1.5 border border-stone-200/50 rounded-lg flex items-center gap-1.5">
                        <span className="font-bold underline text-[#4e0e15] uppercase text-[8px] font-mono shrink-0">{lang === 'ka' ? 'ქუდი:' : 'Cap Ops:'}</span>
                        <span className="truncate">{log.capManagement || (lang === 'ka' ? 'ქუდის ოპერაციები არ ჩაწერილა' : 'No active skin operations logged')}</span>
                      </div>
                      <div className="bg-indigo-50/20 px-2.5 py-1.5 border border-indigo-100/60 rounded-lg flex items-center gap-1.5">
                        <span className="font-bold underline text-indigo-750 uppercase text-[8px] font-mono shrink-0">{lang === 'ka' ? 'დანამატები:' : 'Additives:'}</span>
                        <span className="truncate">{log.additives || (lang === 'ka' ? 'არაფერი' : 'None')}</span>
                      </div>
                    </div>}

                    <p className="text-[11px] text-stone-600 italic bg-white p-2.5 border border-slate-100 rounded-lg mt-2 font-serif">
                      &quot;{log.tastingNotes}&quot;
                    </p>
                  </div>
                );
              })}

              {fermLogs.length === 0 && (
                <p className="p-8 text-stone-400 italic text-center font-serif">{lang === 'ka' ? 'დუღილის ჟურნალის ჩანაწერები არ არის.' : 'No fermentation log ledger entries recorded.'}</p>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
