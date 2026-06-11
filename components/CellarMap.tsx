'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Vessel, WineLot } from '../lib/wineryState';
import { Language, translations } from '../lib/i18n';
import { 
  Move, MapPin, Eye, Thermometer, ShieldAlert, Sparkles, HelpCircle 
} from 'lucide-react';

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

export default function CellarMap({
  lang,
  vessels,
  lots,
  onUpdateVessels,
  onSelectTank,
  selectedTankId,
  setActiveTab,
  setPrefilledSourceId,
  setPrefilledDestId
}: Props) {
  const t = translations[lang];

  // Visual layers: 'variety' | 'temperature' | 'sanitation'
  const [layer, setLayer] = useState<'variety' | 'temperature' | 'sanitation'>('variety');
  const [isEditingLayout, setIsEditingLayout] = useState(false);
  const [draggedVesselId, setDraggedVesselId] = useState<string | null>(null);
  const [hoveredVessel, setHoveredVessel] = useState<Vessel | null>(null);
  
  // Custom states for drag-and-drop transfer action
  const [activeTransferSource, setActiveTransferSource] = useState<Vessel | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [customDragPos, setCustomDragPos] = useState<{ x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Convert SVG coordinates
  const getSVGCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 800;
    const y = ((e.clientY - rect.top) / rect.height) * 500;
    return { x, y };
  };

  // Drag start
  const handleVesselMouseDown = (e: React.MouseEvent, vessel: Vessel) => {
    e.stopPropagation();
    const { x, y } = getSVGCoords(e as any);
    
    if (isEditingLayout) {
      // Repositioning drag
      setDraggedVesselId(vessel.id);
      const currentX = (vessel.xGrid ?? 50) * 8;
      const currentY = (vessel.yGrid ?? 50) * 5;
      setDragOffset({ x: x - currentX, y: y - currentY });
    } else if (vessel.currentVolume > 0) {
      // Transfer/Racking drag
      setActiveTransferSource(vessel);
      setCustomDragPos({ x, y });
    }
  };

  // Dragging
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const { x, y } = getSVGCoords(e);

    if (isEditingLayout && draggedVesselId) {
      const newX = Math.max(5, Math.min(95, (x - dragOffset.x) / 8));
      const newY = Math.max(5, Math.min(95, (y - dragOffset.y) / 5));

      const updated = vessels.map(v => {
        if (v.id === draggedVesselId) {
          return { ...v, xGrid: Math.round(newX), yGrid: Math.round(newY) };
        }
        return v;
      });
      onUpdateVessels(updated);
    } else if (activeTransferSource) {
      setCustomDragPos({ x, y });

      // Check proximity to other vessels for drag-over highlights
      let bestTarget: string | null = null;
      let minDistance = 50; // pixels target proximity threshold

      vessels.forEach(v => {
        if (v.id === activeTransferSource.id) return;
        const targetX = (v.xGrid ?? 50) * 8;
        const targetY = (v.yGrid ?? 50) * 5;
        const dist = Math.hypot(x - targetX, y - targetY);
        if (dist < minDistance) {
          minDistance = dist;
          bestTarget = v.id;
        }
      });
      setTransferTargetId(bestTarget);
    }
  };

  // Drag end
  const handleMouseUp = () => {
    if (isEditingLayout) {
      setDraggedVesselId(null);
    } else if (activeTransferSource) {
      if (transferTargetId && setActiveTab && setPrefilledSourceId && setPrefilledDestId) {
        // Trigger visual racking transfer action!
        setPrefilledSourceId(activeTransferSource.id);
        setPrefilledDestId(transferTargetId);
        setActiveTab('transfers');
      }
      setActiveTransferSource(null);
      setTransferTargetId(null);
      setCustomDragPos(null);
    }
  };

  // Color functions
  const getVarietyColor = (lotId: string | null) => {
    if (!lotId) return '#e2e8f0'; // empty/light slate
    const lot = lots.find(l => l.id === lotId);
    if (!lot) return '#e2e8f0';
    const variety = lot.variety.toLowerCase();
    if (variety.includes('saperavi')) return '#580815'; // Deep dark Saperavi red
    if (variety.includes('cabernet')) return '#801323'; // Burgundy Cabernet
    if (variety.includes('rkatsiteli')) return '#e2b13c'; // Amber gold Rkatsiteli
    if (variety.includes('mtsvane')) return '#a2c11c'; // Olive green Mtsvane
    if (lot.wineClass === 'white') return '#fef08a'; // pale yellow
    return '#801323'; // fallback red
  };

  const getTemperatureColor = (temp: number) => {
    // Under 15 is blue, 15-20 is grey-blue, above 20 is orange-red
    if (temp < 15) return '#0284c7';
    if (temp < 18) return '#38bdf8';
    if (temp < 21) return '#94a3b8';
    if (temp < 24) return '#f97316';
    return '#ef4444';
  };

  // Render SVG Icon based on type
  const renderVesselIcon = (v: Vessel) => {
    const isSelected = selectedTankId === v.id;
    const isDragSource = activeTransferSource?.id === v.id;
    const isDragTarget = transferTargetId === v.id;
    
    const fillPercent = v.capacity > 0 ? (v.currentVolume / v.capacity) * 100 : 0;

    // Dynamic layer styling
    let bodyColor = '#f8fafc';
    let strokeColor = isSelected ? '#801323' : '#cbd5e1';
    let strokeWidth = isSelected ? 3 : 1.5;
    let effectPulse = false;

    if (layer === 'temperature') {
      bodyColor = getTemperatureColor(v.temperature);
    } else if (layer === 'sanitation') {
      if (v.cleaningStatus === 'clean') {
        strokeColor = '#10b981'; // green clean
      } else if (v.cleaningStatus === 'dirty') {
        strokeColor = '#f59e0b'; // amber dirty
        effectPulse = true;
      } else {
        strokeColor = '#ef4444';
      }
    }

    if (isDragTarget) {
      strokeColor = '#10b981';
      strokeWidth = 4;
      effectPulse = true;
    }

    const commonProps = {
      onMouseDown: (e: React.MouseEvent) => handleVesselMouseDown(e, v),
      onMouseEnter: () => setHoveredVessel(v),
      onMouseLeave: () => setHoveredVessel(null),
      className: `cursor-grab active:cursor-grabbing transition-transform hover:scale-105 duration-155 ${effectPulse ? 'animate-pulse' : ''}`,
      style: { opacity: isDragSource ? 0.4 : 1 }
    };

    // Width/Height boundary bounding box inside SVG coordinates
    if (v.type === 'qvevri') {
      // Clay Amphora Shape
      return (
        <g {...commonProps}>
          {/* Shadow */}
          <ellipse cx="0" cy="28" rx="20" ry="6" fill="#000" fillOpacity="0.08" />
          {/* Main clay body */}
          <path 
            d="M -18,-15 C -18,-15 -25,5 -15,22 C -8,30 8,30 15,22 C 25,5 18,-15 18,-15 L 12,-20 L -12,-20 Z" 
            fill={layer === 'variety' ? '#c27d54' : bodyColor} 
            stroke={strokeColor} 
            strokeWidth={strokeWidth} 
          />
          {/* Neck collar */}
          <ellipse cx="0" cy="-18" rx="12" ry="4" fill="#a05d34" stroke={strokeColor} strokeWidth={strokeWidth} />
          {/* Liquid level layer overlay */}
          {v.currentVolume > 0 && layer === 'variety' && (
            <path 
              d={`M -15,10 C -15,10 -18,15 -10,21 C -5,25 5,25 10,21 C 18,15 15,10 15,10 Z`} 
              fill={getVarietyColor(v.assignedLotId)} 
            />
          )}
          {/* Temperature/alert icon overlay */}
          {v.temperature > 22 && (
            <circle cx="0" cy="5" r="4" fill="#ef4444" className="animate-ping" />
          )}
        </g>
      );
    } else if (v.type === 'barrel') {
      // Horizontal Oak Barrel Shape
      return (
        <g {...commonProps}>
          {/* Shadow */}
          <rect x="-22" y="16" width="44" height="6" rx="2" fill="#000" fillOpacity="0.08" />
          {/* Barrel body */}
          <path 
            d="M -20,-15 C -15,-18 15,-18 20,-15 C 24,-6 24,6 20,15 C 15,18 -15,18 -20,15 C -24,6 -24,-6 -20,-15 Z" 
            fill={layer === 'variety' ? '#8c6239' : bodyColor} 
            stroke={strokeColor} 
            strokeWidth={strokeWidth} 
          />
          {/* Iron hoops */}
          <path d="M -12,-17 C -9,-7 -9,7 -12,17" fill="none" stroke="#5a4028" strokeWidth="2" />
          <path d="M 12,-17 C 9,-7 9,7 12,17" fill="none" stroke="#5a4028" strokeWidth="2" />
          <circle cx="0" cy="0" r="3" fill="#5a4028" />
          {/* Liquid level */}
          {v.currentVolume > 0 && layer === 'variety' && (
            <path 
              d="M -16,5 C -10,8 10,8 16,5 C 18,10 14,14 0,14 C -14,14 -18,10 -16,5 Z" 
              fill={getVarietyColor(v.assignedLotId)} 
            />
          )}
        </g>
      );
    } else {
      // Stainless steel/Concrete cylinder
      const isConcrete = v.type === 'concrete';
      return (
        <g {...commonProps}>
          {/* Shadow */}
          <ellipse cx="0" cy="32" rx="22" ry="6" fill="#000" fillOpacity="0.08" />
          {/* Main cylinder */}
          {isConcrete ? (
            <rect x="-20" y="-30" width="40" height="60" rx="4" fill={layer === 'variety' ? '#cbd5e1' : bodyColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          ) : (
            <rect x="-18" y="-32" width="36" height="64" rx="10" fill={layer === 'variety' ? '#94a3b8' : bodyColor} stroke={strokeColor} strokeWidth={strokeWidth} />
          )}
          
          {/* Liquid level height rendering */}
          {v.currentVolume > 0 && (
            <rect 
              x={isConcrete ? "-18" : "-16"} 
              y={30 - (58 * fillPercent) / 100} 
              width={isConcrete ? "36" : "32"} 
              height={(58 * fillPercent) / 100} 
              rx="2"
              fill={layer === 'variety' ? getVarietyColor(v.assignedLotId) : 'rgba(255,255,255,0.15)'} 
            />
          )}

          {/* Cooling indicator */}
          {v.coolingJacketActive && (
            <rect x="-21" y="-10" width="42" height="20" fill="none" stroke="#0284c7" strokeWidth="1.5" className="animate-pulse" />
          )}
        </g>
      );
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Dynamic Controls Header Panel */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white/90 p-4 border border-[#e8dfd5] rounded-xl shadow-xs">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#801323]" />
          <h3 className="text-sm font-serif font-bold text-[#4e0e15]">
            {lang === 'ka' ? 'ინტერაქტიული მარნის რუკა' : 'Interactive Cellar Floor Map'}
          </h3>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-3">
          {/* Layer toggles */}
          <div className="bg-slate-100 p-0.5 rounded-lg flex items-center text-[10px] font-bold">
            <button 
              type="button"
              onClick={() => setLayer('variety')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                layer === 'variety' ? 'bg-white text-[#4e0e15] shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Eye className="w-3 h-3" />
              {lang === 'ka' ? 'ღვინის ჯიშები' : 'Variety Color'}
            </button>
            <button 
              type="button"
              onClick={() => setLayer('temperature')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                layer === 'temperature' ? 'bg-white text-[#4e0e15] shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Thermometer className="w-3 h-3" />
              {lang === 'ka' ? 'ტემპერატურა' : 'Temperature'}
            </button>
            <button 
              type="button"
              onClick={() => setLayer('sanitation')}
              className={`px-3 py-1.5 rounded-md flex items-center gap-1 cursor-pointer transition-colors ${
                layer === 'sanitation' ? 'bg-white text-[#4e0e15] shadow-2xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              {lang === 'ka' ? 'რეცხვა / ჰიგიენა' : 'Sanitation'}
            </button>
          </div>

          <span className="text-slate-200">|</span>

          {/* Layout editor toggle */}
          <button
            type="button"
            onClick={() => setIsEditingLayout(!isEditingLayout)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
              isEditingLayout 
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm' 
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Move className="w-3.5 h-3.5" />
            {isEditingLayout 
              ? (lang === 'ka' ? 'შენახვა' : 'Save Layout') 
              : (lang === 'ka' ? 'განლაგების შეცვლა' : 'Customize Layout')
            }
          </button>
        </div>
      </div>

      {/* Dynamic 2D floorplan SVG Area */}
      <div className="relative border border-[#e8dfd5] bg-stone-900 rounded-2xl overflow-hidden shadow-inner h-[500px] w-full">
        {/* Cellar labels */}
        <div className="absolute top-4 left-6 text-slate-500 font-mono text-[10px] uppercase tracking-widest font-extrabold select-none">
          {lang === 'ka' ? 'დუღილის ზონა (A)' : 'Fermentation Hall (A)'}
        </div>
        <div className="absolute bottom-6 left-6 text-slate-500 font-mono text-[10px] uppercase tracking-widest font-extrabold select-none">
          {lang === 'ka' ? 'ტექნოლოგიური ქვევრები' : 'Ancient Clay Qvevris'}
        </div>
        <div className="absolute top-4 right-8 text-slate-500 font-mono text-[10px] uppercase tracking-widest font-extrabold select-none">
          {lang === 'ka' ? 'მუხის კასრები' : 'Oak Barrel Aging Hall'}
        </div>

        {/* Visual guide line separations */}
        <div className="absolute top-0 bottom-0 left-[55%] border-l border-dashed border-stone-800/40 select-none pointer-events-none" />
        <div className="absolute left-0 right-[45%] top-[55%] border-t border-dashed border-stone-800/40 select-none pointer-events-none" />

        {/* Drag-to-Transfer helper prompt */}
        {!isEditingLayout && (
          <div className="absolute bottom-4 right-6 bg-stone-950/80 border border-stone-850 text-[10px] text-amber-200/80 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 font-mono pointer-events-none select-none max-w-xs leading-tight">
            <Sparkles className="w-3 h-3 text-[#c5a059] shrink-0 animate-bounce" />
            <span>
              {lang === 'ka' 
                ? 'გადაათრიეთ შევსებული ჭურჭელი ცარიელზე გადასაღებად.' 
                : 'Drag a filled vessel onto another to dispatch a transfer.'}
            </span>
          </div>
        )}

        <svg 
          ref={svgRef}
          viewBox="0 0 800 500" 
          className="w-full h-full select-none"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid background floor lines */}
          <defs>
            <pattern id="cellar-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" strokeWidth="0.5" strokeOpacity="0.04" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#cellar-grid)" />

          {/* Render layout paths/walls */}
          <path d="M 440,0 L 440,500" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeDasharray="6 6" />
          <path d="M 0,275 L 440,275" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeDasharray="6 6" />

          {/* Vessels nodes */}
          {vessels.map(v => {
            const x = (v.xGrid ?? 50) * 8;
            const y = (v.yGrid ?? 50) * 5;
            
            return (
              <g 
                key={v.id}
                transform={`translate(${x}, ${y})`}
              >
                {renderVesselIcon(v)}
                
                {/* Vessel Text ID tag */}
                <text 
                  y="47" 
                  textAnchor="middle" 
                  fill="#ffffff" 
                  fillOpacity="0.7" 
                  fontSize="9px" 
                  fontFamily="monospace"
                  fontWeight="bold"
                  className="pointer-events-none"
                >
                  {v.id}
                </text>
              </g>
            );
          })}

          {/* Transfer Drag-Line Overlay */}
          {activeTransferSource && customDragPos && (
            <g>
              <line 
                x1={(activeTransferSource.xGrid ?? 50) * 8} 
                y1={(activeTransferSource.yGrid ?? 50) * 5} 
                x2={customDragPos.x} 
                y2={customDragPos.y} 
                stroke="#10b981" 
                strokeWidth="2.5" 
                strokeDasharray="4 4" 
              />
              <circle cx={customDragPos.x} cy={customDragPos.y} r="6" fill="#10b981" />
            </g>
          )}
        </svg>

        {/* Hover Glassmorphic Tooltip Overlay */}
        {hoveredVessel && (() => {
          const v = hoveredVessel;
          const x = (v.xGrid ?? 50);
          const y = (v.yGrid ?? 50);
          
          const assignedLot = lots.find(l => l.id === v.assignedLotId);
          const progress = v.capacity > 0 ? (v.currentVolume / v.capacity) * 100 : 0;
          
          // Position tooltip relative to layout percentage
          const style: React.CSSProperties = {
            position: 'absolute',
            left: `${x > 75 ? x - 28 : x + 2}%`,
            top: `${y > 70 ? y - 35 : y + 2}%`,
          };

          return (
            <div 
              style={style}
              className="bg-stone-950/90 border border-stone-850 text-white px-3.5 py-2.5 rounded-xl shadow-xl w-60 z-30 font-sans backdrop-blur-md transition-all duration-150 animate-fade-in pointer-events-none"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-serif font-black text-xs text-amber-100">{v.id}</span>
                <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                  v.cleaningStatus === 'clean' ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-900' : 'bg-amber-950/70 text-amber-400 border border-amber-900'
                }`}>
                  {v.cleaningStatus}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono capitalize border-b border-stone-900 pb-1.5 mb-1.5">
                {v.type.replace('_', ' ')} • {v.locationDetails}
              </p>
              
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">{t.capacity || 'Capacity'}:</span>
                  <span className="font-bold font-mono">{v.capacity.toLocaleString()} L</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{t.volume || 'Volume'}:</span>
                  <span className="font-bold font-mono">{v.currentVolume.toLocaleString()} L ({progress.toFixed(0)}%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{t.temperature || 'Temperature'}:</span>
                  <span className="font-bold font-mono flex items-center gap-0.5 text-sky-400">
                    {v.temperature.toFixed(1)}°C
                  </span>
                </div>
                
                {assignedLot ? (
                  <div className="mt-2 pt-1.5 border-t border-stone-900">
                    <span className="text-[9px] uppercase font-mono tracking-wider text-[#c5a059] block mb-0.5">Assigned Lot:</span>
                    <span className="font-bold text-amber-50 text-[11px] block truncate">{assignedLot.name}</span>
                    <span className="text-[9px] font-mono text-slate-400 mt-0.5 inline-block">{assignedLot.variety} ({assignedLot.vintage})</span>
                  </div>
                ) : (
                  <div className="mt-2 pt-1.5 border-t border-stone-900 text-slate-400 italic text-[10px]">
                    No wine lot assigned
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
