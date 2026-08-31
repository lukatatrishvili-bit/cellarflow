import React, { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import { lazyRetry } from './lazyRetry';
import { motion, AnimatePresence } from 'motion/react';
import type { Language } from '../lib/i18n';
import { getShellTranslations } from '../lib/i18nShell';
import { computeAlerts, type Alert } from '../lib/alerts';
import WorkspaceShell, { type WorkspaceNavSection } from '../components/WorkspaceShell';
import { vaziNavigationGroups, type VaziTab } from '../lib/vaziNavigation';
import type { AiFinding } from '../lib/ai/types';
import {
  buildNotificationFeed,
  type AiNotificationFinding,
  type NotificationItem,
} from '../lib/notificationFeed';
import { useWineryState } from '../hooks/useWineryState';
import { parseWorkspaceRoute } from '../lib/workspaceRoute';
import { useWorkspaceRoute } from '../hooks/useWorkspaceRoute';
import { IndexedDBQueue } from '../lib/syncQueue';
import { ToastProvider } from '../components/ToastProvider';
import { usePerformanceManager } from '../hooks/usePerformanceManager';
import { useFocusTrap } from '../components/useFocusTrap';
import { canAccess } from '../server/permissions';
import { parseAuthAccessLink } from '../lib/authAccess';
import { localizedRoleLabel } from '../lib/roleLabels';
import {
  canViewUserDestination,
  firstVisibleWineryTab,
  permissionModuleFor,
} from '../lib/navigationPermissions';
import {
  cellarWorkflowPermissions,
  salesWorkflowPermissions,
  vineyardWorkflowPermissions,
} from '../lib/workflowPermissions';
import type { BillingFeature } from '../lib/billing/planCatalog';
import type { CellarOperation, CellarOperationType } from '../lib/wineryState';
import type { ProductionPlanItem } from '../lib/operationsControl';

// Heavy modules are code-split
const DashboardTab = lazyRetry(() => import('../components/DashboardTab'));
const ProfileSettingsTab = lazyRetry(() => import('../components/ProfileSettingsTab'));
const IntegrationHubTab = lazyRetry(() => import('../components/IntegrationHubTab'));
const AuditTrailTab = lazyRetry(() => import('../components/AuditTrailTab'));
const LotPassport = lazyRetry(() => import('../components/LotPassport'));
const VaziModule = lazyRetry(() => import('../components/VaziModule'));
const WineryDashboardTab = lazyRetry(() => import('../components/WineryDashboardTab'));
const CellarWorkspaceRoute = lazyRetry(() => import('../components/CellarWorkspaceRoute'));
const QvevriPassportTab = lazyRetry(() => import('../components/QvevriPassportTab'));
const GrapeReceivingTab = lazyRetry(() => import('../components/GrapeReceivingTab'));
const LotLineageGraphTab = lazyRetry(() => import('../components/LotLineageGraphTab'));
const CellarOperationsTab = lazyRetry(() => import('../components/CellarOperationsTab'));
const TransfersTab = lazyRetry(() => import('../components/TransfersTab'));
const FermentationTab = lazyRetry(() => import('../components/FermentationTab'));
const LabsTab = lazyRetry(() => import('../components/LabsTab'));
const BottlingTab = lazyRetry(() => import('../components/BottlingTab'));
const EnoCalculators = lazyRetry(() => import('../components/EnoCalculators'));
const InventoryTab = lazyRetry(() => import('../components/InventoryTab'));
const AiWinemaker = lazyRetry(() => import('../components/AiWinemaker'));
const AiIntelligenceTab = lazyRetry(() => import('../components/AiIntelligenceTab'));
const AiSignalStrip = lazyRetry(() => import('../components/AiSignalStrip'));
const TasksTab = lazyRetry(() => import('../components/TasksTab'));
const NotesTab = lazyRetry(() => import('../components/NotesTab'));
const OfficialDocsTab = lazyRetry(() => import('../components/OfficialDocsTab'));
const CertificationManagerTab = lazyRetry(() => import('../components/CertificationManagerTab'));
const CostsTab = lazyRetry(() => import('../components/CostsTab'));
const StorageTab = lazyRetry(() => import('../components/StorageTab'));
const SalesDispatchTab = lazyRetry(() => import('../components/SalesDispatchTab'));
const YearComparisonTab = lazyRetry(() => import('../components/YearComparisonTab'));
const TerroirPulsePage = lazyRetry(() => import('../components/TerroirPulsePage'));
const VesselDrawer = lazyRetry(() => import('../components/VesselDrawer'));
const GlobalCommandPalette = lazyRetry(() => import('../components/GlobalCommandPalette'));
const SyncConflictResolutionModal = lazyRetry(() => import('../components/SyncConflictResolutionModal'));
const AuthAccountFlows = lazyRetry(() => import('../components/AuthAccountFlows'));
const MasterAdminPortal = lazyRetry(() => import('../components/MasterAdminPortal'));
const NotificationCenter = lazyRetry(() => import('../components/NotificationCenter'));
const PricingPage = lazyRetry(() => import('../components/PricingPage'));
const MarketingLanding = lazyRetry(() => import('../components/MarketingLanding'));
const RegistrationPanel = lazyRetry(() => import('../components/RegistrationExperience').then(module => ({ default: module.RegistrationPanel })));
const SignInPanel = lazyRetry(() => import('../components/RegistrationExperience').then(module => ({ default: module.SignInPanel })));
const WorkspaceSetupDialog = lazyRetry(() => import('../components/RegistrationExperience').then(module => ({ default: module.WorkspaceSetupDialog })));
const StatusToastHost = lazyRetry(() => import('../components/StatusToastHost'));
const SyncStatus = lazyRetry(() => import('../components/SyncStatus'));
const InstallButton = lazyRetry(() => import('../components/InstallButton'));
const OperationsControlTab = lazyRetry(() => import('../components/OperationsControlTab'));
const RecallCockpitTab = lazyRetry(() => import('../components/RecallCockpitTab'));
const QualitySopTab = lazyRetry(() => import('../components/QualitySopTab'));
const ProcurementTab = lazyRetry(() => import('../components/ProcurementTab'));
const ProductionPlannerTab = lazyRetry(() => import('../components/ProductionPlannerTab'));
const ScanToAction = lazyRetry(() => import('../components/ScanToAction'));

// Subcomponents modular layout
import AuroraBackdrop from '../components/AuroraBackdrop';
import type { WorkspaceSetupSubmission } from '../components/RegistrationExperience';
import type {
  AuthAccountFlow,
  AuthenticatedStateNotice,
  ReturnToSignInContext,
} from '../components/AuthAccountFlows';
import type { CellarScanTarget } from '../components/ScanToAction';

// Core Lucide Icons mapping
import {
  LayoutDashboard,
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
  ChevronUp,
  ChevronDown,
  ClipboardList,
  ListChecks,
  FileText,
  FileSpreadsheet,
  BarChart3,
  BadgeDollarSign,
  Package,
  Coins,
  Warehouse,
  Truck,
  Sprout,
  Sun,
  Moon,
  RefreshCw,
  Search,
  PlugZap,
  BadgeCheck,
  Settings,
  Menu,
  LogOut,
  ShieldCheck,
  AlertOctagon,
  ShoppingCart,
  CalendarRange,
  ScanLine,
} from 'lucide-react';

function ModuleLoader() {
  return (
    <div className="flex items-center justify-center p-16 w-full">
      <Loader2 className="w-6 h-6 animate-spin text-[#4e0e15]" />
    </div>
  );
}

const PENDING_INVITATION_TOKEN_KEY = 'vinos_pending_invitation_token';
const POST_LOGIN_RETURN_TO_KEY = 'vinos_post_login_return_to';
const LOGIN_ROUTE = '/login';
const DEFAULT_AUTHENTICATED_ROUTE = '/dashboard';

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

function readBrowserRoute(): string {
  return typeof window === 'undefined'
    ? '/'
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Whether the URL itself says which module to show.
 *
 * Landing on `/dashboard` resets the workspace to the portal, which was the
 * right default while the pathname was the only destination the URL carried.
 * Now that `?module=` can name one, that reset has to defer to it — otherwise
 * Back and Forward restore the address bar and are immediately overruled, and a
 * shared link opens on the portal instead of where it points.
 */
function routeNamesWorkspaceModule(route: string): boolean {
  const queryAt = route.indexOf('?');
  if (queryAt < 0) return false;
  return parseWorkspaceRoute(route.slice(queryAt)).module !== null;
}

function clearPostLoginReturnTo(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(POST_LOGIN_RETURN_TO_KEY);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

export default function App() {
  const state = useWineryState();
  const isKa = state.lang === 'ka';
  const [routeRevision, setRouteRevision] = useState(0);
  const [resolvedAuthRouteKey, setResolvedAuthRouteKey] = useState('');
  const replaceRoute = useCallback((target: string) => {
    if (typeof window === 'undefined') return;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current === target) return;
    window.history.replaceState(window.history.state, document.title, target);
    setRouteRevision(revision => revision + 1);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => setRouteRevision(revision => revision + 1);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const browserRoute = useMemo(readBrowserRoute, [routeRevision, state.isLoggedIn, state.isAuthResolved]);
  const normalizedPathname = browserRoute.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const isTerroirPulsePage = normalizedPathname === '/terroir-pulse';
  const isMarketingPage = normalizedPathname === '/welcome'
    || (normalizedPathname === '/' && !state.isLoggedIn);
  const perf = usePerformanceManager();
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [showSyncTroubleshooter, setShowSyncTroubleshooter] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [prefilledOpType, setPrefilledOpType] = useState<CellarOperationType | undefined>();
  const [prefilledTransferVolume, setPrefilledTransferVolume] = useState<number | undefined>();
  const [operationReturnVesselId, setOperationReturnVesselId] = useState<string | null>(null);
  const [recentlyLoggedOperationId, setRecentlyLoggedOperationId] = useState<string | null>(null);
  // Stable identity, so ToastHost's memo actually holds across App re-renders.
  const openSyncTroubleshooter = useCallback(() => setShowSyncTroubleshooter(true), []);

  // Pulled out of `state` so the hooks below can depend on the individual
  // setters. `useStableCallbacks` fixes each function's identity but returns a
  // fresh container each render, so depending on `state` itself would make every
  // callback below unstable again — exactly what these exist to prevent.
  const {
    setActiveModule,
    setActiveTab,
    setCompanyProfile,
    setSelectedTankId,
    setPrefilledIntakeHarvestId,
    setPrefilledOpVesselId,
    setPrefilledSourceId,
    setPrefilledDestId,
    setPassportLotId,
    setToastMessage,
    handleAuthLogout,
  } = state;
  const currentUserForScan = state.currentUser;
  const scanLanguage = state.lang;

  // Handlers passed to memoized module components. Declared inline they were
  // allocated fresh on every App render, which defeated those components' memo
  // entirely — the boundary paid for a prop comparison that could never pass.
  const openOnboarding = useCallback(() => setShowOnboarding(true), []);
  const clearIntakePrefill = useCallback(() => setPrefilledIntakeHarvestId(null), [setPrefilledIntakeHarvestId]);
  const clearOperationPrefill = useCallback(() => {
    setPrefilledOpVesselId('');
    setPrefilledOpType(undefined);
  }, [setPrefilledOpVesselId]);
  const clearTransferPrefill = useCallback(() => {
    setPrefilledSourceId('');
    setPrefilledDestId('');
    setPrefilledTransferVolume(undefined);
  }, [setPrefilledSourceId, setPrefilledDestId]);
  const openTransferFromVessel = useCallback((vesselId: string, role: 'source' | 'destination' = 'source') => {
    setPrefilledSourceId(role === 'source' ? vesselId : '');
    setPrefilledDestId(role === 'destination' ? vesselId : '');
    setPrefilledTransferVolume(undefined);
    setActiveModule('gvino');
    setActiveTab('transfers');
  }, [setActiveModule, setActiveTab, setPrefilledDestId, setPrefilledSourceId]);
  const navigateCellarWorkflow = useCallback(
    (tab: 'transfers' | 'bottling' | 'vessels') => setActiveTab(tab),
    [setActiveTab],
  );
  const openProcurement = useCallback(() => setActiveModule('procurement'), [setActiveModule]);
  const closeScanner = useCallback(() => setIsScannerOpen(false), []);
  const handleScanResolve = useCallback((target: CellarScanTarget) => {
    setActiveModule('gvino');
    if (target.kind === 'vessel') {
      if (canViewUserDestination(currentUserForScan, 'gvino', 'operations')) {
        setPrefilledOpVesselId(target.id);
        setPrefilledOpType(undefined);
        setActiveTab('operations');
      } else {
        setSelectedTankId(target.id);
        setActiveTab('vessels');
      }
      setToastMessage(scanLanguage === 'ka' ? `${target.id} ოპერაციისთვის მზადაა.` : `${target.id} is ready for an operation.`);
      return;
    }
    setPassportLotId(target.id);
    setActiveTab('lots');
    setToastMessage(scanLanguage === 'ka' ? `${target.id} პარტიის პასპორტი გაიხსნა.` : `${target.id} lot passport opened.`);
  }, [currentUserForScan, scanLanguage, setActiveModule, setActiveTab, setPassportLotId, setPrefilledOpVesselId, setSelectedTankId, setToastMessage]);

  const scanVesselIds = useMemo(() => state.vessels.map(vessel => vessel.id), [state.vessels]);
  const scanLotIds = useMemo(() => state.lots.map(lot => lot.id), [state.lots]);

  const closeVesselDrawer = useCallback(() => {
    setSelectedTankId(null);
    setRecentlyLoggedOperationId(null);
  }, [setSelectedTankId]);
  const openVesselOperation = useCallback((vesselId: string, operationType?: CellarOperationType) => {
    setPrefilledOpVesselId(vesselId);
    setPrefilledOpType(operationType);
    setOperationReturnVesselId(vesselId);
    setRecentlyLoggedOperationId(null);
    setSelectedTankId(null);
    setActiveModule('gvino');
    setActiveTab('operations');
  }, [setActiveModule, setActiveTab, setPrefilledOpVesselId, setSelectedTankId]);
  const handleVesselOperationLogged = useCallback((operation: Pick<CellarOperation, 'id' | 'vesselId'>) => {
    if (!operationReturnVesselId) return;
    const vesselId = operation.vesselId || operationReturnVesselId;
    setOperationReturnVesselId(null);
    setRecentlyLoggedOperationId(operation.id);
    setActiveModule('gvino');
    setActiveTab('vessels');
    setSelectedTankId(vesselId);
  }, [operationReturnVesselId, setActiveModule, setActiveTab, setSelectedTankId]);
  useEffect(() => {
    if (state.activeTab !== 'operations' && !state.selectedTankId && operationReturnVesselId) {
      setOperationReturnVesselId(null);
    }
  }, [operationReturnVesselId, state.activeTab, state.selectedTankId]);
  const consumeAiFindingFocus = useCallback(() => setFocusedAiFindingId(null), []);
  const saveAiConfig = useCallback(
    (aiConfig: any) => setCompanyProfile((current: any) => ({ ...current, aiConfig })),
    [setCompanyProfile],
  );

  // Findings name the module they belong to; map it onto the winery tab that
  // actually shows that work.
  const navigateToAiFindingModule = useCallback((targetModule: string) => {
    const tabByModule: Record<string, string> = {
      tasks: 'tasks',
      labs: 'labs',
      operations: 'operations',
      transfers: 'transfers',
      bottling: 'bottling',
      fermentation: 'fermentation',
      calculators: 'calculators',
      vessels: 'vessels',
      lots: 'lots',
    };
    if (targetModule === 'vazi') {
      setActiveModule('vazi');
      return;
    }
    // Materials is its own module now, not a cellar tab.
    if (targetModule === 'inventory') {
      setActiveModule('inventory');
      return;
    }
    if (targetModule === 'documents' || targetModule === 'certification') {
      setActiveModule('docs');
      return;
    }
    const tab = tabByModule[targetModule];
    if (tab) {
      setActiveModule('gvino');
      setActiveTab(tab);
    }
  }, [setActiveModule, setActiveTab]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [lineageFocusLotId, setLineageFocusLotId] = useState<string>('');
  const [recallFocusCaseId, setRecallFocusCaseId] = useState<string>('');
  const [workflowFocus, setWorkflowFocus] = useState<{ tab: string; targetId: string } | null>(null);
  // The vineyard's active screen lives here so the shared shell sidebar can
  // drive it, the same way the cellar's activeTab does.
  const [vaziTab, setVaziTab] = useState<VaziTab>('dashboard');
  const [focusedAiFindingId, setFocusedAiFindingId] = useState<string | null>(null);
  const locallyReadAiNotificationEvents = useRef<Set<string>>(new Set());
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [isEndingImpersonation, setIsEndingImpersonation] = useState(false);
  const [billingEntitlements, setBillingEntitlements] = useState<Partial<Record<BillingFeature, boolean>> | null>(null);
  const [initialAuthLinkContext] = useState<InitialAuthLinkContext>(readInitialAuthLinkContext);
  const [authAccountFlow, setAuthAccountFlow] = useState<AuthAccountFlow | null>(initialAuthLinkContext.flow);
  const [pendingInvitationToken, setPendingInvitationToken] = useState(initialAuthLinkContext.invitationToken);
  const activeBillingOrganizationId = state.organizations.find(organization => organization.isActive)?.id || '';
  const aiDrawerRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(aiDrawerRef, { active: isAiDrawerOpen, onClose: () => setIsAiDrawerOpen(false) });

  const isCompletingInvitation = Boolean(
    state.isLoggedIn
    && pendingInvitationToken
    && normalizedPathname === LOGIN_ROUTE,
  );
  const authRouteKey = state.isAuthResolved
    ? `${state.isLoggedIn ? 'in' : 'out'}|${authAccountFlow || ''}|${isCompletingInvitation ? 'invite' : ''}|${browserRoute}`
    : '';
  const isAuthRoutePending = state.isAuthResolved && resolvedAuthRouteKey !== authRouteKey;

  useEffect(() => {
    if (!state.isAuthResolved) return;
    if (authAccountFlow || isCompletingInvitation) {
      setResolvedAuthRouteKey(authRouteKey);
      return;
    }

    let cancelled = false;
    void import('../lib/authRouting').then(({ resolveAuthRoute }) => {
      if (cancelled) return;
      const target = resolveAuthRoute(browserRoute, state.isLoggedIn);
      if (!target) {
        if (
          state.isLoggedIn
          && normalizedPathname === DEFAULT_AUTHENTICATED_ROUTE
          && !state.currentUser.isMasterAdmin
          && !routeNamesWorkspaceModule(browserRoute)
        ) setActiveModule('portal');
        setResolvedAuthRouteKey(authRouteKey);
        return;
      }
      if (
        target.split(/[?#]/, 1)[0] === DEFAULT_AUTHENTICATED_ROUTE
        && !state.currentUser.isMasterAdmin
        && !routeNamesWorkspaceModule(target)
      ) setActiveModule('portal');
      replaceRoute(target);
    }).catch(() => {
      if (cancelled) return;
      const isPublic = ['/', '/welcome', '/pricing', '/terroir-pulse', '/reset-password', '/accept-invite']
        .includes(normalizedPathname);
      const fallbackTarget = state.isLoggedIn
        ? (normalizedPathname === '/' || normalizedPathname === LOGIN_ROUTE ? DEFAULT_AUTHENTICATED_ROUTE : null)
        : (normalizedPathname === LOGIN_ROUTE || isPublic ? null : LOGIN_ROUTE);
      if (fallbackTarget) replaceRoute(fallbackTarget);
      else {
        if (
          state.isLoggedIn
          && normalizedPathname === DEFAULT_AUTHENTICATED_ROUTE
          && !state.currentUser.isMasterAdmin
          && !routeNamesWorkspaceModule(browserRoute)
        ) setActiveModule('portal');
        setResolvedAuthRouteKey(authRouteKey);
      }
    });
    return () => { cancelled = true; };
  }, [
    authAccountFlow,
    authRouteKey,
    browserRoute,
    isCompletingInvitation,
    normalizedPathname,
    replaceRoute,
    state.currentUser.isMasterAdmin,
    state.isAuthResolved,
    state.isLoggedIn,
    setActiveModule,
  ]);

  // Keep the open destination and the address bar in step, so a screen can be
  // linked to, Back returns to the previous one, and a reload lands where the
  // user was. The master admin console is deliberately excluded: it has no
  // tenant workspace to address.
  useWorkspaceRoute({
    isActive: state.isLoggedIn && !state.currentUser.isMasterAdmin,
    activeModule: state.activeModule,
    activeTab: state.activeTab,
    setActiveModule: state.setActiveModule,
    setActiveTab: state.setActiveTab,
    passportLotId: state.passportLotId,
    setPassportLotId: state.setPassportLotId,
    selectedTankId: state.selectedTankId,
    setSelectedTankId: state.setSelectedTankId,
  });

  useEffect(() => {
    document.documentElement.lang = isKa ? 'ka' : 'en';
    document.title = isMarketingPage
      ? (isKa ? 'VinOS | ღვინის წარმოების ერთიანი სისტემა' : 'VinOS | The operating system for wine')
      : isTerroirPulsePage
      ? 'Terroir Pulse — VinOS'
      : (isKa ? 'VinOS — მარნის მართვა' : 'VinOS — Winery Management');
  }, [isKa, isMarketingPage, isTerroirPulsePage]);

  useEffect(() => {
    if (!state.isLoggedIn || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const findingId = (url.searchParams.get('aiFinding') || '').trim().slice(0, 160);
    if (!findingId) return;
    state.setActiveModule('gvino');
    state.setActiveTab('intelligence');
    setFocusedAiFindingId(findingId);
    url.searchParams.delete('aiFinding');
    replaceRoute(`${url.pathname}${url.search}${url.hash}`);
  }, [replaceRoute, state]);

  useEffect(() => {
    if (typeof window === 'undefined' || !initialAuthLinkContext.flow) return;
    if (initialAuthLinkContext.invitationToken) {
      try {
        localStorage.setItem(PENDING_INVITATION_TOKEN_KEY, initialAuthLinkContext.invitationToken);
      } catch {
        // Continue without persistence when storage is unavailable.
      }
    }
    replaceRoute(initialAuthLinkContext.flow === 'reset-password' ? '/reset-password' : '/accept-invite');
  }, [initialAuthLinkContext, replaceRoute]);

  useEffect(() => {
    const organizationId = activeBillingOrganizationId;
    if (!state.isLoggedIn || state.currentUser.isMasterAdmin || !organizationId) {
      setBillingEntitlements(null);
      return;
    }
    const controller = new AbortController();
    fetch('/api/billing/subscription', { signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Unable to load subscription entitlements.');
        setBillingEntitlements(data.entitlements || null);
      })
      .catch(error => {
        if (error?.name !== 'AbortError') setBillingEntitlements(null);
      });
    return () => controller.abort();
  }, [state.isLoggedIn, state.currentUser.isMasterAdmin, activeBillingOrganizationId]);

  const billingAllows = (feature: BillingFeature) => billingEntitlements?.[feature] !== false;

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

  const handleEndImpersonation = async () => {
    if (isEndingImpersonation) return;
    setIsEndingImpersonation(true);
    try {
      const response = await fetch('/api/admin/impersonate/stop', { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not end the support session.');
      }
      const { clearTenantCachedData } = await import('../lib/tenantCache');
      clearTenantCachedData(localStorage);
      localStorage.removeItem('vinea_curr_user');
      localStorage.removeItem('vinea_active_module');
      localStorage.removeItem('vinea_active_tab');
      window.location.reload();
    } catch (error) {
      state.setToastMessage(error instanceof Error ? error.message : 'Could not end the support session.');
      setIsEndingImpersonation(false);
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
    replaceRoute(LOGIN_ROUTE);
    setAuthAccountFlow(null);
  };

  const handleAuthFlowStateChange = (notice: AuthenticatedStateNotice) => {
    if (notice.reason === 'authentication-required') {
      rememberInvitation(notice.invitationToken);
      setAuthAccountFlow(null);
      replaceRoute(LOGIN_ROUTE);
      return;
    }
    clearPendingInvitation();
    if (typeof window !== 'undefined') {
      replaceRoute(DEFAULT_AUTHENTICATED_ROUTE);
      window.setTimeout(() => window.location.replace(DEFAULT_AUTHENTICATED_ROUTE), 650);
    }
  };

  const handleLogout = useCallback(async () => {
    clearPostLoginReturnTo();
    await handleAuthLogout();
    setActiveModule('portal');
    replaceRoute(LOGIN_ROUTE);
  }, [handleAuthLogout, replaceRoute, setActiveModule]);

  // Onboarding wizard toggling
  useEffect(() => {
    if (
      state.isLoggedIn
      && !state.currentUser.isMasterAdmin
      && (state.currentUser.registrationComplete === false || !state.currentUser.enabledModules)
    ) {
      setShowOnboarding(true);
    } else {
      setShowOnboarding(false);
    }
  }, [state.isLoggedIn, state.currentUser.isMasterAdmin, state.currentUser.enabledModules, state.currentUser.registrationComplete]);

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
    // The facade object is recreated as domain state changes; rerunning on the
    // whole object would turn this guard into an every-render effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoggedIn, state.currentUser.enabledModules, state.activeModule]);

  // Dark Mode State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cf_dark_mode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    if (isMarketingPage) {
      document.documentElement.classList.remove('dark');
    } else if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('cf_dark_mode', 'true');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('cf_dark_mode', 'false');
    }
  }, [darkMode, isMarketingPage]);

  // Registering/Login switch state
  const [isRegistering, setIsRegistering] = useState(() => (
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('register') === '1'
  ));
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
      state.setToastMessage(isKa ? 'ინტერნეტთან კავშირი აღდგა! ხდება სინქრონიზაცია...' : 'Connection restored! Synchronizing...');
      state.triggerSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
      state.setToastMessage(isKa ? 'კავშირი გაწყდა. მუშაობა გრძელდება ოფლაინ რეჟიმში.' : 'Connection lost. Operating in offline mode.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // Rebind only for localized messages. Winery-state actions are current
    // facade callbacks and must not churn browser listeners every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [isConflictResolutionOpen, setIsConflictResolutionOpen] = useState(true);

  useEffect(() => {
    setResolutions({});
    if (state.syncConflicts?.length) {
      setIsConflictResolutionOpen(true);
    }
  }, [state.syncConflicts]);

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
  // Same pattern for language: the telemetry poller below runs on a 15s
  // interval whose closure would otherwise pin the login-time language.
  const langRef = useRef(state.lang);
  langRef.current = state.lang;

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
              const isKa = langRef.current === 'ka';
              const titleEn = `Diagnose stuck fermentation in ${reading.tankId} (Lot ${reading.lotId})`;
              const titleKa = `გაჩერებული დუღილის დიაგნოსტიკა ${reading.tankId}-ში (პარტია ${reading.lotId})`;
              // Dedup against both languages so switching mid-session can't
              // re-create the same task under the other title.
              const hasTask = tasksRef.current.some(t => t.title === titleEn || t.title === titleKa);
              if (!hasTask) {
                state.handleAddNewTask(
                  isKa ? titleKa : titleEn,
                  'high',
                  new Date().toISOString().split('T')[0],
                  isKa
                    ? `გაჩერებული დუღილის განგაში რეალურ დროში IoT სენსორიდან. ტემპერატურა ${reading.temperature}°C, სიმკვრივე ${reading.density} SG, დღიური ვარდნა ${reading.dailySlope} SG/დღე (< 0.002 SG/დღე ზღვარი). დაუყოვნებლივ დაიწყეთ დუღილის აღდგენის პროცედურები.`
                    : `Stuck fermentation alert triggered by real-time IoT sensor. Temperature is ${reading.temperature}°C, density is ${reading.density} SG, and daily slope drop is ${reading.dailySlope} SG/day (< 0.002 SG/day threshold). Initiate warning restart procedures immediately.`
                );
                state.setToastMessage(isKa
                  ? `კრიტიკული: გაჩერებული დუღილი ${reading.tankId}-ზე!`
                  : `CRITICAL STUCK FERMENTATION DETECTED on ${reading.tankId}!`);
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
    // The polling lifecycle follows authentication; task deduplication reads
    // through refs, while facade identity changes on every domain update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoggedIn]);

  // Derived live alert feed for the notification center
  const alerts = useMemo(() => {
    const baseAlerts = computeAlerts({
      vessels: state.vessels,
      lots: state.lots,
      fermLogs: state.fermLogs,
      labLogs: state.labLogs,
      inventory: state.inventory,
      tasks: state.tasks,
      lang: state.lang
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
          title: state.lang === 'ka'
            ? `გაჩერებული დუღილი — ${name} (ტელემეტრია)`
            : `Stuck fermentation — ${name} (Telemetry)`,
          message: state.lang === 'ka'
            ? `სენსორმა დააფიქსირა სიმკვრივის ვარდნა ${t.dailySlope.toFixed(4)} SG/დღეში (< 0.002 SG/დღე ზღვარი). მიმდინარე SG: ${t.density}. ტემპერატურა: ${t.temperature}°C.`
            : `Sensor detected gravity drop rate of ${t.dailySlope.toFixed(4)} SG/day (< 0.002 SG/day threshold). Current SG: ${t.density}. Temperature: ${t.temperature}°C.`,
          relatedEntityType: 'lot',
          relatedEntityId: t.lotId,
          relatedLotId: t.lotId,
          relatedTankId: t.tankId
        });
      }
    });

    const combined = [...telemetryAlerts, ...baseAlerts];
    const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    return combined.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  }, [state.vessels, state.lots, state.fermLogs, state.labLogs, state.inventory, state.tasks, activeTelemetry, state.lang]);

  // Everything the intelligence layer reads, assembled once. Both the
  // contextual signal strip and the intelligence centre consume this
  // evaluation, so the rule engine runs once per state change, not per screen.
  const intelligenceData = useMemo(() => ({
    vessels: state.vessels,
    lots: state.lots,
    fermLogs: state.fermLogs,
    labLogs: state.labLogs,
    inventory: state.inventory,
    tasks: state.tasks,
    cellarOps: state.cellarOps,
    transfers: state.transfers,
    bottlingRuns: state.bottlingRuns,
    grapeIntakes: state.grapeIntakes,
    blocks: state.blocks,
    scoutings: state.scoutings,
    sprays: state.sprays,
    samplings: state.samplings,
    harvests: state.harvests,
    certifications: state.certificationRecords,
    salesOrders: state.salesOrders,
    companyProfile: state.companyProfile,
  }), [
    state.vessels, state.lots, state.fermLogs, state.labLogs, state.inventory, state.tasks,
    state.cellarOps, state.transfers, state.bottlingRuns, state.grapeIntakes, state.blocks,
    state.scoutings, state.sprays, state.samplings, state.harvests, state.certificationRecords,
    state.salesOrders, state.companyProfile,
  ]);

  const [intelligenceFindings, setIntelligenceFindings] = useState<AiFinding[]>([]);
  useEffect(() => {
    let active = true;
    if (!state.isLoggedIn) {
      setIntelligenceFindings([]);
      return () => { active = false; };
    }

    // The detectors are substantial but not required for the public/login
    // shell. Load them after authentication, then keep evaluating locally on
    // every relevant state change.
    void import('../lib/ai/rules').then(({ evaluateRules }) => {
      if (!active) return;
      setIntelligenceFindings(evaluateRules({
        ...intelligenceData,
        lang: state.lang,
        config: state.companyProfile.aiConfig,
      }).findings);
    });
    return () => { active = false; };
  }, [intelligenceData, state.lang, state.companyProfile.aiConfig, state.isLoggedIn]);

  const [aiNotificationFindings, setAiNotificationFindings] = useState<AiNotificationFinding[]>([]);
  const [aiNotificationStatus, setAiNotificationStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  useEffect(() => {
    if (!state.isLoggedIn || state.currentUser.isMasterAdmin) {
      locallyReadAiNotificationEvents.current.clear();
      setAiNotificationFindings([]);
      setAiNotificationStatus('ready');
      return;
    }

    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const response = await fetch(`/api/ai/notifications?lang=${state.lang}&limit=50`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json();
        if (cancelled) return;
        const received = Array.isArray(payload.findings) ? payload.findings : [];
        setAiNotificationFindings(received.map((finding: AiNotificationFinding) => (
          locallyReadAiNotificationEvents.current.has(
            `${finding.id}:${finding.notificationEventKey || ''}`,
          )
            ? { ...finding, unread: false }
            : finding
        )));
        setAiNotificationStatus('ready');
      } catch {
        if (!cancelled) setAiNotificationStatus('unavailable');
      } finally {
        inFlight = false;
      }
    };

    locallyReadAiNotificationEvents.current.clear();
    setAiNotificationFindings([]);
    setAiNotificationStatus('loading');
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onFindingsChanged = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('vinos:ai-findings-changed', onFindingsChanged);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('vinos:ai-findings-changed', onFindingsChanged);
    };
  }, [
    state.isLoggedIn,
    state.currentUser.isMasterAdmin,
    state.currentUser.username,
    activeBillingOrganizationId,
    state.lang,
  ]);

  const notificationItems = useMemo(
    () => buildNotificationFeed(alerts, aiNotificationFindings),
    [alerts, aiNotificationFindings],
  );

  const markAiNotificationRead = async (item: NotificationItem) => {
    if (item.source !== 'ai' || !item.findingId || !item.unread) return;
    const eventKey = item.notificationEventKey;
    const localEventKey = `${item.findingId}:${eventKey || ''}`;
    locallyReadAiNotificationEvents.current.add(localEventKey);
    setAiNotificationFindings((current) => current.map((finding) => (
      finding.id === item.findingId && finding.notificationEventKey === eventKey
        ? { ...finding, unread: false, readAt: new Date().toISOString() }
        : finding
    )));
    try {
      const response = await fetch(`/api/ai/notifications/${encodeURIComponent(item.findingId)}/read`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: state.lang }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      locallyReadAiNotificationEvents.current.delete(localEventKey);
      setAiNotificationFindings((current) => current.map((finding) => (
        finding.id === item.findingId && finding.notificationEventKey === eventKey
          ? { ...finding, unread: true, readAt: undefined }
          : finding
      )));
      state.setToastMessage(isKa
        ? 'შეტყობინების წაკითხულად მონიშვნა ვერ შეინახა.'
        : 'Could not save the notification as read.');
    }
  };

  const markAllAiNotificationsRead = async () => {
    const unreadEventKeys = new Map(
      aiNotificationFindings
        .filter((finding) => finding.unread !== false)
        .map((finding) => [finding.id, finding.notificationEventKey]),
    );
    if (unreadEventKeys.size === 0) return;
    for (const [findingId, eventKey] of unreadEventKeys) {
      locallyReadAiNotificationEvents.current.add(`${findingId}:${eventKey || ''}`);
    }
    const readAt = new Date().toISOString();
    setAiNotificationFindings((current) => current.map((finding) => (
      unreadEventKeys.has(finding.id)
        && unreadEventKeys.get(finding.id) === finding.notificationEventKey
        ? { ...finding, unread: false, readAt }
        : finding
    )));
    try {
      const response = await fetch('/api/ai/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: state.lang }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      for (const [findingId, eventKey] of unreadEventKeys) {
        locallyReadAiNotificationEvents.current.delete(`${findingId}:${eventKey || ''}`);
      }
      setAiNotificationFindings((current) => current.map((finding) => (
        unreadEventKeys.has(finding.id)
          && unreadEventKeys.get(finding.id) === finding.notificationEventKey
          ? { ...finding, unread: true, readAt: undefined }
          : finding
      )));
      state.setToastMessage(isKa
        ? 'შეტყობინებების წაკითხულად მონიშვნა ვერ შეინახა.'
        : 'Could not mark AI notifications as read.');
      throw new Error('Could not mark AI notifications as read.');
    }
  };

  const handleSelectNotification = (item: NotificationItem) => {
    if (item.source === 'ai' && item.findingId) {
      void markAiNotificationRead(item);
      state.setActiveModule('gvino');
      setFocusedAiFindingId(item.findingId);
      state.setActiveTab('intelligence');
      return;
    }
    // Stock alerts open the Materials module; everything else is a cellar tab.
    if (item.category === 'inventory') {
      state.setActiveModule('inventory');
      return;
    }
    const tabByCategory: Record<Exclude<Alert['category'], 'inventory'>, string> = {
      so2: 'labs',
      va: 'labs',
      lab: 'labs',
      fermentation: 'fermentation',
      temperature: 'vessels',
      cleaning: 'vessels',
      task: 'tasks',
    };
    state.setActiveModule('gvino');
    state.setActiveTab(item.category === 'intelligence' ? 'intelligence' : tabByCategory[item.category]);
  };

  // Close selected modal drawer on Escape key down for intuitive usability
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        state.setSelectedTankId(null);
        setIsAiDrawerOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !state.currentUser.isMasterAdmin) {
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
  // Sections group the cellar by what a person is doing, not by which register
  // owns the data. Every destination sits under a named heading: the previous
  // collapsible "More tools" group held eight unrelated tabs that could only be
  // found by hunting through it. Tab ids are untouched, so permissions, deep
  // links and the command palette keep working unchanged.
  const wineryTabGroups = [
    {
      id: 'overview',
      label: isKa ? 'მიმოხილვა' : 'Overview',
      tabs: [
        { id: 'dashboard', label: t.overview, icon: LayoutDashboard },
        { id: 'intelligence', label: t.ai_intelligence, icon: BrainCircuitIcon },
      ],
    },
    {
      id: 'wine',
      label: isKa ? 'ღვინის გზა' : 'Wine lifecycle',
      tabs: [
        { id: 'intake', label: t.grape_intake || 'Grape Intake', icon: Grape },
        { id: 'cellar', label: isKa ? 'მარანი' : 'Cellar workspace', icon: Wine },
        { id: 'bottling', label: t.bottling, icon: Package },
      ],
    },
    {
      id: 'production',
      label: isKa ? 'მიმდინარე წარმოება' : 'Current production',
      tabs: [
        { id: 'planner', label: isKa ? 'წარმოების გეგმა' : 'Production plan', icon: CalendarRange },
        { id: 'tasks', label: t.tasks, icon: ClipboardList },
        { id: 'operations', label: isKa ? 'მოვლა და გაზომვები' : 'Treatments & checks', icon: Workflow },
        { id: 'fermentation', label: t.fermentation, icon: Activity },
        { id: 'transfers', label: t.transfers, icon: GitCommit },
        { id: 'labs', label: t.lab_analysis, icon: TestTube },
      ],
    },
    {
      id: 'quality',
      label: isKa ? 'ხარისხი და მიკვლევადობა' : 'Quality & traceability',
      tabs: [
        { id: 'quality', label: isKa ? 'ხარისხი' : 'Quality SOPs', icon: ShieldCheck },
        { id: 'lineage', label: t.lineage || 'Lineage', icon: GitMerge },
        { id: 'notes', label: t.notes, icon: FileText },
      ],
    },
    {
      id: 'resources',
      label: isKa ? 'ხელსაწყოები' : 'Tools',
      tabs: [
        { id: 'calculators', label: t.calculators, icon: TestTube },
        { id: 'ai', label: t.ai_assistant, icon: BrainCircuitIcon },
      ],
    },
  ];
  const canViewModule = (moduleId: string, tabId?: string) => (
    canViewUserDestination(state.currentUser, moduleId, tabId)
  );
  const canViewWineryTasks = canViewModule('gvino', 'tasks');
  const canViewWineryPlanner = canViewModule('gvino', 'planner');
  const canViewWineryLots = canViewModule('gvino', 'lots');
  const canViewWineryVessels = canViewModule('gvino', 'vessels');
  const canViewWineryFermentation = canViewModule('gvino', 'fermentation');
  const activeWineryNavTab = state.activeTab === 'lots' || state.activeTab === 'vessels'
    ? 'cellar'
    : state.activeTab;
  const taskDeepLinkId = normalizedPathname === '/tasks'
    ? new URLSearchParams(browserRoute.slice(browserRoute.indexOf('?'))).get('task')?.trim() || undefined
    : undefined;
  const accessibleWineryTabGroups = wineryTabGroups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) => canViewModule('gvino', tab.id)),
    }))
    .filter((group) => group.tabs.length > 0);
  useEffect(() => {
    if (!state.isLoggedIn || !taskDeepLinkId) return;
    if (!canViewWineryTasks) {
      state.setToastMessage(isKa
        ? 'თქვენს როლს ამ დავალების ნახვის უფლება არ აქვს.'
        : 'Your workspace role cannot view this task.');
      return;
    }
    if (state.activeModule !== 'gvino') state.setActiveModule('gvino');
    if (state.activeTab !== 'tasks') state.setActiveTab('tasks');
    // The state facade is render-derived; the scalar dependencies are the
    // navigation events this deep-link repair handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.isLoggedIn,
    state.currentUser.role,
    state.currentUser.isMasterAdmin,
    state.lang,
    state.activeModule,
    state.activeTab,
    taskDeepLinkId,
  ]);
  const cellarPermissions = useMemo(
    () => cellarWorkflowPermissions(state.currentUser.role),
    [state.currentUser.role],
  );
  const vineyardPermissions = useMemo(
    () => vineyardWorkflowPermissions(state.currentUser.role),
    [state.currentUser.role],
  );
  const salesPermissions = useMemo(
    () => salesWorkflowPermissions(state.currentUser.role),
    [state.currentUser.role],
  );
  // A render prop, so it needs hoisting too: recreated inline it changed identity
  // on every App render and TanksVessels never got to skip one. Declared here
  // rather than with the other callbacks because it reads `cellarPermissions`.
  const renderQvevriRecords = useCallback(
    (onBackToVessels: () => void, focusedVesselId?: string | null) => (
      <QvevriPassportTab
        embedded
        onBackToVessels={onBackToVessels}
        activeVesselId={focusedVesselId}
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
    ),
    [
      state.lang, state.vessels, state.lots, state.fermLogs, state.cellarOps,
      state.certificationRecords, state.setVessels, state.setActiveTab,
      state.setSelectedTankId, state.setToastMessage, state.currentUser.fullName,
      cellarPermissions.vessels.canUpdateVessel,
    ],
  );

  const isCellarWorkspaceDestination = state.activeModule === 'gvino'
    && ['cellar', 'lots', 'vessels'].includes(state.activeTab);
  const activePermissionModule = isCellarWorkspaceDestination
    ? (canViewWineryLots ? 'lots' : 'vessels')
    : permissionModuleFor(state.activeModule, state.activeTab);
  const canManageCurrentArea = isCellarWorkspaceDestination
    ? canAccess(state.currentUser.role, 'lots', 'update')
      || canAccess(state.currentUser.role, 'vessels', 'create')
      || canAccess(state.currentUser.role, 'vessels', 'update')
    : canAccess(state.currentUser.role, activePermissionModule, 'create')
      || canAccess(state.currentUser.role, activePermissionModule, 'update');
  const shouldShowReadOnlyNotice = state.isLoggedIn
    && canViewModule(state.activeModule, state.activeTab)
    && !canManageCurrentArea
    && state.activeModule !== 'portal'
    && state.activeModule !== 'master-admin'
    && state.activeModule !== 'settings'
    && !(state.activeModule === 'gvino' && state.activeTab === 'dashboard');
  const moduleGroups = [
    {
      id: 'dashboard',
      label: t.today,
      icon: LayoutDashboard,
      primary: 'portal',
      modules: [
        { id: 'portal', label: t.today, icon: LayoutDashboard },
        { id: 'work', label: isKa ? 'სამუშაო რიგი' : 'Work Queue', icon: ListChecks },
      ],
    },
    {
      id: 'vineyard',
      label: isKa ? 'ვენახი' : 'Vineyard',
      icon: Sprout,
      primary: 'vazi',
      requires: 'vazi',
      modules: [{ id: 'vazi', label: t.nav_vazi || 'Vazi', icon: Sprout }],
    },
    {
      id: 'cellar',
      label: isKa ? 'მარანი' : 'Cellar',
      icon: Wine,
      primary: 'gvino',
      requires: 'gvino',
      modules: [{ id: 'gvino', label: t.nav_gvino || 'Gvino', icon: Wine }],
    },
    {
      // Ordered as goods actually move: materials in, then bought, then
      // bottled stock, then shipped — and recall, which reaches back through
      // all of it. Costs and Analytics used to sit here too; they report on
      // the business rather than running it, so they moved to Records.
      id: 'business',
      label: isKa ? 'მარაგი და გაყიდვები' : 'Stock & Sales',
      icon: BadgeDollarSign,
      primary: 'inventory',
      modules: [
        { id: 'inventory', label: isKa ? 'მასალები' : 'Materials', icon: Boxes },
        { id: 'procurement', label: isKa ? 'შესყიდვა' : 'Purchasing', icon: ShoppingCart },
        { id: 'storage', label: isKa ? 'მზა პროდუქცია' : 'Finished goods', icon: Warehouse },
        { id: 'sales', label: isKa ? 'შეკვეთები და გაგზავნა' : 'Orders & dispatch', icon: Truck },
        { id: 'recall', label: isKa ? 'პროდუქტის გაწვევა' : 'Product Recall', icon: AlertOctagon },
      ],
    },
    {
      // Everything you look up or produce a report from, rather than work in.
      id: 'documents',
      label: isKa ? 'ჩანაწერები' : 'Records',
      icon: FileSpreadsheet,
      primary: 'docs',
      modules: [
        { id: 'docs', label: t.nav_docs || 'Official Documents', icon: FileSpreadsheet },
        { id: 'certification', label: isKa ? 'სერტიფიცირება' : 'Certification', icon: BadgeCheck },
        { id: 'audit', label: t.nav_audit || 'Audit Trail', icon: FileText },
        { id: 'costs', label: t.nav_costs || 'Costs', icon: Coins },
        { id: 'analytics', label: t.nav_analytics || 'Analytics', icon: BarChart3 },
      ],
    },
    {
      id: 'settings',
      label: state.currentUser.isMasterAdmin ? 'System' : (t.nav_settings || 'Settings'),
      icon: state.currentUser.isMasterAdmin ? ShieldAlert : ClipboardList,
      primary: 'integrations',
      modules: [
        { id: 'integrations', label: isKa ? 'ინტეგრაციები' : 'Integration Hub', icon: PlugZap },
        { id: 'settings', label: t.nav_settings || 'Settings', icon: ClipboardList },
        { id: 'master-admin', label: 'System Console', icon: ShieldAlert },
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
  const activeWineryTab = accessibleWineryTabGroups
    .flatMap(group => group.tabs)
    .find(tab => tab.id === activeWineryNavTab);

  // One sidebar, three sources. The cellar lists its tabs, the vineyard lists
  // its own, and every other group lists the modules it contains — so the
  // navigation reads the same wherever you are.
  const workspaceNavSections: WorkspaceNavSection[] = activeModuleGroup.id === 'cellar'
    ? accessibleWineryTabGroups.map(group => ({
      id: group.id,
      label: group.label,
      items: group.tabs.map(tab => ({
        id: tab.id,
        label: tab.label,
        icon: tab.icon,
        active: activeWineryNavTab === tab.id,
        onSelect: () => state.setActiveTab(tab.id),
      })),
    }))
    : activeModuleGroup.id === 'vineyard'
      ? vaziNavigationGroups(state.lang)
        .map(group => ({
          id: group.id,
          label: group.label,
          items: group.items
            .filter(item => canViewModule('vazi', item.id))
            .map(item => ({
              id: item.id,
              label: item.label,
              icon: item.icon,
              active: vaziTab === item.id,
              onSelect: () => setVaziTab(item.id),
            })),
        }))
        .filter(group => group.items.length > 0)
      : [{
        id: activeModuleGroup.id,
        label: activeModuleGroup.label,
        items: activeModuleGroup.modules.map(mod => ({
          id: mod.id,
          label: mod.label,
          icon: mod.icon,
          active: state.activeModule === mod.id,
          onSelect: () => switchModule(mod.id),
        })),
      }];
  // Cellar-only context card pinned above the sidebar sections.
  const cellarFocusSummary = (
    <div className="app-sidebar-summary hidden lg:block mb-3 p-3 dark:border-stone-800 dark:bg-stone-900/90">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="block text-[9px] font-mono font-black uppercase tracking-[0.18em] text-stone-400">
            {isKa ? 'დღის ფოკუსი' : 'Today focus'}
          </span>
          <strong className="mt-1 block text-sm font-black text-stone-900 dark:text-amber-100">
            {activeWineryTab?.label || activeModuleGroup.label}
          </strong>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
          urgentAlertCount > 0
            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300'
            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
        }`}>
          {urgentAlertCount > 0 ? `${urgentAlertCount} ${isKa ? 'გადაუდებელი' : 'urgent'}` : (isKa ? 'სტაბილური' : 'steady')}
        </span>
      </div>
      {(canViewWineryTasks || canViewWineryFermentation) && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          {canViewWineryTasks && (
            <button type="button" onClick={() => state.setActiveTab('tasks')} className="flex min-h-9 items-center justify-between rounded-lg bg-stone-50 px-2.5 text-left font-bold text-stone-600 hover:bg-[#f5efe9] hover:text-[#4e0e15] dark:bg-stone-950/40 dark:text-stone-300">
              <span className="text-stone-400">{t.tasks || 'Tasks'}</span>
              <strong className="text-sm text-stone-900 dark:text-amber-100">{pendingTaskCount}</strong>
            </button>
          )}
          {canViewWineryFermentation && (
            <button type="button" onClick={() => state.setActiveTab('fermentation')} className="flex min-h-9 items-center justify-between rounded-lg bg-stone-50 px-2.5 text-left font-bold text-stone-600 hover:bg-[#f5efe9] hover:text-[#4e0e15] dark:bg-stone-950/40 dark:text-stone-300">
              <span className="text-stone-400">{isKa ? 'დუღილი' : 'Ferments'}</span>
              <strong className="text-sm text-stone-900 dark:text-amber-100">{activeFermsCount}</strong>
            </button>
          )}
        </div>
      )}
      {canViewWineryVessels && (
      <div className="mt-2.5">
        <div className="mb-1 flex items-center justify-between text-[9px] font-mono font-bold uppercase tracking-wide text-stone-400">
          <span>{isKa ? 'ტევადობა' : 'Capacity'}</span>
          <span>{cellarCapacityPct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
          <div
            className={`h-full rounded-full ${cellarCapacityPct > 85 ? 'bg-amber-500' : 'bg-[#4e0e15]'}`}
            style={{ width: `${Math.min(100, cellarCapacityPct)}%` }}
          />
        </div>
        <span className="mt-1.5 block text-[9px] font-semibold text-stone-400">
          {isKa
            ? `${occupiedTanksCount} დაკავებული ჭურჭელი · საშ. ${averageOccupiedTemp} °C`
            : `${occupiedTanksCount} occupied vessels · avg ${averageOccupiedTemp} °C`}
        </span>
      </div>
      )}
    </div>
  );
  const workspaceMobileLabel = activeModuleGroup.id === 'cellar'
    ? (isKa ? 'მარნის განყოფილება' : 'Winery section')
    : activeModuleGroup.id === 'vineyard'
      ? (isKa ? 'ვენახის განყოფილება' : 'Vineyard section')
      : activeModuleGroup.label;
  useEffect(() => {
    if (!state.isLoggedIn) return;
    if (state.activeModule === 'gvino' && state.activeTab === 'qvevri') {
      state.setActiveTab('vessels');
      return;
    }
    if (state.activeModule === 'gvino' && state.activeTab === 'control') {
      if (canViewModule('work')) state.setActiveModule('work');
      else {
        const fallbackTab = firstVisibleWineryTab(state.currentUser.role);
        if (fallbackTab) state.setActiveTab(fallbackTab);
      }
      return;
    }
    if (state.activeModule === 'gvino' && ['recall', 'procurement', 'inventory'].includes(state.activeTab)) {
      if (canViewModule(state.activeTab)) {
        state.setActiveModule(state.activeTab as 'recall' | 'procurement' | 'inventory');
        return;
      }
      const fallbackTab = firstVisibleWineryTab(state.currentUser.role);
      if (fallbackTab) state.setActiveTab(fallbackTab);
      return;
    }
    if (canViewModule(state.activeModule, state.activeTab)) return;
    if (state.activeModule === 'gvino') {
      const fallbackTab = firstVisibleWineryTab(state.currentUser.role);
      if (fallbackTab) {
        state.setActiveTab(fallbackTab);
        return;
      }
    }
    state.setActiveModule((moduleGroups[0]?.primary || 'portal') as any);
    // Navigation helpers and the state facade are render-derived. The scalar
    // route/role dependencies below are the events this repair effect handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoggedIn, state.currentUser.role, state.currentUser.isMasterAdmin, state.activeModule, state.activeTab]);

  // A role that cannot open the vineyard screen it last had is moved to one it
  // can, the same way the cellar repairs an unreachable tab above.
  useEffect(() => {
    if (!state.isLoggedIn) return;
    if (canViewModule('vazi', vaziTab)) return;
    const fallback = vaziNavigationGroups(state.lang)
      .flatMap(group => group.items)
      .find(item => canViewModule('vazi', item.id));
    if (fallback) setVaziTab(fallback.id);
    // canViewModule is render-derived; the scalar role/tab pair is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isLoggedIn, state.currentUser.role, vaziTab, state.lang]);

  const switchModule = (moduleId: string) => {
    state.setActiveModule(moduleId as any);
    if (moduleId === 'gvino') {
      state.setActiveTab('dashboard');
    }
  };
  const handleNavigate = (target: { module: string; tab?: string }) => {
    if (!canViewModule(target.module, target.tab)) {
      state.setToastMessage(isKa
        ? 'თქვენს როლს ამ განყოფილებაზე წვდომა არ აქვს.'
        : 'Your workspace role does not have access to that area.');
      return;
    }
    state.setActiveModule(target.module as any);
    if (target.tab) state.setActiveTab(target.tab);
  };
  const openWorkflowItem = useCallback((tab: string, targetId?: string) => {
    setWorkflowFocus(targetId ? { tab, targetId } : null);
    if (tab === 'recall') {
      setRecallFocusCaseId(targetId || '');
      setActiveModule('recall');
      return;
    }
    if (tab === 'procurement') {
      setActiveModule('procurement');
      return;
    }
    if (tab === 'control') {
      setActiveModule('work');
      return;
    }
    setActiveModule('gvino');
    setActiveTab(tab);
  }, [setActiveModule, setActiveTab]);

  const openProductionPlanWork = async (item: ProductionPlanItem) => {
    const { openProductionPlanItem } = await import('../lib/productionPlanNavigation');
    openProductionPlanItem(item, {
      lang: state.lang,
      harvests: state.harvests,
      navigate: (module, tab) => {
        if (!canViewModule(module, tab)) {
          state.setToastMessage(isKa
            ? 'თქვენს როლს ამ სამუშაო სივრცეზე წვდომა არ აქვს.'
            : 'Your workspace role does not have access to this work area.');
          return false;
        }
        state.setActiveModule(module as any);
        if (tab) state.setActiveTab(tab);
        return true;
      },
      setIntakeHarvestId: state.setPrefilledIntakeHarvestId,
      setTransfer: (sourceId, destinationId, volume) => {
        state.setPrefilledSourceId(sourceId);
        state.setPrefilledDestId(destinationId);
        setPrefilledTransferVolume(volume);
      },
      setLab: (lotId, vesselId) => {
        state.setLabLotId(lotId);
        state.setLabTankId(vesselId);
      },
      setSanitation: vesselId => {
        setPrefilledOpVesselId(vesselId);
        setPrefilledOpType('cleaning');
      },
      setTaskDraft: (title, priority, description) => {
        state.setPrefilledTaskTitle(title);
        state.setPrefilledTaskPriority(priority);
        state.setPrefilledTaskDesc(description);
      },
    });
  };

  // Loading gate — MUST come after every hook above. React requires an
  // unconditional, stable hook order across renders; early-returning before a
  // hook (as this block previously did, ahead of the module-access useEffect)
  // triggers "Rendered more hooks than during the previous render" once
  // isClient flips true and the extra hooks suddenly run.
  if (!state.isClient || !state.isAuthResolved || isAuthRoutePending) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8F5] text-[#2c241e]">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-800 mb-2" />
        <span className="text-xs font-semibold tracking-wide uppercase font-serif">{isKa ? 'VinOS ერთიანი პლატფორმა იტვირთება...' : 'Powering up VinOS Unified Platform...'}</span>
      </div>
    );
  }

  if (normalizedPathname === '/pricing') {
    return (
      <Suspense fallback={<ModuleLoader />}>
        <PricingPage
          lang={state.lang}
          isLoggedIn={state.isLoggedIn}
          currentRole={state.currentUser.role}
          onLanguageChange={(nextLang) => {
            state.setLang(nextLang);
            localStorage.setItem('vinea_lang', nextLang);
          }}
        />
      </Suspense>
    );
  }

  if (
    isMarketingPage
    && !authAccountFlow
  ) {
    return (
      <Suspense fallback={<ModuleLoader />}>
        <MarketingLanding />
      </Suspense>
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
                {isKa
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
                    state.setToastMessage(isKa ? 'კავშირი აღდგა! სინქრონიზაცია...' : 'Connection restored! Syncing...');
                    state.triggerSync();
                  } else {
                    state.setToastMessage(isKa ? 'კავშირი კვლავ არ არის.' : 'Still offline.');
                  }
                }
              }}
              className="px-2.5 py-1 bg-white hover:bg-stone-50 text-rose-700 rounded-lg text-[10px] font-black tracking-wide uppercase transition-all cursor-pointer shadow-3xs active:scale-95 shrink-0"
            >
              🔄 {isKa ? 'ხელახლა ცდა' : 'Retry'}
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
              {isKa
                ? 'ხელმისაწვდომია ახალი ვერსია.'
                : 'A new version of VinOS is ready.'}
            </span>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1 bg-white text-[#4e0e15] rounded-lg text-[10px] font-black tracking-wide uppercase cursor-pointer active:scale-95 transition-transform shrink-0"
            >
              {isKa ? 'განახლება' : 'Reload'}
            </button>
            <button
              onClick={() => setUpdateReady(false)}
              aria-label={isKa ? 'დახურვა' : 'Dismiss'}
              className="text-white/60 hover:text-white text-sm leading-none cursor-pointer shrink-0"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* overflow-x clipping lives on <body> (globals.css): an overflow value
          on this wrapper would break position:sticky for the floating header */}
      <div className="app-shell min-h-screen flex flex-col font-sans relative transition-colors duration-300">

      {/* Keep the expressive backdrop for entry screens; the working app stays quiet. */}
      {!state.isLoggedIn && <AuroraBackdrop variant="rich" shouldReduceMotion={perf.shouldReduceMotion} />}

      {/* Dynamic Toast Alerts instead of blocking alerts inside nested components.
          Subscribes to the toast context on its own so a raise/dismiss does not
          re-render this shell or the open module. */}
      <Suspense fallback={null}>
        <StatusToastHost lang={state.lang} onTroubleshoot={openSyncTroubleshooter} />
      </Suspense>

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

      {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
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

      {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
        <Suspense fallback={null}>
          <ScanToAction
            open={isScannerOpen}
            lang={state.lang}
            vesselIds={scanVesselIds}
            lotIds={scanLotIds}
            onResolve={handleScanResolve}
            onClose={closeScanner}
          />
        </Suspense>
      )}

      {/* Restore handle shown while retracted (manual click only) */}
      {headerHidden && (
        <button
          onClick={() => setHeaderHidden(false)}
          className="fixed top-1.5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-3 py-1 bg-[#4e0e15]/90 backdrop-blur text-amber-50 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-lg cursor-pointer hover:bg-[#4e0e15] animate-fade-in"
          title={isKa ? 'მენიუს ჩვენება' : 'Show menu'}
        >
          <ChevronDown className="w-3.5 h-3.5" /> {isKa ? 'მენიუ' : 'Menu'}
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
        className="app-header-shell sticky top-0 z-40"
      >
      <header
        ref={navRef}
        style={{
          transform: showHeader ? 'translateY(0)' : 'translateY(-130%)',
          opacity: showHeader ? 1 : 0,
          pointerEvents: showHeader ? 'auto' : 'none',
          transition: 'transform 0.34s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease',
        }}
        className="app-header relative z-20 max-w-[1600px] w-full mx-auto px-3 md:px-5 py-2 flex items-center gap-2">

        {/* Brand mark */}
        <button
          onClick={() => state.setActiveModule('portal')}
          className="shrink-0 w-9 h-9 bg-[#651522] text-white rounded-[10px] flex items-center justify-center cursor-pointer transition-colors hover:bg-[#7a1c2b]"
          title="VinOS"
          aria-label="VinOS home"
        >
          <Wine className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
        <span className="hidden xl:block text-sm tracking-tight text-stone-900 font-extrabold dark:text-stone-100 shrink-0">VinOS</span>

        {/* LEFT — module navigation */}
        {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
          <>
            {/* Desktop: inline module tabs, with dropdown submenus for grouped areas */}
            <nav aria-label={isKa ? 'მოდულების ნავიგაცია' : 'Module navigation'} className="hidden md:flex items-center gap-0.5 min-w-0">
              {moduleGroups.filter(g => g.id !== 'settings').map(group => {
                const Icon = group.icon;
                const isActive = activeModuleGroup.id === group.id;
                const hasSub = group.modules.length > 1;
                const tabClass = `relative px-3 py-2 rounded-[10px] flex items-center gap-1.5 cursor-pointer transition-colors duration-150 font-bold text-[11px] ${isActive ? 'text-[#651522] dark:text-amber-100' : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'}`;
                const pill = isActive ? (
                  <motion.span layoutId="module-nav-pill" className="absolute inset-0 bg-[#f0e6e8] rounded-[10px] dark:bg-[#3a171d]" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />
                ) : null;
                if (!hasSub) {
                  return (
                    <button key={group.id} onClick={() => switchModule(group.primary)} title={group.label} aria-label={group.label} aria-current={isActive ? 'page' : undefined} className={tabClass}>
                      {pill}
                      <Icon className={`relative z-10 w-3.5 h-3.5 ${isActive ? 'text-[#651522] dark:text-amber-200' : 'text-stone-500 dark:text-stone-400'}`} />
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
                      <Icon className={`relative z-10 w-3.5 h-3.5 ${isActive ? 'text-[#651522] dark:text-amber-200' : 'text-stone-500 dark:text-stone-400'}`} />
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
                aria-label={isKa ? 'მენიუ' : 'Menu'}
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
          {!isTerroirPulsePage && !state.currentUser.isMasterAdmin && (
            <Suspense fallback={null}><SyncStatus lang={state.lang} /></Suspense>
          )}

          {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="min-h-10 min-w-10 rounded-xl border border-stone-200 bg-stone-50 p-2 text-stone-600 transition-colors hover:border-[#4e0e15]/30 hover:bg-white hover:text-[#651522] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
              title={isKa ? 'ჭურჭლის ან პარტიის სკანირება' : 'Scan vessel or lot'}
              aria-label={isKa ? 'ჭურჭლის ან პარტიის სკანირება' : 'Scan vessel or lot'}
            >
              <ScanLine className="h-4 w-4" />
            </button>
          )}

          {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
            <button
              type="button"
              onClick={() => setIsCommandOpen(true)}
              className="hidden xl:flex items-center gap-2 w-40 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left text-[11px] font-semibold text-stone-500 shadow-2xs transition-colors hover:border-[#4e0e15]/30 hover:bg-white hover:text-stone-800 dark:bg-stone-900 dark:border-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-amber-100"
              title={isKa ? 'ყველაფრის ძიება' : 'Search everything'}
            >
              <Search className="w-3.5 h-3.5 text-[#4e0e15] dark:text-amber-300" />
              <span className="flex-1 truncate">{isKa ? 'ძიება…' : 'Search…'}</span>
              <kbd className="rounded-md border border-stone-200 bg-white px-1.5 py-0.5 text-[9px] font-black text-stone-600 dark:bg-stone-950 dark:border-stone-700 dark:text-stone-300">⌘K</kbd>
            </button>
          )}

          <Suspense fallback={null}><InstallButton lang={state.lang} /></Suspense>

          {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
            <Suspense fallback={null}>
              <NotificationCenter
                items={notificationItems}
                aiStatus={aiNotificationStatus}
                onMarkAllAiRead={markAllAiNotificationsRead}
                onSelect={handleSelectNotification}
                lang={state.lang}
                preferenceScopeKey={`${state.currentUser.username}:${activeBillingOrganizationId}`}
              />
            </Suspense>
          )}

          {/* Settings menu — theme, language, settings/integration links, hide bar */}
          {state.isLoggedIn && (
            <div className="relative">
              <button
                onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
                aria-label={isKa ? 'პარამეტრები' : 'Settings menu'}
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
                        {darkMode ? (isKa ? 'ნათელი თემა' : 'Light theme') : (isKa ? 'მუქი თემა' : 'Dark theme')}
                      </span>
                    </button>

                    {/* Language */}
                    <div className="px-3 py-2">
                      <div className="flex items-center gap-2 mb-1.5 text-[9px] font-black uppercase tracking-widest text-stone-500 dark:text-stone-400">
                        <Languages className="w-3 h-3" />{isKa ? 'ენა' : 'Language'}
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
                    {canViewModule('master-admin') && (
                      <button role="menuitem" onClick={() => { switchModule('master-admin'); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800">
                        <ShieldAlert className="w-4 h-4 text-[#4e0e15] dark:text-cyan-300" />System Console
                      </button>
                    )}
                    {canViewModule('integrations') && (
                      <button role="menuitem" onClick={() => { switchModule('integrations'); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800">
                        <PlugZap className="w-4 h-4 text-[#4e0e15] dark:text-amber-300" />{isKa ? 'ინტეგრაციები' : 'Integration Hub'}
                      </button>
                    )}

                    <div className="my-1 border-t border-stone-200/70 dark:border-stone-800" />
                    <button role="menuitem" onClick={() => { setHeaderHidden(true); setOpenMenu(null); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-bold cursor-pointer text-stone-700 hover:bg-[#FAF8F5] dark:text-stone-200 dark:hover:bg-stone-800">
                      <ChevronUp className="w-4 h-4 text-stone-400" />{isKa ? 'ზოლის დამალვა' : 'Hide menu bar'}
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
                onClick={() => { void handleLogout(); }}
                aria-label={isKa ? 'გამოსვლა' : 'Log Out'}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-stone-200 bg-[#faf8f6] p-0 text-[10px] font-mono font-extrabold uppercase tracking-wider text-[#801323] shadow-2xs transition-all duration-150 hover:bg-rose-50/50 sm:min-h-0 sm:min-w-0 sm:px-3 sm:py-2 dark:bg-stone-900 dark:border-stone-800 dark:text-rose-300"
                title={isKa ? 'გამოსვლა' : 'Log Out'}
              >
                <LogOut className="h-4 w-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">{t.nav_logout || 'Logout'}</span>
              </motion.button>
            </div>
          )}
        </div>
      </header>
      {state.currentUser.impersonatedBy && (
        <div role="status" className="relative max-w-[1600px] w-full mx-auto px-4 py-2.5 border-x border-b border-cyan-200 bg-cyan-50 text-xs font-semibold text-cyan-950 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100 flex flex-wrap items-center justify-between gap-3">
          <span>
            Support session: viewing the app as <strong>{state.currentUser.fullName}</strong>. Started by {state.currentUser.impersonatedBy}.
          </span>
          <button
            type="button"
            disabled={isEndingImpersonation}
            onClick={handleEndImpersonation}
            className="rounded-lg border border-cyan-400 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-cyan-900 transition-colors hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60 dark:border-cyan-700 dark:bg-cyan-950 dark:text-cyan-100"
          >
            {isEndingImpersonation ? 'Returning…' : 'Return to admin'}
          </button>
        </div>
      )}
      {shouldShowReadOnlyNotice && (
        <div role="status" className="relative max-w-[1600px] w-full mx-auto px-4 py-2 border-x border-b border-amber-200 bg-amber-50 text-[10px] font-mono font-bold uppercase tracking-wide text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {isKa ? 'ამ განყოფილებაში მხოლოდ ნახვა შეგიძლიათ' : 'View-only access in this area'}: {activePermissionModule.replace(/_/g, ' ')}
        </div>
      )}
      </motion.div>

      {/* 2. Main Shell Layout */}
      {isTerroirPulsePage ? (
        <Suspense fallback={<ModuleLoader />}>
          <TerroirPulsePage lang={state.lang} isLoggedIn={state.isLoggedIn} />
        </Suspense>
      ) : authAccountFlow ? (
        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-gradient-to-b from-[#f8f6f2] to-[#ece5dd] min-h-[82vh] dark:from-[#0d0b09] dark:to-[#1a1512]">
          <Suspense fallback={<ModuleLoader />}>
            <AuthAccountFlows
              lang={isKa ? 'ka' : 'en'}
              flow={authAccountFlow}
              resetToken={initialAuthLinkContext.resetToken}
              username={initialAuthLinkContext.username}
              invitationToken={pendingInvitationToken}
              isAuthenticated={state.isLoggedIn}
              onReturnToSignIn={handleAuthFlowReturn}
              onAuthenticatedStateChange={handleAuthFlowStateChange}
            />
          </Suspense>
        </div>
      ) : !state.isLoggedIn ? (
        <div className="flex-1 flex items-stretch justify-center p-4 sm:p-8 min-h-[82vh]">
          <div className="my-auto grid w-full max-w-xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_18px_50px_-30px_rgba(28,25,23,0.45)] animate-fade-in dark:border-stone-800 dark:bg-stone-950">
            <div className="p-7 sm:p-10 flex flex-col justify-center bg-white text-stone-600 space-y-5 dark:bg-stone-900">
              {/* Compact product identity */}
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-[10px] bg-[#651522] text-white flex items-center justify-center">
                  <Wine className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="font-black tracking-tight text-stone-900 dark:text-stone-100">VinOS</div>
                  <div className="text-[10px] font-medium text-stone-500">{isKa ? 'ვენახიდან ბოთლამდე' : 'Vineyard to bottle'}</div>
                </div>
              </div>

              {state.verificationPending && (
                <div role="status" aria-live="polite" className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-950/30 dark:border-amber-900/60">
                  <div className="flex items-start gap-2.5">
                    <MailCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                        {state.verificationPending.approvalOnly
                          ? (isKa ? 'ანგარიში დასამტკიცებელია' : 'Waiting for approval')
                          : (isKa ? 'დაადასტურეთ ელფოსტა' : 'Verify your email')}
                      </h3>
                      {!state.verificationPending.approvalOnly && (
                        <p className="text-[12px] text-amber-800/90 mt-0.5 dark:text-amber-200/80">
                          {isKa
                            ? 'გამოგიგზავნეთ დადასტურების ბმული მისამართზე '
                            : 'We sent a confirmation link to '}
                          <strong className="break-all">{state.verificationPending.email}</strong>
                          {isKa ? '. გახსენით ბმული ანგარიშის გასააქტიურებლად.' : '. Open it to activate your account.'}
                        </p>
                      )}
                      {state.verificationPending.requiresApproval && (
                        <p className="text-[12px] text-amber-800/90 mt-1.5 dark:text-amber-200/80">
                          {isKa
                            ? 'თქვენი მოთხოვნა გადაეგზავნა ადმინისტრატორს. შესვლა შესაძლებელი იქნება დამტკიცების შემდეგ — შეტყობინებას ელფოსტაზე მიიღებთ.'
                            : 'Your request was sent to the administrator for approval. Sign-in unlocks once it is approved — we will email you either way.'}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 mt-2.5">
                        {!state.verificationPending.approvalOnly && (
                          <button
                            type="button"
                            onClick={() => state.handleResendVerification(state.verificationPending!.email)}
                            className="text-[11px] font-bold uppercase tracking-wide text-amber-900 bg-amber-200/70 hover:bg-amber-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                          >
                            {isKa ? 'ხელახლა გაგზავნა' : 'Resend link'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => state.setVerificationPending(null)}
                          className="text-[11px] font-semibold text-amber-800/70 hover:text-amber-900 cursor-pointer"
                        >
                          {isKa ? 'დახურვა' : 'Dismiss'}
                        </button>
                      </div>
                      {state.verificationPending.devVerifyUrl && (
                        <a
                          href={state.verificationPending.devVerifyUrl}
                          className="block mt-2.5 text-[10px] font-mono text-amber-700 underline break-all"
                        >
                          {isKa ? 'დეველოპერ ბმული: ' : 'Dev link: '}{state.verificationPending.devVerifyUrl}
                        </a>
                      )}
                      {state.verificationPending.devApprovalUrl && (
                        <a
                          href={state.verificationPending.devApprovalUrl}
                          className="block mt-1.5 text-[10px] font-mono text-amber-700 underline break-all"
                        >
                          {isKa ? 'დეველოპერ დამტკიცება: ' : 'Dev approval link: '}{state.verificationPending.devApprovalUrl}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {isRegistering ? (
                <Suspense fallback={<ModuleLoader />}>
                  <RegistrationPanel
                    lang={isKa ? 'ka' : 'en'}
                    error={state.loginError}
                    submitting={authSubmitting}
                    onGoogle={() => {
                      window.location.href = '/api/auth/google/login';
                    }}
                    onSignIn={() => {
                      setIsRegistering(false);
                      state.setLoginError(null);
                    }}
                    onLanguageChange={nextLang => {
                      state.setLang(nextLang);
                      localStorage.setItem('vinea_lang', nextLang);
                    }}
                    onSubmit={async submission => {
                      if (authSubmitting) return;
                      setAuthSubmitting(true);
                      state.setLoginError(null);
                      try {
                        const registered = await state.handleAuthRegister({
                          email: submission.email,
                          fullName: `${submission.firstName} ${submission.lastName}`.trim(),
                          passcode: submission.passcode,
                          language: isKa ? 'ka' : 'en',
                          rememberMe: true,
                          companyProfile: {
                            companyName: submission.companyName,
                            contactEmail: submission.email,
                            phone: submission.phone,
                            measurementUnits: 'metric',
                            currency: 'GEL',
                          },
                          enabledModules: ['vazi', 'gvino'],
                          enabledWidgets: ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks'],
                        });
                        if (registered) setIsRegistering(false);
                      } finally {
                        setAuthSubmitting(false);
                      }
                    }}
                  />
                </Suspense>
              ) : (
                <Suspense fallback={<ModuleLoader />}>
                  <SignInPanel
                    lang={isKa ? 'ka' : 'en'}
                    error={state.loginError}
                    submitting={authSubmitting}
                    demoEnabled={state.demoLoginEnabled}
                    invitationPending={Boolean(pendingInvitationToken)}
                    onLanguageChange={nextLang => {
                      state.setLang(nextLang);
                      localStorage.setItem('vinea_lang', nextLang);
                    }}
                    onForgotPassword={() => {
                      state.setLoginError(null);
                      setAuthAccountFlow('forgot-password');
                    }}
                    onRegister={() => {
                      setIsRegistering(true);
                      state.setLoginError(null);
                    }}
                    onGoogle={() => {
                      window.location.href = '/api/auth/google/login';
                    }}
                    onDemo={async () => {
                      if (authSubmitting) return;
                      setAuthSubmitting(true);
                      try {
                        const success = await state.handleDemoLogin();
                        if (success) {
                          if (pendingInvitationToken) {
                            setAuthAccountFlow('accept-invite');
                            replaceRoute('/accept-invite');
                          } else {
                            state.setActiveModule('portal');
                          }
                        }
                      } finally {
                        setAuthSubmitting(false);
                      }
                    }}
                    onSubmit={async submission => {
                      if (authSubmitting) return;
                      setAuthSubmitting(true);
                      try {
                        const success = await state.handleAuthLogin(
                          submission.identifier,
                          submission.passcode,
                          submission.rememberMe,
                        );
                        if (success) {
                          if (pendingInvitationToken) {
                            setAuthAccountFlow('accept-invite');
                            replaceRoute('/accept-invite');
                          } else {
                            state.setActiveModule('portal');
                          }
                        }
                      } finally {
                        setAuthSubmitting(false);
                      }
                    }}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      ) : state.currentUser.isMasterAdmin ? (
        <Suspense fallback={<ModuleLoader />}>
          <MasterAdminPortal
            lang={state.lang}
            currentUser={state.currentUser}
            onClose={() => { void handleLogout(); }}
            setToastMessage={state.setToastMessage}
          />
        </Suspense>
      ) : (
        <WorkspaceShell
          sections={workspaceNavSections}
          mobileLabel={workspaceMobileLabel}
          sectionsLabel={isKa ? 'განყოფილებები' : 'Sections'}
          collapseLabel={isKa ? 'მენიუს ჩაკეცვა' : 'Collapse menu'}
          expandLabel={isKa ? 'მენიუს გაშლა' : 'Expand menu'}
          collapsed={state.isSidebarCollapsed}
          onToggleCollapsed={() => state.setIsSidebarCollapsed(!state.isSidebarCollapsed)}
          summary={activeModuleGroup.id === 'cellar' ? cellarFocusSummary : undefined}
        >
        {state.activeModule === 'vazi' ? (
          <Suspense fallback={<ModuleLoader />}>
            <VaziModule
              activeTab={vaziTab}
              onTabChange={setVaziTab}
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
              onPrepareHarvestIntake={state.setPrefilledIntakeHarvestId}
              onAddIrrigation={state.handleAddIrrigation}
              onAddFertilizer={state.handleAddFertilizer}
              setActiveModule={state.setActiveModule}
              setActiveTab={state.setActiveTab}
              onNavigate={handleNavigate}
              setPrefilledTaskTitle={state.setPrefilledTaskTitle}
              setPrefilledTaskPriority={state.setPrefilledTaskPriority}
              setPrefilledTaskDesc={state.setPrefilledTaskDesc}
              canCreateVineyardRecord={vineyardPermissions.canCreateVineyardRecord}
              canUpdateVineyardRecord={vineyardPermissions.canUpdateVineyardRecord}
              canDeleteVineyardRecord={vineyardPermissions.canDeleteVineyardRecord}
              canCreateVineyardProject={vineyardPermissions.canCreateVineyardProject}
              canUpdateVineyardProject={vineyardPermissions.canUpdateVineyardProject}
              canDispatchHarvestToGvino={vineyardPermissions.canDispatchHarvestToGvino
                && cellarPermissions.intake.canReceiveGrapes
                && cellarPermissions.intake.canLinkHarvest}
              canCreateTask={vineyardPermissions.canCreateTask}
            />
          </Suspense>
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
            qualitySops={state.qualitySops}
            purchaseOrders={state.purchaseOrders}
            productionPlans={state.productionPlans}
            recallCases={state.recallCases}
            onToggleTaskStatus={state.handleToggleTaskStatus}
            setActiveModule={state.setActiveModule}
            setActiveTab={state.setActiveTab}
            onOpenOnboarding={openOnboarding}
            onOpenWorkItem={openWorkflowItem}
          />
        </Suspense>
      ) : state.activeModule === 'work' ? (
        <>
          <Suspense fallback={<ModuleLoader />}>
            <OperationsControlTab
              lang={state.lang}
              currentUsername={state.currentUser.username}
              currentUserName={state.currentUser.fullName}
              currentRole={state.currentUser.role}
              tasks={state.tasks}
              qualitySops={state.qualitySops}
              purchaseOrders={state.purchaseOrders}
              productionPlans={state.productionPlans}
              recallCases={state.recallCases}
              queueVisibility={{
                tasks: canViewWineryTasks,
                sops: canViewModule('gvino', 'quality'),
                purchaseOrders: canViewModule('procurement'),
                productionPlans: canViewWineryPlanner,
                approvals: state.currentUser.role === 'Owner/Admin' ? 'all' : 'own',
                recalls: canViewModule('recall'),
                includeTeamWork: state.currentUser.role === 'Owner/Admin',
              }}
              focusApprovalId={workflowFocus?.tab === 'control' ? workflowFocus.targetId : undefined}
              onNavigate={openWorkflowItem}
              setToastMessage={state.setToastMessage}
            />
          </Suspense>
        </>
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
            onUpdateCompany={state.setCompanyProfile}
            pricing={state.winePricing}
            onUpdatePricing={state.setWinePricing}
            onNavigate={handleNavigate}
            canCreateCost={canAccess(state.currentUser.role, 'costs', 'create') && billingAllows('production_cost_tracking')}
            canDeleteCost={canAccess(state.currentUser.role, 'costs', 'delete') && billingAllows('production_cost_tracking')}
            canUpdatePricing={canAccess(state.currentUser.role, 'sales', 'update')}
            canExportCosts={canAccess(state.currentUser.role, 'costs', 'export') && canAccess(state.currentUser.role, 'sales', 'export') && billingAllows('advanced_reports')}
            canManageAutomation={canAccess(state.currentUser.role, 'costs', 'update') && billingAllows('production_cost_tracking')}
          />
        </Suspense>
      ) : state.activeModule === 'inventory' ? (
        <Suspense fallback={<ModuleLoader />}>
          <InventoryTab
            lang={state.lang}
            inventory={state.inventory}
            cellarOps={state.cellarOps}
            onUpdateInventory={state.setInventory}
            canCreateInventory={canAccess(state.currentUser.role, 'inventory', 'create')}
            canUpdateInventory={canAccess(state.currentUser.role, 'inventory', 'update')}
            canDeleteInventory={canAccess(state.currentUser.role, 'inventory', 'delete')}
            canPostInvoiceCosts={canAccess(state.currentUser.role, 'costs', 'create') && billingAllows('data_import_export')}
            accountingCurrency={state.companyProfile.currency || 'GEL'}
            onApplyInvoiceReceiptCommandResponse={state.applyInvoiceReceiptCommandResponse}
            onOpenProcurement={openProcurement}
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
            dispatches={state.salesDispatches}
            onUpdateLocations={state.setStorageLocations}
            onUpdateMovements={state.setStockMovements}
            onUpdateBottlingRuns={state.setBottlingRuns}
            onApplyStorageMovementCommandResponse={state.applyStorageMovementCommandResponse}
            currentUserName={state.currentUser.fullName || state.currentUser.username}
            onDeleteLocation={state.handleDeleteStorageLocation}
            onDeleteMovement={state.handleDeleteStockMovement}
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
            onApplySalesStockCommandResponse={state.applySalesStockCommandResponse}
            currency={state.companyProfile.currency || 'GEL'}
            currentUserName={state.currentUser.fullName}
            setToastMessage={state.setToastMessage}
            onNavigate={handleNavigate}
            canCreateOrder={salesPermissions.canCreateOrder}
            canUpdateOrder={salesPermissions.canUpdateOrder}
            canCreateDispatch={salesPermissions.canCreateDispatch}
            canReverseDispatch={salesPermissions.canReverseDispatch}
            canCreateStockMovement={salesPermissions.canCreateStockMovement}
            canViewCosts={salesPermissions.canViewCosts}
            canViewStorage={salesPermissions.canViewStorage}
            canViewBottling={salesPermissions.canViewBottling}
          />
        </Suspense>
      ) : state.activeModule === 'recall' ? (
        <>
          <Suspense fallback={<ModuleLoader />}>
            <RecallCockpitTab
              lang={state.lang}
              currentUsername={state.currentUser.username}
              currentUserName={state.currentUser.fullName}
              lots={state.lots}
              grapeIntakes={state.grapeIntakes}
              harvests={state.harvests}
              vessels={state.vessels}
              bottlingRuns={state.bottlingRuns}
              cellarOps={state.cellarOps}
              transfers={state.transfers}
              storageLocations={state.storageLocations}
              stockMovements={state.stockMovements}
              salesOrders={state.salesOrders}
              salesDispatches={state.salesDispatches}
              tasks={state.tasks}
              recallCases={state.recallCases}
              focusCaseId={recallFocusCaseId}
              onUpdateRecallCases={state.setRecallCases}
              onAddTask={state.handleAddNewTask}
              canManage={canAccess(state.currentUser.role, 'recall', 'update')}
              canCreateTasks={canAccess(state.currentUser.role, 'tasks', 'create')}
              setToastMessage={state.setToastMessage}
            />
          </Suspense>
        </>
      ) : state.activeModule === 'procurement' ? (
        <>
          <Suspense fallback={<ModuleLoader />}>
            <ProcurementTab
              lang={state.lang}
              currentUsername={state.currentUser.username}
              accountingCurrency={state.companyProfile.currency || 'GEL'}
              inventory={state.inventory}
              purchaseOrders={state.purchaseOrders}
              onUpdatePurchaseOrders={state.setPurchaseOrders}
              onApplyInvoiceReceiptCommandResponse={state.applyInvoiceReceiptCommandResponse}
              canCreate={canAccess(state.currentUser.role, 'procurement', 'create')}
              canUpdate={canAccess(state.currentUser.role, 'procurement', 'update')}
              canReceive={canAccess(state.currentUser.role, 'inventory', 'update') && canAccess(state.currentUser.role, 'costs', 'create')}
              focusOrderId={workflowFocus?.tab === 'procurement' ? workflowFocus.targetId : undefined}
              setToastMessage={state.setToastMessage}
            />
          </Suspense>
        </>
      ) : state.activeModule === 'analytics' ? (
        billingAllows('advanced_reports') ? (
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
        ) : (
          <>
            <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950/30">
              <BarChart3 className="mx-auto h-10 w-10 text-amber-700 dark:text-amber-300" />
              <h2 className="mt-4 font-serif text-2xl font-semibold text-stone-950 dark:text-white">{isKa ? 'გაფართოებული ანგარიშები' : 'Advanced reports'}</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-stone-600 dark:text-stone-300">{isKa ? 'წლების შედარება და მარჟის გაფართოებული ანალიზი ხელმისაწვდომია Professional გეგმიდან.' : 'Year comparison and advanced margin analysis are available on the Professional plan and above.'}</p>
              <button type="button" onClick={() => window.location.assign('/pricing')} className="mt-5 min-h-11 rounded-xl bg-[#651522] px-5 text-xs font-black text-white">{isKa ? 'გეგმების ნახვა' : 'View plans'}</button>
            </div>
          </>
        )
      ) : state.activeModule === 'docs' ? (
        <Suspense fallback={<ModuleLoader />}>
          <OfficialDocsTab
            lang={state.lang}
            company={state.companyProfile}
            currentUser={state.currentUser}
            blocks={state.blocks}
            lots={state.lots}
            vessels={state.vessels}
            transfers={state.transfers}
            harvests={state.harvests}
            samplings={state.samplings}
            inventory={state.inventory}
            labLogs={state.labLogs}
            grapeIntakes={state.grapeIntakes}
            cellarOps={state.cellarOps}
            bottlingRuns={state.bottlingRuns}
            salesDispatches={state.salesDispatches}
            inventoryMovements={state.inventoryMovements}
            invoiceReceipts={state.invoiceReceipts}
            attachments={state.attachments}
            onAddAttachment={state.handleAddAttachment}
            onDeleteAttachment={state.handleDeleteAttachment}
            canManageOfficialDocs={canAccess(state.currentUser.role, 'official_docs', 'create') || canAccess(state.currentUser.role, 'official_docs', 'update')}
          />
        </Suspense>
      ) : (
        <>
            {!canViewModule('gvino', state.activeTab) ? (
              <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                {isKa
                  ? 'თქვენს როლს ამ განყოფილებაზე წვდომა არ აქვს. ხელმისაწვდომ განყოფილებაზე გადაგიყვანთ.'
                  : 'Your workspace role cannot open this area. Redirecting to an available section.'}
              </div>
            ) : (
            <Suspense fallback={<ModuleLoader />}>

            {/* Contextual intelligence: appears only when this screen's own
                area has something at warning severity or above. */}
            {state.activeTab !== 'intelligence' && (
              <Suspense fallback={null}>
                <AiSignalStrip
                  findings={intelligenceFindings}
                  activeTab={state.activeTab}
                  role={state.currentUser.role}
                  lang={state.lang}
                  onOpen={() => state.setActiveTab('intelligence')}
                />
              </Suspense>
            )}

            {/* A. DASHBOARD TAB */}
            {state.activeTab === 'dashboard' && (
              <WineryDashboardTab
                lang={state.lang}
                lots={state.lots}
                vessels={state.vessels}
                fermLogs={state.fermLogs}
                labLogs={state.labLogs}
                tasks={state.tasks}
                currentUsername={state.currentUser.username}
                currentUserName={state.currentUser.fullName}
                chartLotId={state.chartLotId}
                setChartLotId={state.setChartLotId}
                selectedTankId={state.selectedTankId}
                setSelectedTankId={state.setSelectedTankId}
                onToggleTaskStatus={state.handleToggleTaskStatus}
                role={state.currentUser.role}
                layoutOwner={state.currentUser.username}
                canUpdateTasks={canAccess(state.currentUser.role, 'tasks', 'update')}
                setActiveTab={state.setActiveTab}
                setCalculatorLotId={state.setCalculatorLotId}
                setPrefilledTaskTitle={state.setPrefilledTaskTitle}
                setPrefilledTaskPriority={state.setPrefilledTaskPriority}
                setPrefilledTaskDesc={state.setPrefilledTaskDesc}
              />
            )}

            {/* A1. WINERY INTELLIGENCE */}
            {state.activeTab === 'intelligence' && (
              <Suspense fallback={<ModuleLoader />}>
                <AiIntelligenceTab
                  lang={state.lang}
                  role={state.currentUser.role}
                  aiConfig={state.companyProfile.aiConfig}
                  canConfigure={canAccess(state.currentUser.role, 'company_profile', 'update')}
                  canReview={canAccess(state.currentUser.role, 'tasks', 'update')}
                  onConfigSaved={saveAiConfig}
                  data={intelligenceData}
                  findings={intelligenceFindings}
                  focusFindingId={focusedAiFindingId}
                  onFocusConsumed={consumeAiFindingFocus}
                  onCreateTask={canAccess(state.currentUser.role, 'tasks', 'create')
                    ? (title, priority, dueDate, description) => {
                      state.handleAddNewTask(title, priority, dueDate, description);
                    }
                    : undefined}
                  onSaveDraftActions={canAccess(state.currentUser.role, 'tasks', 'create')
                    ? state.handleSaveAiDraftActions
                    : undefined}
                  onNavigate={navigateToAiFindingModule}
                  setToastMessage={state.setToastMessage}
                />
              </Suspense>
            )}

            {/* B. UNIFIED CELLAR WORKSPACE (legacy lot/vessel routes remain compatible) */}
            {['cellar', 'lots', 'vessels'].includes(state.activeTab) && (
              <div className="space-y-4 text-stone-800 animate-fade-in">
                <CellarWorkspaceRoute
                  state={state}
                  permissions={cellarPermissions}
                  onOpenProductionPlan={(planId) => openWorkflowItem('planner', planId)}
                  onLogOperation={openVesselOperation}
                  onPlanTransfer={openTransferFromVessel}
                  renderQvevriRecords={renderQvevriRecords}
                />
              </div>
            )}

            {/* B1. GRAPE RECEIVING / INTAKE */}
            {state.activeTab === 'intake' && (
              <GrapeReceivingTab
                lang={state.lang}
                vessels={state.vessels}
                blocks={state.blocks}
                harvests={state.harvests}
                intakes={state.grapeIntakes}
                currentUserName={state.currentUser.fullName}
                currency={state.companyProfile.currency || 'GEL'}
                costAutomation={state.companyProfile.costAutomation}
                region={state.companyProfile.region || 'Kakheti'}
                onReceiveGrapes={state.handleReceiveGrapes}
                lots={state.lots}
                costEntries={state.costEntries}
                auditLogs={state.auditLogs}
                onUpdateLots={state.setLots}
                onUpdateVessels={state.setVessels}
                onUpdateHarvests={state.setHarvests}
                onUpdateIntakes={state.setGrapeIntakes}
                onUpdateCostEntries={state.setCostEntries}
                onUpdateAuditLogs={state.setAuditLogs}
                onApplyHarvestIntakeCommandResponse={state.applyHarvestIntakeCommandResponse}
                prefilledHarvestRecordId={state.prefilledIntakeHarvestId}
                onPrefillConsumed={clearIntakePrefill}
                {...cellarPermissions.intake}
                setActiveTab={state.setActiveTab}
                setToastMessage={state.setToastMessage}
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
                costEntries={state.costEntries}
                auditLogs={state.auditLogs}
                currentUserName={state.currentUser.fullName}
                currentUsername={state.currentUser.username}
                currency={state.companyProfile.currency || 'GEL'}
                costAutomation={state.companyProfile.costAutomation}
                onAddOperation={state.handleAddCellarOperation}
                onUpdateLots={state.setLots}
                onUpdateVessels={state.setVessels}
                onUpdateInventory={state.setInventory}
                onUpdateOperations={state.setCellarOps}
                onUpdateCostEntries={state.setCostEntries}
                onUpdateAuditLogs={state.setAuditLogs}
                onApplyCellarOperationCommandResponse={state.applyCellarOperationCommandResponse}
                prefillVesselId={state.prefilledOpVesselId}
                prefillOperationType={prefilledOpType}
                returnToVesselId={operationReturnVesselId || undefined}
                onOperationLogged={handleVesselOperationLogged}
                clearPrefill={clearOperationPrefill}
                onNavigateWorkflow={navigateCellarWorkflow}
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
                inventory={state.inventory}
                costEntries={state.costEntries}
                currency={state.companyProfile.currency || 'GEL'}
                onUpdateVessels={state.setVessels}
                onUpdateLots={state.setLots}
                onAddCellarOperation={state.handleAddCellarOperation}
                {...cellarPermissions.transfers}
                prefilledSourceId={state.prefilledSourceId}
                prefilledDestId={state.prefilledDestId}
                prefilledVolume={prefilledTransferVolume}
                pastTransfers={state.transfers}
                onUpdateTransfers={state.setTransfers}
                onUpdateCostEntries={state.setCostEntries}
                onApplyTransferCommandResponse={state.applyTransferCommandResponse}
                onApplyTransferReversalCommandResponse={state.applyTransferReversalCommandResponse}
                clearPrefilled={clearTransferPrefill}
              />
            )}

            {/* E. FERMENTATION FOLLOWUP */}
            {state.activeTab === 'fermentation' && (
              <FermentationTab
                lang={state.lang}
                vessels={state.vessels}
                lots={state.lots}
                fermLogs={state.fermLogs}
                inventory={state.inventory}
                auditLogs={state.auditLogs}
                currentUser={state.currentUser}
                setActiveTab={state.setActiveTab}
                {...cellarPermissions.fermentation}
                onUpdateLots={state.setLots}
                onUpdateVessels={state.setVessels}
                onUpdateFermLogs={state.setFermLogs}
                onAddCellarOperation={state.handleAddCellarOperation}
                onUpdateAuditLogs={state.setAuditLogs}
                onApplyFermentationCompletionCommandResponse={state.applyFermentationCompletionCommandResponse}
                onApplyFermentationCompletionReversalCommandResponse={state.applyFermentationCompletionReversalCommandResponse}
                setToastMessage={state.setToastMessage}
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
                labDate={state.labDate}
                setLabDate={state.setLabDate}
                labPH={state.labPH}
                setLabPH={state.setLabPH}
                labMalic={state.labMalic}
                setLabMalic={state.setLabMalic}
                labTechnician={state.labTechnician}
                setLabTechnician={state.setLabTechnician}
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
                vessels={state.vessels}
                onUpdateVessels={state.setVessels}
                history={state.bottlingRuns}
                onUpdateHistory={state.setBottlingRuns}
                inventory={state.inventory}
                onUpdateInventory={state.setInventory}
                costEntries={state.costEntries}
                onUpdateCostEntries={state.setCostEntries}
                storageLocations={state.storageLocations}
                stockMovements={state.stockMovements}
                onUpdateStockMovements={state.setStockMovements}
                onApplyBottlingCommandResponse={state.applyBottlingCommandResponse}
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
            {/* H2. RECURRING QUALITY SOPS */}
            {state.activeTab === 'quality' && (
              <QualitySopTab
                lang={state.lang}
                currentUsername={state.currentUser.username}
                vessels={state.vessels}
                lots={state.lots}
                qualitySops={state.qualitySops}
                onUpdateQualitySops={state.setQualitySops}
                canCreate={canAccess(state.currentUser.role, 'tasks', 'create')}
                canUpdate={canAccess(state.currentUser.role, 'tasks', 'update')}
                canDelete={canAccess(state.currentUser.role, 'tasks', 'delete')}
                focusSopId={workflowFocus?.tab === 'quality' ? workflowFocus.targetId : undefined}
                setToastMessage={state.setToastMessage}
              />
            )}

            {/* H3. VISUAL PRODUCTION PLANNER */}
            {state.activeTab === 'planner' && (
              <ProductionPlannerTab
                lang={state.lang}
                currentUsername={state.currentUser.username}
                productionPlans={state.productionPlans}
                onUpdateProductionPlans={state.setProductionPlans}
                vessels={state.vessels}
                lots={state.lots}
                blocks={state.blocks}
                harvests={state.harvests}
                fermentationLogs={state.fermLogs}
                labLogs={state.labLogs}
                tasks={canViewWineryTasks ? state.tasks : []}
                canCreate={canAccess(state.currentUser.role, 'planning', 'create')}
                canUpdate={canAccess(state.currentUser.role, 'planning', 'update')}
                canDelete={canAccess(state.currentUser.role, 'planning', 'delete')}
                canCreateTask={canAccess(state.currentUser.role, 'tasks', 'create')}
                focusPlanId={workflowFocus?.tab === 'planner' ? workflowFocus.targetId : undefined}
                onOpenLot={canViewWineryLots ? state.setPassportLotId : undefined}
                onOpenVessel={canViewWineryVessels ? (vesselId) => {
                  state.setActiveModule('gvino');
                  state.setActiveTab('cellar');
                  state.setSelectedTankId(vesselId);
                } : undefined}
                onOpenBlock={canViewModule('vazi') ? () => state.setActiveModule('vazi') : undefined}
                onOpenWorkflow={openProductionPlanWork}
                onCreateTask={canAccess(state.currentUser.role, 'tasks', 'create') ? state.handleAddNewTask : undefined}
                onOpenTask={canViewWineryTasks ? (taskId) => openWorkflowItem('tasks', taskId) : undefined}
                setToastMessage={state.setToastMessage}
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
                currentUsername={state.currentUser.username}
                currentUserName={state.currentUser.fullName}
                tasks={state.tasks}
                onToggleTaskStatus={state.handleToggleTaskStatus}
                onDeleteTask={state.handleDeleteTask}
                onAddNewTask={state.handleAddNewTask}
                onUpdateTaskNotification={state.handleUpdateTaskNotification}
                setToastMessage={state.setToastMessage}
                canCreateTask={canAccess(state.currentUser.role, 'tasks', 'create')}
                canUpdateTask={canAccess(state.currentUser.role, 'tasks', 'update')}
                canDeleteTask={canAccess(state.currentUser.role, 'tasks', 'delete')}
                prefilledTaskTitle={state.prefilledTaskTitle}
                setPrefilledTaskTitle={state.setPrefilledTaskTitle}
                prefilledTaskPriority={state.prefilledTaskPriority}
                setPrefilledTaskPriority={state.setPrefilledTaskPriority}
                prefilledTaskDesc={state.prefilledTaskDesc}
                setPrefilledTaskDesc={state.setPrefilledTaskDesc}
                focusTaskId={taskDeepLinkId || (workflowFocus?.tab === 'tasks' ? workflowFocus.targetId : undefined)}
                onOpenTaskSource={canViewWineryPlanner ? (task) => task.source && openWorkflowItem('planner', task.source.id) : undefined}
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
        </>
        )}
        </WorkspaceShell>
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

      {state.isLoggedIn && (state.isSwitchingOrganization || state.workspaceHydrationError) && (
        <WorkspaceTransitionOverlay
          lang={state.lang}
          error={state.workspaceHydrationError}
          onReload={() => window.location.reload()}
          onLogout={handleLogout}
        />
      )}

      {/* 2. CONFLICT RESOLUTION MODAL */}
      {state.isLoggedIn
        && !state.isSwitchingOrganization
        && !state.workspaceHydrationError
        && state.syncConflicts
        && state.syncConflicts.length > 0
        && isConflictResolutionOpen && (
        <Suspense fallback={(
          <div
            role="status"
            className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-xs"
          >
            <div className="flex items-center gap-2 rounded-xl bg-white px-5 py-4 text-xs font-bold text-stone-700 shadow-2xl">
              <Loader2 className="h-4 w-4 animate-spin text-[#4e0e15]" aria-hidden="true" />
              {isKa ? 'კონფლიქტების მიმოხილვა იტვირთება…' : 'Loading conflict review…'}
            </div>
          </div>
        )}>
          <SyncConflictResolutionModal
            lang={state.lang}
            conflicts={state.syncConflicts}
            resolutions={resolutions}
            onChoose={(key, choice) => setResolutions(prev => ({ ...prev, [key]: choice }))}
            onClose={() => setIsConflictResolutionOpen(false)}
            onResolve={() => { state.resolveConflict(resolutions); }}
          />
        </Suspense>
      )}
      {state.isLoggedIn
        && !state.isSwitchingOrganization
        && !state.workspaceHydrationError
        && state.syncConflicts
        && state.syncConflicts.length > 0
        && !isConflictResolutionOpen && (
        <button
          type="button"
          onClick={() => setIsConflictResolutionOpen(true)}
          className="fixed bottom-5 right-5 z-40 rounded-full border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-950 shadow-lg hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          {isKa
            ? `სინქრონიზაციის ${state.syncConflicts.length} კონფლიქტის მოგვარება`
            : `Review ${state.syncConflicts.length} sync conflict${state.syncConflicts.length === 1 ? '' : 's'}`}
        </button>
      )}

      {state.isLoggedIn && showOnboarding && (
        <Suspense fallback={null}>
          <WorkspaceSetupDialog
            lang={isKa ? 'ka' : 'en'}
            required={needsRegistrationCompletion}
            user={state.currentUser}
            companyProfile={state.companyProfile}
            error={state.loginError}
            onClose={() => setShowOnboarding(false)}
            onSubmit={async (setup: WorkspaceSetupSubmission) => {
              if (needsRegistrationCompletion) {
                const companySetup = {
                  ...state.companyProfile,
                  companyName: setup.companyName,
                  address: setup.location?.label || state.companyProfile.address || '',
                  contactEmail: state.companyProfile.contactEmail || state.currentUser.email || '',
                  measurementUnits: state.companyProfile.measurementUnits || ('metric' as const),
                  currency: state.companyProfile.currency || 'GEL',
                  ...(setup.location ? {
                    latitude: setup.location.latitude,
                    longitude: setup.location.longitude,
                  } : {}),
                };
                const completed = await state.handleCompleteRegistration({
                  fullName: state.currentUser.fullName,
                  role: state.currentUser.role,
                  language: isKa ? 'ka' : 'en',
                  companyProfile: companySetup,
                  enabledModules: setup.enabledModules,
                  enabledWidgets: setup.enabledWidgets,
                });
                if (completed) {
                  state.setActiveModule(setup.enabledModules.includes('gvino') ? 'gvino' : 'vazi');
                }
                return completed;
              }

              await state.handleUpdateProfile({
                enabledModules: setup.enabledModules,
                enabledWidgets: setup.enabledWidgets,
              });
              state.setActiveModule(setup.enabledModules.includes('gvino') ? 'gvino' : 'vazi');
              return true;
            }}
          />
        </Suspense>
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
            operations={state.cellarOps}
            recentlyLoggedOperationId={recentlyLoggedOperationId || undefined}
            onClose={closeVesselDrawer}
            onAdjustTargetTemp={state.handleAdjustTargetTemp}
            onToggleSanitation={state.handleToggleSanitation}
            onToggleCoolingJacket={state.handleToggleCoolingJacket}
            onUpdateVessels={state.setVessels}
            onLogOperation={cellarPermissions.operations.canLogCellarOperation ? openVesselOperation : undefined}
            canUpdateVessel={cellarPermissions.vessels.canUpdateVessel}
          />
        </Suspense>
      )}

      {/* OMNIPRESENT FLOATING AI WIDGET */}
      {state.isLoggedIn && !state.currentUser.isMasterAdmin && (
        <>
          {/* Compact assistant launcher (hidden when drawer is open) */}
          <AnimatePresence>
            {!isAiDrawerOpen && (
              <motion.button
                key="ai-floating-orb"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setIsAiDrawerOpen(true)}
                className="fixed bottom-5 right-5 z-40 h-11 px-3.5 bg-[#651522] hover:bg-[#7a1c2b] text-white rounded-xl hidden sm:flex items-center gap-2 justify-center shadow-lg cursor-pointer focus:outline-none transition-colors"
                title="Open AI Winemaker Assistant"
              >
                <BrainCircuitIcon className="h-4 w-4" />
                <span className="text-xs font-bold">{isKa ? 'AI მეღვინე' : 'AI Winemaker'}</span>
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
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0e6e8] text-[#651522] dark:bg-stone-800 dark:text-amber-200">
                        <BrainCircuitIcon className="h-4 w-4" />
                      </span>
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
                      aria-label={isKa ? 'AI ასისტენტის დახურვა' : 'Close AI assistant'}
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



      {!state.isLoggedIn && (
        <footer className="app-footer py-5 px-6 text-center mt-auto text-[10px] font-medium">
          {isKa
            ? 'VinOS • ვენახიდან ბოთლამდე'
            : 'VinOS · Vineyard to bottle'}
        </footer>
      )}
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

function WorkspaceTransitionOverlay({
  lang,
  error,
  onReload,
  onLogout,
}: {
  lang: Language;
  error: string | null;
  onReload: () => void;
  onLogout: () => void | Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, { active: true });
  const ka = lang === 'ka';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/70 p-4 backdrop-blur-md">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-transition-title"
        aria-describedby="workspace-transition-description"
        aria-busy={!error}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 text-center text-stone-850 shadow-2xl"
      >
        {error
          ? <ShieldAlert className="mx-auto h-8 w-8 text-amber-700" aria-hidden="true" />
          : <RefreshCw className="mx-auto h-8 w-8 animate-spin text-[#801323]" aria-hidden="true" />}
        <h2 id="workspace-transition-title" className="mt-4 font-serif text-lg font-black text-[#4e0e15]">
          {error
            ? (ka ? 'უსაფრთხო განახლებაა საჭირო' : 'Safe reload required')
            : (ka ? 'სამუშაო სივრცე იცვლება' : 'Switching workspace')}
        </h2>
        <p id="workspace-transition-description" role="status" aria-live="polite" className="mt-2 text-sm leading-relaxed text-slate-600">
          {error || (ka
            ? 'იტვირთება ახალი როლი და მეღვინეობის მონაცემები. გთხოვთ, მოიცადოთ.'
            : 'Loading the new role and winery data. Please wait.')}
        </p>
        {error && (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={onReload}
              className="rounded-lg bg-[#4e0e15] px-4 py-2 text-xs font-bold text-white hover:bg-[#801323] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#801323]"
            >
              {ka ? 'გვერდის განახლება' : 'Reload workspace'}
            </button>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-bold text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#801323]"
            >
              {ka ? 'გასვლა' : 'Sign out'}
            </button>
          </div>
        )}
      </div>
    </div>
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
