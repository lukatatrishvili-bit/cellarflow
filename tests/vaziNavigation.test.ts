import { describe, expect, it } from 'vitest';
import { vaziNavigationGroups } from '../lib/vaziNavigation';

/**
 * The vineyard's navigation moved out of VaziModule and into the shared app
 * shell, so the destinations themselves are covered here rather than through
 * the module's rendered markup.
 */
describe('vazi navigation groups', () => {
  it('labels every section in English', () => {
    const labels = vaziNavigationGroups('en').map(group => group.label);

    expect(labels).toEqual(['Overview', 'Vineyard', 'Field work', 'Harvest']);
  });

  it('labels every section in Georgian', () => {
    const labels = vaziNavigationGroups('ka').map(group => group.label);

    expect(labels).toEqual(['მთავარი', 'ვენახი', 'საველე სამუშაო', 'რთველი']);
  });

  it('keeps every vineyard screen reachable exactly once', () => {
    const ids = vaziNavigationGroups('en').flatMap(group => group.items.map(item => item.id));

    expect(ids).toEqual([
      'dashboard',
      'weather',
      'blocks',
      'projects',
      'scouting',
      'ipm_pheno',
      'spraying',
      'sampling',
      'yield',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('earns every heading it prints', () => {
    // A section of one is a divider with a caption — it costs a rule in the
    // rail and a heading in the full sidebar to say nothing the item does not.
    for (const group of vaziNavigationGroups('en')) {
      expect(group.items.length).toBeGreaterThan(1);
    }
  });

  it('gives every destination a label and an icon in both languages', () => {
    for (const lang of ['en', 'ka'] as const) {
      for (const group of vaziNavigationGroups(lang)) {
        expect(group.label.trim()).not.toBe('');
        expect(group.items.length).toBeGreaterThan(0);
        for (const item of group.items) {
          expect(item.label.trim()).not.toBe('');
          expect(item.icon).toBeTruthy();
        }
      }
    }
  });
});
