import { describe, expect, it } from 'vitest';
import { localizedRoleLabel } from '../lib/roleLabels';

describe('localized role labels', () => {
  it('does not present specialist roles as owners', () => {
    expect(localizedRoleLabel('Lab Technician', 'en')).toBe('Lab Technician');
    expect(localizedRoleLabel('Cellar Worker', 'en')).toBe('Cellar Worker');
    expect(localizedRoleLabel('Read-Only', 'en')).toBe('Read-only');
  });

  it('provides Georgian labels for every production role', () => {
    for (const role of ['Owner/Admin', 'Winemaker', 'Viticulturist', 'Lab Technician', 'Cellar Worker', 'Read-Only']) {
      expect(localizedRoleLabel(role, 'ka')).toMatch(/[ა-ჰ]/);
    }
  });

  it('preserves an unknown server role instead of elevating its label', () => {
    expect(localizedRoleLabel('Custom Auditor', 'en')).toBe('Custom Auditor');
  });
});
