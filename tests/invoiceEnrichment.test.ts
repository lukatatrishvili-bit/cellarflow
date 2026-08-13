import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeInvoiceDraft } from '../server/invoiceAnalyzer';
import type { InventoryItem } from '../lib/wineryState';

vi.mock('../server/db', () => ({
  getPrismaClientForAdmin: vi.fn(async () => null),
}));

const generate = vi.fn();
const client = { models: { generateContent: generate } } as never;

const EXTRACTION = {
  invoice: { supplier_name: 'Oenology Georgia', currency: 'GEL', invoice_number: 'INV-1' },
  lines: [
    {
      line_number: 1,
      invoice_description: 'Lalvin EC-1118 yeast 500 g bag',
      product_name: 'Lalvin EC-1118',
      category: 'yeasts',
      invoice_quantity: 10,
      invoice_unit: 'bag',
      stock_quantity: 5,
      stock_unit: 'kg',
      cost_per_stock_unit: 84,
      confidence: 0.9,
    },
  ],
  warnings: [],
};

function groundedReply(text: string, chunkSites: string[]) {
  return {
    text,
    candidates: [{
      groundingMetadata: {
        groundingChunks: chunkSites.map((site, index) => ({
          web: { title: site, uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/chunk-${index}` },
        })),
      },
    }],
  };
}

function enrichmentReply(sites: string[], official = true) {
  return JSON.stringify({
    products: [{
      line_id: 'LINE_ID',
      product_name: 'Lalvin EC-1118',
      brand_name: 'Lallemand',
      manufacturer_name: 'Lallemand',
      active_ingredients: ['Saccharomyces cerevisiae bayanus'],
      recommended_dosage: '25-40 g/hL',
      usage_instructions: 'Rehydrate in 10x its weight of water at 35-40 C.',
      safety_notes: 'Check the current label before use.',
      source_sites: sites,
      source_official: official,
      not_applicable: false,
    }],
  });
}

// The enrichment reply must address the line by the id minted during
// extraction, which the analyzer only reveals in the second prompt.
function respondWith(enrichment: (lineId: string) => unknown) {
  generate.mockImplementation(async (request: any) => {
    const prompt = Array.isArray(request.contents) ? '' : String(request.contents);
    const lineId = /"line_id":"([^"]+)"/.exec(prompt)?.[1];
    return lineId ? enrichment(lineId) : { text: JSON.stringify(EXTRACTION) };
  });
}

const draftInput = {
  client,
  organizationId: `org-${Math.random().toString(36).slice(2)}`,
  maxModelCallsPerDay: 100,
  request: { invoiceText: 'Lalvin EC-1118 yeast 500 g bag', enrichOnline: true, lang: 'en' as const },
  inventory: [] as InventoryItem[],
};

describe('AI invoice online enrichment', () => {
  beforeEach(() => {
    generate.mockReset();
  });

  it('never combines Google Search with a JSON response schema', async () => {
    respondWith((lineId) => groundedReply(
      enrichmentReply(['lallemandwine.com']).replace('LINE_ID', lineId),
      ['lallemandwine.com'],
    ));

    await analyzeInvoiceDraft({ ...draftInput, organizationId: `org-${Math.random()}` });

    // Gemini answers "Tool use with a response mime type: 'application/json' is
    // unsupported" with HTTP 400, which silently discarded every enrichment.
    const enrichmentCall = generate.mock.calls[1][0];
    expect(enrichmentCall.config.tools).toEqual([{ googleSearch: {} }]);
    expect(enrichmentCall.config.responseMimeType).toBeUndefined();
    expect(enrichmentCall.config.responseSchema).toBeUndefined();
  });

  it('keeps fenced JSON findings and links sources matched by site domain', async () => {
    respondWith((lineId) => groundedReply(
      `\`\`\`json\n${enrichmentReply(['lallemandwine.com']).replace('LINE_ID', lineId)}\n\`\`\``,
      ['lallemandwine.com', 'retailer.example'],
    ));

    const draft = await analyzeInvoiceDraft({ ...draftInput, organizationId: `org-${Math.random()}` });

    const line = draft.lines[0];
    expect(line.activeIngredients).toEqual(['Saccharomyces cerevisiae bayanus']);
    expect(line.recommendedDosage).toBe('25-40 g/hL');
    expect(line.sourceStatus).toBe('official');
    expect(line.sourceIds).toHaveLength(1);
    const cited = draft.sources.find((source) => source.id === line.sourceIds[0]);
    expect(cited).toMatchObject({ domain: 'lallemandwine.com', official: true });
  });

  it('keeps untraceable findings for review instead of discarding them', async () => {
    respondWith((lineId) => groundedReply(
      enrichmentReply(['lallemandwine.com']).replace('LINE_ID', lineId),
      ['someretailer.example'],
    ));

    const draft = await analyzeInvoiceDraft({ ...draftInput, organizationId: `org-${Math.random()}` });

    const line = draft.lines[0];
    expect(line.recommendedDosage).toBe('25-40 g/hL');
    expect(line.sourceIds).toEqual([]);
    expect(line.sourceStatus).toBe('not_found');
    expect(line.warnings.join(' ')).toContain('could not be traced');
  });

  it('reports when the research call returns nothing usable', async () => {
    respondWith(() => groundedReply('I could not find these products.', ['lallemandwine.com']));

    const draft = await analyzeInvoiceDraft({ ...draftInput, organizationId: `org-${Math.random()}` });

    expect(draft.lines[0].recommendedDosage).toBeUndefined();
    expect(draft.warnings.join(' ')).toContain('no usable result');
  });
});
