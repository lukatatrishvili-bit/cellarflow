import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import IpmPhenoscheme from '../components/IpmPhenoscheme';
import VaziModule, {
  HarvestPlanForm,
  parseHarvestDispatchInput,
  parseHarvestPlanInput,
  runVaziMutationIfAllowed,
} from '../components/VaziModule';
import VineyardProjectsTab, { buildVineyardProjectTaskDraft } from '../components/VineyardProjectsTab';
import { evaluateVineyardProjectReadiness } from '../lib/vineyardProjects';
import type {
  SprayRecord,
  UserProfile,
  VineyardBlock,
  VineyardPlantingProject,
} from '../lib/wineryState';

const user: UserProfile = {
  username: 'nino',
  email: 'nino@example.com',
  fullName: 'Nino Beridze',
  role: 'Viticulturist',
  language: 'en',
};

const block: VineyardBlock = {
  id: 'BLOCK-A',
  name: 'Mukuzani Block A',
  vineyardName: 'Estate vineyard',
  locationName: 'Mukuzani',
  latitude: 41.81,
  longitude: 45.75,
  area: 2.4,
  elevation: 430,
  slope: '5%',
  aspect: 'South',
  soilType: 'Clay loam',
  grapeVariety: 'Saperavi',
  plantingYear: 2014,
  spacing: '2.2 x 1.2 m',
  rowsCount: 42,
  vinesCount: 3_200,
  trainingSystem: 'Double Guyot',
  pruningSystem: 'Cane pruned',
  irrigationEnabled: false,
  farmingStatus: 'conventional',
  currentPhenology: 'Veraison',
  estimatedHarvestDate: '2026-09-15',
  notes: 'South-facing estate block',
};

const project: VineyardPlantingProject = {
  id: 'PROJECT-A',
  projectName: 'Mukuzani restoration',
  landOwnershipDocumentName: 'land-rights.pdf',
  cadastralMapDocumentName: 'cadastre-map.pdf',
  soilAnalysisDocumentName: 'soil-analysis.pdf',
  agrotechnicalQuestionnaireName: 'agro-questionnaire.pdf',
  plannedVarieties: ['Saperavi'],
  nurseryInvoiceDocumentName: 'nursery-intent.pdf',
  applicationStatus: 'ready',
};

const spray: SprayRecord = {
  id: 'SPRAY-A',
  blockId: block.id,
  date: '2026-06-15',
  targetProblem: 'Downy mildew',
  productName: 'Copper treatment',
  activeIngredient: 'Copper',
  dosePerHa: 2,
  waterVolumePerHa: 400,
  totalProductUsed: 4.8,
  totalWaterUsed: 960,
  operator: user.fullName,
  machineryUsed: 'Vineyard sprayer',
  windSpeed: 4,
  temperature: 22,
  humidity: 64,
  preHarvestIntervalDays: 21,
  reEntryIntervalHours: 24,
  notes: '[MoA MoA: M01 (FRAC)]',
};

function vaziProps(
  overrides: Partial<ComponentProps<typeof VaziModule>> = {},
): ComponentProps<typeof VaziModule> {
  return {
    lang: 'en',
    currentUser: user,
    blocks: [block],
    phenologyLogs: [],
    sprays: [spray],
    scoutings: [],
    soilRecords: [],
    vineyardProjects: [project],
    samplings: [],
    harvests: [],
    irrigationLogs: [],
    fertilizerLogs: [],
    onAddBlock: vi.fn(),
    onUpdateBlock: vi.fn(),
    onAddVineyardProject: vi.fn(),
    onUpdateVineyardProject: vi.fn(),
    onAddPhenologyLog: vi.fn(),
    onAddSprayRecord: vi.fn(),
    onAddScoutingRecord: vi.fn(),
    onAddSamplings: vi.fn(),
    onAddHarvestRecord: vi.fn(),
    onUpdateHarvestRecord: vi.fn(),
    onSendHarvestToGvino: vi.fn(() => 'LOT-NEW'),
    onAddIrrigation: vi.fn(),
    onAddFertilizer: vi.fn(),
    ...overrides,
  };
}

describe('Vazi permission-aware workspace', () => {
  it('preserves vineyard review while removing dashboard create actions in read-only mode', () => {
    const markup = renderToStaticMarkup(React.createElement(VaziModule, vaziProps({
      canCreateVineyardRecord: false,
      canUpdateVineyardRecord: false,
      canDeleteVineyardRecord: false,
      canCreateVineyardProject: false,
      canUpdateVineyardProject: false,
      canDispatchHarvestToGvino: false,
      canCreateTask: false,
    })));

    expect(markup).toContain('Read-only vineyard access');
    expect(markup).toContain('Mukuzani Block A');
    expect(markup).toContain('Latest Field Management Logs');
    expect(markup).not.toContain('>Add block</button>');
    expect(markup).toContain('Dispatching harvest to the winery requires combined');
    expect(markup).toContain('Creating task drafts from field records is unavailable');
  });

  it('keeps the existing owner-style dashboard actions enabled by default', () => {
    const markup = renderToStaticMarkup(React.createElement(VaziModule, vaziProps({ blocks: [] })));

    expect(markup).not.toContain('Read-only vineyard access');
    expect(markup).toContain('aria-label="Vazi workspace"');
    expect(markup).toContain('Field work');
    expect(markup).toContain(' Add block</button>');
    expect(markup).toContain('No vineyard blocks yet');
  });

  it('guards callbacks even when a stale event reaches a forbidden mutation', () => {
    const mutation = vi.fn(() => 'saved');

    expect(runVaziMutationIfAllowed(false, mutation)).toBeUndefined();
    expect(mutation).not.toHaveBeenCalled();
    expect(runVaziMutationIfAllowed(true, mutation)).toBe('saved');
    expect(mutation).toHaveBeenCalledOnce();
  });

  it('requires an explicit positive finite harvest weight and derives vintage from the actual date', () => {
    expect(parseHarvestDispatchInput('', '2027-09-21')).toEqual({ ok: false, reason: 'weight_required' });
    expect(parseHarvestDispatchInput('0', '2027-09-21')).toEqual({ ok: false, reason: 'weight_invalid' });
    expect(parseHarvestDispatchInput('-4', '2027-09-21')).toEqual({ ok: false, reason: 'weight_invalid' });
    expect(parseHarvestDispatchInput('Infinity', '2027-09-21')).toEqual({ ok: false, reason: 'weight_invalid' });
    expect(parseHarvestDispatchInput('12500.5', '2027-09-21')).toEqual({
      ok: true,
      harvestedKg: 12500.5,
      actualHarvestDate: '2027-09-21',
      vintage: 2027,
    });
    expect(parseHarvestDispatchInput('12500', '2027-02-30')).toEqual({ ok: false, reason: 'date_invalid' });
  });

  it('requires a valid target date and positive finite tonnage for harvest plans', () => {
    expect(parseHarvestPlanInput('', '')).toEqual({
      ok: false,
      errors: {
        estimatedHarvestDate: 'date_required',
        estimatedTons: 'tons_required',
      },
    });
    expect(parseHarvestPlanInput('2027-02-30', '0')).toEqual({
      ok: false,
      errors: {
        estimatedHarvestDate: 'date_invalid',
        estimatedTons: 'tons_invalid',
      },
    });
    expect(parseHarvestPlanInput('2027-09-21', 'Infinity')).toEqual({
      ok: false,
      errors: { estimatedTons: 'tons_invalid' },
    });
    expect(parseHarvestPlanInput('2027-09-21', '8.75')).toEqual({
      ok: true,
      estimatedHarvestDate: '2027-09-21',
      estimatedTons: 8.75,
    });
  });

  it('renders an accessible harvest-plan editor with the selected block defaults', () => {
    const markup = renderToStaticMarkup(React.createElement(HarvestPlanForm, {
      lang: 'en',
      block,
      onCreate: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(markup).toContain('New harvest plan');
    expect(markup).not.toContain(`Set a target date and expected yield for ${block.name}`);
    expect(markup).toContain('Target harvest date');
    expect(markup).toContain('value="15/09/2026"');
    expect(markup).toContain('Estimated yield (tons)');
    expect(markup).toContain('Picking method');
    expect(markup).toContain('Hand-picked');
    expect(markup).toContain('Expected grape condition');
    expect(markup).toContain('Picking instructions and notes');
    expect(markup).toContain('Save harvest plan');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('aria-labelledby=');
    expect(markup).toContain('required=""');
  });

  it('localizes harvest-plan guidance and actions in Georgian', () => {
    const markup = renderToStaticMarkup(React.createElement(HarvestPlanForm, {
      lang: 'ka',
      block,
      onCreate: vi.fn(),
      onCancel: vi.fn(),
    }));

    expect(markup).toContain('რთველის ახალი გეგმა');
    expect(markup).toContain('სამიზნე თარიღი');
    expect(markup).toContain('სავარაუდო მოსავალი (ტონა)');
    expect(markup).toContain('კრეფის მეთოდი');
    expect(markup).toContain('ინსტრუქციები და შენიშვნები');
    expect(markup).toContain('გეგმის შენახვა');
    expect(markup).toContain('გაუქმება');
  });

  it('keeps project files visible while disabling project creation and updates', () => {
    const markup = renderToStaticMarkup(React.createElement(VineyardProjectsTab, {
      lang: 'en',
      projects: [project],
      onAddProject: vi.fn(),
      onUpdateProject: vi.fn(),
      canCreateProject: false,
      canUpdateProject: false,
      canCreateTask: false,
    }));

    expect(markup).toContain('You have read-only project access');
    expect(markup).toContain('Mukuzani restoration');
    expect(markup).toContain('land-rights.pdf');
    expect(markup).not.toContain('>New</button>');
    expect(markup).not.toContain('>Save</button>');
    expect(markup).not.toContain('Task draft');
    expect(markup).toContain('<fieldset disabled=""');
  });

  it('treats task drafting independently from project editing', () => {
    const markup = renderToStaticMarkup(React.createElement(VineyardProjectsTab, {
      lang: 'en',
      projects: [project],
      onAddProject: vi.fn(),
      onUpdateProject: vi.fn(),
      canCreateProject: false,
      canUpdateProject: false,
      canCreateTask: true,
    }));

    expect(markup).toContain('Task draft');
    expect(markup).not.toContain('>Save</button>');
  });

  it('builds a localized Georgian task draft for the Gvino task workspace', () => {
    const readiness = evaluateVineyardProjectReadiness({
      id: 'PROJECT-DRAFT',
      projectName: 'ახალი ვენახი',
      plannedVarieties: [],
      applicationStatus: 'draft',
    });

    const draft = buildVineyardProjectTaskDraft('ka', 'ახალი ვენახი', readiness);

    expect(draft.target).toEqual({ module: 'gvino', tab: 'tasks' });
    expect(draft.title).toBe('ვენახის თანხმობის ფაილის დასრულება: ახალი ვენახი');
    expect(draft.description).toContain('აკლია თანხმობის დოკუმენტები:');
    expect(draft.description).toContain('მიწის საკუთრების ან სარგებლობის დოკუმენტი');
    expect(draft.description).not.toContain('Missing consent evidence');
  });

  it('retains IPM guidance and spray history without draft or delete controls', () => {
    const markup = renderToStaticMarkup(React.createElement(IpmPhenoscheme, {
      lang: 'en',
      selectedBlock: block,
      sprays: [spray],
      onAddSprayRecord: vi.fn(),
      currentUser: user,
      blockWeather: null,
      canCreateVineyardRecord: false,
      canDeleteVineyardRecord: false,
    }));

    expect(markup).toContain('You have read-only IPM access');
    expect(markup).toContain('Brand-Free Vine Phenoscheme &amp; IPM');
    expect(markup).toContain('Selected Block');
    expect(markup).not.toContain('from-[#1e2f23]');
    expect(markup).not.toContain('Draft Spray Treatment');
    expect(markup).not.toContain('Delete trap log');
  });

  it('localizes the read-only Vazi guidance in Georgian', () => {
    const markup = renderToStaticMarkup(React.createElement(VaziModule, vaziProps({
      lang: 'ka',
      canCreateVineyardRecord: false,
      canUpdateVineyardRecord: false,
      canCreateVineyardProject: false,
      canUpdateVineyardProject: false,
      canDispatchHarvestToGvino: false,
      canCreateTask: false,
    })));

    expect(markup).toContain('ვენახზე მხოლოდ ნახვის წვდომა');
    expect(markup).toContain('aria-label="ვაზის სამუშაო სივრცე"');
    expect(markup).toContain('საველე სამუშაო');
    expect(markup).not.toContain('Read-only vineyard access');
  });
});
