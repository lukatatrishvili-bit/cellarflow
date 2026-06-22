import { useState, useEffect, useRef } from 'react';
import { Language } from '../lib/i18n';
import { SyncQueueManager, IndexedDBQueue } from '../lib/syncQueue';
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
  MaraniOSAuditLog,
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
  initialMaraniOSAuditLogs
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

const initialCellarNotes: CellarNote[] = [];

export function useWineryState() {
  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isClient, setIsClient] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [passportLotId, setPassportLotId] = useState<string | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<any[] | null>(null);
  const [pendingServerDb, setPendingServerDb] = useState<any | null>(null);
  // Auth States
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>({
    username: 'luka_winemaker',
    email: 'luka@maranios.com',
    fullName: 'Luka Tatrishvili',
    role: 'Owner/Admin',
    language: 'en'
  });

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    companyName: 'MaraniOS Estates',
    wineryName: 'MaraniOS Central Marani',
    country: 'Georgia',
    region: 'Kakheti',
    municipality: 'Telavi',
    address: 'Kondoli Village Highway, Telavi, Kakheti, Georgia',
    contactEmail: 'production@maranios.ge',
    phone: '+995 599 123 456',
    website: 'www.maranios.ge',
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
  const [auditLogs, setAuditLogs] = useState<MaraniOSAuditLog[]>([]);

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

  const [prefilledTaskTitle, setPrefilledTaskTitle] = useState('');
  const [prefilledTaskPriority, setPrefilledTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [prefilledTaskDesc, setPrefilledTaskDesc] = useState('');
  const [prefilledSourceId, setPrefilledSourceId] = useState('');
  const [prefilledDestId, setPrefilledDestId] = useState('');

  // Synchronization refs to manage server state & loop prevention
  const isSyncing = useRef(false);
  const hasHydrated = useRef(false);
  const pendingSync = useRef<{ payload: any } | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const lastServerState = useRef<Record<string, string>>({});

  // Auto-dismiss toast messages after 5 seconds
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const updateAllStates = (data: any) => {

    const setSafe = (setter: any, val: any, key: string, localKey: string) => {
      if (val !== undefined) {
        setter(val);
        localStorage.setItem(localKey, JSON.stringify(val));
        lastServerState.current[key] = JSON.stringify(val);
      }
    };
    
    setSafe(setVessels, data.vessels, 'vessels', 'cf_vessels');
    setSafe(setLots, data.lots, 'lots', 'cf_lots');
    setSafe(setFermLogs, data.fermlogs, 'fermLogs', 'cf_fermlogs');
    setSafe(setLabLogs, data.lablogs, 'labLogs', 'cf_lablogs');
    setSafe(setInventory, data.inventory, 'inventory', 'cf_inventory');
    setSafe(setTasks, data.tasks, 'tasks', 'cf_tasks');
    setSafe(setNotesList, data.notes, 'notesList', 'cf_notes');
    setSafe(setBlocks, data.blocks, 'blocks', 'vinea_blocks');
    setSafe(setPhenologyLogs, data.phenologyLogs, 'phenologyLogs', 'vinea_phenology');
    setSafe(setSprays, data.sprays, 'sprays', 'vinea_sprays');
    setSafe(setScoutings, data.scoutings, 'scoutings', 'vinea_scoutings');
    setSafe(setSoilRecords, data.soilRecords, 'soilRecords', 'vinea_soil');
    setSafe(setSamplings, data.samplings, 'samplings', 'vinea_samplings');
    setSafe(setHarvests, data.harvests, 'harvests', 'vinea_harvests');
    setSafe(setIrrigationLogs, data.irrigationLogs, 'irrigationLogs', 'vinea_irrigation');
    setSafe(setFertilizerLogs, data.fertilizerLogs, 'fertilizerLogs', 'vinea_fertilizer');
    setSafe(setAuditLogs, data.auditLogs, 'auditLogs', 'vinea_audit_logs');
    setSafe(setCompanyProfile, data.companyProfile, 'companyProfile', 'vinea_company_profile');
  };

  const triggerSync = async (forcePayload?: any) => {
    if (isSyncing.current) {
      // Don't drop syncs requested while one is in flight (the dropped data —
      // e.g. a freshly added task — would be reverted by the in-flight
      // response). Remember the latest request and run it afterwards.
      pendingSync.current = { payload: forcePayload };
      return;
    }
    isSyncing.current = true;

    try {
      const latestState = forcePayload || {
        vessels, lots, fermLogs, labLogs, inventory, tasks, notesList,
        blocks, phenologyLogs, sprays, scoutings, soilRecords,
        samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
        companyProfile
      };

      const response = await SyncQueueManager.sync(latestState);
      if (response) {
        if (response.hasConflicts) {
          setSyncConflicts(response.conflicts);
          setPendingServerDb(response.serverDb);
          setToastMessage(lang === 'ka' ? 'კონფლიქტი აღმოჩენილია სინქრონიზაციისას!' : 'Sync conflict detected! Review required.');
        } else if (response.syncError) {
          // The server rejected the whole sync — keep data dirty for retry,
          // but tell the user instead of failing silently.
          if (response.syncError !== lastSyncError) {
            setLastSyncError(response.syncError);
            setToastMessage(`⚠️ ${lang === 'ka' ? 'სინქრონიზაცია უარყოფილია' : 'Sync rejected'}: ${response.syncError}`);
          }
        } else {
          updateAllStates(response);
          if (Array.isArray(response.syncErrors) && response.syncErrors.length > 0) {
            // Partial success: some collections were rejected and stay dirty.
            const firstErr = response.syncErrors[0];
            if (firstErr !== lastSyncError) {
              setLastSyncError(firstErr);
              setToastMessage(`⚠️ ${lang === 'ka' ? 'ზოგიერთი ცვლილება უარყოფილია' : 'Some changes were rejected'}: ${firstErr}`);
            }
          } else {
            setLastSyncError(null);
          }
        }
      }
    } catch (err) {
      console.error('Trigger sync error:', err);
    } finally {
      isSyncing.current = false;
      if (pendingSync.current) {
        const { payload } = pendingSync.current;
        pendingSync.current = null;
        triggerSync(payload);
      }
    }
  };

  const discardLocalUnsyncedChanges = async () => {
    try {
      await SyncQueueManager.clearOfflineQueue();
      const dbData = await SyncQueueManager.sync({});
      if (dbData) {
        updateAllStates(dbData);
      }
      setLastSyncError(null);
      setToastMessage(lang === 'ka' ? 'ლოკალური ცვლილებები გაუქმებულია. სინქრონიზირებულია სერვერთან.' : 'Local changes discarded. Synchronized with server state.');
    } catch (err) {
      console.error('Discard local changes error:', err);
    }
  };

  const handleAuthLogin = async (identifier: string, passcode: string, rememberMe?: boolean): Promise<boolean> => {
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, passcode, rememberMe })
      });
      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
        setIsLoggedIn(true);
        
        // Sync database immediately in background without blocking login on errors
        try {
          const dbData = await SyncQueueManager.sync({});
          if (dbData) {
            updateAllStates(dbData);
          }
        } catch (syncErr) {
          console.error('Initial login sync failed:', syncErr);
        }
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        setLoginError(err.error || 'Authentication failed');
        return false;
      }
    } catch (err) {
      setLoginError('Could not reach secure login gateway');
      return false;
    }
  };

  const handleAuthLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    setIsLoggedIn(false);
    localStorage.removeItem('vinea_is_logged_in');
    localStorage.removeItem('vinea_curr_user');
    localStorage.removeItem('cf_vessels');
    localStorage.removeItem('cf_lots');
    localStorage.removeItem('cf_fermlogs');
    localStorage.removeItem('cf_lablogs');
    localStorage.removeItem('cf_inventory');
    localStorage.removeItem('cf_tasks');
    localStorage.removeItem('cf_notes');
    localStorage.removeItem('vinea_blocks');
    localStorage.removeItem('vinea_phenology');
    localStorage.removeItem('vinea_sprays');
    localStorage.removeItem('vinea_scoutings');
    localStorage.removeItem('vinea_soil');
    localStorage.removeItem('vinea_samplings');
    localStorage.removeItem('vinea_harvests');
    localStorage.removeItem('vinea_irrigation');
    localStorage.removeItem('vinea_fertilizer');
    localStorage.removeItem('vinea_audit_logs');
    localStorage.removeItem('vinea_company_profile');
    localStorage.removeItem('vinea_deleted_ids');
    
    // Reset React state variables to initial values (clean slate for logout view)
    setVessels([]);
    setLots([]);
    setFermLogs([]);
    setLabLogs([]);
    setInventory([]);
    setTasks([]);
    setNotesList([]);
    setBlocks([]);
    setPhenologyLogs([]);
    setSprays([]);
    setScoutings([]);
    setSoilRecords([]);
    setSamplings([]);
    setHarvests([]);
    setIrrigationLogs([]);
    setFertilizerLogs([]);
    setAuditLogs([]);
  };

  const handleAuthRegister = async (profileData: { username: string, email: string, fullName: string, role: string, language: string, rememberMe?: boolean, passcode: string }) => {
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData)
      });
      if (res.ok) {
        const user = await res.json();
        setCurrentUser(user);
        setIsLoggedIn(true);
        
        // Only force full upload if there are unsynced offline changes made as guest
        const hasOfflineChanges = SyncQueueManager.getDirtyCollections().size > 0;
        const initialDB = await SyncQueueManager.sync(hasOfflineChanges ? {
          vessels, lots, fermLogs, labLogs, inventory, tasks, notesList,
          blocks, phenologyLogs, sprays, scoutings, soilRecords,
          samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
          companyProfile
        } : {});
        if (initialDB) {
          updateAllStates(initialDB);
        }
      } else {
        const err = await res.json();
        setLoginError(err.error || 'Registration failed');
      }
    } catch (err) {
      setLoginError('Could not reach secure registration gateway');
    }
  };

  const clearAllData = async () => {
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const cleanDB = await res.json();
        
        // Clear local storage cache
        localStorage.removeItem('cf_vessels');
        localStorage.removeItem('cf_lots');
        localStorage.removeItem('cf_fermlogs');
        localStorage.removeItem('cf_lablogs');
        localStorage.removeItem('cf_inventory');
        localStorage.removeItem('cf_tasks');
        localStorage.removeItem('cf_notes');
        localStorage.removeItem('vinea_blocks');
        localStorage.removeItem('vinea_phenology');
        localStorage.removeItem('vinea_sprays');
        localStorage.removeItem('vinea_scoutings');
        localStorage.removeItem('vinea_soil');
        localStorage.removeItem('vinea_samplings');
        localStorage.removeItem('vinea_harvests');
        localStorage.removeItem('vinea_irrigation');
        localStorage.removeItem('vinea_fertilizer');
        localStorage.removeItem('vinea_audit_logs');
        localStorage.removeItem('vinea_company_profile');
        localStorage.removeItem('vinea_deleted_ids');

        await SyncQueueManager.clearOfflineQueue();

        // Hydrate empty states locally
        updateAllStates(cleanDB);
      } else {
        const errData = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ Reset failed: ${errData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to reset estate database:', err);
    }
  };

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

    // Initialize from local cache first to ensure smooth loading UI
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
    setAuditLogs(parseOrInit('vinea_audit_logs', initialMaraniOSAuditLogs));

    // Restore session and sync from server
    const checkSessionAndSync = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const user = await res.json();
          setCurrentUser(user);
          setIsLoggedIn(true);
          
          const dbData = await SyncQueueManager.sync({});
          if (dbData) {
            updateAllStates(dbData);
          }
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        hasHydrated.current = true;
      }
    };
    checkSessionAndSync();

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

  // Atomic sync to Local Storage with Auto-API sync wrappers
  const handleCollectionUpdate = (key: string, localKey: string, value: any) => {
    if (!isClient) return;
    
    // Auto-inject lastModified timestamps for arrays of objects
    let processedValue = value;
    const modifiedOrAddedItems: Array<{ item: any; baselineTimestamp?: string }> = [];
    
    if (Array.isArray(value)) {
      let prevList: any[] = [];
      try {
        const stored = localStorage.getItem(localKey);
        if (stored) prevList = JSON.parse(stored);
      } catch { /* ignore */ }

      // Last server-acknowledged versions: the true baseline for conflict
      // detection. Using the local previous timestamp instead would make
      // chained local edits look like conflicts.
      let serverMap = new Map<string, any>();
      try {
        const serverJson = lastServerState.current[key];
        if (serverJson) {
          const serverList = JSON.parse(serverJson);
          if (Array.isArray(serverList)) {
            serverMap = new Map(serverList.map((item: any) => [item.id, item]));
          }
        }
      } catch { /* ignore */ }

      const prevMap = new Map(prevList.map(item => [item.id, item]));
      const nowStr = new Date().toISOString();

      processedValue = value.map(item => {
        if (item && typeof item === 'object' && 'id' in item) {
          const prevItem = prevMap.get(item.id);
          if (!prevItem) {
            // New item
            const newItem = { ...item, lastModified: nowStr };
            modifiedOrAddedItems.push({ item: newItem });
            return newItem;
          } else {
            // Compare fields ignoring sync metadata
            const { lastModified: _, baselineTimestamp: _b, ...itemWithoutTs } = item;
            const { lastModified: __, baselineTimestamp: _pb, ...prevWithoutTs } = prevItem;
            if (JSON.stringify(itemWithoutTs) !== JSON.stringify(prevWithoutTs)) {
              // Modified item: carry the server baseline on the item so
              // /api/sync can detect concurrent edits from other sessions.
              const serverItem = serverMap.get(item.id);
              const baselineTimestamp = item.baselineTimestamp ?? serverItem?.lastModified;
              const modifiedItem = { ...item, lastModified: nowStr, ...(baselineTimestamp ? { baselineTimestamp } : {}) };
              modifiedOrAddedItems.push({
                item: modifiedItem,
                baselineTimestamp
              });
              return modifiedItem;
            } else {
              // Unchanged content: keep the incoming timestamp (server
              // responses are authoritative). Preferring the local previous
              // timestamp here left local/server timestamps permanently
              // diverged, re-marking collections dirty after every sync —
              // an endless sync/re-render loop.
              return { ...item, lastModified: item.lastModified || prevItem.lastModified || nowStr };
            }
          }
        }
        return item;
      });
    }

    const setters: Record<string, any> = {
      vessels: setVessels,
      lots: setLots,
      fermLogs: setFermLogs,
      labLogs: setLabLogs,
      inventory: setInventory,
      tasks: setTasks,
      notesList: setNotesList,
      blocks: setBlocks,
      phenologyLogs: setPhenologyLogs,
      sprays: setSprays,
      scoutings: setScoutings,
      soilRecords: setSoilRecords,
      samplings: setSamplings,
      harvests: setHarvests,
      irrigationLogs: setIrrigationLogs,
      fertilizerLogs: setFertilizerLogs,
      auditLogs: setAuditLogs
    };

    const setter = setters[key];
    if (setter && JSON.stringify(processedValue) !== JSON.stringify(value)) {
      // Persist BEFORE updating state: the effect re-runs after the setter,
      // and must find storage already matching, or it re-stamps lastModified
      // with a fresh timestamp on every pass — an infinite update loop that
      // previously only terminated when two passes landed on the same
      // millisecond. The re-run becomes a no-op and handles dirty-marking.
      localStorage.setItem(localKey, JSON.stringify(processedValue));
      // The re-run sees no modified items, so offline mutations (which carry
      // the conflict baselines) must be queued on this first pass.
      if (hasHydrated.current && !SyncQueueManager.isOnline()) {
        modifiedOrAddedItems.forEach(({ item, baselineTimestamp }) => {
          IndexedDBQueue.addMutation({
            action: 'put',
            collection: key,
            recordId: item.id,
            data: item,
            baselineTimestamp
          });
        });
      }
      setter(processedValue);
      return;
    }

    localStorage.setItem(localKey, JSON.stringify(processedValue));

    const currentStr = JSON.stringify(processedValue);
    if (hasHydrated.current && currentStr !== lastServerState.current[key]) {
      SyncQueueManager.markDirty(key);
      
      // If offline, queue specific mutations in IndexedDB!
      if (!SyncQueueManager.isOnline()) {
        modifiedOrAddedItems.forEach(({ item, baselineTimestamp }) => {
          IndexedDBQueue.addMutation({
            action: 'put',
            collection: key,
            recordId: item.id,
            data: item,
            baselineTimestamp
          });
        });
      }

      const currentFullState = {
        vessels, lots, fermLogs, labLogs, inventory, tasks, notesList,
        blocks, phenologyLogs, sprays, scoutings, soilRecords,
        samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
        companyProfile
      };
      
      triggerSync({
        ...currentFullState,
        [key]: processedValue
      });
    }
  };

  useEffect(() => { handleCollectionUpdate('vessels', 'cf_vessels', vessels); }, [vessels, isClient]);
  useEffect(() => { handleCollectionUpdate('lots', 'cf_lots', lots); }, [lots, isClient]);
  useEffect(() => { handleCollectionUpdate('fermLogs', 'cf_fermlogs', fermLogs); }, [fermLogs, isClient]);
  useEffect(() => { handleCollectionUpdate('labLogs', 'cf_lablogs', labLogs); }, [labLogs, isClient]);
  useEffect(() => { handleCollectionUpdate('inventory', 'cf_inventory', inventory); }, [inventory, isClient]);
  useEffect(() => { handleCollectionUpdate('tasks', 'cf_tasks', tasks); }, [tasks, isClient]);
  useEffect(() => { handleCollectionUpdate('notesList', 'cf_notes', notesList); }, [notesList, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_sidebar_collapsed', String(isSidebarCollapsed)); }, [isSidebarCollapsed, isClient]);

  useEffect(() => { if (isClient) localStorage.setItem('vinea_is_logged_in', String(isLoggedIn)); }, [isLoggedIn, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_curr_user', JSON.stringify(currentUser)); }, [currentUser, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_company_profile', JSON.stringify(companyProfile)); }, [companyProfile, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_active_module', activeModule); }, [activeModule, isClient]);

  useEffect(() => { handleCollectionUpdate('blocks', 'vinea_blocks', blocks); }, [blocks, isClient]);
  useEffect(() => { handleCollectionUpdate('phenologyLogs', 'vinea_phenology', phenologyLogs); }, [phenologyLogs, isClient]);
  useEffect(() => { handleCollectionUpdate('sprays', 'vinea_sprays', sprays); }, [sprays, isClient]);
  useEffect(() => { handleCollectionUpdate('scoutings', 'vinea_scoutings', scoutings); }, [scoutings, isClient]);
  useEffect(() => { handleCollectionUpdate('soilRecords', 'vinea_soil', soilRecords); }, [soilRecords, isClient]);
  useEffect(() => { handleCollectionUpdate('samplings', 'vinea_samplings', samplings); }, [samplings, isClient]);
  useEffect(() => { handleCollectionUpdate('harvests', 'vinea_harvests', harvests); }, [harvests, isClient]);
  useEffect(() => { handleCollectionUpdate('irrigationLogs', 'vinea_irrigation', irrigationLogs); }, [irrigationLogs, isClient]);
  useEffect(() => { handleCollectionUpdate('fertilizerLogs', 'vinea_fertilizer', fertilizerLogs); }, [fertilizerLogs, isClient]);
  useEffect(() => { handleCollectionUpdate('auditLogs', 'vinea_audit_logs', auditLogs); }, [auditLogs, isClient]);

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
    const audit: MaraniOSAuditLog = {
      id: sanitizeId(`audit-${Date.now()}`),
      timestamp: new Date().toISOString(),
      user: currentUser.fullName,
      module: 'MARANIOS',
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

  const recordDeletion = (id: string) => {
    try {
      const stored = localStorage.getItem('vinea_deleted_ids');
      const list = stored ? JSON.parse(stored) : [];
      list.push(id);
      localStorage.setItem('vinea_deleted_ids', JSON.stringify(list));
      
      if (!SyncQueueManager.isOnline()) {
        IndexedDBQueue.addMutation({
          action: 'delete',
          collection: 'any',
          recordId: id
        });
      }
    } catch { /* ignore */ }
  };

  const handleDeleteTask = (taskId: string) => {
    recordDeletion(taskId);
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
    recordDeletion(noteId);
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

  const resolveConflict = async (resolutions: Record<string, 'local' | 'server'>) => {
    if (!syncConflicts || !pendingServerDb) return;
    
    const db = { ...pendingServerDb };
    
    syncConflicts.forEach(conflict => {
      const choice = resolutions[`${conflict.collection}-${conflict.recordId}`] || 'server';
      
      // Map client-side collection names to server-side keys
      let colKey = conflict.collection;
      if (conflict.collection === 'notesList') colKey = 'notes';
      if (conflict.collection === 'fermLogs') colKey = 'fermlogs';
      if (conflict.collection === 'labLogs') colKey = 'lablogs';
      
      const list = db[colKey];
      if (list) {
        const index = list.findIndex((x: any) => x.id === conflict.recordId);
        let resolvedItem = choice === 'local' ? { ...conflict.local } : { ...conflict.server };

        // If choosing local, bump lastModified and rebase onto the server
        // version we just reviewed — otherwise the re-push would conflict again.
        if (choice === 'local') {
          resolvedItem.lastModified = new Date().toISOString();
          resolvedItem.baselineTimestamp = conflict.server?.lastModified;
        }
        
        if (index !== -1) {
          list[index] = resolvedItem;
        } else {
          list.push(resolvedItem);
        }
      }
    });

    // Clear mutations queue from IndexedDB
    await SyncQueueManager.clearOfflineQueue();

    // Re-mark collections dirty so standard sync pushes modifications back
    syncConflicts.forEach(conflict => {
      SyncQueueManager.markDirty(conflict.collection);
    });

    setSyncConflicts(null);
    setPendingServerDb(null);

    // Apply the merged database to the client state
    updateAllStates(db);

    // Force trigger sync to push the resolved changes (with local versions) to the server
    const currentFullState = {
      vessels: db.vessels || vessels,
      lots: db.lots || lots,
      fermLogs: db.fermlogs || fermLogs,
      labLogs: db.lablogs || labLogs,
      inventory: db.inventory || inventory,
      tasks: db.tasks || tasks,
      notesList: db.notes || notesList,
      blocks: db.blocks || blocks,
      phenologyLogs: db.phenologyLogs || phenologyLogs,
      sprays: db.sprays || sprays,
      scoutings: db.scoutings || scoutings,
      soilRecords: db.soilRecords || soilRecords,
      samplings: db.samplings || samplings,
      harvests: db.harvests || harvests,
      irrigationLogs: db.irrigationLogs || irrigationLogs,
      fertilizerLogs: db.fertilizerLogs || fertilizerLogs,
      auditLogs: db.auditLogs || auditLogs,
      companyProfile: db.companyProfile || companyProfile
    };

    triggerSync(currentFullState);
    
    setToastMessage(lang === 'ka' ? 'კონფლიქტები წარმატებით მოგვარდა!' : 'Conflicts resolved successfully!');
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
    prefilledSourceId, setPrefilledSourceId,
    prefilledDestId, setPrefilledDestId,

    // Actions
    sanitizeId,
    triggerSync,
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
    handleAddInventory,
    handleAuthLogin,
    handleAuthLogout,
    handleAuthRegister,
    syncConflicts,
    setSyncConflicts,
    resolveConflict,
    lastSyncError,
    setLastSyncError,
    discardLocalUnsyncedChanges,
    clearAllData
  };
}
