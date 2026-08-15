import React, { useMemo } from 'react';
import { translations } from '../lib/i18n';
import type { Language } from '../lib/i18n';
import type { Vessel, WineLot, DailyFermLog, LabAnalysis, Task } from '../lib/wineryState';
import { taskPriorityLabel } from '../lib/enumLabels';
import { isPhysicalFermentationReading } from '../lib/fermentationIntegrity';
import { canAccess, type Role } from '../server/permissions';
import TankCapacityChart from './TankCapacityChart';
import FermentationCurveChart from './FermentationCurveChart';
import DashboardLayout, { type DashboardWidgetSpec } from './DashboardLayout';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Container,
  LayoutDashboard,
  ShieldAlert,
  TestTube,
  Thermometer,
  Wine,
} from 'lucide-react';
import {
  ActionButton,
  EmptyState,
  InlineNotice,
  MetricCard,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatusBadge,
} from './ui/primitives';

interface WineryDashboardTabProps {
  lang: Language;
  lots: WineLot[];
  vessels: Vessel[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  tasks: Task[];
  chartLotId: string;
  setChartLotId: (val: string) => void;
  selectedTankId: string | null;
  setSelectedTankId: (val: string | null) => void;
  onToggleTaskStatus: (taskId: string) => void;
  role?: Role;
  canUpdateTasks?: boolean;
  layoutOwner?: string;
  setActiveTab?: (tab: string) => void;
  setCalculatorLotId?: (lotId: string) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function formatVolume(value: number) {
  return `${Math.round(value).toLocaleString()} L`;
}

function latestByLot<T extends { lotId: string; date: string }>(records: T[]) {
  return records.reduce<Record<string, T>>((acc, record) => {
    if (!acc[record.lotId] || record.date > acc[record.lotId].date) acc[record.lotId] = record;
    return acc;
  }, {});
}

export function toggleTaskStatusIfAllowed(
  canUpdateTasks: boolean,
  onToggleTaskStatus: (taskId: string) => void,
  taskId: string,
) {
  if (!canUpdateTasks) return;
  onToggleTaskStatus(taskId);
}

export function WineryDashboardTab({
  lang,
  lots,
  vessels,
  fermLogs,
  labLogs,
  tasks,
  chartLotId,
  setChartLotId,
  selectedTankId,
  setSelectedTankId,
  onToggleTaskStatus,
  role = 'Owner/Admin',
  canUpdateTasks = true,
  layoutOwner,
  setActiveTab,
  setCalculatorLotId,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc
}: WineryDashboardTabProps) {
  const t = translations[lang];
  const isKa = lang === 'ka';
  const today = todayISO();
  const go = (tab: string) => setActiveTab ? () => setActiveTab(tab) : undefined;
  const canViewLots = canAccess(role, 'lots', 'view');
  const canViewVessels = canAccess(role, 'vessels', 'view');
  const canCreateVessels = canAccess(role, 'vessels', 'create');
  const canViewFermentation = canAccess(role, 'fermentation', 'view');
  const canCreateFermentation = canAccess(role, 'fermentation', 'create');
  const canViewLab = canAccess(role, 'lab', 'view');
  const canCreateLab = canAccess(role, 'lab', 'create');
  const canViewBottling = canAccess(role, 'bottling', 'view');
  const canViewTasks = canAccess(role, 'tasks', 'view');
  const canCreateTasks = canAccess(role, 'tasks', 'create');
  const showCellarHealth = canViewVessels || canViewBottling || canViewLab;
  const physicalFermLogs = fermLogs.filter(isPhysicalFermentationReading);

  const totalLotsVolume = lots.reduce((acc, curr) => acc + curr.currentVolume, 0);
  const totalCapacity = vessels.reduce((acc, curr) => acc + curr.capacity, 0);
  const occupiedVessels = vessels.filter(v => v.currentVolume > 0);
  const occupiedTanksCount = occupiedVessels.length;
  const vesselUsePct = totalCapacity > 0 ? (occupiedVessels.reduce((acc, curr) => acc + curr.currentVolume, 0) / totalCapacity) * 100 : 0;
  const activeFerms = lots.filter(l => l.stage === 'fermenting');
  const activeFermsCount = activeFerms.length;
  const avgTemp = occupiedVessels.length > 0
    ? parseFloat((occupiedVessels.reduce((acc, curr) => acc + (curr.temperature || 0), 0) / occupiedVessels.length).toFixed(1))
    : 0;

  const latestFermByLot = latestByLot(physicalFermLogs);
  const latestLabByLot = latestByLot(labLogs);
  const fermentsMissingReading = activeFerms.filter(lot => latestFermByLot[lot.id]?.date !== today);
  const lowSO2Alerts = Object.values(latestLabByLot).filter(log => log.freeSo2 < 15);
  const highVAAlerts = Object.values(latestLabByLot).filter(log => log.volatileAcid > 0.8);
  const pendingTasks = tasks
    .filter(task => task.status !== 'completed')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueTasks = pendingTasks.filter(task => task.dueDate < today);
  const readyForBottling = lots.filter(lot => ['stabilization', 'filtration', 'aging'].includes(lot.stage) && lot.currentVolume > 0);

  const workQueue = [
    ...(canViewLab ? lowSO2Alerts.map(log => ({
      id: `so2-${log.id}`,
      tone: 'danger' as const,
      title: `${isKa ? 'დაბალი SO₂' : 'Low SO₂'}: ${lots.find(l => l.id === log.lotId)?.name || log.lotId}`,
      detail: `${log.freeSo2} ${isKa ? 'მგ/ლ თავისუფალი SO₂' : 'mg/L free SO₂'} · ${log.date}`,
      action: () => {
        setCalculatorLotId?.(log.lotId);
        setActiveTab?.('calculators');
      },
      actionLabel: isKa ? 'SO₂ კალკულატორი' : 'Run SO₂ calculator',
    })) : []),
    ...(canViewLab ? highVAAlerts.map(log => ({
      id: `va-${log.id}`,
      tone: 'danger' as const,
      title: `${isKa ? 'აქროლადი მჟავიანობის გაფრთხილება' : 'Volatile acidity warning'}: ${lots.find(l => l.id === log.lotId)?.name || log.lotId}`,
      detail: `${log.volatileAcid} ${isKa ? 'გ/ლ VA' : 'g/L VA'} · ${log.date}`,
      action: canCreateTasks ? () => {
        setPrefilledTaskTitle?.(isKa
          ? `შეამოწმეთ და დაალუქეთ ჭურჭელი პარტიისთვის ${log.lotId}`
          : `Inspect & seal vessel for Lot ${log.lotId}`);
        setPrefilledTaskPriority?.('high');
        setPrefilledTaskDesc?.(isKa
          ? `აცეტაციის გაფრთხილება: აქროლადი მჟავიანობა აწეულია ${log.volatileAcid} გ/ლ-მდე. შეამოწმეთ გამაგრილებელი პერანგი, გაწმინდეთ თავისუფალი სივრცე, დაარწმუნეთ სახურავის ჰერმეტულობა და საჭიროების შემთხვევაში გაფილტრეთ CO2/Argon-ით.`
          : `Acetation alert: volatile acidity is elevated at ${log.volatileAcid} g/L. Check cooling jacket, clean headspace, verify lid gasket tightness, and purge with CO2/Argon if necessary.`);
        setActiveTab?.('tasks');
      } : undefined,
      actionLabel: isKa ? 'ინსპექციის დავალება' : 'Create inspection task',
    })) : []),
    ...(canViewFermentation ? fermentsMissingReading.map(lot => ({
      id: `ferm-${lot.id}`,
      tone: 'warning' as const,
      title: `${isKa ? 'დუღილის ჩანაწერი დასამატებელია' : 'Fermentation reading missing'}: ${lot.name}`,
      detail: `${lot.currentVolume.toLocaleString()} L · ${lot.variety}`,
      action: go('fermentation'),
      actionLabel: canCreateFermentation ? (isKa ? 'ჩაწერა' : 'Log reading') : (isKa ? 'დუღილის ნახვა' : 'Review fermentation'),
    })) : []),
    ...(canViewTasks ? overdueTasks.slice(0, 4).map(task => ({
      id: `task-${task.id}`,
      tone: 'warning' as const,
      title: task.title,
      detail: isKa
        ? `ვადაგადაცილებულია ${task.dueDate}-დან · ${taskPriorityLabel(task.priority, lang)} პრიორიტეტი`
        : `Overdue since ${task.dueDate} · ${taskPriorityLabel(task.priority, lang)} priority`,
      action: go('tasks'),
      actionLabel: isKa ? 'დავალებების ნახვა' : 'Review tasks',
    })) : []),
  ].slice(0, 8);

  const chartableLotIds = Array.from(new Set(physicalFermLogs.map(l => l.lotId)));
  const selectedChartLotId = chartLotId && chartableLotIds.includes(chartLotId)
    ? chartLotId
    : chartableLotIds[0] || '';

  const mappedTanks = useMemo(() => {
    return vessels.map(v => ({
      id: v.id,
      name: v.id,
      capacity: v.capacity,
      currentVolume: v.currentVolume,
      status: v.assignedLotId
        ? (lots.find(l => l.id === v.assignedLotId)?.stage === 'fermenting' ? 'fermenting' : 'occupied')
        : (v.cleaningStatus === 'dirty' ? 'cleaning' : 'empty')
    }));
  }, [vessels, lots]);

  const recentFermLogs = [...physicalFermLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const recentTasks = pendingTasks.slice(0, 6);

  return (
    <div className="space-y-5 animate-fade-in text-stone-800 relative z-10">
      <PageHeader
        eyebrow={isKa ? 'მარანი' : 'Cellar'}
        title={t.overview || 'Overview'}
        description={isKa
          ? 'წარმოების, ტევადობისა და ქიმიის მოკლე ოპერაციული სურათი.'
          : 'A focused view of production, capacity, chemistry, and cellar work.'}
        icon={LayoutDashboard}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canCreateFermentation && (
              <ActionButton onClick={go('fermentation')} className="gap-1.5">
                <Activity className="h-3.5 w-3.5" /> {isKa ? 'დუღილის ჩაწერა' : 'Log fermentation'}
              </ActionButton>
            )}
            {canCreateLab && (
              <ActionButton tone="secondary" onClick={go('labs')} className="gap-1.5">
                <TestTube className="h-3.5 w-3.5" /> {isKa ? 'ანალიზის დამატება' : 'Add lab'}
              </ActionButton>
            )}
            {canViewTasks && (
              <ActionButton tone="secondary" onClick={go('tasks')} className="gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" /> {t.tasks || 'Tasks'}
              </ActionButton>
            )}
          </div>
        )}
      />

      <DashboardLayout
        dashboardId={`cellar:${layoutOwner || role}`}
        lang={lang}
        items={[
          {
            id: 'metrics',
            label: isKa ? 'მარნის მაჩვენებლები' : 'Cellar metrics',
            defaultSpan: 12,
            content: (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {canViewLots && (
          <MetricCard
            label={t.total_volume || 'Wine volume'}
            value={formatVolume(totalLotsVolume)}
            detail={`${lots.length} ${isKa ? 'აქტიური პარტია' : 'active wine lots'}`}
            icon={Wine}
            tone="brand"
            onClick={go('lots')}
          />
        )}
        {canViewVessels && (
          <MetricCard
            label={t.total_tanks || 'Vessels'}
            value={`${occupiedTanksCount}/${vessels.length}`}
            detail={isKa ? `გამოყენებულია ტევადობის ${Math.round(vesselUsePct)}%` : `${Math.round(vesselUsePct)}% of cellar capacity used`}
            icon={Container}
            tone={vesselUsePct > 85 ? 'warning' : 'info'}
            onClick={go('vessels')}
          />
        )}
        {canViewFermentation && (
          <MetricCard
            label={t.active_ferms || 'Fermenting'}
            value={activeFermsCount}
            detail={fermentsMissingReading.length
              ? (isKa ? `${fermentsMissingReading.length} საჭიროებს ჩაწერას დღეს` : `${fermentsMissingReading.length} need readings today`)
              : (isKa ? 'ჩანაწერები განახლებულია' : 'Readings up to date')}
            icon={Activity}
            tone={fermentsMissingReading.length ? 'warning' : 'success'}
            onClick={go('fermentation')}
          />
        )}
        {canViewVessels && (
          <MetricCard
            label={t.temperature || 'Avg vessel temp'}
            value={`${avgTemp} °C`}
            detail={occupiedTanksCount
              ? (isKa ? `${occupiedTanksCount} დაკავებული ჭურჭელი` : `${occupiedTanksCount} occupied vessels`)
              : (isKa ? 'დაკავებული ჭურჭელი არ არის' : 'No occupied vessels')}
            icon={Thermometer}
            tone="neutral"
            onClick={go('vessels')}
          />
        )}
              </div>
            ),
          },
          {
            id: 'priority-queue',
            label: isKa ? 'დღის განრიგი' : 'Today’s cellar queue',
            defaultSpan: showCellarHealth ? 8 : 12,
            content: (
              <SectionCard
          title={isKa ? 'დღის განრიგი' : 'Today’s cellar queue'}
          subtitle={isKa
            ? 'ჯერ ქიმიის რისკები, გამოტოვებული დუღილის ჩანაწერები და ვადაგადაცილებული სამუშაო.'
            : 'Chemistry risks, missing fermentation readings, and overdue work first.'}
          icon={ShieldAlert}
          actions={<StatusBadge tone={workQueue.length ? 'warning' : 'success'}>{workQueue.length ? `${workQueue.length} ${isKa ? 'ღია' : 'open'}` : (isKa ? 'სუფთა' : 'clear')}</StatusBadge>}
        >
          {workQueue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={isKa ? 'გადაუდებელი სამუშაო არ არის' : 'No urgent cellar work'}
              description={isKa
                ? 'ქიმიის, დუღილისა და ვადაგადაცილებული დავალებების სიგნალები სუფთაა ჩაწერილი მონაცემებისთვის.'
                : 'Chemistry, fermentation, and overdue task signals are clear for the recorded data.'}
            />
          ) : (
            <div className="space-y-2.5">
              {workQueue.map(item => (
                <div key={item.id} className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-stone-50/70 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-950/30">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`mt-0.5 rounded-xl border p-2 ${
                      item.tone === 'danger'
                        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                    }`}>
                      <AlertTriangle className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <strong className="block text-sm font-black text-stone-900 dark:text-amber-50">{item.title}</strong>
                      <span className="block text-[11px] font-semibold text-stone-500 dark:text-stone-400">{item.detail}</span>
                    </div>
                  </div>
                  {item.action && (
                    <ActionButton tone={item.tone === 'danger' ? 'danger' : 'secondary'} onClick={item.action} className="shrink-0">
                      {item.actionLabel}
                    </ActionButton>
                  )}
                </div>
              ))}
            </div>
          )}
              </SectionCard>
            ),
          },
          ...(showCellarHealth ? [{
            id: 'cellar-health',
            label: isKa ? 'მარნის მდგომარეობა' : 'Cellar health',
            defaultSpan: 4 as const,
            content: (
              <SectionCard
            title={isKa ? 'მარნის მდგომარეობა' : 'Cellar health'}
            subtitle={isKa
              ? 'თქვენი როლისთვის ხელმისაწვდომი მარნის სიგნალების სწრაფი მიმოხილვა.'
              : 'Fast read on the cellar signals available to your role.'}
            icon={BarChart3}
          >
            <div className="space-y-4">
              {canViewVessels && (
                <ProgressBar
                  value={vesselUsePct}
                  tone={vesselUsePct > 85 ? 'warning' : 'brand'}
                  label={isKa ? 'მარნის ტევადობა' : 'Capacity utilization'}
                />
              )}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {canViewBottling && (
              <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/40">
                <span className="block text-[9px] font-mono font-bold uppercase text-stone-500 dark:text-stone-400">{isKa ? 'მალე მზადაა' : 'Ready soon'}</span>
                <strong className="mt-1 block text-xl font-black text-stone-900 dark:text-amber-50">{readyForBottling.length}</strong>
                <span className="text-[10px] font-semibold text-stone-500">{isKa ? 'პარტია ჩამოსხმის ზღვარზე' : 'lots near bottling'}</span>
              </div>
              )}
              {canViewLab && (
              <div className="rounded-xl bg-stone-50 p-3 dark:bg-stone-950/40">
                <span className="block text-[9px] font-mono font-bold uppercase text-stone-500 dark:text-stone-400">{isKa ? 'ქიმია' : 'Chemistry'}</span>
                <strong className={`mt-1 block text-xl font-black ${lowSO2Alerts.length || highVAAlerts.length ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {lowSO2Alerts.length + highVAAlerts.length}
                </strong>
                <span className="text-[10px] font-semibold text-stone-500">{isKa ? 'ბოლო ლაბ. გაფრთხილება' : 'latest lab alerts'}</span>
              </div>
              )}
              </div>

              {canViewVessels && vesselUsePct > 85 && (
                <InlineNotice tone="warning">
                  {isKa
                    ? 'მარნის ტევადობა იწურება. განიხილეთ ჩამოსხმა, გადატანა ან დროებითი საწყობის დამატება ახალი ყურძნის მიღებამდე.'
                    : 'Cellar capacity is getting tight. Consider bottling, transfers, or adding temporary storage before receiving more fruit.'}
                </InlineNotice>
              )}

              {canViewVessels && vessels.length === 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950/30 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <strong className="block text-xs font-bold text-stone-800 dark:text-stone-100">
                      {isKa ? 'ჭურჭელი ჯერ არ არის რეგისტრირებული' : 'No vessels registered yet'}
                    </strong>
                    <span className="mt-1 block text-[11px] text-stone-500 dark:text-stone-400">
                      {isKa ? 'დაამატეთ პირველი ჭურჭელი ტევადობისა და პარტიების აღრიცხვისთვის.' : 'Add the first vessel to start capacity and batch tracking.'}
                    </span>
                  </div>
                  {canCreateVessels && (
                    <ActionButton tone="secondary" onClick={go('vessels')} className="shrink-0">
                      {isKa ? 'ჭურჭლის დამატება' : 'Register vessel'}
                    </ActionButton>
                  )}
                </div>
              )}
            </div>
              </SectionCard>
            ),
          }] : []),

          ...(canViewVessels && vessels.length > 0 ? [{
            id: 'vessel-utilization',
            label: isKa ? 'ჭურჭლის გამოყენება' : 'Vessel utilization',
            defaultSpan: 6 as const,
            content: (
              <SectionCard
          title={isKa ? 'მარნის ჭურჭლის გამოყენება' : 'Cellar vessel utilization'}
          subtitle={isKa ? 'ტევადობა აქტიური სითხის მოცულობასთან.' : 'Capacity vs active liquid volume.'}
          icon={Container}
          actions={<StatusBadge tone="info">D3</StatusBadge>}
        >
          {vessels.length === 0 ? (
            <EmptyState icon={Container} title={isKa ? 'ჭურჭელი ჯერ არ არის' : 'No vessels yet'} description={isKa ? 'დაამატეთ რეზერვუარები, ქვევრი, კასრი ან ავზი ტევადობის დასაგეგმად.' : 'Add tanks, qvevri, barrels, or bins to start capacity planning.'} />
          ) : (
            <TankCapacityChart tanks={mappedTanks} onSelectTank={setSelectedTankId} selectedTankId={selectedTankId} />
          )}
              </SectionCard>
            ),
          }] : []),

          ...(canViewFermentation && chartableLotIds.length > 0 ? [{
            id: 'fermentation-kinetics',
            label: isKa ? 'დუღილის კინეტიკა' : 'Fermentation kinetics',
            defaultSpan: 6 as const,
            content: (
              <SectionCard
          title={isKa ? 'კინეტიკა და შაქრის დაშლა' : 'Kinetics & sugar degradation'}
          subtitle={isKa ? 'დუღილის ტრენდი არჩეული პარტიისთვის.' : 'Fermentation trend for the selected lot.'}
          icon={Activity}
          actions={chartableLotIds.length > 0 && (
            <select
              value={selectedChartLotId}
              onChange={(e) => setChartLotId(e.target.value)}
              className="w-full sm:w-48 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-[10px] font-bold text-stone-800 outline-none dark:border-stone-800 dark:bg-stone-950 dark:text-amber-50"
            >
              {chartableLotIds.map(lId => {
                const associatedLot = lots.find(lt => lt.id === lId);
                return (
                  <option key={lId} value={lId}>
                    {associatedLot ? associatedLot.name : lId}
                  </option>
                );
              })}
            </select>
          )}
        >
          {chartableLotIds.length === 0 ? (
            <EmptyState icon={Activity} title={isKa ? 'დუღილის ჩანაწერები ჯერ არ არის' : 'No fermentation readings yet'} description={isKa ? 'ჩაწერეთ პირველი დღიური სიმკვრივე და ტემპერატურა მრუდის დასაწყებად.' : 'Log the first daily density and temperature reading to start the curve.'} />
          ) : (
            <FermentationCurveChart logs={physicalFermLogs} selectedLotId={selectedChartLotId} lang={lang} />
          )}
              </SectionCard>
            ),
          }] : []),

          ...(canViewTasks && recentTasks.length > 0 ? [{
            id: 'upcoming-tasks',
            label: t.upcoming_tasks || 'Upcoming tasks',
            defaultSpan: 6 as const,
            content: (
              <SectionCard
          title={t.upcoming_tasks || 'Upcoming tasks'}
          subtitle={canUpdateTasks
            ? (isKa ? 'მოკლე სამუშაო რიგი, არა უსასრულო ჟურნალი.' : 'A short work queue, not an endless ledger.')
            : (isKa ? 'დავალების სტატუსი თქვენი როლისთვის მხოლოდ სანახავია.' : 'Task status is view-only for your role.')}
          icon={ClipboardList}
          actions={<StatusBadge tone={overdueTasks.length ? 'danger' : 'neutral'}>{pendingTasks.length} {isKa ? 'მოლოდინში' : 'pending'}</StatusBadge>}
        >
          {recentTasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={isKa ? 'ღია დავალებები არ არის' : 'No open tasks'} description={isKa ? 'მარნის დავალებების სიაში არაფერია დაგეგმილი.' : 'Nothing is scheduled in the cellar task list.'} />
          ) : (
            <div className="space-y-2">
              {recentTasks.map(task => (
                <label
                  key={task.id}
                  className={`flex items-start gap-3 rounded-xl border border-stone-100 bg-stone-50/60 p-3 dark:border-stone-800 dark:bg-stone-950/30 ${canUpdateTasks ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <input
                    type="checkbox"
                    checked={task.status === 'completed'}
                    disabled={!canUpdateTasks}
                    onChange={() => toggleTaskStatusIfAllowed(canUpdateTasks, onToggleTaskStatus, task.id)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-stone-300 accent-[#4e0e15] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className={`block text-xs font-black ${task.status === 'completed' ? 'text-stone-500 dark:text-stone-400 line-through' : 'text-stone-900 dark:text-amber-50'}`}>{task.title}</strong>
                    <span className="mt-1 block text-[10px] font-mono font-bold text-stone-500 dark:text-stone-400">
                      {isKa ? 'ვადა' : 'Due'} {task.dueDate} · {task.assignedTo || (isKa ? 'დაუნიშნავი' : 'Unassigned')} · {taskPriorityLabel(task.priority, lang)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
              </SectionCard>
            ),
          }] : []),

          ...(canViewFermentation && recentFermLogs.length > 0 ? [{
            id: 'recent-fermentation',
            label: isKa ? 'ბოლო დუღილის ჩანაწერები' : 'Recent fermentation logs',
            defaultSpan: 6 as const,
            content: (
              <SectionCard
          title={isKa ? 'ბოლო დუღილის ჩანაწერები' : 'Recent fermentation logs'}
          subtitle={isKa ? 'ბოლო მაჩვენებლები პარტიების მიხედვით.' : 'Latest cellar readings across lots.'}
          icon={TestTube}
        >
          {recentFermLogs.length === 0 ? (
            <EmptyState icon={TestTube} title={isKa ? 'ჩანაწერები არ არის' : 'No readings logged'} description={isKa ? 'დღიური ჩანაწერები აქ გამოჩნდება დუღილის მონიტორინგის დაწყებისას.' : 'Daily logs will appear here once fermentation tracking starts.'} />
          ) : (
            <div className="space-y-2.5">
              {recentFermLogs.map(log => {
                const lot = lots.find(l => l.id === log.lotId);
                return (
                  <div key={log.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3 text-xs dark:border-stone-800 dark:bg-stone-950/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block truncate font-black text-stone-900 dark:text-amber-50">{lot?.name || log.lotId}</strong>
                        <span className="block text-[10px] font-mono font-bold text-stone-500 dark:text-stone-400">{log.date}</span>
                      </div>
                      <StatusBadge tone="info">{log.temperature} °C</StatusBadge>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                      {isKa ? 'სიმკვრივე' : 'Density'} {log.density} SG{log.tastingNotes ? ` · ${log.tastingNotes}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
              </SectionCard>
            ),
          }] : []),
        ] satisfies DashboardWidgetSpec[]}
      />
    </div>
  );
}

/**
 * Memoized: `useWineryState` hands out stable handler identities, so a state
 * change elsewhere in the app (a toast, a sync timestamp, another module's
 * records) leaves this component’s props referentially equal and React skips
 * the re-render entirely.
 */
export default React.memo(WineryDashboardTab);
