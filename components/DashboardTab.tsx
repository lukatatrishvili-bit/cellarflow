import React, { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Beaker,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  CloudSun,
  Container,
  FlaskConical,
  Grape,
  ListChecks,
  MapPin,
  Settings2,
  ShieldCheck,
  Sprout,
  ThermometerSun,
  Wine,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
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
  CellarOperation,
} from '../lib/wineryState';
import {
  computeSetupJourney,
  isSetupJourneyDismissed,
  setSetupJourneyDismissed,
  type SetupStep,
} from '../lib/onboarding';
import { computeAlerts, type Alert, type AlertSeverity } from '../lib/alerts';
import { isPhysicalFermentationReading } from '../lib/fermentationIntegrity';
import { localizedRoleLabel } from '../lib/roleLabels';
import { canAccess, type PermissionAction, type PermissionModule } from '../server/permissions';
import { canViewAppDestination } from '../lib/navigationPermissions';
import {
  type DayWeather,
  describeWeatherCode,
  fetchDayWeather,
  localISODate,
} from '../lib/weatherApi';
import {
  ActionButton,
  ProgressBar,
  SectionCard,
  StatusBadge,
} from './ui/primitives';

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

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  tone: 'warning' | 'danger';
  icon: LucideIcon;
  actionLabel: string;
  onOpen?: () => void;
}

interface DashboardMetric {
  id: string;
  label: string;
  value: React.ReactNode;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
  onClick?: () => void;
}

const DATE_LOCALES: Record<Language, string> = {
  en: 'en-GB',
  ka: 'ka-GE',
};

const DEFAULT_MODULES = ['vazi', 'gvino'];
const DEFAULT_WIDGETS = [
  'weather',
  'chemistry',
  'scouting',
  'fermentation',
  'notes',
  'tasks',
  'audit',
];

function formatVolume(value: number): string {
  return `${Math.round(value).toLocaleString()} L`;
}

function metricToneClasses(tone: Tone): string {
  const tones: Record<Tone, string> = {
    neutral: 'text-stone-900 dark:text-stone-100',
    brand: 'text-[#5b1320] dark:text-amber-200',
    success: 'text-emerald-700 dark:text-emerald-300',
    warning: 'text-amber-700 dark:text-amber-300',
    danger: 'text-rose-700 dark:text-rose-300',
    info: 'text-sky-700 dark:text-sky-300',
  };
  return tones[tone];
}

function alertDestination(alert: Alert): { tab: string; labelEn: string; labelKa: string } {
  switch (alert.category) {
    case 'task':
      return { tab: 'tasks', labelEn: 'Open tasks', labelKa: 'დავალებების გახსნა' };
    case 'inventory':
      return { tab: 'inventory', labelEn: 'Open inventory', labelKa: 'მარაგების გახსნა' };
    case 'so2':
    case 'va':
      return { tab: 'labs', labelEn: 'Open laboratory', labelKa: 'ლაბორატორიის გახსნა' };
    case 'cleaning':
    case 'temperature':
      return { tab: 'vessels', labelEn: 'Open vessels', labelKa: 'ჭურჭლების გახსნა' };
    default:
      return { tab: 'fermentation', labelEn: 'Open fermentation', labelKa: 'დუღილის გახსნა' };
  }
}

function MetricTile({ metric }: { metric: DashboardMetric }) {
  const Icon = metric.icon;
  const className = [
    'group min-w-0 rounded-2xl border border-[#e8dfd5] bg-white/90 p-4 text-left shadow-sm',
    'dark:border-stone-800 dark:bg-stone-900/90',
    metric.onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md' : '',
  ].join(' ');
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="min-h-7 text-[11px] font-bold leading-tight text-stone-500 dark:text-stone-400">
          {metric.label}
        </span>
        <Icon className={`h-4 w-4 shrink-0 ${metricToneClasses(metric.tone)}`} />
      </div>
      <strong className={`mt-2 block text-2xl font-black leading-none ${metricToneClasses(metric.tone)}`}>
        {metric.value}
      </strong>
      <span className="mt-1.5 block text-[11px] font-medium leading-snug text-stone-500 dark:text-stone-400">
        {metric.detail}
      </span>
    </>
  );

  return metric.onClick ? (
    <button type="button" onClick={metric.onClick} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function QueueRow({ item }: { item: AttentionItem }) {
  const Icon = item.icon;
  const isDanger = item.tone === 'danger';
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-950/30">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 rounded-xl border p-2 ${
          isDanger
            ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'
            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
        }`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <strong className="block text-sm font-bold text-stone-900 dark:text-amber-50">
            {item.title}
          </strong>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
            {item.detail}
          </span>
        </div>
      </div>
      {item.onOpen && (
        <button
          type="button"
          onClick={item.onOpen}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold text-[#5b1320] hover:bg-[#5b1320]/5 dark:text-amber-200 dark:hover:bg-amber-200/10"
        >
          {item.actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function DashboardTab({
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
  onOpenOnboarding,
}: DashboardTabProps) {
  const isKa = lang === 'ka';
  const copy = (en: string, ka: string) => (isKa ? ka : en);
  const enabledModules = currentUser.enabledModules || DEFAULT_MODULES;
  const enabledWidgets = currentUser.enabledWidgets || DEFAULT_WIDGETS;
  const canViewCellarTab = (tabId: string) => canViewAppDestination(currentUser.role, 'gvino', tabId);
  const canViewVineyard = enabledModules.includes('vazi') && canViewAppDestination(currentUser.role, 'vazi');
  const canViewCellar = enabledModules.includes('gvino') && canViewAppDestination(currentUser.role, 'gvino');
  const canViewTasks = canViewCellarTab('tasks');
  const canUpdateTasks = canAccess(currentUser.role, 'tasks', 'update');
  const canCreateFermentation = canAccess(currentUser.role, 'fermentation', 'create');
  const canCreateLab = canAccess(currentUser.role, 'lab', 'create');
  const canCreateVessel = canAccess(currentUser.role, 'vessels', 'create');
  const canCreateIntake = canAccess(currentUser.role, 'grape_intake', 'create');
  const canCreateBlock = canAccess(currentUser.role, 'vineyard', 'create');
  const canViewAudit = enabledWidgets.includes('audit') && canViewAppDestination(currentUser.role, 'audit');
  const today = localISODate();

  const go = (module: 'vazi' | 'gvino' | 'settings' | 'audit', tab?: string) => () => {
    setActiveModule(module);
    if (tab) setActiveTab(tab);
  };

  const journey = computeSetupJourney({
    companyProfile,
    blocks,
    vessels,
    lots,
    grapeIntakes,
    cellarOps,
    fermLogs,
    labLogs,
  });
  const [journeyDismissed, setJourneyDismissed] = useState(isSetupJourneyDismissed);
  const roleJourneySteps = journey.steps.filter((step) => {
    if (step.module === 'vazi' && !canViewVineyard) return false;
    if (step.module === 'gvino' && !canViewCellar) return false;
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
  const goToStep = (step: SetupStep) => {
    const [permissionModule, action] = SETUP_STEP_PERMISSIONS[step.id];
    if (!canAccess(currentUser.role, permissionModule, action)) return;
    setActiveModule(step.module);
    if (step.tab) setActiveTab(step.tab);
  };

  const totalArea = blocks.reduce((sum, block) => sum + block.area, 0);
  const totalCapacity = vessels.reduce((sum, vessel) => sum + vessel.capacity, 0);
  const usedCapacity = vessels.reduce((sum, vessel) => sum + vessel.currentVolume, 0);
  const capacityPct = totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0;
  const totalWineVolume = lots.reduce((sum, lot) => sum + lot.currentVolume, 0);
  const activeFerments = lots.filter((lot) => lot.stage === 'fermenting');
  const pendingTasks = tasks
    .filter((task) => task.status !== 'completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueTasks = pendingTasks.filter((task) => task.dueDate < today);
  const fermentsMissingReading = activeFerments.filter(
    (lot) => !fermLogs.some((log) => (
      log.lotId === lot.id && log.date === today && isPhysicalFermentationReading(log)
    )),
  );
  const unassignedLots = lots.filter(
    (lot) => lot.currentVolume > 0 && !vessels.some((vessel) => vessel.assignedLotId === lot.id),
  );
  const highRiskScoutings = scoutings.filter((record) => record.severity === 'high');
  const latestHighRiskScouting = [...highRiskScoutings].sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestAuditLogs = [...auditLogs]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5);

  const derivedAlerts = useMemo(() => computeAlerts({
    vessels,
    lots,
    fermLogs,
    labLogs,
    inventory,
    tasks,
    today,
    lang,
  }), [vessels, lots, fermLogs, labLogs, inventory, tasks, today, lang]);
  const visibleAlerts = derivedAlerts.filter((alert) => (
    canViewCellarTab(alertDestination(alert).tab)
  ));
  const criticalAlerts = visibleAlerts.filter((alert) => alert.severity === 'critical');

  const [weather, setWeather] = useState<DayWeather | null>(null);
  const [weatherError, setWeatherError] = useState('');
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    const latitude = companyProfile.latitude;
    const longitude = companyProfile.longitude;
    const shouldLoadWeather = enabledWidgets.includes('weather') && canViewVineyard;
    if (!shouldLoadWeather || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setWeather(null);
      setWeatherError('');
      setWeatherLoading(false);
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
          setWeatherError(error instanceof Error ? error.message : (isKa ? 'ამინდი მიუწვდომელია.' : 'Weather is unavailable.'));
        }
      })
      .finally(() => {
        if (active) setWeatherLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    companyProfile.latitude,
    companyProfile.longitude,
    today,
    lang,
    isKa,
    canViewVineyard,
    enabledWidgets,
  ]);

  const weatherSummary = weather
    ? describeWeatherCode(weather.current?.code ?? weather.daily.code, lang)
    : null;
  const weatherHumidity = weather?.current?.humidity ?? 0;
  const weatherTemp = weather?.current?.temp
    ?? ((weather?.daily.tempMax ?? 0) + (weather?.daily.tempMin ?? 0)) / 2;
  const diseaseRisk = weather
    ? weather.daily.precipSum >= 5 || (weatherHumidity >= 85 && weatherTemp >= 10 && weatherTemp <= 28)
      ? 'high'
      : weather.daily.precipSum > 0 || weatherHumidity >= 75
        ? 'watch'
        : 'low'
    : null;

  const openCellarAlert = (alert: Alert) => {
    const destination = alertDestination(alert);
    return go('gvino', destination.tab);
  };
  const alertTone = (severity: AlertSeverity): AttentionItem['tone'] => (
    severity === 'critical' ? 'danger' : 'warning'
  );

  const attentionItems: AttentionItem[] = [
    ...visibleAlerts.slice(0, 4).map((alert) => {
      const destination = alertDestination(alert);
      return {
        id: alert.id,
        title: alert.title,
        detail: alert.message,
        tone: alertTone(alert.severity),
        icon: alert.severity === 'critical' ? AlertTriangle : ShieldCheck,
        actionLabel: isKa ? destination.labelKa : destination.labelEn,
        onOpen: canViewCellar ? openCellarAlert(alert) : undefined,
      };
    }),
    ...(fermentsMissingReading.length > 0 && canViewCellarTab('fermentation') ? [{
      id: 'missing-fermentation-reading',
      title: copy(
        `${fermentsMissingReading.length} fermentation ${fermentsMissingReading.length === 1 ? 'reading is' : 'readings are'} missing`,
        `${fermentsMissingReading.length} დუღილის ჩანაწერია შესავსები`,
      ),
      detail: copy(
        'Record today’s density and temperature before the shift ends.',
        'ცვლის დასრულებამდე ჩაწერეთ დღევანდელი სიმკვრივე და ტემპერატურა.',
      ),
      tone: 'warning' as const,
      icon: ThermometerSun,
      actionLabel: copy('Log readings', 'ჩანაწერების დამატება'),
      onOpen: go('gvino', 'fermentation'),
    }] : []),
    ...(highRiskScoutings.length > 0 && canViewVineyard ? [{
      id: 'high-risk-scouting',
      title: copy(
        `${highRiskScoutings.length} high-risk vineyard ${highRiskScoutings.length === 1 ? 'report' : 'reports'}`,
        `${highRiskScoutings.length} მაღალი რისკის საველე ანგარიში`,
      ),
      detail: latestHighRiskScouting
        ? copy(
            `Latest: ${latestHighRiskScouting.problemType} on ${latestHighRiskScouting.date}.`,
            `ბოლო: ${latestHighRiskScouting.problemType}, ${latestHighRiskScouting.date}.`,
          )
        : copy('Review vineyard scouting records.', 'გადახედეთ ვენახის მონიტორინგის ჩანაწერებს.'),
      tone: 'warning' as const,
      icon: Sprout,
      actionLabel: copy('Open vineyard', 'ვენახის გახსნა'),
      onOpen: go('vazi'),
    }] : []),
    ...(diseaseRisk === 'high' && canViewVineyard ? [{
      id: 'weather-disease-risk',
      title: copy('High vineyard disease pressure forecast', 'ვენახში დაავადების მაღალი რისკია'),
      detail: weather
        ? copy(
            `${weather.daily.precipSum.toFixed(1)} mm rain and ${weatherHumidity}% humidity are forecast today.`,
            `დღეს მოსალოდნელია ${weather.daily.precipSum.toFixed(1)} მმ ნალექი და ${weatherHumidity}% ტენიანობა.`,
          )
        : copy('Review field conditions before starting vineyard work.', 'საველე სამუშაომდე შეამოწმეთ ვენახის პირობები.'),
      tone: 'warning' as const,
      icon: CloudSun,
      actionLabel: copy('Open vineyard', 'ვენახის გახსნა'),
      onOpen: go('vazi'),
    }] : []),
    ...(unassignedLots.length > 0 && canViewCellarTab('lots') ? [{
      id: 'unassigned-lots',
      title: copy(
        `${unassignedLots.length} wine ${unassignedLots.length === 1 ? 'lot needs' : 'lots need'} a vessel`,
        `${unassignedLots.length} ღვინის პარტიას სჭირდება ჭურჭელი`,
      ),
      detail: copy(
        'Assign active liquid to a vessel to keep cellar traceability complete.',
        'მარნის სრული მიკვლევადობისთვის აქტიური ღვინო მიაბით ჭურჭელს.',
      ),
      tone: 'warning' as const,
      icon: Container,
      actionLabel: copy('Open lots', 'პარტიების გახსნა'),
      onOpen: go('gvino', 'lots'),
    }] : []),
  ].slice(0, 6);

  const attentionCount = visibleAlerts.length
    + fermentsMissingReading.length
    + highRiskScoutings.length
    + (diseaseRisk === 'high' && canViewVineyard ? 1 : 0)
    + unassignedLots.length;
  const estateName = companyProfile.wineryName
    || companyProfile.companyName
    || currentUser.fullName
    || copy('Your estate', 'თქვენი მეურნეობა');
  const estateLocation = [companyProfile.municipality, companyProfile.region, companyProfile.country]
    .filter(Boolean)
    .join(', ') || copy('Location not configured', 'მდებარეობა არ არის მითითებული');
  const readableToday = new Intl.DateTimeFormat(DATE_LOCALES[lang], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${today}T12:00:00`));

  const defaultPrimaryMetrics: DashboardMetric[] = [
    {
      id: 'attention',
      label: copy('Needs attention', 'საჭიროებს ყურადღებას'),
      value: attentionCount,
      detail: attentionCount
        ? copy(`${criticalAlerts.length} critical`, `${criticalAlerts.length} კრიტიკული`)
        : copy('Everything is clear', 'ყველაფერი წესრიგშია'),
      icon: attentionCount ? AlertTriangle : CheckCircle2,
      tone: (criticalAlerts.length ? 'danger' : attentionCount ? 'warning' : 'success') as Tone,
    },
    ...(canViewTasks ? [{
      id: 'tasks',
      label: copy('Open tasks', 'ღია დავალებები'),
      value: pendingTasks.length,
      detail: overdueTasks.length
        ? copy(`${overdueTasks.length} overdue`, `${overdueTasks.length} ვადაგადაცილებული`)
        : copy('No overdue work', 'ვადაგადაცილებული არ არის'),
      icon: ClipboardList,
      tone: overdueTasks.length ? 'danger' as const : 'neutral' as const,
      onClick: go('gvino', 'tasks'),
    }] : []),
    ...(canViewCellar && (lots.length > 0 || fermLogs.length > 0) ? [{
      id: 'ferments',
      label: copy('Active fermentations', 'აქტიური დუღილი'),
      value: activeFerments.length,
      detail: fermentsMissingReading.length
        ? copy(`${fermentsMissingReading.length} need readings`, `${fermentsMissingReading.length} საჭიროებს ჩანაწერს`)
        : copy('Readings up to date', 'ჩანაწერები განახლებულია'),
      icon: Activity,
      tone: fermentsMissingReading.length ? 'warning' as const : 'brand' as const,
      onClick: canViewCellarTab('fermentation') ? go('gvino', 'fermentation') : undefined,
    }] : []),
    ...(canViewCellar && vessels.length > 0 ? [{
      id: 'capacity',
      label: copy('Cellar capacity', 'მარნის ტევადობა'),
      value: `${capacityPct}%`,
      detail: totalCapacity
        ? copy(`${formatVolume(usedCapacity)} of ${formatVolume(totalCapacity)}`, `${formatVolume(usedCapacity)} / ${formatVolume(totalCapacity)}`)
        : copy('No vessels registered', 'ჭურჭელი არ არის რეგისტრირებული'),
      icon: Container,
      tone: capacityPct > 85 ? 'warning' as const : 'info' as const,
      onClick: canViewCellarTab('vessels') ? go('gvino', 'vessels') : undefined,
    }] : []),
  ].slice(0, 4);

  const vineyardMetricSummary = diseaseRisk === 'high'
    ? copy('High weather risk', 'ამინდის მაღალი რისკი')
    : diseaseRisk === 'watch'
      ? copy('Weather watch', 'ამინდის დაკვირვება')
      : diseaseRisk === 'low'
        ? copy('Low weather risk', 'ამინდის დაბალი რისკი')
        : copy('Weather pending', 'ამინდი იტვირთება');

  const attentionMetric = defaultPrimaryMetrics[0];
  const taskMetric = defaultPrimaryMetrics.find((metric) => metric.id === 'tasks');
  const vineyardRiskCount = highRiskScoutings.length + (diseaseRisk === 'high' ? 1 : 0);
  const grapeVarietyCount = new Set(
    blocks.map((block) => block.grapeVariety).filter(Boolean),
  ).size;
  const labAlertCount = visibleAlerts.filter(
    (alert) => alert.category === 'so2' || alert.category === 'va',
  ).length;
  const analysedLotsCount = new Set(labLogs.map((log) => log.lotId)).size;
  const latestLabAnalysis = [...labLogs]
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const latestLabLot = latestLabAnalysis
    ? lots.find((lot) => lot.id === latestLabAnalysis.lotId)
    : undefined;
  const latestScouting = [...scoutings]
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const phenologyCounts = blocks.reduce<Record<string, number>>((counts, block) => {
    const stage = block.currentPhenology?.trim();
    if (stage) counts[stage] = (counts[stage] || 0) + 1;
    return counts;
  }, {});
  const dominantPhenology = Object.entries(phenologyCounts)
    .sort(([, countA], [, countB]) => countB - countA)[0]?.[0];
  const nextHarvestBlock = [...blocks]
    .filter((block) => block.estimatedHarvestDate)
    .sort((a, b) => a.estimatedHarvestDate.localeCompare(b.estimatedHarvestDate))[0];

  const vineyardPrimaryMetrics: DashboardMetric[] = [
    attentionMetric,
    {
      id: 'vineyard-blocks',
      label: copy('Vineyard blocks', 'ვენახის ბლოკები'),
      value: blocks.length,
      detail: blocks.length
        ? copy(
            `${grapeVarietyCount} ${grapeVarietyCount === 1 ? 'variety' : 'varieties'} in rotation`,
            `${grapeVarietyCount} ჯიში ბრუნვაში`,
          )
        : copy('Add the first vineyard block', 'დაამატეთ პირველი ვენახის ბლოკი'),
      icon: Sprout,
      tone: blocks.length ? 'brand' : 'neutral',
      onClick: go('vazi'),
    },
    {
      id: 'vineyard-area',
      label: copy('Vineyard area', 'ვენახის ფართობი'),
      value: `${totalArea.toLocaleString(DATE_LOCALES[lang], { maximumFractionDigits: 1 })} ha`,
      detail: blocks.length
        ? copy('Across registered blocks', 'რეგისტრირებულ ბლოკებში')
        : copy('No area registered yet', 'ფართობი ჯერ არ არის რეგისტრირებული'),
      icon: MapPin,
      tone: 'info',
      onClick: go('vazi'),
    },
    {
      id: 'vineyard-risk',
      label: copy('Field & weather risk', 'საველე და ამინდის რისკი'),
      value: vineyardRiskCount,
      detail: vineyardMetricSummary,
      icon: CloudSun,
      tone: diseaseRisk === 'high'
        ? 'danger'
        : vineyardRiskCount
          ? 'warning'
          : 'success',
      onClick: go('vazi'),
    },
  ];

  const labPrimaryMetrics: DashboardMetric[] = [
    attentionMetric,
    {
      id: 'lab-alerts',
      label: copy('Chemistry alerts', 'ქიმიის გაფრთხილებები'),
      value: labAlertCount,
      detail: labAlertCount
        ? copy('Results need review', 'შედეგები გადასახედია')
        : copy('Recorded results are in range', 'ჩაწერილი შედეგები ნორმაშია'),
      icon: Beaker,
      tone: labAlertCount ? 'danger' : 'success',
      onClick: go('gvino', 'labs'),
    },
    {
      id: 'lab-analyses',
      label: copy('Lab analyses', 'ლაბორატორიული ანალიზები'),
      value: labLogs.length,
      detail: analysedLotsCount
        ? copy(
            `${analysedLotsCount} ${analysedLotsCount === 1 ? 'lot' : 'lots'} tested`,
            `${analysedLotsCount} პარტია შემოწმებულია`,
          )
        : copy('No results recorded yet', 'შედეგები ჯერ არ არის ჩაწერილი'),
      icon: FlaskConical,
      tone: 'info',
      onClick: go('gvino', 'labs'),
    },
    ...(taskMetric ? [taskMetric] : []),
  ];

  const primaryMetrics = currentUser.role === 'Viticulturist' && canViewVineyard
    ? vineyardPrimaryMetrics
    : currentUser.role === 'Lab Technician' && canViewCellarTab('labs')
      ? labPrimaryMetrics
      : defaultPrimaryMetrics;
  const hasVineyardData = blocks.length > 0
    || scoutings.length > 0;
  const hasLabData = labLogs.length > 0 || labAlertCount > 0;
  const hasCellarData = lots.length > 0
    || vessels.length > 0
    || fermLogs.length > 0
    || grapeIntakes.length > 0
    || cellarOps.length > 0;
  const hasRoleOperationalData = currentUser.role === 'Viticulturist'
    ? hasVineyardData
    : currentUser.role === 'Lab Technician'
      ? hasLabData
      : hasCellarData || (canViewVineyard && hasVineyardData);
  const showDashboardMetrics = hasRoleOperationalData
    || attentionItems.length > 0
    || pendingTasks.length > 0;
  const showPriorityQueue = showDashboardMetrics;
  const isFreshWorkspace = !hasRoleOperationalData
    && attentionItems.length === 0
    && pendingTasks.length === 0
    && latestAuditLogs.length === 0;
  const showLabPulse = currentUser.role === 'Lab Technician'
    && canViewCellarTab('labs')
    && hasLabData;
  const showCellarPulse = canViewCellar
    && currentUser.role !== 'Viticulturist'
    && currentUser.role !== 'Lab Technician'
    && (lots.length > 0 || vessels.length > 0);
  const showVineyardPulse = canViewVineyard && blocks.length > 0;
  const pulseColumnCount = Number(showLabPulse) + Number(showCellarPulse) + Number(showVineyardPulse);
  const queueSubtitle = currentUser.role === 'Viticulturist'
    ? copy(
        'Field risk, weather pressure, and overdue work first.',
        'ჯერ საველე რისკი, ამინდის წნეხი და ვადაგადაცილებული სამუშაო.',
      )
    : currentUser.role === 'Lab Technician'
      ? copy(
          'Chemistry exceptions and overdue lab work first.',
          'ჯერ ქიმიის გამონაკლისები და ვადაგადაცილებული ლაბორატორიული სამუშაო.',
        )
      : copy(
          'Critical risks, missing readings, and overdue work first.',
          'ჯერ კრიტიკული რისკები, გამოტოვებული ჩანაწერები და ვადაგადაცილებული სამუშაო.',
        );
  const clearQueueDetail = currentUser.role === 'Viticulturist'
    ? copy(
        'Field reports, weather pressure, and assigned work are clear.',
        'საველე ანგარიშები, ამინდის წნეხი და დავალებები წესრიგშია.',
      )
    : currentUser.role === 'Lab Technician'
      ? copy(
          'Chemistry results and assigned lab work are clear.',
          'ქიმიის შედეგები და ლაბორატორიული დავალებები წესრიგშია.',
        )
      : copy(
          'Alerts, readings, assignments, and vineyard risk are clear for the recorded data.',
          'ჩაწერილი მონაცემებით გაფრთხილებები, ჩანაწერები, დავალებები და ვენახის რისკები წესრიგშია.',
        );

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 animate-fade-in flex-col gap-5 p-4 text-stone-900 dark:text-stone-200 lg:p-6 xl:p-8">
      <header className="rounded-3xl border border-[#e8dfd5] bg-white/92 p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900/92 lg:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-stone-500 dark:text-stone-400">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-[#5b1320] dark:text-amber-300" />
                {readableToday}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {estateLocation}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-stone-950 dark:text-amber-50 sm:text-3xl">
              {copy('Today at', 'დღეს —')} {estateName}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-stone-500 dark:text-stone-400">
              {attentionCount
                ? copy(
                    'Start with the few items that can change today’s work.',
                    'დაიწყეთ იმ საკითხებით, რომლებიც დღევანდელ სამუშაოს ცვლის.',
                  )
                : isFreshWorkspace
                  ? roleJourney.total > 0
                    ? copy(
                        'Complete the next setup step to bring your live operation into view.',
                        'ცოცხალი ოპერაციის სანახავად დაასრულეთ გამართვის შემდეგი ნაბიჯი.',
                      )
                    : copy(
                        'No operational records are available for this workspace yet.',
                        'ამ სამუშაო სივრცეში ოპერაციული ჩანაწერები ჯერ არ არის.',
                      )
                : copy(
                    'No urgent signals. The recorded operation is steady.',
                    'გადაუდებელი სიგნალები არ არის. აღრიცხული ოპერაცია სტაბილურია.',
                  )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-xs font-semibold text-stone-600 dark:border-stone-800 dark:bg-stone-950/40 dark:text-stone-300">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              {localizedRoleLabel(currentUser.role, lang)}
            </span>
            <button
              type="button"
              onClick={onOpenOnboarding}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 text-xs font-bold text-stone-700 transition hover:border-[#5b1320]/30 hover:text-[#5b1320] dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200 dark:hover:text-amber-200"
            >
              <Settings2 className="h-4 w-4" />
              {copy('Personalize', 'მორგება')}
            </button>
          </div>
        </div>
      </header>

      {roleJourney.total > 0 && !roleJourney.complete && !journeyDismissed && roleJourney.nextStep && (
        <section
          aria-label="Winery setup journey"
          className="rounded-2xl border border-[#c5a059]/35 bg-[#fffaf0] p-4 dark:border-amber-900/60 dark:bg-amber-950/15"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold text-[#73591f] dark:text-amber-300">
                  {copy('Setup progress', 'საწყისი გამართვა')} · {roleJourney.done}/{roleJourney.total}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSetupJourneyDismissed(true);
                    setJourneyDismissed(true);
                  }}
                  className="text-[11px] font-semibold text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                >
                  {copy('Hide', 'დამალვა')}
                </button>
              </div>
              <div className="mt-2">
                <ProgressBar value={roleJourney.pct} tone="warning" />
              </div>
            </div>
            <button
              type="button"
              onClick={() => goToStep(roleJourney.nextStep as SetupStep)}
              className="flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-xl border border-[#c5a059]/45 bg-white px-4 text-left transition hover:border-[#8a6425] dark:bg-stone-900"
            >
              <span className="min-w-0">
                <strong className="block truncate text-xs font-bold text-stone-900 dark:text-amber-50">
                  {isKa ? roleJourney.nextStep.ka : roleJourney.nextStep.en}
                </strong>
                <span className="mt-0.5 block truncate text-[11px] text-stone-500 dark:text-stone-400">
                  {isKa ? roleJourney.nextStep.kaHint : roleJourney.nextStep.enHint}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[#8a6425]" />
            </button>
          </div>
        </section>
      )}

      {roleJourney.total > 0 && !roleJourney.complete && journeyDismissed && (
        <button
          type="button"
          onClick={() => {
            setSetupJourneyDismissed(false);
            setJourneyDismissed(false);
          }}
          className="self-start text-xs font-bold text-[#7a5c1e] hover:text-[#4e0e15] dark:text-amber-300"
        >
          {copy(`Resume setup · ${roleJourney.done}/${roleJourney.total}`, `გამართვის გაგრძელება · ${roleJourney.done}/${roleJourney.total}`)}
        </button>
      )}

      {showDashboardMetrics && (
        <section
          aria-label={copy('Today metrics', 'დღევანდელი მაჩვენებლები')}
          className={`grid grid-cols-2 gap-3 ${
            primaryMetrics.length === 3
              ? 'lg:grid-cols-3'
              : primaryMetrics.length >= 4
                ? 'xl:grid-cols-4'
                : ''
          }`}
        >
          {primaryMetrics.map((metric) => <MetricTile key={metric.id} metric={metric} />)}
        </section>
      )}

      <div className={`grid grid-cols-1 gap-5 ${
        showPriorityQueue ? 'xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]' : ''
      }`}>
        {showPriorityQueue && (
          <SectionCard
          title={copy('Today’s priority queue', 'დღევანდელი პრიორიტეტები')}
          subtitle={queueSubtitle}
          icon={ListChecks}
          actions={(
            <StatusBadge tone={criticalAlerts.length ? 'danger' : attentionItems.length ? 'warning' : 'success'}>
              {attentionItems.length
                ? copy(`${attentionItems.length} open`, `${attentionItems.length} ღია`)
                : copy('clear', 'წესრიგშია')}
            </StatusBadge>
          )}
        >
          {attentionItems.length ? (
            <div className="space-y-2.5">
              {attentionItems.map((item) => <QueueRow key={item.id} item={item} />)}
            </div>
          ) : (
            <div className="flex min-h-36 items-center gap-4 rounded-2xl bg-emerald-50/70 p-5 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">
              <span className="rounded-2xl bg-white p-3 text-emerald-600 shadow-sm dark:bg-stone-900">
                <CheckCircle2 className="h-6 w-6" />
              </span>
              <div>
                <strong className="block text-sm font-bold">
                  {copy('No urgent work right now', 'ამჟამად გადაუდებელი სამუშაო არ არის')}
                </strong>
                <p className="mt-1 text-xs leading-relaxed opacity-80">
                  {clearQueueDetail}
                </p>
              </div>
            </div>
          )}
          </SectionCard>
        )}

        <SectionCard
          title={isFreshWorkspace
            ? copy('Start here', 'დაიწყეთ აქ')
            : copy('Quick actions', 'სწრაფი მოქმედებები')}
          subtitle={isFreshWorkspace
            ? copy('Open the workspace where your first record belongs.', 'გახსენით სივრცე, სადაც პირველი ჩანაწერი უნდა შეიქმნას.')
            : copy('Start the most common shift work.', 'დაიწყეთ ცვლის ყველაზე ხშირი სამუშაო.')}
          icon={ClipboardCheck}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {currentUser.role === 'Viticulturist'
              && canViewVineyard
              && !(isFreshWorkspace && roleJourney.nextStep?.id === 'block') && (
              <ActionButton onClick={go('vazi')} className="min-h-11 justify-between normal-case tracking-normal">
                <span className="inline-flex items-center gap-2"><Sprout className="h-4 w-4" />{copy('Open vineyard', 'ვენახის გახსნა')}</span>
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            )}
            {canCreateFermentation && (
              <ActionButton onClick={go('gvino', 'fermentation')} className="min-h-11 justify-between normal-case tracking-normal">
                <span className="inline-flex items-center gap-2"><Activity className="h-4 w-4" />{copy('Log fermentation', 'დუღილის ჩანაწერი')}</span>
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            )}
            {canCreateLab && !(isFreshWorkspace && roleJourney.nextStep?.id === 'lab') && (
              <ActionButton tone="secondary" onClick={go('gvino', 'labs')} className="min-h-11 justify-between normal-case tracking-normal">
                <span className="inline-flex items-center gap-2"><Beaker className="h-4 w-4" />{copy('Add lab result', 'ლაბორატორიული შედეგი')}</span>
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            )}
            {canCreateIntake && (
              <ActionButton tone="secondary" onClick={go('gvino', 'intake')} className="min-h-11 justify-between normal-case tracking-normal">
                <span className="inline-flex items-center gap-2"><Grape className="h-4 w-4" />{copy('Receive grapes', 'ყურძნის მიღება')}</span>
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            )}
            {canViewTasks && (
              <ActionButton tone="secondary" onClick={go('gvino', 'tasks')} className="min-h-11 justify-between normal-case tracking-normal">
                <span className="inline-flex items-center gap-2"><ClipboardList className="h-4 w-4" />{copy('Review tasks', 'დავალებების ნახვა')}</span>
                <ArrowRight className="h-4 w-4" />
              </ActionButton>
            )}
            {!canCreateFermentation
              && !canCreateLab
              && !canCreateIntake
              && !canViewTasks
              && !(currentUser.role === 'Viticulturist' && canViewVineyard) && (
              <p className="rounded-xl bg-stone-50 p-4 text-xs text-stone-500 dark:bg-stone-950/30 dark:text-stone-400">
                {copy('No quick actions are available for this role.', 'ამ როლისთვის სწრაფი მოქმედებები ხელმისაწვდომი არ არის.')}
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      {(showLabPulse || showCellarPulse || showVineyardPulse) && (
        <section aria-label={copy('Operational pulse', 'ოპერაციული მდგომარეობა')} className={`grid grid-cols-1 gap-5 ${pulseColumnCount > 1 ? 'xl:grid-cols-2' : ''}`}>
          {showLabPulse && (
            <SectionCard
              title={copy('Laboratory pulse', 'ლაბორატორიის მდგომარეობა')}
              subtitle={latestLabAnalysis
                ? copy(
                    `Latest result recorded on ${latestLabAnalysis.date}.`,
                    `ბოლო შედეგი ჩაწერილია ${latestLabAnalysis.date}.`,
                  )
                : copy('Chemistry workload and recent analysis coverage.', 'ქიმიის სამუშაო და ბოლო ანალიზების დაფარვა.')}
              icon={FlaskConical}
              actions={(
                <button
                  type="button"
                  onClick={go('gvino', 'labs')}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-800 hover:underline dark:text-sky-300"
                >
                  {copy('Open laboratory', 'ლაბორატორიის გახსნა')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            >
              {labLogs.length === 0 && labAlertCount === 0 ? (
                <div className="flex flex-col gap-4 rounded-2xl bg-stone-50 p-4 dark:bg-stone-950/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-white p-2.5 text-sky-700 shadow-sm dark:bg-stone-900 dark:text-sky-300">
                      <FlaskConical className="h-5 w-5" />
                    </span>
                    <div>
                      <strong className="block text-sm font-bold text-stone-800 dark:text-stone-100">
                        {copy('No analyses recorded yet', 'ანალიზები ჯერ არ არის ჩაწერილი')}
                      </strong>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        {copy('Record the first result to start chemistry trend tracking.', 'ქიმიის ტენდენციების დასაწყებად ჩაწერეთ პირველი შედეგი.')}
                      </p>
                    </div>
                  </div>
                  {canCreateLab && (
                    <button
                      type="button"
                      onClick={go('gvino', 'labs')}
                      className="min-h-10 shrink-0 rounded-xl bg-sky-800 px-4 text-xs font-bold text-white"
                    >
                      {copy('Add result', 'შედეგის დამატება')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{copy('Latest lot', 'ბოლო პარტია')}</span>
                    <strong className="mt-1 block truncate text-sm font-black text-stone-900 dark:text-amber-50">
                      {latestLabLot?.name || latestLabAnalysis?.lotId || '—'}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">pH</span>
                    <strong className="mt-1 block text-lg font-black text-stone-900 dark:text-amber-50">
                      {typeof latestLabAnalysis?.ph === 'number' ? latestLabAnalysis.ph.toFixed(2) : '—'}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{copy('Free SO₂', 'თავისუფალი SO₂')}</span>
                    <strong className="mt-1 block text-lg font-black text-stone-900 dark:text-amber-50">
                      {typeof latestLabAnalysis?.freeSo2 === 'number' ? `${latestLabAnalysis.freeSo2} mg/L` : '—'}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{copy('Volatile acidity', 'აქროლადი მჟავიანობა')}</span>
                    <strong className="mt-1 block text-lg font-black text-stone-900 dark:text-amber-50">
                      {typeof latestLabAnalysis?.volatileAcid === 'number' ? `${latestLabAnalysis.volatileAcid.toFixed(2)} g/L` : '—'}
                    </strong>
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          {showCellarPulse && (
            <SectionCard
              title={copy('Cellar pulse', 'მარნის მდგომარეობა')}
              subtitle={copy('Live production, capacity, and chemistry.', 'წარმოება, ტევადობა და ქიმია ერთ ხედში.')}
              icon={Wine}
              actions={(
                <button
                  type="button"
                  onClick={go('gvino', 'dashboard')}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5b1320] hover:underline dark:text-amber-200"
                >
                  {copy('Open overview', 'მიმოხილვის გახსნა')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            >
              {vessels.length === 0 && lots.length === 0 ? (
                <div className="flex flex-col gap-4 rounded-2xl bg-stone-50 p-4 dark:bg-stone-950/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-white p-2.5 text-stone-400 shadow-sm dark:bg-stone-900">
                      <Container className="h-5 w-5" />
                    </span>
                    <div>
                      <strong className="block text-sm font-bold text-stone-800 dark:text-stone-100">
                        {copy('Your cellar is ready to configure', 'მარანი მზადაა გასამართად')}
                      </strong>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        {copy('Register the first vessel to start capacity and batch tracking.', 'ტევადობისა და პარტიების აღრიცხვისთვის დაამატეთ პირველი ჭურჭელი.')}
                      </p>
                    </div>
                  </div>
                  {canCreateVessel && (
                    <button
                      type="button"
                      onClick={go('gvino', 'vessels')}
                      className="min-h-10 shrink-0 rounded-xl bg-[#5b1320] px-4 text-xs font-bold text-white"
                    >
                      {copy('Register vessel', 'ჭურჭლის დამატება')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      [copy('Wine volume', 'ღვინის მოცულობა'), formatVolume(totalWineVolume)],
                      [copy('Active lots', 'აქტიური პარტიები'), lots.length],
                      [copy('Fermenting', 'დუღილშია'), activeFerments.length],
                      [copy('Open lab alerts', 'ლაბ. გაფრთხილებები'), labAlertCount],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                        <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{label}</span>
                        <strong className="mt-1 block text-lg font-black text-stone-900 dark:text-amber-50">{value}</strong>
                      </div>
                    ))}
                  </div>
                  <ProgressBar
                    value={capacityPct}
                    tone={capacityPct > 85 ? 'warning' : 'brand'}
                    label={copy('Capacity used', 'გამოყენებული ტევადობა')}
                  />
                </div>
              )}
            </SectionCard>
          )}

          {showVineyardPulse && (
            <SectionCard
              title={copy('Vineyard pulse', 'ვენახის მდგომარეობა')}
              subtitle={copy('Current field context beyond the headline metrics.', 'მიმდინარე საველე კონტექსტი ძირითადი მაჩვენებლების მიღმა.')}
              icon={Sprout}
              actions={(
                <button
                  type="button"
                  onClick={go('vazi')}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:underline dark:text-emerald-300"
                >
                  {copy('Open vineyard', 'ვენახის გახსნა')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            >
              {blocks.length === 0 ? (
                <div className="flex flex-col gap-4 rounded-2xl bg-stone-50 p-4 dark:bg-stone-950/30 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="rounded-xl bg-white p-2.5 text-emerald-700 shadow-sm dark:bg-stone-900 dark:text-emerald-300">
                      <Sprout className="h-5 w-5" />
                    </span>
                    <div>
                      <strong className="block text-sm font-bold text-stone-800 dark:text-stone-100">
                        {copy('Add the first vineyard block', 'დაამატეთ პირველი ვენახის ნაკვეთი')}
                      </strong>
                      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        {copy('Blocks connect field work, weather, harvest, and traceability.', 'ნაკვეთები აერთიანებს საველე სამუშაოს, ამინდს, რთველსა და მიკვლევადობას.')}
                      </p>
                    </div>
                  </div>
                  {canCreateBlock && (
                    <button
                      type="button"
                      onClick={go('vazi')}
                      className="min-h-10 shrink-0 rounded-xl bg-emerald-800 px-4 text-xs font-bold text-white"
                    >
                      {copy('Add block', 'ნაკვეთის დამატება')}
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{copy('Current stage', 'მიმდინარე ფაზა')}</span>
                    <strong className="mt-1 block truncate text-sm font-black text-stone-900 dark:text-amber-50">
                      {dominantPhenology || copy('Not recorded', 'არ არის ჩაწერილი')}
                    </strong>
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{copy('Next harvest', 'შემდეგი რთველი')}</span>
                    <strong className="mt-1 block truncate text-sm font-black text-stone-900 dark:text-amber-50">
                      {nextHarvestBlock?.name || copy('Not scheduled', 'არ არის დაგეგმილი')}
                    </strong>
                    {nextHarvestBlock?.estimatedHarvestDate && (
                      <span className="mt-1 block truncate text-[10px] text-stone-500 dark:text-stone-400">
                        {nextHarvestBlock.estimatedHarvestDate}
                      </span>
                    )}
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="block text-[10px] font-bold text-stone-500 dark:text-stone-400">{copy('Last scouting', 'ბოლო მონიტორინგი')}</span>
                    <strong className={`mt-1 block truncate text-sm font-black ${latestScouting?.severity === 'high' ? 'text-rose-700' : 'text-stone-900 dark:text-amber-50'}`}>
                      {latestScouting?.problemType || copy('No reports', 'ანგარიშები არ არის')}
                    </strong>
                    {latestScouting?.date && (
                      <span className="mt-1 block truncate text-[10px] text-stone-500 dark:text-stone-400">{latestScouting.date}</span>
                    )}
                  </div>
                  <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/30">
                    <span className="flex items-center gap-1 text-[10px] font-bold text-stone-500 dark:text-stone-400">
                      <CloudSun className="h-3 w-3" /> {copy('Weather', 'ამინდი')}
                    </span>
                    <strong className={`mt-1 block truncate text-sm font-black ${
                      diseaseRisk === 'high'
                        ? 'text-rose-700'
                        : diseaseRisk === 'watch'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                    }`}>
                      {weatherLoading
                        ? copy('Loading', 'იტვირთება')
                        : weatherError
                          ? copy('Unavailable', 'მიუწვდომელია')
                          : weather
                            ? `${Math.round(weatherTemp)}°C · ${weatherSummary?.label || vineyardMetricSummary}`
                            : vineyardMetricSummary}
                    </strong>
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </section>
      )}

      {((canViewTasks && pendingTasks.length > 0) || (canViewAudit && latestAuditLogs.length > 0)) && (
        <div className={`grid grid-cols-1 gap-5 ${
          canViewTasks && pendingTasks.length > 0 && canViewAudit && latestAuditLogs.length > 0
            ? 'xl:grid-cols-2'
            : ''
        }`}>
          {canViewTasks && pendingTasks.length > 0 && (
            <SectionCard
              title={copy('My tasks', 'ჩემი დავალებები')}
              subtitle={canUpdateTasks
                ? copy('A short, actionable work list.', 'მოკლე და ქმედითი სამუშაო სია.')
                : copy('Task status is view-only for your role.', 'თქვენი როლისთვის დავალებების სტატუსი მხოლოდ სანახავია.')}
              icon={ClipboardList}
              actions={<StatusBadge tone={overdueTasks.length ? 'danger' : 'neutral'}>{pendingTasks.length} {copy('open', 'ღია')}</StatusBadge>}
            >
              {pendingTasks.length ? (
                <div className="space-y-2">
                  {pendingTasks.slice(0, 5).map((task) => (
                    <label
                      key={task.id}
                      className={`flex min-h-12 items-start gap-3 rounded-xl border border-stone-100 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30 ${canUpdateTasks ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <input
                        type="checkbox"
                        checked={task.status === 'completed'}
                        disabled={!canUpdateTasks}
                        onChange={() => {
                          if (canUpdateTasks) onToggleTaskStatus(task.id);
                        }}
                        className="mt-0.5 h-5 w-5 shrink-0 rounded border-stone-300 accent-[#5b1320] disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-bold text-stone-900 dark:text-amber-50">
                          {task.title}
                        </strong>
                        <span className={`mt-1 block text-[10px] font-semibold ${
                          task.dueDate < today ? 'text-rose-700 dark:text-rose-300' : 'text-stone-500 dark:text-stone-400'
                        }`}>
                          {copy('Due', 'ვადა')} {task.dueDate} · {task.assignedTo || copy('Unassigned', 'დაუნიშნავი')} · {task.priority}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center gap-3 rounded-xl bg-stone-50 p-4 text-stone-500 dark:bg-stone-950/30 dark:text-stone-400">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span className="text-xs font-semibold">{copy('No open tasks.', 'ღია დავალებები არ არის.')}</span>
                </div>
              )}
            </SectionCard>
          )}

          {canViewAudit && latestAuditLogs.length > 0 && (
            <SectionCard
              title={copy('Recent activity', 'ბოლო აქტივობა')}
              subtitle={copy('Latest recorded changes across the estate.', 'მეურნეობაში ბოლოს ჩაწერილი ცვლილებები.')}
              icon={ShieldCheck}
              actions={(
                <button
                  type="button"
                  onClick={go('audit')}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5b1320] hover:underline dark:text-amber-200"
                >
                  {copy('Open audit', 'აუდიტის გახსნა')} <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            >
              {latestAuditLogs.length ? (
                <div className="space-y-2">
                  {latestAuditLogs.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 rounded-xl border border-stone-100 p-3 dark:border-stone-800">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#5b1320] dark:bg-amber-300" />
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-xs font-bold text-stone-900 dark:text-amber-50">
                          {log.actionType} · {log.changedItem}
                        </strong>
                        <span className="mt-1 block truncate text-[10px] text-stone-500 dark:text-stone-400">
                          {log.user} · {log.timestamp}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center gap-3 rounded-xl bg-stone-50 p-4 text-stone-500 dark:bg-stone-950/30 dark:text-stone-400">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-xs font-semibold">{copy('Activity will appear after the first recorded change.', 'აქტივობა გამოჩნდება პირველი ცვლილების ჩაწერის შემდეგ.')}</span>
                </div>
              )}
            </SectionCard>
          )}
        </div>
      )}
    </main>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(DashboardTab);
