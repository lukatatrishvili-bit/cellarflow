import { useState } from 'react';
import { translations, Language } from '@/lib/i18n';
import { Tank, WineLot, LabResult } from '@/lib/services/db';
import { Sparkles, Send, Loader2, HelpCircle, AlertCircle, Quote } from 'lucide-react';

interface AiTabProps {
  lang: Language;
  tanks: Tank[];
  lots: WineLot[];
  labResults: LabResult[];
}

export default function AiTab({
  lang,
  tanks,
  lots,
  labResults
}: AiTabProps) {
  const t = translations[lang];

  // AI chat states
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Array<{ sender: 'user' | 'vinea'; text: string }>>([
    { 
      sender: 'vinea', 
      text: "Greetings, Winemaker. I am Vinea AI, your Senior Enology consultant. I have parsed your active tanks metrics, grape lot stages, and chemical parameters. Ask me any technical questions regarding stuck fermentations, yeast nutrients, KMBS balancing, or traditional Georgian Qvevri skin macerations." 
    }
  ]);
  const [loading, setLoading] = useState(false);

  // Suggested technical enology queries
  const suggestions = [
    "How do I kickstart a sluggish/stuck fermentation?",
    "Calculate SO2 additives for Kakhetian Amber wine at high pH.",
    "Guidelines on traditional Georgian Qvevri/Kakhuri skin aging.",
    "Calculate Volatile Acidity risk threshold in barrel rooms."
  ];

  const handleQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;

    // Append user message
    const newMsgs = [...messages, { sender: 'user' as const, text: queryText }];
    setMessages(newMsgs);
    setPrompt('');
    setLoading(true);

    // Compile active context
    const cellarContext = {
      tanksSummary: tanks.map(tk => ({ name: tk.name, type: tk.type, volume: tk.currentVolume, temp: tk.currentTemp, status: tk.status })),
      trackedLots: lots.map(l => ({ code: l.code, name: l.wineName, stage: l.stage, variety: l.variety })),
      recentLabAverages: labResults.slice(0, 3).map(r => ({ pH: r.pH, alcohol: r.alcohol, freeSO2: r.freeSO2 }))
    };

    try {
      const response = await fetch('/api/assistant', { // Standard next api endpoint
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: queryText, context: cellarContext })
      });

      const data = await response.json();
      
      if (data.text) {
        setMessages([...newMsgs, { sender: 'vinea', text: data.text }]);
      } else if (data.error) {
        setMessages([...newMsgs, { sender: 'vinea', text: `System modeling exception: ${data.error}` }]);
      } else {
        setMessages([...newMsgs, { sender: 'vinea', text: "Vinea modeling core failed to return a valid response text. Please check server configuration." }]);
      }
    } catch (error) {
      console.error("AI error: ", error);
      setMessages([...newMsgs, { 
        sender: 'vinea', 
        text: "The server proxy API did not respond. This may be due to missing GEMINI_API_KEY environment credentials. Please go to Secrets Panel to configure."
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h3 className="text-lg font-bold font-sans text-slate-800 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#2d0a0a]" />
          {t.ai_assistant}
        </h3>
        <p className="text-xs text-slate-400">Consult with deep enology modeling on stuck ferments, sulfiting values, and aging guidelines</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Suggested Queries & Context Summary (Side Column) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 shadow-sm space-y-2">
            <h5 className="font-sans font-bold text-[#2d0a0a] text-xs font-mono uppercase tracking-widest">Enology Directives</h5>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              Click any of these quick-fire enology questions to initiate scientific advice:
            </p>
            <div className="space-y-2 pt-1">
              {suggestions.map((sug, i) => (
                <button
                  key={i}
                  onClick={() => handleQuery(sug)}
                  className="w-full text-left p-2 bg-white border border-[#EBE5D8] hover:border-[#722F37] rounded-lg text-[11px] text-gray-600 hover:text-gray-800 cursor-pointer transition-all hover:shadow-2xs block"
                  disabled={loading}
                >
                  &ldquo;{sug}&rdquo;
                </button>
              ))}
            </div>
          </div>

          <div className="bg-stone-50 border border-stone-200 p-4 rounded-xl text-xs space-y-2 text-stone-600 leading-relaxed font-mono">
            <p className="font-bold border-b border-stone-200 pb-1 text-[10px] text-stone-700 uppercase">Active Core Context Attached</p>
            <p>• {tanks.length} storage tanks metrics</p>
            <p>• {lots.length} traceability sheets</p>
            <p>• {labResults.length} enological analysis logs</p>
          </div>
        </div>

        {/* Conversation Dialog Interface (3 cols) */}
        <div className="lg:col-span-3 bg-white border border-[#EBE5D8] rounded-xl flex flex-col justify-between h-[520px] overflow-hidden shadow-xs">
          {/* Header */}
          <div className="p-4 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold font-sans text-gray-700 uppercase tracking-widest">Vinea Enology Core Active</span>
            </div>
            <span className="text-[10px] font-mono text-gray-400 text-right">MODEL: GEMINI-3.5-FLASH</span>
          </div>

          {/* Messages container list */}
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            {messages.map((m, idx) => (
              <div 
                key={idx} 
                className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] rounded-xl p-4.5 text-xs leading-relaxed space-y-1 ${
                  m.sender === 'user' 
                    ? 'bg-[#722F37] text-white shadow-2xs rounded-br-none' 
                    : 'bg-[#FDFBF7] border border-[#EBE5D8] text-gray-700 shadow-3xs rounded-bl-none'
                }`}>
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[9px] uppercase tracking-wider mb-1 line-clamp-1">
                    <span>{m.sender === 'user' ? 'Head Winemaker' : 'Vinea Advisor'}</span>
                  </div>
                  <p className="whitespace-pre-wrap font-sans leading-relaxed">{m.text}</p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#FAF3F5] text-[#722F37] rounded-xl p-4 text-xs font-mono font-bold flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#722F37]" />
                  Compiling lab formulas and enology data...
                </div>
              </div>
            )}
          </div>

          {/* Form input dock */}
          <form 
            onSubmit={(e) => { e.preventDefault(); handleQuery(prompt); }} 
            className="p-3 bg-stone-50 border-t border-stone-200/60 flex gap-2"
          >
            <input 
              type="text" 
              placeholder="Ask Vinea AI enological recommendations..."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              className="flex-1 bg-white border border-[#EBE5D8] text-xs text-gray-800 rounded-lg px-4 py-2 focus:outline-hidden"
              disabled={loading}
              required
            />
            <button 
              type="submit" 
              className="bg-[#722F37] hover:bg-opacity-95 text-white p-2 rounded-lg cursor-pointer flex items-center justify-center transition-all shadow-xs"
              disabled={loading}
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

        </div>

      </div>
    </div>
  );
}
