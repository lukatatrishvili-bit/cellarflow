import React, { useState, useMemo, useEffect, useRef } from 'react';
import type { 
  VineyardBlock, 
  PhenologyRecord, 
  SprayRecord, 
  ScoutingRecord, 
  IrrigationRecord, 
  FertilizationRecord, 
  SoilAnalysisRecord, 
  GrapeSamplingRecord, 
  HarvestRecord,
  UserProfile
} from '../lib/wineryState';
import type { Language } from '../lib/i18n';
import WeatherTab from './WeatherTab';
import LocationPicker from './LocationPicker';
import IpmPhenoscheme from './IpmPhenoscheme';
import { useFocusTrap } from './useFocusTrap';
import { APIProvider, Map, useMap, Marker } from '@vis.gl/react-google-maps';

interface MapPolygonProps {
  paths: { lat: number; lng: number }[];
  fillColor?: string;
  strokeColor?: string;
  onClick?: () => void;
}

function MapPolygon({ paths, fillColor, strokeColor, onClick }: MapPolygonProps) {
  const map = useMap();
  const polygonRef = useRef<google.maps.Polygon | null>(null);

  useEffect(() => {
    if (!map) return;

    const polygon = new google.maps.Polygon({
      paths,
      fillColor: fillColor || '#10b981',
      fillOpacity: 0.45,
      strokeColor: strokeColor || '#047857',
      strokeOpacity: 0.8,
      strokeWeight: 2,
    });

    polygon.setMap(map);
    polygonRef.current = polygon;

    let clickListener: google.maps.MapsEventListener | null = null;
    if (onClick) {
      clickListener = polygon.addListener('click', onClick);
    }

    return () => {
      if (clickListener) {
        google.maps.event.removeListener(clickListener);
      }
      polygon.setMap(null);
    };
  }, [map, paths, fillColor, strokeColor, onClick]);

  return null;
}
import { DayWeather, fetchDayWeather, localISODate } from '../lib/weatherApi';
import { 
  Mountain, Wind, Droplet, Sun, Layers, Plus, 
  AlertTriangle, Check, Calendar, Thermometer, 
  Compass, FlaskConical, BarChart3, TrendingUp, 
  MapPin, HelpCircle, ArrowRight, User, Trash2,
  Sprout, FileText, CheckSquare, Info, ShieldAlert
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';

interface VaziModuleProps {
  lang: Language;
  currentUser: UserProfile;
  blocks: VineyardBlock[];
  phenologyLogs: PhenologyRecord[];
  sprays: SprayRecord[];
  scoutings: ScoutingRecord[];
  soilRecords: SoilAnalysisRecord[];
  samplings: GrapeSamplingRecord[];
  harvests: HarvestRecord[];
  irrigationLogs: IrrigationRecord[];
  fertilizerLogs: FertilizationRecord[];
  
  onAddBlock: (block: Omit<VineyardBlock, 'id'>) => void;
  onUpdateBlock: (id: string, updated: Partial<VineyardBlock>) => void;
  onAddPhenologyLog: (log: Omit<PhenologyRecord, 'id'>) => void;
  onAddSprayRecord: (rec: Omit<SprayRecord, 'id'>) => void;
  onAddScoutingRecord: (rec: Omit<ScoutingRecord, 'id'>) => void;
  onAddSamplings: (rec: Omit<GrapeSamplingRecord, 'id'>) => void;
  onAddHarvestRecord: (rec: Omit<HarvestRecord, 'id'>) => void;
  onUpdateHarvestRecord: (id: string, updated: Partial<HarvestRecord>) => void;
  onSendHarvestToGvino: (blockId: string, harvestedKg: number, variety: string, vintage: number, harvestedDate: string) => string; // Returns Gvino Lot ID
  onAddIrrigation: (rec: Omit<IrrigationRecord, 'id'>) => void;
  onAddFertilizer: (rec: Omit<FertilizationRecord, 'id'>) => void;
  setActiveModule?: (mod: 'portal' | 'vazi' | 'gvino' | 'settings' | 'audit') => void;
  setActiveTab?: (tab: string) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
}

export default function VaziModule({
  lang,
  currentUser,
  blocks,
  phenologyLogs,
  sprays,
  scoutings,
  soilRecords,
  samplings,
  harvests,
  irrigationLogs,
  fertilizerLogs,
  onAddBlock,
  onUpdateBlock,
  onAddPhenologyLog,
  onAddSprayRecord,
  onAddScoutingRecord,
  onAddSamplings,
  onAddHarvestRecord,
  onUpdateHarvestRecord,
  onSendHarvestToGvino,
  onAddIrrigation,
  onAddFertilizer,
  setActiveModule,
  setActiveTab,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc
}: VaziModuleProps) {
  const [vaziTab, setVaziTab] = useState<'dashboard' | 'blocks' | 'tasks' | 'spraying' | 'scouting' | 'sampling' | 'yield' | 'weather' | 'ipm_pheno'>('dashboard');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  
  const [mapOverlay, setMapOverlay] = useState<'mildew' | 'moisture' | 'phenology'>('mildew');
  const [mapHoveredBlock, setMapHoveredBlock] = useState<string | null>(null);

  const getBlockColor = (blockId: string) => {
    const b = blocks.find(x => x.id === blockId);
    if (!b) return '#e2e8f0';
    const name = b.name.toLowerCase();
    
    if (mapOverlay === 'mildew') {
      if (name.includes('ridge') || blockId === 'block-1') return '#eab308'; // Moderate (Yellow)
      if (name.includes('kondoli') || blockId === 'block-2') return '#10b981'; // Low (Green)
      if (name.includes('mukuzani') || blockId === 'block-3') return '#ef4444'; // High (Red)
      return '#10b981';
    }
    if (mapOverlay === 'moisture') {
      if (name.includes('ridge') || blockId === 'block-1') return '#ef4444'; // Dry (Red)
      if (name.includes('kondoli') || blockId === 'block-2') return '#10b981'; // Optimum (Green)
      if (name.includes('mukuzani') || blockId === 'block-3') return '#3b82f6'; // Wet (Blue)
      return '#10b981';
    }
    if (mapOverlay === 'phenology') {
      if (b.currentPhenology.toLowerCase().includes('veraison')) return '#8b5cf6'; // Veraison (Purple)
      if (b.currentPhenology.toLowerCase().includes('ripening')) return '#f43f5e'; // Ripening (Rose)
      if (b.currentPhenology.toLowerCase().includes('fruit set')) return '#10b981'; // Fruit Set (Green)
      return '#6ee7b7'; // Default / Flowering
    }
    return '#cbd5e1';
  };

  // Adding state
  const [showAddBlockModal, setShowAddBlockModal] = useState(false);
  const addBlockDialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(addBlockDialogRef, { active: showAddBlockModal, onClose: () => setShowAddBlockModal(false) });
  const [addBlockLat, setAddBlockLat] = useState<number>(41.9567);
  const [addBlockLng, setAddBlockLng] = useState<number>(45.4851);
  const [addBlockLocName, setAddBlockLocName] = useState<string>('Kakheti, Georgia');
  const [addBlockElev, setAddBlockElev] = useState<number>(350);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  // Real-map polygon (add-block form): geographic boundary saved to the block.
  const [drawnPoints, setDrawnPoints] = useState<{ lat: number; lng: number }[]>([]);
  // Legacy block-detail "satellite simulation": pixel-space sketch only (visual).
  const [drawnPixels, setDrawnPixels] = useState<{ x: number; y: number }[]>([]);

  const defaultCenter = useMemo(() => {
    if (blocks && blocks.length > 0) {
      const validBlocks = blocks.filter(b => typeof b.latitude === 'number' && typeof b.longitude === 'number');
      if (validBlocks.length > 0) {
        const sumLat = validBlocks.reduce((sum, b) => sum + b.latitude, 0);
        const sumLng = validBlocks.reduce((sum, b) => sum + b.longitude, 0);
        return { lat: sumLat / validBlocks.length, lng: sumLng / validBlocks.length };
      }
    }
    return { lat: 41.9056, lng: 45.474 };
  }, [blocks]);

  const getBlockPaths = (b: VineyardBlock) => {
    if (b.boundary && b.boundary.length > 2) {
      return b.boundary;
    }
    const latOffset = 0.0003;
    const lngOffset = 0.0004;
    return [
      { lat: b.latitude - latOffset, lng: b.longitude - lngOffset },
      { lat: b.latitude + latOffset, lng: b.longitude - lngOffset },
      { lat: b.latitude + latOffset, lng: b.longitude + lngOffset },
      { lat: b.latitude - latOffset, lng: b.longitude + lngOffset },
    ];
  };

  // Multilingual translations lookups
  const label = {
    title: {
      en: 'Vazi — Vineyard Management',
      ka: 'ვაზი — ვენახების მართვა',
      it: 'Vazi — Gestione del Vigneto',
      fr: 'Vazi — Viticulture & Vignoble',
      de: 'Vazi — Weinberg-Management'
    }[lang] || 'Vazi — Vineyard Management',
    tagline: {
      en: 'Pristine canopy health & fruit quality tracking from rows',
      ka: 'სიჯანსაღე და ხარისხი ვენახის რიგებიდან',
      it: 'Tracciamento della salute della chioma e della qualità dei frutti dai filari',
      fr: 'Suivi de la santé du feuillage et de la qualité des fruits des rangs',
      de: 'Ertrags- und Laubwerküberwachung direkt aus den Rebzeilen'
    }[lang] || 'Pristine canopy health & fruit quality tracking from rows',
    allBlocks: {
      en: 'All Vineyard Blocks',
      ka: 'ყველა ვენახის ნაკვეთი',
      it: 'Tutti i Lotti di Vigneto',
      fr: 'Toutes les Parcelles',
      de: 'Alle Weinbergsparzellen'
    }[lang] || 'All Vineyard Blocks',
    area: {
      en: 'Area (Hectares)',
      ka: 'ფართობი (ჰა)',
      it: 'Superficie (Ettari)',
      fr: 'Superficie (Hectares)',
      de: 'Fläche (Hektar)'
    }[lang] || 'Area (Hectares)',
    elevation: {
      en: 'Elevation',
      ka: 'სიმაღლე ზღ.დ.',
      it: 'Altitudine',
      fr: 'Altitude',
      de: 'Höhe'
    }[lang] || 'Elevation',
    grapeVariety: {
      en: 'Grape Variety',
      ka: 'ყურძნის ჯიში',
      it: 'Vitigno',
      fr: 'Cépage',
      de: 'Rebsorte'
    }[lang] || 'Grape Variety',
    phenology: {
      en: 'Phenological Stage',
      ka: 'ფენოლოგიური ფაზა',
      it: 'Fase Fenologica',
      fr: 'Stade Phénologique',
      de: 'Phänologisches Stadium'
    }[lang] || 'Phenological Stage',
    harvestEst: {
      en: 'Est. Harvest Date',
      ka: 'მოსავლის თარიღი',
      it: 'Data di Vendemmia Prevista',
      fr: 'Date de Récolte Estimée',
      de: 'Voraussichtliche Ernte'
    }[lang] || 'Est. Harvest Date',
    addBlock: {
      en: 'Add Vineyard Block',
      ka: 'ახალი ნაკვეთის დამატება',
      it: 'Aggiungi Lotto Vigneto',
      fr: 'Ajouter une Parcelle',
      de: 'Weinbergsparzelle hinzufügen'
    }[lang] || 'Add Vineyard Block',
    blockName: {
      en: 'Block Name / Code',
      ka: 'ნაკვეთის დასახელება',
      it: 'Nome / Codice Lotto',
      fr: 'Nom / Code de Parcelle',
      de: 'Name / Vorgabe'
    }[lang] || 'Block Name / Code',
    coordinates: {
      en: 'Coordinates',
      ka: 'კოორდინატები',
      it: 'Coordinate',
      fr: 'Coordonnées',
      de: 'Koordinaten'
    }[lang] || 'Coordinates',
    soilType: {
      en: 'Soil Type',
      ka: 'ნიადაგის ტიპი',
      it: 'Tipo di Suolo',
      fr: 'Type de Sol',
      de: 'Bodentyp'
    }[lang] || 'Soil Type',
    vinesCount: {
      en: 'Number of Vines',
      ka: 'ვაზის რაოდენობა',
      it: 'Numero di Viti',
      fr: 'Nombre de Vignes',
      de: 'Rebenanzahl'
    }[lang] || 'Number of Vines',
    irrigation: {
      en: 'Irrigation',
      ka: 'მორწყვა',
      it: 'Irrigazione',
      fr: 'Irrigation',
      de: 'Bewässerung'
    }[lang] || 'Irrigation',
    yes: {
      en: 'Yes',
      ka: 'დიახ',
      it: 'Sì',
      fr: 'Oui',
      de: 'Ja'
    }[lang] || 'Yes',
    no: {
      en: 'No',
      ka: 'არა',
      it: 'No',
      fr: 'Non',
      de: 'Nein'
    }[lang] || 'No'
  };

  // Find selected block
  const selectedBlock = useMemo(() => {
    return blocks.find(b => b.id === selectedBlockId) || null;
  }, [blocks, selectedBlockId]);

  // Block Edit States
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [editBlockName, setEditBlockName] = useState('');
  const [editVineyardName, setEditVineyardName] = useState('');
  const [editLocationName, setEditLocationName] = useState('');
  const [editArea, setEditArea] = useState(1.0);
  const [editElevation, setEditElevation] = useState(350);
  const [editSlope, setEditSlope] = useState('');
  const [editAspect, setEditAspect] = useState('');
  const [editSoilType, setEditSoilType] = useState('');
  const [editGrapeVariety, setEditGrapeVariety] = useState('');
  const [editPlantingYear, setEditPlantingYear] = useState(2018);
  const [editSpacing, setEditSpacing] = useState('');
  const [editRowsCount, setEditRowsCount] = useState(0);
  const [editVinesCount, setEditVinesCount] = useState(0);
  const [editTrainingSystem, setEditTrainingSystem] = useState('');
  const [editIrrigationEnabled, setEditIrrigationEnabled] = useState(false);
  const [editFarmingStatus, setEditFarmingStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    if (selectedBlock) {
      setEditBlockName(selectedBlock.name);
      setEditVineyardName(selectedBlock.vineyardName);
      setEditLocationName(selectedBlock.locationName);
      setEditArea(selectedBlock.area);
      setEditElevation(selectedBlock.elevation);
      setEditSlope(selectedBlock.slope);
      setEditAspect(selectedBlock.aspect);
      setEditSoilType(selectedBlock.soilType);
      setEditGrapeVariety(selectedBlock.grapeVariety);
      setEditPlantingYear(selectedBlock.plantingYear);
      setEditSpacing(selectedBlock.spacing);
      setEditRowsCount(selectedBlock.rowsCount);
      setEditVinesCount(selectedBlock.vinesCount);
      setEditTrainingSystem(selectedBlock.trainingSystem);
      setEditIrrigationEnabled(selectedBlock.irrigationEnabled);
      setEditFarmingStatus(selectedBlock.farmingStatus);
      setEditNotes(selectedBlock.notes || '');
      setIsEditingBlock(false);
    }
  }, [selectedBlockId, selectedBlock]);

  const handleSaveBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBlock) return;
    onUpdateBlock(selectedBlock.id, {
      name: editBlockName,
      vineyardName: editVineyardName,
      locationName: editLocationName,
      area: Number(editArea) || 0,
      elevation: Number(editElevation) || 0,
      slope: editSlope,
      aspect: editAspect,
      soilType: editSoilType,
      grapeVariety: editGrapeVariety,
      plantingYear: Number(editPlantingYear) || 2018,
      spacing: editSpacing,
      rowsCount: Number(editRowsCount) || 0,
      vinesCount: Number(editVinesCount) || 0,
      trainingSystem: editTrainingSystem,
      irrigationEnabled: editIrrigationEnabled,
      farmingStatus: editFarmingStatus as VineyardBlock['farmingStatus'],
      notes: editNotes
    });
    setIsEditingBlock(false);
  };

  // Compute stats
  const totalArea = useMemo(() => blocks.reduce((acc, b) => acc + b.area, 0), [blocks]);
  const totalVines = useMemo(() => blocks.reduce((acc, b) => acc + b.vinesCount, 0), [blocks]);
  
  const [blockWeatherData, setBlockWeatherData] = useState<DayWeather | null>(null);
  const [blockWeatherError, setBlockWeatherError] = useState('');

  useEffect(() => {
    if (!selectedBlock) {
      setBlockWeatherData(null);
      setBlockWeatherError('');
      return;
    }

    let active = true;
    setBlockWeatherError('');
    fetchDayWeather(selectedBlock.latitude, selectedBlock.longitude, localISODate())
      .then((result) => {
        if (active) setBlockWeatherData(result);
      })
      .catch((error) => {
        if (active) {
          setBlockWeatherData(null);
          setBlockWeatherError(error instanceof Error ? error.message : 'Live weather is unavailable.');
        }
      });

    return () => {
      active = false;
    };
  }, [selectedBlock?.id, selectedBlock?.latitude, selectedBlock?.longitude]);

  const blockWeather = useMemo(() => {
    if (!blockWeatherData) return null;
    const temp = blockWeatherData.current?.temp
      ?? (blockWeatherData.daily.tempMax + blockWeatherData.daily.tempMin) / 2;
    const wind = blockWeatherData.current?.wind ?? blockWeatherData.daily.windMax;
    const humidity = blockWeatherData.current?.humidity ?? 0;
    const rainMm = blockWeatherData.daily.precipSum;

    return {
      temp: Math.round(temp),
      rainMm,
      wind: Math.round(wind),
      humidity,
      frostRisk: blockWeatherData.daily.tempMin < 2 ? 'High' : blockWeatherData.daily.tempMin < 5 ? 'Medium' : 'None',
      heatStress: blockWeatherData.daily.tempMax > 35 ? 'Severe' : blockWeatherData.daily.tempMax > 30 ? 'Moderate' : 'Optimum',
      sprayConditions: wind > 14 ? 'Unsafe (High Wind)' : rainMm > 0 ? 'Unsafe (Rain)' : 'Suitable',
      diseasePressure: humidity > 75 && temp > 18 && rainMm > 0 ? 'High (Downy Mildew Risk)' : 'Low'
    };
  }, [blockWeatherData]);

  // GDD is a recorded agronomic value, not a synthetic estimate.
  const computedGDD = useMemo(() => {
    if (!selectedBlock) return 0;
    const latest = phenologyLogs
      .filter((record) => record.blockId === selectedBlock.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest?.gdd ?? 0;
  }, [selectedBlock, phenologyLogs]);

  return (
    <div id="vazi-sandbox" className="space-y-6 text-stone-800 animate-fade-in font-sans">
      
      {/* Module Title bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-emerald-950/95 text-white p-5 rounded-2xl border border-emerald-900 shadow-md gap-4">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-widest bg-emerald-800 text-emerald-100 px-2.5 py-1 rounded-full font-bold">VINEA VAZI MODULE</span>
          <h2 className="text-2xl font-serif font-black flex items-center gap-2 mt-2">
            <Sprout className="h-6 w-6 text-emerald-400 animate-pulse" />
            {label.title}
          </h2>
          <p className="text-xs text-emerald-250/90 mt-1 font-medium">{label.tagline}</p>
        </div>
        
        {/* Unit & Area Stats Badge */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="px-3.5 py-2 bg-emerald-900/50 rounded-xl border border-emerald-850 text-center">
            <span className="text-[9px] uppercase font-mono text-emerald-300 font-bold block">Total Vineyard Area</span>
            <span className="text-lg font-serif font-black text-amber-300 block mt-0.5">{totalArea.toFixed(1)} ha</span>
          </div>
          <div className="px-3.5 py-2 bg-emerald-900/50 rounded-xl border border-emerald-850 text-center">
            <span className="text-[9px] uppercase font-mono text-emerald-300 font-bold block">Active Vines</span>
            <span className="text-lg font-serif font-bold text-emerald-200 block mt-0.5">{totalVines.toLocaleString()} vines</span>
          </div>
        </div>
      </div>

      {/* Mini Vazi Sub-Navigation bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#e8dfd5] pb-2 text-xs">
        {[
          {
            id: 'dashboard',
            label: {
              en: 'Viticulture Dashboard',
              ka: 'პორტალი',
              it: 'Dashboard Viticoltura',
              fr: 'Tableau de Viticulture',
              de: 'Weinbau-Übersicht'
            }[lang] || 'Viticulture Dashboard',
            icon: BarChart3
          },
          {
            id: 'blocks',
            label: {
              en: 'Vineyard Blocks',
              ka: 'ნაკვეთები',
              it: 'Parcelle Vigneto',
              fr: 'Parcelles',
              de: 'Weinbergsparzellen'
            }[lang] || 'Vineyard Blocks',
            icon: Layers
          },
          {
            id: 'spraying',
            label: {
              en: 'Spraying Logs',
              ka: 'წამლობა',
              it: 'Registro Trattamenti',
              fr: 'Traitements',
              de: 'Spritztagebuch'
            }[lang] || 'Spraying Logs',
            icon: Wind
          },
          {
            id: 'scouting',
            label: {
              en: 'Disease Scouting',
              ka: 'მავნებლები',
              it: 'Monitoraggio Patologie',
              fr: 'Suivi Maladies',
              de: 'Schädlingsbeobachtung'
            }[lang] || 'Disease Scouting',
            icon: ShieldAlert
          },
          {
            id: 'ipm_pheno',
            label: {
              en: 'IPM Phenoscheme',
              ka: 'ინტეგრირებული დაცვა',
              it: 'IPM Phenoscheme',
              fr: 'IPM Phenoscheme',
              de: 'IPM Phenoscheme'
            }[lang] || 'IPM Phenoscheme',
            icon: Sprout
          },
          {
            id: 'sampling',
            label: {
              en: 'Fruit Sampling Check',
              ka: 'ნიმუშები',
              it: 'Campionamento Uva',
              fr: 'Échantillonnage',
              de: 'Traubenreife-Kontrolle'
            }[lang] || 'Fruit Sampling Check',
            icon: FlaskConical
          },
          {
            id: 'yield',
            label: {
              en: 'Yield & Harvest Planner',
              ka: 'კალკულატორი',
              it: 'Pianificazione Resa',
              fr: 'Rendement & Récolte',
              de: 'Ernteplaner'
            }[lang] || 'Yield & Harvest Planner',
            icon: TrendingUp
          },
          {
            id: 'weather',
            label: {
              en: 'Agro-Weather Station',
              ka: 'მეტეო სადგური',
              it: 'Stazione Meteo',
              fr: 'Station Météo',
              de: 'Agrar-Wetter'
            }[lang] || 'Agro-Weather Station',
            icon: Sun
          }
        ].map(tb => {
          const Icon = tb.icon;
          const isActive = vaziTab === tb.id;
          return (
            <button
              key={tb.id}
              onClick={() => {
                setVaziTab(tb.id as any);
                if (tb.id !== 'blocks' && tb.id !== 'dashboard') {
                  // auto select first block if none selected
                  if (!selectedBlockId && blocks.length > 0) {
                    setSelectedBlockId(blocks[0].id);
                  }
                }
              }}
              className={`px-3.5 py-2.5 rounded-xl font-bold flex items-center gap-2 cursor-pointer transition-all duration-150 text-xs ${
                isActive 
                  ? 'bg-[#1e2f23] text-stone-100 shadow-xs border border-[#1e2f23]' 
                  : 'text-[#615c57] hover:text-[#1b1715] hover:bg-stone-100 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tb.label}
            </button>
          );
        })}
      </div>

      {/* ==========================================
          TAB 1: PORTAL DASHBOARD
          ========================================== */}
      {vaziTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Quick Info Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Quick Summary list of Blocks */}
            <div className="lg:col-span-1 bg-white border border-[#e8dfd5] rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="font-serif font-bold text-sm text-emerald-950 border-b border-stone-100 pb-2">
                {{
                  en: 'Canopy Status Radar',
                  ka: 'კანოპის მონიტორინგი',
                  it: 'Radar dello Stato della Chioma',
                  fr: 'Surveillance de la Canopée',
                  de: 'Laubwand-Statusradar'
                }[lang] || 'Canopy Status Radar'}
              </h3>
              <div className="space-y-3.5">
                {blocks.map(b => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setSelectedBlockId(b.id);
                      setVaziTab('blocks');
                    }}
                    className="w-full text-left p-3 hover:bg-emerald-50/40 rounded-xl border border-stone-100 hover:border-emerald-200 transition-all flex justify-between items-center group cursor-pointer"
                  >
                    <div>
                      <strong className="text-xs font-serif font-bold text-[#4e0e15] group-hover:text-emerald-900 duration-100">{b.name}</strong>
                      <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">{b.area} ha • {b.grapeVariety}</span>
                    </div>
                    <span className="text-[10px] font-bold bg-amber-50 text-amber-700 font-mono px-2 py-0.5 rounded border border-amber-100 font-semibold">{b.currentPhenology}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* GIS block map & Weather Station Forecast */}
            <div className="lg:col-span-2 bg-white border border-[#e8dfd5] rounded-2xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-stone-150 pb-2.5 gap-2">
                <div>
                  <h3 className="text-sm font-serif font-black text-emerald-950 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    {lang === 'ka' ? 'ვენახის ინტერაქტიული რუკა და მიკროკლიმატი' : 'Interactive Estate Block Map & Microclimate'}
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {lang === 'ka' ? 'აგრონომიული რუკის ფენები და კავშირი საველე მეტეო სადგურებთან' : 'Interactive block layers & real-time field weather parameters'}
                  </p>
                </div>

                {/* Overlay layer control button group */}
                <div className="flex gap-1 bg-stone-50 border border-stone-200 p-0.5 rounded-lg text-[10px]">
                  {[
                    { id: 'mildew', label: lang === 'ka' ? 'ჭრაქი (IPM)' : 'Mildew Risk' },
                    { id: 'moisture', label: lang === 'ka' ? 'ტენიანობა' : 'Soil Moisture' },
                    { id: 'phenology', label: lang === 'ka' ? 'ფენოლოგია' : 'Phenology' }
                  ].map(layer => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setMapOverlay(layer.id as any)}
                      className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                        mapOverlay === layer.id 
                          ? 'bg-[#1e2f23] text-stone-100 shadow-2xs' 
                          : 'text-stone-650 hover:bg-stone-200/50'
                      }`}
                    >
                      {layer.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
                {/* Google Map Column */}
                <div className="md:col-span-5 bg-stone-50 border border-[#e8dfd5] rounded-xl p-3 flex flex-col justify-between relative overflow-hidden h-60">
                  <div className="text-[9px] font-mono font-bold text-emerald-800 uppercase tracking-widest flex items-center gap-1">
                    🛰️ {lang === 'ka' ? 'ვენახის სატელიტური რუკა' : 'Estate GIS Map'}
                  </div>

                  <div className="w-full h-40 mt-2 rounded-lg overflow-hidden border border-stone-200 relative z-0">
                    <APIProvider apiKey={process.env.GOOGLE_MAPS_PLATFORM_KEY || ''}>
                      <Map
                        defaultCenter={defaultCenter}
                        defaultZoom={14}
                        mapTypeId="hybrid"
                        gestureHandling="greedy"
                        disableDefaultUI={true}
                      >
                        {blocks.map((b) => {
                          const paths = getBlockPaths(b);
                          const isActive = b.id === selectedBlockId;
                          const fillColor = getBlockColor(b.id);
                          return (
                            <MapPolygon
                              key={b.id}
                              paths={paths}
                              fillColor={fillColor}
                              strokeColor={isActive ? '#4e0e15' : '#78716c'}
                              onClick={() => setSelectedBlockId(b.id)}
                            />
                          );
                        })}
                      </Map>
                    </APIProvider>
                  </div>

                  {/* Micro legend */}
                  <div className="flex items-center gap-3 text-[9px] font-mono text-stone-500 border-t border-stone-200/60 pt-1.5 mt-1 shrink-0">
                    <span className="font-bold uppercase tracking-wider">{lang === 'ka' ? 'ლეგენდა:' : 'Legend:'}</span>
                    {mapOverlay === 'mildew' && (
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Low</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />Mod</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />High</span>
                      </div>
                    )}
                    {mapOverlay === 'moisture' && (
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Dry</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Opt</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Wet</span>
                      </div>
                    )}
                    {mapOverlay === 'phenology' && (
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />Ver</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />Rip</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Set</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Weather Station Forecast Column */}
                <div className="md:col-span-7 bg-stone-50/70 border border-[#e8dfd5] rounded-xl p-4 shadow-inner flex flex-col justify-between h-60">
                  {(() => {
                    const block = blocks.find(x => x.id === selectedBlockId) || blocks[0];
                    if (!block) return null;

                    if (!blockWeather) {
                      return (
                        <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-stone-500">
                          <AlertTriangle className="w-6 h-6 text-amber-600" />
                          <strong className="text-xs text-stone-800">Live weather unavailable</strong>
                          <span className="text-[10px] max-w-sm">
                            {blockWeatherError || 'No simulated readings are shown. Check the connection and block coordinates.'}
                          </span>
                        </div>
                      );
                    }

                    const { temp, rainMm, wind, humidity, diseasePressure } = blockWeather;

                    return (
                      <div className="flex flex-col justify-between h-full space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <strong className="text-xs font-serif font-black text-emerald-950 block">{block.name} Forecast</strong>
                            <span className="text-[9px] text-stone-500 font-mono">GPS: {block.latitude.toFixed(3)}, {block.longitude.toFixed(3)} • Recorded GDD: {computedGDD}</span>
                          </div>
                          <span className="text-[9px] font-mono font-bold bg-sky-50 text-sky-800 px-2 py-0.5 rounded border border-sky-200">
                            {lang === 'ka' ? 'ცოცხალი ამინდი' : 'OPEN-METEO LIVE'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-stone-850">
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">Temperature</span>
                            <strong className="text-sm font-black mt-0.5 block">{temp}°C</strong>
                          </div>
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">Rain Today</span>
                            <strong className="text-sm font-black mt-0.5 block">{rainMm} mm</strong>
                          </div>
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">Wind Max</span>
                            <strong className="text-sm font-black mt-0.5 block">{wind} km/h</strong>
                          </div>
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">Humidity</span>
                            <strong className="text-sm font-black mt-0.5 block">{humidity}%</strong>
                          </div>
                        </div>

                        {/* Disease Pressure Warning */}
                        <div className="p-2.5 bg-amber-50/75 border border-amber-200 text-amber-900 rounded-lg flex items-start gap-2 text-[10px] leading-snug">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold block text-[10px] leading-none mb-0.5">Agro-Alert: {block.grapeVariety} block</span>
                            {diseasePressure.includes('High') || humidity > 70
                              ? `Pathogen pressure is high! Foliar humidity is at ${humidity}%, offering mildew propagation vectors. Spray recommended.`
                              : `Canopy conditions optimal. Heat indices are moderate. Soil moisture stands at ${block.id === 'block-1' ? '18%' : '28%'}. Drip line calibrated.`
                            }
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

          </div>

          {/* Vineyard Activities Card log */}
          <div className="bg-white border border-[#e8dfd5] rounded-2xl p-5 shadow-xs space-y-4">
            <h3 className="font-serif font-bold text-sm text-emerald-950">
              {{
                en: 'Latest Field Management Logs',
                ka: 'საველე სამუშაოების ბოლო ლოგები',
                it: 'Ultimi Registri di Gestione in Campo',
                fr: 'Derniers Rapports de Gestion de Terrain',
                de: 'Aktuelle Weinberg-Aktivitäten'
              }[lang] || 'Latest Field Management Logs'}
            </h3>
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-left text-xs text-stone-600 font-sans border-collapse">
                <thead>
                  <tr className="border-b border-stone-100 text-[9px] font-mono uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2">
                      {{ en: 'Date', ka: 'თარიღი', it: 'Data', fr: 'Date', de: 'Datum' }[lang] || 'Date'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Block', ka: 'ნაკვეთი', it: 'Lotto', fr: 'Parcelle', de: 'Parzelle' }[lang] || 'Block'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Operational Activity', ka: 'ოპერაციული აქტივობა', it: 'Attività Operativa', fr: 'Activité Opérationnelle', de: 'Arbeitsgang' }[lang] || 'Operational Activity'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Operator / Manager', ka: 'ოპერატორი', it: 'Operatore', fr: 'Opérateur', de: 'Bediener' }[lang] || 'Operator / Manager'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Details & Chemical Safety Notes', ka: 'დეტალები და უსაფრთხოების შენიშვნები', it: 'Dettagli e Note di Sicurezza Chimica', fr: 'Détails & Notes de Sécurité Chimique', de: 'Details & Pflanzenschutzhinweise' }[lang] || 'Details & Chemical Safety Notes'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 font-medium">
                  {sprays.map(sp => (
                    <tr key={sp.id}>
                      <td className="py-2.5 font-mono">{sp.date}</td>
                      <td className="py-2.5 font-serif font-bold text-[#4e0e15]">{blocks.find(b => b.id === sp.blockId)?.name || sp.blockId}</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold border border-emerald-100">
                          {{ en: 'Spraying: ', ka: 'წამლობა: ', it: 'Trattamento: ', fr: 'Traitement: ', de: 'Spritzen: ' }[lang] || 'Spraying: '}
                          {sp.targetProblem}
                        </span>
                      </td>
                      <td className="py-2.5 font-mono">{sp.operator}</td>
                      <td className="py-2.5 text-[11px] text-stone-500">
                        {sp.productName} ({sp.dosePerHa} kg/ha) • {{ en: 'Pre-Harvest Interval (PHI):', ka: 'მოსავლის აღების უსაფრთხოების ინტერვალი (PHI):', it: 'Intervallo di Sicurezza (PHI):', fr: 'Délai avant Récolte (DAR):', de: 'Wartezeit (PHI):' }[lang] || 'Pre-Harvest Interval (PHI):'} {sp.preHarvestIntervalDays} {{ en: 'days', ka: 'დღე', it: 'giorni', fr: 'jours', de: 'Tage' }[lang]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          TAB 2: VINEYARD BLOCKS LIST & DETAIL
          ========================================== */}
      {vaziTab === 'blocks' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          
          {/* Left Block Selection list */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between border-b border-[#e8dfd5] pb-2">
              <h3 className="font-serif font-black text-sm text-emerald-950">{label.allBlocks}</h3>
              <button
                onClick={() => setShowAddBlockModal(true)}
                className="bg-emerald-800 hover:bg-emerald-900 text-white px-2.5 py-1 text-[10px] uppercase font-mono tracking-wider font-extrabold rounded-md cursor-pointer flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Block
              </button>
            </div>

            <div className="space-y-3.5">
              {blocks.map(b => {
                const isActive = b.id === selectedBlockId;
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBlockId(b.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                      isActive 
                        ? 'bg-neutral-50/80 border-[#4e0e15] shadow-xs' 
                        : 'bg-white border-[#e8dfd5] hover:bg-stone-50/50'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#4e0e15]" />
                    )}
                    <div className="flex items-center justify-between">
                      <strong className="text-xs font-serif font-black text-stone-900 dark:text-amber-100">{b.name}</strong>
                      <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400 font-bold">{b.area} ha</span>
                    </div>
                    <div className="flex justify-between items-center mt-2 font-mono text-[9px] text-stone-500">
                      <span>{b.grapeVariety}</span>
                      <span className="text-emerald-700 font-extrabold">{b.currentPhenology}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Detailed Analysis of Selected Block */}
          <div className="lg:col-span-2 xl:col-span-3 space-y-6">
            {selectedBlock ? (
              <div className="bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 p-8 lg:p-10 rounded-3xl shadow-sm space-y-8">
                
                {/* Title and Base Stats */}
                <div className="flex flex-col sm:flex-row justify-between sm:items-start border-b border-[#e8dfd5] pb-4 gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate-450 tracking-widest">{selectedBlock.vineyardName} • {selectedBlock.locationName}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <h3 className="text-xl font-serif font-black text-[#4e0e15]">{selectedBlock.name}</h3>
                      <button
                        type="button"
                        onClick={() => setIsEditingBlock(!isEditingBlock)}
                        className="text-stone-500 hover:text-[#4e0e15] text-[10px] font-mono font-bold transition-colors cursor-pointer select-none border border-stone-250 px-1.5 rounded"
                        title="Edit Block Properties"
                      >
                        ✏️ {lang === 'ka' ? 'შეცვლა' : 'Edit'}
                      </button>
                    </div>
                    <p className="text-xs text-stone-500 font-medium font-sans leading-relaxed mt-1">{selectedBlock.notes}</p>
                  </div>
                  
                  {/* Local Quick actions */}
                  <div className="bg-neutral-50 border border-stone-200/55 p-3 rounded-xl flex items-center gap-3 w-fit text-[10px] font-mono shrink-0">
                    <div className="text-center shrink-0 pr-3 border-r border-stone-150">
                      <span className="text-[9px] uppercase font-normal text-slate-500 dark:text-slate-400 block">Variety Status</span>
                      <strong className="text-xs block text-[#4e0e15] font-bold font-serif">{selectedBlock.grapeVariety}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-normal text-slate-500 dark:text-slate-400 block">Farming</span>
                      <strong className="text-xs uppercase block text-emerald-750 font-bold">{selectedBlock.farmingStatus}</strong>
                    </div>
                  </div>
                </div>

                {isEditingBlock ? (
                  <form onSubmit={handleSaveBlock} className="space-y-4 bg-[#FAF8F5] p-5 border border-[#e8dfd5] rounded-xl text-xs text-stone-700">
                    <h3 className="text-xs uppercase font-mono tracking-widest text-[#4e0e15] font-black border-b pb-1.5 mb-3 flex justify-between items-center">
                      <span>✏️ {lang === 'ka' ? 'ნაკვეთის პარამეტრები' : 'Edit Block Properties'}</span>
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Block Name</label>
                        <input 
                          type="text" required
                          value={editBlockName} onChange={(e) => setEditBlockName(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Vineyard Name</label>
                        <input 
                          type="text" required
                          value={editVineyardName} onChange={(e) => setEditVineyardName(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Location Name</label>
                        <input 
                          type="text" required
                          value={editLocationName} onChange={(e) => setEditLocationName(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Area (ha)</label>
                        <input 
                          type="number" step="0.01" required
                          value={editArea} onChange={(e) => setEditArea(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Elevation (m)</label>
                        <input 
                          type="number" required
                          value={editElevation} onChange={(e) => setEditElevation(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Slope</label>
                        <input 
                          type="text" required
                          value={editSlope} onChange={(e) => setEditSlope(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Aspect</label>
                        <input 
                          type="text" required
                          value={editAspect} onChange={(e) => setEditAspect(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Grape Variety</label>
                        <input 
                          type="text" required
                          value={editGrapeVariety} onChange={(e) => setEditGrapeVariety(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Planting Year</label>
                        <input 
                          type="number" required
                          value={editPlantingYear} onChange={(e) => setEditPlantingYear(Number(e.target.value) || 2018)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Training System</label>
                        <input 
                          type="text" required
                          value={editTrainingSystem} onChange={(e) => setEditTrainingSystem(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Spacing</label>
                        <input 
                          type="text" required
                          value={editSpacing} onChange={(e) => setEditSpacing(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Rows Count</label>
                        <input 
                          type="number" required
                          value={editRowsCount} onChange={(e) => setEditRowsCount(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Vines Count</label>
                        <input 
                          type="number" required
                          value={editVinesCount} onChange={(e) => setEditVinesCount(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Farming Status</label>
                        <input 
                          type="text" required
                          value={editFarmingStatus} onChange={(e) => setEditFarmingStatus(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Soil Type</label>
                        <input 
                          type="text" required
                          value={editSoilType} onChange={(e) => setEditSoilType(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <input 
                          type="checkbox" id="editIrrigationEnabled"
                          checked={editIrrigationEnabled} onChange={(e) => setEditIrrigationEnabled(e.target.checked)}
                          className="h-4 w-4 text-emerald-800 focus:ring-emerald-700 rounded accent-emerald-800"
                        />
                        <label htmlFor="editIrrigationEnabled" className="font-bold text-[10px] text-stone-700 cursor-pointer">Irrigation Enabled</label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">Block Notes / Description</label>
                      <textarea 
                        value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                        className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none h-16"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button 
                        type="button"
                        onClick={() => setIsEditingBlock(false)}
                        className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-700 font-mono font-bold uppercase py-2.5 rounded-lg text-[10px] cursor-pointer transition-colors"
                      >
                        {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                      </button>
                      <button 
                        type="submit"
                        className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-[10px] cursor-pointer transition-colors"
                      >
                        {lang === 'ka' ? 'შენახვა' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>

                {/* Sub-Tabs of Block detail */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-stone-700">
                  
                  {/* Block Terrain & Soil */}
                  <div className="space-y-3 p-4 bg-stone-50 rounded-xl border border-stone-100">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-[#4e0e15] flex items-center gap-1.5 border-b border-dashed border-stone-200 pb-1.5">
                      <Mountain className="w-3.5 h-3.5" />
                      Block Terrain & Vineyard Soil Specs
                    </h4>
                    <ul className="text-xs space-y-2 font-medium">
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Altitude / Elevation:</span>
                        <span className="font-mono text-stone-800">{selectedBlock.elevation} Meters</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Slope Profile:</span>
                        <span className="font-mono text-stone-800">{selectedBlock.slope}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Aspect Exposure:</span>
                        <span className="font-mono text-stone-800">{selectedBlock.aspect}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Planting Spacing:</span>
                        <span className="font-mono text-stone-800">{selectedBlock.spacing}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Soil Geological Profile:</span>
                        <span className="font-serif text-[11px] text-[#4e0e15] text-right font-bold inline-block max-w-40">{selectedBlock.soilType}</span>
                      </li>
                    </ul>
                  </div>

                  {/* Coordinates & Custom Area Mapping Draw widget */}
                  <div className="space-y-3 p-4 bg-stone-50 rounded-xl border border-stone-100 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-[#4e0e15] flex items-center justify-between border-b border-dashed border-stone-200 pb-1.5 w-full">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5" />
                          Interactive Digital Block Polygon Map
                        </span>
                      </h4>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                        GPS: Lat {selectedBlock.latitude.toFixed(4)}, Lng {selectedBlock.longitude.toFixed(4)}
                      </div>
                    </div>

                    {/* Virtual Interactive coordinate mapping area */}
                    <div className="h-32 bg-stone-100/80 rounded-lg border border-stone-200 relative overflow-hidden flex flex-col items-center justify-center">
                      <div className="absolute top-2 right-2 flex gap-1.5 shrink-0 z-10">
                        <button 
                          onClick={() => {
                            setIsDrawingPolygon(!isDrawingPolygon);
                            setDrawnPixels([]);
                          }}
                          className={`px-2 py-0.5 text-[9px] font-mono font-bold rounded cursor-pointer ${
                            isDrawingPolygon ? 'bg-red-600 text-white' : 'bg-emerald-800 text-white hover:bg-emerald-900'
                          }`}
                        >
                          {isDrawingPolygon ? 'Cancel Map' : 'Draw Polygon'}
                        </button>
                      </div>

                      {/* Map backdrop and custom canvas outline helper */}
                      <div className="absolute inset-0 bg-stone-200 opacity-30 flex items-center justify-center select-none">
                        <span className="text-[8px] font-mono text-stone-400 uppercase tracking-widest">[Satellite View Simulation]</span>
                      </div>
                      
                      {isDrawingPolygon ? (
                        <div 
                          className="absolute inset-0 z-0 cursor-crosshair pb-2 flex flex-col items-center justify-end" 
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;
                            setDrawnPixels([...drawnPixels, { x, y }]);
                          }}
                        >
                          {/* Saperavi drawing points SVG overlay */}
                          <svg className="absolute inset-0 w-full h-full pointer-events-none">
                            {drawnPixels.length > 1 && (
                              <polygon
                                points={drawnPixels.map(p => `${p.x},${p.y}`).join(' ')}
                                fill="rgba(16, 185, 129, 0.2)"
                                stroke="#10b981"
                                strokeWidth="1.5"
                              />
                            )}
                            {drawnPixels.map((p, i) => (
                              <circle key={i} cx={p.x} cy={p.y} r="3" fill="#10b981" />
                            ))}
                          </svg>
                          <span className="text-[8px] font-bold font-mono tracking-wider bg-[#4e0e15] text-white px-2 py-0.5 rounded shadow-sm relative z-15">
                            Click {4 - drawnPixels.length > 0 ? `${4 - drawnPixels.length} more` : 'Completed'} times to snap block boundary
                          </span>
                        </div>
                      ) : (
                        <div className="text-center p-3 relative z-10 font-mono">
                          <Compass className="w-8 h-8 text-emerald-800 mx-auto opacity-70 animate-spin" style={{ animationDuration: '8s' }} />
                          <span className="text-[8px] uppercase tracking-wider block mt-2 text-stone-500 font-bold">Polygon Bound Calibrations Ready</span>
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                {/* Phenology Estimation Area */}
                <div className="p-4 bg-emerald-50/40 rounded-xl border border-emerald-100 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-150 pb-2">
                    <div>
                      <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-emerald-900 flex items-center gap-1.5">
                        <Sprout className="w-3.5 h-3.5" />
                        Growing Degree Days Phenological Predictor
                      </h4>
                      <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">Automated heat sum index algorithms mapping current vegetative progression</p>
                    </div>
                    <span className="text-[9px] font-mono bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded font-extrabold">Active Prediction Model</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 bg-white border border-stone-100 rounded-lg text-center font-mono">
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase block font-sans">Accumulated GDD Heat</span>
                      <strong className="text-base text-emerald-950 block mt-0.5">{computedGDD} °C-Days</strong>
                    </div>
                    <div className="p-3 bg-white border border-stone-100 rounded-lg text-center font-mono flex flex-col justify-between items-center">
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase block font-sans">Estimated Canopy Stage</span>
                      <select
                        value={selectedBlock.currentPhenology}
                        onChange={(e) => onUpdateBlock(selectedBlock.id, { currentPhenology: e.target.value })}
                        className="text-xs font-serif font-bold text-amber-700 text-center bg-transparent border border-amber-200/50 rounded-lg px-2.5 py-1 outline-none cursor-pointer mt-1.5 hover:text-amber-950 hover:border-amber-400 transition-all font-semibold max-w-full"
                      >
                        {[
                          'Dormancy / before bud swelling',
                          'Budburst',
                          'Budburst / early shoot growth',
                          '4-6 leaves / inflorescences visible',
                          'Pre-flowering',
                          'Flowering',
                          'Fruit set',
                          'Post-flowering / fruit set',
                          'Pea-size berry / berry growth',
                          'Bunch closure',
                          'Veraison',
                          'Ripening',
                          'Pre-harvest / ripening'
                        ].map((stage) => (
                          <option key={stage} value={stage} className="text-stone-800 bg-white">
                            {stage}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="p-3 bg-white border border-stone-100 rounded-lg text-center font-mono">
                      <span className="text-[9px] text-slate-450 uppercase block font-sans">Confidence Index</span>
                      <strong className="text-base text-emerald-700 block mt-0.5">92% Reliable</strong>
                    </div>
                  </div>

                  <div className="flex gap-2 text-[10px] font-mono justify-end pt-1">
                    <button 
                      onClick={() => {
                        onAddPhenologyLog({
                          blockId: selectedBlock.id,
                          stage: selectedBlock.currentPhenology,
                          date: new Date().toISOString().split('T')[0],
                          gdd: computedGDD,
                          confidence: 92,
                          status: 'confirmed',
                          notes: `Confirmed physiological status on late spring checkup. GDD tracking matches stage expectation.`,
                          observer: currentUser.fullName
                        });
                        alert(`Broadcasting canopy confirmation: Block ${selectedBlock.name} successfully registered at ${selectedBlock.currentPhenology}!`);
                      }}
                      className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold rounded-md cursor-pointer flex items-center gap-1 transition-all"
                    >
                      <Check className="w-3 h-3" /> Confirm Viticulturist Status
                    </button>
                  </div>
                </div>

              </>
            )}
              </div>
            ) : (
              <div className="bg-stone-50 border border-dashed border-[#e8dfd5] text-center p-12 rounded-xl italic font-serif text-sm text-[#4e0e15]/60 flex flex-col items-center justify-center">
                <Layers className="w-12 h-12 text-stone-300 mb-3" />
                Select a vineyard block from the sidebar registry to deploy the viticulture control station.
              </div>
            )}
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 3: SPRAYING RECORDS
          ========================================== */}
      {vaziTab === 'spraying' && selectedBlock && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 font-sans">
          
          {/* Add Spray Record Form */}
          <div className="lg:col-span-1 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 p-6 lg:p-7 rounded-2xl h-fit shadow-xs space-y-4 text-xs text-stone-600">
            <h4 className="font-serif font-black text-sm text-emerald-950 border-b border-stone-100 dark:border-stone-800 pb-2">Record Chemical Application</h4>
            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const targetProblem = fd.get('targetProblem') as string;
              const productName = fd.get('productName') as string;
              const active = fd.get('activeIngredient') as string;
              const dose = parseFloat(fd.get('dosePerHa') as string);
              const water = parseFloat(fd.get('waterVolumePerHa') as string);
              const operator = fd.get('operator') as string;
              const machinery = fd.get('machineryUsed') as string;
              const phi = parseInt(fd.get('phi') as string) || 14;
              const rei = parseInt(fd.get('rei') as string) || 24;

              if (targetProblem && productName) {
                onAddSprayRecord({
                  blockId: selectedBlock.id,
                  date: new Date().toISOString().split('T')[0],
                  targetProblem,
                  productName,
                  activeIngredient: active,
                  dosePerHa: dose,
                  waterVolumePerHa: water,
                  totalProductUsed: Math.round(dose * selectedBlock.area * 10) / 10,
                  totalWaterUsed: Math.round(water * selectedBlock.area),
                  operator,
                  machineryUsed: machinery,
                  windSpeed: blockWeather?.wind ?? 0,
                  temperature: blockWeather?.temp ?? 0,
                  humidity: blockWeather?.humidity ?? 0,
                  preHarvestIntervalDays: phi,
                  reEntryIntervalHours: rei,
                  notes: `Authorized chemical pesticide spraying campaign for ${targetProblem} prevention on Saperavi rows.`
                });
                form.reset();
              }
            }} className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Target Problem / Disease *</label>
                <input 
                  type="text" 
                  name="targetProblem" 
                  placeholder="e.g., Downy Mildew prevention" 
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium text-stone-800"
                  required 
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Chemical Product / Compound *</label>
                <input 
                  type="text" 
                  name="productName" 
                  placeholder="e.g., Valiant Cu-7 Copp" 
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium"
                  required 
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Active Ingredient</label>
                  <input type="text" name="activeIngredient" placeholder="Copper hydroxide" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Operator</label>
                  <input type="text" name="operator" placeholder="Nugzar Jincharadze" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Dose/ha (kg/L)</label>
                  <input type="number" step="0.1" name="dosePerHa" defaultValue="2.0" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Water volume/ha (L)</label>
                  <input type="number" step="10" name="waterVolumePerHa" defaultValue="400" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">PHI (Pre-Harvest Days)</label>
                  <input type="number" name="phi" defaultValue="21" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">REI (Re-Entry Hours)</label>
                  <input type="number" name="rei" defaultValue="24" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Tractor & Sprayer Unit</label>
                <input type="text" name="machineryUsed" placeholder="Fendt 207V with Hardi Sprayer" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none" />
              </div>

              {/* Instant Safety Warnings block */}
              {blockWeather && blockWeather.wind > 12 && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg font-mono text-[10px] space-y-1 block">
                  <span className="font-extrabold uppercase text-[9px] block">⚠️ HIGH WIND HAZARD</span>
                  Local wind speed is currently {blockWeather.wind} km/h. High drift risks. Delay application sequence to early morning!
                </div>
              )}

              <button 
                type="submit" 
                className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold font-mono uppercase tracking-wider py-2 rounded-lg cursor-pointer transition-colors"
              >
                Launch Field Spray Campaign
              </button>
            </form>
          </div>

          {/* Spraying History list */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15]">Pesticide and Spraying Logbook — {selectedBlock.name}</h4>
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1" tabIndex={0}>
              {sprays.filter(s => s.blockId === selectedBlock.id).map(spray => (
                <div key={spray.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all font-sans space-y-2 relative">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 rounded font-mono font-bold">
                      🛡️ PHI: {spray.preHarvestIntervalDays} Days Safety
                    </span>
                    <span className="text-[9px] bg-sky-100 text-sky-850 px-2 py-0.5 rounded font-mono font-bold">
                      REI: {spray.reEntryIntervalHours} hours
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono ml-auto">{spray.date} • Operator {spray.operator}</span>
                  </div>
                  
                  <h5 className="font-bold text-stone-900 text-sm leading-tight">Applied: {spray.productName} ({spray.activeIngredient})</h5>
                  <p className="text-xs text-stone-500 leading-relaxed bg-[#fbf9f6]/60 p-2 rounded border border-dashed border-[#e8dfd5]/60">
                    <strong>Target:</strong> {spray.targetProblem} <br />
                    <strong>Machinery Dosage:</strong> {spray.dosePerHa} kg/ha in {spray.waterVolumePerHa}L/ha water. Total quantity: <strong>{spray.totalProductUsed} kg</strong> pesticide in <strong>{spray.totalWaterUsed}L</strong> water.
                  </p>
                  
                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-stone-550 pt-1">
                    <div>🌡️ Temp: {spray.temperature}°C</div>
                    <div>🍃 Wind: {spray.windSpeed} km/h</div>
                    <div>💧 Humidity: {spray.humidity}%</div>
                  </div>
                </div>
              ))}

              {sprays.filter(s => s.blockId === selectedBlock.id).length === 0 && (
                <div className="text-center py-12 text-stone-400 italic font-mono text-xs">
                  <Wind className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                  No chemical treatments recorded for this block.
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 4: DISEASE SCOUTING
          ========================================== */}
      {vaziTab === 'scouting' && selectedBlock && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 font-sans">
          
          {/* Add Scouting Record form */}
          <div className="lg:col-span-1 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 p-6 lg:p-7 rounded-2xl h-fit shadow-xs space-y-4 text-xs text-stone-600">
            <h4 className="font-serif font-black text-sm text-emerald-950 border-b border-stone-100 dark:border-stone-800 pb-2">Log Pathogen Scouting</h4>
            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const path = fd.get('problemType') as any;
              const loc = fd.get('locationDetails') as string;
              const sev = fd.get('severity') as any;
              const rec = fd.get('recommendedAction') as string;
              const note = fd.get('notes') as string;

              if (path && loc) {
                onAddScoutingRecord({
                  blockId: selectedBlock.id,
                  date: new Date().toISOString().split('T')[0],
                  locationDetails: loc,
                  problemType: path,
                  severity: sev,
                  notes: note,
                  recommendedAction: rec,
                  followUpTaskId: `scout-task-${Date.now()}`
                });
                form.reset();
              }
            }} className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Pathogen / Problem Type *</label>
                <select name="problemType" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1.5 outline-none font-bold text-stone-800">
                  <option value="Downy mildew">🌾 Downy Mildew</option>
                  <option value="Powdery mildew">🌫️ Powdery Mildew</option>
                  <option value="Botrytis">🍇 Botrytis Bunch Rot</option>
                  <option value="Black rot">⚫ Black Rot</option>
                  <option value="Esca">🪵 Esca Trunk Disease</option>
                  <option value="Mites">🕷️ Red Spider Mites</option>
                  <option value="Grape moth">🦋 European Grape Moth</option>
                  <option value="Nutrient deficiency">🍂 Chlorosis / Nutrient Defic</option>
                  <option value="Water stress">🏜️ Severe Water Stress</option>
                  <option value="Hail damage">⛈️ Hail Injury</option>
                  <option value="Sunburn">☀️ Cluster Sunburn</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Field Row / Location detail *</label>
                <input 
                  type="text" 
                  name="locationDetails" 
                  placeholder="e.g. Rows 24 to 36, southern depression" 
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium"
                  required 
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Observed Severity</label>
                <div className="flex gap-2">
                  {['low', 'medium', 'high'].map(s => (
                    <label key={s} className="flex-1 text-center py-1.5 border border-stone-200 rounded-lg cursor-pointer hover:bg-stone-50 font-mono text-[10px] font-bold block uppercase">
                      <input 
                        type="radio" 
                        name="severity" 
                        value={s} 
                        defaultChecked={s === 'low'}
                        className="mr-1 accent-emerald-800"
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Recommended Action Plan</label>
                <textarea 
                  name="recommendedAction" 
                  placeholder="e.g. Schedule systemic protective spraying immediately..." 
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-16 outline-none text-xs"
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Scouting Observations / Count</label>
                <textarea 
                  name="notes" 
                  placeholder="e.g. Faint oil spots on lower leaf surface detected..." 
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-16 outline-none text-xs"
                />
              </div>

              <button 
                type="submit" 
                className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white font-extrabold font-mono uppercase tracking-wider py-2 rounded-lg cursor-pointer transition-colors hover-lift"
              >
                Save Scouting Record
              </button>
            </form>
          </div>

          {/* Scouting List */}
          <div className="lg:col-span-2 xl:col-span-3 bg-white dark:bg-stone-900 rounded-3xl border border-[#e8dfd5] dark:border-stone-800 p-8 shadow-sm space-y-5">
            <h4 className="font-serif font-bold text-sm text-[#4e0e15]">Continuous Field Pathology Records</h4>
            <div className="space-y-4">
              {scoutings.filter(sc => sc.blockId === selectedBlock.id).map(scout => (
                <div key={scout.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all font-sans relative flex justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                        scout.severity === 'high' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                        scout.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {scout.severity === 'high' ? '🔴 Severity: High' : scout.severity === 'medium' ? '🟡 Severity: Medium' : '⚪ Severity: Low'}
                      </span>
                      <span className="text-[10px] bg-slate-100 text-stone-600 font-mono px-1.5 py-0.2 rounded font-semibold">
                        Location: {scout.locationDetails}
                      </span>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono ml-auto">{scout.date}</span>
                    </div>

                    <h5 className="font-black text-stone-900 text-sm leading-tight">Detected Problem: <span className="text-[#801323]">{scout.problemType}</span></h5>
                    <p className="text-xs text-stone-600 leading-relaxed"><strong className="text-slate-500">Observation Notes:</strong> {scout.notes}</p>
                    {scout.recommendedAction && (
                      <div className="text-xs text-emerald-800 bg-emerald-50/70 p-2.5 rounded border border-emerald-100 flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>Farming Action Plan:</strong> {scout.recommendedAction}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {scoutings.filter(sc => sc.blockId === selectedBlock.id).length === 0 && (
                <div className="text-center py-12 text-stone-400 italic font-mono text-xs">
                  <CheckSquare className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                  Your canopy scouting reports are perfectly clean. No pathogens spotted!
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 5: GRAPE SAMPLING & GRAPHS
          ========================================== */}
      {vaziTab === 'sampling' && selectedBlock && (
        <div className="space-y-6 font-sans">
          
          {/* Top Form to Record new Analytical Grape Sample */}
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-4">
            <h4 className="font-serif font-black text-sm text-[#4e0e15] border-b border-stone-100 pb-2">Record Pre-Harvest Grape Mature Sampling</h4>
            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const brix = parseFloat(fd.get('brix') as string);
              const ph = parseFloat(fd.get('ph') as string);
              const ta = parseFloat(fd.get('ta') as string);
              const weight = parseFloat(fd.get('weight') as string);
              const taste = fd.get('taste') as string;
              const seed = fd.get('seed') as any;

              if (brix && ph) {
                onAddSamplings({
                  blockId: selectedBlock.id,
                  date: new Date().toISOString().split('T')[0],
                  brix,
                  pH: ph,
                  totalAcidityGL: ta,
                  berryWeightG: weight,
                  phenolicMaturity: brix > 22 ? 'Optimal' : 'Intermediate',
                  seedColor: seed,
                  tasteNotes: taste,
                  diseaseCondition: 'Healthy grapes',
                  estimatedHarvestDate: selectedBlock.estimatedHarvestDate,
                  notes: `Manual grape cluster sampling recorded for vintage checkup.`
                });
                form.reset();
                alert('Sugar accumulation sample logs saved successfully!');
              }
            }} className="grid grid-cols-2 md:grid-cols-6 gap-4 text-xs">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Sugar Density (°Brix) *</label>
                <input type="number" step="0.1" name="brix" defaultValue="19.5" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" required />
              </div>
              
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Active pH *</label>
                <input type="number" step="0.01" name="ph" defaultValue="3.15" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" required />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Total Acidity (g/L Tartaric)</label>
                <input type="number" step="0.1" name="ta" defaultValue="7.4" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Average Berry Wt (grams)</label>
                <input type="number" step="0.01" name="weight" defaultValue="1.20" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Seed Lignified Status</label>
                <select name="seed" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none">
                  <option value="Green">🟢 Hydrated Green</option>
                  <option value="Yellow-brown">🟡 Semi-Brown</option>
                  <option value="Dark brown">🟤 Lignified Dark Brown</option>
                </select>
              </div>

              <div className="flex items-end">
                <button 
                  type="submit"
                  className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 font-mono font-bold uppercase rounded cursor-pointer leading-tight"
                >
                  Save Sample
                </button>
              </div>
            </form>
          </div>

          {/* Interactive Recharts Graphics showing maturity curves */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Recharts 1: Brix vs Berry Weight */}
            <div className="bg-white border border-[#e8dfd5] p-5 rounded-xl shadow-sm space-y-2">
              <h5 className="font-serif font-bold text-stone-900 text-xs">Sugar Accumulation Rate (°Brix Trend)</h5>
              <div className="h-64 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={samplings.filter(s => s.blockId === selectedBlock.id).sort((a,b) => a.date.localeCompare(b.date))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f3f5" />
                    <XAxis dataKey="date" stroke="#888" fontSize={9} />
                    <YAxis stroke="#888" domain={[10, 26]} fontSize={9} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="brix" name="Brix level" stroke="#801323" strokeWidth={2.5} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="berryWeightG" name="Berry Weight (g)" stroke="#0ea5e9" strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recharts 2: pH vs Acidity */}
            <div className="bg-white border border-[#e8dfd5] p-5 rounded-xl shadow-sm space-y-2">
              <h5 className="font-serif font-bold text-stone-900 text-xs">pH Rise vs. Total Tartaric Acidity Decline</h5>
              <div className="h-64 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={samplings.filter(s => s.blockId === selectedBlock.id).sort((a,b) => a.date.localeCompare(b.date))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f3f5" />
                    <XAxis dataKey="date" stroke="#888" fontSize={9} />
                    <YAxis yAxisId="left" stroke="#888" domain={[2.8, 3.8]} fontSize={9} name="pH" />
                    <YAxis yAxisId="right" orientation="right" stroke="#888" domain={[4, 12]} fontSize={9} name="TA g/L" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line yAxisId="left" type="monotone" dataKey="pH" name="pH level" stroke="#eab308" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="totalAcidityGL" name="Tartaric Acid (g/L)" stroke="#b45309" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ==========================================
          TAB 6: YIELD ESTIMATOR & HARVEST
          ========================================== */}
      {vaziTab === 'yield' && selectedBlock && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans">
          
          {/* Yield Calculator */}
          <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-5">
            <div>
              <h4 className="font-serif font-black text-sm text-[#4e0e15] flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-[#801323]" />
                Micro-Yield Calculator Estimates
              </h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Predicted grape crop kilograms, tons per acre, and anticipated total juice volumes</p>
            </div>

            {/* Interactive sliders for robust yield estimation */}
            <div className="space-y-4 text-xs font-semibold text-stone-700">
              <div>
                <label className="text-[10px] tracking-wider uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1">Total Vine Count on Block</label>
                <div className="bg-stone-50 border border-stone-200 p-2 text-[#4e0e15] text-sm font-black rounded font-mono">
                  {selectedBlock.vinesCount.toLocaleString()} Vines
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] tracking-wider uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1">Avg Grape Clusters per Vine</label>
                  <input type="number" defaultValue="15" className="w-full bg-stone-50 border border-stone-200 px-2 py-1.5 font-mono" id="cluster-count" />
                </div>
                <div>
                  <label className="text-[10px] tracking-wider uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1">Avg Bunch Weight (gr)</label>
                  <input type="number" defaultValue="125" className="w-full bg-stone-50 border border-stone-200 px-2 py-1.5 font-mono" id="bunch-weight" />
                </div>
              </div>

              <button 
                type="button"
                onClick={() => {
                  const bCount = parseFloat((document.getElementById('cluster-count') as HTMLInputElement).value) || 15;
                  const bWeight = parseFloat((document.getElementById('bunch-weight') as HTMLInputElement).value) || 125;
                  
                  // Computations
                  const totalKg = Math.round(selectedBlock.vinesCount * bCount * (bWeight / 1000));
                  const totalTons = Math.round((totalKg / 1000) * 10) / 10;
                  const tonsPerHa = Math.round((totalTons / selectedBlock.area) * 10) / 10;
                  const expectedJuiceLiters = Math.round(totalKg * 0.70); // 70% average extraction recovery
                  
                  // Show inside target outputs
                  (document.getElementById('pred-kg') as HTMLSpanElement).innerText = totalKg.toLocaleString() + " Kg";
                  (document.getElementById('pred-tons') as HTMLSpanElement).innerText = totalTons + " Tons";
                  (document.getElementById('pred-ha') as HTMLSpanElement).innerText = tonsPerHa + " t/ha";
                  (document.getElementById('pred-juice') as HTMLSpanElement).innerText = expectedJuiceLiters.toLocaleString() + " L";
                }}
                className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 font-mono uppercase tracking-wider text-xs cursor-pointer font-extrabold rounded"
              >
                Compute Crop Volume Projections
              </button>

              <hr className="border-stone-100" />

              {/* Outputs grid */}
              <div className="grid grid-cols-2 gap-4 font-mono">
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">Predicted Kg</span>
                  <strong className="text-base text-stone-800 block mt-1" id="pred-kg">{(selectedBlock.vinesCount * 15 * 0.125).toLocaleString()} Kg</strong>
                </div>
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">Predicted Tons</span>
                  <strong className="text-base text-stone-800 block mt-1" id="pred-tons">{Math.round(((selectedBlock.vinesCount * 15 * 0.125) / 1000) * 10) / 10} Tons</strong>
                </div>
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">Yield per Hectare</span>
                  <strong className="text-base text-amber-700 block mt-1" id="pred-ha">{Math.round(((((selectedBlock.vinesCount * 15 * 0.125) / 1000)) / selectedBlock.area) * 10) / 10} t/ha</strong>
                </div>
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">Est. Wine Juice Recovery</span>
                  <strong className="text-base text-emerald-800 block mt-1" id="pred-juice">{Math.round(selectedBlock.vinesCount * 15 * 0.125 * 0.70).toLocaleString()} L</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Harvest Planning Page with Winery Direct Connection */}
          <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-4">
            <div>
              <h4 className="font-serif font-black text-sm text-[#4e0e15] flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-emerald-800" />
                Active Crop Harvest & Traceability Links
              </h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Schedule harvest campaigns and dispatch crops directly to Gvino cellar processing</p>
            </div>

            <div className="space-y-4">
              {harvests.filter(h => h.blockId === selectedBlock.id).map(harvest => (
                <div key={harvest.id} className="p-4 border border-[#e8dfd5]/65 bg-[#FAF8F5]/50 rounded-xl space-y-3">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <span className="text-[9px] bg-amber-100 text-amber-800 font-mono font-bold px-2 py-0.5 rounded">
                      Planned Target Date: {harvest.estimatedHarvestDate}
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-extrabold ${harvest.sentToGvino ? 'bg-emerald-100 text-emerald-800' : 'bg-red-50 text-red-700 border border-red-200 animate-pulse'}`}>
                      {harvest.sentToGvino ? '✅ Received in Gvino' : '⚠️ Pending Harvest Draft'}
                    </span>
                  </div>

                  <div className="text-xs space-y-2">
                    <div>
                      <strong>Variety Name:</strong> {harvest.variety} <br />
                      <strong>Estimated Yield Weight:</strong> {harvest.estimatedTons} Tons anticipated <br />
                      <strong>Special Harvesting Instructions:</strong> {harvest.notes}
                    </div>

                    {harvest.sentToGvino ? (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-900 text-[11px] rounded font-mono space-y-1 block">
                        <strong>Traceability Secured:</strong> Crop dispatch completed. <br />
                        Corresponding Winery Lot ID: <strong className="text-stone-800 font-black">{harvest.associatedLotId}</strong>
                      </div>
                    ) : (
                      <div className="pt-2">
                        <label className="text-[9px] uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1 font-bold">Input Actual Crop Harvest Weight (Kg)</label>
                        <div className="flex gap-2">
                          <input 
                            type="number" 
                            id={`qty-${harvest.id}`}
                            placeholder="e.g. 12500" 
                            defaultValue="12000"
                            className="bg-white border border-stone-250 px-2 py-1 text-xs outline-none rounded font-mono w-28 text-stone-900"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const input = document.getElementById(`qty-${harvest.id}`) as HTMLInputElement;
                              const harvestedQty = parseFloat(input.value) || 12000;
                              
                              // Send to Gvino callback
                              const grapeLotId = onSendHarvestToGvino(
                                selectedBlock.id, 
                                harvestedQty, 
                                selectedBlock.grapeVariety, 
                                2026, 
                                new Date().toISOString().split('T')[0]
                              );
                              
                              // Update local harvest state
                              onUpdateHarvestRecord(harvest.id, {
                                sentToGvino: true,
                                actualHarvestedKg: harvestedQty,
                                actualHarvestDate: new Date().toISOString().split('T')[0],
                                associatedLotId: grapeLotId
                              });
                              alert(`Traceability secured! Harvest of ${harvestedQty} Kg Ripe ${selectedBlock.grapeVariety} dispatched as Gvino Lot: ${grapeLotId}. Open Gvino to view the fermentation lot!`);
                            }}
                            className="flex-1 bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold text-[10px] uppercase font-mono px-3.5 py-1.5 rounded cursor-pointer duration-100 flex items-center justify-center gap-1.5"
                          >
                            <ArrowRight className="w-3.5 h-3.5" /> Dispatch Crop to Gvino Winery
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ==========================================
          TAB: IPM PHENOSCHEME
          ========================================== */}
      {vaziTab === 'ipm_pheno' && (
        <IpmPhenoscheme 
          lang={lang}
          selectedBlock={selectedBlock}
          sprays={sprays}
          onAddSprayRecord={onAddSprayRecord}
          currentUser={currentUser}
          blockWeather={blockWeather}
        />
      )}

      {/* ==========================================
          TAB 7: AGRO-WEATHER STATION
          ========================================== */}
      {vaziTab === 'weather' && (
        <WeatherTab 
          lang={lang} 
          blocks={blocks} 
          setActiveModule={setActiveModule}
          setActiveTab={setActiveTab}
          setPrefilledTaskTitle={setPrefilledTaskTitle}
          setPrefilledTaskPriority={setPrefilledTaskPriority}
          setPrefilledTaskDesc={setPrefilledTaskDesc}
        />
      )}

      {/* ==========================================
          ADD BLOCK MODAL
          ========================================== */}
      {showAddBlockModal && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in font-sans">
          <div
            ref={addBlockDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vazi-add-block-title"
            tabIndex={-1}
            className="bg-white w-full max-w-lg rounded-2xl border border-stone-200 shadow-xl overflow-hidden text-xs text-stone-600 space-y-4"
          >
            <div className="bg-emerald-950 text-white p-4 flex justify-between items-center font-serif">
              <strong id="vazi-add-block-title" className="text-sm font-bold block">{label.addBlock}</strong>
              <button onClick={() => setShowAddBlockModal(false)} aria-label={lang === 'ka' ? 'ბლოკის დამატების ფანჯრის დახურვა' : 'Close add block dialog'} className="text-white hover:text-stone-300 text-lg cursor-pointer">✕</button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              
              const name = fd.get('name') as string;
              const vineyard = fd.get('vineyardName') as string;
              const area = parseFloat(fd.get('area') as string) || 2.5;
              const variety = fd.get('variety') as string;
              const plantYear = parseInt(fd.get('plantYear') as string) || 2012;
              const rows = parseInt(fd.get('rows') as string) || 50;
              const spacing = fd.get('spacing') as string;
              const note = fd.get('notes') as string;

              if (name && variety) {
                onAddBlock({
                  name,
                  vineyardName: vineyard,
                  locationName: addBlockLocName,
                  latitude: addBlockLat,
                  longitude: addBlockLng,
                  area,
                  elevation: addBlockElev,
                  slope: '12% South-West',
                  aspect: 'South-West',
                  soilType: 'Limestone with heavy gravel alluvial deposits',
                  grapeVariety: variety,
                  plantingYear: plantYear,
                  spacing,
                  rowsCount: rows,
                  vinesCount: rows * 200, // 200 vines per row approx
                  trainingSystem: 'Guyot',
                  pruningSystem: 'Cane pruned',
                  irrigationEnabled: true,
                  farmingStatus: 'organic',
                  currentPhenology: 'Budburst',
                  estimatedHarvestDate: new Date(2026, 8, 15).toISOString().split('T')[0],
                  notes: note,
                  boundary: drawnPoints.length > 2 ? drawnPoints : undefined
                });
                form.reset();
                setDrawnPoints([]);
                setIsDrawingPolygon(false);
                setShowAddBlockModal(false);
              }
            }} className="p-5 space-y-3 max-h-[80vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Block Name*</label>
                  <input type="text" name="name" placeholder="e.g. Mukuzani Sector A" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5 outline-none rounded text-stone-900" required />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Estate/Vineyard Name*</label>
                  <input type="text" name="vineyardName" defaultValue="Anaklia Hills" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5 outline-none rounded" required />
                </div>
              </div>

              {/* Location — search a real place (Open-Meteo geocoder) or fine-tune coordinates below */}
              <div className="bg-emerald-50/50 border border-emerald-200/70 p-3 rounded-lg space-y-2">
                <span className="font-bold block text-emerald-900 font-mono text-[9px] uppercase tracking-wider">📍 Block Location</span>
                <p className="text-[10px] text-emerald-900/70 leading-relaxed">
                  Search any place to set the block's coordinates — they drive the real-time weather station, satellite views, and disease-risk models. Fine-tune latitude/longitude manually below.
                </p>
                <LocationPicker
                  latitude={addBlockLat}
                  longitude={addBlockLng}
                  showManual={false}
                  onChange={(loc) => {
                    setAddBlockLat(parseFloat(loc.latitude.toFixed(4)));
                    setAddBlockLng(parseFloat(loc.longitude.toFixed(4)));
                    if (loc.label) setAddBlockLocName(loc.label);
                    if (typeof loc.elevation === 'number' && loc.elevation > 0) setAddBlockElev(Math.round(loc.elevation));
                  }}
                />
                
                <div className="w-full h-40 rounded-lg overflow-hidden border border-stone-200 mt-2 relative z-0">
                  <APIProvider apiKey={process.env.GOOGLE_MAPS_PLATFORM_KEY || ''}>
                    <Map
                      defaultCenter={defaultCenter}
                      center={{ lat: addBlockLat, lng: addBlockLng }}
                      defaultZoom={15}
                      mapTypeId="hybrid"
                      gestureHandling="greedy"
                      disableDefaultUI={true}
                      onClick={(e) => {
                        if (e.detail.latLng) {
                          const lat = e.detail.latLng.lat;
                          const lng = e.detail.latLng.lng;
                          if (isDrawingPolygon) {
                            setDrawnPoints(prev => [...prev, { lat, lng }]);
                          } else {
                            setAddBlockLat(parseFloat(lat.toFixed(4)));
                            setAddBlockLng(parseFloat(lng.toFixed(4)));
                          }
                        }
                      }}
                    >
                      {!isDrawingPolygon && (
                        <Marker position={{ lat: addBlockLat, lng: addBlockLng }} />
                      )}
                      {isDrawingPolygon && drawnPoints.map((pt, idx) => (
                        <Marker key={idx} position={pt} label={String(idx + 1)} />
                      ))}
                      {drawnPoints.length > 1 && (
                        <MapPolygon paths={drawnPoints} fillColor="#10b981" strokeColor="#047857" />
                      )}
                    </Map>
                  </APIProvider>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsDrawingPolygon(!isDrawingPolygon);
                      if (!isDrawingPolygon) setDrawnPoints([]);
                    }}
                    className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded transition-colors cursor-pointer ${
                      isDrawingPolygon ? 'bg-emerald-800 text-white hover:bg-emerald-900' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                    }`}
                  >
                    {isDrawingPolygon ? '🛑 Stop Drawing' : '✏️ Draw Block Boundary'}
                  </button>
                  {isDrawingPolygon && drawnPoints.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDrawnPoints([])}
                      className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase bg-rose-100 hover:bg-rose-200 text-rose-800 rounded transition-colors cursor-pointer"
                    >
                      🗑️ Clear Points ({drawnPoints.length})
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Latitude</label>
                  <input 
                    type="number" 
                    step="0.0001" 
                    name="lat" 
                    value={addBlockLat} 
                    onChange={(e) => setAddBlockLat(parseFloat(e.target.value) || 41.9)} 
                    className="w-full bg-stone-50 border border-slate-200 px-2 py-1 text-stone-900 font-semibold font-mono" 
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Longitude</label>
                  <input 
                    type="number" 
                    step="0.0001" 
                    name="lng" 
                    value={addBlockLng} 
                    onChange={(e) => setAddBlockLng(parseFloat(e.target.value) || 45.4)} 
                    className="w-full bg-stone-50 border border-slate-200 px-2 py-1 text-stone-900 font-semibold font-mono" 
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Area (ha)*</label>
                  <input type="number" step="0.1" name="area" defaultValue="2.5" className="w-full bg-stone-50 border border-slate-200 px-2 py-1" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Elevation (Meters)</label>
                  <input type="number" name="elevation" value={addBlockElev} onChange={(e) => setAddBlockElev(parseInt(e.target.value) || 0)} className="w-full bg-stone-50 border border-slate-200 px-2 py-1" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Location Name</label>
                  <input type="text" name="locationName" value={addBlockLocName} onChange={(e) => setAddBlockLocName(e.target.value)} className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Grape Variety *</label>
                  <select name="variety" className="w-full bg-stone-55 border border-slate-200 px-2 py-1 outline-none font-bold text-stone-800">
                    <option value="Saperavi">🍇 Saperavi (Georgian Red)</option>
                    <option value="Rkatsiteli">🥂 Rkatsiteli (Amber/White)</option>
                    <option value="Mtsvane">🥂 Kakhuri Mtsvane</option>
                    <option value="Kisi">🍯 Kisi Traditional</option>
                    <option value="Cabernet Sauvignon">🍷 Cabernet Sauvignon</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Planting Year</label>
                  <input type="number" name="plantYear" defaultValue="2008" className="w-full bg-stone-50 border border-slate-200 px-2 py-1" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Rows count</label>
                  <input type="number" name="rows" defaultValue="60" className="w-full bg-stone-50 border border-slate-200 px-2 py-1" />
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Planting Spacing & Row density</label>
                <input type="text" name="spacing" defaultValue="2.5m x 1.0m" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">Agronomist Remarks</label>
                <textarea name="notes" placeholder="Old Saperavi clones on 5C rootstocks..." className="w-full bg-stone-50 border border-slate-200 p-2.5 h-16 outline-none" />
              </div>

              <button 
                type="submit"
                className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-mono font-bold uppercase tracking-wider py-2.5 rounded-lg cursor-pointer"
              >
                Register Block Sector
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
