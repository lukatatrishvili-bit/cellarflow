import { describe, it, expect } from 'vitest';
import { computeSetupJourney, type SetupJourneyInput } from '../lib/onboarding';

const empty = (): SetupJourneyInput => ({
  companyProfile: { companyName: '', wineryName: '', region: '' },
  blocks: [], vessels: [], lots: [], grapeIntakes: [], cellarOps: [], fermLogs: [], labLogs: [],
});

describe('setup journey', () => {
  it('starts at zero for a brand-new winery and suggests the profile first', () => {
    const j = computeSetupJourney(empty());
    expect(j.done).toBe(0);
    expect(j.total).toBe(6);
    expect(j.pct).toBe(0);
    expect(j.complete).toBe(false);
    expect(j.nextStep?.id).toBe('profile');
  });

  it('profile needs BOTH a name and a region (documents require both)', () => {
    const nameOnly = computeSetupJourney({ ...empty(), companyProfile: { companyName: 'ჩემი მარანი', wineryName: '', region: '' } });
    expect(nameOnly.steps.find(s => s.id === 'profile')?.done).toBe(false);
    const both = computeSetupJourney({ ...empty(), companyProfile: { companyName: '', wineryName: 'Kondoli Cellar', region: 'Kakheti' } });
    expect(both.steps.find(s => s.id === 'profile')?.done).toBe(true);
  });

  it('intake counts either a structured intake or a legacy lot', () => {
    const viaIntake = computeSetupJourney({ ...empty(), grapeIntakes: [{ id: 'gi1' }] });
    expect(viaIntake.steps.find(s => s.id === 'intake')?.done).toBe(true);
    const viaLot = computeSetupJourney({ ...empty(), lots: [{ id: 'L1' }] });
    expect(viaLot.steps.find(s => s.id === 'intake')?.done).toBe(true);
  });

  it('operation counts either a cellar op or a fermentation log', () => {
    const viaOp = computeSetupJourney({ ...empty(), cellarOps: [{ id: 'op1' }] });
    expect(viaOp.steps.find(s => s.id === 'operation')?.done).toBe(true);
    const viaFerm = computeSetupJourney({ ...empty(), fermLogs: [{ id: 'f1' }] });
    expect(viaFerm.steps.find(s => s.id === 'operation')?.done).toBe(true);
  });

  it('nextStep skips completed steps and lands on the first gap', () => {
    const j = computeSetupJourney({
      ...empty(),
      companyProfile: { companyName: 'X', wineryName: '', region: 'Kakheti' },
      blocks: [{ id: 'b1' }],
      vessels: [{ id: 'v1' }],
    });
    expect(j.done).toBe(3);
    expect(j.nextStep?.id).toBe('intake');
  });

  it('completes at 100% and clears nextStep when every record type exists', () => {
    const j = computeSetupJourney({
      companyProfile: { companyName: 'X', wineryName: 'Y', region: 'Kakheti' },
      blocks: [{ id: 'b' }], vessels: [{ id: 'v' }], lots: [{ id: 'l' }],
      grapeIntakes: [{ id: 'g' }], cellarOps: [{ id: 'o' }], fermLogs: [], labLogs: [{ id: 'la' }],
    });
    expect(j.complete).toBe(true);
    expect(j.pct).toBe(100);
    expect(j.nextStep).toBeNull();
  });

  it('every step carries both Georgian and English labels and a deep link', () => {
    for (const s of computeSetupJourney(empty()).steps) {
      expect(s.en.length).toBeGreaterThan(3);
      expect(s.ka.length).toBeGreaterThan(3);
      expect(['settings', 'vazi', 'gvino']).toContain(s.module);
    }
  });
});
