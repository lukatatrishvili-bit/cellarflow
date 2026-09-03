import type { Language } from './i18n';

type ShellTranslationKey =
  | 'dashboard'
  | 'today'
  | 'overview'
  | 'grape_intake'
  | 'rtveli'
  | 'wine_lots'
  | 'lineage'
  | 'tanks'
  | 'cellar_operations'
  | 'transfers'
  | 'fermentation'
  | 'lab_analysis'
  | 'bottling'
  | 'inventory'
  | 'tasks'
  | 'notes'
  | 'calculators'
  | 'ai_assistant'
  | 'ai_intelligence'
  | 'nav_portal'
  | 'nav_vazi'
  | 'nav_gvino'
  | 'nav_sales'
  | 'nav_storage'
  | 'nav_costs'
  | 'nav_analytics'
  | 'nav_docs'
  | 'nav_audit'
  | 'nav_settings'
  | 'nav_logout'
  | 'signin_role_viticulturist'
  | 'signin_role_winemaker'
  | 'signin_role_owner'
  | 'signin_subtitle'
  | 'signin_title'
  | 'signin_username'
  | 'signin_passcode'
  | 'signin_btn';

export type ShellTranslations = Record<ShellTranslationKey, string>;

const en: ShellTranslations = {
  dashboard: 'Dashboard',
  today: 'Today',
  overview: 'Overview',
  grape_intake: 'Grape Intake',
  rtveli: 'Rtveli (Harvest)',
  wine_lots: 'Wine Lots',
  lineage: 'Lineage',
  tanks: 'Tanks & Vessels',
  cellar_operations: 'Operations',
  transfers: 'Transfers',
  fermentation: 'Fermentation',
  lab_analysis: 'Lab Analysis',
  bottling: 'Bottling',
  inventory: 'Inventory',
  tasks: 'Tasks',
  notes: 'Notes',
  calculators: 'Winemaking Calculators',
  ai_assistant: 'AI Winemaker',
  ai_intelligence: 'Winery Intelligence',
  nav_portal: 'Dashboard Portal',
  nav_vazi: 'Vazi (Vineyard)',
  nav_gvino: 'Gvino (Winery)',
  nav_sales: 'Sales',
  nav_storage: 'Storage',
  nav_costs: 'Costs',
  nav_analytics: 'Analytics',
  nav_docs: 'Official Documents',
  nav_audit: 'Audit Trail',
  nav_settings: 'Settings',
  nav_logout: 'Logout',
  signin_role_viticulturist: 'Lead Viticulturist',
  signin_role_winemaker: 'Head Winemaker',
  signin_role_owner: 'Owner & ERP Admin',
  signin_subtitle: 'Unified Vineyard (Vazi) & Winery (Gvino) Cloud Management',
  signin_title: 'VinOS Unified Sign In',
  signin_username: 'Account Username / Email',
  signin_passcode: 'Passcode',
  signin_btn: 'Secure Portal Login',
};

const ka: ShellTranslations = {
  dashboard: 'მთავარი პანელი',
  today: 'დღეს',
  overview: 'მიმოხილვა',
  grape_intake: 'ყურძნის მიღება',
  rtveli: 'რთველი',
  wine_lots: 'ღვინის პარტიები',
  lineage: 'გენეალოგია',
  tanks: 'რეზერვუარები',
  cellar_operations: 'ოპერაციები',
  transfers: 'გადატანა',
  fermentation: 'დუღილი',
  lab_analysis: 'ლაბორატორია',
  bottling: 'ჩამოსხმა',
  inventory: 'ინვენტარი',
  tasks: 'დავალებები',
  notes: 'შენიშვნა',
  calculators: 'კალკულატორები',
  ai_assistant: 'AI მეღვინე',
  ai_intelligence: 'მარნის ინტელექტი',
  nav_portal: 'მთავარი პორტალი',
  nav_vazi: 'ვაზი (ვენახები)',
  nav_gvino: 'ღვინო (მარანი)',
  nav_sales: 'გაყიდვები',
  nav_storage: 'საწყობი',
  nav_costs: 'ხარჯები',
  nav_analytics: 'ანალიტიკა',
  nav_docs: 'ოფიციალური დოკუმენტები',
  nav_audit: 'აუდიტის ისტორია',
  nav_settings: 'პარამეტრები',
  nav_logout: 'გამოსვლა',
  signin_role_viticulturist: 'მთავარი მევენახე',
  signin_role_winemaker: 'მთავარი მეღვინე',
  signin_role_owner: 'მფლობელი & ERP ადმინი',
  signin_subtitle: 'ვენახების (ვაზი) და მარნის (ღვინო) ერთიანი მართვის სისტემა',
  signin_title: 'VinOS - ავტორიზაცია',
  signin_username: 'ანგარიშის სახელი / ელ-ფოსტა',
  signin_passcode: 'უსაფრთხოების კოდი',
  signin_btn: 'უსაფრთხო შესვლა',
};

const shellTranslations: Partial<Record<Language, ShellTranslations>> = {
  en,
  ka,
};

export function getShellTranslations(lang: Language): ShellTranslations {
  return shellTranslations[lang] || en;
}
