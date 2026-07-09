import type { ComplianceReadiness } from './compliance';

export interface AgencyDeadlineReminder {
  id: string;
  deadline: string;
  month: number;
  day: number;
  labelEn: string;
  labelKa: string;
  requiredFormEn: string;
  requiredFormKa: string;
  formId: string;
  readiness: ComplianceReadiness;
  missingData: string[];
}

export type DeadlineReadinessMap = Record<string, ComplianceReadiness>;

const fallbackReadiness: ComplianceReadiness = {
  scope: 'document',
  score: 0,
  badge: 'Not ready',
  missing: ['document readiness not calculated'],
  missingCritical: ['document readiness not calculated'],
  requirements: [],
};

const DEADLINES = [
  {
    id: 'vineyard_notification',
    month: 1,
    day: 10,
    formId: 'annex_16_vineyard_notification',
    labelEn: 'Vineyard notification',
    labelKa: 'ვენახის შეტყობინება',
    requiredFormEn: 'Annex 16 - Vineyard notification',
    requiredFormKa: 'დანართი 16 - ვენახის შეტყობინება',
  },
  {
    id: 'wine_turnover',
    month: 1,
    day: 10,
    formId: 'annex_18_wine_turnover_notification',
    labelEn: 'Wine turnover / balance notification',
    labelKa: 'ღვინის ბრუნვის / ნაშთის შეტყობინება',
    requiredFormEn: 'Annex 18 - Wine turnover notification',
    requiredFormKa: 'დანართი 18 - ღვინის ბრუნვის შეტყობინება',
  },
  {
    id: 'distillate_balance',
    month: 1,
    day: 10,
    formId: 'annex_19_distillate_notification',
    labelEn: 'Distillate / spirit balance notification',
    labelKa: 'დისტილატის / სპირტის ნაშთის შეტყობინება',
    requiredFormEn: 'Annex 19 - Distillate notification',
    requiredFormKa: 'დანართი 19 - დისტილატის შეტყობინება',
  },
  {
    id: 'planting_material',
    month: 7,
    day: 1,
    formId: 'annex_15_seedlings_notification',
    labelEn: 'Planting material movement notification',
    labelKa: 'სარგავი მასალის მოძრაობის შეტყობინება',
    requiredFormEn: 'Annex 15 - Grafting material / seedlings notification',
    requiredFormKa: 'დანართი 15 - ნამყენი ნერგების შეტყობინება',
  },
  {
    id: 'grape_processing',
    month: 12,
    day: 1,
    formId: 'annex_17_processing_notification',
    labelEn: 'Grape processing notification',
    labelKa: 'ყურძნის გადამუშავების შეტყობინება',
    requiredFormEn: 'Annex 17 - Grape processing notification',
    requiredFormKa: 'დანართი 17 - ყურძნის გადამუშავების შეტყობინება',
  },
] as const;

export function buildAgencyDeadlineCalendar(year: number, readinessByFormId: DeadlineReadinessMap): AgencyDeadlineReminder[] {
  return DEADLINES.map(item => {
    const deadline = new Date(Date.UTC(year, item.month - 1, item.day)).toISOString().slice(0, 10);
    const readiness = readinessByFormId[item.formId] || fallbackReadiness;
    return {
      ...item,
      deadline,
      readiness,
      missingData: readiness.missing,
    };
  });
}

export function nextAgencyDeadline(todayIso: string, reminders: AgencyDeadlineReminder[]): AgencyDeadlineReminder | null {
  const today = todayIso.slice(0, 10);
  return [...reminders]
    .filter(r => r.deadline >= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))[0] || null;
}
