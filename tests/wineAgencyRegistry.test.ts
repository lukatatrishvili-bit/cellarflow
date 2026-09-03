import { describe, expect, it, vi } from 'vitest';
import {
  applyWineAgencyVerification,
  parseWineAgencyRegistryHtml,
  searchWineAgencyRegistry,
  validateWineAgencyRegistryQuery,
  wineAgencyIdentityMismatches,
  wineAgencyVerificationStatus,
} from '../server/wineAgencyRegistry';
import type { CompanyProfile } from '../lib/wineryState';

const fixture = `
<div class="fileBlock wineCompany">
  <div class="contactIcon"><span>1100</span></div>
  <h2><a href="#inline_1100" class="various1">JSC &ldquo;Badagoni&rdquo;</a></h2>
  <h3>0910, Georgia, Akhmeta District, vil. Zemo Khodasheni</h3>
  <div class="wineCompanyDesc">
    <h2>JSC &nbsp; JSC &ldquo;Badagoni&rdquo;<span>1100</span></h2>
    <h3>Identification Code 224624262</h3>
    <h3>0910, Georgia, Akhmeta District, vil. Zemo Khodasheni</h3>
    <a href="https://badagoni.com" target="_blank">badagoni.com</a>
  </div>
</div>`;

const profile = (updates: Partial<CompanyProfile> = {}): CompanyProfile => ({
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
  ...updates,
});

describe('Wine Agency public registry adapter', () => {
  it('parses the public HTML partial into a bounded structured record', () => {
    expect(parseWineAgencyRegistryHtml(fixture, '2026-07-20T00:00:00.000Z')).toEqual([{
      registrationNumber: '1100',
      name: 'JSC “Badagoni”',
      legalForm: 'JSC',
      identificationCode: '224624262',
      address: '0910, Georgia, Akhmeta District, vil. Zemo Khodasheni',
      website: 'https://badagoni.com',
      sourceUrl: 'https://www.wine.gov.ge/En/WineCompaniesAndWineries',
      verifiedAt: '2026-07-20T00:00:00.000Z',
    }]);
    expect(parseWineAgencyRegistryHtml(fixture.replace('fileBlock wineCompany', 'wineCompany featured fileBlock'))).toHaveLength(1);
  });

  it('validates lookup input and rejects broad or malformed requests', () => {
    expect(validateWineAgencyRegistryQuery({ registrationNumber: ' 1100 ' })).toEqual({ registrationNumber: '1100', companyName: '' });
    expect(() => validateWineAgencyRegistryQuery({})).toThrow(/required/i);
    expect(() => validateWineAgencyRegistryQuery({ registrationNumber: '11<script>' })).toThrow(/digits/i);
    expect(() => validateWineAgencyRegistryQuery({ companyName: 'x' })).toThrow(/at least 2/i);
    expect(() => validateWineAgencyRegistryQuery({ companyName: 'x'.repeat(121) })).toThrow(/too long/i);
  });

  it('requests only the fixed official endpoint and reports that it is not an official API', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://www.wine.gov.ge');
      expect(url.pathname).toBe('/En/Companies/SearchCompany');
      expect(url.searchParams.get('lotNumber')).toBe('1100');
      return new Response(fixture, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }) as unknown as typeof fetch;

    const result = await searchWineAgencyRegistry(
      { registrationNumber: '1100' },
      { fetchImpl, now: new Date('2026-07-20T00:00:00.000Z'), useCache: false },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ officialApi: false, transport: 'public_html_registry' });
    expect(result.results[0]).toMatchObject({ registrationNumber: '1100', identificationCode: '224624262' });
  });

  it('stores bounded verification evidence, fills blank identity fields, and preserves mismatches', () => {
    const entry = parseWineAgencyRegistryHtml(fixture, '2026-07-20T00:00:00.000Z')[0];
    const linked = applyWineAgencyVerification(profile(), entry);
    expect(linked.profile).toMatchObject({
      wineAgencyRegistrationCode: '1100',
      identificationCode: '224624262',
      wineAgencyVerification: {
        registrationNumber: '1100',
        officialApi: false,
        transport: 'public_html_registry',
      },
    });
    expect(linked.mismatches).toEqual([]);

    const mismatched = applyWineAgencyVerification(profile({
      wineAgencyRegistrationCode: '9999',
      identificationCode: '111111111',
    }), entry);
    expect(mismatched.profile.wineAgencyRegistrationCode).toBe('9999');
    expect(mismatched.profile.identificationCode).toBe('111111111');
    expect(mismatched.mismatches.map(item => item.field)).toEqual(['registrationNumber', 'identificationCode']);
    expect(wineAgencyIdentityMismatches(mismatched.profile, entry)).toEqual([
      expect.objectContaining({ field: 'registrationNumber', localValue: '9999', registryValue: '1100' }),
      expect.objectContaining({ field: 'identificationCode', localValue: '111111111', registryValue: '224624262' }),
    ]);
  });

  it('marks linked evidence current, due, or conflicted using an explicitly internal re-check policy', () => {
    const entry = parseWineAgencyRegistryHtml(fixture, '2026-01-01T00:00:00.000Z')[0];
    const linked = applyWineAgencyVerification(profile(), entry).profile;

    expect(wineAgencyVerificationStatus(profile(), new Date('2026-01-02T00:00:00.000Z'))).toEqual({
      state: 'not_linked',
      policy: 'cellarflow_internal',
      recheckIntervalDays: 90,
    });
    expect(wineAgencyVerificationStatus(linked, new Date('2026-03-31T23:59:59.999Z'))).toMatchObject({
      state: 'current',
      policy: 'cellarflow_internal',
      recheckDueAt: '2026-04-01T00:00:00.000Z',
    });
    expect(wineAgencyVerificationStatus(linked, new Date('2026-04-01T00:00:00.000Z'))).toMatchObject({
      state: 'recheck_due',
      recheckDueAt: '2026-04-01T00:00:00.000Z',
    });
    expect(wineAgencyVerificationStatus({
      ...linked,
      identificationCode: 'different-local-code',
    }, new Date('2027-01-01T00:00:00.000Z'))).toMatchObject({
      state: 'identity_mismatch',
    });
  });
});
