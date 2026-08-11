import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { getDB } from '../db';
import { requireCapability } from '../middleware/auth';
import { GEMINI_MODEL } from '../config';
import { reserveAiModelCalls } from '../aiModelBudget';
import { resolveAiConfig } from '../../lib/ai';

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

// Helper to assemble rich historical context about the user's winery and vineyard
export function getHistoricalContext(username: string): string {
  const db = getDB();
  const user = db.users.find(u => u.username === username);
  const orgId = user?.activeOrganizationId;
  const userData = orgId ? db.orgData[orgId] : null;
  if (!userData) return "";

  let context = "\n[HISTORICAL WINERY & VINEYARD CONTEXT]\n";

  const blockName = (id: string) => (userData.blocks || []).find((b: any) => b.id === id)?.name || id;

  // 1. Vineyard Blocks
  if (userData.blocks && userData.blocks.length > 0) {
    context += "\n* VINEYARD BLOCKS:\n";
    userData.blocks.forEach((b: any) => {
      context += `  - Block "${b.name}" (${b.grapeVariety}, ${b.area} ha): Stage is "${b.currentPhenology}", Est. Harvest: ${b.estimatedHarvestDate}. Spacing: ${b.spacing}, Training: ${b.trainingSystem}.\n`;
    });
  }

  // 2. Recent Spraying and Scouting
  if (userData.scoutings && userData.scoutings.length > 0) {
    context += "\n* RECENT SCOUTING RECORDS:\n";
    userData.scoutings.slice(-5).forEach((s: any) => {
      context += `  - Date: ${s.date}, Block: "${blockName(s.blockId)}": Problem: ${s.problemType}, Severity: ${s.severity}. Findings: ${s.notes}\n`;
    });
  }
  if (userData.sprays && userData.sprays.length > 0) {
    context += "\n* RECENT SPRAY LOGS:\n";
    userData.sprays.slice(-5).forEach((s: any) => {
      context += `  - Date: ${s.date}, Block: "${blockName(s.blockId)}": Product: ${s.productName}, Target: ${s.targetProblem || 'N/A'}, Dose/ha: ${s.dosePerHa}.\n`;
    });
  }

  // 3. Active Wine Lots and Vessels
  if (userData.lots && userData.lots.length > 0) {
    context += "\n* WINE LOTS & VESSEL LOCATIONS:\n";
    userData.lots.forEach((l: any) => {
      const vessels = (userData.vessels || []).filter((v: any) => v.assignedLotId === l.id);
      const vesselNames = vessels.map((v: any) => `${v.name} (${v.type})`).join(', ') || "Not in vessel";
      context += `  - Lot "${l.id}" (${l.name}, ${l.variety}, Vintage ${l.vintage}, Vol: ${l.currentVolume} L): Stage is "${l.stage}". Stored in: ${vesselNames}.\n`;

      // Add recent chemistry
      const chemistry = (userData.lablogs || [])
        .filter((c: any) => c.lotId === l.id)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (chemistry) {
        context += `    - Last Chemistry (${chemistry.date}): pH: ${chemistry.ph}, Free SO2: ${chemistry.freeSo2} ppm, TA: ${chemistry.titratableAcidity} g/L, VA: ${chemistry.volatileAcid} g/L, Alc: ${chemistry.alcoholPct}%.\n`;
      }

      // Add recent fermentation readings
      const fermentation = (userData.fermlogs || [])
        .filter((f: any) => f.lotId === l.id)
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
      if (fermentation.length > 0) {
        context += "    - Recent Fermentation Readings:\n";
        fermentation.forEach((f: any) => {
          context += `      * ${f.date}: SG/Density: ${f.density}, Temp: ${f.temperature}°C, pH: ${f.ph ?? 'N/A'}\n`;
        });
      }
    });
  }

  return context;
}

// POST /api/gemini
router.post('/', async (req, res) => {
  try {
    const auth = await requireCapability(req, res, 'read');
    if (!auth) return;
    const { prompt, cellarState, stream, lang, contextModule, contextTab } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }

    const username = auth.username;

    // Every other model-calling route reserves against the organization's daily
    // budget; this one — the interactive Copilot, and so the highest-volume of
    // them — did not, leaving a single authenticated account able to spend the
    // Gemini quota without limit. Reserve before the call, not after, so a
    // burst of concurrent requests cannot race past the ceiling.
    const db = getDB();
    const organizationId = db.users.find(u => u.username === username)?.activeOrganizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'No active organization set for user' });
    }
    const aiConfig = resolveAiConfig(db.orgData[organizationId]?.companyProfile?.aiConfig);
    const reservation = await reserveAiModelCalls(organizationId, aiConfig.maxModelCallsPerDay, 1);
    if (!reservation.granted) {
      return res.status(429).json({
        code: 'ai_budget_exhausted',
        error: 'This winery has used its AI allowance for today.',
        budget: { used: reservation.used, remaining: reservation.remaining },
      });
    }

    let historicalContext = "";
    historicalContext = getHistoricalContext(username);

    const SYSTEM_PROMPT = `You are the VinOS AI Winemaker Assistant (Copilot), a world-class enological advisor, biochemist, and cellar processes expert.
You help winemakers worldwide with:
1. Stuck and sluggish fermentation diagnostics (sugar curves, temperature, nitrogen, density) and restart protocols.
2. Chemical additions and pH modeling: free SO2 calculations, potassium metabisulfite (KMBS) formulations, tartaric acid / calcium carbonate additions.
3. Traditional Georgian winemaking in clay Qvevris: skin contact maceration times, lid sealing, lime water lining, buried marani temperature dynamics.
4. Malolactic fermentation (MLF) management, volatile acidity (VA) mitigation, barrel aging, oak toast selections, and cellaring sanitation.

You have access to the winemaker's real-time cellar state and historical data (fermentation logs, chemistry history, vineyard spray/scouting records) below. Use this data to provide highly personalized, context-aware advice, diagnose issues, and perform enological calculations automatically without asking the user to re-enter values unless needed.

When recommending work that could change tasks, lab decisions, cellar operations, spray plans, official documents, certifications, or lot passports, frame it as reviewable draft action guidance. Never claim that you updated official records, submitted documents, changed compliance status, or applied a vineyard/cellar operation.

Provide highly professional, authentic, scientifically accurate enological advice. Answer concisely, using markdown tables or bullet points where helpful.`;

    let languageInstruction = "";
    if (lang === 'ka') {
      languageInstruction = "\n\nCRITICAL: The winemaker's system language is set to Georgian (KA). You MUST write your entire response in Georgian (ქართულად). Use authentic Georgian winemaking terminology (e.g., ქვევრი, რთველი, საფერავი, მაცერაცია, კუპაჟი).";
    }

    let chemicalContext = "";
    if (cellarState) {
      chemicalContext = `
[CURRENT CELLAR SUMMARY]
- Total active vessels: ${cellarState.tanksCount}
- Active fermentations: ${cellarState.activeFermsCount}
- Average fermenter temperature: ${cellarState.avgTemp}°C
- Low SO2 warnings: ${cellarState.lowSo2Count}
- High Volatile Acidity alerts: ${cellarState.highVaCount}

[REPRESENTATIVE TANKS/LOTS]
${JSON.stringify(cellarState.sampleData || [], null, 2)}
`;
    }

    const safeContextValue = (value: unknown) => (
      typeof value === 'string'
        ? value.replace(/[^a-z0-9_-]/gi, '').slice(0, 48)
        : ''
    );
    const processContext = `
[CURRENT WORKFLOW CONTEXT]
- Module: ${safeContextValue(contextModule) || 'unknown'}
- Screen: ${safeContextValue(contextTab) || 'unknown'}
Use this workflow context to make the answer operationally relevant. Keep every proposed record-changing action as a reviewable draft.
`;

    const fullPrompt = `${SYSTEM_PROMPT}${languageInstruction}\n\n${processContext}\n\n${chemicalContext}\n\n${historicalContext}\n\nWinemaker Query: ${prompt}\n\nAI Winemaker Response:\n`;

    const client = getAiClient();

    // Streaming (Server-Sent Events) for the chat UI
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      try {
        const streamed = await client.models.generateContentStream({
          model: GEMINI_MODEL,
          contents: fullPrompt,
        });
        for await (const chunk of streamed) {
          const piece = chunk.text;
          if (piece) res.write(`data: ${JSON.stringify({ text: piece })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (streamErr: any) {
        res.write(`data: ${JSON.stringify({ error: streamErr?.message || 'Streaming failed' })}\n\n`);
      }
      return res.end();
    }

    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: fullPrompt,
    });

    return res.json({ text: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    if (error?.message?.includes("GEMINI_API_KEY")) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }
    return res.status(500).json({
      error: "I am offline. Please verify settings or connection, or ask about general winemaking.",
      details: error?.message || "Unknown error"
    });
  }
});

export default router;
