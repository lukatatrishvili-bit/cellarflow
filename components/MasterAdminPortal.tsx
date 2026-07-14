import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert, RefreshCw, Trash2, Edit, Activity, Cpu, Database,
  Server, User, Users, Check, X, ShieldCheck, Terminal, AlertTriangle, KeyRound,
  Eye, Mail, ScrollText, Unlock, Download, Wrench, Gauge, SearchCode
} from 'lucide-react';
import { useFocusTrap } from './useFocusTrap';
import { localizedRoleLabel } from '../lib/roleLabels';

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
  isDemo: boolean;
  createdAt: string;
  organizations: Array<{ id: string; name: string; role: string }>;
}

interface OrgRecord {
  id: string;
  name: string;
  createdAt: string;
  membersCount: number;
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

interface OrgInspection {
  organization: { id: string; name: string; createdAt: string };
  wineryName: string;
  members: Array<{ username: string; role: string }>;
  dataSizeBytes: number;
  lastActivity: string | null;
  collections: Array<{ key: string; count: number; lastModified: string | null }>;
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

export default function MasterAdminPortal({
  lang,
  currentUser,
  onClose,
  setToastMessage
}: MasterAdminPortalProps) {
  const isKa = lang === 'ka';
  const [activeTab, setActiveTab] = useState<'stats' | 'users' | 'orgs' | 'ops' | 'audit' | 'client-errors' | 'terminal'>('stats');
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [orgs, setOrgs] = useState<OrgRecord[]>([]);
  const [clientErrors, setClientErrors] = useState<ClientErrorReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search & Filters
  const [userSearch, setUserSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  // Editing States
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editVerified, setEditVerified] = useState(false);
  const [newPasscode, setNewPasscode] = useState('');
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  // Deleting States
  const [deletingUsername, setDeletingUsername] = useState<string | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);

  // Real process telemetry: event-loop lag history sampled from /api/admin/stats.
  const [lagHistory, setLagHistory] = useState<number[]>([]);

  // Godmode panels
  const [lockouts, setLockouts] = useState<LockoutEntry[]>([]);
  const [lockoutsBackend, setLockoutsBackend] = useState<string>('');
  const [adminTrail, setAdminTrail] = useState<AdminAction[]>([]);
  const [inspectingOrgId, setInspectingOrgId] = useState<string | null>(null);
  const [inspection, setInspection] = useState<OrgInspection | null>(null);
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
  useFocusTrap(editUserDialogRef, { active: !!editingUser, onClose: () => setEditingUser(null) });
  useFocusTrap(deleteUserDialogRef, { active: !!deletingUsername, onClose: () => setDeletingUsername(null) });

  // Fetch Data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, usersRes, orgsRes, healthRes, lockoutsRes, actionsRes, clientErrorsRes] = await Promise.all([
        fetch('/api/admin/stats'),
        fetch('/api/admin/users'),
        fetch('/api/admin/orgs'),
        fetch('/api/admin/system-health'),
        fetch('/api/admin/lockouts'),
        fetch('/api/admin/actions'),
        fetch('/api/admin/client-errors')
      ]);

      if (statsRes.ok && usersRes.ok && orgsRes.ok) {
        const statsData = await statsRes.json();
        const usersData = await usersRes.json();
        const orgsData = await orgsRes.json();
        const healthData = healthRes.ok ? await healthRes.json() : null;
        const lockoutsData = lockoutsRes.ok ? await lockoutsRes.json() : null;
        const actionsData = actionsRes.ok ? await actionsRes.json() : null;
        const clientErrorsData = clientErrorsRes.ok ? await clientErrorsRes.json() : null;

        setStats(statsData);
        setSystemHealth(healthData);
        setUsers(usersData.users);
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
  };

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
  }, []);

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
  const handleImpersonate = async (username: string) => {
    setImpersonatingUsername(username);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (res.ok) {
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

  const handleInspectOrg = async (orgId: string) => {
    if (inspectingOrgId === orgId) { setInspectingOrgId(null); setInspection(null); return; }
    setInspectingOrgId(orgId);
    setInspection(null);
    setInspectionLoading(true);
    try {
      const res = await fetch(`/api/admin/orgs/inspect?id=${encodeURIComponent(orgId)}`);
      if (res.ok) {
        setInspection(await res.json());
      } else {
        const err = await res.json().catch(() => ({}));
        setToastMessage(`⚠️ ${err.error || (isKa ? 'ინსპექცია ვერ მოხერხდა' : 'Inspection failed')}`);
        setInspectingOrgId(null);
      }
    } catch {
      setToastMessage(isKa ? '⚠️ ინსპექცია ვერ მოხერხდა' : '⚠️ Inspection failed');
      setInspectingOrgId(null);
    } finally {
      setInspectionLoading(false);
    }
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

  const handleDeleteUser = async () => {
    if (!deletingUsername) return;
    setIsDeletingUser(true);

    try {
      const res = await fetch('/api/admin/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: deletingUsername })
      });

      if (res.ok) {
        setToastMessage(isKa ? '✓ მომხმარებელი წარმატებით წაიშალა' : '✓ User deleted successfully');
        setDeletingUsername(null);
        fetchData();
      } else {
        const err = await res.json();
        setToastMessage(`⚠️ ${err.error}`);
      }
    } catch (err) {
      setToastMessage(isKa ? 'მომხმარებლის წაშლა ვერ მოხერხდა' : 'Failed to delete user');
    } finally {
      setIsDeletingUser(false);
    }
  };

  // Filtering
  const filteredUsers = users.filter(u => 
    u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.fullName.toLowerCase().includes(userSearch.toLowerCase())
  );

  const filteredOrgs = orgs.filter(o => 
    o.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
    o.id.toLowerCase().includes(orgSearch.toLowerCase())
  );

  const formatDateTime = (value: string | null | undefined) => {
    if (!value) return isKa ? 'არ არის ჩაწერილი' : 'Not recorded';
    try {
      return new Date(value).toLocaleString(isKa ? 'ka-GE' : undefined);
    } catch {
      return value;
    }
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
    <div className="fixed inset-0 bg-[#070506] z-50 flex flex-col text-stone-100 font-mono select-none">
      {/* Retro scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,6px_100%] pointer-events-none z-50 opacity-40" />

      {/* Cyber Grid Header */}
      <header className="border-b border-cyan-900/40 bg-[#0c090a] px-6 py-4 flex items-center justify-between shrink-0 shadow-[0_4px_30px_rgba(0,0,0,0.8)] relative">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-950 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]">
            <Server className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-black tracking-widest text-cyan-400 uppercase">{isKa ? 'VinOS ქსელის მართვა' : 'VinOS Network Control'}</h1>
              <span className="px-1.5 py-0.5 text-[8px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/20 rounded uppercase tracking-widest animate-pulse">{isKa ? 'მთავარი ადმინი' : 'Master Admin'}</span>
            </div>
            <p className="text-[10px] text-cyan-700 uppercase tracking-wider mt-0.5">{isKa ? 'სისტემის ადმინისტრირებისა და დიაგნოსტიკის კონსოლი' : 'System Administration & Diagnostics Console'}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={fetchData}
            className="p-2 bg-stone-900 border border-stone-800 rounded-lg hover:border-cyan-500/40 text-stone-400 hover:text-cyan-400 transition-all cursor-pointer"
            title={isKa ? 'ტელემეტრიის იძულებითი განახლება' : 'Force telemetry refresh'}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-stone-900 border border-stone-800 rounded-lg hover:border-red-500/40 text-stone-400 hover:text-red-400 transition-all text-xs cursor-pointer tracking-wider font-bold"
          >
            {isKa ? 'გათიშვა' : 'DISCONNECT'} ✕
          </button>
        </div>
      </header>

      {/* Main Grid Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <nav className="w-56 border-r border-cyan-900/20 bg-[#090708] p-4 flex flex-col gap-2 shrink-0">
          <span className="text-[9px] uppercase text-cyan-800 font-bold tracking-widest mb-2 block">{isKa ? 'ინტერფეისები' : 'Interfaces'}</span>
          {[
            { id: 'stats', label: isKa ? 'სისტემის მდგომარეობა' : 'System Health', icon: Activity },
            { id: 'users', label: isKa ? 'მომხმარებლები' : 'User Accounts', icon: User },
            { id: 'orgs', label: isKa ? 'მარნები / ორგანიზაციები' : 'Wineries / Orgs', icon: Users },
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
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-bold tracking-wider transition-all cursor-pointer text-left ${
                  active 
                    ? 'bg-cyan-950/20 border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.08)]' 
                    : 'bg-transparent border-transparent text-stone-500 hover:text-stone-300 hover:bg-stone-900/40'
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? 'text-cyan-400' : 'text-stone-650'}`} />
                {tab.label}
              </button>
            );
          })}

          <div className="mt-auto p-3.5 bg-stone-950/50 border border-cyan-900/10 rounded-2xl text-[9px] text-cyan-700/80 space-y-2">
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
        <main className="flex-1 bg-[#090607] p-6 overflow-y-auto relative">
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
                        download="cellarflow_export.json"
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
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'მომხმარებელთა რეესტრი' : 'User Directory Registry'}</h2>
                    <input
                      type="text"
                      placeholder={isKa ? 'ძებნა სახელით, მომხმარებლის სახელით ან ელფოსტით...' : 'Search accounts by name, username, or email...'}
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      className="w-80 bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs outline-none focus:border-cyan-500/40 text-stone-200 transition-colors"
                    />
                  </div>

                  <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl overflow-hidden">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
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
                              <td className="px-5 py-3.5">
                                <div className="font-bold text-stone-200">@{u.username}</div>
                                <div className="text-[10px] text-stone-500 mt-0.5">{u.fullName}</div>
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
                                    <span key={o.id} className="px-1.5 py-0.5 bg-stone-900 text-stone-400 border border-stone-850 rounded text-[9px]">
                                      {o.name} ({o.role})
                                    </span>
                                  ))}
                                  {u.organizations.length === 0 && (
                                    <span className="text-stone-550 italic text-[10px]">{isKa ? 'სამუშაო სივრცე არ აქვს' : 'No workspaces'}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-5 py-3.5">
                                <span className={`flex items-center gap-1.5 font-bold ${u.emailVerified ? 'text-emerald-500' : 'text-amber-500'}`}>
                                  {u.emailVerified ? (
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
                                    onClick={() => handleImpersonate(u.username)}
                                    disabled={isMaster || impersonatingUsername !== null}
                                    className={`p-1.5 bg-stone-900 border border-stone-850 rounded-lg transition-colors ${
                                      isMaster || impersonatingUsername !== null
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
                                    onClick={() => {
                                      setEditingUser(u);
                                      setEditRole(u.role);
                                      setEditEmail(u.email);
                                      setEditVerified(u.emailVerified);
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
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-xs uppercase font-bold text-cyan-400 tracking-wider">{isKa ? 'მარნების (ორგანიზაციების) რეესტრი' : 'Winery Organizations Registry'}</h2>
                    <input
                      type="text"
                      placeholder={isKa ? 'ძებნა სახელით ან ID-ით...' : 'Search organizations by name or ID...'}
                      value={orgSearch}
                      onChange={e => setOrgSearch(e.target.value)}
                      className="w-80 bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs outline-none focus:border-cyan-500/40 text-stone-200 transition-colors"
                    />
                  </div>

                  <div className="bg-[#0c090a] border border-cyan-900/20 rounded-2xl overflow-hidden">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-stone-900 bg-stone-950/80 text-stone-400 uppercase text-[9px] font-bold tracking-widest">
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
                            <td className="px-5 py-3.5">
                              <div className="font-bold text-stone-200">{o.name}</div>
                              <div className="text-[9.5px] text-stone-500 font-mono mt-0.5">{o.id}</div>
                            </td>
                            <td className="px-5 py-3.5 text-stone-400 font-mono">
                              {new Date(o.createdAt).toISOString().split('T')[0]}
                            </td>
                            <td className="px-5 py-3.5 text-stone-300 font-bold">{o.membersCount}</td>
                            <td className="px-5 py-3.5 text-stone-300 font-bold">{o.tanksCount}</td>
                            <td className="px-5 py-3.5 text-stone-300 font-bold">{o.lotsCount}</td>
                            <td className="px-5 py-3.5 text-right font-mono text-cyan-400">
                              {o.dataSize.toLocaleString()} B
                            </td>
                            <td className="px-5 py-3.5 text-right">
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
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Data inspector panel */}
                  {inspectingOrgId && (
                    <div className="bg-[#0c090a] border border-cyan-500/25 rounded-2xl p-5 space-y-4">
                      {inspectionLoading ? (
                        <div className="flex items-center gap-2 text-cyan-500 text-xs font-bold">
                          <RefreshCw className="w-4 h-4 animate-spin" /> {isKa ? 'მონაცემთა პროფილის ინსპექცია...' : 'INSPECTING DATA PROFILE...'}
                        </div>
                      ) : inspection ? (
                        <>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className="text-xs uppercase font-bold text-cyan-400 tracking-wider flex items-center gap-2">
                                <SearchCode className="w-4 h-4" /> {inspection.organization.name}
                                {inspection.wineryName && <span className="text-stone-500 normal-case font-mono">· {inspection.wineryName}</span>}
                              </h3>
                              <p className="text-[10px] text-stone-500 mt-1">
                                {formatBytes(inspection.dataSizeBytes)} · {isKa ? 'ბოლო აქტივობა' : 'last activity'} {inspection.lastActivity ? formatDateTime(inspection.lastActivity) : '—'} ·
                                {isKa ? ' წევრები:' : ' members:'} {inspection.members.map(m => ` @${m.username} (${m.role})`).join(',') || (isKa ? ' არავინ' : ' none')}
                              </p>
                            </div>
                            <button onClick={() => { setInspectingOrgId(null); setInspection(null); }}
                              className="p-1.5 text-stone-500 hover:text-stone-300 cursor-pointer">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                            {inspection.collections.map(c => (
                              <div key={c.key} className={`p-3 rounded-xl border ${c.count > 0 ? 'bg-stone-950/60 border-cyan-900/30' : 'bg-stone-950/30 border-stone-900'}`}>
                                <span className="text-[9px] uppercase font-bold text-stone-500 block truncate" title={c.key}>{c.key}</span>
                                <span className={`text-lg font-mono font-bold ${c.count > 0 ? 'text-cyan-400' : 'text-stone-700'}`}>{c.count}</span>
                                <span className="block text-[8.5px] text-stone-600 font-mono truncate">
                                  {c.lastModified ? c.lastModified.slice(0, 10) : (isKa ? 'ჩანაწერები არ არის' : 'no records')}
                                </span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
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

              {/* Tab 4: Command Line Terminal */}
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
                      {(['Owner/Admin', 'Winemaker', 'Lab Technician', 'Cellar Worker', 'Read-Only'] as const).map(role => (
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

                  <div>
                    <label className="block text-[9px] uppercase text-stone-500 font-bold mb-1">{isKa ? 'კოდის იძულებითი შეცვლა' : 'Force Passcode Override'}</label>
                    <div className="relative">
                      <input
                        type="password"
                        placeholder="••••"
                        value={newPasscode}
                        onChange={e => setNewPasscode(e.target.value)}
                        className="w-full bg-stone-900 border border-stone-850 px-3 py-2 rounded-xl text-xs text-stone-200 outline-none focus:border-cyan-500/30"
                        minLength={4}
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
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeletingUsername(null)}
                    className="flex-1 py-2 bg-stone-900 border border-stone-800 hover:border-stone-700 text-stone-400 rounded-xl text-xs font-bold cursor-pointer"
                  >
                    {isKa ? 'გაუქმება' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteUser}
                    disabled={isDeletingUser}
                    className="flex-1 py-2 bg-red-950/45 hover:bg-red-950 border border-red-500/30 hover:border-red-500/60 text-red-400 rounded-xl text-xs font-bold cursor-pointer transition-colors flex justify-center items-center gap-1.5"
                  >
                    {isDeletingUser ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
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
