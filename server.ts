import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gemini model used for all Winemaker AI features. Centralized here so the
// model can be swapped in a single place.
const GEMINI_MODEL = "gemini-3.5-flash";

const app = express();
app.use(express.json());

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

// -------------------------------------------------------------
// POST /api/gemini — Winemaker AI assistant
// Consumed by the AI chat (AiWinemaker) and the Weather tab.
// -------------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, cellarState, stream } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(400).json({
        error: "API key is not configured yet. Please configure GEMINI_API_KEY in Settings."
      });
    }

    const SYSTEM_PROMPT = `You are the Vinea AI Winemaker Assistant, a world-class enological advisor, biochemist, and cellar processes expert.
You help winemakers worldwide with:
1. Stuck and sluggish fermentation diagnostics (sugar curves, temperature, nitrogen, density) and restart protocols.
2. Chemical additions and pH modeling: free SO2 calculations, potassium metabisulfite (KMBS) formulations, tartaric acid / calcium carbonate additions.
3. Traditional Georgian winemaking in clay Qvevris: skin contact maceration times, lid sealing, lime water lining, buried marani temperature dynamics.
4. Malolactic fermentation (MLF) management, volatile acidity (VA) mitigation, barrel aging, oak toast selections, and cellaring sanitation.

Provide highly professional, authentic, scientifically accurate enological advice. Answer concisely, using markdown tables or bullet points where helpful.`;

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

    const fullPrompt = `${SYSTEM_PROMPT}\n\n${chemicalContext}\n\nWinemaker Query: ${prompt}\n\nAI Winemaker Response:\n`;

    const client = getAiClient();

    // Streaming (Server-Sent Events) for the chat UI. Callers that don't ask for
    // a stream (e.g. the Weather tab) still get a single JSON response below.
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

// Serve frontend
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  // Serve production build static files
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
} else {
  // In development, load Vite middleware dynamically to provide live reload on same port!
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running in ${isProd ? 'production' : 'development'} on port ${PORT}`);
});
