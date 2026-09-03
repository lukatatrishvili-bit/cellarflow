import { BarChart3, FileText, FlaskConical, Layers, ShieldAlert, Sprout, Sun, TrendingUp, Wind } from 'lucide-react';
import type React from 'react';
import type { Language } from './i18n';

/**
 * The vineyard workspace's destinations, shared between the app shell (which
 * renders them in the same sidebar the cellar uses) and VaziModule (which
 * still owns the screens themselves). Kept out of VaziModule so the shell can
 * build its navigation without eagerly importing that lazily-loaded module.
 */
export type VaziTab =
  | 'dashboard'
  | 'blocks'
  | 'projects'
  | 'tasks'
  | 'spraying'
  | 'scouting'
  | 'sampling'
  | 'yield'
  | 'weather'
  | 'ipm_pheno';

export interface VaziNavGroup {
  id: string;
  label: string;
  items: Array<{ id: VaziTab; label: string; icon: React.ComponentType<{ className?: string }> }>;
}

export function vaziNavigationGroups(lang: Language): VaziNavGroup[] {
  const ka = lang === 'ka';
  // Four headings, matching the cellar's shape. "Conditions" used to hold
  // weather alone and "Overview" the dashboard alone — two headings for two
  // items, which in the rail means two dividers earning nothing. Both are
  // things you glance at rather than work in, so they share one.
  return [
    {
      id: 'overview',
      label: ka ? 'მთავარი' : 'Overview',
      items: [
        { id: 'dashboard', label: ka ? 'მიმოხილვა' : 'Overview', icon: BarChart3 },
        { id: 'weather', label: ka ? 'ამინდი' : 'Weather', icon: Sun },
      ],
    },
    {
      id: 'vineyard',
      label: ka ? 'ვენახი' : 'Vineyard',
      items: [
        { id: 'blocks', label: ka ? 'ნაკვეთები' : 'Blocks', icon: Layers },
        { id: 'projects', label: ka ? 'ახალი პროექტები' : 'New projects', icon: FileText },
      ],
    },
    {
      id: 'field',
      label: ka ? 'საველე სამუშაო' : 'Field work',
      items: [
        { id: 'scouting', label: ka ? 'დათვალიერება' : 'Scouting', icon: ShieldAlert },
        { id: 'ipm_pheno', label: ka ? 'დაცვა / IPM' : 'Protection / IPM', icon: Sprout },
        { id: 'spraying', label: ka ? 'წამლობა' : 'Spraying', icon: Wind },
      ],
    },
    {
      id: 'harvest',
      label: ka ? 'რთველი' : 'Harvest',
      items: [
        { id: 'sampling', label: ka ? 'ნიმუშები' : 'Sampling', icon: FlaskConical },
        { id: 'yield', label: ka ? 'დაგეგმვა' : 'Planning', icon: TrendingUp },
      ],
    },
  ];
}
