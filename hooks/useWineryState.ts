import { useState, useEffect, useRef } from 'react';
import type { Language } from '../lib/i18n';
import { SyncQueueManager, IndexedDBQueue } from '../lib/syncQueue';
import type {
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
  VineyardPlantingProject,
  GrapeSamplingRecord,
  HarvestRecord,
  MaraniOSAuditLog,
  UserProfile,
  CompanyProfile,
  BottlingRunRecord,
  CellarTransferRecord,
  CertificationRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  SupplierPayment,
  GrapeIntakeRecord,
  CellarOperation,
  DocumentAttachment,
  CrmLeadRecord,
} from '../lib/wineryState';
import { CELLAR_OPERATIONS, deductStock, estimateMustVolumeL } from '../lib/wineryOperations';
import { signAuditEntries } from '../lib/auditHash';
import type { CostEntry } from '../lib/costing';
import { grapeIntakeCostEntry, materialCostEntryFromOperation } from '../lib/costing';
import type { WinePricing } from '../lib/costing/store';
import type { StorageLocation, StockMovement } from '../lib/storage';
import { PDO_RULES } from '../lib/pdo';
import { createDocumentAttachmentRecord, type DocumentAttachmentInput } from '../lib/attachments';
import { createCrmLeadRecord, upsertCrmLeadRecord, type CrmLeadRecordInput } from '../lib/crm';
import {
  createAiDraftQueueItems,
  upsertAiDraftQueueItems,
  type AiDraftAction,
  type AiDraftQueueItem,
  type AiDraftQueueStatus,
} from '../lib/aiDraftActions';
import { isKnownRole } from '../server/permissions';

interface RolePersistence {
  setItem(key: string, value: string): void;
}

export function applyOrganizationSwitchRole(
  currentUser: UserProfile,
  response: unknown,
  storage?: RolePersistence,
): UserProfile | null {
  const role = response && typeof response === 'object'
    ? (response as { role?: unknown }).role
    : undefined;
  if (!isKnownRole(role)) return null;

  const updatedUser: UserProfile = { ...currentUser, role };
  try {
    storage?.setItem('vinea_curr_user', JSON.stringify(updatedUser));
  } catch {
    // React state remains authoritative when persistent storage is unavailable.
  }
  return updatedUser;
}

export interface CellarNote {
  id: string;
  title: string;
  category: 'Enology' | 'Tasting' | 'Sanitation' | 'General';
  content: string;
  date: string;
  author: string;
  relatedLotId?: string;
}

interface RegistrationProfileData {
  username: string;
  email: string;
  fullName: string;
  role: UserProfile['role'];
  language: UserProfile['language'];
  rememberMe?: boolean;
  passcode: string;
  companyProfile: Partial<CompanyProfile>;
  enabledModules: string[];
  enabledWidgets?: string[];
}

interface CompleteRegistrationData {
  fullName: string;
  role: UserProfile['role'];
  language: UserProfile['language'];
  companyProfile: Partial<CompanyProfile>;
  enabledModules: string[];
  enabledWidgets?: string[];
}

const cleanText = (value: unknown): string | undefined => {
  const text = String(value || '').trim();
  return text.length > 0 ? text : undefined;
};

const textMatches = (left: string, right: string): boolean => {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  return Boolean(a && b) && (a.includes(b) || b.includes(a));
};

const inferPdoClassification = (microzone: string | undefined): WineLot['classification'] | undefined => {
  if (!microzone) return undefined;
  return PDO_RULES.some(rule => rule.microzones.some(zone => textMatches(zone, microzone))) ? 'PDO' : undefined;
};

const inferOriginProofStatus = (...values: Array<string | undefined>): WineLot['originProofStatus'] => {
  return values.some(Boolean) ? 'partial' : 'missing';
};

const initialCellarNotes: CellarNote[] = [];

export function useWineryState() {
  const [lang, setLang] = useState<Language>(() => {
    // Restore the chosen language across reloads (set by the header toggle and
    // by login, which adopts the account's saved language).
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('vinea_lang') : null;
      if (stored === 'ka' || stored === 'en' || stored === 'it' || stored === 'fr' || stored === 'de') return stored;
    } catch { /* ignore */ }
    return 'en';
  });
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isClient, setIsClient] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [verificationPending, setVerificationPending] = useState<{ email: string; devVerifyUrl?: string } | null>(null);
  const [demoLoginEnabled, setDemoLoginEnabled] = useState(false);
  const [passportLotId, setPassportLotId] = useState<string | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<any[] | null>(null);
  const [pendingServerDb, setPendingServerDb] = useState<any | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  // Auth States
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>({
    username: '',
    email: '',
    fullName: '',
    role: 'Read-Only',
    language: 'en',
    registrationComplete: true,
  });

  const [organizations, setOrganizations] = useState<{ id: string; name: string; role: string; isActive: boolean }[]>([]);

  const fetchOrganizations = async () => {
    try {
      const res = await fetch('/api/org/list');
      if (res.ok) {
        const list = await res.json();
        setOrganizations(list);
      }
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  };

  const handleSwitchOrganization = async (orgId: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/org/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const switchedUser = applyOrganizationSwitchRole(currentUser, data, localStorage);
        if (!switchedUser) {
          setToastMessage(lang === 'ka'
            ? '⚠️ სამუშაო სივრცე შეიცვალა, მაგრამ ახალი როლის განახლება ვერ მოხერხდა. გთხოვთ, განაახლოთ გვერდი.'
            : '⚠️ Workspace switched, but its role could not be refreshed. Please reload the page.');
          return false;
        }
        // Update permission-bearing client state before any follow-up fetches so
        // the previous workspace role cannot keep controls visible while the new
        // organization data hydrates.
        setCurrentUser(switchedUser);
        await fetchOrganizations();
        await discardLocalUnsyncedChanges();
        setToastMessage(lang === 'ka' ? 'სამუშაო სივრცე შეიცვალა!' : 'Switched winery workspace!');
        return true;
      } else {
        setToastMessage(`⚠️ ${data.error || 'Failed to switch workspace'}`);
        return false;
      }
    } catch (err) {
      setToastMessage(lang === 'ka' ? '⚠️ კავშირის შეცდომა სამუშაო სივრცის შეცვლისას.' : '⚠️ Connection error while switching workspace.');
      return false;
    }
  };

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    companyName: '',
    wineryName: '',
    country: '',
    region: '',
    municipality: '',
    address: '',
    identificationCode: '',
    wineAgencyRegistrationCode: '',
    legalAddress: '',
    factualAddress: '',
    certificateContactPerson: '',
    certificatePhone: '',
    certificateEmail: '',
    producerRegistrationNotes: '',
    contactEmail: '',
    phone: '',
    website: '',
    measurementUnits: 'metric',
    currency: 'GEL'
  });

  const [activeModule, setActiveModule] = useState<'portal' | 'vazi' | 'gvino' | 'integrations' | 'settings' | 'audit' | 'docs' | 'certification' | 'costs' | 'storage' | 'sales' | 'analytics'>('portal');
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
  const [vineyardProjects, setVineyardProjects] = useState<VineyardPlantingProject[]>([]);
  const [phenologyLogs, setPhenologyLogs] = useState<PhenologyRecord[]>([]);
  const [sprays, setSprays] = useState<SprayRecord[]>([]);
  const [scoutings, setScoutings] = useState<ScoutingRecord[]>([]);
  const [soilRecords, setSoilRecords] = useState<SoilAnalysisRecord[]>([]);
  const [samplings, setSamplings] = useState<GrapeSamplingRecord[]>([]);
  const [harvests, setHarvests] = useState<HarvestRecord[]>([]);
  const [irrigationLogs, setIrrigationLogs] = useState<IrrigationRecord[]>([]);
  const [fertilizerLogs, setFertilizerLogs] = useState<FertilizationRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<MaraniOSAuditLog[]>([]);
  const [bottlingRuns, setBottlingRuns] = useState<BottlingRunRecord[]>([]);
  const [transfers, setTransfers] = useState<CellarTransferRecord[]>([]);
  const [grapeIntakes, setGrapeIntakes] = useState<GrapeIntakeRecord[]>([]);
  const [cellarOps, setCellarOps] = useState<CellarOperation[]>([]);
  const [costEntries, setCostEntries] = useState<CostEntry[]>([]);
  const [winePricing, setWinePricing] = useState<WinePricing>({});
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [salesDispatches, setSalesDispatches] = useState<SalesDispatchRecord[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderRecord[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [certificationRecords, setCertificationRecords] = useState<CertificationRecord[]>([]);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [crmLeads, setCrmLeads] = useState<CrmLeadRecord[]>([]);
  const [aiDrafts, setAiDrafts] = useState<AiDraftQueueItem[]>([]);

  // Daily fermentation inputs
  const [logTankId, setLogTankId] = useState('');
  const [logLotId, setLogLotId] = useState('');
  const [logTemp, setLogTemp] = useState(20);
  const [logDensity, setLogDensity] = useState(1.005);
  const [logSugar, setLogSugar] = useState(12);
  const [logPH, setLogPH] = useState(3.5);
  const [logNotes, setLogNotes] = useState('');
  const [logCap, setLogCap] = useState('Punchdowns - 2X');
  const [chartLotId, setChartLotId] = useState<string>('');
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
  // Vessel preselected for the quick-operation form (QR scan / drawer action).
  const [prefilledOpVesselId, setPrefilledOpVesselId] = useState('');
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
      if (val === undefined) return;
      const serialized = JSON.stringify(val);
      lastServerState.current[key] = serialized;
      // Skip the setState when the server echoes exactly what we already hold
      // (localStorage mirrors current state). Replacing arrays with identical
      // content still changes their identity, which forces every consumer —
      // including the D3 charts — to rebuild and replay animations on each
      // sync response.
      let current: string | null = null;
      try { current = localStorage.getItem(localKey); } catch { /* ignore */ }
      if (current === serialized) return;
      setter(val);
      try { localStorage.setItem(localKey, serialized); } catch { /* ignore */ }
    };
    
    setSafe(setVessels, data.vessels, 'vessels', 'cf_vessels');
    setSafe(setLots, data.lots, 'lots', 'cf_lots');
    setSafe(setFermLogs, data.fermlogs, 'fermLogs', 'cf_fermlogs');
    setSafe(setLabLogs, data.lablogs, 'labLogs', 'cf_lablogs');
    setSafe(setInventory, data.inventory, 'inventory', 'cf_inventory');
    setSafe(setTasks, data.tasks, 'tasks', 'cf_tasks');
    setSafe(setNotesList, data.notes, 'notesList', 'cf_notes');
    setSafe(setBlocks, data.blocks, 'blocks', 'vinea_blocks');
    setSafe(setVineyardProjects, data.vineyardProjects, 'vineyardProjects', 'vinea_projects');
    setSafe(setPhenologyLogs, data.phenologyLogs, 'phenologyLogs', 'vinea_phenology');
    setSafe(setSprays, data.sprays, 'sprays', 'vinea_sprays');
    setSafe(setScoutings, data.scoutings, 'scoutings', 'vinea_scoutings');
    setSafe(setSoilRecords, data.soilRecords, 'soilRecords', 'vinea_soil');
    setSafe(setSamplings, data.samplings, 'samplings', 'vinea_samplings');
    setSafe(setHarvests, data.harvests, 'harvests', 'vinea_harvests');
    setSafe(setIrrigationLogs, data.irrigationLogs, 'irrigationLogs', 'vinea_irrigation');
    setSafe(setFertilizerLogs, data.fertilizerLogs, 'fertilizerLogs', 'vinea_fertilizer');
    setSafe(setAuditLogs, data.auditLogs, 'auditLogs', 'vinea_audit_logs');
    setSafe(setBottlingRuns, data.bottlingRuns, 'bottlingRuns', 'cf_bottling_history');
    setSafe(setTransfers, data.transfers, 'transfers', 'cf_transfers_history');
    setSafe(setGrapeIntakes, data.grapeIntakes, 'grapeIntakes', 'cf_grape_intakes');
    setSafe(setCellarOps, data.cellarOps, 'cellarOps', 'cf_cellar_ops');
    setSafe(setCostEntries, data.costEntries, 'costEntries', 'cf_cost_entries');
    setSafe(setWinePricing, data.winePricing, 'winePricing', 'cf_wine_pricing');
    setSafe(setStorageLocations, data.storageLocations, 'storageLocations', 'cf_storage_locations');
    setSafe(setStockMovements, data.stockMovements, 'stockMovements', 'cf_storage_movements');
    setSafe(setSalesDispatches, data.salesDispatches, 'salesDispatches', 'cf_sales_dispatches');
    setSafe(setSalesOrders, data.salesOrders, 'salesOrders', 'cf_sales_orders');
    setSafe(setSupplierPayments, data.supplierPayments, 'supplierPayments', 'cf_supplier_payments');
    setSafe(setCertificationRecords, data.certificationRecords, 'certificationRecords', 'cf_certification_records');
    setSafe(setAttachments, data.attachments, 'attachments', 'cf_attachments');
    setSafe(setCrmLeads, data.crmLeads, 'crmLeads', 'cf_crm_leads');
    setSafe(setAiDrafts, data.aiDrafts, 'aiDrafts', 'cf_ai_drafts');
    setSafe(setCompanyProfile, data.companyProfile, 'companyProfile', 'vinea_company_profile');
    const syncedAt = new Date().toISOString();
    setLastSyncAt(syncedAt);
    localStorage.setItem('vinea_last_sync_at', syncedAt);
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
        blocks, vineyardProjects, phenologyLogs, sprays, scoutings, soilRecords,
        samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
        bottlingRuns, transfers, grapeIntakes, cellarOps, costEntries, winePricing, storageLocations, stockMovements, salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments, crmLeads, aiDrafts,
        companyProfile
      };

      const response = await SyncQueueManager.sync(latestState);
      if (response) {
        if (response.hasConflicts) {
          setSyncConflicts(response.conflicts);
          setPendingServerDb(response.serverDb);
          setToastMessage(lang === 'ka' ? 'კონფლიქტი აღმოჩენილია სინქრონიზაციისას!' : 'Sync conflict detected! Review required.');
        } else if (response.orgStateConflict) {
          if (response.serverDb) {
            await SyncQueueManager.clearOfflineQueue();
            updateAllStates(response.serverDb);
          }
          setLastSyncError(response.syncError || 'Organization state conflict');
          setToastMessage(lang === 'ka'
            ? '⚠️ მონაცემები განახლდა სერვერიდან. თქვენი ბოლო ცვლილება არ ჩაიწერა, რადგან მეღვინეობის მონაცემები სხვა სესიამ შეცვალა.'
            : '⚠️ Refreshed from server. Your last change was not saved because this winery changed in another session.');
        } else if (response.syncError) {
          // The server rejected the whole sync — keep data dirty for retry,
          // but tell the user instead of failing silently.
          if (response.syncError !== lastSyncError) {
            setLastSyncError(response.syncError);
            setToastMessage(`⚠️ ${lang === 'ka' ? 'სინქრონიზაცია უარყოფილია' : 'Sync rejected'}: ${response.syncError}`);
          }
        } else {
          updateAllStates(response);
          if (response.recoveredOrgStateConflict) {
            setToastMessage(lang === 'ka'
              ? '✓ მონაცემები განახლდა და ცვლილება უსაფრთხოდ ჩაიწერა.'
              : '✓ Data refreshed and your change was saved safely.');
          }
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

  const hydrateAuthenticatedUser = async (user: UserProfile) => {
    setCurrentUser(user);
    setIsLoggedIn(true);

    // Speak the user's saved language from the first screen after login —
    // a Georgian account should not land in an English UI.
    if (user.language && (user.language === 'ka' || user.language === 'en')) {
      setLang(user.language);
      try { localStorage.setItem('vinea_lang', user.language); } catch { /* ignore */ }
    }

    try {
      await fetchOrganizations();
    } catch (orgErr) {
      console.error('Failed to fetch organizations:', orgErr);
    }

    // Hydrate through the same persisted sync path for every account,
    // including the optional public demo account.
    try {
      const dbData = await SyncQueueManager.sync({});
      if (dbData) updateAllStates(dbData);
    } catch (syncErr) {
      console.error('Initial login sync failed:', syncErr);
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
        await hydrateAuthenticatedUser(user);
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        if (err.code === 'email_unverified') {
          setVerificationPending({ email: identifier });
        }
        setLoginError(err.error || 'Authentication failed');
        return false;
      }
    } catch (err) {
      setLoginError('Could not reach secure login gateway');
      return false;
    }
  };

  const handleResendVerification = async (identifier: string) => {
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.devVerifyUrl) {
        setVerificationPending(prev => ({ email: prev?.email || identifier, devVerifyUrl: data.devVerifyUrl }));
      }
      setToastMessage(lang === 'ka'
        ? 'დადასტურების ბმული ხელახლა გაიგზავნა. შეამოწმეთ ელფოსტა.'
        : 'Verification link sent again — check your email.');
    } catch {
      setToastMessage(lang === 'ka' ? '⚠️ ბმულის გაგზავნა ვერ მოხერხდა.' : '⚠️ Could not resend the verification link.');
    }
  };

  const handleDemoLogin = async (): Promise<boolean> => {
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoginError(err.error || 'Demo workspace is unavailable');
        return false;
      }

      const user = await res.json();
      await hydrateAuthenticatedUser(user);
      return true;
    } catch {
      setLoginError('Could not reach the demo workspace');
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
    localStorage.removeItem('vinea_projects');
    localStorage.removeItem('vinea_phenology');
    localStorage.removeItem('vinea_sprays');
    localStorage.removeItem('vinea_scoutings');
    localStorage.removeItem('vinea_soil');
    localStorage.removeItem('vinea_samplings');
    localStorage.removeItem('vinea_harvests');
    localStorage.removeItem('vinea_irrigation');
    localStorage.removeItem('vinea_fertilizer');
    localStorage.removeItem('vinea_audit_logs');
    localStorage.removeItem('cf_bottling_history');
    localStorage.removeItem('cf_transfers_history');
    localStorage.removeItem('cf_cost_entries');
    localStorage.removeItem('cf_wine_pricing');
    localStorage.removeItem('cf_storage_locations');
    localStorage.removeItem('cf_storage_movements');
    localStorage.removeItem('cf_sales_dispatches');
    localStorage.removeItem('cf_sales_orders');
    localStorage.removeItem('cf_certification_records');
    localStorage.removeItem('cf_attachments');
    localStorage.removeItem('cf_crm_leads');
    localStorage.removeItem('cf_ai_drafts');
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
    setVineyardProjects([]);
    setPhenologyLogs([]);
    setSprays([]);
    setScoutings([]);
    setSoilRecords([]);
    setSamplings([]);
    setHarvests([]);
    setIrrigationLogs([]);
    setFertilizerLogs([]);
    setAuditLogs([]);
    setBottlingRuns([]);
    setTransfers([]);
    setGrapeIntakes([]);
    setCellarOps([]);
    setCostEntries([]);
    setWinePricing({});
    setStorageLocations([]);
    setStockMovements([]);
    setSalesDispatches([]);
    setSalesOrders([]);
    setSupplierPayments([]);
    setCertificationRecords([]);
    setAttachments([]);
    setCrmLeads([]);
    setAiDrafts([]);
  };

  const handleAuthRegister = async (profileData: RegistrationProfileData) => {
    setLoginError(null);
    setVerificationPending(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData)
      });
      if (res.ok) {
        const user = await res.json();

        // New accounts must confirm their email before the session is created.
        if (user && user.requiresVerification) {
          setVerificationPending({ email: user.email || profileData.email, devVerifyUrl: user.devVerifyUrl });
          return;
        }

        setCurrentUser(user);
        setIsLoggedIn(true);

        // Only force full upload if there are unsynced offline changes made as guest
        const hasOfflineChanges = SyncQueueManager.getDirtyCollections().size > 0;
        const initialDB = await SyncQueueManager.sync(hasOfflineChanges ? {
          vessels, lots, fermLogs, labLogs, inventory, tasks, notesList,
          blocks, vineyardProjects, phenologyLogs, sprays, scoutings, soilRecords,
          samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
          bottlingRuns, transfers, grapeIntakes, cellarOps, costEntries, winePricing, storageLocations, stockMovements, salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments, crmLeads, aiDrafts,
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

  const handleCompleteRegistration = async (setupData: CompleteRegistrationData): Promise<boolean> => {
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/complete_registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(setupData)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err.error || 'Registration setup failed';
        setLoginError(message);
        setToastMessage(`⚠️ ${message}`);
        return false;
      }

      const updated = await res.json();
      setCurrentUser(updated);
      setCompanyProfile(prev => ({
        ...prev,
        ...setupData.companyProfile,
      }));
      await fetchOrganizations();

      const dbData = await SyncQueueManager.sync({});
      if (dbData) updateAllStates(dbData);
      setToastMessage(lang === 'ka' ? 'პროფილი მზად არის.' : 'Workspace setup complete.');
      return true;
    } catch (err) {
      console.error('Failed to complete registration:', err);
      setLoginError('Could not complete registration setup');
      setToastMessage('⚠️ Could not complete registration setup.');
      return false;
    }
  };

  const handleUpdateProfile = async (updates: Partial<UserProfile>) => {
    try {
      const res = await fetch('/api/auth/update_profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentUser(updated);
        localStorage.setItem('vinea_curr_user', JSON.stringify(updated));
        setToastMessage(lang === 'ka' ? 'პროფილი განახლდა!' : 'Profile updated successfully!');
      } else {
        const err = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ Profile update failed: ${err.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Failed to update profile:', err);
      setToastMessage('⚠️ Failed to connect for profile update.');
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
        localStorage.removeItem('vinea_projects');
        localStorage.removeItem('vinea_phenology');
        localStorage.removeItem('vinea_sprays');
        localStorage.removeItem('vinea_scoutings');
        localStorage.removeItem('vinea_soil');
        localStorage.removeItem('vinea_samplings');
        localStorage.removeItem('vinea_harvests');
        localStorage.removeItem('vinea_irrigation');
        localStorage.removeItem('vinea_fertilizer');
        localStorage.removeItem('vinea_audit_logs');
        localStorage.removeItem('cf_bottling_history');
        localStorage.removeItem('cf_transfers_history');
        localStorage.removeItem('cf_cost_entries');
        localStorage.removeItem('cf_wine_pricing');
        localStorage.removeItem('cf_storage_locations');
        localStorage.removeItem('cf_storage_movements');
        localStorage.removeItem('cf_sales_dispatches');
        localStorage.removeItem('cf_sales_orders');
        localStorage.removeItem('cf_certification_records');
        localStorage.removeItem('cf_attachments');
        localStorage.removeItem('cf_crm_leads');
        localStorage.removeItem('cf_ai_drafts');
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
    let cancelled = false;

    fetch('/api/config')
      .then((res) => res.ok ? res.json() : null)
      .then((config) => {
        if (!cancelled) setDemoLoginEnabled(Boolean(config?.demoLoginEnabled));
      })
      .catch(() => {
        if (!cancelled) setDemoLoginEnabled(false);
      });

    const parseCached = <T>(key: string, fallback: T): T => {
      const cached = localStorage.getItem(key);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return fallback;
        }
      }
      return fallback;
    };

    const hydrateLocalWineryCache = async () => {
      const defaults = await import('../lib/wineryDefaults');
      if (cancelled) return;

      // Only remembered/authenticated sessions need winery datasets on boot.
      // The logged-out shell stays lean and does not load cellar/vineyard defaults.
      setVessels(parseCached('cf_vessels', defaults.initialVessels));
      setLots(parseCached('cf_lots', defaults.initialLots));
      setFermLogs(parseCached('cf_fermlogs', defaults.initialFermLogs));
      setLabLogs(parseCached('cf_lablogs', defaults.initialLabLogs));
      setInventory(parseCached('cf_inventory', defaults.initialInventory));
      setTasks(parseCached('cf_tasks', defaults.initialTasks));
      setNotesList(parseCached('cf_notes', initialCellarNotes));
      setBottlingRuns(parseCached('cf_bottling_history', []));
      setTransfers(parseCached('cf_transfers_history', []));
      setGrapeIntakes(parseCached('cf_grape_intakes', defaults.initialGrapeIntakes));
      setCellarOps(parseCached('cf_cellar_ops', defaults.initialCellarOps));
      setCostEntries(parseCached('cf_cost_entries', []));
      setWinePricing(parseCached('cf_wine_pricing', {}));
      setStorageLocations(parseCached('cf_storage_locations', []));
      setStockMovements(parseCached('cf_storage_movements', []));
      setSalesDispatches(parseCached('cf_sales_dispatches', defaults.initialSalesDispatches));
      setSalesOrders(parseCached('cf_sales_orders', defaults.initialSalesOrders));
      setSupplierPayments(parseCached('cf_supplier_payments', defaults.initialSupplierPayments));
      setCertificationRecords(parseCached('cf_certification_records', defaults.initialCertificationRecords));
      setAttachments(parseCached('cf_attachments', []));
      setCrmLeads(parseCached('cf_crm_leads', []));
      setAiDrafts(parseCached('cf_ai_drafts', []));

      setBlocks(parseCached('vinea_blocks', defaults.initialVineyardBlocks));
      setVineyardProjects(parseCached('vinea_projects', defaults.initialVineyardPlantingProjects));
      setPhenologyLogs(parseCached('vinea_phenology', defaults.initialPhenologyRecords));
      setSprays(parseCached('vinea_sprays', defaults.initialSprayRecords));
      setScoutings(parseCached('vinea_scoutings', defaults.initialScoutingRecords));
      setSoilRecords(parseCached('vinea_soil', defaults.initialSoilAnalysis));
      setSamplings(parseCached('vinea_samplings', defaults.initialGrapeSamples));
      setHarvests(parseCached('vinea_harvests', defaults.initialHarvestRecords));
      setIrrigationLogs(parseCached('vinea_irrigation', defaults.initialIrrigationLogs));
      setFertilizerLogs(parseCached('vinea_fertilizer', defaults.initialFertilizerLogs));
      setAuditLogs(parseCached('vinea_audit_logs', defaults.initialMaraniOSAuditLogs));
    };

    const hasLocalSession = localStorage.getItem('vinea_is_logged_in') === 'true';
    setIsSidebarCollapsed(localStorage.getItem('cf_sidebar_collapsed') === 'true');
    setLastSyncAt(localStorage.getItem('vinea_last_sync_at'));

    setIsLoggedIn(hasLocalSession);
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

    // Restore session and sync from server
    const checkSessionAndSync = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const user = await res.json();
          if (cancelled) return;
          setCurrentUser(user);
          setIsLoggedIn(true);
          
          await fetchOrganizations();
          
          const dbData = await SyncQueueManager.sync({});
          if (!cancelled && dbData) {
            updateAllStates(dbData);
          }
        } else if (res.status === 401 && hasLocalSession && !cancelled) {
          // A cached flag must never impersonate an authenticated session. Keep
          // offline operation on network failure, but an authoritative 401
          // clears stale identity and cached winery data.
          await handleAuthLogout();
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        if (!cancelled) hasHydrated.current = true;
      }
    };

    const bootstrap = async () => {
      if (hasLocalSession) {
        try {
          await hydrateLocalWineryCache();
        } catch (err) {
          console.error('Failed to hydrate local winery cache:', err);
        }
      }
      if (!cancelled) await checkSessionAndSync();
    };
    bootstrap();

    // Deep link logic
    if (hasLocalSession) {
      const params = new URLSearchParams(window.location.search);
      const lotParam = params.get('lot');
      const tankParam = params.get('tank');
      if (lotParam) {
        setActiveModule('gvino');
        setActiveTab('lots');
        setPassportLotId(lotParam);
      } else if (tankParam) {
        setActiveModule('gvino');
        if (params.get('op') === '1') {
          // Cellar-floor QR label: straight to the quick-operation form,
          // scoped to the scanned vessel.
          setActiveTab('operations');
          setPrefilledOpVesselId(tankParam);
        } else {
          setActiveTab('vessels');
          setSelectedTankId(tankParam);
        }
      }
    }

    // Email-verification landing (redirected here from the verification link).
    const params = new URLSearchParams(window.location.search);
    const verified = params.get('verified');
    const verifyError = params.get('verify_error');
    if (verified || verifyError) {
      const isKa = (localStorage.getItem('vinea_lang') as Language) === 'ka';
      if (verified) {
        setToastMessage(isKa ? '✅ ელფოსტა დადასტურდა — ახლა შეგიძლიათ შესვლა.' : '✅ Email verified — you can now sign in.');
      } else {
        setToastMessage(verifyError === 'expired'
          ? (isKa ? '⚠️ დადასტურების ბმულს ვადა გაუვიდა. მოითხოვეთ ახალი.' : '⚠️ Verification link expired. Please request a new one.')
          : (isKa ? '⚠️ დადასტურების ბმული არასწორია.' : '⚠️ Invalid verification link.'));
      }
      // Strip the params so a refresh doesn't repeat the toast.
      window.history.replaceState({}, '', window.location.pathname);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Atomic sync to Local Storage with Auto-API sync wrappers
  const handleCollectionUpdate = (key: string, localKey: string, value: any) => {
    if (!isClient || !isLoggedIn || !hasHydrated.current) return;
    
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
      vineyardProjects: setVineyardProjects,
      phenologyLogs: setPhenologyLogs,
      sprays: setSprays,
      scoutings: setScoutings,
      soilRecords: setSoilRecords,
      samplings: setSamplings,
      harvests: setHarvests,
      irrigationLogs: setIrrigationLogs,
      fertilizerLogs: setFertilizerLogs,
      auditLogs: setAuditLogs,
      salesDispatches: setSalesDispatches,
      salesOrders: setSalesOrders,
      supplierPayments: setSupplierPayments,
      certificationRecords: setCertificationRecords,
      attachments: setAttachments,
      crmLeads: setCrmLeads,
      aiDrafts: setAiDrafts
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
        blocks, vineyardProjects, phenologyLogs, sprays, scoutings, soilRecords,
        samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
        bottlingRuns, transfers, grapeIntakes, cellarOps, costEntries, winePricing, storageLocations, stockMovements, salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments, crmLeads, aiDrafts,
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
  useEffect(() => { handleCollectionUpdate('bottlingRuns', 'cf_bottling_history', bottlingRuns); }, [bottlingRuns, isClient]);
  useEffect(() => { handleCollectionUpdate('transfers', 'cf_transfers_history', transfers); }, [transfers, isClient]);
  useEffect(() => { handleCollectionUpdate('grapeIntakes', 'cf_grape_intakes', grapeIntakes); }, [grapeIntakes, isClient]);
  useEffect(() => { handleCollectionUpdate('cellarOps', 'cf_cellar_ops', cellarOps); }, [cellarOps, isClient]);
  useEffect(() => { handleCollectionUpdate('costEntries', 'cf_cost_entries', costEntries); }, [costEntries, isClient]);
  useEffect(() => { handleCollectionUpdate('winePricing', 'cf_wine_pricing', winePricing); }, [winePricing, isClient]);
  useEffect(() => { handleCollectionUpdate('storageLocations', 'cf_storage_locations', storageLocations); }, [storageLocations, isClient]);
  useEffect(() => { handleCollectionUpdate('stockMovements', 'cf_storage_movements', stockMovements); }, [stockMovements, isClient]);
  useEffect(() => { handleCollectionUpdate('salesDispatches', 'cf_sales_dispatches', salesDispatches); }, [salesDispatches, isClient]);
  useEffect(() => { handleCollectionUpdate('salesOrders', 'cf_sales_orders', salesOrders); }, [salesOrders, isClient]);
  useEffect(() => { handleCollectionUpdate('supplierPayments', 'cf_supplier_payments', supplierPayments); }, [supplierPayments, isClient]);
  useEffect(() => { handleCollectionUpdate('certificationRecords', 'cf_certification_records', certificationRecords); }, [certificationRecords, isClient]);
  useEffect(() => { handleCollectionUpdate('attachments', 'cf_attachments', attachments); }, [attachments, isClient]);
  useEffect(() => { handleCollectionUpdate('crmLeads', 'cf_crm_leads', crmLeads); }, [crmLeads, isClient]);
  useEffect(() => { handleCollectionUpdate('aiDrafts', 'cf_ai_drafts', aiDrafts); }, [aiDrafts, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_sidebar_collapsed', String(isSidebarCollapsed)); }, [isSidebarCollapsed, isClient]);

  useEffect(() => { if (isClient) localStorage.setItem('vinea_is_logged_in', String(isLoggedIn)); }, [isLoggedIn, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_curr_user', JSON.stringify(currentUser)); }, [currentUser, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_company_profile', JSON.stringify(companyProfile)); }, [companyProfile, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_active_module', activeModule); }, [activeModule, isClient]);

  useEffect(() => { handleCollectionUpdate('blocks', 'vinea_blocks', blocks); }, [blocks, isClient]);
  useEffect(() => { handleCollectionUpdate('vineyardProjects', 'vinea_projects', vineyardProjects); }, [vineyardProjects, isClient]);
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

  const handleAddVineyardProject = (project: Omit<VineyardPlantingProject, 'id'>) => {
    const id = sanitizeId(`vp-${Date.now()}`);
    setVineyardProjects(prev => [...prev, { ...project, id }]);
  };

  const handleUpdateVineyardProject = (id: string, updated: Partial<VineyardPlantingProject>) => {
    setVineyardProjects(prev => prev.map(project => project.id === id ? { ...project, ...updated } : project));
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
    const intendedAppellation = cleanText(assocBlock?.microzone);
    const cadastralCode = cleanText(assocBlock?.cadastralCode);
    const originDetails = [
      cadastralCode ? `cadastre ${cadastralCode}` : '',
      intendedAppellation ? `microzone ${intendedAppellation}` : '',
      cleanText(assocBlock?.village) ? `village ${cleanText(assocBlock?.village)}` : '',
    ].filter(Boolean).join(', ');
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
      intendedAppellation,
      classification: inferPdoClassification(intendedAppellation),
      originProofStatus: inferOriginProofStatus(cadastralCode, intendedAppellation, cleanText(assocBlock?.village)),
      marketStatus: 'unknown',
      history: [
        {
          date: harvestedDate,
          type: 'Harvest Dispatch',
          description: `Secured full viticulture-to-enology traceability link. ${variety} grape yield of ${harvestedKg.toLocaleString()} Kg.${originDetails ? ` Origin mirror: ${originDetails}.` : ''}`,
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
      notes: `Secured full viticulture-to-enology traceability link: ${variety} grape yield of ${harvestedKg} Kg.`
    };
    setAuditLogs(prev => [signAuditEntries([audit], prev)[0], ...prev]);

    return lotId;
  };

  /**
   * Structured grape receiving / intake. Creates a wine batch (WineLot) from the
   * captured fruit, optionally fills a destination vessel, seeds the first
   * fermentation log with the chemistry measured at the weighbridge, records the
   * intake document, and writes an audit entry. Returns the new lot id.
   */
  const handleReceiveGrapes = (
    input: Omit<GrapeIntakeRecord, 'id' | 'createdLotId' | 'netWeightKg' | 'estimatedVolumeL'>,
  ): string => {
    const netWeightKg = Math.max(0, (input.grossWeightKg || 0) - (input.tareWeightKg || 0));
    const estimatedVolumeL = estimateMustVolumeL(netWeightKg, input.juiceYieldPct || 0);
    const intakeId = sanitizeId(`intake-${Date.now()}`);

    const rawLotId = `LOT-${(input.variety || 'XX').substring(0, 2).toUpperCase()}-${input.vintage}-${Date.now().toString().slice(-4)}`;
    const lotId = sanitizeId(rawLotId);
    const origin = input.source === 'own'
      ? (input.blockName || 'Own vineyard')
      : (input.supplierName || 'Supplier');
    const lotName = `${input.variety} — ${origin} ${input.vintage}`;

    const newLot: WineLot = {
      id: lotId,
      name: lotName,
      vintage: input.vintage,
      variety: input.variety,
      vineyardBlock: input.source === 'own' ? (input.blockName || '') : (input.supplierName || ''),
      region: companyProfile.region || 'Kakheti',
      initialVolume: estimatedVolumeL,
      currentVolume: estimatedVolumeL,
      wineClass: input.wineClass,
      stage: 'crushing',
      createdAt: input.date,
      intendedAppellation: cleanText(input.microzone),
      classification: inferPdoClassification(cleanText(input.microzone)),
      originProofStatus: inferOriginProofStatus(
        cleanText(input.cadastralCode),
        cleanText(input.municipality),
        cleanText(input.village),
        cleanText(input.microzone),
      ),
      marketStatus: 'unknown',
      history: [
        {
          date: input.date,
          type: 'Grape Receiving',
          description: `Intake of ${netWeightKg.toLocaleString()} kg ${input.variety} (${input.source === 'own' ? input.blockName || 'own block' : input.supplierName || 'supplier'}) — ${input.brix}°Brix, pH ${input.ph}, TA ${input.titratableAcidity} g/L. Est. ${estimatedVolumeL} L must.`,
          operator: input.operator || currentUser.fullName,
        },
      ],
    };
    setLots(prev => [...prev, newLot]);

    // Fill the destination vessel if one was chosen.
    if (input.destinationVesselId) {
      setVessels(prev => prev.map(v => v.id !== input.destinationVesselId ? v : {
        ...v,
        currentVolume: Math.round((v.currentVolume + estimatedVolumeL) * 10) / 10,
        assignedLotId: lotId,
        temperature: input.temperatureC,
        lastOperation: `Grape intake: ${input.variety} (${estimatedVolumeL} L must)`,
      }));
    }

    // Seed the first fermentation log with the real measured chemistry.
    const firstFermLog: DailyFermLog = {
      id: sanitizeId(`flog-${Date.now()}`),
      tankId: input.destinationVesselId || '',
      lotId,
      date: input.date,
      temperature: input.temperatureC,
      density: 1.090,
      sugar: input.brix,
      ph: input.ph,
      tastingNotes: `Received ${input.condition} condition fruit (${input.pickingMethod} picked).`,
      capManagement: 'None',
      additives: 'None',
    };
    setFermLogs(prev => [...prev, firstFermLog]);

    const intakeRecord: GrapeIntakeRecord = {
      ...input,
      id: intakeId,
      netWeightKg,
      estimatedVolumeL,
      createdLotId: lotId,
      currency: input.currency || companyProfile.currency || 'GEL',
    };
    setGrapeIntakes(prev => [intakeRecord, ...prev]);

    const grapeCost = grapeIntakeCostEntry(intakeRecord, {
      currency: companyProfile.currency || 'GEL',
      createdBy: input.operator || currentUser.fullName,
    });
    if (grapeCost) {
      setCostEntries(prev => [grapeCost, ...prev]);
    }

    // Link a Vazi harvest record when the fruit came from the field.
    if (input.harvestRecordId) {
      setHarvests(prev => prev.map(h => h.id !== input.harvestRecordId ? h : {
        ...h,
        sentToGvino: true,
        actualHarvestedKg: netWeightKg,
        actualHarvestDate: input.date,
        associatedLotId: lotId,
      }));
    }

    const audit: MaraniOSAuditLog = {
      id: sanitizeId(`audit-${Date.now()}`),
      timestamp: new Date().toISOString(),
      user: input.operator || currentUser.fullName,
      module: 'GVINO',
      actionType: 'Grape Receiving',
      changedItem: `WineLot ${lotId}`,
      oldValue: 'None',
      newValue: `${netWeightKg} kg ${input.variety} → ${estimatedVolumeL} L must${input.destinationVesselId ? ` in ${input.destinationVesselId}` : ''}`,
      notes: `Source: ${origin}. ${input.brix}°Brix, pH ${input.ph}, TA ${input.titratableAcidity} g/L.`,
    };
    setAuditLogs(prev => [signAuditEntries([audit], prev)[0], ...prev]);

    return lotId;
  };

  /**
   * Fast cellar-operation entry. Records a single winemaking action against a
   * batch: appends a readable entry to the lot timeline, deducts an inventory
   * material when one is consumed, applies a volume change (loss/addition) to the
   * lot and its vessel, and writes an audit entry. Returns the operation id.
   */
  /**
   * Record a payment to a grape supplier (rtveli settlements). The balance is
   * always derived (intake costs − payments), so this only appends the payment
   * and an audit entry.
   */
  const handleAddSupplierPayment = (input: Omit<SupplierPayment, 'id' | 'operator'> & { operator?: string }): string => {
    const id = sanitizeId(`spay-${Date.now()}`);
    const payment: SupplierPayment = {
      ...input,
      id,
      operator: input.operator || currentUser.fullName,
    };
    setSupplierPayments(prev => [payment, ...prev]);

    const audit: MaraniOSAuditLog = {
      id: sanitizeId(`audit-${Date.now()}`),
      timestamp: new Date().toISOString(),
      user: payment.operator,
      module: 'GVINO',
      actionType: 'Supplier Payment',
      changedItem: payment.supplierName,
      oldValue: '',
      newValue: `${payment.amount} ${payment.currency} (${payment.method})`,
      notes: payment.note || '',
    };
    setAuditLogs(prev => [audit, ...prev]);
    return id;
  };

  const handleDeleteSupplierPayment = (id: string) => {
    const payment = supplierPayments.find(p => p.id === id);
    setSupplierPayments(prev => prev.filter(p => p.id !== id));
    if (payment) {
      const audit: MaraniOSAuditLog = {
        id: sanitizeId(`audit-${Date.now()}`),
        timestamp: new Date().toISOString(),
        user: currentUser.fullName,
        module: 'GVINO',
        actionType: 'Supplier Payment Deleted',
        changedItem: payment.supplierName,
        oldValue: `${payment.amount} ${payment.currency}`,
        newValue: '',
        notes: payment.note || '',
      };
      setAuditLogs(prev => [audit, ...prev]);
    }
  };

  const handleAddCellarOperation = (
    input: Omit<CellarOperation, 'id' | 'lotName' | 'volumeBeforeL' | 'materialName' | 'unit'>,
  ): string => {
    const lot = lots.find(l => l.id === input.lotId);
    if (!lot) return '';

    const meta = CELLAR_OPERATIONS.find(o => o.key === input.type);
    const opLabel = input.type === 'custom'
      ? (input.customLabel || 'Custom operation')
      : (lang === 'ka' ? (meta?.ka || input.type) : (meta?.en || input.type));

    const material = input.materialId ? inventory.find(i => i.id === input.materialId) : undefined;
    const volumeBeforeL = lot.currentVolume;
    const hasVolumeChange = input.volumeAfterL != null && Number.isFinite(input.volumeAfterL);
    const volumeAfterL = hasVolumeChange ? Math.max(0, input.volumeAfterL as number) : undefined;

    const opId = sanitizeId(`op-${Date.now()}`);
    const operator = input.operator || currentUser.fullName;
    const dateOnly = (input.date || new Date().toISOString()).slice(0, 10);

    // Build a readable timeline description.
    const parts: string[] = [opLabel];
    if (material && input.dose) parts.push(`${material.name} ${input.dose}${material.unit || ''}`);
    if (input.vesselId) parts.push(input.vesselToId ? `${input.vesselId} → ${input.vesselToId}` : `${input.vesselId}`);
    if (hasVolumeChange) parts.push(`${volumeBeforeL} → ${volumeAfterL} L`);
    if (input.notes) parts.push(input.notes);
    const description = parts.join(' · ');

    // 1) Lot: timeline entry + optional volume change.
    setLots(prev => prev.map(l => l.id !== lot.id ? l : {
      ...l,
      currentVolume: hasVolumeChange ? (volumeAfterL as number) : l.currentVolume,
      history: [
        { date: dateOnly, type: opLabel, description, operator },
        ...(l.history || []),
      ],
    }));

    // 2) Vessel: mirror the volume change on the operating vessel.
    if (input.vesselId && hasVolumeChange) {
      setVessels(prev => prev.map(v => v.id !== input.vesselId ? v : {
        ...v,
        currentVolume: volumeAfterL as number,
        lastOperation: description,
      }));
    } else if (input.vesselId) {
      setVessels(prev => prev.map(v => v.id !== input.vesselId ? v : { ...v, lastOperation: description }));
    }

    // 3) Inventory: deduct the consumed material (clamped at zero).
    if (material && input.dose && input.dose > 0) {
      setInventory(prev => prev.map(i => i.id !== material.id ? i : {
        ...i,
        stock: deductStock(i.stock, input.dose as number),
      }));
    }

    // 4) Operation record.
    const op: CellarOperation = {
      ...input,
      id: opId,
      lotName: lot.name,
      operator,
      volumeBeforeL,
      volumeAfterL,
      materialName: material?.name,
      unit: material?.unit,
    };
    setCellarOps(prev => [op, ...prev]);

    const materialCost = materialCostEntryFromOperation(op, material, {
      currency: companyProfile.currency || 'GEL',
      createdBy: operator,
    });
    if (materialCost) {
      setCostEntries(prev => [materialCost, ...prev]);
    }

    // 5) Audit.
    const audit: MaraniOSAuditLog = {
      id: sanitizeId(`audit-${Date.now()}`),
      timestamp: new Date().toISOString(),
      user: operator,
      module: 'GVINO',
      actionType: `Cellar Operation: ${opLabel}`,
      changedItem: `Lot ${lot.id}`,
      oldValue: hasVolumeChange ? `${volumeBeforeL} L` : '',
      newValue: hasVolumeChange ? `${volumeAfterL} L` : description,
      notes: description,
    };
    setAuditLogs(prev => [signAuditEntries([audit], prev)[0], ...prev]);

    return opId;
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

  const handleAddAttachment = (input: DocumentAttachmentInput): DocumentAttachment => {
    const attachment = createDocumentAttachmentRecord({
      ...input,
      uploadedBy: input.uploadedBy || currentUser.fullName || currentUser.username,
    });
    setAttachments(prev => [attachment, ...prev.filter(item => item.id !== attachment.id)]);
    setToastMessage(lang === 'ka' ? 'Attachment saved for review.' : 'Attachment saved for review.');
    return attachment;
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    recordDeletion(attachmentId);
    setAttachments(prev => prev.filter(item => item.id !== attachmentId));
    setToastMessage(lang === 'ka' ? 'Attachment removed.' : 'Attachment removed.');
  };

  const handleSaveCrmLead = (input: CrmLeadRecordInput): CrmLeadRecord => {
    const lead = createCrmLeadRecord({
      ...input,
      owner: input.owner || currentUser.fullName || currentUser.username,
    });
    setCrmLeads(prev => upsertCrmLeadRecord(prev, lead));
    setToastMessage(lang === 'ka' ? 'CRM lead saved.' : 'CRM lead saved.');
    return lead;
  };

  const handleUpdateCrmLeadStatus = (leadId: string, status: CrmLeadRecord['status']) => {
    setCrmLeads(prev => prev.map(lead => (
      lead.id === leadId
        ? { ...lead, status, updatedAt: new Date().toISOString() }
        : lead
    )));
  };

  const handleDeleteCrmLead = (leadId: string) => {
    recordDeletion(leadId);
    setCrmLeads(prev => prev.filter(lead => lead.id !== leadId));
    setToastMessage(lang === 'ka' ? 'CRM lead removed.' : 'CRM lead removed.');
  };

  const handleSaveAiDraftActions = (actions: AiDraftAction[], dueDate?: string): number => {
    const items = createAiDraftQueueItems(actions, {
      createdBy: currentUser.fullName || currentUser.username,
      dueDate,
      sourceModule: activeModule,
      sourceTab: activeTab,
    });
    setAiDrafts(prev => upsertAiDraftQueueItems(prev, items));
    setToastMessage(lang === 'ka' ? 'AI draft actions saved for review.' : 'AI draft actions saved for review.');
    return items.length;
  };

  const handleUpdateAiDraftStatus = (draftId: string, status: AiDraftQueueStatus) => {
    setAiDrafts(prev => prev.map(draft => (
      draft.id === draftId
        ? { ...draft, status }
        : draft
    )));
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
      vineyardProjects: db.vineyardProjects || vineyardProjects,
      phenologyLogs: db.phenologyLogs || phenologyLogs,
      sprays: db.sprays || sprays,
      scoutings: db.scoutings || scoutings,
      soilRecords: db.soilRecords || soilRecords,
      samplings: db.samplings || samplings,
      harvests: db.harvests || harvests,
      irrigationLogs: db.irrigationLogs || irrigationLogs,
      fertilizerLogs: db.fertilizerLogs || fertilizerLogs,
      auditLogs: db.auditLogs || auditLogs,
      bottlingRuns: db.bottlingRuns || bottlingRuns,
      transfers: db.transfers || transfers,
      costEntries: db.costEntries || costEntries,
      winePricing: db.winePricing || winePricing,
      storageLocations: db.storageLocations || storageLocations,
      stockMovements: db.stockMovements || stockMovements,
      salesDispatches: db.salesDispatches || salesDispatches,
      salesOrders: db.salesOrders || salesOrders,
      supplierPayments: db.supplierPayments || supplierPayments,
      certificationRecords: db.certificationRecords || certificationRecords,
      attachments: db.attachments || attachments,
      crmLeads: db.crmLeads || crmLeads,
      aiDrafts: db.aiDrafts || aiDrafts,
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
    verificationPending, setVerificationPending,
    demoLoginEnabled,
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
    vineyardProjects, setVineyardProjects,
    phenologyLogs, setPhenologyLogs,
    sprays, setSprays,
    scoutings, setScoutings,
    soilRecords, setSoilRecords,
    samplings, setSamplings,
    harvests, setHarvests,
    irrigationLogs, setIrrigationLogs,
    fertilizerLogs, setFertilizerLogs,
    auditLogs, setAuditLogs,
    bottlingRuns, setBottlingRuns,
    transfers, setTransfers,
    grapeIntakes, setGrapeIntakes,
    cellarOps, setCellarOps,
    costEntries, setCostEntries,
    winePricing, setWinePricing,
    storageLocations, setStorageLocations,
    stockMovements, setStockMovements,
    salesDispatches, setSalesDispatches,
    salesOrders, setSalesOrders,
    supplierPayments, setSupplierPayments,
    certificationRecords, setCertificationRecords,
    attachments, setAttachments,
    crmLeads, setCrmLeads,
    aiDrafts, setAiDrafts,

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
    prefilledOpVesselId, setPrefilledOpVesselId,
    prefilledDestId, setPrefilledDestId,

    // Actions
    sanitizeId,
    triggerSync,
    handleToggleCoolingJacket,
    handleAdjustTargetTemp,
    handleToggleSanitation,
    handleAddBlock,
    handleUpdateBlock,
    handleAddVineyardProject,
    handleUpdateVineyardProject,
    handleAddPhenologyLog,
    handleAddSprayRecord,
    handleAddScoutingRecord,
    handleAddSamplings,
    handleAddHarvestRecord,
    handleUpdateHarvestRecord,
    handleAddIrrigation,
    handleAddFertilizer,
    handleSendHarvestToGvino,
    handleReceiveGrapes,
    handleAddCellarOperation,
    handleAddSupplierPayment,
    handleDeleteSupplierPayment,
    handleAddFermLog,
    handleAddLabLog,
    handleToggleTaskStatus,
    handleAddNewTask,
    handleAddAttachment,
    handleDeleteAttachment,
    handleSaveCrmLead,
    handleUpdateCrmLeadStatus,
    handleDeleteCrmLead,
    handleSaveAiDraftActions,
    handleUpdateAiDraftStatus,
    handleDeleteTask,
    handleAddNewNote,
    handleDeleteNote,
    handleAddInventory,
    handleAuthLogin,
    handleDemoLogin,
    handleAuthLogout,
    handleAuthRegister,
    handleCompleteRegistration,
    handleResendVerification,
    handleUpdateProfile,
    organizations,
    fetchOrganizations,
    handleSwitchOrganization,
    syncConflicts,
    setSyncConflicts,
    resolveConflict,
    lastSyncError,
    setLastSyncError,
    lastSyncAt,
    discardLocalUnsyncedChanges,
    clearAllData
  };
}
