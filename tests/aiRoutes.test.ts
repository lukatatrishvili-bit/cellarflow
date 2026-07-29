import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetInMemoryAiNotificationPreferences } from '../server/aiNotificationPreferences';

const mocks = vi.hoisted(() => ({
  role: 'Lab Technician',
  data: {} as any,
  generate: vi.fn(),
  save: vi.fn(),
  reserve: vi.fn(),
  emailVerified: true,
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
    return { username: 'ai-user', role: mocks.role };
  },
}));

vi.mock('../server/db', () => ({
  getDB: () => ({
    users: [{
      username: 'ai-user',
      activeOrganizationId: 'org-ai',
      email: 'ai-user@example.com',
      emailVerified: mocks.emailVerified,
      accountEnabled: true,
    }],
    organizations: [{ id: 'org-ai', name: 'AI Winery' }],
    memberships: [{ organizationId: 'org-ai', userId: 'ai-user', role: mocks.role }],
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
});

afterAll(async () => {
  delete process.env.GEMINI_API_KEY;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe.sequential('AI route boundaries', () => {
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
    expect((mocks.data.aiFindings || []).some((finding: any) => finding.source === 'model')).toBe(false);
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
