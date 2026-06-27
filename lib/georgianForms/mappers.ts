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
import type { VineyardBlock, WineLot, HarvestRecord, CellarOperation } from '../wineryState';
import { CELLAR_OPERATIONS } from '../wineryOperations';
import { applyRunningBalance, litresToDal, round2, toNum } from './balance';

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

/** locationName is a free string ("Telavi, Kakheti, Georgia"); split best-effort. */
function splitLocation(block: VineyardBlock): { municipality: string; community: string; village: string } {
  const parts = (block.locationName || '').split(',').map(s => s.trim()).filter(Boolean);
  // Heuristic: [village, municipality/region, country] — keep it transparent.
  if (parts.length >= 2) return { municipality: parts[1] || '', community: '', village: parts[0] || '' };
  return { municipality: parts[0] || '', community: '', village: '' };
}

function blockName(ctx: ExportContext, blockId: string): string {
  return ctx.blocks.find(b => b.id === blockId)?.name || blockId;
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

// ── Annex 1 / 16 — vineyard ──────────────────────────────────────────────────
const mapVineyard: Mapper = (ctx) => selectedBlocks(ctx).map(b => {
  const loc = splitLocation(b);
  const [rowD, vineD] = parseSpacing(b.spacing);
  return {
    parcelCadastral: b.id || '',
    municipality: loc.municipality,
    community: loc.community,
    village: loc.village || b.vineyardName || '',
    parcelName: b.name || '',
    variety: b.grapeVariety || '',
    areaSqm: round2((b.area || 0) * 10000), // ha → sq.m
    plantingYear: b.plantingYear || '',
    rootstock: b.rootstock || '', // TODO: rootstock optional in app model
    rowDistance: rowD,
    vineDistance: vineD,
    irrigation: b.irrigationEnabled ? 'დიახ' : 'არა',
    condition: b.currentPhenology || b.farmingStatus || '',
  };
});

// ── Annex 2 — harvest journal ────────────────────────────────────────────────
const mapHarvest: Mapper = (ctx) => {
  const rows = ctx.harvests
    .filter(h => (!ctx.blockId || h.blockId === ctx.blockId))
    .filter(h => inRange(h.actualHarvestDate || h.estimatedHarvestDate, ctx))
    .sort((a, b) => ((a.actualHarvestDate || '') < (b.actualHarvestDate || '') ? -1 : 1))
    .map((h): DocRow => {
      const block = ctx.blocks.find(b => b.id === h.blockId);
      const area = block?.area || 0;
      const tons = h.actualHarvestedKg != null ? round2(h.actualHarvestedKg / 1000) : round2(h.estimatedTons || 0);
      return {
        date: (h.actualHarvestDate || h.estimatedHarvestDate || '').slice(0, 10),
        parcelName: block?.name || h.blockId,
        variety: h.variety || block?.grapeVariety || '',
        areaHa: round2(area),
        tons,
        yieldPerHa: area > 0 ? round2(tons / area) : '',
        note: h.notes || '',
      };
    });
  return rows;
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
      const block = ctx.blocks.find(b => b.id === g.blockId);
      const supplier = g.source === 'supplier'
        ? (g.supplierName || '')
        : (g.blockName || block?.vineyardName || ctx.company.companyName || '');
      return {
        no: i + 1,
        date: (g.date || '').slice(0, 10),
        supplier,
        variety: g.variety || block?.grapeVariety || '',
        location: block?.locationName || (g.source === 'supplier' ? (g.supplierName || '') : ''),
        transport: '', // TODO: transport not tracked in app
        brutto: g.grossWeightKg != null ? round2(g.grossWeightKg) : '',
        tara: g.tareWeightKg != null ? round2(g.tareWeightKg) : '',
        netto: g.netWeightKg != null ? round2(g.netWeightKg) : '',
        analysisNo: '', // TODO: lab analysis № not linked to reception
        sugar: g.brix ? round2(g.brix) : '',
        note: g.notes || '',
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
  }

  // Tank transfers touching the selected lot's currently-assigned vessels.
  const lotIds = new Set(lots.map(l => l.id));
  const lotTanks = new Set(ctx.vessels.filter(v => v.assignedLotId && lotIds.has(v.assignedLotId)).map(v => v.id));
  for (const tr of ctx.transfers.filter(t => inRange(t.date, ctx))) {
    const isOut = lotTanks.has(tr.sourceTankId);
    const isIn = lotTanks.has(tr.destTankId);
    if (!isOut && !isIn) continue;
    rows.push({
      date: tr.date.slice(0, 10),
      fromTo: `${tr.sourceTankId} → ${tr.destTankId}`,
      incoming: isIn ? litresToDal(tr.volume) : 0,
      outgoing: isOut ? litresToDal(tr.volume) : 0,
      balance: 0,
      note: tr.reason || '',
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

// ── Annex 6 — wine blending act (best-effort from lot history) ───────────────
const mapWineBlending: Mapper = (ctx) => {
  const lot = ctx.lotId ? ctx.lots.find(l => l.id === ctx.lotId) : undefined;
  if (!lot) return []; // blending requires a target lot; warn + blank otherwise
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
function bottlingRunsInRange(ctx: ExportContext) {
  return (ctx.bottlingRuns || [])
    .filter(r => (!ctx.lotId || r.lotId === ctx.lotId) && inRange(r.date, ctx))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
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
  const runs = bottlingRunsInRange(ctx);
  const dispatches = (ctx.salesDispatches || [])
    .filter(d => (!ctx.lotId || d.lotId === ctx.lotId) && inRange(d.date, ctx));

  if (runs.length > 0 || dispatches.length > 0) {
    // Dispatches are recorded in bottles; value them in the same dal unit as the
    // incoming column using each lot's average litres/bottle from its bottling
    // runs (falling back to a standard 0.75 L bottle).
    const volAgg = new Map<string, { litres: number; units: number }>();
    for (const r of (ctx.bottlingRuns || [])) {
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
      rows.push({
        date: r.date.slice(0, 10),
        fromTo: `${ka ? 'ჩამოსხმა' : 'Bottling'} / ${r.lotName}${r.lotNumber ? ` (${r.lotNumber})` : ''}`,
        incoming: litresToDal(r.volumeBottledL || 0),
        outgoing: 0,
        balance: 0,
      });
    }
    for (const d of dispatches) {
      rows.push({
        date: (d.date || '').slice(0, 10),
        fromTo: `${ka ? 'რეალიზაცია' : 'Sale'} / ${d.customerName || d.lotName || ''}`.trim(),
        incoming: 0,
        outgoing: litresToDal((d.bottles || 0) * litresPerBottle(d.lotId)),
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
// Real ledger reconstructed from cellar-operation usage: an opening-balance row
// (current stock + in-range usage, assuming no in-range purchases) followed by
// one outgoing row per additive use, with a running balance that closes at the
// current stock. Materials with no recorded usage fall back to a stock snapshot.
const mapMaterials: Mapper = (ctx) => {
  const items = ctx.inventory.filter(i =>
    /addit|yeast|nutri|bentonit|gelat|ferment|საფუარ|ბენტონ|ჟელატ|ფერმენ/i.test(i.category + i.name)
    && (!ctx.materialId || i.id === ctx.materialId));

  const usageAll = (ctx.cellarOps || []).filter(o =>
    o.materialId && typeof o.dose === 'number' && o.dose > 0 && inRange(o.date, ctx));

  const ka = ctx.lang === 'ka';
  const rows: DocRow[] = [];

  for (const i of items) {
    const usage = usageAll
      .filter(o => o.materialId === i.id)
      .sort((a, b) => ((a.date || '') < (b.date || '') ? -1 : 1));

    if (usage.length === 0) {
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

    const totalOut = usage.reduce((acc, o) => acc + (o.dose || 0), 0);
    const opening = round2(i.stock + totalOut); // assumes no purchases inside the range
    const block: DocRow[] = [{
      date: ctx.dateRange.from,
      docNo: '',
      fromTo: `${i.name} — ${ka ? 'ნაშთი პერიოდის დასაწყისში' : 'opening balance'}`,
      incoming: opening,
      outgoing: 0,
      balance: 0,
    }];
    for (const o of usage) {
      block.push({
        date: (o.date || '').slice(0, 10),
        docNo: o.id,
        fromTo: `${ka ? 'გამოყენება' : 'used'} — ${o.lotName} (${opLabel(o, ctx.lang)})`,
        incoming: 0,
        outgoing: round2(o.dose || 0),
        balance: 0,
      });
    }
    applyRunningBalance(block, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
    rows.push(...block);
  }

  return rows;
};

// ── Annex 17 — grape processing summary (by variety) ─────────────────────────
const mapProcessingSummary: Mapper = (ctx) => {
  const byVariety = new Map<string, { tons: number; sugars: number[]; wineDal: number }>();
  for (const h of ctx.harvests.filter(h => inRange(h.actualHarvestDate || h.estimatedHarvestDate, ctx))) {
    const v = h.variety || 'უცნობი';
    const e = byVariety.get(v) || { tons: 0, sugars: [], wineDal: 0 };
    e.tons += h.actualHarvestedKg != null ? h.actualHarvestedKg / 1000 : (h.estimatedTons || 0);
    const s = latestSugarForBlock(ctx, h.blockId);
    if (typeof s === 'number') e.sugars.push(s);
    byVariety.set(v, e);
  }
  for (const lot of ctx.lots) {
    const v = lot.variety || 'უცნობი';
    const e = byVariety.get(v) || { tons: 0, sugars: [], wineDal: 0 };
    e.wineDal += litresToDal(lot.initialVolume || 0);
    byVariety.set(v, e);
  }
  return [...byVariety.entries()].map(([variety, e]): DocRow => ({
    variety,
    grapeTons: round2(e.tons),
    avgSugar: e.sugars.length ? round2(e.sugars.reduce((a, b) => a + b, 0) / e.sugars.length) : '',
    wineCategory: '', // TODO: PDO/PGI/table classification not modelled
    wineTotal: round2(e.wineDal),
    pdoWine: '', // TODO
    pgiWine: '', // TODO
    otherWine: round2(e.wineDal), // safe default: uncategorised → table wine
    distillWine: '',
  }));
};

// ── Annex 18 — wine turnover notification (per lot) ──────────────────────────
const mapWineTurnover: Mapper = (ctx) => {
  return ctx.lots.map((lot): DocRow => {
    const produced = litresToDal(lot.initialVolume || 0);
    const closing = litresToDal(lot.currentVolume || 0);
    return {
      wineName: lot.name,
      typeColor: lot.wineClass,
      vintage: lot.vintage,
      openBalance: 0, // TODO: period opening balance not snapshotted
      inOwn: produced,
      inBought: 0, // TODO: purchases not tracked
      outExport: 0, // TODO: sales channels not tracked
      outDomestic: 0,
      outBlend: 0,
      outCategory: 0,
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
