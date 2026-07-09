import { describe, expect, it } from 'vitest';
import {
  directoryRecordToCrmLead,
  directoryRecordLabel,
  importWineryDirectoryRecord,
  parseWineryDirectoryText
} from '../lib/wineryDirectoryImport';
import type { CompanyProfile } from '../lib/wineryState';

const existing: CompanyProfile = {
  companyName: 'Old Winery LLC',
  wineryName: 'Old Cellar',
  country: 'Georgia',
  region: '',
  municipality: '',
  address: '',
  contactEmail: '',
  phone: '',
  website: '',
  measurementUnits: 'metric',
  currency: 'GEL'
};

describe('winery directory import helper', () => {
  it('parses quoted CSV rows and maps known directory headers', () => {
    const csv = [
      'Company,Winery,Identification Code,Wine Agency Code,Region,Municipality,Address,Email,Phone',
      '"Telavi Wine LLC","Marani Telavi",405001122,WA-778,Kacheti,Telavi,"Kondoli, Main Road",info@example.ge,+995555000111'
    ].join('\n');

    const result = parseWineryDirectoryText(csv);

    expect(result.warnings).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      companyName: 'Telavi Wine LLC',
      wineryName: 'Marani Telavi',
      identificationCode: '405001122',
      wineAgencyRegistrationCode: 'WA-778',
      region: 'Kakheti',
      municipality: 'Telavi',
      address: 'Kondoli, Main Road',
      contactEmail: 'info@example.ge'
    });
    expect(directoryRecordLabel(result.records[0])).toContain('Marani Telavi');
  });

  it('imports a selected directory row into a company profile with change tracking', () => {
    const [record] = parseWineryDirectoryText([
      'Producer,Brand,Registration Code,Region,District,Certificate Contact,Certificate Phone,Certificate Email',
      'Mukuzani Estate LLC,Mukuzani Estate,AG-1001,Mukuzani,Gurjaani,Nino,+995322000000,cert@example.ge'
    ].join('\n')).records;

    const result = importWineryDirectoryRecord(record, existing);

    expect(result.profile.companyName).toBe('Mukuzani Estate LLC');
    expect(result.profile.wineryName).toBe('Mukuzani Estate');
    expect(result.profile.wineAgencyRegistrationCode).toBe('AG-1001');
    expect(result.profile.region).toBe('Kakheti');
    expect(result.profile.municipality).toBe('Gurjaani');
    expect(result.profile.certificateContactPerson).toBe('Nino');
    expect(result.profile.certificateEmail).toBe('cert@example.ge');
    expect(result.changes.map(change => change.field)).toEqual(expect.arrayContaining([
      'companyName',
      'wineryName',
      'wineAgencyRegistrationCode',
      'region'
    ]));
  });

  it('can fill blanks without overwriting existing profile fields', () => {
    const [record] = parseWineryDirectoryText([
      'Company,Winery,Region,Phone',
      'New Name,New Winery,Kakheti,+995000'
    ].join('\n')).records;

    const result = importWineryDirectoryRecord(record, existing, { overwrite: false });

    expect(result.profile.companyName).toBe('Old Winery LLC');
    expect(result.profile.wineryName).toBe('Old Cellar');
    expect(result.profile.region).toBe('Kakheti');
    expect(result.profile.phone).toBe('+995000');
  });

  it('warns on unknown regions and missing official codes', () => {
    const [record] = parseWineryDirectoryText([
      'Company,Region',
      'Mystery Estate,Atlantis'
    ].join('\n')).records;

    const result = importWineryDirectoryRecord(record, existing);

    expect(result.profile.region).toBe('Atlantis');
    expect(result.warnings.join(' ')).toContain('Unknown Georgian wine region');
    expect(result.warnings.join(' ')).toContain('no identification');
  });

  it('converts a parsed directory row into a CRM lead summary', () => {
    const [record] = parseWineryDirectoryText([
      'Company,Winery,Identification Code,Wine Agency Code,Region,Municipality,Email,Phone,Website,Contact Person',
      'Telavi Wine LLC,Marani Telavi,405001122,WA-778,Kakheti,Telavi,info@example.ge,+995555000111,https://example.ge,Nino'
    ].join('\n')).records;

    const lead = directoryRecordToCrmLead(record, 'manual_directory_import');

    expect(lead).toMatchObject({
      id: 'lead-wa-778',
      companyName: 'Telavi Wine LLC',
      wineryName: 'Marani Telavi',
      region: 'Kakheti',
      municipality: 'Telavi',
      contactEmail: 'info@example.ge',
      phone: '+995555000111',
      source: 'manual_directory_import'
    });
    expect(lead.tags).toEqual(expect.arrayContaining(['winery', 'Kakheti', 'wine-agency-registered', 'has-id-code']));
    expect(lead.notes).toContain('Wine Agency registration: WA-778');
  });
});
