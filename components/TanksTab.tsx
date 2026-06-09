import { useState } from 'react';
import { translations, Language } from '@/lib/i18n';
import { Tank, WineLot } from '@/lib/services/db';
import { 
  Database, Plus, Thermometer, Wind, RefreshCw, 
  Trash, MessageSquare, ClipboardList, CheckCircle2 
} from 'lucide-react';

interface TanksTabProps {
  lang: Language;
  tanks: Tank[];
  lots: WineLot[];
  onAddTank: (tank: Omit<Tank, 'id'>) => void;
  onUpdateTank: (id: string, updated: Partial<Tank>) => void;
  onRecordCleaning: (eqId: string, eqType: 'tank') => void;
  onRecordTransferClick: (sourceId: string) => void;
}

export default function TanksTab({
  lang,
  tanks,
  lots,
  onAddTank,
  onUpdateTank,
  onRecordCleaning,
  onRecordTransferClick
}: TanksTabProps) {
  const t = translations[lang];

  // Forms and Modals State
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTank, setSelectedTank] = useState<Tank | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'capacity_desc' | 'capacity_asc' | 'temp_desc' | 'temp_asc' | 'status'>('name');

  const getSortedTanks = () => {
    const list = [...tanks];
    switch (sortBy) {
      case 'capacity_desc':
        return list.sort((a, b) => b.capacity - a.capacity);
      case 'capacity_asc':
        return list.sort((a, b) => a.capacity - b.capacity);
      case 'temp_desc':
        return list.sort((a, b) => b.currentTemp - a.currentTemp);
      case 'temp_asc':
        return list.sort((a, b) => a.currentTemp - b.currentTemp);
      case 'status':
        return list.sort((a, b) => {
          if (a.status !== b.status) {
            return a.status.localeCompare(b.status);
          }
          return a.name.localeCompare(b.name);
        });
      case 'name':
      default:
        return list.sort((a, b) => a.name.localeCompare(b.name));
    }
  };

  // New Tank Input Fields
  const [name, setName] = useState('');
  const [type, setType] = useState<'stainless_steel' | 'qvevri' | 'barrel' | 'plastic' | 'concrete' | 'other'>('stainless_steel');
  const [capacity, setCapacity] = useState<number>(5000);
  const [location, setLocation] = useState('East Wing Cellar');
  const [shape, setShape] = useState<'vertical' | 'horizontal' | 'conical' | 'variable_capacity' | 'qvevri' | 'barrel'>('vertical');
  const [coolingJacket, setCoolingJacket] = useState(true);
  const [tempControl, setTempControl] = useState(true);
  const [notes, setNotes] = useState('');

  // Inline inputs
  const [tempInput, setTempInput] = useState<string>('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || capacity <= 0) return;

    onAddTank({
      name,
      type,
      capacity,
      currentVolume: 0,
      location,
      shape,
      coolingJacket,
      tempControl,
      currentTemp: 15.0,
      status: 'empty',
      currentLotId: '',
      notes,
      lastCleaningDate: new Date().toISOString().split('T')[0],
      lastOperationDate: new Date().toISOString().split('T')[0]
    });

    // Reset fields
    setName('');
    setCapacity(5000);
    setNotes('');
    setShowAddForm(false);
  };

  const getLotNameAndCode = (lotId: string) => {
    if (!lotId) return { name: 'Empty / Vacant', code: '', type: '' };
    const lot = lots.find(l => l.id === lotId);
    return lot ? { name: lot.wineName, code: lot.code, type: lot.type } : { name: t.unknown, code: '', type: '' };
  };

  const getLiquidColor = (wineType: string) => {
    switch (wineType) {
      case 'red': return 'bg-gradient-to-t from-[#58111A] to-[#800020] text-white';
      case 'rose': return 'bg-gradient-to-t from-[#E5A4B4] to-[#F1B2C3] text-gray-800';
      case 'white': return 'bg-gradient-to-t from-[#EEDAA2] to-[#FDF4CD] text-gray-800';
      case 'amber': return 'bg-gradient-to-t from-[#C5832E] to-[#E6A15C] text-white';
      case 'sparkling': return 'bg-gradient-to-t from-[#F8EDB6] to-[#FAF8ED] text-gray-800 animate-pulse';
      default: return 'bg-stone-100 border border-stone-200 text-stone-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 pb-4 gap-4">
        <div>
          <h3 className="text-lg font-bold font-sans text-slate-800 flex items-center gap-2">
            <Database className="h-5 w-5 text-[#2d0a0a]" />
            {t.tanks}
          </h3>
          <p className="text-xs text-slate-400">Manage, fill, Rack/Transfer, clean and control cellar vessels</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium whitespace-nowrap">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-white border border-slate-200 rounded-sm px-2 py-1.2 text-xs text-slate-705 focus:outline-[#2d0a0a] font-sans"
            >
              <option value="name">Vessel Name</option>
              <option value="capacity_desc">Capacity: High to Low</option>
              <option value="capacity_asc">Capacity: Low to High</option>
              <option value="temp_desc">Temp: Warmest First</option>
              <option value="temp_asc">Temp: Coolest First</option>
              <option value="status">Vessel Status</option>
            </select>
          </div>
          <button 
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-[#2d0a0a] text-white px-3 py-1.5 rounded-sm text-xs font-semibold hover:bg-opacity-90 inline-flex items-center gap-1 cursor-pointer transition-all whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            {t.add_new}
          </button>
        </div>
      </div>

      {/* Add Tank Panel */}
      {showAddForm && (
        <form onSubmit={handleCreate} className="bg-slate-50 border border-slate-200 p-5 rounded-lg space-y-4 max-w-2xl">
          <h4 className="font-semibold text-slate-800 text-sm">Deploy New Cellar Vessel</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-mono text-slate-500 block mb-1">{t.tank_id} *</label>
              <input 
                type="text" 
                value={name} 
                onChange={e => setName(e.target.value)}
                placeholder="e.g. T-104 (SS)"
                className="w-full bg-white border border-slate-200 rounded-sm px-3 py-1.5 text-xs text-slate-700 focus:outline-hidden"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-500 block mb-1">{t.capacity} (Liters) *</label>
              <input 
                type="number" 
                value={capacity} 
                onChange={e => setCapacity(Number(e.target.value))}
                className="w-full bg-white border border-slate-200 rounded-sm px-3 py-1.5 text-xs text-slate-700 focus:outline-hidden"
                required
              />
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-500 block mb-1">{t.tank_type}</label>
              <select 
                value={type} 
                onChange={e => setType(e.target.value as any)}
                className="w-full bg-white border border-slate-200 rounded-sm px-3 py-1.5 text-xs text-slate-700 focus:outline-hidden"
              >
                <option value="stainless_steel">{t.stainless_steel}</option>
                <option value="qvevri">{t.qvevri}</option>
                <option value="barrel">{t.barrel}</option>
                <option value="concrete">{t.concrete}</option>
                <option value="plastic">{t.plastic}</option>
                <option value="other">{t.other}</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono text-gray-500 block mb-1">{t.vessel_shape}</label>
              <select 
                value={shape} 
                onChange={e => setShape(e.target.value as any)}
                className="w-full bg-white border border-slate-200 rounded-sm px-3 py-1.5 text-xs text-slate-700 focus:outline-hidden"
              >
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
                <option value="conical">Conical</option>
                <option value="variable_capacity">Variable Capacity</option>
                <option value="qvevri">Qvevri shape</option>
                <option value="barrel">Barrel oval</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-mono text-slate-500 block mb-1">Cellar Location</label>
              <input 
                type="text" 
                value={location} 
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Marani Soil, Room A"
                className="w-full bg-white border border-slate-200 rounded-sm px-3 py-1.5 text-xs text-slate-700"
              />
            </div>
            <div className="flex gap-4 items-center pt-5">
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input 
                  type="checkbox" 
                  checked={coolingJacket} 
                  onChange={e => setCoolingJacket(e.target.checked)}
                />
                Jacketed
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input 
                  type="checkbox" 
                  checked={tempControl} 
                  onChange={e => setTempControl(e.target.checked)}
                />
                Temp Regulated
              </label>
            </div>
          </div>
          <div>
            <label className="text-[11px] font-mono text-slate-500 block mb-1">Notes / Special Instructions</label>
            <textarea 
              value={notes} 
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-sm p-2.5 text-xs text-slate-700 h-16"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button 
              type="button" 
              onClick={() => setShowAddForm(false)} 
              className="border border-slate-200 px-3 py-1.5 rounded-sm text-xs"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="bg-[#2d0a0a] text-white px-4 py-1.5 rounded-sm text-xs font-semibold"
            >
              Deploy Vessel
            </button>
          </div>
        </form>
      )}

      {/* Grid of Vessels (Tanks & Qvevris) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {getSortedTanks().map((tank) => {
          const filledPct = Math.min(100, Math.round((tank.currentVolume / tank.capacity) * 100));
          const lotInfo = getLotNameAndCode(tank.currentLotId);
          const isFull = filledPct >= 95;

          return (
            <div 
              key={tank.id} 
              className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between overflow-hidden"
            >
              {/* Card Header */}
              <div className="p-4 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                <div>
                  <h4 className="font-sans font-bold text-slate-800 text-sm">{tank.name}</h4>
                  <span className="text-[10px] font-mono text-slate-400 capitalize">{tank.type.replace('_',' ')} • {tank.location}</span>
                </div>
                <span className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded-sm font-bold ${
                  tank.status === 'fermenting' ? 'bg-orange-100 text-orange-800' :
                  tank.status === 'cleaning' ? 'bg-blue-100 text-blue-800' :
                  tank.status === 'empty' ? 'bg-slate-100 text-slate-500' :
                  'bg-stone-100 text-stone-700'
                }`}>
                  {tank.status}
                </span>
              </div>

              {/* Tank Body & Dynamic Fill Level Graphic */}
              <div className="p-4 flex gap-4">
                {/* Visual Flask / Cylinder Bar */}
                <div className="w-16 h-40 bg-stone-100 border border-stone-200 rounded-lg relative overflow-hidden flex flex-col justify-end">
                  {/* Fluid segment */}
                  {tank.currentVolume > 0 ? (
                    <div 
                      style={{ height: `${filledPct}%` }}
                      className={`w-full transition-all duration-700 flex items-center justify-center text-[10px] font-mono font-bold select-none ${getLiquidColor(lotInfo.type)}`}
                    >
                      <span className="scale-75 origin-center">{filledPct}%</span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-gray-400">
                      Empty
                    </div>
                  )}
                  {/* Cooling indication */}
                  {tank.coolingJacket && (
                    <div className="absolute top-1 right-1 p-0.5 bg-blue-50 text-blue-600 rounded-xs shadow-xs">
                      <Wind className="h-2.5 w-2.5" />
                    </div>
                  )}
                </div>

                {/* Technical Parameters */}
                <div className="flex-1 space-y-2 text-xs">
                  <div>
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Content</span>
                    <span className="font-semibold text-slate-700 line-clamp-1">{lotInfo.name}</span>
                    {lotInfo.code && (
                      <span className="text-[9px] block font-mono bg-slate-100 px-1 py-0.2 w-fit rounded-xs mt-0.5 text-red-800 font-bold">
                        {lotInfo.code}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block">Volume</span>
                      <span className="font-bold text-slate-800">{tank.currentVolume.toLocaleString()} L</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block">Capacity</span>
                      <span className="font-bold text-slate-500">{tank.capacity.toLocaleString()} L</span>
                    </div>
                  </div>

                  {/* Temperature Module */}
                  {tank.tempControl && (
                    <div className="pt-1.5 flex items-center gap-1.5">
                      <Thermometer className="h-4 w-4 text-rose-600" />
                      <div className="flex-1 flex gap-1 items-center">
                        <span className="font-bold text-slate-800">{tank.currentTemp}°C</span>
                        <input 
                          type="number" 
                          placeholder="Set"
                          style={{ width: '40px' }}
                          className="border border-slate-200 rounded-sm text-[10px] px-1 focus:outline-hidden"
                          onBlur={(e) => {
                            if (e.target.value) {
                              onUpdateTank(tank.id, { currentTemp: Number(e.target.value) });
                              e.target.value = '';
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Clean records */}
                  <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-100 font-mono">
                    Cleaned: {tank.lastCleaningDate || 'Pending'}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="p-3 bg-slate-50 border-t border-slate-100 grid grid-cols-3 gap-1">
                <button 
                  disabled={tank.currentVolume <= 0}
                  onClick={() => onRecordTransferClick(tank.id)}
                  className={`py-1 rounded-sm text-[10px] font-semibold text-center uppercase cursor-pointer transition-all ${
                    tank.currentVolume > 0 
                      ? 'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100' 
                      : 'bg-slate-50 text-slate-300 pointer-events-none'
                  }`}
                >
                  Transfer/Rack
                </button>
                <button 
                  onClick={() => onRecordCleaning(tank.id, 'tank')}
                  className="bg-green-50 text-green-700 border border-green-100 hover:bg-green-100 py-1 rounded-sm text-[10px] font-semibold text-center uppercase cursor-pointer transition-all"
                >
                  Wash/Clean
                </button>
                <button 
                  onClick={() => setSelectedTank(tank)}
                  className="bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 py-1 rounded-sm text-[10px] font-semibold text-center uppercase cursor-pointer"
                >
                  Specs
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tank Specs Detailed Drawer Modal */}
      {(() => {
        const activeDetailedTank = selectedTank 
          ? tanks.find(t => t.id === selectedTank.id) || selectedTank 
          : null;
        if (!activeDetailedTank) return null;

        return (
          <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-xl">
              <div className="flex justify-between items-start border-b border-slate-250 pb-3">
                <div>
                  <h3 className="text-base font-bold text-slate-800">{activeDetailedTank.name} (Specifications)</h3>
                  <span className="text-xs text-slate-400">{activeDetailedTank.location}</span>
                </div>
                <button 
                  onClick={() => setSelectedTank(null)}
                  className="text-slate-400 hover:text-slate-700 text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1 bg-slate-50 p-2.5 rounded-sm border border-slate-100">
                  <span className="text-slate-400 block font-mono text-[9px] uppercase">Vessel Geometry</span>
                  <p className="font-semibold text-slate-705 capitalize">{activeDetailedTank.shape} configuration</p>
                </div>
                <div className="space-y-1 bg-slate-50 p-2.5 rounded-sm border border-slate-100">
                  <span className="text-slate-400 block font-mono text-[9px] uppercase">Cooling Jacket</span>
                  <p className="font-semibold text-slate-705">{activeDetailedTank.coolingJacket ? 'Yes' : 'No'}</p>
                </div>
                <div className="space-y-1 bg-slate-50 p-2.5 rounded-sm border border-slate-100">
                  <span className="text-slate-400 block font-mono text-[9px] uppercase">Last Sanitize Wash</span>
                  <p className="font-semibold text-slate-705">{activeDetailedTank.lastCleaningDate || 'Never'}</p>
                </div>
                <div className="space-y-1 bg-slate-50 p-2.5 rounded-sm border border-slate-100">
                  <span className="text-slate-400 block font-mono text-[9px] uppercase">Last Action Operator</span>
                  <p className="font-semibold text-slate-705">{activeDetailedTank.lastOperationDate || 'N/A'}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 bg-slate-50 p-3 rounded-sm border border-slate-200 text-center font-mono text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Current Temp</span>
                  <span className="font-bold text-rose-600 text-sm">{activeDetailedTank.tempControl ? `${activeDetailedTank.currentTemp}°C` : 'N/A'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Current Volume</span>
                  <span className="font-bold text-blue-600 text-sm">{activeDetailedTank.currentVolume.toLocaleString()} L</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Current Status</span>
                  <span className="font-bold text-amber-700 text-[10px] uppercase">{activeDetailedTank.status}</span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">Cellar Notes & Warnings</span>
                <p className="text-xs text-slate-650 bg-slate-50 p-3 rounded-sm border border-slate-200 italic">
                  {activeDetailedTank.notes || 'No custom winemaker notes logged for this vessel.'}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                {activeDetailedTank.status === 'empty' && (
                  <button 
                    disabled
                    className="bg-red-50 text-red-300 border border-red-50 px-3 py-1.5 rounded-sm text-xs"
                  >
                    Vessel Is Empty
                  </button>
                )}
                <button 
                  onClick={() => setSelectedTank(null)}
                  className="bg-[#2d0a0a] text-white px-4 py-1.5 rounded-sm text-xs cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
