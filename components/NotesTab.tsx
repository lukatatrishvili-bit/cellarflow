import React from 'react';
import { Trash, FileText } from 'lucide-react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { WineLot } from '../lib/wineryState';
import { CellarNote } from '../hooks/useWineryState';

interface NotesTabProps {
  lang: Language;
  lots: WineLot[];
  notesList: CellarNote[];
  onAddNewNote: (title: string, category: 'Enology' | 'Tasting' | 'Sanitation' | 'General', content: string, relatedLotId: string) => void;
  onDeleteNote: (id: string) => void;
  canCreateNote?: boolean;
  canDeleteNote?: boolean;
}

export default function NotesTab({
  lang,
  lots,
  notesList,
  onAddNewNote,
  onDeleteNote,
  canCreateNote = true,
  canDeleteNote = true
}: NotesTabProps) {
  const t = translations[lang];
  const lotFilterId = React.useId();
  const [lotFilter, setLotFilter] = React.useState('all');
  const filteredNotes = lotFilter === 'all'
    ? notesList
    : notesList.filter(note => note.relatedLotId === lotFilter);

  const permissionNotice = !canCreateNote && !canDeleteNote
    ? (lang === 'ka'
      ? 'მხოლოდ ნახვის წვდომა: შეგიძლიათ მარნის ჩანაწერების ნახვა და ლოტით გაფილტვრა, თუმცა ახალი ჩანაწერის შექმნა ან წაშლა არ შეგიძლიათ.'
      : 'Read-only access: you can browse and filter winery notes, but you cannot create or delete entries.')
    : !canCreateNote
      ? (lang === 'ka'
        ? 'შეგიძლიათ ჩანაწერების ნახვა და ლოტით გაფილტვრა, თუმცა თქვენი როლი ახალი ჩანაწერის შექმნას არ უშვებს.'
        : 'You can browse and filter notes, but your role cannot create new entries.')
      : !canDeleteNote
        ? (lang === 'ka'
          ? 'შეგიძლიათ ჩანაწერების ნახვა და ლოტით გაფილტვრა, თუმცა თქვენი როლი ჩანაწერების წაშლას არ უშვებს.'
          : 'You can browse and filter notes, but your role cannot delete entries.')
        : null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canCreateNote) return;
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

  const handleDeleteNote = (id: string) => {
    if (!canDeleteNote) return;
    onDeleteNote(id);
  };

  return (
    <div className="space-y-6 animate-fade-in text-stone-800">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
        <div>
          <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <FileText className="h-5 w-5 text-[#801323]" />
            {t.notes}
          </h3>
          <p className="text-xs text-slate-400 font-medium">{lang === 'ka' ? 'დააფიქსირეთ დეგუსტაციის დაკვირვებები, ქიმიური გადაწყვეტილებები და მარნის შენიშვნები' : 'Capture tasting observations, chemistry decisions, and cellar notes'}</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 bg-indigo-50/50 border border-[#e8dfd5] rounded-lg text-center">
            <span className="text-[9px] text-[#4e0e15] font-mono uppercase font-bold block">{lang === 'ka' ? 'სულ შენიშვნები' : 'Total Notes'}</span>
            <strong className="text-sm font-serif font-bold text-[#4e0e15] block">{notesList.length}</strong>
          </div>
        </div>
      </div>

      {permissionNotice && (
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-medium leading-relaxed text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300" role="note">
          {permissionNotice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Note Form */}
        {canCreateNote && (
          <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4">
          <h4 className="font-serif font-bold text-sm text-[#4e0e15] border-b border-stone-100 pb-2">{lang === 'ka' ? 'მარნის შენიშვნის ჩაწერა' : 'Record Winery Note'}</h4>
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs text-stone-600 font-sans">
            <div>
              <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{lang === 'ka' ? 'სათაური *' : 'Note Title *'}</label>
              <input
                type="text"
                name="title"
                placeholder={lang === 'ka' ? 'მაგ. საფერავის ორგანოლეპტიკური დეგუსტაცია' : 'e.g. Saperavi Organoleptic Tasting'}
                className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{lang === 'ka' ? 'კატეგორია' : 'Category'}</label>
                <select
                  name="category"
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-700 outline-none text-xs"
                  defaultValue="Enology"
                >
                  <option value="Enology">🧪 {lang === 'ka' ? 'ქიმიური შემოწმება' : 'Chemistry Check'}</option>
                  <option value="Tasting">🍷 {lang === 'ka' ? 'დეგუსტაციის ჩანაწერი' : 'Tasting Log'}</option>
                  <option value="Sanitation">🧼 {lang === 'ka' ? 'სანიტარია' : 'Sanitation'}</option>
                  <option value="General">📝 {lang === 'ka' ? 'ზოგადი შენიშვნა' : 'General Note'}</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{lang === 'ka' ? 'დაკავშირებული პარტია' : 'Related Lot'}</label>
                <select
                  name="relatedLotId"
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2 py-1.5 text-stone-700 outline-none text-xs"
                  defaultValue=""
                >
                  <option value="">{lang === 'ka' ? '-- არცერთი --' : '-- None --'}</option>
                  {lots.map(l => (
                    <option key={l.id} value={l.id}>{l.name} ({l.vintage})</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">{lang === 'ka' ? 'შინაარსი *' : 'Note Content *'}</label>
              <textarea
                name="content"
                placeholder={lang === 'ka' ? 'აღწერეთ ენოლოგიური მაჩვენებლები, გემოს დახასიათება ან მარნის ცვლილებები...' : 'Detail enological readings, mouthfeel characters, or cellar changes...'}
                className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-32 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 rounded-lg font-bold uppercase transition-all duration-200 cursor-pointer text-xs"
            >
              {lang === 'ka' ? 'შენიშვნის შენახვა' : 'Save Note Entry'}
            </button>
          </form>
          </div>
        )}

        {/* Notes List */}
        <div className={`${canCreateNote ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
          <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15] flex items-center justify-between">
              <span>{lang === 'ka' ? 'მარნის ჟურნალი' : 'Winery Journal Logs'}</span>
              <span className="text-[10px] font-mono text-slate-400 font-normal">{notesList.length} {lang === 'ka' ? 'ჩანაწერი' : 'entries recorded'}</span>
            </h4>

            <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3 sm:flex-row sm:items-end sm:justify-between dark:border-stone-800 dark:bg-stone-950/30">
              <div className="w-full sm:max-w-xs">
                <label htmlFor={lotFilterId} className="mb-1 block text-[10px] font-mono font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  {lang === 'ka' ? 'ჩანაწერების ლოტით გაფილტვრა' : 'Filter notes by lot'}
                </label>
                <select
                  id={lotFilterId}
                  value={lotFilter}
                  onChange={(event) => setLotFilter(event.target.value)}
                  className="min-h-10 w-full rounded-lg border border-[#e8dfd5] bg-white px-2.5 py-2 text-xs font-semibold text-stone-700 outline-none focus:border-[#801323] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                >
                  <option value="all">{lang === 'ka' ? 'ყველა ლოტი' : 'All lots'}</option>
                  {lots.map(lot => (
                    <option key={lot.id} value={lot.id}>{lot.name} ({lot.vintage})</option>
                  ))}
                </select>
              </div>
              <span className="text-[10px] font-mono font-medium text-stone-400" aria-live="polite">
                {lang === 'ka'
                  ? `ნაჩვენებია ${filteredNotes.length} / ${notesList.length}`
                  : `Showing ${filteredNotes.length} of ${notesList.length}`}
              </span>
            </div>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {filteredNotes.map((note) => (
                <div key={note.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all space-y-2 relative group font-sans">
                  {canDeleteNote && (
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(note.id)}
                      className="absolute top-4 right-4 text-stone-300 hover:text-rose-600 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 duration-200 cursor-pointer"
                      title={lang === 'ka' ? 'შენიშვნის წაშლა' : 'Delete Note'}
                      aria-label={`Delete ${note.title}`}
                    >
                      <Trash className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                      note.category === 'Enology' ? 'bg-indigo-100 text-[#4e0e15]' :
                      note.category === 'Tasting' ? 'bg-rose-100 text-rose-800' :
                      note.category === 'Sanitation' ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-700'
                    }`}>
                      {note.category === 'Enology' ? (lang === 'ka' ? '🧪 ქიმია' : '🧪 Chemistry') :
                       note.category === 'Tasting' ? (lang === 'ka' ? '🍷 დეგუსტაცია' : '🍷 Tasting') :
                       note.category === 'Sanitation' ? (lang === 'ka' ? '🧼 სანიტარია' : '🧼 Sanitation') : (lang === 'ka' ? '📝 ზოგადი' : '📝 General')}
                    </span>
                    {note.relatedLotId && (
                      <span className="text-[9px] bg-stone-100 text-stone-600 font-mono px-1.5 py-0.5 rounded">
                        {lang === 'ka' ? 'პარტია' : 'Lot'}: {note.relatedLotId}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-slate-400 ml-auto mr-4">{note.date} • {note.author}</span>
                  </div>

                  <h5 className="font-bold text-stone-900 text-sm leading-tight">{note.title}</h5>
                  <p className="text-xs text-stone-550 leading-relaxed whitespace-pre-wrap bg-stone-50/50 p-2.5 rounded border border-stone-100/60 mt-1">{note.content}</p>
                </div>
              ))}

              {filteredNotes.length === 0 && (
                <div className="text-center py-12 text-[#4e0e15]/40 italic font-mono text-xs">
                  <FileText className="h-10 w-10 text-stone-300 mx-auto mb-2" />
                  {lotFilter === 'all'
                    ? (lang === 'ka'
                      ? 'მარნის ჩანაწერები ჯერ არ არის.'
                      : 'Your enology notebook is empty. Record vintage checkups or active cellar insights.')
                    : (lang === 'ka'
                      ? 'არჩეული ლოტისთვის ჩანაწერები ვერ მოიძებნა.'
                      : 'No notes were found for the selected lot.')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
