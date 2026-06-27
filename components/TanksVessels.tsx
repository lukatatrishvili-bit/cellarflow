'use client';

import React, { useState } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Vessel, VesselType, WineLot } from '../lib/wineryState';
import { 
  ShieldAlert, CheckCircle, Flame, Snowflake, RotateCw, Plus, Trash2, Edit, 
  Search, LayoutGrid, List, Map, Sparkles, Database, Droplets, Thermometer, ShieldCheck
} from 'lucide-react';
import TankCapacityChart, { ChartTankData } from './TankCapacityChart';
import CellarMap from './CellarMap';
import VesselFill from './VesselFill';

interface Props {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  onUpdateVessels: (newVessels: Vessel[]) => void;
  onSelectTank?: (tankId: string) => void;
  selectedTankId?: string | null;
  setActiveTab?: (tab: string) => void;
  setPrefilledSourceId?: (id: string) => void;
  setPrefilledDestId?: (id: string) => void;
}

export default function TanksVessels({ 
  lang, vessels, lots, onUpdateVessels, onSelectTank, selectedTankId,
  setActiveTab, setPrefilledSourceId, setPrefilledDestId
}: Props) {
  const t = translations[lang];
  const ka = lang === 'ka';
  const lText = (obj: Partial<Record<Language, string>>, fallback: string): string => {
    return obj[lang] || fallback;
  };

  const [filterType, setFilterType] = useState<string>('all');
  
  // Custom view modes and search states for intuitive navigation
  const [viewMode, setViewMode] = useState<'grid' | 'table' | 'map'>('grid');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'empty' | 'occupied' | 'dirty' | 'cooling'>('all');

  // Custom add vessel state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newId, setNewId] = useState('');
  const [newType, setNewType] = useState<VesselType>('stainless_steel');
  const [newCapacity, setNewCapacity] = useState(2000);
  const [newLocation, setNewLocation] = useState('');

  // Editing temperature state
  const [editingTempId, setEditingTempId] = useState<string | null>(null);
  const [tempInputValue, setTempInputValue] = useState<number>(15);

  const handleClean = (vId: string) => {
    const updated = vessels.map(v => {
      if (v.id === vId) {
        return {
          ...v,
          cleaningStatus: 'clean' as const,
          lastCleaned: new Date().toISOString().split('T')[0],
          lastOperation: 'Sanitized'
        };
      }
      return v;
    });
    onUpdateVessels(updated);
  };

  const handleToggleCooling = (vId: string) => {
    const updated = vessels.map(v => {
      if (v.id === vId) {
        return {
          ...v,
          coolingJacketActive: !v.coolingJacketActive,
          lastOperation: !v.coolingJacketActive ? 'Activated Cooling Jacket' : 'Deactivated Cooling'
        };
      }
      return v;
    });
    onUpdateVessels(updated);
  };

  const handleSaveTemp = (vId: string) => {
    const updated = vessels.map(v => {
      if (v.id === vId) {
        return {
          ...v,
          temperature: tempInputValue,
          lastOperation: `Adjusted temperature to ${tempInputValue}°C`
        };
      }
      return v;
    });
    onUpdateVessels(updated);
    setEditingTempId(null);
  };

  const handleDeleteVessel = (vId: string) => {
    const filtered = vessels.filter(v => v.id !== vId);
    onUpdateVessels(filtered);
  };

  const handleAddVessel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId) return;

    const newVessel: Vessel = {
      id: newId,
      type: newType,
      shape: newType === 'barrel' ? 'horizontal' : 'vertical',
      capacity: newCapacity,
      currentVolume: 0,
      assignedLotId: null,
      cleaningStatus: 'clean',
      lastCleaned: new Date().toISOString().split('T')[0],
      temperature: 15.0,
      coolingJacketActive: false,
      targetTemperature: null,
      lastOperation: 'Vessel commissioned',
      locationDetails: newLocation || 'Main Cellar Hall'
    };

    onUpdateVessels([...vessels, newVessel]);
    setNewId('');
    setNewLocation('');
    setShowAddForm(false);
  };

  // Improved reactive filtering system with multi-criteria support
  const filteredVessels = vessels.filter(v => {
    // 1. Filter by Material/Type
    if (filterType !== 'all' && v.type !== filterType) return false;

    // 2. Filter by Status filter
    if (statusFilter === 'empty' && v.currentVolume > 0) return false;
    if (statusFilter === 'occupied' && (!v.assignedLotId || v.currentVolume === 0)) return false;
    if (statusFilter === 'dirty' && v.cleaningStatus !== 'dirty') return false;
    if (statusFilter === 'cooling' && !v.coolingJacketActive) return false;

    // 3. Search input matches vessel ID, location, or assigned wine description
    if (searchTerm.trim() !== '') {
      const query = searchTerm.toLowerCase();
      const matchesId = v.id.toLowerCase().includes(query);
      const matchesLocation = v.locationDetails ? v.locationDetails.toLowerCase().includes(query) : false;
      const assignedLot = lots.find(l => l.id === v.assignedLotId);
      const matchesLotName = assignedLot ? assignedLot.name.toLowerCase().includes(query) : false;
      const matchesLotVariety = assignedLot ? assignedLot.variety.toLowerCase().includes(query) : false;
      if (!matchesId && !matchesLocation && !matchesLotName && !matchesLotVariety) return false;
    }

    return true;
  });

  // Calculate high-fidelity health diagnostics
  const totalVolume = vessels.reduce((sum, v) => sum + v.currentVolume, 0);
  const totalCapacity = vessels.reduce((sum, v) => sum + v.capacity, 0);
  const totalUtilization = totalCapacity > 0 ? (totalVolume / totalCapacity) * 100 : 0;
  const coolingActiveCount = vessels.filter(v => v.coolingJacketActive).length;
  const dirtyCount = vessels.filter(v => v.cleaningStatus === 'dirty').length;

  const mappedTanks: ChartTankData[] = vessels.map(v => ({
    id: v.id,
    name: v.id,
    capacity: v.capacity,
    currentVolume: v.currentVolume,
    status: v.assignedLotId 
      ? (lots.find(l => l.id === v.assignedLotId)?.stage === 'fermenting' ? 'fermenting' : 'occupied')
      : (v.cleaningStatus === 'dirty' ? 'cleaning' : 'empty')
  }));

  return (
    <div className="space-y-6">
      {/* 1. D3-Based Tank Capacity glance chart */}
      <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm">
        <h3 className="text-base font-serif font-semibold text-[#4e0e15] mb-1">
          {({
            en: 'Cellar Capacity Glance',
            ka: 'მარნის ტევადობის ზოგადი ხედი',
            it: 'Panoramica della Capacità della Cantina',
            fr: 'Aperçu de la Capacité de la Cave',
            de: 'Überblick über die Kellerkapazität'
          })[lang] || 'Cellar Capacity Glance'}
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          {({
            en: 'Visualizing active volumes against overall capacity. Red warnings trigger automatically at >95% capacity levels.',
            ka: 'მიმდინარე აქტიური მოცულობის შედარება საერთო ტევადობასთან. წითელი გაფრთხილება ავტომატურად ირთვება >95%-ით შევსებისას.',
            it: 'Visualizzazione del volume attivo rispetto alla capacità complessiva. Gli avvisi rossi si attivano automaticamente a livelli di capacità superiori al 95%.',
            fr: 'Visualisation des volumes actifs par rapport à la capacité globale. Les alertes rouges se déclenchent automatiquement au-dessus de 95 % de capacité.',
            de: 'Visualisierung des aktiven Volumens im Verhältnis zur Gesamtkapazität. Rote Warnungen werden ab 95 % Füllstand automatisch ausgelöst.'
          })[lang] || 'Visualizing active volumes against overall capacity. Red warnings trigger automatically at >95% capacity levels.'}
        </p>

        {/* CONTAINER FOR D3 GRAPHICS (MATCHES CRITICAL CSS SELECTOR FROM TASK) */}
        <TankCapacityChart tanks={mappedTanks} onSelectTank={onSelectTank} selectedTankId={selectedTankId} />
      </div>

      {/* Live High-Fidelity Cellar Diagnostics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Capacity Utilized */}
        <div className="bg-[#FAF8F5] border border-[#f0e6da] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              {({
                en: 'Cellar Volume',
                ka: 'მარნის მოცულობა',
                it: 'Volume Cantina',
                fr: 'Volume Cave',
                de: 'Keller-Volumen'
              })[lang] || 'Cellar Volume'}
            </span>
            <Droplets className="w-3.5 h-3.5 text-[#801323]" />
          </div>
          <div className="mt-2 text-stone-900">
            <h4 className="text-lg font-serif font-bold text-[#4e0e15]">
              {totalVolume.toLocaleString()} L
            </h4>
            <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
              <span>{Math.round(totalUtilization)}% {lText({ en: 'Filled', ka: 'შევსებული', it: 'Riempito', fr: 'Rempli', de: 'Gefüllt' }, 'Filled')}</span>
              <span>/ {totalCapacity.toLocaleString()} L</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1 mt-3 overflow-hidden">
            <div 
              className="bg-[#801323] h-full transition-all duration-500" 
              style={{ width: `${Math.min(100, totalUtilization)}%` }}
            />
          </div>
        </div>

        {/* Metric 2: Vessel Count */}
        <div className="bg-[#FAF8F5] border border-[#f0e6da] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              {({
                en: 'Capacity Units',
                ka: 'ტევადობის ერთეულები',
                it: 'Unità Capacità',
                fr: 'Unités de Capacité',
                de: 'Behälter-Einheiten'
              })[lang] || 'Capacity Units'}
            </span>
            <Database className="w-3.5 h-3.5 text-stone-500" />
          </div>
          <div className="mt-2 text-stone-900">
            <h4 className="text-lg font-serif font-bold text-slate-800">
              {vessels.length} {({ en: 'Vessels', ka: 'ჭურჭელი', it: 'Recipienti', fr: 'Cuves', de: 'Behälter' })[lang] || 'Vessels'}
            </h4>
            <div className="flex gap-2 text-[10px] text-slate-500 mt-1 font-mono">
              <span className="text-emerald-700 font-bold">{vessels.filter(v => v.currentVolume === 0).length} empty</span>
              <span>•</span>
              <span className="text-[#801323] font-bold">{vessels.filter(v => v.currentVolume > 0).length} active</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-3 border-t border-slate-200/50 pt-1">
            {({ en: 'Capacity ready for transfer', ka: 'მზადაა გადასატანად', it: 'Capacità pronta', fr: 'Prêt pour transfert', de: 'Bereit für Transfer' })[lang] || 'Capacity ready for transfer'}
          </div>
        </div>

        {/* Metric 3: Active Coolers */}
        <div className="bg-[#FAF8F5] border border-[#f0e6da] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              {({
                en: 'Active Stabilization',
                ka: 'აქტიური სტაბილიზაცია',
                it: 'Stabilizzazione Attiva',
                fr: 'Stabilisation Active',
                de: 'Aktive Stabilisierung'
              })[lang] || 'Active Stabilization'}
            </span>
            <Snowflake className={`w-3.5 h-3.5 ${coolingActiveCount > 0 ? 'text-sky-600 animate-spin' : 'text-slate-400'}`} />
          </div>
          <div className="mt-2 text-stone-900">
            <h4 className="text-lg font-serif font-bold text-slate-800 flex items-center gap-1.5">
              {coolingActiveCount} {({ en: 'Jackets', ka: 'პერანგი', it: 'Giacche', fr: 'Vestes', de: 'Mäntel' })[lang] || 'Jackets'}
            </h4>
            <div className="text-[10px] text-slate-500 mt-1 font-mono">
              {coolingActiveCount > 0 
                ? `${coolingActiveCount} active temperature controller runs` 
                : 'Automated jackets standard idle'}
            </div>
          </div>
          <div className={`text-[10px] font-semibold mt-3 border-t border-slate-200/50 pt-1 inline-flex items-center gap-1 ${coolingActiveCount > 0 ? 'text-[#0369a1]' : 'text-slate-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${coolingActiveCount > 0 ? 'bg-[#0369a1] animate-pulse' : 'bg-slate-300'}`} />
            <span>{coolingActiveCount > 0 ? 'Active cold-plate holding' : 'Idle standby'}</span>
          </div>
        </div>

        {/* Metric 4: Hygiene status */}
        <div className="bg-[#FAF8F5] border border-[#f0e6da] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              {({
                en: 'Cellar Hygiene Index',
                ka: 'ჰიგიენის ინდექსი',
                it: 'Indice Igiene',
                fr: 'Hygiène de la Cave',
                de: 'Reinheits-Index'
              })[lang] || 'Cellar Hygiene Index'}
            </span>
            {dirtyCount > 0 ? (
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500 animate-bounce" />
            ) : (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            )}
          </div>
          <div className="mt-2 text-stone-900">
            <h4 className="text-lg font-serif font-bold text-slate-800">
              {dirtyCount > 0 
                ? `${dirtyCount} pending wash` 
                : ({ en: 'Pristine Clean', ka: 'იდეალურად სუფთა', it: 'Tutto Pulito', fr: 'Totalement Propre', de: 'Komplett Sauber' })[lang] || 'Pristine Clean'
              }
            </h4>
            <div className="text-[10px] text-slate-500 mt-1 font-mono">
              {dirtyCount > 0 
                ? 'Washing tasks recommended' 
                : '100% of inactive units washed'}
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-3 border-t border-slate-200/50 pt-1">
            {dirtyCount > 0 ? '⚠️ High priority task logged' : '✓ Standard winery health high'}
          </div>
        </div>
      </div>

      {/* 2. Top advanced command and control panel */}
      <div className="space-y-4">
        {/* Core Filters Row */}
        <div className="flex flex-col lg:flex-row gap-3 justify-between items-stretch lg:items-center bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs">
          {/* Material classification tab filters */}
          <div className="flex flex-wrap gap-1">
            {['all', 'stainless_steel', 'qvevri', 'barrel', 'concrete'].map(type => {
              // Calculate counts of each type inline
              const count = vessels.filter(v => type === 'all' || v.type === type).length;
              return (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium cursor-pointer transition-all flex items-center gap-1 mt-1 ${
                    filterType === type 
                      ? 'bg-[#4e0e15] text-white border-[#4e0e15] shadow-xs' 
                      : 'bg-[#FCFAF7] text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span>
                    {type === 'all' && (t.all || 'Show All')}
                    {type === 'stainless_steel' && (t.stainless_steel || 'Stainless Steel')}
                    {type === 'qvevri' && (t.qvevri || 'Qvevris')}
                    {type === 'barrel' && (t.barrel || 'Oak Barrels')}
                    {type === 'concrete' && (t.concrete || 'Concrete')}
                  </span>
                  <span className={`text-[9px] px-1 rounded-full ${
                    filterType === type 
                      ? 'bg-white/25 text-white' 
                      : 'bg-slate-200/60 text-slate-500'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action trigger button */}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center justify-center gap-1 px-3.5 py-1.5 bg-[#4e0e15] hover:bg-[#6b151e] cursor-pointer text-white font-semibold text-xs rounded-lg transition-colors shadow-sm h-9"
          >
            <Plus className="w-3.5 h-3.5" /> 
            {({
              en: 'Commission Vessel',
              ka: 'ჭურჭლის დამატება',
              it: 'Commissiona Recipiente',
              fr: 'Commissionner une Cuve',
              de: 'Behälter in Betrieb nehmen'
            })[lang] || 'Commission Vessel'}
          </button>
        </div>

        {/* Sub search parameters line */}
        <div className="flex flex-col md:flex-row gap-3 justify-between items-center bg-[#FAF8F5]/80 p-3 border border-[#f0e6da] rounded-xl">
          {/* Search bar with lens icon */}
          <div className="relative w-full md:w-80">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input 
              type="text"
              placeholder={({
                en: "Search vessels, locations or wine lots...",
                ka: "მოძებნე ჭურჭელი, მდებარეობა ან პარტია...",
                it: "Cerca recipienti, ubicazioni o lotti...",
                fr: "Rechercher cuves, emplacements ou lots...",
                de: "Suche nach Behältern, Standorten oder Chargen..."
              })[lang] || "Search vessels, locations or wine lots..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:border-[#4e0e15] text-stone-800 shadow-3xs"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2 text-xs text-slate-400 hover:text-stone-700 font-bold"
              >
                ×
              </button>
            )}
          </div>

          {/* Additional status filter filters & View toggler */}
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                {({ en: 'Filter:', ka: 'ფილტრი:', it: 'Stato:', fr: 'Statut :', de: 'Filter:' })[lang] || 'Filter:'}
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-white border border-slate-200 text-xs px-2.5 py-1.5 rounded-lg outline-none text-stone-700 cursor-pointer focus:border-[#4e0e15]"
              >
                <option value="all">{({ en: 'All Statuses', ka: 'ყველა სტატუსი', it: 'Tutti gli Stati', fr: 'Tous les Statuts', de: 'Alle Status' })[lang] || 'All Statuses'}</option>
                <option value="empty">{({ en: 'Empty & Ready', ka: 'ცარიელი', it: 'Vuoto', fr: 'Vides', de: 'Leer & Bereit' })[lang] || 'Empty & Ready'}</option>
                <option value="occupied">{({ en: 'Filled / In-use', ka: 'შევსებული', it: 'Occupato', fr: 'Occupés', de: 'In Verwendung' })[lang] || 'Filled / In-use'}</option>
                <option value="dirty">{({ en: 'Needs Cleaning', ka: 'საჭიროებს რეცხვას', it: 'Da Pulire', fr: 'À Laver', de: 'Reinigungsbedarf' })[lang] || 'Needs Cleaning'}</option>
                <option value="cooling">{({ en: 'Active Cooling', ka: 'აქტიური გაგრილება', it: 'Raffreddamento', fr: 'Refroidissement actif', de: 'Aktive Kühlung' })[lang] || 'Active Cooling'}</option>
              </select>
            </div>

            <span className="text-slate-200 hidden md:block">|</span>

            {/* Layout viewMode switches */}
            <div className="bg-slate-200/70 p-0.5 rounded-lg flex items-center">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                  viewMode === 'grid' 
                    ? 'bg-white text-[#4e0e15] shadow-xs' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Board Grid Representation"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                  viewMode === 'table' 
                    ? 'bg-white text-[#4e0e15] shadow-xs' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Compact Power-Winery Table"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('map')}
                className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                  viewMode === 'map' 
                    ? 'bg-white text-[#4e0e15] shadow-xs' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                title="Interactive Cellar Floor Map"
              >
                <Map className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Add Vessel Form Popup */}
      {showAddForm && (
        <form onSubmit={handleAddVessel} className="p-4 bg-white border border-[#4e0e15] rounded-xl grid grid-cols-1 sm:grid-cols-4 gap-4 items-end shadow">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {({
                en: 'Unique Vessel ID',
                ka: 'უნიკალური ჭურჭლის ID',
                it: 'ID Recipiente Unico',
                fr: 'ID Unique de la Cuve',
                de: 'Eindeutige Behälter-ID'
              })[lang] || 'Unique Vessel ID'}
            </label>
            <input 
              type="text" 
              required
              placeholder="e.g. Tank T-5"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-200 rounded outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {({
                en: 'Vessel Material/Type',
                ka: 'ჭურჭლის მასალა/ტიპი',
                it: 'Materiale/Tipo Recipiente',
                fr: 'Matériau/Type de Cuve',
                de: 'Behältermaterial/-typ'
              })[lang] || 'Vessel Material/Type'}
            </label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as VesselType)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-200 rounded outline-none"
            >
              <option value="stainless_steel">{t.stainless_steel || 'Stainless Steel'}</option>
              <option value="qvevri">
                {({
                  en: 'Traditional Clay Qvevri',
                  ka: 'ტრადიციული თიხის ქვევრი',
                  it: 'Qvevri Tradizionale',
                  fr: 'Qvevri Traditionnel',
                  de: 'Klassischer Qvevri'
                })[lang] || 'Traditional Clay Qvevri'}
              </option>
              <option value="barrel">
                {({
                  en: 'Oak Barrel (Barrique)',
                  ka: 'მუხის კასრი (ბარიკი)',
                  it: 'Botte di Rovere (Barrique)',
                  fr: 'Tonneau de Chêne (Barrique)',
                  de: 'Eichenfass (Barrique)'
                })[lang] || 'Oak Barrel (Barrique)'}
              </option>
              <option value="concrete">{t.concrete || 'Concrete Vessel'}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              {({
                en: 'Maximum Liters Capacity',
                ka: 'მაქსიმალური ტევადობა (ლ)',
                it: 'Capacità Massima Litri',
                fr: 'Capacité Maximale (L)',
                de: 'Maximales Volumen (L)'
              })[lang] || 'Maximum Liters Capacity'}
            </label>
            <input 
              type="number" 
              required
              value={newCapacity}
              onChange={(e) => setNewCapacity(parseInt(e.target.value) || 0)}
              className="w-full px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-slate-200 rounded outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button 
              type="submit"
              className="px-4 py-1.5 bg-[#4e0e15] text-white text-xs font-semibold rounded hover:bg-[#6b151e] flex-1 cursor-pointer"
            >
              {({
                en: 'Register Vessel',
                ka: 'რეგისტრაცია',
                it: 'Registra',
                fr: 'Enregistrer',
                de: 'Registrieren'
              })[lang] || 'Register Vessel'}
            </button>
            <button 
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 text-xs rounded hover:bg-slate-300 pointer-events-auto"
            >
              {t.cancel || 'Cancel'}
            </button>
          </div>
        </form>
      )}

      {/* 4. Executive Vessel Visual Workspace */}
      {filteredVessels.length === 0 ? (
        <div className="p-12 text-center bg-[#FAF8F5] border border-dashed border-[#e8dfd5] rounded-2xl">
          <Database className="w-10 h-10 mx-auto text-stone-300 mb-3" />
          <h4 className="text-sm font-serif font-bold text-stone-700 mb-1">
            {({
              en: 'No matching cellar vessels found',
              ka: 'იდენტური ჭურჭელი ვერ მოიძებნა',
              it: 'Nessun recipiente trovato',
              fr: 'Aucune cuve trouvée',
              de: 'Keine passenden Behälter gefunden'
            })[lang] || 'No matching cellar vessels found'}
          </h4>
          <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
            {({
              en: 'Adjust your active material filters, search queries, or cleaning statuses to expose commissioned cellar units.',
              ka: 'შეცვალეთ ფილტრაციის პარამეტრები ან საძიებო სიტყვა.',
              it: 'Modifica i filtri o la ricerca per mostrare i recipienti disponibili.',
              fr: 'Ajustez vos filtres ou votre terme de recherche.',
              de: 'Passen Sie Ihre Filter oder Ihren Suchbegriff an.'
            })[lang] || 'Adjust your active material filters, search queries, or cleaning statuses to expose commissioned cellar units.'}
          </p>
          <button 
            onClick={() => {
              setSearchTerm('');
              setFilterType('all');
              setStatusFilter('all');
            }}
            className="px-3.5 py-1.5 bg-[#4e0e15] text-white hover:bg-[#6b151e] rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
          >
            {({ en: 'Clear Active Filters', ka: 'ფილტრების გასუფთავება', it: 'Azzera Filtri', fr: 'Effacer Filtres', de: 'Filter zurücksetzen' })[lang] || 'Clear Active Filters'}
          </button>
        </div>
      ) : viewMode === 'map' ? (
        /* Interactive 2D Cellar Map Floor Layout */
        <CellarMap 
          lang={lang}
          vessels={vessels}
          lots={lots}
          onUpdateVessels={onUpdateVessels}
          onSelectTank={onSelectTank}
          selectedTankId={selectedTankId}
          setActiveTab={setActiveTab}
          setPrefilledSourceId={setPrefilledSourceId}
          setPrefilledDestId={setPrefilledDestId}
        />
      ) : viewMode === 'grid' ? (
        /* Original Premium Glass Cards Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6 lg:gap-8">
          {filteredVessels.map(v => {
            const progress = v.capacity > 0 ? (v.currentVolume / v.capacity) * 100 : 0;
            const assignedLot = lots.find(l => l.id === v.assignedLotId);
            const needsCleaning = v.cleaningStatus === 'dirty';
            const isOver95 = progress > 95;
            const isSelected = v.id === selectedTankId;

            return (
              <div 
                key={v.id} 
                onClick={() => onSelectTank?.(v.id)}
                className={`bg-white border text-stone-800 rounded-xl overflow-hidden shadow-sm flex flex-col transition-all cursor-pointer ${
                  isSelected 
                    ? 'border-[#801323] ring-2 ring-[#801323]/10 scale-[1.01]' 
                    : isOver95 
                      ? 'border-red-500 shadow-md ring-1 ring-red-100' 
                      : 'border-[#e8dfd5] hover:border-stone-400'
                }`}
              >
                {/* Card Title Header */}
                <div className="px-4 py-3 bg-[#FAF8F5] border-b border-[#e8dfd5] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSelected && <span className="w-2 h-2 rounded-full bg-[#801323] animate-pulse" />}
                    <div>
                      <h4 className="text-sm font-serif font-bold text-[#4e0e15] flex items-center gap-1">
                        {v.id} 
                        {isSelected && <span className="text-[9px] font-sans font-normal text-stone-400 italic">({({ en: 'selected', ka: 'არჩეული', it: 'selezionato', fr: 'sélectionné', de: 'ausgewählt' })[lang] || 'selected'})</span>}
                      </h4>
                      <p className="text-[10px] text-slate-400 font-mono capitalize">
                        {v.type.replace('_', ' ')} • {v.locationDetails}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteVessel(v.id);
                    }}
                    className="p-1 text-slate-300 hover:text-red-500 cursor-pointer transition-colors"
                    title="Commission out / destroy vessel"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Liquid Graphics Fill Card */}
                <div className="p-4 flex-1 flex flex-col space-y-4">
                  <div className="flex items-center gap-4">
                    {/* Animated liquid-fill vessel (height = volume, colour = wine class) */}
                    <div className={`shrink-0 flex flex-col items-center ${isOver95 ? 'text-red-600' : 'text-[#4e0e15]'}`}>
                      <VesselFill
                        fillPct={progress}
                        wineClass={assignedLot?.wineClass || 'red'}
                        qvevri={v.type === 'qvevri'}
                        width={48}
                        height={64}
                      />
                      <span className="mt-0.5 text-[9px] font-mono font-bold text-slate-500">{progress.toFixed(0)}%</span>
                    </div>

                    {/* Lot metrics */}
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-mono uppercase font-bold text-slate-400">
                        {({
                          en: 'Assigned Lot',
                          ka: 'მიკუთვნებული პარტია',
                          it: 'Lotto Assegnato',
                          fr: 'Lot Assigné',
                          de: 'Zugewiesene Charge'
                        })[lang] || 'Assigned Lot'}
                      </span>
                      {assignedLot ? (
                        <div>
                          <span className="text-xs font-bold text-slate-700 block truncate">{assignedLot.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 mt-0.5 inline-block bg-[#f5efe9] border border-[#e3d7cb] text-[#4e0e15] rounded font-medium capitalize truncate">{assignedLot.variety}</span>
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-slate-400 block italic">
                          {({
                            en: 'Empty / Ready',
                            ka: 'ცარიელი / მზადყოფნაში',
                            it: 'Vuoto / Pronto',
                            fr: 'Vide / Prêt',
                            de: 'Leer / Bereit'
                          })[lang] || 'Empty / Ready'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress parameters bar text */}
                  <div className="grid grid-cols-2 gap-2 text-xs py-2 bg-[#Fdfbfc] border border-[#f5ece4] rounded p-2">
                    <div>
                      <span className="text-[9px] text-slate-400 block font-mono">
                        {({
                          en: 'Current Vol',
                          ka: 'მიმდინარე მოცულობა',
                          it: 'Volume Corrente',
                          fr: 'Volume Actuel',
                          de: 'Aktuelle Füllung'
                        })[lang] || 'Current Vol'}
                      </span>
                      <strong className="text-slate-800 text-xs">{v.currentVolume} L</strong>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 block font-mono">
                        {({
                          en: 'Vessel Capacity',
                          ka: 'ჭურჭლის ტევადობა',
                          it: 'Capacità Recipiente',
                          fr: 'Capacité',
                          de: 'Gesamtkapazität'
                        })[lang] || 'Vessel Capacity'}
                      </span>
                      <strong className="text-slate-800 text-xs">{v.capacity} L</strong>
                    </div>
                  </div>

                  {/* Temperature settings edit */}
                  <div className="text-xs flex items-center justify-between border-t border-dashed border-slate-100 pt-2" onClick={e => e.stopPropagation()}>
                    {v.type === 'qvevri' ? (
                      <>
                        <div>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {ka ? 'ქვევრის / ნიადაგის ტემპ.' : 'Qvevri / Soil Temp'}
                          </span>
                          <span className="font-bold flex items-center gap-1 mt-0.5 text-stone-750">
                            <Thermometer className="w-3.5 h-3.5 text-emerald-600" />
                            {v.temperature}°C / {(v.soilTemperature ?? (v.temperature - 2.5)).toFixed(1)}°C
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {ka ? 'თიხის ლუქი' : 'Clay Seal Status'}
                          </span>
                          {(() => {
                            const lastSealed = v.lastSealedDate ? new Date(v.lastSealedDate) : new Date(Date.now() - 45 * 86400000);
                            const diffDays = Math.round((Date.now() - lastSealed.getTime()) / (1000 * 60 * 60 * 24));
                            const needsReseal = diffDays > 120;
                            const formattedDate = v.lastSealedDate || lastSealed.toISOString().split('T')[0];
                            return (
                              <span 
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-bold border mt-0.5 ${
                                  needsReseal 
                                    ? 'bg-red-50 text-red-750 border-red-200 animate-pulse' 
                                    : 'bg-emerald-50 text-emerald-750 border-emerald-200'
                                }`}
                                title={needsReseal ? (ka ? 'საჭიროებს ხელახალ დალუქვას' : 'Requires beeswax resealing!') : (ka ? 'დალუქულია' : 'Sealed')}
                              >
                                {needsReseal ? (ka ? 'ლუქი გასაახლებელია' : 'Reseal Needed') : (ka ? 'დალუქულია' : 'Sealed')} ({formattedDate})
                              </span>
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {({
                              en: 'Current Temp',
                              ka: 'მიმდინარე ტემპ.',
                              it: 'Temperatura Corrente',
                              fr: 'Température Actuelle',
                              de: 'Aktuelle Temp.'
                            })[lang] || 'Current Temp'}
                          </span>
                          {editingTempId === v.id ? (
                            <div className="flex items-center gap-1 mt-0.5">
                              <input 
                                type="number" 
                                step="0.1"
                                value={tempInputValue}
                                onChange={(e) => setTempInputValue(parseFloat(e.target.value) || 0)}
                                className="w-14 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs"
                              />
                              <button 
                                onClick={() => handleSaveTemp(v.id)}
                                className="px-1.5 py-0.5 text-[9px] bg-green-600 hover:bg-green-700 text-white rounded cursor-pointer"
                              >
                                {t.save || 'Save'}
                              </button>
                            </div>
                          ) : (
                            <span className="font-bold flex items-center gap-1 mt-0.5">
                              {v.temperature}°C 
                              <button 
                                onClick={() => {
                                  setEditingTempId(v.id);
                                  setTempInputValue(v.temperature);
                                }}
                                className="p-0.5 text-slate-400 hover:text-[#4e0e15] cursor-pointer"
                              >
                                <Edit className="w-3 h-3" />
                              </button>
                            </span>
                          )}
                        </div>

                        {/* Cooling options */}
                        <div className="text-right">
                          <span className="text-[9px] text-slate-400 block font-mono">
                            {({
                              en: 'Cooling Jacket',
                              ka: 'გამაგრილებელი პერანგი',
                              it: 'Giacca di Raffreddamento',
                              fr: 'Double Enveloppe',
                              de: 'Kühlmantel'
                            })[lang] || 'Cooling Jacket'}
                          </span>
                          <button 
                            onClick={() => handleToggleCooling(v.id)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-bold transition-all border mt-0.5 cursor-pointer ${
                              v.coolingJacketActive 
                                ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] animate-pulse' 
                                : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                            }`}
                          >
                            {v.coolingJacketActive ? (
                              <>
                                <Snowflake className="w-2.5 h-2.5 text-[#0369a1] animate-spin" /> 
                                {({ en: 'Active', ka: 'აქტიური', it: 'Attiva', fr: 'Active', de: 'Aktiv' })[lang] || 'Active'}
                              </>
                            ) : (
                              ({ en: 'Inactive', ka: 'არააქტიური', it: 'Inattiva', fr: 'Inactive', de: 'Inaktiv' })[lang] || 'Inactive'
                            )}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Cleaning / Operation Status */}
                  <div className="text-xs border-t border-dashed border-slate-100 pt-2 flex items-center justify-between mt-auto" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-slate-400 font-mono text-[9px]">
                        {({ en: 'Hygiene:', ka: 'ჰიგიენა:', it: 'Igiene:', fr: 'Hygiène :', de: 'Reinigung:' })[lang] || 'Hygiene:'}
                      </span>
                      {needsCleaning ? (
                        <span className="text-amber-600 font-bold bg-amber-50 px-1.5 py-0.5 border border-amber-200 rounded">
                          {({ en: 'Needs Cleaning', ka: 'საჭიროებს რეცხვას', it: 'Da Pulire', fr: 'À Nettoyer', de: 'Reinigungsbedarf' })[lang] || 'Needs Cleaning'}
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> 
                          {({ en: 'Clean', ka: 'სუფთა', it: 'Pulito', fr: 'Propre', de: 'Sauber' })[lang] || 'Clean'} ({v.lastCleaned})
                        </span>
                      )}
                    </div>

                    {needsCleaning && (
                      <button
                        onClick={() => handleClean(v.id)}
                        className="inline-flex items-center gap-0.5 px-2 py-1 bg-[#4e0e15] text-white font-bold rounded hover:bg-[#6b151e] cursor-pointer text-[9px]"
                      >
                        <RotateCw className="w-2.5 h-2.5" /> 
                        {({ en: 'Wash Vessel', ka: 'ჭურჭლის რეცხვა', it: 'Lava Recipiente', fr: 'Nettoyer la Cuve', de: 'Gefäß waschen' })[lang] || 'Wash Vessel'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Executive Compact Interactive Wine-Table Layout */
        <div className="bg-white border border-[#e8dfd5] rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-[#FAF8F5] text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider border-b border-[#e8dfd5]">
                <tr>
                  <th className="py-3 px-4">{lText({ en: 'ID / Material', ka: 'ID / მასალა', it: 'ID / Materiale', fr: 'ID / Matériau', de: 'ID / Material' }, 'ID / Material')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Location', ka: 'მდებარეობა', it: 'Ubicazione', fr: 'Emplacement', de: 'Standort' }, 'Location')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Assigned Lot', ka: 'პარტია', it: 'Lotto Assegnato', fr: 'Lot Assigné', de: 'Zugewiesene Charge' }, 'Assigned Lot')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Volume State / Fills', ka: 'მოცულობა', it: 'Volume / Riempimento', fr: 'Volume / Remplissage', de: 'Füllmenge' }, 'Volume State / Fills')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Temperature', ka: 'ტემპერატურა', it: 'Temperatura', fr: 'Température', de: 'Temperatur' }, 'Temperature')}</th>
                  <th className="py-3 px-3 text-center">{lText({ en: 'Cooling Jacket', ka: 'გაგრილება', it: 'Giacca Raffreddamento', fr: 'Jaquette de Rafroidissement', de: 'Kühlmantel' }, 'Cooling Jacket')}</th>
                  <th className="py-3 px-3">{lText({ en: 'Hygiene', ka: 'ჰიგიენა', it: 'Igiene', fr: 'Hygiène', de: 'Hygiene' }, 'Hygiene')}</th>
                  <th className="py-3 px-4 text-center">{lText({ en: 'Actions', ka: 'ქმედებები', it: 'Azioni', fr: 'Actions', de: 'Aktionen' }, 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredVessels.map(v => {
                  const progress = v.capacity > 0 ? (v.currentVolume / v.capacity) * 100 : 0;
                  const assignedLot = lots.find(l => l.id === v.assignedLotId);
                  const needsCleaning = v.cleaningStatus === 'dirty';
                  const isOver95 = progress > 95;
                  const isSelected = v.id === selectedTankId;

                  return (
                    <tr 
                      key={v.id}
                      onClick={() => onSelectTank?.(v.id)}
                      className={`cursor-pointer transition-colors hover:bg-slate-50/50 ${
                        isSelected ? 'bg-[#FAF8F5] font-semibold' : ''
                      }`}
                    >
                      {/* 1. ID / Material */}
                      <td className="py-3.5 px-4 font-serif">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isSelected 
                              ? 'bg-[#801323] animate-ping'
                              : isOver95 
                                ? 'bg-red-500' 
                                : v.currentVolume > 0 ? 'bg-[#801323]' : 'bg-slate-300'
                          }`} />
                          <div>
                            <span className="font-bold text-[#4e0e15] text-xs hover:underline">{v.id}</span>
                            <span className="text-[10px] text-slate-400 font-mono block capitalize">{v.type.replace('_', ' ')}</span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Location */}
                      <td className="py-3.5 px-3 text-slate-500 font-mono">{v.locationDetails || 'Main Hall'}</td>

                      {/* 3. Assigned Wine Lot */}
                      <td className="py-3.5 px-3">
                        {assignedLot ? (
                          <div>
                            <span className="font-bold text-slate-800 text-xs block">{assignedLot.name}</span>
                            <span className="text-[9px] font-mono px-1 py-0.5 bg-slate-100 text-[#4e0e15] rounded whitespace-nowrap inline-block capitalize">{assignedLot.variety}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic font-medium">{lText({ en: 'Empty / Standby', ka: 'ცარიელი', it: 'Vuoto / Pronto', fr: 'Vide', de: 'Leer' }, 'Empty / Standby')}</span>
                        )}
                      </td>

                      {/* 4. Volume State / Fill Index progress bar */}
                      <td className="py-3.5 px-3 min-w-[130px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1">
                            <div className="flex justify-between text-[10px] text-slate-500 mb-0.5 font-mono">
                              <span className="font-semibold text-slate-700">{v.currentVolume.toLocaleString()} L</span>
                              <span>{progress.toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-300 ${isOver95 ? 'bg-red-500' : 'bg-[#801323]'}`}
                                style={{ width: `${Math.min(100, progress)}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-400 block font-mono">/ {v.capacity.toLocaleString()} L</span>
                        </div>
                      </td>

                      {/* 5. Temperature Controls */}
                      <td className="py-3.5 px-3" onClick={e => e.stopPropagation()}>
                        {editingTempId === v.id ? (
                          <div className="flex items-center gap-1">
                            <input 
                              type="number" 
                              step="0.1"
                              value={tempInputValue}
                              onChange={(e) => setTempInputValue(parseFloat(e.target.value) || 0)}
                              className="w-14 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs"
                            />
                            <button 
                              onClick={() => handleSaveTemp(v.id)}
                              className="px-1.5 py-0.5 text-[9px] bg-green-600 hover:bg-green-700 text-white rounded cursor-pointer"
                            >
                              ✓
                            </button>
                            <button 
                              onClick={() => setEditingTempId(null)}
                              className="px-1.5 py-0.5 text-[9px] bg-slate-200 text-slate-600 rounded cursor-pointer"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-slate-700 flex items-center gap-1 font-mono">
                              <Thermometer className="w-3 h-3 text-slate-400" />
                              {v.temperature.toFixed(1)}°C
                            </span>
                            <button 
                              onClick={() => {
                                setEditingTempId(v.id);
                                setTempInputValue(v.temperature);
                              }}
                              className="p-1 text-slate-400 hover:text-[#4e0e15] cursor-pointer"
                              title="Set temperature value"
                            >
                              <Edit className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        )}
                      </td>

                      {/* 6. Stabilization active control toggle */}
                      <td className="py-3.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        <button 
                          onClick={() => handleToggleCooling(v.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] rounded-lg font-bold transition-all border cursor-pointer ${
                            v.coolingJacketActive 
                              ? 'bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd] animate-pulse' 
                              : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <Snowflake className={`w-2.5 h-2.5 ${v.coolingJacketActive ? 'text-[#0369a1] animate-spin' : 'text-slate-400'}`} /> 
                          {v.coolingJacketActive 
                            ? lText({ en: 'Active', ka: 'აქტიური', it: 'Attiva', fr: 'Active', de: 'Aktiv' }, 'Active')
                            : lText({ en: 'Hold', ka: 'გამორთული', it: 'Fermo', fr: 'Arrêt', de: 'Aus' }, 'Hold')
                          }
                        </button>
                      </td>

                      {/* 7. Hygiene cleaning logs */}
                      <td className="py-3.5 px-3">
                        {needsCleaning ? (
                          <span className="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 border border-amber-200 rounded text-[10px] whitespace-nowrap">
                            ⚠️ {lText({ en: 'Dirty', ka: 'სარეცხი', it: 'Da Lavare', fr: 'Sale', de: 'Schmutzig' }, 'Dirty')}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5 text-[10px] whitespace-nowrap">
                            <CheckCircle className="w-3 h-3 text-emerald-600" /> 
                            {lText({ en: 'Clean', ka: 'სუფთა', it: 'Pulito', fr: 'Propre', de: 'Sauber' }, 'Clean')}
                          </span>
                        )}
                      </td>

                      {/* 8. Extra action column */}
                      <td className="py-3.5 px-4 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {needsCleaning && (
                            <button
                              onClick={() => handleClean(v.id)}
                              className="px-2 py-1 bg-[#4e0e15] text-white hover:bg-[#6b151e] rounded text-[10px] font-bold inline-flex items-center gap-0.5 cursor-pointer"
                              title="Wash and sanitize unit"
                            >
                              <RotateCw className="w-2.5 h-2.5" />
                              Washing
                            </button>
                          )}
                          <button 
                            onClick={() => handleDeleteVessel(v.id)}
                            className="p-1 text-slate-300 hover:text-red-500 rounded cursor-pointer hover:bg-red-50"
                            title="Decommission vessel unit"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
