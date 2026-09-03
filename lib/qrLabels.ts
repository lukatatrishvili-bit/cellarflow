/**
 * Printable QR labels for vessels (cellar-floor mode). Each label encodes a
 * deep link that lands a phone directly on the quick-operation form with the
 * vessel — and its current batch — preselected, so a worker standing at a
 * qvevri can scan → log in seconds.
 */

export function vesselDeepLink(origin: string, vesselId: string): string {
  return `${origin.replace(/\/+$/, '')}/?tank=${encodeURIComponent(vesselId)}&op=1`;
}

export interface QrLabelInput {
  vesselId: string;
  /** Small caption under the id, e.g. "qvevri · 1500 L". */
  caption: string;
  /** PNG data URL of the QR code. */
  dataUrl: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Self-contained print-ready HTML: an A4 grid of cut-out labels. Kept as plain
 * HTML (like the settlement statement) so it prints identically everywhere and
 * needs no PDF dependency.
 *
 * The markup carries no script. A document written into a window this app
 * opened inherits the app's CSP, and `script-src` allows no inline script — so
 * the caller triggers printing from the opener once the document is closed.
 */
export function buildQrLabelSheetHtml(opts: {
  wineryName: string;
  labels: QrLabelInput[];
  lang?: string;
}): string {
  const ka = opts.lang === 'ka';
  const title = ka ? 'ჭურჭლის QR ეტიკეტები' : 'Vessel QR labels';
  const hint = ka ? 'დაასკანერეთ ოპერაციის ჩასაწერად' : 'Scan to log an operation';
  const winery = escapeHtml(opts.wineryName || 'VinOS');

  const cells = opts.labels.map(l => `
    <div class="label">
      <img src="${l.dataUrl}" alt="QR ${escapeHtml(l.vesselId)}" />
      <div class="id">${escapeHtml(l.vesselId)}</div>
      <div class="cap">${escapeHtml(l.caption)}</div>
      <div class="hint">${hint}</div>
      <div class="brand">${winery}</div>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} — ${winery}</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: Georgia, serif; color: #2c221e; margin: 0; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; padding: 6mm; }
  .label {
    border: 1.5px dashed #b9a99a; border-radius: 8px; padding: 6mm 4mm; text-align: center;
    break-inside: avoid; page-break-inside: avoid;
  }
  .label img { width: 34mm; height: 34mm; }
  .id { font-size: 15px; font-weight: bold; color: #4e0e15; margin-top: 2mm; word-break: break-word; }
  .cap { font-size: 10px; color: #6d5f57; margin-top: 1mm; }
  .hint { font-size: 8.5px; color: #8c7f7e; margin-top: 2mm; letter-spacing: .04em; text-transform: uppercase; }
  .brand { font-size: 8.5px; color: #b9a99a; margin-top: 1mm; }
</style></head><body>
  <div class="sheet">${cells}</div>
</body></html>`;
}
