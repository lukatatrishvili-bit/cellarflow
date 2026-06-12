import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { translations, Language } from '../lib/i18n';
import { authenticate, DEMO_PASSCODE } from '../lib/auth';
import { computeAlerts, Alert } from '../lib/alerts';
import NotificationCenter from '../components/NotificationCenter';
import LocationPicker, { PickedLocation } from '../components/LocationPicker';
import { useWineryState } from '../hooks/useWineryState';
import { IndexedDBQueue } from '../lib/syncQueue';

// Heavy modules are code-split
const LotPassport = lazy(() => import('../components/LotPassport'));
const VaziModule = lazy(() => import('../components/VaziModule'));
const EnoCalculators = lazy(() => import('../components/EnoCalculators'));
const AiWinemaker = lazy(() => import('../components/AiWinemaker'));

// Subcomponents modular layout
import TanksVessels from '../components/TanksVessels';
import WineLotsTrace from '../components/WineLotsTrace';
import TransfersTab from '../components/TransfersTab';
import InventoryTab from '../components/InventoryTab';
import FermentationTab from '../components/FermentationTab';

// Refactored modular pages
import DashboardTab from '../components/DashboardTab';
import WineryDashboardTab from '../components/WineryDashboardTab';
import AuditTrailTab from '../components/AuditTrailTab';
import ProfileSettingsTab from '../components/ProfileSettingsTab';
import LabsTab from '../components/LabsTab';
import TasksTab from '../components/TasksTab';
import NotesTab from '../components/NotesTab';
import VesselDrawer from '../components/VesselDrawer';

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
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Trash,
  CheckCircle2,
  Sprout,
  Sun,
  Moon,
  RefreshCw,
  QrCode
} from 'lucide-react';

function ModuleLoader() {
  return (
    <div className="flex items-center justify-center p-16 w-full">
      <Loader2 className="w-6 h-6 animate-spin text-[#4e0e15]" />
    </div>
  );
}

export default function App() {
  const state = useWineryState();
  const [showQrModal, setShowQrModal] = useState(false);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [showSyncTroubleshooter, setShowSyncTroubleshooter] = useState(false);

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

  // Real-time telemetry state
  const [activeTelemetry, setActiveTelemetry] = useState<any[]>([]);

  // Conflict resolution choice state
  const [resolutions, setResolutions] = useState<Record<string, 'local' | 'server'>>({});

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
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [state]);

  if (!state.isClient) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FAF8F5] text-[#2c241e]">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-800 mb-2" />
        <span className="text-xs font-semibold tracking-wide uppercase font-serif">Powering up VINEA Unified Platform...</span>
      </div>
    );
  }

  const t = translations[state.lang];

  // Derived stats for sidebar
  const activeFermsCount = state.lots.filter(l => l.stage === 'fermenting').length;
  const occupiedTanksCount = state.vessels.filter(v => v.currentVolume > 0).length;

  return (
    // overflow-x clipping lives on <body> (globals.css): an overflow value
    // on this wrapper would break position:sticky for the floating header
    <div className="min-h-screen bg-[#f8f6f2] dark:bg-[#0a0607] flex flex-col font-sans relative transition-colors duration-300">
      
      {/* Ambient background glow spheres */}
      <div className="bg-glow-sphere top-[10%] left-[5%] w-[380px] h-[380px] bg-[#801323]" />
      <div className="bg-glow-sphere top-[45%] right-[8%] w-[420px] h-[420px] bg-[#c5a059]" />
      <div className="bg-glow-sphere bottom-[15%] left-[10%] w-[350px] h-[350px] bg-emerald-800" />
      
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
          <div className="fixed top-20 right-6 z-50 bg-[#4e0e15] border border-[#801323] text-amber-100 rounded-xl px-4 py-2.5 shadow-lg font-bold text-xs flex items-center gap-3 animate-fade-in">
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
          </div>
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
              onClose={() => state.setPassportLotId(null)}
            />
          </Suspense>
        );
      })()}

      {/* 1. Global Navigation Bar — floating glass pill */}
      <header className="relative mx-3 md:mx-6 mt-3 px-5 md:px-7 py-3 bg-white/85 backdrop-blur-xl border border-stone-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-3 z-40 rounded-2xl shadow-[0_12px_40px_-12px_rgba(78,14,21,0.25)] transition-all duration-300 dark:bg-[#140d0e]/90 dark:border-[#2a191b] dark:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.7)]">
        {/* Luxury Top Wine Edge Border */}
        <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl bg-gradient-to-r from-[#801323] via-[#4e0e15] to-[#c5a059]" />

        {/* Brand Crest */}
        <div className="flex items-center gap-3">
          <motion.div 
            whileHover={{ scale: 1.08, rotate: [0, -10, 10, 0] }}
            onClick={() => state.setActiveModule('portal')}
            className="w-10 h-10 bg-gradient-to-br from-[#4e0e15] to-[#210204] text-amber-100 rounded-xl flex items-center justify-center shadow-md font-serif font-black text-xl border border-[#801323] cursor-pointer"
          >
            🍇
          </motion.div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-serif tracking-[0.25em] text-[#1b1715] font-black dark:text-amber-100">VINEA</h1>
            </div>
            <p className="text-[10px] text-[#c5a059] font-mono tracking-widest font-extrabold uppercase mt-0.5">{state.companyProfile.companyName}</p>
          </div>
        </div>

        {/* Module Nav Switcher (Available once logged in) */}
        {state.isLoggedIn && (
          <nav className="flex flex-wrap items-center gap-1 bg-stone-50 border border-[#e8dfd5] p-1 rounded-2xl text-xs font-semibold dark:bg-stone-900 dark:border-stone-800">
            {[
              { id: 'portal', label: t.nav_portal || 'Dashboard Portal', icon: LayoutDashboard },
              { id: 'vazi', label: t.nav_vazi || 'Vazi (Vineyard)', icon: Sprout },
              { id: 'gvino', label: t.nav_gvino || 'Gvino (Winery)', icon: Wine },
              { id: 'audit', label: t.nav_audit || 'Audit Trail', icon: FileText },
              { id: 'settings', label: t.nav_settings || 'Settings', icon: ClipboardList }
            ].map(mod => {
              const Icon = mod.icon;
              const isActive = state.activeModule === mod.id;
              return (
                <button
                  key={mod.id}
                  onClick={() => {
                    state.setActiveModule(mod.id as any);
                    if (mod.id === 'gvino') {
                      state.setActiveTab('dashboard'); // reset winery tab
                    }
                  }}
                  className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-all duration-200 font-extrabold text-[11px] tracking-wide uppercase ${
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

        {/* Toolbar Controls: Language, Dark Mode, Notifications, and Profile */}
        <div className="flex items-center gap-3 justify-end">
          {/* Connection Status Badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl shadow-2xs text-[10px] font-mono font-bold tracking-wider border transition-all duration-300 ${
            isOnline 
              ? 'bg-emerald-50 border-emerald-250 text-emerald-800' 
              : 'bg-amber-50 border-amber-250 text-amber-800 animate-pulse'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span>{isOnline ? (state.lang === 'ka' ? 'ონლაინ' : 'ONLINE') : (state.lang === 'ka' ? 'ოფლაინ' : 'OFFLINE')}</span>
          </div>

          {/* QR Scanner Trigger */}
          {state.isLoggedIn && (
            <button
              onClick={() => setShowQrModal(true)}
              className="p-2 bg-stone-50 border border-stone-200 text-stone-550 rounded-xl hover:text-[#4e0e15] hover:bg-stone-100 transition-colors cursor-pointer dark:bg-stone-900 dark:border-stone-800 flex items-center justify-center shadow-2xs"
              title="Simulate QR Code Scan"
            >
              <QrCode className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Language Switcher */}
          <div className="flex items-center gap-1 bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-xl shadow-2xs dark:bg-stone-900 dark:border-stone-800">
            <Languages className="w-3.5 h-3.5 text-stone-550 shrink-0" />
            <select
              value={state.lang}
              onChange={(e) => {
                const nextLang = e.target.value as Language;
                state.setLang(nextLang);
                localStorage.setItem('vinea_lang', nextLang);
              }}
              className="text-[10px] font-mono font-bold bg-transparent border-0 outline-none text-stone-700 w-14 cursor-pointer"
            >
              <option value="en">EN</option>
              <option value="ka">KA</option>
            </select>
          </div>

          {/* Dark Mode Switcher */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 bg-stone-50 border border-stone-200 text-stone-550 rounded-xl hover:text-[#4e0e15] hover:bg-stone-100 transition-colors cursor-pointer dark:bg-stone-900 dark:border-stone-800"
            title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          {/* Alerts Center */}
          {state.isLoggedIn && <NotificationCenter alerts={alerts} onSelect={handleSelectAlert} />}

          {state.isLoggedIn && (
            <div className="flex items-center gap-3.5 pl-3.5 border-l border-stone-200 dark:border-stone-800">
              <div className="text-right hidden sm:block">
                <span className="font-bold text-xs text-stone-850 block leading-tight dark:text-amber-100">{state.currentUser.fullName}</span>
                <span className="text-[8px] uppercase font-mono text-[#c5a059] font-extrabold block mt-0.5 tracking-wider">
                  {state.currentUser.role === 'Viticulturist' ? (t.signin_role_viticulturist || 'Lead Viticulturist') :
                   state.currentUser.role === 'Winemaker' ? (t.signin_role_winemaker || 'Head Winemaker') :
                   (t.signin_role_owner || 'Owner & ERP Admin')}
                </span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  state.handleAuthLogout();
                  state.setActiveModule('portal');
                }}
                className="bg-[#faf8f6] hover:bg-rose-50/50 border border-stone-200 text-[#801323] px-3.5 py-2 text-[10px] font-mono font-extrabold rounded-xl cursor-pointer transition-all duration-150 uppercase tracking-wider shadow-2xs dark:bg-stone-900 dark:border-stone-800"
                title="Log Out"
              >
                {t.nav_logout || 'Logout'}
              </motion.button>
            </div>
          )}
        </div>
      </header>

      {/* 2. Main Shell Layout */}
      {!state.isLoggedIn ? (
        <div className="flex-1 flex items-stretch justify-center p-4 sm:p-6 bg-gradient-to-b from-[#f8f6f2] to-[#ece5dd] min-h-[82vh] dark:from-[#0d0b09] dark:to-[#1a1512]">
          <div className="w-full max-w-4xl my-auto grid lg:grid-cols-[1.05fr_1fr] rounded-3xl overflow-hidden shadow-[0_30px_80px_-30px_rgba(78,14,21,0.35)] border border-stone-200/70 bg-white animate-fade-in dark:border-stone-850 dark:bg-stone-950">

            {/* Brand hero — desktop only */}
            <div className="relative hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-[#5a1019] via-[#3a0a0f] to-[#1b0203] text-amber-100 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#801323] via-[#c5a059] to-[#801323]" />
              <div className="absolute -right-12 -bottom-16 text-[260px] leading-none opacity-[0.06] select-none pointer-events-none">🍇</div>

              <div className="relative">
                <div className="flex items-center gap-2.5">
                  <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-2xl">🍇</div>
                  <div>
                    <div className="font-serif font-black tracking-[0.3em] text-lg">VINEA</div>
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
                  <div className="font-serif font-black tracking-[0.25em] text-[#1b1715] dark:text-amber-100">VINEA</div>
                  <div className="text-[8px] font-mono uppercase tracking-[0.2em] text-[#c5a059]">Unified Estate ERP</div>
                </div>
              </div>
              
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
                    
                    let mappedRole: 'Owner/Admin' | 'Viticulturist' | 'Winemaker' | 'Lab Technician' | 'Cellar Worker' | 'Read-Only' = 'Viticulturist';
                    if (selectedRole === 'Winemaker') {
                      mappedRole = 'Winemaker';
                    } else if (selectedRole === 'Cellar Assistant') {
                      mappedRole = 'Cellar Worker';
                    } else if (selectedRole === 'Estate Manager') {
                      mappedRole = 'Owner/Admin';
                    }

                    const cleanUsername = user.toLowerCase().replace(/\s+/g, '_');
                    await state.handleAuthRegister({
                      username: cleanUsername,
                      email: email,
                      fullName: name,
                      role: mappedRole,
                      language: state.lang === 'ka' ? 'ka' : 'en',
                      rememberMe: rememberMe,
                      passcode: passcode
                    });

                    if (regLocation) {
                      state.setCompanyProfile({
                        ...state.companyProfile,
                        latitude: regLocation.latitude,
                        longitude: regLocation.longitude,
                        ...(regLocation.label ? { address: regLocation.label } : {})
                      });
                    }
                    if (mappedRole === 'Winemaker' || mappedRole === 'Cellar Worker') {
                      state.setActiveModule('gvino');
                    } else {
                      state.setActiveModule('vazi');
                    }
                  }} className="space-y-4 mt-4">
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'სრული სახელი' : 'Full Name'}
                      </label>
                      <input
                        type="text"
                        name="fullName"
                        placeholder={state.lang === 'ka' ? 'ლუკა ტატრიშვილი' : 'Luka Tatrishvili'}
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
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">
                        {state.lang === 'ka' ? 'მამულის / ვენახის მდებარეობა' : 'Estate / Vineyard Location'}
                      </label>
                      <LocationPicker
                        latitude={regLocation?.latitude ?? state.companyProfile.latitude ?? 41.9056}
                        longitude={regLocation?.longitude ?? state.companyProfile.longitude ?? 45.474}
                        showManual={false}
                        placeholder={state.lang === 'ka' ? 'მოძებნეთ ადგილი… მაგ. თელავი' : 'Search your estate… e.g. Telavi, Kakheti'}
                        onChange={(loc) => setRegLocation(loc)}
                      />
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
                      {state.lang === 'ka' ? 'რეგისტრაციის დასრულება' : 'Complete Registration & Enter'}
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
                    const fd = new FormData(e.currentTarget);
                    const rememberMe = fd.get('rememberMe') === 'true';
                    const success = await state.handleAuthLogin(
                      String(fd.get('identifier') || ''),
                      String(fd.get('passcode') || ''),
                      rememberMe
                    );
                    if (success) {
                      state.setActiveModule('portal');
                    }
                  }} className="space-y-4">
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">{t.signin_username || 'Account Username / Email'}</label>
                      <input
                        type="text"
                        name="identifier"
                        placeholder={state.lang === 'ka' ? 'მომხმარებელი ან ელ-ფოსტა' : 'username or email'}
                        autoComplete="username"
                        className="w-full bg-stone-50/80 border border-stone-200/80 px-3 py-2.5 rounded-xl text-xs outline-none text-stone-900 font-bold focus:border-stone-400 transition-colors"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400 font-extrabold tracking-widest">{t.signin_passcode || 'Passcode'}</label>
                      <input
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
                      <p className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" /> {state.loginError}
                      </p>
                    )}

                    <button
                      type="submit"
                      className="w-full bg-[#4e0e15] hover:bg-[#34070a] text-white font-mono font-bold uppercase tracking-widest py-3 rounded-xl cursor-pointer shadow-sm transition-all duration-155 text-xs mt-2"
                    >
                      {t.signin_btn || 'Secure Portal Login'}
                    </button>

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
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col">
          <Suspense fallback={<ModuleLoader />}>
            <VaziModule
              lang={state.lang}
              currentUser={state.currentUser}
              blocks={state.blocks}
              phenologyLogs={state.phenologyLogs}
              sprays={state.sprays}
              scoutings={state.scoutings}
              soilRecords={state.soilRecords}
              samplings={state.samplings}
              harvests={state.harvests}
              irrigationLogs={state.irrigationLogs}
              fertilizerLogs={state.fertilizerLogs}
              onAddBlock={state.handleAddBlock}
              onUpdateBlock={state.handleUpdateBlock}
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
              setPrefilledTaskTitle={state.setPrefilledTaskTitle}
              setPrefilledTaskPriority={state.setPrefilledTaskPriority}
              setPrefilledTaskDesc={state.setPrefilledTaskDesc}
            />
          </Suspense>
        </main>
      ) : state.activeModule === 'portal' ? (
        <DashboardTab
          lang={state.lang}
          companyProfile={state.companyProfile}
          currentUser={state.currentUser}
          blocks={state.blocks}
          lots={state.lots}
          vessels={state.vessels}
          tasks={state.tasks}
          auditLogs={state.auditLogs}
          onToggleTaskStatus={state.handleToggleTaskStatus}
          setActiveModule={state.setActiveModule}
          setActiveTab={state.setActiveTab}
        />
      ) : state.activeModule === 'settings' ? (
        <ProfileSettingsTab
          lang={state.lang}
          currentUser={state.currentUser}
          setCurrentUser={state.setCurrentUser}
          companyProfile={state.companyProfile}
          setCompanyProfile={state.setCompanyProfile}
          setToastMessage={state.setToastMessage}
          onClearAllData={state.clearAllData}
        />
      ) : state.activeModule === 'audit' ? (
        <AuditTrailTab
          lang={state.lang}
          auditLogs={state.auditLogs}
        />
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-6 flex flex-col lg:flex-row gap-6">
          
          {/* Sticky sidebar */}
          <aside className={`shrink-0 w-full ${state.isSidebarCollapsed ? 'lg:w-20' : 'lg:w-60'} lg:self-start lg:sticky lg:top-24 transition-[width] duration-300`}>
            <div className="hidden lg:flex items-center justify-between px-1 pb-2 mb-1 border-b border-[#e8dfd5]/70 dark:border-stone-800">
              {!state.isSidebarCollapsed && <span className="text-[10px] font-mono text-stone-400 uppercase tracking-[0.15em] font-bold">Winery Menu</span>}
              <button
                onClick={() => state.setIsSidebarCollapsed(!state.isSidebarCollapsed)}
                className="ml-auto p-1.5 text-stone-400 hover:text-[#4e0e15] hover:bg-stone-100 rounded-md transition-colors cursor-pointer"
                title={state.isSidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
              >
                {state.isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible no-scrollbar -mx-4 px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
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
                const isActive = state.activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => state.setActiveTab(tab.id)}
                    title={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group shrink-0 lg:w-full flex items-center gap-2.5 px-3.5 py-2 lg:py-2.5 rounded-lg text-xs font-semibold tracking-wide whitespace-nowrap cursor-pointer transition-colors ${
                      state.isSidebarCollapsed ? 'lg:justify-center' : ''
                    } ${
                      isActive
                        ? 'bg-[#4e0e15] text-[#fbf9f6] shadow-sm'
                        : 'text-stone-600 hover:text-[#4e0e15] hover:bg-[#f5efe9]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-400' : 'text-[#4e0e15]/70 group-hover:text-[#4e0e15]'}`} />
                    <span className={state.isSidebarCollapsed ? 'lg:hidden' : ''}>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Content Tabs Area */}
          <section className="flex-1 min-w-0 space-y-4">
            
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
                  onSelectTank={state.setSelectedTankId} 
                  selectedTankId={state.selectedTankId} 
                  setActiveTab={state.setActiveTab}
                  setPrefilledSourceId={state.setPrefilledSourceId}
                  setPrefilledDestId={state.setPrefilledDestId}
                />
              </div>
            )}

            {/* C. WINE LOTS TAB */}
            {state.activeTab === 'lots' && (
              <WineLotsTrace 
                lang={state.lang} 
                lots={state.lots} 
                onUpdateLots={state.setLots} 
                onOpenPassport={state.setPassportLotId} 
                vessels={state.vessels}
                labLogs={state.labLogs}
                setActiveTab={state.setActiveTab}
                setSelectedTankId={state.setSelectedTankId}
                setCalculatorLotId={state.setCalculatorLotId}
                setCalculatorLotIdA={state.setCalculatorLotIdA}
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
                prefilledSourceId={state.prefilledSourceId}
                prefilledDestId={state.prefilledDestId}
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
                onUpdateLots={state.setLots}
                onUpdateVessels={state.setVessels}
                onUpdateFermLogs={state.setFermLogs}
              />
            )}

            {/* F. LAB ANALYSIS TIMELINES */}
            {state.activeTab === 'labs' && (
              <LabsTab
                lang={state.lang}
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
              <InventoryTab inventory={state.inventory} onUpdateInventory={state.setInventory} />
            )}

            {/* I. AI ASSISTANT WINEMAKER */}
            {state.activeTab === 'ai' && (
              <Suspense fallback={<ModuleLoader />}>
                <AiWinemaker
                  lang={state.lang}
                  cellarState={{
                    tanksCount: state.vessels.length,
                    activeFermsCount,
                    avgTemp: occupiedTanksCount > 0 
                      ? parseFloat((state.vessels.reduce((acc, curr) => acc + (curr.temperature || 0), 0) / state.vessels.length).toFixed(1))
                      : 15.0,
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
              />
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

      {/* SLIDE-OUT PANEL FOR SELECTED VESSEL DETAILED METRICS */}
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
      />

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
                className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-gradient-to-tr from-[#4e0e15] to-[#801323] hover:from-[#801323] hover:to-[#c5a059] text-white rounded-full flex items-center justify-center shadow-[0_8px_30px_rgba(78,14,21,0.55)] border-2 border-[#c5a059]/50 dark:border-amber-400/50 cursor-pointer focus:outline-none transition-all duration-300 group"
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
                  key="ai-drawer"
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
                        <h2 className="text-sm font-serif font-black text-[#4e0e15] dark:text-amber-150 tracking-wide">
                          AI Winemaker Assistant
                        </h2>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Context: {state.activeModule === 'vazi' ? 'Vineyard (Vazi)' : `Winery (Gvino) - ${state.activeTab}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsAiDrawerOpen(false)}
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
                          avgTemp: occupiedTanksCount > 0 
                            ? parseFloat((state.vessels.reduce((acc, curr) => acc + (curr.temperature || 0), 0) / state.vessels.length).toFixed(1))
                            : 15.0,
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
                      />
                    </Suspense>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}

      {/* QR CODE SCANNER SIMULATOR MODAL */}
      {showQrModal && (
        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#140d0e] max-w-md w-full rounded-2xl border border-stone-200 dark:border-[#2a191b] shadow-2xl overflow-hidden animate-scale-up text-stone-850 dark:text-stone-100 font-sans">
            <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800 flex justify-between items-center bg-stone-50 dark:bg-stone-950/40">
              <h3 className="text-sm font-serif font-black text-[#4e0e15] dark:text-amber-150 flex items-center gap-2">
                <QrCode className="w-4 h-4 text-[#801323] dark:text-amber-400" />
                Mobile QR Code Scanner Simulator
              </h3>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Viewfinder Framed Scanner Animation */}
              <div className="relative w-48 h-48 mx-auto border-2 border-stone-300 dark:border-stone-700 rounded-xl overflow-hidden flex items-center justify-center bg-stone-50 dark:bg-stone-900 shadow-inner">
                <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#801323] dark:border-amber-400"></div>
                <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#801323] dark:border-amber-400"></div>
                <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#801323] dark:border-amber-400"></div>
                <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#801323] dark:border-amber-400"></div>
                
                <div className="absolute left-0 right-0 h-0.5 bg-emerald-500 shadow-[0_0_10px_#10b981] animate-bounce w-full" style={{ animationDuration: '2.5s' }}></div>

                <div className="text-center p-3 select-none pointer-events-none">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400 block mb-1">Scanning...</span>
                  <span className="text-2xl">📷</span>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs text-stone-500 dark:text-stone-450 leading-relaxed text-center font-semibold">
                  Select a mockup asset barcode target to simulate scanning with a smartphone camera.
                </p>

                <div className="space-y-3.5 max-h-60 overflow-y-auto pr-1">
                  <div>
                    <h4 className="text-[10px] uppercase font-mono text-stone-400 dark:text-stone-500 tracking-wider font-extrabold mb-1.5">Vessels (Tank Drawers)</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {state.vessels.slice(0, 4).map(v => (
                        <button
                          key={v.id}
                          onClick={() => {
                            state.setSelectedTankId(v.id);
                            state.setActiveModule('gvino');
                            state.setActiveTab('vessels');
                            setShowQrModal(false);
                            state.setToastMessage(`Scanned QR for Vessel: ${v.id}`);
                          }}
                          className="p-2 text-left bg-stone-50 hover:bg-[#FAF8F5]/85 border border-stone-200 dark:bg-stone-900 dark:border-stone-850 rounded-xl hover:border-[#801323] transition-all cursor-pointer text-xs font-bold text-[#4e0e15] dark:text-amber-100 flex items-center justify-between group"
                        >
                          <span>{v.id}</span>
                          <span className="text-[9px] font-mono text-stone-400 font-semibold group-hover:text-stone-600">Scan ⚡</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="text-[10px] uppercase font-mono text-stone-400 dark:text-stone-500 tracking-wider font-extrabold mb-1.5">Wine Lots (Passport Reports)</h4>
                    <div className="space-y-2">
                      {state.lots.slice(0, 3).map(l => (
                        <button
                          key={l.id}
                          onClick={() => {
                            state.setPassportLotId(l.id);
                            state.setActiveModule('gvino');
                            setShowQrModal(false);
                            state.setToastMessage(`Scanned QR for Lot: ${l.name}`);
                          }}
                          className="w-full p-2.5 text-left bg-stone-50 hover:bg-[#FAF8F5]/85 border border-stone-200 dark:bg-stone-900 dark:border-[#2a191b] rounded-xl hover:border-[#801323] transition-all cursor-pointer text-xs font-bold flex items-center justify-between group"
                        >
                          <div>
                            <span className="text-[#4e0e15] dark:text-amber-100 block font-serif">{l.name}</span>
                            <span className="text-[9px] text-stone-450 block font-mono font-semibold">{l.id} • {l.variety} ({l.vintage})</span>
                          </div>
                          <span className="text-[9px] font-mono text-stone-400 font-semibold group-hover:text-stone-600">Scan ⚡</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 bg-stone-50 dark:bg-stone-950/40 border-t border-stone-100 dark:border-stone-800 flex justify-end">
              <button
                onClick={() => setShowQrModal(false)}
                className="px-4 py-2 bg-stone-200 dark:bg-stone-800 hover:bg-stone-300 dark:hover:bg-stone-750 text-stone-700 dark:text-stone-200 text-xs font-mono font-bold rounded-xl transition-all cursor-pointer"
              >
                Close Scanner
              </button>
            </div>
          </div>
        </div>
      )}

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
      <div className="bg-white dark:bg-[#140d0e] max-w-md w-full rounded-2xl border border-stone-200 dark:border-[#2a191b] shadow-2xl overflow-hidden animate-scale-up text-stone-850 dark:text-stone-100 font-sans">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-100 dark:border-stone-800 flex justify-between items-center bg-stone-50 dark:bg-stone-950/40">
          <h3 className="text-sm font-serif font-black text-[#4e0e15] dark:text-amber-150 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-[#801323] dark:text-amber-400 animate-spin" style={{ animationDuration: '3s' }} />
            {lang === 'ka' ? 'სინქრონიზაციის შეცდომების დიაგნოსტიკა' : 'Sync Rejection Troubleshooter'}
          </h3>
          <button
            onClick={onClose}
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
