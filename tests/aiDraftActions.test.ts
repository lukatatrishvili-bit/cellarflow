import { describe, expect, it } from 'vitest';
import {
  createAiDraftQueueItems,
  deriveAiDraftActions,
  draftActionFromFindingRecommendation,
  formatDraftTaskDescription,
  upsertAiDraftQueueItems,
} from '../lib/aiDraftActions';
import type { AiFinding } from '../lib/ai';

const cellarState = {
  tanksCount: 2,
  activeFermsCount: 1,
  avgTemp: 18.5,
  lowSo2Count: 1,
  highVaCount: 0,
  sampleData: [
    {
      id: 'T-1',
      lotCode: 'LOT-SAP-2026',
      currentVolume: 1200,
      wineName: 'Saperavi Reserve',
      stage: 'aging'
    }
  ]
};

describe('AI draft actions', () => {
  it('creates review-only lab and SO2 calculation drafts from sulfite guidance', () => {
    const actions = deriveAiDraftActions(
      'Free SO2 is low. Calculate KMBS addition after confirming pH and current free SO2.',
      { cellarState, contextTab: 'labs', contextModule: 'gvino' }
    );

    expect(actions.map(action => action.type)).toEqual(['lab_check', 'so2_calculation']);
    expect(actions.every(action => action.reviewOnly)).toBe(true);
    expect(actions[0].payload).toMatchObject({ lotId: 'LOT-SAP-2026' });
    expect(actions.flatMap(action => action.warnings).join(' ')).toContain('do not modify official winery records');
    expect(actions.flatMap(action => action.warnings).join(' ')).toContain('Confirm lot');
  });

  it('turns mildew guidance into a Vazi spray recommendation with PHI and REI warnings', () => {
    const actions = deriveAiDraftActions(
      'High downy mildew pressure after rain and humidity. Prepare a spray plan and check PHI.',
      { contextModule: 'vazi' }
    );

    const spray = actions.find(action => action.type === 'spray_recommendation');
    expect(spray).toBeTruthy();
    expect(spray?.priority).toBe('high');
    expect(spray?.targetModule).toBe('vazi');
    expect(spray?.warnings.join(' ')).toContain('PHI');
    expect(spray?.warnings.join(' ')).toContain('REI');
  });

  it('creates a compliance warning without applying official document changes', () => {
    const actions = deriveAiDraftActions(
      'The PDO certificate may be expired and export documents are missing attachments.',
      { contextModule: 'docs' }
    );

    const compliance = actions.find(action => action.type === 'compliance_warning');
    expect(compliance).toBeTruthy();
    expect(compliance?.priority).toBe('high');
    expect(compliance?.reviewOnly).toBe(true);
    expect(formatDraftTaskDescription(compliance!)).toContain('do not modify official winery records');
    expect(formatDraftTaskDescription(compliance!)).toContain('Verify official documents');
  });

  it('creates a separate explanation draft for missing official document fields', () => {
    const actions = deriveAiDraftActions(
      'Explain what is missing from Annex 3 official document warnings before export submission.',
      { contextModule: 'docs' }
    );

    const explanation = actions.find(action => action.type === 'official_document_explanation');
    expect(explanation).toBeTruthy();
    expect(explanation?.targetModule).toBe('documents');
    expect(explanation?.priority).toBe('high');
    expect(explanation?.reviewOnly).toBe(true);
    expect(explanation?.payload).toMatchObject({
      suggestedSections: ['missing fields', 'source module', 'blocking vs warning', 'next data-entry step']
    });
  });

  it('creates a transfer-specific draft with source, destination, volume, and sanitation gates', () => {
    const actions = deriveAiDraftActions(
      'Prepare a wine transfer from the source vessel to a clean destination vessel.',
      { cellarState, contextTab: 'transfers', contextModule: 'gvino' },
    );

    const transfer = actions.find(action => action.type === 'transfer_plan');
    expect(transfer).toMatchObject({
      targetModule: 'transfers',
      reviewOnly: true,
      payload: {
        requiredInputs: ['sourceVesselId', 'destinationVesselId', 'volumeL', 'expectedLossL', 'sanitationStatus'],
      },
    });
  });

  it('creates bottling and inventory drafts without placing orders or mutating records', () => {
    const bottling = deriveAiDraftActions(
      'Check bottling readiness, cork stock, capsules, labels, and boxes.',
      { cellarState, contextTab: 'bottling' },
    ).find(action => action.type === 'bottling_readiness');
    expect(bottling?.targetModule).toBe('bottling');
    expect(bottling?.warnings.join(' ')).toContain('stock shortages');

    const restock = deriveAiDraftActions(
      'Prepare an urgent inventory reorder from the supplier.',
      { contextTab: 'inventory' },
    ).find(action => action.type === 'inventory_restock');
    expect(restock?.targetModule).toBe('inventory');
    expect(restock?.warnings.join(' ')).toContain('No order is sent automatically');
  });

  it('creates human-reviewed YAN nutrition and lactic-acid adjustment drafts', () => {
    const nutrition = deriveAiDraftActions(
      'Calculate a YAN nutrient dose for this fermentation.',
      { cellarState, contextTab: 'fermentation' },
    ).find(action => action.type === 'fermentation_nutrition');
    expect(nutrition?.payload).toMatchObject({
      requiresConfirmedInputs: expect.arrayContaining(['currentYanMgL', 'availableNitrogenPct']),
    });

    const acid = deriveAiDraftActions(
      'Plan a lactic acid adjustment using the liquid purity and density.',
      { cellarState, contextTab: 'calculators' },
    ).find(action => action.type === 'acid_adjustment');
    expect(acid?.targetModule).toBe('calculators');
    expect(acid?.priority).toBe('high');
    expect(acid?.warnings.join(' ')).toContain('bench trial');
  });

  it('falls back to a human-reviewed task draft for generic protocols', () => {
    const actions = deriveAiDraftActions('Please write a checklist for tomorrow morning cellar rounds.');

    expect(actions[0]).toMatchObject({
      type: 'task',
      targetModule: 'tasks',
      priority: 'medium',
      reviewOnly: true
    });
  });

  it('saves draft actions into a review queue without changing source records', () => {
    const actions = deriveAiDraftActions('Explain missing Annex 3 fields for export.');
    const queue = createAiDraftQueueItems(actions, {
      createdAt: '2026-07-09T00:00:00.000Z',
      createdBy: 'Luka',
      dueDate: '2026-07-10',
      sourceModule: 'docs',
    });

    expect(queue.every(item => item.status === 'draft')).toBe(true);
    expect(queue.every(item => item.reviewOnly)).toBe(true);
    expect(queue[0].createdBy).toBe('Luka');

    const converted = { ...queue[0], status: 'converted_to_task' as const };
    const merged = upsertAiDraftQueueItems([converted], queue);
    expect(merged.find(item => item.id === converted.id)?.status).toBe('converted_to_task');
  });

  it('turns finding recommendations into typed, provenance-carrying drafts', () => {
    const finding = {
      id: 'ai-stock-yeast',
      findingType: 'stock_shortage',
      severity: 'warning',
      entityType: 'inventory_item',
      entityId: 'INV-YEAST',
      title: { en: 'Yeast stock will run short', ka: 'საფუარის მარაგი არასაკმარისი იქნება' },
      observation: {
        en: 'Planned fermentations require more yeast than is on hand.',
        ka: 'დაგეგმილ დუღილებს არსებულზე მეტი საფუარი სჭირდება.',
      },
    } as AiFinding;
    const action = {
      kind: 'purchase' as const,
      label: { en: 'Prepare a yeast restock', ka: 'მოამზადეთ საფუარის მარაგის შევსება' },
      targetModule: 'inventory',
      requiresConfirmation: true,
    };

    const draft = draftActionFromFindingRecommendation(finding, action, { actionIndex: 2 });

    expect(draft).toMatchObject({
      type: 'inventory_restock',
      targetModule: 'inventory',
      priority: 'medium',
      reviewOnly: true,
      payload: {
        source: 'ai_finding',
        findingId: 'ai-stock-yeast',
        entityId: 'INV-YEAST',
        recommendedActionKind: 'purchase',
        recommendedActionIndex: 2,
        requiresConfirmation: true,
      },
    });
    expect(draft.warnings.join(' ')).toContain('No order is sent automatically');
  });
});
