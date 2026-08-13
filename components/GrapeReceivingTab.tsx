import React, { useEffect, useMemo, useState } from 'react';
import {
  Grape, CheckCircle2, AlertTriangle, ArrowRight, Sprout, Truck, RotateCcw, X,
  Scale, FlaskConical, Coins, FileText, Warehouse, History,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type {
  WineLot, Vessel, VineyardBlock, HarvestRecord, GrapeIntakeRecord, MaraniOSAuditLog,
  WineClass, GrapeSource, GrapeIntakeCondition,
} from '../lib/wineryState';
import { estimateMustVolumeL, brixToPotentialAlcohol } from '../lib/wineryOperations';
import { GEORGIAN_GRAPE_VARIETIES, GEORGIAN_WINE_REGIONS, inferWineClassForVariety } from '../lib/georgianWineKnowledge';
import { EmptyState, FormSection, InlineNotice } from './ui/primitives';
import DateInput from './ui/DateInput';
import { resolveCostAutomationSettings, type CostEntry } from '../lib/costing';
import { SyncQueueManager, type PendingCommandIntent } from '../lib/syncQueue';
import {
  applyHarvestIntakeCommand,
  type HarvestIntakeCommandPayload,
  type HarvestIntakeInput,
} from '../lib/commands/harvestIntake';
import type { HarvestIntakeReversalCommandPayload } from '../lib/commands/harvestIntakeReversal';
import { isActiveHarvestIntake, isHarvestIntakeReversal } from '../lib/harvestIntakeIntegrity';
import {
  CommandRequestError,
  createHarvestIntakeCommandIntent,
  createHarvestIntakeReversalCommandIntent,
  pendingHarvestIntakeCommandIntent,
  pendingHarvestIntakeReversalCommandIntent,
  submitHarvestIntakeCommand,
  submitHarvestIntakeReversalCommand,
  type HarvestIntakeCommandResponse,
} from '../lib/commands/client';

interface Props {
  lang: Language;
  vessels: Vessel[];
  blocks: VineyardBlock[];
  harvests: HarvestRecord[];
  intakes: GrapeIntakeRecord[];
  currentUserName: string;
  currency: string;
  costAutomation?: unknown;
  region?: string;
  onReceiveGrapes: (input: Omit<GrapeIntakeRecord, 'id' | 'createdLotId' | 'netWeightKg' | 'estimatedVolumeL'>) => string;
  lots?: WineLot[];
  costEntries?: CostEntry[];
  auditLogs?: MaraniOSAuditLog[];
  onUpdateLots?: (lots: WineLot[]) => void;
  onUpdateVessels?: (vessels: Vessel[]) => void;
  onUpdateHarvests?: (harvests: HarvestRecord[]) => void;
  onUpdateIntakes?: (intakes: GrapeIntakeRecord[]) => void;
  onUpdateCostEntries?: (entries: CostEntry[]) => void;
  onUpdateAuditLogs?: (logs: MaraniOSAuditLog[]) => void;
  onApplyHarvestIntakeCommandResponse?: (response: HarvestIntakeCommandResponse) => void;
  prefilledHarvestRecordId?: string | null;
  onPrefillConsumed?: () => void;
  /** Compound permission for the intake, lot, and audit writes. */
  canReceiveGrapes?: boolean;
  /** Optional vineyard update performed when a planned harvest is linked. */
  canLinkHarvest?: boolean;
  /** Optional vessel update performed when must is assigned on receipt. */
  canFillDestinationVessel?: boolean;
  /** Optional cost-ledger create performed when fruit pricing is entered. */
  canPostIntakeCost?: boolean;
  /** Append-only intake compensation permission. */
  canReverseHarvestIntake?: boolean;
  setActiveTab?: (t: string) => void;
  setToastMessage?: (m: string) => void;
}

type ReceiveGrapesInput = Parameters<Props['onReceiveGrapes']>[0];

interface OptionalIntakeWritePermissions {
  canLinkHarvest: boolean;
  canFillDestinationVessel: boolean;
  canPostIntakeCost: boolean;
}

/**
 * Strip optional compound writes from a prepared intake before it reaches the
 * state mutation. The UI also hides these fields, but this keeps the callback
 * safe if permissions change while the form is open.
 */
export function restrictOptionalIntakeWrites(
  input: ReceiveGrapesInput,
  permissions: OptionalIntakeWritePermissions,
): ReceiveGrapesInput {
  return {
    ...input,
    destinationVesselId: permissions.canFillDestinationVessel ? input.destinationVesselId : null,
    harvestRecordId: permissions.canLinkHarvest ? input.harvestRecordId : undefined,
    costPerKg: permissions.canPostIntakeCost ? input.costPerKg : undefined,
    totalCost: permissions.canPostIntakeCost ? input.totalCost : undefined,
    grapePrice: permissions.canPostIntakeCost ? input.grapePrice : undefined,
    paymentStatus: permissions.canPostIntakeCost ? input.paymentStatus : 'not_applicable',
  };
}

const WINE_CLASSES: Array<{ key: WineClass; en: string; ka: string }> = [
  { key: 'red', en: 'Red', ka: 'წითელი' },
  { key: 'white', en: 'White', ka: 'თეთრი' },
  { key: 'amber', en: 'Amber', ka: 'ქარვისფერი' },
  { key: 'qvevri', en: 'Qvevri', ka: 'ქვევრის' },
  { key: 'rose', en: 'Rosé', ka: 'ვარდისფერი' },
  { key: 'sparkling', en: 'Sparkling base', ka: 'ცქრიალა' },
  { key: 'fortified', en: 'Fortified', ka: 'შემაგრებული' },
  { key: 'base_wine', en: 'Base wine', ka: 'საბაზო' },
];

const CONDITIONS: Array<{ key: GrapeIntakeCondition; en: string; ka: string }> = [
  { key: 'excellent', en: 'Excellent', ka: 'შესანიშნავი' },
  { key: 'good', en: 'Good', ka: 'კარგი' },
  { key: 'fair', en: 'Fair', ka: 'საშუალო' },
  { key: 'damaged', en: 'Damaged', ka: 'დაზიანებული' },
];

const round1 = (n: number) => Math.round(n * 10) / 10;
const GEORGIAN_MICROZONE_OPTIONS = Array.from(new Set(GEORGIAN_WINE_REGIONS.flatMap(region => region.mainMicrozones))).sort();

export function GrapeReceivingTab({
  lang, vessels, blocks, harvests, intakes, currentUserName,
  currency, costAutomation, region = 'Kakheti',
  onReceiveGrapes, setActiveTab, setToastMessage,
  lots = [], costEntries = [], auditLogs = [],
  onUpdateLots, onUpdateVessels, onUpdateHarvests, onUpdateIntakes,
  onUpdateCostEntries, onUpdateAuditLogs, onApplyHarvestIntakeCommandResponse,
  prefilledHarvestRecordId, onPrefillConsumed,
  canReceiveGrapes = true,
  canLinkHarvest = true,
  canFillDestinationVessel = true,
  canPostIntakeCost = true,
  canReverseHarvestIntake = false,
}: Props) {
  const ka = lang === 'ka';
  const today = new Date().toISOString().slice(0, 10);
  const thisYear = new Date().getFullYear();

  const [source, setSource] = useState<GrapeSource>('own');
  const [blockId, setBlockId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierIdCode, setSupplierIdCode] = useState('');
  const [harvestRecordId, setHarvestRecordId] = useState('');
  const [variety, setVariety] = useState('');
  const [vintage, setVintage] = useState(thisYear);
  const [date, setDate] = useState(today);
  const [transportName, setTransportName] = useState('');
  const [transportNumber, setTransportNumber] = useState('');
  const [weighingDocumentNumber, setWeighingDocumentNumber] = useState('');
  const [labAnalysisNumber, setLabAnalysisNumber] = useState('');
  const [cadastralCode, setCadastralCode] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [village, setVillage] = useState('');
  const [microzone, setMicrozone] = useState('');
  const [grossWeightKg, setGross] = useState('');
  const [tareWeightKg, setTare] = useState('');
  const [netWeightKg, setNetWeight] = useState('');
  const [brix, setBrix] = useState('');
  const [ph, setPh] = useState('');
  const [ta, setTa] = useState('');
  const [temperatureC, setTemp] = useState('');
  const [condition, setCondition] = useState<GrapeIntakeCondition>('good');
  const [pickingMethod, setPicking] = useState<'hand' | 'machine'>('hand');
  const [wineClass, setWineClass] = useState<WineClass>('red');
  const [juiceYieldPct, setYield] = useState('70');
  const [costPerKg, setCostPerKg] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<GrapeIntakeRecord['paymentStatus']>('not_applicable');
  const [destinationVesselId, setDest] = useState('');
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingIntent, setPendingIntent] = useState<PendingCommandIntent<HarvestIntakeCommandPayload> | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingReversalIntent, setPendingReversalIntent] = useState<PendingCommandIntent<HarvestIntakeReversalCommandPayload> | null>(null);
  const [reversalIntakeId, setReversalIntakeId] = useState('');
  const [reversalReason, setReversalReason] = useState('');
  const [isReversing, setIsReversing] = useState(false);

  // Own-vineyard harvests not yet received into the winery.
  const pendingHarvests = useMemo(
    () => harvests.filter(h => !h.sentToGvino),
    [harvests],
  );

  const net = Math.max(0, parseFloat(netWeightKg) || 0);
  const yieldPct = parseFloat(juiceYieldPct) || 0;
  const estVolumeL = estimateMustVolumeL(net, yieldPct);
  const potentialAbv = brixToPotentialAlcohol(parseFloat(brix) || 0);
  const costAutomationSettings = useMemo(
    () => resolveCostAutomationSettings(costAutomation),
    [costAutomation],
  );
  const costPerKgNum = canPostIntakeCost ? parseFloat(costPerKg) || 0 : 0;
  const explicitTotalCost = canPostIntakeCost ? parseFloat(totalCost) || 0 : 0;
  const automaticOwnGrapeRate = source === 'own' && costAutomationSettings.enabled
    ? costAutomationSettings.ownGrapeCostPerKg
    : 0;
  const effectiveFruitRate = costPerKgNum || automaticOwnGrapeRate;
  const computedFruitCost = Math.round((explicitTotalCost || (net * effectiveFruitRate)) * 100) / 100;

  const permittedDestinationVesselId = canFillDestinationVessel ? destinationVesselId : '';
  const destVessel = vessels.find(v => v.id === permittedDestinationVesselId) || null;
  const freeCapacity = destVessel ? round1(destVessel.capacity - destVessel.currentVolume) : 0;
  const overfill = !!destVessel && estVolumeL > freeCapacity + 0.001;
  const destinationUnavailable = !!destVessel && (
    destVessel.cleaningStatus !== 'clean'
    || destVessel.currentVolume > 0.001
    || Boolean(destVessel.assignedLotId)
  );
  const eligibleVessels = useMemo(
    () => vessels.filter(vessel => (
      (vessel.cleaningStatus === 'clean' && vessel.currentVolume <= 0.001 && !vessel.assignedLotId)
      || vessel.id === pendingIntent?.payload.intake.destinationVesselId
    )),
    [pendingIntent?.payload.intake.destinationVesselId, vessels],
  );

  const varietyOk = variety.trim().length > 0;
  const sourceOk = source === 'own' ? !!blockId : supplierName.trim().length > 0;
  const canSubmit = !pendingReversalIntent && !isReversing && (Boolean(pendingIntent) || (
    canReceiveGrapes && varietyOk && sourceOk && net > 0 && yieldPct > 0 && !overfill && !destinationUnavailable
  ));

  const restrictedOptionalActions = [
    !canLinkHarvest ? (ka ? 'დაგეგმილი მოსავლის მიბმა' : 'planned-harvest linking') : null,
    !canFillDestinationVessel ? (ka ? 'ჭურჭლის შევსება' : 'destination-vessel filling') : null,
    !canPostIntakeCost ? (ka ? 'ხარჯების წიგნში გატარება' : 'cost-ledger posting') : null,
  ].filter((label): label is string => !!label);

  const applyBlock = (id: string) => {
    setBlockId(id);
    const b = blocks.find(x => x.id === id);
    if (!b) return;
    if (!variety) {
      setVariety(b.grapeVariety);
      const inferredClass = inferWineClassForVariety(b.grapeVariety);
      if (inferredClass) setWineClass(inferredClass);
    }
    setCadastralCode(b.cadastralCode || b.id || '');
    setMunicipality(b.municipality || '');
    setVillage(b.village || b.vineyardName || '');
    setMicrozone(b.microzone || '');
  };

  const applyHarvest = (id: string) => {
    if (!canLinkHarvest) return;
    setHarvestRecordId(id);
    const h = harvests.find(x => x.id === id);
    if (!h) return;
    setSource('own');
    applyBlock(h.blockId);
    setVariety(h.variety);
    const inferredClass = inferWineClassForVariety(h.variety);
    if (inferredClass) setWineClass(inferredClass);
    if (h.estimatedTons) {
      const gross = Math.round(h.actualHarvestedKg || h.estimatedTons * 1000);
      setGross(String(gross));
      setNetWeight(String(Math.max(0, gross - (parseFloat(tareWeightKg) || 0))));
    }
    if (h.temperatureAtHarvest != null) setTemp(String(h.temperatureAtHarvest));
    setDate(h.actualHarvestDate || h.estimatedHarvestDate || today);
    setVintage(Number((h.actualHarvestDate || h.estimatedHarvestDate || today).slice(0, 4)) || thisYear);
    setPicking(h.pickingMethod);
    setCondition(h.grapeCondition === ' fair' ? 'fair' : h.grapeCondition);
  };

  const restoreCapturedIntake = (input: HarvestIntakeInput) => {
    setSource(input.source);
    setBlockId(input.blockId || '');
    setSupplierName(input.supplierName || '');
    setSupplierIdCode(input.supplierIdCode || '');
    setHarvestRecordId(input.harvestRecordId || '');
    setVariety(input.variety);
    setVintage(input.vintage);
    setDate(input.date);
    setTransportName(input.transportName || '');
    setTransportNumber(input.transportNumber || '');
    setWeighingDocumentNumber(input.weighingDocumentNumber || '');
    setLabAnalysisNumber(input.labAnalysisNumber || '');
    setCadastralCode(input.cadastralCode || '');
    setMunicipality(input.municipality || '');
    setVillage(input.village || '');
    setMicrozone(input.microzone || '');
    setGross(String(input.grossWeightKg));
    setTare(String(input.tareWeightKg));
    setNetWeight(String(Math.max(0, input.grossWeightKg - input.tareWeightKg)));
    setBrix(String(input.brix));
    setPh(String(input.ph));
    setTa(String(input.titratableAcidity));
    setTemp(String(input.temperatureC));
    setCondition(input.condition);
    setPicking(input.pickingMethod);
    setWineClass(input.wineClass);
    setYield(String(input.juiceYieldPct));
    setCostPerKg(input.costPerKg ? String(input.costPerKg) : '');
    setTotalCost(input.totalCost ? String(input.totalCost) : '');
    setPaymentStatus(input.paymentStatus || 'not_applicable');
    setDest(input.destinationVesselId || '');
    setOperator(input.operator);
    setNotes(input.notes || '');
  };

  useEffect(() => {
    const restored = pendingHarvestIntakeCommandIntent();
    if (!restored) return;
    setPendingIntent(restored);
    restoreCapturedIntake(restored.payload.intake);
    setCommandError(ka
      ? 'წინა მიღების შედეგი ჯერ არ არის დადასტურებული. იგივე ბრძანება ხელახლა გაგზავნეთ.'
      : 'A previous grape intake is not yet acknowledged. Resubmit to recover the same command safely.');
  }, [ka]);

  useEffect(() => {
    const restored = pendingHarvestIntakeReversalCommandIntent();
    if (!restored) return;
    const original = intakes.find(item => item.commandId === restored.payload.originalCommandId);
    setPendingReversalIntent(restored);
    setReversalIntakeId(original?.id || '');
    setReversalReason(restored.payload.reason);
    setCommandError(ka
      ? 'A previous intake correction is not yet acknowledged. Resubmit the same correction.'
      : 'A previous intake correction is not yet acknowledged. Resubmit the same correction.');
  }, [intakes, ka]);

  useEffect(() => {
    if (!prefilledHarvestRecordId || !canLinkHarvest || pendingHarvestIntakeCommandIntent()) return;
    applyHarvest(prefilledHarvestRecordId);
    onPrefillConsumed?.();
    // Consume only when the parent supplies a new harvest id; depending on the
    // form-population callbacks would replay the prefill after every field set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilledHarvestRecordId]);

  const handleVarietyChange = (value: string) => {
    setVariety(value);
    const inferredClass = inferWineClassForVariety(value);
    if (inferredClass) setWineClass(inferredClass);
  };

  const normalizedWeight = (value: number) => String(Math.round(value * 1000) / 1000);

  const handleGrossWeightChange = (value: string) => {
    setGross(value);
    const gross = parseFloat(value) || 0;
    const tare = parseFloat(tareWeightKg) || 0;
    setNetWeight(gross > tare ? normalizedWeight(gross - tare) : '');
  };

  const handleTareWeightChange = (value: string) => {
    setTare(value);
    const gross = parseFloat(grossWeightKg) || 0;
    const tare = parseFloat(value) || 0;
    setNetWeight(gross > tare ? normalizedWeight(gross - tare) : '');
  };

  const handleNetWeightChange = (value: string) => {
    setNetWeight(value);
    const tare = parseFloat(tareWeightKg) || 0;
    const manualNet = parseFloat(value);
    setGross(Number.isFinite(manualNet) && manualNet > 0
      ? normalizedWeight(manualNet + tare)
      : (tare > 0 ? normalizedWeight(tare) : ''));
  };

  const resetForm = () => {
    setHarvestRecordId(''); setVariety(''); setGross(''); setTare(''); setNetWeight('');
    setBrix(''); setPh(''); setTa(''); setTemp(''); setCostPerKg(''); setTotalCost(''); setNotes(''); setDest('');
    setTransportName(''); setTransportNumber(''); setWeighingDocumentNumber(''); setLabAnalysisNumber('');
    setSupplierIdCode(''); setCadastralCode(''); setMunicipality(''); setVillage(''); setMicrozone('');
    setPaymentStatus('not_applicable');
  };

  const preparedIntakeInput = (): ReceiveGrapesInput => {
    const block = blocks.find(b => b.id === blockId);
    const preparedInput: ReceiveGrapesInput = {
      date,
      source,
      supplierName: source === 'supplier' ? supplierName.trim() : undefined,
      supplierIdCode: source === 'supplier' ? supplierIdCode.trim() || undefined : undefined,
      blockId: source === 'own' ? blockId : undefined,
      blockName: source === 'own' ? (block?.name || '') : undefined,
      transportName: transportName.trim() || undefined,
      transportNumber: transportNumber.trim() || undefined,
      weighingDocumentNumber: weighingDocumentNumber.trim() || undefined,
      labAnalysisNumber: labAnalysisNumber.trim() || undefined,
      cadastralCode: cadastralCode.trim() || block?.cadastralCode || undefined,
      municipality: municipality.trim() || block?.municipality || undefined,
      village: village.trim() || block?.village || block?.vineyardName || undefined,
      microzone: microzone.trim() || block?.microzone || undefined,
      variety: variety.trim(),
      vintage,
      grossWeightKg: parseFloat(grossWeightKg) || 0,
      tareWeightKg: parseFloat(tareWeightKg) || 0,
      brix: parseFloat(brix) || 0,
      ph: parseFloat(ph) || 0,
      titratableAcidity: parseFloat(ta) || 0,
      temperatureC: parseFloat(temperatureC) || 0,
      condition,
      pickingMethod,
      wineClass,
      juiceYieldPct: yieldPct,
      costPerKg: costPerKgNum > 0 ? costPerKgNum : undefined,
      totalCost: computedFruitCost > 0 ? computedFruitCost : undefined,
      currency,
      grapePrice: costPerKgNum > 0 ? costPerKgNum : undefined,
      paymentStatus,
      destinationVesselId: permittedDestinationVesselId || null,
      harvestRecordId: canLinkHarvest ? harvestRecordId || undefined : undefined,
      operator: operator.trim() || currentUserName,
      notes: notes.trim(),
    };
    return restrictOptionalIntakeWrites(preparedInput, {
      canLinkHarvest,
      canFillDestinationVessel,
      canPostIntakeCost,
    });
  };

  const finishCommand = () => {
    setPendingIntent(null);
    setCommandError(null);
    resetForm();
  };

  const applyIntakeLocally = (intent: PendingCommandIntent<HarvestIntakeCommandPayload>) => {
    const hasCommandBindings = Boolean(
      onUpdateLots && onUpdateVessels && onUpdateHarvests && onUpdateIntakes
      && onUpdateCostEntries && onUpdateAuditLogs,
    );
    if (!hasCommandBindings) {
      const lotId = onReceiveGrapes(intent.payload.intake as ReceiveGrapesInput);
      setToastMessage?.(ka
        ? `მიღება აღირიცხა: ${net.toLocaleString()} კგ ${variety} → ლოტი ${lotId}`
        : `Intake recorded: ${net.toLocaleString()} kg ${variety} → lot ${lotId}`);
      finishCommand();
      return;
    }

    const applied = applyHarvestIntakeCommand(
      { blocks, harvests, lots, vessels, grapeIntakes: intakes, costEntries, auditLogs },
      intent.payload,
      {
        commandId: intent.commandId,
        actorUsername: currentUserName,
        currency,
        region,
        costAutomation,
        performedAt: new Date(intent.capturedAt),
      },
    );
    onUpdateLots?.(applied.state.lots);
    onUpdateVessels?.(applied.state.vessels);
    onUpdateHarvests?.(applied.state.harvests);
    onUpdateIntakes?.(applied.state.grapeIntakes);
    onUpdateCostEntries?.(applied.state.costEntries);
    onUpdateAuditLogs?.(applied.state.auditLogs);
    setToastMessage?.(ka
      ? `მიღება აღირიცხა: ${applied.result.receipt.netWeightKg.toLocaleString()} კგ ${applied.result.intake.variety} → ლოტი ${applied.result.lot.id}`
      : `Intake recorded: ${applied.result.receipt.netWeightKg.toLocaleString()} kg ${applied.result.intake.variety} → lot ${applied.result.lot.id}`);
    finishCommand();
  };

  const executeIntakeCommand = async (intent: PendingCommandIntent<HarvestIntakeCommandPayload>) => {
    setCommandError(null);
    if (!onApplyHarvestIntakeCommandResponse || !SyncQueueManager.isOnline()) {
      if (pendingIntent) {
        setCommandError(ka
          ? 'დაუდასტურებელი მიღების აღდგენას ინტერნეტთან კავშირი სჭირდება.'
          : 'Recovering an unacknowledged grape intake requires a server connection.');
        return;
      }
      try {
        applyIntakeLocally(intent);
      } catch (error) {
        setCommandError(error instanceof Error ? error.message : 'Grape intake validation failed.');
      }
      return;
    }

    setPendingIntent(intent);
    setIsSubmitting(true);
    try {
      const response = await submitHarvestIntakeCommand(intent);
      onApplyHarvestIntakeCommandResponse(response);
      setToastMessage?.(ka
        ? `მიღება აღირიცხა: ${response.result.receipt.netWeightKg.toLocaleString()} კგ ${response.result.intake.variety} → ლოტი ${response.result.lot.id}`
        : `Intake recorded: ${response.result.receipt.netWeightKg.toLocaleString()} kg ${response.result.intake.variety} → lot ${response.result.lot.id}`);
      finishCommand();
    } catch (error) {
      if (error instanceof CommandRequestError
        && error.code === 'command_store_unavailable'
        && !pendingIntent) {
        SyncQueueManager.consumePendingCommandIntent(intent.commandId);
        try {
          applyIntakeLocally(intent);
          return;
        } catch (fallbackError) {
          setCommandError(fallbackError instanceof Error ? fallbackError.message : 'Grape intake validation failed.');
          setPendingIntent(null);
          return;
        }
      }
      setCommandError(error instanceof Error ? error.message : 'Grape intake command failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingIntent(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const reversalIntake = intakes.find(item => item.id === reversalIntakeId) || null;

  const applyReversalResponse = (
    response: Awaited<ReturnType<typeof submitHarvestIntakeReversalCommand>>,
  ) => {
    if (response.collections) {
      onUpdateHarvests?.(response.collections.harvests);
      onUpdateLots?.(response.collections.lots);
      onUpdateVessels?.(response.collections.vessels);
      onUpdateIntakes?.(response.collections.grapeIntakes);
      onUpdateCostEntries?.(response.collections.costEntries);
      onUpdateAuditLogs?.(response.collections.auditLogs);
      return;
    }
    const replaceById = <T extends { id: string }>(current: T[], changed: T[]) => {
      const changedIds = new Set(changed.map(item => item.id));
      return [...changed, ...current.filter(item => !changedIds.has(item.id))];
    };
    const result = response.result;
    onUpdateLots?.(replaceById(lots, [result.voidedLot]));
    if (result.updatedVessel) onUpdateVessels?.(replaceById(vessels, [result.updatedVessel]));
    if (result.updatedHarvest) onUpdateHarvests?.(replaceById(harvests, [result.updatedHarvest]));
    onUpdateIntakes?.(replaceById(intakes, [result.reversalIntake, result.originalIntake]));
    onUpdateCostEntries?.(replaceById(costEntries, [
      ...(result.reversalCostEntry ? [result.reversalCostEntry] : []),
      ...(result.updatedOriginalCostEntry ? [result.updatedOriginalCostEntry] : []),
    ]));
    onUpdateAuditLogs?.(replaceById(auditLogs, [result.auditLog]));
  };

  const handleReverseIntake = async () => {
    if (!canReverseHarvestIntake || isReversing) return;
    const original = pendingReversalIntent
      ? intakes.find(item => item.commandId === pendingReversalIntent.payload.originalCommandId)
      : reversalIntake;
    const reason = pendingReversalIntent?.payload.reason || reversalReason.trim();
    if (!original?.commandId || !reason) {
      setCommandError(ka ? 'A correction reason is required.' : 'A correction reason is required.');
      return;
    }
    if (!onApplyHarvestIntakeCommandResponse || !SyncQueueManager.isOnline()) {
      setCommandError(ka
        ? 'Intake corrections require a server connection.'
        : 'Intake corrections require a server connection.');
      return;
    }
    const intent = pendingReversalIntent || createHarvestIntakeReversalCommandIntent({
      originalCommandId: original.commandId,
      reason,
    });
    setPendingReversalIntent(intent);
    setCommandError(null);
    setIsReversing(true);
    try {
      const response = await submitHarvestIntakeReversalCommand(intent);
      applyReversalResponse(response);
      setPendingReversalIntent(null);
      setReversalIntakeId('');
      setReversalReason('');
      setToastMessage?.(ka
        ? 'Intake corrected and linked harvest, lot, vessel, cost, and audit ledgers restored.'
        : 'Intake corrected and linked harvest, lot, vessel, cost, and audit ledgers restored.');
    } catch (error) {
      setCommandError(error instanceof Error ? error.message : 'Grape-intake reversal failed.');
      if (error instanceof CommandRequestError && !error.retryable) setPendingReversalIntent(null);
    } finally {
      setIsReversing(false);
    }
  };

  const handleSubmit = () => {
    if (!canReceiveGrapes || !canSubmit) return;
    if (pendingIntent) {
      void executeIntakeCommand(pendingIntent);
      return;
    }
    const preparedInput = preparedIntakeInput();
    const { currency: _ignoredCurrency, commandId: _ignoredCommandId, lastModified: _ignoredLastModified, ...intake } = preparedInput;
    void executeIntakeCommand(createHarvestIntakeCommandIntent(intake as HarvestIntakeInput));
  };

  const openLot = (_lotId: string) => {
    setActiveTab?.('lots');
  };

  const labelCls = 'text-[9px] uppercase font-mono block mb-1 font-bold text-stone-400 tracking-widest';
  const inputCls = 'w-full bg-stone-50 border border-stone-200 px-2.5 py-2 rounded-lg text-xs font-semibold text-stone-700 outline-none focus:border-[#4e0e15] dark:bg-stone-900 dark:border-stone-800';

  return (
    <div className="space-y-4 animate-fade-in text-stone-800">
      <datalist id="georgian-grape-variety-options">
        {GEORGIAN_GRAPE_VARIETIES.map(item => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>
      <datalist id="georgian-microzone-options">
        {GEORGIAN_MICROZONE_OPTIONS.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {/* Header */}
      <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm dark:bg-stone-900 dark:border-stone-800">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <span className="text-[9px] uppercase tracking-widest bg-[#4e0e15]/10 text-[#4e0e15] px-2.5 py-0.5 rounded font-bold">
              {ka ? 'მარანი · დურდოს მიღება' : 'Cellar · Grape Receiving'}
            </span>
            <h3 className="text-xl font-serif font-black text-stone-900 uppercase mt-1 flex items-center gap-2 dark:text-amber-100">
              <Grape className="w-5 h-5 text-[#4e0e15]" />
              {ka ? 'ყურძნის მიღება' : 'Grape Intake'}
            </h3>
            <p className="text-xs text-stone-400 font-semibold mt-0.5">
              {!canReceiveGrapes
                ? (ka
                  ? 'გადახედეთ მიღების ისტორიას და გახსენით დაკავშირებული ღვინის პარტიები.'
                  : 'Review receiving history and open linked wine batches.')
                : canFillDestinationVessel
                  ? (ka
                    ? 'ყურძნის მიღება საკუთარი ვენახიდან ან მომწოდებლისგან — ავტომატურად იქმნება პარტია და ივსება ჭურჭელი'
                    : 'Receive fruit from an own block or a supplier — auto-creates the wine batch and fills the vessel')
                  : (ka
                    ? 'აღრიცხეთ ყურძნის მიღება და შექმენით პარტია; ჭურჭლის მინიჭება მოგვიანებით შეიძლება.'
                    : 'Record grape intake and create its batch; a vessel can be assigned later.')}
            </p>
          </div>
          <a
            href="#grape-intake-history"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#d8c9bb] bg-[#faf7f2] px-3 py-2 text-xs font-bold text-[#4e0e15] transition-colors hover:border-[#4e0e15] hover:bg-[#f5ece5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4e0e15] dark:border-stone-700 dark:bg-stone-950 dark:text-amber-200"
          >
            <History className="h-4 w-4" />
            {ka ? 'ყურძნის მიღების ისტორია' : 'Grape intake history'}
          </a>
        </div>
      </div>

      {(!canReceiveGrapes || restrictedOptionalActions.length > 0) && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-xs font-bold">
              {!canReceiveGrapes
                ? (ka ? 'მიღებებზე მხოლოდ ნახვის წვდომა' : 'Read-only intake access')
                : (ka ? 'მიღების შეზღუდული მოქმედებები' : 'Limited intake actions')}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold opacity-80">
              {!canReceiveGrapes
                ? (ka
                  ? 'შეგიძლიათ მიღების ისტორიის ნახვა და დაკავშირებული პარტიების გახსნა. ახალი მიღების აღრიცხვა თქვენი როლისთვის მიუწვდომელია.'
                  : 'You can review receiving history and open linked batches. Recording a new intake is unavailable for your role.')
                : (ka
                  ? `შეგიძლიათ მიღების აღრიცხვა და პარტიის შექმნა. თქვენი როლისთვის მიუწვდომელია: ${restrictedOptionalActions.join(', ')}.`
                  : `You can record an intake and create its batch. Unavailable for your role: ${restrictedOptionalActions.join(', ')}.`)}
            </p>
          </div>
        </div>
      )}

      {(pendingIntent || pendingReversalIntent || commandError) && (
        <div role={commandError ? 'alert' : 'status'} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
          <span>{commandError || (ka
            ? 'ყურძნის მიღება სერვერის დადასტურებას ელოდება.'
            : 'The grape intake is waiting for server acknowledgement.')}</span>
          {(pendingIntent || pendingReversalIntent) && (
            <button
              type="button"
              onClick={() => pendingReversalIntent
                ? void handleReverseIntake()
                : pendingIntent && void executeIntakeCommand(pendingIntent)}
              disabled={isSubmitting || isReversing}
              className="shrink-0 rounded-lg bg-amber-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white disabled:opacity-50"
            >
              {pendingReversalIntent ? 'Resubmit same correction' : (ka ? 'იგივე მიღების ხელახლა გაგზავნა' : 'Resubmit same intake')}
            </button>
          )}
        </div>
      )}

      <fieldset disabled={Boolean(pendingIntent) || isSubmitting} className="contents">
      {/* The form owns the full width and splits into two columns itself, so
          its inner `sm:` field grids still see the breakpoint they expect. */}
      <div className="space-y-4">
        {/* ── Intake form ───────────────────────────────── */}
        {canReceiveGrapes && (
        <div className="bg-white border border-[#e8dfd5] p-4 sm:p-5 rounded-2xl shadow-sm space-y-4 dark:bg-stone-900 dark:border-stone-800">
          {/* Paired sections keep each step readable instead of stretching a
              single field across the full card width on wide screens. */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-start">
            <FormSection
              icon={source === 'own' ? Sprout : Truck}
              title={ka ? 'ხილის წყარო' : 'Fruit source'}
              description={ka
                ? 'აირჩიეთ საიდან შემოდის ყურძენი — წარმოშობის ველები ავტომატურად ივსება.'
                : 'Choose where the fruit comes from — origin fields fill in automatically.'}
            >
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSource('own')}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer ${source === 'own' ? 'bg-[#4e0e15] text-amber-50 border-[#4e0e15]' : 'bg-white text-stone-500 border-stone-200 dark:bg-stone-900 dark:border-stone-800'}`}>
                  <Sprout className="w-3.5 h-3.5" /> {ka ? 'საკუთარი ვენახი' : 'Own vineyard'}
                </button>
                <button type="button" onClick={() => { setSource('supplier'); setHarvestRecordId(''); }}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide border transition-colors cursor-pointer ${source === 'supplier' ? 'bg-[#4e0e15] text-amber-50 border-[#4e0e15]' : 'bg-white text-stone-500 border-stone-200 dark:bg-stone-900 dark:border-stone-800'}`}>
                  <Truck className="w-3.5 h-3.5" /> {ka ? 'მომწოდებელი' : 'Supplier'}
                </button>
              </div>

              {source === 'own' ? (
                <div className={`grid grid-cols-1 gap-2 ${canLinkHarvest && pendingHarvests.length > 0 ? 'sm:grid-cols-2' : ''}`}>
                  {canLinkHarvest && pendingHarvests.length > 0 && (
                    <div>
                      <label className={labelCls}>{ka ? 'მოსავლის ჩანაწერიდან (არჩევითი)' : 'From planned harvest (optional)'}</label>
                      <select value={harvestRecordId} onChange={e => applyHarvest(e.target.value)} className={inputCls}>
                        <option value="">{ka ? '— ხელით შევსება —' : '— enter manually —'}</option>
                        {pendingHarvests.map(h => {
                          const b = blocks.find(x => x.id === h.blockId);
                          return <option key={h.id} value={h.id}>{h.variety} · {b?.name || h.blockId} · ~{h.estimatedTons}t</option>;
                        })}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className={labelCls}>{ka ? 'ვენახის ბლოკი' : 'Vineyard block'}</label>
                    <select value={blockId} onChange={e => applyBlock(e.target.value)} className={inputCls}>
                      <option value="">{ka ? '— აირჩიეთ ბლოკი —' : '— select block —'}</option>
                      {blocks.map(b => <option key={b.id} value={b.id}>{b.name} ({b.grapeVariety})</option>)}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>{ka ? 'მომწოდებლის სახელი' : 'Supplier name'}</label>
                    <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)}
                      placeholder={ka ? 'მაგ. გიორგი ბ. — სოფ. ვაზისუბანი' : 'e.g. Giorgi B. - Vazisubani'} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{ka ? 'მომწოდებლის საიდ. კოდი' : 'Supplier ID / company code'}</label>
                    <input type="text" value={supplierIdCode} onChange={e => setSupplierIdCode(e.target.value)}
                      placeholder={ka ? 'პირადი ან კომპანიის კოდი' : 'Personal or company code'} className={inputCls} />
                  </div>
                </div>
              )}
            </FormSection>

            <FormSection
              icon={Grape}
              title={ka ? 'პარტიის იდენტობა' : 'Batch identity'}
              description={ka
                ? 'ეს ველები განსაზღვრავს შექმნილი ღვინის პარტიის სახელს და ტიპს.'
                : 'These fields name and classify the wine batch this intake creates.'}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'ჯიში' : 'Variety'}</label>
                  <input type="text" value={variety} onChange={e => handleVarietyChange(e.target.value)}
                    list="georgian-grape-variety-options"
                    placeholder={ka ? 'საფერავი' : 'Saperavi'} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ღვინის ტიპი' : 'Wine class'}</label>
                  <select value={wineClass} onChange={e => setWineClass(e.target.value as WineClass)} className={inputCls}>
                    {WINE_CLASSES.map(c => <option key={c.key} value={c.key}>{ka ? c.ka : c.en}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'მოსავალი (წელი)' : 'Vintage'}</label>
                  <input type="number" value={vintage} onChange={e => setVintage(parseInt(e.target.value) || thisYear)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'თარიღი' : 'Date'}</label>
                  <DateInput lang={lang} value={date} onValueChange={setDate} className={inputCls} required />
                </div>
              </div>
            </FormSection>

            <FormSection
              icon={Scale}
              title={ka ? 'მასა და გამოსავალი' : 'Weight & yield'}
              description={ka
                ? 'ნეტო წონა ხელით შეიყვანეთ ან ბრუტოსა და ტარის მიხედვით ავტომატურად გამოთვალეთ.'
                : 'Enter net weight manually or calculate it from gross and tare.'}
              footer={(
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[
                    {
                      label: ka ? 'ნეტო' : 'Net weight',
                      value: `${net.toLocaleString()} kg`,
                      tone: 'text-stone-800 dark:text-amber-50',
                    },
                    {
                      label: ka ? 'სავარაუდო ტკბილი' : 'Est. must',
                      value: `${estVolumeL.toLocaleString()} L`,
                      tone: overfill ? 'text-rose-600' : 'text-[#4e0e15] dark:text-amber-300',
                    },
                    {
                      label: ka ? 'პოტ. ალკოჰოლი' : 'Potential ABV',
                      value: potentialAbv > 0 ? `${potentialAbv}%` : '—',
                      tone: 'text-stone-800 dark:text-amber-50',
                    },
                  ].map(metric => (
                    <div key={metric.label} className="rounded-lg border border-stone-200 bg-white px-2 py-2 dark:border-stone-800 dark:bg-stone-900">
                      <dt className="text-[8px] font-bold uppercase tracking-widest text-stone-400">{metric.label}</dt>
                      <dd className={`mt-0.5 font-mono text-sm font-black ${metric.tone}`}>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'ბრუტო (კგ)' : 'Gross (kg)'}</label>
                  <input type="number" min={0} step="0.001" value={grossWeightKg} onChange={e => handleGrossWeightChange(e.target.value)} placeholder="12500" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ტარა (კგ)' : 'Tare (kg)'}</label>
                  <input type="number" min={0} step="0.001" value={tareWeightKg} onChange={e => handleTareWeightChange(e.target.value)} placeholder="500" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ნეტო (კგ)' : 'Net weight (kg)'}</label>
                  <input type="number" min={0} step="0.001" value={netWeightKg} onChange={e => handleNetWeightChange(e.target.value)} placeholder="12000" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'გამოსავ. %' : 'Yield %'}</label>
                  <input type="number" min={1} max={100} value={juiceYieldPct} onChange={e => setYield(e.target.value)} className={inputCls} />
                </div>
              </div>
            </FormSection>

            <FormSection
              icon={FlaskConical}
              title={ka ? 'ხარისხი მიღებისას' : 'Quality at reception'}
              description={ka
                ? 'შემოსული ყურძნის ქიმია და მდგომარეობა.'
                : 'Chemistry and condition of the fruit as it arrives.'}
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className={labelCls}>°Brix</label>
                  <input type="number" step="0.1" value={brix} onChange={e => setBrix(e.target.value)} placeholder="22.5" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>pH</label>
                  <input type="number" step="0.01" value={ph} onChange={e => setPh(e.target.value)} placeholder="3.30" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'მჟავ. (TA)' : 'TA g/L'}</label>
                  <input type="number" step="0.1" value={ta} onChange={e => setTa(e.target.value)} placeholder="6.0" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ტემპ. °C' : 'Temp °C'}</label>
                  <input type="number" step="0.1" value={temperatureC} onChange={e => setTemp(e.target.value)} placeholder="18" className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'მდგომარეობა' : 'Condition'}</label>
                  <select value={condition} onChange={e => setCondition(e.target.value as GrapeIntakeCondition)} className={inputCls}>
                    {CONDITIONS.map(c => <option key={c.key} value={c.key}>{ka ? c.ka : c.en}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'კრეფა' : 'Picking'}</label>
                  <select value={pickingMethod} onChange={e => setPicking(e.target.value as 'hand' | 'machine')} className={inputCls}>
                    <option value="hand">{ka ? 'ხელით' : 'Hand'}</option>
                    <option value="machine">{ka ? 'მექანიკური' : 'Machine'}</option>
                  </select>
                </div>
              </div>
            </FormSection>

            {canPostIntakeCost && (
              <FormSection
                icon={Coins}
                title={ka ? 'ყურძნის ღირებულება' : 'Fruit cost'}
                description={ka
                  ? 'შეყვანილი თანხა ავტომატურად ჩაიწერება ხარჯების წიგნში.'
                  : 'What you enter here posts straight to the cost ledger.'}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>{ka ? 'ყურძნის ფასი / კგ' : `Fruit cost / kg (${currency})`}</label>
                    <input type="number" min={0} step="0.01" value={costPerKg} onChange={e => setCostPerKg(e.target.value)}
                      placeholder="0.00" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{ka ? 'სულ ყურძნის ხარჯი' : `Total fruit cost (${currency})`}</label>
                    <input type="number" min={0} step="0.01" value={totalCost} onChange={e => setTotalCost(e.target.value)}
                      placeholder={effectiveFruitRate > 0 && net > 0 ? String(Math.round(net * effectiveFruitRate * 100) / 100) : 'optional override'} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'გადახდის სტატუსი' : 'Payment status'}</label>
                  <select value={paymentStatus || 'not_applicable'} onChange={e => setPaymentStatus(e.target.value as GrapeIntakeRecord['paymentStatus'])} className={inputCls}>
                    <option value="not_applicable">{ka ? 'არ გამოიყენება' : 'Not applicable'}</option>
                    <option value="unpaid">{ka ? 'გადასახდელი' : 'Unpaid'}</option>
                    <option value="partial">{ka ? 'ნაწილობრივ' : 'Partial'}</option>
                    <option value="paid">{ka ? 'გადახდილია' : 'Paid'}</option>
                  </select>
                </div>
                {automaticOwnGrapeRate > 0 && !costPerKgNum && !explicitTotalCost && (
                  <InlineNotice tone="success">
                    {ka
                      ? `საკუთარი ყურძნის ავტომატური ფასი: ${automaticOwnGrapeRate.toFixed(2)} ${currency}/კგ`
                      : `Automatic own-grape rate: ${automaticOwnGrapeRate.toFixed(2)} ${currency}/kg`}
                  </InlineNotice>
                )}
                {computedFruitCost > 0 && (
                  <InlineNotice tone="success">
                    {ka ? 'ხარჯების წიგნში ჩაიწერება:' : 'Will post to cost ledger:'}{' '}
                    <strong className="font-mono">{computedFruitCost.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currency}</strong>
                  </InlineNotice>
                )}
              </FormSection>
            )}

            <FormSection
              icon={Warehouse}
              title={canFillDestinationVessel
                ? (ka ? 'დანიშნულება და ოპერატორი' : 'Destination & operator')
                : (ka ? 'ოპერატორი და შენიშვნები' : 'Operator & notes')}
              description={canFillDestinationVessel
                ? (ka
                  ? 'ჭურჭლის მინიჭება არჩევითია — მისი გაკეთება მოგვიანებითაც შეიძლება.'
                  : 'Assigning a vessel is optional; it can be done later.')
                : (ka
                  ? 'ვინ მიიღო ყურძენი და რა შენიშვნები ახლავს მიღებას.'
                  : 'Who received the fruit and any notes for this receipt.')}
            >
              <div className={`grid grid-cols-1 gap-2 ${canFillDestinationVessel ? 'sm:grid-cols-2' : ''}`}>
                {canFillDestinationVessel && (
                <div>
                  <label className={labelCls}>{ka ? 'დანიშნულების ჭურჭელი' : 'Destination vessel'}</label>
                  <select value={destinationVesselId} onChange={e => setDest(e.target.value)} className={inputCls}>
                    <option value="">{ka ? '— მოგვიანებით —' : '— assign later —'}</option>
                    {eligibleVessels.map(v => (
                      <option key={v.id} value={v.id}>{v.id} — {round1(v.capacity - v.currentVolume)} L {ka ? 'თავისუფ.' : 'free'}</option>
                    ))}
                  </select>
                </div>
                )}
                <div>
                  <label className={labelCls}>{ka ? 'ოპერატორი' : 'Operator'}</label>
                  <input type="text" value={operator} onChange={e => setOperator(e.target.value)} placeholder={currentUserName} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>{ka ? 'შენიშვნები' : 'Notes'}</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={ka ? 'მაგ. ჯანმრთელი მტევნები, მსუბუქი ბოტრიტისი' : 'e.g. healthy clusters, light botrytis'} className={inputCls} />
              </div>
              {overfill && (
                <InlineNotice tone="danger">
                  {ka
                    ? `სავარაუდო მოცულობა აღემატება ჭურჭლის თავისუფალ ტევადობას (${freeCapacity} L).`
                    : `Estimated volume exceeds the vessel’s free capacity (${freeCapacity} L).`}
                </InlineNotice>
              )}
              {/* Blocks submission without this the reviewer would only see a
                  disabled button and no reason. */}
              {destinationUnavailable && !overfill && (
                <InlineNotice tone="danger">
                  {ka
                    ? 'არჩეული ჭურჭელი დაკავებული ან დაუწმენდავია. აირჩიეთ სუფთა და ცარიელი ჭურჭელი.'
                    : 'The selected vessel is not clean and empty. Choose a clean, unassigned vessel.'}
                </InlineNotice>
              )}
            </FormSection>

            <div className="xl:col-span-2">
            <FormSection
              icon={FileText}
              title={ka ? 'ოფიციალური მიღების ველები' : 'Official receiving fields'}
              description={ka
                ? 'აკლებული გამოჩნდება დოკუმენტებში'
                : 'Missing values become document warnings'}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <div>
                  <label className={labelCls}>{ka ? 'ტრანსპორტი' : 'Transport name'}</label>
                  <input type="text" value={transportName} onChange={e => setTransportName(e.target.value)} placeholder={ka ? 'მძღოლი / კომპანია' : 'Driver / company'} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ტრანსპორტის ნომერი' : 'Transport number'}</label>
                  <input type="text" value={transportNumber} onChange={e => setTransportNumber(e.target.value)} placeholder="AA-000-AA" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'აწონის დოკ. №' : 'Weighing document no.'}</label>
                  <input type="text" value={weighingDocumentNumber} onChange={e => setWeighingDocumentNumber(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'ლაბ. ანალიზის №' : 'Lab analysis no.'}</label>
                  <input type="text" value={labAnalysisNumber} onChange={e => setLabAnalysisNumber(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'საკადასტრო კოდი' : 'Cadastral code'}</label>
                  <input type="text" value={cadastralCode} onChange={e => setCadastralCode(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'მუნიციპალიტეტი' : 'Municipality'}</label>
                  <input type="text" value={municipality} onChange={e => setMunicipality(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'სოფელი' : 'Village'}</label>
                  <input type="text" value={village} onChange={e => setVillage(e.target.value)} placeholder={ka ? 'სოფელი' : 'Village'} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{ka ? 'მიკროზონა' : 'Microzone'}</label>
                  <input type="text" value={microzone} onChange={e => setMicrozone(e.target.value)} list="georgian-microzone-options" placeholder={ka ? 'მიკროზონა' : 'Microzone'} className={inputCls} />
                </div>
              </div>
            </FormSection>
            </div>
          </div>

          <button onClick={handleSubmit} disabled={!canSubmit}
            className="sticky bottom-3 z-10 w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#4e0e15] hover:bg-[#34070a] disabled:opacity-50 disabled:cursor-not-allowed text-amber-50 rounded-xl text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors shadow-lg shadow-[#4e0e15]/20 lg:static lg:shadow-none">
            <CheckCircle2 className="w-4 h-4" /> {ka ? 'მიღების აღრიცხვა და პარტიის შექმნა' : 'Record intake & create batch'}
          </button>
        </div>
        )}

        {/* ── Recent intakes ────────────────────────────── */}
        <div id="grape-intake-history" className="scroll-mt-24 bg-white border border-[#e8dfd5] rounded-2xl shadow-sm overflow-hidden dark:bg-stone-900 dark:border-stone-800">
          <div className="px-4 py-3 border-b border-[#e8dfd5] flex items-center justify-between dark:border-stone-800">
            <span className="text-xs font-bold text-stone-700 flex items-center gap-1.5 dark:text-amber-100">
              <Grape className="w-4 h-4" /> {ka ? 'მიღების ჟურნალი' : 'Intake log'}
            </span>
            <span className="text-[9px] font-mono text-stone-400">{intakes.length} {ka ? 'ჩანაწერი' : 'records'}</span>
          </div>
          {canReverseHarvestIntake && (reversalIntake || pendingReversalIntent) && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold">
                    {ka ? 'ყურძნის მიღების შესწორება' : 'Correct grape intake'}
                    {reversalIntake ? ` · ${reversalIntake.variety}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium text-amber-800/80 dark:text-amber-200/80">
                    {ka
                      ? 'თავდაპირველი ჩანაწერი აუდიტში რჩება; დაკავშირებული მდგომარეობა კომპენსირებადი ჩანაწერებით აღდგება.'
                      : 'The original receipt remains in the audit trail; linked state is restored with compensating records.'}
                  </p>
                </div>
                {!pendingReversalIntent && (
                  <button type="button" onClick={() => { setReversalIntakeId(''); setReversalReason(''); }}
                    aria-label={ka ? 'შესწორების დახურვა' : 'Close correction'}
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
                  placeholder={ka ? 'რატომ არის შესწორება საჭირო?' : 'Why is this correction required?'} />
              </label>
              <button type="button" onClick={handleReverseIntake}
                disabled={isReversing || (!pendingReversalIntent && !reversalReason.trim())}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-900 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-amber-50 disabled:opacity-50 dark:bg-amber-700">
                <RotateCcw className="h-3.5 w-3.5" />
                {pendingReversalIntent
                  ? (ka ? 'იგივე შესწორების ხელახლა გაგზავნა' : 'Resubmit same correction')
                  : (ka ? 'შესწორების დადასტურება' : 'Confirm correction')}
              </button>
            </div>
          )}
          {intakes.length === 0 ? (
            <EmptyState
              icon={Grape}
              title={ka ? 'ყურძნის მიღება ჯერ არ არის' : 'No grape intakes yet'}
              description={canReceiveGrapes
                ? (ka
                  ? 'შეავსეთ მიღების ფორმა პირველი ხილის მისაღებად და ღვინის პარტიის შესაქმნელად.'
                  : 'Fill in the receiving form to receive fruit and create the first wine batch.')
                : (ka
                  ? 'არსებული მიღების ჩანაწერები აქ გამოჩნდება.'
                  : 'Existing intake records will appear here.')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-stone-400 font-bold dark:bg-stone-950">
                    <th className="p-2.5">{ka ? 'თარიღი' : 'Date'}</th>
                    <th className="p-2.5">{ka ? 'ჯიში / წყარო' : 'Variety / Source'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ნეტო' : 'Net'}</th>
                    <th className="p-2.5 text-right">{ka ? 'ტკბილი' : 'Must'}</th>
                    <th className="p-2.5">{ka ? 'პარტია' : 'Batch'}</th>
                    {canReverseHarvestIntake && <th className="p-2.5 text-right">{ka ? 'მოქმედება' : 'Action'}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 dark:divide-stone-800">
                  {intakes.map(r => (
                    <tr key={r.id} className="hover:bg-stone-50/50 dark:hover:bg-white/5">
                      <td className="p-2.5 font-mono text-stone-500 whitespace-nowrap">{r.date}</td>
                      <td className="p-2.5">
                        <span className="font-bold text-stone-800 dark:text-amber-50">{r.variety}</span>
                        {isHarvestIntakeReversal(r) && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-800">Correction</span>}
                        {r.reversedByCommandId && <span className="ml-1.5 rounded bg-stone-200 px-1.5 py-0.5 text-[8px] font-bold uppercase text-stone-600">Reversed</span>}
                        <span className="block text-[9px] font-mono text-stone-400">
                          {r.source === 'own' ? `🌿 ${r.blockName || (ka ? 'ვენახი' : 'block')}` : `🚚 ${r.supplierName || (ka ? 'მომწოდებელი' : 'supplier')}`}
                          {r.brix ? ` · ${r.brix}°Bx` : ''}
                        </span>
                      </td>
                      <td className="p-2.5 text-right font-bold whitespace-nowrap">{isHarvestIntakeReversal(r) ? '-' : ''}{(r.netWeightKg ?? 0).toLocaleString()} kg</td>
                      <td className="p-2.5 text-right font-mono text-[#4e0e15] dark:text-amber-300 whitespace-nowrap">{isHarvestIntakeReversal(r) ? '-' : ''}{(r.estimatedVolumeL ?? 0).toLocaleString()} L</td>
                      <td className="p-2.5">
                        <button onClick={() => openLot(r.createdLotId)}
                          className="text-[10px] font-mono text-[#4e0e15] hover:underline cursor-pointer flex items-center gap-0.5 dark:text-amber-300">
                          {r.createdLotId} <ArrowRight className="w-3 h-3" />
                        </button>
                      </td>
                      {canReverseHarvestIntake && (
                        <td className="p-2.5 text-right">
                          {isActiveHarvestIntake(r) && r.commandId && r.reversalSnapshot && (
                            <button type="button"
                              onClick={() => { setReversalIntakeId(r.id); setReversalReason(''); setCommandError(null); }}
                              title="Correct" aria-label={`Correct intake ${r.id}`}
                              className="text-stone-300 hover:text-amber-700 cursor-pointer transition-colors">
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </fieldset>
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(GrapeReceivingTab);
