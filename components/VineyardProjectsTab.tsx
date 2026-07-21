import React, { useEffect, useState } from 'react';
import {
  BadgeCheck,
  CalendarClock,
  ClipboardList,
  FileText,
  MapPinned,
  Plus,
  Save,
  Sprout,
} from 'lucide-react';
import type { Language } from '../lib/i18n';
import type { VineyardPlantingProject, VineyardProjectStatus } from '../lib/wineryState';
import { evaluateVineyardProjectReadiness } from '../lib/vineyardProjects';
import { GEORGIAN_GRAPE_VARIETIES } from '../lib/georgianWineKnowledge';
import {
  ActionButton,
  EmptyState,
  FieldLabel,
  InlineNotice,
  MetricCard,
  ProgressBar,
  SectionCard,
  StatusBadge,
  cx,
} from './ui/primitives';

interface VineyardProjectsTabProps {
  lang: Language;
  projects: VineyardPlantingProject[];
  onAddProject: (project: Omit<VineyardPlantingProject, 'id'>) => void;
  onUpdateProject: (id: string, updated: Partial<VineyardPlantingProject>) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
  onNavigate?: (target: { module: 'gvino'; tab: 'tasks' }) => void;
  canCreateProject?: boolean;
  canUpdateProject?: boolean;
  canCreateTask?: boolean;
}

interface ProjectForm {
  projectName: string;
  landOwnershipDocumentName: string;
  cadastralMapDocumentName: string;
  soilAnalysisDocumentName: string;
  agrotechnicalQuestionnaireName: string;
  plannedVarieties: string;
  rootstock: string;
  spacing: string;
  rowDirection: string;
  irrigationPlan: string;
  nurseryInvoiceDocumentName: string;
  applicationStatus: VineyardProjectStatus;
  approvalDate: string;
  approvalValidUntil: string;
  soilDepth: string;
  pH: string;
  organicMatter: string;
  caco3: string;
  texture: string;
  ec: string;
  exchangeableCa: string;
  exchangeableMg: string;
  exchangeableNa: string;
  hygroscopicWater: string;
}

const inputCls = 'w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-800 outline-none focus:border-emerald-800 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-100';
const textareaCls = `${inputCls} min-h-[78px] resize-y leading-relaxed`;
const blankForm: ProjectForm = {
  projectName: '',
  landOwnershipDocumentName: '',
  cadastralMapDocumentName: '',
  soilAnalysisDocumentName: '',
  agrotechnicalQuestionnaireName: '',
  plannedVarieties: '',
  rootstock: '',
  spacing: '',
  rowDirection: '',
  irrigationPlan: '',
  nurseryInvoiceDocumentName: '',
  applicationStatus: 'draft',
  approvalDate: '',
  approvalValidUntil: '',
  soilDepth: '',
  pH: '',
  organicMatter: '',
  caco3: '',
  texture: '',
  ec: '',
  exchangeableCa: '',
  exchangeableMg: '',
  exchangeableNa: '',
  hygroscopicWater: '',
};

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toForm(project: VineyardPlantingProject | null): ProjectForm {
  if (!project) return blankForm;
  return {
    projectName: project.projectName || '',
    landOwnershipDocumentName: project.landOwnershipDocumentName || '',
    cadastralMapDocumentName: project.cadastralMapDocumentName || '',
    soilAnalysisDocumentName: project.soilAnalysisDocumentName || '',
    agrotechnicalQuestionnaireName: project.agrotechnicalQuestionnaireName || '',
    plannedVarieties: project.plannedVarieties.join(', '),
    rootstock: project.rootstock || '',
    spacing: project.spacing || '',
    rowDirection: project.rowDirection || '',
    irrigationPlan: project.irrigationPlan || '',
    nurseryInvoiceDocumentName: project.nurseryInvoiceDocumentName || '',
    applicationStatus: project.applicationStatus,
    approvalDate: project.approvalDate || '',
    approvalValidUntil: project.approvalValidUntil || '',
    soilDepth: project.soilDepth === undefined ? '' : String(project.soilDepth),
    pH: project.pH === undefined ? '' : String(project.pH),
    organicMatter: project.organicMatter === undefined ? '' : String(project.organicMatter),
    caco3: project.caco3 === undefined ? '' : String(project.caco3),
    texture: project.texture || '',
    ec: project.ec === undefined ? '' : String(project.ec),
    exchangeableCa: project.exchangeableCa === undefined ? '' : String(project.exchangeableCa),
    exchangeableMg: project.exchangeableMg === undefined ? '' : String(project.exchangeableMg),
    exchangeableNa: project.exchangeableNa === undefined ? '' : String(project.exchangeableNa),
    hygroscopicWater: project.hygroscopicWater === undefined ? '' : String(project.hygroscopicWater),
  };
}

function fromForm(form: ProjectForm): Omit<VineyardPlantingProject, 'id'> {
  return {
    projectName: form.projectName.trim(),
    landOwnershipDocumentName: optionalText(form.landOwnershipDocumentName),
    cadastralMapDocumentName: optionalText(form.cadastralMapDocumentName),
    soilAnalysisDocumentName: optionalText(form.soilAnalysisDocumentName),
    agrotechnicalQuestionnaireName: optionalText(form.agrotechnicalQuestionnaireName),
    plannedVarieties: form.plannedVarieties.split(',').map(item => item.trim()).filter(Boolean),
    rootstock: optionalText(form.rootstock),
    spacing: optionalText(form.spacing),
    rowDirection: optionalText(form.rowDirection),
    irrigationPlan: optionalText(form.irrigationPlan),
    nurseryInvoiceDocumentName: optionalText(form.nurseryInvoiceDocumentName),
    applicationStatus: form.applicationStatus,
    approvalDate: optionalText(form.approvalDate),
    approvalValidUntil: optionalText(form.approvalValidUntil),
    soilDepth: optionalNumber(form.soilDepth),
    pH: optionalNumber(form.pH),
    organicMatter: optionalNumber(form.organicMatter),
    caco3: optionalNumber(form.caco3),
    texture: optionalText(form.texture),
    ec: optionalNumber(form.ec),
    exchangeableCa: optionalNumber(form.exchangeableCa),
    exchangeableMg: optionalNumber(form.exchangeableMg),
    exchangeableNa: optionalNumber(form.exchangeableNa),
    hygroscopicWater: optionalNumber(form.hygroscopicWater),
  };
}

function statusTone(status: ReturnType<typeof evaluateVineyardProjectReadiness>['status']) {
  if (status === 'ready' || status === 'approved') return 'success';
  if (status === 'submitted') return 'info';
  if (status === 'needs_review') return 'warning';
  return 'danger';
}

function statusLabel(status: ReturnType<typeof evaluateVineyardProjectReadiness>['status']) {
  if (status === 'missing_critical') return 'Missing critical';
  if (status === 'needs_review') return 'Needs review';
  return status.replace('_', ' ');
}

function expiryDetail(readiness: ReturnType<typeof evaluateVineyardProjectReadiness>) {
  if (readiness.daysUntilApprovalExpiry === null) return 'No approval validity date';
  if (readiness.daysUntilApprovalExpiry < 0) return `${Math.abs(readiness.daysUntilApprovalExpiry)} days overdue`;
  return `${readiness.daysUntilApprovalExpiry} days left`;
}

const GEORGIAN_REQUIREMENT_LABELS: Record<string, string> = {
  'Project name': 'პროექტის სახელი',
  'Land ownership/use document': 'მიწის საკუთრების ან სარგებლობის დოკუმენტი',
  'Cadastral map': 'საკადასტრო რუკა',
  'Soil analysis document': 'ნიადაგის ანალიზის დოკუმენტი',
  'Agrotechnical questionnaire': 'აგროტექნიკური კითხვარი',
  'Planned varieties': 'დაგეგმილი ჯიშები',
  Rootstock: 'საძირე',
  Spacing: 'დარგვის სქემა',
  'Row direction': 'რიგების მიმართულება',
  'Irrigation plan': 'სარწყავი გეგმა',
  'Nursery invoice/intent document': 'სანერგის ინვოისი ან განზრახვის დოკუმენტი',
  'Soil depth': 'ნიადაგის სიღრმე',
  'Soil pH': 'ნიადაგის pH',
  'Organic matter': 'ორგანული ნივთიერება',
  CaCO3: 'CaCO3',
  Texture: 'მექანიკური შემადგენლობა',
  EC: 'EC',
  'Exchangeable Ca': 'გაცვლითი Ca',
  'Exchangeable Mg': 'გაცვლითი Mg',
  'Exchangeable Na': 'გაცვლითი Na',
  'Hygroscopic water': 'ჰიგროსკოპიული წყალი',
};

export function buildVineyardProjectTaskDraft(
  lang: Language,
  projectName: string,
  readiness: ReturnType<typeof evaluateVineyardProjectReadiness>,
) {
  const ka = lang === 'ka';
  const normalizedProjectName = projectName.trim() || (ka ? 'ახალი პროექტი' : 'new project');
  const missing = readiness.missing
    .slice(0, 5)
    .map(label => ka ? (GEORGIAN_REQUIREMENT_LABELS[label] || label) : label)
    .join(', ');

  return {
    title: ka
      ? `ვენახის თანხმობის ფაილის დასრულება: ${normalizedProjectName}`
      : `Complete vineyard consent file: ${normalizedProjectName}`,
    priority: readiness.status === 'missing_critical' ? 'high' as const : 'medium' as const,
    description: missing
      ? (ka ? `აკლია თანხმობის დოკუმენტები: ${missing}.` : `Missing consent evidence: ${missing}.`)
      : (ka
        ? 'გადაამოწმეთ და წარადგინეთ ვენახის გაშენების თანხმობის ფაილი.'
        : 'Review and submit the vineyard planting consent file.'),
    target: { module: 'gvino' as const, tab: 'tasks' as const },
  };
}

export default function VineyardProjectsTab({
  lang,
  projects,
  onAddProject,
  onUpdateProject,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc,
  onNavigate,
  canCreateProject = true,
  canUpdateProject = true,
  canCreateTask = true,
}: VineyardProjectsTabProps) {
  const ka = lang === 'ka';
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id || 'new');
  const selectedProject = projects.find(project => project.id === selectedProjectId) || null;
  const [form, setForm] = useState<ProjectForm>(() => toForm(selectedProject));
  const draftProject: VineyardPlantingProject = { ...fromForm(form), id: selectedProject?.id || 'draft' };
  const readiness = evaluateVineyardProjectReadiness(selectedProject || draftProject);
  const canEditSelectedProject = selectedProject ? canUpdateProject : canCreateProject;

  useEffect(() => {
    if (selectedProjectId !== 'new' && !projects.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id || 'new');
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (!canCreateProject && selectedProjectId === 'new' && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [canCreateProject, projects, selectedProjectId]);

  useEffect(() => {
    setForm(toForm(selectedProject));
  }, [selectedProject]);

  const updateForm = <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const startNew = () => {
    if (!canCreateProject) return;
    setSelectedProjectId('new');
    setForm(blankForm);
  };

  const saveProject = () => {
    if (!canEditSelectedProject) return;
    const payload = fromForm(form);
    if (!payload.projectName.trim()) return;
    if (selectedProject) {
      onUpdateProject(selectedProject.id, payload);
    } else {
      onAddProject(payload);
      setSelectedProjectId('new');
      setForm(blankForm);
    }
  };

  const createTaskDraft = () => {
    if (!canCreateTask) return;
    const draft = buildVineyardProjectTaskDraft(lang, form.projectName, readiness);
    setPrefilledTaskTitle?.(draft.title);
    setPrefilledTaskPriority?.(draft.priority);
    setPrefilledTaskDesc?.(draft.description);
    onNavigate?.(draft.target);
  };

  return (
    <div className="space-y-4">
      <datalist id="vineyard-project-variety-options">
        {GEORGIAN_GRAPE_VARIETIES.map(item => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={ka ? 'მზადყოფნა' : 'Consent file'}
          value={`${readiness.score}%`}
          detail={<StatusBadge tone={statusTone(readiness.status)}>{statusLabel(readiness.status)}</StatusBadge>}
          icon={BadgeCheck}
          tone={statusTone(readiness.status) === 'success' ? 'success' : statusTone(readiness.status) === 'warning' ? 'warning' : statusTone(readiness.status) === 'info' ? 'info' : 'danger'}
        />
        <MetricCard
          label={ka ? 'პროექტები' : 'Projects'}
          value={projects.length}
          detail={projects.length === 1 ? '1 vineyard consent file' : `${projects.length} vineyard consent files`}
          icon={Sprout}
          tone="neutral"
        />
        <MetricCard
          label={ka ? 'განაცხადი' : 'Application'}
          value={form.applicationStatus}
          detail={form.approvalDate ? `Approved ${form.approvalDate}` : 'Lifecycle status'}
          icon={ClipboardList}
          tone="brand"
        />
        <MetricCard
          label={ka ? 'ვადა' : 'Validity'}
          value={readiness.approvalExpiryStatus === 'not_applicable' ? '--' : readiness.approvalExpiryStatus}
          detail={expiryDetail(readiness)}
          icon={CalendarClock}
          tone={readiness.approvalExpiryStatus === 'expired' ? 'danger' : readiness.approvalExpiryStatus === 'expiring' ? 'warning' : 'info'}
        />
      </div>

      {(!canCreateProject || !canUpdateProject) && (
        <InlineNotice tone="warning">
          {!canCreateProject && !canUpdateProject
            ? (ka
              ? 'პროექტებზე მხოლოდ ნახვის წვდომა გაქვთ. შეგიძლიათ შეამოწმოთ თანხმობის ფაილები და მზადყოფნა, მაგრამ ცვლილებებს ვერ შეინახავთ.'
              : 'You have read-only project access. You can review consent files and readiness, but cannot save changes.')
            : (ka
              ? 'პროექტის მოქმედებები შეზღუდულია თქვენი როლის მიხედვით; ხელმისაწვდომი მართვის ელემენტები ავტომატურად არის მორგებული.'
              : 'Project actions are limited by your role; the available controls are adjusted automatically.')}
        </InlineNotice>
      )}

      {readiness.missing.length > 0 && (selectedProject !== null || canCreateProject) && (
        <InlineNotice tone={readiness.status === 'missing_critical' ? 'danger' : 'warning'}>
          {ka ? 'აკლია: ' : 'Missing: '}
          {readiness.missing.slice(0, 8).join(', ')}
          {readiness.missing.length > 8 ? ` +${readiness.missing.length - 8}` : ''}
        </InlineNotice>
      )}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <SectionCard
          title={ka ? 'ახალი ვენახის პროექტები' : 'New vineyard projects'}
          icon={Sprout}
          actions={canCreateProject ? <ActionButton tone="secondary" onClick={startNew}><Plus className="mr-2 h-4 w-4" />New</ActionButton> : undefined}
        >
          <div className="space-y-2">
            {projects.map(project => {
              const projectReadiness = evaluateVineyardProjectReadiness(project);
              const active = selectedProject?.id === project.id;
              return (
                <button
                  type="button"
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={cx(
                    'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                    active
                      ? 'border-emerald-900 bg-emerald-950 text-emerald-50'
                      : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-emerald-700/50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black">{project.projectName}</div>
                      <div className={cx('mt-0.5 text-[10px] font-semibold', active ? 'text-emerald-100/80' : 'text-stone-500')}>
                        {project.plannedVarieties.join(', ') || 'No varieties'} · {project.applicationStatus}
                      </div>
                    </div>
                    <StatusBadge tone={statusTone(projectReadiness.status)}>{projectReadiness.score}%</StatusBadge>
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={projectReadiness.score} tone={projectReadiness.score >= 90 ? 'success' : projectReadiness.score >= 65 ? 'warning' : 'danger'} />
                  </div>
                </button>
              );
            })}
            {projects.length === 0 && (
              <EmptyState
                icon={MapPinned}
                title={ka ? 'პროექტი ჯერ არ არის' : 'No vineyard projects yet'}
                description={canCreateProject
                  ? (ka ? 'შეავსეთ ახალი დარგვის ან აღდგენის განაცხადის ფაილი.' : 'Start a planting or restoration consent file.')
                  : (ka ? 'არსებული პროექტები აქ გამოჩნდება, როცა უფლებამოსილი თანამშრომელი შექმნის.' : 'Existing projects will appear here after an authorized teammate creates one.')}
              />
            )}
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title={selectedProject ? selectedProject.projectName : (ka ? 'ახალი პროექტი' : 'New project')}
            icon={FileText}
            actions={(canCreateTask || canEditSelectedProject) ? (
              <div className="flex flex-wrap gap-2">
                {canCreateTask && <ActionButton tone="secondary" onClick={createTaskDraft}>{ka ? 'დავალების მონახაზი' : 'Task draft'}</ActionButton>}
                {canEditSelectedProject && <ActionButton onClick={saveProject}><Save className="mr-2 h-4 w-4" />Save</ActionButton>}
              </div>
            ) : undefined}
          >
            <fieldset disabled={!canEditSelectedProject} className="contents">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <FieldLabel required>{ka ? 'პროექტის სახელი' : 'Project name'}</FieldLabel>
                <input value={form.projectName} onChange={event => updateForm('projectName', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel>{ka ? 'განაცხადის სტატუსი' : 'Application status'}</FieldLabel>
                <select aria-label="Application status" value={form.applicationStatus} onChange={event => updateForm('applicationStatus', event.target.value as VineyardProjectStatus)} className={inputCls}>
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="submitted">Submitted</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <TextField label="Land ownership/use document" value={form.landOwnershipDocumentName} onChange={value => updateForm('landOwnershipDocumentName', value)} required />
              <TextField label="Cadastral map" value={form.cadastralMapDocumentName} onChange={value => updateForm('cadastralMapDocumentName', value)} required />
              <TextField label="Soil analysis document" value={form.soilAnalysisDocumentName} onChange={value => updateForm('soilAnalysisDocumentName', value)} required />
              <TextField label="Agrotechnical questionnaire" value={form.agrotechnicalQuestionnaireName} onChange={value => updateForm('agrotechnicalQuestionnaireName', value)} required />
              <TextField label="Nursery invoice / intent" value={form.nurseryInvoiceDocumentName} onChange={value => updateForm('nurseryInvoiceDocumentName', value)} required />
              <TextField label="Planned varieties" value={form.plannedVarieties} onChange={value => updateForm('plannedVarieties', value)} required listId="vineyard-project-variety-options" />
              <TextField label="Rootstock" value={form.rootstock} onChange={value => updateForm('rootstock', value)} />
              <TextField label="Spacing" value={form.spacing} onChange={value => updateForm('spacing', value)} />
              <TextField label="Row direction" value={form.rowDirection} onChange={value => updateForm('rowDirection', value)} />
              <div>
                <FieldLabel>{ka ? 'დამტკიცების თარიღი' : 'Approval date'}</FieldLabel>
                <input type="date" value={form.approvalDate} onChange={event => updateForm('approvalDate', event.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel>{ka ? 'დამტკიცების ვადა' : 'Approval valid until'}</FieldLabel>
                <input type="date" value={form.approvalValidUntil} onChange={event => updateForm('approvalValidUntil', event.target.value)} className={inputCls} />
              </div>
              <div className="md:col-span-2">
                <FieldLabel>{ka ? 'სარწყავი გეგმა' : 'Irrigation plan'}</FieldLabel>
                <textarea value={form.irrigationPlan} onChange={event => updateForm('irrigationPlan', event.target.value)} className={textareaCls} />
              </div>
            </div>
            </fieldset>
          </SectionCard>

          <SectionCard title={ka ? 'ნიადაგის მონაცემები' : 'Soil fields'} icon={MapPinned}>
            <fieldset disabled={!canEditSelectedProject} className="contents">
            <div className="grid gap-3 md:grid-cols-3">
              <NumberField label="Soil depth cm" value={form.soilDepth} onChange={value => updateForm('soilDepth', value)} />
              <NumberField label="pH" value={form.pH} onChange={value => updateForm('pH', value)} step="0.1" />
              <NumberField label="Organic matter %" value={form.organicMatter} onChange={value => updateForm('organicMatter', value)} step="0.1" />
              <NumberField label="CaCO3 %" value={form.caco3} onChange={value => updateForm('caco3', value)} step="0.1" />
              <TextField label="Texture" value={form.texture} onChange={value => updateForm('texture', value)} />
              <NumberField label="EC" value={form.ec} onChange={value => updateForm('ec', value)} step="0.01" />
              <NumberField label="Exchangeable Ca" value={form.exchangeableCa} onChange={value => updateForm('exchangeableCa', value)} step="0.1" />
              <NumberField label="Exchangeable Mg" value={form.exchangeableMg} onChange={value => updateForm('exchangeableMg', value)} step="0.1" />
              <NumberField label="Exchangeable Na" value={form.exchangeableNa} onChange={value => updateForm('exchangeableNa', value)} step="0.1" />
              <NumberField label="Hygroscopic water %" value={form.hygroscopicWater} onChange={value => updateForm('hygroscopicWater', value)} step="0.1" />
            </div>
            </fieldset>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange, required, listId }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; listId?: string }) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input value={value} onChange={event => onChange(event.target.value)} list={listId} className={inputCls} />
    </div>
  );
}

function NumberField({ label, value, onChange, step = '1' }: { label: string; value: string; onChange: (value: string) => void; step?: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input type="number" step={step} value={value} onChange={event => onChange(event.target.value)} className={inputCls} />
    </div>
  );
}
