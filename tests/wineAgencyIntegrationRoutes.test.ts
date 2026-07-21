import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompanyProfile } from '../lib/wineryState';

const searchWineAgencyRegistry = vi.fn();
const saveUserData = vi.fn();

function profile(): CompanyProfile {
  return {
    companyName: 'Badagoni',
    wineryName: 'Badagoni',
    country: 'Georgia',
    region: 'Kakheti',
    municipality: 'Akhmeta',
    address: '',
    contactEmail: '',
    phone: '',
    website: '',
    measurementUnits: 'metric',
  };
}

let data: any = { companyProfile: profile(), auditLogs: [] };
let server: Server;
let baseUrl = '';

vi.mock('../server/middleware/auth', () => ({
  checkWineryScope: () => (req: any, _res: any, next: () => void) => {
    req.wineryContext = { username: 'owner' };
    next();
  },
}));

vi.mock('../server/db', () => ({
  createEmptyUserData: () => ({ companyProfile: profile(), auditLogs: [] }),
  getUserData: vi.fn(async () => data),
  saveUserData,
}));

vi.mock('../server/wineAgencyRegistry', async () => {
  const actual = await vi.importActual<typeof import('../server/wineAgencyRegistry')>('../server/wineAgencyRegistry');
  return { ...actual, searchWineAgencyRegistry };
});

beforeAll(async () => {
  const routes = await import('../server/routes/integrations');
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', routes.default);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  data = { companyProfile: profile(), auditLogs: [] };
  searchWineAgencyRegistry.mockReset();
  saveUserData.mockReset();
  saveUserData.mockImplementation(async (_username: string, nextData: any) => {
    data = nextData;
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe.sequential('Wine Agency integration routes', () => {
  it('requires an existing server-linked producer before re-checking', async () => {
    const response = await fetch(`${baseUrl}/api/integrations/wine-agency/registry/reverify`, { method: 'POST' });

    expect(response.status).toBe(409);
    expect(searchWineAgencyRegistry).not.toHaveBeenCalled();
    expect(saveUserData).not.toHaveBeenCalled();
  });

  it('re-checks only the server-stored producer identity and appends audit evidence', async () => {
    data.companyProfile = {
      ...profile(),
      wineAgencyRegistrationCode: '1100',
      identificationCode: '224624262',
      wineAgencyVerification: {
        registrationNumber: '1100',
        name: 'Old directory name',
        identificationCode: '224624262',
        sourceUrl: 'https://www.wine.gov.ge/En/WineCompaniesAndWineries',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        officialApi: false,
        transport: 'public_html_registry',
      },
    };
    searchWineAgencyRegistry.mockResolvedValue({
      results: [{
        registrationNumber: '1100',
        name: 'JSC “Badagoni”',
        identificationCode: '224624262',
        sourceUrl: 'https://www.wine.gov.ge/En/WineCompaniesAndWineries',
        verifiedAt: new Date().toISOString(),
      }],
    });

    const response = await fetch(`${baseUrl}/api/integrations/wine-agency/registry/reverify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ registrationNumber: '9999' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(searchWineAgencyRegistry).toHaveBeenCalledWith({ registrationNumber: '1100' }, { useCache: false });
    expect(body).toMatchObject({
      verification: { registrationNumber: '1100', name: 'JSC “Badagoni”' },
      status: { state: 'current', policy: 'cellarflow_internal' },
      portalUrl: 'https://portal.wine.gov.ge/',
    });
    expect(saveUserData).toHaveBeenCalledOnce();
    expect(data.auditLogs[0]).toMatchObject({
      actionType: 'Wine Agency Producer Identity Rechecked',
      changedItem: '1100',
    });
  });
});
