'use client';

import React, { useState, useEffect } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { WineLot, WinemakingStage, WineClass, Vessel, LabAnalysis, BottlingRunRecord, SalesOrderRecord, SalesDispatchRecord } from '../lib/wineryState';
import type { CostEntry } from '../lib/costing';
import type { StockMovement } from '../lib/storage';
import { stageLabel, vesselTypeLabel } from '../lib/enumLabels';
import WineLotCommandCenter from './WineLotCommandCenter';
import { ChevronRight, Compass, Plus, ListFilter, FileText, MapPin, Activity } from 'lucide-react';

interface Props {
  lang: Language;
  lots: WineLot[];
  onUpdateLots: (newLots: WineLot[]) => void;
  canCreateLot?: boolean;
  canUpdateLot?: boolean;
  onOpenPassport?: (lotId: string) => void;
  vessels?: Vessel[];
  labLogs?: LabAnalysis[];
  costEntries?: CostEntry[];
  bottlingRuns?: BottlingRunRecord[];
  stockMovements?: StockMovement[];
  salesOrders?: SalesOrderRecord[];
  salesDispatches?: SalesDispatchRecord[];
  currency?: string;
  setActiveTab?: (tab: string) => void;
  setSelectedTankId?: (tankId: string | null) => void;
  setCalculatorLotId?: (lotId: string) => void;
  setCalculatorLotIdA?: (lotId: string) => void;
}

export function commitWineLotMutationIfAllowed(
  allowed: boolean,
  nextLots: WineLot[],
  onUpdateLots: (newLots: WineLot[]) => void,
): boolean {
  if (!allowed) return false;
  onUpdateLots(nextLots);
  return true;
}

export default function WineLotsTrace({
  lang,
  lots,
  onUpdateLots,
  canCreateLot = true,
  canUpdateLot = true,
  onOpenPassport,
  vessels = [],
  labLogs = [],
  costEntries = [],
  bottlingRuns = [],
  stockMovements = [],
  salesOrders = [],
  salesDispatches = [],
  currency = 'GEL',
  setActiveTab,
  setSelectedTankId,
  setCalculatorLotId,
  setCalculatorLotIdA
}: Props) {
  const t = translations[lang];
  const [selectedLotId, setSelectedLotId] = useState<string | null>(lots[0]?.id || null);
  const [filterClass, setFilterClass] = useState<string>('all');
  const [filterVintage, setFilterVintage] = useState<string>('all');

  // Lot Edit States
  const [isEditingLot, setIsEditingLot] = useState(false);
  const [editName, setEditName] = useState('');
  const [editVariety, setEditVariety] = useState('');
  const [editVintage, setEditVintage] = useState(2025);
  const [editVolume, setEditVolume] = useState(0);
  const [editBlock, setEditBlock] = useState('');
  const [editRegion, setEditRegion] = useState('');

  const selectedLot = lots.find(l => l.id === selectedLotId);

  useEffect(() => {
    if (selectedLot) {
      setEditName(selectedLot.name);
      setEditVariety(selectedLot.variety);
      setEditVintage(selectedLot.vintage);
      setEditVolume(selectedLot.currentVolume);
      setEditBlock(selectedLot.vineyardBlock);
      setEditRegion(selectedLot.region);
      setIsEditingLot(false);
    }
  }, [selectedLotId, selectedLot]);

  // Stage transition states
  const [showTransitionForm, setShowTransitionForm] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<WinemakingStage>('crushing');
  const [transitionOperator, setTransitionOperator] = useState('Luka Tatrishvili');
  const [transitionNotes, setTransitionNotes] = useState('');

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
    if (!canCreateLot) return;
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

    if (!commitWineLotMutationIfAllowed(canCreateLot, [...lots, newLot], onUpdateLots)) return;
    setNewId('');
    setNewName('');
    setNewVineyard('');
    setShowAddForm(false);
    setSelectedLotId(newLot.id);
  };



  const filteredLots = lots.filter(l => {
    if (filterClass !== 'all' && l.wineClass !== filterClass) return false;
    if (filterVintage !== 'all' && l.vintage.toString() !== filterVintage) return false;
    return true;
  });

  const uniqueVintages = Array.from(new Set(lots.map(l => l.vintage))).sort((a, b) => b - a);
  const isReadOnly = !canCreateLot && !canUpdateLot;
  const readOnlyNotice = lang === 'ka'
    ? {
        title: 'ღვინის პარტიებზე მხოლოდ ნახვის წვდომა',
        body: 'შეგიძლიათ დაათვალიეროთ პარტიის დეტალები, მიკვლევადობა, წარმოშობის კავშირები, პასპორტები და მარნის დაკავშირებული ჩანაწერები, მაგრამ თქვენი როლი ვერ ქმნის ან ცვლის ღვინის პარტიებს.',
      }
    : {
        title: 'Read-only wine lot access',
        body: 'You can browse lot details, traceability, lineage, passports, and linked cellar records, but your role cannot create or change wine lots.',
      };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-4 gap-8">
      {isReadOnly && (
        <div role="status" className="xl:col-span-3 2xl:col-span-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-100">
          <strong className="block text-xs font-bold">{readOnlyNotice.title}</strong>
          <span className="mt-0.5 block text-[11px] leading-relaxed">
            {readOnlyNotice.body}
          </span>
        </div>
      )}
      {/* List Panel */}
      <div className="xl:col-span-1 space-y-4">
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
          {canCreateLot && <button
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
          </button>}
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
                  {lang === 'ka'
                    ? ({all: 'ყველა', red: 'წითელი', white: 'თეთრი', amber: 'ქარვისფერი'} as Record<string, string>)[cls] || cls
                    : cls}
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
        {canCreateLot && showAddForm && (
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
                type="text" placeholder={lang === 'ka' ? 'მაგ. მუკუზანი, დასავლეთი ბლოკი B' : 'Mukuzani West Block B'}
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
                    {l.voidedAt && <span className="text-[8px] uppercase font-bold rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Voided</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-400 capitalize">{lang === 'ka'
                      ? ({red_dry: 'წითელი მშრალი', white_dry: 'თეთრი მშრალი', amber_dry: 'ქარვისფერი მშრალი', rose: 'ვარდისფერი', red_semi_sweet: 'წითელი ნახევრადტკბილი', white_semi_sweet: 'თეთრი ნახევრადტკბილი'} as Record<string, string>)[l.wineClass] || l.wineClass
                      : `${l.wineClass} Wine`}</span>
                    <span className="text-[10px] text-slate-400 font-medium">{lang === 'ka' ? 'მოც.' : 'Vol'}: {l.currentVolume}L</span>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'translate-x-1 text-[#4e0e15]' : 'text-slate-300'}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Details/Timeline Trace Panel */}
      <div className="xl:col-span-2 2xl:col-span-3 space-y-6">
        {selectedLot ? (
          <div className="p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-xs text-stone-900 dark:text-stone-200 space-y-8">
            <WineLotCommandCenter
              lang={lang}
              lot={selectedLot}
              vessels={vessels}
              labLogs={labLogs}
              costEntries={costEntries}
              bottlingRuns={bottlingRuns}
              stockMovements={stockMovements}
              salesOrders={salesOrders}
              salesDispatches={salesDispatches}
              currency={currency}
              onEdit={canUpdateLot && !selectedLot.voidedAt ? () => setIsEditingLot(!isEditingLot) : undefined}
              onOpenPassport={onOpenPassport}
              setActiveTab={setActiveTab}
              setSelectedTankId={setSelectedTankId}
              setCalculatorLotId={setCalculatorLotId}
            />
            {/* Header info */}
            <div className="hidden">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-serif font-bold text-[#4e0e15]">{selectedLot.name}</h2>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 font-bold bg-[#f5efe9] border border-[#e3d7cb] text-[#4e0e15] rounded">
                    {selectedLot.id}
                  </span>
                  {canUpdateLot && <button
                    type="button"
                    onClick={() => setIsEditingLot(!isEditingLot)}
                    className="text-stone-500 hover:text-[#4e0e15] text-[10px] font-mono font-bold transition-colors cursor-pointer select-none border border-stone-250 px-1.5 rounded"
                    title={lang === 'ka' ? 'პარტიის თვისებების რედაქტირება' : 'Edit Lot Properties'}
                  >
                    ✏️ {lang === 'ka' ? 'შეცვლა' : 'Edit'}
                  </button>}
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
                {onOpenPassport && (
                  <button
                    onClick={() => onOpenPassport(selectedLot.id)}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded-lg transition-colors cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" /> Passport (PDF)
                  </button>
                )}
              </div>
            </div>

            {canUpdateLot && !selectedLot.voidedAt && isEditingLot ? (
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!canUpdateLot) return;
                const updatedLots = lots.map(l => {
                  if (l.id === selectedLot.id) {
                    return {
                      ...l,
                      name: editName,
                      variety: editVariety,
                      vintage: Number(editVintage) || 2025,
                      currentVolume: Number(editVolume) || 0,
                      vineyardBlock: editBlock,
                      region: editRegion
                    };
                  }
                  return l;
                });
                if (!commitWineLotMutationIfAllowed(canUpdateLot, updatedLots, onUpdateLots)) return;
                setIsEditingLot(false);
              }} className="space-y-4 bg-[#FAF8F5] p-5 border border-[#e8dfd5] rounded-xl text-xs text-stone-700">
                <h3 className="text-xs uppercase font-mono tracking-widest text-[#4e0e15] font-black border-b pb-1.5 mb-3 flex justify-between items-center">
                  <span>✏️ {lang === 'ka' ? 'პარტიის რედაქტირება' : 'Edit Wine Lot Properties'}</span>
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                      {lang === 'ka' ? 'სახელი' : 'Lot Name'}
                    </label>
                    <input
                      type="text" required
                      value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'ჯიში' : 'Grape Variety'}
                      </label>
                      <input
                        type="text" required
                        value={editVariety} onChange={(e) => setEditVariety(e.target.value)}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'წელი' : 'Vintage'}
                      </label>
                      <input
                        type="number" required
                        value={editVintage} onChange={(e) => setEditVintage(Number(e.target.value) || 2025)}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'მოცულობა (L)' : 'Volume (Liters)'}
                      </label>
                      <input
                        type="number" required min="0"
                        value={editVolume} onChange={(e) => setEditVolume(Number(e.target.value) || 0)}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                        {lang === 'ka' ? 'ნაკვეთი' : 'Vineyard Block'}
                      </label>
                      <input
                        type="text" required
                        value={editBlock} onChange={(e) => setEditBlock(e.target.value)}
                        className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">
                      {lang === 'ka' ? 'რეგიონი / PDO' : 'Origin Region / PDO'}
                    </label>
                    <input
                      type="text" required
                      value={editRegion} onChange={(e) => setEditRegion(e.target.value)}
                      className="w-full bg-white border border-[#e8dfd5] p-2.5 rounded text-stone-900 outline-none focus:border-[#4e0e15]"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingLot(false)}
                    className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-700 font-mono font-bold uppercase py-2 rounded text-[10px] cursor-pointer transition-colors"
                  >
                    {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase py-2 rounded text-[10px] cursor-pointer transition-colors"
                  >
                    {lang === 'ka' ? 'შენახვა' : 'Save Changes'}
                  </button>
                </div>
              </form>
            ) : (
              <>

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
                <strong className="text-slate-700 font-bold text-xs">{selectedLot.currentVolume} {lang === 'ka' ? 'ლიტრი' : 'Liters'}</strong>
              </div>
            </div>

            {/* Live Location and Chemistry Metrics card */}
            {(() => {
              const containingVessels = vessels.filter(v => v.assignedLotId === selectedLot.id);
              const lotLabs = labLogs.filter(log => log.lotId === selectedLot.id);
              const latestLab = lotLabs[0];

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-stone-200 bg-[#FCFAF8] p-4 rounded-xl shadow-2xs dark:bg-stone-900/50 dark:border-stone-800">
                  {/* Left Column: Containing Vessel info */}
                  <div className="space-y-3">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-bold text-stone-550 flex items-center gap-1.5 dark:text-stone-400">
                      <MapPin className="w-4 h-4 text-[#801323]" /> Live Location Containment
                    </h4>

                    {containingVessels.length > 0 ? (
                      <div className="space-y-2">
                        {containingVessels.map(v => (
                          <div key={v.id} className="p-3 bg-white border border-stone-200 rounded-lg flex items-center justify-between shadow-3xs dark:bg-stone-950 dark:border-stone-850">
                            <div>
                              <strong className="text-xs font-sans text-stone-900 block dark:text-amber-100">{v.id} ({vesselTypeLabel(v.type, lang)})</strong>
                              <span className="text-[10px] text-slate-400 block font-mono">{lang === 'ka' ? 'ტემპ.' : 'Temp'}: {v.temperature}°C • {lang === 'ka' ? 'მოც.' : 'Vol'}: {v.currentVolume} L</span>
                            </div>
                            {setSelectedTankId && (
                              <button
                                onClick={() => setSelectedTankId(v.id)}
                                className="px-2 py-1 text-[9px] font-bold text-white bg-[#4e0e15] hover:bg-[#801323] rounded transition-colors cursor-pointer"
                              >
                                {lang === 'ka' ? 'დეტალების ნახვა' : 'View Drawer'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-450 italic font-mono py-2">
                        Liquid is currently unallocated to specific cellar vessels (bulk dry storage).
                      </p>
                    )}
                  </div>

                  {/* Right Column: Latest Chemistry */}
                  <div className="space-y-3 border-t md:border-t-0 md:border-l border-stone-200/80 pt-3 md:pt-0 md:pl-4 dark:border-stone-800">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-bold text-stone-550 flex items-center gap-1.5 dark:text-stone-400">
                      <Activity className="w-4 h-4 text-[#801323]" /> Latest Laboratory Chemistry
                    </h4>

                    {latestLab ? (
                      <div className="space-y-2.5">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-semibold text-slate-700 dark:text-stone-300 font-mono">
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">ABV:</span>
                            <span>{latestLab.alcoholPct}%</span>
                          </div>
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">pH:</span>
                            <span>{latestLab.ph || '--'}</span>
                          </div>
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">Free SO₂:</span>
                            <span className={latestLab.freeSo2 < 15 ? 'text-red-700 font-bold' : ''}>{latestLab.freeSo2} mg/L</span>
                          </div>
                          <div className="flex justify-between border-b pb-1 border-stone-100 dark:border-stone-850">
                            <span className="text-slate-400 font-normal">VA Level:</span>
                            <span className={latestLab.volatileAcid > 0.8 ? 'text-red-700 font-bold' : ''}>{latestLab.volatileAcid} g/L</span>
                          </div>
                        </div>

                        {/* Integration buttons */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {setActiveTab && (
                            <button
                              onClick={() => {
                                setActiveTab('labs');
                              }}
                              className="px-2 py-1 bg-white border border-stone-200 text-stone-700 hover:border-[#4e0e15] hover:text-[#4e0e15] text-[9.5px] font-bold rounded transition-colors cursor-pointer dark:bg-stone-950 dark:border-stone-850 dark:text-stone-300 dark:hover:border-amber-400"
                            >
                              🧬 Log Lab panel
                            </button>
                          )}
                          {setActiveTab && setCalculatorLotId && (
                            <button
                              onClick={() => {
                                setCalculatorLotId(selectedLot.id);
                                setActiveTab('calculators');
                              }}
                              className="px-2 py-1 bg-white border border-stone-200 text-stone-700 hover:border-[#4e0e15] hover:text-[#4e0e15] text-[9.5px] font-bold rounded transition-colors cursor-pointer dark:bg-stone-950 dark:border-stone-850 dark:text-stone-300 dark:hover:border-amber-400"
                            >
                              🧪 SO₂ Calculator
                            </button>
                          )}
                          {setActiveTab && setCalculatorLotIdA && (
                            <button
                              onClick={() => {
                                setCalculatorLotIdA(selectedLot.id);
                                setActiveTab('calculators');
                              }}
                              className="px-2 py-1 bg-white border border-stone-200 text-stone-700 hover:border-[#4e0e15] hover:text-[#4e0e15] text-[9.5px] font-bold rounded transition-colors cursor-pointer dark:bg-stone-950 dark:border-stone-850 dark:text-stone-300 dark:hover:border-amber-400"
                            >
                              ⚖ Blending Simulation
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-center py-2">
                        <p className="text-xs text-slate-455 italic font-mono">
                          {lang === 'ka' ? 'ამ პარტიაზე ლაბორატორიული ანალიზები არ არის ჩაწერილი.' : 'No lab measurements logged for this lot code.'}
                        </p>
                        {setActiveTab && (
                          <button
                            onClick={() => setActiveTab('labs')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-white bg-[#4e0e15] hover:bg-[#801323] rounded transition-colors cursor-pointer"
                          >
                            ➕ {lang === 'ka' ? 'ქიმიური პანელის დაწყება' : 'Initialize Chemistry Panel'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Stage Progress Stepper */}
            {(() => {
              const stagesOrdered: WinemakingStage[] = [
                'crushing',
                'fermenting',
                'maceration',
                'pressing',
                'aging',
                'stabilization',
                'filtration',
                'bottled',
                'sold'
              ];

              return (
                <div className="space-y-4 border border-stone-200/80 bg-stone-50/50 p-4 rounded-xl dark:bg-stone-900/50 dark:border-stone-800">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-bold text-stone-550 flex items-center gap-1.5 dark:text-stone-400">
                      🍇 Winemaking Stage Workflow
                    </h4>
                    {canUpdateLot && <button
                      onClick={() => {
                        if (!canUpdateLot) return;
                        const currentIndex = stagesOrdered.indexOf(selectedLot.stage);
                        const nextIndex = Math.min(stagesOrdered.length - 1, currentIndex + 1);
                        setTransitionTarget(stagesOrdered[nextIndex]);
                        setTransitionOperator('Luka Tatrishvili');
                        setTransitionNotes('');
                        setShowTransitionForm(true);
                      }}
                      className="px-2 py-1 text-[10px] font-bold text-white bg-[#801323] hover:bg-[#4e0e15] rounded transition-all cursor-pointer shadow-2xs"
                    >
                      {lang === 'ka' ? 'ეტაპის შეცვლა' : 'Advance / Modify Stage'}
                    </button>}
                  </div>

                  {/* Stage Progress Stepper (Flex row) */}
                  <div className="overflow-x-auto pb-2 -mx-2 px-2 no-scrollbar">
                    <div className="flex items-center justify-between min-w-[700px] relative py-2">
                      {/* Connection Line */}
                      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-stone-200 z-0 -translate-y-1/2 dark:bg-stone-800" />

                      {stagesOrdered.map((st, idx) => {
                        const currentStageIndex = stagesOrdered.indexOf(selectedLot.stage);
                        const isCompleted = idx < currentStageIndex;
                        const isActive = idx === currentStageIndex;
                        const label = stageLabel(st, lang);

                        return (
                          <div key={st} className="flex flex-col items-center z-10 relative">
                            <div
                              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-emerald-600 text-white ring-4 ring-emerald-50 border border-white dark:ring-emerald-950/20'
                                  : isActive
                                  ? 'bg-[#4e0e15] text-white ring-4 ring-rose-100 border border-white scale-110 animate-pulse dark:ring-rose-950/30'
                                  : 'bg-stone-200 text-stone-400 border border-white dark:bg-stone-800 dark:text-stone-600'
                              }`}
                              title={st}
                            >
                              {isCompleted ? '✓' : idx + 1}
                            </div>
                            <span className={`text-[9.5px] font-medium mt-1.5 tracking-tight ${
                              isActive ? 'text-[#4e0e15] font-black dark:text-amber-100' : isCompleted ? 'text-emerald-700' : 'text-stone-400 dark:text-stone-500'
                            }`}>
                              {label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Transition form drawer */}
                  {canUpdateLot && showTransitionForm && (
                    <div className="bg-white border border-stone-200 p-4 rounded-xl space-y-3.5 shadow-2xs text-xs dark:bg-stone-950 dark:border-stone-800">
                      <h5 className="font-bold text-[#4e0e15] border-b border-stone-100 pb-1.5 uppercase text-[10px] tracking-wide dark:text-amber-100 dark:border-stone-850">
                        {lang === 'ka' ? 'ეტაპის გადასვლის ჩაწერა' : 'Log Stage Transition'}
                      </h5>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">{lang === 'ka' ? 'სამიზნე ეტაპი' : 'Target Stage'}</label>
                          <select
                            value={transitionTarget}
                            onChange={(e) => setTransitionTarget(e.target.value as WinemakingStage)}
                            className="w-full bg-[#FAF8F5] border border-stone-200 px-2 py-1.5 rounded outline-none text-stone-800 dark:bg-stone-900 dark:border-stone-800 dark:text-stone-100"
                          >
                            {stagesOrdered.map(st => (
                              <option key={st} value={st}>
                                {stageLabel(st, lang)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ოპერატორი / მემარნე' : 'Operator / Cellarer'}</label>
                          <input
                            type="text"
                            value={transitionOperator}
                            onChange={(e) => setTransitionOperator(e.target.value)}
                            className="w-full bg-[#FAF8F5] border border-stone-200 px-2 py-1.5 rounded outline-none text-stone-800 dark:bg-stone-900 dark:border-stone-800 dark:text-stone-100"
                            placeholder={lang === 'ka' ? 'მაგ. ნინო გელაშვილი' : 'e.g. Sophia Rossi'}
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9.5px] font-mono uppercase text-slate-400 font-bold mb-1">{lang === 'ka' ? 'გადასვლის ოპერაციის შენიშვნები' : 'Transition Operation Log notes'}</label>
                        <textarea
                          value={transitionNotes}
                          onChange={(e) => setTransitionNotes(e.target.value)}
                          className="w-full bg-[#FAF8F5] border border-stone-200 p-2 rounded outline-none h-16 text-stone-800 dark:bg-stone-900 dark:border-stone-800 dark:text-stone-100"
                          placeholder={lang === 'ka' ? 'აღწერეთ ქმედება: გადატანა, მაცერაცია, გოგირდის კორექცია ან ფილტრაციის შემოწმება...' : 'Describe action: racking, dynamic skin maceration, sulfur adjustment, or filtration check...'}
                          required
                        />
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowTransitionForm(false)}
                          className="px-3 py-1.5 bg-stone-100 text-stone-600 rounded hover:bg-stone-200 cursor-pointer dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-850"
                        >
                          {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canUpdateLot) return;
                            if (transitionOperator.trim() && transitionNotes.trim()) {
                              const updatedLots = lots.map(l => {
                                if (l.id === selectedLot.id) {
                                  return {
                                    ...l,
                                    stage: transitionTarget,
                                    history: [
                                      {
                                        date: new Date().toISOString().split('T')[0],
                                        type: lang === 'ka' ? `ეტაპის გადასვლა: ${stageLabel(transitionTarget, lang)}` : `Stage Transition: to ${transitionTarget}`,
                                        description: transitionNotes,
                                        operator: transitionOperator
                                      },
                                      ...(l.history || [])
                                    ]
                                  };
                                }
                                return l;
                              });
                              if (!commitWineLotMutationIfAllowed(canUpdateLot, updatedLots, onUpdateLots)) return;
                              setShowTransitionForm(false);
                            } else {
                              alert(lang === 'ka' ? 'გთხოვთ მიუთითოთ ოპერატორის სახელი და გადასვლის შენიშვნები.' : 'Please provide Operator name and Transition notes.');
                            }
                          }}
                          className="px-3 py-1.5 bg-emerald-705 text-white rounded hover:bg-emerald-800 cursor-pointer"
                        >
                          {lang === 'ka' ? 'გადასვლის დადასტურება' : 'Confirm Transition'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Traceability chronological timeline sequence (THE SYSTEM MUST DISPLAY HISTORIC TIMELINE AS MAPPED) */}
            <div className="space-y-4">
              <h4 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                <Compass className="w-4 h-4 text-[#4e0e15]" />
                {t.traceability_timeline}{lang === 'ka' ? '' : ' Chronology'}
              </h4>

              <div className="relative pl-6 border-l border-[#f5efe9] space-y-5">
                {/* Guard: lots hydrated from imports/API can arrive without history —
                    a missing array must not crash the whole app (root ErrorBoundary). */}
                {(selectedLot.history || []).map((hist, index) => (
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
          </>
        )}
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
