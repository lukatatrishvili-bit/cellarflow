import { WineLot, DailyFermLog, LabAnalysis, CompanyProfile } from './wineryState';
import { molecularSO2 } from './alerts';

export interface PassportData {
  lot: WineLot;
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  company: CompanyProfile;
  generatedBy: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/**
 * Builds a fully self-contained HTML document (with its own print CSS) for a
 * wine lot's traceability passport. The same string drives both the in-app
 * iframe preview and the print / save-as-PDF window, so there is a single
 * source of truth for the layout.
 */
export function buildPassportHtml(data: PassportData): string {
  const { lot, fermLogs, labLogs, company, generatedBy } = data;
  const generatedAt = new Date().toLocaleString();
  const ferm = [...fermLogs].sort((a, b) => a.date.localeCompare(b.date));
  const labs = [...labLogs].sort((a, b) => a.date.localeCompare(b.date));

  const historyRows = lot.history.length
    ? lot.history
        .map(
          (h) => `
        <li>
          <div class="t-row"><span class="t-type">${esc(h.type)}</span><span class="t-date">${esc(h.date)}</span></div>
          <div class="t-desc">${esc(h.description)}</div>
          <div class="t-op">Operator: ${esc(h.operator)}</div>
        </li>`
        )
        .join('')
    : '<li><div class="t-desc">No traceability events recorded yet.</div></li>';

  const fermRows = ferm.length
    ? ferm
        .map(
          (f) => `
        <tr>
          <td>${esc(f.date)}</td><td>${esc(f.temperature)}</td><td>${esc(f.density)}</td>
          <td>${esc(f.sugar)}</td><td>${esc(f.ph)}</td><td>${esc(f.capManagement)}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">No fermentation logs recorded.</td></tr>';

  const labRows = labs.length
    ? labs
        .map((l) => {
          const mol = molecularSO2(l.freeSo2, l.ph).toFixed(2);
          const molLow = molecularSO2(l.freeSo2, l.ph) < 0.5 ? ' class="warn"' : '';
          return `
        <tr>
          <td>${esc(l.date)}</td><td>${esc(l.alcoholPct)}</td><td>${esc(l.titratableAcidity)}</td>
          <td>${esc(l.volatileAcid)}</td><td>${esc(l.ph)}</td><td>${esc(l.freeSo2)}</td>
          <td>${esc(l.totalSo2)}</td><td${molLow}>${mol}</td><td>${esc(l.residualSugar)}</td>
        </tr>`;
        })
        .join('')
    : '<tr><td colspan="9" class="empty">No laboratory analyses recorded.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Lot Passport — ${esc(lot.id)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #2c241e; margin: 0; padding: 28px; background: #fff; }
  .doc { max-width: 820px; margin: 0 auto; }
  .head { border-bottom: 3px solid #4e0e15; padding-bottom: 12px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .brand { font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: #4e0e15; font-weight: bold; }
  .title { font-size: 22px; font-weight: bold; margin: 6px 0 0; }
  .muted { color: #8a7d72; font-size: 11px; }
  .code { font-family: 'Courier New', monospace; background: #f5efe9; border: 1px solid #e3d7cb; padding: 3px 9px; border-radius: 4px; color: #4e0e15; font-size: 13px; font-weight: bold; display: inline-block; }
  h2.section { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #4e0e15; border-bottom: 1px solid #eadfd5; padding-bottom: 4px; margin: 22px 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .cell { border: 1px solid #eadfd5; border-radius: 6px; padding: 8px 10px; }
  .cell .k { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #a3998d; font-family: Arial, Helvetica, sans-serif; }
  .cell .v { font-size: 13px; font-weight: bold; text-transform: capitalize; margin-top: 2px; }
  ul.timeline { list-style: none; padding: 0; margin: 0; }
  ul.timeline li { border-left: 2px solid #e3d7cb; padding: 0 0 12px 14px; position: relative; }
  ul.timeline li::before { content: ''; position: absolute; left: -5px; top: 4px; width: 8px; height: 8px; background: #4e0e15; border-radius: 50%; }
  .t-row { display: flex; justify-content: space-between; align-items: baseline; }
  .t-type { font-weight: bold; font-size: 12px; }
  .t-date { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #8a7d72; }
  .t-desc { font-size: 11px; margin: 2px 0; line-height: 1.4; }
  .t-op { font-size: 9px; color: #8a7d72; font-family: Arial, Helvetica, sans-serif; }
  table { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
  th { background: #4e0e15; color: #f6efe6; padding: 6px; text-align: left; font-weight: 600; }
  td { border: 1px solid #eadfd5; padding: 5px 6px; }
  tr:nth-child(even) td { background: #faf7f3; }
  td.warn { background: #fff1f0 !important; color: #b4231f; font-weight: bold; }
  td.empty { text-align: center; color: #a3998d; font-style: italic; padding: 12px; }
  .foot { margin-top: 28px; border-top: 1px solid #eadfd5; padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 10px; color: #8a7d72; font-family: Arial, Helvetica, sans-serif; }
  .sig { text-align: center; }
  .sig .line { width: 190px; border-top: 1px solid #2c241e; margin-bottom: 4px; height: 30px; }
  @page { margin: 16mm; }
  @media print { body { padding: 0; } h2.section, table, ul.timeline li, .foot { page-break-inside: avoid; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="head">
      <div>
        <div class="brand">&#127815; VINEA &middot; ${esc(company.wineryName)}</div>
        <div class="title">Wine Lot Passport</div>
        <div class="muted">${esc(company.region)}, ${esc(company.country)} &middot; PDO Traceability Record</div>
      </div>
      <div style="text-align:right">
        <div class="code">${esc(lot.id)}</div>
        <div class="muted" style="margin-top:6px">Generated ${esc(generatedAt)}</div>
      </div>
    </div>

    <h2 class="section">Lot Identity</h2>
    <div class="grid">
      <div class="cell"><div class="k">Wine</div><div class="v">${esc(lot.name)}</div></div>
      <div class="cell"><div class="k">Vintage</div><div class="v">${esc(lot.vintage)}</div></div>
      <div class="cell"><div class="k">Variety</div><div class="v">${esc(lot.variety)}</div></div>
      <div class="cell"><div class="k">Class</div><div class="v">${esc(lot.wineClass)}</div></div>
      <div class="cell"><div class="k">Vineyard Block</div><div class="v">${esc(lot.vineyardBlock)}</div></div>
      <div class="cell"><div class="k">Region / PDO</div><div class="v">${esc(lot.region)}</div></div>
      <div class="cell"><div class="k">Current Stage</div><div class="v">${esc(lot.stage.replace('_', ' '))}</div></div>
      <div class="cell"><div class="k">Volume</div><div class="v">${esc(lot.currentVolume)} / ${esc(lot.initialVolume)} L</div></div>
    </div>

    <h2 class="section">Traceability Timeline</h2>
    <ul class="timeline">${historyRows}</ul>

    <h2 class="section">Fermentation Log</h2>
    <table>
      <thead><tr><th>Date</th><th>Temp &deg;C</th><th>Density</th><th>Sugar g/L</th><th>pH</th><th>Cap Management</th></tr></thead>
      <tbody>${fermRows}</tbody>
    </table>

    <h2 class="section">Laboratory Analyses</h2>
    <table>
      <thead><tr><th>Date</th><th>ABV %</th><th>TA g/L</th><th>VA g/L</th><th>pH</th><th>Free SO&#8322;</th><th>Total SO&#8322;</th><th>Mol. SO&#8322;</th><th>RS g/L</th></tr></thead>
      <tbody>${labRows}</tbody>
    </table>
    <div class="muted" style="margin-top:6px; font-family: Arial, Helvetica, sans-serif;">Molecular SO&#8322; computed from free SO&#8322; and pH; values below 0.5 mg/L are highlighted.</div>

    <div class="foot">
      <div>
        Issued by ${esc(generatedBy)}<br />
        ${esc(company.companyName)} &middot; ${esc(company.address)}
      </div>
      <div class="sig"><div class="line"></div>Authorised Signature</div>
    </div>
  </div>
</body>
</html>`;
}
