import React, { type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import QvevriPassportTab from '../components/QvevriPassportTab';
import type {
  CellarOperation,
  CertificationRecord,
  DailyFermLog,
  Vessel,
  WineLot,
} from '../lib/wineryState';

const vessel: Vessel = {
  id: 'Q-7',
  type: 'qvevri',
  shape: 'vertical',
  capacity: 1_200,
  currentVolume: 900,
  assignedLotId: 'LOT-Q-7',
  cleaningStatus: 'clean',
  lastCleaned: '2026-07-02',
  temperature: 18,
  coolingJacketActive: false,
  targetTemperature: null,
  lastOperation: 'Morning punchdown',
  locationDetails: 'West Marani',
  qvevriNumber: 'Qvevri 7',
  maraniLocation: 'West Marani',
  buried: true,
  lastWashingDate: '2026-07-02',
  limeWashStatus: 'done',
  waxingStatus: 'done',
  inspectionNotes: 'Clay surface intact.',
  fillingDate: '2026-07-03',
  grapeVariety: 'Rkatsiteli',
  chachaPercentage: 18,
  stemInclusion: false,
  mixingFrequency: 'Twice daily',
  sealingDate: '2026-07-10',
  lastSealedDate: '2026-07-10',
  openingDate: '2026-11-10',
  skinContactDurationDays: 120,
  firstRackingDate: '2026-11-15',
  soilTemperature: 16.4,
  dailyMixingLog: [{
    date: '2026-07-10',
    action: 'Morning punchdown',
    operator: 'Nino',
    notes: 'Cap fully wetted.',
  }],
  sanitationHistory: [{
    date: '2026-07-02',
    action: 'Washed and waxed',
    operator: 'Giorgi',
    notes: 'Ready for filling.',
  }],
};

const lot: WineLot = {
  id: 'LOT-Q-7',
  name: 'Rkatsiteli Qvevri',
  vintage: 2026,
  variety: 'Rkatsiteli',
  vineyardBlock: 'Block R1',
  region: 'Kakheti',
  initialVolume: 1_000,
  currentVolume: 900,
  wineClass: 'amber',
  stage: 'maceration',
  createdAt: '2026-07-03',
  history: [],
};

const fermentationLog: DailyFermLog = {
  id: 'ferm-q7',
  tankId: 'Q-7',
  lotId: 'LOT-Q-7',
  date: '2026-07-10',
  temperature: 22,
  density: 1.04,
  sugar: 90,
  ph: 3.4,
  tastingNotes: 'Clean fermentation',
  capManagement: 'Punchdown',
  additives: '',
};

const sanitationOperation: CellarOperation = {
  id: 'op-clean-q7',
  date: '2026-07-02T09:00:00.000Z',
  type: 'cleaning',
  lotId: 'LOT-Q-7',
  lotName: 'Rkatsiteli Qvevri',
  vesselId: 'Q-7',
  operator: 'Giorgi',
  notes: 'Final rinse complete.',
};

const certification: CertificationRecord = {
  id: 'CERT-Q-7',
  lotId: 'LOT-Q-7',
  productType: 'wine',
  samplePrepared: true,
  labProtocolUploaded: true,
  applicationStatus: 'submitted',
};

function passportProps(
  overrides: Partial<ComponentProps<typeof QvevriPassportTab>> = {},
): ComponentProps<typeof QvevriPassportTab> {
  return {
    lang: 'en',
    vessels: [vessel],
    lots: [lot],
    fermentationLogs: [fermentationLog],
    cellarOps: [sanitationOperation],
    certificationRecords: [certification],
    onUpdateVessels: vi.fn(),
    setActiveTab: vi.fn(),
    setSelectedTankId: vi.fn(),
    setToastMessage: vi.fn(),
    currentUserName: 'QA User',
    ...overrides,
  };
}

function renderPassport(overrides: Partial<ComponentProps<typeof QvevriPassportTab>> = {}): string {
  return renderToStaticMarkup(React.createElement(QvevriPassportTab, passportProps(overrides)));
}

describe('QvevriPassportTab permissions', () => {
  it('locks passport fields and hides mutation forms while preserving review data', () => {
    const markup = renderPassport({ canUpdateVessel: false });

    expect(markup).toContain('Read-only qvevri passport.');
    expect(markup).toContain('Qvevri 7');
    expect(markup).toContain('West Marani');
    expect(markup).toContain('Rkatsiteli Qvevri');
    expect(markup).toContain('CERT-Q-7');
    expect(markup).toContain('Morning punchdown');
    expect(markup).toContain('Washed and waxed');
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup).not.toContain('>Save</button>');
    expect(markup).not.toContain('>Add mixing</button>');
    expect(markup).not.toContain('>Add sanitation</button>');
    expect(markup).toContain('>Vessel</button>');
  });

  it('retains all existing update actions by default', () => {
    const markup = renderPassport();

    expect(markup).toContain('>Save</button>');
    expect(markup).toContain('>Add mixing</button>');
    expect(markup).toContain('>Add sanitation</button>');
    expect(markup).not.toContain('<fieldset disabled=""');
    expect(markup).not.toContain('Read-only qvevri passport.');
  });

  it('localizes read-only guidance in Georgian', () => {
    const markup = renderPassport({ lang: 'ka', canUpdateVessel: false });

    expect(markup).toContain('ქვევრის პასპორტი მხოლოდ სანახავია.');
    expect(markup).toContain('შეგიძლიათ ნახოთ იდენტიფიკაცია, მზადყოფნა');
    expect(markup).not.toContain('Read-only qvevri passport.');
    expect(markup).not.toContain('>შენახვა</button>');
  });
});
