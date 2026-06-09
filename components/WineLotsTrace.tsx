'use client';

import React, { useState } from 'react';
import { translations, Language } from '../lib/i18n';
import { WineLot, WinemakingStage, WineClass } from '../lib/wineryState';
import { Calendar, Tag, ChevronRight, Compass, FlaskConical, Circle, Plus, ListFilter } from 'lucide-react';

interface Props {
  lang: Language;
  lots: WineLot[];
  onUpdateLots: (newLots: WineLot[]) => void;
}

export default function WineLotsTrace({ lang, lots, onUpdateLots }: Props) {
  const t = translations[lang];
  const [selectedLotId, setSelectedLotId] = useState<string | null>(lots[0]?.id || null);
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterVintage, setFilterVintage] = useState<string>('all');

  // Add Lot State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newVariety, setNewVariety] = useState('Saperavi');
  const [newClass, setNewClass] = useState<WineClass>('red');
  const [newVintage, setNewVintage] = useState<number>(2025);
  const [newVolume, setNewVolume] = useState<number>(1000);
  const [newVineyard, setNewVineyard] = useState('');

  const handleAddLot = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId || !newName) return;

    const newLot: WineLot = {
      id: newId,
      name: newName,
      vintage: newVintage,
      variety: newVariety,
      vineyardBlock: newVineyard || 'Generative Select Ridge',
      region: 'Kakheti Valley microclimate',
      initialVolume: newVolume,
      currentVolume: newVolume,
      wineClass: newClass,
      stage: 'crushing',
      createdAt: new Date().toISOString().split('T')[0],
      history: [
        {
          date: new Date().toISOString().split('T')[0],
          type: 'Intake and Commission',
          description: `Grapes received: ${newVolume} L crush equivalency. Created lot.`,
          operator: 'H. Keller'
        }
      ]
    };

    onUpdateLots([...lots, newLot]);
    setNewId('');
    setNewName('');
    setNewVineyard('');
    setShowAddForm(false);
    setSelectedLotId(newLot.id);
  };

  const selectedLot = lots.find(l => l.id === selectedLotId);

  const filteredLots = lots.filter(l => {
    if (filterClass !== 'all' && l.wineClass !== filterClass) return false;
    if (filterVintage !== 'all' && l.vintage.toString() !== filterVintage) return false;
    return true;
  });

  const uniqueVintages = Array.from(new Set(lots.map(l => l.vintage))).sort((a, b) => b - a);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* List Panel */}
      <div className="lg:col-span-1 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-serif text-[#4e0e15] flex items-center gap-1">
            <ListFilter className="w-4 h-4" /> 
            {{
              en: 'Active Lots',
              ka: 'აქტიური პარტიები',
              it: 'Lotti Attivi',
              fr: 'Lots Actifs',
              de: 'Aktive Chargen'
            }[lang] || 'Active Lots'} ({filteredLots.length})
          </h3>
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-0.5 px-2.5 py-1 text-[11px] font-semibold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded transition-colors cursor-pointer"
          >
            <Plus className="w-3 h-3" /> 
            {{
              en: 'Create Lot',
              ka: 'პარტიის შექმნა',
              it: 'Crea Lotto',
              fr: 'Créer un Lot',
              de: 'Charge erstellen'
            }[lang] || 'Create Lot'}
          </button>
        </div>

        {/* Filters */}
        <div className="space-y-2 bg-[#FAF8F5] p-3 border border-[#e8dfd5] rounded-xl">
          <div>
            <span className="block text-[9px] font-mono uppercase text-slate-500 font-bold mb-1">
              {{
                en: 'Wine Style / Class',
                ka: 'ღვინის ტიპი / კლასი',
                it: 'Stile / Classe di Vino',
                fr: 'Style / Classe de Vin',
                de: 'Weinstil / -klasse'
              }[lang] || 'Wine Style / Class'}
            </span>
            <div className="grid grid-cols-4 gap-1">
              {['all', 'red', 'white', 'amber'].map(cls => (
                <button
                  key={cls}
                  type="button"
                  onClick={() => setFilterClass(cls)}
                  className={`text-[10px] py-1 border rounded capitalize cursor-pointer font-medium font-sans ${
                    filterClass === cls 
                      ? 'bg-[#4e0e15] text-white border-[#4e0e15]' 
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {cls}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-[9px] font-mono uppercase text-slate-500 font-bold mb-1">
              {{
                en: 'Vintage Year',
                ka: 'მოსავლის წელი',
                it: 'Anno di Vendemmia',
                fr: 'Millésime',
                de: 'Jahrgang'
              }[lang] || 'Vintage Year'}
            </span>
            <select
              value={filterVintage}
              onChange={(e) => setFilterVintage(e.target.value)}
              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white text-stone-750 font-medium outline-none"
            >
              <option value="all">
                {{
                  en: '📅 All Vintages',
                  ka: '📅 ყველა მოსავალი',
                  it: '📅 Tutte le Vendemmie',
                  fr: '📅 Tous les Millésimes',
                  de: '📅 Alle Jahrgänge'
                }[lang] || '📅 All Vintages'}
              </option>
              {uniqueVintages.map(v => (
                <option key={v} value={v.toString()}>
                  🍇 {{
                    en: 'Vintage',
                    ka: 'მოსავალი',
                    it: 'Vendemmia',
                    fr: 'Millésime',
                    de: 'Jahrgang'
                  }[lang] || 'Vintage'} {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Add Lot form popup */}
        {showAddForm && (
          <form onSubmit={handleAddLot} className="p-3 bg-white border border-[#4e0e15] rounded-xl space-y-2.5 shadow-sm text-stone-800">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                {{
                  en: 'Lot Code (Unique)',
                  ka: 'პარტიის კოდი (უნიკალური)',
                  it: 'Codice Lotto (Unico)',
                  fr: 'Code du Lot (Unique)',
                  de: 'Chargennummer (Eindeutig)'
                }[lang] || 'Lot Code (Unique)'}
              </label>
              <input 
                type="text" required placeholder="e.g. MC-2025-09"
                value={newId} onChange={(e) => setNewId(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-[#FAF8F5]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                {{
                  en: 'Wine Lot Name',
                  ka: 'პარტიის დასახელება',
                  it: 'Nome Lotto Vino',
                  fr: 'Nom du Lot de Vin',
                  de: 'Weincharge Name'
                }[lang] || 'Wine Lot Name'}
              </label>
              <input 
                type="text" required placeholder="e.g. Mukuzani Old Vine"
                value={newName} onChange={(e) => setNewName(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-[#FAF8F5]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">{t.grape_variety || 'Grape Variety'}</label>
                <input 
                  type="text" value={newVariety} onChange={(e) => setNewVariety(e.target.value)}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-[#FAF8F5]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                  {{
                    en: 'Wine Style',
                    ka: 'ღვინის სტილი',
                    it: 'Stile del Vino',
                    fr: 'Style de Vin',
                    de: 'Weinstil'
                  }[lang] || 'Wine Style'}
                </label>
                <select 
                  value={newClass} onChange={(e) => setNewClass(e.target.value as WineClass)}
                  className="w-full px-2 py-1 text-xs border border-[#ced] rounded bg-[#FAF8F5]"
                >
                  <option value="red">{lang === 'ka' ? 'წითელი' : 'Red'}</option>
                  <option value="white">{lang === 'ka' ? 'თეთრი' : 'White'}</option>
                  <option value="rose">{lang === 'ka' ? 'ვარდისფერი (როზე)' : 'Rosé'}</option>
                  <option value="amber">{lang === 'ka' ? 'ქვევრის ქარვისფერი' : 'Amber/Georgian qvevri'}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">{t.vintage || 'Vintage'}</label>
                <input 
                  type="number" value={newVintage} onChange={(e) => setNewVintage(parseInt(e.target.value) || 2025)}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-[#FAF8F5]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                  {{
                    en: 'Volume Equivalency (L)',
                    ka: 'მოცულობა (ლ)',
                    it: 'Volume Equivalente (L)',
                    fr: 'Équivalence Volume (L)',
                    de: 'Volumen (L)'
                  }[lang] || 'Volume Equivalency (L)'}
                </label>
                <input 
                  type="number" value={newVolume} onChange={(e) => setNewVolume(parseInt(e.target.value) || 100)}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-[#FAF8F5]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                {{
                  en: 'Vineyard Block Source',
                  ka: 'ვენახის საწყისი ნაკვეთი',
                  it: 'Sorgente Lotto Vigneto',
                  fr: 'Parcelle de Vigne Source',
                  de: 'Weinbergsparzelle'
                }[lang] || 'Vineyard Block Source'}
              </label>
              <input 
                type="text" placeholder="Mukuzani West Block B"
                value={newVineyard} onChange={(e) => setNewVineyard(e.target.value)}
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-[#FAF8F5]"
              />
            </div>
            <button 
              type="submit" 
              className="w-full py-1.5 text-xs font-semibold text-white bg-[#4e0e15] cursor-pointer hover:bg-[#6b151e] rounded text-center block"
            >
              {{
                en: 'Verify & Add Lot',
                ka: 'გადამოწმება და დამატება',
                it: 'Verifica & Aggiungi Lotto',
                fr: 'Vérifier & Ajouter le Lot',
                de: 'Prüfen & Hinzufügen'
              }[lang] || 'Verify & Add Lot'}
            </button>
          </form>
        )}

        {/* List items representation */}
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {filteredLots.map(l => {
            const isSelected = l.id === selectedLotId;
            return (
              <div
                key={l.id}
                onClick={() => setSelectedLotId(l.id)}
                className={`p-3 border rounded-lg cursor-pointer transition-all flex items-center justify-between ${
                  isSelected 
                    ? 'bg-[#f5efe9] border-[#4e0e15] shadow-sm' 
                    : 'bg-white border-[#e8dfd5] hover:border-slate-300'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-800 truncate block">{l.name}</span>
                    <span className="text-[9px] font-mono px-1 py-0.2 bg-slate-100 text-slate-500 border rounded font-bold shrink-0">{l.id}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-400 capitalize">{l.wineClass} Wine</span>
                    <span className="text-[10px] text-slate-400 font-medium">Vol: {l.currentVolume}L</span>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'translate-x-1 text-[#4e0e15]' : 'text-slate-300'}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Details/Timeline Trace Panel */}
      <div className="lg:col-span-2 space-y-4">
        {selectedLot ? (
          <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800 space-y-6">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-bold text-[#4e0e15]">{selectedLot.name}</h2>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 font-bold bg-[#f5efe9] border border-[#e3d7cb] text-[#4e0e15] rounded">
                    {selectedLot.id}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 font-medium font-sans">
                  Vintage {selectedLot.vintage} • Traditional Single-Lot Mapping trace
                </p>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-mono text-slate-400 block uppercase">Current Processing Stage</span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#4e0e15] bg-[#FAF8F5] border border-[#e8dfd5] px-2.5 py-1 rounded inline-block mt-1">
                  {selectedLot.stage.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* General Chemistry specs summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3 bg-gradient-to-br from-[#FAF8F5] to-[#f5efe9]/30 border border-[#f0e6da] rounded-lg">
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase">Grape Variety</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.variety}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase">Vineyard Block Source</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.vineyardBlock}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase text-amber-800/80">Est Origin PDO</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.region}</strong>
              </div>
              <div>
                <span className="text-[9px] text-slate-400 font-mono block uppercase text-red-800/80">Active Balance</span>
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.currentVolume} Liters</strong>
              </div>
            </div>

            {/* Traceability chronological timeline sequence (THE SYSTEM MUST DISPLAY HISTORIC TIMELINE AS MAPPED) */}
            <div className="space-y-4">
              <h4 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                <Compass className="w-4 h-4 text-[#4e0e15]" />
                {t.traceability_timeline} Chronology
              </h4>

              <div className="relative pl-6 border-l border-[#f5efe9] space-y-5">
                {selectedLot.history.map((hist, index) => (
                  <div key={index} className="relative">
                    {/* Circle Node indicator */}
                    <div className="absolute -left-[30px] top-1 w-3 h-3 bg-[#4e0e15] ring-4 ring-[#FAF8F5] rounded-full flex items-center justify-center border border-white" />
                    
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg hover:border-slate-200 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1.5">
                        <span className="text-xs font-bold text-slate-700 flex items-center gap-1">{hist.type}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-slate-400 font-mono font-medium">{hist.date}</span>
                          <span className="text-[9px] px-1.5 py-0.2 bg-white border rounded font-mono text-slate-500 font-bold">Operator: {hist.operator}</span>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed font-sans">{hist.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center border-2 border-dashed border-[#e8dfd5] rounded-xl text-slate-400 italic font-serif">
            Configure or select an active wine lot to audit traceability history pathways.
          </div>
        )}
      </div>
    </div>
  );
}
