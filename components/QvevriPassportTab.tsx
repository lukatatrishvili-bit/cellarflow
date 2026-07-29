import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  ClipboardList,
  Container,
  Droplets,
  FileText,
  MapPin,
  Plus,
  Save,
  ShieldCheck,
  Thermometer,
  Wine,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { CellarOperation, CertificationRecord, DailyFermLog, Vessel, WineLot } from '../lib/wineryState';
import { isActiveCellarOperation } from '../lib/cellarOperationIntegrity';
import { buildQvevriPassportSummary, evaluateQvevriPassport } from '../lib/qvevri';
import {
  ActionButton,
  EmptyState,
  FieldLabel,
  InlineNotice,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusBadge,
} from './ui/primitives';
import DateInput from './ui/DateInput';

type QvevriStatus = 'unknown' | 'needed' | 'done';
type QvevriLogEntry = NonNullable<Vessel['dailyMixingLog']>[number];

interface QvevriPassportTabProps {
  lang: Language;
  vessels: Vessel[];
  lots: WineLot[];
  fermentationLogs: DailyFermLog[];
  cellarOps: CellarOperation[];
  certificationRecords: CertificationRecord[];
  onUpdateVessels: (vessels: Vessel[]) => void;
  setActiveTab?: (tab: string) => void;
  setSelectedTankId?: (tankId: string | null) => void;
  setToastMessage?: (message: string) => void;
  currentUserName?: string;
  canUpdateVessel?: boolean;
  embedded?: boolean;
  onBackToVessels?: () => void;
  activeVesselId?: string | null;
}

interface PassportForm {
  qvevriNumber: string;
  maraniLocation: string;
  buried: boolean;
  lastWashingDate: string;
  limeWashStatus: QvevriStatus;
  waxingStatus: QvevriStatus;
  inspectionNotes: string;
  fillingDate: string;
  grapeVariety: string;
  chachaPercentage: string;
  stemInclusion: boolean;
  mixingFrequency: string;
  sealingDate: string;
  openingDate: string;
  skinContactDurationDays: string;
  firstRackingDate: string;
  soilTemperature: string;
  lastSealedDate: string;
}

interface LogDraft {
  date: string;
  action: string;
  operator: string;
  notes: string;
}

const inputCls = 'w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-800 outline-none focus:border-[#4e0e15] dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100';
const textareaCls = `${inputCls} min-h-[82px] resize-y leading-relaxed`;
const checkboxCls = 'h-4 w-4 rounded border-stone-300 text-[#4e0e15] focus:ring-[#4e0e15]';

const blankForm: PassportForm = {
  qvevriNumber: '',
  maraniLocation: '',
  buried: true,
  lastWashingDate: '',
  limeWashStatus: 'unknown',
  waxingStatus: 'unknown',
  inspectionNotes: '',
  fillingDate: '',
  grapeVariety: '',
  chachaPercentage: '',
  stemInclusion: false,
  mixingFrequency: '',
  sealingDate: '',
  openingDate: '',
  skinContactDurationDays: '',
  firstRackingDate: '',
  soilTemperature: '',
  lastSealedDate: '',
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const clean = (value: string) => value.trim();
const optionalText = (value: string) => {
  const trimmed = clean(value);
  return trimmed.length > 0 ? trimmed : undefined;
};
const optionalNumber = (value: string) => {
  const trimmed = clean(value);
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const optionalInteger = (value: string) => {
  const parsed = optionalNumber(value);
  return parsed === undefined ? undefined : Math.round(parsed);
};
const formatDate = (value?: string | null) => value ? value.slice(0, 10) : 'Not set';
const formatDays = (value: number | null) => value === null ? '--' : `${value} d`;
const formatTemp = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} C` : '--';
const fillPct = (vessel: Vessel) => vessel.capacity > 0 ? Math.round((vessel.currentVolume / vessel.capacity) * 100) : 0;

function formFromVessel(vessel: Vessel | null, lot: WineLot | null): PassportForm {
  if (!vessel) return blankForm;
  return {
    qvevriNumber: vessel.qvevriNumber || vessel.id,
    maraniLocation: vessel.maraniLocation || vessel.locationDetails || '',
    buried: vessel.buried ?? true,
    lastWashingDate: vessel.lastWashingDate || vessel.lastCleaned || '',
    limeWashStatus: vessel.limeWashStatus || 'unknown',
    waxingStatus: vessel.waxingStatus || 'unknown',
    inspectionNotes: vessel.inspectionNotes || '',
    fillingDate: vessel.fillingDate || lot?.createdAt || '',
    grapeVariety: vessel.grapeVariety || lot?.variety || '',
    chachaPercentage: vessel.chachaPercentage === undefined ? '' : String(vessel.chachaPercentage),
    stemInclusion: Boolean(vessel.stemInclusion),
    mixingFrequency: vessel.mixingFrequency || '',
    sealingDate: vessel.sealingDate || vessel.lastSealedDate || '',
    openingDate: vessel.openingDate || '',
    skinContactDurationDays: vessel.skinContactDurationDays === undefined ? '' : String(vessel.skinContactDurationDays),
    firstRackingDate: vessel.firstRackingDate || '',
    soilTemperature: vessel.soilTemperature === undefined ? '' : String(vessel.soilTemperature),
    lastSealedDate: vessel.lastSealedDate || vessel.sealingDate || '',
  };
}

function readinessTone(status: ReturnType<typeof evaluateQvevriPassport>['status']) {
  if (status === 'ready') return 'success';
  if (status === 'needs_review') return 'warning';
  return 'danger';
}

function statusLabel(status: ReturnType<typeof evaluateQvevriPassport>['status']) {
  if (status === 'ready') return 'Ready';
  if (status === 'needs_review') return 'Needs review';
  return 'Missing data';
}

function sortLogs<T extends { date: string }>(items: T[]) {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

export default function QvevriPassportTab({
  lang,
  vessels,
  lots,
  fermentationLogs,
  cellarOps,
  certificationRecords,
  onUpdateVessels,
  setActiveTab,
  setSelectedTankId,
  setToastMessage,
  currentUserName = '',
  canUpdateVessel = true,
  embedded = false,
  onBackToVessels,
  activeVesselId,
}: QvevriPassportTabProps) {
  const ka = lang === 'ka';
  const qvevris = useMemo(() => vessels.filter(vessel => vessel.type === 'qvevri'), [vessels]);
  const [selectedVesselId, setSelectedVesselId] = useState(
    qvevris.some(vessel => vessel.id === activeVesselId) ? activeVesselId! : qvevris[0]?.id || '',
  );
  const selectedVessel = qvevris.find(vessel => vessel.id === selectedVesselId) || qvevris[0] || null;
  const assignedLot = selectedVessel?.assignedLotId
    ? lots.find(lot => lot.id === selectedVessel.assignedLotId) || null
    : null;
  const [form, setForm] = useState<PassportForm>(() => formFromVessel(selectedVessel, assignedLot));
  const [mixingDraft, setMixingDraft] = useState<LogDraft>({
    date: todayIso(),
    action: 'Punchdown / cap wetting',
    operator: currentUserName,
    notes: '',
  });
  const [sanitationDraft, setSanitationDraft] = useState<LogDraft>({
    date: todayIso(),
    action: 'Wash / lime check',
    operator: currentUserName,
    notes: '',
  });

  useEffect(() => {
    if (!qvevris.length) {
      setSelectedVesselId('');
      return;
    }
    if (activeVesselId && qvevris.some(vessel => vessel.id === activeVesselId)) {
      setSelectedVesselId(activeVesselId);
      return;
    }
    if (!selectedVesselId || !qvevris.some(vessel => vessel.id === selectedVesselId)) {
      setSelectedVesselId(qvevris[0].id);
    }
  }, [activeVesselId, qvevris, selectedVesselId]);

  useEffect(() => {
    setForm(formFromVessel(selectedVessel, assignedLot));
  }, [assignedLot, selectedVessel]);

  const opsForVessel = useMemo(() => {
    if (!selectedVessel) return [];
    return cellarOps.filter(op => isActiveCellarOperation(op) && (
      op.vesselId === selectedVessel.id ||
      op.vesselToId === selectedVessel.id ||
      (assignedLot && op.lotId === assignedLot.id)
    ));
  }, [assignedLot, cellarOps, selectedVessel]);

  const fermentationLogsForVessel = useMemo(() => {
    if (!selectedVessel) return [];
    return fermentationLogs.filter(log =>
      log.tankId === selectedVessel.id ||
      (assignedLot && log.lotId === assignedLot.id)
    );
  }, [assignedLot, fermentationLogs, selectedVessel]);

  const officialRecords = useMemo(() => {
    if (!assignedLot) return [];
    return certificationRecords.filter(record => record.lotId === assignedLot.id);
  }, [assignedLot, certificationRecords]);

  const summary = selectedVessel
    ? buildQvevriPassportSummary({
      vessel: selectedVessel,
      lot: assignedLot || undefined,
      operations: opsForVessel,
      fermentationLogs: fermentationLogsForVessel,
    })
    : null;
  const readiness = selectedVessel ? evaluateQvevriPassport(selectedVessel, assignedLot || undefined) : null;
  const latestFermLog = sortLogs(fermentationLogsForVessel)[0] || null;
  const sanitationOps = sortLogs(opsForVessel.filter(op => op.type === 'cleaning'));
  const passportScore = readiness?.score || 0;

  const updateForm = <K extends keyof PassportForm>(key: K, value: PassportForm[K]) => {
    if (!canUpdateVessel) return;
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const updateSelectedVessel = (updater: (vessel: Vessel) => Vessel) => {
    if (!canUpdateVessel || !selectedVessel) return;
    onUpdateVessels(vessels.map(vessel => vessel.id === selectedVessel.id ? updater(vessel) : vessel));
  };

  const handleSave = () => {
    if (!canUpdateVessel || !selectedVessel) return;
    updateSelectedVessel(vessel => ({
      ...vessel,
      qvevriNumber: optionalText(form.qvevriNumber),
      maraniLocation: optionalText(form.maraniLocation),
      locationDetails: optionalText(form.maraniLocation) || vessel.locationDetails,
      buried: form.buried,
      lastWashingDate: optionalText(form.lastWashingDate),
      lastCleaned: optionalText(form.lastWashingDate) || vessel.lastCleaned,
      limeWashStatus: form.limeWashStatus,
      waxingStatus: form.waxingStatus,
      inspectionNotes: optionalText(form.inspectionNotes),
      fillingDate: optionalText(form.fillingDate),
      grapeVariety: optionalText(form.grapeVariety),
      chachaPercentage: optionalNumber(form.chachaPercentage),
      stemInclusion: form.stemInclusion,
      mixingFrequency: optionalText(form.mixingFrequency),
      sealingDate: optionalText(form.sealingDate),
      lastSealedDate: optionalText(form.lastSealedDate || form.sealingDate),
      openingDate: optionalText(form.openingDate),
      skinContactDurationDays: optionalInteger(form.skinContactDurationDays),
      firstRackingDate: optionalText(form.firstRackingDate),
      soilTemperature: optionalNumber(form.soilTemperature),
    }));
    setToastMessage?.(ka ? 'ქვევრის ჩანაწერი განახლდა.' : `Qvevri record saved for ${selectedVessel.id}.`);
  };

  const handleAddMixing = () => {
    if (!canUpdateVessel || !selectedVessel || !mixingDraft.date || !clean(mixingDraft.action)) return;
    const entry: QvevriLogEntry = {
      date: mixingDraft.date,
      action: clean(mixingDraft.action),
      operator: optionalText(mixingDraft.operator),
      notes: optionalText(mixingDraft.notes),
    };
    updateSelectedVessel(vessel => ({
      ...vessel,
      dailyMixingLog: [entry, ...(vessel.dailyMixingLog || [])],
    }));
    setMixingDraft({ date: todayIso(), action: 'Punchdown / cap wetting', operator: currentUserName, notes: '' });
    setToastMessage?.(ka ? 'ქვევრის დარევის ჩანაწერი დაემატა.' : 'Qvevri mixing log added.');
  };

  const handleAddSanitation = () => {
    if (!canUpdateVessel || !selectedVessel || !sanitationDraft.date || !clean(sanitationDraft.action)) return;
    const entry: QvevriLogEntry = {
      date: sanitationDraft.date,
      action: clean(sanitationDraft.action),
      operator: optionalText(sanitationDraft.operator),
      notes: optionalText(sanitationDraft.notes),
    };
    updateSelectedVessel(vessel => ({
      ...vessel,
      lastWashingDate: sanitationDraft.date,
      lastCleaned: sanitationDraft.date,
      sanitationHistory: [entry, ...(vessel.sanitationHistory || [])],
    }));
    setSanitationDraft({ date: todayIso(), action: 'Wash / lime check', operator: currentUserName, notes: '' });
    setToastMessage?.(ka ? 'სანიტარული ჩანაწერი დაემატა.' : 'Qvevri sanitation log added.');
  };

  const openVessel = () => {
    if (!selectedVessel) return;
    setSelectedTankId?.(selectedVessel.id);
    if (onBackToVessels) onBackToVessels();
    else setActiveTab?.('vessels');
  };

  if (!qvevris.length) {
    return (
      <div className="space-y-4 text-stone-800 animate-fade-in">
        {!embedded && (
          <PageHeader
            eyebrow="Gvino"
            title={ka ? 'ქვევრის ჩანაწერები' : 'Qvevri records'}
            description={ka ? 'ქვევრის იდენტიფიკაცია, სანიტარია და წარმოების ჟურნალი.' : 'Qvevri identity, sanitation, workflow, and linked records.'}
            icon={Container}
          />
        )}
        <SectionCard>
          <EmptyState
            icon={Container}
            title={ka ? 'ქვევრი ჯერ არ არის რეგისტრირებული' : 'No qvevri registered'}
            description={ka ? 'დაამატეთ ქვევრი ჭურჭლის რეესტრში.' : 'Add a qvevri vessel in the cellar register.'}
            action={(
              <ActionButton onClick={() => {
                if (onBackToVessels) onBackToVessels();
                else setActiveTab?.('vessels');
              }}>
                <Container className="mr-2 h-4 w-4" />Open vessels
              </ActionButton>
            )}
          />
        </SectionCard>
      </div>
    );
  }

  if (!selectedVessel || !summary || !readiness) return null;

  return (
    <div className="space-y-4 text-stone-800 animate-fade-in dark:text-stone-100">
      {!embedded && (
        <PageHeader
          eyebrow="Gvino"
          title={ka ? 'ქვევრის ჩანაწერები' : 'Qvevri records'}
          description={ka ? 'ქვევრის იდენტიფიკაცია, სანიტარია, დუღილი და ოფიციალური კავშირები.' : 'Qvevri identity, sanitation, fermentation, operations, and official links.'}
          icon={Container}
          actions={(
            <div className="flex flex-wrap gap-2">
              <ActionButton tone="secondary" onClick={openVessel}>
                <Container className="mr-2 h-4 w-4" />{ka ? 'ჭურჭელი' : 'Vessel'}
              </ActionButton>
              {canUpdateVessel && (
                <ActionButton onClick={handleSave}>
                  <Save className="mr-2 h-4 w-4" />{ka ? 'შენახვა' : 'Save'}
                </ActionButton>
              )}
            </div>
          )}
        />
      )}
      {embedded && canUpdateVessel && (
        <div className="flex justify-end">
          <ActionButton onClick={handleSave}>
            <Save className="mr-2 h-4 w-4" />{ka ? 'შენახვა' : 'Save qvevri record'}
          </ActionButton>
        </div>
      )}

      {!canUpdateVessel && (
        <InlineNotice tone="info">
          <strong>{ka ? 'ქვევრის ჩანაწერები მხოლოდ სანახავია.' : 'Read-only qvevri records.'}</strong>{' '}
          {ka
            ? 'შეგიძლიათ ნახოთ იდენტიფიკაცია, მზადყოფნა, დაკავშირებული დოკუმენტები და სრული ჟურნალი, მაგრამ ცვლილებებს ვერ შეინახავთ.'
            : 'You can review identity, readiness, linked evidence, and complete histories, but cannot save changes.'}
        </InlineNotice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={ka ? 'ჩანაწერი' : 'Record'}
          value={`${passportScore}%`}
          detail={<StatusBadge tone={readinessTone(readiness.status)}>{statusLabel(readiness.status)}</StatusBadge>}
          icon={BadgeCheck}
          tone={readiness.status === 'ready' ? 'success' : readiness.status === 'needs_review' ? 'warning' : 'danger'}
        />
        <MetricCard
          label={ka ? 'შევსება' : 'Fill'}
          value={`${fillPct(selectedVessel)}%`}
          detail={`${selectedVessel.currentVolume.toLocaleString()} / ${selectedVessel.capacity.toLocaleString()} L`}
          icon={Droplets}
          tone="info"
        />
        <MetricCard
          label={ka ? 'ნიადაგი' : 'Soil temp'}
          value={formatTemp(summary.soilTemperature)}
          detail={summary.buried ? (ka ? 'ჩაფლული ქვევრი' : 'Buried qvevri') : (ka ? 'ზედაპირული ჭურჭელი' : 'Surface vessel')}
          icon={Thermometer}
          tone="neutral"
        />
        <MetricCard
          label={ka ? 'კანთან კონტაქტი' : 'Skin contact'}
          value={formatDays(summary.durations.skinContactDays)}
          detail={ka ? `პირველი გადატანა ${formatDays(summary.durations.daysToFirstRacking)}` : `First racking ${formatDays(summary.durations.daysToFirstRacking)}`}
          icon={Wine}
          tone="brand"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {readiness.missing.length > 0 && (
            <InlineNotice tone={readiness.status === 'needs_review' ? 'warning' : 'danger'}>
              {ka ? 'აკლია: ' : 'Missing: '}
              {(ka ? readiness.missingKa : readiness.missing).slice(0, 6).join(', ')}
              {readiness.missing.length > 6 ? ` +${readiness.missing.length - 6}` : ''}
            </InlineNotice>
          )}

          <SectionCard
            title={ka ? 'იდენტიფიკაცია და მოვლა' : 'Identity and care'}
            icon={MapPin}
            actions={<StatusBadge tone={summary.limeWashStatus === 'done' ? 'success' : 'warning'}>{summary.limeWashStatus}</StatusBadge>}
          >
            <fieldset disabled={!canUpdateVessel} className="grid gap-3 md:grid-cols-2 disabled:cursor-not-allowed disabled:opacity-75">
              <div>
                <FieldLabel required>{ka ? 'ქვევრის ნომერი' : 'Qvevri number'}</FieldLabel>
                <input value={form.qvevriNumber} onChange={event => updateForm('qvevriNumber', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>{ka ? 'მარანი / ადგილი' : 'Marani location'}</FieldLabel>
                <input value={form.maraniLocation} onChange={event => updateForm('maraniLocation', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>{ka ? 'ბოლო რეცხვა' : 'Last washing date'}</FieldLabel>
                <DateInput lang={lang} value={form.lastWashingDate} onValueChange={value => updateForm('lastWashingDate', value)} className={inputCls} required />
              </div>
              <div>
                <FieldLabel required>{ka ? 'ნიადაგის ტემპერატურა' : 'Soil temperature C'}</FieldLabel>
                <input type="number" step="0.1" value={form.soilTemperature} onChange={event => updateForm('soilTemperature', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel>{ka ? 'კირით დამუშავება' : 'Lime wash status'}</FieldLabel>
                <select aria-label="Lime wash status" value={form.limeWashStatus} onChange={event => updateForm('limeWashStatus', event.target.value as QvevriStatus)} className={inputCls}>
                  <option value="unknown">{ka ? 'უცნობი' : 'Unknown'}</option>
                  <option value="needed">{ka ? 'საჭიროა' : 'Needed'}</option>
                  <option value="done">{ka ? 'შესრულებული' : 'Done'}</option>
                </select>
              </div>
              <div>
                <FieldLabel>{ka ? 'ცვილის სტატუსი (არასავალდებულო)' : 'Waxing status (optional)'}</FieldLabel>
                <select aria-label="Waxing status" value={form.waxingStatus} onChange={event => updateForm('waxingStatus', event.target.value as QvevriStatus)} className={inputCls}>
                  <option value="unknown">{ka ? 'უცნობი' : 'Unknown'}</option>
                  <option value="needed">{ka ? 'საჭიროა' : 'Needed'}</option>
                  <option value="done">{ka ? 'შესრულებული' : 'Done'}</option>
                </select>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                <input type="checkbox" checked={form.buried} onChange={event => updateForm('buried', event.target.checked)} className={checkboxCls} />
                {ka ? 'ჩაფლულია მიწაში' : 'Buried in earth'}
              </label>
              <div className="md:col-span-2">
                <FieldLabel required>{ka ? 'ინსპექციის შენიშვნები' : 'Inspection notes'}</FieldLabel>
                <textarea value={form.inspectionNotes} onChange={event => updateForm('inspectionNotes', event.target.value)} className={textareaCls} />
              </div>
            </fieldset>
          </SectionCard>

          <SectionCard title={ka ? 'წარმოების გზა' : 'Production workflow'} icon={Activity}>
            <fieldset disabled={!canUpdateVessel} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 disabled:cursor-not-allowed disabled:opacity-75">
              <div>
                <FieldLabel required>{ka ? 'შევსების თარიღი' : 'Filling date'}</FieldLabel>
                <DateInput lang={lang} value={form.fillingDate} onValueChange={value => updateForm('fillingDate', value)} className={inputCls} required />
              </div>
              <div>
                <FieldLabel required>{ka ? 'ყურძნის ჯიში' : 'Grape variety'}</FieldLabel>
                <input value={form.grapeVariety} onChange={event => updateForm('grapeVariety', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel>{ka ? 'ჭაჭა %' : 'Chacha percentage'}</FieldLabel>
                <input type="number" min="0" max="100" step="1" value={form.chachaPercentage} onChange={event => updateForm('chachaPercentage', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>{ka ? 'დალუქვის თარიღი' : 'Sealing date'}</FieldLabel>
                <DateInput lang={lang} value={form.sealingDate} onValueChange={value => updateForm('sealingDate', value)} className={inputCls} required />
              </div>
              <div>
                <FieldLabel>{ka ? 'გახსნის თარიღი' : 'Opening date'}</FieldLabel>
                <DateInput lang={lang} value={form.openingDate} onValueChange={value => updateForm('openingDate', value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel>{ka ? 'პირველი გადატანა' : 'First racking date'}</FieldLabel>
                <DateInput lang={lang} value={form.firstRackingDate} onValueChange={value => updateForm('firstRackingDate', value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel>{ka ? 'კანთან კონტაქტი დღეებში' : 'Skin contact days'}</FieldLabel>
                <input type="number" min="0" step="1" value={form.skinContactDurationDays} onChange={event => updateForm('skinContactDurationDays', event.target.value)} className={inputCls} />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>{ka ? 'დარევის სიხშირე' : 'Mixing frequency'}</FieldLabel>
                <input value={form.mixingFrequency} onChange={event => updateForm('mixingFrequency', event.target.value)} className={inputCls} />
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
                <input type="checkbox" checked={form.stemInclusion} onChange={event => updateForm('stemInclusion', event.target.checked)} className={checkboxCls} />
                {ka ? 'კლერტი ჩართულია' : 'Stem inclusion'}
              </label>
            </fieldset>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={ka ? 'დაკავშირებული ჩანაწერები' : 'Linked evidence'} icon={FileText}>
            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-black text-stone-800 dark:text-stone-100">{assignedLot?.name || 'No lot assigned'}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-stone-500 dark:text-stone-400">{summary.variety || 'No variety'} · {summary.lotId || '--'}</div>
                  </div>
                  <StatusBadge tone={assignedLot ? 'success' : 'warning'}>{assignedLot ? assignedLot.stage : 'Open'}</StatusBadge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
                  <div className="text-[10px] font-mono font-black uppercase tracking-wide text-stone-500">Ferm logs</div>
                  <div className="mt-1 text-lg font-black text-[#4e0e15] dark:text-amber-200">{summary.fermentationLogCount}</div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-950">
                  <div className="text-[10px] font-mono font-black uppercase tracking-wide text-stone-500">Sanitation</div>
                  <div className="mt-1 text-lg font-black text-[#4e0e15] dark:text-amber-200">{summary.sanitationCount}</div>
                </div>
              </div>
              <div className="text-[11px] font-semibold leading-relaxed text-stone-500 dark:text-stone-400">
                {ka ? 'ბოლო დუღილი' : 'Latest fermentation'}: {latestFermLog ? `${latestFermLog.date} · ${latestFermLog.temperature} C · ${latestFermLog.density}` : (ka ? 'ჩანაწერი არ არის' : 'No reading')}
              </div>
              <div className="text-[11px] font-semibold leading-relaxed text-stone-500 dark:text-stone-400">
                {ka ? 'ოფიციალური ჩანაწერები' : 'Official records'}: {officialRecords.length ? officialRecords.map(record => `${record.id} (${record.applicationStatus})`).join(', ') : (ka ? 'მიბმული არ არის' : 'None linked')}
              </div>
            </div>
          </SectionCard>

          <SectionCard title={ka ? 'ყოველდღიური დარევა' : 'Daily mixing log'} icon={ClipboardList}>
            <div className="space-y-3">
              {canUpdateVessel && (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
                    <DateInput lang={lang} value={mixingDraft.date} onValueChange={value => setMixingDraft(prev => ({ ...prev, date: value }))} className={inputCls} required />
                    <input value={mixingDraft.action} onChange={event => setMixingDraft(prev => ({ ...prev, action: event.target.value }))} className={inputCls} />
                  </div>
                  <input value={mixingDraft.operator} onChange={event => setMixingDraft(prev => ({ ...prev, operator: event.target.value }))} className={inputCls} placeholder="Operator" />
                  <textarea value={mixingDraft.notes} onChange={event => setMixingDraft(prev => ({ ...prev, notes: event.target.value }))} className={textareaCls} placeholder="Notes" />
                  <ActionButton onClick={handleAddMixing} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />{ka ? 'დარევის დამატება' : 'Add mixing'}
                  </ActionButton>
                </div>
              )}
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {sortLogs(selectedVessel.dailyMixingLog || []).map((entry, index) => (
                  <LogRow key={`${entry.date}-${entry.action}-${index}`} entry={entry} />
                ))}
                {(!selectedVessel.dailyMixingLog || selectedVessel.dailyMixingLog.length === 0) && (
                  <p className="text-[11px] font-semibold text-stone-500">{ka ? 'დარევის ჩანაწერი არ არის.' : 'No mixing entries.'}</p>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title={ka ? 'სანიტარია' : 'Sanitation history'} icon={ShieldCheck}>
            <div className="space-y-3">
              {canUpdateVessel && (
                <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
                    <DateInput lang={lang} value={sanitationDraft.date} onValueChange={value => setSanitationDraft(prev => ({ ...prev, date: value }))} className={inputCls} required />
                    <input value={sanitationDraft.action} onChange={event => setSanitationDraft(prev => ({ ...prev, action: event.target.value }))} className={inputCls} />
                  </div>
                  <input value={sanitationDraft.operator} onChange={event => setSanitationDraft(prev => ({ ...prev, operator: event.target.value }))} className={inputCls} placeholder="Operator" />
                  <textarea value={sanitationDraft.notes} onChange={event => setSanitationDraft(prev => ({ ...prev, notes: event.target.value }))} className={textareaCls} placeholder="Notes" />
                  <ActionButton onClick={handleAddSanitation} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />{ka ? 'სანიტარიის დამატება' : 'Add sanitation'}
                  </ActionButton>
                </div>
              )}
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {sortLogs(selectedVessel.sanitationHistory || []).map((entry, index) => (
                  <LogRow key={`${entry.date}-${entry.action}-${index}`} entry={entry} />
                ))}
                {sanitationOps.slice(0, 3).map(op => (
                  <LogRow key={op.id} entry={{ date: op.date.slice(0, 10), action: op.customLabel || 'Cleaning operation', operator: op.operator, notes: op.notes }} />
                ))}
                {(!selectedVessel.sanitationHistory || selectedVessel.sanitationHistory.length === 0) && sanitationOps.length === 0 && (
                  <p className="text-[11px] font-semibold text-stone-500">{ka ? 'სანიტარიის ჩანაწერი არ არის.' : 'No sanitation entries.'}</p>
                )}
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: QvevriLogEntry }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-xs dark:border-stone-800 dark:bg-stone-950">
      <div className="flex items-start justify-between gap-2">
        <span className="font-black text-stone-800 dark:text-stone-100">{entry.action}</span>
        <span className="shrink-0 text-[10px] font-mono font-bold text-stone-500">{formatDate(entry.date)}</span>
      </div>
      {(entry.operator || entry.notes) && (
        <p className="mt-1 text-[11px] font-semibold leading-relaxed text-stone-500 dark:text-stone-400">
          {entry.operator ? `${entry.operator}${entry.notes ? ' - ' : ''}` : ''}{entry.notes || ''}
        </p>
      )}
    </div>
  );
}
