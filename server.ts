import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
// API Route 1: /api/assistant
// -------------------------------------------------------------
app.post('/api/assistant', async (req, res) => {
  try {
    const { prompt, context } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.json({ 
        text: "The Gemini API key is not currently configured in the environment. Please add GEMINI_API_KEY in the Secrets panel to activate full Winemaker AI services." 
      });
    }

    const systemInstruction = 
      "You are a Senior Winemaker and Master Enologist AI Assistant named 'Vinea AI'. " +
      "You are a technical consultant for professional wineries, providing chemistry corrections, fermentation trouble-shooting, " +
      "SO2 additions advice, and traditional Georgian Qvevri/Kakhuri winemaking guidance. " +
      "Answer in the selected language (English or Georgian depending on the query). Isolate the calculations precisely in metric units (liters, grams, hL). " +
      "Always maintain a serious, professional, helpful, and scientific composure - do not use greeting fluff. " +
      "Be highly concise, emphasizing molecular SO2 boundaries, active yeast nutrition, and chemical stabilization indices.";

    const contents = `
User Question: ${prompt}

Current Cellar Status Context for reference:
${context ? JSON.stringify(context) : "No specific context provided."}
`;

    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2,
      }
    });

    const replyText = response.text || "I was unable to retrieve a response from the modeling core. Please try again.";
    return res.json({ text: replyText });
  } catch (error: any) {
    console.error("Gemini Assistant Route Error: ", error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : "System-level modeling exception occurred" 
    });
  }
});

// -------------------------------------------------------------
// API Route 2: /api/gemini
// -------------------------------------------------------------
app.post('/api/gemini', async (req, res) => {
  try {
    const { prompt, cellarState } = req.body;

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
      化学Context: 
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
    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
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
