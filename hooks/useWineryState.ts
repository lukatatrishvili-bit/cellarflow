import { useState, useEffect } from 'react';
import { Language } from '../lib/i18n';
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

export function useWineryState() {
  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isClient, setIsClient] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [passportLotId, setPassportLotId] = useState<string | null>(null);

  // Auth States
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

  const [activeModule, setActiveModule] = useState<'portal' | 'vazi' | 'gvino' | 'settings' | 'audit'>('portal');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Datasets
  const [vessels, setVessels] = useState<Vessel[]>([]);
  const [lots, setLots] = useState<WineLot[]>([]);
  const [fermLogs, setFermLogs] = useState<DailyFermLog[]>([]);
  const [labLogs, setLabLogs] = useState<LabAnalysis[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notesList, setNotesList] = useState<CellarNote[]>([]);

  // Vazi Viticulture Datasets
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

  // Daily fermentation inputs
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

  // Lab entry inputs
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

  // Lab filters
  const [labFilterType, setLabFilterType] = useState('all');
  const [labFilterAge, setLabFilterAge] = useState('all');

  // Cross-tab calculator inputs
  const [calculatorLotId, setCalculatorLotId] = useState('');
  const [calculatorLotIdA, setCalculatorLotIdA] = useState('');
  const [calculatorLotIdB, setCalculatorLotIdB] = useState('');

  // Prefilled task parameters
  const [prefilledTaskTitle, setPrefilledTaskTitle] = useState('');
  const [prefilledTaskPriority, setPrefilledTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [prefilledTaskDesc, setPrefilledTaskDesc] = useState('');

  // Unified Hydration
  useEffect(() => {
    setIsClient(true);

    const parseOrInit = (key: string, initVal: any) => {
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch {
          return initVal;
        }
      }
      return initVal;
    };

    setVessels(parseOrInit('cf_vessels', initialVessels));
    setLots(parseOrInit('cf_lots', initialLots));
    setFermLogs(parseOrInit('cf_fermlogs', initialFermLogs));
    setLabLogs(parseOrInit('cf_lablogs', initialLabLogs));
    setInventory(parseOrInit('cf_inventory', initialInventory));
    setTasks(parseOrInit('cf_tasks', initialTasks));
    setNotesList(parseOrInit('cf_notes', initialCellarNotes));
    setIsSidebarCollapsed(localStorage.getItem('cf_sidebar_collapsed') === 'true');

    setIsLoggedIn(localStorage.getItem('vinea_is_logged_in') === 'true');
    const storedUser = localStorage.getItem('vinea_curr_user');
    if (storedUser) {
      try { setCurrentUser(JSON.parse(storedUser)); } catch { /* ignore */ }
    }
    const storedCompany = localStorage.getItem('vinea_company_profile');
    if (storedCompany) {
      try { setCompanyProfile(JSON.parse(storedCompany)); } catch { /* ignore */ }
    }
    const storedModule = localStorage.getItem('vinea_active_module');
    if (storedModule) setActiveModule(storedModule as any);

    setBlocks(parseOrInit('vinea_blocks', initialVineyardBlocks));
    setPhenologyLogs(parseOrInit('vinea_phenology', initialPhenologyRecords));
    setSprays(parseOrInit('vinea_sprays', initialSprayRecords));
    setScoutings(parseOrInit('vinea_scoutings', initialScoutingRecords));
    setSoilRecords(parseOrInit('vinea_soil', initialSoilAnalysis));
    setSamplings(parseOrInit('vinea_samplings', initialGrapeSamples));
    setHarvests(parseOrInit('vinea_harvests', initialHarvestRecords));
    setIrrigationLogs(parseOrInit('vinea_irrigation', initialIrrigationLogs));
    setFertilizerLogs(parseOrInit('vinea_fertilizer', initialFertilizerLogs));
    setAuditLogs(parseOrInit('vinea_audit_logs', initialVineaAuditLogs));

    // Deep link logic
    if (localStorage.getItem('vinea_is_logged_in') === 'true') {
      const params = new URLSearchParams(window.location.search);
      const lotParam = params.get('lot');
      const tankParam = params.get('tank');
      if (lotParam) {
        setActiveModule('gvino');
        setActiveTab('lots');
        setPassportLotId(lotParam);
      } else if (tankParam) {
        setActiveModule('gvino');
        setActiveTab('vessels');
        setSelectedTankId(tankParam);
      }
    }
  }, []);

  // Atomic sync to Local Storage
  useEffect(() => { if (isClient) localStorage.setItem('cf_vessels', JSON.stringify(vessels)); }, [vessels, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_lots', JSON.stringify(lots)); }, [lots, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_fermlogs', JSON.stringify(fermLogs)); }, [fermLogs, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_lablogs', JSON.stringify(labLogs)); }, [labLogs, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_inventory', JSON.stringify(inventory)); }, [inventory, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_tasks', JSON.stringify(tasks)); }, [tasks, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_notes', JSON.stringify(notesList)); }, [notesList, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_sidebar_collapsed', String(isSidebarCollapsed)); }, [isSidebarCollapsed, isClient]);

  useEffect(() => { if (isClient) localStorage.setItem('vinea_is_logged_in', String(isLoggedIn)); }, [isLoggedIn, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_curr_user', JSON.stringify(currentUser)); }, [currentUser, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_company_profile', JSON.stringify(companyProfile)); }, [companyProfile, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_active_module', activeModule); }, [activeModule, isClient]);

  useEffect(() => { if (isClient) localStorage.setItem('vinea_blocks', JSON.stringify(blocks)); }, [blocks, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_phenology', JSON.stringify(phenologyLogs)); }, [phenologyLogs, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_sprays', JSON.stringify(sprays)); }, [sprays, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_scoutings', JSON.stringify(scoutings)); }, [scoutings, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_soil', JSON.stringify(soilRecords)); }, [soilRecords, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_samplings', JSON.stringify(samplings)); }, [samplings, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_harvests', JSON.stringify(harvests)); }, [harvests, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_irrigation', JSON.stringify(irrigationLogs)); }, [irrigationLogs, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_fertilizer', JSON.stringify(fertilizerLogs)); }, [fertilizerLogs, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_audit_logs', JSON.stringify(auditLogs)); }, [auditLogs, isClient]);

  // Input Sanitizer/Validator Helper for ID poisoning prevention
  const sanitizeId = (id: string): string => {
    return id.trim().replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 128);
  };

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
    const rawLotId = `LOT-${variety.substring(0, 2).toUpperCase()}-${vintage}-${Date.now().toString().slice(-4)}`;
    const lotId = sanitizeId(rawLotId);
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
      id: sanitizeId(`fl-${Date.now()}`),
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
      id: sanitizeId(`audit-${Date.now()}`),
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

  const handleAddFermLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!logLotId || !logTankId) return;

    const newLog: DailyFermLog = {
      id: sanitizeId(`flog-${Date.now()}`),
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
    setToastMessage(lang === 'ka' ? 'ფერმენტაციის ჩანაწერი დაემატა!' : 'Fermentation log added successfully!');
  };

  const handleAddLabLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labLotId || !labTankId) return;

    const newLab: LabAnalysis = {
      id: sanitizeId(`lab-${Date.now()}`),
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
    
    // Auto-update wine lots
    const targetLot = lots.find(l => l.id === labLotId);
    if (targetLot) {
      setLots(prev => prev.map(l => {
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
      }));
    }
    setToastMessage(lang === 'ka' ? 'ლაბორატორიული ანალიზი დაემატა!' : 'Lab analysis added successfully!');
  };

  const handleToggleTaskStatus = (taskId: string) => {
    setTasks(prev => prev.map(tk => {
      if (tk.id === taskId) {
        return {
          ...tk,
          status: tk.status === 'pending' ? 'completed' : 'pending'
        };
      }
      return tk;
    }));
  };

  const handleAddNewTask = (title: string, priority: 'high' | 'medium' | 'low', dueDate: string, description: string) => {
    const newTask: Task = {
      id: sanitizeId(`task-${Date.now()}`),
      title,
      priority,
      dueDate: dueDate || new Date().toISOString().split('T')[0],
      assignedTo: 'Luka Tatrishvili',
      status: 'pending',
      description
    };
    setTasks(prev => [newTask, ...prev]);
    setToastMessage(lang === 'ka' ? 'ახალი დავალება დაემატა!' : 'New task assigned successfully!');
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setToastMessage(lang === 'ka' ? 'დავალება წაიშალა!' : 'Task deleted successfully!');
  };

  const handleAddNewNote = (title: string, category: 'Enology' | 'Tasting' | 'Sanitation' | 'General', content: string, relatedLotId?: string) => {
    const newNote: CellarNote = {
      id: sanitizeId(`note-${Date.now()}`),
      title,
      category,
      content,
      date: new Date().toISOString().split('T')[0],
      author: 'Luka Tatrishvili',
      relatedLotId: relatedLotId || undefined
    };
    setNotesList(prev => [newNote, ...prev]);
    setToastMessage(lang === 'ka' ? 'შენიშვნა დაემატა!' : 'Cellar note saved successfully!');
  };

  const handleDeleteNote = (noteId: string) => {
    setNotesList(prev => prev.filter(n => n.id !== noteId));
    setToastMessage(lang === 'ka' ? 'შენიშვნა წაიშალა!' : 'Note removed successfully!');
  };

  const handleAddInventory = (itemId: string, qty: number) => {
    setInventory(prev => prev.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          stock: parseFloat((item.stock + qty).toFixed(1))
        };
      }
      return item;
    }));
    setToastMessage(lang === 'ka' ? 'მარაგი განახლდა!' : 'Inventory stock updated successfully!');
  };

  return {
    lang, setLang,
    activeTab, setActiveTab,
    isClient,
    toastMessage, setToastMessage,
    loginError, setLoginError,
    passportLotId, setPassportLotId,
    isLoggedIn, setIsLoggedIn,
    currentUser, setCurrentUser,
    companyProfile, setCompanyProfile,
    activeModule, setActiveModule,
    isSidebarCollapsed, setIsSidebarCollapsed,
    
    // Data
    vessels, setVessels,
    lots, setLots,
    fermLogs, setFermLogs,
    labLogs, setLabLogs,
    inventory, setInventory,
    tasks, setTasks,
    notesList, setNotesList,
    blocks, setBlocks,
    phenologyLogs, setPhenologyLogs,
    sprays, setSprays,
    scoutings, setScoutings,
    soilRecords, setSoilRecords,
    samplings, setSamplings,
    harvests, setHarvests,
    irrigationLogs, setIrrigationLogs,
    fertilizerLogs, setFertilizerLogs,
    auditLogs, setAuditLogs,

    // Inputs
    logTankId, setLogTankId,
    logLotId, setLogLotId,
    logTemp, setLogTemp,
    logDensity, setLogDensity,
    logSugar, setLogSugar,
    logPH, setLogPH,
    logNotes, setLogNotes,
    logCap, setLogCap,
    chartLotId, setChartLotId,
    selectedTankId, setSelectedTankId,

    labLotId, setLabLotId,
    labTankId, setLabTankId,
    labABV, setLabABV,
    labVA, setLabVA,
    labFSO2, setLabFSO2,
    labTSO2, setLabTSO2,
    labResidualSugar, setLabResidualSugar,
    labLactic, setLabLactic,
    labTurbidity, setLabTurbidity,
    labTA, setLabTA,
    labFilterType, setLabFilterType,
    labFilterAge, setLabFilterAge,

    // Cross-tab variables
    calculatorLotId, setCalculatorLotId,
    calculatorLotIdA, setCalculatorLotIdA,
    calculatorLotIdB, setCalculatorLotIdB,
    prefilledTaskTitle, setPrefilledTaskTitle,
    prefilledTaskPriority, setPrefilledTaskPriority,
    prefilledTaskDesc, setPrefilledTaskDesc,

    // Actions
    sanitizeId,
    handleToggleCoolingJacket,
    handleAdjustTargetTemp,
    handleToggleSanitation,
    handleAddBlock,
    handleUpdateBlock,
    handleAddPhenologyLog,
    handleAddSprayRecord,
    handleAddScoutingRecord,
    handleAddSamplings,
    handleAddHarvestRecord,
    handleUpdateHarvestRecord,
    handleAddIrrigation,
    handleAddFertilizer,
    handleSendHarvestToGvino,
    handleAddFermLog,
    handleAddLabLog,
    handleToggleTaskStatus,
    handleAddNewTask,
    handleDeleteTask,
    handleAddNewNote,
    handleDeleteNote,
    handleAddInventory
  };
}
