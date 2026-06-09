'use client';

import React, { useState, useRef, useEffect } from 'react';
import { translations, Language } from '../lib/i18n';
import { Sparkles, Send, Bot, HelpCircle, Loader2 } from 'lucide-react';
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
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function AiWinemaker({ lang, cellarState }: Props) {
  const t = translations[lang];
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: translations[lang].ai_desc
    }
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

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

      // Open an empty assistant bubble and stream tokens into it as they arrive.
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
            /* ignore malformed / keep-alive lines */
          }
        }
      }

      if (streamError) throw new Error(streamError);
    } catch (err: any) {
      console.error(err);
      const errMsg = `⚠️ **Connection Error**: ${err.message || 'The AI Winemaker is currently unavailable. Please verify your GEMINI_API_KEY environment variable is configured in the workspace settings.'} `;
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

  const quickPrompts = [
    { label: 'Stuck Ferment Protocol', query: 'My Cabernet Sauvignon EC-1118 fermentation is sluggish at 1.015 density. Present a step-by-step stuck fermentation restart protocol.' },
    { label: 'Qvevri Clay Waxing', query: 'Explain traditional Georgian Marani Qvevri waxing preparation, hygiene practices, and limestone water sanitation.' },
    { label: 'Sulfide/pH Interaction', query: 'Why does wine pH dictate free SO2 targets? Explain molecular SO2 correlation and KMBS chemistry.' },
    { label: 'Cellar Audit Remediation', query: 'Inspect my current cellar stats. Suggest immediate actions for any low SO2 or high VA warnings.' }
  ];

  return (
    <div className="flex flex-col h-[520px] bg-white border border-[#e8dfd5] rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-4 bg-gradient-to-r from-[#4e0e15] to-[#3a0a0f] text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold font-serif tracking-wide">{t.ai_assistant} (Gemini)</h3>
            <p className="text-[10px] text-amber-200/80">Winery Advisor & Chemistry Modeler Mode</p>
          </div>
        </div>
        <div className="px-2 py-0.5 bg-[#ffffff1d] text-[10px] rounded text-stone-100 flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-300" /> Active Cellar Sync
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
            className="text-[10px] px-2.5 py-1 bg-white border border-[#e8dfd5] hover:border-[#4e0e15] hover:text-[#4e0e15] text-slate-600 rounded-full transition-colors font-medium disabled:opacity-50 cursor-pointer"
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
    </div>
  );
}
