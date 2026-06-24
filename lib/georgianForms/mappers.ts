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
import type { VineyardBlock, WineLot, HarvestRecord } from '../wineryState';
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

// ── Annex 3 — grape reception (derived from harvests sent to the winery) ──────
const mapGrapeReception: Mapper = (ctx) => {
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
        brutto: '', // TODO: gross/tare weights not tracked; only net (harvested kg)
        tara: '',
        netto: net,
        analysisNo: '', // TODO: lab analysis № not linked to reception
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

// ── Annex 7 — bottling act (bottled lots) ────────────────────────────────────
const mapBottling: Mapper = (ctx) => {
  const lots = (ctx.lotId ? ctx.lots.filter(l => l.id === ctx.lotId) : ctx.lots)
    .filter(l => l.stage === 'bottled' || l.stage === 'sold');
  return lots.map((lot): DocRow => {
    const bottledLitres = Math.max(0, (lot.initialVolume || 0)); // volume that went to bottling
    const fill = (lot.history || []).find(h => /bottl|ჩამოსხ/i.test(h.type + h.description));
    return {
      wineNo: lot.id,
      lotNo: lot.id,
      inDate: (lot.createdAt || '').slice(0, 10),
      inQty: litresToDal(bottledLitres),
      fillDate: (fill?.date || '').slice(0, 10),
      fillQty: litresToDal(lot.initialVolume - lot.currentVolume > 0 ? lot.initialVolume - lot.currentVolume : lot.initialVolume),
      bottles: '', // TODO: per-format bottle counts (0.75/0.5/...) not tracked
      ceramic: '',
      note: lot.name,
    };
  });
};

// ── Annex 8 — finished goods warehouse movement ──────────────────────────────
const mapWarehouse: Mapper = (ctx) => {
  const lots = (ctx.lotId ? ctx.lots.filter(l => l.id === ctx.lotId) : ctx.lots)
    .filter(l => l.stage === 'bottled' || l.stage === 'sold');
  const rows: DocRow[] = lots.map((lot): DocRow => ({
    date: (lot.createdAt || ctx.dateRange.from).slice(0, 10),
    fromTo: `ჩამოსხმა / ${lot.name}`,
    incoming: litresToDal(lot.initialVolume || 0),
    outgoing: litresToDal(Math.max(0, (lot.initialVolume || 0) - (lot.currentVolume || 0))),
    balance: 0,
  }));
  rows.sort((a, b) => (String(a.date) < String(b.date) ? -1 : 1));
  applyRunningBalance(rows, { incoming: 'incoming', outgoing: 'outgoing', balance: 'balance' });
  return rows;
};

// ── Annex 13 — auxiliary materials (inventory snapshot as opening balance) ────
const mapMaterials: Mapper = (ctx) => {
  const items = ctx.inventory.filter(i =>
    /addit|yeast|nutri|bentonit|gelat|ferment|საფუარ|ბენტონ|ჟელატ|ფერმენ/i.test(i.category + i.name)
    && (!ctx.materialId || i.id === ctx.materialId));
  // No movement ledger exists; present current stock as the standing balance.
  return items.map((i): DocRow => ({
    date: ctx.dateRange.to,
    docNo: '', // TODO: material receipt documents not tracked
    fromTo: `${i.supplierName || ''} — ${i.name}`.trim(),
    incoming: round2(i.stock), // TODO: opening vs incoming not separated; shown as current stock
    outgoing: 0,
    balance: round2(i.stock),
  }));
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
