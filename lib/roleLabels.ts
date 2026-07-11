import type { Role } from '../server/permissions';

const ROLE_LABELS: Record<Role, { en: string; ka: string }> = {
  'Owner/Admin': { en: 'Owner & ERP Admin', ka: 'მფლობელი & ERP ადმინი' },
  Winemaker: { en: 'Head Winemaker', ka: 'მთავარი მეღვინე' },
  Viticulturist: { en: 'Lead Viticulturist', ka: 'მთავარი მევენახე' },
  'Lab Technician': { en: 'Lab Technician', ka: 'ლაბორანტი' },
  'Cellar Worker': { en: 'Cellar Worker', ka: 'მარნის თანამშრომელი' },
  'Read-Only': { en: 'Read-only', ka: 'მხოლოდ ნახვა' },
};

export function localizedRoleLabel(role: string, lang: string): string {
  const labels = ROLE_LABELS[role as Role];
  if (!labels) return role || (lang === 'ka' ? 'როლი უცნობია' : 'Unknown role');
  return lang === 'ka' ? labels.ka : labels.en;
}
