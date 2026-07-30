import type { AiFinding, AiRecommendedAction } from './ai/types';

export type AiDraftActionType =
  | 'task'
  | 'lab_check'
  | 'cellar_operation'
  | 'transfer_plan'
  | 'bottling_readiness'
  | 'inventory_restock'
  | 'fermentation_nutrition'
  | 'acid_adjustment'
  | 'so2_calculation'
  | 'spray_recommendation'
  | 'compliance_warning'
  | 'official_document_explanation'
  | 'lot_passport_summary';

export type AiDraftPriority = 'high' | 'medium' | 'low';

export interface AiDraftAction {
  id: string;
  type: AiDraftActionType;
  title: string;
  priority: AiDraftPriority;
  description: string;
  reviewOnly: true;
  targetModule:
    | 'tasks'
    | 'labs'
    | 'operations'
    | 'transfers'
    | 'bottling'
    | 'inventory'
    | 'fermentation'
    | 'calculators'
    | 'vazi'
    | 'documents'
    | 'lots';
  warnings: string[];
  payload?: Record<string, unknown>;
}

export type AiDraftQueueStatus = 'draft' | 'converted_to_task' | 'dismissed';

export interface AiDraftQueueItem extends AiDraftAction {
  status: AiDraftQueueStatus;
  createdAt: string;
  createdBy?: string;
  dueDate?: string;
  sourceModule?: string;
  sourceTab?: string;
}

interface DraftContext {
  contextModule?: string;
  contextTab?: string;
  lang?: string;
  cellarState?: {
    tanksCount: number;
    activeFermsCount: number;
    avgTemp: number;
    lowSo2Count: number;
    highVaCount: number;
    sampleData: Array<{ id: string; lotCode: string; currentVolume: number; wineName: string; stage: string }>;
  };
}

const REVIEW_ONLY_WARNING = 'Review before applying; AI draft actions do not modify official winery records.';
const CHEMISTRY_WARNING = 'Confirm lot, volume, pH, target free SO2, and lab method before dosing.';
const SPRAY_WARNING = 'Check PHI, REI, product registration, weather window, and local label restrictions before spraying.';
const COMPLIANCE_WARNING = 'Verify official documents against source records before submission.';

const REVIEW_ONLY_WARNING_KA = 'გადაამოწმეთ გამოყენებამდე; AI-ს მიერ შემოთავაზებული ქმედებები არ ცვლის ოფიციალურ მარნის ჩანაწერებს.';
const CHEMISTRY_WARNING_KA = 'დოზირებამდე გადაამოწმეთ პარტია, მოცულობა, pH, სამიზნე თავისუფალი SO2 და ლაბორატორიული მეთოდი.';
const SPRAY_WARNING_KA = 'შესხურებამდე შეამოწმეთ PHI, REI, პრეპარატის რეგისტრაცია, ამინდის ფანჯარა და ადგილობრივი ეტიკეტის შეზღუდვები.';
const COMPLIANCE_WARNING_KA = 'წარდგენამდე შეამოწმეთ ოფიციალური დოკუმენტები პირველად წყაროებთან.';

const ACTION_LABELS: Record<AiDraftActionType, string> = {
  task: 'Task draft',
  lab_check: 'Lab check draft',
  cellar_operation: 'Cellar operation draft',
  transfer_plan: 'Transfer plan draft',
  bottling_readiness: 'Bottling readiness draft',
  inventory_restock: 'Inventory restock draft',
  fermentation_nutrition: 'Fermentation nutrition draft',
  acid_adjustment: 'Acid adjustment draft',
  so2_calculation: 'SO2 calculation draft',
  spray_recommendation: 'Spray recommendation draft',
  compliance_warning: 'Compliance warning draft',
  official_document_explanation: 'Official document field explanation',
  lot_passport_summary: 'Lot passport summary draft'
};

function normalizeText(content: string): string {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasAny(text: string, words: string[]): boolean {
  return words.some(word => text.includes(word));
}

function hashDraft(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8);
}

function firstLot(context?: DraftContext): { id: string; name: string; volume: number } | null {
  const sample = context?.cellarState?.sampleData?.[0];
  if (!sample) return null;
  return {
    id: sample.lotCode || sample.id,
    name: sample.wineName || sample.lotCode || sample.id,
    volume: sample.currentVolume || 0
  };
}

function makeDraft(
  type: AiDraftActionType,
  content: string,
  draft: Omit<AiDraftAction, 'id' | 'type' | 'reviewOnly'>,
  lang?: string
): AiDraftAction {
  const isKa = lang === 'ka';
  const defaultWarning = isKa ? REVIEW_ONLY_WARNING_KA : REVIEW_ONLY_WARNING;
  const warningSet = new Set([defaultWarning, ...draft.warnings]);
  return {
    ...draft,
    id: `ai-draft-${type}-${hashDraft(`${type}:${draft.title}:${content.slice(0, 120)}`)}`,
    type,
    reviewOnly: true,
    warnings: Array.from(warningSet)
  };
}

export function draftActionLabel(type: AiDraftActionType, lang?: string): string {
  if (lang === 'ka') {
    const kaLabels: Record<AiDraftActionType, string> = {
      task: 'დავალების პროექტი',
      lab_check: 'ლაბორატორიული შემოწმების პროექტი',
      cellar_operation: 'მარნის ოპერაციის პროექტი',
      transfer_plan: 'ღვინის გადატანის გეგმის პროექტი',
      bottling_readiness: 'ჩამოსხმის მზადყოფნის პროექტი',
      inventory_restock: 'მარაგის შევსების პროექტი',
      fermentation_nutrition: 'დუღილის კვების პროექტი',
      acid_adjustment: 'მჟავიანობის კორექციის პროექტი',
      so2_calculation: 'SO2-ის გაანგარიშების პროექტი',
      spray_recommendation: 'წამლობის რეკომენდაციის პროექტი',
      compliance_warning: 'შესაბამისობის გაფრთხილების პროექტი',
      official_document_explanation: 'ოფიციალური დოკუმენტის ველის განმარტება',
      lot_passport_summary: 'ლოტის პასპორტის რეზიუმეს პროექტი'
    };
    return kaLabels[type];
  }
  return ACTION_LABELS[type];
}

export function deriveAiDraftActions(content: string, context: DraftContext = {}): AiDraftAction[] {
  const text = normalizeText(content);
  if (!text) return [];

  const lot = firstLot(context);
  const contextModule = (context.contextModule || '').toLowerCase();
  const contextTab = (context.contextTab || '').toLowerCase();
  const lang = context.lang;
  const isKa = lang === 'ka';
  const drafts: AiDraftAction[] = [];

  const so2Like = hasAny(text, ['so2', 'sulfur dioxide', 'sulphur dioxide', 'sulfite', 'sulphite', 'kmbs', 'metabisulfite', 'გოგირდ', 'KMBS']);
  const transferLike = contextTab === 'transfers' || hasAny(text, [
    'racking', 'wine transfer', 'transfer wine', 'source vessel', 'destination vessel',
    'გადატანა', 'გადაღება', 'საიდან', 'მიმღები ჭურჭელი',
  ]);
  const bottlingLike = contextTab === 'bottling' || hasAny(text, [
    'bottling', 'bottle run', 'cork', 'closure', 'capsule', 'packaging',
    'ჩამოსხმა', 'საცობი', 'ჩაჩი', 'კაფსულა', 'ეტიკეტი',
  ]);
  const inventoryLike = contextTab === 'inventory' || hasAny(text, [
    'inventory', 'restock', 'reorder', 'supplier', 'stock shortage',
    'ინვენტარი', 'მარაგის შევსება', 'მომწოდებელი', 'პროდუქტის მარაგი',
  ]);
  const nutritionLike = (
    contextTab === 'fermentation'
    && hasAny(text, [
      'yan', 'nitrogen', 'nutrient', 'dap', 'organic nutrition',
      'აზოტი', 'კვება', 'საფუარის საკვები',
    ])
  ) || hasAny(text, ['yan calculation', 'nutrient dose', 'კვების დოზა']);
  const acidLike = hasAny(text, [
    'acid adjustment', 'acidification', 'deacidification', 'tartaric acid',
    'malic acid', 'lactic acid', 'citric acid', 'titratable acidity',
    'მჟავიანობის კორექცია', 'ღვინის მჟავა', 'ვაშლმჟავა', 'რძემჟავა', 'ლიმონმჟავა',
  ]);
  const labLike = so2Like || acidLike || hasAny(text, ['lab', 'analysis', 'sample', 'ph', 'volatile acidity', ' va ', 'density', 'brix', 'ta ', 'tartaric', 'ლაბორატორი', 'ანალიზი', 'ნიმუში']);
  const cellarLike = hasAny(text, [
    'rack',
    'racking',
    'transfer',
    'punchdown',
    'pump-over',
    'pumpover',
    'topping',
    'sanitize',
    'cleaning',
    'qvevri',
    'wax',
    'seal',
    'fermentation restart',
    'stuck fermentation',
    'გადაღება',
    'ტუმბვა',
    'ქვევრი',
    'ცვილი',
    'დალუქვა',
    'დუღილის გაჩერება'
  ]);
  const vaziLike = contextModule === 'vazi' || hasAny(text, [
    'mildew',
    'botrytis',
    'spray',
    'canopy',
    'phenology',
    'vineyard',
    'scouting',
    'phi',
    'rei',
    'humidity',
    'rain',
    'ნაცარი',
    'ჭრაქი',
    'შესხურება',
    'ვენახი',
    'მავნებელი'
  ]);
  const complianceLike = hasAny(text, [
    'compliance',
    'certificate',
    'certification',
    'declaration',
    'official',
    'pdo',
    'pgi',
    'export',
    'document',
    'agency',
    'traceability',
    'შესაბამისობა',
    'სერტიფიკატი',
    'დეკლარაცია',
    'ოფიციალური',
    'ექსპორტი',
    'დოკუმენტი'
  ]);
  const officialFieldGapLike = hasAny(text, ['missing field', 'missing official', 'blank field', 'todo field', 'required field', 'annex', 'form', 'document warning', 'გამოტოვებული ველი', 'ცარიელი ველი', 'დანართი', 'ფორმა'])
    || (hasAny(text, ['explain', 'why', 'what is missing', 'missing', 'განმარტება', 'რა აკლია', 'გამოტოვებული']) && hasAny(text, ['official document', 'annex', 'form', 'georgian document', 'agency document', 'დოკუმენტი', 'დანართი']));
  const passportLike = contextTab === 'lots' || hasAny(text, [
    'lot passport',
    'passport',
    'lineage',
    'chain of custody',
    'history',
    'traceability summary',
    'batch summary',
    'პასპორტი',
    'მიკვლევადობა'
  ]);
  const urgentLike = hasAny(text, ['critical', 'urgent', 'immediately', 'high risk', 'high va', 'stuck', 'infection', 'contamination', 'კრიტიკული', 'სასწრაფო', 'მაღალი რისკი']);

  if (labLike) {
    drafts.push(makeDraft('lab_check', content, {
      title: lot
        ? (isKa ? `ქიმიის გადამოწმება ${lot.name}-სთვის` : `Verify chemistry for ${lot.name}`)
        : (isKa ? 'ღვინის ქიმიის გადამოწმება' : 'Verify wine chemistry'),
      priority: so2Like || urgentLike ? 'high' : 'medium',
      targetModule: 'labs',
      description: lot
        ? (isKa ? `შექმენით ლაბორატორიული შემოწმების პროექტი ${lot.name}-სთვის (${lot.id}), სანამ მიიღებთ გადაწყვეტილებას ქიმიის ან სტაბილურობის შესახებ.` : `Create a reviewed lab-check draft for ${lot.name} (${lot.id}) before making chemistry or stability decisions.`)
        : (isKa ? 'შექმენით ლაბორატორიული შემოწმების პროექტი, სანამ მიიღებთ გადაწყვეტილებას ქიმიის ან სტაბილურობის შესახებ.' : 'Create a reviewed lab-check draft before making chemistry or stability decisions.'),
      warnings: so2Like ? [isKa ? CHEMISTRY_WARNING_KA : CHEMISTRY_WARNING] : [],
      payload: {
        lotId: lot?.id,
        requestedChecks: so2Like ? ['pH', 'free SO2', 'total SO2'] : ['pH', 'density', 'TA', 'VA']
      }
    }, lang));
  }

  if (so2Like) {
    drafts.push(makeDraft('so2_calculation', content, {
      title: lot
        ? (isKa ? `SO2-ის გაანგარიშება ${lot.name}-სთვის` : `Review SO2 calculation for ${lot.name}`)
        : (isKa ? 'SO2-ის გაანგარიშება' : 'Review SO2 calculation'),
      priority: 'high',
      targetModule: 'labs',
      description: lot
        ? (isKa ? `მოამზადეთ SO2-ის კალკულაციის ვერსია ${lot.name}-სთვის მიმდინარე მოცულობის (${lot.volume} ლ), pH-ის, თავისუფალი SO2-ის და სამიზნე მოლეკულური SO2-ის გამოყენებით.` : `Prepare a draft SO2 review for ${lot.name} using the current volume (${lot.volume} L), measured pH, current free SO2, and target molecular SO2.`)
        : (isKa ? 'მოამზადეთ SO2-ის კალკულაციის ვერსია პარტიის დადასტურებული მოცულობის, pH-ის, თავისუფალი SO2-ის და სამიზნე მოლეკულური SO2-ის გამოყენებით.' : 'Prepare a draft SO2 review using confirmed lot volume, measured pH, current free SO2, and target molecular SO2.'),
      warnings: [isKa ? CHEMISTRY_WARNING_KA : CHEMISTRY_WARNING],
      payload: {
        lotId: lot?.id,
        volumeL: lot?.volume,
        requiresConfirmedInputs: ['pH', 'currentFreeSo2', 'targetFreeSo2', 'wineVolumeL']
      }
    }, lang));
  }

  if (transferLike) {
    drafts.push(makeDraft('transfer_plan', content, {
      title: lot
        ? (isKa ? `ღვინის გადატანის გეგმა ${lot.name}-სთვის` : `Review transfer plan for ${lot.name}`)
        : (isKa ? 'ღვინის გადატანის გეგმა' : 'Review wine transfer plan'),
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'transfers',
      description: isKa
        ? 'მოამზადეთ გადატანის პროექტი ზუსტი „საიდან/სად“ ჭურჭლებით, მოცულობით, მოსალოდნელი დანაკარგით, სანიტარიული შემოწმებით და ოპერატორის დასტურით.'
        : 'Prepare a transfer draft with exact source and destination vessels, volume, expected loss, sanitation check, and operator confirmation.',
      warnings: [isKa
        ? 'გადატანამდე გადაამოწმეთ ჭურჭლის თავისუფალი ტევადობა, პარტიის იდენტობა, სისუფთავე და ბოლო ოპერაციები.'
        : 'Confirm vessel headroom, lot identity, sanitation, and intervening operations before transfer.'],
      payload: {
        lotId: lot?.id,
        requiredInputs: ['sourceVesselId', 'destinationVesselId', 'volumeL', 'expectedLossL', 'sanitationStatus'],
      },
    }, lang));
  }

  if (bottlingLike) {
    drafts.push(makeDraft('bottling_readiness', content, {
      title: lot
        ? (isKa ? `ჩამოსხმის მზადყოფნა ${lot.name}-სთვის` : `Review bottling readiness for ${lot.name}`)
        : (isKa ? 'ჩამოსხმის მზადყოფნა' : 'Review bottling readiness'),
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'bottling',
      description: isKa
        ? 'შექმენით ჩამოსხმის მზადყოფნის პროექტი ლაბორატორიული გამოშვების, ფილტრაციის, მოცულობის, ბოთლის, საცობის, კაფსულის, ეტიკეტის, ყუთისა და საწყობის შემოწმებით.'
        : 'Create a bottling-readiness draft covering lab release, filtration, volume, bottle, closure, capsule, label, box, and storage checks.',
      warnings: [isKa
        ? 'არასწორი პროდუქტის კატეგორია ან არასაკმარისი მარაგი ჩამოსხმამდე უნდა გამოსწორდეს.'
        : 'Correct mismatched product categories or stock shortages before bottling.'],
      payload: {
        lotId: lot?.id,
        checklist: ['lab release', 'filtration', 'bottle', 'closure', 'capsule', 'label', 'box', 'storage'],
      },
    }, lang));
  }

  if (inventoryLike) {
    drafts.push(makeDraft('inventory_restock', content, {
      title: isKa ? 'მარაგის შევსების გეგმა' : 'Review inventory restock plan',
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'inventory',
      description: isKa
        ? 'მოამზადეთ პროდუქტების შევსების პროექტი მიმდინარე ბალანსის, მინიმალური ზღვრის, დაგეგმილი ოპერაციების, მომწოდებლისა და მიწოდების ვადის მიხედვით.'
        : 'Prepare a product restock draft using current balance, minimum threshold, scheduled operations, supplier, and lead time.',
      warnings: [isKa
        ? 'შეკვეთა ავტომატურად არ იგზავნება; რაოდენობა და მომწოდებელი ადამიანმა უნდა დაადასტუროს.'
        : 'No order is sent automatically; a person must confirm quantity and supplier.'],
      payload: {
        suggestedChecks: ['on-hand', 'minimum threshold', 'scheduled consumption', 'supplier', 'lead time'],
      },
    }, lang));
  }

  if (nutritionLike) {
    drafts.push(makeDraft('fermentation_nutrition', content, {
      title: lot
        ? (isKa ? `დუღილის კვების გეგმა ${lot.name}-სთვის` : `Review fermentation nutrition for ${lot.name}`)
        : (isKa ? 'დუღილის კვების გეგმა' : 'Review fermentation nutrition'),
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'fermentation',
      description: isKa
        ? 'მოამზადეთ YAN-ზე დაფუძნებული კვების პროექტი ტკბილის მოცულობის, მიმდინარე და სამიზნე YAN-ის, შაქრის, საფუარის შტამისა და პროდუქტის ხელმისაწვდომი აზოტის მიხედვით.'
        : 'Prepare a YAN-based nutrition draft using must volume, current and target YAN, sugar, yeast strain, and the product available-nitrogen fraction.',
      warnings: [isKa
        ? 'დოზა და დამატების დრო გადაამოწმეთ ლაბორატორიულ შედეგებთან და პროდუქტის ტექნიკურ ფურცელთან.'
        : 'Confirm dose and timing against lab results and the product technical sheet.'],
      payload: {
        lotId: lot?.id,
        requiresConfirmedInputs: ['mustVolumeL', 'currentYanMgL', 'targetYanMgL', 'sugar', 'yeastStrain', 'availableNitrogenPct'],
      },
    }, lang));
  }

  if (acidLike) {
    drafts.push(makeDraft('acid_adjustment', content, {
      title: lot
        ? (isKa ? `მჟავიანობის კორექცია ${lot.name}-სთვის` : `Review acid adjustment for ${lot.name}`)
        : (isKa ? 'მჟავიანობის კორექცია' : 'Review acid adjustment'),
      priority: 'high',
      targetModule: 'calculators',
      description: isKa
        ? 'მოამზადეთ მჟავიანობის კორექციის პროექტი მიმდინარე/სამიზნე TA-ის, პროდუქტის ტიპის, ფხვნილის ან სითხის ფორმის, სისუფთავისა და სითხის სიმკვრივის მიხედვით.'
        : 'Prepare an acid-adjustment draft from current and target TA, product type, powder or liquid form, purity, and liquid density.',
      warnings: [isKa
        ? 'დოზირებამდე ჩაატარეთ მცირე საცდელი სინჯი, გადაამოწმეთ pH/TA და მოქმედი რეგულაცია.'
        : 'Run a bench trial and confirm pH, TA, and applicable regulation before dosing.'],
      payload: {
        lotId: lot?.id,
        requiresConfirmedInputs: ['volumeL', 'currentTaGL', 'targetTaGL', 'acidType', 'productForm', 'purityPct', 'densityGml'],
      },
    }, lang));
  }

  if (cellarLike && !transferLike && !bottlingLike && !nutritionLike) {
    drafts.push(makeDraft('cellar_operation', content, {
      title: lot
        ? (isKa ? `მარნის ოპერაცია ${lot.name}-სთვის` : `Review cellar operation for ${lot.name}`)
        : (isKa ? 'მარნის ოპერაცია' : 'Review cellar operation'),
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'operations',
      description: isKa
        ? 'გადააქციეთ ასისტენტის რეკომენდაცია განსახილველ მარნის ოპერაციის პროექტად, სანამ დანიშნავთ შემსრულებლებს ან შეცვლით რეზერვუარებს.'
        : 'Turn the assistant recommendation into a reviewed cellar-operation draft before assigning operators or changing vessels.',
      warnings: [],
      payload: {
        lotId: lot?.id,
        operationHints: ['operator', 'vessel', 'volume', 'materials', 'sanitation check']
      }
    }, lang));
  }

  if (vaziLike) {
    drafts.push(makeDraft('spray_recommendation', content, {
      title: isKa ? 'ვენახის წამლობის რეკომენდაცია' : 'Review vineyard protection recommendation',
      priority: urgentLike || hasAny(text, ['mildew', 'botrytis', 'high risk', 'ჭრაქი', 'ნაცარი']) ? 'high' : 'medium',
      targetModule: 'vazi',
      description: isKa
        ? 'გადააქციეთ ვენახის რეკომენდაცია შემოწმებულ ფიტოსანიტარულ ან წამლობის გეგმის პროექტად ნაკვეთზე მავნებლების წნევისა და ეტიკეტის შეზღუდვების დადასტურების შემდეგ.'
        : 'Convert the vineyard recommendation into a checked scouting or spray-plan draft after confirming field pressure and label constraints.',
      warnings: [isKa ? SPRAY_WARNING_KA : SPRAY_WARNING],
      payload: {
        contextModule,
        suggestedChecks: ['weather window', 'scouting severity', 'PHI', 'REI', 'operator safety']
      }
    }, lang));
  }

  if (complianceLike) {
    drafts.push(makeDraft('compliance_warning', content, {
      title: isKa ? 'შესაბამისობის და დოკუმენტების რისკები' : 'Review compliance and document risk',
      priority: urgentLike || hasAny(text, ['missing', 'expired', 'rejected', 'გამოტოვებული', 'ვადაგასული']) ? 'high' : 'medium',
      targetModule: 'documents',
      description: isKa
        ? 'შექმენით მხოლოდ განსახილველი შესაბამისობის გაფრთხილება, რათა ოფიციალური ფაილები, დეკლარაციები და სერტიფიკატის მონაცემები გადამოწმდეს პირველად ჩანაწერებთან.'
        : 'Create a review-only compliance warning so official files, declarations, and certification data can be checked against source records.',
      warnings: [isKa ? COMPLIANCE_WARNING_KA : COMPLIANCE_WARNING],
      payload: {
        suggestedChecks: ['lot origin', 'certificate status', 'declaration numbers', 'export purpose', 'attachments']
      }
    }, lang));
  }

  if (officialFieldGapLike) {
    drafts.push(makeDraft('official_document_explanation', content, {
      title: isKa ? 'ოფიციალური დოკუმენტის ცარიელი ველები' : 'Explain missing official document fields',
      priority: hasAny(text, ['critical', 'export', 'submission', 'submit', 'კრიტიკული', 'ექსპორტი']) ? 'high' : 'medium',
      targetModule: 'documents',
      description: isKa
        ? 'მოამზადეთ მხოლოდ განსახილველი განმარტება დოკუმენტის ცარიელ ველებზე, მათ სავარაუდო პირველად წყაროებზე და იმაზე, თუ რა უნდა შეივსოს ექსპორტამდე.'
        : 'Prepare a review-only explanation of missing official document fields, their likely source records, and what must be entered before export or submission.',
      warnings: [isKa ? COMPLIANCE_WARNING_KA : COMPLIANCE_WARNING],
      payload: {
        suggestedSections: ['missing fields', 'source module', 'blocking vs warning', 'next data-entry step']
      }
    }, lang));
  }

  if (passportLike) {
    drafts.push(makeDraft('lot_passport_summary', content, {
      title: lot
        ? (isKa ? `ლოტის პასპორტის რეზიუმე ${lot.name}-სთვის` : `Draft lot passport summary for ${lot.name}`)
        : (isKa ? 'ლოტის პასპორტის რეზიუმე' : 'Draft lot passport summary'),
      priority: 'low',
      targetModule: 'lots',
      description: isKa
        ? 'მოამზადეთ მხოლოდ განსახილველი ლოტის პასპორტის რეზიუმე გენეალოგიის, მიღების, ლაბორატორიის, მარნისა და დოკუმენტების ჩანაწერებიდან.'
        : 'Prepare a review-only lot passport summary from lineage, intake, lab, cellar, and document records.',
      warnings: [isKa ? COMPLIANCE_WARNING_KA : COMPLIANCE_WARNING],
      payload: {
        lotId: lot?.id,
        sections: ['origin', 'operations', 'chemistry', 'certification', 'audit']
      }
    }, lang));
  }

  if (drafts.length === 0 || hasAny(text, ['todo', 'task', 'action', 'next step', 'protocol', 'checklist', 'schedule', 'დავალება', 'ნაბიჯი', 'გეგმა'])) {
    drafts.unshift(makeDraft('task', content, {
      title: urgentLike
        ? (isKa ? 'სასწრაფო AI-რეკომენდებული დავალება' : 'Review urgent AI-recommended task')
        : (isKa ? 'AI-რეკომენდებული დავალება' : 'Review AI-recommended task'),
      priority: urgentLike ? 'high' : 'medium',
      targetModule: 'tasks',
      description: isKa
        ? 'შექმენით დავალების პროექტი ასისტენტის რეკომენდაციიდან ადამიანური გადამოწმების შემდეგ.'
        : 'Create a task draft from the assistant recommendation after a human review.',
      warnings: [],
      payload: {
        source: 'ai_assistant'
      }
    }, lang));
  }

  return drafts;
}

export function formatDraftTaskDescription(action: AiDraftAction, lang?: string): string {
  const isKa = lang === 'ka';
  const warningText = action.warnings.length > 0
    ? `\n\n${isKa ? 'შენიშვნები' : 'Review notes'}:\n- ${action.warnings.join('\n- ')}`
    : '';
  const prefix = isKa ? 'AI პროექტი' : 'AI draft action';
  return `${prefix} (${draftActionLabel(action.type, lang)}): ${action.description}${warningText}`;
}

export function createAiDraftQueueItems(
  actions: AiDraftAction[],
  options: {
    createdAt?: string;
    createdBy?: string;
    dueDate?: string;
    sourceModule?: string;
    sourceTab?: string;
  } = {},
): AiDraftQueueItem[] {
  const createdAt = options.createdAt || new Date().toISOString();
  return actions.map(action => ({
    ...action,
    status: 'draft',
    createdAt,
    createdBy: options.createdBy,
    dueDate: options.dueDate,
    sourceModule: options.sourceModule,
    sourceTab: options.sourceTab,
  }));
}

export function upsertAiDraftQueueItems(queue: AiDraftQueueItem[], incoming: AiDraftQueueItem[]): AiDraftQueueItem[] {
  const incomingIds = new Set(incoming.map(item => item.id));
  const updated = queue.map(item => {
    const next = incoming.find(candidate => candidate.id === item.id);
    if (!next) return item;
    return {
      ...item,
      ...next,
      status: item.status === 'converted_to_task' ? item.status : next.status,
      createdAt: item.createdAt,
    };
  });
  return [
    ...incoming.filter(item => !queue.some(existing => existing.id === item.id)),
    ...updated.filter(item => !incomingIds.has(item.id) || incoming.some(candidate => candidate.id === item.id)),
  ];
}

const VALID_TARGET_MODULES = new Set<AiDraftAction['targetModule']>([
  'tasks',
  'labs',
  'operations',
  'transfers',
  'bottling',
  'inventory',
  'fermentation',
  'calculators',
  'vazi',
  'documents',
  'lots',
]);

function findingDraftType(
  action: AiRecommendedAction,
): AiDraftActionType {
  const target = action.targetModule;
  if (action.kind === 'purchase' || target === 'inventory') return 'inventory_restock';
  if (action.kind === 'document' || target === 'documents' || target === 'certification') {
    return 'compliance_warning';
  }
  if (target === 'transfers') return 'transfer_plan';
  if (target === 'bottling') return 'bottling_readiness';
  if (target === 'calculators') return 'so2_calculation';
  if (target === 'vazi') return 'spray_recommendation';
  if (target === 'labs' || action.kind === 'measure') return 'lab_check';
  if (target === 'fermentation') return 'fermentation_nutrition';
  if (target === 'operations' || action.kind === 'inspect' || action.kind === 'schedule') {
    return 'cellar_operation';
  }
  return 'task';
}

function findingDraftWarnings(
  type: AiDraftActionType,
  lang?: string,
): string[] {
  const isKa = lang === 'ka';
  if (type === 'so2_calculation' || type === 'acid_adjustment') {
    return [isKa ? CHEMISTRY_WARNING_KA : CHEMISTRY_WARNING];
  }
  if (type === 'spray_recommendation') {
    return [isKa ? SPRAY_WARNING_KA : SPRAY_WARNING];
  }
  if (
    type === 'compliance_warning'
    || type === 'official_document_explanation'
    || type === 'lot_passport_summary'
  ) {
    return [isKa ? COMPLIANCE_WARNING_KA : COMPLIANCE_WARNING];
  }
  if (type === 'inventory_restock') {
    return [isKa
      ? 'შეკვეთა ავტომატურად არ იგზავნება; რაოდენობა და მომწოდებელი ადამიანმა უნდა დაადასტუროს.'
      : 'No order is sent automatically; a person must confirm quantity and supplier.'];
  }
  return [];
}

/**
 * Converts one validated finding recommendation into a typed, review-only
 * queue item. It never executes the recommendation or mutates its target
 * module; the existing human approval flow remains the only conversion path.
 */
export function draftActionFromFindingRecommendation(
  finding: AiFinding,
  action: AiRecommendedAction,
  options: { lang?: string; actionIndex?: number } = {},
): AiDraftAction {
  const isKa = options.lang === 'ka';
  const type = findingDraftType(action);
  const localizedLabel = isKa ? action.label.ka : action.label.en;
  const localizedFinding = isKa ? finding.title.ka : finding.title.en;
  const localizedObservation = isKa ? finding.observation.ka : finding.observation.en;
  const requestedTarget = action.targetModule as AiDraftAction['targetModule'] | undefined;
  const targetModule = requestedTarget && VALID_TARGET_MODULES.has(requestedTarget)
    ? requestedTarget
    : type === 'lab_check'
      ? 'labs'
      : type === 'inventory_restock'
        ? 'inventory'
        : type === 'compliance_warning'
          ? 'documents'
          : type === 'spray_recommendation'
            ? 'vazi'
            : type === 'cellar_operation'
              ? 'operations'
              : 'tasks';
  const priority: AiDraftPriority = finding.severity === 'critical'
    ? 'high'
    : finding.severity === 'warning'
      ? 'medium'
      : 'low';
  const source = `${finding.id}:${options.actionIndex ?? 0}:${localizedLabel}`;

  return makeDraft(type, source, {
    title: localizedLabel || localizedFinding,
    priority,
    targetModule,
    description: isKa
      ? `${localizedFinding}: ${localizedLabel}\n\nდაკვირვება: ${localizedObservation}`
      : `${localizedFinding}: ${localizedLabel}\n\nObservation: ${localizedObservation}`,
    warnings: findingDraftWarnings(type, options.lang),
    payload: {
      source: 'ai_finding',
      findingId: finding.id,
      findingType: finding.findingType,
      findingSeverity: finding.severity,
      entityType: finding.entityType,
      entityId: finding.entityId,
      recommendedActionKind: action.kind,
      recommendedActionIndex: options.actionIndex ?? 0,
      requiresConfirmation: true,
    },
  }, options.lang);
}
