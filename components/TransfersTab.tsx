'use client';

import React, { useState, useEffect } from 'react';
import type { Language } from '../lib/i18n';
import type {
  Vessel,
  WineLot,
  CellarTransferRecord,
  InventoryItem,
  OperationMaterialUsage,
} from '../lib/wineryState';
import type { CellarOperationInput } from '../lib/commands/cellarOperation';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyTransferCommand,
  type TransferCommandPayload,
  type TransferCommandResult,
} from '../lib/commands/transfer';
import {
  applyTransferReversalCommand,
  type TransferReversalCommandPayload,
} from '../lib/commands/transferReversal';
import {
  CommandRequestError,
  createTransferCommandIntent,
  createTransferReversalCommandIntent,
  pendingTransferCommandIntent,
  pendingTransferReversalCommandIntent,
  submitTransferCommand,
  submitTransferReversalCommand,
  type TransferCommandResponse,
  type TransferReversalCommandResponse,
} from '../lib/commands/client';
import OperationMaterialsEditor, {
  materialDraftIssue,
  materialDraftsToUsages,
  type MaterialUsageDraft,
} from './OperationMaterialsEditor';
import {
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  RotateCcw,
  X,
  Shuffle,
  Compass,
  Sparkles,
  Check,
  User,
  Activity
} from 'lucide-react';

interface Props {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  inventory?: InventoryItem[];
  onUpdateVessels: (newVessels: Vessel[]) => void;
  onUpdateLots: (newLots: WineLot[]) => void;
  onAddCellarOperation?: (input: CellarOperationInput) => string;
  prefilledSourceId?: string;
  prefilledDestId?: string;
  clearPrefilled?: () => void;
  pastTransfers: CellarTransferRecord[];
  onUpdateTransfers: (transfers: CellarTransferRecord[]) => void;
  onApplyTransferCommandResponse?: (response: TransferCommandResponse) => void;
  onApplyTransferReversalCommandResponse?: (response: TransferReversalCommandResponse) => void;
  canExecuteTransfer?: boolean;
  canSanitizeVessels?: boolean;
  canConsumeTransferMaterials?: boolean;
  canReverseTransfer?: boolean;
}

type TransferRecord = CellarTransferRecord;

export default function TransfersTab({
  lang, vessels, lots, inventory = [], onUpdateVessels, onUpdateLots, onAddCellarOperation,
  prefilledSourceId, prefilledDestId, clearPrefilled, pastTransfers, onUpdateTransfers,
  onApplyTransferCommandResponse, onApplyTransferReversalCommandResponse,
  canExecuteTransfer = true, canSanitizeVessels = true,
  canConsumeTransferMaterials = false, canReverseTransfer = true,
}: Props) {
  // Transfer input states
  const [sourceId, setSourceId] = useState<string>('');
  const [destId, setDestId] = useState<string>('');
  const [transferVol, setTransferVol] = useState<number>(500);
  const [pumpModel, setPumpModel] = useState<string>('Enopump E-400');
  const [lossVol, setLossVol] = useState<number>(4);
  const [operatorName, setOperatorName] = useState<string>('');
  const [reasonCategory, setReasonCategory] = useState<'racking' | 'blend' | 'filtration' | 'bottling'>('racking');
  const [operationReceipt, setOperationReceipt] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingIntent, setPendingIntent] = useState<PendingCommandIntent<TransferCommandPayload> | null>(null);
  const [isReversing, setIsReversing] = useState(false);
  const [reversalTargetId, setReversalTargetId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [pendingReversalIntent, setPendingReversalIntent] = useState<PendingCommandIntent<TransferReversalCommandPayload> | null>(null);
  const [materialDrafts, setMaterialDrafts] = useState<MaterialUsageDraft[]>([]);
  const [pendingMaterialPosting, setPendingMaterialPosting] = useState<{
    lotId: string;
    vesselId: string;
    operator: string;
    category: 'racking' | 'blend' | 'filtration' | 'bottling';
    transferId: string;
    materials: OperationMaterialUsage[];
  } | null>(null);

  useEffect(() => {
    const restored = pendingTransferCommandIntent();
    if (!restored) return;
    setPendingIntent(restored);
    setSourceId(restored.payload.sourceVesselId);
    setDestId(restored.payload.destinationVesselId);
    setTransferVol(restored.payload.volumeLiters);
    setLossVol(restored.payload.lossLiters);
    setOperatorName(restored.payload.operator);
    setReasonCategory(restored.payload.category);
    setPumpModel(restored.payload.pump);
    setCommandError(lang === 'ka'
      ? 'წინა გადატანის შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანების უსაფრთხოდ აღსადგენად დააჭირეთ ხელახლა გაგზავნას.'
      : 'A previous transfer is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [lang]);

  useEffect(() => {
    const restored = pendingTransferReversalCommandIntent();
    if (!restored) return;
    setPendingReversalIntent(restored);
    setReversalReason(restored.payload.reason);
    const original = pastTransfers.find(record => record.commandId === restored.payload.originalCommandId);
    setReversalTargetId(original?.id || null);
    setCommandError(lang === 'ka'
      ? 'წინა დაბრუნების შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანების უსაფრთხოდ აღსადგენად ხელახლა გაგზავნეთ.'
      : 'A previous reversal is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [lang, pastTransfers]);

  // Apply prefilled values when redirected from map drop
  useEffect(() => {
    // An unacknowledged online command is immutable until replay resolves it.
    // Do not let navigation autofill overwrite the durable recovery payload.
    if (pendingTransferCommandIntent()) return;
    if (prefilledSourceId) {
      setSourceId(prefilledSourceId);
      // Auto-set transfer volume to source's volume as a sensible default
      const srcVessel = vessels.find(v => v.id === prefilledSourceId);
      if (srcVessel) {
        setTransferVol(srcVessel.currentVolume);
      }
    }
    if (prefilledDestId) {
      setDestId(prefilledDestId);
    }
    if (prefilledSourceId || prefilledDestId) {
      clearPrefilled?.();
    }
  }, [prefilledSourceId, prefilledDestId, vessels, clearPrefilled]);

  const saveTransfers = (newXfers: TransferRecord[]) => {
    onUpdateTransfers(newXfers);
    localStorage.setItem('cf_transfers_history', JSON.stringify(newXfers));
  };

  const sourceVessel = vessels.find(v => v.id === sourceId);
  const destVessel = vessels.find(v => v.id === destId);

  // Safety assessments
  const sourceIsEmpty = sourceVessel ? sourceVessel.currentVolume === 0 : true;
  const sourceHasInsufficient = sourceVessel ? transferVol <= 0 || sourceVessel.currentVolume < transferVol : true;

  const destCapRemaining = destVessel ? destVessel.capacity - destVessel.currentVolume : 0;
  const arrivalVolume = Math.max(0, transferVol - lossVol);
  const destWillOverflow = destVessel ? arrivalVolume > destCapRemaining : true;
  const lossIsInvalid = lossVol < 0 || lossVol >= transferVol;
  const destinationNeedsCleaning = Boolean(destVessel && destVessel.currentVolume === 0 && destVessel.cleaningStatus !== 'clean');
  const transferMaterialIssue = canConsumeTransferMaterials
    ? materialDraftIssue(materialDrafts, inventory)
    : null;

  // Wet blend warning
  const showsBlendAlert = sourceVessel && destVessel &&
                      sourceVessel.assignedLotId && destVessel.assignedLotId &&
                      sourceVessel.assignedLotId !== destVessel.assignedLotId;

  // Let's make an advanced calculation of resulting enological metrics (Weighted blend model!)
  const getBlendedPrediction = () => {
    if (!sourceVessel || !destVessel) return null;
    const sourceLot = lots.find(l => l.id === sourceVessel.assignedLotId);

    if (!sourceLot) return null;

    // Default mock chemistry values if not explicit
    const sourceABV = sourceVessel.id.includes('T-1') ? 13.5 : 14.2;
    const sourcepH = 3.42;
    const sourceSO2 = 25;

    // Dest values
    const destABV = destVessel.id.includes('T-3') ? 12.8 : 13.9;
    const destpH = 3.55;
    const destSO2 = 28;

    const vSource = transferVol - lossVol;
    const vDest = destVessel.currentVolume;
    const vTotal = vSource + vDest;

    if (vTotal === 0) return null;

    // If destination is empty, prediction is simply the incoming source
    if (vDest === 0) {
      return {
        abv: sourceABV,
        ph: sourcepH,
        so2: sourceSO2
      };
    }

    const blendedABV = parseFloat(((sourceABV * vSource + destABV * vDest) / vTotal).toFixed(2));
    const blendedpH = parseFloat(((sourcepH * vSource + destpH * vDest) / vTotal).toFixed(2));
    const blendedSO2 = Math.round((sourceSO2 * vSource + destSO2 * vDest) / vTotal);

    return {
      abv: blendedABV,
      ph: blendedpH,
      so2: blendedSO2
    };
  };

  const predictedBlend = getBlendedPrediction();

  // Execute transfer state
  const localizedReceipt = (result: TransferCommandResult): string => {
    if (result.receipt.kind === 'blend') {
      return lang === 'ka'
        ? `შეიქმნა ახალი კუპაჟის პარტია „${result.receipt.destinationLotId}“: ${result.receipt.arrivalLiters} ლ წყაროდან და ${result.destinationVessel.currentVolume - result.receipt.arrivalLiters} ლ მიმღები ჭურჭლიდან.`
        : `Created blend lot “${result.receipt.destinationLotId}”: ${result.receipt.arrivalLiters} L arrived from the source vessel.`;
    }
    return lang === 'ka'
      ? `${result.receipt.volumeLiters} ლ წარმატებით გადაიტუმბა ${result.receipt.destinationVesselId}-ში; მიღებულია ${result.receipt.arrivalLiters} ლ.`
      : `Transferred ${result.receipt.volumeLiters} L into ${result.receipt.destinationVesselId}; ${result.receipt.arrivalLiters} L arrived.`;
  };

  const resetTransferForm = () => {
    setSourceId('');
    setDestId('');
    setOperatorName('');
    setPendingIntent(null);
    setCommandError(null);
  };

  const queueTransferMaterials = (result: TransferCommandResult) => {
    if (!canConsumeTransferMaterials) return;
    const materials = materialDraftsToUsages(materialDrafts, inventory);
    if (!materials.length) return;
    setPendingMaterialPosting({
      lotId: result.receipt.destinationLotId,
      vesselId: result.receipt.destinationVesselId,
      operator: operatorName || 'Cellar Crew',
      category: reasonCategory,
      transferId: result.transfer.id,
      materials,
    });
  };

  useEffect(() => {
    if (!pendingMaterialPosting || !onAddCellarOperation) return;
    const destinationLot = lots.find(item => item.id === pendingMaterialPosting.lotId);
    const destinationVessel = vessels.find(item => item.id === pendingMaterialPosting.vesselId);
    if (!destinationLot || destinationVessel?.assignedLotId !== destinationLot.id) return;
    onAddCellarOperation({
      date: new Date().toISOString().slice(0, 10),
      type: pendingMaterialPosting.category === 'blend'
        ? 'blending'
        : pendingMaterialPosting.category === 'bottling'
          ? 'bottling'
          : pendingMaterialPosting.category,
      lotId: destinationLot.id,
      vesselId: destinationVessel.id,
      vesselToId: null,
      materials: pendingMaterialPosting.materials,
      operator: pendingMaterialPosting.operator,
      notes: lang === 'ka'
        ? `გადატანასთან დაკავშირებული დანამატები: ${pendingMaterialPosting.transferId}`
        : `Materials linked to transfer ${pendingMaterialPosting.transferId}`,
    });
    setPendingMaterialPosting(null);
    setMaterialDrafts([]);
  }, [lang, lots, onAddCellarOperation, pendingMaterialPosting, vessels]);

  const applyTransferLocally = (intent: PendingCommandIntent<TransferCommandPayload>) => {
    const applied = applyTransferCommand(
      { vessels, lots, transfers: pastTransfers },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: intent.payload.operator || 'Cellar Crew',
        performedAt: new Date(),
      },
    );
    onUpdateVessels(applied.state.vessels);
    onUpdateLots(applied.state.lots);
    saveTransfers(applied.state.transfers);
    setOperationReceipt(localizedReceipt(applied.result));
    queueTransferMaterials(applied.result);
    resetTransferForm();
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canExecuteTransfer || pendingReversalIntent) return;
    if (!pendingIntent && (!sourceVessel || !destVessel || sourceIsEmpty || sourceHasInsufficient
      || destWillOverflow || lossIsInvalid || destinationNeedsCleaning)) return;
    if (!pendingIntent && transferMaterialIssue) {
      setCommandError(lang === 'ka'
        ? 'შეამოწმეთ გადატანის დანამატები, რაოდენობები და ხელმისაწვდომი მარაგი.'
        : 'Check the transfer materials, quantities, and available stock.');
      return;
    }

    const intent = pendingIntent || createTransferCommandIntent({
      sourceVesselId: sourceId,
      destinationVesselId: destId,
      volumeLiters: transferVol,
      lossLiters: lossVol,
      operator: operatorName || 'Cellar Crew',
      category: reasonCategory,
      pump: pumpModel,
    });

    setCommandError(null);
    if (!onApplyTransferCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        setCommandError(lang === 'ka'
          ? 'დაუდასტურებელი ბრძანების აღდგენას ინტერნეტთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged transfer requires a server connection.');
        return;
      }
      try {
        applyTransferLocally(intent);
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Transfer validation failed.');
      }
      return;
    }

    setPendingIntent(intent);
    setIsSubmitting(true);
    try {
      const response = await submitTransferCommand(intent);
      onApplyTransferCommandResponse(response);
      setOperationReceipt(localizedReceipt(response.result));
      queueTransferMaterials(response.result);
      resetTransferForm();
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        // The server rejected before claiming or mutating anything. This is the
        // development/JSON-backend compatibility path and is safe to queue via
        // the established whole-state sync flow.
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyTransferLocally(intent);
          return;
        } catch (fallbackError) {
          setCommandError(fallbackError instanceof Error ? fallbackError.message : 'Transfer validation failed.');
          setPendingIntent(null);
          return;
        }
      }
      const message = error instanceof Error ? error.message : 'Transfer command failed.';
      setCommandError(message);
      if (error instanceof CommandRequestError && !error.retryable) {
        setPendingIntent(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick sanitation of vessels
  const handleSanitizeVessel = (id: string, stage: 'clean' | 'sterilized') => {
    if (!canSanitizeVessels) return;
    const updated = vessels.map(v => {
      if (v.id === id) {
        return {
          ...v,
          cleaningStatus: (stage === 'sterilized' ? 'clean' : stage) as any,
          lastOperation: `Sanitized on ${new Date().toISOString().split('T')[0]} as ${stage.toUpperCase()}`
        };
      }
      return v;
    });
    onUpdateVessels(updated);
  };

  const clearReversalForm = () => {
    setPendingReversalIntent(null);
    setReversalTargetId(null);
    setReversalReason('');
  };

  const applyTransferReversalLocally = (
    intent: PendingCommandIntent<TransferReversalCommandPayload>,
  ) => {
    const applied = applyTransferReversalCommand(
      { vessels, lots, transfers: pastTransfers },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: 'Cellar Crew',
        performedAt: new Date(),
      },
    );
    onUpdateVessels(applied.state.vessels);
    onUpdateLots(applied.state.lots);
    saveTransfers(applied.state.transfers);
    setOperationReceipt(lang === 'ka'
      ? `გადატანა ${applied.result.originalTransfer.id} დაბრუნებულია და მაკორექტირებელი ჩანაწერი შენახულია.`
      : `Transfer ${applied.result.originalTransfer.id} was reversed with an immutable correction record.`);
    clearReversalForm();
  };

  const handleReverseTransfer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canReverseTransfer || pendingIntent) return;
    const original = reversalTargetId
      ? pastTransfers.find(record => record.id === reversalTargetId)
      : pastTransfers.find(record => record.commandId === pendingReversalIntent?.payload.originalCommandId);
    if (!original?.commandId || original.recordKind === 'reversal' || original.reversedByCommandId) return;

    const intent = pendingReversalIntent || createTransferReversalCommandIntent({
      originalCommandId: original.commandId,
      reason: reversalReason,
    });
    setCommandError(null);

    if (!onApplyTransferReversalCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingReversalIntent) {
        setCommandError(lang === 'ka'
          ? 'დაუდასტურებელი დაბრუნების აღდგენას სერვერთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged reversal requires a server connection.');
        return;
      }
      try {
        applyTransferReversalLocally(intent);
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Transfer reversal validation failed.');
      }
      return;
    }

    setPendingReversalIntent(intent);
    setIsReversing(true);
    try {
      const response = await submitTransferReversalCommand(intent);
      onApplyTransferReversalCommandResponse(response);
      setOperationReceipt(lang === 'ka'
        ? `გადატანა ${response.result.originalTransfer.id} დაბრუნებულია და მაკორექტირებელი ჩანაწერი შენახულია.`
        : `Transfer ${response.result.originalTransfer.id} was reversed with an immutable correction record.`);
      clearReversalForm();
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingReversalIntent) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyTransferReversalLocally(intent);
          return;
        } catch (fallbackError) {
          setCommandError(fallbackError instanceof Error
            ? fallbackError.message
            : 'Transfer reversal validation failed.');
          setPendingReversalIntent(null);
          return;
        }
      }
      setCommandError(error instanceof Error ? error.message : 'Transfer reversal command failed.');
      if (error instanceof CommandRequestError && !error.retryable) {
        setPendingReversalIntent(null);
      }
    } finally {
      setIsReversing(false);
    }
  };

  // 1. Global Recommendations (Idle state)
  const globalRecommendations = React.useMemo(() => {
    const recs: Array<{
      id: string;
      title: string;
      titleKa: string;
      desc: string;
      descKa: string;
      sourceId: string;
      destId: string;
      volume: number;
      badge: string;
      badgeKa: string;
    }> = [];

    // Heuristic A: Oxidation Headspace Protection (Ullage Control)
    // Find occupied tanks that are underfilled (between 40% and 85% full)
    const underfilled = vessels.filter(v => v.currentVolume > 0 && (v.currentVolume / v.capacity) >= 0.4 && (v.currentVolume / v.capacity) <= 0.85);
    underfilled.forEach(v => {
      const lot = lots.find(l => l.id === v.assignedLotId);
      if (!lot) return;

      // Look for a smaller vessel (like a barrel) with the same lot to top it off
      const potentialTopper = vessels.find(s => s.id !== v.id && s.assignedLotId === v.assignedLotId && s.currentVolume > 0 && s.currentVolume < (v.capacity - v.currentVolume));
      if (potentialTopper) {
        recs.push({
          id: `opt-top-${v.id}-${potentialTopper.id}`,
          title: `Headspace Topping: Eliminate Oxidation Risk`,
          titleKa: `თავისუფალი სივრცის შევსება: ჟანგვის რისკის თავიდან აცილება`,
          desc: `Transfer ${potentialTopper.currentVolume}L from ${potentialTopper.id} into ${v.id} to minimize headspace/ullage and secure Lot ${lot.name}.`,
          descKa: `გადაიტანეთ ${potentialTopper.currentVolume}ლ ჭურჭლიდან ${potentialTopper.id} ჭურჭელში ${v.id} თავისუფალი სივრცის შესამცირებლად და ${lot.name} პარტიის დასაცავად.`,
          sourceId: potentialTopper.id,
          destId: v.id,
          volume: potentialTopper.currentVolume,
          badge: 'Oxidation Alert',
          badgeKa: 'ჟანგვის საფრთხე'
        });
      }
    });

    // Heuristic B: Post-Fermentation Lees Racking
    // Find dirty tanks containing dry lots (stage: aging)
    const needsRacking = vessels.filter(v => v.currentVolume > 0 && v.cleaningStatus === 'dirty');
    needsRacking.forEach(v => {
      const lot = lots.find(l => l.id === v.assignedLotId);
      if (!lot || lot.stage !== 'aging') return;

      // Find an empty clean or sterilized tank that can fit the full volume
      const cleanDest = vessels.find(d => d.currentVolume === 0 && d.cleaningStatus === 'clean' && d.capacity >= v.currentVolume);
      if (cleanDest) {
        recs.push({
          id: `opt-rack-${v.id}-${cleanDest.id}`,
          title: `Rack Off post-fermentation lees`,
          titleKa: `ლექიდან მოხსნა (დეკანტაცია)`,
          desc: `Move ${v.currentVolume}L of ${lot.name} from dirty ${v.id} to empty clean ${cleanDest.id} to prevent sulfur off-odors.`,
          descKa: `გადაიტანეთ ${v.currentVolume}ლ (${lot.name}) ჭუჭყიანი ${v.id}-დან სუფთა ${cleanDest.id}-ში გოგირდოვანი სუნის თავიდან ასაცილებლად.`,
          sourceId: v.id,
          destId: cleanDest.id,
          volume: v.currentVolume,
          badge: 'Lees Racking',
          badgeKa: 'ლექიდან მოხსნა'
        });
      }
    });

    // Heuristic C: Free Small Cooperage (Consolidation)
    // Find two vessels containing matching lots that can combine
    const occupied = vessels.filter(v => v.currentVolume > 0);
    for (let i = 0; i < occupied.length; i++) {
      const v1 = occupied[i];
      const lot1 = lots.find(l => l.id === v1.assignedLotId);
      if (!lot1) continue;

      for (let j = i + 1; j < occupied.length; j++) {
        const v2 = occupied[j];
        if (v1.assignedLotId === v2.assignedLotId) {
          const totalVol = v1.currentVolume + v2.currentVolume;
          // Find if there is a larger empty tank or if one of the tanks can hold the total
          if (v1.capacity >= totalVol) {
            recs.push({
              id: `opt-merge-${v2.id}-${v1.id}`,
              title: `Consolidate matching Lot into single tank`,
              titleKa: `პარტიების გაერთიანება ერთ ჭურჭელში`,
              desc: `Consolidate ${v2.currentVolume}L from ${v2.id} into ${v1.id} (total ${totalVol}L) to free up empty cooperage.`,
              descKa: `გააერთიანეთ ${v2.currentVolume}ლ ${v2.id}-დან ${v1.id}-ში (სულ ${totalVol}ლ) სხვა ოპერაციებისთვის ჭურჭლის გამოსათავისუფლებლად.`,
              sourceId: v2.id,
              destId: v1.id,
              volume: v2.currentVolume,
              badge: 'Consolidation',
              badgeKa: 'გაერთიანება'
            });
          }
        }
      }
    }

    // Default mock recommendations if none of the rules triggered
    if (recs.length === 0) {
      const sourceWithVolume = vessels.find(v => v.currentVolume > 0);
      const cleanEmpty = vessels.find(v => v.currentVolume === 0 && v.cleaningStatus === 'clean');
      if (sourceWithVolume && cleanEmpty) {
        recs.push({
          id: 'opt-mock-racking',
          title: 'Routine Racking: Clean to Sterilized Tank',
          titleKa: 'გეგმიური გადატანა: სტერილურ ჭურჭელში',
          desc: `Rack ${sourceWithVolume.currentVolume}L of wine from ${sourceWithVolume.id} to clean empty ${cleanEmpty.id} to assist clarity.`,
          descKa: `გადაიღეთ ${sourceWithVolume.currentVolume}ლ ღვინო ${sourceWithVolume.id}-დან სუფთა ${cleanEmpty.id}-ში სიკაშკაშის გასაუმჯობესებლად.`,
          sourceId: sourceWithVolume.id,
          destId: cleanEmpty.id,
          volume: sourceWithVolume.currentVolume,
          badge: 'Clarification',
          badgeKa: 'გაფილტვრა'
        });
      }
    }

    return recs.slice(0, 3);
  }, [vessels, lots]);

  // 2. Contextual Recommendations (when sourceId is chosen)
  const destinationScores = React.useMemo(() => {
    if (!sourceId || !sourceVessel) return [];
    const sourceLot = lots.find(l => l.id === sourceVessel.assignedLotId);

    return vessels
      .filter(v => v.id !== sourceId)
      .map(v => {
        const lot = lots.find(l => l.id === v.assignedLotId);
        const freeSpace = v.capacity - v.currentVolume;

        let score = 50; // base score
        const reasons: string[] = [];
        const reasonsKa: string[] = [];

        // Check if destination has enough capacity for at least a significant portion
        if (freeSpace <= 0) return null;

        if (v.currentVolume === 0) {
          // Empty tank heuristics
          score += 10;
          reasons.push('Vessel is completely empty.');
          reasonsKa.push('ჭურჭელი სრულიად ცარიელია.');

          if (v.cleaningStatus === 'clean') {
            score += 15;
            reasons.push('Sanitized & Clean status.');
            reasonsKa.push('სუფთა და დეზინფიცირებული მდგომარეობა.');
          } else if (v.cleaningStatus === 'dirty') {
            score -= 20;
            reasons.push('Requires CIP sanitation before filling.');
            reasonsKa.push('ავსებამდე საჭიროებს CIP რეცხვას.');
          }

          // Volume capacity matching
          const fillRatio = sourceVessel.currentVolume / v.capacity;
          if (fillRatio > 1) {
            score -= 10;
            reasons.push(`Partial fill (requires splitting ${sourceVessel.currentVolume - v.capacity}L).`);
            reasonsKa.push(`ნაწილობრივი შევსება (საჭიროა ${sourceVessel.currentVolume - v.capacity}ლ-ის გაყოფა).`);
          } else {
            if (fillRatio >= 0.90 && fillRatio <= 0.98) {
              score += 25;
              reasons.push('Ideal capacity match (90-98% filled, minimizing oxidation headspace).');
              reasonsKa.push('იდეალური ტევადობა (90-98% შევსება, ჟანგვის მინიმალური რისკი).');
            } else if (fillRatio >= 0.70) {
              score += 15;
              reasons.push('Good capacity match (moderate fill level).');
              reasonsKa.push('კარგი ტევადობა (ზომიერი შევსების დონე).');
            } else {
              score -= 15;
              reasons.push(`High headspace / oxidation risk (${Math.round((1 - fillRatio)*100)}% empty space).`);
              reasonsKa.push(`ჟანგვის მაღალი რისკი (${Math.round((1 - fillRatio)*100)}% თავისუფალი სივრცე).`);
            }
          }
        } else {
          // Occupied tank: Blend/Consolidation heuristics
          if (sourceLot && lot) {
            if (sourceLot.id === lot.id) {
              score += 30;
              reasons.push('Identical Wine Lot (Direct consolidation blend).');
              reasonsKa.push('იდენტური ღვინის პარტია (პირდაპირი გაერთიანება).');
            } else if (sourceLot.variety === lot.variety && sourceLot.vintage === lot.vintage) {
              score += 20;
              reasons.push('Matching variety & vintage (assembly blend).');
              reasonsKa.push('თავსებადი ჯიში და მოსავლის წელი.');
            } else if (sourceLot.wineClass === lot.wineClass) {
              score += 5;
              reasons.push('Same wine class (requires assembly blend logic).');
              reasonsKa.push('ერთნაირი კლასის ღვინო (საჭიროებს ასამბლაჟის გაანგარიშებას).');
            } else {
              score -= 40;
              reasons.push('Incompatible class / variety mismatch.');
              reasonsKa.push('შეუთავსებელი ჯიში ან ღვინის კლასი.');
            }
          }

          if (sourceVessel.currentVolume > freeSpace) {
            score -= 15;
            reasons.push(`Insufficient headroom (can only receive ${freeSpace}L of ${sourceVessel.currentVolume}L).`);
            reasonsKa.push(`არასაკმარისი თავისუფალი ადგილი (ეტევა მხოლოდ ${freeSpace}ლ ${sourceVessel.currentVolume}ლ-დან).`);
          } else {
            score += 10;
            reasons.push('Total volume fits inside current headroom.');
            reasonsKa.push('სრული მოცულობა თავისუფლად ეტევა.');
          }
        }

        return {
          vessel: v,
          score: Math.max(0, Math.min(100, score)),
          reasons,
          reasonsKa
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);
  }, [sourceId, sourceVessel, vessels, lots]);

  const restrictedActionLabels = lang === 'ka'
    ? [
        !canExecuteTransfer && 'ტრანსფერის შესრულება',
        !canSanitizeVessels && 'ჭურჭლის სანიტარიზაცია',
        !canReverseTransfer && 'ტრანსფერის ჩანაწერის დაბრუნება',
      ].filter((label): label is string => Boolean(label))
    : [
        !canExecuteTransfer && 'initiate transfers',
        !canSanitizeVessels && 'sanitize vessels',
        !canReverseTransfer && 'reverse transfer records',
      ].filter((label): label is string => Boolean(label));
  const restrictedActionsText = lang === 'ka' || restrictedActionLabels.length < 2
    ? restrictedActionLabels.join(', ')
    : restrictedActionLabels.length === 2
      ? `${restrictedActionLabels[0]} or ${restrictedActionLabels[1]}`
      : `${restrictedActionLabels.slice(0, -1).join(', ')}, or ${restrictedActionLabels.at(-1)}`;
  const isTransferReadOnly = !canExecuteTransfer && !canSanitizeVessels && !canReverseTransfer;
  const reversalTarget = reversalTargetId
    ? pastTransfers.find(record => record.id === reversalTargetId)
    : pastTransfers.find(record => record.commandId === pendingReversalIntent?.payload.originalCommandId);

  return (
    <div className="space-y-6 text-stone-850">

      {/* Intro info box */}
      <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <Shuffle className="w-5 h-5 text-[#801323]" />
            {lang === 'ka' ? 'ღვინის გადაადგილებისა და კუპაჟირების პანელი' : 'Winery Liquid Movement & Pomace Blending Panel'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {lang === 'ka'
              ? 'შეასრულეთ ღვინის გადატანა, დეკანტაცია, ლექიდან მოხსნა და პროპორციული კუპაჟირება ავტომატური მოცულობითი გამოთვლებით.'
              : 'Perform wine transfers, barrel decantations, Lees rackings, and blend proportional genealogies accurately with automatic volumetric math.'}
          </p>
        </div>
      </div>

      {restrictedActionLabels.length > 0 && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-xs font-bold">
              {lang === 'ka'
                ? (isTransferReadOnly ? 'ტრანსფერებზე მხოლოდ ნახვის წვდომა' : 'ტრანსფერის მოქმედებები შეზღუდულია')
                : (isTransferReadOnly ? 'Read-only transfer access' : 'Limited transfer actions')}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-900">
              {lang === 'ka'
                ? `შეგიძლიათ ნახოთ რეკომენდაციები და გადაადგილების ისტორია, მაგრამ თქვენი როლი არ გაძლევთ უფლებას: ${restrictedActionsText}.`
                : `You can review recommendations and movement history, but your role cannot ${restrictedActionsText}.`}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-12 gap-6 items-start">

        {/* Left column: Visual Tank Selectors */}
        <div className="2xl:col-span-4 space-y-4">

          {/* Source Vessel selector */}
          <div className="bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs space-y-3">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-400 border-b border-stone-100 pb-2">
              {lang === 'ka' ? 'ნაბიჯი 1: საიდან' : 'Step 1: Select Source Vessel'}
            </h3>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {vessels.filter(v => v.currentVolume > 0).map(v => {
                const isSelected = sourceId === v.id;
                const lot = lots.find(l => l.id === v.assignedLotId);
                const percentFull = Math.round((v.currentVolume / v.capacity) * 100);

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      if (pendingIntent || isSubmitting) return;
                      setSourceId(v.id);
                      setTransferVol(v.currentVolume); // default to whole volume
                    }}
                    className={`p-3 border rounded-xl cursor-pointer hover:bg-stone-50 transition-all ${
                      isSelected
                        ? 'bg-[#4e0e15]/5 border-[#4e0e15] ring-2 ring-[#4e0e15]/10'
                        : 'bg-[#FAF8F5]/80 border-[#e8dfd5] hover:border-slate-350'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <strong className="text-xs font-sans text-stone-900">{v.id}</strong>
                      <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded font-black uppercase ${
                        v.cleaningStatus === 'dirty' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                      }`}>
                        🎨 {lang === 'ka' ? (v.cleaningStatus === 'dirty' ? 'ჭუჭყიანი' : v.cleaningStatus === 'cleaning_needed' ? 'გასაწმენდი' : 'სუფთა') : v.cleaningStatus}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 mt-0.5 font-semibold">
                      {lang === 'ka' ? 'პარტია' : 'Lot'}: <span className="text-stone-800 italic font-medium">{lot ? lot.name : (lang === 'ka' ? 'უცნობი პარტია' : 'Unknown lot')}</span>
                    </p>

                    {/* Progress Fill Bar */}
                    <div className="mt-2 text-[9px] text-slate-500 font-mono flex items-center justify-between">
                      <span>{lang === 'ka' ? 'მოცულობა' : 'Volume'}: {v.currentVolume} L / {v.capacity}L</span>
                      <span>{percentFull}% {lang === 'ka' ? 'სავსე' : 'Full'}</span>
                    </div>
                    <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden mt-1">
                      <div
                        className="bg-[#801323] h-full"
                        style={{ width: `${percentFull}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Destination Vessel Selector */}
          <div className="bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs space-y-3">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-400 border-b border-stone-100 pb-2">
              {lang === 'ka' ? 'ნაბიჯი 2: სად' : 'Step 2: Select Recipient Vessel'}
            </h3>
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {vessels.filter(v => v.id !== sourceId).map(v => {
                const isSelected = destId === v.id;
                const lot = lots.find(l => l.id === v.assignedLotId);
                const freeSpace = v.capacity - v.currentVolume;
                const percentFull = Math.round((v.currentVolume / v.capacity) * 100);

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      if (pendingIntent || isSubmitting) return;
                      setDestId(v.id);
                    }}
                    className={`p-3 border rounded-xl cursor-pointer hover:bg-stone-50 transition-all ${
                      isSelected
                        ? 'bg-[#4e0e15]/5 border-[#4e0e15] ring-2 ring-[#4e0e15]/10'
                        : 'bg-[#FAF8F5]/80 border-[#e8dfd5] hover:border-slate-350'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <strong className="text-xs font-sans text-stone-900">{v.id}</strong>
                      <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded font-black uppercase ${
                        v.cleaningStatus === 'dirty' ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                      }`}>
                        ⚙ {lang === 'ka' ? (v.cleaningStatus === 'dirty' ? 'ჭუჭყიანი' : v.cleaningStatus === 'cleaning_needed' ? 'გასაწმენდი' : 'სუფთა') : v.cleaningStatus}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 mt-0.5 font-semibold">
                      {lang === 'ka' ? 'პარტია' : 'Lot occupied'}: <span className="text-stone-800 italic font-medium">{lot ? lot.name : (lang === 'ka' ? 'ცარიელი / სუფთა ჭურჭელი' : 'Empty / Clean vessel')}</span>
                    </p>

                    {/* Headroom fill info */}
                    <div className="mt-2 text-[9px] text-slate-505 font-mono flex items-center justify-between">
                      <span>{lang === 'ka' ? `თავისუფალი: ${freeSpace} ლ` : `Headroom: ${freeSpace} L free space`}</span>
                      <span>{percentFull}% {lang === 'ka' ? 'სავსე' : 'Full'}</span>
                    </div>
                    <div className="w-full bg-stone-200 h-1.5 rounded-full overflow-hidden mt-1">
                      <div
                        className="bg-sky-600 h-full"
                        style={{ width: `${percentFull}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick sanitization list */}
          {canSanitizeVessels && (
            <div className="bg-amber-50/50 p-4 border border-[#e8dfd5] rounded-xl space-y-2">
            <h4 className="text-[10px] font-mono font-bold uppercase text-amber-955 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-amber-600 animate-spin" />
              {lang === 'ka' ? 'სწრაფი სანიტარული კონტროლი' : 'Quick Sanitization Controls'}
            </h4>
            <p className="text-[10px] text-amber-900/80 leading-relaxed font-serif">
              {lang === 'ka' ? 'დაუყოვნებლივ გაწმინდეთ და გაასტერილეთ ცარიელი ჭურჭელი, რომ ღვინის შესანახად მზად იყოს.' : 'Immediately clean and sterilize empty tanks so they are ready for wine storage.'}
            </p>
            <div className="space-y-2 mt-2">
              {vessels.filter(v => v.currentVolume === 0 && (v.cleaningStatus === 'dirty' || v.cleaningStatus === 'clean')).map(v => (
                <div key={v.id} className="text-xs font-semibold bg-white p-2 border border-slate-205 rounded-lg flex items-center justify-between">
                  <span>{v.id} ({lang === 'ka' ? (v.cleaningStatus === 'dirty' ? 'ჭუჭყიანი' : 'სუფთა') : v.cleaningStatus})</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleSanitizeVessel(v.id, 'clean')}
                      className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-300 rounded text-[9px] font-bold hover:bg-emerald-100"
                    >
                      {lang === 'ka' ? 'გაწმენდა' : 'Clean'}
                    </button>
                    <button
                      onClick={() => handleSanitizeVessel(v.id, 'sterilized')}
                      className="px-2 py-0.5 bg-blue-50 text-blue-800 border border-blue-350 rounded text-[9px] font-bold hover:bg-blue-105"
                    >
                      {lang === 'ka' ? 'სტერილიზაცია' : 'Sterilize'}
                    </button>
                  </div>
                </div>
              ))}
              {vessels.filter(v => v.currentVolume === 0 && (v.cleaningStatus === 'dirty' || v.cleaningStatus === 'clean')).length === 0 && (
                <p className="text-[10px] text-slate-400 italic text-center p-2">{lang === 'ka' ? 'ყველა ცარიელი ჭურჭელი უკვე სუფთა ან სტერილურია!' : 'All empty tanks are already clean or sterilized!'}</p>
              )}
            </div>
            </div>
          )}

        </div>

        {/* Right Columns: Racking Form, Safety Checklist & Predictions */}
        <div className="2xl:col-span-8 space-y-6">

          {/* 🔮 SMART TRANSFER ADVISOR */}
          <div className="bg-[#FAF8F5] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-850 rounded-xl p-4 space-y-3.5 shadow-2xs relative overflow-hidden text-stone-850 dark:text-stone-100">
            <div className="absolute -right-6 -bottom-6 text-4xl opacity-[0.06] select-none pointer-events-none">🔮</div>

            <div className="flex items-center justify-between border-b border-[#e8dfd5]/60 dark:border-stone-800 pb-2">
              <h3 className="text-xs font-serif font-black text-[#4e0e15] dark:text-amber-150 flex items-center gap-1.5 uppercase">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                {lang === 'ka' ? 'ღვინის გადატანის ჭკვიანი მრჩეველი' : 'AI Cellar Transfer Recommender'}
              </h3>
              <span className="text-[9px] font-mono text-amber-700 dark:text-amber-455 font-extrabold bg-amber-50 dark:bg-[#140d0e] px-2 py-0.5 rounded border border-amber-200 dark:border-stone-800">
                {sourceId ? (lang === 'ka' ? 'თავსებადი ჭურჭელი' : 'BEST DESTINATIONS') : (lang === 'ka' ? 'გეგმიური ოპერაციები' : 'RECOMMENDED OPERATIONS')}
              </span>
            </div>

            {!sourceId ? (
              /* Idle Recommendations */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {globalRecommendations.map((rec) => (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => {
                      if (pendingIntent || isSubmitting) return;
                      setSourceId(rec.sourceId);
                      setDestId(rec.destId);
                      setTransferVol(rec.volume);
                    }}
                    className="p-3 bg-white hover:bg-stone-50 dark:bg-[#140d0e] dark:hover:bg-stone-950 border border-[#e8dfd5] dark:border-stone-800 hover:border-[#801323] dark:hover:border-amber-400 rounded-xl text-left transition-all cursor-pointer shadow-3xs flex flex-col justify-between space-y-2 h-full group"
                  >
                    <div className="space-y-1 w-full text-left">
                      <div className="flex justify-between items-center w-full">
                        <span className="text-[8.5px] font-mono font-black text-[#801323] dark:text-amber-400 uppercase bg-rose-50 dark:bg-stone-900 border border-rose-100 dark:border-stone-800 px-2 py-0.5 rounded">
                          {lang === 'ka' ? rec.badgeKa : rec.badge}
                        </span>
                        <span className="text-[9px] text-slate-400 font-bold font-mono group-hover:text-[#801323]">
                          {canExecuteTransfer
                            ? (lang === 'ka' ? 'ავტოშევსება ⚡' : 'Autofill ⚡')
                            : (lang === 'ka' ? 'ნახვა' : 'Review')}
                        </span>
                      </div>
                      <h4 className="text-[11px] font-bold text-stone-900 dark:text-amber-100 leading-tight">
                        {lang === 'ka' ? rec.titleKa : rec.title}
                      </h4>
                      <p className="text-[10px] text-slate-500 dark:text-stone-455 leading-relaxed font-serif">
                        {lang === 'ka' ? rec.descKa : rec.desc}
                      </p>
                    </div>
                    <div className="pt-2 border-t border-stone-100 dark:border-stone-800 w-full flex justify-between items-center text-[9px] font-mono font-bold text-stone-700 dark:text-stone-300">
                      <span>{rec.sourceId}</span>
                      <ArrowRight className="w-3 h-3 text-slate-400" />
                      <span>{rec.destId}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              /* Contextual Destination Scores */
              <div className="space-y-2.5">
                <p className="text-[10.5px] text-slate-550 dark:text-stone-400 italic leading-normal text-left font-medium">
                  {lang === 'ka'
                    ? `მონაცემების ანალიზი ჭურჭლისთვის ${sourceId} (${sourceVessel?.currentVolume}ლ). აირჩიეთ სად გადავიტანოთ მაღალი თავსებადობით:`
                    : `Analyzing best recipients for ${sourceId} holding ${sourceVessel?.currentVolume}L. Select a recommended destination:`}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {destinationScores.slice(0, 4).map(({ vessel, score, reasons, reasonsKa }) => {
                    const isSelected = destId === vessel.id;
                    const scoreColor = score >= 80 ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200' :
                                       score >= 50 ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200' :
                                       'text-rose-600 bg-rose-50 dark:bg-rose-950/20 border-rose-200';

                    return (
                      <button
                        key={vessel.id}
                        type="button"
                        onClick={() => {
                          if (pendingIntent || isSubmitting) return;
                          setDestId(vessel.id);
                        }}
                        className={`p-3 bg-white hover:bg-stone-50 dark:bg-[#140d0e] dark:hover:bg-stone-950 border rounded-xl text-left transition-all cursor-pointer shadow-3xs flex flex-col justify-between h-full group ${
                          isSelected
                            ? 'border-[#4e0e15] dark:border-amber-450 ring-2 ring-[#4e0e15]/10 dark:ring-amber-400/10'
                            : 'border-[#e8dfd5] dark:border-stone-800 hover:border-slate-350'
                        }`}
                      >
                        <div className="space-y-2 w-full text-left">
                          <div className="flex justify-between items-center w-full">
                            <strong className="text-xs font-sans text-stone-900 dark:text-amber-100">{vessel.id}</strong>
                            <span className={`text-[10px] font-mono font-black px-2 py-0.5 rounded border uppercase ${scoreColor}`}>
                              {score}% {lang === 'ka' ? 'თავსებადობა' : 'Match'}
                            </span>
                          </div>

                          <div className="space-y-1">
                            {(lang === 'ka' ? reasonsKa : reasons).slice(0, 2).map((reason, idx) => (
                              <div key={idx} className="flex items-start gap-1 text-[9.5px] leading-relaxed text-stone-600 dark:text-stone-400 font-serif">
                                <span className="text-amber-600">•</span>
                                <span>{reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="pt-2.5 mt-2 border-t border-stone-100 dark:border-stone-800 w-full flex justify-between items-center text-[9px] font-mono font-semibold text-slate-400">
                          <span>{lang === 'ka' ? 'ტევადობა' : 'Cap'}: {vessel.capacity}L</span>
                          <span>{vessel.capacity - vessel.currentVolume}L {lang === 'ka' ? 'თავისუფალი' : 'free'}</span>
                        </div>
                      </button>
                    );
                  })}
                  {destinationScores.length === 0 && (
                    <p className="col-span-2 text-xs text-stone-400 dark:text-stone-550 italic text-center py-4">
                      {lang === 'ka' ? 'თავსებადი ჭურჭელი არ მოიძებნა. გთხოვთ გაათავისუფლოთ ან გარეცხოთ ჭურჭელი.' : 'No compatible recipient vessels found with remaining headroom.'}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-12 gap-6 items-start">

            {/* Controller main inputs */}
            {canExecuteTransfer && (
              <div className="2xl:col-span-7 bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
              <h3 className="text-sm font-serif font-bold text-[#4e0e15] border-b pb-2 flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-[#801323]" /> {lang === 'ka' ? 'გადატანისა და კუპაჟირების ფორმა' : 'Racking & Blending Form'}
              </h3>

              <form onSubmit={handleExecuteTransfer} className="space-y-3.5">

                {/* Visual arrow indicator or active selected summary */}
                <div className="p-3 bg-stone-50 border border-stone-200/50 rounded-xl flex items-center justify-center gap-4 text-xs font-semibold">
                  <div className="text-center flex-1">
                    <span className="block text-[8px] font-mono text-slate-400 uppercase">{lang === 'ka' ? 'საიდან' : 'SOURCE'}</span>
                    <strong className="text-stone-904">{sourceId || (lang === 'ka' ? 'საიდან' : 'Choose Source')}</strong>
                    <span className="block text-[9px] text-amber-900 font-mono mt-0.5">
                      {sourceVessel ? `${sourceVessel.currentVolume} L` : ''}
                    </span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-400 animate-pulse" />
                  <div className="text-center flex-1 font-sans">
                    <span className="block text-[8px] font-mono text-slate-400 uppercase">{lang === 'ka' ? 'სად' : 'RECIPIENT'}</span>
                    <strong className="text-slate-700">{destId || (lang === 'ka' ? 'სად' : 'Choose Destination')}</strong>
                    <span className="block text-[9px] text-indigo-805 font-mono mt-0.5">
                      {destVessel ? `${destCapRemaining} L ${lang === 'ka' ? 'თავისუფალი' : 'free'}` : ''}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">{lang === 'ka' ? 'გადასატანი მოცულობა (ლიტრი)' : 'Volume to Move (Liters)'}</label>
                    <input
                      type="number"
                      required
                      disabled={Boolean(pendingIntent) || isSubmitting}
                      value={transferVol}
                      onChange={(e) => setTransferVol(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded font-mono outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">{lang === 'ka' ? 'დანაკარგის დაშვება (ლ)' : 'Racking Loss Allowance (L)'}</label>
                    <input
                      type="number"
                      required
                      disabled={Boolean(pendingIntent) || isSubmitting}
                      value={lossVol}
                      onChange={(e) => setLossVol(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded font-mono outline-none"
                    />
                  </div>
                </div>

                {(lossIsInvalid || destinationNeedsCleaning) && !pendingIntent && (
                  <p role="alert" className="rounded-lg border border-amber-250 bg-amber-50 px-3 py-2 text-[10px] font-medium text-amber-950">
                    {destinationNeedsCleaning
                      ? (lang === 'ka'
                        ? 'ცარიელი მიმღები ჭურჭელი ღვინის მიღებამდე უნდა გაიწმინდოს.'
                        : 'The empty destination vessel must be cleaned before it can receive wine.')
                      : (lang === 'ka'
                        ? 'დანაკარგი უნდა იყოს არაუარყოფითი და გადასატან მოცულობაზე ნაკლები.'
                        : 'Process loss must be non-negative and smaller than the transferred volume.')}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">{lang === 'ka' ? 'ტუმბოს მოდელი / შლანგის ნიშანი' : 'Pump Model / Hose Tag'}</label>
                    <input
                      type="text"
                      required
                      disabled={Boolean(pendingIntent) || isSubmitting}
                      value={pumpModel}
                      onChange={(e) => setPumpModel(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">{lang === 'ka' ? 'ოპერაციის კატეგორია' : 'Operation Category'}</label>
                    <select
                      disabled={Boolean(pendingIntent) || isSubmitting}
                      value={reasonCategory}
                      onChange={(e) => setReasonCategory(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded outline-none cursor-pointer"
                    >
                      <option value="racking">{lang === 'ka' ? 'დეკანტაცია / ლექიდან მოხსნა' : 'Decantation / Racking lees'}</option>
                      <option value="blend">{lang === 'ka' ? 'კუპაჟირება' : 'Cuvée Assembly blending'}</option>
                      <option value="filtration">{lang === 'ka' ? 'ფილტრაცია' : 'Filtration Loop'}</option>
                      <option value="bottling">{lang === 'ka' ? 'ჩამოსხმისწინა ჩატვირთვა' : 'Pre-bottling tank load'}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">{lang === 'ka' ? 'პასუხისმგებელი მეღვინე *' : 'Responsible Cellar Master *'}</label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(pendingIntent) || isSubmitting}
                    placeholder={lang === 'ka' ? 'მაგ. ნ. გელაშვილი' : 'e.g. S. Rossi'}
                    value={operatorName}
                    onChange={(e) => setOperatorName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-205 rounded outline-none font-medium"
                  />
                </div>

                {canConsumeTransferMaterials && (
                  <OperationMaterialsEditor
                    lang={lang}
                    inventory={inventory}
                    value={materialDrafts}
                    onChange={setMaterialDrafts}
                    operationType={reasonCategory === 'blend' ? 'blending' : reasonCategory}
                    lotVolumeL={destVessel ? destVessel.currentVolume + arrivalVolume : arrivalVolume}
                  />
                )}

                <button
                  type="submit"
                  disabled={isSubmitting || Boolean(pendingReversalIntent) || (!pendingIntent && (
                    sourceIsEmpty
                    || sourceHasInsufficient
                    || destWillOverflow
                    || lossIsInvalid
                    || destinationNeedsCleaning
                    || Boolean(transferMaterialIssue)
                    || !sourceId
                    || !destId
                  ))}
                  className="w-full py-2 bg-[#4e0e15] text-white hover:bg-[#6b151e] shadow-xs text-xs font-bold rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmitting
                    ? (lang === 'ka' ? 'მუშავდება…' : 'Processing…')
                    : pendingIntent
                      ? (lang === 'ka' ? 'იგივე ბრძანების უსაფრთხოდ აღდგენა' : 'Recover the same transfer safely')
                      : (lang === 'ka' ? 'დადასტურება და გადატანის დაწყება' : 'Confirm & Initiate Fluid Pump')}
                </button>

              </form>

              {operationReceipt && (
                <div className="mt-4 p-3.5 bg-emerald-50 border border-emerald-250 rounded-xl flex items-center gap-2 text-emerald-950 text-xs">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="font-serif font-medium">{operationReceipt}</span>
                </div>
              )}

              {commandError && (
                <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                  {commandError}
                </div>
              )}

              </div>
            )}

            {/* Safety parameters & Blending calculations panel */}
            <div className={`${canExecuteTransfer ? '2xl:col-span-5' : '2xl:col-span-12'} space-y-4`}>

              <div className="bg-[#FAF8F5] p-4 border border-stone-200 rounded-xl space-y-4">
                <h4 className="text-xs font-mono font-bold uppercase text-stone-700 tracking-wider">{lang === 'ka' ? 'უსაფრთხოებისა და თავსებადობის შემოწმება' : 'Safety & Compatibility Check'}</h4>

                <div className="space-y-3">
                  {/* Liquid verification block */}
                  <div className="flex items-start gap-2.5 text-xs leading-tight">
                    <div className={`p-0.5 rounded-full shrink-0 ${sourceId && !sourceIsEmpty ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {sourceId && !sourceIsEmpty ? <Check className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <span className="font-bold block text-stone-900">{lang === 'ka' ? 'წყაროს მოცულობის შემოწმება' : 'Source Headroom Check'}</span>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {sourceVessel
                          ? (lang === 'ka' ? `${sourceVessel.id} უსაფრთხოდ იტევს ${sourceVessel.currentVolume} ლ-ს.` : `${sourceVessel.id} shares ${sourceVessel.currentVolume} L volume safely.`)
                          : (lang === 'ka' ? 'გთხოვთ აირჩიოთ, საიდან გადავიტანოთ.' : 'Please configure source.')}
                      </p>
                    </div>
                  </div>

                  {/* Free capacity block */}
                  <div className="flex items-start gap-2.5 text-xs leading-tight">
                    <div className={`p-0.5 rounded-full shrink-0 ${destId && !destWillOverflow ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {destId && !destWillOverflow ? <Check className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    </div>
                    <div>
                      <span className="font-bold block text-[#4e0e15]">{lang === 'ka' ? 'თავისუფალი მოცულობის შემოწმება' : 'Headroom Check'}</span>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {destVessel
                          ? (lang === 'ka' ? `${destVessel.id}-ს აქვს ${destCapRemaining} ლ თავისუფალი ტევადობა.` : `${destVessel.id} supports up to ${destCapRemaining} L empty capacity.`)
                          : (lang === 'ka' ? 'გთხოვთ აირჩიოთ, სად გადავიტანოთ.' : 'Please configure receiver.')}
                      </p>
                    </div>
                  </div>

                  {/* Micro blend analysis predictions weighted by volume */}
                  {showsBlendAlert && predictedBlend && (
                    <div className="p-3 bg-amber-50 border border-amber-250 rounded-xl space-y-2">
                      <h5 className="text-[10px] font-mono font-bold text-amber-900 flex items-center gap-1.5 uppercase">
                        <Activity className="w-3.5 h-3.5 text-amber-700 animate-spin" />
                        {lang === 'ka' ? 'კუპაჟის შეწონილი პროგნოზი' : 'Weighted Blend Predictions'}
                      </h5>
                      <div className="space-y-1 font-mono text-[10.5px] leading-relaxed text-amber-950 font-semibold">
                        <div className="flex justify-between">
                          <span>{lang === 'ka' ? 'კუპაჟის პროპორციები:' : 'Blending proportions:'}</span>
                          <span className="text-[#801323]">{lang === 'ka' ? 'პარტიების შერწყმა' : 'Lot Merge'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{lang === 'ka' ? 'სავარ. ალკოჰოლი:' : 'Est. Blended Alcohol:'}</span>
                          <span className="border-b border-dashed">{predictedBlend.abv} % ABV</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{lang === 'ka' ? 'სავარ. pH:' : 'Est. Blended pH:'}</span>
                          <span className="border-b border-dashed">{predictedBlend.ph} pH</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{lang === 'ka' ? 'სავარ. თავისუფალი SO2:' : 'Est. Blended Free SO2:'}</span>
                          <span>{predictedBlend.so2} mg/L (ppm)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {!showsBlendAlert && sourceId && destId && (
                    <div className="p-2 bg-emerald-50/50 border border-emerald-100 rounded-lg text-[10.5px] text-emerald-900 leading-tight flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      {lang === 'ka' ? 'თავსებადი ღვინის პარტიები! პირდაპირი გადატანა კუპაჟირების გამოთვლების გარეშე.' : 'Compatible Wine Lots! Direct transfer without dynamic blending calculations in genealogy.'}
                    </div>
                  )}

                </div>
              </div>

            </div>

          </div>

          {/* Append-only movement ledger with command-owned corrections */}
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-xs space-y-3 text-stone-850">
            <h3 className="text-sm font-serif font-bold text-stone-900 border-b border-stone-100 pb-2 flex items-center justify-between">
              <span>{lang === 'ka' ? 'გადაადგილებების ჟურნალი' : 'Winery Translocation Movement Logs Ledger'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono bg-[#FAF8F5] border font-bold text-slate-400">{pastTransfers.length} {lang === 'ka' ? 'ჩანაწერი' : 'Recorded'}</span>
            </h3>

            {reversalTarget && (
              <form
                onSubmit={handleReverseTransfer}
                className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-rose-950">
                      {lang === 'ka'
                        ? `გადატანის დაბრუნება: ${reversalTarget.id}`
                        : `Reverse transfer ${reversalTarget.id}`}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-rose-800">
                      {lang === 'ka'
                        ? 'სისტემა აღადგენს ჭურჭლებსა და პარტიებს მხოლოდ მაშინ, თუ ამ გადატანის შემდეგ ისინი არ შეცვლილა. საწყისი ჩანაწერი ისტორიაში დარჩება.'
                        : 'Vessels and lots are restored only if nothing changed them after this transfer. The original entry remains in the audit ledger.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(pendingReversalIntent) || isReversing}
                    onClick={clearReversalForm}
                    aria-label={lang === 'ka' ? 'დახურვა' : 'Close reversal form'}
                    className="rounded p-1 text-rose-500 hover:bg-rose-100 disabled:opacity-40"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <label className="block text-[11px] font-bold text-rose-950">
                  {lang === 'ka' ? 'დაბრუნების მიზეზი' : 'Correction reason'}
                  <textarea
                    required
                    maxLength={500}
                    disabled={Boolean(pendingReversalIntent) || isReversing}
                    value={reversalReason}
                    onChange={event => setReversalReason(event.target.value)}
                    placeholder={lang === 'ka'
                      ? 'მაგ. არასწორი ჭურჭელი იყო არჩეული'
                      : 'Example: the wrong destination vessel was selected'}
                    className="mt-1 min-h-20 w-full resize-y rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-normal text-stone-900 outline-none focus:border-rose-500 disabled:bg-rose-100/50"
                  />
                </label>
                <button
                  type="submit"
                  disabled={isReversing || !reversalReason.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-rose-800 px-3 py-2 text-xs font-bold text-white hover:bg-rose-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isReversing ? 'animate-spin' : ''}`} />
                  {isReversing
                    ? (lang === 'ka' ? 'ბრუნდება…' : 'Reversing…')
                    : pendingReversalIntent
                      ? (lang === 'ka' ? 'იგივე ბრძანების აღდგენა' : 'Recover same command')
                      : (lang === 'ka' ? 'მაკორექტირებელი დაბრუნება' : 'Post reversal correction')}
                </button>
              </form>
            )}

            <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
              {pastTransfers.map(record => (
                <div key={record.id} className={`p-3.5 bg-[#FAF8F5] border hover:border-slate-350 transition-color rounded-xl flex flex-col justify-between md:flex-row gap-3 items-start md:items-center ${reversalTargetId === record.id ? 'border-rose-400 ring-1 ring-rose-200' : 'border-stone-200'}`}>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-bold text-[#801323] uppercase bg-red-50 px-1.5 py-0.2 rounded">
                        {lang === 'ka'
                          ? ({racking: 'გადატანა', blend: 'კუპაჟი', filtration: 'ფილტრაცია', bottling: 'ჩამოსხმა', reversal: 'კორექცია'} as Record<string, string>)[record.category] || record.category
                          : record.category}
                      </span>
                      <span className="font-sans font-black text-xs text-stone-900 flex items-center gap-1">
                        <strong>{record.sourceId}</strong>
                        <ArrowRight className="w-3.5 h-3.5 text-stone-405 text-slate-400" />
                        <strong>{record.destId}</strong>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">({record.date})</span>
                    </div>

                    <p className="text-[11px] text-stone-605 font-medium leading-relaxed font-serif text-slate-600">
                      {lang === 'ka'
                        ? <>გადატანილია <strong className="text-stone-900">{record.volume} ლიტრი</strong>. დანაკარგის დაშვება: {record.loss}ლ (ტუმბო: {record.pump}).</>
                        : <>Moved <strong className="text-stone-900">{record.volume} Liters</strong>. loss allowance: {record.loss}L (Racked with {record.pump}).</>}
                    </p>

                    <p className="text-[11px] text-emerald-900 font-serif italic border-l-2 border-emerald-250 pl-2">
                      &quot;{record.details}&quot;
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {record.operator}
                    </span>
                    {record.recordKind === 'reversal' ? (
                      <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-1 text-[9px] font-bold text-violet-800">
                        <RotateCcw className="h-3.5 w-3.5" />
                        {lang === 'ka' ? 'კორექცია' : 'Correction'}
                      </span>
                    ) : record.reversedByCommandId ? (
                      <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-1 text-[9px] font-bold text-rose-900">
                        <RotateCcw className="h-3.5 w-3.5" />
                        {lang === 'ka' ? 'დაბრუნებული' : 'Reversed'}
                      </span>
                    ) : record.commandId ? (
                      <>
                      <span
                        title={lang === 'ka' ? 'ატომურად ჩაწერილი ოპერაცია' : 'Atomically recorded operation'}
                        className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-1 text-[9px] font-bold text-emerald-800"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {lang === 'ka' ? 'დაცული' : 'Protected'}
                      </span>
                      {canReverseTransfer && record.reversalSnapshot && (
                      <button
                        type="button"
                        disabled={Boolean(pendingReversalIntent) || Boolean(pendingIntent) || isReversing}
                        title={lang === 'ka' ? 'მაკორექტირებელი დაბრუნება' : 'Post a reversal correction'}
                        onClick={() => {
                          setReversalTargetId(record.id);
                          setReversalReason('');
                          setCommandError(null);
                        }}
                        className="rounded p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      )}
                      </>
                    ) : (
                      <span className="rounded bg-stone-200 px-1.5 py-1 text-[9px] font-bold text-stone-600">
                        {lang === 'ka' ? 'ძველი ჩანაწერი' : 'Legacy read-only'}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {pastTransfers.length === 0 && (
                <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-stone-200 rounded-2xl bg-stone-50/50 dark:bg-stone-900/20 dark:border-stone-850">
                  <svg className="w-16 h-16 text-stone-300 dark:text-stone-700 mb-4 stroke-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <circle cx="12" cy="12" r="10" strokeDasharray="4 4" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8m-8 4h8m-8 4h5" />
                    <path d="M17 13l4 4m0 0l-4 4m4-4H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <h4 className="text-xs font-bold text-stone-700 dark:text-stone-300 uppercase tracking-wider font-mono">
                    {lang === 'ka' ? 'ტრანსფერები არ არის ჩაწერილი' : 'No transfers recorded'}
                  </h4>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400 font-serif max-w-xs mt-1.5 leading-relaxed">
                    {lang === 'ka'
                      ? 'მარანში სითხის გადატანის ან ბლენდირების ჟურნალი ჯერ არ დაწყებულა. ჯერ დაარეგისტრირეთ ჭურჭელი და მიიღეთ ყურძენი — შემდეგ აქ დააფიქსირებთ გადატანას ჭურჭლიდან ჭურჭელში.'
                      : 'Liquid transfer, racking, and blending operations will appear here in chronological order. Register vessels and receive grapes first — then record vessel-to-vessel movements from the form above.'}
                  </p>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
