import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../lib/i18n';
import {
  initialVessels,
  initialLots,
  initialFermLogs,
  initialLabLogs,
  initialInventory,
  initialTasks,
  Vessel,
  WineLot,
  DailyFermLog,
  LabAnalysis,
  InventoryItem,
  Task,
  
  // Vazi Types & Datasets
  VineyardBlock,
  PhenologyRecord,
  SprayRecord,
  ScoutingRecord,
  IrrigationRecord,
  FertilizationRecord,
  SoilAnalysisRecord,
  GrapeSamplingRecord,
  HarvestRecord,
  VineaAuditLog,
  UserProfile,
  CompanyProfile,
  initialVineyardBlocks,
  initialPhenologyRecords,
  initialSprayRecords,
  initialScoutingRecords,
  initialSoilAnalysis,
  initialGrapeSamples,
  initialHarvestRecords,
  initialIrrigationLogs,
  initialFertilizerLogs,
  initialVineaAuditLogs
} from '../lib/wineryState';

import VaziModule from '../components/VaziModule';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

// Subcomponents modular layout
import TanksVessels from '../components/TanksVessels';
import WineLotsTrace from '../components/WineLotsTrace';
import TransfersTab from '../components/TransfersTab';
import EnoCalculators from '../components/EnoCalculators';
import AiWinemaker from '../components/AiWinemaker';
import FermentationCurveChart from '../components/FermentationCurveChart';
import TankCapacityChart from '../components/TankCapacityChart';
import InventoryTab from '../components/InventoryTab';
import FermentationTab from '../components/FermentationTab';

// Core Lucide Icons mapping
import {
  LayoutDashboard,
  Container,
  Wine,
  GitCommit,
  Activity,
  TestTube,
  Boxes,
  Languages,
  ShieldAlert,
  Loader2,
  X,
  Thermometer,
  Flame,
  Snowflake,
  RefreshCw,
  Calendar,
  Sparkles,
  Droplet,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Trash,
  CheckCircle2,
  Sprout,
  CheckSquare
} from 'lucide-react';

export interface CellarNote {
  id: string;
  title: string;
  category: 'Enology' | 'Tasting' | 'Sanitation' | 'General';
  content: string;
  date: string;
  author: string;
  relatedLotId?: string;
}

const initialCellarNotes: CellarNote[] = [
  {
    id: 'note-1',
    title: 'Saperavi Cap Management Protocol',
    category: 'Enology',
    content: 'Ensure 3x daily punchdowns for Lot S-2025-01 to maximize color and soft tannin extraction from grapes.',
    date: '2026-05-27',
    author: 'Luka Tatrishvili',
    relatedLotId: 'S-2025-01'
  },
  {
    id: 'note-2',
    title: 'Rkatsiteli Malolactic Fermentation Check',
    category: 'Enology',
    content: 'MLF progress is slow but steady. VA level is stable at 0.35 g/L. Ambient temperature maintained at 18 degrees Celsius.',
    date: '2026-05-25',
    author: 'Sophia Rossi',
    relatedLotId: 'R-2025-02'
  },
  {
    id: 'note-3',
    title: 'Post-stabilization organoleptic tasting review',
    category: 'Tasting',
    content: 'Full-bodied, clean. No reduction issues noticed. Sulfite levels are stable. Notes of blackberry and black pepper.',
    date: '2026-05-20',
    author: 'Luka Tatrishvili'
  }
];

export default function App() {
  // 1. Language selector management
  const [lang, setLang] = useState<Language>('en');
  const [currentUtcTime, setCurrentUtcTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setCurrentUtcTime(d.toUTCString().replace('GMT', 'UTC'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isClient, setIsClient] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // Authentication & Profile States
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>({
    username: 'luka_winemaker',
    email: 'luka@vinea.com',
    fullName: 'Luka Tatrishvili',
    role: 'Owner/Admin',
    language: 'en'
  });

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    companyName: 'Vinea Estates',
    wineryName: 'Vinea Central Marani',
    country: 'Georgia',
    region: 'Kakheti',
    municipality: 'Telavi',
    address: 'Kondoli Village Highway, Telavi, Kakheti, Georgia',
    contactEmail: 'production@vinea.ge',
    phone: '+995 599 123 456',
    website: 'www.vinea.ge',
    measurementUnits: 'metric',
    latitude: 41.9056,
    longitude: 45.4740
  });

  // Module switcher: portal = module launcher map hub
  const [activeModule, setActiveModule] = useState<'portal' | 'vazi' | 'gvino' | 'settings' | 'audit'>('portal');

  // Navigation Sidebar collapsed state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Cellar Notes state
  const [notesList, setNotesList] = useState<CellarNote[]>([]);

  // 2. Global application state datasets (Winery & Viticulture)
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [lots, setLots] = useState<WineLot[]>([]);
  const [fermLogs, setFermLogs] = useState<DailyFermLog[]>([]);
  const [labLogs, setLabLogs] = useState<LabAnalysis[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Vazi Viticulture States
  const [blocks, setBlocks] = useState<VineyardBlock[]>([]);
  const [phenologyLogs, setPhenologyLogs] = useState<PhenologyRecord[]>([]);
  const [sprays, setSprays] = useState<SprayRecord[]>([]);
  const [scoutings, setScoutings] = useState<ScoutingRecord[]>([]);
  const [soilRecords, setSoilRecords] = useState<SoilAnalysisRecord[]>([]);
  const [samplings, setSamplings] = useState<GrapeSamplingRecord[]>([]);
  const [harvests, setHarvests] = useState<HarvestRecord[]>([]);
  const [irrigationLogs, setIrrigationLogs] = useState<IrrigationRecord[]>([]);
  const [fertilizerLogs, setFertilizerLogs] = useState<FertilizationRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<VineaAuditLog[]>([]);

  // 3. Daily fermentation tracking log inputs
  const [logTankId, setLogTankId] = useState('');
  const [logLotId, setLogLotId] = useState('');
  const [logTemp, setLogTemp] = useState(20);
  const [logDensity, setLogDensity] = useState(1.005);
  const [logSugar, setLogSugar] = useState(12);
  const [logPH, setLogPH] = useState(3.5);
  const [logNotes, setLogNotes] = useState('');
  const [logCap, setLogCap] = useState('Punchdowns - 2X');
  const [chartLotId, setChartLotId] = useState<string>('CS-2025-01');
  const [selectedTankId, setSelectedTankId] = useState<string | null>(null);

  // 4. Lab entry inputs state
  const [labLotId, setLabLotId] = useState('');
  const [labTankId, setLabTankId] = useState('');
  const [labABV, setLabABV] = useState(13.5);
  const [labVA, setLabVA] = useState(0.4);
  const [labFSO2, setLabFSO2] = useState(25);
  const [labTSO2, setLabTSO2] = useState(80);
  const [labResidualSugar, setLabResidualSugar] = useState(1.5);
  const [labLactic, setLabLactic] = useState(1.2);
  const [labTurbidity, setLabTurbidity] = useState(20);
  const [labTA, setLabTA] = useState(5.8);

  // Lab analysis page filter states
  const [labFilterType, setLabFilterType] = useState('all');
  const [labFilterAge, setLabFilterAge] = useState('all');

  // Load and hydrate from local storage securely
  useEffect(() => {
    setIsClient(true);
    
    // Gvino
    const storedVessels = localStorage.getItem('cf_vessels');
    const storedLots = localStorage.getItem('cf_lots');
    const storedFerm = localStorage.getItem('cf_fermlogs');
    const storedLab = localStorage.getItem('cf_lablogs');
    const storedInv = localStorage.getItem('cf_inventory');
    const storedTasks = localStorage.getItem('cf_tasks');
    const storedNotes = localStorage.getItem('cf_notes');
    const storedSidebarCollapsed = localStorage.getItem('cf_sidebar_collapsed');

    // Portal / Active Module
    const storedIsLoggedIn = localStorage.getItem('vinea_is_logged_in');
    const storedUser = localStorage.getItem('vinea_curr_user');
    const storedCompany = localStorage.getItem('vinea_company_profile');
    const storedModule = localStorage.getItem('vinea_active_module');

    // Vazi
    const storedBlocks = localStorage.getItem('vinea_blocks');
    const storedPhen = localStorage.getItem('vinea_phenology');
    const storedSprays = localStorage.getItem('vinea_sprays');
    const storedScout = localStorage.getItem('vinea_scoutings');
    const storedSoil = localStorage.getItem('vinea_soil');
    const storedSamps = localStorage.getItem('vinea_samplings');
    const storedHarv = localStorage.getItem('vinea_harvests');
    const storedIrrig = localStorage.getItem('vinea_irrigation');
    const storedFert = localStorage.getItem('vinea_fertilizer');
    const storedAudits = localStorage.getItem('vinea_audit_logs');

    setVessels(storedVessels ? JSON.parse(storedVessels) : initialVessels);
    setLots(storedLots ? JSON.parse(storedLots) : initialLots);
    setFermLogs(storedFerm ? JSON.parse(storedFerm) : initialFermLogs);
    setLabLogs(storedLab ? JSON.parse(storedLab) : initialLabLogs);
    setInventory(storedInv ? JSON.parse(storedInv) : initialInventory);
    setTasks(storedTasks ? JSON.parse(storedTasks) : initialTasks);
    setNotesList(storedNotes ? JSON.parse(storedNotes) : initialCellarNotes);
    setIsSidebarCollapsed(storedSidebarCollapsed === 'true');

    setIsLoggedIn(storedIsLoggedIn === 'true');
    if (storedUser) setCurrentUser(JSON.parse(storedUser));
    if (storedCompany) setCompanyProfile(JSON.parse(storedCompany));
    if (storedModule) setActiveModule(storedModule as any);

    setBlocks(storedBlocks ? JSON.parse(storedBlocks) : initialVineyardBlocks);
    setPhenologyLogs(storedPhen ? JSON.parse(storedPhen) : initialPhenologyRecords);
    setSprays(storedSprays ? JSON.parse(storedSprays) : initialSprayRecords);
    setScoutings(storedScout ? JSON.parse(storedScout) : initialScoutingRecords);
    setSoilRecords(storedSoil ? JSON.parse(storedSoil) : initialSoilAnalysis);
    setSamplings(storedSamps ? JSON.parse(storedSamps) : initialGrapeSamples);
    setHarvests(storedHarv ? JSON.parse(storedHarv) : initialHarvestRecords);
    setIrrigationLogs(storedIrrig ? JSON.parse(storedIrrig) : initialIrrigationLogs);
    setFertilizerLogs(storedFert ? JSON.parse(storedFert) : initialFertilizerLogs);
    setAuditLogs(storedAudits ? JSON.parse(storedAudits) : initialVineaAuditLogs);
  }, []);

  // Sync back to client side standard key-value storage
  useEffect(() => {
    if (!isClient) return;
    localStorage.setItem('cf_vessels', JSON.stringify(vessels));
    localStorage.setItem('cf_lots', JSON.stringify(lots));
    localStorage.setItem('cf_fermlogs', JSON.stringify(fermLogs));
    localStorage.setItem('cf_lablogs', JSON.stringify(labLogs));
    localStorage.setItem('cf_inventory', JSON.stringify(inventory));
    localStorage.setItem('cf_tasks', JSON.stringify(tasks));
    localStorage.setItem('cf_notes', JSON.stringify(notesList));
    localStorage.setItem('cf_sidebar_collapsed', String(isSidebarCollapsed));

    localStorage.setItem('vinea_is_logged_in', String(isLoggedIn));
    localStorage.setItem('vinea_curr_user', JSON.stringify(currentUser));
    localStorage.setItem('vinea_company_profile', JSON.stringify(companyProfile));
    localStorage.setItem('vinea_active_module', activeModule);

    // Vazi
    localStorage.setItem('vinea_blocks', JSON.stringify(blocks));
    localStorage.setItem('vinea_phenology', JSON.stringify(phenologyLogs));
    localStorage.setItem('vinea_sprays', JSON.stringify(sprays));
    localStorage.setItem('vinea_scoutings', JSON.stringify(scoutings));
    localStorage.setItem('vinea_soil', JSON.stringify(soilRecords));
    localStorage.setItem('vinea_samplings', JSON.stringify(samplings));
    localStorage.setItem('vinea_harvests', JSON.stringify(harvests));
    localStorage.setItem('vinea_irrigation', JSON.stringify(irrigationLogs));
    localStorage.setItem('vinea_fertilizer', JSON.stringify(fertilizerLogs));
    localStorage.setItem('vinea_audit_logs', JSON.stringify(auditLogs));
  }, [
    vessels, lots, fermLogs, labLogs, inventory, tasks, notesList, isSidebarCollapsed, isClient,
    isLoggedIn, currentUser, companyProfile, activeModule,
    blocks, phenologyLogs, sprays, scoutings, soilRecords, samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs
  ]);

  // Close selected modal drawer on Escape key down for intuitive usability
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTankId(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const handleToggleCoolingJacket = (vesselId: string) => {
    setVessels(prev => prev.map(v => {
      if (v.id === vesselId) {
        const nextStatus = !v.coolingJacketActive;
        return {
          ...v,
          coolingJacketActive: nextStatus,
          lastOperation: `${nextStatus ? 'Activated' : 'Switched off'} automated temperature cooling induction jacket`
        };
      }
      return v;
    }));
  };

  const handleAdjustTargetTemp = (vesselId: string, increment: number) => {
    setVessels(prev => prev.map(v => {
      if (v.id === vesselId) {
        const currentTarget = v.targetTemperature ?? 16.0;
        const nextTarget = parseFloat((currentTarget + increment).toFixed(1));
        return {
          ...v,
          targetTemperature: nextTarget,
          lastOperation: `Calibrated thermostatic target to ${nextTarget}°C`
        };
      }
      return v;
    }));
  };

  const handleToggleSanitation = (vesselId: string) => {
    setVessels(prev => prev.map(v => {
      if (v.id === vesselId) {
        const isCurrentlyClean = v.cleaningStatus === 'clean';
        const nextStatus = isCurrentlyClean ? 'cleaning_needed' : 'clean';
        return {
          ...v,
          cleaningStatus: nextStatus as any,
          lastCleaned: new Date().toISOString().split('T')[0],
          lastOperation: isCurrentlyClean ? 'Flagged: Needs CIP protocol' : 'SIP Sanitization completed locally'
        };
      }
      return v;
    }));
  };

  // Vazi Viticulture Handler Callbacks
  const handleAddBlock = (block: Omit<VineyardBlock, 'id'>) => {
    const id = `block-${Date.now()}`;
    setBlocks(prev => [...prev, { ...block, id }]);
  };

  const handleUpdateBlock = (id: string, updated: Partial<VineyardBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updated } : b));
  };

  const handleAddPhenologyLog = (log: Omit<PhenologyRecord, 'id'>) => {
    const id = `ph-${Date.now()}`;
    setPhenologyLogs(prev => [...prev, { ...log, id }]);
  };

  const handleAddSprayRecord = (rec: Omit<SprayRecord, 'id'>) => {
    const id = `spray-${Date.now()}`;
    setSprays(prev => [...prev, { ...rec, id }]);
  };

  const handleAddScoutingRecord = (rec: Omit<ScoutingRecord, 'id'>) => {
    const id = `scout-${Date.now()}`;
    setScoutings(prev => [...prev, { ...rec, id }]);
  };

  const handleAddSamplings = (rec: Omit<GrapeSamplingRecord, 'id'>) => {
    const id = `sample-${Date.now()}`;
    setSamplings(prev => [...prev, { ...rec, id }]);
  };

  const handleAddHarvestRecord = (rec: Omit<HarvestRecord, 'id'>) => {
    const id = `harv-${Date.now()}`;
    setHarvests(prev => [...prev, { ...rec, id }]);
  };

  const handleUpdateHarvestRecord = (id: string, updated: Partial<HarvestRecord>) => {
    setHarvests(prev => prev.map(h => h.id === id ? { ...h, ...updated } : h));
  };

  const handleAddIrrigation = (rec: Omit<IrrigationRecord, 'id'>) => {
    const id = `irrig-${Date.now()}`;
    setIrrigationLogs(prev => [...prev, { ...rec, id }]);
  };

  const handleAddFertilizer = (rec: Omit<FertilizationRecord, 'id'>) => {
    const id = `fert-${Date.now()}`;
    setFertilizerLogs(prev => [...prev, { ...rec, id }]);
  };

  const handleSendHarvestToGvino = (
    blockId: string, 
    harvestedKg: number, 
    variety: string, 
    vintage: number, 
    harvestedDate: string
  ): string => {
    const lotId = `LOT-${variety.substring(0, 2).toUpperCase()}-${vintage}-${Date.now().toString().slice(-4)}`;
    const assocBlock = blocks.find(b => b.id === blockId);
    const lotName = `${variety} - ${assocBlock ? assocBlock.name : 'Ridge'} Crop`;
    
    const newLot: WineLot = {
      id: lotId,
      name: lotName,
      vintage,
      variety,
      vineyardBlock: assocBlock ? assocBlock.name : 'Unknown Vineyard Block',
      region: companyProfile.region || 'Kakheti',
      initialVolume: Math.round(harvestedKg * 0.70),
      currentVolume: Math.round(harvestedKg * 0.70),
      wineClass: 'red',
      stage: 'crushing',
      createdAt: harvestedDate,
      history: [
        {
          date: harvestedDate,
          type: 'Harvest Dispatch',
          description: `Secured full viticulture-to-enology traceability link. Saperavi grape yield of ${harvestedKg.toLocaleString()} Kg.`,
          operator: currentUser.fullName
        }
      ]
    };

    setLots(prev => [...prev, newLot]);

    // Add initial fermentation tracking node
    const firstDailyFermLog: DailyFermLog = {
      id: `fl-${Date.now()}`,
      tankId: 'T-1',
      lotId,
      date: harvestedDate,
      temperature: 16.0,
      density: 1.090,
      sugar: 21.5,
      ph: 3.25,
      tastingNotes: 'Crushed and direct-pumped. Cold settle initiated.',
      capManagement: 'None',
      additives: 'None'
    };
    setFermLogs(prev => [...prev, firstDailyFermLog]);

    // Record system audit log
    const audit: VineaAuditLog = {
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      user: currentUser.fullName,
      module: 'VINEA',
      actionType: 'Traceability Dispatch',
      changedItem: 'WineLots & Harvest',
      oldValue: 'None (Agricultural)',
      newValue: `Gvino WineLot: ${lotId}`,
      notes: `Secured full viticulture-to-enology traceability link: Saperavi grape yield of ${harvestedKg} Kg.`
    };
    setAuditLogs(prev => [audit, ...prev]);

    return lotId;
  };

  if (!isClient) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8F5] text-[#2c241e]">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-800 mb-2" />
        <span className="text-xs font-semibold tracking-wide uppercase font-serif">Powering up VINEA Unified Platform...</span>
      </div>
    );
  }

  const t = translations[lang];

  // Helper selectors
  const totalLotsVolume = lots.reduce((acc, curr) => acc + curr.currentVolume, 0);
  const totalTanksCount = vessels.length;
  const occupiedTanksCount = vessels.filter(v => v.currentVolume > 0).length;
  const activeFermsCount = lots.filter(l => l.stage === 'fermenting').length;

  const lowSO2Alerts = labLogs.filter(log => log.freeSo2 < 15);
  const highVAAlerts = labLogs.filter(log => log.volatileAcid > 0.8);

  const mappedTanks = vessels.map(v => ({
    id: v.id,
    name: v.id,
    capacity: v.capacity,
    currentVolume: v.currentVolume,
    status: v.assignedLotId 
      ? (lots.find(l => l.id === v.assignedLotId)?.stage === 'fermenting' ? 'fermenting' : 'occupied')
      : (v.cleaningStatus === 'dirty' ? 'cleaning' : 'empty')
  }));

  const avgTemp = occupiedTanksCount > 0 
    ? parseFloat((vessels.reduce((acc, curr) => acc + (curr.temperature || 0), 0) / vessels.length).toFixed(1))
    : 15.0;

  // Sync active logs triggers
  const handleAddFermLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logLotId || !logTankId) return;

    const newLog: DailyFermLog = {
      id: `flog-${Date.now()}`,
      tankId: logTankId,
      lotId: logLotId,
      date: new Date().toISOString().split('T')[0],
      temperature: logTemp,
      density: logDensity,
      sugar: logSugar,
      ph: logPH,
      tastingNotes: logNotes || 'Healthy cap dynamics, fermenting raw juice perfectly.',
      capManagement: logCap,
      additives: 'None / DAP calculated'
    };

    setFermLogs([newLog, ...fermLogs]);
    setLogNotes('');
  };

  const handleAddLabLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labLotId || !labTankId) return;

    const newLab: LabAnalysis = {
      id: `lab-${Date.now()}`,
      lotId: labLotId,
      tankId: labTankId,
      date: new Date().toISOString().split('T')[0],
      alcoholPct: labABV,
      volatileAcid: labVA,
      freeSo2: labFSO2,
      totalSo2: labTSO2,
      residualSugar: labResidualSugar,
      ph: 3.55,
      malicAcid: 1.2,
      lacticAcid: labLactic,
      turbidity: labTurbidity,
      technician: 'Sophia Rossi',
      titratableAcidity: labTA
    };

    setLabLogs([newLab, ...labLogs]);
    
    // Auto-update wine lots with potential historic note about lab analysis completion
    const targetLot = lots.find(l => l.id === labLotId);
    if (targetLot) {
      const updatedLots = lots.map(l => {
        if (l.id === labLotId) {
          return {
            ...l,
            history: [
              ...l.history,
              {
                date: new Date().toISOString().split('T')[0],
                type: 'Lab Analysis Audit',
                description: `Completed chemical panel: ABV%: ${labABV}%, Free SO2: ${labFSO2} mg/L, VA: ${labVA} g/L, TA: ${labTA} g/L.`,
                operator: 'Sophia Rossi'
              }
            ]
          };
        }
        return l;
      });
      setLots(updatedLots);
    }
  };

  const handleToggleTaskStatus = (taskId: string) => {
    const updated = tasks.map(tk => {
      if (tk.id === taskId) {
        return {
          ...tk,
          status: tk.status === 'pending' ? 'completed' as const : 'pending' as const
        };
      }
      return tk;
    });
    setTasks(updated);
  };

  const handleAddNewTask = (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => {
    const newTask: Task = {
      id: `task-${Date.now()}`,
      title,
      priority,
      dueDate: dueDate || new Date().toISOString().split('T')[0],
      assignedTo: 'Luka Tatrishvili',
      status: 'pending',
      description
    };
    setTasks(prev => [newTask, ...prev]);
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const handleAddNewNote = (title: string, category: 'Enology' | 'Tasting' | 'Sanitation' | 'General', content: string, relatedLotId?: string) => {
    const newNote: CellarNote = {
      id: `note-${Date.now()}`,
      title,
      category,
      content,
      date: new Date().toISOString().split('T')[0],
      author: 'Luka Tatrishvili',
      relatedLotId: relatedLotId || undefined
    };
    setNotesList(prev => [newNote, ...prev]);
  };

  const handleDeleteNote = (noteId: string) => {
    setNotesList(prev => prev.filter(n => n.id !== noteId));
  };

  const handleAddInventory = (itemId: string, qty: number) => {
    const updated = inventory.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          stock: parseFloat((item.stock + qty).toFixed(1))
        };
      }
      return item;
    });
    setInventory(updated);
  };

  return (
    <div className="min-h-screen bg-[#f8f6f2] flex flex-col font-sans relative">
      {/* Dynamic Toast Alerts instead of blocking alerts inside nested components */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-[#4e0e15] border border-[#801323] text-amber-50 rounded-xl px-4 py-2.5 shadow-lg font-bold text-xs animate-pulse flex items-center gap-2">
          <span>🍇</span> {toastMessage}
        </div>
      )}
      {/* 1. Global Navigation Bar header */}
      <header className="px-6 md:px-8 py-3 bg-white/95 backdrop-blur-md border-b border-stone-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-40 shadow-[0_4px_30px_rgba(78,14,21,0.03)] transition-all duration-300">
        {/* Luxury Top Wine Edge Border */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-[#801323] via-[#4e0e15] to-[#c5a059]" />

        {/* Brand Crest */}
        <div className="flex items-center gap-3">
          <motion.div 
            whileHover={{ scale: 1.08, rotate: [0, -10, 10, 0] }}
            className="w-10 h-10 bg-gradient-to-br from-[#4e0e15] to-[#210204] text-amber-100 rounded-xl flex items-center justify-center shadow-md font-serif font-black text-xl border border-[#801323] cursor-pointer"
          >
            🍇
          </motion.div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-serif tracking-[0.25em] text-[#1b1715] font-black">VINEA</h1>
              <span className="text-[8px] px-2 py-0.5 font-mono font-black bg-stone-100/90 text-[#4e0e15] border border-[#e8dfd5] rounded-sm uppercase tracking-widest flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                UNIFIED ERP
              </span>
            </div>
            <p className="text-[10px] text-[#c5a059] font-mono tracking-widest font-extrabold uppercase mt-0.5">{companyProfile.companyName}</p>
          </div>
        </div>

        {/* Module Nav Switcher (Available once logged in) */}
        {isLoggedIn && (
          <nav className="flex flex-wrap items-center gap-1 bg-stone-50 border border-[#e8dfd5] p-1 rounded-2xl text-xs font-semibold">
            {[
              { id: 'portal', label: t.nav_portal || 'Dashboard Portal', icon: LayoutDashboard },
              { id: 'vazi', label: t.nav_vazi || 'Vazi (Vineyard)', icon: Sprout },
              { id: 'gvino', label: t.nav_gvino || 'Gvino (Winery)', icon: Wine },
              { id: 'audit', label: t.nav_audit || 'Audit Trail', icon: FileText },
              { id: 'settings', label: t.nav_settings || 'Settings', icon: ClipboardList }
            ].map(mod => {
              const Icon = mod.icon;
              const isActive = activeModule === mod.id;
              return (
                <button
                  key={mod.id}
                  onClick={() => {
                    setActiveModule(mod.id as any);
                    if (mod.id === 'gvino') {
                      setActiveTab('dashboard'); // reset winery tab
                    }
                  }}
                  className={`px-3.5 py-1.8 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all duration-200 font-extrabold text-[11px] tracking-wide uppercase ${
                    isActive 
                      ? 'bg-[#4e0e15] text-amber-50 shadow-md scale-105 ring-1 ring-[#801323]/20' 
                      : 'text-stone-600 hover:text-stone-900 hover:bg-[#FAF8F5]/90 hover:scale-[1.02]'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-300' : 'text-[#4e0e15]'}`} />
                  <span className="hidden lg:inline">{mod.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Configuration Utilities & User Widget */}
        <div className="flex items-center gap-3 justify-between md:justify-end">
          <div className="flex items-center gap-1.5 p-1 bg-gradient-to-r from-stone-50 to-stone-100 border border-stone-200/90 rounded-xl shadow-2xs">
            <Languages className="w-3.5 h-3.5 text-[#4e0e15] ml-1.5 shrink-0" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Language)}
              className="text-[10px] font-extrabold bg-transparent text-stone-700 outline-none pr-2 focus:ring-0 select-none border-none py-0 pl-1 pr-7 cursor-pointer uppercase font-mono"
            >
              <option value="en">EN</option>
              <option value="ka">KA</option>
              <option value="it">IT</option>
              <option value="fr">FR</option>
              <option value="de">DE</option>
            </select>
          </div>

          {isLoggedIn && (
            <div className="flex items-center gap-3.5 pl-3.5 border-l border-stone-200">
              <div className="text-right hidden sm:block">
                <span className="font-bold text-xs text-stone-850 block leading-tight">{currentUser.fullName}</span>
                <span className="text-[8px] uppercase font-mono text-[#c5a059] font-extrabold block mt-0.5 tracking-wider">
                  {currentUser.role === 'Viticulturist' ? (t.signin_role_viticulturist || 'Lead Viticulturist') :
                   currentUser.role === 'Winemaker' ? (t.signin_role_winemaker || 'Head Winemaker') :
                   (t.signin_role_owner || 'Owner & ERP Admin')}
                </span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setIsLoggedIn(false);
                  setActiveModule('portal');
                }}
                className="bg-[#faf8f6] hover:bg-rose-50/50 border border-stone-200 text-[#801323] px-3.5 py-1.8 text-[10px] font-mono font-extrabold rounded-xl cursor-pointer transition-all duration-150 uppercase tracking-wider shadow-2xs"
                title="Log Out"
              >
                {t.nav_logout || 'Logout'}
              </motion.button>
            </div>
          )}
        </div>
      </header>

      {/* 2. Main Shell Layout */}
      {!isLoggedIn ? (
        <div className="flex-1 flex items-center justify-center p-6 bg-[#f8f6f2] min-h-[75vh]">
          <div className="w-full max-w-md bg-white border border-stone-200/90 rounded-2xl p-8 shadow-[0_4px_24px_rgba(27,23,21,0.03)] space-y-6 relative overflow-hidden text-stone-600">
            {/* Top design element decorative line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-[#4e0e15]" />
            
            <div className="text-center space-y-2 pt-2">
              <div className="w-12 h-12 bg-[#31070b]/95 text-amber-100 rounded-full flex items-center justify-center shadow-md font-serif font-black text-xl mx-auto border border-[#4e0e15]">
                🍇
              </div>
              <h2 className="text-lg font-serif font-black tracking-widest text-[#1b1715] uppercase mt-3">{t.signin_title || 'VINEA UNIFIED SIGN IN'}</h2>
              <p className="text-[11px] text-stone-400 font-serif italic leading-relaxed">{t.signin_subtitle || 'Unified Vineyard (Vazi) & Winery (Gvino) Cloud Management'}</p>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              setIsLoggedIn(true);
              setActiveModule('portal');
            }} className="space-y-4">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">{t.signin_username || 'Account Username / Email'}</label>
                <input 
                  type="text" 
                  defaultValue="luka_winemaker"
                  className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                  required
                />
              </div>
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">{t.signin_passcode || 'Passcode'}</label>
                <input 
                  type="password" 
                  defaultValue="••••••••"
                  className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none font-bold focus:border-stone-400 transition-colors text-stone-900"
                  required
                />
              </div>

              <button 
                type="submit"
                className="w-full bg-[#4e0e15] hover:bg-[#34070a] text-white font-mono font-bold uppercase tracking-widest py-3 rounded-xl cursor-pointer shadow-sm transition-all duration-155 text-xs mt-2"
              >
                {t.signin_btn || 'Secure Portal Login'}
              </button>
            </form>

            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-stone-150"></div>
              <span className="flex-shrink mx-4 text-[9px] uppercase font-mono text-stone-400 font-extrabold tracking-widest">{t.signin_playgrounds || 'Quick Demo Playgrounds'}</span>
              <div className="flex-grow border-t border-stone-150"></div>
            </div>

            {/* Quick Login Playground Buttons */}
            <div className="grid grid-cols-2 gap-3.5 text-center">
              <button
                type="button"
                onClick={() => {
                  setCurrentUser({
                    username: 'luka_viticulture',
                    email: 'luka.t@vinea.com',
                    fullName: 'Luka Tatrishvili',
                    role: 'Viticulturist',
                    language: 'en'
                  });
                  setIsLoggedIn(true);
                  setActiveModule('vazi');
                }}
                className="p-4 bg-[#fbfbf8] hover:bg-stone-50 hover:shadow-xs border border-stone-200/80 rounded-xl cursor-pointer text-left duration-150 flex flex-col justify-between group transition-all"
              >
                <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-sm group-hover:scale-105 duration-100">🚜</div>
                <div className="mt-3 text-left">
                  <strong className="text-[11px] font-bold block text-stone-850">{t.signin_role_viticulturist || 'Lead Viticulturist'}</strong>
                  <span className="text-[9px] font-mono text-stone-400 font-bold block mt-0.5">Luka Tatrishvili</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setCurrentUser({
                    username: 'sophia_enology',
                    email: 's.rossi@vinea.com',
                    fullName: 'Sophia Rossi',
                    role: 'Winemaker',
                    language: 'en'
                  });
                  setIsLoggedIn(true);
                  setActiveModule('gvino');
                }}
                className="p-4 bg-[#fbfbf8] hover:bg-stone-50 hover:shadow-xs border border-stone-200/80 rounded-xl cursor-pointer text-left duration-150 flex flex-col justify-between group transition-all"
              >
                <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-100 flex items-center justify-center text-sm group-hover:scale-105 duration-100">🍷</div>
                <div className="mt-3 text-left">
                  <strong className="text-[11px] font-bold block text-stone-850">{t.signin_role_winemaker || 'Head Winemaker'}</strong>
                  <span className="text-[9px] font-mono text-stone-400 font-bold block mt-0.5">Sophia Rossi</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      ) : activeModule === 'vazi' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col">
          <VaziModule
            lang={lang}
            currentUser={currentUser}
            blocks={blocks}
            phenologyLogs={phenologyLogs}
            sprays={sprays}
            scoutings={scoutings}
            soilRecords={soilRecords}
            samplings={samplings}
            harvests={harvests}
            irrigationLogs={irrigationLogs}
            fertilizerLogs={fertilizerLogs}
            onAddBlock={handleAddBlock}
            onUpdateBlock={handleUpdateBlock}
            onAddPhenologyLog={handleAddPhenologyLog}
            onAddSprayRecord={handleAddSprayRecord}
            onAddScoutingRecord={handleAddScoutingRecord}
            onAddSamplings={handleAddSamplings}
            onAddHarvestRecord={handleAddHarvestRecord}
            onUpdateHarvestRecord={handleUpdateHarvestRecord}
            onSendHarvestToGvino={handleSendHarvestToGvino}
            onAddIrrigation={handleAddIrrigation}
            onAddFertilizer={handleAddFertilizer}
          />
        </main>
      ) : activeModule === 'portal' ? (
         <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6">
          {/* Main platform Welcome header */}
          <div className="bg-gradient-to-r from-white via-white to-[#fbfaf8] border border-stone-200/90 rounded-2xl p-8 shadow-[0_4px_25px_rgba(78,14,21,0.015)] relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6 text-stone-800 text-xs">
            {/* Elegant side color-stripe indicator */}
            <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-gradient-to-b from-[#801323] to-[#4e0e15]" />
            
            <div className="space-y-1.5 pl-3">
              <span className="text-[9px] uppercase tracking-widest bg-[#fcf8f6] border border-[#e8dfd5] text-[#4e0e15] px-3.5 py-1 rounded-full font-black inline-block">
                📢 {t.portal_hq || 'Estate Headquarters'}
              </span>
              <h2 className="text-2xl font-serif font-black text-stone-900 tracking-tight uppercase leading-none mt-1">{t.portal_welcome || 'Welcome to Vinea'}</h2>
              <p className="text-xs text-stone-550 font-sans mt-1.5">{t.portal_status_p || 'Real-time status indicators across your agricultural blocks & fermentation vats'}</p>
            </div>
            
            <div className="flex flex-wrap gap-2.5 text-[10px] font-mono pl-3 md:pl-0">
              {/* Precision Live Clock */}
              <div className="bg-[#FAF8F5]/85 border border-[#e8dfd5] px-4 py-2.5 rounded-xl text-left shadow-2xs">
                <span className="text-stone-400 block text-[8px] uppercase tracking-widest font-extrabold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
                  Oenology Clock
                </span>
                <strong className="text-stone-850 block mt-1 font-mono font-bold text-[11px] text-[#4e0e15]">
                  {currentUtcTime || 'LOADING UTC...'}
                </strong>
              </div>
              <div className="bg-[#fcfbf9] border border-[#e8dfd5] px-4 py-2.5 rounded-xl text-left">
                <span className="text-stone-400 block text-[8px] uppercase tracking-wider font-extrabold">{t.portal_appellation || 'Active Appellation'}</span>
                <strong className="text-[#c5a059] block mt-0.5 font-serif font-bold">{companyProfile.region != 'Kakheti / Appellation' ? companyProfile.region : (lang === 'ka' ? 'კახეთი / ალაზნის ველი' : companyProfile.region)}, {companyProfile.country === 'Georgia' && lang === 'ka' ? 'საქართველო' : companyProfile.country}</strong>
              </div>
              <div className="bg-[#fcfbf9] border border-[#e8dfd5] px-4 py-2.5 rounded-xl text-left">
                <span className="text-stone-400 block text-[8px] uppercase tracking-wider font-extrabold">{t.portal_role || 'Active Role'}</span>
                <strong className="text-stone-800 block mt-0.5 font-extrabold">
                  {currentUser.role === 'Viticulturist' ? (t.signin_role_viticulturist || 'Lead Viticulturist') :
                   currentUser.role === 'Winemaker' ? (t.signin_role_winemaker || 'Head Winemaker') :
                   (t.signin_role_owner || 'Owner & ERP Admin')}
                </strong>
              </div>
            </div>
          </div>

          {/* Module launch deck bentogrid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-stone-800">
            
            {/* Vazi Module Card */}
            <motion.div 
              whileHover={{ y: -4, shadow: '0 10px 30px rgba(16,185,129,0.06)' }}
              className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-xs duration-300 space-y-4 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-200/80 transition-all cursor-pointer"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-600/10 via-emerald-600/30 to-emerald-600/10" />
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase font-mono bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full font-black border border-emerald-100">
                    ✨ {t.portal_module_agri || 'Agricultural Module'}
                  </span>
                  <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 font-mono">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    LIVE FROM FIELDS
                  </span>
                </div>
                
                <h3 className="text-xl font-serif font-black text-stone-900 leading-tight flex items-center gap-2">🚜 {t.portal_vazi_title || 'Vazi Vineyard Operations'}</h3>
                <p className="text-xs text-stone-500 leading-relaxed font-medium">
                  {t.portal_vazi_desc || 'Trace canopy development, heat sum Growing Degree Days predictions, scouting downy/powdery pathogens, and pre-harvest grape sugar maturation curves.'}
                </p>

                {/* Sub-metrics */}
                <div className="grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 font-mono text-[10px] text-stone-550">
                  <div>
                    <span className="text-[8px] uppercase text-stone-400 block pb-0.5">{t.portal_blocks_count || 'Registered Blocks'}</span>
                    <strong className="text-xs text-stone-850 font-bold block mt-0.5">{blocks.length} {lang === 'ka' ? 'ნაკვეთი' : 'Sectors'}</strong>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase text-stone-400 block pb-0.5">{t.portal_total_area || 'Total Area'}</span>
                    <strong className="text-xs text-stone-850 font-bold block mt-0.5">{blocks.reduce((acc,b) => acc + b.area, 0).toFixed(1)} ha</strong>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase text-stone-400 block pb-0.5 font-bold">{t.portal_scout_status || 'Scouting Reports'}</span>
                    <strong className="text-xs text-emerald-800 font-bold block mt-0.5">🌿 {t.portal_scout_healthy || 'Canopy Healthy'}</strong>
                  </div>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveModule('vazi')}
                className="w-full mt-4 bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase tracking-wider py-3 rounded-xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs"
              >
                {t.portal_launch_vazi || 'Launch Vazi Management'} →
              </motion.button>
            </motion.div>



            {/* Gvino Module Card */}
            <motion.div 
              whileHover={{ y: -4, shadow: '0 10px 30px rgba(78,14,21,0.06)' }}
              className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-xs duration-300 space-y-4 flex flex-col justify-between relative overflow-hidden group hover:border-rose-200/80 transition-all cursor-pointer"
            >
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#4e0e15]/10 via-[#4e0e15]/30 to-[#4e0e15]/10" />
              <div className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase font-mono bg-rose-50 text-rose-850 px-3 py-1 rounded-full font-black border border-rose-100">
                    🍇 {t.portal_module_wine || 'Winery & Oenology'}
                  </span>
                  <span className="flex items-center gap-1 text-[9px] font-bold text-amber-600 font-mono">
                    <span className="h-2 w-2 rounded-full bg-amber-550 animate-pulse"></span>
                    MONITORING MARANI
                  </span>
                </div>
                
                <h3 className="text-xl font-serif font-black text-[#4e0e15] leading-tight flex items-center gap-2">🍷 {t.portal_gvino_title || 'Gvino Cellar & Production'}</h3>
                <p className="text-xs text-stone-500 leading-relaxed font-medium">
                  {t.portal_gvino_desc || 'Manage stainless steel fermenters fill index, direct transfers log, lab Free & Total SO2 levels, additives calibration, and the Winemaker AI assistant.'}
                </p>

                {/* Sub-metrics */}
                <div className="grid grid-cols-3 gap-3 border-t border-stone-100 pt-4 font-mono text-[10px] text-stone-550 font-bold">
                  <div>
                    <span className="text-[8px] uppercase text-stone-400 block font-normal pb-0.5">{t.portal_total_capacity || 'Total Capacity'}</span>
                    <strong className="text-xs text-stone-850 font-bold block mt-0.5">{vessels.reduce((acc,v) => acc + v.capacity, 0).toLocaleString()} L</strong>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase text-stone-400 block font-normal pb-0.5">{t.portal_active_lots || 'Active Lots'}</span>
                    <strong className="text-xs text-stone-850 font-bold block mt-0.5">{lots.length} {lang === 'ka' ? 'ჯიში' : 'Varieties'}</strong>
                  </div>
                  <div>
                    <span className="text-[8px] uppercase text-stone-400 block font-normal pb-0.5">{t.portal_fermenting_vessels || 'Fermenting'}</span>
                    <strong className="text-xs text-amber-600 font-bold block mt-0.5">🔥 {lots.filter(l => l.stage === 'fermenting').length} {lang === 'ka' ? 'ჭურჭელი' : 'Vessels'}</strong>
                  </div>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  setActiveModule('gvino');
                  setActiveTab('dashboard');
                }}
                className="w-full mt-4 bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase tracking-wider py-3 rounded-xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs"
              >
                {t.portal_launch_gvino || 'Launch Gvino Winemaking'} →
              </motion.button>
            </motion.div>

          </div>

          {/* Quick Joint Operational Dashboard Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-stone-850 text-xs">
            
            {/* Combined Tasks list */}
            <div className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-2xs space-y-4">
              <h4 className="font-serif font-black text-sm text-[#4e0e15] border-b border-stone-100 pb-3 flex items-center gap-1.5 uppercase text-[11px] tracking-wider">
                📋 {t.portal_tasklist || 'Unified Operations Tasklist Checklist'}
              </h4>
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {tasks.map(task => (
                  <div key={task.id} className="flex items-start gap-2.5 border-b border-stone-50 pb-2.5 last:border-0 font-medium">
                    <input 
                      type="checkbox" 
                      checked={task.status === 'completed'}
                      onChange={() => {
                        setTasks(prev => prev.map(t => {
                          if (t.id === task.id) {
                            return { ...t, status: t.status === 'completed' ? 'pending' : 'completed' };
                          }
                          return t;
                        }));
                      }}
                      className="mt-0.5 accent-emerald-800 cursor-pointer h-3.5 w-3.5 rounded border-stone-300"
                    />
                    <div className="flex-grow">
                      <span className={`block font-bold text-stone-800 text-xs ${task.status === 'completed' ? 'line-through text-stone-400 font-normal' : ''}`}>{task.title}</span>
                      <span className="block text-[9px] font-mono text-slate-400 font-medium">
                        {t.task_assign || 'Assignee'}: {task.assignedTo || 'Unassigned'} • {t.task_due || 'Due Date'}: {task.dueDate} • {t.task_priority || 'Priority'}: <span className="uppercase font-bold text-red-700">{task.priority === 'high' ? (t.task_high || 'High') : task.priority === 'medium' ? (t.task_med || 'Medium') : (t.task_low || 'Low')}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Corporate audit logs ledger ticker */}
            <div className="p-6 bg-white border border-[#e8dfd5] rounded-3xl shadow-2xs space-y-4">
              <h4 className="font-serif font-black text-xs text-[#4e0e15] border-b border-stone-100 pb-3 flex items-center gap-1.5 uppercase tracking-wider">
                🛡️ {t.portal_audit_history || 'Immutable Audit Trail Ledger History'}
              </h4>
              
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
                {auditLogs.map(log => (
                  <div key={log.id} className="p-3 bg-stone-50/50 border border-stone-200 rounded-xl space-y-1 hover:border-emerald-250 transition-all font-sans text-xs">
                    <div className="flex justify-between items-center text-[9px] text-slate-400 font-mono">
                      <span>{new Date(log.timestamp).toLocaleTimeString()} • {t.audit_col_user || 'Operator'} {log.user}</span>
                      <span className="bg-stone-250/55 text-stone-600 px-1.5 py-0.2 rounded uppercase font-extrabold text-[8px]">{log.module === 'VAZI' ? (t.nav_vazi || 'Vazi') : (t.nav_gvino || 'Gvino')}</span>
                    </div>
                    <strong className="block text-stone-850 font-bold font-serif text-stone-900">{log.actionType}</strong>
                    <p className="text-stone-500 text-[10.5px] leading-relaxed font-semibold">{log.notes}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </main>
      ) : activeModule === 'settings' ? (
        <main className="flex-1 max-w-4xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6 font-sans text-stone-700 text-xs">
          <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in">
            <div>
              <h3 className="text-md font-serif font-black text-[#4e0e15] border-b border-stone-100 pb-2 uppercase tracking-wide">
                🏠 {t.settings_title || 'Company & User Profile Preferences'}
              </h3>
              <p className="text-[10px] text-slate-450 mt-1">
                {lang === 'ka' ? 'კომპანიის პარამეტრების, ლოკალიზაციისა და როლების მართვა' : 'Configure company profiles, localization formats and operational user permissions'}
              </p>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              setCompanyProfile({
                companyName: fd.get('companyName') as string,
                wineryName: fd.get('wineryName') as string,
                country: fd.get('country') as string,
                region: fd.get('region') as string,
                municipality: fd.get('municipality') as string,
                address: fd.get('address') as string,
                contactEmail: fd.get('contactEmail') as string,
                phone: fd.get('phone') as string,
                website: fd.get('website') as string,
                measurementUnits: fd.get('units') as any,
                latitude: parseFloat(fd.get('latitude') as string) || 41.9056,
                longitude: parseFloat(fd.get('longitude') as string) || 45.4740
              });
              setToastMessage(lang === 'ka' ? 'კონფიგურაცია წარმატებით შეინახა!' : 'Configurations saved successfully!');
            }} className="space-y-4">
              
              <h4 className="text-[9px] uppercase font-mono border-l-2 border-[#4e0e15] pl-2 font-black tracking-wider text-slate-400">
                {lang === 'ka' ? 'საწარმოს ოფიციალური რეკვიზიტები' : 'Agricultural Corporate Enterprise Specifications'}
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_co_name || 'Company Operating Name'}</label>
                  <input type="text" name="companyName" defaultValue={companyProfile.companyName} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-800 font-bold outline-none" required />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_winery_name || 'Headquarters Winery Name'}</label>
                  <input type="text" name="wineryName" defaultValue={companyProfile.wineryName} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-800 font-bold outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_country || 'Country'}</label>
                  <input type="text" name="country" defaultValue={companyProfile.country} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_region || 'PDO Region'}</label>
                  <input type="text" name="region" defaultValue={companyProfile.region} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{t.settings_district || 'District'}</label>
                  <input type="text" name="municipality" defaultValue={companyProfile.municipality} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-bold">{t.settings_email || 'Contact Email'}</label>
                  <input type="email" name="contactEmail" defaultValue={companyProfile.contactEmail} className="w-full bg-stone-50 border border-[#e8dfd5] p-2 rounded outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-bold">{t.settings_phone || 'Hotline Phone'}</label>
                  <input type="text" name="phone" defaultValue={companyProfile.phone} className="w-full bg-stone-50 border border-[#e8dfd5] p-2 rounded outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-bold">{t.settings_units || 'Standard Measurement Units'}</label>
                  <select name="units" defaultValue={companyProfile.measurementUnits} className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-bold text-stone-900">
                    <option value="metric">{t.settings_unit_metric || 'Metric (L, kg, °C, ha)'}</option>
                    <option value="imperial">{t.settings_unit_us || 'US Customary (gal, lb, °F, acre)'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ფიზიკური მისამართი' : 'Company Physical Street Address'}</label>
                <input type="text" name="address" defaultValue={companyProfile.address} className="w-full bg-stone-50 border border-[#e8dfd5] p-2 rounded outline-none font-semibold text-stone-850" />
              </div>

              {/* Precise Coordinates override because GPS in browsers can be imprecise */}
              <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-xl space-y-2">
                <span className="text-[9px] font-mono uppercase bg-amber-200 text-amber-950 px-2.5 py-1 rounded font-black tracking-wider inline-block">
                  {lang === 'ka' ? 'სათავო ოფისის GPS კოორდინატები' : 'Precise Manual Coordinates Control'}
                </span>
                <p className="text-[10px] leading-relaxed text-stone-600">
                  {lang === 'ka' 
                    ? 'ვებ ბრაუზერებში GPS სიზუსტე შეიძლება არასანდო იყოს. გთხოვთ ხელით მიუთითოთ ზუსტი კოორდინატები სატელიტური ამინდისა და დაავადებების რისკების სწორი მოდელირებისთვის.' 
                    : 'System GPS location can be inaccurate inside web sandboxes. Explicitly defining manual coordinates enables highly granular satellite weather analysis and precise mildew risk indexing.'}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">Manual Latitude</label>
                    <input 
                      type="number" 
                      step="0.0001" 
                      name="latitude" 
                      defaultValue={companyProfile.latitude ?? 41.9056} 
                      className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-800 font-mono outline-none focus:border-amber-500" 
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">Manual Longitude</label>
                    <input 
                      type="number" 
                      step="0.0001" 
                      name="longitude" 
                      defaultValue={companyProfile.longitude ?? 45.4740} 
                      className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-800 font-mono outline-none focus:border-amber-500" 
                    />
                  </div>
                </div>
              </div>

              <hr className="border-stone-100" />

              <h4 className="text-[9px] uppercase font-mono border-l-2 border-emerald-800 pl-2 font-black tracking-wider text-slate-400">
                {lang === 'ka' ? 'ოპერატორის პერსონალური პროფილი და როლი' : 'Operator Profile and Clearance Privileges'}
              </h4>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">{lang === 'ka' ? 'ოპერატორის სრული სახელი' : 'Operator Full Name'}</label>
                  <input 
                    type="text" 
                    defaultValue={currentUser.fullName} 
                    onChange={(e) => setCurrentUser({ ...currentUser, fullName: e.target.value })}
                    className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded text-stone-900 font-bold outline-none" 
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-[#4e0e15] font-bold">{lang === 'ka' ? 'აქტიური უფლებამოსილების როლი' : 'Simulated Clearance Role Privilege'}</label>
                  <select 
                    value={currentUser.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as any;
                      setCurrentUser({ ...currentUser, role: nextRole });
                      setToastMessage(lang === 'ka' ? `აქტიური როლი განახლდა: ${nextRole}` : `Simulated active clearance configured to ${nextRole}`);
                    }}
                    className="w-full bg-stone-50 border border-[#e8dfd5] p-2.5 rounded outline-none font-extrabold text-[#4e0e15]"
                  >
                    <option value="Owner/Admin">👑 {t.signin_role_owner || 'Owner & ERP Admin'}</option>
                    <option value="Viticulturist">🚜 {t.signin_role_viticulturist || 'Lead Viticulturist'}</option>
                    <option value="Winemaker">🍷 {t.signin_role_winemaker || 'Head Winemaker'}</option>
                  </select>
                </div>
              </div>

              <button 
                type="submit"
                className="w-full bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-xs cursor-pointer shadow-xs transition-colors"
              >
                {t.settings_save || 'Save Configurations'}
              </button>
            </form>
          </div>
        </main>
      ) : activeModule === 'audit' ? (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col space-y-6 font-sans text-stone-700 text-xs text-stone-850">
          <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-4">
            <div>
              <span className="text-[9px] uppercase tracking-widest bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded font-bold">PDO Traceability</span>
              <h3 className="text-xl font-serif font-black text-stone-905 uppercase mt-1">
                🛡️ {t.audit_title || 'SaaS Corporate Action Audit Trails'}
              </h3>
              <p className="text-xs text-stone-400 font-semibold mt-0.5">
                {t.audit_subtitle || 'Chronological action logs ledger strictly verifying viticultural and winemaking authenticity'}
              </p>
            </div>

            <div className="overflow-x-auto border border-stone-100 rounded-xl">
              <table className="w-full text-left text-xs text-stone-605 border-collapse">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#e8dfd5] text-[9px] font-mono uppercase text-slate-400 font-bold">
                    <th className="p-3">{t.audit_col_ts || 'Timestamp UTC'}</th>
                    <th className="p-3">{t.audit_col_module || 'System Module'}</th>
                    <th className="p-3">{t.audit_col_user || 'Operator User'}</th>
                    <th className="p-3">{t.audit_col_action || 'Action Class'}</th>
                    <th className="p-3">{t.audit_col_item || 'Scope Object'}</th>
                    <th className="p-3">{t.notes || 'Notes'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 font-mono text-[11px] font-medium text-stone-800">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-stone-50/50 duration-75">
                      <td className="p-3 text-slate-400">{new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString()}</td>
                      <td className="p-3 font-serif font-bold uppercase"><span className="px-2 py-0.5 bg-[#FAF8F5]/80 text-[#4e0e15] border border-stone-150 rounded">{log.module === 'VAZI' ? (t.nav_vazi || 'Vazi') : (t.nav_gvino || 'Gvino')}</span></td>
                      <td className="p-3 text-emerald-900 font-sans font-extrabold">{log.user}</td>
                      <td className="p-3 font-bold text-stone-900">{log.actionType}</td>
                      <td className="p-3 font-sans text-stone-700 font-semibold">{log.changedItem}</td>
                      <td className="p-3 text-[11px] text-stone-500 font-sans leading-relaxed">{log.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col lg:flex-row gap-6">
          
          {/* Sidebar Tabs */}
          <aside className={`${isSidebarCollapsed ? 'w-full lg:w-20' : 'w-full lg:w-64'} transition-all duration-300 space-y-1.5 shrink-0 bg-white lg:bg-transparent p-4 lg:p-0 rounded-xl border border-[#e8dfd5] lg:border-none shadow-sm lg:shadow-none`}>
          
          {/* Header area with close/collapse button on desktop */}
          <div className="hidden lg:flex items-center justify-between px-2.5 py-2 border-b border-[#e8dfd5]/60 mb-2">
            {!isSidebarCollapsed && <span className="text-[10px] font-mono text-stone-500 uppercase tracking-widest font-bold">Winery Menu</span>}
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="ml-auto p-1.5 text-[#4e0e15] hover:bg-stone-100 rounded-md transition-all cursor-pointer"
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
          
          {/* Mobile toggle helper */}
          <div className="flex lg:hidden items-center justify-between border-b border-dashed border-[#e8dfd5]/60 pb-2 mb-2">
            <span className="text-xs font-serif font-bold text-[#4e0e15]">Menu Options</span>
            <button 
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="px-2 py-1 bg-stone-100 hover:bg-stone-200 text-[#4e0e15] rounded text-[10px] font-mono font-bold"
            >
              {isSidebarCollapsed ? "Show Names" : "Icons Only"}
            </button>
          </div>

          {[
            { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard },
            { id: 'vessels', label: t.tanks, icon: Container },
            { id: 'lots', label: t.wine_lots, icon: Wine },
            { id: 'transfers', label: t.transfers, icon: GitCommit },
            { id: 'fermentation', label: t.fermentation, icon: Activity },
            { id: 'labs', label: t.lab_analysis, icon: TestTube },
            { id: 'calculators', label: t.calculators, icon: TestTube }, 
            { id: 'inventory', label: t.inventory, icon: Boxes },
            { id: 'tasks', label: t.tasks, icon: ClipboardList },
            { id: 'notes', label: t.notes, icon: FileText },
            { id: 'ai', label: t.ai_assistant, icon: BrainCircuitIcon }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                className={`w-full flex items-center px-3.5 py-2.5 rounded-lg text-xs font-semibold font-sans tracking-wide cursor-pointer transition-all ${
                  isSidebarCollapsed ? 'justify-start lg:justify-center' : 'justify-start'
                } ${
                  isActive 
                    ? 'bg-[#4e0e15] text-[#fbf9f6] shadow' 
                    : 'bg-white hover:bg-[#f5efe9] text-stone-700 hover:text-stone-900 border border-[#e8dfd5]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isSidebarCollapsed ? 'lg:mr-0 mr-3' : 'mr-3'} ${isActive ? 'text-amber-400' : 'text-[#4e0e15]'}`} />
                <span className={`${isSidebarCollapsed ? 'lg:hidden block' : 'block'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </aside>

        {/* Content Tabs Area */}
        <section className="flex-1 min-w-0 space-y-4">
          
          {/* A. DASHBOARD TAB */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6 animate-fade-in text-stone-800">
              
              {/* Quick Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-center">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">{t.total_volume}</span>
                  <strong className="text-xl font-serif font-black text-[#801323] block mt-1">{totalLotsVolume.toLocaleString()} L</strong>
                </div>
                <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-center">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">{t.total_tanks}</span>
                  <strong className="text-xl font-serif font-semibold text-[#4e0e15] block mt-1">{totalTanksCount} ({occupiedTanksCount} ocup)</strong>
                </div>
                <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-center">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">{t.active_ferms}</span>
                  <strong className="text-xl font-serif font-semibold text-amber-600 block mt-1">{activeFermsCount}</strong>
                </div>
                <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-center">
                  <span className="text-[10px] uppercase font-mono text-slate-400 block">{t.temperature}</span>
                  <strong className="text-xl font-serif font-semibold text-emerald-700 block mt-1">{avgTemp} °C Avg</strong>
                </div>
              </div>

              {/* D3 Analytics Dashboard Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* 1. Cellar Vessel utilization graph */}
                <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800 space-y-3">
                  <div className="border-b border-indigo-50/50 pb-2 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-serif font-bold text-[#4e0e15]">Cellar Vessel Utilization</h3>
                      <p className="text-[10px] text-slate-400">D3 Dynamic capacity vs active liquid volume tracking</p>
                    </div>
                    <span className="text-[9px] font-mono bg-[#fdfbfc] border border-[#f5ece4] px-1.5 py-0.5 rounded text-[#4e0e15] uppercase font-bold">Cellar D3</span>
                  </div>
                  <TankCapacityChart tanks={mappedTanks} onSelectTank={setSelectedTankId} selectedTankId={selectedTankId} />
                </div>

                {/* 2. Fermentation kinetics curve */}
                <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800 space-y-3">
                  <div className="border-b border-indigo-50/50 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-serif font-bold text-[#4e0e15]">Kinetics & Sugar Degradation</h3>
                      <p className="text-[10px] text-slate-400">D3 Live dual-axis fermentation kinetic tracker</p>
                    </div>
                    <select
                      value={chartLotId}
                      onChange={(e) => setChartLotId(e.target.value)}
                      className="text-[10px] font-bold px-2 py-0.5 bg-[#FAF8F5] border border-slate-200 rounded outline-none w-full sm:w-40 cursor-pointer text-slate-800"
                    >
                      {Array.from(new Set(fermLogs.map(l => l.lotId))).map(lId => {
                        const associatedLot = lots.find(lt => lt.id === lId);
                        return (
                          <option key={lId} value={lId}>
                            {associatedLot ? associatedLot.name : lId}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <FermentationCurveChart logs={fermLogs} selectedLotId={chartLotId} />
                </div>

              </div>

              {/* Chemical Alerts Panel */}
              {(lowSO2Alerts.length > 0 || highVAAlerts.length > 0) && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
                  <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1">
                    <ShieldAlert className="w-4 h-4 text-rose-500" /> Winery Safety & Chemistry Alerts
                  </h4>
                  <ul className="text-xs text-rose-700 space-y-1.5 list-disc pl-4 font-sans">
                    {lowSO2Alerts.map((log, i) => (
                      <li key={i}>
                        Lab Reading Warning: Wine Lot &quot;{log.lotId}&quot; has low active Free SO₂ ({log.freeSo2} mg/L). Risk of microbial infection or juice browning. Action KMBS correction!
                      </li>
                    ))}
                    {highVAAlerts.map((log, i) => (
                      <li key={i}>
                        Acetation Alert: Volatile Acidity warning for Lot &quot;{log.lotId}&quot; ({log.volatileAcid} g/L). Risk of ethyl acetate formation. Inspect lid seal.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Grid 2 components: Recents */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Pending Tasks list */}
                <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm">
                  <h4 className="text-sm font-serif font-bold text-[#4e0e15] border-b border-slate-100 pb-2 mb-3">{t.upcoming_tasks}</h4>
                  <div className="space-y-2.5">
                    {tasks.map(task => (
                      <div key={task.id} className="flex items-start gap-2 text-xs">
                        <input 
                          type="checkbox" 
                          checked={task.status === 'completed'}
                          onChange={() => handleToggleTaskStatus(task.id)}
                          className="mt-0.5 cursor-pointer accent-[#4e0e15]"
                        />
                        <div className="flex-1">
                          <span className={`block font-semibold ${task.status === 'completed' ? 'line-through text-slate-300' : 'text-slate-700'}`}>{task.title}</span>
                          <span className="text-[10px] text-slate-400 font-medium block">Due: {task.dueDate} • Assigned: {task.assignedTo}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recent Daily Ferment log tracker */}
                <div className="p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800">
                  <h4 className="text-sm font-serif font-bold text-[#4e0e15] border-b border-slate-100 pb-2 mb-3">Recent Fermentation Tracking Logs</h4>
                  <div className="space-y-3">
                    {fermLogs.slice(0, 3).map(log => (
                      <div key={log.id} className="text-xs pb-2 border-b border-dashed border-slate-100">
                        <div className="flex items-center justify-between font-bold text-slate-700">
                           <span>{log.lotId}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{log.date}</span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1">Temp: {log.temperature}°C | Density: {log.density} | Notes: {log.tastingNotes}</p>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* B. VESSELS TAB */}
          {activeTab === 'vessels' && (
            <div className="space-y-4 text-stone-800">
              <TanksVessels lang={lang} vessels={vessels} lots={lots} onUpdateVessels={setVessels} onSelectTank={setSelectedTankId} selectedTankId={selectedTankId} />
            </div>
          )}

          {/* C. WINE LOTS TAB */}
          {activeTab === 'lots' && (
            <WineLotsTrace lang={lang} lots={lots} onUpdateLots={setLots} />
          )}

          {/* D. TRANSFERS & BLENDS */}
          {activeTab === 'transfers' && (
            <TransfersTab lang={lang} vessels={vessels} lots={lots} onUpdateVessels={setVessels} onUpdateLots={setLots} />
          )}

          {/* E. FERMENTATION FOLLOWUP */}
          {activeTab === 'fermentation' && (
            <FermentationTab 
              lang={lang}
              vessels={vessels}
              lots={lots}
              fermLogs={fermLogs}
              onUpdateLots={setLots}
              onUpdateVessels={setVessels}
              onUpdateFermLogs={setFermLogs}
            />
          )}

          {/* F. LAB ANALYSIS TIMELINES */}
          {activeTab === 'labs' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-stone-800">
              
              {/* Lab Add entry */}
              <div className="md:col-span-1 p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm">
                <h3 className="text-sm font-serif font-bold text-[#4e0e15] border-b border-slate-100 pb-2 mb-4">Add Lab Readings</h3>
                <form onSubmit={handleAddLabLog} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Wine Lot Code</label>
                    <select
                      required
                      value={labLotId}
                      onChange={(e) => setLabLotId(e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                    >
                      <option value="">-- Choose Lot --</option>
                      {lots.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Vessel Tank</label>
                    <select
                      required
                      value={labTankId}
                      onChange={(e) => setLabTankId(e.target.value)}
                      className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                    >
                      <option value="">-- Choose Vessel --</option>
                      {vessels.filter(v => v.currentVolume > 0).map(v => (
                        <option key={v.id} value={v.id}>{v.id}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">ABV% v/v</label>
                      <input 
                        type="number" step="0.1" value={labABV}
                        onChange={(e) => setLabABV(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Volatile Acid (VA g/L)</label>
                      <input 
                        type="number" step="0.01" value={labVA}
                        onChange={(e) => setLabVA(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Free SO₂ mg/L</label>
                      <input 
                        type="number" value={labFSO2}
                        onChange={(e) => setLabFSO2(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Total SO₂ mg/L</label>
                      <input 
                        type="number" value={labTSO2}
                        onChange={(e) => setLabTSO2(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Sugar residual (g/L)</label>
                      <input 
                        type="number" step="0.1" value={labResidualSugar}
                        onChange={(e) => setLabResidualSugar(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Lactic Acid (g/L)</label>
                      <input 
                        type="number" step="0.1" value={labLactic}
                        onChange={(e) => setLabLactic(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Titratable Acidity (TA g/L)</label>
                      <input 
                        type="number" step="0.1" value={labTA}
                        onChange={(e) => setLabTA(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-0.5">Turbidity (NTU)</label>
                      <input 
                        type="number" value={labTurbidity}
                        onChange={(e) => setLabTurbidity(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border rounded bg-[#FAF8F5]"
                      />
                    </div>
                  </div>
                  <button 
                    type="submit"
                    className="w-full py-1.5 bg-[#4e0e15] hover:bg-[#6b151e] text-white text-xs font-semibold rounded cursor-pointer"
                  >
                    Commit Lab Reads
                  </button>
                </form>
              </div>

              {/* Lab reports database */}
              <div className="md:col-span-2 p-5 bg-white border border-[#e8dfd5] rounded-xl shadow-sm text-stone-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <h3 className="text-sm font-serif font-bold text-[#4e0e15]">Lab Chemical History Log</h3>
                  <span className="text-xs text-slate-500 font-mono">
                    Total: {labLogs.length} records
                  </span>
                </div>

                {/* Filters section */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#FAF8F5] p-3.5 border border-[#e8dfd5] rounded-xl">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-500 font-bold mb-1">
                      Filter Wine Type / Class
                    </label>
                    <select
                      value={labFilterType}
                      onChange={(e) => setLabFilterType(e.target.value)}
                      className="px-2 py-1 text-xs border border-stone-200 rounded-lg bg-white text-stone-705 outline-none w-full"
                    >
                      <option value="all">🍷 All Wine Classes</option>
                      <option value="red">🔴 Red Wine</option>
                      <option value="white">🟡 White Wine</option>
                      <option value="rose">💗 Rosé Wine</option>
                      <option value="amber">🟠 Amber / Traditional</option>
                      <option value="sparkling">🫧 Sparkling</option>
                      <option value="fortified">🥃 Fortified / Base</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-500 font-bold mb-1">
                      Filter Age / Vintage
                    </label>
                    <select
                      value={labFilterAge}
                      onChange={(e) => setLabFilterAge(e.target.value)}
                      className="px-2 py-1 text-xs border border-stone-200 rounded-lg bg-white text-stone-750 outline-none w-full"
                    >
                      <option value="all">📅 All Vintages / Ages</option>
                      <option value="young">🌱 Young (&lt; 1 Year)</option>
                      <option value="aging">🍇 Aging (1-2 Years)</option>
                      <option value="aged">🪵 Barrel Reserve (3+ Years)</option>
                      <option value="2025">Vintage 2025</option>
                      <option value="2024">Vintage 2024</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                  {labLogs
                    .filter(log => {
                      const lot = lots.find(l => l.id === log.lotId);
                      if (!lot) return true;
                      
                      // Type filter
                      if (labFilterType !== 'all') {
                        if (lot.wineClass !== labFilterType) return false;
                      }

                      // Age filter
                      if (labFilterAge !== 'all') {
                        // Current mock year is 2026
                        const computedAgeYears = 2026 - lot.vintage;
                        if (labFilterAge === 'young') {
                          if (computedAgeYears > 1) return false;
                        } else if (labFilterAge === 'aging') {
                          if (computedAgeYears !== 2) return false;
                        } else if (labFilterAge === 'aged') {
                          if (computedAgeYears < 3) return false;
                        } else {
                          if (lot.vintage.toString() !== labFilterAge) return false;
                        }
                      }
                      return true;
                    })
                    .map(log => {
                      const lowSo2 = log.freeSo2 < 15;
                      const highVa = log.volatileAcid > 0.8;
                      const lot = lots.find(l => l.id === log.lotId);

                      return (
                        <div key={log.id} className={`p-4 border rounded-lg ${lowSo2 || highVa ? 'border-rose-300 bg-rose-50/20' : 'border-slate-100 bg-slate-50'}`}>
                          <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[#801323]">🍷</span>
                              <span>{lot ? lot.name : log.lotId} ({log.tankId})</span>
                              <span className="px-1.5 py-0.5 text-[9px] font-bold text-slate-400 bg-slate-200/55 rounded uppercase">
                                {lot ? lot.wineClass : 'Unknown'}
                              </span>
                              <span className="px-1.5 py-0.5 text-[9px] font-mono text-indigo-700 bg-indigo-50 rounded">
                                {lot ? `${lot.vintage} Vintage` : ''}
                              </span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">{log.date}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-3 text-[10px] text-slate-500 font-mono mt-3">
                            <div>ABV%: <strong className="text-slate-800 font-bold block">{log.alcoholPct}% vol</strong></div>
                            <div>Free SO₂: <strong className={`block ${lowSo2 ? 'text-red-600 font-black' : 'text-slate-800'}`}>{log.freeSo2} mg/L {lowSo2 && '⚠️ LOW!'}</strong></div>
                            <div>Volatile Acid: <strong className={`block ${highVa ? 'text-red-600 font-black' : 'text-slate-800'}`}>{log.volatileAcid} g/L {highVa && '⚠️ HIGH!'}</strong></div>
                            <div>Titratable Acid: <strong className="text-[#4e0e15] font-black block">{log.titratableAcidity !== undefined ? log.titratableAcidity : 6.0} g/L</strong></div>
                            <div>Sugar raw: <strong className="text-slate-800 block">{log.residualSugar} g/L</strong></div>
                            <div>Malic: <strong className="text-slate-800 block">{log.malicAcid} g/L</strong></div>
                            <div>Lactic: <strong className="text-slate-800 block">{log.lacticAcid} g/L</strong></div>
                            <div>Turbidity: <strong className="text-slate-800 block">{log.turbidity !== undefined ? log.turbidity : 20} NTU</strong></div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

            </div>
          )}

          {/* G. WINEMAKING CALCULATORS */}
          {activeTab === 'calculators' && (
            <EnoCalculators lang={lang} />
          )}

          {/* H. RAW INVENTORY STOCK */}
          {activeTab === 'inventory' && (
            <InventoryTab inventory={inventory} onUpdateInventory={setInventory} />
          )}

          {/* I. AI ASSISTANT WINEMAKER */}
          {activeTab === 'ai' && (
            <AiWinemaker 
              lang={lang} 
              cellarState={{
                tanksCount: totalTanksCount,
                activeFermsCount,
                avgTemp,
                lowSo2Count: lowSO2Alerts.length,
                highVaCount: highVAAlerts.length,
                sampleData: vessels.filter(v => v.currentVolume > 0).map(v => {
                  const lot = lots.find(l => l.id === v.assignedLotId);
                  return {
                    id: v.id,
                    lotCode: v.assignedLotId || 'None',
                    currentVolume: v.currentVolume,
                    wineName: lot ? lot.name : 'Unknown',
                    stage: lot ? lot.stage : 'None'
                  };
                })
              }}
            />
          )}

          {/* J. CELLAR TASKS */}
          {activeTab === 'tasks' && (
            <div className="space-y-6 animate-fade-in text-stone-800">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
                <div>
                  <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
                    <ClipboardList className="h-5 w-5 text-[#801323]" />
                    {t.tasks}
                  </h3>
                  <p className="text-xs text-slate-400">Track winemaker schedule, priority corrections, and cellar activities</p>
                </div>
                
                {/* Stats */}
                <div className="flex items-center gap-3">
                  <div className="px-3 py-1.5 bg-rose-50 border border-rose-200/50 rounded-lg text-center">
                    <span className="text-[9px] text-rose-800 font-mono uppercase font-bold block">Active</span>
                    <strong className="text-sm font-serif font-bold text-rose-700 block">{tasks.filter(t => t.status === 'pending').length}</strong>
                  </div>
                  <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-150 rounded-lg text-center">
                    <span className="text-[9px] text-emerald-800 font-mono uppercase font-bold block">Finished</span>
                    <strong className="text-sm font-serif font-bold text-emerald-600 block">{tasks.filter(t => t.status === 'completed').length}</strong>
                  </div>
                </div>
              </div>

              {/* Form and List Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Task Form */}
                <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4">
                  <h4 className="font-serif font-bold text-sm text-[#4e0e15] border-b border-stone-100 pb-2">Schedule Cellar Task</h4>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const formData = new FormData(form);
                    const title = formData.get('title') as string;
                    const priority = formData.get('priority') as 'high' | 'medium' | 'low';
                    const dueDate = formData.get('dueDate') as string;
                    const description = formData.get('description') as string;
                    if (title.trim()) {
                      handleAddNewTask(title, priority, dueDate, description);
                      form.reset();
                    }
                  }} className="space-y-3.5 text-xs text-stone-600 font-sans">
                    <div>
                      <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Task Title *</label>
                      <input 
                        type="text" 
                        name="title"
                        placeholder="e.g. Pumpover Lot CS-2025-01"
                        className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2.5 py-2 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Priority</label>
                        <select 
                          name="priority"
                          className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 text-stone-700 outline-none text-xs"
                          defaultValue="medium"
                        >
                          <option value="high">🔴 High Priority</option>
                          <option value="medium">🟡 Medium Priority</option>
                          <option value="low">⚪ Low Priority</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Due Date</label>
                        <input 
                          type="date" 
                          name="dueDate"
                          className="w-full bg-white border border-[#e8dfd5] rounded-lg px-2 py-1 text-stone-700 text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase font-mono block mb-1 font-semibold text-stone-500">Description / Details</label>
                      <textarea 
                        name="description"
                        placeholder="e.g. Pump grape cap 2x daily, check sugar density readings."
                        className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-20 text-stone-800 focus:outline-[#801323] outline-none text-xs"
                      />
                    </div>

                    <button 
                      type="submit"
                      className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 rounded-lg font-bold uppercase transition-all duration-200 cursor-pointer text-xs"
                    >
                      Assign Task Directive
                    </button>
                  </form>
                </div>

                {/* Task List */}
                <div className="lg:col-span-2 space-y-4">
                  
                  {/* Active List */}
                  <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4">
                    <h4 className="font-serif font-bold text-sm text-[#4e0e15] flex items-center justify-between">
                      <span>Pending Directives</span>
                      <span className="text-[10px] font-mono text-slate-400 font-normal">{tasks.filter(t => t.status === 'pending').length} tasks remaining</span>
                    </h4>

                    <div className="space-y-3">
                      {tasks.filter(t => t.status === 'pending').map((task) => (
                        <div key={task.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/40 transition-all flex justify-between items-start gap-3">
                          <div className="flex gap-3 items-start">
                            <input 
                              type="checkbox" 
                              checked={false}
                              onChange={() => handleToggleTaskStatus(task.id)}
                              className="mt-1 cursor-pointer accent-[#4e0e15] w-4 h-4 shrink-0"
                            />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                                  task.priority === 'high' ? 'bg-rose-100 text-rose-800' : 
                                  task.priority === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-500'
                                }`}>
                                  {task.priority === 'high' ? '🔴 High' : task.priority === 'medium' ? '🟡 Medium' : '⚪ Low'}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">Due: {task.dueDate}</span>
                              </div>
                              <h5 className="font-bold text-stone-800 text-xs mt-1.5 leading-snug">{task.title}</h5>
                              {task.description && <p className="text-xs text-stone-500 mt-1 leading-relaxed">{task.description}</p>}
                            </div>
                          </div>

                          <button 
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1 text-stone-300 hover:text-rose-600 transition-colors cursor-pointer shrink-0"
                            title="Delete Task"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </div>
                      ))}

                      {tasks.filter(t => t.status === 'pending').length === 0 && (
                        <div className="text-center py-10 text-[#4e0e15]/40 italic font-mono text-xs">
                          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                          All cellar directives completed! Cellar sanitation is stellar.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Completed list */}
                  {tasks.filter(t => t.status === 'completed').length > 0 && (
                    <div className="bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-3">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block font-semibold">Completed Records Archive</span>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {tasks.filter(t => t.status === 'completed').map(task => (
                          <div key={task.id} className="flex justify-between items-center text-xs bg-stone-50 px-3.5 py-2.5 rounded-lg border border-stone-200/60 text-slate-400">
                            <div className="flex items-center gap-2 line-through">
                              <span className="font-medium">{task.title}</span>
                              <span className="text-[9px] font-mono">({task.dueDate})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => handleToggleTaskStatus(task.id)}
                                className="text-stone-400 hover:text-[#4e0e15] text-[10px] underline"
                              >
                                Reopen
                              </button>
                              <button 
                                onClick={() => handleDeleteTask(task.id)}
                                className="text-stone-300 hover:text-rose-600 transition-colors"
                              >
                                <Trash className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

          {/* K. CELLAR NOTES */}
          {activeTab === 'notes' && (
            <div className="space-y-6 animate-fade-in text-stone-800">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#e8dfd5] pb-4 gap-3">
                <div>
                  <h3 className="text-lg font-serif font-black text-[#4e0e15] flex items-center gap-2">
                    <FileText className="h-5 w-5 text-[#801323]" />
                    {t.notes}
                  </h3>
                  <p className="text-xs text-slate-400 font-medium">Capture tasting observations, chemistry decisions, and cellular notes</p>
                </div>
                
                {/* Stats */}
                <div className="flex items-center gap-3">
                  <div className="px-3 py-1.5 bg-indigo-50/50 border border-[#e8dfd5] rounded-lg text-center">
                    <span className="text-[9px] text-[#4e0e15] font-mono uppercase font-bold block">Total Notes</span>
                    <strong className="text-sm font-serif font-bold text-[#4e0e15] block">{notesList.length}</strong>
                  </div>
                </div>
              </div>

              {/* Grid Form and List */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Add Note Form */}
                <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4">
                  <h4 className="font-serif font-bold text-sm text-[#4e0e15] border-b border-stone-100 pb-2">Record Winery Note</h4>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const formData = new FormData(form);
                    const title = formData.get('title') as string;
                    const category = formData.get('category') as 'Enology' | 'Tasting' | 'Sanitation' | 'General';
                    const content = formData.get('content') as string;
                    const relatedLotId = formData.get('relatedLotId') as string;
                    if (title.trim() && content.trim()) {
                      handleAddNewNote(title, category, content, relatedLotId);
                      form.reset();
                    }
                  }} className="space-y-3.5 text-xs text-stone-600 font-sans">
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
                          <option value="Enology">🧪 Enology Check</option>
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
                            onClick={() => handleDeleteNote(note.id)}
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
                          <p className="text-xs text-stone-600 leading-relaxed whitespace-pre-wrap bg-stone-50/50 p-2.5 rounded border border-stone-100/60 mt-1">{note.content}</p>
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
          )}

        </section>

      </main>
      )}

      {/* SLIDE-OUT PANEL FOR SELECTED VESSEL DETAILED METRICS */}
      {(() => {
        const selectedVessel = selectedTankId ? vessels.find(v => v.id === selectedTankId) : null;
        const selectedLot = selectedVessel?.assignedLotId 
          ? lots.find(l => l.id === selectedVessel.assignedLotId) 
          : null;
        const tankLogs = selectedTankId 
          ? fermLogs.filter(log => log.tankId === selectedTankId) 
          : [];

        // Build 7-day temperature history
        const tempHistory = (() => {
          if (!selectedVessel) return [];
          const list = [];
          const currentTemp = selectedVessel.temperature;
          for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const realLog = tankLogs.find(log => log.date === dateStr);
            
            let temp = currentTemp;
            let isReal = false;
            
            if (realLog) {
              temp = realLog.temperature;
              isReal = true;
            } else {
              // Deterministic variance based on tank ID and index to make historical graph look authentic and dynamic
              const idSum = selectedVessel.id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
              const variance = Math.sin((idSum + i) * 1.7) * 1.3;
              temp = Number((currentTemp + variance).toFixed(1));
            }
            
            const label = d.toLocaleDateString(lang === 'ka' ? 'ka-GE' : lang === 'it' ? 'it-IT' : 'en-US', {
              month: 'short',
              day: 'numeric',
            });
            
            list.push({
              date: dateStr,
              label,
              temperature: temp,
              isReal
            });
          }
          return list;
        })();

        return (
          <AnimatePresence>
            {selectedTankId && selectedVessel && (
              <>
                {/* Semi-transparent Backdrop with smooth fading */}
                <motion.div
                  key="vessel-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setSelectedTankId(null)}
                  className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs z-50 transition-opacity"
                />

                {/* Sliding Panel Container from the right */}
                <motion.div
                  key="vessel-drawer"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 24, stiffness: 200 }}
                  className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-[#FAF8F5] shadow-2xl border-l border-[#f0e6da] flex flex-col focus:outline-none text-stone-800"
                >
                  {/* Scrollable body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* Header section with Close Button */}
                    <div className="flex items-start justify-between border-b border-[#e8dfd5] pb-4">
                      <div>
                        <span className="text-[10px] font-mono uppercase bg-amber-100 text-amber-950 px-2 py-0.5 rounded font-bold tracking-wider mb-1.5 inline-block">
                          Cellar Core Vessel
                        </span>
                        <h2 className="text-xl font-serif font-bold text-[#4e0e15]">{selectedVessel.id}</h2>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedVessel.locationDetails || 'Cellar Room A, main row'}</p>
                      </div>
                      <button
                        onClick={() => setSelectedTankId(null)}
                        className="p-1.5 rounded-full hover:bg-stone-200/50 text-stone-500 hover:text-stone-800 transition-colors cursor-pointer"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-white border border-[#e8dfd5] rounded-xl shadow-2xs">
                        <span className="text-[10px] uppercase font-mono text-slate-400 block">Vessel Type</span>
                        <strong className="text-xs text-stone-800 font-semibold capitalize block mt-0.5">
                          {selectedVessel.type.replace('_', ' ')}
                        </strong>
                      </div>
                      <div className="p-3 bg-white border border-[#e8dfd5] rounded-xl shadow-2xs">
                        <span className="text-[10px] uppercase font-mono text-slate-400 block">Profile Shape</span>
                        <strong className="text-xs text-stone-800 font-semibold capitalize block mt-0.5">
                          {selectedVessel.shape} Container
                        </strong>
                      </div>
                    </div>

                    {/* Capacity level progress section */}
                    <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-500 font-medium">Volumetric Fill Degree</span>
                        <span className="font-bold text-[#4e0e15]">
                          {selectedVessel.capacity > 0 ? Math.round((selectedVessel.currentVolume / selectedVessel.capacity) * 100) : 0}% Filled
                        </span>
                      </div>
                      
                      {/* HTML/CSS Bar representing the level */}
                      <div className="w-full bg-slate-100 h-3.5 rounded-full overflow-hidden border border-slate-200 relative">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${
                            (selectedVessel.currentVolume / selectedVessel.capacity) > 0.95 
                              ? 'bg-gradient-to-r from-red-600 to-rose-500 animate-pulse' 
                              : 'bg-gradient-to-r from-[#801323] to-[#510e19]'
                          }`}
                          style={{ width: `${selectedVessel.capacity > 0 ? (selectedVessel.currentVolume / selectedVessel.capacity) * 100 : 0}%` }}
                        />
                      </div>

                      <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mt-1">
                        <span>{selectedVessel.currentVolume.toLocaleString()} L Net volume</span>
                        <span>{selectedVessel.capacity.toLocaleString()} L Total Limit</span>
                      </div>
                    </div>

                    {/* Dynamic Interactive Cooling jacket control panel */}
                    <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-4 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Thermometer className="w-5 h-5 text-[#801323]" />
                          <div>
                            <h3 className="text-xs font-bold text-stone-800">Thermal Intelligence Loop</h3>
                            <p className="text-[10px] text-slate-400">Automated temperature regulation</p>
                          </div>
                        </div>
                        {/* Glowing LED status indicator depending on jacket */}
                        <span className={`h-2.5 w-2.5 relative flex ${selectedVessel.coolingJacketActive ? '' : 'hidden'}`}>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 bg-[#FAF8F5] p-3 rounded-lg border border-[#e8dfd5]/40">
                        <div>
                          <span className="text-[9px] uppercase font-mono text-slate-400 block">Current Fluid Temp</span>
                          <div className="flex items-baseline gap-1 mt-0.5">
                            <strong className="text-lg font-serif font-black text-[#4e0e15]">{selectedVessel.temperature} °C</strong>
                            <span className="text-[8px] text-indigo-700 font-semibold font-mono whitespace-nowrap">Sensors Live</span>
                          </div>
                        </div>
                        <div>
                          <span className="text-[9px] uppercase font-mono text-slate-400 block">Set Target</span>
                          <div className="flex items-center justify-between mt-1">
                            <strong className="text-xs font-semibold text-slate-750 font-mono">
                              {selectedVessel.targetTemperature ? `${selectedVessel.targetTemperature} °C` : '--'}
                            </strong>
                            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded shrink-0 shadow-2xs">
                              <button 
                                onClick={() => handleAdjustTargetTemp(selectedVessel.id, -0.5)}
                                className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 font-bold border-r border-slate-200 cursor-pointer"
                              >
                                -
                              </button>
                              <button 
                                onClick={() => handleAdjustTargetTemp(selectedVessel.id, 0.5)}
                                className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-100 font-bold cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 7-Day Temperature Sparkline / Chart */}
                      <div className="pt-3 border-t border-slate-100 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] uppercase font-mono text-slate-400 block font-bold">7-Day Thermal History</span>
                          <span className="text-[8px] font-mono text-slate-400">
                            {tempHistory[0]?.label || ''} — {tempHistory[tempHistory.length - 1]?.label || ''}
                          </span>
                        </div>
                        <div className="h-28 w-full bg-[#FAF8F5]/80 rounded-lg p-2 border border-[#e8dfd5]/40">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={tempHistory} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                              <XAxis 
                                dataKey="label" 
                                fontSize={8} 
                                tickLine={false} 
                                axisLine={false}
                                stroke="#94a3b8" 
                              />
                              <YAxis 
                                domain={['dataMin - 1', 'dataMax + 1']} 
                                fontSize={8} 
                                tickLine={false} 
                                axisLine={false}
                                stroke="#94a3b8" 
                                tickFormatter={(val) => `${val}°C`}
                              />
                              <Tooltip 
                                contentStyle={{ 
                                  backgroundColor: '#fff', 
                                  borderRadius: '6px', 
                                  border: '1px solid #e8dfd5', 
                                  fontSize: '10px',
                                  padding: '4px 8px'
                                }}
                                formatter={(value: any) => [`${value} °C`, 'Temp']}
                                labelFormatter={(label) => `Date: ${label}`}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="temperature" 
                                stroke="#801323" 
                                strokeWidth={2.5}
                                dot={{ r: 2.5, fill: '#801323', strokeWidth: 0 }}
                                activeDot={{ r: 4 }}
                                name="Temp"
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                        <div className="flex justify-between items-center text-[8px] font-mono text-slate-400 px-0.5">
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#801323]" /> 
                            {lang === 'ka' ? 'ტემპერატურის დინამიკა' : 'Telemetry Log Chart'}
                          </span>
                          <span>
                            {lang === 'ka' ? 'ბოლო 7 დღე' : 'Last 7 Days'}
                          </span>
                        </div>
                      </div>

                      {/* Toggle controls */}
                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                        <span className="text-slate-500 font-medium font-sans">Cooling Induction Jacket</span>
                        <button
                          onClick={() => handleToggleCoolingJacket(selectedVessel.id)}
                          className={`px-3 py-1 rounded-md font-semibold text-[11px] transition-all cursor-pointer ${
                            selectedVessel.coolingJacketActive 
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                              : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                          }`}
                        >
                          {selectedVessel.coolingJacketActive ? '✓ Active Cooling' : 'Disabled'}
                        </button>
                      </div>
                    </div>

                    {/* Active wine lot configuration */}
                    <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-3 shadow-2xs">
                      <h3 className="text-xs font-bold text-stone-800 flex items-center gap-1.5 border-b border-stone-100 pb-2">
                        <Wine className="w-4 h-4 text-[#801323]" />
                        Allocated Wine Lot Details
                      </h3>
                      
                      {selectedLot ? (
                        <div className="space-y-2.5 text-stone-750">
                          <div className="flex items-center justify-between">
                            <div>
                              <strong className="text-xs text-[#4e0e15] font-serif font-bold block">{selectedLot.name}</strong>
                              <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider block mt-0.5">{selectedLot.id}</span>
                            </div>
                            <span className="px-2 py-0.5 text-[9px] font-semibold text-[#801323] bg-rose-50 border border-rose-100 rounded-full uppercase">
                              {selectedLot.stage}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs border-t border-slate-100 pt-2.5">
                            <div>
                              <span className="text-slate-400 text-[10px] block font-mono uppercase">Vintage & Variety</span>
                              <strong className="text-stone-700 font-serif font-semibold">{selectedLot.vintage} • {selectedLot.variety}</strong>
                            </div>
                            <div>
                              <span className="text-slate-400 text-[10px] block font-mono uppercase">Vineyard Block</span>
                              <strong className="text-stone-700 font-mono text-[11px]">{selectedLot.vineyardBlock}</strong>
                            </div>
                            <div className="col-span-2">
                              <span className="text-slate-400 text-[10px] block font-mono uppercase">Origin Appellation</span>
                              <strong className="text-stone-700 text-[11px]">{selectedLot.region} Protected Appellation</strong>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="py-2 text-center text-xs text-slate-400 italic font-mono text-[11px]">
                          No active wine grapes or fermenting lot assigned. This tank is vacant.
                        </div>
                      )}
                    </div>

                    {/* Sanitation Cleaning controls */}
                    <div className="p-4 bg-white border border-[#e8dfd5] rounded-xl space-y-3 shadow-2xs">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <h3 className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                          <RefreshCw className="w-4 h-4 text-emerald-855" />
                          Sanitation & Hygiene Protocol
                        </h3>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono uppercase ${
                          selectedVessel.cleaningStatus === 'clean' 
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                            : 'bg-amber-100 text-amber-805 border border-amber-200'
                        }`}>
                          {selectedVessel.cleaningStatus.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs pt-1">
                        <div className="text-slate-500">
                          <span className="block text-[9px]">Last Hygiene Record:</span>
                          <strong className="font-mono text-slate-600 block mt-0.5">
                            {selectedVessel.lastCleaned ? selectedVessel.lastCleaned : 'Never/New'}
                          </strong>
                        </div>
                        <button
                          onClick={() => handleToggleSanitation(selectedVessel.id)}
                          className="px-2 py-1 text-[10px] font-mono font-semibold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/50 rounded transition-all cursor-pointer"
                        >
                          {selectedVessel.cleaningStatus === 'clean' ? 'Flag: CIP Required' : '✓ Mark Sanitized Today'}
                        </button>
                      </div>
                    </div>

                    {/* Active Vessel Activity Logs Log Ledger */}
                    <div className="space-y-2">
                      <h3 className="text-xs font-bold text-[#4e0e15] uppercase tracking-wider px-1 font-serif">
                        Recent Ledger & Operations
                      </h3>
                      
                      <div className="p-3 bg-white border border-[#e8dfd5] rounded-xl space-y-2 shadow-2xs">
                        {selectedVessel.lastOperation && (
                          <div className="text-xs border-b border-dashed border-slate-150 pb-2">
                            <span className="text-[9px] uppercase font-mono text-slate-400 block mb-0.5">Last Tracked Event</span>
                            <p className="text-slate-700 leading-relaxed font-mono text-[11px] font-semibold">{selectedVessel.lastOperation}</p>
                          </div>
                        )}

                        {tankLogs.length > 0 ? (
                          <div className="space-y-2 pt-1">
                            <span className="text-[9px] uppercase font-mono text-slate-400 block mb-1">Fermentation Logs</span>
                            {tankLogs.slice(0, 3).map((log, index) => (
                              <div key={log.id || index} className="text-[11.5px] text-slate-600 border-l-2 border-[#801323]/40 pl-2 py-0.5 space-y-0.5">
                                <div className="flex items-center justify-between font-bold text-slate-700">
                                  <span>Date: {log.date}</span>
                                  <span>Sugar: {log.sugar} g/L</span>
                                </div>
                                <p className="italic text-slate-500 font-serif">
                                  &quot;{log.tastingNotes || 'Clean active extraction'}&quot;
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 text-center py-2 font-mono">
                            No fermentation samples logged for this vessel.
                          </div>
                        )}
                      </div>
                    </div>

                  </div>

                  {/* Footer Action to view details */}
                  <div className="p-4 bg-stone-100 border-t border-[#e8dfd5] flex items-center justify-between gap-3 shrink-0">
                    <span className="text-[9px] font-mono text-slate-400">
                      SYSTEM: VINEA OPERATIONAL CORE
                    </span>
                    <button
                      onClick={() => setSelectedTankId(null)}
                      className="px-3.5 py-1.5 bg-[#4e0e15] hover:bg-[#3d0a10] text-stone-100 rounded-lg text-xs font-semibold shadow-xs transition-all cursor-pointer"
                    >
                      Done / Close
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        );
      })()}

      {/* 3. Humble human-label footer */}
      <footer className="py-6 px-6 bg-white border-t border-[#e8dfd5] text-center mt-auto text-[10px] text-slate-400 font-mono font-medium">
        Vinea ERP • Operational Winemaking Control Loop • European Union PDO Standards Verified
      </footer>
    </div>
  );
}

function BrainCircuitIcon(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 5V3M12 21v-2M5 12H3M21 12h-2M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0 -6 0" />
      <path d="M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4l-1.4-1.4M7 7L5.6 5.6" />
    </svg>
  );
}
