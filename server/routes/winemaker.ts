import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { getDB } from '../db';
import { requireCapability } from '../middleware/auth';
import { GEMINI_MODEL } from '../config';
import { reserveAiModelCalls } from '../aiModelBudget';
import { withAiModelCallTelemetry } from '../aiModelTelemetry';
import { AiProviderRateLimitedError } from '../aiProviderLimiter';
import {
  loadWorkspace,
  normalizeLang,
  snapshotFor,
  snapshotVisibleToRole,
  withheldDataForRole,
} from '../aiWorkspace';
import {
  buildContext,
  buildCopilotPrompt,
  computeWineryBaselines,
  copilotScopeExists,
  normalizeCopilotHistory,
  normalizeCopilotQuestion,
  normalizeSnapshot,
  resolveAiConfig,
  resolveCopilotScopes,
  type AiContextScope,
  type AiEntityType,
} from '../../lib/ai';

const router = express.Router();

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

const FOCUS_TYPES = new Set<AiEntityType>(['lot', 'vessel', 'block', 'inventory_item']);

/**
 * A client may point the copilot at what the user has open. It is only a hint:
 * the scope is discarded unless the entity exists in the role-filtered
 * snapshot, so it can never widen what the request is allowed to read.
 */
function requestedFocus(value: unknown): AiContextScope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const entityType = candidate.entityType as AiEntityType;
  const entityId = candidate.entityId;
  if (!FOCUS_TYPES.has(entityType)) return null;
  if (typeof entityId !== 'string' || !entityId.trim()) return null;
  return { entityType, entityId: entityId.trim() };
}

/** Screen hints are labels, not data. Keep them to a safe, bounded token. */
const safeContextValue = (value: unknown) => (
  typeof value === 'string'
    ? value.replace(/[^a-z0-9_-]/gi, '').slice(0, 48)
    : ''
);

// POST /api/gemini
router.post('/', async (req, res) => {
  try {
    const auth = await requireCapability(req, res, 'read');
    if (!auth) return;
    const { prompt, stream, lang, contextModule, contextTab } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }

    const username = auth.username;
    const organizationId = getDB().users
      .find(u => u.username === username)?.activeOrganizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'No active organization set for user' });
    }

    const question = normalizeCopilotQuestion(prompt);
    if (!question) return res.status(400).json({ error: 'A question is required.' });
    const language = normalizeLang(lang);

    // The copilot reads the winery the same way the monitoring agents do:
    // a server-derived snapshot, filtered to the modules this role may open,
    // then narrowed to scoped context packages. Nothing the client sends about
    // the cellar is trusted, and no collection outside the caller's permissions
    // is ever serialized into the prompt.
    const workspace = await loadWorkspace(auth);
    if (!workspace) return res.status(404).json({ error: 'No active organization.' });

    // Every other model-calling route reserves against the organization's daily
    // budget; this one — the interactive Copilot, and so the highest-volume of
    // them — did not, leaving a single authenticated account able to spend the
    // Gemini quota without limit. Reserve before the call, not after, so a
    // burst of concurrent requests cannot race past the ceiling — and after the
    // cheap rejections, so a malformed request costs a winery nothing.
    const aiConfig = resolveAiConfig(
      (workspace.data as unknown as Record<string, any>).companyProfile?.aiConfig,
    );
    const reservation = await reserveAiModelCalls(organizationId, aiConfig.maxModelCallsPerDay, 1);
    if (!reservation.granted) {
      return res.status(429).json({
        code: 'ai_budget_exhausted',
        error: 'This winery has used its AI allowance for today.',
        budget: { used: reservation.used, remaining: reservation.remaining },
      });
    }

    const snapshot = snapshotVisibleToRole(
      normalizeSnapshot(snapshotFor(workspace, language)),
      workspace.role,
    );
    const baselines = computeWineryBaselines(snapshot);

    const focus = requestedFocus(req.body?.focus);
    const scopes = resolveCopilotScopes(
      snapshot,
      question,
      focus && copilotScopeExists(snapshot, focus) ? focus : null,
    );
    const contexts = scopes.map((scope) => buildContext(snapshot, baselines, scope));

    const fullPrompt = buildCopilotPrompt({
      language,
      role: workspace.role,
      question,
      contexts,
      history: normalizeCopilotHistory(req.body?.history, question),
      withheld: withheldDataForRole(workspace.role),
      screen: {
        module: safeContextValue(contextModule) || undefined,
        tab: safeContextValue(contextTab) || undefined,
      },
    });

    const client = getAiClient();

    // Streaming (Server-Sent Events) for the chat UI
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      try {
        // Wrapped like every other model call so the copilot — the highest
        // volume caller — is visible in the operations console rather than
        // being the one surface nobody can see failing.
        await withAiModelCallTelemetry({
          organizationId,
          purpose: 'copilot',
          model: GEMINI_MODEL,
        }, async () => {
          const streamed = await client.models.generateContentStream({
            model: GEMINI_MODEL,
            contents: fullPrompt,
          });
          let received = false;
          for await (const chunk of streamed) {
            const piece = chunk.text;
            if (piece) {
              received = true;
              res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
            }
          }
          return { value: null, valid: received };
        });
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (streamErr: any) {
        const message = streamErr instanceof AiProviderRateLimitedError
          ? 'The AI service is busy right now. Try again in a moment.'
          : streamErr?.message || 'Streaming failed';
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
      }
      return res.end();
    }

    const text = await withAiModelCallTelemetry({
      organizationId,
      purpose: 'copilot',
      model: GEMINI_MODEL,
    }, async () => {
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: fullPrompt,
      });
      return { value: response.text ?? null, valid: Boolean(response.text) };
    });

    return res.json({ text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error?.message?.includes("GEMINI_API_KEY")) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }
    // A provider quota is not an outage and not a misconfiguration; telling the
    // winemaker to check their settings would send them somewhere useless.
    if (error instanceof AiProviderRateLimitedError) {
      return res.status(429).json({
        code: 'ai_provider_rate_limited',
        error: 'The AI service is busy right now. Try again in a moment.',
        retryAfterMs: error.retryAfterMs,
      });
    }
    return res.status(500).json({
      error: "I am offline. Please verify settings or connection, or ask about general winemaking.",
      details: error?.message || "Unknown error"
    });
  }
});

export default router;
