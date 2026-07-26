import React, { lazy, Suspense, useState, useMemo, useEffect, useRef } from 'react';
import type {
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
  UserProfile
} from '../lib/wineryState';
import type { Language } from '../lib/i18n';
import WeatherTab from './WeatherTab';
import LocationPicker from './LocationPicker';
import IpmPhenoscheme from './IpmPhenoscheme';
import VineyardProjectsTab from './VineyardProjectsTab';
import { useFocusTrap } from './useFocusTrap';
import { calculateCadastreCompleteness, cadastreBadgeLabel } from '../lib/cadastre';
import { calculateVaziRisk, vaziRiskColor } from '../lib/vaziRisk';
import type { VaziRiskSummary, VaziWeatherRiskInput } from '../lib/vaziRisk';
import { GEORGIAN_GRAPE_VARIETIES, GEORGIAN_WINE_REGIONS } from '../lib/georgianWineKnowledge';
import {
  appendBoundaryPoint,
  hasUsableBoundary,
  removeBoundaryPoint,
  validateVineyardBoundary,
  vineyardBlockBoundary,
  vineyardBlockGeoJsonFeature,
  vineyardPolygonAreaHectares,
  type VineyardBoundaryValidation,
} from '../lib/vineyardMap';
import { fetchDayWeather, localISODate } from '../lib/weatherApi';
import type { DayWeather } from '../lib/weatherApi';
import {
  Mountain, Wind, Sun, Layers, Plus,
  AlertTriangle, Check, Calendar,
  FlaskConical, BarChart3, TrendingUp,
  MapPin, ArrowRight,
  Sprout, FileText, CheckSquare, Info, ShieldAlert
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';

const VineyardMap = lazy(() => import('./VineyardMap'));

function VineyardMapLoading({ lang }: { lang: Language }) {
  return (
    <div className="flex h-full min-h-[160px] items-center justify-center rounded-lg bg-stone-100 text-[10px] font-semibold text-stone-500">
      {lang === 'ka' ? 'რუკა იტვირთება…' : 'Loading map…'}
    </div>
  );
}

type LiveBlockWeather = VaziWeatherRiskInput & {
  temp: number;
  rainMm: number;
  wind: number;
  humidity: number;
  tempMax: number;
  tempMin: number;
  frostRisk: string;
  heatStress: string;
  sprayConditions: string;
  diseasePressure: string;
};

function toLiveBlockWeather(weather: DayWeather): LiveBlockWeather {
  const temp = weather.current?.temp
    ?? (weather.daily.tempMax + weather.daily.tempMin) / 2;
  const wind = weather.current?.wind ?? weather.daily.windMax;
  const humidity = weather.current?.humidity ?? 0;
  const rainMm = weather.daily.precipSum;

  return {
    temp: Math.round(temp),
    rainMm,
    wind: Math.round(wind),
    humidity,
    tempMax: weather.daily.tempMax,
    tempMin: weather.daily.tempMin,
    frostRisk: weather.daily.tempMin < 2 ? 'High' : weather.daily.tempMin < 5 ? 'Medium' : 'None',
    heatStress: weather.daily.tempMax > 35 ? 'Severe' : weather.daily.tempMax > 30 ? 'Moderate' : 'Optimum',
    sprayConditions: wind > 14 ? 'Unsafe (High Wind)' : rainMm > 0 ? 'Unsafe (Rain)' : 'Suitable',
    diseasePressure: humidity > 75 && temp > 18 && rainMm > 0 ? 'High (Downy Mildew Risk)' : 'Low',
  };
}

function boundaryValidationMessage(
  validation: VineyardBoundaryValidation,
  lang: Language,
): string {
  if (validation.valid) {
    return lang === 'ka'
      ? `გაზომილი ფართობი: ${validation.areaHectares.toFixed(2)} ჰა`
      : `Measured area: ${validation.areaHectares.toFixed(2)} ha`;
  }
  if (validation.reason === 'self-intersection') {
    return lang === 'ka'
      ? 'საზღვარი იკვეთება — წაშალეთ ან გადაალაგეთ გადამკვეთი წერტილი.'
      : 'Boundary lines cross — remove or redraw the crossing vertex.';
  }
  if (validation.reason === 'zero-area') {
    return lang === 'ka'
      ? 'წერტილები გამოსადეგ ფართობს არ ქმნის.'
      : 'The points do not form a measurable area.';
  }
  return lang === 'ka'
    ? `დაამატეთ მინიმუმ 3 წერტილი · ${validation.areaHectares.toFixed(2)} ჰა`
    : `Add at least 3 points · ${validation.areaHectares.toFixed(2)} ha`;
}

function downloadBlockGeoJson(block: VineyardBlock): void {
  const feature = vineyardBlockGeoJsonFeature(block);
  const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${block.name.trim().replace(/[^a-z0-9_-]+/gi, '-') || block.id}.geojson`;
  link.click();
  URL.revokeObjectURL(url);
}

type NavigationTarget = {
  module: 'portal' | 'vazi' | 'gvino' | 'integrations' | 'settings' | 'audit' | 'docs' | 'costs' | 'storage' | 'sales' | 'analytics';
  tab?: string;
};

interface VaziModuleProps {
  lang: Language;
  currentUser: UserProfile;
  blocks: VineyardBlock[];
  phenologyLogs: PhenologyRecord[];
  sprays: SprayRecord[];
  scoutings: ScoutingRecord[];
  soilRecords: SoilAnalysisRecord[];
  vineyardProjects: VineyardPlantingProject[];
  samplings: GrapeSamplingRecord[];
  harvests: HarvestRecord[];
  irrigationLogs: IrrigationRecord[];
  fertilizerLogs: FertilizationRecord[];

  onAddBlock: (block: Omit<VineyardBlock, 'id'>) => void;
  onUpdateBlock: (id: string, updated: Partial<VineyardBlock>) => void;
  onAddVineyardProject: (project: Omit<VineyardPlantingProject, 'id'>) => void;
  onUpdateVineyardProject: (id: string, updated: Partial<VineyardPlantingProject>) => void;
  onAddPhenologyLog: (log: Omit<PhenologyRecord, 'id'>) => void;
  onAddSprayRecord: (rec: Omit<SprayRecord, 'id'>) => void;
  onAddScoutingRecord: (rec: Omit<ScoutingRecord, 'id'>) => void;
  onAddSamplings: (rec: Omit<GrapeSamplingRecord, 'id'>) => void;
  onAddHarvestRecord: (rec: Omit<HarvestRecord, 'id'>) => void;
  onUpdateHarvestRecord: (id: string, updated: Partial<HarvestRecord>) => void;
  onSendHarvestToGvino: (blockId: string, harvestedKg: number, variety: string, vintage: number, harvestedDate: string) => string; // Returns Gvino Lot ID
  /** Canonical handoff: open the full intake form with this harvest prefilled. */
  onPrepareHarvestIntake?: (harvestId: string) => void;
  onAddIrrigation: (rec: Omit<IrrigationRecord, 'id'>) => void;
  onAddFertilizer: (rec: Omit<FertilizationRecord, 'id'>) => void;
  setActiveModule?: (mod: NavigationTarget['module']) => void;
  setActiveTab?: (tab: string) => void;
  onNavigate?: (target: NavigationTarget) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
  canCreateVineyardRecord?: boolean;
  canUpdateVineyardRecord?: boolean;
  canDeleteVineyardRecord?: boolean;
  canCreateVineyardProject?: boolean;
  canUpdateVineyardProject?: boolean;
  canDispatchHarvestToGvino?: boolean;
  canCreateTask?: boolean;
}

export function runVaziMutationIfAllowed<T>(
  allowed: boolean,
  mutation: () => T,
): T | undefined {
  if (!allowed) return undefined;
  return mutation();
}

export type HarvestDispatchParseResult =
  | {
      ok: true;
      harvestedKg: number;
      actualHarvestDate: string;
      vintage: number;
    }
  | {
      ok: false;
      reason: 'weight_required' | 'weight_invalid' | 'date_invalid';
    };

type HarvestDispatchErrorReason = Extract<HarvestDispatchParseResult, { ok: false }>['reason'];

export type HarvestPlanParseResult =
  | {
      ok: true;
      estimatedHarvestDate: string;
      estimatedTons: number;
    }
  | {
      ok: false;
      errors: {
        estimatedHarvestDate?: 'date_required' | 'date_invalid';
        estimatedTons?: 'tons_required' | 'tons_invalid';
      };
    };

const isValidISODate = (value: string) => {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateMatch) return false;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isInteger(year)
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

/** Validates the two quantitative fields required before a harvest plan can be saved. */
export function parseHarvestPlanInput(
  rawTargetDate: string,
  rawEstimatedTons: string,
): HarvestPlanParseResult {
  const targetDate = rawTargetDate.trim();
  const rawTons = rawEstimatedTons.trim();
  const errors: Extract<HarvestPlanParseResult, { ok: false }>['errors'] = {};

  if (!targetDate) errors.estimatedHarvestDate = 'date_required';
  else if (!isValidISODate(targetDate)) errors.estimatedHarvestDate = 'date_invalid';

  if (!rawTons) errors.estimatedTons = 'tons_required';
  else {
    const estimatedTons = Number(rawTons);
    if (!Number.isFinite(estimatedTons) || estimatedTons <= 0) {
      errors.estimatedTons = 'tons_invalid';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    estimatedHarvestDate: targetDate,
    estimatedTons: Number(rawTons),
  };
}

interface HarvestPlanFormProps {
  lang: Language;
  block: VineyardBlock;
  onCreate: (record: Omit<HarvestRecord, 'id'>) => void;
  onCancel: () => void;
}

/** Inline harvest-plan editor kept separate so its labels and validation contract remain testable. */
export function HarvestPlanForm({ lang, block, onCreate, onCancel }: HarvestPlanFormProps) {
  const initialTargetDate = isValidISODate(block.estimatedHarvestDate)
    ? block.estimatedHarvestDate
    : '';
  const [targetDate, setTargetDate] = useState(initialTargetDate);
  const [estimatedTons, setEstimatedTons] = useState('');
  const [pickingMethod, setPickingMethod] = useState<HarvestRecord['pickingMethod']>('hand');
  const [grapeCondition, setGrapeCondition] = useState<HarvestRecord['grapeCondition']>('good');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Extract<HarvestPlanParseResult, { ok: false }>['errors']>({});
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const fieldIdPrefix = `harvest-plan-${block.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  useEffect(() => {
    dateInputRef.current?.focus();
  }, []);

  const resetFields = () => {
    setTargetDate(initialTargetDate);
    setEstimatedTons('');
    setPickingMethod('hand');
    setGrapeCondition('good');
    setNotes('');
    setErrors({});
  };

  return (
    <form
      aria-labelledby={`${fieldIdPrefix}-title`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseHarvestPlanInput(targetDate, estimatedTons);
        if (!parsed.ok) {
          setErrors(parsed.errors);
          return;
        }

        onCreate({
          blockId: block.id,
          variety: block.grapeVariety,
          estimatedHarvestDate: parsed.estimatedHarvestDate,
          estimatedTons: parsed.estimatedTons,
          pickingMethod,
          grapeCondition,
          sentToGvino: false,
          notes: notes.trim(),
        });
      }}
      className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"
    >
      <div className="mb-4">
        <h5 id={`${fieldIdPrefix}-title`} className="font-serif text-sm font-black text-emerald-950">
          {lang === 'ka' ? 'რთველის ახალი გეგმა' : 'New harvest plan'}
        </h5>
        <p id={`${fieldIdPrefix}-guidance`} className="mt-1 text-[11px] leading-relaxed text-emerald-900/75">
          {lang === 'ka'
            ? `${block.name}-ისთვის მიუთითეთ სამიზნე თარიღი და მოსალოდნელი მოსავალი. ფაქტობრივ წონას მარანში გადაცემისას შეიყვანთ.`
            : `Set a target date and expected yield for ${block.name}. You will record the actual weight when the fruit is dispatched.`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${fieldIdPrefix}-date`} className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-emerald-950">
            {lang === 'ka' ? 'სამიზნე თარიღი' : 'Target harvest date'}
          </label>
          <input
            ref={dateInputRef}
            id={`${fieldIdPrefix}-date`}
            type="date"
            value={targetDate}
            required
            aria-invalid={Boolean(errors.estimatedHarvestDate)}
            aria-describedby={errors.estimatedHarvestDate ? `${fieldIdPrefix}-date-error` : `${fieldIdPrefix}-guidance`}
            onChange={(event) => {
              setTargetDate(event.target.value);
              setErrors(current => ({ ...current, estimatedHarvestDate: undefined }));
            }}
            className={`h-10 w-full rounded-lg border bg-white px-3 text-xs font-mono text-stone-900 outline-none focus:ring-2 focus:ring-emerald-200 ${errors.estimatedHarvestDate ? 'border-red-500' : 'border-emerald-200 focus:border-emerald-700'}`}
          />
          {errors.estimatedHarvestDate && (
            <p id={`${fieldIdPrefix}-date-error`} role="alert" className="mt-1 text-[10px] font-semibold text-red-700">
              {errors.estimatedHarvestDate === 'date_required'
                ? (lang === 'ka' ? 'აირჩიეთ რთველის სამიზნე თარიღი.' : 'Choose a target harvest date.')
                : (lang === 'ka' ? 'შეიყვანეთ სწორი კალენდარული თარიღი.' : 'Enter a valid calendar date.')}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${fieldIdPrefix}-tons`} className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-emerald-950">
            {lang === 'ka' ? 'სავარაუდო მოსავალი (ტონა)' : 'Estimated yield (tons)'}
          </label>
          <input
            id={`${fieldIdPrefix}-tons`}
            type="number"
            inputMode="decimal"
            min="0.001"
            step="any"
            value={estimatedTons}
            required
            placeholder={lang === 'ka' ? 'მაგ. 8.5' : 'e.g. 8.5'}
            aria-invalid={Boolean(errors.estimatedTons)}
            aria-describedby={errors.estimatedTons ? `${fieldIdPrefix}-tons-error` : undefined}
            onChange={(event) => {
              setEstimatedTons(event.target.value);
              setErrors(current => ({ ...current, estimatedTons: undefined }));
            }}
            className={`h-10 w-full rounded-lg border bg-white px-3 text-xs font-mono text-stone-900 outline-none focus:ring-2 focus:ring-emerald-200 ${errors.estimatedTons ? 'border-red-500' : 'border-emerald-200 focus:border-emerald-700'}`}
          />
          {errors.estimatedTons && (
            <p id={`${fieldIdPrefix}-tons-error`} role="alert" className="mt-1 text-[10px] font-semibold text-red-700">
              {errors.estimatedTons === 'tons_required'
                ? (lang === 'ka' ? 'შეიყვანეთ სავარაუდო მოსავალი.' : 'Enter the estimated yield.')
                : (lang === 'ka' ? 'მოსავალი უნდა იყოს 0 ტონაზე მეტი.' : 'Estimated yield must be greater than 0 tons.')}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={`${fieldIdPrefix}-method`} className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-emerald-950">
            {lang === 'ka' ? 'კრეფის მეთოდი' : 'Picking method'}
          </label>
          <select
            id={`${fieldIdPrefix}-method`}
            value={pickingMethod}
            onChange={(event) => setPickingMethod(event.target.value as HarvestRecord['pickingMethod'])}
            className="h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-xs text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-200"
          >
            <option value="hand">{lang === 'ka' ? 'ხელით' : 'Hand-picked'}</option>
            <option value="machine">{lang === 'ka' ? 'მექანიკურად' : 'Machine-picked'}</option>
          </select>
        </div>

        <div>
          <label htmlFor={`${fieldIdPrefix}-condition`} className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-emerald-950">
            {lang === 'ka' ? 'ყურძნის მოსალოდნელი მდგომარეობა' : 'Expected grape condition'}
          </label>
          <select
            id={`${fieldIdPrefix}-condition`}
            value={grapeCondition}
            onChange={(event) => setGrapeCondition(event.target.value as HarvestRecord['grapeCondition'])}
            className="h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 text-xs text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-200"
          >
            <option value="excellent">{lang === 'ka' ? 'შესანიშნავი' : 'Excellent'}</option>
            <option value="good">{lang === 'ka' ? 'კარგი' : 'Good'}</option>
            <option value=" fair">{lang === 'ka' ? 'დამაკმაყოფილებელი' : 'Fair'}</option>
            <option value="damaged">{lang === 'ka' ? 'დაზიანებული' : 'Damaged'}</option>
          </select>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`${fieldIdPrefix}-notes`} className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-emerald-950">
          {lang === 'ka' ? 'ინსტრუქციები და შენიშვნები' : 'Picking instructions and notes'}
        </label>
        <textarea
          id={`${fieldIdPrefix}-notes`}
          value={notes}
          rows={3}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={lang === 'ka' ? 'მაგ. კრეფა დილით, მცირე ყუთებში' : 'e.g. Pick in the morning and use small crates'}
          className="w-full resize-y rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-200"
        />
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => {
            resetFields();
            onCancel();
          }}
          className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-950 hover:bg-emerald-100"
        >
          {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
        </button>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-800 px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white hover:bg-emerald-950"
        >
          <Check className="h-3.5 w-3.5" /> {lang === 'ka' ? 'გეგმის შენახვა' : 'Save harvest plan'}
        </button>
      </div>
    </form>
  );
}

/** Converts the explicit handoff fields into the values shared by Vazi and Gvino. */
export function parseHarvestDispatchInput(
  rawWeight: string,
  actualHarvestDate: string,
): HarvestDispatchParseResult {
  const trimmedWeight = rawWeight.trim();
  if (!trimmedWeight) return { ok: false, reason: 'weight_required' };

  const harvestedKg = Number(trimmedWeight);
  if (!Number.isFinite(harvestedKg) || harvestedKg <= 0) {
    return { ok: false, reason: 'weight_invalid' };
  }

  if (!isValidISODate(actualHarvestDate)) return { ok: false, reason: 'date_invalid' };
  const vintage = Number(actualHarvestDate.slice(0, 4));

  return { ok: true, harvestedKg, actualHarvestDate, vintage };
}

const optionalText = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const cadastreBadgeClass = (score: number, missingCriticalCount: number) => {
  if (missingCriticalCount > 0) return 'bg-amber-50 text-amber-800 border-amber-200';
  if (score >= 85) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  return 'bg-stone-100 text-stone-700 border-stone-200';
};

// Phenology stages are stored as English values (state/data); localize display only.
const PHENOLOGY_STAGES = [
  'Dormancy / before bud swelling',
  'Budburst',
  'Budburst / early shoot growth',
  '4-6 leaves / inflorescences visible',
  'Pre-flowering',
  'Flowering',
  'Fruit set',
  'Post-flowering / fruit set',
  'Pea-size berry / berry growth',
  'Bunch closure',
  'Veraison',
  'Ripening',
  'Pre-harvest / ripening',
] as const;
const PHENOLOGY_KA: Record<string, string> = {
  'Dormancy / before bud swelling': 'მოსვენება / კვირტის დაბერვამდე',
  'Budburst': 'კვირტის გაშლა',
  'Budburst / early shoot growth': 'კვირტის გაშლა / ყლორტის ადრეული ზრდა',
  '4-6 leaves / inflorescences visible': '4-6 ფოთოლი / ყვავილედები ჩანს',
  'Pre-flowering': 'ყვავილობამდე',
  'Flowering': 'ყვავილობა',
  'Fruit set': 'ნაყოფის გამონასკვა',
  'Post-flowering / fruit set': 'ყვავილობის შემდეგ / გამონასკვა',
  'Pea-size berry / berry growth': 'ბარდისებრი მარცვალი / მარცვლის ზრდა',
  'Bunch closure': 'მტევნის შეკვრა',
  'Veraison': 'შეთვალება',
  'Ripening': 'მწიფობა',
  'Pre-harvest / ripening': 'რთველამდე / მწიფობა',
};
const phenologyLabel = (stage: string, lang: string) =>
  (lang === 'ka' && PHENOLOGY_KA[stage]) ? PHENOLOGY_KA[stage] : stage;
const GEORGIAN_MICROZONE_OPTIONS = Array.from(new Set(GEORGIAN_WINE_REGIONS.flatMap(region => region.mainMicrozones))).sort();

export default function VaziModule({
  lang,
  currentUser,
  blocks,
  phenologyLogs,
  sprays,
  scoutings,
  vineyardProjects,
  samplings,
  harvests,
  irrigationLogs,
  onAddBlock,
  onUpdateBlock,
  onAddVineyardProject,
  onUpdateVineyardProject,
  onAddPhenologyLog,
  onAddSprayRecord,
  onAddScoutingRecord,
  onAddSamplings,
  onAddHarvestRecord,
  onUpdateHarvestRecord,
  onSendHarvestToGvino,
  onPrepareHarvestIntake,
  setActiveModule,
  setActiveTab,
  onNavigate,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc,
  canCreateVineyardRecord = true,
  canUpdateVineyardRecord = true,
  canDeleteVineyardRecord = true,
  canCreateVineyardProject = true,
  canUpdateVineyardProject = true,
  canDispatchHarvestToGvino = true,
  canCreateTask = true,
}: VaziModuleProps) {
  const [vaziTab, setVaziTab] = useState<'dashboard' | 'blocks' | 'projects' | 'tasks' | 'spraying' | 'scouting' | 'sampling' | 'yield' | 'weather' | 'ipm_pheno'>('dashboard');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [harvestDispatchWeights, setHarvestDispatchWeights] = useState<Record<string, string>>({});
  const [harvestDispatchDates, setHarvestDispatchDates] = useState<Record<string, string>>({});
  const [harvestDispatchErrors, setHarvestDispatchErrors] = useState<Record<string, HarvestDispatchErrorReason>>({});
  const [showHarvestPlanForm, setShowHarvestPlanForm] = useState(false);
  const [harvestPlanStatus, setHarvestPlanStatus] = useState<{
    blockName: string;
    targetDate: string;
  } | null>(null);
  const [harvestDispatchStatus, setHarvestDispatchStatus] = useState<{
    harvestedKg: number;
    variety: string;
    lotId: string;
  } | null>(null);
  const dispatchNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mapOverlay, setMapOverlay] = useState<'mildew' | 'moisture' | 'phenology'>('mildew');

  // Adding state
  const [showAddBlockModal, setShowAddBlockModal] = useState(false);
  const addBlockDialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(addBlockDialogRef, { active: showAddBlockModal, onClose: () => setShowAddBlockModal(false) });
  const [addBlockLat, setAddBlockLat] = useState<number>(41.9567);
  const [addBlockLng, setAddBlockLng] = useState<number>(45.4851);
  const [addBlockLocName, setAddBlockLocName] = useState<string>('Kakheti, Georgia');
  const [addBlockElev, setAddBlockElev] = useState<number>(350);
  const [isDrawingPolygon, setIsDrawingPolygon] = useState(false);
  // Real-map polygon (add-block form): geographic boundary saved to the block.
  const [drawnPoints, setDrawnPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [isEditingBlockBoundary, setIsEditingBlockBoundary] = useState(false);
  const [editingBoundaryPoints, setEditingBoundaryPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [editingPointLat, setEditingPointLat] = useState(41.9056);
  const [editingPointLng, setEditingPointLng] = useState(45.474);

  useEffect(() => {
    if (blocks.length === 0) {
      if (selectedBlockId !== null) setSelectedBlockId(null);
      return;
    }
    if (!selectedBlockId || !blocks.some(block => block.id === selectedBlockId)) {
      setSelectedBlockId(blocks[0].id);
    }
  }, [blocks, selectedBlockId]);

  useEffect(() => {
    if (!canCreateVineyardRecord) {
      setShowAddBlockModal(false);
      setShowHarvestPlanForm(false);
    }
  }, [canCreateVineyardRecord]);

  useEffect(() => () => {
    if (dispatchNavigationTimerRef.current) clearTimeout(dispatchNavigationTimerRef.current);
  }, []);

  const defaultCenter = useMemo(() => {
    if (blocks && blocks.length > 0) {
      const validBlocks = blocks.filter(b => typeof b.latitude === 'number' && typeof b.longitude === 'number');
      if (validBlocks.length > 0) {
        const sumLat = validBlocks.reduce((sum, b) => sum + b.latitude, 0);
        const sumLng = validBlocks.reduce((sum, b) => sum + b.longitude, 0);
        return { lat: sumLat / validBlocks.length, lng: sumLng / validBlocks.length };
      }
    }
    return { lat: 41.9056, lng: 45.474 };
  }, [blocks]);

  // Multilingual translations lookups
  const label = {
    title: {
      en: 'Vazi — Vineyard Management',
      ka: 'ვაზი — ვენახების მართვა',
      it: 'Vazi — Gestione del Vigneto',
      fr: 'Vazi — Viticulture & Vignoble',
      de: 'Vazi — Weinberg-Management'
    }[lang] || 'Vazi — Vineyard Management',
    tagline: {
      en: 'Pristine canopy health & fruit quality tracking from rows',
      ka: 'სიჯანსაღე და ხარისხი ვენახის რიგებიდან',
      it: 'Tracciamento della salute della chioma e della qualità dei frutti dai filari',
      fr: 'Suivi de la santé du feuillage et de la qualité des fruits des rangs',
      de: 'Ertrags- und Laubwerküberwachung direkt aus den Rebzeilen'
    }[lang] || 'Pristine canopy health & fruit quality tracking from rows',
    allBlocks: {
      en: 'All Vineyard Blocks',
      ka: 'ყველა ვენახის ნაკვეთი',
      it: 'Tutti i Lotti di Vigneto',
      fr: 'Toutes les Parcelles',
      de: 'Alle Weinbergsparzellen'
    }[lang] || 'All Vineyard Blocks',
    area: {
      en: 'Area (Hectares)',
      ka: 'ფართობი (ჰა)',
      it: 'Superficie (Ettari)',
      fr: 'Superficie (Hectares)',
      de: 'Fläche (Hektar)'
    }[lang] || 'Area (Hectares)',
    elevation: {
      en: 'Elevation',
      ka: 'სიმაღლე ზღ.დ.',
      it: 'Altitudine',
      fr: 'Altitude',
      de: 'Höhe'
    }[lang] || 'Elevation',
    grapeVariety: {
      en: 'Grape Variety',
      ka: 'ყურძნის ჯიში',
      it: 'Vitigno',
      fr: 'Cépage',
      de: 'Rebsorte'
    }[lang] || 'Grape Variety',
    phenology: {
      en: 'Phenological Stage',
      ka: 'ფენოლოგიური ფაზა',
      it: 'Fase Fenologica',
      fr: 'Stade Phénologique',
      de: 'Phänologisches Stadium'
    }[lang] || 'Phenological Stage',
    harvestEst: {
      en: 'Est. Harvest Date',
      ka: 'მოსავლის თარიღი',
      it: 'Data di Vendemmia Prevista',
      fr: 'Date de Récolte Estimée',
      de: 'Voraussichtliche Ernte'
    }[lang] || 'Est. Harvest Date',
    addBlock: {
      en: 'Add Vineyard Block',
      ka: 'ახალი ნაკვეთის დამატება',
      it: 'Aggiungi Lotto Vigneto',
      fr: 'Ajouter une Parcelle',
      de: 'Weinbergsparzelle hinzufügen'
    }[lang] || 'Add Vineyard Block',
    blockName: {
      en: 'Block Name / Code',
      ka: 'ნაკვეთის დასახელება',
      it: 'Nome / Codice Lotto',
      fr: 'Nom / Code de Parcelle',
      de: 'Name / Vorgabe'
    }[lang] || 'Block Name / Code',
    coordinates: {
      en: 'Coordinates',
      ka: 'კოორდინატები',
      it: 'Coordinate',
      fr: 'Coordonnées',
      de: 'Koordinaten'
    }[lang] || 'Coordinates',
    soilType: {
      en: 'Soil Type',
      ka: 'ნიადაგის ტიპი',
      it: 'Tipo di Suolo',
      fr: 'Type de Sol',
      de: 'Bodentyp'
    }[lang] || 'Soil Type',
    vinesCount: {
      en: 'Number of Vines',
      ka: 'ვაზის რაოდენობა',
      it: 'Numero di Viti',
      fr: 'Nombre de Vignes',
      de: 'Rebenanzahl'
    }[lang] || 'Number of Vines',
    irrigation: {
      en: 'Irrigation',
      ka: 'მორწყვა',
      it: 'Irrigazione',
      fr: 'Irrigation',
      de: 'Bewässerung'
    }[lang] || 'Irrigation',
    yes: {
      en: 'Yes',
      ka: 'დიახ',
      it: 'Sì',
      fr: 'Oui',
      de: 'Ja'
    }[lang] || 'Yes',
    no: {
      en: 'No',
      ka: 'არა',
      it: 'No',
      fr: 'Non',
      de: 'Nein'
    }[lang] || 'No'
  };

  // Find selected block
  const selectedBlock = useMemo(() => {
    return blocks.find(b => b.id === selectedBlockId) || null;
  }, [blocks, selectedBlockId]);
  const selectedBlockKey = selectedBlock?.id;
  const selectedBlockLatitude = selectedBlock?.latitude;
  const selectedBlockLongitude = selectedBlock?.longitude;

  useEffect(() => {
    setShowHarvestPlanForm(false);
    setHarvestPlanStatus(null);
    setHarvestDispatchStatus(null);
    setIsEditingBlockBoundary(false);
    setEditingBoundaryPoints([]);
    if (selectedBlockLatitude !== undefined && selectedBlockLongitude !== undefined) {
      setEditingPointLat(selectedBlockLatitude);
      setEditingPointLng(selectedBlockLongitude);
    }
  }, [selectedBlockKey, selectedBlockLatitude, selectedBlockLongitude]);
  const selectedCadastre = useMemo(() => {
    return selectedBlock ? calculateCadastreCompleteness(selectedBlock) : null;
  }, [selectedBlock]);

  const navigateTo = (target: NavigationTarget) => {
    if (onNavigate) {
      onNavigate(target);
      return;
    }
    setActiveModule?.(target.module);
    if (target.tab) setActiveTab?.(target.tab);
  };

  const openVaziTab = (tab: typeof vaziTab, blockId = selectedBlockId || blocks[0]?.id) => {
    if (blockId) setSelectedBlockId(blockId);
    setVaziTab(tab);
  };

  // Block Edit States
  const [isEditingBlock, setIsEditingBlock] = useState(false);
  const [editBlockName, setEditBlockName] = useState('');
  const [editVineyardName, setEditVineyardName] = useState('');
  const [editLocationName, setEditLocationName] = useState('');
  const [editArea, setEditArea] = useState(1.0);
  const [editElevation, setEditElevation] = useState(350);
  const [editSlope, setEditSlope] = useState('');
  const [editAspect, setEditAspect] = useState('');
  const [editSoilType, setEditSoilType] = useState('');
  const [editGrapeVariety, setEditGrapeVariety] = useState('');
  const [editPlantingYear, setEditPlantingYear] = useState(2018);
  const [editSpacing, setEditSpacing] = useState('');
  const [editRowsCount, setEditRowsCount] = useState(0);
  const [editVinesCount, setEditVinesCount] = useState(0);
  const [editTrainingSystem, setEditTrainingSystem] = useState('');
  const [editIrrigationEnabled, setEditIrrigationEnabled] = useState(false);
  const [editFarmingStatus, setEditFarmingStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCadastralCode, setEditCadastralCode] = useState('');
  const [editOfficialCadastreDocumentName, setEditOfficialCadastreDocumentName] = useState('');
  const [editLandOwner, setEditLandOwner] = useState('');
  const [editGrower, setEditGrower] = useState('');
  const [editMunicipality, setEditMunicipality] = useState('');
  const [editCommunity, setEditCommunity] = useState('');
  const [editVillage, setEditVillage] = useState('');
  const [editMicrozone, setEditMicrozone] = useState('');
  const [editParcelName, setEditParcelName] = useState('');
  const [editParcelArea, setEditParcelArea] = useState('');
  const [editRootstock, setEditRootstock] = useState('');
  const [editClone, setEditClone] = useState('');
  const [editVineyardCondition, setEditVineyardCondition] = useState('');

  useEffect(() => {
    if (selectedBlock) {
      setEditBlockName(selectedBlock.name);
      setEditVineyardName(selectedBlock.vineyardName);
      setEditLocationName(selectedBlock.locationName);
      setEditArea(selectedBlock.area);
      setEditElevation(selectedBlock.elevation);
      setEditSlope(selectedBlock.slope);
      setEditAspect(selectedBlock.aspect);
      setEditSoilType(selectedBlock.soilType);
      setEditGrapeVariety(selectedBlock.grapeVariety);
      setEditPlantingYear(selectedBlock.plantingYear);
      setEditSpacing(selectedBlock.spacing);
      setEditRowsCount(selectedBlock.rowsCount);
      setEditVinesCount(selectedBlock.vinesCount);
      setEditTrainingSystem(selectedBlock.trainingSystem);
      setEditIrrigationEnabled(selectedBlock.irrigationEnabled);
      setEditFarmingStatus(selectedBlock.farmingStatus);
      setEditNotes(selectedBlock.notes || '');
      setEditCadastralCode(selectedBlock.cadastralCode || '');
      setEditOfficialCadastreDocumentName(selectedBlock.officialCadastreDocumentName || '');
      setEditLandOwner(selectedBlock.landOwner || '');
      setEditGrower(selectedBlock.grower || '');
      setEditMunicipality(selectedBlock.municipality || '');
      setEditCommunity(selectedBlock.community || '');
      setEditVillage(selectedBlock.village || '');
      setEditMicrozone(selectedBlock.microzone || '');
      setEditParcelName(selectedBlock.parcelName || '');
      setEditParcelArea(selectedBlock.parcelArea ? String(selectedBlock.parcelArea) : '');
      setEditRootstock(selectedBlock.rootstock || '');
      setEditClone(selectedBlock.clone || '');
      setEditVineyardCondition(selectedBlock.vineyardCondition || '');
      setIsEditingBlock(false);
    }
  }, [selectedBlockId, selectedBlock]);

  const handleSaveBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBlock || !canUpdateVineyardRecord) return;
    runVaziMutationIfAllowed(canUpdateVineyardRecord, () => onUpdateBlock(selectedBlock.id, {
      name: editBlockName,
      vineyardName: editVineyardName,
      locationName: editLocationName,
      area: Number(editArea) || 0,
      elevation: Number(editElevation) || 0,
      slope: editSlope,
      aspect: editAspect,
      soilType: editSoilType,
      grapeVariety: editGrapeVariety,
      plantingYear: Number(editPlantingYear) || 2018,
      spacing: editSpacing,
      rowsCount: Number(editRowsCount) || 0,
      vinesCount: Number(editVinesCount) || 0,
      trainingSystem: editTrainingSystem,
      irrigationEnabled: editIrrigationEnabled,
      farmingStatus: editFarmingStatus as VineyardBlock['farmingStatus'],
      notes: editNotes,
      cadastralCode: optionalText(editCadastralCode),
      officialCadastreDocumentName: optionalText(editOfficialCadastreDocumentName),
      landOwner: optionalText(editLandOwner),
      grower: optionalText(editGrower),
      municipality: optionalText(editMunicipality),
      community: optionalText(editCommunity),
      village: optionalText(editVillage),
      microzone: optionalText(editMicrozone),
      parcelName: optionalText(editParcelName),
      parcelArea: editParcelArea.trim() ? Number(editParcelArea) || undefined : undefined,
      rootstock: optionalText(editRootstock),
      clone: optionalText(editClone),
      vineyardCondition: optionalText(editVineyardCondition)
    }));
    setIsEditingBlock(false);
  };

  useEffect(() => {
    if (!canUpdateVineyardRecord) setIsEditingBlock(false);
  }, [canUpdateVineyardRecord]);

  // Compute stats
  const totalArea = useMemo(() => blocks.reduce((acc, b) => acc + b.area, 0), [blocks]);
  const totalVines = useMemo(() => blocks.reduce((acc, b) => acc + b.vinesCount, 0), [blocks]);

  const weatherTargets = useMemo(() => (
    blocks.map(block => ({
      id: block.id,
      latitude: block.latitude,
      longitude: block.longitude,
    }))
  ), [blocks]);
  const [blockWeatherDataById, setBlockWeatherDataById] = useState<Record<string, DayWeather>>({});
  const [blockWeatherErrorsById, setBlockWeatherErrorsById] = useState<Record<string, string>>({});
  const [blockWeatherLoading, setBlockWeatherLoading] = useState(false);

  useEffect(() => {
    if (weatherTargets.length === 0) {
      setBlockWeatherDataById({});
      setBlockWeatherErrorsById({});
      setBlockWeatherLoading(false);
      return;
    }

    let active = true;
    setBlockWeatherLoading(true);
    const date = localISODate();
    Promise.allSettled(weatherTargets.map(async target => ({
      id: target.id,
      weather: await fetchDayWeather(target.latitude, target.longitude, date),
    }))).then((results) => {
      if (!active) return;
      const weatherData: Record<string, DayWeather> = {};
      const weatherErrors: Record<string, string> = {};
      results.forEach((result, index) => {
        const blockId = weatherTargets[index].id;
        if (result.status === 'fulfilled') {
          weatherData[blockId] = result.value.weather;
        } else {
          weatherErrors[blockId] = result.reason instanceof Error
            ? result.reason.message
            : 'Live weather is unavailable.';
        }
      });
      setBlockWeatherDataById(weatherData);
      setBlockWeatherErrorsById(weatherErrors);
      setBlockWeatherLoading(false);
    });

    return () => {
      active = false;
    };
  }, [weatherTargets]);

  const blockWeatherById = useMemo<Record<string, LiveBlockWeather>>(() => (
    Object.fromEntries(
      Object.entries(blockWeatherDataById).map(([blockId, weather]) => (
        [blockId, toLiveBlockWeather(weather)]
      )),
    )
  ), [blockWeatherDataById]);
  const mapSelectedBlockId = selectedBlockId || blocks[0]?.id || null;
  const blockWeather = mapSelectedBlockId ? blockWeatherById[mapSelectedBlockId] || null : null;
  const blockWeatherError = mapSelectedBlockId ? blockWeatherErrorsById[mapSelectedBlockId] || '' : '';

  // GDD is a recorded agronomic value, not a synthetic estimate.
  const computedGDD = useMemo(() => {
    if (!selectedBlock) return 0;
    const latest = phenologyLogs
      .filter((record) => record.blockId === selectedBlock.id)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return latest?.gdd ?? 0;
  }, [selectedBlock, phenologyLogs]);

  const blockRiskById = useMemo<Record<string, VaziRiskSummary>>(() => (
    Object.fromEntries(blocks.map(block => [
      block.id,
      calculateVaziRisk({
        block,
        weather: blockWeatherById[block.id] || null,
        sprays,
        scoutings,
        samplings,
        harvests,
        irrigationLogs,
      }),
    ]))
  ), [blocks, blockWeatherById, sprays, scoutings, samplings, harvests, irrigationLogs]);

  const selectedRisk = selectedBlock ? blockRiskById[selectedBlock.id] || null : null;
  const mapSelectedRisk = mapSelectedBlockId ? blockRiskById[mapSelectedBlockId] || null : null;

  const getBlockColor = (blockId: string) => {
    const block = blocks.find(item => item.id === blockId);
    const risk = blockRiskById[blockId];
    if (!block || !risk) return '#e2e8f0';
    if (mapOverlay === 'mildew') {
      const mildewLevel = [
        risk.items.downyMildew,
        risk.items.powderyMildew,
        risk.items.botrytis,
      ].sort((a, b) => b.score - a.score)[0].level;
      return vaziRiskColor(mildewLevel);
    }
    if (mapOverlay === 'moisture') return vaziRiskColor(risk.items.waterStress.level);
    if (block.currentPhenology.toLowerCase().includes('veraison')) return '#8b5cf6';
    if (block.currentPhenology.toLowerCase().includes('ripening')) return '#f43f5e';
    if (block.currentPhenology.toLowerCase().includes('fruit set')) return '#10b981';
    return '#6ee7b7';
  };

  const getBlockTooltipLines = (blockId: string): string[] => {
    const block = blocks.find(item => item.id === blockId);
    const risk = blockRiskById[blockId];
    if (!block || !risk) return [];
    let layerLine: string;
    if (mapOverlay === 'mildew') {
      const item = [
        risk.items.downyMildew,
        risk.items.powderyMildew,
        risk.items.botrytis,
      ].sort((a, b) => b.score - a.score)[0];
      layerLine = lang === 'ka'
        ? `${item.label}: ${item.score}/100`
        : `${item.label}: ${item.level} · ${item.score}/100`;
    } else if (mapOverlay === 'moisture') {
      const item = risk.items.waterStress;
      layerLine = lang === 'ka'
        ? `წყლის სტრესი: ${item.score}/100`
        : `Water stress: ${item.level} · ${item.score}/100`;
    } else {
      layerLine = lang === 'ka'
        ? `ფენოლოგია: ${phenologyLabel(block.currentPhenology, lang)}`
        : `Phenology: ${phenologyLabel(block.currentPhenology, lang)}`;
    }
    const weather = blockWeatherById[blockId];
    const weatherLine = weather
      ? `${weather.temp}°C · ${weather.rainMm} mm · ${weather.humidity}% RH`
      : blockWeatherLoading
        ? (lang === 'ka' ? 'ცოცხალი ამინდი იტვირთება…' : 'Loading live weather…')
        : (lang === 'ka' ? 'ცოცხალი ამინდი მიუწვდომელია' : 'Live weather unavailable');
    return [layerLine, weatherLine];
  };

  const editingBoundaryValidation = useMemo(
    () => validateVineyardBoundary(editingBoundaryPoints),
    [editingBoundaryPoints],
  );
  const drawnBoundaryValidation = useMemo(
    () => validateVineyardBoundary(drawnPoints),
    [drawnPoints],
  );
  const selectedMappedArea = selectedBlock
    ? vineyardPolygonAreaHectares(vineyardBlockBoundary(selectedBlock))
    : 0;
  const selectedHasRecordedBoundary = selectedBlock
    ? hasUsableBoundary(selectedBlock.boundary) || hasUsableBoundary(selectedBlock.gpsPolygon)
    : false;
  const selectedAreaDifferencePercent = selectedBlock?.area
    ? ((selectedMappedArea - selectedBlock.area) / selectedBlock.area) * 100
    : 0;

  return (
    <div id="vazi-sandbox" className="space-y-6 text-stone-800 animate-fade-in font-sans">
      <datalist id="vazi-georgian-variety-options">
        {GEORGIAN_GRAPE_VARIETIES.map(item => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>
      <datalist id="vazi-georgian-microzone-options">
        {GEORGIAN_MICROZONE_OPTIONS.map(name => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {/* Module Title bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-emerald-950/95 text-white p-5 rounded-2xl border border-emerald-900 shadow-md gap-4">
        <div>
          <span className="text-[10px] uppercase font-mono tracking-widest bg-emerald-800 text-emerald-100 px-2.5 py-1 rounded-full font-bold">{lang === 'ka' ? 'ვაზის მოდული' : 'VINEA VAZI MODULE'}</span>
          <h2 className="text-2xl font-serif font-black flex items-center gap-2 mt-2">
            <Sprout className="h-6 w-6 text-emerald-400 animate-pulse" />
            {label.title}
          </h2>
          <p className="text-xs text-emerald-250/90 mt-1 font-medium">{label.tagline}</p>
        </div>

        {/* Unit & Area Stats Badge */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="px-3.5 py-2 bg-emerald-900/50 rounded-xl border border-emerald-850 text-center">
            <span className="text-[9px] uppercase font-mono text-emerald-300 font-bold block">{lang === 'ka' ? 'ვენახის საერთო ფართობი' : 'Total Vineyard Area'}</span>
            <span className="text-lg font-serif font-black text-amber-300 block mt-0.5">{totalArea.toFixed(1)} ha</span>
          </div>
          <div className="px-3.5 py-2 bg-emerald-900/50 rounded-xl border border-emerald-850 text-center">
            <span className="text-[9px] uppercase font-mono text-emerald-300 font-bold block">{lang === 'ka' ? 'აქტიური ვაზები' : 'Active Vines'}</span>
            <span className="text-lg font-serif font-bold text-emerald-200 block mt-0.5">{totalVines.toLocaleString()} {lang === 'ka' ? 'ვაზი' : 'vines'}</span>
          </div>
        </div>
      </div>

      {(!canCreateVineyardRecord || !canUpdateVineyardRecord || !canDeleteVineyardRecord
        || !canCreateVineyardProject || !canUpdateVineyardProject || !canDispatchHarvestToGvino || !canCreateTask) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <strong className="block font-black">
            {!canCreateVineyardRecord && !canUpdateVineyardRecord && !canCreateVineyardProject && !canUpdateVineyardProject
              ? (lang === 'ka' ? 'ვენახზე მხოლოდ ნახვის წვდომა' : 'Read-only vineyard access')
              : (lang === 'ka' ? 'ვენახის შეზღუდული მოქმედებები' : 'Limited vineyard actions')}
          </strong>
          <span className="mt-0.5 block leading-relaxed">
            {!canCreateVineyardRecord && !canUpdateVineyardRecord && !canCreateVineyardProject && !canUpdateVineyardProject
              ? (lang === 'ka'
                ? 'შეგიძლიათ დაათვალიეროთ ნაკვეთები, რუკები, რისკები, პროექტები და საველე ისტორია; ცვლილებები თქვენი როლისთვის მიუწვდომელია.'
                : 'You can review blocks, maps, risks, projects, and field history; changes are unavailable for your role.')
              : (lang === 'ka'
                ? 'ხელმისაწვდომია მხოლოდ თქვენი როლისთვის ნებადართული ვენახის მოქმედებები. დამალული მართვის ელემენტები დამატებით უფლებებს მოითხოვს.'
                : 'Only vineyard actions allowed for your role are available. Hidden controls require additional permissions.')}
          </span>
          {!canDispatchHarvestToGvino && (
            <span className="mt-1 block text-[11px] text-amber-800 dark:text-amber-200">
              {lang === 'ka'
                ? 'მოსავლის მარანში გადაცემა საჭიროებს მოსავლის, ღვინის პარტიისა და დუღილის ჩანაწერების ერთობლივ უფლებებს.'
                : 'Dispatching harvest to the winery requires combined harvest, wine-lot, and fermentation permissions.'}
            </span>
          )}
          {!canCreateTask && (
            <span className="mt-1 block text-[11px] text-amber-800 dark:text-amber-200">
              {lang === 'ka'
                ? 'საველე ჩანაწერებიდან დავალების მონახაზის შექმნა თქვენი როლისთვის მიუწვდომელია.'
                : 'Creating task drafts from field records is unavailable for your role.'}
            </span>
          )}
        </div>
      )}

      {/* Mini Vazi Sub-Navigation bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#e8dfd5] pb-2 text-xs">
        {[
          {
            id: 'dashboard',
            label: {
              en: 'Viticulture Dashboard',
              ka: 'პორტალი',
              it: 'Dashboard Viticoltura',
              fr: 'Tableau de Viticulture',
              de: 'Weinbau-Übersicht'
            }[lang] || 'Viticulture Dashboard',
            icon: BarChart3
          },
          {
            id: 'blocks',
            label: {
              en: 'Vineyard Blocks',
              ka: 'ნაკვეთები',
              it: 'Parcelle Vigneto',
              fr: 'Parcelles',
              de: 'Weinbergsparzellen'
            }[lang] || 'Vineyard Blocks',
            icon: Layers
          },
          {
            id: 'projects',
            label: {
              en: 'New Vineyard Projects',
              ka: 'ახალი ვენახის პროექტები',
              it: 'Nuovi Progetti Vigneto',
              fr: 'Nouveaux Projets Vigne',
              de: 'Neue Weinbergprojekte'
            }[lang] || 'New Vineyard Projects',
            icon: FileText
          },
          {
            id: 'spraying',
            label: {
              en: 'Spraying Logs',
              ka: 'წამლობა',
              it: 'Registro Trattamenti',
              fr: 'Traitements',
              de: 'Spritztagebuch'
            }[lang] || 'Spraying Logs',
            icon: Wind
          },
          {
            id: 'scouting',
            label: {
              en: 'Disease Scouting',
              ka: 'მავნებლები',
              it: 'Monitoraggio Patologie',
              fr: 'Suivi Maladies',
              de: 'Schädlingsbeobachtung'
            }[lang] || 'Disease Scouting',
            icon: ShieldAlert
          },
          {
            id: 'ipm_pheno',
            label: {
              en: 'IPM Phenoscheme',
              ka: 'ინტეგრირებული დაცვა',
              it: 'IPM Phenoscheme',
              fr: 'IPM Phenoscheme',
              de: 'IPM Phenoscheme'
            }[lang] || 'IPM Phenoscheme',
            icon: Sprout
          },
          {
            id: 'sampling',
            label: {
              en: 'Fruit Sampling Check',
              ka: 'ნიმუშები',
              it: 'Campionamento Uva',
              fr: 'Échantillonnage',
              de: 'Traubenreife-Kontrolle'
            }[lang] || 'Fruit Sampling Check',
            icon: FlaskConical
          },
          {
            id: 'yield',
            label: {
              en: 'Yield & Harvest Planner',
              ka: 'კალკულატორი',
              it: 'Pianificazione Resa',
              fr: 'Rendement & Récolte',
              de: 'Ernteplaner'
            }[lang] || 'Yield & Harvest Planner',
            icon: TrendingUp
          },
          {
            id: 'weather',
            label: {
              en: 'Agro-Weather Station',
              ka: 'მეტეო სადგური',
              it: 'Stazione Meteo',
              fr: 'Station Météo',
              de: 'Agrar-Wetter'
            }[lang] || 'Agro-Weather Station',
            icon: Sun
          }
        ].map(tb => {
          const Icon = tb.icon;
          const isActive = vaziTab === tb.id;
          return (
            <button
              key={tb.id}
              onClick={() => {
                setVaziTab(tb.id as any);
                if (tb.id !== 'blocks' && tb.id !== 'dashboard' && tb.id !== 'projects') {
                  // auto select first block if none selected
                  if (!selectedBlockId && blocks.length > 0) {
                    setSelectedBlockId(blocks[0].id);
                  }
                }
              }}
              className={`px-3.5 py-2.5 rounded-xl font-bold flex items-center gap-2 cursor-pointer transition-all duration-150 text-xs ${
                isActive
                  ? 'bg-[#1e2f23] text-stone-100 shadow-xs border border-[#1e2f23]'
                  : 'text-[#615c57] hover:text-[#1b1715] hover:bg-stone-100 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tb.label}
            </button>
          );
        })}
      </div>

      {(['spraying', 'scouting', 'sampling', 'yield'] as const).includes(vaziTab as any) && !selectedBlock && (
        <div className="rounded-2xl border border-dashed border-[#e8dfd5] bg-white p-10 text-center shadow-sm">
          <Layers className="w-12 h-12 text-stone-300 mx-auto mb-3" />
          <h3 className="text-sm font-serif font-black text-[#4e0e15]">{lang === 'ka' ? 'ჯერ აირჩიეთ ვენახის ნაკვეთი' : 'Select a vineyard block first'}</h3>
          <p className="mt-1 text-xs text-stone-500 max-w-md mx-auto">
            {lang === 'ka' ? 'წამლობა, დაკვირვება, ნიმუშები და რთველის დაგეგმვა კონკრეტულ ნაკვეთზე იწერება.' : 'Spraying, scouting, sampling, and harvest planning are recorded against a specific block.'}
          </p>
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => openVaziTab('blocks')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-[#801323]"
            >
              <ArrowRight className="w-3.5 h-3.5" /> Open blocks
            </button>
            {canCreateVineyardRecord && (
              <button
                type="button"
                onClick={() => setShowAddBlockModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-900 transition-colors hover:bg-emerald-100"
              >
                <Plus className="w-3.5 h-3.5" /> Add block
              </button>
            )}
          </div>
        </div>
      )}

      {vaziTab === 'projects' && (
        <VineyardProjectsTab
          lang={lang}
          projects={vineyardProjects}
          onAddProject={onAddVineyardProject}
          onUpdateProject={onUpdateVineyardProject}
          canCreateProject={canCreateVineyardProject}
          canUpdateProject={canUpdateVineyardProject}
          canCreateTask={canCreateTask}
          setPrefilledTaskTitle={setPrefilledTaskTitle}
          setPrefilledTaskPriority={setPrefilledTaskPriority}
          setPrefilledTaskDesc={setPrefilledTaskDesc}
          onNavigate={navigateTo}
        />
      )}

      {/* ==========================================
          TAB 1: PORTAL DASHBOARD
          ========================================== */}
      {vaziTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Quick Info Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Quick Summary list of Blocks */}
            <div className="lg:col-span-1 bg-white border border-[#e8dfd5] rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="font-serif font-bold text-sm text-emerald-950 border-b border-stone-100 pb-2">
                {{
                  en: 'Canopy Status Radar',
                  ka: 'კანოპის მონიტორინგი',
                  it: 'Radar dello Stato della Chioma',
                  fr: 'Surveillance de la Canopée',
                  de: 'Laubwand-Statusradar'
                }[lang] || 'Canopy Status Radar'}
              </h3>
              <div className="space-y-3.5">
                {blocks.map(b => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setSelectedBlockId(b.id);
                      setVaziTab('blocks');
                    }}
                    className="w-full text-left p-3 hover:bg-emerald-50/40 rounded-xl border border-stone-100 hover:border-emerald-200 transition-all flex justify-between items-center group cursor-pointer"
                  >
                    <div>
                      <strong className="text-xs font-serif font-bold text-[#4e0e15] group-hover:text-emerald-900 duration-100">{b.name}</strong>
                      <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">{b.area} ha • {b.grapeVariety}</span>
                    </div>
                    <span className="text-[10px] font-bold bg-amber-50 text-amber-700 font-mono px-2 py-0.5 rounded border border-amber-100 font-semibold">{phenologyLabel(b.currentPhenology, lang)}</span>
                  </button>
                ))}
                {blocks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 p-5 text-center">
                    <Layers className="w-9 h-9 text-emerald-700/40 mx-auto mb-2" />
                    <p className="text-xs font-bold text-emerald-950">{lang === 'ka' ? 'ვენახის ნაკვეთები ჯერ არ არის' : 'No vineyard blocks yet'}</p>
                    <p className="mt-1 text-[11px] text-stone-500">
                      {canCreateVineyardRecord
                        ? (lang === 'ka' ? 'შექმენით პირველი ნაკვეთი მონიტორინგის, ნიმუშების აღების, წამლობის ან რთველის დაგეგმვამდე.' : 'Create the first block before scouting, sampling, sprays, or harvest planning.')
                        : (lang === 'ka' ? 'არსებული ვენახის ნაკვეთები აქ გამოჩნდება, როცა უფლებამოსილი თანამშრომელი დაამატებს.' : 'Existing vineyard blocks will appear here after an authorized teammate adds one.')}
                    </p>
                    {canCreateVineyardRecord && (
                      <button
                        type="button"
                        onClick={() => setShowAddBlockModal(true)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-emerald-900"
                      >
                        <Plus className="w-3.5 h-3.5" /> {lang === 'ka' ? 'ნაკვეთის დამატება' : 'Add block'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* GIS block map & Weather Station Forecast */}
            <div className="lg:col-span-2 bg-white border border-[#e8dfd5] rounded-2xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-stone-150 pb-2.5 gap-2">
                <div>
                  <h3 className="text-sm font-serif font-black text-emerald-950 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-emerald-700" />
                    {lang === 'ka' ? 'ვენახის ინტერაქტიული რუკა და მიკროკლიმატი' : 'Interactive Estate Block Map & Microclimate'}
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {lang === 'ka'
                      ? 'ყველა ნაკვეთის რისკის ფენები ცოცხალი მიკროკლიმატით'
                      : 'Estate-wide condition layers using each block’s live microclimate'}
                  </p>
                </div>

                {/* Overlay layer control button group */}
                <div className="flex gap-1 bg-stone-50 border border-stone-200 p-0.5 rounded-lg text-[10px]">
                  {[
                    { id: 'mildew', label: lang === 'ka' ? 'ჭრაქი (IPM)' : 'Mildew Risk' },
                    { id: 'moisture', label: lang === 'ka' ? 'წყლის სტრესი' : 'Water Stress' },
                    { id: 'phenology', label: lang === 'ka' ? 'ფენოლოგია' : 'Phenology' }
                  ].map(layer => (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setMapOverlay(layer.id as any)}
                      className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                        mapOverlay === layer.id
                          ? 'bg-[#1e2f23] text-stone-100 shadow-2xs'
                          : 'text-stone-650 hover:bg-stone-200/50'
                      }`}
                    >
                      {layer.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-stretch">
                {/* Interactive vineyard map */}
                <div className="md:col-span-5 bg-stone-50 border border-[#e8dfd5] rounded-xl p-3 flex flex-col justify-between relative overflow-hidden h-60">
                  <div className="flex items-center justify-between gap-2 text-[9px] font-mono font-bold uppercase tracking-widest text-emerald-800">
                    <span>🗺️ {lang === 'ka' ? 'ვენახის ბლოკების რუკა' : 'Estate Block Map'}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 normal-case tracking-normal text-emerald-900">
                      {blockWeatherLoading
                        ? (lang === 'ka' ? 'ამინდი ახლდება…' : 'Weather updating…')
                        : `${Object.keys(blockWeatherById).length}/${blocks.length} ${lang === 'ka' ? 'ცოცხალი' : 'live'}`}
                    </span>
                  </div>

                  <div className="w-full h-40 mt-2 rounded-lg overflow-hidden border border-stone-200 relative z-0">
                    <Suspense fallback={<VineyardMapLoading lang={lang} />}>
                      <VineyardMap
                        lang={lang}
                        center={defaultCenter}
                        blocks={blocks}
                        selectedBlockId={mapSelectedBlockId}
                        onSelectBlock={setSelectedBlockId}
                        getBlockColor={getBlockColor}
                        getBlockTooltipLines={getBlockTooltipLines}
                        heightClassName="h-full min-h-[160px]"
                        ariaLabel={lang === 'ka' ? 'ვენახის ბლოკების რუკა' : 'Estate vineyard block map'}
                      />
                    </Suspense>
                  </div>

                  {/* Micro legend */}
                  <div className="flex items-center gap-3 text-[9px] font-mono text-stone-500 border-t border-stone-200/60 pt-1.5 mt-1 shrink-0">
                    <span className="font-bold uppercase tracking-wider">{lang === 'ka' ? 'ლეგენდა:' : 'Legend:'}</span>
                    {mapOverlay === 'mildew' && (
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{lang === 'ka' ? 'დაბალი' : 'Low'}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />{lang === 'ka' ? 'საშ.' : 'Mod'}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{lang === 'ka' ? 'მაღალი' : 'High'}</span>
                      </div>
                    )}
                    {mapOverlay === 'moisture' && (
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{lang === 'ka' ? 'დაბალი' : 'Low'}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />{lang === 'ka' ? 'საშ.' : 'Mod'}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{lang === 'ka' ? 'მაღალი' : 'High'}</span>
                      </div>
                    )}
                    {mapOverlay === 'phenology' && (
                      <div className="flex gap-2">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />{lang === 'ka' ? 'შეთვ.' : 'Ver'}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" />{lang === 'ka' ? 'მწიფ.' : 'Rip'}</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{lang === 'ka' ? 'გამონ.' : 'Set'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Weather Station Forecast Column */}
                <div className="md:col-span-7 bg-stone-50/70 border border-[#e8dfd5] rounded-xl p-4 shadow-inner flex flex-col justify-between h-60">
                  {(() => {
                    const block = blocks.find(x => x.id === selectedBlockId) || blocks[0];
                    if (!block) return null;

                    if (!blockWeather) {
                      return (
                        <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-stone-500">
                          <AlertTriangle className="w-6 h-6 text-amber-600" />
                          <strong className="text-xs text-stone-800">
                            {blockWeatherLoading
                              ? (lang === 'ka' ? 'ცოცხალი ამინდი იტვირთება…' : 'Loading live weather…')
                              : (lang === 'ka' ? 'ცოცხალი ამინდი მიუწვდომელია' : 'Live weather unavailable')}
                          </strong>
                          <span className="text-[10px] max-w-sm">
                            {blockWeatherLoading
                              ? (lang === 'ka' ? 'ნაკვეთის მიკროკლიმატის მონაცემები ახლდება.' : 'Updating this block’s microclimate data.')
                              : blockWeatherError || (lang === 'ka' ? 'მონაცემები არ არის. შეამოწმეთ კავშირი და ნაკვეთის კოორდინატები.' : 'No simulated readings are shown. Check the connection and block coordinates.')}
                          </span>
                        </div>
                      );
                    }

                    const { temp, rainMm, wind, humidity } = blockWeather;
                    const topRisk = mapSelectedRisk
                      ? [mapSelectedRisk.items.downyMildew, mapSelectedRisk.items.powderyMildew, mapSelectedRisk.items.botrytis, mapSelectedRisk.items.waterStress, mapSelectedRisk.items.phiConflict]
                        .sort((a, b) => b.score - a.score)[0]
                      : null;

                    return (
                      <div className="flex flex-col justify-between h-full space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <strong className="text-xs font-serif font-black text-emerald-950 block">{block.name} {lang === 'ka' ? 'პროგნოზი' : 'Forecast'}</strong>
                            <span className="text-[9px] text-stone-500 font-mono">GPS: {block.latitude.toFixed(3)}, {block.longitude.toFixed(3)} • Recorded GDD: {computedGDD}</span>
                          </div>
                          <span className="text-[9px] font-mono font-bold bg-sky-50 text-sky-800 px-2 py-0.5 rounded border border-sky-200">
                            {lang === 'ka' ? 'ცოცხალი ამინდი' : 'OPEN-METEO LIVE'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-stone-850">
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">{lang === 'ka' ? 'ტემპერატურა' : 'Temperature'}</span>
                            <strong className="text-sm font-black mt-0.5 block">{temp}°C</strong>
                          </div>
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">{lang === 'ka' ? 'წვიმა დღეს' : 'Rain Today'}</span>
                            <strong className="text-sm font-black mt-0.5 block">{rainMm} mm</strong>
                          </div>
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">{lang === 'ka' ? 'ქარის მაქს.' : 'Wind Max'}</span>
                            <strong className="text-sm font-black mt-0.5 block">{wind} km/h</strong>
                          </div>
                          <div className="p-2 bg-white border border-stone-200 rounded-lg text-center shadow-2xs">
                            <span className="text-[8px] font-mono text-slate-500 dark:text-slate-400 block uppercase">{lang === 'ka' ? 'ტენიანობა' : 'Humidity'}</span>
                            <strong className="text-sm font-black mt-0.5 block">{humidity}%</strong>
                          </div>
                        </div>

                        {selectedRisk && (
                          <div className="grid grid-cols-3 gap-2 text-[10px]">
                            {[
                              selectedRisk.items.downyMildew,
                              selectedRisk.items.botrytis,
                              selectedRisk.items.waterStress,
                            ].map(item => (
                              <div key={item.category} className="rounded-lg border border-stone-200 bg-white p-2">
                                <span className="block font-mono text-[8px] uppercase tracking-wide text-stone-500">{item.label}</span>
                                <strong className="mt-1 block text-xs font-black capitalize" style={{ color: vaziRiskColor(item.level) }}>{item.level}</strong>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="p-2.5 bg-amber-50/75 border border-amber-200 text-amber-900 rounded-lg flex items-start gap-2 text-[10px] leading-snug">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold block text-[10px] leading-none mb-0.5">Agro-alert: {topRisk ? `${topRisk.label} ${topRisk.level}` : `${block.grapeVariety} block`}</span>
                            {topRisk
                              ? `${topRisk.reasons.slice(0, 2).join('; ')}. ${topRisk.nextAction}`
                              : `Temperature ${temp} C, humidity ${humidity}%, rainfall ${rainMm} mm, wind ${wind} km/h.`
                            }
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

          </div>

          {/* Vineyard Activities Card log */}
          <div className="bg-white border border-[#e8dfd5] rounded-2xl p-5 shadow-xs space-y-4">
            <h3 className="font-serif font-bold text-sm text-emerald-950">
              {{
                en: 'Latest Field Management Logs',
                ka: 'საველე სამუშაოების ბოლო ლოგები',
                it: 'Ultimi Registri di Gestione in Campo',
                fr: 'Derniers Rapports de Gestion de Terrain',
                de: 'Aktuelle Weinberg-Aktivitäten'
              }[lang] || 'Latest Field Management Logs'}
            </h3>
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-left text-xs text-stone-600 font-sans border-collapse">
                <thead>
                  <tr className="border-b border-stone-100 text-[9px] font-mono uppercase text-slate-500 dark:text-slate-400">
                    <th className="py-2">
                      {{ en: 'Date', ka: 'თარიღი', it: 'Data', fr: 'Date', de: 'Datum' }[lang] || 'Date'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Block', ka: 'ნაკვეთი', it: 'Lotto', fr: 'Parcelle', de: 'Parzelle' }[lang] || 'Block'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Operational Activity', ka: 'ოპერაციული აქტივობა', it: 'Attività Operativa', fr: 'Activité Opérationnelle', de: 'Arbeitsgang' }[lang] || 'Operational Activity'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Operator / Manager', ka: 'ოპერატორი', it: 'Operatore', fr: 'Opérateur', de: 'Bediener' }[lang] || 'Operator / Manager'}
                    </th>
                    <th className="py-2">
                      {{ en: 'Details & Chemical Safety Notes', ka: 'დეტალები და უსაფრთხოების შენიშვნები', it: 'Dettagli e Note di Sicurezza Chimica', fr: 'Détails & Notes de Sécurité Chimique', de: 'Details & Pflanzenschutzhinweise' }[lang] || 'Details & Chemical Safety Notes'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50 font-medium">
                  {sprays.map(sp => (
                    <tr key={sp.id}>
                      <td className="py-2.5 font-mono">{sp.date}</td>
                      <td className="py-2.5 font-serif font-bold text-[#4e0e15]">{blocks.find(b => b.id === sp.blockId)?.name || sp.blockId}</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold border border-emerald-100">
                          {{ en: 'Spraying: ', ka: 'წამლობა: ', it: 'Trattamento: ', fr: 'Traitement: ', de: 'Spritzen: ' }[lang] || 'Spraying: '}
                          {sp.targetProblem}
                        </span>
                      </td>
                      <td className="py-2.5 font-mono">{sp.operator}</td>
                      <td className="py-2.5 text-[11px] text-stone-500">
                        {sp.productName} ({sp.dosePerHa} kg/ha) • {{ en: 'Pre-Harvest Interval (PHI):', ka: 'მოსავლის აღების უსაფრთხოების ინტერვალი (PHI):', it: 'Intervallo di Sicurezza (PHI):', fr: 'Délai avant Récolte (DAR):', de: 'Wartezeit (PHI):' }[lang] || 'Pre-Harvest Interval (PHI):'} {sp.preHarvestIntervalDays} {{ en: 'days', ka: 'დღე', it: 'giorni', fr: 'jours', de: 'Tage' }[lang]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          TAB 2: VINEYARD BLOCKS LIST & DETAIL
          ========================================== */}
      {vaziTab === 'blocks' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8">

          {/* Left Block Selection list */}
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between border-b border-[#e8dfd5] pb-2">
              <h3 className="font-serif font-black text-sm text-emerald-950">{label.allBlocks}</h3>
              {canCreateVineyardRecord && (
                <button
                  onClick={() => setShowAddBlockModal(true)}
                  className="bg-emerald-800 hover:bg-emerald-900 text-white px-2.5 py-1 text-[10px] uppercase font-mono tracking-wider font-extrabold rounded-md cursor-pointer flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {lang === 'ka' ? 'ახალი ნაკვეთი' : 'New Block'}
                </button>
              )}
            </div>

            <div className="space-y-3.5">
              {blocks.map(b => {
                const isActive = b.id === selectedBlockId;
                const cadastre = calculateCadastreCompleteness(b);
                return (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBlockId(b.id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                      isActive
                        ? 'bg-neutral-50/80 border-[#4e0e15] shadow-xs'
                        : 'bg-white border-[#e8dfd5] hover:bg-stone-50/50'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#4e0e15]" />
                    )}
                    <div className="flex items-center justify-between">
                      <strong className="text-xs font-serif font-black text-stone-900 dark:text-amber-100">{b.name}</strong>
                      <span className="text-[9px] font-mono text-slate-500 dark:text-slate-400 font-bold">{b.area} ha</span>
                    </div>
                    <div className="flex justify-between items-center mt-2 font-mono text-[9px] text-stone-500">
                      <span>{b.grapeVariety}</span>
                      <span className="text-emerald-700 font-extrabold">{phenologyLabel(b.currentPhenology, lang)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400">{lang === 'ka' ? 'საკადასტრო' : 'Cadastre mirror'}</span>
                      <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${cadastreBadgeClass(cadastre.score, cadastre.missingCritical.length)}`}>
                        {cadastre.score}%
                      </span>
                    </div>
                  </div>
                );
              })}
              {blocks.length === 0 && (
                <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-4 text-center text-[11px] text-stone-500">
                  {canCreateVineyardRecord
                    ? (lang === 'ka' ? 'დაამატეთ პირველი ნაკვეთი ვენახის რეესტრის დასაწყებად.' : 'Add the first block to start the vineyard registry.')
                    : (lang === 'ka' ? 'ნაკვეთის ჩანაწერები ჯერ არ არის. მათი შექმნა მხოლოდ უფლებამოსილ როლს შეუძლია.' : 'No block records are available yet. Only an authorized role can create them.')}
                </div>
              )}
            </div>
          </div>

          {/* Right Detailed Analysis of Selected Block */}
          <div className="lg:col-span-2 xl:col-span-3 space-y-6">
            {selectedBlock ? (
              <div className="bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 p-8 lg:p-10 rounded-3xl shadow-sm space-y-8">

                {/* Title and Base Stats */}
                <div className="flex flex-col sm:flex-row justify-between sm:items-start border-b border-[#e8dfd5] pb-4 gap-3">
                  <div>
                    <span className="text-[10px] uppercase font-mono text-slate-450 tracking-widest">{selectedBlock.vineyardName} • {selectedBlock.locationName}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <h3 className="text-xl font-serif font-black text-[#4e0e15]">{selectedBlock.name}</h3>
                      {canUpdateVineyardRecord && (
                        <button
                          type="button"
                          onClick={() => setIsEditingBlock(!isEditingBlock)}
                          className="text-stone-500 hover:text-[#4e0e15] text-[10px] font-mono font-bold transition-colors cursor-pointer select-none border border-stone-250 px-1.5 rounded"
                          title={lang === 'ka' ? 'ბლოკის თვისებების რედაქტირება' : 'Edit Block Properties'}
                        >
                          ✏️ {lang === 'ka' ? 'შეცვლა' : 'Edit'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 font-medium font-sans leading-relaxed mt-1">{selectedBlock.notes}</p>
                  </div>

                  {/* Local Quick actions */}
                  <div className="bg-neutral-50 border border-stone-200/55 p-3 rounded-xl flex items-center gap-3 w-fit text-[10px] font-mono shrink-0">
                    <div className="text-center shrink-0 pr-3 border-r border-stone-150">
                      <span className="text-[9px] uppercase font-normal text-slate-500 dark:text-slate-400 block">{lang === 'ka' ? 'ჯიში' : 'Variety Status'}</span>
                      <strong className="text-xs block text-[#4e0e15] font-bold font-serif">{selectedBlock.grapeVariety}</strong>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase font-normal text-slate-500 dark:text-slate-400 block">{lang === 'ka' ? 'მართვა' : 'Farming'}</span>
                      <strong className="text-xs uppercase block text-emerald-750 font-bold">{selectedBlock.farmingStatus}</strong>
                    </div>
                    {selectedCadastre && (
                      <div className="pl-3 border-l border-stone-150">
                        <span className="text-[9px] uppercase font-normal text-slate-500 dark:text-slate-400 block">{lang === 'ka' ? 'კადასტრი' : 'Cadastre'}</span>
                        <strong className="text-xs uppercase block text-amber-700 font-bold">{selectedCadastre.score}%</strong>
                      </div>
                    )}
                  </div>
                </div>

                {isEditingBlock ? (
                  <form onSubmit={handleSaveBlock} className="space-y-4 bg-[#FAF8F5] p-5 border border-[#e8dfd5] rounded-xl text-xs text-stone-700">
                    <h3 className="text-xs uppercase font-mono tracking-widest text-[#4e0e15] font-black border-b pb-1.5 mb-3 flex justify-between items-center">
                      <span>✏️ {lang === 'ka' ? 'ნაკვეთის პარამეტრები' : 'Edit Block Properties'}</span>
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ნაკვეთის სახელი' : 'Block Name'}</label>
                        <input
                          type="text" required
                          value={editBlockName} onChange={(e) => setEditBlockName(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ვენახის სახელი' : 'Vineyard Name'}</label>
                        <input
                          type="text" required
                          value={editVineyardName} onChange={(e) => setEditVineyardName(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'მდებარეობის სახელი' : 'Location Name'}</label>
                        <input
                          type="text" required
                          value={editLocationName} onChange={(e) => setEditLocationName(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-200 bg-amber-50/35 p-3 space-y-3">
                      <h4 className="text-[10px] uppercase font-mono tracking-widest text-amber-900 font-black flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        {lang === 'ka' ? 'სახელმწიფო საკადასტრო მონაცემები' : 'Government Cadastre Mirror'}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'საკადასტრო კოდი' : 'Cadastral Code'}</label>
                          <input
                            type="text"
                            value={editCadastralCode}
                            onChange={(e) => setEditCadastralCode(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'საკადასტრო დოკუმენტი' : 'Cadastre Document'}</label>
                          <input
                            type="text"
                            value={editOfficialCadastreDocumentName}
                            onChange={(e) => setEditOfficialCadastreDocumentName(e.target.value)}
                            placeholder={lang === 'ka' ? 'ფაილის სახელი ან რეესტრის ნომერი' : 'file name or registry ref'}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ნაკვეთის დასახელება' : 'Parcel Name'}</label>
                          <input
                            type="text"
                            value={editParcelName}
                            onChange={(e) => setEditParcelName(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'მუნიციპალიტეტი' : 'Municipality'}</label>
                          <input
                            type="text"
                            value={editMunicipality}
                            onChange={(e) => setEditMunicipality(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'თემი' : 'Community'}</label>
                          <input
                            type="text"
                            value={editCommunity}
                            onChange={(e) => setEditCommunity(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'სოფელი' : 'Village'}</label>
                          <input
                            type="text"
                            value={editVillage}
                            onChange={(e) => setEditVillage(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'მიკროზონა / PDO' : 'Microzone / PDO'}</label>
                          <input
                            type="text"
                            value={editMicrozone}
                            onChange={(e) => setEditMicrozone(e.target.value)}
                            list="vazi-georgian-microzone-options"
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ნაკვეთის ფართობი (ჰა)' : 'Parcel Area (ha)'}</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editParcelArea}
                            onChange={(e) => setEditParcelArea(e.target.value)}
                            placeholder={String(editArea)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'მიწის მესაკუთრე' : 'Land Owner'}</label>
                          <input
                            type="text"
                            value={editLandOwner}
                            onChange={(e) => setEditLandOwner(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'მევენახე' : 'Grower'}</label>
                          <input
                            type="text"
                            value={editGrower}
                            onChange={(e) => setEditGrower(e.target.value)}
                            className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ფართობი (ჰა)' : 'Area (ha)'}</label>
                        <input
                          type="number" step="0.01" required
                          value={editArea} onChange={(e) => setEditArea(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'სიმაღლე (მ)' : 'Elevation (m)'}</label>
                        <input
                          type="number" required
                          value={editElevation} onChange={(e) => setEditElevation(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'დაქანება' : 'Slope'}</label>
                        <input
                          type="text" required
                          value={editSlope} onChange={(e) => setEditSlope(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ექსპოზიცია' : 'Aspect'}</label>
                        <input
                          type="text" required
                          value={editAspect} onChange={(e) => setEditAspect(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ყურძნის ჯიში' : 'Grape Variety'}</label>
                        <input
                          type="text" required
                          value={editGrapeVariety} onChange={(e) => setEditGrapeVariety(e.target.value)}
                          list="vazi-georgian-variety-options"
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'დარგვის წელი' : 'Planting Year'}</label>
                        <input
                          type="number" required
                          value={editPlantingYear} onChange={(e) => setEditPlantingYear(Number(e.target.value) || 2018)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ფორმირების სისტემა' : 'Training System'}</label>
                        <input
                          type="text" required
                          value={editTrainingSystem} onChange={(e) => setEditTrainingSystem(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'საძირე' : 'Rootstock'}</label>
                        <input
                          type="text"
                          value={editRootstock}
                          onChange={(e) => setEditRootstock(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'კლონი' : 'Clone'}</label>
                        <input
                          type="text"
                          value={editClone}
                          onChange={(e) => setEditClone(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ვენახის მდგომარეობა' : 'Vineyard Condition'}</label>
                        <input
                          type="text"
                          value={editVineyardCondition}
                          onChange={(e) => setEditVineyardCondition(e.target.value)}
                          placeholder={lang === 'ka' ? 'პროდუქტიული, ხელახლა დარგული, ახალგაზრდა ვაზები' : 'productive, replanted, young vines'}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'დარგვის სქემა' : 'Spacing'}</label>
                        <input
                          type="text" required
                          value={editSpacing} onChange={(e) => setEditSpacing(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'რიგების რაოდენობა' : 'Rows Count'}</label>
                        <input
                          type="number" required
                          value={editRowsCount} onChange={(e) => setEditRowsCount(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ვაზების რაოდენობა' : 'Vines Count'}</label>
                        <input
                          type="number" required
                          value={editVinesCount} onChange={(e) => setEditVinesCount(Number(e.target.value) || 0)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'მართვის სტატუსი' : 'Farming Status'}</label>
                        <input
                          type="text" required
                          value={editFarmingStatus} onChange={(e) => setEditFarmingStatus(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ნიადაგის ტიპი' : 'Soil Type'}</label>
                        <input
                          type="text" required
                          value={editSoilType} onChange={(e) => setEditSoilType(e.target.value)}
                          className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <input
                          type="checkbox" id="editIrrigationEnabled"
                          checked={editIrrigationEnabled} onChange={(e) => setEditIrrigationEnabled(e.target.checked)}
                          className="h-4 w-4 text-emerald-800 focus:ring-emerald-700 rounded accent-emerald-800"
                        />
                        <label htmlFor="editIrrigationEnabled" className="font-bold text-[10px] text-stone-700 cursor-pointer">{lang === 'ka' ? 'მორწყვა ჩართულია' : 'Irrigation Enabled'}</label>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold mb-1">{lang === 'ka' ? 'ნაკვეთის შენიშვნები / აღწერა' : 'Block Notes / Description'}</label>
                      <textarea
                        value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                        className="w-full bg-white border border-[#e8dfd5] p-2 rounded text-stone-900 outline-none h-16"
                      />
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingBlock(false)}
                        className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-700 font-mono font-bold uppercase py-2.5 rounded-lg text-[10px] cursor-pointer transition-colors"
                      >
                        {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                      </button>
                      <button
                        type="submit"
                        className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white font-mono font-bold uppercase py-2.5 rounded-lg text-[10px] cursor-pointer transition-colors"
                      >
                        {lang === 'ka' ? 'შენახვა' : 'Save Changes'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>

                {/* Sub-Tabs of Block detail */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-stone-700">

                  {selectedCadastre && (
                    <div className="space-y-3 p-4 bg-amber-50/45 rounded-xl border border-amber-100 md:col-span-2">
                      <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-[#4e0e15] flex items-center justify-between gap-2 border-b border-dashed border-amber-200 pb-1.5">
                        <span className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          {lang === 'ka' ? 'სახელმწიფო საკადასტრო მონაცემები' : 'Government Cadastre Mirror'}
                        </span>
                        <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${cadastreBadgeClass(selectedCadastre.score, selectedCadastre.missingCritical.length)}`}>
                          {selectedCadastre.score}% {cadastreBadgeLabel(selectedCadastre.badge, lang)}
                        </span>
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
                        {([
                          [lang === 'ka' ? 'საკადასტრო კოდი' : 'Cadastral code', selectedBlock.cadastralCode],
                          [lang === 'ka' ? 'მუნიციპალიტეტი' : 'Municipality', selectedBlock.municipality],
                          [lang === 'ka' ? 'სოფელი' : 'Village', selectedBlock.village],
                          [lang === 'ka' ? 'მიკროზონა' : 'Microzone', selectedBlock.microzone],
                          [lang === 'ka' ? 'ნაკვეთი' : 'Parcel', selectedBlock.parcelName],
                          [lang === 'ka' ? 'ნაკვეთის ფართობი' : 'Parcel area', `${selectedBlock.parcelArea ?? selectedBlock.area} ha`],
                          [lang === 'ka' ? 'მესაკუთრე / მევენახე' : 'Owner / grower', selectedBlock.landOwner || selectedBlock.grower],
                          [lang === 'ka' ? 'დოკუმენტი' : 'Document', selectedBlock.officialCadastreDocumentName],
                        ] as Array<[string, string | number | undefined]>).map(([field, value]) => (
                          <div key={field} className="border border-amber-100 bg-white/70 rounded-lg p-2">
                            <span className="block text-[9px] uppercase font-mono text-slate-500 dark:text-slate-400 font-bold">{field}</span>
                            <strong className="mt-0.5 block text-stone-800 font-serif">{value || (lang === 'ka' ? 'არ არის' : 'Missing')}</strong>
                          </div>
                        ))}
                      </div>
                      {selectedCadastre.missing.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-[9px] font-mono">
                          {selectedCadastre.requirements.filter(r => !r.met).slice(0, 7).map(item => (
                            <span key={item.id} className="rounded-full border border-amber-200 bg-amber-100/70 px-2 py-0.5 text-amber-900">
                              {lang === 'ka' ? 'აკლია' : 'Missing'}: {lang === 'ka' ? item.labelKa : item.labelEn}
                            </span>
                          ))}
                          {selectedCadastre.missing.length > 7 && (
                            <span className="rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-stone-600">
                              +{selectedCadastre.missing.length - 7} {lang === 'ka' ? 'სხვა' : 'more'}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Block Terrain & Soil */}
                  <div className="space-y-3 p-4 bg-stone-50 rounded-xl border border-stone-100">
                    <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-[#4e0e15] flex items-center gap-1.5 border-b border-dashed border-stone-200 pb-1.5">
                      <Mountain className="w-3.5 h-3.5" />
                      {lang === 'ka' ? 'ნაკვეთის რელიეფი და ნიადაგი' : 'Block Terrain & Vineyard Soil Specs'}
                    </h4>
                    <ul className="text-xs space-y-2 font-medium">
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'სიმაღლე ზ. დ.:' : 'Altitude / Elevation:'}</span>
                        <span className="font-mono text-stone-800">{selectedBlock.elevation} {lang === 'ka' ? 'მ' : 'Meters'}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დაქანება:' : 'Slope Profile:'}</span>
                        <span className="font-mono text-stone-800">{selectedBlock.slope}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ექსპოზიცია:' : 'Aspect Exposure:'}</span>
                        <span className="font-mono text-stone-800">{selectedBlock.aspect}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დარგვის სქემა:' : 'Planting Spacing:'}</span>
                        <span className="font-mono text-stone-800">{selectedBlock.spacing}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ნიადაგის პროფილი:' : 'Soil Geological Profile:'}</span>
                        <span className="font-serif text-[11px] text-[#4e0e15] text-right font-bold inline-block max-w-40">{selectedBlock.soilType}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'საძირე / კლონი:' : 'Rootstock / Clone:'}</span>
                        <span className="font-mono text-stone-800 text-right">{selectedBlock.rootstock || (lang === 'ka' ? 'არ არის' : 'Missing')} / {selectedBlock.clone || (lang === 'ka' ? 'არ არის' : 'Missing')}</span>
                      </li>
                      <li className="flex justify-between">
                        <span className="text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ვენახის მდგომარეობა:' : 'Vineyard Condition:'}</span>
                        <span className="font-mono text-stone-800 text-right">{selectedBlock.vineyardCondition || (lang === 'ka' ? 'არ არის' : 'Missing')}</span>
                      </li>
                    </ul>
                  </div>

                  {/* Coordinates & Custom Area Mapping Draw widget */}
                  <div className="space-y-3 p-4 bg-stone-50 rounded-xl border border-stone-100 flex flex-col justify-between">
                    <div>
                      <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-[#4e0e15] flex items-center justify-between border-b border-dashed border-stone-200 pb-1.5 w-full">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5" />
                          {lang === 'ka' ? 'ნაკვეთის ინტერაქტიული პოლიგონის რუკა' : 'Interactive Digital Block Polygon Map'}
                        </span>
                      </h4>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                        GPS: Lat {selectedBlock.latitude.toFixed(4)}, Lng {selectedBlock.longitude.toFixed(4)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-mono text-stone-600">
                        <span>
                          {lang === 'ka' ? 'რეგისტრირებული' : 'Registered'}: {selectedBlock.area.toFixed(2)} ha
                        </span>
                        <span>
                          {selectedHasRecordedBoundary
                            ? (lang === 'ka' ? 'რუკით გაზომილი' : 'Mapped')
                            : (lang === 'ka' ? 'მიახლოებითი' : 'Approximate')}: {selectedMappedArea.toFixed(2)} ha
                        </span>
                        {selectedHasRecordedBoundary && (
                          <span className={Math.abs(selectedAreaDifferencePercent) > 10 ? 'font-bold text-amber-700' : 'text-emerald-700'}>
                            {selectedAreaDifferencePercent >= 0 ? '+' : ''}{selectedAreaDifferencePercent.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="h-40 bg-stone-100/80 rounded-lg border border-stone-200 relative overflow-hidden">
                        <Suspense fallback={<VineyardMapLoading lang={lang} />}>
                          <VineyardMap
                            lang={lang}
                            center={{ lat: selectedBlock.latitude, lng: selectedBlock.longitude }}
                            blocks={isEditingBlockBoundary ? [] : [selectedBlock]}
                            selectedBlockId={selectedBlock.id}
                            drawing={isEditingBlockBoundary}
                            drawingPoints={editingBoundaryPoints}
                            onMapClick={isEditingBlockBoundary
                              ? point => {
                                  setEditingPointLat(parseFloat(point.lat.toFixed(6)));
                                  setEditingPointLng(parseFloat(point.lng.toFixed(6)));
                                  setEditingBoundaryPoints(previous => appendBoundaryPoint(previous, point));
                                }
                              : undefined}
                            onRemoveDrawingPoint={isEditingBlockBoundary
                              ? index => setEditingBoundaryPoints(previous => removeBoundaryPoint(previous, index))
                              : undefined}
                            heightClassName="h-full min-h-[160px]"
                            ariaLabel={lang === 'ka' ? `${selectedBlock.name} საზღვრის რუკა` : `${selectedBlock.name} boundary map`}
                            showEmptyState={false}
                          />
                        </Suspense>
                      </div>

                      {isEditingBlockBoundary ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`text-[9px] font-mono ${
                            editingBoundaryValidation.valid ? 'text-emerald-700' : 'text-amber-700'
                          }`}>
                            {boundaryValidationMessage(editingBoundaryValidation, lang)}
                            {' · '}
                            {editingBoundaryPoints.length} {lang === 'ka' ? 'წერტილი' : 'vertices'}
                            {editingBoundaryValidation.valid && selectedBlock.area > 0 && (
                              <>
                                {' · '}
                                {lang === 'ka' ? 'რეგისტრირებულთან სხვაობა' : 'vs registered'}{' '}
                                {(((editingBoundaryValidation.areaHectares - selectedBlock.area) / selectedBlock.area) * 100).toFixed(1)}%
                              </>
                            )}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <label className="sr-only" htmlFor="boundary-point-lat">
                              {lang === 'ka' ? 'საზღვრის წერტილის განედი' : 'Boundary point latitude'}
                            </label>
                            <input
                              id="boundary-point-lat"
                              type="number"
                              step="0.000001"
                              value={editingPointLat}
                              onChange={event => setEditingPointLat(Number(event.target.value))}
                              className="w-24 rounded border border-stone-200 bg-white px-2 py-1 text-[9px] font-mono text-stone-800 outline-none focus:border-emerald-700"
                            />
                            <label className="sr-only" htmlFor="boundary-point-lng">
                              {lang === 'ka' ? 'საზღვრის წერტილის გრძედი' : 'Boundary point longitude'}
                            </label>
                            <input
                              id="boundary-point-lng"
                              type="number"
                              step="0.000001"
                              value={editingPointLng}
                              onChange={event => setEditingPointLng(Number(event.target.value))}
                              className="w-24 rounded border border-stone-200 bg-white px-2 py-1 text-[9px] font-mono text-stone-800 outline-none focus:border-emerald-700"
                            />
                            <button
                              type="button"
                              onClick={() => setEditingBoundaryPoints(previous => appendBoundaryPoint(previous, {
                                lat: editingPointLat,
                                lng: editingPointLng,
                              }))}
                              className="px-2 py-1 text-[9px] font-mono font-bold rounded bg-emerald-100 text-emerald-900 hover:bg-emerald-200 cursor-pointer"
                            >
                              + {lang === 'ka' ? 'კოორდინატი' : 'Coordinate'}
                            </button>
                            <button
                              type="button"
                              disabled={editingBoundaryPoints.length === 0}
                              onClick={() => setEditingBoundaryPoints(previous => previous.slice(0, -1))}
                              className="px-2 py-1 text-[9px] font-mono font-bold rounded bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                            >
                              ↶ {lang === 'ka' ? 'გაუქმება' : 'Undo'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsEditingBlockBoundary(false);
                                setEditingBoundaryPoints([]);
                              }}
                              className="px-2 py-1 text-[9px] font-mono font-bold rounded bg-rose-100 text-rose-800 hover:bg-rose-200 cursor-pointer"
                            >
                              {lang === 'ka' ? 'გაუქმება' : 'Cancel'}
                            </button>
                            <button
                              type="button"
                              disabled={!editingBoundaryValidation.valid}
                              onClick={() => {
                                if (!canUpdateVineyardRecord || !editingBoundaryValidation.valid) return;
                                runVaziMutationIfAllowed(canUpdateVineyardRecord, () => (
                                  onUpdateBlock(selectedBlock.id, { boundary: editingBoundaryPoints })
                                ));
                                setIsEditingBlockBoundary(false);
                                setEditingBoundaryPoints([]);
                              }}
                              className="px-2 py-1 text-[9px] font-mono font-bold rounded bg-emerald-800 text-white hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                            >
                              {lang === 'ka' ? 'საზღვრის შენახვა' : 'Save Boundary'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => downloadBlockGeoJson(selectedBlock)}
                            className="px-2.5 py-1 text-[9px] font-mono font-bold rounded border border-stone-200 bg-white text-stone-700 hover:bg-stone-100 cursor-pointer"
                          >
                            {lang === 'ka' ? 'GeoJSON-ის ჩამოტვირთვა' : 'Export GeoJSON'}
                          </button>
                          {canUpdateVineyardRecord && (
                          <button
                            type="button"
                            onClick={() => {
                              const recordedBoundary = selectedBlock.boundary && selectedBlock.boundary.length >= 3
                                ? selectedBlock.boundary
                                : selectedBlock.gpsPolygon && selectedBlock.gpsPolygon.length >= 3
                                  ? selectedBlock.gpsPolygon
                                  : [];
                              setEditingBoundaryPoints(recordedBoundary);
                              setEditingPointLat(selectedBlock.latitude);
                              setEditingPointLng(selectedBlock.longitude);
                              setIsEditingBlockBoundary(true);
                            }}
                            className="px-2.5 py-1 text-[9px] font-mono font-bold rounded bg-emerald-800 text-white hover:bg-emerald-900 cursor-pointer"
                          >
                            {lang === 'ka' ? 'საზღვრის რედაქტირება' : 'Edit Boundary'}
                          </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                </div>

                {/* Phenology Estimation Area */}
                <div className="p-4 bg-emerald-50/40 rounded-xl border border-emerald-100 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-150 pb-2">
                    <div>
                      <h4 className="text-xs uppercase font-mono tracking-wider font-extrabold text-emerald-900 flex items-center gap-1.5">
                        <Sprout className="w-3.5 h-3.5" />
                        {lang === 'ka' ? 'ფენოლოგიის პროგნოზი (GDD)' : 'Growing Degree Days Phenological Predictor'}
                      </h4>
                      <p className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">{lang === 'ka' ? 'სითბოს ჯამის ავტომატური ინდექსი ვეგეტაციის მიმდინარე ეტაპის შესაფასებლად' : 'Automated heat sum index algorithms mapping current vegetative progression'}</p>
                    </div>
                    <span className="text-[9px] font-mono bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded font-extrabold">{lang === 'ka' ? 'აქტიური პროგნოზის მოდელი' : 'Active Prediction Model'}</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-3 bg-white border border-stone-100 rounded-lg text-center font-mono">
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase block font-sans">{lang === 'ka' ? 'დაგროვილი GDD სითბო' : 'Accumulated GDD Heat'}</span>
                      <strong className="text-base text-emerald-950 block mt-0.5">{computedGDD} {lang === 'ka' ? '°C-დღე' : '°C-Days'}</strong>
                    </div>
                    <div className="p-3 bg-white border border-stone-100 rounded-lg text-center font-mono flex flex-col justify-between items-center">
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase block font-sans">{lang === 'ka' ? 'სავარაუდო ფენოლოგიური ფაზა' : 'Estimated Canopy Stage'}</span>
                      {canUpdateVineyardRecord ? (
                        <select
                          aria-label={lang === 'ka' ? 'ფენოლოგიური ფაზის განახლება' : 'Update phenology stage'}
                          value={selectedBlock.currentPhenology}
                          onChange={(e) => runVaziMutationIfAllowed(canUpdateVineyardRecord, () => (
                            onUpdateBlock(selectedBlock.id, { currentPhenology: e.target.value })
                          ))}
                          className="text-xs font-serif font-bold text-amber-700 text-center bg-transparent border border-amber-200/50 rounded-lg px-2.5 py-1 outline-none cursor-pointer mt-1.5 hover:text-amber-950 hover:border-amber-400 transition-all font-semibold max-w-full"
                        >
                          {PHENOLOGY_STAGES.map((stage) => (
                            <option key={stage} value={stage} className="text-stone-800 bg-white">
                              {phenologyLabel(stage, lang)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <strong className="mt-1.5 block text-xs font-serif text-amber-700">
                          {phenologyLabel(selectedBlock.currentPhenology, lang)}
                        </strong>
                      )}
                    </div>
                    <div className="p-3 bg-white border border-stone-100 rounded-lg text-center font-mono">
                      <span className="text-[9px] text-slate-450 uppercase block font-sans">{lang === 'ka' ? 'სანდოობის ინდექსი' : 'Confidence Index'}</span>
                      <strong className="text-base text-emerald-700 block mt-0.5">{lang === 'ka' ? '92% სანდო' : '92% Reliable'}</strong>
                    </div>
                  </div>

                  {canCreateVineyardRecord && (
                  <div className="flex gap-2 text-[10px] font-mono justify-end pt-1">
                    <button
                      onClick={() => {
                        if (!canCreateVineyardRecord) return;
                        runVaziMutationIfAllowed(canCreateVineyardRecord, () => onAddPhenologyLog({
                          blockId: selectedBlock.id,
                          stage: selectedBlock.currentPhenology,
                          date: new Date().toISOString().split('T')[0],
                          gdd: computedGDD,
                          confidence: 92,
                          status: 'confirmed',
                          notes: lang === 'ka'
                            ? `ფენოლოგიური სტატუსი დადასტურდა. GDD მონიტორინგი შეესაბამება ფაზის მოლოდინს.`
                            : `Confirmed physiological status on late spring checkup. GDD tracking matches stage expectation.`,
                          observer: currentUser.fullName
                        }));
                        alert(lang === 'ka'
                          ? `ფენოლოგიის დადასტურება: ნაკვეთი ${selectedBlock.name} რეგისტრირდა ფაზაზე „${phenologyLabel(selectedBlock.currentPhenology, lang)}“!`
                          : `Broadcasting canopy confirmation: Block ${selectedBlock.name} successfully registered at ${selectedBlock.currentPhenology}!`);
                      }}
                      className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold rounded-md cursor-pointer flex items-center gap-1 transition-all"
                    >
                      <Check className="w-3 h-3" /> {lang === 'ka' ? 'სტატუსის დადასტურება' : 'Confirm Viticulturist Status'}
                    </button>
                  </div>
                  )}
                </div>

              </>
            )}
              </div>
            ) : (
              <div className="bg-stone-50 border border-dashed border-[#e8dfd5] text-center p-12 rounded-xl italic font-serif text-sm text-[#4e0e15]/60 flex flex-col items-center justify-center">
                <Layers className="w-12 h-12 text-stone-300 mb-3" />
                <span>{lang === 'ka' ? 'აირჩიეთ ვენახის ნაკვეთი გვერდით რეესტრიდან მევენახეობის სამართავი პანელის გასახსნელად.' : 'Select a vineyard block from the sidebar registry to deploy the viticulture control station.'}</span>
                <div className="mt-4 flex flex-col sm:flex-row gap-2 not-italic font-sans">
                  {blocks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openVaziTab('blocks', blocks[0].id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4e0e15] px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-[#801323]"
                    >
                      <ArrowRight className="w-3.5 h-3.5" /> {lang === 'ka' ? 'პირველი ნაკვეთის არჩევა' : 'Select first block'}
                    </button>
                  )}
                  {canCreateVineyardRecord && (
                    <button
                      type="button"
                      onClick={() => setShowAddBlockModal(true)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-900 transition-colors hover:bg-emerald-50"
                    >
                      <Plus className="w-3.5 h-3.5" /> {lang === 'ka' ? 'ნაკვეთის დამატება' : 'Add block'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 3: SPRAYING RECORDS
          ========================================== */}
      {vaziTab === 'spraying' && selectedBlock && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 font-sans">

          {/* Add Spray Record Form */}
          {canCreateVineyardRecord && (
          <div className="lg:col-span-1 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 p-6 lg:p-7 rounded-2xl h-fit shadow-xs space-y-4 text-xs text-stone-600">
            <h4 className="font-serif font-black text-sm text-emerald-950 border-b border-stone-100 dark:border-stone-800 pb-2">{lang === 'ka' ? 'ქიმიური დამუშავების ჩაწერა' : 'Record Chemical Application'}</h4>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!canCreateVineyardRecord) return;
              if (drawnPoints.length > 0 && !drawnBoundaryValidation.valid) return;
              const form = e.currentTarget;
              const fd = new FormData(form);
              const targetProblem = fd.get('targetProblem') as string;
              const productName = fd.get('productName') as string;
              const active = fd.get('activeIngredient') as string;
              const dose = parseFloat(fd.get('dosePerHa') as string);
              const water = parseFloat(fd.get('waterVolumePerHa') as string);
              const operator = fd.get('operator') as string;
              const machinery = fd.get('machineryUsed') as string;
              const phi = parseInt(fd.get('phi') as string) || 14;
              const rei = parseInt(fd.get('rei') as string) || 24;

              if (targetProblem && productName) {
                runVaziMutationIfAllowed(canCreateVineyardRecord, () => onAddSprayRecord({
                  blockId: selectedBlock.id,
                  date: new Date().toISOString().split('T')[0],
                  targetProblem,
                  productName,
                  activeIngredient: active,
                  dosePerHa: dose,
                  waterVolumePerHa: water,
                  totalProductUsed: Math.round(dose * selectedBlock.area * 10) / 10,
                  totalWaterUsed: Math.round(water * selectedBlock.area),
                  operator,
                  machineryUsed: machinery,
                  windSpeed: blockWeather?.wind ?? 0,
                  temperature: blockWeather?.temp ?? 0,
                  humidity: blockWeather?.humidity ?? 0,
                  preHarvestIntervalDays: phi,
                  reEntryIntervalHours: rei,
                  notes: lang === 'ka'
                    ? `ავტორიზებული ქიმიური წამლობის კამპანია ${targetProblem}-ის პრევენციისთვის.`
                    : `Authorized chemical pesticide spraying campaign for ${targetProblem} prevention on Saperavi rows.`
                }));
                form.reset();
              }
            }} className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'სამიზნე პრობლემა / დაავადება *' : 'Target Problem / Disease *'}</label>
                <input
                  type="text"
                  name="targetProblem"
                  placeholder={lang === 'ka' ? 'მაგ., ჭრაქის პრევენცია' : 'e.g., Downy Mildew prevention'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium text-stone-800"
                  required
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ქიმიური პროდუქტი / ნაერთი *' : 'Chemical Product / Compound *'}</label>
                <input
                  type="text"
                  name="productName"
                  placeholder={lang === 'ka' ? 'მაგ., Valiant Cu-7 Copp' : 'e.g., Valiant Cu-7 Copp'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'აქტიური ნივთიერება' : 'Active Ingredient'}</label>
                  <input type="text" name="activeIngredient" placeholder={lang === 'ka' ? 'სპილენძის ჰიდროქსიდი' : 'Copper hydroxide'} className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ოპერატორი' : 'Operator'}</label>
                  <input type="text" name="operator" placeholder={lang === 'ka' ? 'ნუგზარ ჯინჭარაძე' : 'Nugzar Jincharadze'} className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დოზა/ჰა (კგ/ლ)' : 'Dose/ha (kg/L)'}</label>
                  <input type="number" step="0.1" name="dosePerHa" defaultValue="2.0" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'წყლის მოცულობა/ჰა (ლ)' : 'Water volume/ha (L)'}</label>
                  <input type="number" step="10" name="waterVolumePerHa" defaultValue="400" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'PHI (რთველამდე დღეები)' : 'PHI (Pre-Harvest Days)'}</label>
                  <input type="number" name="phi" defaultValue="21" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'REI (ხელახლა შესვლის საათები)' : 'REI (Re-Entry Hours)'}</label>
                  <input type="number" name="rei" defaultValue="24" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none" />
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ტრაქტორი და შესხურებელი' : 'Tractor & Sprayer Unit'}</label>
                <input type="text" name="machineryUsed" placeholder={lang === 'ka' ? 'Fendt 207V, Hardi შესხურებელით' : 'Fendt 207V with Hardi Sprayer'} className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none" />
              </div>

              {/* Instant Safety Warnings block */}
              {blockWeather && blockWeather.wind > 12 && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg font-mono text-[10px] space-y-1 block">
                  <span className="font-extrabold uppercase text-[9px] block">{lang === 'ka' ? '⚠️ ძლიერი ქარის საფრთხე' : '⚠️ HIGH WIND HAZARD'}</span>
                  {lang === 'ka'
                    ? `ქარის ამჟამინდელი სიჩქარეა ${blockWeather.wind} კმ/სთ. მაღალი გადატანის რისკი. გადადეთ დამუშავება დილის ადრეულ საათებზე!`
                    : `Local wind speed is currently ${blockWeather.wind} km/h. High drift risks. Delay application sequence to early morning!`}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold font-mono uppercase tracking-wider py-2 rounded-lg cursor-pointer transition-colors"
              >
                {lang === 'ka' ? 'წამლობის კამპანიის დაწყება' : 'Launch Field Spray Campaign'}
              </button>
            </form>
          </div>
          )}

          {/* Spraying History list */}
          <div className={`${canCreateVineyardRecord ? 'lg:col-span-2 xl:col-span-3' : 'lg:col-span-3 xl:col-span-4'} bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4`}>
            <h4 className="font-serif font-bold text-sm text-[#4e0e15]">{lang === 'ka' ? 'წამლობის ჟურნალი' : 'Pesticide and Spraying Logbook'} — {selectedBlock.name}</h4>
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1" tabIndex={0}>
              {sprays.filter(s => s.blockId === selectedBlock.id).map(spray => (
                <div key={spray.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all font-sans space-y-2 relative">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] bg-red-100 text-red-800 border border-red-200 px-2 py-0.5 rounded font-mono font-bold">
                      🛡️ PHI: {spray.preHarvestIntervalDays} {lang === 'ka' ? 'დღე' : 'Days Safety'}
                    </span>
                    <span className="text-[9px] bg-sky-100 text-sky-850 px-2 py-0.5 rounded font-mono font-bold">
                      REI: {spray.reEntryIntervalHours} {lang === 'ka' ? 'საათი' : 'hours'}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono ml-auto">{spray.date} • {lang === 'ka' ? 'ოპერატორი' : 'Operator'} {spray.operator}</span>
                  </div>

                  <h5 className="font-bold text-stone-900 text-sm leading-tight">{lang === 'ka' ? 'გამოყენებული' : 'Applied'}: {spray.productName} ({spray.activeIngredient})</h5>
                  <p className="text-xs text-stone-500 leading-relaxed bg-[#fbf9f6]/60 p-2 rounded border border-dashed border-[#e8dfd5]/60">
                    <strong>{lang === 'ka' ? 'სამიზნე:' : 'Target:'}</strong> {spray.targetProblem} <br />
                    <strong>{lang === 'ka' ? 'დოზირება:' : 'Machinery Dosage:'}</strong> {lang === 'ka'
                      ? <>{spray.dosePerHa} კგ/ჰა, {spray.waterVolumePerHa}ლ/ჰა წყალში. სულ: <strong>{spray.totalProductUsed} კგ</strong> პესტიციდი <strong>{spray.totalWaterUsed}ლ</strong> წყალში.</>
                      : <>{spray.dosePerHa} kg/ha in {spray.waterVolumePerHa}L/ha water. Total quantity: <strong>{spray.totalProductUsed} kg</strong> pesticide in <strong>{spray.totalWaterUsed}L</strong> water.</>}
                  </p>

                  <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-stone-550 pt-1">
                    <div>🌡️ {lang === 'ka' ? 'ტემპ.' : 'Temp'}: {spray.temperature}°C</div>
                    <div>🍃 {lang === 'ka' ? 'ქარი' : 'Wind'}: {spray.windSpeed} km/h</div>
                    <div>💧 {lang === 'ka' ? 'ტენიანობა' : 'Humidity'}: {spray.humidity}%</div>
                  </div>
                </div>
              ))}

              {sprays.filter(s => s.blockId === selectedBlock.id).length === 0 && (
                <div className="text-center py-12 text-stone-400 italic font-mono text-xs">
                  <Wind className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                  {lang === 'ka' ? 'ამ ნაკვეთზე ქიმიური დამუშავება არ არის ჩაწერილი.' : 'No chemical treatments recorded for this block.'}
                  <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2 not-italic font-sans">
                    <button
                      type="button"
                      onClick={() => openVaziTab('scouting', selectedBlock.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-900 transition-colors hover:bg-emerald-100"
                    >
                      <CheckSquare className="w-3.5 h-3.5" /> {lang === 'ka' ? 'ჯერ დაათვალიერეთ' : 'Scout first'}
                    </button>
                    {canCreateTask && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!canCreateTask) return;
                          setPrefilledTaskTitle?.(lang === 'ka' ? `წამლობის კამპანიის დაგეგმვა — ${selectedBlock.name}` : `Plan spray campaign for ${selectedBlock.name}`);
                          setPrefilledTaskPriority?.('medium');
                          setPrefilledTaskDesc?.(lang === 'ka'
                            ? `გადახედეთ ${selectedBlock.name}-ის მდგომარეობას და საჭიროების შემთხვევაში დაგეგმეთ დამუშავება.`
                            : `Review canopy conditions for ${selectedBlock.name} and schedule treatment if disease pressure warrants it.`);
                          navigateTo({ module: 'gvino', tab: 'tasks' });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-[#801323]"
                      >
                        <ArrowRight className="w-3.5 h-3.5" /> {lang === 'ka' ? 'დავალების შექმნა' : 'Create task'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 4: DISEASE SCOUTING
          ========================================== */}
      {vaziTab === 'scouting' && selectedBlock && (
        <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-8 font-sans">

          {/* Add Scouting Record form */}
          {canCreateVineyardRecord && (
          <div className="lg:col-span-1 bg-white dark:bg-stone-900 border border-[#e8dfd5] dark:border-stone-800 p-6 lg:p-7 rounded-2xl h-fit shadow-xs space-y-4 text-xs text-stone-600">
            <h4 className="font-serif font-black text-sm text-emerald-950 border-b border-stone-100 dark:border-stone-800 pb-2">{lang === 'ka' ? 'პათოგენზე დაკვირვების ჩაწერა' : 'Log Pathogen Scouting'}</h4>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!canCreateVineyardRecord) return;
              const form = e.currentTarget;
              const fd = new FormData(form);
              const path = fd.get('problemType') as any;
              const loc = fd.get('locationDetails') as string;
              const sev = fd.get('severity') as any;
              const rec = fd.get('recommendedAction') as string;
              const note = fd.get('notes') as string;

              if (path && loc) {
                runVaziMutationIfAllowed(canCreateVineyardRecord, () => onAddScoutingRecord({
                  blockId: selectedBlock.id,
                  date: new Date().toISOString().split('T')[0],
                  locationDetails: loc,
                  problemType: path,
                  severity: sev,
                  notes: note,
                  recommendedAction: rec,
                  followUpTaskId: `scout-task-${Date.now()}`
                }));
                form.reset();
              }
            }} className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'პათოგენი / პრობლემის ტიპი *' : 'Pathogen / Problem Type *'}</label>
                <select name="problemType" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1.5 outline-none font-bold text-stone-800">
                  <option value="Downy mildew">🌾 {lang === 'ka' ? 'ჭრაქი' : 'Downy Mildew'}</option>
                  <option value="Powdery mildew">🌫️ {lang === 'ka' ? 'ნაცარი (ოიდიუმი)' : 'Powdery Mildew'}</option>
                  <option value="Botrytis">🍇 {lang === 'ka' ? 'ნაცრისფერი ლპობა (ბოტრიტისი)' : 'Botrytis Bunch Rot'}</option>
                  <option value="Black rot">⚫ {lang === 'ka' ? 'შავი სიდამპლე' : 'Black Rot'}</option>
                  <option value="Esca">🪵 {lang === 'ka' ? 'ესკა (ღეროს დაავადება)' : 'Esca Trunk Disease'}</option>
                  <option value="Mites">🕷️ {lang === 'ka' ? 'წითელი ტკიპა' : 'Red Spider Mites'}</option>
                  <option value="Grape moth">🦋 {lang === 'ka' ? 'ვაზის ჩრჩილი' : 'European Grape Moth'}</option>
                  <option value="Nutrient deficiency">🍂 {lang === 'ka' ? 'ქლოროზი / ნიადაგის დეფიციტი' : 'Chlorosis / Nutrient Defic'}</option>
                  <option value="Water stress">🏜️ {lang === 'ka' ? 'წყლის მწვავე დეფიციტი' : 'Severe Water Stress'}</option>
                  <option value="Hail damage">⛈️ {lang === 'ka' ? 'სეტყვის დაზიანება' : 'Hail Injury'}</option>
                  <option value="Sunburn">☀️ {lang === 'ka' ? 'მზის დამწვრობა' : 'Cluster Sunburn'}</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'რიგი / ადგილმდებარეობა *' : 'Field Row / Location detail *'}</label>
                <input
                  type="text"
                  name="locationDetails"
                  placeholder={lang === 'ka' ? 'მაგ. 24-დან 36 რიგამდე, სამხრეთი დაქანება' : 'e.g. Rows 24 to 36, southern depression'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium"
                  required
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დაფიქსირებული სიმძიმე' : 'Observed Severity'}</label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as const).map(s => (
                    <label key={s} className="flex-1 text-center py-1.5 border border-stone-200 rounded-lg cursor-pointer hover:bg-stone-50 font-mono text-[10px] font-bold block uppercase">
                      <input
                        type="radio"
                        name="severity"
                        value={s}
                        defaultChecked={s === 'low'}
                        className="mr-1 accent-emerald-800"
                      />
                      {lang === 'ka' ? (s === 'low' ? 'დაბალი' : s === 'medium' ? 'საშუალო' : 'მაღალი') : s}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'რეკომენდებული სამოქმედო გეგმა' : 'Recommended Action Plan'}</label>
                <textarea
                  name="recommendedAction"
                  placeholder={lang === 'ka' ? 'მაგ. დაუყოვნებლივ დაგეგმეთ სისტემური დამცავი წამლობა...' : 'e.g. Schedule systemic protective spraying immediately...'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-16 outline-none text-xs"
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დაკვირვების შენიშვნები / რაოდენობა' : 'Scouting Observations / Count'}</label>
                <textarea
                  name="notes"
                  placeholder={lang === 'ka' ? 'მაგ. ფოთლის ქვედა ზედაპირზე შესამჩნევია ზეთისებრი ლაქები...' : 'e.g. Faint oil spots on lower leaf surface detected...'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-lg p-2.5 h-16 outline-none text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white font-extrabold font-mono uppercase tracking-wider py-2 rounded-lg cursor-pointer transition-colors hover-lift"
              >
                {lang === 'ka' ? 'დაკვირვების ჩანაწერის შენახვა' : 'Save Scouting Record'}
              </button>
            </form>
          </div>
          )}

          {/* Scouting List */}
          <div className={`${canCreateVineyardRecord ? 'lg:col-span-2 xl:col-span-3' : 'lg:col-span-3 xl:col-span-4'} bg-white dark:bg-stone-900 rounded-3xl border border-[#e8dfd5] dark:border-stone-800 p-8 shadow-sm space-y-5`}>
            <h4 className="font-serif font-bold text-sm text-[#4e0e15]">{lang === 'ka' ? 'ველის პათოლოგიის უწყვეტი ჩანაწერები' : 'Continuous Field Pathology Records'}</h4>
            <div className="space-y-4">
              {scoutings.filter(sc => sc.blockId === selectedBlock.id).map(scout => (
                <div key={scout.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all font-sans relative flex justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-sm font-bold ${
                        scout.severity === 'high' ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                        scout.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {lang === 'ka'
                          ? (scout.severity === 'high' ? '🔴 სიმძიმე: მაღალი' : scout.severity === 'medium' ? '🟡 სიმძიმე: საშუალო' : '⚪ სიმძიმე: დაბალი')
                          : (scout.severity === 'high' ? '🔴 Severity: High' : scout.severity === 'medium' ? '🟡 Severity: Medium' : '⚪ Severity: Low')}
                      </span>
                      <span className="text-[10px] bg-slate-100 text-stone-600 font-mono px-1.5 py-0.2 rounded font-semibold">
                        {lang === 'ka' ? 'ადგილი' : 'Location'}: {scout.locationDetails}
                      </span>
                      <span className="text-[9px] text-slate-500 dark:text-slate-400 font-mono ml-auto">{scout.date}</span>
                    </div>

                    <h5 className="font-black text-stone-900 text-sm leading-tight">{lang === 'ka' ? 'გამოვლენილი პრობლემა' : 'Detected Problem'}: <span className="text-[#801323]">{scout.problemType}</span></h5>
                    <p className="text-xs text-stone-600 leading-relaxed"><strong className="text-slate-500">{lang === 'ka' ? 'დაკვირვების შენიშვნები:' : 'Observation Notes:'}</strong> {scout.notes}</p>
                    {scout.recommendedAction && (
                      <div className="text-xs text-emerald-800 bg-emerald-50/70 p-2.5 rounded border border-emerald-100 flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>{lang === 'ka' ? 'სამოქმედო გეგმა:' : 'Farming Action Plan:'}</strong> {scout.recommendedAction}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {scoutings.filter(sc => sc.blockId === selectedBlock.id).length === 0 && (
                <div className="text-center py-12 text-stone-400 italic font-mono text-xs">
                  <CheckSquare className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                  {lang === 'ka' ? 'დაკვირვების ჩანაწერები სუფთაა — პათოგენები არ დაფიქსირებულა!' : 'Your canopy scouting reports are perfectly clean. No pathogens spotted!'}
                  <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2 not-italic font-sans">
                    <button
                      type="button"
                      onClick={() => openVaziTab('spraying', selectedBlock.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-emerald-900 transition-colors hover:bg-emerald-100"
                    >
                      <Wind className="w-3.5 h-3.5" /> {lang === 'ka' ? 'წამლობების გახსნა' : 'Open sprays'}
                    </button>
                    {canCreateTask && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!canCreateTask) return;
                          setPrefilledTaskTitle?.(lang === 'ka' ? `${selectedBlock.name}-ის დათვალიერება` : `Scout ${selectedBlock.name}`);
                          setPrefilledTaskPriority?.('low');
                          setPrefilledTaskDesc?.(lang === 'ka'
                            ? `შემოიარეთ ${selectedBlock.name}, ჩაიწერეთ დაავადებების წნეხი და განაახლეთ ვაზის დაკვირვების ჟურნალი.`
                            : `Walk ${selectedBlock.name}, record disease pressure, and update the Vazi scouting log.`);
                          navigateTo({ module: 'gvino', tab: 'tasks' });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-[#801323]"
                      >
                        <ArrowRight className="w-3.5 h-3.5" /> {lang === 'ka' ? 'დავალების შექმნა' : 'Create task'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ==========================================
          TAB 5: GRAPE SAMPLING & GRAPHS
          ========================================== */}
      {vaziTab === 'sampling' && selectedBlock && (
        <div className="space-y-6 font-sans">

          {/* Top Form to Record new Analytical Grape Sample */}
          {canCreateVineyardRecord && (
          <div className="bg-white border border-[#e8dfd5] p-5 rounded-2xl shadow-sm space-y-4">
            <h4 className="font-serif font-black text-sm text-[#4e0e15] border-b border-stone-100 pb-2">{lang === 'ka' ? 'რთველისწინა სიმწიფის ნიმუშის ჩაწერა' : 'Record Pre-Harvest Grape Mature Sampling'}</h4>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (!canCreateVineyardRecord) return;
              const form = e.currentTarget;
              const fd = new FormData(form);
              const brix = parseFloat(fd.get('brix') as string);
              const ph = parseFloat(fd.get('ph') as string);
              const ta = parseFloat(fd.get('ta') as string);
              const weight = parseFloat(fd.get('weight') as string);
              const taste = fd.get('taste') as string;
              const seed = fd.get('seed') as any;

              if (brix && ph) {
                runVaziMutationIfAllowed(canCreateVineyardRecord, () => onAddSamplings({
                  blockId: selectedBlock.id,
                  date: new Date().toISOString().split('T')[0],
                  brix,
                  pH: ph,
                  totalAcidityGL: ta,
                  berryWeightG: weight,
                  phenolicMaturity: brix > 22 ? 'Optimal' : 'Intermediate',
                  seedColor: seed,
                  tasteNotes: taste,
                  diseaseCondition: 'Healthy grapes',
                  estimatedHarvestDate: selectedBlock.estimatedHarvestDate,
                  notes: lang === 'ka' ? `ყურძნის მტევნის ხელით აღებული ნიმუში.` : `Manual grape cluster sampling recorded for vintage checkup.`
                }));
                form.reset();
                alert(lang === 'ka' ? 'შაქრის დაგროვების ნიმუშის ჩანაწერი შენახულია!' : 'Sugar accumulation sample logs saved successfully!');
              }
            }} className="grid grid-cols-2 md:grid-cols-6 gap-4 text-xs">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'შაქრიანობა (°Brix) *' : 'Sugar Density (°Brix) *'}</label>
                <input type="number" step="0.1" name="brix" defaultValue="19.5" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" required />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'აქტიური pH *' : 'Active pH *'}</label>
                <input type="number" step="0.01" name="ph" defaultValue="3.15" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" required />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'საერთო მჟავიანობა (გ/ლ ღვინის მჟავა)' : 'Total Acidity (g/L Tartaric)'}</label>
                <input type="number" step="0.1" name="ta" defaultValue="7.4" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მარცვლის საშ. წონა (გ)' : 'Average Berry Wt (grams)'}</label>
                <input type="number" step="0.01" name="weight" defaultValue="1.20" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none" />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'წიპწის სიმწიფე' : 'Seed Lignified Status'}</label>
                <select name="seed" className="w-full bg-stone-50 border border-slate-250 rounded px-2 py-1.5 text-stone-900 outline-none">
                  <option value="Green">🟢 {lang === 'ka' ? 'მწვანე' : 'Hydrated Green'}</option>
                  <option value="Yellow-brown">🟡 {lang === 'ka' ? 'ნახევრად ყავისფერი' : 'Semi-Brown'}</option>
                  <option value="Dark brown">🟤 {lang === 'ka' ? 'მუქი ყავისფერი' : 'Lignified Dark Brown'}</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 font-mono font-bold uppercase rounded cursor-pointer leading-tight"
                >
                  {lang === 'ka' ? 'ნიმუშის შენახვა' : 'Save Sample'}
                </button>
              </div>
            </form>
          </div>
          )}

          {/* Interactive Recharts Graphics showing maturity curves */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Recharts 1: Brix vs Berry Weight */}
            <div className="bg-white border border-[#e8dfd5] p-5 rounded-xl shadow-sm space-y-2">
              <h5 className="font-serif font-bold text-stone-900 text-xs">{lang === 'ka' ? 'შაქრის დაგროვების ტემპი (°Brix ტრენდი)' : 'Sugar Accumulation Rate (°Brix Trend)'}</h5>
              <div className="h-64 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={samplings.filter(s => s.blockId === selectedBlock.id).sort((a,b) => a.date.localeCompare(b.date))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f3f5" />
                    <XAxis dataKey="date" stroke="#888" fontSize={9} />
                    <YAxis stroke="#888" domain={[10, 26]} fontSize={9} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="brix" name={lang === 'ka' ? 'Brix დონე' : 'Brix level'} stroke="#801323" strokeWidth={2.5} activeDot={{ r: 6 }} />
                    <Line type="monotone" dataKey="berryWeightG" name={lang === 'ka' ? 'მარცვლის წონა (გ)' : 'Berry Weight (g)'} stroke="#0ea5e9" strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recharts 2: pH vs Acidity */}
            <div className="bg-white border border-[#e8dfd5] p-5 rounded-xl shadow-sm space-y-2">
              <h5 className="font-serif font-bold text-stone-900 text-xs">{lang === 'ka' ? 'pH-ის ზრდა vs. ღვინის მჟავის კლება' : 'pH Rise vs. Total Tartaric Acidity Decline'}</h5>
              <div className="h-64 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={samplings.filter(s => s.blockId === selectedBlock.id).sort((a,b) => a.date.localeCompare(b.date))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f3f5" />
                    <XAxis dataKey="date" stroke="#888" fontSize={9} />
                    <YAxis yAxisId="left" stroke="#888" domain={[2.8, 3.8]} fontSize={9} name="pH" />
                    <YAxis yAxisId="right" orientation="right" stroke="#888" domain={[4, 12]} fontSize={9} name="TA g/L" />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line yAxisId="left" type="monotone" dataKey="pH" name={lang === 'ka' ? 'pH დონე' : 'pH level'} stroke="#eab308" strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="totalAcidityGL" name={lang === 'ka' ? 'ღვინის მჟავა (გ/ლ)' : 'Tartaric Acid (g/L)'} stroke="#b45309" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* ==========================================
          TAB 6: YIELD ESTIMATOR & HARVEST
          ========================================== */}
      {vaziTab === 'yield' && selectedBlock && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 font-sans">

          {/* Yield Calculator */}
          <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-5">
            <div>
              <h4 className="font-serif font-black text-sm text-[#4e0e15] flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-[#801323]" />
                {lang === 'ka' ? 'მოსავლიანობის კალკულატორი' : 'Micro-Yield Calculator Estimates'}
              </h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{lang === 'ka' ? 'ყურძნის სავარაუდო კილოგრამები, ტონა ჰექტარზე და მოსალოდნელი ტკბილის მოცულობა' : 'Predicted grape crop kilograms, tons per acre, and anticipated total juice volumes'}</p>
            </div>

            {/* Interactive sliders for robust yield estimation */}
            <div className="space-y-4 text-xs font-semibold text-stone-700">
              <div>
                <label className="text-[10px] tracking-wider uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1">{lang === 'ka' ? 'ვაზების საერთო რაოდენობა ნაკვეთზე' : 'Total Vine Count on Block'}</label>
                <div className="bg-stone-50 border border-stone-200 p-2 text-[#4e0e15] text-sm font-black rounded font-mono">
                  {selectedBlock.vinesCount.toLocaleString()} {lang === 'ka' ? 'ვაზი' : 'Vines'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] tracking-wider uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1">{lang === 'ka' ? 'მტევნების საშ. რაოდენობა ვაზზე' : 'Avg Grape Clusters per Vine'}</label>
                  <input type="number" defaultValue="15" className="w-full bg-stone-50 border border-stone-200 px-2 py-1.5 font-mono" id="cluster-count" />
                </div>
                <div>
                  <label className="text-[10px] tracking-wider uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1">{lang === 'ka' ? 'მტევნის საშ. წონა (გ)' : 'Avg Bunch Weight (gr)'}</label>
                  <input type="number" defaultValue="125" className="w-full bg-stone-50 border border-stone-200 px-2 py-1.5 font-mono" id="bunch-weight" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const bCount = parseFloat((document.getElementById('cluster-count') as HTMLInputElement).value) || 15;
                  const bWeight = parseFloat((document.getElementById('bunch-weight') as HTMLInputElement).value) || 125;

                  // Computations
                  const totalKg = Math.round(selectedBlock.vinesCount * bCount * (bWeight / 1000));
                  const totalTons = Math.round((totalKg / 1000) * 10) / 10;
                  const tonsPerHa = Math.round((totalTons / selectedBlock.area) * 10) / 10;
                  const expectedJuiceLiters = Math.round(totalKg * 0.70); // 70% average extraction recovery

                  // Show inside target outputs
                  (document.getElementById('pred-kg') as HTMLSpanElement).innerText = totalKg.toLocaleString() + " Kg";
                  (document.getElementById('pred-tons') as HTMLSpanElement).innerText = totalTons + " Tons";
                  (document.getElementById('pred-ha') as HTMLSpanElement).innerText = tonsPerHa + " t/ha";
                  (document.getElementById('pred-juice') as HTMLSpanElement).innerText = expectedJuiceLiters.toLocaleString() + " L";
                }}
                className="w-full bg-[#4e0e15] hover:bg-[#801323] text-white py-2 font-mono uppercase tracking-wider text-xs cursor-pointer font-extrabold rounded"
              >
                {lang === 'ka' ? 'მოსავლის მოცულობის გამოთვლა' : 'Compute Crop Volume Projections'}
              </button>

              <hr className="border-stone-100" />

              {/* Outputs grid */}
              <div className="grid grid-cols-2 gap-4 font-mono">
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">{lang === 'ka' ? 'სავარაუდო კგ' : 'Predicted Kg'}</span>
                  <strong className="text-base text-stone-800 block mt-1" id="pred-kg">{(selectedBlock.vinesCount * 15 * 0.125).toLocaleString()} {lang === 'ka' ? 'კგ' : 'Kg'}</strong>
                </div>
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">{lang === 'ka' ? 'სავარაუდო ტონა' : 'Predicted Tons'}</span>
                  <strong className="text-base text-stone-800 block mt-1" id="pred-tons">{Math.round(((selectedBlock.vinesCount * 15 * 0.125) / 1000) * 10) / 10} {lang === 'ka' ? 'ტონა' : 'Tons'}</strong>
                </div>
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">{lang === 'ka' ? 'მოსავალი ჰექტარზე' : 'Yield per Hectare'}</span>
                  <strong className="text-base text-amber-700 block mt-1" id="pred-ha">{Math.round(((((selectedBlock.vinesCount * 15 * 0.125) / 1000)) / selectedBlock.area) * 10) / 10} t/ha</strong>
                </div>
                <div className="p-3 bg-[#FAF8F5]/80 rounded border border-[#e8dfd5]/60 text-center">
                  <span className="text-[8px] text-slate-500 dark:text-slate-400 uppercase block font-sans">{lang === 'ka' ? 'სავარაუდო ტკბილი' : 'Est. Wine Juice Recovery'}</span>
                  <strong className="text-base text-emerald-800 block mt-1" id="pred-juice">{Math.round(selectedBlock.vinesCount * 15 * 0.125 * 0.70).toLocaleString()} L</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Harvest Planning Page with Winery Direct Connection */}
          <div className="bg-white border border-[#e8dfd5] p-6 rounded-2xl shadow-sm space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="font-serif font-black text-sm text-[#4e0e15] flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-800" />
                  {lang === 'ka' ? 'რთველი და მიკვლევადობის ბმულები' : 'Active Crop Harvest & Traceability Links'}
                </h4>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{lang === 'ka' ? 'დაგეგმეთ რთველი და მოსავალი პირდაპირ გადაამისამართეთ ღვინის მარნის დამუშავებაში' : 'Schedule harvest campaigns and dispatch crops directly to Gvino cellar processing'}</p>
              </div>
              {canCreateVineyardRecord && (
                <button
                  type="button"
                  aria-expanded={showHarvestPlanForm}
                  aria-controls="harvest-plan-editor"
                  onClick={() => {
                    setHarvestPlanStatus(null);
                    setShowHarvestPlanForm(current => !current);
                  }}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-emerald-950"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {showHarvestPlanForm
                    ? (lang === 'ka' ? 'ფორმის დახურვა' : 'Close form')
                    : (lang === 'ka' ? 'რთველის გეგმის შექმნა' : 'Create harvest plan')}
                </button>
              )}
            </div>

            {harvestPlanStatus && (
              <div role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-semibold text-emerald-900">
                <Check className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
                {lang === 'ka'
                  ? `${harvestPlanStatus.blockName}-ის რთველის გეგმა შენახულია ${harvestPlanStatus.targetDate}-ისთვის.`
                  : `Harvest plan for ${harvestPlanStatus.blockName} was saved for ${harvestPlanStatus.targetDate}.`}
              </div>
            )}

            {harvestDispatchStatus && (
              <div role="status" aria-live="assertive" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-semibold leading-relaxed text-emerald-900">
                <Check className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
                {lang === 'ka'
                  ? `${harvestDispatchStatus.harvestedKg} კგ ${harvestDispatchStatus.variety} გადაცემულია მარნის პარტიად ${harvestDispatchStatus.lotId}. იხსნება Gvino…`
                  : `${harvestDispatchStatus.harvestedKg} kg of ${harvestDispatchStatus.variety} was dispatched as Gvino lot ${harvestDispatchStatus.lotId}. Opening Gvino…`}
              </div>
            )}

            {showHarvestPlanForm && canCreateVineyardRecord && (
              <div id="harvest-plan-editor">
                <HarvestPlanForm
                  key={selectedBlock.id}
                  lang={lang}
                  block={selectedBlock}
                  onCancel={() => setShowHarvestPlanForm(false)}
                  onCreate={(record) => {
                    const created = runVaziMutationIfAllowed(canCreateVineyardRecord, () => {
                      onAddHarvestRecord(record);
                      return true;
                    });
                    if (!created) return;
                    setHarvestPlanStatus({
                      blockName: selectedBlock.name,
                      targetDate: record.estimatedHarvestDate,
                    });
                    setShowHarvestPlanForm(false);
                  }}
                />
              </div>
            )}

            <div className="space-y-4">
              {harvests.filter(h => h.blockId === selectedBlock.id).map(harvest => (
                <div key={harvest.id} className="p-4 border border-[#e8dfd5]/65 bg-[#FAF8F5]/50 rounded-xl space-y-3">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <span className="text-[9px] bg-amber-100 text-amber-800 font-mono font-bold px-2 py-0.5 rounded">
                      {lang === 'ka' ? 'დაგეგმილი თარიღი' : 'Planned Target Date'}: {harvest.estimatedHarvestDate}
                    </span>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded font-extrabold ${harvest.sentToGvino ? 'bg-emerald-100 text-emerald-800' : 'bg-red-50 text-red-700 border border-red-200 animate-pulse'}`}>
                      {harvest.sentToGvino
                        ? (lang === 'ka' ? '✅ მიღებულია მარანში' : '✅ Received in Gvino')
                        : (lang === 'ka' ? '⚠️ რთველი მოლოდინში' : '⚠️ Pending Harvest Draft')}
                    </span>
                  </div>

                  <div className="text-xs space-y-2">
                    <div>
                      <strong>{lang === 'ka' ? 'ჯიშის სახელი:' : 'Variety Name:'}</strong> {harvest.variety} <br />
                      <strong>{lang === 'ka' ? 'მოსავლის სავარაუდო წონა:' : 'Estimated Yield Weight:'}</strong> {harvest.estimatedTons} {lang === 'ka' ? 'ტონა (მოსალოდნელი)' : 'Tons anticipated'} <br />
                      <strong>{lang === 'ka' ? 'რთველის სპეც. ინსტრუქციები:' : 'Special Harvesting Instructions:'}</strong> {harvest.notes}
                    </div>

                    {harvest.sentToGvino ? (
                      <div className="p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-900 text-[11px] rounded font-mono space-y-1 block">
                        <strong>{lang === 'ka' ? 'მიკვლევადობა უზრუნველყოფილია:' : 'Traceability Secured:'}</strong> {lang === 'ka' ? 'მოსავლის გადაცემა დასრულდა.' : 'Crop dispatch completed.'} <br />
                        {lang === 'ka' ? 'შესაბამისი მარნის პარტიის ID:' : 'Corresponding Winery Lot ID:'} <strong className="text-stone-800 font-black">{harvest.associatedLotId}</strong>
                      </div>
                    ) : canDispatchHarvestToGvino ? (
                      <div className="pt-2">
                        {onPrepareHarvestIntake && (
                          <p className="mb-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-semibold leading-relaxed text-emerald-900">
                            {lang === 'ka'
                              ? 'გახსენით მიღების სრული ფორმა, გადაამოწმეთ ფაქტობრივი წონა, თარიღი, ქიმია და დანიშნულების ჭურჭელი, შემდეგ დაადასტურეთ ერთი ატომური ჩანაწერი.'
                              : 'Open the full intake form, review actual weight, date, chemistry, and destination vessel, then confirm one atomic record.'}
                          </p>
                        )}
                        <label
                          htmlFor={`qty-${harvest.id}`}
                          className={onPrepareHarvestIntake ? 'sr-only' : 'text-[9px] uppercase font-mono block text-slate-500 dark:text-slate-400 mb-1 font-bold'}
                        >
                          {lang === 'ka' ? 'მოსავლის ფაქტობრივი წონა (კგ)' : 'Actual harvested weight (kg)'}
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                          <input
                            type="number"
                            id={`qty-${harvest.id}`}
                            placeholder={lang === 'ka' ? 'მაგ. 12500' : 'e.g. 12500'}
                            value={harvestDispatchWeights[harvest.id] || ''}
                            min="0.001"
                            step="any"
                            required
                            inputMode="decimal"
                            aria-invalid={Boolean(harvestDispatchErrors[harvest.id])}
                            aria-describedby={harvestDispatchErrors[harvest.id] ? `qty-error-${harvest.id}` : undefined}
                            onChange={(event) => {
                              const value = event.target.value;
                              setHarvestDispatchWeights(current => ({ ...current, [harvest.id]: value }));
                              setHarvestDispatchErrors(current => {
                                if (!current[harvest.id]) return current;
                                const next = { ...current };
                                delete next[harvest.id];
                                return next;
                              });
                            }}
                            className={onPrepareHarvestIntake
                              ? 'hidden'
                              : `h-9 bg-white border px-2 py-1 text-xs outline-none rounded font-mono w-full sm:w-28 text-stone-900 ${harvestDispatchErrors[harvest.id] ? 'border-red-500 focus:ring-2 focus:ring-red-200' : 'border-stone-250 focus:border-emerald-700'}`}
                          />
                          <div className={onPrepareHarvestIntake ? 'hidden' : 'min-w-0 sm:w-36'}>
                            <label
                              htmlFor={`harvest-date-${harvest.id}`}
                              className="mb-1 block text-[9px] font-bold uppercase text-slate-500"
                            >
                              {lang === 'ka' ? 'ფაქტობრივი თარიღი' : 'Actual harvest date'}
                            </label>
                            <input
                              id={`harvest-date-${harvest.id}`}
                              type="date"
                              value={harvestDispatchDates[harvest.id] || localISODate()}
                              onChange={(event) => setHarvestDispatchDates(current => ({
                                ...current,
                                [harvest.id]: event.target.value,
                              }))}
                              className="h-9 w-full rounded border border-stone-250 bg-white px-2 text-xs font-mono text-stone-900 outline-none focus:border-emerald-700"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (!canDispatchHarvestToGvino) return;
                              if (onPrepareHarvestIntake) {
                                onPrepareHarvestIntake(harvest.id);
                                navigateTo({ module: 'gvino', tab: 'intake' });
                                return;
                              }
                              const dispatch = parseHarvestDispatchInput(
                                harvestDispatchWeights[harvest.id] || '',
                                harvestDispatchDates[harvest.id] || localISODate(),
                              );
                              if (!dispatch.ok) {
                                setHarvestDispatchStatus(null);
                                setHarvestDispatchErrors(current => ({ ...current, [harvest.id]: dispatch.reason }));
                                return;
                              }

                              const { harvestedKg, actualHarvestDate, vintage } = dispatch;
                              const grapeLotId = runVaziMutationIfAllowed(canDispatchHarvestToGvino, () => {
                                const lotId = onSendHarvestToGvino(
                                  selectedBlock.id,
                                  harvestedKg,
                                  harvest.variety,
                                  vintage,
                                  actualHarvestDate,
                                );
                                if (!lotId) return undefined;

                                onUpdateHarvestRecord(harvest.id, {
                                  sentToGvino: true,
                                  actualHarvestedKg: harvestedKg,
                                  actualHarvestDate,
                                  associatedLotId: lotId
                                });
                                return lotId;
                              });
                              if (!grapeLotId) return;
                              setHarvestDispatchErrors(current => {
                                if (!current[harvest.id]) return current;
                                const next = { ...current };
                                delete next[harvest.id];
                                return next;
                              });
                              setHarvestDispatchStatus({
                                harvestedKg,
                                variety: harvest.variety,
                                lotId: grapeLotId,
                              });
                              if (dispatchNavigationTimerRef.current) {
                                clearTimeout(dispatchNavigationTimerRef.current);
                              }
                              dispatchNavigationTimerRef.current = setTimeout(() => {
                                navigateTo({ module: 'gvino', tab: 'lots' });
                                dispatchNavigationTimerRef.current = null;
                              }, 900);
                            }}
                            className="flex-1 bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold text-[10px] uppercase font-mono px-3.5 py-1.5 rounded cursor-pointer duration-100 flex items-center justify-center gap-1.5"
                          >
                            <ArrowRight className="w-3.5 h-3.5" /> {onPrepareHarvestIntake
                              ? (lang === 'ka' ? 'მიღების ფორმის გახსნა' : 'Continue in Grape Intake')
                              : (lang === 'ka' ? 'მოსავლის გადაცემა მარანში' : 'Dispatch Crop to Gvino Winery')}
                          </button>
                        </div>
                        {harvestDispatchErrors[harvest.id] && (
                          <p
                            id={`qty-error-${harvest.id}`}
                            role="alert"
                            className="mt-1.5 text-[10px] font-semibold text-red-700"
                          >
                            {harvestDispatchErrors[harvest.id] === 'weight_required'
                              ? (lang === 'ka' ? 'შეიყვანეთ მოსავლის ფაქტობრივი წონა.' : 'Enter the actual harvested weight.')
                              : harvestDispatchErrors[harvest.id] === 'weight_invalid'
                                ? (lang === 'ka' ? 'წონა უნდა იყოს 0 კგ-ზე მეტი.' : 'Weight must be greater than 0 kg.')
                                : (lang === 'ka' ? 'რთველის თარიღი არასწორია. განაახლეთ გვერდი და სცადეთ ხელახლა.' : 'The harvest date is invalid. Refresh and try again.')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
                        {lang === 'ka'
                          ? 'ამ მოსავლის ისტორიის ნახვა შეგიძლიათ, თუმცა მარანში გადაცემა თქვენი როლისთვის მიუწვდომელია.'
                          : 'You can review this harvest, but dispatching it to the winery is unavailable for your role.'}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {harvests.filter(h => h.blockId === selectedBlock.id).length === 0 && (
                <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-8 text-center">
                  <Calendar className="w-10 h-10 text-amber-500/60 mx-auto mb-2" />
                  <p className="text-xs font-bold text-amber-950">{lang === 'ka' ? 'ამ ნაკვეთისთვის რთველის გეგმა ჯერ არ არის' : 'No harvest plans for this block yet'}</p>
                  <p className="mt-1 text-[11px] text-amber-900/70">{lang === 'ka' ? 'გამოიყენეთ ნიმუშები მზადყოფნის შესაფასებლად, შემდეგ რთველის დაწყებისას გადაამისამართეთ ყურძენი მარნის მიღებაში.' : 'Use sampling to judge readiness, then send picked fruit to Gvino intake when harvest starts.'}</p>
                  <div className="mt-4 flex flex-col sm:flex-row justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => openVaziTab('sampling', selectedBlock.id)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-amber-900 transition-colors hover:bg-amber-100"
                    >
                      <FlaskConical className="w-3.5 h-3.5" /> {lang === 'ka' ? 'ნიმუშების გახსნა' : 'Open sampling'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigateTo({ module: 'gvino', tab: 'intake' })}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4e0e15] px-3 py-2 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-[#801323]"
                    >
                      <ArrowRight className="w-3.5 h-3.5" /> {lang === 'ka' ? 'მარნის მიღების გახსნა' : 'Open Gvino intake'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ==========================================
          TAB: IPM PHENOSCHEME
          ========================================== */}
      {vaziTab === 'ipm_pheno' && (
        <IpmPhenoscheme
          lang={lang}
          selectedBlock={selectedBlock}
          sprays={sprays}
          onAddSprayRecord={onAddSprayRecord}
          canCreateVineyardRecord={canCreateVineyardRecord}
          canDeleteVineyardRecord={canDeleteVineyardRecord}
          currentUser={currentUser}
          blockWeather={blockWeather}
        />
      )}

      {/* ==========================================
          TAB 7: AGRO-WEATHER STATION
          ========================================== */}
      {vaziTab === 'weather' && (
        <WeatherTab
          lang={lang}
          blocks={blocks}
          setActiveModule={setActiveModule}
          setActiveTab={setActiveTab}
          setPrefilledTaskTitle={setPrefilledTaskTitle}
          setPrefilledTaskPriority={setPrefilledTaskPriority}
          setPrefilledTaskDesc={setPrefilledTaskDesc}
          canCreateTask={canCreateTask}
        />
      )}

      {/* ==========================================
          ADD BLOCK MODAL
          ========================================== */}
      {showAddBlockModal && canCreateVineyardRecord && (
        <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-55 animate-fade-in font-sans">
          <div
            ref={addBlockDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="vazi-add-block-title"
            tabIndex={-1}
            className="bg-white w-full max-w-lg rounded-2xl border border-stone-200 shadow-xl overflow-hidden text-xs text-stone-600 space-y-4"
          >
            <div className="bg-emerald-950 text-white p-4 flex justify-between items-center font-serif">
              <strong id="vazi-add-block-title" className="text-sm font-bold block">{label.addBlock}</strong>
              <button onClick={() => setShowAddBlockModal(false)} aria-label={lang === 'ka' ? 'ბლოკის დამატების ფანჯრის დახურვა' : 'Close add block dialog'} className="text-white hover:text-stone-300 text-lg cursor-pointer">✕</button>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              if (!canCreateVineyardRecord) return;
              const form = e.currentTarget;
              const fd = new FormData(form);

              const name = fd.get('name') as string;
              const vineyard = fd.get('vineyardName') as string;
              const area = parseFloat(fd.get('area') as string) || 2.5;
              const variety = fd.get('variety') as string;
              const plantYear = parseInt(fd.get('plantYear') as string) || 2012;
              const rows = parseInt(fd.get('rows') as string) || 50;
              const spacing = String(fd.get('spacing') || '');
              const note = String(fd.get('notes') || '');
              const parcelArea = parseFloat(fd.get('parcelArea') as string) || area;
              const cadastralCode = optionalText(String(fd.get('cadastralCode') || ''));
              const officialCadastreDocumentName = optionalText(String(fd.get('officialCadastreDocumentName') || ''));
              const landOwner = optionalText(String(fd.get('landOwner') || ''));
              const grower = optionalText(String(fd.get('grower') || ''));
              const municipality = optionalText(String(fd.get('municipality') || ''));
              const community = optionalText(String(fd.get('community') || ''));
              const village = optionalText(String(fd.get('village') || ''));
              const microzone = optionalText(String(fd.get('microzone') || ''));
              const parcelName = optionalText(String(fd.get('parcelName') || ''));
              const rootstock = optionalText(String(fd.get('rootstock') || ''));
              const clone = optionalText(String(fd.get('clone') || ''));
              const vineyardCondition = optionalText(String(fd.get('vineyardCondition') || ''));

              if (name && variety) {
                runVaziMutationIfAllowed(canCreateVineyardRecord, () => onAddBlock({
                  name,
                  vineyardName: vineyard,
                  locationName: addBlockLocName,
                  cadastralCode,
                  officialCadastreDocumentName,
                  landOwner,
                  grower,
                  municipality,
                  community,
                  village,
                  microzone,
                  parcelName,
                  parcelArea,
                  latitude: addBlockLat,
                  longitude: addBlockLng,
                  area,
                  elevation: addBlockElev,
                  slope: '12% South-West',
                  aspect: 'South-West',
                  soilType: 'Limestone with heavy gravel alluvial deposits',
                  grapeVariety: variety,
                  rootstock,
                  clone,
                  plantingYear: plantYear,
                  spacing,
                  rowsCount: rows,
                  vinesCount: rows * 200, // 200 vines per row approx
                  trainingSystem: 'Guyot',
                  pruningSystem: 'Cane pruned',
                  irrigationEnabled: true,
                  farmingStatus: 'organic',
                  currentPhenology: 'Budburst',
                  estimatedHarvestDate: new Date(2026, 8, 15).toISOString().split('T')[0],
                  notes: note,
                  vineyardCondition,
                  boundary: drawnBoundaryValidation.valid ? drawnPoints : undefined
                }));
                form.reset();
                setDrawnPoints([]);
                setIsDrawingPolygon(false);
                setShowAddBlockModal(false);
              }
            }} className="p-5 space-y-3 max-h-[80vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ნაკვეთის სახელი*' : 'Block Name*'}</label>
                  <input type="text" name="name" placeholder={lang === 'ka' ? 'მაგ. მუკუზანი, სექტორი A' : 'e.g. Mukuzani Sector A'} className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5 outline-none rounded text-stone-900" required />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მამულის/ვენახის სახელი*' : 'Estate/Vineyard Name*'}</label>
                  <input type="text" name="vineyardName" defaultValue="Anaklia Hills" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5 outline-none rounded" required />
                </div>
              </div>

              {/* Location — search a real place (Open-Meteo geocoder) or fine-tune coordinates below */}
              <div className="bg-emerald-50/50 border border-emerald-200/70 p-3 rounded-lg space-y-2">
                <span className="font-bold block text-emerald-900 font-mono text-[9px] uppercase tracking-wider">📍 {lang === 'ka' ? 'ნაკვეთის მდებარეობა' : 'Block Location'}</span>
                <p className="text-[10px] text-emerald-900/70 leading-relaxed">
                  {lang === 'ka'
                    ? 'მოძებნეთ ნებისმიერი ადგილი კოორდინატების დასაყენებლად — მათზეა დამოკიდებული ამინდი, რუკის ხედები და დაავადების რისკის მოდელები. ქვემოთ ხელით დააზუსტეთ განედი/გრძედი.'
                    : "Search any place to set the block's coordinates — they drive weather, map views, and disease-risk models. Fine-tune latitude/longitude manually below."}
                </p>
                <LocationPicker
                  lang={lang}
                  latitude={addBlockLat}
                  longitude={addBlockLng}
                  showManual={false}
                  onChange={(loc) => {
                    setAddBlockLat(parseFloat(loc.latitude.toFixed(4)));
                    setAddBlockLng(parseFloat(loc.longitude.toFixed(4)));
                    if (loc.label) setAddBlockLocName(loc.label);
                    if (typeof loc.elevation === 'number' && loc.elevation > 0) setAddBlockElev(Math.round(loc.elevation));
                  }}
                />

                <div className="w-full h-40 rounded-lg overflow-hidden border border-stone-200 mt-2 relative z-0">
                  <Suspense fallback={<VineyardMapLoading lang={lang} />}>
                    <VineyardMap
                      lang={lang}
                      center={{ lat: addBlockLat, lng: addBlockLng }}
                      drawing={isDrawingPolygon}
                      drawingPoints={drawnPoints}
                      onMapClick={(point) => {
                        if (isDrawingPolygon) {
                          setDrawnPoints(previous => appendBoundaryPoint(previous, point));
                        } else {
                          setAddBlockLat(parseFloat(point.lat.toFixed(4)));
                          setAddBlockLng(parseFloat(point.lng.toFixed(4)));
                        }
                      }}
                      onRemoveDrawingPoint={isDrawingPolygon
                        ? index => setDrawnPoints(previous => removeBoundaryPoint(previous, index))
                        : undefined}
                      heightClassName="h-full min-h-[160px]"
                      ariaLabel={lang === 'ka' ? 'ახალი ნაკვეთის საზღვრის რუკა' : 'New block boundary map'}
                      showEmptyState={false}
                    />
                  </Suspense>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
                  <button
                    type="button"
                    disabled={isDrawingPolygon && !drawnBoundaryValidation.valid}
                    onClick={() => {
                      if (isDrawingPolygon) {
                        setIsDrawingPolygon(false);
                      } else {
                        setDrawnPoints([]);
                        setIsDrawingPolygon(true);
                      }
                    }}
                    className={`px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      isDrawingPolygon ? 'bg-emerald-800 text-white hover:bg-emerald-900 cursor-pointer' : 'bg-stone-200 text-stone-700 hover:bg-stone-300 cursor-pointer'
                    }`}
                  >
                    {isDrawingPolygon
                      ? (!drawnBoundaryValidation.valid
                        ? (drawnBoundaryValidation.reason === 'minimum-points'
                          ? (lang === 'ka' ? `კიდევ ${3 - drawnPoints.length} წერტილი` : `Add ${3 - drawnPoints.length} more point${3 - drawnPoints.length === 1 ? '' : 's'}`)
                          : (lang === 'ka' ? 'გაასწორეთ საზღვარი' : 'Fix Boundary'))
                        : (lang === 'ka' ? '✓ საზღვრის დასრულება' : '✓ Finish Boundary'))
                      : (lang === 'ka' ? '✏️ ნაკვეთის საზღვრის დახაზვა' : '✏️ Draw Block Boundary')}
                  </button>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isDrawingPolygon && (
                      <button
                        type="button"
                        onClick={() => setDrawnPoints(previous => appendBoundaryPoint(previous, { lat: addBlockLat, lng: addBlockLng }))}
                        className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase bg-emerald-100 hover:bg-emerald-200 text-emerald-900 rounded transition-colors cursor-pointer"
                      >
                        + {lang === 'ka' ? 'კოორდინატის დამატება' : 'Add Coordinate'}
                      </button>
                    )}
                    {drawnPoints.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setDrawnPoints(previous => previous.slice(0, -1))}
                          className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors cursor-pointer"
                        >
                          ↶ {lang === 'ka' ? 'ბოლო წერტილის გაუქმება' : 'Undo Point'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDrawnPoints([])}
                          className="px-2.5 py-1 text-[9px] font-mono font-bold uppercase bg-rose-100 hover:bg-rose-200 text-rose-800 rounded transition-colors cursor-pointer"
                        >
                          🗑️ {lang === 'ka' ? 'წერტილების წაშლა' : 'Clear Points'} ({drawnPoints.length})
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {drawnPoints.length > 0 && (
                  <div
                    role={drawnBoundaryValidation.valid ? 'status' : 'alert'}
                    className={`rounded-md border px-2.5 py-1.5 text-[9px] font-mono ${
                      drawnBoundaryValidation.valid
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {boundaryValidationMessage(drawnBoundaryValidation, lang)}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'განედი' : 'Latitude'}</label>
                  <input
                    type="number"
                    step="0.0001"
                    name="lat"
                    value={addBlockLat}
                    onChange={(e) => setAddBlockLat(parseFloat(e.target.value) || 41.9)}
                    className="w-full bg-stone-50 border border-slate-200 px-2 py-1 text-stone-900 font-semibold font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'გრძედი' : 'Longitude'}</label>
                  <input
                    type="number"
                    step="0.0001"
                    name="lng"
                    value={addBlockLng}
                    onChange={(e) => setAddBlockLng(parseFloat(e.target.value) || 45.4)}
                    className="w-full bg-stone-50 border border-slate-200 px-2 py-1 text-stone-900 font-semibold font-mono"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ფართობი (ჰა)*' : 'Area (ha)*'}</label>
                  <input type="number" step="0.1" name="area" defaultValue="2.5" className="w-full bg-stone-50 border border-slate-200 px-2 py-1" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'სიმაღლე (მ)' : 'Elevation (Meters)'}</label>
                  <input type="number" name="elevation" value={addBlockElev} onChange={(e) => setAddBlockElev(parseInt(e.target.value) || 0)} className="w-full bg-stone-50 border border-slate-200 px-2 py-1" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მდებარეობის სახელი' : 'Location Name'}</label>
                  <input type="text" name="locationName" value={addBlockLocName} onChange={(e) => setAddBlockLocName(e.target.value)} className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
                </div>
              </div>

              <div className="bg-amber-50/60 border border-amber-200/70 p-3 rounded-lg space-y-3">
                <span className="font-bold block text-amber-900 font-mono text-[9px] uppercase tracking-wider">{lang === 'ka' ? 'სახელმწიფო საკადასტრო მონაცემები' : 'Government Cadastre Mirror'}</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'საკადასტრო კოდი' : 'Cadastral Code'}</label>
                    <input type="text" name="cadastralCode" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'საკადასტრო დოკუმენტი' : 'Cadastre Document'}</label>
                    <input type="text" name="officialCadastreDocumentName" placeholder={lang === 'ka' ? 'ფაილი ან რეესტრის ნომერი' : 'file or registry ref'} className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ნაკვეთის დასახელება' : 'Parcel Name'}</label>
                    <input type="text" name="parcelName" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მუნიციპალიტეტი' : 'Municipality'}</label>
                    <input type="text" name="municipality" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'თემი' : 'Community'}</label>
                    <input type="text" name="community" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'სოფელი' : 'Village'}</label>
                    <input type="text" name="village" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მიკროზონა / PDO' : 'Microzone / PDO'}</label>
                    <input type="text" name="microzone" list="vazi-georgian-microzone-options" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ნაკვეთის ფართობი (ჰა)' : 'Parcel Area (ha)'}</label>
                    <input type="number" min="0" step="0.01" name="parcelArea" placeholder={lang === 'ka' ? 'ავტომატურად ფართობიდან' : 'defaults to area'} className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მიწის მესაკუთრე' : 'Land Owner'}</label>
                    <input type="text" name="landOwner" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'მევენახე' : 'Grower'}</label>
                    <input type="text" name="grower" className="w-full bg-white border border-amber-100 px-2 py-1.5 outline-none rounded text-stone-900" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ყურძნის ჯიში *' : 'Grape Variety *'}</label>
                  <input type="text" name="variety" defaultValue="Saperavi" list="vazi-georgian-variety-options" className="w-full bg-stone-55 border border-slate-200 px-2 py-1 outline-none font-bold text-stone-800" required />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დარგვის წელი' : 'Planting Year'}</label>
                  <input type="number" name="plantYear" defaultValue="2008" className="w-full bg-stone-50 border border-slate-200 px-2 py-1" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'რიგების რაოდენობა' : 'Rows count'}</label>
                  <input type="number" name="rows" defaultValue="60" className="w-full bg-stone-50 border border-slate-200 px-2 py-1" />
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'დარგვის სქემა და რიგების სიმჭიდროვე' : 'Planting Spacing & Row density'}</label>
                <input type="text" name="spacing" defaultValue="2.5m x 1.0m" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'საძირე' : 'Rootstock'}</label>
                  <input type="text" name="rootstock" placeholder="5C, SO4" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'კლონი' : 'Clone'}</label>
                  <input type="text" name="clone" placeholder="Saperavi 06" className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'ვენახის მდგომარეობა' : 'Vineyard Condition'}</label>
                  <input type="text" name="vineyardCondition" placeholder={lang === 'ka' ? 'პროდუქტიული' : 'productive'} className="w-full bg-stone-50 border border-slate-200 px-2 py-1.5" />
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-500 dark:text-slate-400">{lang === 'ka' ? 'აგრონომის შენიშვნები' : 'Agronomist Remarks'}</label>
                <textarea name="notes" placeholder={lang === 'ka' ? 'ძველი საფერავის კლონები 5C საძირეზე...' : 'Old Saperavi clones on 5C rootstocks...'} className="w-full bg-stone-50 border border-slate-200 p-2.5 h-16 outline-none" />
              </div>

              <button
                type="submit"
                className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-mono font-bold uppercase tracking-wider py-2.5 rounded-lg cursor-pointer"
              >
                {lang === 'ka' ? 'ნაკვეთის რეგისტრაცია' : 'Register Block Sector'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
