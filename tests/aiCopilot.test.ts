import { describe, it, expect } from 'vitest';
import { getDB } from '../server/db';
import { getHistoricalContext } from '../server.ts';

describe('AI Winemaking Copilot Historical Context', () => {
  it('returns empty string if user does not exist', () => {
    const context = getHistoricalContext('non_existent_user_xyz');
    expect(context).toBe('');
  });

  it('correctly assembles blocks, lots, chemistry, and fermentation logs', () => {
    const db = getDB();
    const mockUsername = 'test_user_ai_copilot_verification';
    const mockOrgId = 'org_test_ai_copilot';

    // Add mock user
    db.users.push({
      username: mockUsername,
      fullName: 'Test AI Copilot User',
      activeOrganizationId: mockOrgId,
      email: 'test@copilot.com',
      role: 'Winemaker',
      language: 'en',
      passwordHash: '',
      emailVerified: true,
      isDemo: false
    });

    // Seed mock organization data in the in-memory database cache
    db.orgData[mockOrgId] = {
      vessels: [
        { id: 'vessel-t1', name: 'Tank T-1', type: 'Stainless Steel', assignedLotId: 'lot-sap-2026' }
      ],
      lots: [
        { id: 'lot-sap-2026', name: 'Saperavi Premium', variety: 'Saperavi', vintage: 2026, currentVolume: 5000, stage: 'Fermentation' }
      ],
      fermlogs: [
        { id: 'f-1', lotId: 'lot-sap-2026', date: '2026-09-10', density: 1.095, temperature: 22 },
        { id: 'f-2', lotId: 'lot-sap-2026', date: '2026-09-11', density: 1.080, temperature: 24, ph: 3.45 }
      ],
      lablogs: [
        { id: 'l-1', lotId: 'lot-sap-2026', date: '2026-09-11', ph: 3.45, freeSo2: 25, titratableAcidity: 6.2, volatileAcid: 0.25, alcoholPct: 5.5 }
      ],
      inventory: [],
      tasks: [],
      notes: [],
      blocks: [
        { id: 'block-sap', name: 'Saperavi Hillside A', grapeVariety: 'Saperavi', area: 1.5, currentPhenology: 'Veraison', estimatedHarvestDate: '2026-09-15', spacing: '2.5m x 1m', trainingSystem: 'Guyot' }
      ],
      phenologyLogs: [],
      sprays: [
        { id: 'spray-1', blockId: 'block-sap', date: '2026-08-20', productName: 'Copper Soap', targetProblem: 'Downy Mildew', dosePerHa: 3 }
      ],
      scoutings: [
        { id: 'scout-1', blockId: 'block-sap', date: '2026-08-25', problemType: 'Powdery mildew', severity: 'low', notes: 'Spotted on lower leaves.' }
      ],
      soilRecords: [],
      samplings: [],
      harvests: [],
      irrigationLogs: [],
      fertilizerLogs: [],
      auditLogs: [],
      bottlingRuns: [],
      transfers: [],
      grapeIntakes: [],
      cellarOps: [],
      costEntries: [],
      winePricing: {},
      storageLocations: [],
      stockMovements: [],
      salesDispatches: [],
      salesOrders: [],
      companyProfile: {}
    };

    const context = getHistoricalContext(mockUsername);

    // Assert block context
    expect(context).toContain('Saperavi Hillside A');
    expect(context).toContain('Veraison');
    expect(context).toContain('2026-09-15');

    // Assert scouting and spray context
    expect(context).toContain('Powdery mildew');
    expect(context).toContain('Spotted on lower leaves.');
    expect(context).toContain('Copper Soap');

    // Assert lot and vessel context
    expect(context).toContain('Saperavi Premium');
    expect(context).toContain('Tank T-1 (Stainless Steel)');
    expect(context).toContain('5000 L');

    // Assert chemistry context
    expect(context).toContain('pH: 3.45');
    expect(context).toContain('Free SO2: 25 ppm');

    // Assert fermentation context
    expect(context).toContain('SG/Density: 1.08');
    expect(context).toContain('Temp: 24°C');

    // Cleanup
    db.users = db.users.filter(u => u.username !== mockUsername);
    delete db.orgData[mockOrgId];
  });
});
