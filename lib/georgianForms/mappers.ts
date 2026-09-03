/**
 * Data mappers: existing app entities → official form rows.
 *
 * Each mapper is keyed by a template's `dataSource`. Mappers that have no
 * corresponding app entity yet (distillation, spirits, concentrated must,
 * seedlings) are intentionally absent — the engine emits blank rows for those
 * and validation warns the user. Where a required official field has no app
 * source, the cell is left blank and marked with a TODO rather than faked.
 */

import type { ExportContext, DocRow, FormTemplate } from './types';
import type {
  VineyardBlock, WineLot, CellarOperation, CellarTransferRecord, TransferEvent, LabAnalysis,
} from '../wineryState';
import { CELLAR_OPERATIONS } from '../wineryOperations';
import { applyRunningBalance, litresToDal, round2 } from './balance';
import { isActiveBottlingRun, isBottlingRunReversal } from '../bottlingIntegrity';
import { harvestIntakeLedgerSign, isActiveHarvestIntake, isHarvestIntakeReversal } from '../harvestIntakeIntegrity';

type Mapper = (ctx: ExportContext) => DocRow[];

// ── helpers ────────────────────────────────────────────────────────────────

function inRange(date: string | undefined, ctx: ExportContext): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  return d >= ctx.dateRange.from && d <= ctx.dateRange.to;
}

/** Parse "2.0 x 1.0" / "2,0х1,0" spacing into [rowSpacing, vineSpacing]. */
function parseSpacing(spacing: string | undefined): [string, string] {
  if (!spacing) return ['', ''];
  const m = spacing.replace(',', '.').match(/([\d.]+)\s*[xXхХ*]\s*([\d.]+)/);
  if (m) return [m[1], m[2]];
  return [spacing, ''];
}

function splitLocation(block: VineyardBlock): { municipality: string; community: string; village: string } {
  return {
    municipality: block.municipality || '',
    community: block.community || '',
    village: block.village || '',
  };
}

function latestSugarForBlock(ctx: ExportContext, blockId: string): number | '' {
  const s = ctx.samplings
    .filter(x => x.blockId === blockId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return s ? round2(s.brix) : '';
}

function selectedBlocks(ctx: ExportContext): VineyardBlock[] {
  return ctx.blockId ? ctx.blocks.filter(b => b.id === ctx.blockId) : ctx.blocks;
}

function sugarCategoryLabel(category: WineLot['sugarCategory'], lang: ExportContext['lang']): string {
  if (!category) return '';
  const labels = lang === 'ka'
    ? { dry: 'მშრალი', semi_dry: 'ნახევრად მშრალი', semi_sweet: 'ნახევრად ტკბილი', sweet: 'ტკბილი' }
    : { dry: 'Dry', semi_dry: 'Semi-dry', semi_sweet: 'Semi-sweet', sweet: 'Sweet' };
  return labels[category];
}

type OfficialTransfer = CellarTransferRecord | TransferEvent;

function isCurrentTransfer(transfer: OfficialTransfer): transfer is CellarTransferRecord {
  return 'sourceId' in transfer;
}

function transferSourceId(transfer: OfficialTransfer): string {
  return isCurrentTransfer(transfer) ? transfer.sourceId : transfer.sourceTankId;
}

function transferDestinationId(transfer: OfficialTransfer): string {
  return isCurrentTransfer(transfer) ? transfer.destId : transfer.destTankId;
}

function transferNote(transfer: OfficialTransfer): string {
  return isCurrentTransfer(transfer)
    ? [transfer.category, transfer.details].filter(Boolean).join(' — ')
    : transfer.reason || '';
}

function latestLabForLot(ctx: ExportContext, lotId: string, onOrBefore?: string): LabAnalysis | undefined {
  return ctx.labLogs
    .filter(log => log.lotId === lotId && (!onOrBefore || (log.date || '').slice(0, 10) <= onOrBefore.slice(0, 10)))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

// ── Annex 1 / 16 — vineyard ──────────────────────────────────────────────────
const mapVineyard: Mapper = (ctx) => selectedBlocks(ctx).map(b => {
  const loc = splitLocation(b);
  const [rowD, vineD] = parseSpacing(b.spacing);
  return {
    parcelCadastral: b.cadastralCode || '',
    municipality: loc.municipality,
    community: loc.community,
    village: loc.village,
    parcelName: b.parcelName || b.name || '',
    variety: b.grapeVariety || '',
    areaSqm: round2(((b.parcelArea ?? b.area) || 0) * 10000), // ha -> sq.m
    plantingYear: b.plantingYear || '',
    rootstock: b.rootstock || '', // TODO: rootstock optional in app model
    rowDistance: rowD,
    vineDistance: vineD,
    irrigation: b.irrigationEnabled ? 'დიახ' : 'არა',
    condition: b.vineyardCondition || b.currentPhenology || b.farmingStatus || '',
  };
});

// ── Annex 2 — harvest journal ────────────────────────────────────────────────
const mapHarvest: Mapper = (ctx) => {
  const harvestRows = ctx.harvests
    .filter(h => (!ctx.blockId || h.blockId === ctx.blockId))
    .filter(h => Boolean(h.actualHarvestDate) && Number(h.actualHarvestedKg) > 0)
    .filter(h => inRange(h.actualHarvestDate, ctx))
    .map((h): DocRow => {
      const block = ctx.blocks.find(b => b.id === h.blockId);
      const area = h.harvestedAreaHa || 0;
      const tons = round2((h.actualHarvestedKg || 0) / 1000);
      return {
        date: (h.actualHarvestDate || '').slice(0, 10),
        parcelName: block?.name || h.blockId,
        variety: h.variety || block?.grapeVariety || '',
        areaHa: area > 0 ? round2(area) : '',
        tons,
        yieldPerHa: area > 0 ? round2(tons / area) : '',
        note: h.notes || '',
      };
    });

  const linkedHarvestIds = new Set(ctx.harvests
    .filter(h => Boolean(h.actualHarvestDate) && Number(h.actualHarvestedKg) > 0)
    .map(h => h.id));
  const intakeRows = (ctx.grapeIntakes || [])
    .filter(isActiveHarvestIntake)
    .filter(g => g.source === 'own' && (!g.harvestRecordId || !linkedHarvestIds.has(g.harvestRecordId)))
    .filter(g => !ctx.blockId || g.blockId === ctx.blockId)
    .filter(g => inRange(g.date, ctx))
    .map((g): DocRow => {
      const block = ctx.blocks.find(b => b.id === g.blockId);
      const area = g.harvestedAreaHa || 0;
      const tons = round2((g.netWeightKg || 0) / 1000);
      return {
        date: (g.date || '').slice(0, 10),
        parcelName: g.blockName || block?.name || g.blockId || '',
        variety: g.variety || block?.grapeVariety || '',
        areaHa: area > 0 ? round2(area) : '',
        tons,
        yieldPerHa: area > 0 ? round2(tons / area) : '',
        note: g.notes || '',
      };
    });

  return [...harvestRows, ...intakeRows]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
};

// ── Annex 3 — grape reception ────────────────────────────────────────────────
// Primary source: structured grape intakes (gross/tare/net + reception sugar +
// supplier captured at the weighbridge). Falls back to harvest-derived rows for
// legacy accounts that recorded field dispatches before the intake module.
const mapGrapeReception: Mapper = (ctx) => {
  const intakes = (ctx.grapeIntakes || [])
    .filter(g => (!ctx.blockId || g.blockId === ctx.blockId))
    .filter(g => inRange(g.date, ctx))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  if (intakes.length > 0) {
    return intakes.map((g, i): DocRow => {
      const sign = harvestIntakeLedgerSign(g);
      const block = ctx.blocks.find(b => b.id === g.blockId);
      const supplier = g.source === 'supplier'
        ? (g.supplierName || '')
        : (g.blockName || block?.vineyardName || ctx.company.companyName || '');
      return {
        no: i + 1,
        date: (g.date || '').slice(0, 10),
        supplier,
        variety: g.variety || block?.grapeVariety || '',
        location: [
          g.village || block?.village,
          g.community || block?.community,
          g.municipality || block?.municipality,
          g.microzone || block?.microzone,
        ].filter(Boolean).join(', ') || block?.locationName || (g.source === 'supplier' ? (g.supplierName || '') : ''),
        transport: [g.transportName, g.transportNumber].filter(Boolean).join(' / '),
        brutto: g.grossWeightKg != null ? round2(sign * g.grossWeightKg) : '',
        tara: g.tareWeightKg != null ? round2(sign * g.tareWeightKg) : '',
        netto: g.netWeightKg != null ? round2(sign * g.netWeightKg) : '',
        analysisNo: g.labAnalysisNumber || '',
        sugar: g.brix ? round2(g.brix) : '',
        note: [
          isHarvestIntakeReversal(g) ? `CORRECTION of ${g.reversalOfIntakeId || ''}: ${g.reversalReason || ''}` : '',
          g.weighingDocumentNumber ? `weighing ${g.weighingDocumentNumber}` : '',
          g.cadastralCode || block?.cadastralCode ? `cadastre ${g.cadastralCode || block?.cadastralCode}` : '',
          g.supplierIdCode ? `supplier ID ${g.supplierIdCode}` : '',
          (g.grapePrice ?? g.costPerKg) != null ? `price ${round2((g.grapePrice ?? g.costPerKg) as number)} ${g.currency || ctx.company.currency || 'GEL'}/kg` : '',
          g.paymentStatus ? `payment ${g.paymentStatus}` : '',
          g.notes || '',
        ].filter(Boolean).join(' | '),
      };
    });
  }

  return ctx.harvests
    .filter(h => h.sentToGvino && (!ctx.blockId || h.blockId === ctx.blockId))
    .filter(h => inRange(h.actualHarvestDate || h.estimatedHarvestDate, ctx))
    .sort((a, b) => ((a.actualHarvestDate || '') < (b.actualHarvestDate || '') ? -1 : 1))
    .map((h, i): DocRow => {
      const block = ctx.blocks.find(b => b.id === h.blockId);
      const net = h.actualHarvestedKg != null ? round2(h.actualHarvestedKg) : '';
      return {
        no: i + 1,
        date: (h.actualHarvestDate || '').slice(0, 10),
        supplier: ctx.company.companyName || block?.vineyardName || '', // TODO: per-supplier model
        variety: h.variety || block?.grapeVariety || '',
        location: block?.locationName || '',
        transport: '', // TODO: transport not tracked in app
        brutto: '', // gross/tare unknown for legacy harvest dispatches
        tara: '',
        netto: net,
        analysisNo: '',
        sugar: latestSugarForBlock(ctx, h.blockId),
        note: h.notes || '',
      };
    });
};

// ── Annex 4 — wine movement journal (running balance) ────────────────────────
const mapWineMovement: Mapper = (ctx) => {
  const lots: WineLot[] = ctx.lotId ? ctx.lots.filter(l => l.id === ctx.lotId) : ctx.lots;
  const rows: DocRow[] = [];

  for (const lot of lots) {
    // Production-in: the lot's initial volume enters from crush/production.
    if (inRange(lot.createdAt, ctx) || !lot.createdAt) {
      rows.push({
        date: (lot.createdAt || ctx.dateRange.from).slice(0, 10),
        fromTo: `წარმოება / ${lot.vineyardBlock || lot.region || ''}`.trim(),
        incoming: litresToDal(lot.initialVolume || 0),
        outgoing: 0,
        balance: 0,
        note: `${lot.name} (${lot.id})`,
      });
    }
    if (lot.voidedAt && inRange(lot.voidedAt, ctx)) {
      rows.push({
        date: lot.voidedAt.slice(0, 10),
        fromTo: 'Accounting correction',
        incoming: 0,
        outgoing: litresToDal(lot.initialVolume || 0),
        balance: 0,
        note: `VOID ${lot.id}: ${lot.voidReason || ''}`.trim(),
      });
    }
  }

  // Tank transfers touching the selected lot's currently-assigned vessels.
  const lotIds = new Set(lots.map(l => l.id));
  const lotTanks = new Set(ctx.vessels.filter(v => v.assignedLotId && lotIds.has(v.assignedLotId)).map(v => v.id));
  for (const tr of ctx.transfers.filter(t => inRange(t.date, ctx))) {
    const sourceId = transferSourceId(tr);
    const destId = transferDestinationId(tr);
    const isOut = isCurrentTransfer(tr) && tr.sourceLotId
      ? lotIds.has(tr.sourceLotId)
      : lotTanks.has(sourceId);
    const isIn = isCurrentTransfer(tr) && (tr.resultLotId || tr.destinationLotId)
      ? Boolean((tr.resultLotId && lotIds.has(tr.resultLotId)) || (tr.destinationLotId && lotIds.has(tr.destinationLotId)))
      : lotTanks.has(destId);
    if (!isOut && !isIn) continue;
    const outgoingL = isCurrentTransfer(tr) ? (tr.sourceContributionL ?? tr.volume) : tr.volume;
    const incomingL = isCurrentTransfer(tr) ? (tr.arrivalVolumeL ?? Math.max(0, tr.volume - tr.loss)) : Math.max(0, tr.volume - tr.loss);
    rows.push({
      date: tr.date.slice(0, 10),
      fromTo: `${sourceId} → ${destId}`,
      incoming: isIn ? litresToDal(incomingL) : 0,
      outgoing: isOut ? litresToDal(outgoingL) : 0,
      balance: 0,
      note: transferNote(tr),
    });
  }

  rows.sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  applyRunningBalance(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
  return rows;
};

// ── Annex 5 — wine aging act (lots currently aging) ──────────────────────────
const mapWineAging: Mapper = (ctx) => {
  const lots = (ctx.lotId ? ctx.lots.filter(l => l.id === ctx.lotId) : ctx.lots)
    .filter(l => l.stage === 'aging');
  return lots.map((lot): DocRow => {
    const vessel = ctx.vessels.find(v => v.assignedLotId === lot.id);
    const lab = ctx.labLogs.filter(x => x.lotId === lot.id).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const placeEntry = (lot.history || []).find(h => /aging|დავარგ/i.test(h.type) || /aging|დავარგ/i.test(h.description));
    return {
      placeDate: (placeEntry?.date || lot.createdAt || '').slice(0, 10),
      vesselNo: vessel?.id || '', // TODO: barrel № not separately modelled
      placeQty: litresToDal(lot.currentVolume || lot.initialVolume || 0),
      placeAlc: lab ? round2(lab.alcoholPct) : '',
      placeSugar: lab ? round2(lab.residualSugar) : '',
      placeAcid: lab ? round2(lab.titratableAcidity) : '',
      removeDate: '', // TODO: removal recorded only when lot leaves aging
      removeQty: '',
      removeAlc: '',
      removeSugar: '',
      removeAcid: '',
      balance: litresToDal(lot.currentVolume || 0),
    };
  });
};

// ── Annex 6 — wine blending act ──────────────────────────────────────────────
const mapWineBlending: Mapper = (ctx) => {
  const lot = ctx.lotId ? ctx.lots.find(l => l.id === ctx.lotId) : undefined;
  if (!lot) return []; // blending requires a target lot; warn + blank otherwise
  const blendTransfers = ctx.transfers
    .filter(isCurrentTransfer)
    .filter(tr => tr.recordKind !== 'reversal' && !tr.reversedByCommandId)
    .filter(tr => tr.resultLotId === lot.id && Number(tr.destinationContributionL) > 0)
    .filter(tr => inRange(tr.date, ctx));

  if (blendTransfers.length > 0) {
    const rows: DocRow[] = [];
    for (const tr of blendTransfers) {
      const components = [
        { lotId: tr.destinationLotId, litres: tr.destinationContributionL || 0 },
        { lotId: tr.sourceLotId, litres: tr.sourceContributionL ?? tr.volume },
      ].filter((component): component is { lotId: string; litres: number } => Boolean(component.lotId) && component.litres > 0);
      for (const component of components) {
        const componentLot = ctx.lots.find(item => item.id === component.lotId);
        const lab = latestLabForLot(ctx, component.lotId, tr.date);
        const qty = litresToDal(component.litres);
        const alcohol = lab && Number.isFinite(lab.alcoholPct) ? round2(lab.alcoholPct) : '';
        const sugarPct = lab && Number.isFinite(lab.residualSugar) ? round2(lab.residualSugar / 10) : '';
        rows.push({
          no: rows.length + 1,
          material: componentLot ? `${componentLot.name} (${componentLot.id})` : component.lotId,
          qty,
          analysisNo: lab?.id || '',
          alc: alcohol,
          sugar: sugarPct,
          spirit: typeof alcohol === 'number' ? round2(qty * alcohol) : '',
          sugarTotal: typeof sugarPct === 'number' ? round2(qty * sugarPct) : '',
          note: `${tr.date.slice(0, 10)} · ${tr.sourceId} → ${tr.destId}`,
        });
      }
    }
    return rows;
  }

  const blendEvents = (lot.history || []).filter(h => /blend|კუპაჟ|coupage/i.test(h.type + h.description));
  return blendEvents.map((h, i): DocRow => ({
    no: i + 1,
    material: h.description || '',
    qty: '', // TODO: per-component blend volumes not modelled
    analysisNo: '',
    alc: '',
    sugar: '',
    spirit: '',
    sugarTotal: '',
    note: h.date?.slice(0, 10) || '',
  }));
};

/** Real bottling runs recorded by the Bottling tab (localStorage, guarded for tests). */
/** Bottling runs in range (+ optional lot filter), oldest first. */
function bottlingRunsInRange(ctx: ExportContext, auditLedger = false) {
  return (ctx.bottlingRuns || [])
    .filter(r => (auditLedger || isActiveBottlingRun(r))
      && (!ctx.lotId || r.lotId === ctx.lotId) && inRange(r.date, ctx))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function averagePackagedUnitLitres(ctx: ExportContext, lotId: string): number {
  let litres = 0;
  let units = 0;
  for (const run of (ctx.bottlingRuns || [])) {
    if (!isActiveBottlingRun(run) || run.lotId !== lotId) continue;
    const runUnits = (run.totalBottles || 0) + (run.totalCeramic || 0);
    if (runUnits <= 0 || !(run.volumeBottledL > 0)) continue;
    litres += run.volumeBottledL;
    units += runUnits;
  }
  return units > 0 ? litres / units : 0.75;
}

// ── Annex 7 — bottling act ───────────────────────────────────────────────────
const mapBottling: Mapper = (ctx) => {
  // Prefer actual bottling runs (with per-format bottle/ceramic counts); fall
  // back to a lot-volume estimate for lots bottled before runs were tracked.
  const runs = bottlingRunsInRange(ctx);
  if (runs.length > 0) {
    return runs
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((r): DocRow => ({
        wineNo: r.lotId,
        lotNo: r.lotNumber || r.lotId,
        inDate: '',
        inQty: '',
        fillDate: r.date.slice(0, 10),
        fillQty: litresToDal(r.volumeBottledL),
        bottles: r.totalBottles,
        ceramic: r.totalCeramic || '',
        note: r.lotName,
      }));
  }

  const lots = (ctx.lotId ? ctx.lots.filter(l => l.id === ctx.lotId) : ctx.lots)
    .filter(l => l.stage === 'bottled' || l.stage === 'sold');
  return lots.map((lot): DocRow => {
    const fill = (lot.history || []).find(h => /bottl|ჩამოსხ/i.test(h.type + h.description));
    return {
      wineNo: lot.id,
      lotNo: lot.id,
      inDate: (lot.createdAt || '').slice(0, 10),
      inQty: litresToDal(Math.max(0, lot.initialVolume || 0)),
      fillDate: (fill?.date || '').slice(0, 10),
      fillQty: litresToDal(lot.initialVolume - lot.currentVolume > 0 ? lot.initialVolume - lot.currentVolume : lot.initialVolume),
      bottles: '', // TODO: no per-format counts for pre-tracking lots
      ceramic: '',
      note: lot.name,
    };
  });
};

// ── Annex 8 — finished goods warehouse movement ──────────────────────────────
// Finished goods enter the warehouse from bottling, so the "incoming" column is
// driven by the same bottling runs as Annex №7 — the two forms reconcile by
// construction (Σ Annex 8 incoming === Σ Annex 7 fill quantity). Sales/dispatch
// are not tracked yet, so outgoing stays 0 and the balance is goods on hand.
const mapWarehouse: Mapper = (ctx) => {
  const ka = ctx.lang === 'ka';
  const runs = bottlingRunsInRange(ctx, true);
  const dispatches = (ctx.salesDispatches || [])
    .filter(d => (!ctx.lotId || d.lotId === ctx.lotId) && inRange(d.date, ctx));

  if (runs.length > 0 || dispatches.length > 0) {
    // Dispatches are recorded in bottles; value them in the same dal unit as the
    // incoming column using each lot's average litres/bottle from its bottling
    // runs (falling back to a standard 0.75 L bottle).
    const volAgg = new Map<string, { litres: number; units: number }>();
    for (const r of (ctx.bottlingRuns || [])) {
      if (isBottlingRunReversal(r)) continue;
      const units = (r.totalBottles || 0) + (r.totalCeramic || 0);
      if (units <= 0 || !(r.volumeBottledL > 0)) continue;
      const a = volAgg.get(r.lotId) || { litres: 0, units: 0 };
      a.litres += r.volumeBottledL;
      a.units += units;
      volAgg.set(r.lotId, a);
    }
    const litresPerBottle = (lotId: string): number => {
      const a = volAgg.get(lotId);
      return a && a.units > 0 ? a.litres / a.units : 0.75;
    };

    const rows: DocRow[] = [];
    for (const r of runs) {
      const isCorrection = isBottlingRunReversal(r);
      rows.push({
        date: r.date.slice(0, 10),
        fromTo: `${isCorrection ? (ka ? 'ჩამოსხმის კორექცია' : 'Bottling correction') : (ka ? 'ჩამოსხმა' : 'Bottling')} / ${r.lotName}${r.lotNumber ? ` (${r.lotNumber})` : ''}`,
        incoming: isCorrection ? 0 : litresToDal(r.volumeBottledL || 0),
        outgoing: isCorrection ? litresToDal(r.volumeBottledL || 0) : 0,
        balance: 0,
      });
    }
    for (const d of dispatches) {
      const isReturn = d.recordKind === 'reversal';
      const quantityDal = litresToDal((d.bottles || 0) * litresPerBottle(d.lotId));
      rows.push({
        date: (d.date || '').slice(0, 10),
        fromTo: `${isReturn ? (ka ? 'დაბრუნება / კორექცია' : 'Return / correction') : (ka ? 'რეალიზაცია' : 'Sale')} / ${d.customerName || d.lotName || ''}`.trim(),
        incoming: isReturn ? quantityDal : 0,
        outgoing: isReturn ? 0 : quantityDal,
        balance: 0,
      });
    }
    rows.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
    applyRunningBalance(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
    return rows;
  }

  // Fallback for lots bottled before runs were tracked: estimate finished goods
  // from the volume that left the lot (initial − current).
  const lots = (ctx.lotId ? ctx.lots.filter(l => l.id === ctx.lotId) : ctx.lots)
    .filter(l => l.stage === 'bottled' || l.stage === 'sold');
  const rows: DocRow[] = lots.map((lot): DocRow => ({
    date: (lot.createdAt || ctx.dateRange.from).slice(0, 10),
    fromTo: `${ka ? 'ჩამოსხმა' : 'Bottling'} / ${lot.name}`,
    incoming: litresToDal(Math.max(0, (lot.initialVolume || 0) - (lot.currentVolume || 0)) || (lot.initialVolume || 0)),
    outgoing: 0,
    balance: 0,
  }));
  rows.sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  applyRunningBalance(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
  return rows;
};

/** Localised label for a cellar operation type. */
function opLabel(op: CellarOperation, lang: ExportContext['lang']): string {
  if (op.type === 'custom') return op.customLabel || (lang === 'ka' ? 'სხვა' : 'Custom');
  const m = CELLAR_OPERATIONS.find(o => o.key === op.type);
  return m ? (lang === 'ka' ? m.ka : m.en) : op.type;
}

// ── Annex 13 — auxiliary materials movement journal ──────────────────────────
// Receipt/reversal movements come from Procurement; consumption/restoration
// movements come from Cellar Operations. The opening row is reconstructed so
// the ledger closes at the Inventory module's authoritative current stock.
const mapMaterials: Mapper = (ctx) => {
  const items = ctx.inventory.filter(i =>
    /addit|yeast|nutri|bentonit|gelat|ferment|საფუარ|ბენტონ|ჟელატ|ფერმენ/i.test(i.category + i.name)
    && (!ctx.materialId || i.id === ctx.materialId));

  const usageAll = (ctx.cellarOps || []).filter(o =>
    o.materialId && typeof o.dose === 'number' && o.dose > 0 && inRange(o.date, ctx));
  const inventoryMovements = (ctx.inventoryMovements || [])
    .filter(m => inRange(m.occurredAt, ctx));
  const receiptById = new Map((ctx.invoiceReceipts || []).map(receipt => [receipt.id, receipt]));

  const ka = ctx.lang === 'ka';
  const rows: DocRow[] = [];

  for (const i of items) {
    const usage = usageAll
      .filter(o => o.materialId === i.id)
      .sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));
    const procurement = inventoryMovements
      .filter(movement => movement.inventoryItemId === i.id)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    if (usage.length === 0 && procurement.length === 0) {
      // No movements in range: present current stock as a standing balance.
      rows.push({
        date: ctx.dateRange.to,
        docNo: '',
        fromTo: `${i.supplierName || ''} — ${i.name}`.trim(),
        incoming: round2(i.stock),
        outgoing: 0,
        balance: round2(i.stock),
      });
      continue;
    }

    const usageOut = usage.reduce((acc, o) => acc + (o.recordKind === 'reversal' ? 0 : (o.dose || 0)), 0);
    const usageIn = usage.reduce((acc, o) => acc + (o.recordKind === 'reversal' ? (o.dose || 0) : 0), 0);
    const procurementIn = procurement.reduce((acc, movement) => acc + (movement.direction === 'in' ? movement.quantity : 0), 0);
    const procurementOut = procurement.reduce((acc, movement) => acc + (movement.direction === 'out' ? movement.quantity : 0), 0);
    const opening = round2(i.stock - procurementIn + procurementOut + usageOut - usageIn);
    const block: DocRow[] = [{
      date: ctx.dateRange.from,
      docNo: '',
      fromTo: `${i.name} — ${ka ? 'ნაშთი პერიოდის დასაწყისში' : 'opening balance'}`,
      incoming: opening,
      outgoing: 0,
      balance: 0,
    }];
    for (const movement of procurement) {
      const receipt = receiptById.get(movement.invoiceReceiptId);
      const incoming = movement.direction === 'in';
      block.push({
        date: movement.occurredAt.slice(0, 10),
        docNo: receipt?.invoice.invoiceNumber || movement.invoiceReceiptId,
        fromTo: incoming
          ? `${receipt?.invoice.supplierName || i.supplierName || (ka ? 'მომწოდებელი' : 'supplier')} — ${i.name}`
          : `${i.name} — ${ka ? 'მიღების შესწორება' : 'receipt correction'}`,
        incoming: incoming ? round2(movement.quantity) : 0,
        outgoing: incoming ? 0 : round2(movement.quantity),
        balance: 0,
      });
    }
    for (const o of usage) {
      const correction = o.recordKind === 'reversal';
      block.push({
        date: (o.date || '').slice(0, 10),
        docNo: o.id,
        fromTo: `${correction ? (ka ? 'შესწორება' : 'correction') : (ka ? 'გამოყენება' : 'used')} — ${o.lotName} (${opLabel(o, ctx.lang)})`,
        incoming: correction ? round2(o.dose || 0) : 0,
        outgoing: correction ? 0 : round2(o.dose || 0),
        balance: 0,
      });
    }
    block.splice(1, block.length - 1, ...block.slice(1).sort((a, b) => String(a.date).localeCompare(String(b.date))));
    applyRunningBalance(block, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
    rows.push(...block);
  }

  return rows;
};

// ── Annex 17 — grape processing summary (by variety) ─────────────────────────
const mapProcessingSummary: Mapper = (ctx) => {
  const byVariety = new Map<string, { tons: number; sugars: number[]; wineDal: number }>();
  const processingLots = ctx.lots.filter(item => !item.voidedAt && (
    (ctx.accountingYear && String(item.vintage) === ctx.accountingYear)
    || inRange(item.createdAt, ctx)
  ));
  const received = (ctx.grapeIntakes || [])
    .filter(isActiveHarvestIntake)
    .filter(g => inRange(g.date, ctx));
  if (received.length > 0) {
    for (const g of received) {
      const v = g.variety || 'უცნობი';
      const e = byVariety.get(v) || { tons: 0, sugars: [], wineDal: 0 };
      e.tons += (g.netWeightKg || 0) / 1000;
      if (Number.isFinite(g.brix) && g.brix > 0) e.sugars.push(g.brix);
      byVariety.set(v, e);
    }
  } else {
    for (const h of ctx.harvests.filter(h => Boolean(h.actualHarvestDate) && Number(h.actualHarvestedKg) > 0 && inRange(h.actualHarvestDate, ctx))) {
      const v = h.variety || 'უცნობი';
      const e = byVariety.get(v) || { tons: 0, sugars: [], wineDal: 0 };
      e.tons += (h.actualHarvestedKg || 0) / 1000;
      const s = latestSugarForBlock(ctx, h.blockId);
      if (typeof s === 'number') e.sugars.push(s);
      byVariety.set(v, e);
    }
  }
  for (const lot of processingLots) {
    const v = lot.variety || 'უცნობი';
    const e = byVariety.get(v) || { tons: 0, sugars: [], wineDal: 0 };
    e.wineDal += litresToDal(lot.initialVolume || 0);
    byVariety.set(v, e);
  }
  return [...byVariety.entries()].map(([variety, e]): DocRow => {
    const lots = processingLots.filter(l => (l.variety || '') === variety);
    const pdoWine = lots.filter(l => l.classification === 'PDO').reduce((sum, l) => sum + litresToDal(l.initialVolume || 0), 0);
    const pgiWine = lots.filter(l => l.classification === 'PGI').reduce((sum, l) => sum + litresToDal(l.initialVolume || 0), 0);
    const otherWine = lots.filter(l => l.classification !== 'PDO' && l.classification !== 'PGI').reduce((sum, l) => sum + litresToDal(l.initialVolume || 0), 0);
    const categoriesComplete = lots.length > 0 && lots.every(lot => Boolean(lot.sugarCategory));
    const sugarCategories = categoriesComplete
      ? [...new Set(lots.map(lot => sugarCategoryLabel(lot.sugarCategory, ctx.lang)).filter(Boolean))]
      : [];
    return {
      variety,
      grapeTons: round2(e.tons),
      avgSugar: e.sugars.length ? round2(e.sugars.reduce((a, b) => a + b, 0) / e.sugars.length) : '',
      wineCategory: sugarCategories.join(', '),
      wineTotal: round2(e.wineDal),
      pdoWine: pdoWine ? round2(pdoWine) : '',
      pgiWine: pgiWine ? round2(pgiWine) : '',
      otherWine: otherWine ? round2(otherWine) : '',
      distillWine: '',
    };
  });
};

// ── Annex 18 — wine turnover notification (per lot) ──────────────────────────
const mapWineTurnover: Mapper = (ctx) => {
  return ctx.lots
    .filter(lot => (lot.createdAt || '').slice(0, 10) <= ctx.dateRange.to
      || ctx.salesDispatches.some(dispatch => dispatch.lotId === lot.id && inRange(dispatch.date, ctx)))
    .map((lot): DocRow => {
    const produced = litresToDal(lot.initialVolume || 0);
    const unitLitres = averagePackagedUnitLitres(ctx, lot.id);
    const dispatchDal = (dispatches: ExportContext['salesDispatches']): number => round2(dispatches.reduce((sum, dispatch) => {
      const sign = dispatch.recordKind === 'reversal' ? -1 : 1;
      return sum + sign * litresToDal((dispatch.bottles || 0) * unitLitres);
    }, 0));
    const allLotDispatches = ctx.salesDispatches.filter(dispatch => dispatch.lotId === lot.id);
    const priorDispatches = allLotDispatches.filter(dispatch => (dispatch.date || '').slice(0, 10) < ctx.dateRange.from);
    const periodDispatches = allLotDispatches.filter(dispatch => inRange(dispatch.date, ctx));
    const outExport = dispatchDal(periodDispatches.filter(dispatch => dispatch.marketChannel === 'export'));
    const outDomestic = dispatchDal(periodDispatches.filter(dispatch => dispatch.marketChannel === 'domestic'));
    const blendOut = round2(ctx.transfers
      .filter(isCurrentTransfer)
      .filter(transfer => transfer.recordKind !== 'reversal' && !transfer.reversedByCommandId)
      .filter(transfer => transfer.sourceLotId === lot.id && transfer.resultLotId !== lot.id && inRange(transfer.date, ctx))
      .reduce((sum, transfer) => sum + litresToDal(transfer.sourceContributionL ?? transfer.volume), 0));
    const createdInRange = inRange(lot.createdAt, ctx);
    const openBalance = (lot.createdAt || '').slice(0, 10) < ctx.dateRange.from
      ? Math.max(0, round2(produced - dispatchDal(priorDispatches)))
      : 0;
    const inOwn = createdInRange ? produced : 0;
    const availableBeforeCategoryChange = Math.max(0, round2(openBalance + inOwn - outExport - outDomestic - blendOut));
    const outCategory = lot.voidedAt && inRange(lot.voidedAt, ctx) ? availableBeforeCategoryChange : 0;
    const closing = Math.max(0, round2(availableBeforeCategoryChange - outCategory));
    return {
      wineName: lot.name,
      typeColor: lot.wineClass,
      vintage: lot.vintage,
      openBalance,
      inOwn,
      inBought: 0, // TODO: purchases not tracked
      outExport,
      outDomestic,
      outBlend: blendOut,
      outCategory,
      outDistill: 0,
      closeBalance: closing,
    };
  });
};

export const MAPPERS: Record<string, Mapper> = {
  blocks: mapVineyard,
  harvests: mapHarvest,
  grapeReception: mapGrapeReception,
  wineMovements: mapWineMovement,
  wineAging: mapWineAging,
  wineBlending: mapWineBlending,
  bottling: mapBottling,
  warehouse: mapWarehouse,
  materials: mapMaterials,
  processingSummary: mapProcessingSummary,
  wineTurnover: mapWineTurnover,
};

/** Resolve rows for a template; empty array when there is no mapper/data. */
export function mapRows(template: FormTemplate, ctx: ExportContext): DocRow[] {
  if (ctx.mode === 'blank') return [];
  const mapper = template.dataSource ? MAPPERS[template.dataSource] : undefined;
  if (!mapper) return [];
  try {
    return mapper(ctx);
  } catch {
    return [];
  }
}
