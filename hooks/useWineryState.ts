import { useState, useEffect, useRef } from 'react';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import { normalizeSupportedLanguage, type Language } from '../lib/language';
import {
  SyncQueueManager,
  IndexedDBQueue,
  type PendingConflictSyncIntent,
} from '../lib/syncQueue';
import type {
  Vessel,
  WineLot,
  DailyFermLog,
  LabAnalysis,
  InventoryItem,
  Task,
  TaskAssignmentInput,
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
import {
  automaticLabCostEntry,
  grapeIntakeCostEntry,
  materialCostEntryFromOperation,
  resolveCostAutomationSettings,
} from '../lib/costing';
import type { WinePricing } from '../lib/costing/store';
import {
  storageLocationReferences,
  storageMovementDeletionBlockers,
  type StorageLocation,
  type StockMovement,
} from '../lib/storage';
import type { InventoryMovementRecord, InvoiceReceiptRecord } from '../lib/commands/invoiceReceipt';
import { PDO_RULES } from '../lib/pdo';
import { createDocumentAttachmentRecord, type DocumentAttachmentInput } from '../lib/attachments';
import { createCrmLeadRecord, upsertCrmLeadRecord, type CrmLeadRecordInput } from '../lib/crm';
import {
  persistDeletionTombstones,
  syncRecordFingerprint,
  type DeletionTombstone,
} from '../lib/deletionTombstones';
import { createUniqueLotId, createUniqueRecordId } from '../lib/recordIds';
import { recordContentEquals } from '../lib/recordEquality';
import { useStatusToastControls } from './useStatusToast';
import { useStableCallbacks } from './useStableCallbacks';
import {
  createAiDraftQueueItems,
  upsertAiDraftQueueItems,
  type AiDraftAction,
  type AiDraftQueueItem,
  type AiDraftQueueStatus,
} from '../lib/aiDraftActions';
import { isKnownRole } from '../server/permissions';
import type {
  BottlingCommandResponse,
  CellarOperationCommandResponse,
  FermentationCompletionCommandResponse,
  FermentationCompletionReversalCommandResponse,
  HarvestIntakeCommandResponse,
  InvoiceReceiptCommandResponse,
  SalesStockCommandResponse,
  StorageMovementCommandResponse,
  TransferCommandResponse,
  TransferReversalCommandResponse,
} from '../lib/commands/client';
import type {
  ProductionPlanItem,
  PurchaseOrder,
  QualitySop,
  RecallCase,
} from '../lib/operationsControl';

interface RolePersistence {
  setItem(key: string, value: string): void;
}

export function cacheSafeUserProfile(user: UserProfile): UserProfile {
  const cachedUser = { ...user };
  delete cachedUser.isMasterAdmin;
  delete cachedUser.impersonatedBy;
  return cachedUser;
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
    storage?.setItem('vinea_curr_user', JSON.stringify(cacheSafeUserProfile(updatedUser)));
  } catch {
    // React state remains authoritative when persistent storage is unavailable.
  }
  return updatedUser;
}

export function applyLiveSessionProfile(
  currentUser: UserProfile,
  response: unknown,
  storage?: RolePersistence,
): UserProfile | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const candidate = response as Partial<UserProfile>;
  if (!isKnownRole(candidate.role)) return null;
  if (typeof candidate.username !== 'string' || candidate.username !== currentUser.username) return null;

  const updatedUser: UserProfile = {
    ...currentUser,
    username: candidate.username,
    role: candidate.role,
    ...(typeof candidate.email === 'string' ? { email: candidate.email } : {}),
    ...(typeof candidate.fullName === 'string' ? { fullName: candidate.fullName } : {}),
    ...(candidate.language === 'en' || candidate.language === 'ka' ? { language: candidate.language } : {}),
    ...(typeof candidate.phone === 'string' ? { phone: candidate.phone } : {}),
    ...(Array.isArray(candidate.enabledModules)
      ? { enabledModules: candidate.enabledModules.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(Array.isArray(candidate.enabledWidgets)
      ? { enabledWidgets: candidate.enabledWidgets.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(typeof candidate.registrationComplete === 'boolean'
      ? { registrationComplete: candidate.registrationComplete }
      : {}),
    isMasterAdmin: candidate.isMasterAdmin === true,
    ...(typeof candidate.impersonatedBy === 'string'
      ? { impersonatedBy: candidate.impersonatedBy }
      : { impersonatedBy: undefined }),
  };
  try {
    storage?.setItem('vinea_curr_user', JSON.stringify(cacheSafeUserProfile(updatedUser)));
  } catch {
    // React state remains authoritative when persistent storage is unavailable.
  }
  return updatedUser;
}

export function isWineryDatabaseSnapshot(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const arrayKeys = [
    'vessels', 'lots', 'fermlogs', 'lablogs', 'inventory', 'tasks', 'notes',
    'blocks', 'vineyardProjects', 'phenologyLogs', 'sprays', 'scoutings',
    'soilRecords', 'samplings', 'harvests', 'irrigationLogs', 'fertilizerLogs',
    'auditLogs', 'bottlingRuns', 'transfers', 'grapeIntakes', 'cellarOps',
    'costEntries', 'storageLocations', 'stockMovements', 'invoiceReceipts', 'inventoryMovements', 'salesDispatches',
    'salesOrders', 'supplierPayments', 'certificationRecords', 'attachments',
    'crmLeads', 'aiDrafts', 'qualitySops', 'purchaseOrders', 'productionPlans', 'recallCases',
  ];
  return arrayKeys.every(key => Array.isArray(candidate[key]))
    && Boolean(candidate.winePricing && typeof candidate.winePricing === 'object' && !Array.isArray(candidate.winePricing))
    && Boolean(candidate.companyProfile && typeof candidate.companyProfile === 'object' && !Array.isArray(candidate.companyProfile));
}

const createBlankCompanyProfile = (): CompanyProfile => ({
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
  currency: 'GEL',
});

const createSignedOutUser = (): UserProfile => ({
  username: '',
  email: '',
  fullName: '',
  role: 'Read-Only',
  language: 'en',
  phone: '',
  registrationComplete: true,
});

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
  /** Optional compatibility key; new registration derives this from email. */
  username?: string;
  email: string;
  fullName: string;
  role?: UserProfile['role'];
  language: UserProfile['language'];
  rememberMe?: boolean;
  passcode: string;
  companyProfile: Partial<CompanyProfile>;
  enabledModules?: string[];
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

/** Shared empty baseline, so a missing mirror allocates nothing. */
const EMPTY_RECORD_MAP: Map<string, any> = new Map();

export function useWineryState() {
  const [lang, setLang] = useState<Language>(() => {
    // Restore the chosen language across reloads (set by the header toggle and
    // by login, which adopts the account's saved language).
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('vinea_lang') : null;
      if (stored) {
        const supported = normalizeSupportedLanguage(stored);
        if (supported !== stored) localStorage.setItem('vinea_lang', supported);
        return supported;
      }
    } catch { /* ignore */ }
    return 'en';
  });
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isClient, setIsClient] = useState(false);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  // Toast state lives in StatusToastProvider, not here. `setToastMessage` is stable
  // for the provider's lifetime, so the ~90 call sites below raise toasts
  // without this hook — or anything rendering from it — re-rendering when one
  // appears or auto-dismisses. See hooks/useStatusToast.tsx.
  const { setToastMessage } = useStatusToastControls();
  const [loginError, setLoginError] = useState<string | null>(null);
  // Post-signup waiting room: the address still needs confirming, an operator
  // still needs to approve the account, or both.
  const [verificationPending, setVerificationPending] = useState<{
    email: string;
    devVerifyUrl?: string;
    devApprovalUrl?: string;
    /** The account also waits on a human decision before it can sign in. */
    requiresApproval?: boolean;
    /** Email is already confirmed — only the approval is outstanding. */
    approvalOnly?: boolean;
  } | null>(null);
  const [demoLoginEnabled, setDemoLoginEnabled] = useState(false);
  const [passportLotId, setPassportLotId] = useState<string | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<any[] | null>(null);
  const [pendingServerDb, setPendingServerDb] = useState<any | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  // Auth States
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<UserProfile>(createSignedOutUser);

  const [organizations, setOrganizations] = useState<{ id: string; name: string; role: string; isActive: boolean }[]>([]);
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false);
  const [workspaceHydrationError, setWorkspaceHydrationError] = useState<string | null>(null);
  const organizationSwitchInFlight = useRef(false);
  const workspaceTransitionRef = useRef(false);

  const fetchOrganizations = async () => {
    const requestEpoch = syncEpoch.current;
    try {
      const res = await fetch('/api/org/list');
      if (res.ok) {
        const list = await res.json();
        if (requestEpoch === syncEpoch.current && Array.isArray(list)) {
          setOrganizations(list);
        }
      }
    } catch (err) {
      console.error('Failed to fetch organizations:', err);
    }
  };

  const handleSwitchOrganization = async (orgId: string): Promise<boolean> => {
    if (organizationSwitchInFlight.current) return false;
    organizationSwitchInFlight.current = true;
    workspaceTransitionRef.current = true;
    setIsSwitchingOrganization(true);
    setWorkspaceHydrationError(null);
    invalidateSyncWork(true);
    try {
      const res = await SyncQueueManager.switchOrganizationContext(() => fetch('/api/org/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId })
      }));
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const { clearTenantCachedData } = await import('../lib/tenantCache');
        clearTenantCachedData(localStorage);
        // Conflict snapshots are tenant data. Invalidate them as soon as the
        // server commits the switch, before any new-workspace screen can open.
        setSyncConflicts(null);
        setPendingServerDb(null);
        pendingConflictSyncIntent.current = null;
        const switchedUser = applyOrganizationSwitchRole(currentUser, data, localStorage);
        if (!switchedUser) {
          const message = lang === 'ka'
            ? 'სამუშაო სივრცე შეიცვალა, მაგრამ ახალი როლის ჩატვირთვა ვერ მოხერხდა. უსაფრთხოდ გასაგრძელებლად განაახლეთ გვერდი.'
            : 'The workspace changed, but its role could not be loaded. Reload before continuing safely.';
          setWorkspaceHydrationError(message);
          setToastMessage(`⚠️ ${message}`);
          return false;
        }

        const dbData = await SyncQueueManager.sync({});
        if (!isWineryDatabaseSnapshot(dbData)) {
          const message = lang === 'ka'
            ? 'ახალი სამუშაო სივრცის მონაცემები ვერ ჩაიტვირთა. ძველი მონაცემების ახალ სივრცეში მოხვედრის თავიდან ასაცილებლად მუშაობა შეჩერებულია — განაახლეთ გვერდი.'
            : 'The new workspace data could not be loaded. Editing is blocked to prevent old data entering the new workspace; reload the page.';
          setWorkspaceHydrationError(message);
          setToastMessage(`⚠️ ${message}`);
          return false;
        }

        // Commit role and data together while the transition overlay still
        // blocks interaction with the old workspace snapshot.
        updateAllStates(dbData);
        setCurrentUser(switchedUser);
        hasHydrated.current = true;
        workspaceTransitionRef.current = false;
        await fetchOrganizations();
        setLastSyncError(null);
        setToastMessage(lang === 'ka' ? 'სამუშაო სივრცე შეიცვალა!' : 'Switched winery workspace!');
        return true;
      } else {
        hasHydrated.current = true;
        workspaceTransitionRef.current = false;
        setToastMessage(`⚠️ ${data.error || 'Failed to switch workspace'}`);
        return false;
      }
    } catch (err) {
      const message = lang === 'ka'
        ? 'სამუშაო სივრცის შეცვლა უსაფრთხოდ ვერ დასრულდა. მონაცემების შერევის თავიდან ასაცილებლად განაახლეთ გვერდი.'
        : 'The workspace transition could not finish safely. Reload the page to prevent data from different workspaces mixing.';
      setWorkspaceHydrationError(message);
      setToastMessage(`⚠️ ${message}`);
      return false;
    } finally {
      organizationSwitchInFlight.current = false;
      setIsSwitchingOrganization(false);
    }
  };

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(createBlankCompanyProfile);

  const [activeModule, setActiveModule] = useState<'portal' | 'vazi' | 'gvino' | 'integrations' | 'settings' | 'audit' | 'docs' | 'certification' | 'costs' | 'storage' | 'sales' | 'analytics' | 'master-admin'>('portal');
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
  const [invoiceReceipts, setInvoiceReceipts] = useState<InvoiceReceiptRecord[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovementRecord[]>([]);
  const [salesDispatches, setSalesDispatches] = useState<SalesDispatchRecord[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderRecord[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [certificationRecords, setCertificationRecords] = useState<CertificationRecord[]>([]);
  const [attachments, setAttachments] = useState<DocumentAttachment[]>([]);
  const [crmLeads, setCrmLeads] = useState<CrmLeadRecord[]>([]);
  const [aiDrafts, setAiDrafts] = useState<AiDraftQueueItem[]>([]);
  const [qualitySops, setQualitySops] = useState<QualitySop[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [productionPlans, setProductionPlans] = useState<ProductionPlanItem[]>([]);
  const [recallCases, setRecallCases] = useState<RecallCase[]>([]);

  // FermentationTab owns its own daily-reading form state and commit handler.
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
  const [prefilledIntakeHarvestId, setPrefilledIntakeHarvestId] = useState<string | null>(null);
  // Vessel preselected for the quick-operation form (QR scan / drawer action).
  const [prefilledOpVesselId, setPrefilledOpVesselId] = useState('');
  const [prefilledDestId, setPrefilledDestId] = useState('');

  // Synchronization refs to manage server state & loop prevention
  const isSyncing = useRef(false);
  // State-pressure is a plan-ahead warning, so it is raised at most once per
  // session instead of on every sync response that carries it.
  const footprintWarningShown = useRef(false);
  const hasHydrated = useRef(false);
  const pendingSync = useRef<{ payload: any; epoch: number } | null>(null);
  const pendingConflictSyncIntent = useRef<PendingConflictSyncIntent | null>(null);
  const syncEpoch = useRef(0);
  const conflictResolutionInFlight = useRef(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const lastServerState = useRef<Record<string, string>>({});

  const invalidateSyncWork = (pauseHydration = false) => {
    syncEpoch.current += 1;
    pendingSync.current = null;
    if (pauseHydration) hasHydrated.current = false;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOrganizationContextChanged = (event: StorageEvent) => {
      if (event.key !== 'cellarflow_org_state_org_id' || event.oldValue === event.newValue) return;
      workspaceTransitionRef.current = true;
      invalidateSyncWork(true);
      setSyncConflicts(null);
      setPendingServerDb(null);
      pendingConflictSyncIntent.current = null;
      setWorkspaceHydrationError(lang === 'ka'
        ? 'სამუშაო სივრცე სხვა ჩანართში შეიცვალა. უსაფრთხოდ გასაგრძელებლად განაახლეთ ეს გვერდი.'
        : 'The workspace changed in another tab. Reload this page before continuing safely.');
    };
    window.addEventListener('storage', handleOrganizationContextChanged);
    return () => window.removeEventListener('storage', handleOrganizationContextChanged);
  }, [lang]);

  /**
   * Cache of `id -> record` maps built from serialized collections.
   *
   * Every collection write rebuilds two of these — the previous local list and
   * the last server-acknowledged list — by parsing a stored JSON string and
   * walking the result. For a winery holding thousands of audit or fermentation
   * entries that is the dominant cost of a write, and a single sync response
   * triggers it across all 33 collections.
   *
   * The entry is keyed by the exact source string, so it is self-validating: a
   * logout, an organization switch, or another tab writing the key all change
   * (or remove) that string and the cache misses. That matters more than the
   * speed here — a mirror invalidated by hand would have to be kept in step with
   * every `removeItem` call site, and going stale would mean serving a previous
   * tenant's records as the comparison baseline.
   *
   * Returned maps are READ-ONLY; callers compare against them and must not
   * mutate the records they hold.
   */
  const recordMapCache = useRef<Map<string, { raw: string; map: Map<string, any> }>>(new Map());

  const cachedRecordMap = (cacheKey: string, raw: string | null | undefined): Map<string, any> => {
    if (!raw) return EMPTY_RECORD_MAP;
    const cached = recordMapCache.current.get(cacheKey);
    if (cached && cached.raw === raw) return cached.map;

    const map = new Map<string, any>();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) map.set(item?.id, item);
      }
    } catch { /* a corrupt mirror simply yields no baseline */ }
    recordMapCache.current.set(cacheKey, { raw, map });
    return map;
  };

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
    setSafe(setInvoiceReceipts, data.invoiceReceipts, 'invoiceReceipts', 'cf_invoice_receipts');
    setSafe(setInventoryMovements, data.inventoryMovements, 'inventoryMovements', 'cf_inventory_movements');
    setSafe(setSalesDispatches, data.salesDispatches, 'salesDispatches', 'cf_sales_dispatches');
    setSafe(setSalesOrders, data.salesOrders, 'salesOrders', 'cf_sales_orders');
    setSafe(setSupplierPayments, data.supplierPayments, 'supplierPayments', 'cf_supplier_payments');
    setSafe(setCertificationRecords, data.certificationRecords, 'certificationRecords', 'cf_certification_records');
    setSafe(setAttachments, data.attachments, 'attachments', 'cf_attachments');
    setSafe(setCrmLeads, data.crmLeads, 'crmLeads', 'cf_crm_leads');
    setSafe(setAiDrafts, data.aiDrafts, 'aiDrafts', 'cf_ai_drafts');
    setSafe(setQualitySops, data.qualitySops, 'qualitySops', 'cf_quality_sops');
    setSafe(setPurchaseOrders, data.purchaseOrders, 'purchaseOrders', 'cf_purchase_orders');
    setSafe(setProductionPlans, data.productionPlans, 'productionPlans', 'cf_production_plans');
    setSafe(setRecallCases, data.recallCases, 'recallCases', 'cf_recall_cases');
    setSafe(setCompanyProfile, data.companyProfile, 'companyProfile', 'vinea_company_profile');
    const syncedAt = new Date().toISOString();
    setLastSyncAt(syncedAt);
    localStorage.setItem('vinea_last_sync_at', syncedAt);
  };

  const triggerSync = async (forcePayload?: any) => {
    if (!hasHydrated.current || workspaceTransitionRef.current) return;
    if (isSyncing.current) {
      // Don't drop syncs requested while one is in flight (the dropped data —
      // e.g. a freshly added task — would be reverted by the in-flight
      // response). Remember the latest request and run it afterwards.
      pendingSync.current = { payload: forcePayload, epoch: syncEpoch.current };
      return;
    }
    isSyncing.current = true;
    const requestEpoch = syncEpoch.current;

    try {
      const latestState = forcePayload || {
        vessels, lots, fermLogs, labLogs, inventory, tasks, notesList,
        blocks, vineyardProjects, phenologyLogs, sprays, scoutings, soilRecords,
        samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
        bottlingRuns, transfers, grapeIntakes, cellarOps, costEntries, winePricing, storageLocations, stockMovements, invoiceReceipts, inventoryMovements, salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments, crmLeads, aiDrafts, qualitySops, purchaseOrders, productionPlans, recallCases,
        companyProfile
      };

      const response = await SyncQueueManager.sync(latestState);
      if (requestEpoch !== syncEpoch.current) return;
      if (response) {
        const hasNewerPendingPayload = Boolean(pendingSync.current)
          && !response.hasConflicts
          && !response.orgStateConflict
          && !response.syncError;
        if (hasNewerPendingPayload) return;
        if (response.hasConflicts) {
          setSyncConflicts(response.conflicts);
          setPendingServerDb(response.serverDb);
          pendingConflictSyncIntent.current = response.pendingSyncIntent
            || SyncQueueManager.getPendingConflictSyncIntent();
          setToastMessage(response.deletionRejected
            ? (lang === 'ka'
              ? 'წაშლა გაუქმდა და ჩანაწერი აღდგა, რადგან დაკავშირებული მონაცემები სხვა სესიაში შეიცვალა. ჯერ მოაგვარეთ კონფლიქტი.'
              : 'Deletion was cancelled and the record restored because linked data changed in another session. Resolve the conflict first.')
            : response.deletionDeferred
            ? (lang === 'ka'
              ? 'წაშლა შეჩერდა, რადგან დაკავშირებული ჩანაწერი სხვა სესიაში შეიცვალა. მოაგვარეთ კონფლიქტი და შემდეგ სცადეთ წაშლა ხელახლა.'
              : 'Deletion was paused because a linked record changed in another session. Resolve the conflict, then retry the deletion.')
            : (lang === 'ka' ? 'კონფლიქტი აღმოჩენილია სინქრონიზაციისას!' : 'Sync conflict detected! Review required.'));
        } else if (response.orgStateConflict) {
          // A second whole-document race is not an acknowledgement. Keep the
          // local transaction and its dirty revisions intact for a later retry.
          setLastSyncError(response.syncError || 'Organization state conflict');
          setToastMessage(lang === 'ka'
            ? '⚠️ მეღვინეობის მონაცემები სხვა სესიამ შეცვალა. თქვენი ლოკალური ცვლილება შენახულია და ხელახლა სინქრონიზაციისთვის მზადაა.'
            : '⚠️ This winery changed in another session. Your local change was kept and is ready to retry.');
        } else if (response.syncError) {
          // The server rejected the whole sync — keep data dirty for retry,
          // but tell the user instead of failing silently. The server speaks
          // English; translate by response code so the whole sentence lands in
          // one language rather than switching halfway.
          //
          // The dictionary is fetched on demand rather than imported: it is
          // error-path-only text, and Georgian is three bytes per character in
          // UTF-8, so bundling it charged every boot for a message most sessions
          // never show. It exceeded the critical-path budget when imported.
          if (response.syncError !== lastSyncError) {
            setLastSyncError(response.syncError);
            const prefix = lang === 'ka' ? 'სინქრონიზაცია უარყოფილია' : 'Sync rejected';
            void import('../lib/serverErrorMessages')
              .then(({ localizeServerError }) => {
                setToastMessage(`⚠️ ${prefix}: ${localizeServerError(response.code, response.syncError, lang)}`);
              })
              .catch(() => {
                // Offline with the chunk uncached: the server's own text still
                // beats saying nothing.
                setToastMessage(`⚠️ ${prefix}: ${response.syncError}`);
              });
          }
        } else {
          updateAllStates(response);
          pendingConflictSyncIntent.current = null;
          if (response.deletionRejected) {
            setToastMessage(lang === 'ka'
              ? 'წაშლა გაუქმდა. ჩანაწერი აღდგა სერვერიდან, რადგან მასთან დაკავშირებული მონაცემები შეიცვალა.'
              : 'Deletion cancelled. The record was restored from the server because its linked data changed.');
          } else if (response.recoveredOrgStateConflict) {
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

          // The server flags a workspace approaching the sync ceilings. Warn
          // once per session rather than on every sync: this is a "plan some
          // archiving" signal, not something to act on mid-task.
          if (response.stateFootprint && !footprintWarningShown.current) {
            footprintWarningShown.current = true;
            const { level, recordsPct, bytesPct } = response.stateFootprint;
            const biggest = response.stateFootprint.topCollections?.[0]?.collection || '';
            const used = Math.max(recordsPct, bytesPct);
            console.warn('[sync] organization state pressure', response.stateFootprint);
            if (level === 'critical') {
              setToastMessage(lang === 'ka'
                ? `⚠️ სამუშაო სივრცე სინქრონიზაციის ზღვრის ${used}%-ს იყენებს (ყველაზე დიდი: ${biggest}). დაგეგმეთ არქივირება.`
                : `⚠️ This workspace is using ${used}% of the sync limit (largest: ${biggest}). Plan an archive soon.`);
            }
          }
        }
      }
    } catch (err) {
      console.error('Trigger sync error:', err);
    } finally {
      isSyncing.current = false;
      if (pendingSync.current) {
        const { payload, epoch } = pendingSync.current;
        pendingSync.current = null;
        if (epoch === syncEpoch.current && hasHydrated.current && !workspaceTransitionRef.current) {
          triggerSync(payload);
        }
      }
    }
  };

  const applyTransferCommandResponse = (response: TransferCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    // A committed command remains recoverable even if the follow-up collection
    // projection could not be attached to the response. Reconcile the exact
    // entities from the durable result and let the normal server refresh repair
    // anything unrelated on the next sync.
    const result = response.result;
    const changedLots = new Map(result.changedLots.map(lot => [lot.id, lot]));
    const nextLots = lots.map(lot => changedLots.get(lot.id) || lot);
    for (const lot of result.changedLots) {
      if (!lots.some(existing => existing.id === lot.id)) nextLots.push(lot);
    }
    updateAllStates({
      vessels: vessels.map(vessel => {
        if (vessel.id === result.sourceVessel.id) return result.sourceVessel;
        if (vessel.id === result.destinationVessel.id) return result.destinationVessel;
        return vessel;
      }),
      lots: nextLots,
      transfers: transfers.some(transfer => transfer.id === result.transfer.id)
        ? transfers
        : [result.transfer, ...transfers],
      costEntries: result.costEntries.length
        ? [...result.costEntries, ...costEntries.filter(entry => (
            !result.costEntries.some(changed => changed.id === entry.id)
          ))]
        : costEntries,
    });
  };

  const applyTransferReversalCommandResponse = (response: TransferReversalCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    const changedVessels = new Map(result.changedVessels.map(vessel => [vessel.id, vessel]));
    const changedLots = new Map(result.changedLots.map(lot => [lot.id, lot]));
    const changedTransfers = new Map([
      [result.originalTransfer.id, result.originalTransfer],
      [result.reversalTransfer.id, result.reversalTransfer],
    ]);
    const nextTransfers = transfers.map(transfer => changedTransfers.get(transfer.id) || transfer);
    if (!nextTransfers.some(transfer => transfer.id === result.reversalTransfer.id)) {
      nextTransfers.unshift(result.reversalTransfer);
    }
    updateAllStates({
      vessels: vessels.map(vessel => changedVessels.get(vessel.id) || vessel),
      lots: lots.map(lot => changedLots.get(lot.id) || lot),
      transfers: nextTransfers,
      costEntries: result.changedCostEntries.length
        ? [
            ...result.changedCostEntries,
            ...costEntries.filter(entry => (
              !result.changedCostEntries.some(changed => changed.id === entry.id)
            )),
          ]
        : costEntries,
    });
  };

  const applyBottlingCommandResponse = (response: BottlingCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    const changedInventory = new Map(result.updatedInventoryItems.map(item => [item.id, item]));
    updateAllStates({
      lots: lots.map(lot => lot.id === result.updatedLot.id ? result.updatedLot : lot),
      bottlingRuns: bottlingRuns.some(run => run.id === result.run.id)
        ? bottlingRuns
        : [result.run, ...bottlingRuns],
      inventory: inventory.map(item => changedInventory.get(item.id) || item),
      costEntries: [
        ...result.createdCostEntries.filter(entry => !costEntries.some(existing => existing.id === entry.id)),
        ...costEntries,
      ],
      stockMovements: result.storageMovement && !stockMovements.some(item => item.id === result.storageMovement?.id)
        ? [result.storageMovement, ...stockMovements]
        : stockMovements,
    });
  };

  const applySalesStockCommandResponse = (response: SalesStockCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    let nextOrders = salesOrders;
    if (result.order) {
      nextOrders = salesOrders.some(order => order.id === result.order?.id)
        ? salesOrders.map(order => order.id === result.order?.id ? result.order as SalesOrderRecord : order)
        : [result.order, ...salesOrders];
    }
    updateAllStates({
      salesOrders: nextOrders,
      salesDispatches: result.dispatch && !salesDispatches.some(item => item.id === result.dispatch?.id)
        ? [result.dispatch, ...salesDispatches]
        : salesDispatches,
      stockMovements: result.stockMovement && !stockMovements.some(item => item.id === result.stockMovement?.id)
        ? [result.stockMovement, ...stockMovements]
        : stockMovements,
    });
  };

  const applyStorageMovementCommandResponse = (response: StorageMovementCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const changedRun = response.result.updatedBottlingRun;
    updateAllStates({
      bottlingRuns: changedRun
        ? bottlingRuns.map(run => run.id === changedRun.id ? changedRun : run)
        : bottlingRuns,
      stockMovements: [
        ...response.result.movements.filter(movement => (
          !stockMovements.some(existing => existing.id === movement.id)
        )),
        ...stockMovements,
      ],
    });
  };

  const applyInvoiceReceiptCommandResponse = (response: InvoiceReceiptCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }
    // The commit is already durable. A projection-less acknowledgement is
    // reconciled by a read-only sync instead of reconstructing ledger state in
    // the browser.
    void triggerSync({});
  };

  const applyHarvestIntakeCommandResponse = (response: HarvestIntakeCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    updateAllStates({
      harvests: result.updatedHarvest
        ? harvests.map(item => item.id === result.updatedHarvest?.id ? result.updatedHarvest as HarvestRecord : item)
        : harvests,
      lots: lots.some(item => item.id === result.lot.id) ? lots : [result.lot, ...lots],
      vessels: result.updatedVessel
        ? vessels.map(item => item.id === result.updatedVessel?.id ? result.updatedVessel as Vessel : item)
        : vessels,
      grapeIntakes: grapeIntakes.some(item => item.id === result.intake.id)
        ? grapeIntakes
        : [result.intake, ...grapeIntakes],
      costEntries: result.costEntry && !costEntries.some(item => item.id === result.costEntry?.id)
        ? [result.costEntry, ...costEntries]
        : costEntries,
      auditLogs: auditLogs.some(item => item.id === result.auditLog.id)
        ? auditLogs
        : [result.auditLog, ...auditLogs],
    });
  };

  const applyFermentationCompletionCommandResponse = (
    response: FermentationCompletionCommandResponse,
  ): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    updateAllStates({
      lots: lots.map(item => item.id === result.lot.id ? result.lot : item),
      vessels: vessels.map(item => item.id === result.vessel.id ? result.vessel : item),
      fermlogs: fermLogs.map(item => item.id === result.finalLog.id ? result.finalLog : item),
      auditLogs: auditLogs.some(item => item.id === result.auditLog.id)
        ? auditLogs
        : [result.auditLog, ...auditLogs],
    });
  };

  const applyFermentationCompletionReversalCommandResponse = (
    response: FermentationCompletionReversalCommandResponse,
  ): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    updateAllStates({
      lots: lots.map(item => item.id === result.lot.id ? result.lot : item),
      vessels: vessels.map(item => item.id === result.vessel.id ? result.vessel : item),
      fermlogs: [
        result.reversalLog,
        ...fermLogs.map(item => item.id === result.originalLog.id ? result.originalLog : item),
      ],
      auditLogs: auditLogs.some(item => item.id === result.auditLog.id)
        ? auditLogs
        : [result.auditLog, ...auditLogs],
    });
  };

  const applyCellarOperationCommandResponse = (response: CellarOperationCommandResponse): void => {
    if (response.collections) {
      updateAllStates(response.collections);
      return;
    }

    const result = response.result;
    const changedInventoryItems = result.inventoryItems?.length
      ? result.inventoryItems
      : result.inventoryItem
        ? [result.inventoryItem]
        : [];
    const changedInventoryById = new Map(
      changedInventoryItems.map(item => [item.id, item]),
    );
    const generatedCostEntries = result.costEntries?.length
      ? result.costEntries
      : result.costEntry
        ? [result.costEntry]
        : [];
    updateAllStates({
      lots: lots.map(item => item.id === result.lot.id ? result.lot : item),
      vessels: result.vessel
        ? vessels.map(item => item.id === result.vessel?.id ? result.vessel as Vessel : item)
        : vessels,
      inventory: inventory.map(item => changedInventoryById.get(item.id) || item),
      cellarOps: cellarOps.some(item => item.id === result.operation.id)
        ? cellarOps
        : [result.operation, ...cellarOps],
      costEntries: [
        ...generatedCostEntries.filter(entry => !costEntries.some(item => item.id === entry.id)),
        ...costEntries,
      ],
      auditLogs: auditLogs.some(item => item.id === result.auditLog.id)
        ? auditLogs
        : [result.auditLog, ...auditLogs],
    });
  };

  const discardLocalUnsyncedChanges = async () => {
    invalidateSyncWork();
    try {
      const dbData = await SyncQueueManager.discardPendingChangesAndFetch();
      if (!isWineryDatabaseSnapshot(dbData)) {
        const detail = dbData?.syncError || (lang === 'ka' ? 'სერვერის მონაცემები ვერ ჩაიტვირთა.' : 'Server state could not be loaded.');
        setLastSyncError(detail);
        setToastMessage(`⚠️ ${lang === 'ka' ? 'ლოკალური ცვლილებები არ გაუქმებულა' : 'Local changes were not discarded'}: ${detail}`);
        return;
      }
      updateAllStates(dbData);
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
        } else if (err.code === 'approval_pending') {
          setVerificationPending({ email: identifier, requiresApproval: true, approvalOnly: true });
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
    invalidateSyncWork();
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    await SyncQueueManager.discardPendingChanges();
    SyncQueueManager.clearOrganizationContext();
    setIsLoggedIn(false);
    setSyncConflicts(null);
    setPendingServerDb(null);
    pendingConflictSyncIntent.current = null;
    setWorkspaceHydrationError(null);
    workspaceTransitionRef.current = false;
    setOrganizations([]);
    setCompanyProfile(createBlankCompanyProfile());
    setCurrentUser(createSignedOutUser());
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
    localStorage.removeItem('cf_invoice_receipts');
    localStorage.removeItem('cf_inventory_movements');
    localStorage.removeItem('cf_sales_dispatches');
    localStorage.removeItem('cf_sales_orders');
    localStorage.removeItem('cf_certification_records');
    localStorage.removeItem('cf_attachments');
    localStorage.removeItem('cf_crm_leads');
    localStorage.removeItem('cf_ai_drafts');
    localStorage.removeItem('cf_quality_sops');
    localStorage.removeItem('cf_purchase_orders');
    localStorage.removeItem('cf_production_plans');
    localStorage.removeItem('cf_recall_cases');
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
    setInvoiceReceipts([]);
    setInventoryMovements([]);
    setSalesDispatches([]);
    setSalesOrders([]);
    setSupplierPayments([]);
    setCertificationRecords([]);
    setAttachments([]);
    setCrmLeads([]);
    setAiDrafts([]);
    setQualitySops([]);
    setPurchaseOrders([]);
    setProductionPlans([]);
    setRecallCases([]);
  };

  const handleAuthRegister = async (profileData: RegistrationProfileData): Promise<boolean> => {
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
          setVerificationPending({
            email: user.email || profileData.email,
            devVerifyUrl: user.devVerifyUrl,
            devApprovalUrl: user.devApprovalUrl,
            requiresApproval: user.requiresApproval === true,
          });
          return true;
        }

        setCurrentUser(user);
        setIsLoggedIn(true);

        // Only force full upload if there are unsynced offline changes made as guest
        const hasOfflineChanges = SyncQueueManager.getDirtyCollections().size > 0;
        const initialDB = await SyncQueueManager.sync(hasOfflineChanges ? {
          vessels, lots, fermLogs, labLogs, inventory, tasks, notesList,
          blocks, vineyardProjects, phenologyLogs, sprays, scoutings, soilRecords,
          samplings, harvests, irrigationLogs, fertilizerLogs, auditLogs,
          bottlingRuns, transfers, grapeIntakes, cellarOps, costEntries, winePricing, storageLocations, stockMovements, invoiceReceipts, inventoryMovements, salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments, crmLeads, aiDrafts, qualitySops, purchaseOrders, productionPlans, recallCases,
          companyProfile
        } : {});
        if (initialDB) {
          updateAllStates(initialDB);
        }
        return true;
      } else {
        const err = await res.json();
        const { localizeServerError } = await import('../lib/serverErrorMessages');
        setLoginError(localizeServerError(err.code, err.error || 'Registration failed', lang));
        return false;
      }
    } catch (err) {
      setLoginError('Could not reach secure registration gateway');
      return false;
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
    invalidateSyncWork();
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
        localStorage.removeItem('cf_invoice_receipts');
        localStorage.removeItem('cf_inventory_movements');
        localStorage.removeItem('cf_sales_dispatches');
        localStorage.removeItem('cf_sales_orders');
        localStorage.removeItem('cf_certification_records');
        localStorage.removeItem('cf_attachments');
        localStorage.removeItem('cf_crm_leads');
        localStorage.removeItem('cf_ai_drafts');
        localStorage.removeItem('cf_quality_sops');
        localStorage.removeItem('cf_purchase_orders');
        localStorage.removeItem('cf_production_plans');
        localStorage.removeItem('cf_recall_cases');
        localStorage.removeItem('vinea_company_profile');
        localStorage.removeItem('vinea_deleted_ids');

        await SyncQueueManager.discardPendingChanges();

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
      setInvoiceReceipts(parseCached('cf_invoice_receipts', []));
      setInventoryMovements(parseCached('cf_inventory_movements', []));
      setSalesDispatches(parseCached('cf_sales_dispatches', defaults.initialSalesDispatches));
      setSalesOrders(parseCached('cf_sales_orders', defaults.initialSalesOrders));
      setSupplierPayments(parseCached('cf_supplier_payments', defaults.initialSupplierPayments));
      setCertificationRecords(parseCached('cf_certification_records', defaults.initialCertificationRecords));
      setAttachments(parseCached('cf_attachments', []));
      setCrmLeads(parseCached('cf_crm_leads', []));
      setAiDrafts(parseCached('cf_ai_drafts', []));
      setQualitySops(parseCached('cf_quality_sops', []));
      setPurchaseOrders(parseCached('cf_purchase_orders', []));
      setProductionPlans(parseCached('cf_production_plans', []));
      setRecallCases(parseCached('cf_recall_cases', []));

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
      try {
        const cachedUser = JSON.parse(storedUser);
        // Privileged/support-session capabilities are valid only when freshly
        // issued by the server. Local storage must never restore them.
        setCurrentUser(cacheSafeUserProfile(cachedUser));
      } catch { /* ignore */ }
    }
    const storedCompany = localStorage.getItem('vinea_company_profile');
    if (storedCompany) {
      try { setCompanyProfile(JSON.parse(storedCompany)); } catch { /* ignore */ }
    }
    const storedModule = localStorage.getItem('vinea_active_module');
    if (storedModule) setActiveModule(storedModule as any);
    const storedTab = localStorage.getItem('vinea_active_tab');
    if (storedTab) setActiveTab(storedTab === 'qvevri' ? 'vessels' : storedTab);

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
        if (!cancelled) {
          hasHydrated.current = true;
          setIsAuthResolved(true);
        }
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
    const approval = params.get('approval');
    if (verified || verifyError || approval) {
      const isKa = (localStorage.getItem('vinea_lang') as Language) === 'ka';
      if (approval === 'pending') {
        setVerificationPending({ email: '', requiresApproval: true, approvalOnly: true });
        setToastMessage(isKa
          ? '⏳ ანგარიში ელოდება ადმინისტრატორის დადასტურებას.'
          : '⏳ Your account is waiting for administrator approval.');
      } else if (approval === 'rejected') {
        setToastMessage(isKa
          ? '⚠️ ანგარიშზე წვდომა არ დამტკიცდა.'
          : '⚠️ This account was not approved for access.');
      } else if (verified) {
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
    // Set whenever the mapping below returns a record that differs from its
    // input. It replaces a `JSON.stringify(processedValue) !== JSON.stringify(value)`
    // check further down: that serialized the whole collection twice more just
    // to answer a question the mapping already knows the answer to.
    let stampedAnyItem = false;
    const modifiedOrAddedItems: Array<{ item: any; baselineTimestamp?: string }> = [];

    if (Array.isArray(value)) {
      let storedPrevious: string | null = null;
      try { storedPrevious = localStorage.getItem(localKey); } catch { /* ignore */ }
      const prevMap = cachedRecordMap(`local:${localKey}`, storedPrevious);

      // Last server-acknowledged versions: the true baseline for conflict
      // detection. Using the local previous timestamp instead would make
      // chained local edits look like conflicts.
      const serverMap = cachedRecordMap(`server:${key}`, lastServerState.current[key]);

      const nowStr = new Date().toISOString();

      processedValue = value.map(item => {
        if (item && typeof item === 'object' && 'id' in item) {
          const prevItem = prevMap.get(item.id);
          if (!prevItem) {
            // New item
            const newItem = { ...item, lastModified: nowStr };
            stampedAnyItem = true;
            modifiedOrAddedItems.push({ item: newItem });
            return newItem;
          } else {
            // Compare fields ignoring sync metadata. This runs for every record
            // of every collection on every write, so it walks the two records
            // and stops at the first difference instead of allocating a stripped
            // copy and a JSON string for each side.
            if (!recordContentEquals(item, prevItem)) {
              // Modified item: carry the server baseline on the item so
              // /api/sync can detect concurrent edits from other sessions.
              const serverItem = serverMap.get(item.id);
              const baselineTimestamp = item.baselineTimestamp ?? serverItem?.lastModified;
              const modifiedItem = { ...item, lastModified: nowStr, ...(baselineTimestamp ? { baselineTimestamp } : {}) };
              stampedAnyItem = true;
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
              const carried = item.lastModified || prevItem.lastModified || nowStr;
              if (carried !== item.lastModified) stampedAnyItem = true;
              return { ...item, lastModified: carried };
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
      aiDrafts: setAiDrafts,
      qualitySops: setQualitySops,
      purchaseOrders: setPurchaseOrders,
      productionPlans: setProductionPlans,
      recallCases: setRecallCases,
    };

    // One serialization for this call, reused by every branch below. It was
    // previously recomputed for the storage write, the dirty check, and the
    // comparison above — four full passes over the collection per write.
    const serializedProcessed = JSON.stringify(processedValue);

    const setter = setters[key];
    if (setter && stampedAnyItem) {
      // Persist BEFORE updating state: the effect re-runs after the setter,
      // and must find storage already matching, or it re-stamps lastModified
      // with a fresh timestamp on every pass — an infinite update loop that
      // previously only terminated when two passes landed on the same
      // millisecond. The re-run becomes a no-op and handles dirty-marking.
      localStorage.setItem(localKey, serializedProcessed);
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

    localStorage.setItem(localKey, serializedProcessed);

    if (hasHydrated.current && serializedProcessed !== lastServerState.current[key]) {
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
        bottlingRuns, transfers, grapeIntakes, cellarOps, costEntries, winePricing, storageLocations, stockMovements, invoiceReceipts, inventoryMovements, salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments, crmLeads, aiDrafts, qualitySops, purchaseOrders, productionPlans, recallCases,
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
  useEffect(() => { handleCollectionUpdate('invoiceReceipts', 'cf_invoice_receipts', invoiceReceipts); }, [invoiceReceipts, isClient]);
  useEffect(() => { handleCollectionUpdate('inventoryMovements', 'cf_inventory_movements', inventoryMovements); }, [inventoryMovements, isClient]);
  useEffect(() => { handleCollectionUpdate('salesDispatches', 'cf_sales_dispatches', salesDispatches); }, [salesDispatches, isClient]);
  useEffect(() => { handleCollectionUpdate('salesOrders', 'cf_sales_orders', salesOrders); }, [salesOrders, isClient]);
  useEffect(() => { handleCollectionUpdate('supplierPayments', 'cf_supplier_payments', supplierPayments); }, [supplierPayments, isClient]);
  useEffect(() => { handleCollectionUpdate('certificationRecords', 'cf_certification_records', certificationRecords); }, [certificationRecords, isClient]);
  useEffect(() => { handleCollectionUpdate('attachments', 'cf_attachments', attachments); }, [attachments, isClient]);
  useEffect(() => { handleCollectionUpdate('crmLeads', 'cf_crm_leads', crmLeads); }, [crmLeads, isClient]);
  useEffect(() => { handleCollectionUpdate('aiDrafts', 'cf_ai_drafts', aiDrafts); }, [aiDrafts, isClient]);
  useEffect(() => { handleCollectionUpdate('qualitySops', 'cf_quality_sops', qualitySops); }, [qualitySops, isClient]);
  useEffect(() => { handleCollectionUpdate('purchaseOrders', 'cf_purchase_orders', purchaseOrders); }, [purchaseOrders, isClient]);
  useEffect(() => { handleCollectionUpdate('productionPlans', 'cf_production_plans', productionPlans); }, [productionPlans, isClient]);
  useEffect(() => { handleCollectionUpdate('recallCases', 'cf_recall_cases', recallCases); }, [recallCases, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('cf_sidebar_collapsed', String(isSidebarCollapsed)); }, [isSidebarCollapsed, isClient]);

  useEffect(() => { if (isClient) localStorage.setItem('vinea_is_logged_in', String(isLoggedIn)); }, [isLoggedIn, isClient]);
  useEffect(() => {
    if (!isClient) return;
    localStorage.setItem('vinea_curr_user', JSON.stringify(cacheSafeUserProfile(currentUser)));
  }, [currentUser, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_company_profile', JSON.stringify(companyProfile)); }, [companyProfile, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_active_module', activeModule); }, [activeModule, isClient]);
  useEffect(() => { if (isClient) localStorage.setItem('vinea_active_tab', activeTab); }, [activeTab, isClient]);

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

  // Declared after the localStorage restore above so a destination named in the
  // URL wins over the last one this browser happened to be on: effects run in
  // declaration order, and a shared link must land where it points.
  useWorkspaceRoute({
    isActive: isClient && isLoggedIn,
    activeModule,
    activeTab,
    setActiveModule,
    setActiveTab,
  });

  // Input Sanitizer/Validator Helper for ID poisoning prevention
  const sanitizeId = (id: string): string => {
    return id.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 128);
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
    const id = createUniqueRecordId('block', blocks.map(item => item.id));
    setBlocks(prev => [...prev, { ...block, id }]);
  };

  const handleUpdateBlock = (id: string, updated: Partial<VineyardBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updated } : b));
  };

  const handleAddVineyardProject = (project: Omit<VineyardPlantingProject, 'id'>) => {
    const id = createUniqueRecordId('vp', vineyardProjects.map(item => item.id));
    setVineyardProjects(prev => [...prev, { ...project, id }]);
  };

  const handleUpdateVineyardProject = (id: string, updated: Partial<VineyardPlantingProject>) => {
    setVineyardProjects(prev => prev.map(project => project.id === id ? { ...project, ...updated } : project));
  };

  const handleAddPhenologyLog = (log: Omit<PhenologyRecord, 'id'>) => {
    const id = createUniqueRecordId('ph', phenologyLogs.map(item => item.id));
    setPhenologyLogs(prev => [...prev, { ...log, id }]);
  };

  const handleAddSprayRecord = (rec: Omit<SprayRecord, 'id'>) => {
    const id = createUniqueRecordId('spray', sprays.map(item => item.id));
    setSprays(prev => [...prev, { ...rec, id }]);
  };

  const handleAddScoutingRecord = (rec: Omit<ScoutingRecord, 'id'>) => {
    const id = createUniqueRecordId('scout', scoutings.map(item => item.id));
    setScoutings(prev => [...prev, { ...rec, id }]);
  };

  const handleAddSamplings = (rec: Omit<GrapeSamplingRecord, 'id'>) => {
    const id = createUniqueRecordId('sample', samplings.map(item => item.id));
    setSamplings(prev => [...prev, { ...rec, id }]);
  };

  const handleAddHarvestRecord = (rec: Omit<HarvestRecord, 'id'>) => {
    const id = createUniqueRecordId('harv', harvests.map(item => item.id));
    setHarvests(prev => [...prev, { ...rec, id }]);
  };

  const handleUpdateHarvestRecord = (id: string, updated: Partial<HarvestRecord>) => {
    setHarvests(prev => prev.map(h => h.id === id ? { ...h, ...updated } : h));
  };

  const handleAddIrrigation = (rec: Omit<IrrigationRecord, 'id'>) => {
    const id = createUniqueRecordId('irrig', irrigationLogs.map(item => item.id));
    setIrrigationLogs(prev => [...prev, { ...rec, id }]);
  };

  const handleAddFertilizer = (rec: Omit<FertilizationRecord, 'id'>) => {
    const id = createUniqueRecordId('fert', fertilizerLogs.map(item => item.id));
    setFertilizerLogs(prev => [...prev, { ...rec, id }]);
  };

  const handleSendHarvestToGvino = (
    blockId: string,
    harvestedKg: number,
    variety: string,
    vintage: number,
    harvestedDate: string
  ): string => {
    if (!Number.isFinite(harvestedKg) || harvestedKg <= 0) {
      throw new Error('Harvest weight must be greater than zero.');
    }
    if (!Number.isInteger(vintage) || vintage < 1900 || vintage > 2200) {
      throw new Error('Harvest vintage must match a valid harvest year.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(harvestedDate)) {
      throw new Error('Harvest date must use YYYY-MM-DD format.');
    }

    const lotId = createUniqueLotId(variety, vintage, lots.map(item => item.id));
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

    // Record system audit log
    const audit: MaraniOSAuditLog = {
      id: createUniqueRecordId('audit', auditLogs.map(item => item.id)),
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
   * captured fruit, optionally fills a destination vessel, records the intake
   * document, and writes an audit entry. Fermentation telemetry is intentionally
   * not fabricated here; the first log belongs to an actual cellar reading.
   * Returns the new lot id.
   */
  const handleReceiveGrapes = (
    input: Omit<GrapeIntakeRecord, 'id' | 'createdLotId' | 'netWeightKg' | 'estimatedVolumeL'>,
  ): string => {
    const netWeightKg = Math.max(0, (input.grossWeightKg || 0) - (input.tareWeightKg || 0));
    const estimatedVolumeL = estimateMustVolumeL(netWeightKg, input.juiceYieldPct || 0);
    const intakeId = createUniqueRecordId('intake', grapeIntakes.map(item => item.id));
    const lotId = createUniqueLotId(input.variety || 'XX', input.vintage, lots.map(item => item.id));
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
      id: createUniqueRecordId('audit', auditLogs.map(item => item.id)),
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
   * batch: appends a readable entry to the lot timeline, deducts every inventory
   * material consumed, applies a volume change (loss/addition) to the
   * lot and its vessel, and writes an audit entry. Returns the operation id.
   */
  /**
   * Record a payment to a grape supplier (rtveli settlements). The balance is
   * always derived (intake costs − payments), so this only appends the payment
   * and an audit entry.
   */
  const handleAddSupplierPayment = (input: Omit<SupplierPayment, 'id' | 'operator'> & { operator?: string }): string => {
    const id = createUniqueRecordId('spay', supplierPayments.map(item => item.id));
    const payment: SupplierPayment = {
      ...input,
      id,
      operator: input.operator || currentUser.fullName,
    };
    setSupplierPayments(prev => [payment, ...prev]);

    const audit: MaraniOSAuditLog = {
      id: createUniqueRecordId('audit', auditLogs.map(item => item.id)),
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
        id: createUniqueRecordId('audit', auditLogs.map(item => item.id)),
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

    const requestedMaterials = input.materials?.length
      ? input.materials
      : input.materialId && input.dose
        ? [{ materialId: input.materialId, quantity: input.dose }]
        : [];
    const materialUsages = requestedMaterials.flatMap(usage => {
      const material = inventory.find(item => item.id === usage.materialId);
      if (!material || !(usage.quantity > 0)) return [];
      return [{
        material,
        usage: {
          ...usage,
          materialName: material.name,
          category: material.category,
          unit: material.unit,
        },
      }];
    });
    const volumeBeforeL = lot.currentVolume;
    const hasVolumeChange = input.volumeAfterL != null && Number.isFinite(input.volumeAfterL);
    const volumeAfterL = hasVolumeChange ? Math.max(0, input.volumeAfterL as number) : undefined;

    const opId = createUniqueRecordId('op', cellarOps.map(item => item.id));
    const operator = input.operator || currentUser.fullName;
    const dateOnly = (input.date || new Date().toISOString()).slice(0, 10);

    // Build a readable timeline description.
    const parts: string[] = [opLabel];
    if (materialUsages.length) {
      parts.push(materialUsages.map(({ material, usage }) => (
        `${material.name} ${usage.quantity}${material.unit || ''}${usage.purpose ? ` (${usage.purpose})` : ''}`
      )).join(', '));
    }
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

    // 3) Inventory: deduct every consumed material (clamped at zero).
    if (materialUsages.length) {
      const deductions = new Map(
        materialUsages.map(({ material, usage }) => [material.id, usage.quantity]),
      );
      setInventory(prev => prev.map(item => {
        const quantity = deductions.get(item.id);
        return quantity == null ? item : {
          ...item,
          stock: deductStock(item.stock, quantity),
        };
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
      ...(materialUsages.length ? { materials: materialUsages.map(item => item.usage) } : {}),
      ...(materialUsages.length === 1 && input.materialId ? {
        materialName: materialUsages[0].material.name,
        unit: materialUsages[0].material.unit,
      } : {}),
    };
    setCellarOps(prev => [op, ...prev]);

    const materialCosts = materialUsages.flatMap(({ material, usage }) => {
      const materialCost = materialCostEntryFromOperation({
        ...op,
        materialId: material.id,
        materialName: material.name,
        dose: usage.quantity,
        unit: material.unit,
      }, material, {
        currency: companyProfile.currency || 'GEL',
        createdBy: operator,
      });
      return materialCost ? [materialCost] : [];
    });
    if (materialCosts.length) {
      setCostEntries(prev => [...materialCosts, ...prev]);
    }

    // 5) Audit.
    const audit: MaraniOSAuditLog = {
      id: createUniqueRecordId('audit', auditLogs.map(item => item.id)),
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

  const handleAddLabLog = (e: React.FormEvent) => {
    e.preventDefault();
    if (!labLotId || !labTankId) return;

    const newLab: LabAnalysis = {
      id: createUniqueRecordId('lab', labLogs.map(item => item.id)),
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
    const automaticLabCost = automaticLabCostEntry({
      analysisId: newLab.id,
      date: newLab.date,
      lotId: newLab.lotId,
      currency: companyProfile.currency || 'GEL',
      createdBy: currentUser.fullName || currentUser.username,
      settings: resolveCostAutomationSettings(companyProfile.costAutomation),
    });
    if (automaticLabCost && !costEntries.some(entry => entry.id === automaticLabCost.id)) {
      setCostEntries(previous => [automaticLabCost, ...previous]);
    }

    // Auto-update wine lots
    const targetLot = lots.find(l => l.id === labLotId);
    if (targetLot) {
      setLots(prev => prev.map(l => {
        if (l.id === labLotId) {
          return {
            ...l,
            history: [
              ...(l.history || []),
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

  const handleAddNewTask = (
    title: string,
    priority: 'high' | 'medium' | 'low',
    dueDate: string,
    description: string,
    assignment: TaskAssignmentInput = {},
  ) => {
    const newTask: Task = {
      id: createUniqueRecordId('task', tasks.map(item => item.id)),
      title,
      priority,
      dueDate: dueDate || new Date().toISOString().split('T')[0],
      assignedTo: assignment.assignedTo || currentUser.fullName || currentUser.username,
      ...(assignment.assignedUserId ? { assignedUserId: assignment.assignedUserId } : {}),
      status: 'pending',
      description,
      ...(assignment.notifyAssignee ? {
        notification: {
          status: 'sending' as const,
          updatedAt: new Date().toISOString(),
        },
      } : {}),
    };
    setTasks(prev => [newTask, ...prev]);
    setToastMessage(lang === 'ka' ? 'ახალი დავალება დაემატა!' : 'New task assigned successfully!');
    return newTask;
  };

  const handleUpdateTaskNotification = (
    taskId: string,
    notification: NonNullable<Task['notification']>,
  ) => {
    setTasks(prev => prev.map(task => task.id === taskId ? {
      ...task,
      notification,
    } : task));
  };

  const recordDeletions = (records: DeletionTombstone[]): boolean => {
    const collectionsByServerKey: Record<string, any[]> = {
      vessels, lots, fermlogs: fermLogs, lablogs: labLogs, inventory, tasks, notes: notesList,
      blocks, vineyardProjects, phenologyLogs, sprays, scoutings, soilRecords, samplings,
      harvests, irrigationLogs, fertilizerLogs, auditLogs, bottlingRuns, transfers,
      grapeIntakes, cellarOps, costEntries, storageLocations, stockMovements,
      salesDispatches, salesOrders, supplierPayments, certificationRecords, attachments,
      crmLeads, aiDrafts, qualitySops, purchaseOrders, productionPlans, recallCases,
    };
    const capturedAt = new Date().toISOString();
    const versionedRecords = records.map(record => {
      const source = record.collection
        ? collectionsByServerKey[record.collection]?.find(item => item?.id === record.id)
        : undefined;
      const clientCollectionKey = record.collection === 'fermlogs'
        ? 'fermLogs'
        : record.collection === 'lablogs'
          ? 'labLogs'
          : record.collection === 'notes' ? 'notesList' : record.collection;
      let serverSource: any;
      try {
        const serverRecords = clientCollectionKey
          ? JSON.parse(lastServerState.current[clientCollectionKey] || '[]')
          : [];
        if (Array.isArray(serverRecords)) {
          serverSource = serverRecords.find(item => item?.id === record.id);
        }
      } catch {
        // The current record still supplies fail-closed version evidence.
      }
      const baselineTimestamp = record.baselineTimestamp
        || source?.baselineTimestamp
        || serverSource?.lastModified
        || source?.lastModified;
      const baselineSource = serverSource || source;
      return {
        ...record,
        ...(baselineTimestamp ? { baselineTimestamp } : {}),
        ...(record.baselineFingerprint
          ? { baselineFingerprint: record.baselineFingerprint }
          : baselineSource ? { baselineFingerprint: syncRecordFingerprint(baselineSource) } : {}),
        deletedAt: record.deletedAt || capturedAt,
      };
    });
    if (!persistDeletionTombstones(versionedRecords, localStorage)) {
      setToastMessage(lang === 'ka'
        ? 'წაშლა ვერ დაიწყო, რადგან ამ მოწყობილობაზე ცვლილების უსაფრთხოდ შენახვა ვერ მოხერხდა. გაათავისუფლეთ საცავი ან განაახლეთ გვერდი და სცადეთ ხელახლა.'
        : 'Deletion could not start because this device could not save it safely. Free browser storage or refresh, then try again.');
      return false;
    }

    if (!SyncQueueManager.isOnline()) {
      versionedRecords.forEach(({ id, collection, baselineTimestamp }) => {
        if (!collection) return;
        IndexedDBQueue.addMutation({
          action: 'delete',
          collection,
          recordId: id,
          baselineTimestamp,
        });
      });
    }
    return true;
  };

  const recordDeletion = (id: string, collection: string): boolean => (
    recordDeletions([{ id, collection }])
  );

  const handleDeleteStorageLocation = (locationId: string): boolean => {
    const location = storageLocations.find(item => item.id === locationId);
    if (!location) return false;

    const references = storageLocationReferences(locationId, {
      movements: stockMovements,
      bottlingRuns,
      orders: salesOrders,
      dispatches: salesDispatches,
    });
    if (references.total > 0) {
      setToastMessage(lang === 'ka'
        ? 'შენახვის ლოკაცია ვერ წაიშლება, სანამ მასთან დაკავშირებული ჩანაწერები არსებობს.'
        : 'This storage location cannot be deleted while operational records still reference it.');
      return false;
    }

    if (!recordDeletion(locationId, 'storageLocations')) return false;
    setStorageLocations(prev => prev.filter(item => item.id !== locationId));
    setToastMessage(lang === 'ka' ? 'შენახვის ლოკაცია წაიშალა.' : 'Storage location deleted.');
    return true;
  };

  const handleDeleteStockMovement = (movementId: string): boolean => {
    const blockers = storageMovementDeletionBlockers(movementId, {
      movements: stockMovements,
      bottlingRuns,
      orders: salesOrders,
      dispatches: salesDispatches,
    });
    if (!blockers) return false;
    if (blockers.blocked) {
      setToastMessage(lang === 'ka'
        ? 'მარაგის მოძრაობა ვერ წაიშლება, რადგან ეს დაარღვევს დაკავშირებულ ჩანაწერს ან მარაგის ბალანსს.'
        : 'This stock movement cannot be deleted because it would break a linked record or stock balance.');
      return false;
    }

    if (!recordDeletion(movementId, 'stockMovements')) return false;
    setStockMovements(prev => prev.filter(item => item.id !== movementId));
    setToastMessage(lang === 'ka' ? 'მარაგის მოძრაობა წაიშალა.' : 'Stock movement deleted.');
    return true;
  };

  // Offload an inline attachment's bytes to object storage and swap the record
  // to a lightweight GCS reference, so the bytes never persist in the org JSONB
  // blob. Runs in the background after the optimistic local add — on any failure
  // the inline record is kept, so offline uploads still work.
  const offloadAttachmentToObjectStore = async (local: DocumentAttachment, input: DocumentAttachmentInput) => {
    if (!SyncQueueManager.isOnline()) return;
    if (local.storage.kind !== 'inline' || !local.storage.dataUrl) return;
    const operationEpoch = syncEpoch.current;
    try {
      const res = await SyncQueueManager.runInOrganizationContext(() => fetch('/api/attachments/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: input.fileName,
          mimeType: input.mimeType,
          dataUrl: local.storage.dataUrl,
          sizeBytes: input.sizeBytes ?? local.sizeBytes,
          module: input.module,
          linkedRecordType: input.linkedRecordType,
          linkedRecordId: input.linkedRecordId,
          description: input.description,
        }),
      }));
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      const objectKey = body?.attachment?.storage?.objectKey;
      if (!objectKey || operationEpoch !== syncEpoch.current || workspaceTransitionRef.current) return;
      setAttachments(prev => prev.map(a => (
        a.id === local.id
          ? {
              ...a,
              sizeBytes: body.attachment.sizeBytes ?? a.sizeBytes,
              checksum: body.attachment.checksum ?? a.checksum,
              storage: { kind: 'gcs' as const, objectKey },
            }
          : a
      )));
    } catch {
      /* keep the inline record — it still syncs (small) and works offline */
    }
  };

  const handleAddAttachment = (input: DocumentAttachmentInput): DocumentAttachment => {
    const attachment = createDocumentAttachmentRecord({
      ...input,
      uploadedBy: input.uploadedBy || currentUser.fullName || currentUser.username,
    });
    setAttachments(prev => [attachment, ...prev.filter(item => item.id !== attachment.id)]);
    setToastMessage(lang === 'ka' ? 'Attachment saved for review.' : 'Attachment saved for review.');
    void offloadAttachmentToObjectStore(attachment, input);
    return attachment;
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (!recordDeletion(attachmentId, 'attachments')) return;
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
    if (!recordDeletion(leadId, 'crmLeads')) return;
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
    if (!recordDeletion(taskId, 'tasks')) return;
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setToastMessage(lang === 'ka' ? 'დავალება წაიშალა!' : 'Task deleted successfully!');
  };

  const handleAddNewNote = (title: string, category: 'Enology' | 'Tasting' | 'Sanitation' | 'General', content: string, relatedLotId?: string) => {
    const newNote: CellarNote = {
      id: createUniqueRecordId('note', notesList.map(item => item.id)),
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
    if (!recordDeletion(noteId, 'notes')) return;
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
    if (!syncConflicts || !pendingServerDb || conflictResolutionInFlight.current || workspaceTransitionRef.current) return;
    conflictResolutionInFlight.current = true;
    const resolutionEpoch = syncEpoch.current;
    const conflictsToResolve = syncConflicts;
    try {
    const pendingIntent = pendingConflictSyncIntent.current
      || SyncQueueManager.getPendingConflictSyncIntent();
    if (!pendingIntent) {
      throw new Error('The original sync transaction could not be recovered. Local changes were kept.');
    }

    const { buildResolvedSyncState, resolveDeletionIntent } = await import('../lib/syncConflictRecovery');

    const deletionIntent = resolveDeletionIntent(
      pendingIntent.payload,
      conflictsToResolve,
      resolutions,
    );
    const discardedDeletions: DeletionTombstone[] = [
      ...deletionIntent.discardedRecords,
      ...deletionIntent.discardedLegacyIds.map(id => ({ id })),
    ];
    if (
      (discardedDeletions.length > 0 || deletionIntent.retainedRecords.length > 0)
      && !(await SyncQueueManager.reconcilePendingConflictDeletionRecords(
        deletionIntent.retainedRecords,
        discardedDeletions,
        pendingIntent.organizationId,
      ))
    ) {
      throw new Error('The deletion conflict choices could not be saved safely. Local changes were kept.');
    }

    const inMemoryRetryPayload = { ...pendingIntent.payload };
    if (deletionIntent.retainedRecords.length > 0) {
      inMemoryRetryPayload.deletedRecords = deletionIntent.retainedRecords;
    } else {
      delete inMemoryRetryPayload.deletedRecords;
    }
    if (deletionIntent.retainedLegacyIds.length > 0) {
      inMemoryRetryPayload.deletedIds = deletionIntent.retainedLegacyIds;
    } else {
      delete inMemoryRetryPayload.deletedIds;
    }
    const retryIntent = SyncQueueManager.getPendingConflictSyncIntent() || {
      ...pendingIntent,
      payload: inMemoryRetryPayload,
    };
    if (!await SyncQueueManager.isPendingConflictSyncIntentCurrent(retryIntent)) {
      throw new Error('Newer local changes were made after this conflict appeared. Retry sync before resolving it.');
    }

    const db = buildResolvedSyncState({
      serverDb: pendingServerDb,
      attemptedPayload: retryIntent.payload,
      conflicts: conflictsToResolve,
      resolutions,
    });

    // Clear mutations queue from IndexedDB
    await SyncQueueManager.clearOfflineQueue();
    if (resolutionEpoch !== syncEpoch.current || workspaceTransitionRef.current || !hasHydrated.current) return;

    // Re-mark every collection in the attempted transaction, including clean
    // siblings that were deferred when one anchor record conflicted.
    const retryCollections = new Set([
      ...retryIntent.dirtyCollections,
      ...conflictsToResolve.map(conflict => conflict.collection),
    ]);
    retryCollections.forEach(collection => SyncQueueManager.markDirty(collection));

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
      grapeIntakes: db.grapeIntakes || grapeIntakes,
      cellarOps: db.cellarOps || cellarOps,
      costEntries: db.costEntries || costEntries,
      winePricing: db.winePricing || winePricing,
      storageLocations: db.storageLocations || storageLocations,
      stockMovements: db.stockMovements || stockMovements,
      invoiceReceipts: db.invoiceReceipts || invoiceReceipts,
      inventoryMovements: db.inventoryMovements || inventoryMovements,
      salesDispatches: db.salesDispatches || salesDispatches,
      salesOrders: db.salesOrders || salesOrders,
      supplierPayments: db.supplierPayments || supplierPayments,
      certificationRecords: db.certificationRecords || certificationRecords,
      attachments: db.attachments || attachments,
      crmLeads: db.crmLeads || crmLeads,
      aiDrafts: db.aiDrafts || aiDrafts,
      qualitySops: db.qualitySops || qualitySops,
      purchaseOrders: db.purchaseOrders || purchaseOrders,
      productionPlans: db.productionPlans || productionPlans,
      recallCases: db.recallCases || recallCases,
      companyProfile: db.companyProfile || companyProfile
    };

    await triggerSync(currentFullState);

    setToastMessage(lang === 'ka' ? 'კონფლიქტები წარმატებით მოგვარდა!' : 'Conflicts resolved successfully!');
    } catch (error) {
      setLastSyncError(error instanceof Error ? error.message : 'Conflict resolution failed');
      setToastMessage(lang === 'ka'
        ? '⚠️ კონფლიქტის მოგვარება ვერ დასრულდა. მონაცემები არ გაგზავნილა.'
        : '⚠️ Conflict resolution could not finish. No resolved data was sent.');
    } finally {
      conflictResolutionInFlight.current = false;
    }
  };

  // Every handler below is declared fresh on each render. Wrapping the result
  // gives each one a fixed identity (forwarding to the current implementation),
  // which is what allows the memoized module components to skip a render when
  // only unrelated state moved. Data entries pass through by reference.
  return useStableCallbacks({
    lang, setLang,
    activeTab, setActiveTab,
    isClient,
    isAuthResolved,
    // `toastMessage` is intentionally absent: StatusToastHost subscribes to it
    // directly so raising one does not re-render every consumer of this hook.
    setToastMessage,
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
    invoiceReceipts, setInvoiceReceipts,
    inventoryMovements, setInventoryMovements,
    salesDispatches, setSalesDispatches,
    salesOrders, setSalesOrders,
    supplierPayments, setSupplierPayments,
    certificationRecords, setCertificationRecords,
    attachments, setAttachments,
    crmLeads, setCrmLeads,
    aiDrafts, setAiDrafts,
    qualitySops, setQualitySops,
    purchaseOrders, setPurchaseOrders,
    productionPlans, setProductionPlans,
    recallCases, setRecallCases,

    // Inputs
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
    prefilledIntakeHarvestId, setPrefilledIntakeHarvestId,
    prefilledOpVesselId, setPrefilledOpVesselId,
    prefilledDestId, setPrefilledDestId,

    // Actions
    sanitizeId,
    triggerSync,
    applyTransferCommandResponse,
    applyTransferReversalCommandResponse,
    applyBottlingCommandResponse,
    applySalesStockCommandResponse,
    applyStorageMovementCommandResponse,
    applyInvoiceReceiptCommandResponse,
    applyHarvestIntakeCommandResponse,
    applyFermentationCompletionCommandResponse,
    applyFermentationCompletionReversalCommandResponse,
    applyCellarOperationCommandResponse,
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
    handleAddLabLog,
    handleToggleTaskStatus,
    handleAddNewTask,
    handleUpdateTaskNotification,
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
    handleDeleteStorageLocation,
    handleDeleteStockMovement,
    handleAddInventory,
    handleAuthLogin,
    handleDemoLogin,
    handleAuthLogout,
    handleAuthRegister,
    handleCompleteRegistration,
    handleResendVerification,
    handleUpdateProfile,
    organizations,
    isSwitchingOrganization,
    workspaceHydrationError,
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
  });
}
