'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { translations, Language } from '../lib/i18n';
import { Sparkles, Send, Bot, HelpCircle, Loader2, ClipboardList, CheckSquare, X, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Props {
  lang: Language;
  cellarState: {
    tanksCount: number;
    activeFermsCount: number;
    avgTemp: number;
    lowSo2Count: number;
    highVaCount: number;
    sampleData: Array<{ id: string; lotCode: string; currentVolume: number; wineName: string; stage: string }>;
  };
  onAddNewTask?: (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => void;
  contextTab?: string;
  contextModule?: string;
  className?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface TempTask {
  id: number;
  checked: boolean;
  title: string;
  desc: string;
  priority: 'high' | 'medium' | 'low';
}

export default function AiWinemaker({ lang, cellarState, onAddNewTask, contextTab, contextModule, className }: Props) {
  const t = translations[lang];
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load chats from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('vinea_ai_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
          return;
        }
      } catch (e) {
        console.error('Failed to parse saved chats:', e);
      }
    }
    // Fallback/Initial state
    setMessages([
      {
        role: 'assistant',
        content: translations[lang].ai_desc
      }
    ]);
  }, [lang]);

  // Save chats to localStorage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem('vinea_ai_chats', JSON.stringify(messages));
    }
  }, [messages]);

  // Work Order generator states
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [workOrderTasks, setWorkOrderTasks] = useState<TempTask[]>([]);
  const [taskDueDate, setTaskDueDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || inputMsg).trim();
    if (!query || isLoading) return;

    if (!textToSend) {
      setInputMsg('');
    }

    setMessages(prev => [...prev, { role: 'user', content: query }]);
    setIsLoading(true);

    try {
      const resp = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query, cellarState, stream: true })
      });

      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Server error communicating with Gemini');
      }

      // Open an assistant bubble and stream tokens into it
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      const appendToLast = (chunk: string) =>
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const payload = JSON.parse(line.slice(5).trim());
            if (payload.text) appendToLast(payload.text);
            else if (payload.error) streamError = payload.error;
          } catch {
            /* ignore */
          }
        }
      }

      if (streamError) throw new Error(streamError);
    } catch (err: any) {
      console.error(err);
      const errMsg = `⚠️ **Connection Error**: ${err.message || 'The AI Winemaker is currently unavailable. Please verify your GEMINI_API_KEY environment variable is configured.'}`;
      setMessages(prev => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last && last.role === 'assistant' && last.content === '') {
          copy[copy.length - 1] = { ...last, content: errMsg };
          return copy;
        }
        return [...copy, { role: 'assistant', content: errMsg }];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateWorkOrder = (content: string) => {
    const text = content.toLowerCase();
    let initialTasks: TempTask[] = [];

    if (text.includes('stuck') || text.includes('sluggish') || text.includes('restart') || text.includes('gravity')) {
      initialTasks = [
        { id: 1, checked: true, title: 'Add DAP yeast nutrients to stuck fermenter', desc: 'Add 20g/hL Diammonium Phosphate (DAP) to stimulate yeast health.', priority: 'high' },
        { id: 2, checked: true, title: 'Calibrate thermostatic target to 22°C', desc: 'Induce mild heating to active yeast cultures in the stuck must.', priority: 'high' },
        { id: 3, checked: true, title: 'Aerate must via aerative pumpover', desc: 'Perform brief 10-minute splash pumpover to promote sterol synthesis.', priority: 'medium' }
      ];
    } else if (text.includes('qvevri') || text.includes('marani') || text.includes('wax') || text.includes('clay')) {
      initialTasks = [
        { id: 1, checked: true, title: 'Verify clay seal integrity on Qvevri lids', desc: 'Audit sealed lids on clay jars for microscopic gas leaks or acetic acid risk.', priority: 'high' },
        { id: 2, checked: true, title: 'Prepare hot beeswax for lid resealing', desc: 'Traditional waxing maintenance prep for Georgian marani jars.', priority: 'medium' },
        { id: 3, checked: true, title: 'Sanitize Marani flagstones', desc: 'Cleanse surrounding stone floors with warm lime water.', priority: 'low' }
      ];
    } else if (text.includes('so2') || text.includes('sulfite') || text.includes('kmbs') || text.includes('acid')) {
      initialTasks = [
        { id: 1, checked: true, title: 'Measure pH & Free SO2 of Cabernet Sauvignon', desc: 'Confirm sulfur dioxide protection index relative to wine pH.', priority: 'high' },
        { id: 2, checked: true, title: 'Add calculated KMBS dosage to vessel', desc: 'Increase protection to target active molecular SO2 levels.', priority: 'high' },
        { id: 3, checked: true, title: 'Perform volumetric topping on aging vessels', desc: 'Fill headspace pockets to reduce oxygen contact surface area.', priority: 'medium' }
      ];
    } else {
      // Default general work order
      initialTasks = [
        { id: 1, checked: true, title: 'Sanitize transfer hoses & pump heads', desc: 'Execute standard pre-operation CIP sanitization protocol.', priority: 'medium' },
        { id: 2, checked: true, title: 'Measure daily density & temp panel', desc: 'Track active fermentation sugar curves to verify kinetics.', priority: 'medium' },
        { id: 3, checked: true, title: 'Inspect barrel room relative humidity', desc: 'Target 70-75% humidity to prevent oak barrel evaporation loss.', priority: 'low' }
      ];
    }

    setWorkOrderTasks(initialTasks);
    setShowOrderModal(true);
  };

  const handleDeployTasks = () => {
    if (!onAddNewTask) return;
    const selected = workOrderTasks.filter(t => t.checked);
    selected.forEach(tk => {
      onAddNewTask(tk.title, tk.priority, taskDueDate, tk.desc);
    });
    setShowOrderModal(false);
    alert(`Deployed ${selected.length} tasks successfully to Vinea checklist!`);
  };

  const quickPrompts = useMemo(() => {
    const defaultPrompts = [
      { label: 'Stuck Ferment Protocol', query: 'My Cabernet Sauvignon EC-1118 fermentation is sluggish at 1.015 density. Present a step-by-step stuck fermentation restart protocol.' },
      { label: 'Qvevri Clay Waxing', query: 'Explain traditional Georgian Marani Qvevri waxing preparation, hygiene practices, and limestone water sanitation.' },
      { label: 'Sulfide/pH Interaction', query: 'Why does wine pH dictate free SO2 targets? Explain molecular SO2 correlation and KMBS chemistry.' },
      { label: 'Cellar Audit Remediation', query: 'Inspect my current cellar stats. Suggest immediate actions for any low SO2 or high VA warnings.' }
    ];

    if (contextModule === 'vazi') {
      return [
        { label: 'Mildew Risk Weather', query: 'How do temperature and humidity trigger downy mildew infections? What are the threshold values?' },
        { label: 'Canopy Heat Management', query: 'What are the best canopy management actions (e.g. leaf pulling, thinning) during severe hot weather trends?' },
        { label: 'GDD Phenological Stages', query: 'Explain the heat sum (GDD) accumulation ranges for key grapevine phenological stages like flowering, fruit set, and veraison.' },
        { label: 'Georgian Saperavi Canopy', query: 'What are the unique canopy management and aeration requirements for Saperavi grape vines in Kakheti?' }
      ];
    }

    if (contextTab === 'vessels') {
      return [
        { label: 'Vessel Temp Regulation', query: 'Suggest optimal temperature targets and fermentation management routines for white vs red wine vessels.' },
        { label: 'Oak Barrel Sanitation', query: 'What is the standard cellar sanitation and prep protocol for concrete tanks vs oak barrels before refilling?' },
        { label: 'Volume Topping Routine', query: 'Why is headspace/ullage control critical in aging vessels? Outline a proper topping schedule.' },
        { label: 'KMBS Dosage Calculation', query: 'Outline how to calculate potassium metabisulfite (KMBS) dosage for clean sulfite protection in a tank.' }
      ];
    }

    if (contextTab === 'fermentation') {
      return [
        { label: 'Stuck Fermentation Symptoms', query: 'What are the early warning signs that a fermentation is becoming sluggish or stuck (e.g. density, daily slope)?' },
        { label: 'Nutrient Feed Schedule', query: 'Suggest a yeast nutrient (DAP/Organic) addition schedule for high-brix must to prevent stuck states.' },
        { label: 'Fermentation Temperature Loops', query: 'Explain how temperature spikes or drops affect yeast metabolism and how to maintain the thermal intelligence loop.' },
        { label: 'Wine Dryness Criteria', query: 'How does a winemaker mathematically and sensorially confirm a wine lot is completely dry?' }
      ];
    }

    if (contextTab === 'labs' || contextTab === 'calculators') {
      return [
        { label: 'High Volatile Acidity Dangers', query: 'What causes high Volatile Acidity (VA) in aging wines and how can we mitigate it using sulfur dioxide or filtration?' },
        { label: 'Molecular SO2 Guide', query: 'Explain the mathematical relationship between wine pH, temperature, free SO2, and molecular SO2.' },
        { label: 'Acid Adjustments (Tartaric)', query: 'What is the chemical calculation and process to execute a tartaric acid addition to raise acidity?' },
        { label: 'FSO2 Depletion Rates', query: 'Why does free SO2 deplete rapidly in barrel aging, and what is the target schedule to maintain protective levels?' }
      ];
    }

    return defaultPrompts;
  }, [contextTab, contextModule]);

  return (
    <div className={`flex flex-col bg-white border border-[#e8dfd5] rounded-xl overflow-hidden shadow-sm relative ${className || 'h-[520px]'}`}>
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-[#4e0e15] to-[#3a0a0f] text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold font-serif tracking-wide">{t.ai_assistant} (Gemini)</h3>
            <p className="text-[10px] text-amber-200/80">Winery Advisor & Chemistry Modeler Mode</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Clear enological chat history?')) {
                localStorage.removeItem('vinea_ai_chats');
                setMessages([
                  {
                    role: 'assistant',
                    content: translations[lang].ai_desc
                  }
                ]);
              }
            }}
            className="px-2 py-0.5 bg-[#ffffff1d] hover:bg-[#ffffff30] text-[10px] rounded text-stone-100 flex items-center gap-1 transition-colors cursor-pointer border-0"
            title="Clear Chat History"
          >
            Clear History
          </button>
          <div className="px-2 py-0.5 bg-[#ffffff1d] text-[10px] rounded text-stone-100 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-300" /> Active Cellar Sync
          </div>
        </div>
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-[#FAF8F5] to-white">
        {messages.map((m, idx) => (
          <div 
            key={idx} 
            className={`flex gap-3 max-w-[85%] ${m.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${
              m.role === 'user' 
                ? 'bg-[#4e0e15] text-[#fbf9f6] rounded-br-none font-medium' 
                : 'bg-[#f4efe9] text-[#2c241e] border border-[#e3d7cb] rounded-bl-none'
            }`}>
              <div className="markdown-body">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
              
              {m.role === 'assistant' && idx > 0 && !isLoading && (
                <div className="mt-2.5 pt-2 border-t border-[#d9cebf]/80 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleGenerateWorkOrder(m.content)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-[#4e0e15] hover:bg-[#801323] text-white rounded text-[10px] font-bold font-mono transition-colors shadow-2xs cursor-pointer"
                  >
                    📋 Generate Work Order
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2.5 text-xs text-slate-500 font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-[#4e0e15]" />
            <span>{t.ai_thinking}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick Prompts Shelf */}
      <div className="px-4 py-2 bg-[#fbfaf8] border-t border-[#f0e6da] flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1 pr-1">
          <HelpCircle className="w-3 h-3 text-slate-400" /> Ask about:
        </span>
        {quickPrompts.map((qp, i) => (
          <button
            key={i}
            onClick={() => handleSend(qp.query)}
            disabled={isLoading}
            className="text-[10px] px-2.5 py-1 bg-white border border-[#e8dfd5] hover:border-[#4e0e15] hover:text-[#4e0e15] text-slate-650 rounded-full transition-colors font-semibold disabled:opacity-50 cursor-pointer"
          >
            {qp.label}
          </button>
        ))}
      </div>

      {/* Input panel */}
      <div className="p-3 bg-white border-t border-[#f0e6da] flex gap-2">
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={isLoading}
          placeholder={t.ai_ask_placeholder}
          className="flex-1 px-3.5 py-2 text-xs bg-[#FAF8F5] border border-slate-200 focus:border-[#4e0e15] rounded outline-none"
        />
        <button
          onClick={() => handleSend()}
          disabled={isLoading || !inputMsg.trim()}
          className="p-2 bg-[#4e0e15] hover:bg-[#6b151e] text-white rounded cursor-pointer transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* Work Order Generator Modal */}
      {showOrderModal && (
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-stone-200 rounded-xl shadow-2xl w-full max-w-md max-h-[90%] flex flex-col overflow-hidden text-stone-850">
            {/* Header */}
            <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ClipboardList className="w-4 h-4 text-[#4e0e15]" />
                <strong className="text-xs font-serif font-black uppercase tracking-wider text-[#4e0e15]">
                  AI Cellar Work Order
                </strong>
              </div>
              <button 
                type="button" 
                onClick={() => setShowOrderModal(false)}
                className="text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content list */}
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              <p className="text-[10px] text-stone-500 leading-normal">
                Deploy these recommended tasks to the winery check-list scheduler based on Gemini enological feedback:
              </p>

              <div className="space-y-2.5">
                {workOrderTasks.map((tk) => (
                  <div key={tk.id} className="p-2.5 border border-stone-200 bg-[#FCFAF9] rounded-lg space-y-1.5">
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={tk.checked}
                        onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, checked: e.target.checked } : p))}
                        className="w-3.5 h-3.5 accent-[#4e0e15] cursor-pointer mt-0.5"
                      />
                      <div className="flex-1 space-y-0.5">
                        <input
                          type="text"
                          value={tk.title}
                          onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, title: e.target.value } : p))}
                          className="w-full text-xs font-bold bg-transparent border-0 outline-none text-[#231f1d] focus:underline"
                        />
                        <textarea
                          rows={2}
                          value={tk.desc}
                          onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, desc: e.target.value } : p))}
                          className="w-full text-[10.5px] leading-relaxed text-stone-500 bg-transparent border-0 outline-none resize-none focus:underline"
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between border-t border-stone-100 pt-1.5 text-[9.5px]">
                      <span className="text-slate-400 font-mono">Priority:</span>
                      <select
                        value={tk.priority}
                        onChange={(e) => setWorkOrderTasks(prev => prev.map(p => p.id === tk.id ? { ...p, priority: e.target.value as any } : p))}
                        className="px-1.5 py-0.5 border border-stone-200 rounded bg-white text-[9.5px] font-bold"
                      >
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              {/* Due Date */}
              <div className="border-t border-stone-150 pt-3 flex items-center justify-between text-[11px]">
                <span className="text-stone-500 font-bold">Scheduled Due Date:</span>
                <input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                  className="px-2 py-1 border border-stone-200 rounded font-bold text-xs"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowOrderModal(false)}
                className="px-3 py-1.5 border border-stone-200 hover:bg-stone-100 text-stone-700 text-xs font-bold rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeployTasks}
                className="px-3 py-1.5 bg-[#4e0e15] hover:bg-[#801323] text-white text-xs font-bold rounded-lg cursor-pointer transition-colors flex items-center gap-1 shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                Deploy Selected Tasks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
