import type {
  BottlingRunRecord,
  CellarOperation,
  CellarTransferRecord,
  CertificationRecord,
  CompanyProfile,
  DailyFermLog,
  GrapeIntakeRecord,
  HarvestRecord,
  LabAnalysis,
  MaraniOSAuditLog,
  SalesDispatchRecord,
  SalesOrderRecord,
  Vessel,
  VineyardBlock,
  WineLot,
  DocumentAttachment,
} from './wineryState';
import type { StorageLocation, StockMovement } from './storage';
import { molecularSO2 } from './alerts';
import { evaluateLotCompliance, type ComplianceReadiness } from './compliance';
import { checkPdoEligibility, getPdoRule, type PdoCheckResult } from './pdo';

export interface PassportData {
  lot: WineLot;
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  company: CompanyProfile;
  generatedBy: string;
  qrDataUrl?: string;
  blocks?: VineyardBlock[];
  harvests?: HarvestRecord[];
  grapeIntakes?: GrapeIntakeRecord[];
  vessels?: Vessel[];
  cellarOps?: CellarOperation[];
  transfers?: CellarTransferRecord[];
  bottlingRuns?: BottlingRunRecord[];
  storageLocations?: StorageLocation[];
  stockMovements?: StockMovement[];
  salesOrders?: SalesOrderRecord[];
  salesDispatches?: SalesDispatchRecord[];
  certificationRecords?: CertificationRecord[];
  attachments?: DocumentAttachment[];
  auditLogs?: MaraniOSAuditLog[];
}

interface TimelineItem {
  date?: string;
  type: string;
  detail: string;
  ref?: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function safeDate(date?: string): string {
  return typeof date === 'string' && date.length >= 10 ? date.slice(0, 10) : '';
}

function fmt(value: unknown, fallback = '-'): string {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : fallback;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function includesLoose(value: unknown, needle: string): boolean {
  return String(value || '').toLowerCase().includes(needle.toLowerCase());
}

function findBlock(lot: WineLot, intakes: GrapeIntakeRecord[], blocks: VineyardBlock[]): VineyardBlock | undefined {
  const intake = intakes.find(i => i.blockId);
  return blocks.find(block =>
    block.id === intake?.blockId ||
    block.id === lot.vineyardBlock ||
    block.name === lot.vineyardBlock ||
    block.parcelName === lot.vineyardBlock,
  );
}

function latestCertification(records: CertificationRecord[]): CertificationRecord | undefined {
  return [...records].sort((a, b) =>
    (safeDate(b.issueDate || b.sampleDate) || '').localeCompare(safeDate(a.issueDate || a.sampleDate) || ''),
  )[0];
}

function relatedAuditLogs(lot: WineLot, auditLogs: MaraniOSAuditLog[]): MaraniOSAuditLog[] {
  return auditLogs
    .filter(log => (
      includesLoose(log.changedItem, lot.id) ||
      includesLoose(log.oldValue, lot.id) ||
      includesLoose(log.newValue, lot.id) ||
      includesLoose(log.notes, lot.id) ||
      includesLoose(log.changedItem, lot.name) ||
      includesLoose(log.notes, lot.name)
    ))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function derivePdo(input: {
  lot: WineLot;
  block?: VineyardBlock;
  intake?: GrapeIntakeRecord;
}): PdoCheckResult | null {
  const intended = input.lot.intendedAppellation || '';
  const rule = intended ? getPdoRule(intended) : null;
  if (!rule) return null;
  try {
    return checkPdoEligibility({
      pdoId: rule.id,
      lot: input.lot,
      block: input.block,
      intake: input.intake,
    });
  } catch {
    return null;
  }
}

function readinessHtml(readiness: ComplianceReadiness | null): string {
  if (!readiness) return '<div class="notice warn">Compliance readiness could not be computed.</div>';
  const missing = readiness.missing.length
    ? `<ul class="mini-list">${readiness.missing.slice(0, 8).map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '<div class="ok-line">No missing checklist items detected.</div>';
  return `
    <div class="score-row">
      <div class="score">${esc(readiness.score)}%</div>
      <div><span class="badge">${esc(readiness.badge)}</span><div class="muted">Lot compliance readiness</div></div>
    </div>
    ${missing}`;
}

function tableRows<T>(items: T[], empty: string, render: (item: T) => string): string {
  return items.length ? items.map(render).join('') : `<tr><td colspan="99" class="empty">${esc(empty)}</td></tr>`;
}

function officialRecordsHtml(flags: Array<{ name: string; ref: string; connected: boolean }>): string {
  return flags.map(flag => `
    <tr>
      <td>${esc(flag.name)}</td>
      <td>${esc(flag.ref)}</td>
      <td><span class="${flag.connected ? 'pill ok' : 'pill warn'}">${flag.connected ? 'connected' : 'needs data'}</span></td>
    </tr>
  `).join('');
}

function attachmentRows(attachments: DocumentAttachment[]): string {
  return tableRows(attachments, 'No attachment evidence linked yet.', attachment => `
    <tr>
      <td>${esc(attachment.fileName)}</td>
      <td>${esc(attachment.module.replace(/_/g, ' '))}</td>
      <td>${esc(attachment.description || attachment.linkedRecordType || '-')}</td>
      <td>${esc(attachment.sizeBytes ? `${Math.round(attachment.sizeBytes / 1024)} KB` : '-')}</td>
      <td>${esc(attachment.checksum ? `sha256:${attachment.checksum.slice(0, 12)}` : '-')}</td>
    </tr>
  `);
}

function buildTimeline(items: TimelineItem[]): string {
  const sorted = [...items]
    .filter(item => item.detail)
    .sort((a, b) => (safeDate(a.date) || '9999-99-99').localeCompare(safeDate(b.date) || '9999-99-99'));

  if (!sorted.length) return '<li><div class="t-desc">No traceability events recorded yet.</div></li>';
  return sorted.map(item => `
    <li>
      <div class="t-row"><span class="t-type">${esc(item.type)}</span><span class="t-date">${esc(safeDate(item.date) || '-')}</span></div>
      <div class="t-desc">${esc(item.detail)}</div>
      ${item.ref ? `<div class="t-op">Ref: ${esc(item.ref)}</div>` : ''}
    </li>
  `).join('');
}

export function buildPassportHtml(data: PassportData): string {
  const {
    lot,
    fermLogs,
    labLogs,
    company,
    generatedBy,
    qrDataUrl,
    blocks = [],
    harvests = [],
    grapeIntakes = [],
    vessels = [],
    cellarOps = [],
    transfers = [],
    bottlingRuns = [],
    storageLocations = [],
    stockMovements = [],
    salesOrders = [],
    salesDispatches = [],
    certificationRecords = [],
    attachments = [],
    auditLogs = [],
  } = data;

  const generatedAt = new Date().toLocaleString();
  const intakes = grapeIntakes.filter(intake => intake.createdLotId === lot.id);
  const primaryIntake = intakes[0];
  const block = findBlock(lot, intakes, blocks);
  const lotHarvests = harvests.filter(h =>
    h.associatedLotId === lot.id || intakes.some(intake => intake.harvestRecordId && intake.harvestRecordId === h.id),
  );
  const ops = cellarOps.filter(op => op.lotId === lot.id).sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const xfers = transfers
    .filter(t => includesLoose(t.details, lot.id) || includesLoose(t.details, lot.name))
    .sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const runs = bottlingRuns.filter(run => run.lotId === lot.id).sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const movements = stockMovements.filter(m => m.lotId === lot.id).sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const orders = salesOrders.filter(o => o.lotId === lot.id).sort((a, b) => safeDate(a.orderDate).localeCompare(safeDate(b.orderDate)));
  const dispatches = salesDispatches.filter(d => d.lotId === lot.id).sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const certs = certificationRecords.filter(record => record.lotId === lot.id);
  const cert = latestCertification(certs);
  const certIds = new Set(certs.map(record => record.id));
  const linkedAttachments = attachments
    .filter(attachment => (
      attachment.linkedRecordId === lot.id ||
      (attachment.linkedRecordType === 'certificationRecord' && attachment.linkedRecordId && certIds.has(attachment.linkedRecordId))
    ))
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  const audits = relatedAuditLogs(lot, auditLogs);
  const ferm = [...fermLogs].sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const labs = [...labLogs].sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const pdo = derivePdo({ lot, block, intake: primaryIntake });

  const vesselIds = new Set<string>();
  if (primaryIntake?.destinationVesselId) vesselIds.add(primaryIntake.destinationVesselId);
  for (const op of ops) {
    if (op.vesselId) vesselIds.add(op.vesselId);
    if (op.vesselToId) vesselIds.add(op.vesselToId);
  }
  for (const vessel of vessels) {
    if (vessel.assignedLotId === lot.id) vesselIds.add(vessel.id);
  }
  const linkedVessels = vessels.filter(vessel => vesselIds.has(vessel.id));

  const compliance = (() => {
    try {
      return evaluateLotCompliance({ lot, company, grapeIntakes, blocks, labLogs, bottlingRuns });
    } catch {
      return null;
    }
  })();

  const timeline = buildTimeline([
    ...lotHarvests.map(h => ({ date: h.actualHarvestDate || h.estimatedHarvestDate, type: 'Harvest', detail: `${h.variety} ${fmt(h.actualHarvestedKg || h.estimatedTons)} ${h.actualHarvestedKg ? 'kg' : 't estimated'}`, ref: h.id })),
    ...intakes.map(i => ({ date: i.date, type: 'Grape intake', detail: `${i.variety}, ${fmt(i.netWeightKg)} kg, ${fmt(i.brix)} Brix`, ref: i.id })),
    { date: lot.createdAt, type: 'Wine lot created', detail: `${lot.name}, ${fmt(lot.initialVolume)} L`, ref: lot.id },
    ...ops.map(op => ({ date: op.date, type: 'Cellar operation', detail: `${op.customLabel || op.type.replace(/_/g, ' ')} ${op.materialName ? `- ${op.materialName}` : ''}`, ref: op.id })),
    ...xfers.map(t => ({ date: t.date, type: 'Transfer', detail: `${t.sourceId} to ${t.destId}, ${fmt(t.volume)} L`, ref: t.id })),
    ...runs.map(run => ({ date: run.date, type: 'Bottling', detail: `${fmt((run.totalBottles || 0) + (run.totalCeramic || 0))} bottles, lot no. ${run.lotNumber}`, ref: run.id })),
    ...movements.map(m => ({ date: m.date, type: `Stock ${m.direction}`, detail: `${fmt(m.bottles)} bottles at ${storageLocations.find(l => l.id === m.locationId)?.name || m.locationId}`, ref: m.id })),
    ...orders.map(o => ({ date: o.orderDate, type: 'Sales order', detail: `${o.customerName}, ${fmt(o.bottles)} bottles, ${o.status}`, ref: o.orderNumber || o.id })),
    ...dispatches.map(d => ({ date: d.date, type: 'Dispatch', detail: `${d.customerName}, ${fmt(d.bottles)} bottles, ${fmt(d.revenue)} ${d.currency}`, ref: d.id })),
    ...certs.map(c => ({ date: c.issueDate || c.sampleDate, type: 'Certification', detail: `${c.applicationStatus}${c.certificateNumber ? `, certificate ${c.certificateNumber}` : ''}`, ref: c.id })),
  ]);

  const officialFlags = [
    { name: 'Vineyard journal', ref: 'Annex 1', connected: Boolean(block) },
    { name: 'Harvest journal', ref: 'Annex 2', connected: lotHarvests.length > 0 },
    { name: 'Grape reception', ref: 'Annex 3', connected: intakes.length > 0 },
    { name: 'Wine movement / cellar work', ref: 'Annex 4', connected: ops.length > 0 || xfers.length > 0 },
    { name: 'Bottling act', ref: 'Annex 7', connected: runs.length > 0 },
    { name: 'Warehouse movement', ref: 'Annex 8', connected: movements.length > 0 || dispatches.length > 0 },
    { name: 'Grape processing notification', ref: 'Annex 17', connected: intakes.length > 0 },
    { name: 'Wine turnover notification', ref: 'Annex 18', connected: Boolean(lot.id) },
  ];

  const pdoHtml = pdo
    ? `
      <div class="score-row">
        <div class="score ${pdo.eligible ? 'score-ok' : 'score-warn'}">${pdo.eligible ? 'OK' : 'Review'}</div>
        <div>
          <span class="${pdo.eligible ? 'badge ok-badge' : 'badge warn-badge'}">${esc(pdo.pdo.name)}</span>
          <div class="muted">${esc(pdo.pdo.productionMethodNotes)}</div>
        </div>
      </div>
      ${pdo.warnings.length ? `<div class="notice warn">Warnings: ${esc(pdo.warnings.join(', '))}</div>` : ''}
      ${pdo.missing.length ? `<div class="notice">Missing: ${esc(pdo.missing.join(', '))}</div>` : '<div class="ok-line">PDO checklist has no missing data.</div>'}
    `
    : '<div class="notice">No known PDO rule selected for this lot.</div>';

  const certHtml = cert
    ? `
      <div class="grid">
        <div class="cell"><div class="k">Application</div><div class="v">${esc(cert.applicationStatus)}</div></div>
        <div class="cell"><div class="k">Sample</div><div class="v">${esc(cert.samplePrepared ? cert.sampleDate || 'prepared' : 'not prepared')}</div></div>
        <div class="cell"><div class="k">Balance Check</div><div class="v">${esc(cert.balanceCheckStatus || '-')}</div></div>
        <div class="cell"><div class="k">Organoleptic</div><div class="v">${esc(cert.organolepticResult || '-')}</div></div>
        <div class="cell"><div class="k">Certificate</div><div class="v">${esc(cert.certificateNumber || lot.certificateNumber || '-')}</div></div>
        <div class="cell"><div class="k">Issue Date</div><div class="v">${esc(cert.issueDate || lot.certificateIssueDate || '-')}</div></div>
        <div class="cell"><div class="k">Expiry</div><div class="v">${esc(cert.expiryDate || lot.certificateExpiryDate || '-')}</div></div>
        <div class="cell"><div class="k">Purpose</div><div class="v">${esc((cert.purpose || '').replace(/_/g, ' ') || lot.marketStatus || '-')}</div></div>
      </div>
    `
    : '<div class="notice warn">No certification record is linked to this lot yet.</div>';

  const fermRows = tableRows(ferm, 'No fermentation logs recorded.', f => `
    <tr>
      <td>${esc(safeDate(f.date))}</td><td>${esc(f.temperature)}</td><td>${esc(f.density)}</td>
      <td>${esc(f.sugar)}</td><td>${esc(f.ph)}</td><td>${esc(f.capManagement)}</td>
    </tr>`);

  const labRows = tableRows(labs, 'No laboratory analyses recorded.', l => {
    const mol = molecularSO2(l.freeSo2, l.ph);
    const molLow = mol < 0.5 ? ' class="warn-cell"' : '';
    return `
      <tr>
        <td>${esc(safeDate(l.date))}</td><td>${esc(l.alcoholPct)}</td><td>${esc(l.titratableAcidity)}</td>
        <td>${esc(l.volatileAcid)}</td><td>${esc(l.ph)}</td><td>${esc(l.freeSo2)}</td>
        <td>${esc(l.totalSo2)}</td><td${molLow}>${esc(mol.toFixed(2))}</td><td>${esc(l.residualSugar)}</td>
      </tr>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lot Passport - ${esc(lot.id)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #2c241e; margin: 0; padding: 28px; background: #fff; }
  .doc { max-width: 900px; margin: 0 auto; }
  .head { border-bottom: 3px solid #4e0e15; padding-bottom: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .brand { font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: #4e0e15; font-weight: bold; }
  .title { font-size: 24px; font-weight: bold; margin: 6px 0 0; }
  .muted { color: #8a7d72; font-size: 11px; line-height: 1.4; }
  .code { font-family: 'Courier New', monospace; background: #f5efe9; border: 1px solid #e3d7cb; padding: 3px 9px; border-radius: 4px; color: #4e0e15; font-size: 13px; font-weight: bold; display: inline-block; }
  h2.section { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #4e0e15; border-bottom: 1px solid #eadfd5; padding-bottom: 4px; margin: 22px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .cell { border: 1px solid #eadfd5; border-radius: 6px; padding: 8px 10px; min-height: 48px; }
  .cell .k { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #a3998d; font-family: Arial, Helvetica, sans-serif; }
  .cell .v { font-size: 13px; font-weight: bold; text-transform: capitalize; margin-top: 2px; overflow-wrap: anywhere; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .panel { border: 1px solid #eadfd5; border-radius: 8px; padding: 10px; }
  .score-row { display: flex; align-items: center; gap: 12px; }
  .score { min-width: 62px; text-align: center; border-radius: 7px; background: #4e0e15; color: #fff8ec; font-family: Arial, Helvetica, sans-serif; font-size: 18px; font-weight: 800; padding: 9px 8px; }
  .score-ok { background: #047857; }
  .score-warn { background: #b45309; }
  .badge, .pill { display: inline-block; border: 1px solid #e3d7cb; background: #f5efe9; color: #4e0e15; border-radius: 999px; padding: 2px 8px; font-family: Arial, Helvetica, sans-serif; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .pill.ok, .ok-badge { border-color: #bbf7d0; background: #dcfce7; color: #166534; }
  .pill.warn, .warn-badge { border-color: #fed7aa; background: #fffbeb; color: #92400e; }
  .notice { border: 1px solid #e3d7cb; background: #faf7f3; border-radius: 6px; padding: 8px 10px; margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #6b5d52; }
  .notice.warn { border-color: #fecaca; background: #fff1f2; color: #9f1239; }
  .ok-line { margin-top: 8px; font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #166534; font-weight: 700; }
  .mini-list { margin: 8px 0 0; padding-left: 18px; font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #6b5d52; }
  ul.timeline { list-style: none; padding: 0; margin: 0; }
  ul.timeline li { border-left: 2px solid #e3d7cb; padding: 0 0 12px 14px; position: relative; }
  ul.timeline li::before { content: ''; position: absolute; left: -5px; top: 4px; width: 8px; height: 8px; background: #4e0e15; border-radius: 50%; }
  .t-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .t-type { font-weight: bold; font-size: 12px; }
  .t-date { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #8a7d72; white-space: nowrap; }
  .t-desc { font-size: 11px; margin: 2px 0; line-height: 1.4; }
  .t-op { font-size: 9px; color: #8a7d72; font-family: Arial, Helvetica, sans-serif; }
  table { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
  th { background: #4e0e15; color: #f6efe6; padding: 6px; text-align: left; font-weight: 600; }
  td { border: 1px solid #eadfd5; padding: 5px 6px; vertical-align: top; }
  tr:nth-child(even) td { background: #faf7f3; }
  td.warn-cell { background: #fff1f0 !important; color: #b4231f; font-weight: bold; }
  td.empty { text-align: center; color: #a3998d; font-style: italic; padding: 12px; }
  .foot { margin-top: 28px; border-top: 1px solid #eadfd5; padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; color: #8a7d72; font-family: Arial, Helvetica, sans-serif; }
  .sig { text-align: center; }
  .sig .line { width: 190px; border-top: 1px solid #2c241e; margin-bottom: 4px; height: 30px; }
  .qr { width: 84px; height: 84px; margin-top: 8px; display: inline-block; }
  .qr-cap { font-size: 8px; font-family: Arial, Helvetica, sans-serif; color: #a3998d; text-transform: uppercase; letter-spacing: .05em; }
  @page { margin: 16mm; }
  @media print { body { padding: 0; } h2.section, table, ul.timeline li, .foot, .panel { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="head">
      <div>
        <div class="brand">VinOS - ${esc(company.wineryName || company.companyName)}</div>
        <div class="title">Wine Lot Passport</div>
        <div class="muted">${esc(company.region)}, ${esc(company.country)} - traceability, compliance, certification, and official-record readiness</div>
      </div>
      <div style="text-align:right">
        <div class="code">${esc(lot.id)}</div>
        <div class="muted" style="margin-top:6px">Generated ${esc(generatedAt)}</div>
        ${qrDataUrl ? `<div><img class="qr" src="${esc(qrDataUrl)}" alt="Scan for digital passport" /><div class="qr-cap">Scan to open</div></div>` : ''}
      </div>
    </div>

    <h2 class="section">Lot Identity</h2>
    <div class="grid">
      <div class="cell"><div class="k">Wine</div><div class="v">${esc(lot.name)}</div></div>
      <div class="cell"><div class="k">Vintage</div><div class="v">${esc(lot.vintage)}</div></div>
      <div class="cell"><div class="k">Variety</div><div class="v">${esc(lot.variety)}</div></div>
      <div class="cell"><div class="k">Class</div><div class="v">${esc(lot.wineClass)}</div></div>
      <div class="cell"><div class="k">Vineyard Block</div><div class="v">${esc(lot.vineyardBlock)}</div></div>
      <div class="cell"><div class="k">Region / PDO</div><div class="v">${esc(lot.intendedAppellation || lot.region)}</div></div>
      <div class="cell"><div class="k">Classification</div><div class="v">${esc(lot.classification || '-')}</div></div>
      <div class="cell"><div class="k">Volume</div><div class="v">${esc(fmt(lot.currentVolume))} / ${esc(fmt(lot.initialVolume))} L</div></div>
      <div class="cell"><div class="k">Stage</div><div class="v">${esc(lot.stage.replace('_', ' '))}</div></div>
      <div class="cell"><div class="k">Origin Proof</div><div class="v">${esc(lot.originProofStatus || '-')}</div></div>
      <div class="cell"><div class="k">Market</div><div class="v">${esc(lot.marketStatus || '-')}</div></div>
      <div class="cell"><div class="k">Certificate</div><div class="v">${esc(lot.certificateNumber || cert?.certificateNumber || '-')}</div></div>
    </div>

    <h2 class="section">Compliance and PDO Status</h2>
    <div class="two-col">
      <div class="panel">${readinessHtml(compliance)}</div>
      <div class="panel">${pdoHtml}</div>
    </div>

    <h2 class="section">Certification</h2>
    ${certHtml}

    <h2 class="section">Vineyard, Harvest, and Receiving Evidence</h2>
    <div class="grid">
      <div class="cell"><div class="k">Cadastre</div><div class="v">${esc(primaryIntake?.cadastralCode || block?.cadastralCode || '-')}</div></div>
      <div class="cell"><div class="k">Village</div><div class="v">${esc(primaryIntake?.village || block?.village || '-')}</div></div>
      <div class="cell"><div class="k">Microzone</div><div class="v">${esc(primaryIntake?.microzone || block?.microzone || '-')}</div></div>
      <div class="cell"><div class="k">Transport</div><div class="v">${esc(primaryIntake?.transportNumber || primaryIntake?.transportName || '-')}</div></div>
      <div class="cell"><div class="k">Supplier / Grower</div><div class="v">${esc(primaryIntake?.supplierName || block?.grower || block?.landOwner || '-')}</div></div>
      <div class="cell"><div class="k">Supplier ID</div><div class="v">${esc(primaryIntake?.supplierIdCode || '-')}</div></div>
      <div class="cell"><div class="k">Lab Analysis No.</div><div class="v">${esc(primaryIntake?.labAnalysisNumber || '-')}</div></div>
      <div class="cell"><div class="k">Payment Status</div><div class="v">${esc(primaryIntake?.paymentStatus || '-')}</div></div>
    </div>

    <h2 class="section">Connected Official Records</h2>
    <table>
      <thead><tr><th>Official record</th><th>Form</th><th>Status</th></tr></thead>
      <tbody>${officialRecordsHtml(officialFlags)}</tbody>
    </table>

    <h2 class="section">Attachment Evidence</h2>
    <table>
      <thead><tr><th>File</th><th>Module</th><th>Context</th><th>Size</th><th>Checksum</th></tr></thead>
      <tbody>${attachmentRows(linkedAttachments)}</tbody>
    </table>

    <h2 class="section">Traceability Timeline</h2>
    <ul class="timeline">${timeline}</ul>

    <h2 class="section">Vessels and Cellar Work</h2>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Vessel</th><th>Volume</th><th>Material / Notes</th></tr></thead>
      <tbody>
        ${tableRows(ops, 'No cellar operations linked to this lot.', op => `
          <tr><td>${esc(safeDate(op.date))}</td><td>${esc(op.customLabel || op.type.replace(/_/g, ' '))}</td><td>${esc(op.vesselId || op.vesselToId || '-')}</td><td>${esc(fmt(op.volumeAfterL ?? op.volumeBeforeL))} L</td><td>${esc(op.materialName || op.notes || '-')}</td></tr>
        `)}
        ${linkedVessels.length ? linkedVessels.map(v => `<tr><td>-</td><td>Current vessel</td><td>${esc(v.id)}</td><td>${esc(fmt(v.currentVolume))} L</td><td>${esc(v.type)} ${v.qvevriNumber ? `- qvevri ${esc(v.qvevriNumber)}` : ''}</td></tr>`).join('') : ''}
      </tbody>
    </table>

    <h2 class="section">Bottling, Storage, and Sales</h2>
    <table>
      <thead><tr><th>Date</th><th>Event</th><th>Reference</th><th>Quantity</th><th>Counterparty / Location</th></tr></thead>
      <tbody>
        ${tableRows([
          ...runs.map(run => ({ date: run.date, event: 'Bottling', ref: run.id, qty: `${fmt((run.totalBottles || 0) + (run.totalCeramic || 0))} bottles`, place: run.storageLocationId || '-' })),
          ...movements.map(m => ({ date: m.date, event: `Stock ${m.direction}`, ref: m.id, qty: `${fmt(m.bottles)} bottles`, place: storageLocations.find(l => l.id === m.locationId)?.name || m.locationId })),
          ...orders.map(o => ({ date: o.orderDate, event: `Order ${o.status}`, ref: o.orderNumber || o.id, qty: `${fmt(o.bottles)} bottles`, place: o.customerName })),
          ...dispatches.map(d => ({ date: d.date, event: 'Dispatch', ref: d.id, qty: `${fmt(d.bottles)} bottles`, place: d.customerName })),
        ].sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date))), 'No bottling, storage, or sales records linked yet.', item => `
          <tr><td>${esc(safeDate(item.date))}</td><td>${esc(item.event)}</td><td>${esc(item.ref)}</td><td>${esc(item.qty)}</td><td>${esc(item.place)}</td></tr>
        `)}
      </tbody>
    </table>

    <h2 class="section">Fermentation Log</h2>
    <table>
      <thead><tr><th>Date</th><th>Temp C</th><th>Density</th><th>Sugar g/L</th><th>pH</th><th>Cap Management</th></tr></thead>
      <tbody>${fermRows}</tbody>
    </table>

    <h2 class="section">Laboratory Analyses</h2>
    <table>
      <thead><tr><th>Date</th><th>ABV %</th><th>TA g/L</th><th>VA g/L</th><th>pH</th><th>Free SO2</th><th>Total SO2</th><th>Mol. SO2</th><th>RS g/L</th></tr></thead>
      <tbody>${labRows}</tbody>
    </table>
    <div class="muted" style="margin-top:6px; font-family: Arial, Helvetica, sans-serif;">Molecular SO2 is computed from free SO2 and pH; values below 0.5 mg/L are highlighted.</div>

    <h2 class="section">Audit History</h2>
    <table>
      <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Changed item</th><th>Hash</th></tr></thead>
      <tbody>${tableRows(audits.slice(0, 12), 'No audit entries were found for this lot.', log => `
        <tr><td>${esc(safeDate(log.timestamp) || log.timestamp)}</td><td>${esc(log.user)}</td><td>${esc(log.actionType)}</td><td>${esc(log.changedItem)}</td><td>${esc(log.chainHash ? log.chainHash.slice(0, 12) : '-')}</td></tr>
      `)}</tbody>
    </table>

    <div class="foot">
      <div>
        Issued by ${esc(generatedBy)}<br />
        ${esc(company.companyName)} - ${esc(company.identificationCode || 'no ID code')} - ${esc(company.legalAddress || company.address)}
      </div>
      <div class="sig"><div class="line"></div>Authorised Signature</div>
    </div>
  </div>
</body>
</html>`;
}
