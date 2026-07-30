import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiFindingRecord } from '../lib/ai';
import { __resetInMemoryAiNotificationPreferences } from '../server/aiNotificationPreferences';
import {
  __resetInMemoryAiModelTelemetry,
  getAiModelCallOperations,
} from '../server/aiModelTelemetry';
import { __resetInMemoryAiNotificationReadStates } from '../server/aiInAppNotificationState';
import { __resetInMemoryAiKnowledge } from '../server/aiKnowledge';

const mocks = vi.hoisted(() => ({
  role: 'Lab Technician',
  data: {} as any,
  generate: vi.fn(),
  save: vi.fn(),
  reserve: vi.fn(),
  emailVerified: true,
  username: 'ai-user',
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAI {
    models = { generateContent: mocks.generate };
  },
}));

vi.mock('../server/middleware/auth', () => ({
  requireCapability: async (_req: express.Request, res: express.Response, capability: string) => {
    if (capability === 'write' && mocks.role === 'Read-Only') {
      res.status(403).json({ error: 'Forbidden: write access required.' });
      return null;
    }
    return { username: mocks.username, role: mocks.role };
  },
}));

vi.mock('../server/db', () => ({
  getDB: () => ({
    users: ['ai-user', 'ai-colleague'].map((username) => ({
      username,
      activeOrganizationId: 'org-ai',
      email: `${username}@example.com`,
      emailVerified: mocks.emailVerified,
      accountEnabled: true,
    })),
    organizations: [{ id: 'org-ai', name: 'AI Winery' }],
    memberships: ['ai-user', 'ai-colleague'].map((username) => ({
      organizationId: 'org-ai',
      userId: username,
      role: mocks.role,
    })),
  }),
  getPrismaClientForAdmin: vi.fn(async () => null),
  getUserData: vi.fn(async () => mocks.data),
  reloadUserOrganizationDataFromPostgres: vi.fn(async () => null),
  saveUserData: mocks.save,
  OrganizationStateVersionConflictError: class OrganizationStateVersionConflictError extends Error {},
}));

vi.mock('../server/aiModelBudget', () => ({
  getAiModelBudget: vi.fn(async () => ({ used: 0, remaining: 120 })),
  reserveAiModelCalls: mocks.reserve,
  __resetInMemoryAiModelBudget: vi.fn(),
}));

function wineryData(): any {
  return {
    vessels: [{
      id: 'T-SECRET',
      type: 'steel',
      shape: 'cylindrical',
      capacity: 1_000,
      currentVolume: 900,
      assignedLotId: 'L1',
      cleaningStatus: 'clean',
      lastCleaned: '2026-07-20',
      temperature: 23,
      coolingJacketActive: false,
      targetTemperature: 20,
      lastOperation: 'SECRET_VESSEL_OPERATION',
    }],
    lots: [{
      id: 'L1',
      name: 'Saperavi',
      vintage: 2026,
      variety: 'Saperavi',
      vineyardBlock: 'B1',
      region: 'Kakheti',
      initialVolume: 1_000,
      currentVolume: 900,
      wineClass: 'red',
      stage: 'aging',
      createdAt: '2026-07-01',
      history: [],
    }],
    fermlogs: [{
      id: 'ferm-secret',
      tankId: 'T-SECRET',
      lotId: 'L1',
      date: '2026-07-28',
      temperature: 23,
      density: 0.995,
      sugar: 1,
      ph: 3.6,
      tastingNotes: 'SECRET_FERMENTATION_NOTE',
      capManagement: '',
      additives: '',
    }],
    lablogs: [{
      id: 'lab-1',
      lotId: 'L1',
      tankId: 'T-SECRET',
      date: '2026-07-28',
      alcoholPct: 13,
      volatileAcid: 0.3,
      freeSo2: 10,
      totalSo2: 90,
      residualSugar: 2,
      ph: 3.6,
      malicAcid: 0.5,
      lacticAcid: 0.1,
      turbidity: 5,
      technician: 'QA',
      titratableAcidity: 6,
    }],
    inventory: [],
    tasks: [],
    cellarOps: [{
      id: 'op-secret',
      lotId: 'L1',
      date: '2026-07-28',
      type: 'SECRET_CELLAR_OPERATION',
      notes: 'SECRET_OPERATION_NOTE',
    }],
    transfers: [],
    bottlingRuns: [],
    grapeIntakes: [],
    blocks: [],
    scoutings: [],
    sprays: [],
    samplings: [],
    harvests: [],
    certificationRecords: [],
    salesOrders: [],
    aiFindings: [],
    companyProfile: {
      wineryName: 'Private Winery',
      country: 'Georgia',
      aiConfig: { maxModelCallsPerDay: 120 },
    },
  };
}

function storedFinding(): AiFindingRecord {
  return {
    id: 'feedback-route-finding',
    createdAt: '2026-07-29T10:00:00.000Z',
    source: 'rule',
    agent: 'laboratory',
    area: 'laboratory',
    findingType: 'lab_gap',
    severity: 'warning',
    entityType: 'lot',
    entityId: 'L1',
    entityLabel: 'Saperavi (L1)',
    relatedEntities: [],
    title: { en: 'Analysis overdue', ka: 'ანალიზი დაგვიანებულია' },
    observation: { en: 'No recent analysis.', ka: 'ბოლო ანალიზი არ არის.' },
    whyItMatters: { en: 'Review is needed.', ka: 'საჭიროა გადახედვა.' },
    possibleCauses: [],
    recommendedActions: [],
    evidence: [],
    confidence: { level: 'high', score: 1, reasons: [] },
    missingInformation: [],
    requiresHumanConfirmation: true,
    roles: ['Lab Technician'],
    cooldownHours: 24,
    dedupeKey: 'lab_gap:L1',
    status: 'new',
    lastSeenAt: '2026-07-29T10:00:00.000Z',
    occurrences: 1,
    lastModified: '2026-07-29T10:00:00.000Z',
  };
}

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const routes = await import('../server/routes/ai');
  const app = express();
  app.use(express.json());
  app.use('/api/ai', routes.default);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  mocks.role = 'Lab Technician';
  mocks.username = 'ai-user';
  mocks.emailVerified = true;
  mocks.data = wineryData();
  mocks.save.mockReset().mockImplementation(async (_username: string, data: any) => {
    mocks.data = data;
  });
  mocks.reserve.mockReset().mockImplementation(async (
    _org: string,
    limit: number,
    requested = 1,
  ) => ({
    granted: true,
    requested,
    used: requested,
    remaining: limit - requested,
  }));
  mocks.generate.mockReset().mockResolvedValue({
    text: JSON.stringify({
      findings: [{
        finding_type: 'so2_active_fraction_low',
        title: 'Active molecular protection is low',
        severity: 'warning',
        entity_type: 'lot',
        entity_id: 'L1',
        observation: 'The recorded pH and free SO2 imply weak molecular protection.',
        reasoning_summary: 'Only a small share of free SO2 is active at this pH.',
        possible_causes: [],
        recommended_actions: [{ kind: 'measure', label: 'Confirm pH and free SO2' }],
        confidence: 0.8,
        confidence_reasons: ['Recent analysis is available'],
        missing_information: [],
        source_refs: ['lablogs:lab-1'],
        requires_human_confirmation: true,
      }],
    }),
  });
  __resetInMemoryAiNotificationPreferences();
  __resetInMemoryAiNotificationReadStates();
  __resetInMemoryAiModelTelemetry();
  __resetInMemoryAiKnowledge();
});

afterAll(async () => {
  delete process.env.GEMINI_API_KEY;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe.sequential('AI route boundaries', () => {
  it('lets winery administrators manage tenant knowledge without exposing it to specialists', async () => {
    mocks.role = 'Owner/Admin';
    const created = await fetch(`${baseUrl}/api/ai/knowledge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Winery laboratory protocol',
        content: 'This reviewed winery protocol requires a fresh pH and free SO2 measurement before any sulfur addition. It also requires a documented bench review and human approval before the cellar operation is scheduled.',
        sourceLabel: 'SOP 12',
        agents: ['winemaking', 'laboratory'],
        language: 'en',
      }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    expect(createdBody.document).toMatchObject({
      title: 'Winery laboratory protocol',
      sourceLabel: 'SOP 12',
      chunkCount: 1,
    });

    const listed = await fetch(`${baseUrl}/api/ai/knowledge`);
    expect(listed.status).toBe(200);
    expect((await listed.json()).documents).toHaveLength(1);

    mocks.role = 'Lab Technician';
    expect((await fetch(`${baseUrl}/api/ai/knowledge`)).status).toBe(403);

    mocks.role = 'Owner/Admin';
    const archived = await fetch(
      `${baseUrl}/api/ai/knowledge/${encodeURIComponent(createdBody.document.id)}`,
      { method: 'DELETE' },
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ archived: true });
  });

  it('projects open routed findings into a read-only notification feed', async () => {
    const response = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.minimumSeverity).toBe('attention');
    expect(body.total).toBeGreaterThan(0);
    expect(body.findings[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      observation: expect.any(String),
      status: expect.stringMatching(/^(new|reviewed|accepted)$/),
    }));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('routes notification responsibility separately from activity-log visibility', async () => {
    mocks.role = 'Read-Only';
    const response = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.findings).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('persists read state per user and supports marking the current feed read', async () => {
    const initial = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const initialBody = await initial.json();
    const first = initialBody.findings[0];
    expect(initialBody.unread).toBe(initialBody.total);
    expect(first).toEqual(expect.objectContaining({
      unread: true,
      notificationEventKey: expect.any(String),
    }));

    const markOne = await fetch(
      `${baseUrl}/api/ai/notifications/${encodeURIComponent(first.id)}/read`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lang: 'en' }),
      },
    );
    const markedBody = await markOne.json();
    expect(markOne.status).toBe(200);
    expect(markedBody).toEqual(expect.objectContaining({
      findingId: first.id,
      unread: false,
      readAt: expect.any(String),
    }));

    const refreshed = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const refreshedBody = await refreshed.json();
    expect(refreshedBody.unread).toBe(initialBody.unread - 1);
    expect(refreshedBody.findings.find((finding: any) => finding.id === first.id))
      .toEqual(expect.objectContaining({ unread: false, readAt: expect.any(String) }));

    // A colleague's acknowledgement state is independent.
    mocks.username = 'ai-colleague';
    const colleague = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const colleagueBody = await colleague.json();
    expect(colleagueBody.findings.find((finding: any) => finding.id === first.id)?.unread).toBe(true);

    const markAll = await fetch(`${baseUrl}/api/ai/notifications/read-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang: 'en' }),
    });
    const markAllBody = await markAll.json();
    expect(markAll.status).toBe(200);
    expect(markAllBody.marked).toBe(colleagueBody.total);

    const afterAll = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const afterAllBody = await afterAll.json();
    expect(afterAllBody.unread).toBe(0);
    expect(afterAllBody.findings.every((finding: any) => finding.unread === false)).toBe(true);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('applies the winery threshold, bounds the feed, and honors monitoring disablement', async () => {
    mocks.role = 'Owner/Admin';
    mocks.data.inventory = [{
      id: 'INV-NUTRIENT',
      name: 'Yeast nutrient',
      category: 'nutritions',
      stock: 0,
      minThreshold: 2,
      unit: 'kg',
      costPerUnit: 20,
      supplierName: 'Supplier',
    }];
    mocks.data.tasks = [{
      id: 'TASK-OVERDUE',
      title: 'Rack lot',
      priority: 'high',
      dueDate: '2020-01-01',
      assignedTo: 'Nino',
      status: 'pending',
      description: '',
    }];
    mocks.data.companyProfile.aiConfig = {
      maxModelCallsPerDay: 120,
      minimumSeverity: 'critical',
    };

    const bounded = await fetch(`${baseUrl}/api/ai/notifications?lang=en&limit=1`);
    const boundedBody = await bounded.json();
    expect(bounded.status).toBe(200);
    expect(boundedBody.minimumSeverity).toBe('critical');
    expect(boundedBody.total).toBeGreaterThan(1);
    expect(boundedBody.findings).toHaveLength(1);
    expect(boundedBody.findings[0].severity).toBe('critical');
    expect(boundedBody.overflow).toBe(boundedBody.total - 1);

    mocks.data.companyProfile.aiConfig.monitoringEnabled = false;
    const disabled = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const disabledBody = await disabled.json();
    expect(disabled.status).toBe(200);
    expect(disabledBody.total).toBe(0);
    expect(disabledBody.findings).toEqual([]);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('lets each user raise their in-app severity floor without weakening winery policy', async () => {
    mocks.role = 'Owner/Admin';
    mocks.data.tasks = [{
      id: 'TASK-RECENTLY-OVERDUE',
      title: 'Check cellar plan',
      priority: 'low',
      dueDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      assignedTo: 'Nino',
      status: 'pending',
      description: '',
    }];

    const baseline = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const baselineBody = await baseline.json();
    expect(baselineBody.findings.some((finding: any) => finding.severity === 'attention')).toBe(true);
    expect(baselineBody.personalMinimumSeverity).toBe('info');
    expect(baselineBody.effectiveMinimumSeverity).toBe('attention');

    const preference = await fetch(`${baseUrl}/api/ai/notification-preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inAppMinimumSeverity: 'critical' }),
    });
    const preferenceBody = await preference.json();
    expect(preference.status).toBe(200);
    expect(preferenceBody.preference.inAppMinimumSeverity).toBe('critical');

    const quieter = await fetch(`${baseUrl}/api/ai/notifications?lang=en`);
    const quieterBody = await quieter.json();
    expect(quieterBody.personalMinimumSeverity).toBe('critical');
    expect(quieterBody.effectiveMinimumSeverity).toBe('critical');
    expect(quieterBody.findings.length).toBeGreaterThan(0);
    expect(quieterBody.findings.every((finding: any) => finding.severity === 'critical')).toBe(true);

    const invalid = await fetch(`${baseUrl}/api/ai/notification-preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inAppMinimumSeverity: 'urgent' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('does not let a read-only auditor trigger a persisted evaluation', async () => {
    mocks.role = 'Read-Only';
    const response = await fetch(`${baseUrl}/api/ai/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang: 'en' }),
    });
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('filters model context to the caller role and reloads the persisted interpretation', async () => {
    const analyze = await fetch(`${baseUrl}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang: 'en', maxAnalyses: 1 }),
    });
    const analyzed = await analyze.json();

    expect(analyze.status).toBe(200);
    expect(analyzed.modelFindings).toBe(1);
    expect(mocks.generate).toHaveBeenCalledOnce();
    const prompt = String(mocks.generate.mock.calls[0][0]?.contents || '');
    expect(prompt).toContain('"laboratory"');
    expect(prompt).toContain('"sourceRef":"lablogs:lab-1"');
    expect(prompt).not.toContain('SECRET_FERMENTATION_NOTE');
    expect(prompt).not.toContain('SECRET_CELLAR_OPERATION');
    expect(prompt).not.toContain('T-SECRET');

    const feed = await fetch(`${baseUrl}/api/ai/findings?lang=en`);
    const body = await feed.json();
    const modelFinding = body.findings.find((finding: any) => finding.source === 'model');
    expect(modelFinding).toBeTruthy();
    expect(modelFinding.evidence).toEqual([
      expect.objectContaining({
        sourceRef: 'lablogs:lab-1',
        value: expect.stringContaining('"ph":3.6'),
      }),
    ]);
    const telemetry = await getAiModelCallOperations(20);
    expect(telemetry.byPurpose.analysis).toEqual(expect.objectContaining({
      total: 1,
      succeeded: 1,
    }));
  });

  it('does not persist a model finding with an invented citation', async () => {
    mocks.generate.mockResolvedValueOnce({
      text: JSON.stringify({
        findings: [{
          finding_type: 'unsupported_claim',
          title: 'Unsupported interpretation',
          severity: 'warning',
          entity_type: 'lot',
          entity_id: 'L1',
          observation: 'The laboratory pattern needs review.',
          reasoning_summary: 'The cited source should support this interpretation.',
          possible_causes: [],
          recommended_actions: [],
          confidence: 0.7,
          confidence_reasons: [],
          missing_information: [],
          source_refs: ['lablogs:invented'],
          requires_human_confirmation: true,
        }],
      }),
    });

    const response = await fetch(`${baseUrl}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang: 'en', maxAnalyses: 1 }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.modelFindings).toBe(0);
    expect(body.rejected).toEqual([
      expect.stringContaining('unknown_source_ref'),
    ]);
    // A caller must be able to tell "nothing to add" from "everything discarded",
    // otherwise the UI reports silence as a clean bill of health.
    expect(body.rejectedCount).toBe(1);
    expect(body.rejectionsByReason).toEqual({ unknown_source_ref: 1 });
    expect((mocks.data.aiFindings || []).some((finding: any) => finding.source === 'model')).toBe(false);

    // The same distinction has to reach operations: a response that parsed but
    // produced nothing usable is an invalid response, not a success.
    const telemetry = await getAiModelCallOperations(20);
    expect(telemetry.byPurpose.analysis).toEqual(expect.objectContaining({
      total: 1,
      succeeded: 0,
      invalidResponse: 1,
    }));
  });

  it('never answers with columns the asker cannot open in the app', async () => {
    // A cellar worker may view lots but has no laboratory permission. The
    // `lots_filter` query is gated on `lots` yet joins pH, free SO2 and VA from
    // the lab, so gating the query kind alone is not sufficient protection.
    mocks.role = 'Cellar Worker';
    mocks.generate
      // 1. planner
      .mockResolvedValueOnce({ text: JSON.stringify({ kind: 'lots_filter', filters: [] }) })
      // 2. explanation
      .mockResolvedValueOnce({ text: 'Here are the lots.' });

    const response = await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'List every lot with its chemistry', lang: 'en' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.query.kind).toBe('lots_filter');
    expect(body.rows).toHaveLength(1);
    // The lot itself is permitted; its laboratory chemistry is not.
    expect(body.rows[0]).toEqual(expect.objectContaining({ lotId: 'L1' }));
    expect(body.rows[0].ph).toBeNull();
    expect(body.rows[0].freeSo2).toBeNull();
    expect(body.rows[0].volatileAcid).toBeNull();
    expect(body.rows[0].lastAnalysis).toBeNull();

    // Nor may the lab values reach the model that writes the answer.
    const explanationPrompt = String(mocks.generate.mock.calls[1][0]?.contents || '');
    expect(explanationPrompt).not.toContain('3.6');
    expect(explanationPrompt).not.toContain('lablogs:lab-1');
  });

  it('still answers laboratory chemistry to a role that owns it', async () => {
    mocks.role = 'Lab Technician';
    mocks.generate
      .mockResolvedValueOnce({ text: JSON.stringify({ kind: 'lots_filter', filters: [] }) })
      .mockResolvedValueOnce({ text: 'Here are the lots.' });

    const response = await fetch(`${baseUrl}/api/ai/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'List every lot with its chemistry', lang: 'en' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows[0]).toEqual(expect.objectContaining({ lotId: 'L1', ph: 3.6, freeSo2: 10 }));
  });

  it('keeps reviewer feedback independent and never projects another reviewer', async () => {
    mocks.data.aiFindings = [storedFinding()];

    const firstReview = await fetch(`${baseUrl}/api/ai/findings/feedback-route-finding`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        feedback: { verdict: 'helpful', comment: 'private first review' },
      }),
    });
    const firstBody = await firstReview.json();
    expect(firstReview.status).toBe(200);
    expect(firstBody.finding.feedback).toEqual(expect.objectContaining({
      verdict: 'helpful',
      comment: 'private first review',
    }));
    expect(firstBody.finding.feedback).not.toHaveProperty('submittedBy');
    expect(firstBody.finding).not.toHaveProperty('feedbackEntries');

    mocks.username = 'ai-colleague';
    const secondReview = await fetch(`${baseUrl}/api/ai/findings/feedback-route-finding`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        feedback: { verdict: 'incorrect', comment: 'private second review' },
      }),
    });
    const secondBody = await secondReview.json();
    expect(secondReview.status).toBe(200);
    expect(secondBody.finding.feedback).toEqual(expect.objectContaining({
      verdict: 'incorrect',
      comment: 'private second review',
    }));
    expect(JSON.stringify(secondBody)).not.toContain('private first review');
    expect(mocks.data.aiFindings[0].feedbackEntries).toHaveLength(2);

    mocks.username = 'ai-user';
    const feed = await fetch(`${baseUrl}/api/ai/findings?lang=en`);
    const body = await feed.json();
    expect(feed.status).toBe(200);
    expect(body.findings[0].feedback).toEqual(expect.objectContaining({
      verdict: 'helpful',
      comment: 'private first review',
    }));
    expect(JSON.stringify(body)).not.toContain('ai-colleague');
    expect(JSON.stringify(body)).not.toContain('private second review');
  });

  it('keeps email alerts opt-in and winery-scoped for the current user', async () => {
    const initial = await fetch(`${baseUrl}/api/ai/notification-preferences`);
    const initialBody = await initial.json();
    expect(initial.status).toBe(200);
    expect(initialBody.preference.emailEnabled).toBe(false);

    const update = await fetch(`${baseUrl}/api/ai/notification-preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true, minimumSeverity: 'critical' }),
    });
    const body = await update.json();
    expect(update.status).toBe(200);
    expect(body.preference).toEqual(expect.objectContaining({
      organizationId: 'org-ai',
      username: 'ai-user',
      emailEnabled: true,
      minimumSeverity: 'critical',
    }));
    expect(body.preference.emailEnabledAt).toEqual(expect.any(String));
  });

  it('requires a verified account email before enabling delivery', async () => {
    mocks.emailVerified = false;
    const response = await fetch(`${baseUrl}/api/ai/notification-preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true, minimumSeverity: 'warning' }),
    });
    expect(response.status).toBe(409);
  });
});
