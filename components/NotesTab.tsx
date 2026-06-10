import React from 'react';
import { Trash, FileText } from 'lucide-react';
import { Language, translations } from '../lib/i18n';
import { WineLot } from '../lib/wineryState';
import { CellarNote } from '../hooks/useWineryState';

interface NotesTabProps {
  lang: Language;
  lots: WineLot[];
  notesList: CellarNote[];
  onAddNewNote: (title: string, category: 'Enology' | 'Tasting' | 'Sanitation' | 'General', content: string, relatedLotId: string) => void;
  onDeleteNote: (id: string) => void;
}

export default function NotesTab({
  lang,
  lots,
  notesList,
  onAddNewNote,
  onDeleteNote
}: NotesTabProps) {
  const t = translations[lang];

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const title = formData.get('title') as string;
    const category = formData.get('category') as 'Enology' | 'Tasting' | 'Sanitation' | 'General';
    const content = formData.get('content') as string;
    const relatedLotId = formData.get('relatedLotId') as string;
    if (title.trim() && content.trim()) {
      onAddNewNote(title, category, content, relatedLotId);
      form.reset();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in text-stone-800">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
        <div>
          <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#801323]" />
            {t.notes}
          </h3>
          <p className="text-xs text-slate-400 font-medium">Capture tasting observations, chemistry decisions, and cellar notes</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 bg-indigo-50/50 border border-[#e8dfd5] rounded-lg text-center">
            <span className="text-[9px] text-[#4e0e15] font-mono uppercase font-bold block">Total Notes</span>
            <strong className="text-sm font-serif font-bold text-[#4e0e15] block">{notesList.length}</strong>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Note Form */}
        <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4">
          <h4 className="font-serif font-bold text-sm text-[#4e0e15] border-b border-stone-100 pb-2">Record Winery Note</h4>
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs text-stone-600 font-sans">
            <div>
              <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Note Title *</label>
              <input 
                type="text" 
                name="title"
                placeholder="e.g. Saperavi Organoleptic Tasting"
                className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Category</label>
                <select 
                  name="category"
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-700 outline-none text-xs"
                  defaultValue="Enology"
                >
                  <option value="Enology">🧪 Chemistry Check</option>
                  <option value="Tasting">🍷 Tasting Log</option>
                  <option value="Sanitation">🧼 Sanitation</option>
                  <option value="General">📝 General Note</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Related Lot</label>
                <select 
                  name="relatedLotId"
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2 py-1.5 text-stone-700 outline-none text-xs"
                  defaultValue=""
                >
                  <option value="">-- None --</option>
                  {lots.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.vintage})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Note Content *</label>
              <textarea 
                name="content"
                placeholder="Detail enological readings, mouthfeel characters, or cellar changes..."
                className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-32 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                required
              />
            </div>

            <button 
              type="submit"
              className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 rounded-lg font-bold uppercase transition-all duration-200 cursor-pointer text-xs"
            >
              Save Note Entry
            </button>
          </form>
        </div>

        {/* Notes List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15] flex items-center justify-between">
              <span>Winery Journal Logs</span>
              <span className="text-[10px] font-mono text-slate-400 font-normal">{notesList.length} entries recorded</span>
            </h4>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {notesList.map((note) => (
                <div key={note.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all space-y-2 relative group font-sans">
                  <button 
                    onClick={() => onDeleteNote(note.id)}
                    className="absolute top-4 right-4 text-stone-300 hover:text-rose-600 transition-colors opacity-0 group-hover:opacity-100 duration-200 cursor-pointer"
                    title="Delete Note"
                  >
                    <Trash className="w-4 h-4" />
                  </button>

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                      note.category === 'Enology' ? 'bg-indigo-100 text-[#4e0e15]' :
                      note.category === 'Tasting' ? 'bg-rose-100 text-rose-800' :
                      note.category === 'Sanitation' ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-700'
                    }`}>
                      {note.category === 'Enology' ? '🧪 Chemistry' : 
                       note.category === 'Tasting' ? '🍷 Tasting' : 
                       note.category === 'Sanitation' ? '🧼 Sanitation' : '📝 General'}
                    </span>
                    {note.relatedLotId && (
                      <span className="text-[9px] bg-stone-100 text-stone-600 font-mono px-1.5 py-0.5 rounded">
                        Lot: {note.relatedLotId}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-slate-400 ml-auto mr-4">{note.date} • {note.author}</span>
                  </div>

                  <h5 className="font-bold text-stone-900 text-sm leading-tight">{note.title}</h5>
                  <p className="text-xs text-stone-550 leading-relaxed whitespace-pre-wrap bg-stone-50/50 p-2.5 rounded border border-stone-100/60 mt-1">{note.content}</p>
                </div>
              ))}

              {notesList.length === 0 && (
                <div className="text-center py-12 text-[#4e0e15]/40 italic font-mono text-xs">
                  <FileText className="h-10 w-10 text-stone-300 mx-auto mb-2" />
                  Your enology notebook is empty. Record vintage checkups or active cellar insights.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
