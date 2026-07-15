import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import LiveClock from './LiveClock';
import type {
  UserProfile,
  CompanyProfile,
  VineyardBlock,
  WineLot,
  Vessel,
  Task,
  MaraniOSAuditLog,
  DailyFermLog,
  LabAnalysis,
  InventoryItem,
  ScoutingRecord,
  GrapeIntakeRecord,
  CellarOperation
} from '../lib/wineryState';
import SetupJourney from './SetupJourney';
import {
  computeSetupJourney, isSetupJourneyDismissed, setSetupJourneyDismissed, type SetupStep,
} from '../lib/onboarding';
import { 
  Wind, Sprout, AlertTriangle, FileText, CheckCircle2, 
  Activity, Thermometer, ShieldAlert, Sliders, ClipboardList, CheckSquare 
} from 'lucide-react';
import { computeAlerts } from '../lib/alerts';
import { alertSeverityLabel } from '../lib/enumLabels';
import { CountUp } from './motion';
import { localizedRoleLabel } from '../lib/roleLabels';
import { canAccess, type PermissionAction, type PermissionModule } from '../server/permissions';
import { canViewAppDestination } from '../lib/navigationPermissions';
import { DayWeather, describeWeatherCode, fetchDayWeather, localISODate } from '../lib/weatherApi';

interface DashboardTabProps {
  lang: Language;
  companyProfile: CompanyProfile;
  currentUser: UserProfile;
  blocks: VineyardBlock[];
  lots: WineLot[];
  vessels: Vessel[];
  tasks: Task[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  inventory: InventoryItem[];
  scoutings: ScoutingRecord[];
  auditLogs: MaraniOSAuditLog[];
  grapeIntakes: GrapeIntakeRecord[];
  cellarOps: CellarOperation[];
  onToggleTaskStatus: (taskId: string) => void;
  setActiveModule: (mod: 'portal' | 'vazi' | 'gvino' | 'settings' | 'audit') => void;
  setActiveTab: (tab: string) => void;
  onOpenOnboarding: () => void;
}

const SETUP_STEP_PERMISSIONS: Record<SetupStep['id'], [PermissionModule, PermissionAction]> = {
  profile: ['company_profile', 'update'],
  block: ['vineyard', 'create'],
  vessel: ['vessels', 'create'],
  intake: ['grape_intake', 'create'],
  operation: ['operations', 'create'],
  lab: ['lab', 'create'],
};

export default function DashboardTab({
  lang,
  companyProfile,
  currentUser,
  blocks,
  lots,
  vessels,
  tasks,
  fermLogs,
  labLogs,
  inventory,
  scoutings,
  auditLogs,
  grapeIntakes,
  cellarOps,
  onToggleTaskStatus,
  setActiveModule,
  setActiveTab,
  onOpenOnboarding
}: DashboardTabProps) {
  const t = translations[lang];

  const canViewCellarTab = (tabId: string) => canViewAppDestination(currentUser.role, 'gvino', tabId);
  const canViewVineyard = canViewAppDestination(currentUser.role, 'vazi');
  const canViewCellar = canViewAppDestination(currentUser.role, 'gvino');
  const canCreateFermentation = canAccess(currentUser.role, 'fermentation', 'create');
  const canCreateLab = canAccess(currentUser.role, 'lab', 'create');
  const canViewTasks = canViewCellarTab('tasks');
  const canUpdateTasks = canAccess(currentUser.role, 'tasks', 'update');

  // Setup Journey — live onboarding progress computed from real records.
  const journey = computeSetupJourney({
    companyProfile, blocks, vessels, lots, grapeIntakes, cellarOps, fermLogs, labLogs,
  });
  const [journeyDismissed, setJourneyDismissed] = useState(isSetupJourneyDismissed);
  const goToStep = (step: SetupStep) => {
    const [permissionModule, action] = SETUP_STEP_PERMISSIONS[step.id];
    if (!canAccess(currentUser.role, permissionModule, action)) return;
    setActiveModule(step.module);
    if (step.tab) setActiveTab(step.tab);
  };

  // Resolve preferences defaults
  const enabledModules = currentUser.enabledModules || ['vazi', 'gvino'];
  const enabledWidgets = currentUser.enabledWidgets || ['weather', 'chemistry', 'scouting', 'fermentation', 'notes', 'tasks', 'audit'];
  const roleJourneySteps = journey.steps.filter((step) => {
    if (step.module === 'vazi' && !enabledModules.includes('vazi')) return false;
    if (step.module === 'gvino' && !enabledModules.includes('gvino')) return false;
    const [module, action] = SETUP_STEP_PERMISSIONS[step.id];
    return canAccess(currentUser.role, module, action);
  });
  const roleJourneyDone = roleJourneySteps.filter((step) => step.done).length;
  const roleJourney = {
    ...journey,
    steps: roleJourneySteps,
    done: roleJourneyDone,
    total: roleJourneySteps.length,
    pct: roleJourneySteps.length ? Math.round((roleJourneyDone / roleJourneySteps.length) * 100) : 100,
    complete: roleJourneyDone === roleJourneySteps.length,
    nextStep: roleJourneySteps.find((step) => !step.done) || null,
  };

  // Derive metrics
  const totalArea = blocks.reduce((acc, b) => acc + b.area, 0);
  const totalCapacity = vessels.reduce((acc, v) => acc + v.capacity, 0);
  const activeFermsCount = lots.filter(l => l.stage === 'fermenting').length;
  const today = localISODate();
  const pendingTasks = tasks
    .filter((task) => task.status !== 'completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueTasks = pendingTasks.filter((task) => task.dueDate < today);
  const activeFerments = lots.filter((lot) => lot.stage === 'fermenting');
  const fermentsMissingReading = activeFerments.filter(
    (lot) => !fermLogs.some((log) => log.lotId === lot.id && log.date === today)
  );
  const unassignedLots = lots.filter(
    (lot) => lot.currentVolume > 0 && !vessels.some((vessel) => vessel.assignedLotId === lot.id)
  );
  const highRiskScoutings = scoutings.filter((record) => record.severity === 'high');
  const latestScouting = [...scoutings].sort((a, b) => b.date.localeCompare(a.date))[0];

  const [weather, setWeather] = useState<DayWeather | null>(null);
  const [weatherError, setWeatherError] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    const latitude = companyProfile.latitude;
    const longitude = companyProfile.longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setWeather(null);
      setWeatherError(lang === 'ka' ? 'მამულის კოორდინატები არ არის მითითებული.' : 'Estate coordinates are not configured.');
      return;
    }

    let active = true;
    setWeatherLoading(true);
    setWeatherError('');
    fetchDayWeather(latitude as number, longitude as number, today)
      .then((result) => {
        if (active) setWeather(result);
      })
      .catch((error) => {
        if (active) {
          setWeather(null);
          setWeatherError(error instanceof Error ? error.message : (lang === 'ka' ? 'ამინდი მიუწვდომელია.' : 'Weather is unavailable.'));
        }
      })
      .finally(() => {
        if (active) setWeatherLoading(false);
      });

    return () => {
      active = false;
    };
  }, [companyProfile.latitude, companyProfile.longitude, today, lang]);

  // Compute oenology alerts
  const derivedAlerts = computeAlerts({
    vessels,
    lots,
    fermLogs,
    labLogs,
    inventory,
    tasks,
    lang
  });
  const criticalAlerts = derivedAlerts.filter((alert) => alert.severity === 'critical');
  const displayedAlerts = derivedAlerts.slice(0, 3);
  const weatherSummary = weather ? describeWeatherCode(weather.current?.code ?? weather.daily.code, lang) : null;
  const weatherHumidity = weather?.current?.humidity ?? 0;
  const weatherTemp = weather?.current?.temp ?? ((weather?.daily.tempMax ?? 0) + (weather?.daily.tempMin ?? 0)) / 2;
  const diseaseRisk = weather
    ? weather.daily.precipSum >= 5 || (weatherHumidity >= 85 && weatherTemp >= 10 && weatherTemp <= 28)
      ? 'high'
      : weather.daily.precipSum > 0 || weatherHumidity >= 75
        ? 'watch'
        : 'low'
    : null;
  const estateLocation = [companyProfile.region, companyProfile.country].filter(Boolean).join(', ')
    || (lang === 'ka' ? 'მდებარეობა არ არის მითითებული' : 'Location not configured');

  return (
    <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 lg:p-8 flex flex-col space-y-8 animate-fade-in text-stone-900 dark:text-stone-200">
      {/* Main platform Welcome header */}
      <div className="bg-gradient-to-r from-white via-white to-[#fbfaf8] dark:from-[#110b0c] dark:via-[#110b0c] dark:to-[#1a1113] border border-stone-200/90 dark:border-stone-850 rounded-3xl p-8 lg:p-10 shadow-[0_4px_30px_rgba(78,14,21,0.02)] relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
        {/* Elegant side color-stripe indicator */}
        <div className="absolute top-0 bottom-0 left-0 w-2 bg-gradient-to-b from-[#801323] to-[#4e0e15]" />
        
        <div className="space-y-2.5 pl-3">
          <span className="text-[10px] uppercase tracking-widest bg-[#fcf8f6] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 text-[#4e0e15] dark:text-amber-200 px-4 py-1.5 rounded-full font-black inline-block">
            📢 {t.portal_hq || 'Estate Headquarters'}
          </span>
          <h2 className="text-3xl lg:text-4xl font-display font-black text-stone-950 dark:text-amber-100 tracking-tight uppercase leading-none mt-1">{t.portal_welcome || 'Welcome to MaraniOS'}</h2>
          <p className="text-sm lg:text-base text-stone-600 dark:text-stone-400 font-sans mt-2">{t.portal_status_p || 'Real-time status indicators across your agricultural blocks & fermentation vats'}</p>
        </div>
        
        <div className="flex flex-wrap gap-3 text-[11px] font-mono pl-3 md:pl-0 items-center">
          {/* Precision Live Clock */}
          <div className="bg-[#FAF8F5]/85 dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 px-5 py-3 rounded-2xl text-left shadow-2xs">
            <span className="text-stone-500 dark:text-stone-400 block text-[9px] uppercase tracking-widest font-extrabold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block" />
              {lang === 'ka' ? 'ენოლოგიის საათი' : 'Oenology Clock'}
            </span>
            <LiveClock lang={lang} className="text-stone-900 dark:text-amber-200 block mt-1 font-mono font-bold text-xs text-[#4e0e15]" />
          </div>
          <div className="bg-[#fcfbf9] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 px-5 py-3 rounded-2xl text-left">
            <span className="text-stone-500 dark:text-stone-400 block text-[9px] uppercase tracking-wider font-extrabold">{t.portal_appellation || 'Active Appellation'}</span>
            <strong className="text-[#8a6425] dark:text-[#c5a059] block mt-1 font-display font-extrabold text-xs">{estateLocation}</strong>
          </div>
          <div className="bg-[#fcfbf9] dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 px-5 py-3 rounded-2xl text-left">
            <span className="text-stone-500 dark:text-stone-400 block text-[9px] uppercase tracking-wider font-extrabold">{t.portal_role || 'Active Role'}</span>
            <strong className="text-stone-950 dark:text-amber-100 block mt-1 font-display font-black text-xs">
              {localizedRoleLabel(currentUser.role, lang)}
            </strong>
          </div>
          <button
            onClick={onOpenOnboarding}
            className="bg-[#4e0e15] hover:bg-[#801323] text-white px-5 py-3 rounded-2xl font-mono font-bold uppercase transition-all cursor-pointer shadow-2xs text-[11px] select-none hover-lift"
          >
            ⚙️ {lang === 'ka' ? 'დაფის მორგება' : 'Customize Dashboard'}
          </button>
        </div>
      </div>

      {/* Setup Journey — guided zero-to-productive path for a young winery. */}
      {roleJourney.total > 0 && !roleJourney.complete && !journeyDismissed && (
        <SetupJourney
          lang={lang}
          journey={roleJourney}
          onNavigate={goToStep}
          onDismiss={() => { setSetupJourneyDismissed(true); setJourneyDismissed(true); }}
        />
      )}
      {roleJourney.total > 0 && !roleJourney.complete && journeyDismissed && (
        <button
          type="button"
          onClick={() => { setSetupJourneyDismissed(false); setJourneyDismissed(false); }}
          className="self-start inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-[#c5a059]/40 bg-[#c5a059]/10 text-[11px] font-bold text-[#7a5c1e] hover:border-[#c5a059] transition-colors cursor-pointer dark:text-amber-300"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#c5a059] animate-pulse" />
          {lang === 'ka' ? `გამართვა ${roleJourney.done}/${roleJourney.total} — გაგრძელება` : `Setup ${roleJourney.done}/${roleJourney.total} — resume`}
        </button>
      )}

      {/* Daily operating loop — only persisted records and live services. */}
      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-[#801323] dark:text-amber-300">
              {lang === 'ka' ? 'დღევანდელი სამუშაო' : 'Today'}
            </span>
            <h3 className="mt-1 text-2xl font-display font-black text-stone-950 dark:text-amber-100">
              {lang === 'ka' ? 'რა მოითხოვს ყურადღებას' : 'What needs attention'}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreateFermentation && (
              <button
                onClick={() => { setActiveModule('gvino'); setActiveTab('fermentation'); }}
                className="rounded-xl bg-[#4e0e15] px-4 py-2 text-[11px] font-bold text-white cursor-pointer"
              >
                + {lang === 'ka' ? 'დუღილის ჩანაწერი' : 'Log fermentation'}
              </button>
            )}
            {canCreateLab && (
              <button
                onClick={() => { setActiveModule('gvino'); setActiveTab('labs'); }}
                className="rounded-xl border border-stone-250 bg-white px-4 py-2 text-[11px] font-bold text-stone-700 cursor-pointer dark:bg-stone-900 dark:border-stone-700 dark:text-stone-200"
              >
                + {lang === 'ka' ? 'ლაბორატორიული შედეგი' : 'Add lab result'}
              </button>
            )}
            {canViewTasks && (
              <button
                onClick={() => { setActiveModule('gvino'); setActiveTab('tasks'); }}
                className="rounded-xl border border-stone-250 bg-white px-4 py-2 text-[11px] font-bold text-stone-700 cursor-pointer dark:bg-stone-900 dark:border-stone-700 dark:text-stone-200"
              >
                {lang === 'ka' ? 'დავალებები' : 'Review tasks'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            {
              label: lang === 'ka' ? 'კრიტიკული გაფრთხილებები' : 'Critical alerts',
              value: criticalAlerts.length,
              detail: derivedAlerts.length
                ? (lang === 'ka' ? `${derivedAlerts.length} ღია სულ` : `${derivedAlerts.length} open total`)
                : (lang === 'ka' ? 'აქტიური გაფრთხილება არ არის' : 'No active alerts'),
              action: canViewCellar ? () => { setActiveModule('gvino'); setActiveTab('dashboard'); } : undefined,
              tone: criticalAlerts.length ? 'text-rose-700' : 'text-emerald-700',
            },
            {
              label: lang === 'ka' ? 'ვადაგადაცილებული დავალებები' : 'Overdue tasks',
              value: overdueTasks.length,
              detail: lang === 'ka' ? `${pendingTasks.length} მოლოდინში` : `${pendingTasks.length} pending`,
              action: canViewTasks ? () => { setActiveModule('gvino'); setActiveTab('tasks'); } : undefined,
              tone: overdueTasks.length ? 'text-rose-700' : 'text-stone-800',
            },
            {
              label: lang === 'ka' ? 'დღიური ჩანაწერის გარეშე' : 'Ferments missing today',
              value: fermentsMissingReading.length,
              detail: lang === 'ka' ? `${activeFerments.length} აქტიური დუღილი` : `${activeFerments.length} active fermentations`,
              action: canViewCellarTab('fermentation') ? () => { setActiveModule('gvino'); setActiveTab('fermentation'); } : undefined,
              tone: fermentsMissingReading.length ? 'text-amber-700' : 'text-emerald-700',
            },
            {
              label: lang === 'ka' ? 'ჭურჭლის გარეშე დარჩენილი პარტია' : 'Lots without a vessel',
              value: unassignedLots.length,
              detail: lang === 'ka' ? `${lots.length} ჩაწერილი პარტია` : `${lots.length} lots recorded`,
              action: canViewCellarTab('vessels') ? () => { setActiveModule('gvino'); setActiveTab('vessels'); } : undefined,
              tone: unassignedLots.length ? 'text-amber-700' : 'text-stone-800',
            },
          ].map((item) => {
            const content = (
              <>
              <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-stone-600 dark:text-stone-400">{item.label}</span>
              <strong className={`mt-2 block text-3xl font-sans font-black ${item.tone}`}>{item.value}</strong>
              <span className="mt-1 block text-[11px] font-medium text-stone-500 dark:text-stone-400">{item.detail}</span>
              </>
            );
            return item.action ? (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                className="rounded-2xl border border-[#e8dfd5] bg-white p-4 text-left shadow-xs transition-transform hover:-translate-y-0.5 cursor-pointer dark:bg-stone-900 dark:border-stone-800"
              >
                {content}
              </button>
            ) : (
              <div
                key={item.label}
                className="rounded-2xl border border-[#e8dfd5] bg-stone-50/70 p-4 text-left shadow-xs dark:bg-stone-900 dark:border-stone-800"
              >
                {content}
              </div>
            );
          })}
        </div>
      </section>

      {/* Module launch deck bentogrid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-stone-900">
        
        {/* Vazi Module Card */}
        {enabledModules.includes('vazi') && canViewVineyard && (
          <motion.div 
            whileHover={{ y: -4, shadow: '0 20px 40px rgba(16,185,129,0.08)' }}
            className={`p-8 lg:p-10 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-sm duration-300 space-y-6 flex flex-col justify-between relative overflow-hidden group hover:border-emerald-300 transition-all cursor-pointer ${
              !(enabledModules.includes('gvino') && canViewCellar) ? 'lg:col-span-2' : ''
            }`}
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-600/10 via-emerald-600/30 to-emerald-600/10" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-4 py-1 rounded-full font-black border border-emerald-100 dark:border-emerald-900">
                  ✨ {t.portal_module_agri || 'Agricultural Module'}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-500 font-mono">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  {blocks.length} {lang === 'ka' ? 'ჩაწერილი ნაკვეთი' : `${blocks.length === 1 ? 'BLOCK' : 'BLOCKS'} RECORDED`}
                </span>
              </div>
              
              <h3 className="text-2xl font-display font-black text-stone-950 dark:text-amber-100 leading-tight flex items-center gap-2">🚜 {t.portal_vazi_title || 'Vazi Vineyard Operations'}</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-medium">
                {t.portal_vazi_desc || 'Trace canopy development, heat sum Growing Degree Days predictions, scouting downy/powdery pathogens, and pre-harvest grape sugar maturation curves.'}
              </p>

              {/* Sub-metrics */}
              <div className="grid grid-cols-3 gap-4 border-t border-stone-100 dark:border-stone-800 pt-5 font-sans text-stone-600">
                <div>
                  <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 block pb-0.5">{t.portal_blocks_count || 'Registered Blocks'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5"><CountUp value={blocks.length} /> {lang === 'ka' ? 'ნაკვეთი' : 'Sectors'}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 block pb-0.5">{t.portal_total_area || 'Total Area'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5"><CountUp value={totalArea} decimals={1} /> ha</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 block pb-0.5 font-bold">{t.portal_scout_status || 'Scouting Reports'}</span>
                  <strong className={`text-lg lg:text-xl font-display font-extrabold block mt-0.5 ${highRiskScoutings.length ? 'text-rose-700' : 'text-emerald-800 dark:text-emerald-400'}`}>
                    {scoutings.length === 0
                      ? (lang === 'ka' ? 'ანგარიში არ არის' : 'No reports')
                      : highRiskScoutings.length
                        ? (lang === 'ka' ? `${highRiskScoutings.length} მაღალი რისკი` : `${highRiskScoutings.length} high risk`)
                        : (lang === 'ka' ? `${scoutings.length} ჩაწერილი` : `${scoutings.length} recorded`)}
                  </strong>
                </div>
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveModule('vazi')}
              className="w-full mt-6 bg-emerald-850 hover:bg-emerald-950 text-white font-mono font-bold uppercase tracking-wider py-3.5 rounded-2xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs hover-lift"
            >
              {t.portal_launch_vazi || 'Launch Vazi Management'} →
            </motion.button>
          </motion.div>
        )}

        {/* Gvino Module Card */}
        {enabledModules.includes('gvino') && canViewCellar && (
          <motion.div 
            whileHover={{ y: -4, shadow: '0 20px 40px rgba(78,14,21,0.08)' }}
            className={`p-8 lg:p-10 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-sm duration-300 space-y-6 flex flex-col justify-between relative overflow-hidden group hover:border-rose-300 transition-all cursor-pointer ${
              !(enabledModules.includes('vazi') && canViewVineyard) ? 'lg:col-span-2' : ''
            }`}
          >
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#4e0e15]/10 via-[#4e0e15]/30 to-[#4e0e15]/10" />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-mono bg-rose-50 dark:bg-stone-950/40 text-rose-850 dark:text-rose-300 px-4 py-1 rounded-full font-black border border-rose-100 dark:border-stone-800">
                  🍇 {t.portal_module_wine || 'Winery & Oenology'}
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-500 font-mono">
                  <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                  {vessels.filter((vessel) => vessel.currentVolume > 0).length} {lang === 'ka' ? 'აქტიური ჭურჭელი' : 'ACTIVE VESSELS'}
                </span>
              </div>
              
              <h3 className="text-2xl font-display font-black text-[#4e0e15] dark:text-amber-100 leading-tight flex items-center gap-2">🍷 {t.portal_gvino_title || 'Gvino Cellar & Production'}</h3>
              <p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed font-medium">
                {t.portal_gvino_desc || 'Manage stainless steel fermenters fill index, direct transfers log, lab Free & Total SO2 levels, additives calibration, and the Winemaker AI assistant.'}
              </p>

              {/* Sub-metrics */}
              <div className="grid grid-cols-3 gap-4 border-t border-stone-100 dark:border-stone-800 pt-5 font-sans text-stone-600">
                <div>
                  <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 block pb-0.5">{t.portal_total_capacity || 'Total Capacity'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5"><CountUp value={totalCapacity} format={(n) => Math.round(n).toLocaleString()} /> L</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 block pb-0.5">{t.portal_active_lots || 'Active Lots'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-stone-900 dark:text-amber-100 block mt-0.5"><CountUp value={lots.length} /> {lang === 'ka' ? 'ჯიში' : 'Lots'}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 block pb-0.5">{t.portal_fermenting_vessels || 'Fermenting'}</span>
                  <strong className="text-lg lg:text-xl font-display font-extrabold text-amber-600 block mt-0.5">🔥 <CountUp value={activeFermsCount} /> {lang === 'ka' ? 'ჭურჭელი' : 'Vessels'}</strong>
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
              className="w-full mt-6 bg-[#4e0e15] hover:bg-[#801323] text-white font-mono font-bold uppercase tracking-wider py-3.5 rounded-2xl cursor-pointer text-xs justify-center flex items-center gap-1 transition-colors shadow-2xs hover-lift"
            >
              {t.portal_launch_gvino || 'Launch Gvino Winemaking'} →
            </motion.button>
          </motion.div>
        )}

      </div>

      {/* Customizable Grid widgets - OVERHAULED to 3-column desktop layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 text-stone-900">
        
        {/* Widget 1: Safety & Chemistry alerts */}
        {enabledWidgets.includes('chemistry') && enabledModules.includes('gvino') && canViewCellarTab('labs') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                ⚠️ {lang === 'ka' ? 'უსაფრთხოების და ქიმიის გაფრთხილებები' : 'Safety & Chemistry Warnings'}
              </h4>
              <div className="space-y-3.5">
                {displayedAlerts.length > 0 ? (
                  displayedAlerts.map(alert => (
                    <div key={alert.id} className="p-4 bg-red-50/50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/50 rounded-2xl space-y-1.5 hover-glow transition-all">
                      <div className="flex justify-between items-center text-[10px] font-mono font-bold text-red-850 dark:text-red-400">
                        <span>{alert.title}</span>
                        <span className="uppercase bg-red-100 dark:bg-red-950/60 px-2 py-0.5 rounded-md text-[9px]">{alertSeverityLabel(alert.severity, lang)}</span>
                      </div>
                      <p className="text-stone-700 dark:text-stone-355 text-xs leading-relaxed font-medium">{alert.message}</p>
                    </div>
                  ))
                ) : (
                  <div className="p-5 bg-emerald-50/50 dark:bg-emerald-955/10 border border-emerald-250 dark:border-emerald-900/50 text-emerald-900 dark:text-emerald-400 rounded-2xl font-bold flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span className="text-xs">{lang === 'ka' ? 'ჩაწერილ მონაცემებში აქტიური გაფრთხილება არ არის.' : 'No active alerts in the recorded cellar data.'}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 2: Weather & Mildew Station */}
        {enabledWidgets.includes('weather') && enabledModules.includes('vazi') && canViewVineyard && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-emerald-900 dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🌦️ {lang === 'ka' ? 'მეტეო პროგნოზები და რისკები' : 'Weather Station & Mildew Forecasts'}
              </h4>
              <div className="space-y-3.5">
                {weatherLoading && (
                  <div className="p-5 rounded-2xl border border-stone-200 bg-stone-50 text-xs font-medium text-stone-500">
                    {lang === 'ka' ? 'მიმდინარე ამინდის ჩატვირთვა Open-Meteo-დან…' : 'Loading current weather from Open-Meteo…'}
                  </div>
                )}

                {!weatherLoading && weatherError && (
                  <div className="p-5 rounded-2xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
                    <strong className="block font-bold">{lang === 'ka' ? 'მიმდინარე ამინდი მიუწვდომელია' : 'Current weather unavailable'}</strong>
                    <span className="mt-1 block">{weatherError}</span>
                  </div>
                )}

                {!weatherLoading && weather && (
                  <>
                    <div className="p-4 bg-stone-50/70 dark:bg-stone-950/40 border border-stone-200 dark:border-stone-800 rounded-2xl flex items-center justify-between gap-4">
                      <div>
                        <strong className="block text-stone-900 dark:text-amber-100 font-display font-extrabold text-sm">
                          {[companyProfile.municipality, companyProfile.region].filter(Boolean).join(', ') || (lang === 'ka' ? 'მამულის მდებარეობა' : 'Estate location')}
                        </strong>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                          GPS: {companyProfile.latitude?.toFixed(3)}, {companyProfile.longitude?.toFixed(3)} · Open-Meteo
                        </span>
                        <span className="block text-[11px] text-stone-600 dark:text-stone-300 mt-1">
                          {weatherSummary?.emoji} {weatherSummary?.label} · {lang === 'ka' ? 'ტენიანობა' : 'Humidity'} {weather.current?.humidity ?? '—'}%
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xl font-sans font-black text-stone-900 dark:text-amber-100">{weatherTemp.toFixed(1)} °C</span>
                        <span className="block text-[10px] text-emerald-700 font-bold uppercase tracking-wider mt-0.5">
                          {lang === 'ka' ? 'ქარი' : 'Wind'}: {(weather.current?.wind ?? weather.daily.windMax).toFixed(1)} km/h
                        </span>
                      </div>
                    </div>

                    <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
                      diseaseRisk === 'high'
                        ? 'bg-rose-50 border-rose-200 text-rose-900'
                        : diseaseRisk === 'watch'
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}>
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div>
                        <strong className="block text-xs leading-tight font-extrabold">
                          {lang === 'ka' ? 'ამინდზე დაფუძნებული დაავადების რისკი' : 'Weather-based disease risk'}: {diseaseRisk === 'high' ? (lang === 'ka' ? 'მაღალი' : 'High') : diseaseRisk === 'watch' ? (lang === 'ka' ? 'საყურადღებო' : 'Watch') : (lang === 'ka' ? 'დაბალი' : 'Low')}
                        </strong>
                        <p className="text-xs leading-relaxed mt-1 font-medium">
                          {lang === 'ka' ? 'დღეს' : 'Today'}: {weather.daily.precipSum.toFixed(1)} mm {lang === 'ka' ? 'ნალექი' : 'precipitation'}, {weather.daily.tempMin.toFixed(1)}–{weather.daily.tempMax.toFixed(1)} °C.
                          {blocks.length === 0
                            ? (lang === 'ka' ? ' დაამატეთ ვენახის ნაკვეთები ამ ამინდის სიგნალის საველე მონიტორინგთან დასაკავშირებლად.' : ' Add vineyard blocks to connect this weather signal to field scouting.')
                            : latestScouting
                              ? (lang === 'ka' ? ` ბოლო მონიტორინგის ანგარიში: ${latestScouting.problemType} (${latestScouting.severity}, ${latestScouting.date}).` : ` Latest scouting report: ${latestScouting.problemType} (${latestScouting.severity}, ${latestScouting.date}).`)
                              : (lang === 'ka' ? ' მონიტორინგის ანგარიშები ჯერ არ არის ჩაწერილი.' : ' No scouting reports have been recorded yet.')}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 3: Active Fermentations */}
        {enabledWidgets.includes('fermentation') && enabledModules.includes('gvino') && canViewCellarTab('fermentation') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🔥 {lang === 'ka' ? 'აქტიური დუღილის ჩანაწერები' : 'Active Fermentation Readings'}
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 no-scrollbar" tabIndex={0}>
                {lots.filter(l => l.stage === 'fermenting').length > 0 ? (
                  lots.filter(l => l.stage === 'fermenting').map(lot => {
                    const vessel = vessels.find(v => v.assignedLotId === lot.id);
                    const latestLog = fermLogs
                      .filter((log) => log.lotId === lot.id)
                      .sort((a, b) => b.date.localeCompare(a.date))[0];
                    return (
                      <div key={lot.id} className="p-4 bg-stone-50/50 dark:bg-stone-950/40 border border-stone-200 dark:border-stone-800 rounded-2xl flex justify-between items-center hover-glow transition-all">
                        <div>
                          <strong className="text-xs text-stone-900 dark:text-amber-100 block font-display font-extrabold">{lot.name} ({lot.variety})</strong>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-mono mt-1">{lang === 'ka' ? 'ჭურჭელი' : 'Vessel'}: {vessel ? vessel.id : (lang === 'ka' ? 'დაუნიშნავი' : 'Unassigned')} • {lang === 'ka' ? 'მოც' : 'Vol'}: {lot.currentVolume} L</span>
                        </div>
                        <div className="text-right font-mono">
                          <span className="text-sm font-black text-red-800 dark:text-red-400 block">{vessel ? `${vessel.temperature}°C` : '--'}</span>
                          <span className="text-[10px] text-slate-450 block mt-0.5">
                            {latestLog ? `${lang === 'ka' ? 'სიმკვრივე' : 'Gravity'}: ${latestLog.density} SG · ${latestLog.date}` : (lang === 'ka' ? 'დუღილის ჩანაწერი ჯერ არ არის' : 'No fermentation reading yet')}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic font-mono py-6 text-center">{lang === 'ka' ? 'სისტემაში აქტიური დუღილი არ არის ჩაწერილი.' : 'No active fermentations logged in the system.'}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 4: Canopy status radar */}
        {enabledWidgets.includes('canopy') && enabledModules.includes('vazi') && canViewVineyard && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-emerald-900 dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🌿 {lang === 'ka' ? 'ვენახის კანოპის (ფოთლის) რადარი' : 'Vineyard Canopy Status Radar'}
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 no-scrollbar" tabIndex={0}>
                {blocks.slice(0, 4).map(block => (
                  <div key={block.id} className="p-4 bg-stone-50/50 dark:bg-stone-950/40 border border-stone-200 dark:border-stone-800 rounded-2xl flex justify-between items-center hover-glow transition-all">
                    <div>
                      <strong className="text-xs text-stone-900 dark:text-amber-100 block font-display font-extrabold">{block.name} ({block.grapeVariety})</strong>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-mono mt-1">{block.area} ha • {lang === 'ka' ? 'დარგვის წელი' : 'Plant Year'}: {block.plantingYear}</span>
                    </div>
                    <span className="text-[10px] font-mono bg-emerald-50 dark:bg-emerald-955/25 text-emerald-800 dark:text-emerald-300 px-3 py-1 rounded-lg border border-emerald-150 dark:border-emerald-900 font-bold shrink-0">
                      {block.currentPhenology}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Widget 5: Combined Tasks list */}
        {enabledWidgets.includes('tasks') && canViewTasks && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                📋 {t.portal_tasklist || 'Unified Operations Tasklist Checklist'}
              </h4>
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1" tabIndex={0}>
                {pendingTasks.length > 0 ? (
                  pendingTasks.map(task => (
                    <div key={task.id} className="flex items-start gap-3 border-b border-stone-100 dark:border-stone-850 pb-3 last:border-0 font-medium">
                      <input 
                        type="checkbox" 
                        checked={task.status === 'completed'}
                        onChange={() => { if (canUpdateTasks) onToggleTaskStatus(task.id); }}
                        disabled={!canUpdateTasks}
                        title={!canUpdateTasks ? (lang === 'ka' ? 'თქვენს როლს დავალების შეცვლა არ შეუძლია' : 'Your role cannot update tasks') : undefined}
                        className="mt-1 accent-emerald-800 cursor-pointer h-4 w-4 rounded border-stone-300 shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <div className="flex-grow">
                        <span className={`block font-extrabold text-stone-900 dark:text-amber-100 text-xs ${task.status === 'completed' ? 'line-through text-stone-400 font-normal' : ''}`}>{task.title}</span>
                        <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 font-bold mt-1">
                          {t.task_assign || 'Assignee'}: {task.assignedTo || (lang === 'ka' ? 'დაუნიშნავი' : 'Unassigned')} • {t.task_due || 'Due'}: {task.dueDate} • {lang === 'ka' ? 'პრიორიტეტი' : 'Priority'}: <span className={`uppercase font-black ${task.priority === 'high' ? 'text-red-700' : task.priority === 'medium' ? 'text-amber-600' : 'text-stone-500'}`}>{task.priority === 'high' ? (t.task_high || 'High') : task.priority === 'medium' ? (t.task_med || 'Medium') : (t.task_low || 'Low')}</span>
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic font-mono py-6 text-center">{lang === 'ka' ? 'ამჟამად ოპერაციული დავალებები არ არის დაგეგმილი.' : 'No operations tasks currently scheduled.'}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Widget 6: Corporate audit logs ledger ticker */}
        {enabledWidgets.includes('audit') && canViewAppDestination(currentUser.role, 'audit') && (
          <div className="p-7 lg:p-8 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 rounded-3xl shadow-2xs space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <h4 className="font-display font-black text-sm text-[#4e0e15] dark:text-amber-100 border-b border-stone-100 dark:border-stone-800 pb-3.5 flex items-center gap-2 uppercase tracking-wider">
                🛡️ {t.portal_audit_history || 'Immutable Audit Trail Ledger History'}
              </h4>
              
              <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1 no-scrollbar" tabIndex={0}>
                {auditLogs.length > 0 ? (
                  auditLogs.slice(0, 10).map(log => (
                    <div key={log.id} className="p-4 bg-[#fdfdfb] dark:bg-stone-950/20 border border-stone-200 dark:border-stone-850 rounded-2xl space-y-1.5 hover-glow transition-all text-xs">
                      <div className="flex justify-between items-center text-[9px] text-slate-450 font-mono">
                        <span>{new Date(log.timestamp).toLocaleTimeString()} • {lang === 'ka' ? 'ოპერატორი' : 'Operator'}: {log.user}</span>
                        <span className="bg-stone-200/70 dark:bg-stone-800 text-stone-600 dark:text-stone-300 px-2 py-0.5 rounded-md uppercase font-extrabold text-[8px]">{log.module === 'VAZI' ? (t.nav_vazi || 'Vazi') : (t.nav_gvino || 'Gvino')}</span>
                      </div>
                      <strong className="block text-stone-950 dark:text-amber-100 font-display font-extrabold text-stone-900">{log.actionType}</strong>
                      <p className="text-stone-600 dark:text-stone-400 text-[11px] leading-relaxed font-semibold">{log.notes}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 italic font-mono py-6 text-center">{lang === 'ka' ? 'სისტემური ოპერაციები არ არის ჩაწერილი.' : 'No system operations logged.'}</p>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
