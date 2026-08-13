import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert, RefreshCw, Trash2, Edit, Activity, Cpu, Database,
  Server, User, Users, Check, X, ShieldCheck, Terminal, AlertTriangle, KeyRound,
  Eye, Mail, ScrollText, Unlock, Download, Wrench, Gauge, SearchCode, CreditCard,
  Building2, Plus, UserPlus, Moon, Sun, Rows3
} from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';
import { localizedRoleLabel } from '../lib/roleLabels';
import { localizeServerError } from '../lib/serverErrorMessages';
import { clearTenantCachedData } from '../lib/tenantCache';
import type { AdminOrgInspection } from './admin/AdminOrganizationWorkspace';
import './masterAdminTheme.css';

const AiOperationsAdmin = React.lazy(() => import('./AiOperationsAdmin'));
const MasterBillingAdmin = React.lazy(() => import('./MasterBillingAdmin'));
const AdminRoleExplorer = React.lazy(() => import('./admin/AdminRoleExplorer'));
const AdminOrganizationWorkspace = React.lazy(() => import('./admin/AdminOrganizationWorkspace'));
const AdminControlSnapshot = React.lazy(() => import('./admin/AdminControlSnapshot'));
const AdminOrganizationBulkBar = React.lazy(() => import('./admin/AdminOrganizationBulkBar'));
const AdminCsvExportButton = React.lazy(() => import('./admin/AdminOrganizationBulkBar').then(module => ({ default: module.AdminCsvExportButton })));
const AdminOrganizationQuickActions = React.lazy(() => import('./admin/AdminOrganizationQuickActions'));

interface MasterAdminPortalProps {
  lang: string;
  currentUser: { username: string; fullName: string };
  onClose: () => void;
  setToastMessage: (msg: string | null) => void;
}

interface UserRecord {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: string;
  emailVerified: boolean;
  accountEnabled: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  isDemo: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  isOnline: boolean;
  activeOrganizationId: string | null;
  organizations: Array<{ id: string; name: string; role: string }>;
}

/** A self-service signup that no operator has decided on yet. */
interface PendingRegistration {
  username: string;
  fullName: string;
  email: string;
  phone?: string;
  companyName?: string;
  wineryName?: string;
  country?: string;
  region?: string;
  language?: string;
  role?: string;
  provider?: 'password' | 'google';
  requestedAt?: string;
  emailVerified?: boolean;
  approvalBlockedReasons?: string[];
}

interface OrgRecord {
  id: string;
  name: string;
  createdAt: string;
  membersCount: number;
  ownersCount: number;
  onlineMembersCount: number;
  pendingInvitationsCount: number;
  status: 'active' | 'suspended' | 'archived';
  archivedAt: string | null;
  deletionScheduledAt: string | null;
  internalTags: string[];
  lastActivity: string | null;
  health: { level: 'healthy' | 'warning' | 'critical'; issues: string[] };
  tanksCount: number;
  lotsCount: number;
  dataSize: number;
}

interface SystemStats {
  usersCount: number;
  orgsCount: number;
  membershipsCount: number;
  invitationsCount: number;
  memoryHeapUsedMB: number;
  memoryHeapTotalMB: number;
  memoryRssMB?: number;
  eventLoopLagMs?: number;
  uptimeSeconds: number;
  persistenceMode: string;
  nodeEnv: string;
}

interface LockoutEntry {
  key: string;
  count: number;
  lockedUntil: string | null;
  remainingSeconds: number;
}

interface AdminAction {
  at: string;
  actor: string;
  action: string;
  target?: string;
  detail?: string;
}

interface ClientErrorReport {
  at: string;
  source: string;
  message: string;
  stack: string;
  url: string;
  userAgent: string;
  appVersion: string;
  username: string | null;
}

interface SystemHealth {
  ok: boolean;
  checkedAt: string;
  db: {
    ok: boolean;
    activeBackendLabel: string;
    persistenceMode: string;
    warnings: string[];
    postgres: {
      configured: boolean;
      usable: boolean;
      disabledAfterFailure: boolean;
      target: string | null;
      lastMetadataSyncAt: string | null;
      lastMetadataSyncError: string | null;
    };
    postgresReadiness: {
      ok: boolean;
      checkedAt: string;
      configured: boolean;
      usable: boolean;
      target: string | null;
      checks: {
        coreMetadataRead: boolean;
        organizationStateRead: boolean;
        loginAttemptStoreRead: boolean;
      };
      errors: string[];
    };
    json: {
      localPath: string;
      localFileSizeBytes: number;
      localFileUpdatedAt: string | null;
      lastLocalSaveAt: string | null;
      lastLocalSaveError: string | null;
      gcsEnabled: boolean;
      gcsTarget: string;
      lastGcsUploadAttemptAt: string | null;
      lastGcsUploadAt: string | null;
      lastGcsUploadError: string | null;
    };
    memory: {
      usersCount: number;
      organizationsCount: number;
      membershipsCount: number;
      invitationsCount: number;
      orgDataCount: number;
      serializedBytes: number;
    };
    organizationStates: {
      trackedCount: number;
      latestOrganizationId: string | null;
      latestVersion: number | null;
      latestUpdatedAt: string | null;
      states: Array<{
        organizationId: string;
        organizationName: string;
        version: number | null;
        updatedAt: string | null;
        updatedBy: string | null;
        source: string;
        dataSizeBytes: number;
      }>;
    };
  };
  deployment: {
    ok: boolean;
    warnings: string[];
    runtime: { nodeEnv: string; isCloudRun: boolean; service?: string; revision?: string; region?: string };
    persistence: { databaseBackend: string; userDataBackend: string; target: string; maxInstancesRecommendation: string };
    scaleReadiness: {
      safeToRaiseMaxInstances: boolean;
      currentRecommendation: string;
      completed: string[];
      blockers: string[];
      nextMilestone: string;
    };
  };
  process: {
    uptimeSeconds: number;
    memoryHeapUsedMB: number;
    memoryHeapTotalMB: number;
    nodeVersion: string;
    platform: string;
  };
  actions: {
    exportUrl: string;
    forceSaveAction: string;
  };
}

const ORGANIZATION_ROLES = [
  'Owner/Admin',
  'Winemaker',
  'Viticulturist',
  'Lab Technician',
  'Cellar Worker',
  'Read-Only',
] as const;

export default function MasterAdminPortal({
  lang,
  currentUser,
  onClose,
  setToastMessage
}: MasterAdminPortalProps) {
  const isKa = lang === 'ka';
  const adminActionError = (data: any, englishFallback: string, georgianFallback: string) => (
    data?.code
      ? localizeServerError(data.code, data.error, lang as 'en' | 'ka')
      : data?.error || (isKa ? georgianFallback : englishFallback)
  );
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'orgs' | 'billing' | 'access' | 'ai-ops' | 'ops' | 'audit' | 'client-errors' | 'terminal'>('stats');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistration[]>([]);
  const [decidingUsername, setDecidingUsername] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgRecord[]>([]);
  const [clientErrors, setClientErrors] = useState<ClientErrorReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search & Filters
  const [userSearch, setUserSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [userView, setUserView] = useState<'all' | 'online' | 'offline' | 'unassigned' | 'disabled' | 'pending'>('all');
  const [orgView, setOrgView] = useState<'all' | 'active' | 'suspended' | 'archived' | 'attention'>('all');
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [bulkUserAction, setBulkUserAction] = useState('assign');
  const [bulkOrganizationId, setBulkOrganizationId] = useState('');
  const [bulkRole, setBulkRole] = useState('Winemaker');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<Set<string>>(new Set());
  const [bulkOrganizationStatus, setBulkOrganizationStatus] = useState<'active' | 'suspended' | 'archived'>('suspended');
  const [bulkOrganizationReason, setBulkOrganizationReason] = useState('');
  const [bulkOrganizationWorking, setBulkOrganizationWorking] = useState(false);
  const [initialBillingOrgId, setInitialBillingOrgId] = useState('');
  const [adminTheme, setAdminTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('vinos_master_admin_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  const [adminDensity, setAdminDensity] = useState<'comfortable' | 'compact'>(() => {
    try { return localStorage.getItem('vinos_master_admin_density') === 'compact' ? 'compact' : 'comfortable'; } catch { return 'comfortable'; }
  });

  // Editing States
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editVerified, setEditVerified] = useState(false);
  const [editEnabled, setEditEnabled] = useState(true);
  const [newPasscode, setNewPasscode] = useState('');
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  // Tenant and membership management
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [newOrganizationName, setNewOrganizationName] = useState('');
  const [newOrganizationOwner, setNewOrganizationOwner] = useState('');
  const [isCreatingOrganization, setIsCreatingOrganization] = useState(false);
  const [managingOrganizationId, setManagingOrganizationId] = useState<string | null>(null);
  const [managedOrganizationName, setManagedOrganizationName] = useState('');
  const [organizationDeleteConfirmation, setOrganizationDeleteConfirmation] = useState('');
  const [isSavingOrganization, setIsSavingOrganization] = useState(false);
  const [isDeletingOrganization, setIsDeletingOrganization] = useState(false);
  const [managingUsername, setManagingUsername] = useState<string | null>(null);
  const [membershipOrganizationId, setMembershipOrganizationId] = useState('');
  const [membershipRole, setMembershipRole] = useState('Winemaker');
  const [membershipMakeActive, setMembershipMakeActive] = useState(false);
  const [membershipAction, setMembershipAction] = useState<string | null>(null);

  // Deleting States
  const [deletingUsername, setDeletingUsername] = useState<string | null>(null);
  /** Wineries the pending deletion would destroy, as reported by the server. */
  const [pendingOrphanedOrgs, setPendingOrphanedOrgs] = useState<Array<{
    id: string; name: string; lotsCount: number; tanksCount: number; dataSize: number;
  }> | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Real process telemetry: event-loop lag history sampled from /api/admin/stats.
  const [lagHistory, setLagHistory] = useState<number[]>([]);

  // Godmode panels
  const [lockouts, setLockouts] = useState<LockoutEntry[]>([]);
  const [lockoutsBackend, setLockoutsBackend] = useState<string>('');
  const [adminTrail, setAdminTrail] = useState<AdminAction[]>([]);
  const [inspectingOrgId, setInspectingOrgId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<AdminOrgInspection | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [impersonatingUsername, setImpersonatingUsername] = useState<string | null>(null);

  // Simulated Terminal State
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    `[${new Date().toISOString()}] VinOS Core Network Admin Portal Initialized.`,
    `[${new Date().toISOString()}] Authenticated master administrator: @${currentUser.username}`,
    `[${new Date().toISOString()}] Routing interface active. CPU monitoring thread started.`
  ]);
  const terminalBottomRef = useRef<HTMLDivElement>(null);
  const editUserDialogRef = useRef<HTMLDivElement | null>(null);
  const deleteUserDialogRef = useRef<HTMLDivElement | null>(null);
  const createOrganizationDialogRef = useRef<HTMLDivElement | null>(null);
  const manageMembershipDialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(editUserDialogRef, { active: !!editingUser, onClose: () => setEditingUser(null) });
  useFocusTrap(deleteUserDialogRef, { active: !!deletingUsername, onClose: () => setDeletingUsername(null) });
  useFocusTrap(createOrganizationDialogRef, { active: creatingOrganization, onClose: () => setCreatingOrganization(false) });
  useFocusTrap(manageMembershipDialogRef, { active: !!managingUsername, onClose: () => setManagingUsername(null) });

  useEffect(() => {
    try {
      localStorage.setItem('vinos_master_admin_theme', adminTheme);
      localStorage.setItem('vinos_master_admin_density', adminDensity);
    } catch { /* local preferences are optional */ }
  }, [adminDensity, adminTheme]);

  // Fetch Data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, usersRes, orgsRes, healthRes, lockoutsRes, actionsRes, clientErrorsRes, pendingRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users'),
        fetch('/api/admin/orgs'),
        fetch('/api/admin/system-health'),
        fetch('/api/admin/lockouts'),
        fetch('/api/admin/actions'),
        fetch('/api/admin/client-errors'),
        fetch('/api/admin/registrations/pending')
      ]);

      if (statsRes.ok && usersRes.ok && orgsRes.ok) {
        const statsData = await statsRes.json();
        const usersData = await usersRes.json();
        const orgsData = await orgsRes.json();
        const healthData = healthRes.ok ? await healthRes.json() : null;
        const lockoutsData = lockoutsRes.ok ? await lockoutsRes.json() : null;
        const actionsData = actionsRes.ok ? await actionsRes.json() : null;
        const clientErrorsData = clientErrorsRes.ok ? await clientErrorsRes.json() : null;
        const pendingData = pendingRes.ok ? await pendingRes.json() : null;

        setStats(statsData);
        setSystemHealth(healthData);
        setUsers(usersData.users);
        setPendingRegistrations(pendingData?.pending || []);
        setOrgs(orgsData.organizations);
        if (lockoutsData) { setLockouts(lockoutsData.entries || []); setLockoutsBackend(lockoutsData.backend || ''); }
        if (actionsData) setAdminTrail(actionsData.actions || []);
        if (clientErrorsData) setClientErrors(clientErrorsData.errors || []);
      } else {
        setToastMessage(lang === 'ka' ? 'შეცდომა ადმინ მონაცემების ჩატვირთვისას' : 'Failed to fetch admin console data');
      }
    } catch (err) {
      console.error(err);
      setToastMessage(isKa ? 'API კავშირის შეცდომა' : 'API Connection Error');
    } finally {
      setIsLoading(false);
    }
  }, [isKa, lang, setToastMessage]);

  useEffect(() => {
    fetchData();

    // Live telemetry: poll the real process stats (heap, lag, uptime) — no
    // simulated numbers in an operations console.
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/admin/stats');
        if (!res.ok) return;
        const s = await res.json();
        setStats(s);
        setLagHistory(hist => [...hist.slice(-19), Math.min(100, s.eventLoopLagMs ?? 0)]);
      } catch { /* transient poll failure — keep last reading */ }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Auto scroll terminal
  useEffect(() => {
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // Terminal commands handler
  const handleTerminalCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = terminalInput.trim().toLowerCase();
    if (!cmd) return;

    let reply = '';
    if (cmd === 'help') {
      reply = 'Available commands: help | stats | users | orgs | lockouts | audit | errors | sync | clear';
    } else if (cmd === 'lockouts') {
      reply = lockouts.length
        ? `Active limiter entries (${lockouts.length}): ` + lockouts.map(l => `${l.key} [${l.count}x${l.remainingSeconds ? `, locked ${l.remainingSeconds}s` : ''}]`).join(' | ')
        : 'No tracked login failures or lockouts.';
    } else if (cmd === 'audit') {
      reply = adminTrail.length
        ? `Recent admin actions: ` + adminTrail.slice(0, 5).map(a => `${a.at.slice(11, 19)} ${a.actor} ${a.action}${a.target ? ` → ${a.target}` : ''}`).join(' | ')
        : 'No admin actions recorded this process.';
    } else if (cmd === 'errors') {
      reply = clientErrors.length
        ? `Recent client errors (${clientErrors.length}): ` + clientErrors.slice(0, 5).map(e => `${e.at.slice(11, 19)} ${e.source}: ${e.message.slice(0, 80)}`).join(' | ')
        : 'No client-side errors recorded this process.';
    } else if (cmd === 'stats') {
      reply = stats
        ? `Uptime: ${stats.uptimeSeconds}s | Users: ${stats.usersCount} | Orgs: ${stats.orgsCount} | Heap: ${stats.memoryHeapUsedMB}MB/${stats.memoryHeapTotalMB}MB`
        : 'Stats not loaded';
    } else if (cmd === 'users') {
      reply = `Registered Accounts (${users.length}): ` + users.map(u => `@${u.username} (${u.role})`).join(', ');
    } else if (cmd === 'orgs') {
      reply = `Active Wineries (${orgs.length}): ` + orgs.map(o => `[${o.name}: ${o.tanksCount} tanks]`).join(', ');
    } else if (cmd === 'sync') {
      reply = 'Forcing database sync override...';
      handleSystemAction('save_db');
    } else if (cmd === 'clear') {
      setTerminalLogs([]);
      setTerminalInput('');
      return;
    } else {
      reply = `Unknown command: "${cmd}". Type "help" for available commands.`;
    }

    setTerminalLogs(prev => [
      ...prev,
      `admin@vinos:~$ ${terminalInput}`,
      `[sys]: ${reply}`
    ]);
    setTerminalInput('');
  };

  const handleSystemAction = async (action: string) => {
    try {
      const res = await fetch('/api/admin/system-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (res.ok) {
        const data = await res.json();
        const statusLine = data.status
          ? `[db]: ${data.status.activeBackendLabel || data.status.persistenceMode}; postgres=${data.status.postgres?.lastSaveAt || 'n/a'}; gcs=${data.status.json?.lastGcsUploadAt || 'n/a'}`
          : '';
        setToastMessage(`✓ ${data.message}`);
        setTerminalLogs(prev => [
          ...prev,
          `[sys-action]: ${data.message}`,
          ...(statusLine ? [statusLine] : [])
        ]);
        fetchData();
      } else {
        const data = await res.json().catch(() => null);
        setToastMessage(data?.error
          ? `${isKa ? 'ქმედება ვერ შესრულდა' : 'Action failed'}: ${data.error}`
          : (isKa ? 'ქმედება ვერ შესრულდა' : 'Action failed'));
      }
    } catch (err) {
      setToastMessage(isKa ? 'კავშირის შეცდომა' : 'Connection error');
    }
  };

  // Support mode: become the target user (audited server-side). Full reload so
  // the whole app re-hydrates as that account; the impersonation banner offers
  // the way back.
  const handleImpersonate = async (username: string, reason: string) => {
    setImpersonatingUsername(username);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, reason }),
      });
      if (res.ok) {
        clearTenantCachedData(localStorage);
        localStorage.removeItem('vinea_curr_user');
        localStorage.removeItem('vinea_active_module');
        localStorage.removeItem('vinea_active_tab');
        window.location.reload();
      } else {
        const err = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ ${err.error || (isKa ? 'იმპერსონაცია ვერ მოხერხდა' : 'Impersonation failed')}`);
        setImpersonatingUsername(null);
      }
    } catch {
      setToastMessage(isKa ? '⚠️ იმპერსონაციის მოთხოვნა ვერ შესრულდა' : '⚠️ Impersonation request failed');
      setImpersonatingUsername(null);
    }
  };

  const handleClearLockout = async (key: string) => {
    try {
      const res = await fetch('/api/admin/lockouts/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        setLockouts(prev => prev.filter(l => l.key !== key));
        setToastMessage(isKa ? `✓ ბლოკირება მოიხსნა: ${key}` : `✓ Lockout cleared: ${key}`);
      } else {
        const err = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ ${err.error || (isKa ? 'ბლოკირების მოხსნა ვერ მოხერხდა' : 'Failed to clear lockout')}`);
      }
    } catch {
      setToastMessage(isKa ? '⚠️ ბლოკირების მოხსნა ვერ მოხერხდა' : '⚠️ Failed to clear lockout');
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailTo.trim()) return;
    setSendingTestEmail(true);
    try {
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmailTo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setToastMessage(data.delivered
          ? (isKa ? `✓ სატესტო წერილი მიწოდებულია (${data.transport})` : `✓ Test email delivered via ${data.transport}`)
          : (isKa
            ? `⚠️ SMTP არ არის კონფიგურირებული — წერილი სერვერის კონსოლში ჩაიწერა (ტრანსპორტი: ${data.transport})`
            : `⚠️ No SMTP configured — message logged to server console (transport: ${data.transport})`));
      } else {
        setToastMessage(`⚠️ ${data.error || (isKa ? 'სატესტო წერილი ვერ გაიგზავნა' : 'Test email failed')}`);
      }
    } catch {
      setToastMessage(isKa ? '⚠️ სატესტო წერილი ვერ გაიგზავნა' : '⚠️ Test email failed');
    } finally {
      setSendingTestEmail(false);
    }
  };

  const loadOrganizationInspection = async (orgId: string) => {
    setInspection(null);
    setInspectionLoading(true);
    try {
      const res = await fetch(`/api/admin/orgs/inspect?id=${encodeURIComponent(orgId)}`);
      if (res.ok) {
        setInspection(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ ${err.error || (isKa ? 'ინსპექცია ვერ მოხერხდა' : 'Inspection failed')}`);
        return false;
      }
    } catch {
      setToastMessage(isKa ? '⚠️ ინსპექცია ვერ მოხერხდა' : '⚠️ Inspection failed');
      return false;
    } finally {
      setInspectionLoading(false);
    }
    return true;
  };

  const handleInspectOrg = async (orgId: string) => {
    if (inspectingOrgId === orgId) { setInspectingOrgId(null); setInspection(null); return; }
    setInspectingOrgId(orgId);
    const loaded = await loadOrganizationInspection(orgId);
    if (!loaded) setInspectingOrgId(null);
  };

  const refreshOrganizationWorkspace = async () => {
    const orgId = inspectingOrgId;
    await fetchData();
    if (orgId) await loadOrganizationInspection(orgId);
  };

  const handleSaveUserEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsUpdatingUser(true);

    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: editingUser.username,
          email: editEmail,
          role: editRole,
          emailVerified: editVerified,
          accountEnabled: editEnabled,
          passcode: newPasscode || undefined
        })
      });

      if (res.ok) {
        setToastMessage(isKa ? '✓ მომხმარებელი წარმატებით განახლდა' : '✓ User updated successfully');
        setEditingUser(null);
        setNewPasscode('');
        fetchData();
      } else {
        const err = await res.json();
        setToastMessage(`⚠️ ${err.error}`);
      }
    } catch (err) {
      setToastMessage(isKa ? 'მომხმარებლის განახლება ვერ მოხერხდა' : 'Failed to update user');
    } finally {
      setIsUpdatingUser(false);
    }
  };

  const handleRegistrationDecision = async (username: string, decision: 'approve' | 'reject') => {
    if (decidingUsername) return;
    setDecidingUsername(username);
    try {
      const res = await fetch('/api/admin/registrations/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, decision }),
      });
      if (res.ok) {
        setToastMessage(decision === 'approve'
          ? (isKa ? `✓ @${username} დამტკიცებულია` : `✓ @${username} approved`)
          : (isKa ? `@${username} უარყოფილია` : `@${username} rejected`));
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ ${err.error || (isKa ? 'გადაწყვეტილება ვერ შესრულდა' : 'Decision failed')}`);
      }
    } catch {
      setToastMessage(isKa ? '⚠️ გადაწყვეტილება ვერ შესრულდა' : '⚠️ Decision failed');
    } finally {
      setDecidingUsername(null);
    }
  };

  /**
   * Two-step by design. The first request carries no acknowledgement, so the
   * server answers 409 with the wineries this deletion would destroy; the
   * dialog shows them and the admin confirms against a named list.
   *
   * An account whose workspaces still have other members deletes in one step —
   * the extra confirmation appears only when records would actually be lost.
   */
  const handleDeleteUser = async (confirmOrphanedOrganizations?: string[]) => {
    if (!deletingUsername) return;
    setIsDeletingUser(true);

    try {
      const res = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: deletingUsername,
          ...(confirmOrphanedOrganizations ? { confirmOrphanedOrganizations } : {}),
        })
      });

      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const destroyed = Array.isArray(body.deletedOrganizations) ? body.deletedOrganizations.length : 0;
        setToastMessage(destroyed
          ? (isKa
            ? `✓ მომხმარებელი და ${destroyed} სამუშაო სივრცე წაიშალა`
            : `✓ User deleted, along with ${destroyed} winery workspace${destroyed === 1 ? '' : 's'}`)
          : (isKa ? '✓ მომხმარებელი წარმატებით წაიშალა' : '✓ User deleted successfully'));
        setDeletingUsername(null);
        setPendingOrphanedOrgs(null);
        fetchData();
        return;
      }

      const err = await res.json().catch(() => ({} as any));
      if (res.status === 409 && err.code === 'orphaned_organizations_require_confirmation') {
        // Show what would be lost instead of deleting it.
        setPendingOrphanedOrgs(err.organizations || []);
        return;
      }
      setToastMessage(`⚠️ ${err.error || (isKa ? 'წაშლა ვერ მოხერხდა' : 'Delete failed')}`);
    } catch (err) {
      setToastMessage(isKa ? 'მომხმარებლის წაშლა ვერ მოხერხდა' : 'Failed to delete user');
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrganizationName.trim() || !newOrganizationOwner || isCreatingOrganization) return;
    setIsCreatingOrganization(true);
    try {
      const res = await fetch('/api/admin/orgs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newOrganizationName, ownerUsername: newOrganizationOwner }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToastMessage(`⚠️ ${adminActionError(data, 'Organization could not be created', 'ორგანიზაცია ვერ შეიქმნა')}`);
        return;
      }
      setToastMessage(isKa ? `✓ ორგანიზაცია „${data.organization.name}“ შეიქმნა` : `✓ ${data.organization.name} created`);
      setCreatingOrganization(false);
      setNewOrganizationName('');
      setNewOrganizationOwner('');
      await refreshOrganizationWorkspace();
    } catch {
      setToastMessage(isKa ? '⚠️ ორგანიზაცია ვერ შეიქმნა' : '⚠️ Organization could not be created');
    } finally {
      setIsCreatingOrganization(false);
    }
  };

  const openOrganizationManager = (organization: OrgRecord) => {
    setManagingOrganizationId(organization.id);
    setManagedOrganizationName(organization.name);
    setOrganizationDeleteConfirmation('');
  };

  const copyManagedOrganizationId = async () => {
    if (!managingOrganizationId) return;
    try {
      await navigator.clipboard.writeText(managingOrganizationId);
      setToastMessage(isKa ? '✓ ორგანიზაციის ID დაკოპირდა' : '✓ Organization ID copied');
    } catch {
      setToastMessage(isKa ? '⚠️ ID ვერ დაკოპირდა' : '⚠️ Organization ID could not be copied');
    }
  };

  const openManagedOrganizationWorkspace = async () => {
    const organizationId = managingOrganizationId;
    if (!organizationId) return;
    setManagingOrganizationId(null);
    setActiveTab('orgs');
    if (inspectingOrgId !== organizationId || !inspection) {
      setInspectingOrgId(organizationId);
      await loadOrganizationInspection(organizationId);
    }
    window.setTimeout(() => document.getElementById('admin-organization-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const handleRenameOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingOrganizationId || !managedOrganizationName.trim() || isSavingOrganization) return;
    setIsSavingOrganization(true);
    try {
      const res = await fetch('/api/admin/orgs/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: managingOrganizationId, name: managedOrganizationName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToastMessage(`⚠️ ${adminActionError(data, 'Name could not be updated', 'სახელი ვერ განახლდა')}`);
        return;
      }
      setManagedOrganizationName(data.organization.name);
      setToastMessage(isKa ? '✓ ორგანიზაციის სახელი განახლდა' : '✓ Organization name updated');
      await refreshOrganizationWorkspace();
    } catch {
      setToastMessage(isKa ? '⚠️ სახელი ვერ განახლდა' : '⚠️ Name could not be updated');
    } finally {
      setIsSavingOrganization(false);
    }
  };

  const handleDeleteOrganization = async () => {
    const organization = orgs.find(org => org.id === managingOrganizationId);
    if (!organization || organizationDeleteConfirmation !== organization.name || isDeletingOrganization) return;
    setIsDeletingOrganization(true);
    try {
      const res = await fetch('/api/admin/orgs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: organization.id,
          confirmationName: organizationDeleteConfirmation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToastMessage(`⚠️ ${adminActionError(data, 'Organization could not be deleted', 'ორგანიზაცია ვერ წაიშალა')}`);
        return;
      }
      setManagingOrganizationId(null);
      setInspectingOrgId(current => current === organization.id ? null : current);
      setInspection(current => inspectingOrgId === organization.id ? null : current);
      setToastMessage(isKa
        ? `✓ ორგანიზაცია და ${data.membersRemoved || 0} წევრობა წაიშალა`
        : `✓ Organization deleted; ${data.membersRemoved || 0} membership${data.membersRemoved === 1 ? '' : 's'} removed`);
      await fetchData();
    } catch {
      setToastMessage(isKa ? '⚠️ ორგანიზაცია ვერ წაიშალა' : '⚠️ Organization could not be deleted');
    } finally {
      setIsDeletingOrganization(false);
    }
  };

  const openMembershipManager = (user: UserRecord) => {
    const firstAvailable = orgs.find(org => !user.organizations.some(membership => membership.id === org.id));
    setManagingUsername(user.username);
    setMembershipOrganizationId(firstAvailable?.id || '');
    setMembershipRole('Winemaker');
    setMembershipMakeActive(false);
  };

  const handleUpsertMembership = async (
    username: string,
    organizationId: string,
    role: string,
    makeActive = false,
  ) => {
    if (!organizationId || membershipAction) return;
    const actionKey = `${username}:${organizationId}:upsert`;
    setMembershipAction(actionKey);
    try {
      const res = await fetch('/api/admin/memberships/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, organizationId, role, makeActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToastMessage(`⚠️ ${adminActionError(data, 'Membership could not be updated', 'წევრობა ვერ განახლდა')}`);
        return;
      }
      setToastMessage(data.sessionRevoked
        ? (isKa ? `✓ წევრობა განახლდა · @${username}-ს ხელახლა შესვლა დასჭირდება` : `✓ Membership updated · @${username} will need to sign in again`)
        : (isKa ? '✓ წევრობა განახლდა' : '✓ Membership updated'));
      setMembershipMakeActive(false);
      await refreshOrganizationWorkspace();
    } catch {
      setToastMessage(isKa ? '⚠️ წევრობა ვერ განახლდა' : '⚠️ Membership could not be updated');
    } finally {
      setMembershipAction(null);
    }
  };

  const handleRemoveMembership = async (username: string, organizationId: string) => {
    if (membershipAction) return;
    const actionKey = `${username}:${organizationId}:remove`;
    setMembershipAction(actionKey);
    try {
      const res = await fetch('/api/admin/memberships/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, organizationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToastMessage(`⚠️ ${adminActionError(data, 'Membership could not be removed', 'წევრობა ვერ წაიშალა')}`);
        return;
      }
      setToastMessage(data.sessionRevoked
        ? (isKa ? `✓ წევრობა წაიშალა · @${username}-ს ხელახლა შესვლა დასჭირდება` : `✓ Membership removed · @${username} will need to sign in again`)
        : (isKa ? '✓ წევრობა წაიშალა' : '✓ Membership removed'));
      await refreshOrganizationWorkspace();
    } catch {
      setToastMessage(isKa ? '⚠️ წევრობა ვერ წაიშალა' : '⚠️ Membership could not be removed');
    } finally {
      setMembershipAction(null);
    }
  };

  const toggleUserSelection = (username: string, selected?: boolean) => {
    setSelectedUsernames(current => {
      const next = new Set(current);
      const shouldSelect = selected ?? !next.has(username);
      if (shouldSelect) next.add(username); else next.delete(username);
      return next;
    });
  };

  const handleBulkUsers = async () => {
    if (!selectedUsernames.size || bulkWorking) return;
    if (bulkUserAction === 'assign' && !bulkOrganizationId) {
      setToastMessage(isKa ? 'აირჩიეთ ორგანიზაცია' : 'Choose an organization');
      return;
    }
    setBulkWorking(true);
    try {
      const response = await fetch('/api/admin/users/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          usernames: [...selectedUsernames],
          action: bulkUserAction,
          ...(bulkUserAction === 'assign' ? { organizationId: bulkOrganizationId, role: bulkRole } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Bulk action failed');
      setToastMessage(isKa
        ? `✓ ${data.changed} მომხმარებელი განახლდა`
        : `✓ ${data.changed} user${data.changed === 1 ? '' : 's'} updated`);
      setSelectedUsernames(new Set());
      await refreshOrganizationWorkspace();
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : (isKa ? 'მასობრივი ქმედება ვერ შესრულდა' : 'Bulk action failed'));
    } finally {
      setBulkWorking(false);
    }
  };

  const handleUserSecurityAction = async (username: string, action: 'unlock' | 'revoke_sessions' | 'force_password_reset') => {
    if (membershipAction) return;
    const actionKey = `security:${username}:${action}`;
    setMembershipAction(actionKey);
    try {
      const response = await fetch('/api/admin/users/security-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Security action failed');
      const messages = {
        unlock: isKa ? '✓ ანგარიშის ბლოკირება მოხსნილია' : '✓ Account lockouts cleared',
        revoke_sessions: isKa ? '✓ ყველა სესია გაუქმებულია' : '✓ All sessions revoked',
        force_password_reset: isKa ? '✓ პაროლის აღდგენის წერილი გაიგზავნა' : '✓ Password-reset email sent',
      };
      setToastMessage(messages[action]);
      await fetchData();
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : (isKa ? 'უსაფრთხოების ქმედება ვერ შესრულდა' : 'Security action failed'));
    } finally {
      setMembershipAction(null);
    }
  };

  const toggleOrganizationSelection = (organizationId: string, selected?: boolean) => {
    setSelectedOrganizationIds(current => {
      const next = new Set(current);
      const shouldSelect = selected ?? !next.has(organizationId);
      if (shouldSelect) next.add(organizationId); else next.delete(organizationId);
      return next;
    });
  };

  const handleBulkOrganizations = async () => {
    if (!selectedOrganizationIds.size || bulkOrganizationWorking) return;
    setBulkOrganizationWorking(true);
    try {
      const response = await fetch('/api/admin/orgs/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          organizationIds: [...selectedOrganizationIds],
          status: bulkOrganizationStatus,
          reason: bulkOrganizationReason.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Bulk organization action failed');
      setToastMessage(isKa
        ? `✓ ${data.changed} ორგანიზაცია განახლდა`
        : `✓ ${data.changed} organization${data.changed === 1 ? '' : 's'} updated`);
      setSelectedOrganizationIds(new Set());
      setBulkOrganizationReason('');
      await refreshOrganizationWorkspace();
    } catch (error) {
      setToastMessage(error instanceof Error ? error.message : (isKa ? 'მასობრივი ქმედება ვერ შესრულდა' : 'Bulk organization action failed'));
    } finally {
      setBulkOrganizationWorking(false);
    }
  };

  useEffect(() => {
    if (creatingOrganization && !newOrganizationOwner && users.length > 0) {
      setNewOrganizationOwner(users[0].username);
    }
  }, [creatingOrganization, newOrganizationOwner, users]);

  useEffect(() => {
    if (!managingUsername) return;
    const user = users.find(candidate => candidate.username === managingUsername);
    if (!user) {
      setManagingUsername(null);
      return;
    }
    const available = orgs.filter(org => !user.organizations.some(membership => membership.id === org.id));
    if (!available.some(org => org.id === membershipOrganizationId)) {
      setMembershipOrganizationId(available[0]?.id || '');
    }
  }, [managingUsername, membershipOrganizationId, orgs, users]);

  useEffect(() => {
    if (!bulkOrganizationId && orgs.length) setBulkOrganizationId(orgs[0].id);
    setSelectedUsernames(current => new Set([...current].filter(username => users.some(user => user.username === username))));
    setSelectedOrganizationIds(current => new Set([...current].filter(organizationId => orgs.some(org => org.id === organizationId))));
  }, [bulkOrganizationId, orgs, users]);

  useEffect(() => {
    void import('../lib/adminViewPreferences').then(module => {
      const saved = module.readAdminViews();
      if (saved.userView) setUserView(saved.userView);
      if (saved.orgView) setOrgView(saved.orgView);
    });
  }, []);

  useEffect(() => {
    void import('../lib/adminViewPreferences').then(module => module.saveAdminViews(userView, orgView));
  }, [orgView, userView]);

  // Filtering
  const filteredUsers = users.filter(u => {
    const query = userSearch.toLowerCase();
    const matchesSearch = !query
      || u.username.toLowerCase().includes(query)
      || u.email.toLowerCase().includes(query)
      || u.fullName.toLowerCase().includes(query)
      || u.role.toLowerCase().includes(query)
      || u.organizations.some(org => org.name.toLowerCase().includes(query) || org.role.toLowerCase().includes(query));
    const matchesView = userView === 'all'
      || (userView === 'online' && u.isOnline)
      || (userView === 'offline' && !u.isOnline)
      || (userView === 'unassigned' && u.organizations.length === 0)
      || (userView === 'disabled' && u.accountEnabled === false)
      || (userView === 'pending' && u.approvalStatus === 'pending');
    return matchesSearch && matchesView;
  });

  const filteredOrgs = orgs.filter(o => {
    const query = orgSearch.toLowerCase();
    const matchesSearch = !query
      || o.name.toLowerCase().includes(query)
      || o.id.toLowerCase().includes(query)
      || o.internalTags.some(tag => tag.toLowerCase().includes(query));
    const matchesView = orgView === 'all'
      || o.status === orgView
      || (orgView === 'attention' && o.health.level !== 'healthy');
    return matchesSearch && matchesView;
  });
  const managedOrganization = orgs.find(org => org.id === managingOrganizationId) || null;
  const managedMembershipUser = users.find(user => user.username === managingUsername) || null;
  const assignableOrganizations = managedMembershipUser
    ? orgs.filter(org => !managedMembershipUser.organizations.some(membership => membership.id === org.id))
    : [];

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return isKa ? 'არ არის ჩაწერილი' : 'Not recorded';
    try {
      return new Date(value).toLocaleString(isKa ? 'ka-GE' : undefined);
    } catch {
      return value;
    }
  };

  const formatDateOnly = (value: string | null | undefined) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '—';
  };

  const formatTelemetryUrl = (value: string | null | undefined) => {
    if (!value) return isKa ? 'უცნობი გვერდი' : 'Unknown page';
    try {
      const url = new URL(value, window.location.origin);
      return `${url.pathname}${url.hash ? '#...' : ''}`;
    } catch {
      return value.split('?')[0].slice(0, 120);
    }
  };

  const summarizeUserAgent = (value: string | null | undefined) => {
    if (!value) return isKa ? 'უცნობი კლიენტი' : 'Unknown client';
    const browserMatch = value.match(/(Chrome|Firefox|Safari|Edg|OPR)\/[\d.]+/);
    const platformMatch = value.match(/\(([^)]+)\)/);
    return [browserMatch?.[0], platformMatch?.[1]?.split(';').slice(0, 2).join(';')]
      .filter(Boolean)
      .join(' - ') || value.slice(0, 80);
  };

  const formatBytes = (bytes: number | null | undefined) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  const safetyWarnings = systemHealth
    ? Array.from(new Set([...(systemHealth.db.warnings || []), ...(systemHealth.deployment.warnings || [])]))
    : [];
  const postgresProbe = systemHealth?.db.postgresReadiness;
  const liveProbeItems = [
    {
      label: isKa ? 'ძირითადი მეტამონაცემები' : 'Core metadata',
      ok: postgresProbe?.checks.coreMetadataRead,
      description: isKa ? 'მომხმარებლები, ორგანიზაციები, წევრობები, მოწვევები' : 'users, orgs, memberships, invitations',
    },
    {
      label: 'OrganizationState JSONB',
      ok: postgresProbe?.checks.organizationStateRead,
      description: isKa ? 'თითოეული ორგანიზაციის მარნის სნეპშოტები' : 'per-organization winery snapshots',
    },
    {
      label: isKa ? 'შესვლის მცდელობების ლიმიტერი' : 'LoginAttempt limiter',
      ok: postgresProbe?.checks.loginAttemptStoreRead,
      description: isKa ? 'საერთო დაცვა უხეში ძალის შეტევისგან' : 'shared brute-force protection',
    },
  ];

  return (
    <div style={{ colorScheme: adminTheme }} className={`admin-portal admin-theme-${adminTheme} admin-density-${adminDensity} fixed inset-0 z-50 flex flex-col font-sans selection:bg-cyan-500/25`}>
      <div className="admin-scanlines pointer-events-none absolute inset-0 z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.18)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] bg-[length:100%_4px,6px_100%] opacity-15" />

      {/* Cyber Grid Header */}
      <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-cyan-900/35 bg-[#0c090a]/95 px-3 py-3.5 shadow-[0_4px_30px_rgba(0,0,0,0.55)] backdrop-blur-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-950 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <Server className="w-5 h-5 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-xs font-black uppercase tracking-[0.18em] text-cyan-400 sm:text-sm">{isKa ? 'VinOS ქსელის მართვა' : 'VinOS Network Control'}</h1>
              <span className="hidden rounded border border-emerald-500/20 bg-emerald-950 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-400 sm:inline">{isKa ? 'მთავარი ადმინი' : 'Master Admin'}</span>
            </div>
            <p className="mt-0.5 hidden text-[10px] uppercase tracking-wider text-cyan-700 sm:block">{isKa ? 'სისტემის ადმინისტრირებისა და დიაგნოსტიკის კონსოლი' : 'System Administration & Diagnostics Console'}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={() => setAdminTheme(current => current === 'light' ? 'dark' : 'light')}
            className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900 p-2 text-stone-400 transition-all hover:border-cyan-500/40 hover:text-cyan-400 sm:px-3"
            title={adminTheme === 'light' ? (isKa ? 'მუქი თემის ჩართვა' : 'Switch to dark theme') : (isKa ? 'ნათელი თემის ჩართვა' : 'Switch to light theme')}
            aria-label={adminTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            aria-pressed={adminTheme === 'dark'}
          >
            {adminTheme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="hidden text-[10px] font-bold sm:inline">{adminTheme === 'light' ? (isKa ? 'მუქი' : 'Dark') : (isKa ? 'ნათელი' : 'Light')}</span>
          </button>
          <button
            type="button"
            onClick={() => setAdminDensity(current => current === 'comfortable' ? 'compact' : 'comfortable')}
            className="flex items-center gap-2 rounded-lg border border-stone-800 bg-stone-900 p-2 text-stone-400 transition-all hover:border-cyan-500/40 hover:text-cyan-400 sm:px-3"
            title={adminDensity === 'comfortable' ? (isKa ? 'კომპაქტური ხედი' : 'Use compact density') : (isKa ? 'კომფორტული ხედი' : 'Use comfortable density')}
            aria-label={adminDensity === 'comfortable' ? 'Use compact density' : 'Use comfortable density'}
          >
            <Rows3 className="h-4 w-4" />
            <span className="hidden text-[10px] font-bold xl:inline">{adminDensity === 'comfortable' ? (isKa ? 'კომფორტული' : 'Comfortable') : (isKa ? 'კომპაქტური' : 'Compact')}</span>
          </button>
          <button
            onClick={fetchData}
            className="p-2 bg-stone-900 border border-stone-800 rounded-lg hover:border-cyan-500/40 text-stone-400 hover:text-cyan-400 transition-all cursor-pointer"
            title={isKa ? 'ტელემეტრიის იძულებითი განახლება' : 'Force telemetry refresh'}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-[10px] font-bold tracking-wider text-stone-400 transition-all hover:border-red-500/40 hover:text-red-400 sm:px-4 sm:text-xs"
          >
            <span className="hidden sm:inline">{isKa ? 'გასვლა' : 'EXIT ADMIN'}</span> ✕
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <nav className="flex w-[4.5rem] shrink-0 flex-col gap-2 overflow-y-auto border-r border-cyan-900/20 bg-[#090708] p-2 lg:w-64 lg:p-4">
          <span className="mb-2 hidden text-[9px] font-bold uppercase tracking-widest text-cyan-800 lg:block">{isKa ? 'ინტერფეისები' : 'Interfaces'}</span>
          {[
            { id: 'ai-ops', label: isKa ? 'AI ოპერაციები' : 'AI Operations', icon: Cpu },
            { id: 'billing', label: isKa ? 'გამოწერები და ფასები' : 'Subscriptions', icon: CreditCard },
            { id: 'stats', label: isKa ? 'სისტემის მდგომარეობა' : 'System Health', icon: Activity },
            { id: 'users', label: isKa ? 'მომხმარებლები' : 'User Accounts', icon: User },
            { id: 'orgs', label: isKa ? 'მარნები / ორგანიზაციები' : 'Wineries / Orgs', icon: Users },
            { id: 'access', label: isKa ? 'როლები და უფლებები' : 'Roles & Access', icon: ShieldCheck },
            { id: 'ops', label: isKa ? 'ოპერაციები და უსაფრთხოება' : 'Ops & Security', icon: Wrench },
            { id: 'audit', label: isKa ? 'ადმინის ისტორია' : 'Admin Trail', icon: ScrollText },
            { id: 'client-errors', label: isKa ? 'კლიენტის შეცდომები' : 'Client Errors', icon: ShieldAlert },
            { id: 'terminal', label: isKa ? 'ბრძანების ხაზი' : 'Command Line', icon: Terminal }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                title={tab.label}
                aria-label={tab.label}
                className={`flex w-full items-center justify-center gap-3 rounded-xl border px-2 py-3 text-left text-xs font-bold tracking-wider transition-all lg:justify-start lg:px-4 ${
                  active
                    ? 'bg-cyan-950/20 border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.08)]'
                    : 'bg-transparent border-transparent text-stone-500 hover:text-stone-300 hover:bg-stone-900/40'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-cyan-400' : 'text-stone-650'}`} />
                <span className="hidden lg:inline">{tab.label}</span>
              </button>
            );
          })}

          <div className="mt-auto hidden space-y-2 rounded-2xl border border-cyan-900/10 bg-stone-950/50 p-3.5 text-[9px] text-cyan-700/80 lg:block">
            <div>
              <span className="block font-bold">{isKa ? 'შენახვის ძრავი:' : 'Persistence Engine:'}</span>
              <span className="font-mono text-stone-400">{stats?.persistenceMode || (isKa ? 'იტვირთება...' : 'Resolving...')}</span>
            </div>
            <div>
              <span className="block font-bold">{isKa ? 'Node გარემო:' : 'Node Environment:'}</span>
              <span className="font-mono text-stone-400">{stats?.nodeEnv || (isKa ? 'იტვირთება...' : 'Resolving...')}</span>
            </div>
          </div>
        </nav>

        {/* Console Viewport */}
        <main className="relative flex-1 overflow-y-auto bg-[#090607] bg-[radial-gradient(circle_at_top_right,rgba(8,145,178,0.055),transparent_34rem)] p-3 sm:p-5 lg:p-6">
          {isLoading && !stats ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-cyan-500">
              <RefreshCw className="w-8 h-8 animate-spin" />
              <span className="text-xs font-bold tracking-widest animate-pulse">{isKa ? 'კონსოლთან კავშირის დამყარება...' : 'ESTABLISHING CRYPTO CONSOLE LINK...'}</span>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {/* Tab 1: System Health */}
              {activeTab === 'stats' && stats && (
                <motion.div
                  key="stats"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6"
                >
                  <AdminControlSnapshot
                    isKa={isKa}
                    onlineUsers={users.filter(user => user.isOnline).length}
                    activeOrganizations={orgs.filter(org => org.status === 'active').length}
                    totalOrganizations={orgs.length}
                    organizationsNeedingAttention={orgs.filter(org => org.health.level !== 'healthy').length}
                    pendingInvitations={orgs.reduce((sum, org) => sum + org.pendingInvitationsCount, 0)}
                    pendingAccess={pendingRegistrations.length}
                    onOnlineUsers={() => { setUserView('online'); setActiveTab('users'); }}
                    onActiveOrganizations={() => { setOrgView('active'); setActiveTab('orgs'); }}
                    onAttention={() => { setOrgView('attention'); setActiveTab('orgs'); }}
                    onInvitations={() => setActiveTab('orgs')}
                    onPendingAccess={() => { setUserView('pending'); setActiveTab('users'); }}
                  />

                  {/* Telemetry Dashboard Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Event-loop responsiveness (real, sampled server-side) */}
                    <div className="bg-[#0c090a] border border-cyan-900/30 p-5 rounded-2xl relative overflow-hidden shadow-md">
                      <div className="flex items-center justify-between text-stone-400">
                        <span className="text-[10px] uppercase font-bold tracking-wider">{isKa ? 'ციკლის შეფერხება (Event Loop)' : 'Event Loop Lag'}</span>
                        <Gauge className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className={`text-3xl font-bold font-mono tracking-tight ${
                          (stats.eventLoopLagMs ?? 0) > 100 ? 'text-red-400' : (stats.eventLoopLagMs ?? 0) > 30 ? 'text-amber-400' : 'text-cyan-400'
                        }`}>{stats.eventLoopLagMs ?? 0}ms</span>
                        <span className="text-[10px] text-cyan-700">{isKa ? 'პასუხისუნარიანობა' : 'Responsiveness'}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-1">
                        {(lagHistory.length ? lagHistory.slice(-8) : [stats.eventLoopLagMs ?? 0]).map((val, idx) => (
                          <div key={idx} className="flex-1 bg-stone-900 h-8 rounded relative overflow-hidden">
                            <div
                              className={`absolute bottom-0 inset-x-0 transition-all duration-300 ${
                                val > 100 ? 'bg-red-500/40 border-t border-red-400/80' : val > 30 ? 'bg-amber-500/40 border-t border-amber-400/80' : 'bg-cyan-500/40 border-t border-cyan-400/80'
                              }`}
                              style={{ height: `${Math.max(4, Math.min(100, val))}%` }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Uptime Widget */}
                    <div className="bg-[#0c090a] border border-cyan-900/30 p-5 rounded-2xl relative overflow-hidden shadow-md">
                      <div className="flex items-center justify-between text-stone-400">
                        <span className="text-[10px] uppercase font-bold tracking-wider">{isKa ? 'მუშაობის დრო' : 'Router Uptime'}</span>
                        <Server className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono tracking-tight text-emerald-400">
                          {stats.uptimeSeconds >= 3600
                            ? `${Math.floor(stats.uptimeSeconds / 3600)}h ${Math.floor((stats.uptimeSeconds % 3600) / 60)}m`
                            : stats.uptimeSeconds >= 60
                              ? `${Math.floor(stats.uptimeSeconds / 60)}m ${stats.uptimeSeconds % 60}s`
                              : `${stats.uptimeSeconds}s`}
                        </span>
                        <span className="text-[10px] text-emerald-700">{isKa ? 'ონლაინ' : 'Online'}</span>
                      </div>
                      <div className="mt-2.5 text-[10px] text-stone-500">
                        {isKa ? 'დიაგნოსტიკის მდგომარეობა:' : 'Diagnostics state:'} <span className="text-emerald-500 font-bold">{isKa ? 'შესანიშნავი' : 'Excellent'}</span>
                      </div>
                    </div>

                    {/* Resident memory (real) */}
                    <div className="bg-[#0c090a] border border-cyan-900/30 p-5 rounded-2xl relative overflow-hidden shadow-md">
                      <div className="flex items-center justify-between text-stone-400">
                        <span className="text-[10px] uppercase font-bold tracking-wider">{isKa ? 'პროცესის RSS' : 'Process RSS'}</span>
                        <Cpu className="w-4 h-4 text-amber-400" />
                      </div>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono tracking-tight text-amber-400">{stats.memoryRssMB ?? '—'} MB</span>
                        <span className="text-[10px] text-amber-700">{isKa ? 'რეზიდენტული მეხსიერება' : 'Resident set'}</span>
                      </div>
                      <div className="mt-2.5 text-[10px] text-stone-500">
                        {isKa ? 'განახლება ყოველ 5 წმ-ში:' : 'Live poll every 5s:'} <span className="text-amber-500 font-bold">{isKa ? 'პროცესის რეალური მეტრიკები' : 'real process metrics'}</span>
                      </div>
                    </div>

                    {/* DB Objects Size */}
                    <div className="bg-[#0c090a] border border-cyan-900/30 p-5 rounded-2xl relative overflow-hidden shadow-md">
                      <div className="flex items-center justify-between text-stone-400">
                        <span className="text-[10px] uppercase font-bold tracking-wider">{isKa ? 'მეხსიერების განაწილება' : 'Memory Allocation'}</span>
                        <Database className="w-4 h-4 text-purple-400" />
                      </div>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold font-mono tracking-tight text-purple-400">{stats.memoryHeapUsedMB} MB</span>
                        <span className="text-[10px] text-purple-700">{isKa ? 'გამოყენებული Heap' : 'Heap Used'}</span>
                      </div>
                      <div className="mt-2.5 text-[10px] text-stone-500">
                        {isKa ? 'სულ გამოყოფილი:' : 'Total allocated:'} <span className="text-purple-500 font-bold">{stats.memoryHeapTotalMB} MB</span>
                      </div>
                    </div>
                  </div>

                  {/* Data Safety / Persistence Health */}
                  <div className={`bg-[#0c090a] border p-6 rounded-2xl shadow-sm text-left space-y-5 ${
                    systemHealth?.ok ? 'border-emerald-500/25' : 'border-amber-500/35'
                  }`}>
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          {systemHealth?.ok ? (
                            <ShieldCheck className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <ShieldAlert className="w-5 h-5 text-amber-400 animate-pulse" />
                          )}
                          <h3 className={`text-xs uppercase font-bold tracking-wider ${
                            systemHealth?.ok ? 'text-emerald-400' : 'text-amber-400'
                          }`}>
                            {isKa ? 'მონაცემთა უსაფრთხოება და შენახვა' : 'Data Safety & Persistence'}
                          </h3>
                        </div>
                        <p className="mt-1 text-[11px] text-stone-500 max-w-2xl">
                          {isKa
                            ? 'აჩვენებს, სად ინახება ამჟამად მარნის მონაცემები, როდის მოხდა ბოლო შენახვა და მუშაობს თუ არა აპლიკაცია სარეზერვო ბექენდზე.'
                            : 'Shows where winery data is currently being persisted, when the last save happened, and whether the app is running on a fallback backend.'}
                        </p>
                      </div>

                      <div className={`px-3 py-1.5 rounded-xl border text-[10px] uppercase tracking-widest font-black ${
                        systemHealth?.ok
                          ? 'bg-emerald-950/35 border-emerald-500/25 text-emerald-400'
                          : 'bg-amber-950/35 border-amber-500/30 text-amber-300'
                      }`}>
                        {systemHealth?.ok ? (isKa ? 'დაცულია' : 'Protected') : (isKa ? 'საჭიროებს ყურადღებას' : 'Needs Attention')}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                        <span className="text-[9px] text-stone-500 block mb-1 uppercase font-bold">{isKa ? 'აქტიური ბექენდი' : 'Active Backend'}</span>
                        <span className="text-sm font-bold text-cyan-400">{systemHealth?.db.activeBackendLabel || stats.persistenceMode}</span>
                        <p className="mt-1 text-[10px] text-stone-550">
                          {isKa ? 'რეჟიმი:' : 'Mode:'} {systemHealth?.db.persistenceMode || (isKa ? 'უცნობი' : 'unknown')}
                        </p>
                      </div>

                      <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                        <span className="text-[9px] text-stone-500 block mb-1 uppercase font-bold">{isKa ? 'ბოლო ლოკალური შენახვა' : 'Last Local Save'}</span>
                        <span className="text-xs font-bold text-emerald-400">{formatDateTime(systemHealth?.db.json.lastLocalSaveAt)}</span>
                        <p className="mt-1 text-[10px] text-stone-550">
                          {isKa ? 'ფაილი:' : 'File:'} {formatBytes(systemHealth?.db.json.localFileSizeBytes)}
                        </p>
                      </div>

                      <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                        <span className="text-[9px] text-stone-500 block mb-1 uppercase font-bold">{isKa ? 'ღრუბელი / SQL სარკე' : 'Cloud / SQL Mirror'}</span>
                        <span className="text-xs font-bold text-purple-400">
                          {systemHealth?.db.postgres.usable
                            ? `Postgres ${formatDateTime(systemHealth.db.postgres.lastMetadataSyncAt)}`
                            : systemHealth?.db.json.gcsEnabled
                              ? `GCS ${formatDateTime(systemHealth.db.json.lastGcsUploadAt)}`
                              : (isKa ? 'ღრუბლოვანი სარკე არ არის აქტიური' : 'No cloud mirror active')}
                        </span>
                        <p className="mt-1 text-[10px] text-stone-550 truncate">
                          {systemHealth?.db.postgres.usable
                            ? systemHealth.db.postgres.target || (isKa ? 'PostgreSQL კონფიგურირებულია' : 'PostgreSQL configured')
                            : systemHealth?.db.json.gcsTarget || (isKa ? '(ლოკალური ფაილი)' : '(local file)')}
                        </p>
                      </div>

                      <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                        <span className="text-[9px] text-stone-500 block mb-1 uppercase font-bold">{isKa ? 'სნეპშოტის ზომა' : 'Snapshot Size'}</span>
                        <span className="text-sm font-bold text-amber-400">{formatBytes(systemHealth?.db.memory.serializedBytes)}</span>
                        <p className="mt-1 text-[10px] text-stone-550">
                          {isKa
                            ? `${systemHealth?.db.memory.orgDataCount || 0} ორგანიზაციის მონაცემი ქეშშია`
                            : `${systemHealth?.db.memory.orgDataCount || 0} org datasets cached`}
                        </p>
                      </div>
                    </div>

                    <div className="bg-stone-950/45 border border-cyan-900/20 rounded-2xl p-4">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-3">
                        <div>
                          <span className="text-[9px] text-stone-500 block mb-1 uppercase font-black tracking-widest">{isKa ? 'PostgreSQL JSONB სნეპშოტები' : 'PostgreSQL JSONB Snapshots'}</span>
                          <p className="text-[11px] text-stone-500">
                            {isKa
                              ? 'ორგანიზაციების მდგომარეობის სნეპშოტების ვერსიის მეტამონაცემები (მოძველებული ჩანაწერით გადაწერისგან დასაცავად).'
                              : 'Version metadata for organization state snapshots used by stale-write protection.'}
                          </p>
                        </div>
                        <div className="text-[10px] text-cyan-400 font-mono">
                          tracked={systemHealth?.db.organizationStates?.trackedCount || 0}
                          {systemHealth?.db.organizationStates?.latestVersion !== null && systemHealth?.db.organizationStates?.latestVersion !== undefined
                            ? ` · latest=v${systemHealth.db.organizationStates.latestVersion}`
                            : ''}
                        </div>
                      </div>

                      {systemHealth?.db.organizationStates?.states?.length ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                          {systemHealth.db.organizationStates.states.slice(0, 4).map(snapshot => (
                            <div key={snapshot.organizationId} className="rounded-xl border border-stone-850 bg-[#080607] p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-stone-200 truncate">{snapshot.organizationName}</p>
                                  <p className="text-[10px] text-stone-550 font-mono truncate">{snapshot.organizationId}</p>
                                </div>
                                <span className="shrink-0 rounded-lg border border-purple-500/20 bg-purple-950/25 px-2 py-1 text-[10px] font-black text-purple-300">
                                  {snapshot.version !== null ? `v${snapshot.version}` : (isKa ? 'უვერსიო' : 'unversioned')}
                                </span>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                                <div>
                                  <span className="block text-stone-600 uppercase font-bold">{isKa ? 'განახლდა' : 'Updated'}</span>
                                  <span className="text-emerald-400 font-semibold">{formatDateTime(snapshot.updatedAt)}</span>
                                </div>
                                <div>
                                  <span className="block text-stone-600 uppercase font-bold">{isKa ? 'წყარო' : 'Source'}</span>
                                  <span className="text-cyan-400 font-semibold">{snapshot.source}</span>
                                </div>
                                <div>
                                  <span className="block text-stone-600 uppercase font-bold">{isKa ? 'განაახლა' : 'Updated By'}</span>
                                  <span className="text-stone-400 font-mono truncate block">{snapshot.updatedBy || 'n/a'}</span>
                                </div>
                                <div>
                                  <span className="block text-stone-600 uppercase font-bold">{isKa ? 'ზომა' : 'Size'}</span>
                                  <span className="text-amber-400 font-semibold">{formatBytes(snapshot.dataSizeBytes)}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-3 text-[11px] text-amber-200">
                          {isKa
                            ? 'ორგანიზაციის მდგომარეობის სნეპშოტები მეხსიერებაში ჯერ არ არის. ეს ნორმალურია პირველ PostgreSQL შენახვამდე.'
                            : 'No organization state snapshots are currently tracked in memory. This is expected before the first PostgreSQL-backed winery save.'}
                        </div>
                      )}
                    </div>

                    <div className={`rounded-2xl border p-4 ${
                      systemHealth?.deployment.scaleReadiness?.safeToRaiseMaxInstances
                        ? 'bg-emerald-950/15 border-emerald-500/20'
                        : 'bg-amber-950/10 border-amber-500/20'
                    }`}>
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                        <div>
                          <span className="text-[9px] text-stone-500 block mb-1 uppercase font-black tracking-widest">{isKa ? 'Cloud Run მასშტაბირების მზადყოფნა' : 'Cloud Run Scaling Readiness'}</span>
                          <p className="text-[11px] text-stone-500 max-w-2xl">
                            {isKa
                              ? 'ამოწმებს, უსაფრთხოა თუ არა Cloud Run-ის ერთზე მეტ ინსტანსზე გაზრდა მოძველებული წაკითხვის ან მარნის მდგომარეობის გადაწერის რისკის გარეშე.'
                              : 'Checks whether it is safe to raise Cloud Run above one instance without risking stale reads or overwritten winery state.'}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-xl border px-3 py-1.5 text-[10px] uppercase tracking-widest font-black ${
                          systemHealth?.deployment.scaleReadiness?.safeToRaiseMaxInstances
                            ? 'bg-emerald-950/40 border-emerald-500/25 text-emerald-300'
                            : 'bg-amber-950/30 border-amber-500/25 text-amber-300'
                        }`}>
                          {systemHealth?.deployment.scaleReadiness?.currentRecommendation || (isKa ? 'მოწმდება...' : 'checking...')}
                        </span>
                      </div>

                      <div className={`mt-4 rounded-xl border p-3 ${
                        postgresProbe?.configured
                          ? postgresProbe.ok
                            ? 'border-emerald-500/15 bg-emerald-950/10'
                            : 'border-amber-500/15 bg-amber-950/10'
                          : 'border-stone-800 bg-[#080607]'
                      }`}>
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                          <div>
                            <div className="text-[10px] uppercase tracking-widest font-black text-cyan-300">{isKa ? 'PostgreSQL ცოცხალი შემოწმება' : 'Live PostgreSQL probe'}</div>
                            <div className="mt-1 text-[10px] text-stone-500">
                              {isKa ? 'სამიზნე:' : 'Target:'} <span className="text-stone-300">{postgresProbe?.target || (isKa ? 'არ არის კონფიგურირებული' : 'not configured')}</span>
                              <span className="mx-2 text-stone-700">•</span>
                              {isKa ? 'შემოწმდა:' : 'Checked:'} <span className="text-stone-300">{formatDateTime(postgresProbe?.checkedAt)}</span>
                            </div>
                          </div>
                          <span className={`self-start lg:self-auto rounded-lg border px-2.5 py-1 text-[9px] uppercase tracking-widest font-black ${
                            postgresProbe?.configured
                              ? postgresProbe.ok
                                ? 'border-emerald-500/20 bg-emerald-950/30 text-emerald-300'
                                : 'border-amber-500/20 bg-amber-950/30 text-amber-300'
                              : 'border-stone-700 bg-stone-900 text-stone-400'
                          }`}>
                            {postgresProbe?.configured
                              ? (postgresProbe.ok ? (isKa ? 'სქემა მზადაა' : 'schema ready') : (isKa ? 'საჭიროებს ყურადღებას' : 'needs attention'))
                              : (isKa ? 'არააქტიური' : 'inactive')}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
                          {liveProbeItems.map(item => (
                            <div key={item.label} className={`rounded-lg border p-2 ${
                              item.ok
                                ? 'border-emerald-500/10 bg-[#070b08]'
                                : postgresProbe?.configured
                                  ? 'border-amber-500/10 bg-[#0d0907]'
                                  : 'border-stone-800 bg-[#070607]'
                            }`}>
                              <div className="flex items-center gap-2">
                                {item.ok ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                ) : (
                                  <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${postgresProbe?.configured ? 'text-amber-300' : 'text-stone-600'}`} />
                                )}
                                <span className="text-[10px] font-black uppercase tracking-wider text-stone-200">{item.label}</span>
                              </div>
                              <p className="mt-1 text-[9px] text-stone-500">{item.description}</p>
                            </div>
                          ))}
                        </div>

                        {postgresProbe?.errors?.length ? (
                          <ul className="mt-3 space-y-1 text-[10px] text-amber-200 list-disc pl-5">
                            {postgresProbe.errors.map(error => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>

                      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="rounded-xl border border-emerald-500/10 bg-[#080607] p-3">
                          <div className="text-[10px] uppercase tracking-widest font-black text-emerald-400 mb-2">{isKa ? 'შესრულებული დაცვის ზომები' : 'Completed safeguards'}</div>
                          <ul className="space-y-1.5 text-[11px] text-stone-350">
                            {(systemHealth?.deployment.scaleReadiness?.completed || [isKa ? 'დაცვის ზომები ჯერ არ არის მოხსენებული.' : 'No scaling safeguards reported yet.']).map(item => (
                              <li key={item} className="flex gap-2">
                                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="rounded-xl border border-amber-500/10 bg-[#080607] p-3">
                          <div className="text-[10px] uppercase tracking-widest font-black text-amber-300 mb-2">{isKa ? 'დარჩენილი დაბრკოლებები' : 'Remaining blockers'}</div>
                          <ul className="space-y-1.5 text-[11px] text-stone-350">
                            {(systemHealth?.deployment.scaleReadiness?.blockers?.length
                              ? systemHealth.deployment.scaleReadiness.blockers
                              : [isKa
                                ? 'დაბრკოლებები არ არის მოხსენებული. პროდაქშენის ტრაფიკის გაზრდამდე დაადასტურეთ დატვირთვის ტესტით.'
                                : 'No blockers reported. Confirm with load testing before raising production traffic.']
                            ).map(item => (
                              <li key={item} className="flex gap-2">
                                {systemHealth?.deployment.scaleReadiness?.blockers?.length ? (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                                ) : (
                                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                                )}
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border border-cyan-500/10 bg-cyan-950/10 p-3 text-[11px] text-cyan-200">
                        {isKa ? 'შემდეგი ეტაპი:' : 'Next milestone:'} {systemHealth?.deployment.scaleReadiness?.nextMilestone || (isKa ? 'დაასრულეთ შენახვის მზადყოფნის შემოწმებები.' : 'Complete the persistence readiness checks.')}
                      </div>
                    </div>

                    {safetyWarnings.length > 0 ? (
                      <div className="bg-amber-950/20 border border-amber-500/20 rounded-xl p-4 space-y-2">
                        <div className="flex items-center gap-2 text-amber-300 text-[10px] uppercase tracking-widest font-black">
                          <AlertTriangle className="w-4 h-4" />
                          {isKa ? 'გაფრთხილებები' : 'Warnings'}
                        </div>
                        <ul className="space-y-1.5 text-[11px] text-amber-100/90 list-disc pl-5">
                          {safetyWarnings.map(warning => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-4 text-[11px] text-emerald-300 flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        {isKa ? 'შენახვის შემოწმებები გამართულია. გაფრთხილებები ამჟამად არ არის.' : 'Storage checks are clear. No persistence warnings are currently reported.'}
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3">
                      <a
                        href={systemHealth?.actions.exportUrl || '/api/admin/export'}
                        download="vinos_export.json"
                        className="flex-1 py-2.5 bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-300 hover:text-emerald-200 border border-emerald-500/20 hover:border-emerald-500/40 rounded-xl text-xs font-bold cursor-pointer transition-all uppercase tracking-wider text-center"
                      >
                        {isKa ? 'სანიტიზებული სარეზერვო JSON-ის ჩამოტვირთვა' : 'Download Sanitized Backup JSON'}
                      </a>
                      <button
                        onClick={() => handleSystemAction(systemHealth?.actions.forceSaveAction || 'save_db')}
                        className="flex-1 py-2.5 bg-cyan-950/30 hover:bg-cyan-950/50 text-cyan-450 hover:text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded-xl text-xs font-bold cursor-pointer transition-all uppercase tracking-wider text-center"
                      >
                        {isKa ? 'სნეპშოტის იძულებითი შენახვა' : 'Force Save Snapshot'}
                      </button>
                    </div>
                  </div>

                  {/* System Overview Control Panel */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-[#0c090a] border border-cyan-900/20 p-6 rounded-2xl lg:col-span-2 space-y-4 shadow-sm">
                      <h3 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'მარნების ბაზის მეტრიკები' : 'Winery Database Metrics'}</h3>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                        <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                          <span className="text-[10px] text-stone-450 block mb-1 uppercase font-bold">{isKa ? 'მომხმარებლები' : 'Users'}</span>
                          <span className="text-xl font-bold text-cyan-400">{stats.usersCount}</span>
                        </div>
                        <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                          <span className="text-[10px] text-stone-450 block mb-1 uppercase font-bold">{isKa ? 'მარნები' : 'Wineries'}</span>
                          <span className="text-xl font-bold text-cyan-400">{stats.orgsCount}</span>
                        </div>
                        <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                          <span className="text-[10px] text-stone-450 block mb-1 uppercase font-bold">{isKa ? 'წევრობები' : 'Memberships'}</span>
                          <span className="text-xl font-bold text-cyan-400">{stats.membershipsCount}</span>
                        </div>
                        <div className="p-4 bg-stone-950/60 border border-stone-850 rounded-xl">
                          <span className="text-[10px] text-stone-450 block mb-1 uppercase font-bold">{isKa ? 'მოწვევები' : 'Invitations'}</span>
                          <span className="text-xl font-bold text-cyan-400">{stats.invitationsCount}</span>
                        </div>
                      </div>

                      <div className="p-4 bg-stone-950/45 border border-cyan-900/10 rounded-xl space-y-2 text-xs leading-relaxed text-stone-400 text-left">
                        <p>✓ {isKa ? 'აქტიური შენახვის ბექენდი' : 'Active persistence backend'}: {systemHealth?.db.activeBackendLabel || stats.persistenceMode}.</p>
                        <p>✓ {isKa ? 'ბოლო ლოკალური სნეპშოტი' : 'Last local snapshot'}: {formatDateTime(systemHealth?.db.json.lastLocalSaveAt)}.</p>
                        <p>✓ {isKa ? 'სისტემის მდგომარეობა შემოწმდა' : 'Runtime health checked'}: {formatDateTime(systemHealth?.checkedAt)}.</p>
                      </div>

                      <div className="hidden p-4 bg-stone-950/45 border border-cyan-900/10 rounded-xl space-y-2 text-xs leading-relaxed text-stone-400 text-left">
                        <p>✓ All data is synchronized securely with PostgreSQL via Prisma ORM.</p>
                        <p>✓ Ephemeral memory caches are hydrated correctly on startup from durable storage.</p>
                        <p>✓ Active telemetry streams are running successfully under standard rate-limits.</p>
                      </div>
                    </div>

                    {/* Quick System Actions */}
                    <div className="bg-[#0c090a] border border-cyan-900/20 p-6 rounded-2xl space-y-4 shadow-sm text-left">
                      <h3 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'სისტემის მართვის ბრძანებები' : 'System Control Commands'}</h3>
                      <p className="text-[11px] text-stone-500">{isKa ? 'დაბალი დონის მანუალური ოპერაციები. ყველა ქმედება იწერება და აუდიტირებადია.' : 'Trigger low-level manual overrides. Actions are logged and auditable.'}</p>

                      <div className="space-y-2.5 pt-2">
                        <button
                          onClick={() => handleSystemAction('save_db')}
                          className="w-full py-2.5 bg-cyan-950/30 hover:bg-cyan-950/50 text-cyan-450 hover:text-cyan-400 border border-cyan-500/20 hover:border-cyan-500/40 rounded-xl text-xs font-bold cursor-pointer transition-all uppercase tracking-wider text-center"
                        >
                          💾 {isKa ? 'იძულებითი სარეზერვო შენახვა' : 'Force Serialization Backup'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Tab 2: User Accounts */}
              {activeTab === 'users' && (
                <motion.div
                  key="users"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4 text-left"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-400">{isKa ? 'მომხმარებელთა რეესტრი' : 'User Directory Registry'}</h2>
                      <p className="mt-1 text-[10px] text-stone-600">{filteredUsers.length} / {users.length} {isKa ? 'მომხმარებელი ნაჩვენებია' : 'accounts shown'}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AdminCsvExportButton kind="users" rows={filteredUsers} isKa={isKa} />
                      <select value={userView} onChange={event => setUserView(event.target.value as typeof userView)} className="bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs text-stone-300 outline-none focus:border-cyan-500/40">
                        <option value="all">{isKa ? 'ყველა მომხმარებელი' : 'All users'}</option>
                        <option value="online">{isKa ? 'ონლაინ' : 'Online now'}</option>
                        <option value="offline">{isKa ? 'ოფლაინ' : 'Offline'}</option>
                        <option value="unassigned">{isKa ? 'ორგანიზაციის გარეშე' : 'Unassigned'}</option>
                        <option value="disabled">{isKa ? 'გამორთული' : 'Disabled'}</option>
                        <option value="pending">{isKa ? 'დასამტკიცებელი' : 'Pending approval'}</option>
                      </select>
                      <input
                        type="text"
                        placeholder={isKa ? 'ძებნა სახელით, როლით, ორგანიზაციით...' : 'Search name, role, organization...'}
                        value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        className="w-80 bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs outline-none focus:border-cyan-500/40 text-stone-200 transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-900/25 bg-[#0c090a] p-3">
                    <span className="mr-auto text-[10px] font-bold text-stone-400">
                      {selectedUsernames.size} {isKa ? 'მონიშნული' : 'selected'}
                    </span>
                    <select value={bulkUserAction} onChange={event => setBulkUserAction(event.target.value)} className="rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300">
                      <option value="assign">{isKa ? 'ორგანიზაციაში მინიჭება' : 'Assign to organization'}</option>
                      <option value="enable">{isKa ? 'ანგარიშების ჩართვა' : 'Enable accounts'}</option>
                      <option value="disable">{isKa ? 'ანგარიშების გამორთვა' : 'Disable accounts'}</option>
                      <option value="revoke_sessions">{isKa ? 'სესიების გაუქმება' : 'Revoke sessions'}</option>
                    </select>
                    {bulkUserAction === 'assign' && <>
                      <select value={bulkOrganizationId} onChange={event => setBulkOrganizationId(event.target.value)} className="max-w-52 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300">
                        {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                      </select>
                      <select value={bulkRole} onChange={event => setBulkRole(event.target.value)} className="rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300">
                        {ORGANIZATION_ROLES.map(role => <option key={role}>{role}</option>)}
                      </select>
                    </>}
                    <button type="button" disabled={!selectedUsernames.size || bulkWorking} onClick={() => void handleBulkUsers()} className="flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-950/30 px-4 py-2 text-[10px] font-bold text-cyan-300 disabled:opacity-35">
                      {bulkWorking && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}{isKa ? 'გამოყენება' : 'Apply bulk action'}
                    </button>
                  </div>

                  <section className="bg-[#0c090a] border border-amber-900/30 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                      <h3 className="text-xs uppercase font-bold text-amber-400 tracking-wider">
                        {isKa ? 'დასამტკიცებელი რეგისტრაციები' : 'Access requests awaiting approval'}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-amber-950/40 border border-amber-500/30 text-amber-300 text-[10px] font-bold">
                        {pendingRegistrations.length}
                      </span>
                    </div>
                    {pendingRegistrations.length === 0 ? (
                      <p className="text-[11px] text-stone-500">
                        {isKa
                          ? 'ახალი მოთხოვნები არ არის. ყველა ახალი რეგისტრაცია აქ ჩნდება შესვლამდე.'
                          : 'No requests waiting. Every new signup lands here before it can sign in.'}
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {pendingRegistrations.map(request => (
                          <li
                            key={request.username}
                            className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-stone-850 bg-stone-950/60 p-4"
                          >
                            <div className="min-w-0 space-y-1">
                              <div className="font-bold text-stone-100">{request.fullName || `@${request.username}`}</div>
                              <div className="text-[11px] font-mono text-stone-400 break-all">{request.email}</div>
                              <div className="text-[10px] text-stone-500">
                                {[
                                  request.companyName,
                                  [request.region, request.country].filter(Boolean).join(', '),
                                  request.phone,
                                  request.provider === 'google' ? 'Google' : (isKa ? 'პაროლი' : 'Passcode'),
                                  request.emailVerified
                                    ? (isKa ? 'ელფოსტა დადასტურებულია' : 'Email confirmed')
                                    : (isKa ? 'ელფოსტა არ არის დადასტურებული' : 'Email not confirmed'),
                                  request.requestedAt ? formatDateTime(request.requestedAt) : '',
                                ].filter(Boolean).join(' • ')}
                              </div>
                              {request.approvalBlockedReasons && request.approvalBlockedReasons.length > 0 && (
                                <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-950/25 px-2.5 py-2 text-[10px] font-semibold leading-4 text-amber-300">
                                  {isKa ? 'დამტკიცებამდე საჭიროა: ' : 'Required before approval: '}
                                  {request.approvalBlockedReasons.join(', ')}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleRegistrationDecision(request.username, 'approve')}
                                disabled={decidingUsername !== null || Boolean(request.approvalBlockedReasons?.length)}
                                title={request.approvalBlockedReasons?.length ? (isKa ? 'ჯერ შეავსეთ სავალდებულო მონაცემები' : 'Required registration details are missing') : undefined}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wide transition-colors hover:bg-emerald-900/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                              >
                                {decidingUsername === request.username
                                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  : <Check className="w-3.5 h-3.5" />}
                                {isKa ? 'დამტკიცება' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRegistrationDecision(request.username, 'reject')}
                                disabled={decidingUsername !== null}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-900 border border-stone-850 text-stone-400 text-[10px] font-bold uppercase tracking-wide transition-colors hover:border-red-500/30 hover:text-red-400 disabled:opacity-40 disabled:cursor-wait cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                                {isKa ? 'უარყოფა' : 'Reject'}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <div className="overflow-x-auto rounded-2xl border border-cyan-900/20 bg-[#0c090a] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                    <table className="w-full min-w-[1140px] text-xs text-left border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
                          <th className="w-10 px-4 py-3">
                            <input type="checkbox" aria-label={isKa ? 'ყველა ნაჩვენები მომხმარებლის მონიშვნა' : 'Select all visible users'} checked={filteredUsers.length > 0 && filteredUsers.every(user => selectedUsernames.has(user.username))} onChange={event => setSelectedUsernames(current => { const next = new Set(current); filteredUsers.forEach(user => event.target.checked ? next.add(user.username) : next.delete(user.username)); return next; })} className="accent-cyan-500" />
                          </th>
                          <th className="px-5 py-3">{isKa ? 'ანგარიში' : 'Winemaker Account'}</th>
                          <th className="px-5 py-3">{isKa ? 'ელფოსტა' : 'Email Address'}</th>
                          <th className="px-5 py-3">{isKa ? 'პლატფორმის როლი' : 'Platform Role'}</th>
                          <th className="px-5 py-3">{isKa ? 'მარნის სამუშაო სივრცეები' : 'Winery Workspaces'}</th>
                          <th className="px-5 py-3">{isKa ? 'ვერიფიკაცია' : 'Verification'}</th>
                          <th className="px-5 py-3 text-right">{isKa ? 'ქმედებები' : 'Actions'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-900/50">
                        {filteredUsers.map(u => {
                          const isMaster = u.username.toLowerCase() === currentUser.username.toLowerCase();
                          return (
                            <tr key={u.id} className="hover:bg-stone-900/30 transition-colors">
                              <td className="px-4 py-3.5">
                                <input type="checkbox" aria-label={`${u.username} ${isKa ? 'მონიშვნა' : 'select'}`} checked={selectedUsernames.has(u.username)} onChange={() => toggleUserSelection(u.username)} className="accent-cyan-500" />
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-2 font-bold text-stone-200">
                                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${u.isOnline ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.85)]' : 'bg-stone-700'}`} title={u.isOnline ? (isKa ? 'ონლაინ' : 'Online now') : (isKa ? 'ოფლაინ' : 'Offline')} />
                                  @{u.username}
                                </div>
                                <div className="text-[10px] text-stone-500 mt-0.5">{u.fullName}</div>
                                <div className={`mt-1 text-[9px] ${u.isOnline ? 'text-emerald-500' : 'text-stone-650'}`}>
                                  {u.isOnline ? (isKa ? 'ონლაინ ახლა' : 'Online now') : `${isKa ? 'ბოლო აქტივობა' : 'Last seen'}: ${formatDateTime(u.lastSeenAt)}`}
                                </div>
                              </td>
                              <td className="px-5 py-3.5 text-stone-300 font-mono">{u.email}</td>
                              <td className="px-5 py-3.5">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border capitalize ${
                                  u.role === 'Owner/Admin'
                                    ? 'bg-purple-950/30 border-purple-500/30 text-purple-400'
                                    : 'bg-blue-950/30 border-blue-500/30 text-blue-400'
                                }`}>
                                  {isKa ? localizedRoleLabel(u.role, lang) : u.role}
                                </span>
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="flex flex-wrap gap-1">
                                  {u.organizations.map(o => (
                                    <span key={o.id} className={`px-1.5 py-0.5 border rounded text-[9px] ${
                                      u.activeOrganizationId === o.id
                                        ? 'bg-cyan-950/35 text-cyan-300 border-cyan-500/30'
                                        : 'bg-stone-900 text-stone-400 border-stone-850'
                                    }`}>
                                      {o.name} ({o.role}){u.activeOrganizationId === o.id ? (isKa ? ' · აქტიური' : ' · active') : ''}
                                    </span>
                                  ))}
                                  {u.organizations.length === 0 && (
                                    <span className="text-stone-550 italic text-[10px]">{isKa ? 'სამუშაო სივრცე არ აქვს' : 'No workspaces'}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-3.5">
                                <span className={`flex items-center gap-1.5 font-bold ${
                                  u.accountEnabled === false || u.approvalStatus === 'rejected'
                                    ? 'text-red-500'
                                    : u.approvalStatus === 'pending'
                                      ? 'text-amber-400'
                                      : u.emailVerified ? 'text-emerald-500' : 'text-amber-500'
                                }`}>
                                  {u.accountEnabled === false ? (
                                    <>
                                      <ShieldAlert className="w-3.5 h-3.5" />
                                      <span>{isKa ? 'გამორთული' : 'DISABLED'}</span>
                                    </>
                                  ) : u.approvalStatus === 'rejected' ? (
                                    <>
                                      <ShieldAlert className="w-3.5 h-3.5" />
                                      <span>{isKa ? 'უარყოფილი' : 'REJECTED'}</span>
                                    </>
                                  ) : u.approvalStatus === 'pending' ? (
                                    <>
                                      <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                      <span>{isKa ? 'დასამტკიცებელი' : 'AWAITING APPROVAL'}</span>
                                    </>
                                  ) : u.emailVerified ? (
                                    <>
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      <span>{isKa ? 'ვერიფიცირებული' : 'VERIFIED'}</span>
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle className="w-3.5 h-3.5 animate-pulse" />
                                      <span>{isKa ? 'არავერიფიცირებული' : 'UNVERIFIED'}</span>
                                    </>
                                  )}
                                </span>
                              </td>
                              <td className="px-5 py-3.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => {
                                      const reason = window.prompt(isKa ? 'მიუთითეთ მხარდაჭერის სესიის მიზეზი' : 'Enter a reason for this support session');
                                      if (!reason) return;
                                      if (reason.trim().length < 5) {
                                        setToastMessage(isKa ? 'მიზეზი მინიმუმ 5 სიმბოლო უნდა იყოს' : 'Reason must be at least 5 characters');
                                        return;
                                      }
                                      void handleImpersonate(u.username, reason.trim());
                                    }}
                                    disabled={isMaster || u.accountEnabled === false || impersonatingUsername !== null}
                                    className={`p-1.5 bg-stone-900 border border-stone-850 rounded-lg transition-colors ${
                                      isMaster || u.accountEnabled === false || impersonatingUsername !== null
                                        ? 'opacity-30 cursor-not-allowed text-stone-600'
                                        : 'hover:border-emerald-500/30 text-stone-450 hover:text-emerald-400 cursor-pointer'
                                    }`}
                                    title={isMaster
                                      ? (isKa ? 'უკვე შესული ხართ როგორც მთავარი ადმინი' : 'Already signed in as master admin')
                                      : (isKa ? 'აპის ნახვა ამ მომხმარებლის სახელით (აუდიტირებადი)' : 'View app as this user (audited)')}
                                  >
                                    {impersonatingUsername === u.username
                                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      : <Eye className="w-3.5 h-3.5" />}
                                  </button>
                                  <button
                                    onClick={() => openMembershipManager(u)}
                                    className="p-1.5 bg-stone-900 border border-stone-850 hover:border-purple-500/30 text-stone-450 hover:text-purple-400 rounded-lg cursor-pointer transition-colors"
                                    title={isKa ? 'ორგანიზაციებისა და როლების მართვა' : 'Manage organizations and roles'}
                                  >
                                    <Users className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingUser(u);
                                      setEditRole(u.role);
                                      setEditEmail(u.email);
                                      setEditVerified(u.emailVerified);
                                      setEditEnabled(u.accountEnabled !== false);
                                    }}
                                    className="p-1.5 bg-stone-900 border border-stone-850 hover:border-cyan-500/30 text-stone-450 hover:text-cyan-400 rounded-lg cursor-pointer transition-colors"
                                    title={isKa ? 'დეტალების / კოდის რედაქტირება' : 'Edit details / passcode'}
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingUsername(u.username)}
                                    disabled={isMaster}
                                    className={`p-1.5 bg-stone-900 border border-stone-850 rounded-lg transition-colors ${
                                      isMaster
                                        ? 'opacity-30 cursor-not-allowed text-stone-600'
                                        : 'hover:border-red-500/30 text-stone-450 hover:text-red-400 cursor-pointer'
                                    }`}
                                    title={isMaster
                                      ? (isKa ? 'საკუთარი ანგარიშის წაშლა შეუძლებელია' : 'Cannot delete yourself')
                                      : (isKa ? 'ანგარიშის წაშლა' : 'Terminate account')}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {/* Tab 3: Organizations */}
              {activeTab === 'orgs' && (
                <motion.div
                  key="orgs"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4 text-left"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-400">{isKa ? 'მარნების (ორგანიზაციების) რეესტრი' : 'Winery Organizations Registry'}</h2>
                      <p className="mt-1 text-[10px] text-stone-600">{filteredOrgs.length} / {orgs.length} {isKa ? 'ორგანიზაცია ნაჩვენებია' : 'organizations shown'}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <AdminCsvExportButton kind="organizations" rows={filteredOrgs} isKa={isKa} />
                      <select value={orgView} onChange={event => setOrgView(event.target.value as typeof orgView)} className="bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs text-stone-300 outline-none focus:border-cyan-500/40">
                        <option value="all">{isKa ? 'ყველა ორგანიზაცია' : 'All organizations'}</option>
                        <option value="active">{isKa ? 'აქტიური' : 'Active'}</option>
                        <option value="suspended">{isKa ? 'შეჩერებული' : 'Suspended'}</option>
                        <option value="archived">{isKa ? 'არქივირებული' : 'Archived'}</option>
                        <option value="attention">{isKa ? 'საჭიროებს ყურადღებას' : 'Needs attention'}</option>
                      </select>
                      <input
                        type="text"
                        placeholder={isKa ? 'ძებნა სახელით, ID-ით ან ტეგით...' : 'Search by name, ID, or internal tag...'}
                        value={orgSearch}
                        onChange={e => setOrgSearch(e.target.value)}
                        className="w-72 bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs outline-none focus:border-cyan-500/40 text-stone-200 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setCreatingOrganization(true)}
                        disabled={users.length === 0}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-cyan-950/35 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-950/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        title={users.length === 0 ? (isKa ? 'ჯერ შექმენით მომხმარებელი' : 'Create a user first') : undefined}
                      >
                        <Plus className="w-3.5 h-3.5" /> {isKa ? 'ახალი ორგანიზაცია' : 'New organization'}
                      </button>
                    </div>
                  </div>

                  <AdminOrganizationBulkBar
                    isKa={isKa}
                    selectedCount={selectedOrganizationIds.size}
                    status={bulkOrganizationStatus}
                    reason={bulkOrganizationReason}
                    working={bulkOrganizationWorking}
                    onStatusChange={setBulkOrganizationStatus}
                    onReasonChange={setBulkOrganizationReason}
                    onApply={() => void handleBulkOrganizations()}
                  />

                  <div className="overflow-x-auto rounded-2xl border border-cyan-900/20 bg-[#0c090a] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                    <table className="w-full min-w-[1020px] text-xs text-left border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
                          <th className="w-10 px-4 py-3">
                            <input type="checkbox" aria-label={isKa ? 'ყველა ნაჩვენები ორგანიზაციის მონიშვნა' : 'Select all visible organizations'} checked={filteredOrgs.length > 0 && filteredOrgs.every(org => selectedOrganizationIds.has(org.id))} onChange={event => setSelectedOrganizationIds(current => { const next = new Set(current); filteredOrgs.forEach(org => event.target.checked ? next.add(org.id) : next.delete(org.id)); return next; })} className="accent-cyan-500" />
                          </th>
                          <th className="px-5 py-3">{isKa ? 'მარნის სახელი / ID' : 'Winery Name / ID'}</th>
                          <th className="px-5 py-3">{isKa ? 'რეგისტრაციის თარიღი' : 'Date Registered'}</th>
                          <th className="px-5 py-3">{isKa ? 'წევრები' : 'Members Count'}</th>
                          <th className="px-5 py-3">{isKa ? 'ჭურჭელი / რეზერვუარები' : 'Vessels / Tanks'}</th>
                          <th className="px-5 py-3">{isKa ? 'ღვინის პარტიები' : 'Wine Lots'}</th>
                          <th className="px-5 py-3 text-right">{isKa ? 'მონაცემთა ზომა (ბაიტი)' : 'Data Size (Bytes)'}</th>
                          <th className="px-5 py-3 text-right">{isKa ? 'ინსპექცია' : 'Inspect'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-900/50">
                        {filteredOrgs.map(o => (
                          <tr key={o.id} className={`transition-colors ${inspectingOrgId === o.id ? 'bg-cyan-950/15' : 'hover:bg-stone-900/30'}`}>
                            <td className="px-4 py-3.5">
                              <input type="checkbox" aria-label={`${o.name} ${isKa ? 'მონიშვნა' : 'select'}`} checked={selectedOrganizationIds.has(o.id)} onChange={() => toggleOrganizationSelection(o.id)} className="accent-cyan-500" />
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex flex-wrap items-center gap-2 font-bold text-stone-200">
                                {o.name}
                                <span className={`rounded-full border px-2 py-0.5 text-[8px] uppercase ${o.status === 'active' ? 'border-emerald-500/25 bg-emerald-950/30 text-emerald-400' : o.status === 'suspended' ? 'border-amber-500/25 bg-amber-950/30 text-amber-400' : 'border-stone-700 bg-stone-900 text-stone-400'}`}>{o.status}</span>
                                {o.health.level !== 'healthy' && <span className="rounded-full border border-red-500/25 bg-red-950/20 px-2 py-0.5 text-[8px] uppercase text-red-400" title={o.health.issues.join(', ')}>{isKa ? 'ყურადღება' : 'attention'}</span>}
                              </div>
                              <div className="text-[9.5px] text-stone-500 font-mono mt-0.5">{o.id}</div>
                              {o.internalTags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">
                                {o.internalTags.slice(0, 3).map(tag => <span key={tag} className="rounded-md border border-violet-500/15 bg-violet-950/20 px-1.5 py-0.5 text-[8px] font-medium text-violet-300/80">{tag}</span>)}
                                {o.internalTags.length > 3 && <span className="px-1 py-0.5 text-[8px] text-stone-600">+{o.internalTags.length - 3}</span>}
                              </div>}
                            </td>
                            <td className="px-5 py-3.5 text-stone-400 font-mono">
                              {formatDateOnly(o.createdAt)}
                            </td>
                            <td className="px-5 py-3.5 text-stone-300 font-bold">
                              {o.membersCount}
                              <span className="block text-[9px] font-normal text-stone-600">
                                {o.ownersCount} {isKa ? 'მფლობელი' : `owner${o.ownersCount === 1 ? '' : 's'}`}
                              </span>
                              <span className="mt-1 flex items-center gap-1 text-[9px] font-normal text-emerald-500">
                                <span className={`h-2 w-2 rounded-full ${o.onlineMembersCount > 0 ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,.8)]' : 'bg-stone-700 shadow-none'}`} />
                                {o.onlineMembersCount} {isKa ? 'ონლაინ' : 'online'}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-stone-300 font-bold">{o.tanksCount}</td>
                            <td className="px-5 py-3.5 text-stone-300 font-bold">{o.lotsCount}</td>
                            <td className="px-5 py-3.5 text-right font-mono text-cyan-400">
                              {o.dataSize.toLocaleString()} B
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleInspectOrg(o.id)}
                                  className={`p-1.5 bg-stone-900 border rounded-lg cursor-pointer transition-colors ${
                                    inspectingOrgId === o.id
                                      ? 'border-cyan-500/40 text-cyan-400'
                                      : 'border-stone-850 hover:border-cyan-500/30 text-stone-450 hover:text-cyan-400'
                                  }`}
                                  title={isKa ? 'ჩანაწერების რაოდენობა და სიახლე კოლექციების მიხედვით' : 'Per-collection record counts & freshness'}
                                >
                                  <SearchCode className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => openOrganizationManager(o)}
                                  className="p-1.5 bg-stone-900 border border-stone-850 hover:border-purple-500/30 text-stone-450 hover:text-purple-400 rounded-lg cursor-pointer transition-colors"
                                  title={isKa ? 'ორგანიზაციის სწრაფი ქმედებები' : 'Open organization quick actions'}
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Full organization workspace */}
                  {inspectingOrgId && (
                    <div id="admin-organization-workspace" className="scroll-mt-5">
                      {inspection && !inspectionLoading ? (
                        <AdminOrganizationWorkspace
                          detail={inspection}
                          isKa={isKa}
                          loading={inspectionLoading}
                          onClose={() => { setInspectingOrgId(null); setInspection(null); }}
                          onMessage={setToastMessage}
                          onRefresh={refreshOrganizationWorkspace}
                          onManageUser={username => {
                            const user = users.find(candidate => candidate.username === username);
                            if (user) openMembershipManager(user);
                          }}
                          onOpenBilling={organizationId => {
                            setInitialBillingOrgId(organizationId);
                            setActiveTab('billing');
                          }}
                        />
                      ) : (
                        <div className="flex items-center gap-2 rounded-2xl border border-cyan-500/25 bg-[#0c090a] p-5 text-xs font-bold text-cyan-500">
                          <RefreshCw className="w-4 h-4 animate-spin" /> {isKa ? 'ორგანიზაციის სამუშაო სივრცე იტვირთება...' : 'LOADING ORGANIZATION WORKSPACE...'}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Tab: Ops & Security */}
              {activeTab === 'ops' && (
                <motion.div
                  key="ops"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-6 text-left"
                >
                  <h2 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'ოპერაციებისა და უსაფრთხოების ინსტრუმენტები' : 'Operations & Security Toolkit'}</h2>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Data & backups */}
                    <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl p-5 space-y-4">
                      <h3 className="text-[10px] uppercase font-bold text-stone-400 tracking-widest flex items-center gap-2">
                        <Database className="w-4 h-4 text-cyan-400" /> {isKa ? 'მონაცემები და სარეზერვო ასლები' : 'Data & Backups'}
                      </h3>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => handleSystemAction('save_db')}
                          className="flex items-center gap-2 px-4 py-2.5 bg-cyan-950/30 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-bold hover:bg-cyan-950/60 transition-colors cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4" /> {isKa ? 'იძულებითი მყარი შენახვა' : 'Force Durable Save'}
                        </button>
                        <a
                          href="/api/admin/export"
                          className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 border border-stone-800 text-stone-300 rounded-xl text-xs font-bold hover:border-cyan-500/30 hover:text-cyan-300 transition-colors cursor-pointer"
                        >
                          <Download className="w-4 h-4" /> {isKa ? 'სისტემის ექსპორტის ჩამოტვირთვა' : 'Download System Export'}
                        </a>
                      </div>
                      <p className="text-[10px] text-stone-500 leading-relaxed">
                        {isKa
                          ? 'ექსპორტი არის სანიტიზებული JSON სნეპშოტი (პაროლის ჰეშები და მომხმარებელთა პირადი მარნის ჩანაწერები ამოღებულია). მყარი შენახვა მიმდინარე მდგომარეობას მაშინვე წერს ძირითად ბექენდში.'
                          : 'The export is a sanitized JSON snapshot (credential hashes and per-user winery records excluded). Durable save pushes the live state to the primary backend immediately.'}
                      </p>
                    </div>

                    {/* Outbound email */}
                    <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl p-5 space-y-4">
                      <h3 className="text-[10px] uppercase font-bold text-stone-400 tracking-widest flex items-center gap-2">
                        <Mail className="w-4 h-4 text-cyan-400" /> {isKa ? 'გამავალი ელფოსტის შემოწმება' : 'Outbound Email Check'}
                      </h3>
                      <div className="flex gap-2">
                        <input
                          type="email"
                          value={testEmailTo}
                          onChange={e => setTestEmailTo(e.target.value)}
                          placeholder="recipient@example.com"
                          className="flex-1 bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs outline-none focus:border-cyan-500/40 text-stone-200"
                        />
                        <button
                          onClick={handleSendTestEmail}
                          disabled={sendingTestEmail || !testEmailTo.trim()}
                          className="flex items-center gap-2 px-4 py-2 bg-cyan-950/30 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-bold hover:bg-cyan-950/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {sendingTestEmail ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                          {isKa ? 'ტესტის გაგზავნა' : 'Send Test'}
                        </button>
                      </div>
                      <p className="text-[10px] text-stone-500 leading-relaxed">
                        {isKa
                          ? 'ამოწმებს SMTP მიწოდებას ბოლომდე. SMTP-ის გარეშე წერილი მხოლოდ სერვერის კონსოლში ჩაიწერება — სარეგისტრაციო წერილები რეალურ მომხმარებლებამდე ვერ მივა.'
                          : 'Verifies SMTP delivery end-to-end. Without SMTP configured the message is logged to the server console instead — registration emails will not reach real users.'}
                      </p>
                    </div>
                  </div>

                  {/* Login lockouts */}
                  <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl overflow-hidden">
                    <div className="px-5 py-4 flex items-center justify-between border-b border-stone-900">
                      <h3 className="text-[10px] uppercase font-bold text-stone-400 tracking-widest flex items-center gap-2">
                        <KeyRound className="w-4 h-4 text-cyan-400" /> {isKa ? 'შესვლის შეცდომები და ბლოკირებები' : 'Login Failures & Lockouts'}
                        {lockoutsBackend && <span className="text-stone-600 normal-case font-mono">{isKa ? 'ბექენდი:' : 'backend:'} {lockoutsBackend}</span>}
                      </h3>
                      <span className="text-[10px] font-mono text-stone-500">{lockouts.length} {isKa ? 'აღრიცხული' : 'tracked'}</span>
                    </div>
                    {lockouts.length === 0 ? (
                      <div className="px-5 py-8 text-center text-stone-600 text-xs">
                        {isKa
                          ? 'ბოლო პერიოდში წარუმატებელი შესვლები ან აქტიური ბლოკირებები არ არის.'
                          : 'No recent failed logins or active lockouts. The brute-force limiter is quiet.'}
                      </div>
                    ) : (
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
                            <th className="px-5 py-3">{isKa ? 'IP : იდენტიფიკატორი' : 'IP : Identifier'}</th>
                            <th className="px-5 py-3">{isKa ? 'შეცდომები' : 'Failures'}</th>
                            <th className="px-5 py-3">{isKa ? 'სტატუსი' : 'Status'}</th>
                            <th className="px-5 py-3 text-right">{isKa ? 'ქმედება' : 'Action'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-900/50">
                          {lockouts.map(l => (
                            <tr key={l.key} className="hover:bg-stone-900/30 transition-colors">
                              <td className="px-5 py-3 font-mono text-stone-300">{l.key}</td>
                              <td className="px-5 py-3 font-bold text-stone-300">{l.count}</td>
                              <td className="px-5 py-3">
                                {l.remainingSeconds > 0 ? (
                                  <span className="text-red-400 font-bold">{isKa ? `დაბლოკილია · დარჩა ${l.remainingSeconds}წმ` : `LOCKED · ${l.remainingSeconds}s left`}</span>
                                ) : (
                                  <span className="text-amber-500">{isKa ? 'შეცდომების აღრიცხვა' : 'counting failures'}</span>
                                )}
                              </td>
                              <td className="px-5 py-3 text-right">
                                <button
                                  onClick={() => handleClearLockout(l.key)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 border border-stone-850 hover:border-emerald-500/30 text-stone-400 hover:text-emerald-400 rounded-lg text-[10px] font-bold cursor-pointer transition-colors"
                                >
                                  <Unlock className="w-3 h-3" /> {isKa ? 'განბლოკვა' : 'UNLOCK'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Tab: Admin Trail */}
              {activeTab === 'audit' && (
                <motion.div
                  key="audit"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4 text-left"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'მთავარი ადმინის ქმედებების ისტორია' : 'Master Admin Action Trail'}</h2>
                    <span className="text-[10px] font-mono text-stone-500">
                      {isKa ? `${adminTrail.length} ჩანაწერი · პროცესის ბუფერში` : `${adminTrail.length} recorded · in-process buffer`}
                    </span>
                  </div>
                  <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl overflow-hidden">
                    {adminTrail.length === 0 ? (
                      <div className="px-5 py-10 text-center text-stone-600 text-xs">
                        {isKa
                          ? 'ამ სერვერის პროცესის დაწყებიდან პრივილეგირებული ქმედებები არ დაფიქსირებულა.'
                          : 'No privileged actions recorded since this server process started.'}
                      </div>
                    ) : (
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
                            <th className="px-5 py-3">{isKa ? 'დრო' : 'Timestamp'}</th>
                            <th className="px-5 py-3">{isKa ? 'შემსრულებელი' : 'Actor'}</th>
                            <th className="px-5 py-3">{isKa ? 'ქმედება' : 'Action'}</th>
                            <th className="px-5 py-3">{isKa ? 'სამიზნე' : 'Target'}</th>
                            <th className="px-5 py-3">{isKa ? 'დეტალი' : 'Detail'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-900/50">
                          {adminTrail.map((a, i) => (
                            <tr key={`${a.at}-${i}`} className="hover:bg-stone-900/30 transition-colors">
                              <td className="px-5 py-3 font-mono text-stone-400 whitespace-nowrap">{formatDateTime(a.at)}</td>
                              <td className="px-5 py-3 font-bold text-cyan-400">@{a.actor}</td>
                              <td className="px-5 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                  a.action.startsWith('impersonate') ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
                                    : a.action.startsWith('user.delete') ? 'bg-red-950/30 border-red-500/30 text-red-400'
                                    : 'bg-blue-950/30 border-blue-500/30 text-blue-400'
                                }`}>{a.action}</span>
                              </td>
                              <td className="px-5 py-3 font-mono text-stone-300">{a.target || '—'}</td>
                              <td className="px-5 py-3 text-stone-500">{a.detail || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Tab: Client Errors */}
              {activeTab === 'client-errors' && (
                <motion.div
                  key="client-errors"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4 text-left"
                >
                  <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div>
                      <h2 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'კლიენტის შეცდომების ტელემეტრია' : 'Client Error Telemetry'}</h2>
                      <p className="mt-1 text-[11px] text-stone-500">
                        {isKa
                          ? 'ბრაუზერის ბოლო შეცდომები და ჩატვირთვის ჩავარდნები დიაგნოსტიკური ბუფერიდან.'
                          : 'Recent browser crashes and chunk-load failures from the in-process diagnostic buffer.'}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-stone-500">
                      {isKa
                        ? `${clientErrors.length} ჩანაწერი · ახლები პირველია · ნულდება დეპლოისას`
                        : `${clientErrors.length} recorded - newest first - resets on deploy/recycle`}
                    </span>
                  </div>

                  <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl overflow-hidden">
                    {clientErrors.length === 0 ? (
                      <div className="px-5 py-10 text-center text-stone-600 text-xs">
                        {isKa
                          ? 'ამ სერვერის პროცესის დაწყებიდან კლიენტის მხარეს შეცდომები ან ჩატვირთვის ჩავარდნები არ დაფიქსირებულა.'
                          : 'No client-side crashes or lazy chunk failures have been reported since this server process started.'}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] text-xs text-left">
                          <thead>
                            <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
                              <th className="px-5 py-3">{isKa ? 'დრო' : 'Timestamp'}</th>
                              <th className="px-5 py-3">{isKa ? 'წყარო' : 'Source'}</th>
                              <th className="px-5 py-3">{isKa ? 'მომხმარებელი' : 'User'}</th>
                              <th className="px-5 py-3">{isKa ? 'შეტყობინება' : 'Message'}</th>
                              <th className="px-5 py-3">{isKa ? 'გვერდი' : 'Page'}</th>
                              <th className="px-5 py-3">{isKa ? 'კლიენტი' : 'Client'}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-900/50">
                            {clientErrors.map((error, index) => (
                              <tr key={`${error.at}-${index}`} className="align-top hover:bg-stone-900/30 transition-colors">
                                <td className="px-5 py-3 font-mono text-stone-400 whitespace-nowrap">{formatDateTime(error.at)}</td>
                                <td className="px-5 py-3">
                                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                    error.source.includes('chunk')
                                      ? 'bg-amber-950/30 border-amber-500/30 text-amber-300'
                                      : 'bg-red-950/30 border-red-500/30 text-red-300'
                                  }`}>{error.source || (isKa ? 'უცნობი' : 'unknown')}</span>
                                  {error.appVersion ? (
                                    <div className="mt-1 text-[9px] font-mono text-stone-600">v{error.appVersion}</div>
                                  ) : null}
                                </td>
                                <td className="px-5 py-3 font-bold text-cyan-400 whitespace-nowrap">
                                  {error.username ? `@${error.username}` : (isKa ? 'ანონიმური' : 'anonymous')}
                                </td>
                                <td className="px-5 py-3 min-w-[20rem] max-w-xl">
                                  <div className="text-stone-200 leading-relaxed break-words">{error.message || (isKa ? 'შეტყობინება არ არის' : 'No message provided')}</div>
                                  {error.stack ? (
                                    <details className="mt-2">
                                      <summary className="cursor-pointer text-[10px] uppercase tracking-widest font-bold text-stone-500 hover:text-cyan-400">
                                        {isKa ? 'სტეკ-ტრეისი' : 'Stack trace'}
                                      </summary>
                                      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-stone-850 bg-black/35 p-3 text-[10px] leading-relaxed text-stone-400">
                                        {error.stack}
                                      </pre>
                                    </details>
                                  ) : null}
                                </td>
                                <td className="px-5 py-3 font-mono text-stone-400 break-all max-w-xs">{formatTelemetryUrl(error.url)}</td>
                                <td className="px-5 py-3 text-stone-500 max-w-xs">{summarizeUserAgent(error.userAgent)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === 'billing' && (
                <motion.div
                  key="billing"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <MasterBillingAdmin isKa={isKa} onMessage={setToastMessage} initialOrganizationId={initialBillingOrgId} />
                </motion.div>
              )}

              {activeTab === 'access' && (
                <motion.div
                  key="access"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <AdminRoleExplorer isKa={isKa} onMessage={setToastMessage} />
                </motion.div>
              )}

              {activeTab === 'ai-ops' && (
                <motion.div
                  key="ai-ops"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <React.Suspense
                    fallback={(
                      <div className="flex min-h-[55vh] items-center justify-center gap-3 text-cyan-400">
                        <RefreshCw className="h-5 w-5 animate-spin" />
                        <span className="text-xs font-bold uppercase tracking-widest">
                          {isKa ? 'AI ოპერაციების ჩატვირთვა...' : 'Loading AI operations...'}
                        </span>
                      </div>
                    )}
                  >
                    <AiOperationsAdmin isKa={isKa} onMessage={setToastMessage} />
                  </React.Suspense>
                </motion.div>
              )}

              {/* Tab: Command Line Terminal */}
              {activeTab === 'terminal' && (
                <motion.div
                  key="terminal"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="h-[68vh] flex flex-col bg-black border border-cyan-900/30 rounded-2xl overflow-hidden shadow-2xl"
                >
                  {/* Terminal Header */}
                  <div className="px-4 py-2.5 bg-stone-950 border-b border-stone-900 flex items-center gap-2 text-[10px] text-stone-400 tracking-wider uppercase font-bold shrink-0 text-left">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{isKa ? 'VinOS ინტერაქტიული გარსი (TTY/1)' : 'VinOS Interactive Shell (TTY/1)'}</span>
                  </div>

                  {/* Log stream */}
                  <div className="flex-1 p-4 overflow-y-auto font-mono text-xs space-y-1.5 text-cyan-550 scrollbar-thin text-left">
                    {terminalLogs.map((log, index) => (
                      <div key={index} className="whitespace-pre-wrap break-all">
                        {log}
                      </div>
                    ))}
                    <div ref={terminalBottomRef} />
                  </div>

                  {/* Terminal Input Form */}
                  <form onSubmit={handleTerminalCommand} className="flex border-t border-stone-900 bg-stone-950 p-2.5 shrink-0">
                    <span className="text-cyan-500 font-bold mr-2 select-none">admin@vinos:~$</span>
                    <input
                      type="text"
                      value={terminalInput}
                      onChange={e => setTerminalInput(e.target.value)}
                      placeholder={isKa ? 'ჩაწერეთ "help" ბრძანებების სიისთვის...' : 'Type "help" for a list of commands...'}
                      className="flex-1 bg-transparent text-cyan-400 outline-none border-none font-mono text-xs"
                      autoFocus
                    />
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </main>
      </div>

      {/* Create Organization Dialog */}
      <AnimatePresence>
        {creatingOrganization && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setCreatingOrganization(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-55"
            />
            <div className="fixed inset-0 z-55 flex items-center justify-center p-4">
              <motion.div
                ref={createOrganizationDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="master-admin-create-org-title"
                tabIndex={-1}
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#0c090a] border border-cyan-500/30 rounded-2xl p-6 max-w-md w-full space-y-5 text-left shadow-2xl"
              >
                <div className="flex items-center justify-between pb-3 border-b border-stone-900">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-cyan-950/40 border border-cyan-500/25 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <h3 id="master-admin-create-org-title" className="text-xs uppercase font-bold text-cyan-400 tracking-wider">
                        {isKa ? 'ახალი ორგანიზაცია' : 'Create organization'}
                      </h3>
                      <p className="text-[9px] text-stone-600 mt-0.5">{isKa ? 'ცარიელი, უსაფრთხო სამუშაო სივრცე' : 'A clean, secured winery workspace'}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setCreatingOrganization(false)} aria-label={isKa ? 'ფანჯრის დახურვა' : 'Close dialog'} className="text-stone-500 hover:text-stone-200 cursor-pointer">✕</button>
                </div>

                <form onSubmit={handleCreateOrganization} className="space-y-4">
                  <div>
                    <label className="block text-[9px] uppercase text-stone-500 font-bold mb-1">{isKa ? 'ორგანიზაციის სახელი' : 'Organization name'}</label>
                    <input
                      value={newOrganizationName}
                      onChange={event => setNewOrganizationName(event.target.value)}
                      minLength={2}
                      maxLength={120}
                      autoFocus
                      required
                      placeholder={isKa ? 'მაგ. ყვარლის მარანი' : 'e.g. Kvareli Cellars'}
                      className="w-full bg-stone-900 border border-stone-850 px-3 py-2.5 rounded-xl text-xs text-stone-200 outline-none focus:border-cyan-500/40"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase text-stone-500 font-bold mb-1">{isKa ? 'საწყისი მფლობელი' : 'Initial owner'}</label>
                    <select
                      value={newOrganizationOwner}
                      onChange={event => setNewOrganizationOwner(event.target.value)}
                      required
                      className="w-full bg-stone-900 border border-stone-850 px-3 py-2.5 rounded-xl text-xs text-stone-200 outline-none focus:border-cyan-500/40"
                    >
                      {users.map(user => (
                        <option key={user.username} value={user.username}>
                          @{user.username} — {user.fullName}{user.accountEnabled === false ? ' (disabled)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[9px] leading-relaxed text-stone-600">
                      {isKa ? 'მფლობელი მიიღებს Owner/Admin როლს. შემდეგ შეგიძლიათ სხვა წევრების დამატება.' : 'The initial owner receives Owner/Admin access. You can add more members afterward.'}
                    </p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => setCreatingOrganization(false)} className="flex-1 py-2.5 bg-stone-900 border border-stone-800 text-stone-400 rounded-xl text-xs font-bold hover:border-stone-700 cursor-pointer">
                      {isKa ? 'გაუქმება' : 'Cancel'}
                    </button>
                    <button type="submit" disabled={isCreatingOrganization || !newOrganizationName.trim() || !newOrganizationOwner} className="flex-1 py-2.5 bg-cyan-950/45 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-bold hover:bg-cyan-950/70 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                      {isCreatingOrganization ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      {isKa ? 'შექმნა' : 'Create workspace'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Organization Settings Dialog */}
      <AnimatePresence>
        {managedOrganization && (
          <AdminOrganizationQuickActions
            organization={managedOrganization}
            isKa={isKa}
            name={managedOrganizationName}
            deleteConfirmation={organizationDeleteConfirmation}
            saving={isSavingOrganization}
            deleting={isDeletingOrganization}
            onNameChange={setManagedOrganizationName}
            onDeleteConfirmationChange={setOrganizationDeleteConfirmation}
            onRename={handleRenameOrganization}
            onDelete={() => void handleDeleteOrganization()}
            onClose={() => setManagingOrganizationId(null)}
            onCopyId={() => void copyManagedOrganizationId()}
            onOpenControlCenter={() => void openManagedOrganizationWorkspace()}
            onOpenBilling={() => {
              setManagingOrganizationId(null);
              setInitialBillingOrgId(managedOrganization.id);
              setActiveTab('billing');
            }}
          />
        )}
      </AnimatePresence>

      {/* User Memberships Dialog */}
      <AnimatePresence>
        {managedMembershipUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setManagingUsername(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-55"
            />
            <div className="fixed inset-0 z-55 flex items-center justify-center p-4">
              <motion.div
                ref={manageMembershipDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="master-admin-memberships-title"
                tabIndex={-1}
                initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#0c090a] border border-purple-500/30 rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto space-y-5 text-left shadow-2xl"
              >
                <div className="flex items-start justify-between pb-3 border-b border-stone-900">
                  <div>
                    <h3 id="master-admin-memberships-title" className="text-xs uppercase font-bold text-purple-400 tracking-wider flex items-center gap-2"><Users className="w-4 h-4" /> {isKa ? 'ორგანიზაციები და როლები' : 'Organizations & roles'}</h3>
                    <p className="text-[10px] text-stone-500 mt-1">@{managedMembershipUser.username} · {managedMembershipUser.fullName}</p>
                  </div>
                  <button type="button" onClick={() => setManagingUsername(null)} aria-label={isKa ? 'ფანჯრის დახურვა' : 'Close dialog'} className="text-stone-500 hover:text-stone-200 cursor-pointer">✕</button>
                </div>

                <div className="space-y-2">
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-stone-500">{isKa ? 'მიმდინარე წევრობები' : 'Current memberships'}</h4>
                  {managedMembershipUser.organizations.length === 0 ? (
                    <div className="rounded-xl border border-amber-500/20 bg-amber-950/15 p-4 text-[10px] text-amber-300">
                      {isKa ? 'ამ მომხმარებელს არც ერთ ორგანიზაციაზე არ აქვს წვდომა.' : 'This user is not assigned to an organization.'}
                    </div>
                  ) : managedMembershipUser.organizations.map(membership => {
                    const isActive = managedMembershipUser.activeOrganizationId === membership.id;
                    const actionPrefix = `${managedMembershipUser.username}:${membership.id}`;
                    return (
                      <div key={membership.id} className={`rounded-xl border p-3 flex flex-col md:flex-row md:items-center gap-3 ${isActive ? 'bg-cyan-950/15 border-cyan-500/25' : 'bg-stone-950/50 border-stone-900'}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <strong className="text-xs text-stone-200 truncate">{membership.name}</strong>
                            {isActive && <span className="px-1.5 py-0.5 rounded bg-cyan-950/50 border border-cyan-500/25 text-[8px] uppercase font-bold text-cyan-300">{isKa ? 'აქტიური' : 'Active'}</span>}
                          </div>
                          <span className="text-[9px] font-mono text-stone-600">{membership.id}</span>
                        </div>
                        <select
                          value={membership.role}
                          disabled={membershipAction !== null}
                          onChange={event => handleUpsertMembership(managedMembershipUser.username, membership.id, event.target.value)}
                          className="bg-stone-900 border border-stone-800 px-2.5 py-2 rounded-lg text-[10px] text-stone-300 outline-none focus:border-purple-500/40 disabled:opacity-50"
                          aria-label={isKa ? `${membership.name}-ში როლი` : `Role in ${membership.name}`}
                        >
                          {ORGANIZATION_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                        </select>
                        {!isActive && (
                          <button
                            type="button"
                            disabled={membershipAction !== null}
                            onClick={() => handleUpsertMembership(managedMembershipUser.username, membership.id, membership.role, true)}
                            className="px-3 py-2 rounded-lg bg-cyan-950/25 border border-cyan-500/20 text-[9px] font-bold text-cyan-300 hover:bg-cyan-950/45 cursor-pointer disabled:opacity-40"
                          >
                            {membershipAction === `${actionPrefix}:upsert` ? <RefreshCw className="w-3 h-3 animate-spin" /> : (isKa ? 'აქტიურად დაყენება' : 'Make active')}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={membershipAction !== null}
                          onClick={() => handleRemoveMembership(managedMembershipUser.username, membership.id)}
                          className="p-2 rounded-lg bg-stone-900 border border-stone-800 text-stone-500 hover:text-red-400 hover:border-red-500/25 cursor-pointer disabled:opacity-40"
                          title={isKa ? 'წევრობის წაშლა' : 'Remove membership'}
                        >
                          {membershipAction === `${actionPrefix}:remove` ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <form
                  onSubmit={event => {
                    event.preventDefault();
                    handleUpsertMembership(managedMembershipUser.username, membershipOrganizationId, membershipRole, membershipMakeActive);
                  }}
                  className="rounded-xl border border-purple-500/20 bg-purple-950/10 p-4 space-y-3"
                >
                  <h4 className="text-[9px] uppercase tracking-widest font-bold text-purple-400 flex items-center gap-2"><UserPlus className="w-3.5 h-3.5" /> {isKa ? 'ორგანიზაციაში დამატება' : 'Assign to organization'}</h4>
                  {assignableOrganizations.length === 0 ? (
                    <p className="text-[10px] text-stone-600">{isKa ? 'მომხმარებელი უკვე ყველა ორგანიზაციის წევრია.' : 'This user is already assigned to every organization.'}</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <select value={membershipOrganizationId} onChange={event => setMembershipOrganizationId(event.target.value)} className="bg-stone-900 border border-stone-800 px-3 py-2.5 rounded-xl text-xs text-stone-300 outline-none focus:border-purple-500/40">
                          {assignableOrganizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
                        </select>
                        <select value={membershipRole} onChange={event => setMembershipRole(event.target.value)} className="bg-stone-900 border border-stone-800 px-3 py-2.5 rounded-xl text-xs text-stone-300 outline-none focus:border-purple-500/40">
                          {ORGANIZATION_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] text-stone-500 cursor-pointer">
                        <input type="checkbox" checked={membershipMakeActive} onChange={event => setMembershipMakeActive(event.target.checked)} className="accent-cyan-500" />
                        {isKa ? 'ეს ორგანიზაცია მომხმარებლის აქტიურ სამუშაო სივრცედ დაყენდეს' : 'Make this the user’s active workspace'}
                      </label>
                      <button type="submit" disabled={!membershipOrganizationId || membershipAction !== null} className="w-full py-2.5 rounded-xl bg-purple-950/30 border border-purple-500/25 text-purple-300 text-xs font-bold hover:bg-purple-950/50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                        {membershipAction ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                        {isKa ? 'წევრობის დამატება' : 'Add membership'}
                      </button>
                    </>
                  )}
                </form>

                <section className="rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 space-y-3">
                  <div>
                    <h4 className="text-[9px] uppercase tracking-widest font-bold text-amber-400 flex items-center gap-2"><KeyRound className="w-3.5 h-3.5" /> {isKa ? 'ანგარიშის უსაფრთხოება' : 'Account security'}</h4>
                    <p className="mt-1 text-[9px] leading-relaxed text-stone-600">{isKa ? 'ქმედებები იწერება უსაფრთხოების აუდიტში.' : 'Every action is recorded in the persistent security audit.'}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button type="button" disabled={membershipAction !== null} onClick={() => void handleUserSecurityAction(managedMembershipUser.username, 'unlock')} className="flex items-center justify-center gap-2 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[9px] font-bold text-stone-300 hover:border-emerald-500/25 hover:text-emerald-400 disabled:opacity-40">
                      {membershipAction === `security:${managedMembershipUser.username}:unlock` ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}{isKa ? 'ბლოკის მოხსნა' : 'Clear lockout'}
                    </button>
                    <button type="button" disabled={membershipAction !== null} onClick={() => void handleUserSecurityAction(managedMembershipUser.username, 'revoke_sessions')} className="flex items-center justify-center gap-2 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[9px] font-bold text-stone-300 hover:border-amber-500/25 hover:text-amber-400 disabled:opacity-40">
                      {membershipAction === `security:${managedMembershipUser.username}:revoke_sessions` ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5" />}{isKa ? 'სესიების გაუქმება' : 'Revoke sessions'}
                    </button>
                    <button type="button" disabled={membershipAction !== null} onClick={() => void handleUserSecurityAction(managedMembershipUser.username, 'force_password_reset')} className="flex items-center justify-center gap-2 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[9px] font-bold text-stone-300 hover:border-cyan-500/25 hover:text-cyan-400 disabled:opacity-40">
                      {membershipAction === `security:${managedMembershipUser.username}:force_password_reset` ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}{isKa ? 'პაროლის აღდგენა' : 'Force password reset'}
                    </button>
                  </div>
                </section>
                <p className="text-[9px] text-stone-600 leading-relaxed">
                  {isKa ? 'აქტიური სამუშაო სივრცის ან აქტიური როლის ცვლილება უსაფრთხოების მიზნით მომხმარებლის მიმდინარე სესიას ასრულებს.' : 'Changing the active workspace or its role ends the user’s current session for safety.'}
                </p>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Edit User Modal Dialog */}
      <AnimatePresence>
        {editingUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingUser(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-55"
            />

            <div className="fixed inset-0 z-55 flex items-center justify-center p-4">
              <motion.div
                ref={editUserDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="master-admin-edit-user-title"
                tabIndex={-1}
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#0c090a] border border-cyan-500/30 rounded-2xl p-6 max-w-sm w-full space-y-4 text-left"
              >
                <div className="flex justify-between items-center pb-2 border-b border-stone-900">
                  <h3 id="master-admin-edit-user-title" className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'ანგარიშის კონფიგურაცია:' : 'Configure Account:'} @{editingUser.username}</h3>
                  <button onClick={() => setEditingUser(null)} aria-label={isKa ? 'რედაქტირების ფანჯრის დახურვა' : 'Close edit user dialog'} className="text-stone-500 hover:text-stone-200">✕</button>
                </div>

                <form onSubmit={handleSaveUserEdit} className="space-y-4">
                  <div>
                    <label className="block text-[9px] uppercase text-stone-500 font-bold mb-1">{isKa ? 'ელფოსტა' : 'Email Address'}</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={e => setEditEmail(e.target.value)}
                      className="w-full bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs text-stone-200 outline-none focus:border-cyan-500/30"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase text-stone-500 font-bold mb-1">{isKa ? 'ანგარიშის როლი' : 'Account Role'}</label>
                    <select
                      value={editRole}
                      onChange={e => setEditRole(e.target.value)}
                      className="w-full bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs text-stone-200 outline-none focus:border-cyan-500/30"
                    >
                      {ORGANIZATION_ROLES.map(role => (
                        <option key={role} value={role}>{isKa ? localizedRoleLabel(role, lang) : role}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between bg-stone-950/50 border border-stone-900 p-2.5 rounded-xl">
                    <span className="text-[10px] uppercase text-stone-400 font-bold">{isKa ? 'ელფოსტის ვერიფიკაციის სტატუსი' : 'Email Verification Status'}</span>
                    <button
                      type="button"
                      onClick={() => setEditVerified(prev => !prev)}
                      className={`px-3 py-1 text-[9px] font-bold rounded-lg cursor-pointer transition-colors ${
                        editVerified
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-950 text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {editVerified ? (isKa ? 'ვერიფიცირებული' : 'VERIFIED') : (isKa ? 'არავერიფიცირებული' : 'UNVERIFIED')}
                    </button>
                  </div>

                  <div className="flex items-center justify-between bg-stone-950/50 border border-stone-900 p-2.5 rounded-xl">
                    <span className="text-[10px] uppercase text-stone-400 font-bold">{isKa ? 'áƒáƒœáƒ’áƒáƒ áƒ˜áƒ¨áƒ˜áƒ¡ áƒ¡áƒ¢áƒáƒ¢áƒ£áƒ¡áƒ˜' : 'Account Status'}</span>
                    <button
                      type="button"
                      onClick={() => setEditEnabled(prev => !prev)}
                      className={`px-3 py-1 text-[9px] font-bold rounded-lg cursor-pointer transition-colors ${
                        editEnabled
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-950 text-red-400 border border-red-500/20'
                      }`}
                    >
                      {editEnabled ? (isKa ? 'áƒáƒ¥áƒ¢áƒ˜áƒ£áƒ áƒ˜' : 'ACTIVE') : (isKa ? 'áƒ’áƒáƒ›áƒáƒ áƒ—áƒ£áƒšáƒ˜' : 'DISABLED')}
                    </button>
                  </div>

                  <div>
                    <label className="block text-[9px] uppercase text-stone-500 font-bold mb-1">{isKa ? 'კოდის იძულებითი შეცვლა' : 'Force Passcode Override'}</label>
                    <div className="relative">
                      <input
                        type="password"
                        placeholder="••••"
                        value={newPasscode}
                        onChange={e => setNewPasscode(e.target.value)}
                        className="w-full bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs text-stone-200 outline-none focus:border-cyan-500/30"
                        minLength={8}
                      />
                      <KeyRound className="w-3.5 h-3.5 text-stone-600 absolute right-3.5 top-2.5" />
                    </div>
                    <p className="text-[9px] text-stone-550 mt-1">{isKa ? 'დატოვეთ ცარიელი არსებული პაროლის შესანარჩუნებლად.' : 'Leave blank to keep existing password hash intact.'}</p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingUser(null)}
                      className="flex-1 py-2 bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-400 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      {isKa ? 'გაუქმება' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      disabled={isUpdatingUser}
                      className="flex-1 py-2 bg-cyan-950/45 hover:bg-cyan-950 border border-cyan-500/30 hover:border-cyan-500/60 text-cyan-400 rounded-xl text-xs font-bold cursor-pointer transition-colors flex justify-center items-center gap-1.5"
                    >
                      {isUpdatingUser ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        isKa ? 'ცვლილებების შენახვა' : 'Save Changes'
                      )}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      {/* Delete User Confirmation Modal */}
      <AnimatePresence>
        {deletingUsername && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingUsername(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs z-55"
            />

            <div className="fixed inset-0 z-55 flex items-center justify-center p-4">
              <motion.div
                ref={deleteUserDialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="master-admin-delete-user-title"
                tabIndex={-1}
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#0c090a] border border-red-500/30 rounded-2xl p-6 max-w-sm w-full space-y-4 text-left"
              >
                <div className="flex justify-between items-center pb-2 border-b border-stone-900">
                  <h3 id="master-admin-delete-user-title" className="text-xs uppercase font-bold text-red-500 tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse" />
                    {isKa ? 'ანგარიშის წაშლის დადასტურება' : 'Confirm Account Deletion'}
                  </h3>
                  <button onClick={() => setDeletingUsername(null)} aria-label={isKa ? 'წაშლის ფანჯრის დახურვა' : 'Close delete user dialog'} className="text-stone-500 hover:text-stone-200">✕</button>
                </div>

                <div className="space-y-2 text-xs text-stone-400">
                  <p>
                    {isKa ? 'ნამდვილად გსურთ ანგარიშის ' : 'Are you absolutely sure you want to terminate the winemaker account '}
                    <strong className="text-red-400 font-bold">@{deletingUsername}</strong>
                    {isKa ? ' წაშლა?' : '?'}
                  </p>
                  <p className="bg-red-950/20 border border-red-900/40 p-2.5 rounded-xl text-red-350 leading-normal">
                    {isKa
                      ? '⚠️ ეს ქმედება შეუქცევადია. ამ ანგარიშთან დაკავშირებული ყველა წევრობა, აქტიური სესია და წვდომის გასაღები სამუდამოდ გაუქმდება.'
                      : '⚠️ This action is irreversible. All memberships, active logins, and access keys associated with this account will be permanently revoked.'}
                  </p>

                  {/* The server refuses the first attempt and reports the wineries
                      that would be left with no members. Naming them — with their
                      record counts — is the difference between an informed decision
                      and an accident. */}
                  {pendingOrphanedOrgs && pendingOrphanedOrgs.length > 0 && (
                    <div className="bg-red-950/40 border border-red-500/50 p-2.5 rounded-xl space-y-2">
                      <p className="text-red-300 font-bold leading-normal">
                        {isKa
                          ? '🛑 ამ ანგარიშის წაშლა გაანადგურებს შემდეგ მარნებს და მათ სრულ ისტორიას:'
                          : '🛑 Deleting this account will also destroy these wineries and their entire history:'}
                      </p>
                      <ul className="space-y-1">
                        {pendingOrphanedOrgs.map(org => (
                          <li key={org.id} className="text-red-200 leading-normal">
                            <strong>{org.name}</strong>
                            <span className="text-red-300/80">
                              {' — '}
                              {org.lotsCount} {isKa ? 'პარტია' : 'lots'}
                              {', '}
                              {org.tanksCount} {isKa ? 'ჭურჭელი' : 'vessels'}
                              {', '}
                              {Math.max(1, Math.round(org.dataSize / 1024))} KB
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-red-300/90 leading-normal">
                        {isKa
                          ? 'ამ მონაცემების აღდგენა შეუძლებელია. თუ ისტორია უნდა შენარჩუნდეს, ჯერ დაამატეთ სხვა წევრი მარანში.'
                          : 'This data cannot be recovered. To keep the history, add another member to the winery first.'}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setDeletingUsername(null); setPendingOrphanedOrgs(null); }}
                    className="flex-1 py-2 bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-400 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    {isKa ? 'გაუქმება' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteUser(
                      pendingOrphanedOrgs ? pendingOrphanedOrgs.map(org => org.id) : undefined,
                    )}
                    disabled={isDeletingUser}
                    className="flex-1 py-2 bg-red-950/45 hover:bg-red-950 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-xl text-xs font-bold cursor-pointer transition-colors flex justify-center items-center gap-1.5"
                  >
                    {isDeletingUser ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : pendingOrphanedOrgs && pendingOrphanedOrgs.length > 0 ? (
                      // Label the second click for what it actually does.
                      isKa ? 'წაშლა მონაცემებთან ერთად' : 'Delete account and data'
                    ) : (
                      isKa ? 'ანგარიშის წაშლა' : 'Terminate Account'
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
