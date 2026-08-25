import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Grape, Droplets, FlaskConical, Thermometer, RefreshCw, ArrowDownToLine,
  ArrowRightLeft, Combine, ShieldCheck, Beaker, Filter, Snowflake, Container,
  Package, Sparkles, Wrench, Plus, CheckCircle2, ClipboardList, AlertTriangle,
  RotateCcw, X,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  WineLot,
  Vessel,
  InventoryItem,
  CellarOperation,
  CellarOperationType,
  MaraniOSAuditLog,
} from '../lib/wineryState';
import { CELLAR_OPERATIONS, QUICK_CELLAR_OPERATIONS } from '../lib/wineryOperations';
import {
  automaticOperationCostEntries,
  operationCostProfile,
  resolveCostAutomationSettings,
  type CostEntry,
} from '../lib/costing';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyCellarOperationCommand,
  type CellarOperationCommandPayload,
  type CellarOperationInput,
} from '../lib/commands/cellarOperation';
import type { CellarOperationReversalCommandPayload } from '../lib/commands/cellarOperationReversal';
import { isActiveCellarOperation } from '../lib/cellarOperationIntegrity';
import {
  CommandRequestError,
  createCellarOperationCommandIntent,
  createCellarOperationReversalCommandIntent,
  pendingCellarOperationCommandIntent,
  pendingCellarOperationReversalCommandIntent,
  submitCellarOperationCommand,
  submitCellarOperationReversalCommand,
  type CellarOperationCommandResponse,
} from '../lib/commands/client';
import { useFormDraft } from '../hooks/useFormDraft';
import OperationMaterialsEditor, {
  materialDraftIssue,
  materialDraftsToUsages,
  materialUsagesToDrafts,
  type MaterialUsageDraft,
} from './OperationMaterialsEditor';
import DateInput from './ui/DateInput';

export type { CellarOperationInput } from '../lib/commands/cellarOperation';

export interface CellarOperationMutationAccess {
  canLogCellarOperation: boolean;
  canUseOperationVessels: boolean;
  canConsumeOperationMaterials: boolean;
}

export interface LoggedOperationSummary {
  id: string;
  vesselId?: string | null;
}

/**
 * Keep the callback contract safe even if stale form state survives a role
 * change. A core operation always writes both cellarOps and the lot timeline;
 * vessel and material references opt into their additional collection writes.
 */
export function permittedCellarOperationInput(
  input: CellarOperationInput,
  access: CellarOperationMutationAccess,
): CellarOperationInput | null {
  if (!access.canLogCellarOperation) return null;

  return {
    ...input,
    vesselId: access.canUseOperationVessels ? input.vesselId : null,
    vesselToId: access.canUseOperationVessels ? input.vesselToId : null,
    materialId: access.canConsumeOperationMaterials ? input.materialId : undefined,
    dose: access.canConsumeOperationMaterials ? input.dose : undefined,
    materials: access.canConsumeOperationMaterials ? input.materials : undefined,
  };
}

interface Props {
  lang: Language;
  lots: WineLot[];
  vessels: Vessel[];
  inventory: InventoryItem[];
  ops: CellarOperation[];
  costEntries?: CostEntry[];
  auditLogs?: MaraniOSAuditLog[];
  currentUserName: string;
  currentUsername?: string;
  currency?: string;
  costAutomation?: unknown;
  onAddOperation: (input: CellarOperationInput) => string;
  onUpdateLots?: (lots: WineLot[]) => void;
  onUpdateVessels?: (vessels: Vessel[]) => void;
  onUpdateInventory?: (inventory: InventoryItem[]) => void;
  onUpdateOperations?: (operations: CellarOperation[]) => void;
  onUpdateCostEntries?: (entries: CostEntry[]) => void;
  onUpdateAuditLogs?: (logs: MaraniOSAuditLog[]) => void;
  onApplyCellarOperationCommandResponse?: (response: CellarOperationCommandResponse) => void;
  setToastMessage?: (m: string) => void;
  /** Requires operations:create + lots:update because every log updates both collections. */
  canLogCellarOperation?: boolean;
  /** Enables optional vessel context, which also updates the referenced vessel. */
  canUseOperationVessels?: boolean;
  /** Enables material consumption, which also updates inventory and may create a cost entry. */
  canConsumeOperationMaterials?: boolean;
  /** Enables append-only restoration across every operation ledger. */
  canReverseCellarOperation?: boolean;
  /** Vessel to preselect (QR scan / vessel-drawer quick action). Applied once. */
  prefillVesselId?: string;
  /** Optional operation selected from a vessel's contextual action panel. */
  prefillOperationType?: CellarOperationType;
  /** Vessel-originated operations reopen this vessel only after a successful command. */
  returnToVesselId?: string;
  onOperationLogged?: (operation: LoggedOperationSummary) => void;
  clearPrefill?: () => void;
  onNavigateWorkflow?: (tab: 'transfers' | 'bottling' | 'vessels') => void;
}

const OP_ICONS: Record<CellarOperationType, React.ComponentType<{ className?: string }>> = {
  crush_destem: Grape, pressing: Droplets, ferment_start: FlaskConical, measurement: Thermometer,
  pumpover: RefreshCw, punchdown: ArrowDownToLine, racking: ArrowRightLeft, blending: Combine,
  sulfitation: ShieldCheck, additive: Beaker, fining: Filter, filtration: Filter, stabilization: Snowflake,
  vessel_filling: Container, bottling: Package, cleaning: Sparkles, correction: Wrench, custom: Plus,
};

interface CellarOperationFormDraft {
  type: CellarOperationType;
  customLabel: string;
  lotId: string;
  vesselId: string;
  vesselToId: string;
  materialDrafts: MaterialUsageDraft[];
  volumeAfter: string;
  date: string;
  operator: string;
  notes: string;
  laborHours: string;
  energyKwh: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const catLabelForPreview = (category: CostEntry['category'], ka: boolean) => {
  if (category === 'labor') return ka ? 'შრომა' : 'Labor';
  if (category === 'energy') return ka ? 'ენერგია' : 'Energy';
  if (category === 'overhead') return ka ? 'ზედნადები' : 'Overhead';
  return category;
};

export function CellarOperationsTab({
  lang, lots, vessels, inventory, ops, costEntries = [], auditLogs = [], currentUserName,
  currentUsername = '',
  currency = 'GEL', costAutomation, onAddOperation, onUpdateLots, onUpdateVessels, onUpdateInventory,
  onUpdateOperations, onUpdateCostEntries, onUpdateAuditLogs,
  onApplyCellarOperationCommandResponse, setToastMessage,
  prefillVesselId, prefillOperationType, returnToVesselId, onOperationLogged, clearPrefill,
  onNavigateWorkflow,
  canLogCellarOperation = true,
  canUseOperationVessels = true,
  canConsumeOperationMaterials = true,
  canReverseCellarOperation = true,
}: Props) {
  const ka = lang === 'ka';
  const today = new Date().toISOString().slice(0, 10);
  const automationSettings = useMemo(
    () => resolveCostAutomationSettings(costAutomation),
    [costAutomation],
  );
  const initialCostProfile = operationCostProfile(automationSettings, 'measurement');

  const activeLots = useMemo(() => lots.filter(l => !l.voidedAt && l.stage !== 'sold'), [lots]);

  const [type, setType] = useState<CellarOperationType>('measurement');
  const [customLabel, setCustomLabel] = useState('');
  const [lotId, setLotId] = useState('');
  const [vesselId, setVesselId] = useState('');
  const [vesselToId, setVesselToId] = useState('');
  const [materialDrafts, setMaterialDrafts] = useState<MaterialUsageDraft[]>([]);
  const [volumeAfter, setVolumeAfter] = useState('');
  const [date, setDate] = useState(today);
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');
  const [laborHours, setLaborHours] = useState(
    automationSettings.enabled ? String(initialCostProfile.laborHours) : '',
  );
  const [energyKwh, setEnergyKwh] = useState(
    automationSettings.enabled ? String(initialCostProfile.energyKwh) : '',
  );
  const [pendingIntent, setPendingIntent] = useState<PendingCommandIntent<CellarOperationCommandPayload> | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingReversalIntent, setPendingReversalIntent] = useState<PendingCommandIntent<CellarOperationReversalCommandPayload> | null>(null);
  const [reversalOperationId, setReversalOperationId] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  const meta = CELLAR_OPERATIONS.find(o => o.key === type)!;
  const lot = lots.find(l => l.id === lotId) || null;
  const lotVessels = useMemo(
    () => vessels.filter(vessel => vessel.assignedLotId === lotId),
    [lotId, vessels],
  );
  const lotAllocatedVolume = useMemo(
    () => lotVessels.reduce((sum, vessel) => sum + vessel.currentVolume, 0),
    [lotVessels],
  );
  const restoredInitialDraftRef = useRef(false);
  const skipRestoredLotDefaultsRef = useRef(false);
  const skipRestoredTypeDefaultsRef = useRef(false);
  const operationDraft = useMemo<CellarOperationFormDraft>(() => ({
    type,
    customLabel,
    lotId,
    vesselId,
    vesselToId,
    materialDrafts,
    volumeAfter,
    date,
    operator,
    notes,
    laborHours,
    energyKwh,
  }), [
    customLabel,
    date,
    energyKwh,
    laborHours,
    lotId,
    materialDrafts,
    notes,
    operator,
    type,
    vesselId,
    vesselToId,
    volumeAfter,
  ]);
  const restoreOperationDraft = React.useCallback((draft: CellarOperationFormDraft) => {
    restoredInitialDraftRef.current = true;
    skipRestoredLotDefaultsRef.current = true;
    skipRestoredTypeDefaultsRef.current = true;
    const restoredType = QUICK_CELLAR_OPERATIONS.some(operation => operation.key === draft.type)
      ? draft.type
      : 'measurement';
    setType(restoredType);
    setCustomLabel(draft.customLabel || '');
    setLotId(lots.some(item => item.id === draft.lotId) ? draft.lotId : '');
    setVesselId(vessels.some(item => item.id === draft.vesselId) ? draft.vesselId : '');
    setVesselToId(vessels.some(item => item.id === draft.vesselToId) ? draft.vesselToId : '');
    setMaterialDrafts(Array.isArray(draft.materialDrafts) ? draft.materialDrafts : []);
    setVolumeAfter(draft.volumeAfter || '');
    setDate(/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : today);
    setOperator(draft.operator || '');
    setNotes(draft.notes || '');
    const restoredProfile = operationCostProfile(automationSettings, restoredType);
    setLaborHours(draft.laborHours || (automationSettings.enabled ? String(restoredProfile.laborHours) : ''));
    setEnergyKwh(draft.energyKwh || (automationSettings.enabled ? String(restoredProfile.energyKwh) : ''));
  }, [automationSettings, lots, today, vessels]);
  const operationDraftIsMeaningful = React.useCallback((draft: CellarOperationFormDraft) => {
    const defaultLot = activeLots[0] || null;
    const defaultVessel = defaultLot
      ? vessels.find(item => item.assignedLotId === defaultLot.id)?.id || ''
      : '';
    const defaultProfile = operationCostProfile(automationSettings, draft.type);
    const defaultLabor = automationSettings.enabled ? String(defaultProfile.laborHours) : '';
    const defaultEnergy = automationSettings.enabled ? String(defaultProfile.energyKwh) : '';
    return Boolean(
      draft.type !== 'measurement'
      || draft.customLabel.trim()
      || (draft.lotId && draft.lotId !== defaultLot?.id)
      || (draft.vesselId && draft.vesselId !== defaultVessel)
      || draft.vesselToId
      || draft.materialDrafts.length
      || draft.volumeAfter
      || draft.date !== today
      || draft.operator.trim()
      || draft.notes.trim()
      || draft.laborHours !== defaultLabor
      || draft.energyKwh !== defaultEnergy,
    );
  }, [activeLots, automationSettings, today, vessels]);
  const {
    restored: operationDraftRestored,
    clear: clearOperationDraft,
  } = useFormDraft({
    formId: 'cellar-operation',
    userId: currentUsername,
    value: operationDraft,
    isMeaningful: operationDraftIsMeaningful,
    onRestore: restoreOperationDraft,
  });
  const restoreCapturedOperation = React.useCallback((input: CellarOperationInput) => {
    setType(input.type);
    setCustomLabel(input.customLabel || '');
    setLotId(input.lotId);
    setVesselId(input.vesselId || '');
    setVesselToId(input.vesselToId || '');
    setMaterialDrafts(materialUsagesToDrafts(
      input.materials?.length
        ? input.materials
        : input.materialId && input.dose
          ? [{ materialId: input.materialId, quantity: input.dose }]
          : [],
    ));
    setVolumeAfter(input.volumeAfterL != null ? String(input.volumeAfterL) : '');
    setDate(input.date);
    setOperator(input.operator);
    setNotes(input.notes || '');
    const restoredProfile = operationCostProfile(automationSettings, input.type);
    setLaborHours(input.laborHours != null
      ? String(input.laborHours)
      : automationSettings.enabled ? String(restoredProfile.laborHours) : '');
    setEnergyKwh(input.energyKwh != null
      ? String(input.energyKwh)
      : automationSettings.enabled ? String(restoredProfile.energyKwh) : '');
  }, [automationSettings]);

  useEffect(() => {
    const restored = pendingCellarOperationCommandIntent();
    if (!restored) return;
    setPendingIntent(restored);
    restoreCapturedOperation(restored.payload.operation);
    setCommandError(ka
      ? 'წინა ოპერაციის შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანება ხელახლა გაგზავნეთ.'
      : 'A previous cellar operation is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [ka, restoreCapturedOperation]);

  useEffect(() => {
    const restored = pendingCellarOperationReversalCommandIntent();
    if (!restored) return;
    const original = ops.find(item => item.commandId === restored.payload.originalCommandId);
    setPendingReversalIntent(restored);
    setReversalOperationId(original?.id || '');
    setReversalReason(restored.payload.reason);
    setCommandError(ka
      ? 'წინა ოპერაციის შესწორება ჯერ არ არის დადასტურებული. ხელახლა გაგზავნეთ იგივე შესწორება.'
      : 'A previous operation correction is not yet acknowledged. Resubmit the same correction safely.');
  }, [ka, ops]);

  // Default the batch to the first active lot.
  useEffect(() => {
    if (pendingCellarOperationCommandIntent()) return;
    if (restoredInitialDraftRef.current) return;
    if (!lotId && activeLots.length) setLotId(activeLots[0].id);
  }, [activeLots, lotId]);

  // Scanned / drawer-selected vessel: apply once, selecting its batch too.
  const prefillGuard = useRef(false);
  const prefillAppliedRef = useRef(false);
  useEffect(() => {
    if (pendingCellarOperationCommandIntent()) return;
    if (!prefillVesselId || prefillAppliedRef.current) return;
    const vessel = vessels.find(v => v.id === prefillVesselId);
    // Vessels hydrate asynchronously, so a scanned id cannot always be resolved
    // on first mount. Keep the prefill pending until they arrive rather than
    // clearing it — this effect re-runs when `vessels` lands.
    if (!vessel) return;
    prefillAppliedRef.current = true;
    prefillGuard.current = true;
    if (prefillOperationType && QUICK_CELLAR_OPERATIONS.some(operation => operation.key === prefillOperationType)) {
      setType(prefillOperationType);
    }
    setVesselId(vessel.id);
    if (vessel.assignedLotId && lots.some(l => l.id === vessel.assignedLotId)) {
      setLotId(vessel.assignedLotId);
    }
    clearPrefill?.();
  }, [prefillOperationType, prefillVesselId, vessels]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the batch changes, default the vessel to the one holding it and prefill volume.
  useEffect(() => {
    if (pendingCellarOperationCommandIntent()) return;
    if (skipRestoredLotDefaultsRef.current) {
      skipRestoredLotDefaultsRef.current = false;
      return;
    }
    if (!lot) return;
    if (prefillGuard.current) {
      // A scanned vessel was just applied — don't overwrite it (the vessel may
      // be empty and unrelated to the default batch).
      prefillGuard.current = false;
    } else {
      const holding = vessels.find(v => v.assignedLotId === lot.id);
      setVesselId(holding ? holding.id : '');
    }
    setVolumeAfter(meta.affectsVolume ? String(round1(lot.currentVolume)) : '');
  }, [lotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When switching to a volume op, seed the "after" field with the current volume.
  useEffect(() => {
    if (pendingCellarOperationCommandIntent()) return;
    if (skipRestoredTypeDefaultsRef.current) {
      skipRestoredTypeDefaultsRef.current = false;
      return;
    }
    if (meta.affectsVolume && lot && !volumeAfter) setVolumeAfter(String(round1(lot.currentVolume)));
    if (!meta.affectsVolume) setVolumeAfter('');
    if (!meta.needsVesselTo) setVesselToId('');
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const volNum = volumeAfter === '' ? null : parseFloat(volumeAfter);
  const overfill = meta.affectsVolume && lot != null && volNum != null && volNum > lot.currentVolume + 0.001
    && (type === 'pressing' || type === 'racking' || type === 'filtration' || type === 'bottling');
  const materialIssue = canConsumeOperationMaterials
    ? materialDraftIssue(materialDrafts, inventory)
    : null;
  const materials = canConsumeOperationMaterials
    ? materialDraftsToUsages(materialDrafts, inventory)
    : [];
  const laborHoursNum = laborHours === '' ? undefined : Number.parseFloat(laborHours);
  const energyKwhNum = energyKwh === '' ? undefined : Number.parseFloat(energyKwh);
  const materialCostTotal = materials.reduce((sum, usage) => {
    const item = inventory.find(candidate => candidate.id === usage.materialId);
    return sum + usage.quantity * (item?.costPerUnit || 0);
  }, 0);
  const automaticCostPreview = useMemo(() => automaticOperationCostEntries({
    operationId: 'preview',
    date,
    lotId: lot?.id || '',
    operationType: type,
    laborHours: laborHoursNum,
    energyKwh: energyKwhNum,
    materialCostTotal,
    currency,
    settings: automationSettings,
  }), [
    automationSettings,
    currency,
    date,
    energyKwhNum,
    laborHoursNum,
    lot?.id,
    materialCostTotal,
    type,
  ]);
  const automaticCostTotal = automaticCostPreview.reduce((sum, entry) => sum + entry.amount, 0);
  const laborHoursInvalid = automationSettings.enabled
    && (laborHoursNum === undefined || !Number.isFinite(laborHoursNum) || laborHoursNum < 0);
  const energyKwhInvalid = automationSettings.enabled
    && (energyKwhNum === undefined || !Number.isFinite(energyKwhNum) || energyKwhNum < 0);

  const customOk = type !== 'custom' || customLabel.trim().length > 0;
  const canSubmit = canLogCellarOperation && !!lot && customOk && !overfill && !materialIssue
    && !laborHoursInvalid && !energyKwhInvalid
    && !pendingIntent && !pendingReversalIntent && !isSubmitting && !isReversing;

  const selectOperationType = (nextType: CellarOperationType) => {
    setType(nextType);
    if (!automationSettings.enabled) return;
    const profile = operationCostProfile(automationSettings, nextType);
    setLaborHours(String(profile.laborHours));
    setEnergyKwh(String(profile.energyKwh));
  };

  const resetSoft = () => {
    setType('measurement');
    setCustomLabel('');
    setMaterialDrafts([]);
    setVesselToId('');
    setVolumeAfter('');
    setDate(today);
    setOperator('');
    setNotes('');
    const defaultProfile = operationCostProfile(automationSettings, 'measurement');
    setLaborHours(automationSettings.enabled ? String(defaultProfile.laborHours) : '');
    setEnergyKwh(automationSettings.enabled ? String(defaultProfile.energyKwh) : '');
  };

  const finishCommand = () => {
    setPendingIntent(null);
    setCommandError(null);
    clearOperationDraft();
    resetSoft();
  };

  const applyOperationLocally = (intent: PendingCommandIntent<CellarOperationCommandPayload>) => {
    const hasCommandBindings = Boolean(
      onUpdateLots && onUpdateVessels && onUpdateInventory && onUpdateOperations
      && onUpdateCostEntries && onUpdateAuditLogs,
    );
    if (!hasCommandBindings) {
      const operationId = onAddOperation(intent.payload.operation);
      setToastMessage?.(ka ? 'ოპერაცია აღირიცხა.' : 'Operation logged.');
      finishCommand();
      if (operationId) {
        onOperationLogged?.({ id: operationId, vesselId: intent.payload.operation.vesselId });
      }
      return;
    }

    const applied = applyCellarOperationCommand(
      { lots, vessels, inventory, cellarOps: ops, costEntries, auditLogs },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: currentUserName,
        currency,
        costAutomation,
        performedAt: new Date(intent.capturedAt),
      },
    );
    onUpdateLots?.(applied.state.lots);
    onUpdateVessels?.(applied.state.vessels);
    onUpdateInventory?.(applied.state.inventory);
    onUpdateOperations?.(applied.state.cellarOps);
    onUpdateCostEntries?.(applied.state.costEntries);
    onUpdateAuditLogs?.(applied.state.auditLogs);
    setToastMessage?.(ka
      ? `ოპერაცია აღირიცხა: ${applied.result.operation.lotName}`
      : `Operation logged: ${applied.result.operation.lotName}`);
    finishCommand();
    onOperationLogged?.(applied.result.operation);
  };

  const executeOperationCommand = async (intent: PendingCommandIntent<CellarOperationCommandPayload>) => {
    setCommandError(null);
    if (!onApplyCellarOperationCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        setCommandError(ka
          ? 'დაუდასტურებელი ოპერაციის აღდგენას ინტერნეტთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged cellar operation requires a server connection.');
        return;
      }
      try {
        applyOperationLocally(intent);
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Cellar operation validation failed.');
      }
      return;
    }

    setPendingIntent(intent);
    setIsSubmitting(true);
    try {
      const response = await submitCellarOperationCommand(intent);
      onApplyCellarOperationCommandResponse(response);
      setToastMessage?.(ka
        ? `ოპერაცია აღირიცხა: ${response.result.operation.lotName}`
        : `Operation logged: ${response.result.operation.lotName}`);
      finishCommand();
      onOperationLogged?.(response.result.operation);
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyOperationLocally(intent);
          return;
        } catch (fallbackError) {
          setCommandError(fallbackError instanceof Error
            ? fallbackError.message
            : 'Cellar operation validation failed.');
          setPendingIntent(null);
          return;
        }
      }
      setCommandError(error instanceof Error ? error.message : 'Cellar operation failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingIntent(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const reversalOperation = ops.find(item => item.id === reversalOperationId) || null;

  const applyReversalResponse = (
    response: Awaited<ReturnType<typeof submitCellarOperationReversalCommand>>,
  ) => {
    if (response.collections) {
      onUpdateLots?.(response.collections.lots);
      onUpdateVessels?.(response.collections.vessels);
      onUpdateInventory?.(response.collections.inventory);
      onUpdateOperations?.(response.collections.cellarOps);
      onUpdateCostEntries?.(response.collections.costEntries);
      onUpdateAuditLogs?.(response.collections.auditLogs);
      return;
    }
    const replaceById = <T extends { id: string }>(current: T[], changed: T[]) => {
      const changedById = new Map(changed.map(item => [item.id, item]));
      return [...changed, ...current.filter(item => !changedById.has(item.id))];
    };
    const result = response.result;
    onUpdateLots?.(replaceById(lots, [result.updatedLot]));
    if (result.updatedVessel) onUpdateVessels?.(replaceById(vessels, [result.updatedVessel]));
    const restoredInventory = result.updatedInventoryItems?.length
      ? result.updatedInventoryItems
      : result.updatedInventoryItem
        ? [result.updatedInventoryItem]
        : [];
    if (restoredInventory.length) {
      onUpdateInventory?.(replaceById(inventory, restoredInventory));
    }
    onUpdateOperations?.(replaceById(ops, [result.reversalOperation, result.originalOperation]));
    const reversalCosts = result.reversalCostEntries?.length
      ? result.reversalCostEntries
      : result.reversalCostEntry
        ? [result.reversalCostEntry]
        : [];
    const updatedOriginalCosts = result.updatedOriginalCostEntries?.length
      ? result.updatedOriginalCostEntries
      : result.updatedOriginalCostEntry
        ? [result.updatedOriginalCostEntry]
        : [];
    onUpdateCostEntries?.(replaceById(costEntries, [
      ...reversalCosts,
      ...updatedOriginalCosts,
    ]));
    onUpdateAuditLogs?.(replaceById(auditLogs, [result.auditLog]));
  };

  const handleReverseOperation = async () => {
    if (!canReverseCellarOperation || isReversing) return;
    const original = pendingReversalIntent
      ? ops.find(item => item.commandId === pendingReversalIntent.payload.originalCommandId)
      : reversalOperation;
    const reason = pendingReversalIntent?.payload.reason || reversalReason.trim();
    if (!original?.commandId || !reason) {
      setCommandError(ka ? 'შესწორების მიზეზი სავალდებულოა.' : 'A correction reason is required.');
      return;
    }
    if (!onApplyCellarOperationCommandResponse || !SyncQueueManager.isOnline()) {
      setCommandError(ka
        ? 'ოპერაციის შესწორებას სერვერთან კავშირი სჭირდება.'
        : 'Operation corrections require a server connection.');
      return;
    }
    const intent = pendingReversalIntent || createCellarOperationReversalCommandIntent({
      originalCommandId: original.commandId,
      reason,
    });
    setPendingReversalIntent(intent);
    setCommandError(null);
    setIsReversing(true);
    try {
      const response = await submitCellarOperationReversalCommand(intent);
      applyReversalResponse(response);
      setPendingReversalIntent(null);
      setReversalOperationId('');
      setReversalReason('');
      setToastMessage?.(ka
        ? 'ოპერაცია შესწორდა და დაკავშირებული რეესტრები აღდგა.'
        : 'Operation corrected and linked ledgers restored.');
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Cellar-operation reversal failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingReversalIntent(null);
    } finally {
      setIsReversing(false);
    }
  };

  const handleSubmit = () => {
    if (!canSubmit || !lot) return;
    const input = permittedCellarOperationInput({
      date,
      type,
      customLabel: type === 'custom' ? customLabel.trim() : undefined,
      lotId: lot.id,
      vesselId: vesselId || null,
      vesselToId: meta.needsVesselTo ? (vesselToId || null) : null,
      volumeAfterL: meta.affectsVolume && volNum != null ? volNum : undefined,
      materials: materials.length ? materials : undefined,
      laborHours: automationSettings.enabled ? laborHoursNum : undefined,
      energyKwh: automationSettings.enabled ? energyKwhNum : undefined,
      operator: operator.trim() || currentUserName,
      notes: notes.trim(),
    }, {
      canLogCellarOperation,
      canUseOperationVessels,
      canConsumeOperationMaterials,
    });
    if (!input) return;
    void executeOperationCommand(createCellarOperationCommandIntent(input));
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  const opLabel = (t: CellarOperationType, custom?: string) => {
    if (t === 'custom') return custom || (ka ? 'სხვა' : 'Custom');
    const m = CELLAR_OPERATIONS.find(o => o.key === t);
    return m ? (ka ? m.ka : m.en) : t;
  };

  return (
    <div className="space-y-4 animate-fade-in text-stone-800">
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold">
          {ka ? 'მარანი · ოპერაციები' : 'Cellar · Operations'}
        </span>
        <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
          <ClipboardList className="w-5 h-5 text-[#4e0e15]" />
          {ka ? 'სწრაფი ოპერაცია' : 'Quick Operation'}
        </h3>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900/60 dark:bg-sky-950/20">
        <p className="text-xs font-bold text-sky-950 dark:text-sky-100">
          {ka ? 'ფიზიკურ მოძრაობას თავისი სამუშაო პროცესი აქვს' : 'Physical movements use dedicated workflows'}
        </p>
        <p className="mt-0.5 text-[10px] font-semibold text-sky-800/80 dark:text-sky-200/80">
          {ka
            ? 'გადატანა/გადაღება, კუპაჟი და შევსება აღრიცხეთ გადატანებში; ჩამოსხმა — ჩამოსხმაში; რეცხვა და დეზინფექცია — ჭურჭლის სანიტარიაში.'
            : 'Record racking, blending and filling in Transfers; bottling in Bottling; washing and disinfection in Vessel sanitation.'}
        </p>
        {onNavigateWorkflow && (
          <div className="mt-2 flex flex-wrap gap-2">
            {([
              ['transfers', ArrowRightLeft, ka ? 'გადატანები' : 'Transfers'],
              ['bottling', Package, ka ? 'ჩამოსხმა' : 'Bottling'],
              ['vessels', Sparkles, ka ? 'სანიტარია' : 'Sanitation'],
            ] as const).map(([tab, Icon, label]) => (
              <button key={tab} type="button" onClick={() => onNavigateWorkflow(tab)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-sky-900 hover:border-sky-400 dark:border-sky-800 dark:bg-stone-900 dark:text-sky-100">
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!canLogCellarOperation && (
        <div role="status" className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-stone-600 dark:border-stone-700 dark:bg-stone-900/70 dark:text-stone-300">
          <p className="text-xs font-bold">{ka ? 'ოპერაციებზე მხოლოდ ნახვის წვდომა' : 'Read-only operation access'}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
            {ka
              ? 'შეგიძლიათ გადახედოთ ოპერაციების ისტორიას, მაგრამ თქვენი როლი ვერ აღრიცხავს ახალ ოპერაციას.'
              : 'You can review operation history, but your workspace role cannot log a new operation.'}
          </p>
        </div>
      )}

      {canLogCellarOperation && (!canUseOperationVessels || !canConsumeOperationMaterials) && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="text-xs font-bold">{ka ? 'ოპერაციის შეზღუდული ხელსაწყოები' : 'Limited operation tools'}</p>
          <p className="mt-0.5 text-[11px] font-semibold text-amber-800/80 dark:text-amber-200/80">
            {[
              !canUseOperationVessels
                ? (ka ? 'ჭურჭელთან დაკავშირებული ცვლილებები მიუწვდომელია.' : 'Vessel-linked changes are unavailable.')
                : '',
              !canConsumeOperationMaterials
                ? (ka ? 'დანამატის ჩამოწერა და ხარჯის აღრიცხვა მიუწვდომელია.' : 'Material deductions and cost posting are unavailable.')
                : '',
            ].filter(Boolean).join(' ')}
          </p>
        </div>
      )}

      {commandError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
          <span>{commandError}</span>
          {(pendingIntent || pendingReversalIntent) && (
            <button
              type="button"
              disabled={isSubmitting || isReversing}
              onClick={() => pendingReversalIntent
                ? void handleReverseOperation()
                : pendingIntent && void executeOperationCommand(pendingIntent)}
              className="rounded-lg bg-[#4e0e15] px-3 py-1.5 font-bold text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting || isReversing
                ? (ka ? 'მოწმდება…' : 'Checking…')
                : pendingReversalIntent
                  ? (ka ? 'იგივე შესწორების ხელახლა გაგზავნა' : 'Resubmit same correction')
                  : (ka ? 'იგივე ბრძანების ხელახლა გაგზავნა' : 'Resubmit same command')}
            </button>
          )}
        </div>
      )}

      {canLogCellarOperation && returnToVesselId && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[10px] font-semibold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <span>
            {ka
              ? `${returnToVesselId}-დან დაწყებული ოპერაციაა. წარმატებული შენახვის შემდეგ ჭურჭლის განახლებული ჩანაწერი გაიხსნება.`
              : `Started from ${returnToVesselId}. After a successful save, its updated vessel record will reopen.`}
          </span>
          <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2 py-1 font-mono text-[9px] font-black uppercase tracking-wide text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950">
            {ka ? 'დაბრუნება ჩართულია' : 'Return enabled'}
          </span>
        </div>
      )}

      <div className={`grid grid-cols-1 ${canLogCellarOperation ? '2xl:grid-cols-[1.15fr_1fr]' : ''} gap-4`}>
        {/* ── Operation form ────────────────────────────── */}
        {canLogCellarOperation && (
          <fieldset
            disabled={Boolean(pendingIntent || pendingReversalIntent) || isSubmitting || isReversing}
            aria-busy={isSubmitting || isReversing}
            className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-4 disabled:opacity-70 dark:bg-stone-900 dark:border-stone-800"
          >
          {operationDraftRestored && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {ka ? 'შენახული ოპერაციის პროექტი აღდგა.' : 'Your saved operation draft was restored.'}
            </div>
          )}
          {/* Operation type picker */}
          <div>
            <label className={labelCls}>{ka ? 'ოპერაციის ტიპი' : 'Operation type'}</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {QUICK_CELLAR_OPERATIONS.map(o => {
                const Icon = OP_ICONS[o.key];
                const active = type === o.key;
                return (
                  <button key={o.key} type="button" onClick={() => selectOperationType(o.key)}
                    className={`flex flex-col items-center gap-1 px-1.5 py-2 rounded-lg border text-center transition-colors cursor-pointer ${active ? 'bg-[#4e0e15] text-amber-50 border-[#4e0e15]' : 'bg-stone-50 text-stone-500 border-stone-200 hover:border-[#4e0e15]/40 dark:bg-stone-900 dark:border-stone-800'}`}>
                    <Icon className="w-4 h-4" />
                    <span className="text-[8.5px] font-bold leading-tight">{ka ? o.ka : o.en}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {type === 'custom' && (
            <div>
              <label className={labelCls}>{ka ? 'ოპერაციის დასახელება' : 'Operation name'}</label>
              <input type="text" value={customLabel} onChange={e => setCustomLabel(e.target.value)}
                placeholder={ka ? 'მაგ. ანალიზისთვის ნიმუშის აღება' : 'e.g. Sampling for analysis'} className={inputCls} />
            </div>
          )}

          {activeLots.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              <Grape className="w-9 h-9 mx-auto mb-2 opacity-40" />
              <p className="text-xs font-bold">{ka ? 'აქტიური პარტია არ მოიძებნა' : 'No active batches'}</p>
            </div>
          ) : (
            <>
              <div className={`grid ${canUseOperationVessels ? 'grid-cols-2' : 'grid-cols-1'} gap-2`}>
                <div>
                  <label className={labelCls}>{ka ? 'პარტია' : 'Batch'}</label>
                  <select value={lotId} onChange={e => setLotId(e.target.value)} className={inputCls}>
                    {activeLots.map(l => <option key={l.id} value={l.id}>{l.name} — {round1(l.currentVolume)} L</option>)}
                  </select>
                </div>
                {canUseOperationVessels && (
                  <div>
                    <label className={labelCls}>{meta.needsVesselTo ? (ka ? 'ჭურჭელი (-დან)' : 'Vessel (from)') : (ka ? 'ჭურჭელი' : 'Vessel')}</label>
                    <select value={vesselId} onChange={e => setVesselId(e.target.value)} className={inputCls}>
                      <option value="">{ka ? '— არცერთი —' : '— none —'}</option>
                      {lotVessels.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.id} — {round1(v.currentVolume)} L
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {lot && lotVessels.length > 0 && (
                <p className="mt-1 text-[10px] font-semibold text-stone-500">
                  {ka
                    ? `პარტია განაწილებულია ${lotVessels.length} ჭურჭელში: ${round1(lotAllocatedVolume)} / ${round1(lot.currentVolume)} ლ`
                    : `Lot allocated across ${lotVessels.length} vessels: ${round1(lotAllocatedVolume)} / ${round1(lot.currentVolume)} L`}
                </p>
              )}

              {canUseOperationVessels && meta.needsVesselTo && (
                <div>
                  <label className={labelCls}>{ka ? 'ჭურჭელი (-ში)' : 'Vessel (to)'}</label>
                  <select value={vesselToId} onChange={e => setVesselToId(e.target.value)} className={inputCls}>
                    <option value="">{ka ? '— აირჩიეთ —' : '— select —'}</option>
                    {vessels.filter(v => v.id !== vesselId).map(v => <option key={v.id} value={v.id}>{v.id} — {round1(v.capacity - v.currentVolume)} L {ka ? 'თავ.' : 'free'}</option>)}
                  </select>
                </div>
              )}

              {canConsumeOperationMaterials && (
                <OperationMaterialsEditor
                  lang={lang}
                  inventory={inventory}
                  value={materialDrafts}
                  onChange={setMaterialDrafts}
                  operationType={type}
                  lotVolumeL={lot?.currentVolume}
                />
              )}

              {automationSettings.enabled && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/20">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold text-emerald-900 dark:text-emerald-200">
                        {ka ? 'ავტომატური ხარჯთაღრიცხვა' : 'Automatic costing'}
                      </p>
                      <p className="text-[9px] font-semibold text-emerald-700/80 dark:text-emerald-300/70">
                        {ka ? 'შრომა, ენერგია და ზედნადები ამ ოპერაციასთან ერთად ჩაიწერება.' : 'Labor, energy, and overhead will post with this operation.'}
                      </p>
                    </div>
                    <strong className="whitespace-nowrap text-sm font-black text-emerald-900 dark:text-emerald-200">
                      {automaticCostTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
                    </strong>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>{ka ? 'შრომა (საათი)' : 'Labor (hours)'}</label>
                      <input
                        type="number"
                        min={0}
                        step="0.05"
                        value={laborHours}
                        onChange={event => setLaborHours(event.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{ka ? 'ენერგია (კვტ⋅სთ)' : 'Energy (kWh)'}</label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={energyKwh}
                        onChange={event => setEnergyKwh(event.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                  {automaticCostPreview.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-semibold text-emerald-800/80 dark:text-emerald-300/80">
                      {automaticCostPreview.map(entry => (
                        <span key={entry.category}>
                          {catLabelForPreview(entry.category, ka)}: {entry.amount.toFixed(2)} {currency}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {meta.affectsVolume && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>{ka ? 'მოცულობა მერე (ლ)' : 'Volume after (L)'}</label>
                    <input type="number" step="0.1" min={0} value={volumeAfter} onChange={e => setVolumeAfter(e.target.value)} className={inputCls} />
                  </div>
                  <div className="flex items-end pb-2 text-[11px] font-mono text-stone-500">
                    {lot && volNum != null && (
                      <span>{ka ? 'დანაკარგი:' : 'Loss:'} <strong className={volNum > lot.currentVolume ? 'text-rose-600' : 'text-[#4e0e15] dark:text-amber-300'}>{round1(lot.currentVolume - volNum)} L</strong></span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label>
                  <DateInput lang={lang} value={date} onValueChange={setDate} className={inputCls} required />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ოპერატორი' : 'Operator'}</label>
                  <input type="text" value={operator} onChange={e => setOperator(e.target.value)} placeholder={currentUserName} className={inputCls} />
                </div>
              </div>

              <div>
                <label className={labelCls}>{ka ? 'შენიშვნა' : 'Notes'}</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={ka ? 'არასავალდებულო' : 'optional'} className={inputCls} />
              </div>

              {overfill && (
                <div className="flex items-center gap-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 dark:bg-rose-950/30">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {ka ? 'მოცულობა მერე არ უნდა აღემატებოდეს მიმდინარეს ამ ოპერაციისთვის.' : 'Volume after cannot exceed the current volume for this operation.'}
                </div>
              )}

              <button onClick={handleSubmit} disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors">
                <CheckCircle2 className="w-4 h-4" /> {ka ? 'ოპერაციის აღრიცხვა' : 'Log operation'}
              </button>
            </>
          )}
          </fieldset>
        )}

        {/* ── Recent operations ─────────────────────────── */}
        <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <ClipboardList className="w-4 h-4" /> {ka ? 'ბოლო ოპერაციები' : 'Recent operations'}
            </span>
            <span className="text-[9px] font-mono text-stone-400">{ops.length} {ka ? 'ჩანაწერი' : 'records'}</span>
          </div>
          {canReverseCellarOperation && (reversalOperation || pendingReversalIntent) && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold">
                    {ka ? 'ოპერაციის შესწორება' : 'Correct operation'}
                    {reversalOperation ? ` · ${reversalOperation.lotName}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium text-amber-800/80 dark:text-amber-200/80">
                    {ka
                      ? 'საწყისი ჩანაწერი დარჩება აუდიტში; სისტემა აღადგენს დაკავშირებულ მდგომარეობას და დაამატებს საკომპენსაციო ჩანაწერებს.'
                      : 'The original remains in the audit trail; linked state is restored with compensating records.'}
                  </p>
                </div>
                {!pendingReversalIntent && (
                  <button type="button" onClick={() => { setReversalOperationId(''); setReversalReason(''); }}
                    aria-label={ka ? 'დახურვა' : 'Close correction'}
                    className="text-amber-700 hover:text-amber-950 dark:text-amber-300">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <label className="mt-3 block text-[9px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                {ka ? 'შესწორების მიზეზი' : 'Correction reason'}
                <textarea value={reversalReason} onChange={event => setReversalReason(event.target.value)}
                  disabled={Boolean(pendingReversalIntent)} maxLength={500} rows={2}
                  className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-medium normal-case tracking-normal text-stone-800 outline-none focus:border-amber-600 disabled:opacity-70 dark:border-amber-900 dark:bg-stone-950 dark:text-amber-50"
                  placeholder={ka ? 'რატომ არის ეს შესწორება საჭირო?' : 'Why is this correction required?'} />
              </label>
              <button type="button" onClick={handleReverseOperation}
                disabled={isReversing || (!pendingReversalIntent && !reversalReason.trim())}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 disabled:opacity-50 dark:bg-amber-700">
                <RotateCcw className="h-3.5 w-3.5" />
                {pendingReversalIntent
                  ? (ka ? 'იგივე შესწორების ხელახლა გაგზავნა' : 'Resubmit same correction')
                  : (ka ? 'შესწორების დადასტურება' : 'Confirm correction')}
              </button>
            </div>
          )}
          {ops.length === 0 ? (
            <div className="text-center py-12 text-stone-400 text-xs font-semibold px-6">
              <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-30" />
              {canLogCellarOperation
                ? (ka ? 'ჯერ არ არის ოპერაცია. აირჩიეთ ტიპი და შეინახეთ.' : 'No operations yet. Pick a type and log your first.')
                : (ka ? 'აღრიცხული ოპერაციები აქ გამოჩნდება.' : 'Recorded operations will appear here.')}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                    <th className="p-2.5">{ka ? 'თარიღი' : 'Date'}</th>
                    <th className="p-2.5">{ka ? 'ოპერაცია' : 'Operation'}</th>
                    <th className="p-2.5">{ka ? 'პარტია' : 'Batch'}</th>
                    <th className="p-2.5">{ka ? 'დეტალი' : 'Detail'}</th>
                    {canReverseCellarOperation && <th className="p-2.5"><span className="sr-only">{ka ? 'მოქმედებები' : 'Actions'}</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {ops.map(o => {
                    const Icon = OP_ICONS[o.type] || Plus;
                    const materialDetail = o.materials?.length
                      ? o.materials.map(item => `${item.materialName || item.materialId} ${o.recordKind === 'reversal' ? '−' : ''}${item.quantity}${item.unit || ''}${item.purpose ? ` (${item.purpose})` : ''}`).join(', ')
                      : o.materialName && o.dose
                        ? `${o.materialName} ${o.recordKind === 'reversal' ? '−' : ''}${o.dose}${o.unit || ''}`
                        : '';
                    const detail = [
                      materialDetail,
                      o.vesselId ? (o.vesselToId ? `${o.vesselId}→${o.vesselToId}` : o.vesselId) : '',
                      o.volumeAfterL != null && o.volumeBeforeL != null && o.volumeAfterL !== o.volumeBeforeL ? `${round1(o.volumeBeforeL)}→${round1(o.volumeAfterL)} L` : '',
                      o.notes,
                    ].filter(Boolean).join(' · ');
                    return (
                      <tr key={o.id} className={`hover:bg-stone-50/50 dark:hover:bg-white/5 ${o.recordKind === 'reversal' || o.reversedByCommandId ? 'opacity-65' : ''}`}>
                        <td className="p-2.5 font-mono text-stone-500 whitespace-nowrap">{(o.date || '').slice(0, 10)}</td>
                        <td className="p-2.5">
                          <span className="font-bold text-stone-800 dark:text-amber-50 flex items-center gap-1">
                            <Icon className="w-3 h-3 text-[#4e0e15] dark:text-amber-300" /> {opLabel(o.type, o.customLabel)}
                          </span>
                          {o.recordKind === 'reversal' && <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-800">{ka ? 'შესწორება' : 'Correction'}</span>}
                          {o.reversedByCommandId && <span className="mt-1 inline-block rounded bg-stone-200 px-1.5 py-0.5 text-[8px] font-bold uppercase text-stone-600">{ka ? 'გაუქმებული' : 'Reversed'}</span>}
                        </td>
                        <td className="p-2.5 text-stone-600 dark:text-stone-300">{o.lotName}</td>
                        <td className="p-2.5 text-stone-400 font-mono text-[10px]">{detail || '—'}</td>
                        {canReverseCellarOperation && (
                          <td className="p-2.5 text-right">
                            {isActiveCellarOperation(o) && o.commandId && o.reversalSnapshot && (
                              <button type="button"
                                onClick={() => { setReversalOperationId(o.id); setReversalReason(''); setCommandError(null); }}
                                title={ka ? 'შესწორება' : 'Correct'}
                                aria-label={ka ? `${o.lotName} ოპერაციის შესწორება` : `Correct operation for ${o.lotName}`}
                                className="text-stone-300 hover:text-amber-700 cursor-pointer transition-colors">
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(CellarOperationsTab);
