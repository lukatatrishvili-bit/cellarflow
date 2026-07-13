import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { lazyRetry } from './lazyRetry';
import { motion, AnimatePresence } from 'motion/react';
import type { Language } from '../lib/i18n';
import { getShellTranslations } from '../lib/i18nShell';
import { computeAlerts, type Alert } from '../lib/alerts';
import NotificationCenter from '../components/NotificationCenter';
import type { PickedLocation } from '../components/LocationPicker';
import { useWineryState } from '../hooks/useWineryState';
import { IndexedDBQueue } from '../lib/syncQueue';
import { ToastProvider } from '../components/ToastProvider';
import { usePerformanceManager } from '../hooks/usePerformanceManager';
import { useFocusTrap } from '../components/useFocusTrap';
import { canAccess } from '../server/permissions';
import { parseAuthAccessLink } from '../lib/authAccess';
import { localizedRoleLabel } from '../lib/roleLabels';
import {
  canViewAppDestination,
  firstVisibleWineryTab,
  permissionModuleFor,
} from '../lib/navigationPermissions';
import { cellarWorkflowPermissions } from '../lib/workflowPermissions';

// Heavy modules are code-split
const DashboardTab = lazyRetry(() => import('../components/DashboardTab'));
const ProfileSettingsTab = lazyRetry(() => import('../components/ProfileSettingsTab'));
const IntegrationHubTab = lazyRetry(() => import('../components/IntegrationHubTab'));
const AuditTrailTab = lazyRetry(() => import('../components/AuditTrailTab'));
const LotPassport = lazyRetry(() => import('../components/LotPassport'));
const VaziModule = lazyRetry(() => import('../components/VaziModule'));
const WineryDashboardTab = lazyRetry(() => import('../components/WineryDashboardTab'));
const TanksVessels = lazyRetry(() => import('../components/TanksVessels'));
const QvevriPassportTab = lazyRetry(() => import('../components/QvevriPassportTab'));
const GrapeReceivingTab = lazyRetry(() => import('../components/GrapeReceivingTab'));
const WineLotsTrace = lazyRetry(() => import('../components/WineLotsTrace'));
const LotLineageGraphTab = lazyRetry(() => import('../components/LotLineageGraphTab'));
const CellarOperationsTab = lazyRetry(() => import('../components/CellarOperationsTab'));
const TransfersTab = lazyRetry(() => import('../components/TransfersTab'));
const FermentationTab = lazyRetry(() => import('../components/FermentationTab'));
const LabsTab = lazyRetry(() => import('../components/LabsTab'));
const BottlingTab = lazyRetry(() => import('../components/BottlingTab'));
const EnoCalculators = lazyRetry(() => import('../components/EnoCalculators'));
const InventoryTab = lazyRetry(() => import('../components/InventoryTab'));
const AiWinemaker = lazyRetry(() => import('../components/AiWinemaker'));
const TasksTab = lazyRetry(() => import('../components/TasksTab'));
const NotesTab = lazyRetry(() => import('../components/NotesTab'));
const OfficialDocsTab = lazyRetry(() => import('../components/OfficialDocsTab'));
const CertificationManagerTab = lazyRetry(() => import('../components/CertificationManagerTab'));
const CostsTab = lazyRetry(() => import('../components/CostsTab'));
const StorageTab = lazyRetry(() => import('../components/StorageTab'));
const SalesDispatchTab = lazyRetry(() => import('../components/SalesDispatchTab'));
const YearComparisonTab = lazyRetry(() => import('../components/YearComparisonTab'));
const VesselDrawer = lazyRetry(() => import('../components/VesselDrawer'));
const LocationPicker = lazyRetry(() => import('../components/LocationPicker'));
const GlobalCommandPalette = lazyRetry(() => import('../components/GlobalCommandPalette'));

// Subcomponents modular layout
import AuroraBackdrop from '../components/AuroraBackdrop';
import SyncStatus from '../components/SyncStatus';
import InstallButton from '../components/InstallButton';
import AuthAccountFlows, {
  type AuthAccountFlow,
  type AuthenticatedStateNotice,
  type ReturnToSignInContext,
} from '../components/AuthAccountFlows';

// Core Lucide Icons mapping
import {
  LayoutDashboard,
  Container,
  Grape,
  Workflow,
  Wine,
  GitCommit,
  GitMerge,
  Activity,
  TestTube,
  Boxes,
  Languages,
  ShieldAlert,
  MailCheck,
  Loader2,
  X,
  Thermometer,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ClipboardList,
  FileText,
  FileSpreadsheet,
  BarChart3,
  BadgeDollarSign,
  Package,
  Coins,
  Warehouse,
  Truck,
  Trash,
  CheckCircle2,
  Sprout,
  Sun,
  Moon,
  RefreshCw,
  Search,
  PlugZap,
  BadgeCheck,
  Settings,
  Menu
} from 'lucide-react';

function ModuleLoader() {
  return (
    <div className="flex items-center justify-center p-16 w-full">
      <Loader2 className="w-6 h-6 animate-spin text-[#4e0e15]" />
    </div>
  );
}

const PENDING_INVITATION_TOKEN_KEY = 'vinos_pending_invitation_token';

interface InitialAuthLinkContext {
  flow: AuthAccountFlow | null;
  resetToken: string;
  username: string;
  invitationToken: string;
}

function readInitialAuthLinkContext(): InitialAuthLinkContext {
  if (typeof window === 'undefined') {
    return { flow: null, resetToken: '', username: '', invitationToken: '' };
  }
  let storedInvitationToken = '';
  try {
    storedInvitationToken = localStorage.getItem(PENDING_INVITATION_TOKEN_KEY) || '';
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  return parseAuthAccessLink(window.location.pathname, window.location.search, storedInvitationToken);
}

export default function App() {
  const state = useWineryState();
  const perf = usePerformanceManager();
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [showSyncTroubleshooter, setShowSyncTroubleshooter] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [lineageFocusLotId, setLineageFocusLotId] = useState<string>('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [initialAuthLinkContext] = useState<InitialAuthLinkContext>(readInitialAuthLinkContext);
  const [authAccountFlow, setAuthAccountFlow] = useState<AuthAccountFlow | null>(initialAuthLinkContext.flow);
  const [pendingInvitationToken, setPendingInvitationToken] = useState(initialAuthLinkContext.invitationToken);
  const aiDrawerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(aiDrawerRef, { active: isAiDrawerOpen, onClose: () => setIsAiDrawerOpen(false) });

  useEffect(() => {
    document.documentElement.lang = state.lang === 'ka' ? 'ka' : 'en';
    document.title = state.lang === 'ka' ? 'VinOS — მარნის მართვა' : 'VinOS — Winery Management';
  }, [state.lang]);

  useEffect(() => {
    if (typeof window === 'undefined' || !initialAuthLinkContext.flow) return;
    if (initialAuthLinkContext.invitationToken) {
      try {
        localStorage.setItem(PENDING_INVITATION_TOKEN_KEY, initialAuthLinkContext.invitationToken);
      } catch {
        // Continue without persistence when storage is unavailable.
      }
    }
    window.history.replaceState(
      {},
      '',
      initialAuthLinkContext.flow === 'reset-password' ? '/reset-password' : '/accept-invite',
    );
  }, [initialAuthLinkContext]);

  const rememberInvitation = (token: string) => {
    setPendingInvitationToken(token);
    try {
      localStorage.setItem(PENDING_INVITATION_TOKEN_KEY, token);
    } catch {
      // In-memory intent still works for the current page session.
    }
  };

  const clearPendingInvitation = () => {
    setPendingInvitationToken('');
    try {
      localStorage.removeItem(PENDING_INVITATION_TOKEN_KEY);
    } catch {
      // Nothing else is required when storage is unavailable.
    }
  };

  const handleAuthFlowReturn = (context: ReturnToSignInContext) => {
    if (context.flow === 'accept-invite') {
      if (context.reason === 'authentication-required' && context.invitationToken) {
        rememberInvitation(context.invitationToken);
      } else if (context.reason === 'cancelled') {
        clearPendingInvitation();
      }
    }
    if (typeof window !== 'undefined') window.history.replaceState({}, '', '/');
    setAuthAccountFlow(null);
  };

  const handleAuthFlowStateChange = (notice: AuthenticatedStateNotice) => {
    if (notice.reason === 'authentication-required') {
      rememberInvitation(notice.invitationToken);
      setAuthAccountFlow(null);
      if (typeof window !== 'undefined') window.history.replaceState({}, '', '/');
      return;
    }
    clearPendingInvitation();
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
      window.setTimeout(() => window.location.assign('/'), 650);
    }
  };

  // Onboarding wizard toggling
  useEffect(() => {
    if (state.isLoggedIn && (state.currentUser.registrationComplete === false || !state.currentUser.enabledModules)) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [state.isLoggedIn, state.currentUser.enabledModules, state.currentUser.registrationComplete]);

  // Redirect active module if disabled
  useEffect(() => {
    if (!state.isLoggedIn) return;
    const enabledModules = state.currentUser.enabledModules || ['vazi', 'gvino'];
    if (state.activeModule === 'vazi' && !enabledModules.includes('vazi')) {
      state.setActiveModule(enabledModules.includes('gvino') ? 'gvino' : 'portal');
    }
    if (state.activeModule === 'gvino' && !enabledModules.includes('gvino')) {
      state.setActiveModule(enabledModules.includes('vazi') ? 'vazi' : 'portal');
    }
  }, [state.isLoggedIn, state.currentUser.enabledModules, state.activeModule]);

  // Dark Mode State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cf_dark_mode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('cf_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('cf_dark_mode', 'false');
    }
  }, [darkMode]);

  // Registering/Login switch state
  const [isRegistering, setIsRegistering] = useState(false);
  // Estate location chosen during registration (drives weather, maps, disease models)
  const [regLocation, setRegLocation] = useState<PickedLocation | null>(null);

  // Retractable header: slides up to reclaim vertical space. Manual only —
  // chevron button to hide, the "Menu" pill to show. Preference persists.
  const [headerHidden, setHeaderHidden] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('cf_header_hidden') === 'true');
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('cf_header_hidden', String(headerHidden));
  }, [headerHidden]);
  const showHeader = !headerHidden;

  // Network connection state
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      state.setToastMessage(state.lang === 'ka' ? 'ინტერნეტთან კავშირი აღდგა! ხდება სინქრონიზაცია...' : 'Connection restored! Synchronizing...');
      state.triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      state.setToastMessage(state.lang === 'ka' ? 'კავშირი გაწყდა. მუშაობა გრძელდება ოფლაინ რეჟიმში.' : 'Connection lost. Operating in offline mode.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [state.lang]);

  // A new service worker took over mid-session (event from src/main.tsx).
  // Show a persistent banner; never auto-reload — the user may be mid-form.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const onSwUpdated = () => setUpdateReady(true);
    window.addEventListener('vinos:sw-updated', onSwUpdated);
    return () => window.removeEventListener('vinos:sw-updated', onSwUpdated);
  }, []);

  // Real-time telemetry state
  const [activeTelemetry, setActiveTelemetry] = useState<any[]>([]);

  // Conflict resolution choice state
  const [resolutions, setResolutions] = useState<Record<string, 'local' | 'server'>>({});

  // Nav bar: which dropdown is open — a module-group id, 'settings', 'mobile', or null.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openMenu) return;
    const onPointer = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  // Navigating to another module/tab must land at the top. The app scrolls the
  // window (no inner scroll container), so a state-driven view change otherwise
  // keeps the previous scroll offset and opens the new page mid-screen. Reset to
  // the top on every module/tab change (instant — smooth scrolling on nav is
  // janky and fights reduced-motion preferences).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [state.activeModule, state.activeTab]);

  // Latest tasks are read through a ref so the poller below doesn't restart
  // (and immediately re-fetch) every time the tasks array changes. Re-checking
  // the ref each 15s poll also self-heals the startup race where login
  // hydration overwrites a task created before the first server snapshot.
  const tasksRef = useRef(state.tasks);
  tasksRef.current = state.tasks;

  // Periodically poll fermentation telemetry and run stuck fermentation detector
  useEffect(() => {
    if (!state.isLoggedIn) return;

    const fetchTelemetry = async () => {
      try {
        const res = await fetch('/api/telemetry/active');
        if (res.ok) {
          const data = await res.json();
          // Preserve identity when readings haven't changed to avoid re-renders.
          setActiveTelemetry(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);

          // Slope Anomaly Detector
          data.forEach((reading: any) => {
            if (reading.dailySlope < 0.002 && reading.status === 'stuck') {
              const taskTitle = `Diagnose stuck fermentation in ${reading.tankId} (Lot ${reading.lotId})`;
              const hasTask = tasksRef.current.some(t => t.title === taskTitle);
              if (!hasTask) {
                state.handleAddNewTask(
                  taskTitle,
                  'high',
                  new Date().toISOString().split('T')[0],
                  `Stuck fermentation alert triggered by real-time IoT sensor. Temperature is ${reading.temperature}°C, density is ${reading.density} SG, and daily slope drop is ${reading.dailySlope} SG/day (< 0.002 SG/day threshold). Initiate warning restart procedures immediately.`
                );
                state.setToastMessage(`CRITICAL STUCK FERMENTATION DETECTED on ${reading.tankId}!`);
              }
            }
          });
        }
      } catch (err) {
        console.error('Failed to retrieve telemetry data:', err);
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 15000);
    return () => clearInterval(interval);
  }, [state.isLoggedIn]);

  // Derived live alert feed for the notification center
  const alerts = useMemo(() => {
    const baseAlerts = computeAlerts({
      vessels: state.vessels,
      lots: state.lots,
      fermLogs: state.fermLogs,
      labLogs: state.labLogs,
      inventory: state.inventory,
      tasks: state.tasks
    });

    const telemetryAlerts: Alert[] = [];
    activeTelemetry.forEach((t: any) => {
      if (t.dailySlope < 0.002 && t.status === 'stuck') {
        const lot = state.lots.find(l => l.id === t.lotId);
        const name = lot ? lot.name : t.lotId;
        telemetryAlerts.push({
          id: `telemetry-stuck-${t.lotId}`,
          severity: 'critical',
          category: 'fermentation',
          title: `Stuck fermentation — ${name} (Telemetry)`,
          message: `Sensor detected gravity drop rate of ${t.dailySlope.toFixed(4)} SG/day (< 0.002 SG/day threshold). Current SG: ${t.density}. Temperature: ${t.temperature}°C.`,
          relatedLotId: t.lotId,
          relatedTankId: t.tankId
        });
      }
    });

    const combined = [...telemetryAlerts, ...baseAlerts];
    const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return combined.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  }, [state.vessels, state.lots, state.fermLogs, state.labLogs, state.inventory, state.tasks, activeTelemetry]);

  const handleSelectAlert = (a: Alert) => {
    const tabByCategory: Record<Alert['category'], string> = {
      so2: 'labs',
      va: 'labs',
      fermentation: 'fermentation',
      temperature: 'vessels',
      cleaning: 'vessels',
      task: 'tasks',
      inventory: 'inventory',
    };
    state.setActiveModule('gvino');
    state.setActiveTab(tabByCategory[a.category]);
  };

  // Close selected modal drawer on Escape key down for intuitive usability
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        state.setSelectedTankId(null);
        setIsAiDrawerOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [state]);


  const t = getShellTranslations(state.lang);
  const needsRegistrationCompletion = state.currentUser.registrationComplete === false;
  const defaultEnabledModules = state.currentUser.enabledModules || ['vazi', 'gvino'];
  const defaultEnabledWidgets = state.currentUser.enabledWidgets || ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'];

  // Derived stats for sidebar
  const activeFermsCount = state.lots.filter(l => l.stage === 'fermenting').length;
  const occupiedVessels = state.vessels.filter(v => v.currentVolume > 0);
  const occupiedTanksCount = occupiedVessels.length;
  const averageOccupiedTemp = occupiedTanksCount > 0
    ? parseFloat((occupiedVessels.reduce((acc, vessel) => acc + (vessel.temperature || 0), 0) / occupiedTanksCount).toFixed(1))
    : 0;
  const totalCellarCapacity = state.vessels.reduce((acc, vessel) => acc + vessel.capacity, 0);
  const usedCellarVolume = occupiedVessels.reduce((acc, vessel) => acc + vessel.currentVolume, 0);
  const cellarCapacityPct = totalCellarCapacity > 0 ? Math.round((usedCellarVolume / totalCellarCapacity) * 100) : 0;
  const pendingTaskCount = state.tasks.filter(task => task.status !== 'completed').length;
  const urgentAlertCount = alerts.filter(alert => alert.severity === 'critical').length;
  const wineryTabGroups = [
    {
      label: state.lang === 'ka' ? 'მიმოხილვა' : 'Overview',
      tabs: [
        { id: 'dashboard', label: t.dashboard, icon: LayoutDashboard },
      ],
    },
    {
      label: state.lang === 'ka' ? 'ღვინის გზა' : 'Wine lifecycle',
      tabs: [
        { id: 'intake', label: t.grape_intake || 'Grape Intake', icon: Grape },
        { id: 'lots', label: t.wine_lots, icon: Wine },
        { id: 'lineage', label: t.lineage || 'Lineage', icon: GitMerge },
      ],
    },
    {
      label: state.lang === 'ka' ? 'მარანი' : 'Cellar work',
      tabs: [
        { id: 'vessels', label: t.tanks, icon: Container },
        { id: 'qvevri', label: state.lang === 'ka' ? 'ქვევრის პასპორტი' : 'Qvevri Passport', icon: FileText },
        { id: 'operations', label: t.cellar_operations || 'Operations', icon: Workflow },
        { id: 'transfers', label: t.transfers, icon: GitCommit },
        { id: 'fermentation', label: t.fermentation, icon: Activity },
        { id: 'labs', label: t.lab_analysis, icon: TestTube },
        { id: 'bottling', label: t.bottling, icon: Package },
      ],
    },
    {
      label: state.lang === 'ka' ? 'სამუშაოები' : 'Tools',
      tabs: [
        { id: 'inventory', label: t.inventory, icon: Boxes },
        { id: 'tasks', label: t.tasks, icon: ClipboardList },
        { id: 'notes', label: t.notes, icon: FileText },
        { id: 'calculators', label: t.calculators, icon: TestTube },
        { id: 'ai', label: t.ai_assistant, icon: BrainCircuitIcon },
      ],
    },
  ];
  const canViewModule = (moduleId: string, tabId?: string) => (
    canViewAppDestination(state.currentUser.role, moduleId, tabId)
  );
  const accessibleWineryTabGroups = wineryTabGroups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) => canViewModule('gvino', tab.id)),
    }))
    .filter((group) => group.tabs.length > 0);
  const cellarPermissions = useMemo(
    () => cellarWorkflowPermissions(state.currentUser.role),
    [state.currentUser.role],
  );
  const activePermissionModule = permissionModuleFor(state.activeModule, state.activeTab);
  const canManageCurrentArea = canAccess(state.currentUser.role, activePermissionModule, 'create')
    || canAccess(state.currentUser.role, activePermissionModule, 'update');
  const shouldShowReadOnlyNotice = state.isLoggedIn
    && canViewModule(state.activeModule, state.activeTab)
    && !canManageCurrentArea
    && state.activeModule !== 'portal'
    && state.activeModule !== 'settings'
    && !(state.activeModule === 'gvino' && state.activeTab === 'dashboard');
  const moduleGroups = [
    {
      id: 'dashboard',
      label: state.lang === 'ka' ? 'მთავარი' : 'Dashboard',
      icon: LayoutDashboard,
      primary: 'portal',
      modules: [{ id: 'portal', label: t.nav_portal || 'Dashboard Portal', icon: LayoutDashboard }],
    },
    {
      id: 'vineyard',
      label: state.lang === 'ka' ? 'ვენახი' : 'Vineyard',
      icon: Sprout,
      primary: 'vazi',
      requires: 'vazi',
      modules: [{ id: 'vazi', label: t.nav_vazi || 'Vazi', icon: Sprout }],
    },
    {
      id: 'cellar',
      label: state.lang === 'ka' ? 'მარანი' : 'Cellar',
      icon: Wine,
      primary: 'gvino',
      requires: 'gvino',
      modules: [{ id: 'gvino', label: t.nav_gvino || 'Gvino', icon: Wine }],
    },
    {
      id: 'business',
      label: state.lang === 'ka' ? 'ბიზნესი' : 'Business',
      icon: BadgeDollarSign,
      primary: 'sales',
      modules: [
        { id: 'sales', label: t.nav_sales || 'Sales', icon: Truck },
        { id: 'storage', label: t.nav_storage || 'Storage', icon: Warehouse },
        { id: 'costs', label: t.nav_costs || 'Costs', icon: Coins },
        { id: 'analytics', label: t.nav_analytics || 'Analytics', icon: BarChart3 },
      ],
    },
    {
      id: 'documents',
      label: state.lang === 'ka' ? 'დოკუმენტები' : 'Documents',
      icon: FileSpreadsheet,
      primary: 'docs',
      modules: [
        { id: 'docs', label: t.nav_docs || 'Official Documents', icon: FileSpreadsheet },
        { id: 'certification', label: state.lang === 'ka' ? 'სერტიფიცირება' : 'Certification', icon: BadgeCheck },
        { id: 'audit', label: t.nav_audit || 'Audit Trail', icon: FileText },
      ],
    },
    {
      id: 'settings',
      label: t.nav_settings || 'Settings',
      icon: ClipboardList,
      primary: 'integrations',
      modules: [
        { id: 'integrations', label: state.lang === 'ka' ? 'ინტეგრაციები' : 'Integration Hub', icon: PlugZap },
        { id: 'settings', label: t.nav_settings || 'Settings', icon: ClipboardList },
      ],
    },
  ].map(group => {
    const modules = group.modules.filter(mod => canViewModule(mod.id));
    const primary = modules.some(mod => mod.id === group.primary) ? group.primary : modules[0]?.id || group.primary;
    return { ...group, modules, primary };
  }).filter(group => {
    const enabledModules = state.currentUser.enabledModules || ['vazi', 'gvino'];
    if (group.requires === 'vazi' && !enabledModules.includes('vazi')) return false;
    if (group.requires === 'gvino' && !enabledModules.includes('gvino')) return false;
    if (group.modules.length === 0) return false;
    return true;
  });
  const activeModuleGroup = moduleGroups.find(group => group.modules.some(mod => mod.id === state.activeModule)) || moduleGroups[0];
  useEffect(() => {
    if (!state.isLoggedIn) return;
    if (canViewModule(state.activeModule, state.activeTab)) return;
    if (state.activeModule === 'gvino') {
      const fallbackTab = firstVisibleWineryTab(state.currentUser.role);
      if (fallbackTab) {
        state.setActiveTab(fallbackTab);
        return;
      }
    }
    state.setActiveModule((moduleGroups[0]?.primary || 'portal') as any);
  }, [state.isLoggedIn, state.currentUser.role, state.activeModule, state.activeTab]);

  const switchModule = (moduleId: string) => {
    state.setActiveModule(moduleId as any);
    if (moduleId === 'gvino') {
      state.setActiveTab('dashboard');
    }
  };
  const handleNavigate = (target: { module: string; tab?: string }) => {
    if (!canViewModule(target.module, target.tab)) {
      state.setToastMessage(state.lang === 'ka'
        ? 'თქვენს როლს ამ განყოფილებაზე წვდომა არ აქვს.'
        : 'Your workspace role does not have access to that area.');
      return;
    }
    state.setActiveModule(target.module as any);
    if (target.tab) state.setActiveTab(target.tab);
  };

  // Loading gate — MUST come after every hook above. React requires an
  // unconditional, stable hook order across renders; early-returning before a
  // hook (as this block previously did, ahead of the module-access useEffect)
  // triggers "Rendered more hooks than during the previous render" once
  // isClient flips true and the extra hooks suddenly run.
  if (!state.isClient) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8F5] text-[#2c241e]">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-800 mb-2" />
        <span className="text-xs font-semibold tracking-wide uppercase font-serif">{state.lang === 'ka' ? 'VinOS ერთიანი პლატფორმა იტვირთება...' : 'Powering up VinOS Unified Platform...'}</span>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed top-0 left-0 right-0 z-[1000] bg-rose-600 border-b border-rose-700 text-white py-2 px-4 flex items-center justify-between shadow-md"
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="animate-pulse">⚡</span>
              <span>
                {state.lang === 'ka' 
                  ? 'კავშირი გაწყდა. მარანი მუშაობს ოფლაინ რეჟიმში — ცვლილებები შეინახება ლოკალურად და სინქრონიზირდება კავშირის აღდგენისას.' 
                  : 'Offline Mode Enabled — Using local VinOS cache. Unsaved modifications will auto-sync on reconnect.'}
              </span>
            </div>
            <button
              onClick={() => {
                if (typeof navigator !== 'undefined') {
                  const online = navigator.onLine;
                  setIsOnline(online);
                  if (online) {
                    state.setToastMessage(state.lang === 'ka' ? 'კავშირი აღდგა! სინქრონიზაცია...' : 'Connection restored! Syncing...');
                    state.triggerSync();
                  } else {
                    state.setToastMessage(state.lang === 'ka' ? 'კავშირი კვლავ არ არის.' : 'Still offline.');
                  }
                }
              }}
              className="px-2.5 py-1 bg-white hover:bg-stone-50 text-rose-700 rounded-lg text-[10px] font-black tracking-wide uppercase transition-all cursor-pointer shadow-3xs active:scale-95 shrink-0"
            >
              🔄 {state.lang === 'ka' ? 'ხელახლა ცდა' : 'Retry'}
            </button>
          </motion.div>
        )}
        {updateReady && (
          <motion.div
            key="sw-update-banner"
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-[#4e0e15] text-[#fbf9f6] rounded-2xl shadow-xl py-2.5 px-4 flex items-center gap-3 max-w-[92vw]"
            role="status"
          >
            <span className="text-xs font-semibold">
              {state.lang === 'ka'
                ? 'ხელმისაწვდომია ახალი ვერსია.'
                : 'A new version of VinOS is ready.'}
            </span>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1 bg-white text-[#4e0e15] rounded-lg text-[10px] font-black tracking-wide uppercase cursor-pointer active:scale-95 transition-transform shrink-0"
            >
              {state.lang === 'ka' ? 'განახლება' : 'Reload'}
            </button>
            <button
              onClick={() => setUpdateReady(false)}
              aria-label={state.lang === 'ka' ? 'დახურვა' : 'Dismiss'}
              className="text-white/60 hover:text-white text-sm leading-none cursor-pointer shrink-0"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* overflow-x clipping lives on <body> (globals.css): an overflow value
          on this wrapper would break position:sticky for the floating header */}
      <div className="min-h-screen bg-[#f8f6f2] dark:bg-[#0a0607] flex flex-col font-sans relative transition-colors duration-300">
      
      {/* Ambient, photo-free backdrop: drifting light + terrace contours */}
      <AuroraBackdrop variant={state.isLoggedIn ? 'subtle' : 'rich'} shouldReduceMotion={perf.shouldReduceMotion} />
      
      {/* Dynamic Toast Alerts instead of blocking alerts inside nested components */}
      {state.toastMessage && (() => {
        const isSyncIssue = typeof state.toastMessage === 'string' && (
          state.toastMessage.includes('Sync conflict') ||
          state.toastMessage.includes('Sync rejected') ||
          state.toastMessage.includes('rejected') ||
          state.toastMessage.includes('კონფლიქტი') ||
          state.toastMessage.includes('უარყოფილია')
        );
        return (
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
            className="fixed top-20 right-6 z-50 bg-[#4e0e15] border border-[#801323] text-amber-100 rounded-xl px-4 py-2.5 shadow-lg font-bold text-xs flex items-center gap-3 elev-float"
          >
            <div className="flex items-center gap-2">
              <span>🍇</span>
              <span>{state.toastMessage}</span>
            </div>
            {isSyncIssue && (
              <button
                onClick={() => setShowSyncTroubleshooter(true)}
                className="ml-2 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-[#4e0e15] rounded-lg text-[10px] font-black tracking-wide uppercase transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
              >
                ⚡ {state.lang === 'ka' ? 'მოგვარება' : 'Trace & Fix'}
              </button>
            )}
          </motion.div>
        );
      })()}

      {/* Lot Passport — traceability report modal */}
      {state.passportLotId && (() => {
        const passportLot = state.lots.find(l => l.id === state.passportLotId);
        if (!passportLot) return null;
        return (
          <Suspense fallback={null}>
            <LotPassport
              lot={passportLot}
              fermLogs={state.fermLogs.filter(f => f.lotId === passportLot.id)}
              labLogs={state.labLogs.filter(l => l.lotId === passportLot.id)}
              company={state.companyProfile}
              generatedBy={state.currentUser.fullName}
              blocks={state.blocks}
              harvests={state.harvests}
              grapeIntakes={state.grapeIntakes}
              vessels={state.vessels}
              cellarOps={state.cellarOps}
              transfers={state.transfers}
              bottlingRuns={state.bottlingRuns}
              storageLocations={state.storageLocations}
              stockMovements={state.stockMovements}
              salesOrders={state.salesOrders}
              salesDispatches={state.salesDispatches}
              certificationRecords={state.certificationRecords}
              attachments={state.attachments}
              auditLogs={state.auditLogs}
              onOpenLineage={(lotId) => {
                setLineageFocusLotId(lotId);
                state.setPassportLotId(null);
                state.setActiveModule('gvino');
                state.setActiveTab('lineage');
              }}
              onClose={() => state.setPassportLotId(null)}
            />
          </Suspense>
        );
      })()}

      {state.isLoggedIn && (
        <Suspense fallback={null}>
          <GlobalCommandPalette
            open={isCommandOpen}
            lang={state.lang}
            onOpenChange={setIsCommandOpen}
            lots={state.lots}
            vessels={state.vessels}
            inventory={state.inventory}
            tasks={state.tasks}
            orders={state.salesOrders}
            dispatches={state.salesDispatches}
            role={state.currentUser.role}
            setActiveModule={(moduleId) => state.setActiveModule(moduleId as any)}
            setActiveTab={state.setActiveTab}
            setPassportLotId={state.setPassportLotId}
            setSelectedTankId={state.setSelectedTankId}
            setLineageLotId={setLineageFocusLotId}
          />
        </Suspense>
      )}

      {/* Restore handle shown while retracted (manual click only) */}
      {headerHidden && (
        <button
          onClick={() => setHeaderHidden(false)}
          className="fixed top-1.5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-3 py-1 bg-[#4e0e15]/90 backdrop-blur text-amber-50 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg cursor-pointer hover:bg-[#4e0e15] animate-fade-in"
          title={state.lang === 'ka' ? 'მენიუს ჩვენება' : 'Show menu'}
        >
          <ChevronDown className="w-3.5 h-3.5" /> {state.lang === 'ka' ? 'მენიუ' : 'Menu'}
        </button>
      )}

      {/* 1. Global Navigation Bar — floating glass pill (retractable). Height
          collapse (Framer) reclaims space; transform/opacity (CSS) reliably
          drives the slide so the end-state holds even if frames are throttled. */}
      <motion.div
        initial={false}
        animate={{ height: showHeader ? 'auto' : 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        style={{ overflow: 'visible' }}
        className="sticky top-3 z-40"
      >
      <header
        ref={navRef}
        style={{
          transform: showHeader ? 'translateY(0)' : 'translateY(-130%)',
          opacity: showHeader ? 1 : 0,
          pointerEvents: showHeader ? 'auto' : 'none',
          transition: 'transform 0.34s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease',
        }}
        className="relative max-w-[1720px] w-full mx-auto mt-4 px-3 md:px-4 py-2 bg-white/85 backdrop-blur-xl border border-stone-200/80 flex items-center gap-2 rounded-2xl shadow-[0_12px_40px_-12px_rgba(78,14,21,0.25)] dark:bg-[#140d0e]/90 dark:border-[#2a191b] dark:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.7)]">
        {/* Luxury Top Wine Edge Border */}
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-[#801323] via-[#4e0e15] to-[#c5a059]" />

        {/* Brand Crest — compact */}
        <button
          onClick={() => state.setActiveModule('portal')}
          className="shrink-0 w-9 h-9 bg-gradient-to-br from-[#4e0e15] to-[#210204] text-amber-100 rounded-xl flex items-center justify-center shadow-md font-serif font-black text-lg border border-[#801323] cursor-pointer"
          title="VinOS"
          aria-label="VinOS home"
        >
          🍇
        </button>
        <span className="hidden xl:block text-sm font-serif tracking-[0.22em] text-[#1b1715] font-black dark:text-amber-100 shrink-0">VinOS</span>

        {/* LEFT — module navigation */}
        {state.isLoggedIn && (
          <>
            {/* Desktop: inline module tabs, with dropdown submenus for grouped areas */}
            <nav aria-label={state.lang === 'ka' ? 'მოდულების ნავიგაცია' : 'Module navigation'} className="hidden md:flex items-center gap-0.5 min-w-0">
              {moduleGroups.filter(g => g.id !== 'settings').map(group => {
                const Icon = group.icon;
                const isActive = activeModuleGroup.id === group.id;
                const hasSub = group.modules.length > 1;
                const tabClass = `relative px-3 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors duration-200 font-extrabold text-[11px] tracking-wide uppercase ${isActive ? 'text-amber-50' : 'text-stone-600 hover:text-stone-900 hover:bg-[#FAF8F5]/90 dark:text-stone-300 dark:hover:bg-stone-800'}`;
                const pill = isActive ? (
                  <motion.span layoutId="module-nav-pill" className="absolute inset-0 bg-[#4e0e15] rounded-xl ring-1 ring-[#801323]/20 shadow-md" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />
                ) : null;
                if (!hasSub) {
                  return (
                    <button key={group.id} onClick={() => switchModule(group.primary)} title={group.label} aria-label={group.label} aria-current={isActive ? 'page' : undefined} className={tabClass}>
                      {pill}
                      <Icon className={`relative z-10 w-3.5 h-3.5 ${isActive ? 'text-amber-300' : 'text-[#4e0e15] dark:text-amber-300'}`} />
                      <span className="relative z-10 hidden lg:inline">{group.label}</span>
                    </button>
                  );
                }
                return (
                  <div key={group.id} className="relative">
                    <button
                      onClick={() => setOpenMenu(openMenu === group.id ? null : group.id)}
                      title={group.label}
                      aria-label={group.label}
                      aria-haspopup="menu"
                      aria-expanded={openMenu === group.id}
                      aria-current={isActive ? 'page' : undefined}
                      className={tabClass}
                    >
                      {pill}
                      <Icon className={`relative z-10 w-3.5 h-3.5 ${isActive ? 'text-amber-300' : 'text-[#4e0e15] dark:text-amber-300'}`} />
                      <span className="relative z-10 hidden lg:inline">{group.label}</span>
                      <ChevronDown className={`relative z-10 w-3 h-3 transition-transform ${openMenu === group.id ? 'rotate-180' : ''} ${isActive ? 'text-amber-200' : 'text-stone-400'}`} />
                    </button>
                    <AnimatePresence>
                      {openMenu === group.id && (
                        <motion.div
                          role="menu"
                          initial={{ opacity: 0, y: -6, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -6, scale: 0.97 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 top-full mt-2 z-50 min-w-[190px] p-1 bg-white border border-stone-200 rounded-xl shadow-xl dark:bg-[#1a1113] dark:border-stone-800"
                        >
                          {group.modules.map(mod => {
                            const ModIcon = mod.icon;
                            const modActive = state.activeModule === mod.id;
                            return (
                              <button
                                key={mod.id}
                                role="menuitem"
                                onClick={() => { switchModule(mod.id); setOpenMenu(null); }}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold tracking-wide cursor-pointer transition-colors ${modActive ? 'bg-[#4e0e15] text-amber-50' : 'text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800'}`}
                              >
                                <ModIcon className={`w-3.5 h-3.5 ${modActive ? 'text-amber-300' : 'text-[#4e0e15] dark:text-amber-300'}`} />
                                {mod.label}
                              </button>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </nav>

            {/* Mobile: single Menu button opening the full module list */}
            <div className="relative md:hidden">
              <button
                onClick={() => setOpenMenu(openMenu === 'mobile' ? null : 'mobile')}
                aria-label={state.lang === 'ka' ? 'მენიუ' : 'Menu'}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'mobile'}
                className="min-w-[40px] min-h-[40px] flex items-center justify-center bg-stone-50 border border-stone-200 text-[#4e0e15] rounded-xl cursor-pointer dark:bg-stone-900 dark:border-stone-800 dark:text-amber-300"
              >
                <Menu className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {openMenu === 'mobile' && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-full mt-2 z-50 w-64 max-h-[70vh] overflow-y-auto p-1.5 bg-white border border-stone-200 rounded-xl shadow-xl dark:bg-[#1a1113] dark:border-stone-800"
                  >
                    {moduleGroups.filter(g => g.id !== 'settings').map(group => {
                      const Icon = group.icon;
                      const hasSub = group.modules.length > 1;
                      if (!hasSub) {
                        const modActive = state.activeModule === group.primary;
                        return (
                          <button key={group.id} role="menuitem" onClick={() => { switchModule(group.primary); setOpenMenu(null); }} className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wide cursor-pointer transition-colors ${modActive ? 'bg-[#4e0e15] text-amber-50' : 'text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                            <Icon className={`w-4 h-4 ${modActive ? 'text-amber-300' : 'text-[#4e0e15] dark:text-amber-300'}`} />
                            {group.label}
                          </button>
                        );
                      }
                      return (
                        <div key={group.id} className="mt-1 first:mt-0">
                          <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                            <Icon className="w-3 h-3" />{group.label}
                          </div>
                          {group.modules.map(mod => {
                            const ModIcon = mod.icon;
                            const modActive = state.activeModule === mod.id;
                            return (
                              <button key={mod.id} role="menuitem" onClick={() => { switchModule(mod.id); setOpenMenu(null); }} className={`w-full flex items-center gap-2.5 pl-6 pr-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${modActive ? 'bg-[#4e0e15] text-amber-50' : 'text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800'}`}>
                                <ModIcon className={`w-3.5 h-3.5 ${modActive ? 'text-amber-300' : 'text-[#4e0e15] dark:text-amber-300'}`} />
                                {mod.label}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}

        {/* RIGHT — status, search, notifications, settings, logout */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <SyncStatus lang={state.lang} />

          {state.isLoggedIn && (
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="hidden xl:flex items-center gap-2 w-40 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left text-[11px] font-semibold text-stone-500 shadow-2xs transition-colors hover:border-[#4e0e15]/30 hover:bg-white hover:text-stone-800 dark:bg-stone-900 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-amber-100"
              title={state.lang === 'ka' ? 'ყველაფრის ძიება' : 'Search everything'}
            >
              <Search className="w-3.5 h-3.5 text-[#4e0e15] dark:text-amber-300" />
              <span className="flex-1 truncate">{state.lang === 'ka' ? 'ძიება…' : 'Search…'}</span>
              <kbd className="rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-stone-400 dark:bg-stone-950 dark:border-stone-700">⌘K</kbd>
            </button>
          )}

          <InstallButton lang={state.lang} />

          {state.isLoggedIn && <NotificationCenter alerts={alerts} onSelect={handleSelectAlert} lang={state.lang} />}

          {/* Settings menu — theme, language, settings/integration links, hide bar */}
          {state.isLoggedIn && (
            <div className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
                aria-label={state.lang === 'ka' ? 'პარამეტრები' : 'Settings menu'}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'settings'}
                className={`min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 md:p-2 flex items-center justify-center border rounded-xl cursor-pointer transition-colors ${openMenu === 'settings' ? 'bg-[#4e0e15] border-[#801323] text-amber-100' : 'bg-stone-50 border-stone-200 text-stone-600 hover:text-[#4e0e15] hover:bg-stone-100 dark:bg-stone-900 dark:border-stone-800 dark:text-stone-300'}`}
              >
                <Settings className="w-4 h-4" />
              </button>
              <AnimatePresence>
                {openMenu === 'settings' && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 z-50 w-60 p-1.5 bg-white border border-stone-200 rounded-xl shadow-xl dark:bg-[#1a1113] dark:border-stone-800"
                  >
                    {/* Theme */}
                    <button
                      role="menuitem"
                      onClick={() => setDarkMode(!darkMode)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800"
                    >
                      <span className="flex items-center gap-2.5">
                        {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#4e0e15]" />}
                        {darkMode ? (state.lang === 'ka' ? 'ნათელი თემა' : 'Light theme') : (state.lang === 'ka' ? 'მუქი თემა' : 'Dark theme')}
                      </span>
                    </button>

                    {/* Language */}
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 mb-1.5 text-[9px] font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                        <Languages className="w-3 h-3" />{state.lang === 'ka' ? 'ენა' : 'Language'}
                      </div>
                      <div className="flex gap-1">
                        {(['en', 'ka'] as const).map(code => (
                          <button
                            key={code}
                            role="menuitemradio"
                            aria-checked={state.lang === code}
                            onClick={() => { state.setLang(code); localStorage.setItem('vinea_lang', code); }}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide cursor-pointer transition-colors ${state.lang === code ? 'bg-[#4e0e15] text-amber-50' : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'}`}
                          >
                            {code === 'en' ? 'English' : 'ქართული'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="my-1 border-t border-stone-200/70 dark:border-stone-800" />

                    {canViewModule('settings') && (
                      <button role="menuitem" onClick={() => { switchModule('settings'); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800">
                        <ClipboardList className="w-4 h-4 text-[#4e0e15] dark:text-amber-300" />{t.nav_settings || 'Settings'}
                      </button>
                    )}
                    {canViewModule('integrations') && (
                      <button role="menuitem" onClick={() => { switchModule('integrations'); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800">
                        <PlugZap className="w-4 h-4 text-[#4e0e15] dark:text-amber-300" />{state.lang === 'ka' ? 'ინტეგრაციები' : 'Integration Hub'}
                      </button>
                    )}

                    <div className="my-1 border-t border-stone-200/70 dark:border-stone-800" />
                    <button role="menuitem" onClick={() => { setHeaderHidden(true); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800">
                      <ChevronUp className="w-4 h-4 text-stone-400" />{state.lang === 'ka' ? 'ზოლის დამალვა' : 'Hide menu bar'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {state.isLoggedIn && (
            <div className="flex items-center gap-2 pl-1.5 md:pl-2.5 md:border-l border-stone-200 dark:border-stone-800">
              <div className="text-right hidden lg:block">
                <span className="font-bold text-xs text-stone-850 block leading-tight dark:text-amber-100">{state.currentUser.fullName}</span>
                <span className="text-[8px] uppercase font-mono text-[#8a6425] dark:text-[#c5a059] font-extrabold block mt-0.5 tracking-wider">
                  {localizedRoleLabel(state.currentUser.role, state.lang)}
                </span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  state.handleAuthLogout();
                  state.setActiveModule('portal');
                }}
                className="bg-[#faf8f6] hover:bg-rose-50/50 border border-stone-200 text-[#801323] px-3 py-2 text-[10px] font-mono font-extrabold rounded-xl cursor-pointer transition-all duration-150 uppercase tracking-wider shadow-2xs dark:bg-stone-900 dark:border-stone-800 dark:text-rose-300"
                title={state.lang === 'ka' ? 'გამოსვლა' : 'Log Out'}
              >
                {t.nav_logout || 'Logout'}
              </motion.button>
            </div>
          )}
        </div>
      </header>
      {shouldShowReadOnlyNotice && (
        <div role="status" className="relative max-w-[1720px] w-full mx-auto mt-2 px-4 py-2 rounded-xl border border-amber-200 bg-amber-50 text-[10px] font-mono font-bold uppercase tracking-wide text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {state.lang === 'ka' ? 'ამ განყოფილებაში მხოლოდ ნახვა შეგიძლიათ' : 'View-only access in this area'}: {activePermissionModule.replace(/_/g, ' ')}
        </div>
      )}
      </motion.div>

      {/* 2. Main Shell Layout */}
      {authAccountFlow ? (
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-gradient-to-b from-[#f8f6f2] to-[#ece5dd] min-h-[82vh] dark:from-[#0d0b09] dark:to-[#1a1512]">
          <AuthAccountFlows
            lang={state.lang === 'ka' ? 'ka' : 'en'}
            flow={authAccountFlow}
            resetToken={initialAuthLinkContext.resetToken}
            username={initialAuthLinkContext.username}
            invitationToken={pendingInvitationToken}
            isAuthenticated={state.isLoggedIn}
            onReturnToSignIn={handleAuthFlowReturn}
            onAuthenticatedStateChange={handleAuthFlowStateChange}
          />
        </div>
      ) : !state.isLoggedIn ? (
        <div className="flex-1 flex items-stretch justify-center p-4 sm:p-8 bg-gradient-to-b from-[#f8f6f2] to-[#ece5dd] min-h-[82vh] dark:from-[#0d0b09] dark:to-[#1a1512]">
          <div className="w-full max-w-5xl my-auto grid lg:grid-cols-[1.1fr_1fr] rounded-3xl overflow-hidden shadow-[0_35px_90px_-30px_rgba(78,14,21,0.38)] border border-stone-200/70 bg-white animate-fade-in dark:border-stone-850 dark:bg-stone-950">

            {/* Brand hero — desktop only */}
            <div className="relative hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-[#5a1019] via-[#3a0a0f] to-[#1b0203] text-amber-100 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#801323] via-[#c5a059] to-[#801323]" />
              <div className="absolute -right-12 -bottom-16 text-[260px] leading-none opacity-[0.06] select-none pointer-events-none">🍇</div>

              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-2xl">🍇</div>
                  <div>
                    <div className="font-serif font-black tracking-[0.3em] text-lg">VinOS</div>
                    <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-amber-200/70">Unified Estate ERP</div>
                  </div>
                </div>

                <h2 className="mt-10 text-3xl font-serif font-black leading-[1.15]">Vineyard to bottle,<br />in one cellar book.</h2>
                <p className="mt-3 text-[13px] text-amber-100/70 font-serif italic leading-relaxed max-w-xs">
                  {t.signin_subtitle || 'Unified Vineyard (Vazi) & Winery (Gvino) management.'}
                </p>

                <ul className="mt-8 space-y-2.5 text-[12px] text-amber-50/90">
                  {['Block-to-bottle traceability', 'Lab panels & molecular SO₂ guardrails', 'Live fermentation & cellar alerts', 'AI winemaker assistant'].map(feat => (
                    <li key={feat} className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#c5a059] shrink-0" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="p-7 sm:p-10 flex flex-col justify-center bg-white text-stone-600 space-y-5 dark:bg-stone-900">
              {/* Compact brand for mobile */}
              <div className="lg:hidden flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#31070b] text-amber-100 flex items-center justify-center text-xl border border-[#4e0e15]">🍇</div>
                <div>
                  <div className="font-serif font-black tracking-[0.25em] text-[#1b1715] dark:text-amber-100">VinOS</div>
                  <div className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#c5a059]">Unified Estate ERP</div>
                </div>
              </div>
              
              {state.verificationPending && (
                <div className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900/60">
                  <div className="flex items-start gap-2.5">
                    <MailCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        {state.lang === 'ka' ? 'დაადასტურეთ ელფოსტა' : 'Verify your email'}
                      </h3>
                      <p className="text-[12px] text-amber-800/90 mt-0.5 dark:text-amber-200/80">
                        {state.lang === 'ka'
                          ? 'გამოგიგზავნეთ დადასტურების ბმული მისამართზე '
                          : 'We sent a confirmation link to '}
                        <strong className="break-all">{state.verificationPending.email}</strong>
                        {state.lang === 'ka' ? '. გახსენით ბმული ანგარიშის გასააქტიურებლად.' : '. Open it to activate your account.'}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 mt-2.5">
                        <button
                          type="button"
                          onClick={() => state.handleResendVerification(state.verificationPending!.email)}
                          className="text-[11px] font-bold uppercase tracking-wide text-amber-900 bg-amber-200/70 hover:bg-amber-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                        >
                          {state.lang === 'ka' ? 'ხელახლა გაგზავნა' : 'Resend link'}
                        </button>
                        <button
                          type="button"
                          onClick={() => state.setVerificationPending(null)}
                          className="text-[11px] font-semibold text-amber-800/70 hover:text-amber-900 cursor-pointer"
                        >
                          {state.lang === 'ka' ? 'დახურვა' : 'Dismiss'}
                        </button>
                      </div>
                      {state.verificationPending.devVerifyUrl && (
                        <a
                          href={state.verificationPending.devVerifyUrl}
                          className="block mt-2.5 text-[10px] font-mono text-amber-700 underline break-all"
                        >
                          {state.lang === 'ka' ? 'დეველოპერ ბმული: ' : 'Dev link: '}{state.verificationPending.devVerifyUrl}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isRegistering ? (
                <div>
                  <div>
                    <h2 className="text-xl font-serif font-black tracking-wide text-[#1b1715] dark:text-amber-100">
                      {state.lang === 'ka' ? 'რეგისტრაცია' : 'Create New Account'}
                    </h2>
                    <p className="text-[12px] text-stone-400 mt-1">
                      {state.lang === 'ka' ? 'შექმენით თქვენი პერსონალური პროფილი მარანში.' : 'Provision your personal cellar account.'}
                    </p>
                  </div>

                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const name = String(fd.get('fullName') || '');
                    const email = String(fd.get('email') || '');
                    const user = String(fd.get('username') || '');
                    const passcode = String(fd.get('passcode') || '');
                    const selectedRole = String(fd.get('role') || 'Viticulturist');
                    const rememberMe = fd.get('rememberMe') === 'true';
                    const enabledModules = fd.getAll('enabledModules').map(String);
                    const companyName = String(fd.get('companyName') || '').trim();
                    const wineryName = String(fd.get('wineryName') || '').trim();
                    const country = String(fd.get('country') || '').trim();
                    const region = String(fd.get('region') || '').trim();
                    const municipality = String(fd.get('municipality') || '').trim();
                    const address = String(fd.get('address') || '').trim();
                    const phone = String(fd.get('phone') || '').trim();
                    const website = String(fd.get('website') || '').trim();
                    if (enabledModules.length === 0) {
                      state.setLoginError('Select at least one workspace module.');
                      return;
                    }
                    
                    let mappedRole: 'Owner/Admin' | 'Viticulturist' | 'Winemaker' | 'Lab Technician' | 'Cellar Worker' | 'Read-Only' = 'Viticulturist';
                    if (selectedRole === 'Winemaker') {
                      mappedRole = 'Winemaker';
                    } else if (selectedRole === 'Cellar Assistant') {
                      mappedRole = 'Cellar Worker';
                    } else if (selectedRole === 'Estate Manager') {
                      mappedRole = 'Owner/Admin';
                    }

                    const cleanUsername = user.toLowerCase().replace(/\s+/g, '_');
                    const companySetup = {
                      companyName,
                      wineryName,
                      country,
                      region,
                      municipality,
                      address: regLocation?.label || address,
                      contactEmail: email,
                      phone,
                      website,
                      measurementUnits: 'metric' as const,
                      currency: 'GEL',
                      ...(regLocation ? {
                        latitude: regLocation.latitude,
                        longitude: regLocation.longitude,
                      } : {}),
                    };
                    await state.handleAuthRegister({
                      username: cleanUsername,
                      email: email,
                      fullName: name,
                      role: mappedRole,
                      language: state.lang === 'ka' ? 'ka' : 'en',
                      rememberMe: rememberMe,
                      passcode: passcode,
                      companyProfile: companySetup,
                      enabledModules,
                      enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks']
                    });

                    state.setCompanyProfile({
                      ...state.companyProfile,
                      ...companySetup,
                    });
                    if (enabledModules.includes('gvino') && (mappedRole === 'Winemaker' || mappedRole === 'Cellar Worker' || !enabledModules.includes('vazi'))) {
                      state.setActiveModule('gvino');
                    } else if (enabledModules.includes('vazi')) {
                      state.setActiveModule('vazi');
                    } else {
                      state.setActiveModule('portal');
                    }
                  }} className="space-y-4 mt-4">
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'სრული სახელი' : 'Full Name'}
                      </label>
                      <input
                        type="text"
                        name="fullName"
                        placeholder={state.lang === 'ka' ? 'ლუკა თათრიშვილი' : 'Luka Tatrishvili'}
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'ელ-ფოსტის მისამართი' : 'Email Address'}
                      </label>
                      <input
                        type="email"
                        name="email"
                        placeholder={state.lang === 'ka' ? 'luka.t@vinea.ge' : 'luka.t@vinea.com'}
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'მამულის სახელი *' : 'Company / Estate Name *'}
                      </label>
                      <input
                        type="text"
                        name="companyName"
                        placeholder="Kvareli Estate"
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'მომხმარებლის სახელი' : 'Desired Username'}
                      </label>
                      <input
                        type="text"
                        name="username"
                        placeholder={state.lang === 'ka' ? 'luka_mevenakhe' : 'luka_viticulture'}
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'პაროლი (შესვლის კოდი)' : 'Passcode / Password'}
                      </label>
                      <input
                        type="password"
                        name="passcode"
                        placeholder="••••••••"
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors font-sans"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'თანამდებობა / როლი' : 'Role / Position'}
                      </label>
                      <select
                        name="role"
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                      >
                        <option value="Viticulturist">{state.lang === 'ka' ? 'მევენახე' : 'Viticulturist'}</option>
                        <option value="Winemaker">{state.lang === 'ka' ? 'მეღვინე' : 'Winemaker'}</option>
                        <option value="Cellar Assistant">{state.lang === 'ka' ? 'მარნის დამხმარე' : 'Cellar Assistant'}</option>
                        <option value="Estate Manager">{state.lang === 'ka' ? 'მამულის მმართველი' : 'Estate Manager'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-2 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'საჭირო მოდულები *' : 'Workspace Modules *'}
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="flex items-center gap-2 p-3 rounded-xl bg-stone-50/80 border border-stone-200 cursor-pointer">
                          <input
                            type="checkbox"
                            name="enabledModules"
                            value="vazi"
                            defaultChecked
                            className="w-4 h-4 rounded border-stone-300 accent-emerald-700 cursor-pointer"
                          />
                          <span className="text-xs font-bold text-stone-800">
                            {state.lang === 'ka' ? 'ვენახი / Vazi' : 'Vineyard / Vazi'}
                          </span>
                        </label>
                        <label className="flex items-center gap-2 p-3 rounded-xl bg-stone-50/80 border border-stone-200 cursor-pointer">
                          <input
                            type="checkbox"
                            name="enabledModules"
                            value="gvino"
                            defaultChecked
                            className="w-4 h-4 rounded border-stone-300 accent-[#4e0e15] cursor-pointer"
                          />
                          <span className="text-xs font-bold text-stone-800">
                            {state.lang === 'ka' ? 'მარანი / Gvino' : 'Cellar / Gvino'}
                          </span>
                        </label>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                          {state.lang === 'ka' ? 'მარნის სახელი' : 'Winery / Brand Name'}
                        </label>
                        <input
                          type="text"
                          name="wineryName"
                          placeholder="Marani"
                          className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                          {state.lang === 'ka' ? 'ტელეფონი' : 'Phone'}
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          placeholder="+995"
                          className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                          {state.lang === 'ka' ? 'ქვეყანა' : 'Country'}
                        </label>
                        <input
                          type="text"
                          name="country"
                          placeholder="Georgia"
                          className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                          {state.lang === 'ka' ? 'რეგიონი' : 'Region'}
                        </label>
                        <input
                          type="text"
                          name="region"
                          placeholder="Kakheti"
                          className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                          {state.lang === 'ka' ? 'მუნიციპალიტეტი' : 'Municipality'}
                        </label>
                        <input
                          type="text"
                          name="municipality"
                          placeholder="Kvareli"
                          className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                          {state.lang === 'ka' ? 'ვებგვერდი' : 'Website'}
                        </label>
                        <input
                          type="url"
                          name="website"
                          placeholder="https://"
                          className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'მამულის / ვენახის მდებარეობა' : 'Estate / Vineyard Location (Optional)'}
                      </label>
                      <Suspense fallback={<div className="h-10 rounded-xl bg-stone-100 animate-pulse" />}>
                      <LocationPicker
                        latitude={regLocation?.latitude ?? state.companyProfile.latitude ?? 41.9056}
                        longitude={regLocation?.longitude ?? state.companyProfile.longitude ?? 45.474}
                        showManual={false}
                        placeholder={state.lang === 'ka' ? 'მოძებნეთ ადგილი… მაგ. თელავი' : 'Search your estate… e.g. Telavi, Kakheti'}
                        onChange={(loc) => setRegLocation(loc)}
                      />
                      </Suspense>
                      {regLocation?.label && (
                        <p className="text-[10px] text-emerald-700 font-bold mt-1.5 flex items-center gap-1">
                          ✓ {regLocation.label} ({regLocation.latitude.toFixed(3)}, {regLocation.longitude.toFixed(3)})
                        </p>
                      )}
                      <p className="text-[9px] text-stone-400 mt-1 leading-relaxed">
                        {state.lang === 'ka'
                          ? 'გამოიყენება ამინდის, რუკებისა და დაავადების რისკის მოდელებისთვის.'
                          : 'Powers the weather station, satellite views and disease-risk models for your estate.'}
                      </p>
                    </div>

                    <div className="flex items-center">
                      <label className="flex items-center gap-2 text-[10px] text-stone-600 dark:text-stone-400 font-bold font-sans select-none cursor-pointer">
                        <input
                          type="checkbox"
                          name="rememberMe"
                          defaultChecked
                          value="true"
                          className="w-3.5 h-3.5 rounded border-stone-300 text-[#4e0e15] focus:ring-[#4e0e15] accent-[#4e0e15] cursor-pointer"
                        />
                        <span>{state.lang === 'ka' ? 'დამიმახსოვრე შესული' : 'Keep me signed in'}</span>
                      </label>
                    </div>

                    {state.loginError && (
                      <p className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-1.5 mt-2">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {state.loginError}
                      </p>
                    )}

                    <button
                      type="submit"
                      className="w-full bg-[#4e0e15] hover:bg-[#34070a] text-white font-mono font-bold uppercase tracking-widest py-3 rounded-xl cursor-pointer shadow-sm transition-all duration-155 text-xs mt-2"
                    >
                      {state.lang === 'ka' ? 'ანგარიშის შექმნა' : 'Create Account'}
                    </button>

                    <p className="text-center text-[10px] font-sans text-stone-405 mt-2">
                      {state.lang === 'ka' ? 'უკვე გაქვთ ანგარიში?' : 'Already have an account?'} {' '}
                      <button
                        type="button"
                        onClick={() => {
                          setIsRegistering(false);
                          state.setLoginError(null);
                        }}
                        className="text-[#4e0e15] dark:text-[#c5a059] font-bold hover:underline cursor-pointer bg-transparent border-none p-0 inline"
                      >
                        {state.lang === 'ka' ? 'შესვლა' : 'Sign In'}
                      </button>
                    </p>
                  </form>
                </div>
              ) : (
                <>
                  <div>
                    <h2 className="text-xl font-serif font-black tracking-wide text-[#1b1715] dark:text-amber-100">{t.signin_title || 'VINEA Unified Sign In'}</h2>
                    <p className="text-[12px] text-stone-400 mt-1">{state.lang === 'ka' ? 'შედით თქვენს მართვის სივრცეში.' : 'Sign in to your estate workspace.'}</p>
                  </div>

                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (authSubmitting) return;
                    const fd = new FormData(e.currentTarget);
                    const rememberMe = fd.get('rememberMe') === 'true';
                    setAuthSubmitting(true);
                    try {
                      const success = await state.handleAuthLogin(
                        String(fd.get('identifier') || ''),
                        String(fd.get('passcode') || ''),
                        rememberMe
                      );
                      if (success) {
                        if (pendingInvitationToken) {
                          setAuthAccountFlow('accept-invite');
                        } else {
                          state.setActiveModule('portal');
                        }
                      }
                    } finally {
                      setAuthSubmitting(false);
                    }
                  }} className="space-y-4" aria-busy={authSubmitting}>
                    {pendingInvitationToken && (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200" role="status">
                        {state.lang === 'ka'
                          ? 'შედით იმ ელფოსტით, რომელზეც სამუშაო სივრცის მოსაწვევი მიიღეთ.'
                          : 'Sign in with the email address that received the workspace invitation.'}
                      </p>
                    )}
                    <div>
                      <label htmlFor="auth-login-identifier" className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">{t.signin_username || 'Account Username / Email'}</label>
                      <input
                        id="auth-login-identifier"
                        type="text"
                        name="identifier"
                        placeholder={state.lang === 'ka' ? 'მომხმარებელი ან ელ-ფოსტა' : 'username or email'}
                        autoComplete="username"
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <label htmlFor="auth-login-passcode" className="text-[9px] uppercase font-mono font-bold text-slate-400 font-extrabold tracking-widest">{t.signin_passcode || 'Passcode'}</label>
                        <button
                          type="button"
                          onClick={() => {
                            state.setLoginError(null);
                            setAuthAccountFlow('forgot-password');
                          }}
                          className="min-h-9 rounded-lg px-2 text-xs font-bold text-[#4e0e15] hover:bg-stone-100 hover:underline dark:text-amber-300 dark:hover:bg-stone-800"
                        >
                          {state.lang === 'ka' ? 'დაგავიწყდათ კოდი?' : 'Forgot passcode?'}
                        </button>
                      </div>
                      <input
                        id="auth-login-passcode"
                        type="password"
                        name="passcode"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none font-bold focus:border-stone-400 transition-colors text-stone-900"
                        required
                      />
                    </div>

                    <div className="flex items-center">
                      <label className="flex items-center gap-2 text-[10px] text-stone-600 dark:text-stone-400 font-bold font-sans select-none cursor-pointer">
                        <input
                          type="checkbox"
                          name="rememberMe"
                          defaultChecked
                          value="true"
                          className="w-3.5 h-3.5 rounded border-stone-300 text-[#4e0e15] focus:ring-[#4e0e15] accent-[#4e0e15] cursor-pointer"
                        />
                        <span>{state.lang === 'ka' ? 'დამიმახსოვრე შესული' : 'Keep me signed in'}</span>
                      </label>
                    </div>

                    {state.loginError && (
                      <p className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-1.5" role="alert">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {state.loginError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={authSubmitting}
                      className="w-full bg-[#4e0e15] hover:bg-[#34070a] text-white font-mono font-bold uppercase tracking-widest py-3 rounded-xl cursor-pointer shadow-sm transition-all duration-155 text-xs mt-2"
                    >
                      {authSubmitting && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />}
                      {authSubmitting
                        ? (state.lang === 'ka' ? 'შესვლა მიმდინარეობს…' : 'Signing in…')
                        : (t.signin_btn || 'Secure Portal Login')}
                    </button>

                    {state.demoLoginEnabled && (
                      <button
                        type="button"
                        onClick={async () => {
                          const success = await state.handleDemoLogin();
                          if (success) state.setActiveModule('portal');
                        }}
                        className="w-full border border-[#c5a059]/60 bg-amber-50/60 hover:bg-amber-50 text-[#4e0e15] px-4 py-3 rounded-xl cursor-pointer transition-colors text-left"
                      >
                        <span className="block text-xs font-black uppercase tracking-wide">
                          {state.lang === 'ka' ? 'დემო სივრცის გახსნა' : 'Open Demo Workspace'}
                        </span>
                        <span className="block text-[10px] text-stone-500 mt-0.5 font-medium">
                          {state.lang === 'ka'
                            ? 'იგივე რეალური მონაცემთა ბაზა, სინქრონიზაცია და სერვისები — სატესტო ჩანაწერების გარეშე.'
                            : 'Uses the real database, sync, and services — no sample operational records.'}
                        </span>
                      </button>
                    )}

                    <div className="relative flex py-1.5 items-center">
                      <div className="flex-grow border-t border-stone-200/60 dark:border-stone-800"></div>
                      <span className="flex-shrink mx-3 text-[10px] text-stone-400 dark:text-stone-500 font-mono uppercase tracking-wider">{state.lang === 'ka' ? 'ან' : 'or'}</span>
                      <div className="flex-grow border-t border-stone-200/60 dark:border-stone-800"></div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = '/api/auth/google/login';
                      }}
                      className="w-full bg-white hover:bg-stone-50 text-stone-700 border border-stone-350/80 font-sans font-bold py-2.5 px-4 rounded-xl cursor-pointer shadow-xs transition-all duration-155 text-xs flex items-center justify-center gap-2.5 dark:bg-stone-800 dark:hover:bg-stone-750 dark:border-stone-700 dark:text-amber-100"
                    >
                      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22c-.87-2.6-2.86-4.53-5.29-4.53z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                        />
                      </svg>
                      {state.lang === 'ka' ? 'Google-ით გაგრძელება' : 'Continue with Google'}
                    </button>
                    <a
                      href="/api/auth/google/login?reconfigure=true"
                      className="text-[10px] text-stone-400 hover:text-stone-600 dark:text-stone-550 dark:hover:text-stone-400 font-sans mt-2 block text-center transition-colors hover:underline"
                    >
                      {state.lang === 'ka' ? '⚙️ Google-ის პარამეტრების მართვა' : '⚙️ Manage Google OAuth Credentials'}
                    </a>

                    <p className="text-center text-[10px] font-sans text-stone-450 mt-3">
                      {state.lang === 'ka' ? 'არ გაქვთ ანგარიში?' : "Don't have an account?"} {' '}
                      <button
                        type="button"
                        onClick={() => {
                          setIsRegistering(true);
                          state.setLoginError(null);
                        }}
                        className="text-[#4e0e15] dark:text-[#c5a059] font-bold hover:underline cursor-pointer bg-transparent border-none p-0 inline"
                      >
                        {state.lang === 'ka' ? 'დარეგისტრირდით' : 'Register Now'}
                      </button>
                    </p>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      ) : state.activeModule === 'vazi' ? (
        <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col">
          <Suspense fallback={<ModuleLoader />}>
            <VaziModule
              lang={state.lang}
              currentUser={state.currentUser}
              blocks={state.blocks}
              phenologyLogs={state.phenologyLogs}
              sprays={state.sprays}
              scoutings={state.scoutings}
              soilRecords={state.soilRecords}
              vineyardProjects={state.vineyardProjects}
              samplings={state.samplings}
              harvests={state.harvests}
              irrigationLogs={state.irrigationLogs}
              fertilizerLogs={state.fertilizerLogs}
              onAddBlock={state.handleAddBlock}
              onUpdateBlock={state.handleUpdateBlock}
              onAddVineyardProject={state.handleAddVineyardProject}
              onUpdateVineyardProject={state.handleUpdateVineyardProject}
              onAddPhenologyLog={state.handleAddPhenologyLog}
              onAddSprayRecord={state.handleAddSprayRecord}
              onAddScoutingRecord={state.handleAddScoutingRecord}
              onAddSamplings={state.handleAddSamplings}
              onAddHarvestRecord={state.handleAddHarvestRecord}
              onUpdateHarvestRecord={state.handleUpdateHarvestRecord}
              onSendHarvestToGvino={state.handleSendHarvestToGvino}
              onAddIrrigation={state.handleAddIrrigation}
              onAddFertilizer={state.handleAddFertilizer}
              setActiveModule={state.setActiveModule}
              setActiveTab={state.setActiveTab}
              onNavigate={handleNavigate}
              setPrefilledTaskTitle={state.setPrefilledTaskTitle}
              setPrefilledTaskPriority={state.setPrefilledTaskPriority}
              setPrefilledTaskDesc={state.setPrefilledTaskDesc}
            />
          </Suspense>
        </main>
      ) : state.activeModule === 'portal' ? (
        <Suspense fallback={<ModuleLoader />}>
          <DashboardTab
            lang={state.lang}
            companyProfile={state.companyProfile}
            currentUser={state.currentUser}
            blocks={state.blocks}
            lots={state.lots}
            vessels={state.vessels}
            tasks={state.tasks}
            fermLogs={state.fermLogs}
            labLogs={state.labLogs}
            inventory={state.inventory}
            scoutings={state.scoutings}
            auditLogs={state.auditLogs}
            grapeIntakes={state.grapeIntakes}
            cellarOps={state.cellarOps}
            onToggleTaskStatus={state.handleToggleTaskStatus}
            setActiveModule={state.setActiveModule}
            setActiveTab={state.setActiveTab}
            onOpenOnboarding={() => setShowOnboarding(true)}
          />
        </Suspense>
      ) : state.activeModule === 'integrations' ? (
        <Suspense fallback={<ModuleLoader />}>
          <IntegrationHubTab
            lang={state.lang}
            setToastMessage={state.setToastMessage}
          />
        </Suspense>
      ) : state.activeModule === 'settings' ? (
        <Suspense fallback={<ModuleLoader />}>
          <ProfileSettingsTab 
            lang={state.lang}
            currentUser={state.currentUser}
            setCurrentUser={state.setCurrentUser}
            companyProfile={state.companyProfile}
            setCompanyProfile={state.setCompanyProfile}
            setToastMessage={state.setToastMessage}
            onClearAllData={state.clearAllData}
            onUpdateProfile={state.handleUpdateProfile}
            crmLeads={state.crmLeads}
            onSaveCrmLead={state.handleSaveCrmLead}
            onUpdateCrmLeadStatus={state.handleUpdateCrmLeadStatus}
            onDeleteCrmLead={state.handleDeleteCrmLead}
            canManageProfile={canAccess(state.currentUser.role, 'company_profile', 'update')}
            canManageCrm={canAccess(state.currentUser.role, 'sales', 'create') || canAccess(state.currentUser.role, 'sales', 'update')}
            organizations={state.organizations}
            onSwitchOrganization={state.handleSwitchOrganization}
            manualLowPower={perf.manualLowPower}
            onToggleLowPower={perf.toggleManualLowPower}
          />
        </Suspense>
      ) : state.activeModule === 'audit' ? (
        <Suspense fallback={<ModuleLoader />}>
          <AuditTrailTab
            lang={state.lang}
            auditLogs={state.auditLogs}
          />
        </Suspense>
      ) : state.activeModule === 'certification' ? (
        <Suspense fallback={<ModuleLoader />}>
          <CertificationManagerTab
            lang={state.lang}
            lots={state.lots}
            blocks={state.blocks}
            grapeIntakes={state.grapeIntakes}
            labLogs={state.labLogs}
            bottlingRuns={state.bottlingRuns}
            certificationRecords={state.certificationRecords}
            attachments={state.attachments}
            onUpdateCertificationRecords={state.setCertificationRecords}
            onUpdateLots={state.setLots}
            onAddAttachment={state.handleAddAttachment}
            onDeleteAttachment={state.handleDeleteAttachment}
            canManageCertification={canAccess(state.currentUser.role, 'certification', 'update') || canAccess(state.currentUser.role, 'certification', 'create')}
            setActiveModule={state.setActiveModule}
            setToastMessage={state.setToastMessage}
          />
        </Suspense>
      ) : state.activeModule === 'costs' ? (
        <Suspense fallback={<ModuleLoader />}>
          <CostsTab
            lang={state.lang}
            lots={state.lots}
            inventory={state.inventory}
            company={state.companyProfile}
            bottlingRuns={state.bottlingRuns}
            costEntries={state.costEntries}
            onUpdateCostEntries={state.setCostEntries}
            pricing={state.winePricing}
            onUpdatePricing={state.setWinePricing}
            onNavigate={handleNavigate}
            canCreateCost={canAccess(state.currentUser.role, 'costs', 'create')}
            canDeleteCost={canAccess(state.currentUser.role, 'costs', 'delete')}
            canUpdatePricing={canAccess(state.currentUser.role, 'sales', 'update')}
            canExportCosts={canAccess(state.currentUser.role, 'costs', 'export') && canAccess(state.currentUser.role, 'sales', 'export')}
          />
        </Suspense>
      ) : state.activeModule === 'storage' ? (
        <Suspense fallback={<ModuleLoader />}>
          <StorageTab
            lang={state.lang}
            lots={state.lots}
            bottlingRuns={state.bottlingRuns}
            locations={state.storageLocations}
            movements={state.stockMovements}
            orders={state.salesOrders}
            onUpdateLocations={state.setStorageLocations}
            onUpdateMovements={state.setStockMovements}
            setToastMessage={state.setToastMessage}
            onNavigate={handleNavigate}
            canCreateLocation={canAccess(state.currentUser.role, 'storage', 'create')}
            canDeleteLocation={canAccess(state.currentUser.role, 'storage', 'delete')}
            canCreateMovement={canAccess(state.currentUser.role, 'storage', 'create')}
            canDeleteMovement={canAccess(state.currentUser.role, 'storage', 'delete')}
          />
        </Suspense>
      ) : state.activeModule === 'sales' ? (
        <Suspense fallback={<ModuleLoader />}>
          <SalesDispatchTab
            lang={state.lang}
            lots={state.lots}
            bottlingRuns={state.bottlingRuns}
            costEntries={state.costEntries}
            pricing={state.winePricing}
            locations={state.storageLocations}
            movements={state.stockMovements}
            dispatches={state.salesDispatches}
            orders={state.salesOrders}
            onUpdateMovements={state.setStockMovements}
            onUpdateDispatches={state.setSalesDispatches}
            onUpdateOrders={state.setSalesOrders}
            currency={state.companyProfile.currency || 'GEL'}
            currentUserName={state.currentUser.fullName}
            setToastMessage={state.setToastMessage}
            onNavigate={handleNavigate}
          />
        </Suspense>
      ) : state.activeModule === 'analytics' ? (
        <Suspense fallback={<ModuleLoader />}>
          <YearComparisonTab
            lang={state.lang}
            lots={state.lots}
            harvests={state.harvests}
            grapeIntakes={state.grapeIntakes}
            bottlingRuns={state.bottlingRuns}
            costEntries={state.costEntries}
            stockMovements={state.stockMovements}
            dispatches={state.salesDispatches}
            orders={state.salesOrders}
            currency={state.companyProfile.currency || 'GEL'}
            onNavigate={handleNavigate}
          />
        </Suspense>
      ) : state.activeModule === 'docs' ? (
        <Suspense fallback={<ModuleLoader />}>
          <OfficialDocsTab
            lang={state.lang}
            company={state.companyProfile}
            currentUser={state.currentUser}
            blocks={state.blocks}
            lots={state.lots}
            vessels={state.vessels}
            harvests={state.harvests}
            samplings={state.samplings}
            inventory={state.inventory}
            labLogs={state.labLogs}
            grapeIntakes={state.grapeIntakes}
            cellarOps={state.cellarOps}
            bottlingRuns={state.bottlingRuns}
            salesDispatches={state.salesDispatches}
            attachments={state.attachments}
            onAddAttachment={state.handleAddAttachment}
            onDeleteAttachment={state.handleDeleteAttachment}
            canManageOfficialDocs={canAccess(state.currentUser.role, 'official_docs', 'create') || canAccess(state.currentUser.role, 'official_docs', 'update')}
          />
        </Suspense>
      ) : (
        <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-6 flex flex-col lg:flex-row gap-8">
          
          {/* Sticky sidebar */}
          <aside className={`shrink-0 w-full ${state.isSidebarCollapsed ? 'lg:w-20' : 'lg:w-72'} lg:self-start lg:sticky lg:top-24 transition-[width] duration-300`}>
            <div className="lg:hidden rounded-2xl border border-[#e8dfd5] bg-white/90 p-3 shadow-xs dark:bg-stone-900 dark:border-stone-800">
              <label htmlFor="mobile-winery-section" className="mb-1.5 block text-[10px] font-mono font-bold uppercase tracking-wider text-stone-500">
                {state.lang === 'ka' ? 'მარნის განყოფილება' : 'Winery section'}
              </label>
              <select
                id="mobile-winery-section"
                value={state.activeTab}
                onChange={(event) => state.setActiveTab(event.target.value)}
                className="w-full border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-bold text-stone-800 dark:bg-stone-950 dark:border-stone-700 dark:text-stone-100"
              >
                {accessibleWineryTabGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.tabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>{tab.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {!state.isSidebarCollapsed && (
              <div className="hidden lg:block mb-4 rounded-2xl border border-[#e8dfd5] bg-white/90 p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900/90">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="block text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-400">
                      {state.lang === 'ka' ? 'დღის ფოკუსი' : 'Today focus'}
                    </span>
                    <strong className="mt-1 block text-sm font-black text-stone-900 dark:text-amber-100">
                      {state.lang === 'ka' ? `${activeModuleGroup.label} — სივრცე` : `${activeModuleGroup.label} workspace`}
                    </strong>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                    urgentAlertCount > 0
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                  }`}>
                    {urgentAlertCount > 0 ? `${urgentAlertCount} ${state.lang === 'ka' ? 'გადაუდებელი' : 'urgent'}` : (state.lang === 'ka' ? 'სტაბილური' : 'steady')}
                  </span>
                </div>
                {(canViewModule('gvino', 'tasks') || canViewModule('gvino', 'fermentation')) && (
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[10px]">
                    {canViewModule('gvino', 'tasks') && (
                      <button type="button" onClick={() => state.setActiveTab('tasks')} className="rounded-xl bg-stone-50 p-2 text-left font-bold text-stone-600 hover:bg-[#f5efe9] hover:text-[#4e0e15] dark:bg-stone-950/40 dark:text-stone-300">
                        <span className="block text-stone-400">{t.tasks || 'Tasks'}</span>
                        <strong className="text-lg text-stone-900 dark:text-amber-100">{pendingTaskCount}</strong>
                      </button>
                    )}
                    {canViewModule('gvino', 'fermentation') && (
                      <button type="button" onClick={() => state.setActiveTab('fermentation')} className="rounded-xl bg-stone-50 p-2 text-left font-bold text-stone-600 hover:bg-[#f5efe9] hover:text-[#4e0e15] dark:bg-stone-950/40 dark:text-stone-300">
                        <span className="block text-stone-400">{state.lang === 'ka' ? 'დუღილი' : 'Ferments'}</span>
                        <strong className="text-lg text-stone-900 dark:text-amber-100">{activeFermsCount}</strong>
                      </button>
                    )}
                  </div>
                )}
                {canViewModule('gvino', 'vessels') && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[9px] font-mono font-bold uppercase tracking-wide text-stone-400">
                    <span>{state.lang === 'ka' ? 'ტევადობა' : 'Capacity'}</span>
                    <span>{cellarCapacityPct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                    <div
                      className={`h-full rounded-full ${cellarCapacityPct > 85 ? 'bg-amber-500' : 'bg-[#4e0e15]'}`}
                      style={{ width: `${Math.min(100, cellarCapacityPct)}%` }}
                    />
                  </div>
                  <span className="mt-2 block text-[10px] font-semibold text-stone-400">
                    {state.lang === 'ka'
                      ? `${occupiedTanksCount} დაკავებული ჭურჭელი · საშ. ${averageOccupiedTemp} °C`
                      : `${occupiedTanksCount} occupied vessels · avg ${averageOccupiedTemp} °C`}
                  </span>
                </div>
                )}
              </div>
            )}

            <div className="hidden lg:flex items-center justify-between px-1 pb-2 mb-1 border-b border-[#e8dfd5]/70 dark:border-stone-800">
              {!state.isSidebarCollapsed && <span className="text-[10px] font-mono text-stone-400 uppercase tracking-[0.15em] font-bold">{state.lang === 'ka' ? 'მარნის მენიუ' : 'Winery Menu'}</span>}
              <button
                onClick={() => state.setIsSidebarCollapsed(!state.isSidebarCollapsed)}
                className="ml-auto p-1.5 text-stone-400 hover:text-[#4e0e15] hover:bg-stone-100 rounded-md transition-colors cursor-pointer"
                title={state.isSidebarCollapsed ? (state.lang === 'ka' ? 'მენიუს გაშლა' : 'Expand menu') : (state.lang === 'ka' ? 'მენიუს ჩაკეცვა' : 'Collapse menu')}
              >
                {state.isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            </div>

            <div className="hidden lg:flex lg:flex-col gap-3 lg:overflow-visible">
              {accessibleWineryTabGroups.map(group => (
                <div key={group.label} className="space-y-1">
                  {!state.isSidebarCollapsed && (
                    <div className="px-3 pt-1 pb-0.5 text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-400">
                      {group.label}
                    </div>
                  )}
                  <div className="space-y-1">
                    {group.tabs.map(tab => {
                      const Icon = tab.icon;
                      const isActive = state.activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => state.setActiveTab(tab.id)}
                          title={tab.label}
                          aria-current={isActive ? 'page' : undefined}
                          className={`group shrink-0 lg:w-full flex items-center gap-2.5 px-3.5 py-2 lg:py-2.5 rounded-xl text-xs font-semibold tracking-wide whitespace-nowrap cursor-pointer transition-colors ${
                            state.isSidebarCollapsed ? 'lg:justify-center' : ''
                          } ${
                            isActive
                              ? 'bg-[#4e0e15] text-[#fbf9f6] shadow-sm'
                              : 'text-stone-600 hover:text-[#4e0e15] hover:bg-[#f5efe9] dark:text-stone-300 dark:hover:text-amber-100 dark:hover:bg-stone-900'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-400' : 'text-[#4e0e15]/70 group-hover:text-[#4e0e15] dark:text-amber-500/70 dark:group-hover:text-amber-300'}`} />
                          <span className={state.isSidebarCollapsed ? 'lg:hidden' : ''}>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Content Tabs Area */}
          <section className="flex-1 min-w-0 space-y-4">
            {!canViewModule('gvino', state.activeTab) ? (
              <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                {state.lang === 'ka'
                  ? 'თქვენს როლს ამ განყოფილებაზე წვდომა არ აქვს. ხელმისაწვდომ განყოფილებაზე გადაგიყვანთ.'
                  : 'Your workspace role cannot open this area. Redirecting to an available section.'}
              </div>
            ) : (
            <Suspense fallback={<ModuleLoader />}>
            
            {/* A. DASHBOARD TAB */}
            {state.activeTab === 'dashboard' && (
              <WineryDashboardTab
                lang={state.lang}
                lots={state.lots}
                vessels={state.vessels}
                fermLogs={state.fermLogs}
                labLogs={state.labLogs}
                tasks={state.tasks}
                chartLotId={state.chartLotId}
                setChartLotId={state.setChartLotId}
                selectedTankId={state.selectedTankId}
                setSelectedTankId={state.setSelectedTankId}
                onToggleTaskStatus={state.handleToggleTaskStatus}
                role={state.currentUser.role}
                canUpdateTasks={canAccess(state.currentUser.role, 'tasks', 'update')}
                setActiveTab={state.setActiveTab}
                setCalculatorLotId={state.setCalculatorLotId}
                setPrefilledTaskTitle={state.setPrefilledTaskTitle}
                setPrefilledTaskPriority={state.setPrefilledTaskPriority}
                setPrefilledTaskDesc={state.setPrefilledTaskDesc}
              />
            )}

            {/* B. VESSELS TAB */}
            {state.activeTab === 'vessels' && (
              <div className="space-y-4 text-stone-800 animate-fade-in">
                <TanksVessels 
                  lang={state.lang} 
                  vessels={state.vessels} 
                  lots={state.lots} 
                  onUpdateVessels={state.setVessels} 
                  {...cellarPermissions.vessels}
                  canExecuteTransfer={cellarPermissions.transfers.canExecuteTransfer}
                  onSelectTank={state.setSelectedTankId} 
                  selectedTankId={state.selectedTankId} 
                  setActiveTab={state.setActiveTab}
                  setPrefilledSourceId={state.setPrefilledSourceId}
                  setPrefilledDestId={state.setPrefilledDestId}
                />
              </div>
            )}

            {/* B1. QVEVRI PASSPORT */}
            {state.activeTab === 'qvevri' && (
              <QvevriPassportTab
                lang={state.lang}
                vessels={state.vessels}
                lots={state.lots}
                fermentationLogs={state.fermLogs}
                cellarOps={state.cellarOps}
                certificationRecords={state.certificationRecords}
                onUpdateVessels={state.setVessels}
                canUpdateVessel={cellarPermissions.vessels.canUpdateVessel}
                setActiveTab={state.setActiveTab}
                setSelectedTankId={state.setSelectedTankId}
                setToastMessage={state.setToastMessage}
                currentUserName={state.currentUser.fullName}
              />
            )}

            {/* B2. GRAPE RECEIVING / INTAKE */}
            {state.activeTab === 'intake' && (
              <GrapeReceivingTab
                lang={state.lang}
                vessels={state.vessels}
                blocks={state.blocks}
                harvests={state.harvests}
                intakes={state.grapeIntakes}
                currentUserName={state.currentUser.fullName}
                currency={state.companyProfile.currency || 'GEL'}
                onReceiveGrapes={state.handleReceiveGrapes}
                {...cellarPermissions.intake}
                setActiveTab={state.setActiveTab}
                setToastMessage={state.setToastMessage}
              />
            )}

            {/* C. WINE LOTS TAB */}
            {state.activeTab === 'lots' && (
              <WineLotsTrace 
                lang={state.lang} 
                lots={state.lots} 
                onUpdateLots={state.setLots} 
                canCreateLot={canAccess(state.currentUser.role, 'lots', 'create')}
                canUpdateLot={canAccess(state.currentUser.role, 'lots', 'update')}
                onOpenPassport={state.setPassportLotId} 
                vessels={state.vessels}
                labLogs={state.labLogs}
                costEntries={state.costEntries}
                bottlingRuns={state.bottlingRuns}
                stockMovements={state.stockMovements}
                salesOrders={state.salesOrders}
                salesDispatches={state.salesDispatches}
                currency={state.companyProfile.currency || 'GEL'}
                setActiveTab={state.setActiveTab}
                setSelectedTankId={state.setSelectedTankId}
                setCalculatorLotId={state.setCalculatorLotId}
                setCalculatorLotIdA={state.setCalculatorLotIdA}
              />
            )}

            {/* C1. WINE CODE LINEAGE / TRACEABILITY TREE */}
            {state.activeTab === 'lineage' && (
              <LotLineageGraphTab
                lang={state.lang}
                lots={state.lots}
                grapeIntakes={state.grapeIntakes}
                cellarOps={state.cellarOps}
                transfers={state.transfers}
                bottlingRuns={state.bottlingRuns}
                storageLocations={state.storageLocations}
                stockMovements={state.stockMovements}
                salesOrders={state.salesOrders}
                salesDispatches={state.salesDispatches}
                certificationRecords={state.certificationRecords}
                focusLotId={lineageFocusLotId}
              />
            )}

            {/* C2. CELLAR OPERATIONS (fast entry) */}
            {state.activeTab === 'operations' && (
              <CellarOperationsTab
                lang={state.lang}
                lots={state.lots}
                vessels={state.vessels}
                inventory={state.inventory}
                ops={state.cellarOps}
                currentUserName={state.currentUser.fullName}
                onAddOperation={state.handleAddCellarOperation}
                {...cellarPermissions.operations}
                setToastMessage={state.setToastMessage}
              />
            )}

            {/* D. TRANSFERS & BLENDS */}
            {state.activeTab === 'transfers' && (
              <TransfersTab 
                lang={state.lang} 
                vessels={state.vessels} 
                lots={state.lots} 
                onUpdateVessels={state.setVessels} 
                onUpdateLots={state.setLots} 
                {...cellarPermissions.transfers}
                prefilledSourceId={state.prefilledSourceId}
                prefilledDestId={state.prefilledDestId}
                pastTransfers={state.transfers}
                onUpdateTransfers={state.setTransfers}
                clearPrefilled={() => {
                  state.setPrefilledSourceId('');
                  state.setPrefilledDestId('');
                }}
              />
            )}

            {/* E. FERMENTATION FOLLOWUP */}
            {state.activeTab === 'fermentation' && (
              <FermentationTab 
                lang={state.lang}
                vessels={state.vessels}
                lots={state.lots}
                fermLogs={state.fermLogs}
                currentUser={state.currentUser}
                setActiveTab={state.setActiveTab}
                {...cellarPermissions.fermentation}
                onUpdateLots={state.setLots}
                onUpdateVessels={state.setVessels}
                onUpdateFermLogs={state.setFermLogs}
              />
            )}

            {/* F. LAB ANALYSIS TIMELINES */}
            {state.activeTab === 'labs' && (
              <LabsTab
                lang={state.lang}
                canCreateLabAnalysis={canAccess(state.currentUser.role, 'lab', 'create')}
                lots={state.lots}
                vessels={state.vessels}
                labLogs={state.labLogs}
                labFilterType={state.labFilterType}
                setLabFilterType={state.setLabFilterType}
                labFilterAge={state.labFilterAge}
                setLabFilterAge={state.setLabFilterAge}
                labLotId={state.labLotId}
                setLabLotId={state.setLabLotId}
                labTankId={state.labTankId}
                setLabTankId={state.setLabTankId}
                labABV={state.labABV}
                setLabABV={state.setLabABV}
                labVA={state.labVA}
                setLabVA={state.setLabVA}
                labFSO2={state.labFSO2}
                setLabFSO2={state.setLabFSO2}
                labTSO2={state.labTSO2}
                setLabTSO2={state.setLabTSO2}
                labResidualSugar={state.labResidualSugar}
                setLabResidualSugar={state.setLabResidualSugar}
                labLactic={state.labLactic}
                setLabLactic={state.setLabLactic}
                labTA={state.labTA}
                setLabTA={state.setLabTA}
                labTurbidity={state.labTurbidity}
                setLabTurbidity={state.setLabTurbidity}
                onAddLabLog={state.handleAddLabLog}
              />
            )}

            {/* G0. BOTTLING */}
            {state.activeTab === 'bottling' && (
              <BottlingTab
                lang={state.lang}
                {...cellarPermissions.bottling}
                lots={state.lots}
                onUpdateLots={state.setLots}
                history={state.bottlingRuns}
                onUpdateHistory={state.setBottlingRuns}
                inventory={state.inventory}
                onUpdateInventory={state.setInventory}
                costEntries={state.costEntries}
                onUpdateCostEntries={state.setCostEntries}
                storageLocations={state.storageLocations}
                stockMovements={state.stockMovements}
                onUpdateStockMovements={state.setStockMovements}
                currency={state.companyProfile.currency || 'GEL'}
                currentUserName={state.currentUser.fullName}
                setToastMessage={state.setToastMessage}
              />
            )}

            {/* G. WINEMAKING CALCULATORS */}
            {state.activeTab === 'calculators' && (
              <Suspense fallback={<ModuleLoader />}>
                <EnoCalculators 
                  lang={state.lang} 
                  lots={state.lots}
                  vessels={state.vessels}
                  labLogs={state.labLogs}
                  calculatorLotId={state.calculatorLotId}
                  setCalculatorLotId={state.setCalculatorLotId}
                  calculatorLotIdA={state.calculatorLotIdA}
                  setCalculatorLotIdA={state.setCalculatorLotIdA}
                  calculatorLotIdB={state.calculatorLotIdB}
                  setCalculatorLotIdB={state.setCalculatorLotIdB}
                />
              </Suspense>
            )}

            {/* H. RAW INVENTORY STOCK */}
            {state.activeTab === 'inventory' && (
              <InventoryTab
                lang={state.lang}
                inventory={state.inventory}
                onUpdateInventory={state.setInventory}
                canCreateInventory={canAccess(state.currentUser.role, 'inventory', 'create')}
                canUpdateInventory={canAccess(state.currentUser.role, 'inventory', 'update')}
                canDeleteInventory={canAccess(state.currentUser.role, 'inventory', 'delete')}
              />
            )}

            {/* I. AI ASSISTANT WINEMAKER */}
            {state.activeTab === 'ai' && (
              <Suspense fallback={<ModuleLoader />}>
                <AiWinemaker
                  lang={state.lang}
                  cellarState={{
                    tanksCount: state.vessels.length,
                    activeFermsCount,
                    avgTemp: averageOccupiedTemp,
                    lowSo2Count: alerts.filter(a => a.category === 'so2').length,
                    highVaCount: alerts.filter(a => a.category === 'va').length,
                    sampleData: state.vessels.filter(v => v.currentVolume > 0).map(v => {
                      const lot = state.lots.find(l => l.id === v.assignedLotId);
                      return {
                        id: v.id,
                        lotCode: v.assignedLotId || 'None',
                        currentVolume: v.currentVolume,
                        wineName: lot ? lot.name : 'Unknown',
                        stage: lot ? lot.stage : 'None'
                      };
                    })
                  }}
                  onAddNewTask={state.handleAddNewTask}
                  draftQueue={state.aiDrafts}
                  onSaveDraftActions={state.handleSaveAiDraftActions}
                  onUpdateDraftStatus={state.handleUpdateAiDraftStatus}
                />
              </Suspense>
            )}

            {/* J. CELLAR TASKS */}
            {state.activeTab === 'tasks' && (
              <TasksTab
                lang={state.lang}
                tasks={state.tasks}
                onToggleTaskStatus={state.handleToggleTaskStatus}
                onDeleteTask={state.handleDeleteTask}
                onAddNewTask={state.handleAddNewTask}
                canCreateTask={canAccess(state.currentUser.role, 'tasks', 'create')}
                canUpdateTask={canAccess(state.currentUser.role, 'tasks', 'update')}
                canDeleteTask={canAccess(state.currentUser.role, 'tasks', 'delete')}
                prefilledTaskTitle={state.prefilledTaskTitle}
                setPrefilledTaskTitle={state.setPrefilledTaskTitle}
                prefilledTaskPriority={state.prefilledTaskPriority}
                setPrefilledTaskPriority={state.setPrefilledTaskPriority}
                prefilledTaskDesc={state.prefilledTaskDesc}
                setPrefilledTaskDesc={state.setPrefilledTaskDesc}
              />
            )}

            {/* K. CELLAR NOTES */}
            {state.activeTab === 'notes' && (
              <NotesTab
                lang={state.lang}
                lots={state.lots}
                notesList={state.notesList}
                onAddNewNote={state.handleAddNewNote}
                onDeleteNote={state.handleDeleteNote}
                canCreateNote={canAccess(state.currentUser.role, 'notes', 'create')}
                canDeleteNote={canAccess(state.currentUser.role, 'notes', 'delete')}
              />
            )}

            </Suspense>
            )}
          </section>

        </main>
      )}

      {/* SYNC TROUBLESHOOTER DIAGNOSTICS & RESOLUTION MODAL */}
      {showSyncTroubleshooter && (
        <SyncTroubleshooterModal
          lang={state.lang}
          lastSyncError={state.lastSyncError}
          syncConflicts={state.syncConflicts}
          onClose={() => setShowSyncTroubleshooter(false)}
          onDiscard={async () => {
            await state.discardLocalUnsyncedChanges();
            setShowSyncTroubleshooter(false);
          }}
          onRetry={async () => {
            await state.triggerSync();
            setShowSyncTroubleshooter(false);
          }}
        />
      )}

      {/* 2. CONFLICT RESOLUTION MODAL */}
      {state.syncConflicts && state.syncConflicts.length > 0 && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-3xl w-full max-h-[85vh] rounded-2xl border border-stone-200 shadow-2xl flex flex-col overflow-hidden animate-scale-up">
            <div className="px-6 py-4 border-b border-stone-200 bg-stone-50">
              <h3 className="text-base font-serif font-black text-[#4e0e15]">
                {state.lang === 'ka' ? 'სინქრონიზაციის კონფლიქტების მოგვარება' : 'Sync Conflict Resolution'}
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                {state.lang === 'ka'
                  ? 'შემდეგი ჩანაწერები შეიცვალა როგორც ოფლაინ რეჟიმში, ასევე სერვერზე. გთხოვთ აირჩიოთ სასურველი ვერსია თითოეულისთვის:'
                  : 'The following items were modified concurrently both offline and on the server. Select which version to preserve:'
                }
              </p>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1 font-sans">
              {state.syncConflicts.map((conflict, idx) => {
                const key = `${conflict.collection}-${conflict.recordId}`;
                const currentChoice = resolutions[key] || 'server';
                const diffKeys = (() => {
                  const local = conflict.local || {};
                  const server = conflict.server || {};
                  const allKeys = new Set([...Object.keys(local), ...Object.keys(server)]);
                  return Array.from(allKeys).filter(k => {
                    if (k === 'lastModified' || k === 'history' || k === 'notesList') return false;
                    return JSON.stringify(local[k]) !== JSON.stringify(server[k]);
                  });
                })();

                return (
                  <div key={idx} className="border border-stone-200 rounded-xl overflow-hidden shadow-xs bg-white text-stone-850">
                    <div className="bg-stone-50 px-4 py-2 border-b border-stone-200 flex justify-between items-center text-xs font-mono font-bold text-stone-700">
                      <span>{state.lang === 'ka' ? 'კოლექცია:' : 'Collection:'} {conflict.collection}</span>
                      <span>ID: {conflict.recordId}</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-stone-200">
                      {/* Local/Offline */}
                      <div 
                        onClick={() => setResolutions(prev => ({ ...prev, [key]: 'local' }))}
                        className={`p-4 cursor-pointer transition-all ${
                          currentChoice === 'local' ? 'bg-emerald-50/50 ring-2 ring-emerald-600 ring-inset' : 'hover:bg-stone-50/50'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs uppercase tracking-wider font-bold text-slate-500">
                            {state.lang === 'ka' ? 'ლოკალური ვერსია (ოფლაინ)' : 'Local Version (Offline)'}
                          </span>
                          {currentChoice === 'local' && <span className="text-emerald-700 text-xs font-black">✓ Selected</span>}
                        </div>
                        
                        <div className="space-y-1.5 text-xs font-mono">
                          {diffKeys.map(k => (
                            <div key={k} className="flex justify-between border-b pb-0.5 border-stone-100">
                              <span className="text-slate-450">{k}:</span>
                              <span className="font-semibold text-stone-800">{JSON.stringify(conflict.local?.[k])}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Server/Online */}
                      <div 
                        onClick={() => setResolutions(prev => ({ ...prev, [key]: 'server' }))}
                        className={`p-4 cursor-pointer transition-all ${
                          currentChoice === 'server' ? 'bg-emerald-50/50 ring-2 ring-emerald-600 ring-inset' : 'hover:bg-stone-50/50'
                        }`}
                      >
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-xs uppercase tracking-wider font-bold text-slate-500">
                            {state.lang === 'ka' ? 'სერვერის ვერსია (ახალი)' : 'Server Version (Remote)'}
                          </span>
                          {currentChoice === 'server' && <span className="text-emerald-700 text-xs font-black">✓ Selected</span>}
                        </div>

                        <div className="space-y-1.5 text-xs font-mono">
                          {diffKeys.map(k => (
                            <div key={k} className="flex justify-between border-b pb-0.5 border-stone-100">
                              <span className="text-slate-450">{k}:</span>
                              <span className="font-semibold text-stone-800">{JSON.stringify(conflict.server?.[k])}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-6 py-4 border-t border-stone-200 bg-stone-50 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  state.resolveConflict(resolutions);
                  setResolutions({});
                }}
                className="px-4 py-2 bg-[#4e0e15] hover:bg-[#801323] text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-xs"
              >
                {state.lang === 'ka' ? 'შენახვა და შერწყმა' : 'Apply and Resolve Merge'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ONBOARDING CUSTOMIZATION WIZARD */}
      {state.isLoggedIn && showOnboarding && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white/95 dark:bg-stone-950/95 border border-stone-200 dark:border-stone-850 max-w-2xl w-full max-h-[90vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-up font-sans"
          >
            {/* Top decorative stripe */}
            <div className="h-1.5 bg-gradient-to-r from-[#801323] via-[#c5a059] to-emerald-800" />
            
            <div className="px-8 py-6 border-b border-stone-200/80 dark:border-stone-850 bg-stone-50/50 dark:bg-stone-900/20">
              <h3 className="text-xl font-serif font-black text-[#4e0e15] dark:text-amber-100 flex items-center gap-2">
                🍇 {needsRegistrationCompletion
                  ? (state.lang === 'ka' ? 'დაასრულეთ რეგისტრაცია' : 'Complete Your Registration')
                  : (state.lang === 'ka' ? 'მოარგეთ VinOS თქვენს საჭიროებებს' : 'Tailor your VinOS Workspace')}
              </h3>
              <p className="text-xs text-slate-550 dark:text-stone-400 mt-1 leading-relaxed">
                {needsRegistrationCompletion
                  ? (state.lang === 'ka'
                    ? 'შეავსეთ აუცილებელი სამუშაო სივრცის ინფორმაცია; დანარჩენი ველები შეგიძლიათ მოგვიანებით დაამატოთ.'
                    : 'Add the required workspace details; optional fields can be filled later.')
                  : (state.lang === 'ka'
                    ? 'აირჩიეთ სასურველი მოდულები და მთავარი გვერდის ვიჯეტები თქვენი როლის შესაბამისად.'
                    : 'Choose which modules and home page widgets match your role.')}
              </p>
            </div>

            <form onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const modules = fd.getAll('enabledModules') as string[];
              const widgets = fd.getAll('enabledWidgets') as string[];
              
              if (modules.length === 0) {
                alert(state.lang === 'ka' ? 'გთხოვთ აირჩიოთ მინიმუმ ერთი აქტიური მოდული.' : 'Please enable at least one active module.');
                return;
              }

              if (needsRegistrationCompletion) {
                const fullName = String(fd.get('fullName') || state.currentUser.fullName || '').trim();
                const role = String(fd.get('role') || 'Owner/Admin') as any;
                const companyName = String(fd.get('companyName') || '').trim();
                const companySetup = {
                  companyName,
                  wineryName: String(fd.get('wineryName') || '').trim(),
                  country: String(fd.get('country') || '').trim(),
                  region: String(fd.get('region') || '').trim(),
                  municipality: String(fd.get('municipality') || '').trim(),
                  address: regLocation?.label || String(fd.get('address') || '').trim(),
                  contactEmail: String(fd.get('contactEmail') || state.currentUser.email || '').trim(),
                  phone: String(fd.get('phone') || '').trim(),
                  website: String(fd.get('website') || '').trim(),
                  measurementUnits: 'metric' as const,
                  currency: 'GEL',
                  ...(regLocation ? {
                    latitude: regLocation.latitude,
                    longitude: regLocation.longitude,
                  } : {}),
                };
                const completed = await state.handleCompleteRegistration({
                  fullName,
                  role,
                  language: state.lang === 'ka' ? 'ka' : 'en',
                  companyProfile: companySetup,
                  enabledModules: modules,
                  enabledWidgets: widgets,
                });
                if (completed) {
                  state.setActiveModule(modules.includes('gvino') ? 'gvino' : modules.includes('vazi') ? 'vazi' : 'portal');
                  setShowOnboarding(false);
                }
                return;
              }
              
              await state.handleUpdateProfile({
                enabledModules: modules,
                enabledWidgets: widgets
              });
              setShowOnboarding(false);
            }} className="p-8 overflow-y-auto space-y-6 flex-1 text-xs text-stone-700 dark:text-stone-300">
              {needsRegistrationCompletion && (
                <div className="space-y-4">
                  <h4 className="text-[10px] font-mono uppercase tracking-widest text-[#c5a059] font-black border-b border-stone-150 pb-1">
                    {state.lang === 'ka' ? 'აუცილებელი ინფორმაცია' : 'Required Registration Details'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'სრული სახელი *' : 'Full Name *'}
                      </label>
                      <input
                        type="text"
                        name="fullName"
                        defaultValue={state.currentUser.fullName}
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'როლი *' : 'Role *'}
                      </label>
                      <select
                        name="role"
                        defaultValue={state.currentUser.role || 'Owner/Admin'}
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                        required
                      >
                        <option value="Owner/Admin">{state.lang === 'ka' ? 'მფლობელი / ადმინისტრატორი' : 'Owner / Admin'}</option>
                        <option value="Viticulturist">{state.lang === 'ka' ? 'მევენახე' : 'Viticulturist'}</option>
                        <option value="Winemaker">{state.lang === 'ka' ? 'მეღვინე' : 'Winemaker'}</option>
                        <option value="Lab Technician">{state.lang === 'ka' ? 'ლაბორანტი' : 'Lab Technician'}</option>
                        <option value="Cellar Worker">{state.lang === 'ka' ? 'მარნის თანამშრომელი' : 'Cellar Worker'}</option>
                        <option value="Read-Only">{state.lang === 'ka' ? 'მხოლოდ ნახვა' : 'Read-Only'}</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'კომპანიის / მამულის სახელი *' : 'Company / Estate Name *'}
                      </label>
                      <input
                        type="text"
                        name="companyName"
                        defaultValue={state.companyProfile.companyName}
                        placeholder="Kvareli Estate"
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input type="hidden" name="contactEmail" value={state.currentUser.email} />
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'მარნის სახელი' : 'Winery / Brand Name'}
                      </label>
                      <input
                        type="text"
                        name="wineryName"
                        defaultValue={state.companyProfile.wineryName}
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'ტელეფონი' : 'Phone'}
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        defaultValue={state.companyProfile.phone}
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'რეგიონი' : 'Region'}
                      </label>
                      <input
                        type="text"
                        name="region"
                        defaultValue={state.companyProfile.region}
                        placeholder="Kakheti"
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'მუნიციპალიტეტი' : 'Municipality'}
                      </label>
                      <input
                        type="text"
                        name="municipality"
                        defaultValue={state.companyProfile.municipality}
                        placeholder="Kvareli"
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'ქვეყანა' : 'Country'}
                      </label>
                      <input
                        type="text"
                        name="country"
                        defaultValue={state.companyProfile.country}
                        placeholder="Georgia"
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                        {state.lang === 'ka' ? 'ვებგვერდი' : 'Website'}
                      </label>
                      <input
                        type="url"
                        name="website"
                        defaultValue={state.companyProfile.website}
                        className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 dark:text-stone-100 font-bold focus:border-stone-400 transition-colors"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 tracking-widest">
                      {state.lang === 'ka' ? 'მდებარეობა' : 'Location'}
                    </label>
                    <Suspense fallback={<div className="h-10 rounded-xl bg-stone-100 animate-pulse" />}>
                      <LocationPicker
                        latitude={regLocation?.latitude ?? state.companyProfile.latitude ?? 41.9056}
                        longitude={regLocation?.longitude ?? state.companyProfile.longitude ?? 45.474}
                        showManual={false}
                        placeholder={state.lang === 'ka' ? 'მოძებნეთ ადგილი...' : 'Search your estate...'}
                        onChange={(loc) => setRegLocation(loc)}
                      />
                    </Suspense>
                  </div>
                </div>
              )}
              
              {/* Section 1: Modules Toggles */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-mono uppercase tracking-widest text-[#c5a059] font-black border-b border-stone-150 pb-1">
                  📦 {state.lang === 'ka' ? 'აქტიური მოდულები' : 'Active Winemaking Modules'}
                </h4>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Viticulture Module (Vazi) */}
                  <label className="relative flex flex-col p-4 bg-stone-50 dark:bg-stone-900/50 border border-stone-200 dark:border-stone-800 rounded-2xl cursor-pointer hover:border-emerald-500/50 transition-all select-none">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-stone-900 dark:text-amber-100 flex items-center gap-1.5">
                        🚜 {state.lang === 'ka' ? 'მევენახეობა (ვაზი)' : 'Viticulture (Vazi / Vineyard)'}
                      </span>
                      <input 
                        type="checkbox" 
                        name="enabledModules" 
                        value="vazi" 
                        defaultChecked={defaultEnabledModules.includes('vazi')}
                        className="h-4.5 w-4.5 rounded border-stone-300 text-emerald-805 focus:ring-emerald-800 accent-emerald-800 cursor-pointer"
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed font-sans font-medium">
                      {state.lang === 'ka'
                        ? 'ნაკვეთები, წამლობის გრაფიკები, ფენოლოგია, GDD ტემპერატურული ჯამები და ჭრაქის პროგნოზები.'
                        : 'Track blocks, spray schedules, phenology stages, GDD heat summation, and downy mildew risk forecasts.'
                      }
                    </p>
                  </label>

                  {/* Winery Module (Gvino) */}
                  <label className="relative flex flex-col p-4 bg-stone-50 dark:bg-stone-900/50 border border-stone-200 dark:border-stone-800 rounded-2xl cursor-pointer hover:border-[#801323]/50 transition-all select-none">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-stone-900 dark:text-amber-100 flex items-center gap-1.5">
                        🍷 {state.lang === 'ka' ? 'მეღვინეობა (ღვინო)' : 'Winery (Gvino / Cellar)'}
                      </span>
                      <input 
                        type="checkbox" 
                        name="enabledModules" 
                        value="gvino" 
                        defaultChecked={defaultEnabledModules.includes('gvino')}
                        className="h-4.5 w-4.5 rounded border-stone-300 text-[#4e0e15] focus:ring-[#4e0e15] accent-[#4e0e15] cursor-pointer"
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-500 leading-relaxed font-sans font-medium">
                      {state.lang === 'ka'
                        ? 'ჭურჭელი, ქვევრები, პარტიები, ლაბორატორია, SO₂ ბუფერი და ხელოვნური ინტელექტის მეღვინე.'
                        : 'Manage vessels, clay qvevris, wine lots, laboratory metrics, SO2 buffers, and the AI winemaker assistant.'
                      }
                    </p>
                  </label>
                </div>
              </div>

              {/* Section 2: Widget Selections */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-mono uppercase tracking-widest text-[#c5a059] font-black border-b border-stone-150 pb-1">
                  🏠 {state.lang === 'ka' ? 'მთავარი გვერდის ვიჯეტები' : 'Home Page Dashboard Widgets'}
                </h4>
                <p className="text-[10px] text-slate-400 font-sans">
                  {state.lang === 'ka' 
                    ? 'აირჩიეთ, თუ რომელი ბლოკები გამოჩნდეს მთავარ პორტალზე.' 
                    : 'Choose what metrics appear on your main portal homepage.'
                  }
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-stone-800 dark:text-stone-300">
                  {[
                    { id: 'chemistry', label: state.lang === 'ka' ? '⚠️ უსაფრთხოება და ქიმია' : '⚠️ Safety & Chemistry Alerts', module: 'gvino' },
                    { id: 'weather', label: state.lang === 'ka' ? '🌦️ მეტეო პროგნოზები და რისკები' : '🌦️ Weather Station & Mildew Forecasts', module: 'vazi' },
                    { id: 'fermentation', label: state.lang === 'ka' ? '🔥 აქტიური დუღილის ტელემეტრია' : '🔥 Active Fermentations & Telemetry', module: 'gvino' },
                    { id: 'canopy', label: state.lang === 'ka' ? '🌿 ვენახის ფოთლის რადარი' : '🌿 Vineyard Canopy Status Radar', module: 'vazi' },
                    { id: 'tasks', label: state.lang === 'ka' ? '📋 დავალებების ჩეკლისტი' : '📋 Unified Operations Tasklist Checklist', module: null },
                    { id: 'audit', label: state.lang === 'ka' ? '🛡️ საქმიანობის აუდიტის ჟურნალი' : '🛡️ Immutable Audit Trail Ledger History', module: null }
                  ].map(widget => (
                    <label key={widget.id} className="flex items-center gap-2.5 p-3.5 bg-stone-50/70 dark:bg-stone-900/30 border border-stone-150 dark:border-stone-800 rounded-xl hover:bg-stone-100/50 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        name="enabledWidgets" 
                        value={widget.id} 
                        defaultChecked={defaultEnabledWidgets.includes(widget.id)}
                        className="h-4 w-4 rounded text-amber-600 focus:ring-amber-500 accent-amber-600 cursor-pointer"
                      />
                      <div>
                        <span className="font-bold block text-stone-850 dark:text-amber-100">{widget.label}</span>
                        {widget.module && (
                          <span className="text-[8px] uppercase tracking-wider text-[#c5a059] font-black font-mono">
                            {widget.module === 'vazi' ? (state.lang === 'ka' ? 'მევენახეობა' : 'Viticulture') : (state.lang === 'ka' ? 'მეღვინეობა' : 'Winery')}
                          </span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Action */}
              <div className="pt-4 flex justify-end gap-3.5">
                <button
                  type="submit"
                  className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase tracking-widest py-3.5 rounded-xl cursor-pointer text-xs justify-center flex items-center shadow-md transition-all duration-200"
                >
                  ✨ {needsRegistrationCompletion
                    ? (state.lang === 'ka' ? 'რეგისტრაციის დასრულება' : 'Finish Registration')
                    : (state.lang === 'ka' ? 'პარამეტრების შენახვა და დაწყება' : 'Configure & Start Cellaring')} →
                </button>
              </div>

            </form>
          </motion.div>
        </div>
      )}

      {/* SLIDE-OUT PANEL FOR SELECTED VESSEL DETAILED METRICS */}
      {state.selectedTankId && (
        <Suspense fallback={null}>
          <VesselDrawer
            lang={state.lang}
            selectedTankId={state.selectedTankId}
            vessels={state.vessels}
            lots={state.lots}
            fermLogs={state.fermLogs}
            onClose={() => state.setSelectedTankId(null)}
            onAdjustTargetTemp={state.handleAdjustTargetTemp}
            onToggleSanitation={state.handleToggleSanitation}
            onToggleCoolingJacket={state.handleToggleCoolingJacket}
            onUpdateVessels={state.setVessels}
            canUpdateVessel={cellarPermissions.vessels.canUpdateVessel}
          />
        </Suspense>
      )}

      {/* OMNIPRESENT FLOATING AI WIDGET */}
      {state.isLoggedIn && (
        <>
          {/* Glowing floating orb button (hidden when drawer is open) */}
          <AnimatePresence>
            {!isAiDrawerOpen && (
              <motion.button
                key="ai-floating-orb"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsAiDrawerOpen(true)}
                className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-gradient-to-tr from-[#4e0e15] to-[#801323] hover:from-[#801323] hover:to-[#c5a059] text-white rounded-full hidden sm:flex items-center justify-center shadow-[0_8px_30px_rgba(78,14,21,0.55)] border-2 border-[#c5a059]/50 dark:border-amber-400/50 cursor-pointer focus:outline-none transition-all duration-300 group"
                title="Open AI Winemaker Assistant"
              >
                <div className="absolute inset-0 rounded-full bg-radial-gradient from-transparent to-[#c5a059]/10 animate-pulse" />
                <span className="text-2xl filter drop-shadow-[0_2px_8px_rgba(255,255,255,0.4)]">🔮</span>
                <span className="absolute -top-1 -right-1 bg-amber-500 text-[#4e0e15] border border-white text-[9px] font-black rounded-full w-5 h-5 flex items-center justify-center shadow-xs">
                  AI
                </span>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Slide-out AI assistant drawer */}
          <AnimatePresence>
            {isAiDrawerOpen && (
              <>
                <motion.div
                  key="ai-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsAiDrawerOpen(false)}
                  className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs z-50 transition-opacity"
                />

                <motion.div
                  ref={aiDrawerRef}
                  key="ai-drawer"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="ai-winemaker-drawer-title"
                  tabIndex={-1}
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 24, stiffness: 200 }}
                  className="fixed inset-y-0 right-0 z-50 w-full sm:w-[480px] bg-white dark:bg-[#140d0e] shadow-2xl border-l border-[#f0e6da] dark:border-[#2a191b] flex flex-col focus:outline-none text-stone-850 dark:text-stone-100"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8dfd5] dark:border-stone-800 bg-[#FAF8F5] dark:bg-stone-950/40 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🔮</span>
                      <div>
                        <h2 id="ai-winemaker-drawer-title" className="text-sm font-serif font-black text-[#4e0e15] dark:text-amber-150 tracking-wide">
                          AI Winemaker Assistant
                        </h2>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Context: {state.activeModule === 'vazi' ? 'Vineyard (Vazi)' : `Winery (Gvino) - ${state.activeTab}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsAiDrawerOpen(false)}
                      aria-label={state.lang === 'ka' ? 'AI ასისტენტის დახურვა' : 'Close AI assistant'}
                      className="p-1.5 rounded-full hover:bg-stone-200/50 dark:hover:bg-stone-850 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Component Container */}
                  <div className="flex-1 overflow-hidden">
                    <Suspense fallback={
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-6 h-6 animate-spin text-[#4e0e15]" />
                      </div>
                    }>
                      <AiWinemaker
                        lang={state.lang}
                        className="h-full border-0 rounded-none shadow-none"
                        contextTab={state.activeTab}
                        contextModule={state.activeModule}
                        cellarState={{
                          tanksCount: state.vessels.length,
                          activeFermsCount,
                          avgTemp: averageOccupiedTemp,
                          lowSo2Count: alerts.filter(a => a.category === 'so2').length,
                          highVaCount: alerts.filter(a => a.category === 'va').length,
                          sampleData: state.vessels.filter(v => v.currentVolume > 0).map(v => {
                            const lot = state.lots.find(l => l.id === v.assignedLotId);
                            return {
                              id: v.id,
                              lotCode: v.assignedLotId || 'None',
                              currentVolume: v.currentVolume,
                              wineName: lot ? lot.name : 'Unknown',
                              stage: lot ? lot.stage : 'None'
                            };
                          })
                        }}
                        onAddNewTask={state.handleAddNewTask}
                        draftQueue={state.aiDrafts}
                        onSaveDraftActions={state.handleSaveAiDraftActions}
                        onUpdateDraftStatus={state.handleUpdateAiDraftStatus}
                      />
                    </Suspense>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}



      <footer className="py-6 px-6 bg-white border-t border-[#e8dfd5] text-center mt-auto text-[10px] text-slate-500 dark:text-slate-400 font-mono font-medium">
        VinOS • Operational Winemaking Control Loop • Offline-capable traceability
      </footer>
    </div>
    </ToastProvider>
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

interface SyncTroubleshooterProps {
  lang: string;
  lastSyncError: string | null;
  syncConflicts: any[] | null;
  onClose: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}

function SyncTroubleshooterModal({
  lang,
  lastSyncError,
  syncConflicts,
  onClose,
  onDiscard,
  onRetry
}: SyncTroubleshooterProps) {
  const [offlineMutCount, setOfflineMutCount] = useState<number>(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, { active: true, onClose });
  const dirtyCollections = (() => {
    try {
      return JSON.parse(localStorage.getItem('vinea_dirty_collections') || '[]');
    } catch {
      return [];
    }
  })();

  useEffect(() => {
    IndexedDBQueue.getMutations().then(muts => setOfflineMutCount(muts.length)).catch(() => {});
  }, []);

  return (
    <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-troubleshooter-title"
        tabIndex={-1}
        className="bg-white dark:bg-[#140d0e] max-w-md w-full rounded-2xl border border-stone-200 dark:border-[#2a191b] shadow-2xl overflow-hidden animate-scale-up text-stone-850 dark:text-stone-100 font-sans"
      >
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800 flex justify-between items-center bg-stone-50 dark:bg-stone-950/40">
          <h3 id="sync-troubleshooter-title" className="text-sm font-serif font-black text-[#4e0e15] dark:text-amber-150 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-[#801323] dark:text-amber-400 animate-spin" style={{ animationDuration: '3s' }} />
            {lang === 'ka' ? 'სინქრონიზაციის შეცდომების დიაგნოსტიკა' : 'Sync Rejection Troubleshooter'}
          </h3>
          <button
            onClick={onClose}
            aria-label={lang === 'ka' ? 'სინქრონიზაციის დიაგნოსტიკის დახურვა' : 'Close sync troubleshooter'}
            className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          
          {/* Error detail */}
          <div className="p-4 bg-rose-50 dark:bg-rose-950/25 border border-rose-200/60 dark:border-rose-900/50 rounded-xl space-y-2">
            <span className="text-[10px] font-mono uppercase text-rose-700 dark:text-rose-455 font-bold tracking-wider">
              {lang === 'ka' ? 'სერვერის უარყოფის მიზეზი' : 'Server Rejection Reason'}
            </span>
            <p className="text-xs font-mono font-semibold text-rose-900 dark:text-rose-200 break-words leading-relaxed text-left">
              {lastSyncError || (syncConflicts && syncConflicts.length > 0
                ? (lang === 'ka' ? 'სინქრონიზაციის კონფლიქტი (მონაცემები შეიცვალა სერვერზე)' : 'Sync conflict (simultaneous modifications detected on server)')
                : (lang === 'ka' ? 'დაუდგენელი შეცდომა' : 'Unspecified synchronization rejection error'))}
            </p>
          </div>

          {/* Queue Stats */}
          <div className="space-y-3.5">
            <h4 className="text-[10px] uppercase font-mono text-stone-400 dark:text-stone-550 tracking-wider font-extrabold text-left">
              {lang === 'ka' ? 'ლოკალური რიგის მდგომარეობა' : 'Pending Queue Diagnostics'}
            </h4>

            <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono font-bold">
              <div className="p-3 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-850 rounded-xl">
                <span className="text-[9px] uppercase text-stone-450 block mb-1">Unsaved Mutations</span>
                <span className="text-sm text-[#4e0e15] dark:text-amber-300">{offlineMutCount} items</span>
              </div>
              <div className="p-3 bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-850 rounded-xl">
                <span className="text-[9px] uppercase text-stone-450 block mb-1">Dirty Collections</span>
                <span className="text-sm text-[#4e0e15] dark:text-amber-300">{dirtyCollections.length} tables</span>
              </div>
            </div>

            {dirtyCollections.length > 0 && (
              <div className="p-3 bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/35 rounded-xl text-left">
                <span className="text-[9px] uppercase font-mono text-amber-700 dark:text-amber-455 font-bold block mb-1">Affected Collections</span>
                <p className="text-[10px] font-mono text-stone-600 dark:text-stone-400 leading-normal">
                  {dirtyCollections.join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Warning message */}
          <div className="p-3.5 bg-amber-50/50 dark:bg-amber-950/15 border border-amber-255/50 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 rounded-xl text-[11px] leading-relaxed flex gap-2 text-left">
            <span className="text-base leading-none">⚠️</span>
            <div>
              <strong>{lang === 'ka' ? 'ყურადღება:' : 'Warning:'}</strong> {lang === 'ka' 
                ? 'ლოკალური ცვლილებების გაუქმება სამუდამოდ წაშლის ყველა გაუსინქრონებელ ჩანაწერს და ჩამოტვირთავს სერვერის მიმდინარე ვერსიას.' 
                : 'Discarding local changes will permanently erase all offline/unsynced mutations and overwrite local state with the server database.'}
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 bg-stone-50 dark:bg-stone-950/40 border-t border-stone-100 dark:border-stone-800 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 border border-stone-200 dark:border-stone-800 hover:bg-stone-150 dark:hover:bg-stone-850 text-stone-700 dark:text-stone-200 text-xs font-mono font-bold rounded-xl transition-all cursor-pointer"
          >
            {lang === 'ka' ? 'დახურვა' : 'Close'}
          </button>

          <button
            onClick={onDiscard}
            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-mono font-bold rounded-xl transition-all cursor-pointer shadow-xs"
          >
            🗑️ {lang === 'ka' ? 'გაუქმება' : 'Discard Local'}
          </button>

          <button
            onClick={onRetry}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-mono font-bold rounded-xl transition-all cursor-pointer shadow-xs"
          >
            🔄 {lang === 'ka' ? 'სინქრონიზაცია' : 'Force Retry'}
          </button>
        </div>

      </div>
    </div>
  );
}
