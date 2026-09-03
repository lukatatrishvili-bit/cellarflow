// Display-layer Georgian labels for the Integration Hub's server-provided
// metadata (lib/integrations.ts). The canonical English strings stay untouched
// because they are embedded in export artifacts and drive the
// domainAllowsExternalField guard — this module localizes rendering only.
// Unknown ids fall back to the server-provided English text.
import type { Language } from './i18n';
import type {
  IntegrationConnectorDefinition,
  IntegrationDomainDefinition,
  IntegrationSyncDomain,
  SourceOfTruthRule,
} from './integrations';

const DOMAIN_LABELS_KA: Record<IntegrationSyncDomain, string> = {
  products: 'პროდუქტები / ნომენკლატურა',
  customers: 'კლიენტები',
  suppliers: 'მომწოდებლები',
  sales_dispatches: 'გაყიდვების გატანები',
  sales_orders: 'გაყიდვების შეკვეთები',
  supplier_payments: 'მომწოდებელთა გადახდები',
  stock_movements: 'მარაგის მოძრაობები',
  cost_entries: 'ხარჯების ჩანაწერები',
};

export function integrationDomainLabel(
  domain: Pick<IntegrationDomainDefinition, 'id' | 'label'> | IntegrationSyncDomain,
  lang: Language,
): string {
  const id = typeof domain === 'string' ? domain : domain.id;
  const fallback = typeof domain === 'string' ? domain : domain.label;
  return lang === 'ka' ? (DOMAIN_LABELS_KA[id] || fallback) : fallback;
}

interface SourceRuleText {
  cellarFlowOwns: string[];
  externalOwns: string[];
  notes: string;
}

const SOURCE_RULES_KA: Record<IntegrationSyncDomain, SourceRuleText> = {
  products: {
    cellarFlowOwns: ['ღვინის პარტიის იდენტობა', 'ჯიში', 'მოსავლის წელი', 'მარნის ეტაპი', 'ინვენტარის პროდუქტების ხარჯვა'],
    externalOwns: ['ოფიციალური ნომენკლატურის კოდი', 'სააღრიცხვო კატეგორია', 'საგადასახადო კლასი'],
    notes: 'VinOS ახდენს ოპერაციული პროდუქტების ექსპორტს. 1C-ს შეუძლია დააბრუნოს ოფიციალური ნომენკლატურის ID-ები და საგადასახადო/სააღრიცხვო ატრიბუტები.',
  },
  customers: {
    cellarFlowOwns: ['გაყიდვების ჩანაწერებში დაფიქსირებული კლიენტის სახელი'],
    externalOwns: ['კლიენტის იურიდიული კოდი', 'დღგ-ს რეგისტრაციის მონაცემები', 'დებიტორული დავალიანების სტატუსი'],
    notes: 'კლიენტების ძირითადი მონაცემები გარე ID-ით ემთხვევა ისე, რომ 1C ვერ გადაწერს ისტორიულ გატანებს.',
  },
  suppliers: {
    cellarFlowOwns: ['მომწოდებელთა სახელები ვენახის/მარნის ოპერაციებზე'],
    externalOwns: ['მომწოდებლის იურიდიული კოდი', 'დღგ-ს რეგისტრაციის მონაცემები', 'კრედიტორული დავალიანების სტატუსი'],
    notes: 'მომწოდებლების დამთხვევა იდემპოტენტურია გარე მითითებების მეშვეობით.',
  },
  sales_dispatches: {
    cellarFlowOwns: ['ფიზიკური გატანა', 'პარტია', 'ლოკაცია', 'ბოთლების რაოდენობა', 'ოპერატორის შენიშვნები'],
    externalOwns: ['ინვოისის ნომერი', 'დოკუმენტის სტატუსი', 'დღგ/საგადასახადო ველები', 'გადახდის სტატუსი'],
    notes: '1C-ს შეუძლია გატანებს დაურთოს სააღრიცხვო დოკუმენტის მდგომარეობა, მაგრამ ვერ შეცვლის მიკვლევადობის რაოდენობებს.',
  },
  sales_orders: {
    cellarFlowOwns: ['ჯავშანი', 'შესრულების ბმული', 'პარტია', 'ლოკაცია', 'გატანის მოთხოვნილი თარიღი'],
    externalOwns: ['ოფიციალური შეკვეთის ნომერი', 'სააღრიცხვო სტატუსი', 'საგადასახადო ველები'],
    notes: 'VinOS რჩება შეკვეთების ოპერაციულ წყაროდ; 1C აბრუნებს სააღრიცხვო იდენტიფიკატორებს.',
  },
  supplier_payments: {
    cellarFlowOwns: ['გადახდის განზრახვა / ოპერაციული შენიშვნა', 'მომწოდებელთან ანგარიშსწორების კონტექსტი'],
    externalOwns: ['გადახდის ოფიციალური დოკუმენტის ნომერი', 'გატარების სტატუსი', 'საბანკო რეკონსილაციის სტატუსი'],
    notes: '1C ფლობს გადახდების ოფიციალურ გატარებას და დოკუმენტების ნუმერაციას.',
  },
  stock_movements: {
    cellarFlowOwns: ['პარტიის მიკვლევადობა', 'შენახვის ლოკაცია', 'მოძრაობის მიმართულება', 'ბოთლების რაოდენობა'],
    externalOwns: ['მარაგის ოფიციალური შეფასება', 'სააღრიცხვო გატარების სტატუსი', 'საგადასახადო/სააღრიცხვო პერიოდი'],
    notes: '1C-ს შეუძლია დააბრუნოს შეფასებისა და გატარების მეტამონაცემები, მაგრამ ვერ გადაწერს მარაგის ფიზიკური მოძრაობის ფაქტებს.',
  },
  cost_entries: {
    cellarFlowOwns: ['ხარჯის მიკუთვნება პარტიაზე', 'მარნის ხარჯის კატეგორია', 'ოპერაციული წყაროს მითითება'],
    externalOwns: ['ოფიციალური სააღრიცხვო ანგარიში', 'გატარებული დოკუმენტის ნომერი', 'საგადასახადო რეჟიმი'],
    notes: 'ხარჯების ჩანაწერები კვებავს სააღრიცხვო განხილვას; აღრიცხვის ოფიციალური რეესტრი 1C-შია.',
  },
};

/** Localized copy of a source-of-truth rule for display. */
export function sourceOfTruthDisplay(rule: SourceOfTruthRule, lang: Language): SourceRuleText {
  if (lang === 'ka') {
    const ka = SOURCE_RULES_KA[rule.domain];
    if (ka) return ka;
  }
  return { cellarFlowOwns: rule.cellarFlowOwns, externalOwns: rule.externalOwns, notes: rule.notes };
}

const CONNECTOR_SETTINGS_KA: Record<string, { requiredSettings: string[]; optionalSettings: string[] }> = {
  one_c_accounting: {
    requiredSettings: ['Endpoint URL ან გაცვლის საქაღალდის მისამართი', 'ავთენტიფიკაციის რეჟიმი'],
    optionalSettings: ['მომხმარებლის სახელი', '1C ბაზის სახელი', 'საიდუმლო, რომელიც VinOS-ის გარეთ იმართება'],
  },
};

export function connectorSettingsDisplay(
  definition: Pick<IntegrationConnectorDefinition, 'id' | 'requiredSettings' | 'optionalSettings'>,
  lang: Language,
): { requiredSettings: string[]; optionalSettings: string[] } {
  if (lang === 'ka') {
    const ka = CONNECTOR_SETTINGS_KA[definition.id];
    if (ka) return ka;
  }
  return { requiredSettings: definition.requiredSettings, optionalSettings: definition.optionalSettings };
}

/** Localizes the default connector name; user-renamed connectors stay as typed. */
export function connectorDisplayName(name: string, lang: Language): string {
  if (lang === 'ka' && name === '1C Connector') return '1C კონექტორი';
  return name;
}
