import type { UserDataState } from './db';

type WineClass = 'white' | 'red' | 'rose' | 'amber' | 'qvevri' | 'sparkling' | 'fortified' | 'base_wine';
type WinemakingStage = 'crushing' | 'fermenting' | 'maceration' | 'pressing' | 'aging' | 'stabilization' | 'filtration' | 'bottled' | 'sold';

interface LotSpec {
  id: string;
  name: string;
  variety: string;
  wineClass: WineClass;
  vintage: number;
  blockId: string;
  vesselId: string | null;
  intakeVesselId: string;
  stage: WinemakingStage;
  intakeDate: string;
  harvestKg: number;
  initialVolume: number;
  currentVolume: number;
  brix: number;
  ph: number;
  ta: number;
  tempC: number;
  costPerKg: number;
  freeSo2: number;
  totalSo2: number;
  volatileAcid: number;
  alcoholPct: number;
  sensory: {
    tannins: number;
    acidity: number;
    body: number;
    aromatics: number;
    wood: number;
    fruit: number;
  };
}

const OPERATOR = 'ლუკა თათრიშვილი';
const LAB_TECH = 'ნინო მაისურაძე';
const WINERY_NAME = 'კვარლის მარანი';
const REGION = 'კახეთი, ყვარელი';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lotHistory(spec: LotSpec) {
  const vesselText = spec.vesselId || spec.intakeVesselId;
  const entries = [
    {
      date: spec.intakeDate,
      type: 'ყურძნის მიღება',
      description: `${spec.harvestKg.toLocaleString('ka-GE')} კგ ${spec.variety} მიღებულია ${REGION}-დან; შაქრიანობა ${spec.brix}°Bx, pH ${spec.ph}, საერთო მჟავიანობა ${spec.ta} გ/ლ.`,
      operator: OPERATOR,
    },
    {
      date: addDays(spec.intakeDate, 1),
      type: 'დუღილის დაწყება',
      description: `პარტია ჩაიტვირთა ჭურჭელში ${spec.intakeVesselId}. ტემპერატურა გაკონტროლებულია და დაიწყო ყოველდღიური სიმკვრივის აღრიცხვა.`,
      operator: OPERATOR,
    },
    {
      date: addDays(spec.intakeDate, 6),
      type: 'ლაბორატორიული კონტროლი',
      description: `ჩატარდა pH, SO2, აქროლადი მჟავიანობისა და ნარჩენი შაქრის შემოწმება. ყველა მაჩვენებელი მიბმულია პარტიის კოდზე ${spec.id}.`,
      operator: LAB_TECH,
    },
    {
      date: addDays(spec.intakeDate, 18),
      type: 'ტექნოლოგიური ოპერაცია',
      description: `ღვინო გადაყვანილია ეტაპზე: ${spec.stage}. აქტუალური ჭურჭელი: ${vesselText}.`,
      operator: OPERATOR,
    },
  ];

  if (spec.stage === 'bottled') {
    entries.unshift({
      date: addDays(spec.intakeDate, 150),
      type: 'ჩამოსხმა და საწყობში მიღება',
      description: `${spec.name} ჩამოისხა, მიენიჭა ბოთლების პარტიის ნომერი და განთავსდა მზა პროდუქციის საწყობში.`,
      operator: OPERATOR,
    });
  }

  return entries;
}

function makeFermLogs(spec: LotSpec) {
  return Array.from({ length: 10 }, (_, i) => {
    const sugar = Math.max(1.2, spec.brix - i * (spec.brix / 9));
    const temp = spec.tempC + Math.sin((i / 9) * Math.PI) * 5.5;
    return {
      id: `FL-${spec.id}-${String(i + 1).padStart(2, '0')}`,
      tankId: spec.intakeVesselId,
      lotId: spec.id,
      date: addDays(spec.intakeDate, i + 1),
      temperature: round(temp, 1),
      density: round(0.990 + sugar * 0.004, 4),
      sugar: round(sugar, 1),
      ph: spec.ph,
      tastingNotes: i < 3
        ? 'ინტენსიური არომატიკა და სუფთა დუღილის ტონი'
        : i < 7
          ? 'დუღილი სტაბილურია, ტემპერატურა კონტროლშია'
          : 'დუღილის დასრულებისკენ, ნარჩენი შაქარი მცირდება',
      capManagement: spec.wineClass === 'red'
        ? (i % 2 === 0 ? 'ქუდის ჩაძირვა დღეში ორჯერ' : 'ნაზი გადატუმბვა 15 წუთი')
        : spec.wineClass === 'amber'
          ? 'ჭაჭაზე დაყოვნება ქვევრში'
          : 'დალექვა და სუფთა ფრაქციის კონტროლი',
      additives: i === 1 ? 'საფუარის საკვები DAP 0.2 გ/ლ' : i === 4 ? 'SO2 კორექცია მცირე დოზით' : '',
    };
  });
}

function makeLabLogs(spec: LotSpec) {
  return [
    {
      id: `LAB-${spec.id}-01`,
      lotId: spec.id,
      tankId: spec.intakeVesselId,
      date: addDays(spec.intakeDate, 2),
      alcoholPct: 0,
      volatileAcid: 0.18,
      freeSo2: 0,
      totalSo2: 0,
      residualSugar: round(spec.brix * 10, 1),
      ph: spec.ph,
      malicAcid: spec.wineClass === 'red' ? 2.1 : 2.8,
      lacticAcid: 0.1,
      turbidity: 180,
      technician: LAB_TECH,
      titratableAcidity: spec.ta,
    },
    {
      id: `LAB-${spec.id}-02`,
      lotId: spec.id,
      tankId: spec.vesselId || spec.intakeVesselId,
      date: addDays(spec.intakeDate, 24),
      alcoholPct: spec.alcoholPct,
      volatileAcid: spec.volatileAcid,
      freeSo2: spec.freeSo2,
      totalSo2: spec.totalSo2,
      residualSugar: spec.stage === 'bottled' ? 2.4 : spec.stage === 'fermenting' ? 12.5 : 3.6,
      ph: spec.ph,
      malicAcid: spec.wineClass === 'red' ? 0.35 : 1.1,
      lacticAcid: spec.wineClass === 'red' ? 1.4 : 0.3,
      turbidity: spec.stage === 'bottled' ? 0.8 : 12,
      technician: LAB_TECH,
      titratableAcidity: spec.ta,
    },
  ];
}

const blocks = [
  {
    id: 'B-01',
    name: 'ყვარლის საფერავი - ძველი ნაკვეთი',
    vineyardName: WINERY_NAME,
    locationName: 'ყვარელი, კახეთი',
    cadastralCode: '57.06.51.001',
    officialCadastreDocumentName: 'cadastre-B-01.pdf',
    landOwner: WINERY_NAME,
    grower: WINERY_NAME,
    municipality: 'Kvareli',
    community: 'Kvareli',
    village: 'Kvareli',
    microzone: 'Kvareli',
    parcelName: 'Old Saperavi',
    parcelArea: 2.5,
    latitude: 41.9542,
    longitude: 45.8152,
    area: 2.5,
    elevation: 420,
    slope: 'მსუბუქი დახრა',
    aspect: 'სამხრეთ-აღმოსავლეთი',
    soilType: 'კირქვიანი თიხნარი',
    grapeVariety: 'Saperavi / საფერავი',
    clone: 'ადგილობრივი კლონი',
    rootstock: 'R110',
    plantingYear: 1998,
    spacing: '2.5m x 1.2m',
    rowsCount: 82,
    vinesCount: 8100,
    trainingSystem: 'ორმაგი გუიო',
    pruningSystem: 'ქართული მოკლე სხვლა',
    irrigationEnabled: false,
    farmingStatus: 'organic',
    currentPhenology: 'მოსავლის შემდგომი დასვენება',
    estimatedHarvestDate: '2024-09-18',
    vineyardCondition: 'productive old vines',
    notes: 'საფერავის ძირითადი ნაკვეთი მდინარე ალაზნის მარჯვენა მხარეს.',
  },
  {
    id: 'B-02',
    name: 'ქინძმარაულის რქაწითელი',
    vineyardName: WINERY_NAME,
    locationName: 'ქინძმარაულის მიკროზონა, ყვარელი',
    cadastralCode: '57.06.52.014',
    officialCadastreDocumentName: 'cadastre-B-02.pdf',
    landOwner: WINERY_NAME,
    grower: WINERY_NAME,
    municipality: 'Kvareli',
    community: 'Kindzmarauli',
    village: 'Kindzmarauli',
    microzone: 'Kindzmarauli',
    parcelName: 'Rkatsiteli Terrace',
    parcelArea: 3.2,
    latitude: 41.9568,
    longitude: 45.8221,
    area: 3.2,
    elevation: 390,
    slope: 'ბრტყელი',
    aspect: 'სამხრეთი',
    soilType: 'ალუვიური თიხნარი',
    grapeVariety: 'Rkatsiteli / რქაწითელი',
    clone: 'კახური შერჩევა',
    rootstock: 'SO4',
    plantingYear: 2005,
    spacing: '2.4m x 1.1m',
    rowsCount: 95,
    vinesCount: 10500,
    trainingSystem: 'ვერტიკალური შპალერი',
    pruningSystem: 'გუიო',
    irrigationEnabled: true,
    farmingStatus: 'conventional',
    currentPhenology: 'დასვენება',
    estimatedHarvestDate: '2023-09-26',
    vineyardCondition: 'productive',
    notes: 'ქვევრის ქარვისფერი ღვინოებისთვის განკუთვნილი მაღალი მჟავიანობის ნაკვეთი.',
  },
  {
    id: 'B-03',
    name: 'კახური მწვანე - მთისპირი',
    vineyardName: WINERY_NAME,
    locationName: 'ყვარლის მთისპირეთი',
    cadastralCode: '57.06.53.009',
    officialCadastreDocumentName: 'cadastre-B-03.pdf',
    landOwner: WINERY_NAME,
    grower: WINERY_NAME,
    municipality: 'Kvareli',
    community: 'Kvareli',
    village: 'Kvareli',
    microzone: 'Kvareli',
    parcelName: 'Mtsvane Hillside',
    parcelArea: 1.5,
    latitude: 41.9641,
    longitude: 45.8075,
    area: 1.5,
    elevation: 510,
    slope: 'საშუალო დახრა',
    aspect: 'აღმოსავლეთი',
    soilType: 'ქვიანი კარბონატული ნიადაგი',
    grapeVariety: 'Mtsvane / მწვანე კახური',
    clone: 'ადგილობრივი',
    rootstock: '41B',
    plantingYear: 2018,
    spacing: '2.3m x 1.0m',
    rowsCount: 48,
    vinesCount: 5000,
    trainingSystem: 'გუიო',
    pruningSystem: 'საშუალო სხვლა',
    irrigationEnabled: true,
    farmingStatus: 'organic',
    currentPhenology: 'დასვენება',
    estimatedHarvestDate: '2024-09-21',
    vineyardCondition: 'young productive vines',
    notes: 'გრილი ექსპოზიცია ციტრუსოვანი არომატიკის შესანარჩუნებლად.',
  },
  {
    id: 'B-04',
    name: 'კისი - გავაზის გზა',
    vineyardName: WINERY_NAME,
    locationName: 'ყვარელი, გავაზის გზა',
    cadastralCode: '57.06.54.022',
    officialCadastreDocumentName: 'cadastre-B-04.pdf',
    landOwner: WINERY_NAME,
    grower: WINERY_NAME,
    municipality: 'Kvareli',
    community: 'Gavazi',
    village: 'Gavazi',
    microzone: 'Kvareli',
    parcelName: 'Kisi Road',
    parcelArea: 1.1,
    latitude: 41.9489,
    longitude: 45.8312,
    area: 1.1,
    elevation: 405,
    slope: 'მსუბუქი დახრა',
    aspect: 'სამხრეთი',
    soilType: 'თიხა-კირქვა',
    grapeVariety: 'Kisi / კისი',
    plantingYear: 2012,
    spacing: '2.4m x 1.1m',
    rowsCount: 35,
    vinesCount: 3600,
    trainingSystem: 'ვერტიკალური შპალერი',
    pruningSystem: 'გუიო',
    irrigationEnabled: false,
    farmingStatus: 'organic',
    currentPhenology: 'დასვენება',
    estimatedHarvestDate: '2023-09-29',
    vineyardCondition: 'productive',
    notes: 'ქვევრისთვის შერჩეული არომატული კისი.',
  },
  {
    id: 'B-05',
    name: 'ყვარლის ექსპერიმენტული ნაკვეთი',
    vineyardName: WINERY_NAME,
    locationName: 'ყვარელი, საცდელი ტერასა',
    cadastralCode: '57.06.55.018',
    officialCadastreDocumentName: 'cadastre-B-05.pdf',
    landOwner: WINERY_NAME,
    grower: WINERY_NAME,
    municipality: 'Kvareli',
    community: 'Kvareli',
    village: 'Kvareli',
    microzone: 'Kvareli',
    parcelName: 'Experimental Terrace',
    parcelArea: 1.8,
    latitude: 41.951,
    longitude: 45.812,
    area: 1.8,
    elevation: 450,
    slope: 'ტერასული',
    aspect: 'სამხრეთ-დასავლეთი',
    soilType: 'წითელი თიხნარი',
    grapeVariety: 'Aleksandrouli / Khikhvi / Usakhelouri',
    plantingYear: 2016,
    spacing: '2.2m x 1.0m',
    rowsCount: 54,
    vinesCount: 5900,
    trainingSystem: 'გუიო',
    pruningSystem: 'საშუალო სხვლა',
    irrigationEnabled: true,
    farmingStatus: 'conventional',
    currentPhenology: 'დასვენება',
    estimatedHarvestDate: '2024-10-02',
    vineyardCondition: 'experimental mixed plantings',
    notes: 'მცირე პარტიების საცდელი ვენახი დემო ანგარიშისთვის.',
  },
  {
    id: 'B-06',
    name: 'მუკუზანის რეზერვის საფერავი',
    vineyardName: WINERY_NAME,
    locationName: 'ყვარლის სამხრეთი ფერდობი',
    cadastralCode: '51.01.41.006',
    officialCadastreDocumentName: 'cadastre-B-06.pdf',
    landOwner: WINERY_NAME,
    grower: WINERY_NAME,
    municipality: 'Gurjaani',
    community: 'Mukuzani',
    village: 'Mukuzani',
    microzone: 'Mukuzani',
    parcelName: 'Mukuzani Reserve',
    parcelArea: 0.9,
    latitude: 41.9394,
    longitude: 45.7992,
    area: 0.9,
    elevation: 435,
    slope: 'საშუალო დახრა',
    aspect: 'სამხრეთი',
    soilType: 'კარბონატული თიხა',
    grapeVariety: 'Saperavi / საფერავი',
    plantingYear: 2001,
    spacing: '2.5m x 1.2m',
    rowsCount: 30,
    vinesCount: 2900,
    trainingSystem: 'ორმაგი გუიო',
    pruningSystem: 'რეზერვის მოკლე სხვლა',
    irrigationEnabled: false,
    farmingStatus: 'organic',
    currentPhenology: 'დასვენება',
    estimatedHarvestDate: '2023-09-21',
    vineyardCondition: 'low-yield reserve vines',
    notes: 'მაღალი ფენოლური სიმწიფის მცირე რეზერვი.',
  },
];

const lotSpecs: LotSpec[] = [
  { id: 'SAP-24', name: 'საფერავი ყვარელი 2024', variety: 'Saperavi / საფერავი', wineClass: 'red', vintage: 2024, blockId: 'B-01', vesselId: 'T-101', intakeVesselId: 'T-101', stage: 'fermenting', intakeDate: '2024-09-18', harvestKg: 8500, initialVolume: 5950, currentVolume: 5000, brix: 23.5, ph: 3.58, ta: 6.2, tempC: 18, costPerKg: 1.5, freeSo2: 22, totalSo2: 65, volatileAcid: 0.42, alcoholPct: 13.5, sensory: { tannins: 8, acidity: 6, body: 8, aromatics: 7, wood: 1, fruit: 9 } },
  { id: 'RK-23', name: 'რქაწითელი ქვევრი 2023', variety: 'Rkatsiteli / რქაწითელი', wineClass: 'amber', vintage: 2023, blockId: 'B-02', vesselId: null, intakeVesselId: 'Q-01', stage: 'bottled', intakeDate: '2023-09-26', harvestKg: 3200, initialVolume: 2176, currentVolume: 0, brix: 22.8, ph: 3.42, ta: 5.8, tempC: 17, costPerKg: 1.2, freeSo2: 18, totalSo2: 50, volatileAcid: 0.38, alcoholPct: 12.8, sensory: { tannins: 5, acidity: 7, body: 6, aromatics: 8, wood: 0, fruit: 6 } },
  { id: 'MTS-24', name: 'მწვანე კახური 2024', variety: 'Mtsvane / მწვანე კახური', wineClass: 'white', vintage: 2024, blockId: 'B-03', vesselId: 'T-102', intakeVesselId: 'T-102', stage: 'stabilization', intakeDate: '2024-09-21', harvestKg: 4400, initialVolume: 3080, currentVolume: 3000, brix: 21.6, ph: 3.25, ta: 6.5, tempC: 15, costPerKg: 1.1, freeSo2: 25, totalSo2: 80, volatileAcid: 0.28, alcoholPct: 12.2, sensory: { tannins: 2, acidity: 8, body: 5, aromatics: 8, wood: 0, fruit: 7 } },
  { id: 'KIS-23', name: 'კისი ქვევრი 2023', variety: 'Kisi / კისი', wineClass: 'amber', vintage: 2023, blockId: 'B-04', vesselId: 'Q-02', intakeVesselId: 'Q-02', stage: 'aging', intakeDate: '2023-09-29', harvestKg: 1850, initialVolume: 1258, currentVolume: 1200, brix: 22.1, ph: 3.38, ta: 6.0, tempC: 16, costPerKg: 1.4, freeSo2: 20, totalSo2: 55, volatileAcid: 0.35, alcoholPct: 13.0, sensory: { tannins: 4, acidity: 7, body: 6, aromatics: 9, wood: 0, fruit: 7 } },
  { id: 'AL-24', name: 'ალექსანდროული 2024', variety: 'Aleksandrouli / ალექსანდროული', wineClass: 'red', vintage: 2024, blockId: 'B-05', vesselId: 'T-103', intakeVesselId: 'T-103', stage: 'fermenting', intakeDate: '2024-10-02', harvestKg: 3000, initialVolume: 2100, currentVolume: 2000, brix: 22.8, ph: 3.45, ta: 5.9, tempC: 17, costPerKg: 1.7, freeSo2: 15, totalSo2: 45, volatileAcid: 0.3, alcoholPct: 11.5, sensory: { tannins: 4, acidity: 6, body: 5, aromatics: 8, wood: 0, fruit: 8 } },
  { id: 'KH-24', name: 'ხიხვი ქვევრი 2024', variety: 'Khikhvi / ხიხვი', wineClass: 'amber', vintage: 2024, blockId: 'B-05', vesselId: 'Q-03', intakeVesselId: 'Q-03', stage: 'fermenting', intakeDate: '2024-10-05', harvestKg: 1500, initialVolume: 1020, currentVolume: 1000, brix: 22, ph: 3.32, ta: 6.1, tempC: 16, costPerKg: 1.6, freeSo2: 18, totalSo2: 48, volatileAcid: 0.33, alcoholPct: 12.5, sensory: { tannins: 4, acidity: 7, body: 6, aromatics: 8, wood: 0, fruit: 7 } },
  { id: 'MUK-23', name: 'მუკუზანი რეზერვი 2023', variety: 'Saperavi / საფერავი', wineClass: 'red', vintage: 2023, blockId: 'B-06', vesselId: 'B-01', intakeVesselId: 'T-104', stage: 'aging', intakeDate: '2023-09-21', harvestKg: 1800, initialVolume: 1260, currentVolume: 225, brix: 24.2, ph: 3.62, ta: 6.0, tempC: 18, costPerKg: 1.8, freeSo2: 24, totalSo2: 70, volatileAcid: 0.52, alcoholPct: 14.2, sensory: { tannins: 9, acidity: 6, body: 9, aromatics: 8, wood: 7, fruit: 8 } },
  { id: 'TS-23', name: 'წინანდალი კლასიკური 2023', variety: 'Rkatsiteli / Mtsvane', wineClass: 'white', vintage: 2023, blockId: 'B-02', vesselId: null, intakeVesselId: 'B-02', stage: 'bottled', intakeDate: '2023-09-30', harvestKg: 700, initialVolume: 490, currentVolume: 0, brix: 21.4, ph: 3.28, ta: 6.3, tempC: 15, costPerKg: 1.2, freeSo2: 26, totalSo2: 85, volatileAcid: 0.32, alcoholPct: 12.5, sensory: { tannins: 1, acidity: 8, body: 5, aromatics: 7, wood: 2, fruit: 7 } },
  { id: 'OJ-24', name: 'ოჯალეში 2024', variety: 'Ojaleshi / ოჯალეში', wineClass: 'red', vintage: 2024, blockId: 'B-05', vesselId: 'B-03', intakeVesselId: 'B-03', stage: 'aging', intakeDate: '2024-10-08', harvestKg: 720, initialVolume: 504, currentVolume: 225, brix: 23, ph: 3.5, ta: 6.1, tempC: 17, costPerKg: 1.9, freeSo2: 20, totalSo2: 60, volatileAcid: 0.38, alcoholPct: 13.0, sensory: { tannins: 6, acidity: 6, body: 6, aromatics: 8, wood: 3, fruit: 8 } },
  { id: 'US-24', name: 'უსახელოური ქვევრი 2024', variety: 'Usakhelouri / უსახელოური', wineClass: 'red', vintage: 2024, blockId: 'B-05', vesselId: 'Q-04', intakeVesselId: 'Q-04', stage: 'fermenting', intakeDate: '2024-10-06', harvestKg: 1450, initialVolume: 1015, currentVolume: 1000, brix: 24, ph: 3.48, ta: 5.7, tempC: 16, costPerKg: 2.2, freeSo2: 12, totalSo2: 38, volatileAcid: 0.28, alcoholPct: 11.0, sensory: { tannins: 5, acidity: 6, body: 6, aromatics: 9, wood: 0, fruit: 9 } },
];

export function getSeederData(orgId: string): UserDataState {
  const now = new Date().toISOString();
  const withSyncStamp = <T extends Record<string, any>>(items: T[]): T[] => (
    items.map(item => ({ ...item, lastModified: item.lastModified || now }))
  );
  void orgId;

  const lots = lotSpecs.map(spec => ({
    id: spec.id,
    name: spec.name,
    vintage: spec.vintage,
    variety: spec.variety,
    vineyardBlock: blocks.find(block => block.id === spec.blockId)?.name || '',
    region: REGION,
    initialVolume: spec.initialVolume,
    currentVolume: spec.currentVolume,
    wineClass: spec.wineClass,
    stage: spec.stage,
    createdAt: spec.intakeDate,
    intendedAppellation: blocks.find(block => block.id === spec.blockId)?.microzone,
    classification: ['SAP-24', 'MUK-23'].includes(spec.id) ? 'PDO' : 'table_wine',
    originProofStatus: 'verified',
    marketStatus: 'unknown',
    history: lotHistory(spec),
    sensoryProfile: spec.sensory,
    ph: spec.ph,
    ta: spec.ta,
    abv: spec.alcoholPct,
    so2Free: spec.freeSo2,
    so2Total: spec.totalSo2,
    volatileAcidity: spec.volatileAcid,
    notes: `${REGION}-ში წარმოებული დემო პარტია სრული მიკვლევადობით.`,
  }));

  const vessels = [
    {
      id: 'Q-01', type: 'qvevri', shape: 'vertical', capacity: 2500, currentVolume: 0, assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2024-03-20', temperature: 14.5, coolingJacketActive: false, targetTemperature: null, lastOperation: 'რქაწითელი ჩამოისხა და ქვევრი გაიწმინდა', locationDetails: 'ქვევრის დარბაზი - რიგი 1', lastSealedDate: '2023-10-12', soilTemperature: 14.2,
      qvevriNumber: 'Q-01', maraniLocation: 'Qvevri hall - row 1, nest 1', buried: true, lastWashingDate: '2024-03-20', limeWashStatus: 'done', waxingStatus: 'done', inspectionNotes: 'Empty and clean after 2023 amber Rkatsiteli. Neck rim intact; ready for next fill.', fillingDate: '2023-09-26', grapeVariety: 'Rkatsiteli / რქაწითელი', chachaPercentage: 18, stemInclusion: true, mixingFrequency: 'Twice daily during active fermentation, then once daily until seal', dailyMixingLog: [
        { date: '2023-09-27', action: 'Punchdown and cap wetting', operator: 'Nino', notes: 'Healthy cap, no volatile aroma.' },
        { date: '2023-10-03', action: 'Final open-top mixing', operator: 'Giorgi', notes: 'Prepared for clay seal.' },
      ], sealingDate: '2023-10-12', openingDate: '2024-03-18', skinContactDurationDays: 174, firstRackingDate: '2024-03-19', sanitationHistory: [
        { date: '2024-03-20', action: 'Hot wash and brush', operator: 'Giorgi', notes: 'Lees removed, dried with air flow.' },
        { date: '2024-03-21', action: 'Lime wash', operator: 'Nino', notes: 'Interior surface refreshed.' },
      ],
    },
    {
      id: 'Q-02', type: 'qvevri', shape: 'vertical', capacity: 1400, currentVolume: 1200, assignedLotId: 'KIS-23', cleaningStatus: 'clean', lastCleaned: '2023-09-24', temperature: 15, coolingJacketActive: false, targetTemperature: null, lastOperation: 'კისი დაყოვნებულია ქვევრში', locationDetails: 'ქვევრის დარბაზი - რიგი 1', lastSealedDate: '2023-10-14', soilTemperature: 14.8,
      qvevriNumber: 'Q-02', maraniLocation: 'Qvevri hall - row 1, nest 2', buried: true, lastWashingDate: '2023-09-24', limeWashStatus: 'done', waxingStatus: 'done', inspectionNotes: 'Wax seal checked before filling. No seepage; stable soil temperature.', fillingDate: '2023-09-29', grapeVariety: 'Kisi / კისი', chachaPercentage: 22, stemInclusion: false, mixingFrequency: 'Daily until seal, twice weekly during long skin contact', dailyMixingLog: [
        { date: '2023-09-30', action: 'Cap wetting', operator: 'Nino', notes: 'Aromatic and clean.' },
        { date: '2023-10-07', action: 'Gentle stirring', operator: 'Giorgi', notes: 'Fermentation slowing; skins still submerged.' },
      ], sealingDate: '2023-10-14', openingDate: '2024-04-18', skinContactDurationDays: 202, firstRackingDate: '2024-04-19', sanitationHistory: [
        { date: '2023-09-24', action: 'Pre-fill wash', operator: 'Giorgi', notes: 'Steam rinse and drain.' },
        { date: '2023-09-25', action: 'Wax inspection', operator: 'Nino', notes: 'Waxing intact.' },
      ],
    },
    {
      id: 'Q-03', type: 'qvevri', shape: 'vertical', capacity: 1100, currentVolume: 1000, assignedLotId: 'KH-24', cleaningStatus: 'clean', lastCleaned: '2024-09-30', temperature: 16.2, coolingJacketActive: false, targetTemperature: null, lastOperation: 'ხიხვი აქტიურ დუღილშია', locationDetails: 'ქვევრის დარბაზი - რიგი 2', lastSealedDate: '2024-10-07', soilTemperature: 15.1,
      qvevriNumber: 'Q-03', maraniLocation: 'Qvevri hall - row 2, nest 1', buried: true, lastWashingDate: '2024-09-30', limeWashStatus: 'done', waxingStatus: 'done', inspectionNotes: 'Active 2024 Khikhvi fermentation; clay collar sealed cleanly.', fillingDate: '2024-10-05', grapeVariety: 'Khikhvi / ხიხვი', chachaPercentage: 28, stemInclusion: false, mixingFrequency: 'Twice daily through peak fermentation', dailyMixingLog: [
        { date: '2024-10-06', action: 'Morning punchdown', operator: 'Nino', notes: 'Cap warm and active.' },
        { date: '2024-10-07', action: 'Evening mixing before seal', operator: 'Giorgi', notes: 'Density drop confirmed.' },
      ], sealingDate: '2024-10-07', openingDate: '', skinContactDurationDays: undefined, firstRackingDate: '', sanitationHistory: [
        { date: '2024-09-30', action: 'Pre-harvest wash', operator: 'Giorgi', notes: 'Brush, rinse, dry.' },
      ],
    },
    {
      id: 'Q-04', type: 'qvevri', shape: 'vertical', capacity: 1100, currentVolume: 1000, assignedLotId: 'US-24', cleaningStatus: 'clean', lastCleaned: '2024-10-01', temperature: 15.8, coolingJacketActive: false, targetTemperature: null, lastOperation: 'უსახელოური ქვევრში დუღს', locationDetails: 'ქვევრის დარბაზი - რიგი 2', lastSealedDate: '2024-10-08', soilTemperature: 15,
      qvevriNumber: 'Q-04', maraniLocation: 'Qvevri hall - row 2, nest 2', buried: true, lastWashingDate: '2024-10-01', limeWashStatus: 'done', waxingStatus: 'needed', inspectionNotes: 'Usakhelouri fill is clean; waxing should be rechecked before long seal.', fillingDate: '2024-10-06', grapeVariety: 'Usakhelouri / უსახელოური', chachaPercentage: 12, stemInclusion: true, mixingFrequency: 'Morning and evening until cap settles', dailyMixingLog: [
        { date: '2024-10-07', action: 'Punchdown', operator: 'Nino', notes: 'Red fruit aroma, cap cohesive.' },
        { date: '2024-10-08', action: 'Seal-day mixing', operator: 'Giorgi', notes: 'Skins evenly distributed.' },
      ], sealingDate: '2024-10-08', openingDate: '', skinContactDurationDays: undefined, firstRackingDate: '', sanitationHistory: [
        { date: '2024-10-01', action: 'Pre-fill wash', operator: 'Giorgi', notes: 'Neck brushed; awaiting wax touch-up.' },
      ],
    },
    { id: 'T-101', type: 'stainless_steel', shape: 'vertical', capacity: 6000, currentVolume: 5000, assignedLotId: 'SAP-24', cleaningStatus: 'clean', lastCleaned: '2024-09-15', temperature: 18.5, coolingJacketActive: true, targetTemperature: 18, lastOperation: 'საფერავის გაგრილება აქტიურია', locationDetails: 'ფოლადის ავზების დარბაზი' },
    { id: 'T-102', type: 'stainless_steel', shape: 'vertical', capacity: 3500, currentVolume: 3000, assignedLotId: 'MTS-24', cleaningStatus: 'clean', lastCleaned: '2024-09-18', temperature: 14, coolingJacketActive: false, targetTemperature: 12, lastOperation: 'ცივი სტაბილიზაცია', locationDetails: 'ფოლადის ავზების დარბაზი' },
    { id: 'T-103', type: 'stainless_steel', shape: 'vertical', capacity: 2500, currentVolume: 2000, assignedLotId: 'AL-24', cleaningStatus: 'clean', lastCleaned: '2024-09-27', temperature: 17.2, coolingJacketActive: true, targetTemperature: 17, lastOperation: 'ალექსანდროული დუღილშია', locationDetails: 'ფოლადის ავზების დარბაზი' },
    { id: 'T-104', type: 'stainless_steel', shape: 'vertical', capacity: 1500, currentVolume: 0, assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2024-11-20', temperature: 15, coolingJacketActive: false, targetTemperature: null, lastOperation: 'სარეზერვო ავზი გარეცხილია', locationDetails: 'სანიტარული ზონა' },
    { id: 'T-105', type: 'stainless_steel', shape: 'vertical', capacity: 1000, currentVolume: 0, assignedLotId: null, cleaningStatus: 'dirty', lastCleaned: '2024-08-01', temperature: 15, coolingJacketActive: false, targetTemperature: null, lastOperation: 'საჭიროა გარეცხვა', locationDetails: 'სანიტარული ზონა' },
    { id: 'B-01', type: 'barrel', shape: 'horizontal', capacity: 225, currentVolume: 225, assignedLotId: 'MUK-23', cleaningStatus: 'clean', lastCleaned: '2023-11-20', temperature: 15.5, coolingJacketActive: false, targetTemperature: null, lastOperation: 'მუკუზანი მუხაში დავარგებაზეა', locationDetails: 'კასრების ოთახი' },
    { id: 'B-02', type: 'barrel', shape: 'horizontal', capacity: 225, currentVolume: 0, assignedLotId: null, cleaningStatus: 'clean', lastCleaned: '2024-04-18', temperature: 15, coolingJacketActive: false, targetTemperature: null, lastOperation: 'წინანდალი ჩამოისხა', locationDetails: 'კასრების ოთახი' },
    { id: 'B-03', type: 'barrel', shape: 'horizontal', capacity: 225, currentVolume: 225, assignedLotId: 'OJ-24', cleaningStatus: 'clean', lastCleaned: '2024-10-06', temperature: 16, coolingJacketActive: false, targetTemperature: null, lastOperation: 'ოჯალეში კასრში გადაღებულია', locationDetails: 'კასრების ოთახი' },
  ];

  const inventory = [
    { id: 'INV-YEAST', name: 'საფუარი QA23', category: 'yeasts', stock: 4.5, minThreshold: 2, unit: 'კგ', costPerUnit: 95, supplierName: 'Lallemand Georgia', details: 'თეთრი და ქარვისფერი ღვინოებისთვის, სუფთა არომატიკა.' },
    { id: 'INV-RED-YEAST', name: 'საფუარი RC212', category: 'yeasts', stock: 3.2, minThreshold: 1.5, unit: 'კგ', costPerUnit: 105, supplierName: 'Enogroup Georgia', details: 'საფერავისა და წითელი ჯიშებისთვის ფერის სტაბილიზაცია.' },
    { id: 'INV-DAP', name: 'საფუარის საკვები DAP', category: 'nutritions', stock: 12, minThreshold: 5, unit: 'კგ', costPerUnit: 8, supplierName: 'Enartis', details: 'YAN კორექცია აქტიური დუღილის დროს.' },
    { id: 'INV-KMBS', name: 'კალიუმის მეტაბისულფიტი', category: 'additives', stock: 26, minThreshold: 8, unit: 'კგ', costPerUnit: 12, supplierName: 'Enartis', details: 'SO2 კორექციისთვის.' },
    { id: 'INV-BENT', name: 'ბენტონიტი', category: 'additives', stock: 30, minThreshold: 10, unit: 'კგ', costPerUnit: 6, supplierName: 'Enartis', details: 'ცილის სტაბილიზაცია თეთრ ღვინოებში.' },
    { id: 'INV-BOTTLE-750', name: 'მინის ბოთლი 750 მლ', category: 'bottles', stock: 4200, minThreshold: 800, unit: 'ცალი', costPerUnit: 1.15, supplierName: 'Glass Georgia', details: 'ბორდოს ტიპის მუქი ბოთლი.' },
    { id: 'INV-CORK', name: 'ნატურალური საცობი 44x24', category: 'closures', stock: 3800, minThreshold: 800, unit: 'ცალი', costPerUnit: 0.42, supplierName: 'Cork Supply', details: 'ტექნიკური საცობი რეზერვისა და ქვევრის ხაზისთვის.' },
    { id: 'INV-LABEL', name: 'ეტიკეტი კვარლის ხაზი', category: 'labels', stock: 3600, minThreshold: 700, unit: 'ცალი', costPerUnit: 0.18, supplierName: 'PrintLab Tbilisi', details: 'ქართული/ინგლისური ეტიკეტი QR მიკვლევადობით.' },
    { id: 'INV-BOX', name: '6-ბოთლიანი ყუთი', category: 'boxes', stock: 700, minThreshold: 120, unit: 'ცალი', costPerUnit: 2.5, supplierName: 'Kartli Pack', details: 'ექსპორტისთვის გამაგრებული ყუთი.' },
    { id: 'INV-BARREL', name: 'ფრანგული მუხის კასრი 225 ლ', category: 'packaging', stock: 4, minThreshold: 1, unit: 'ცალი', costPerUnit: 1800, supplierName: 'Radoux', details: 'მეორე შევსება, საშუალო გამოწვა.' },
  ];

  const harvestIdFor = (spec: LotSpec, index: number) => (
    index === 0 ? 'harv_1' : index === 1 ? 'harv_2' : `HV-${spec.id}`
  );
  const samplingIdFor = (spec: LotSpec, index: number) => (
    index === 0 ? 'samp_1' : index === 1 ? 'samp_2' : `GS-${spec.id}`
  );

  const harvests = lotSpecs.map((spec, index) => ({
    id: harvestIdFor(spec, index),
    blockId: spec.blockId,
    variety: spec.variety,
    estimatedHarvestDate: spec.intakeDate,
    estimatedTons: round(spec.harvestKg / 1000, 2),
    actualHarvestDate: spec.intakeDate,
    actualHarvestedKg: spec.harvestKg,
    pickingMethod: 'hand',
    crateQuantity: Math.round(spec.harvestKg / 18),
    grapeCondition: 'excellent',
    temperatureAtHarvest: spec.tempC,
    destinationWinery: WINERY_NAME,
    sentToGvino: true,
    associatedLotId: spec.id,
    notes: `${spec.name} ხელით მოიკრიფა და იმავე დღეს შევიდა მარანში.`,
  }));

  const grapeIntakes = lotSpecs.map(spec => ({
    id: `GI-${spec.id}`,
    date: spec.intakeDate,
    time: '08:30',
    source: 'own',
    blockId: spec.blockId,
    blockName: blocks.find(block => block.id === spec.blockId)?.name || '',
    cadastralCode: blocks.find(block => block.id === spec.blockId)?.cadastralCode,
    municipality: blocks.find(block => block.id === spec.blockId)?.municipality,
    community: blocks.find(block => block.id === spec.blockId)?.community,
    village: blocks.find(block => block.id === spec.blockId)?.village,
    microzone: blocks.find(block => block.id === spec.blockId)?.microzone,
    variety: spec.variety,
    vintage: spec.vintage,
    grossWeightKg: spec.harvestKg + 180,
    tareWeightKg: 180,
    netWeightKg: spec.harvestKg,
    brix: spec.brix,
    ph: spec.ph,
    titratableAcidity: spec.ta,
    temperatureC: spec.tempC,
    condition: 'excellent',
    pickingMethod: 'hand',
    wineClass: spec.wineClass,
    juiceYieldPct: round((spec.initialVolume / spec.harvestKg) * 100, 1),
    estimatedVolumeL: spec.initialVolume,
    costPerKg: spec.costPerKg,
    totalCost: round(spec.harvestKg * spec.costPerKg, 2),
    currency: 'GEL',
    destinationVesselId: spec.intakeVesselId,
    createdLotId: spec.id,
    harvestRecordId: harvestIdFor(spec, lotSpecs.findIndex(candidate => candidate.id === spec.id)),
    operator: OPERATOR,
    notes: `${spec.name} შეიქმნა მიღების ჩანაწერიდან; createdLotId სწორად მიუთითებს პარტიაზე ${spec.id}.`,
  }));

  const samplings = lotSpecs.map((spec, index) => ({
    id: samplingIdFor(spec, index),
    blockId: spec.blockId,
    date: addDays(spec.intakeDate, -5),
    brix: round(spec.brix - 0.4, 1),
    pH: round(spec.ph - 0.03, 2),
    totalAcidityGL: round(spec.ta + 0.3, 1),
    berryWeightG: spec.wineClass === 'red' ? 1.45 : 1.65,
    phenolicMaturity: 'Optimal',
    seedColor: spec.wineClass === 'white' ? 'Yellow-brown' : 'Dark brown',
    tasteNotes: 'მწიფე კანი, სუფთა მტევანი და ჯიშური არომატი.',
    diseaseCondition: 'სუფთა',
    estimatedHarvestDate: spec.intakeDate,
    notes: `${spec.name} მოსავლის წინ შერჩევითი სინჯი.`,
  }));

  const phenologyLogs = blocks.map((block, index) => ({
    id: `PH-${block.id}`,
    blockId: block.id,
    stage: 'მოსავლის შემდგომი ფოთოლცვენა',
    date: '2024-11-05',
    gdd: 1680 + index * 22,
    confidence: 92,
    status: 'confirmed',
    notes: 'სეზონი დასრულებულია, ვაზი გადადის დასვენების ფაზაში.',
    observer: 'მარიამ ყიფიანი',
  }));

  const sprays = blocks.slice(0, 4).map((block, index) => ({
    id: `SP-${block.id}`,
    blockId: block.id,
    date: '2024-06-18',
    targetProblem: 'ჭრაქის პრევენცია',
    productName: index % 2 ? 'კუმულუსი' : 'ბორდოს ხსნარი',
    activeIngredient: index % 2 ? 'გოგირდი' : 'სპილენძი',
    dosePerHa: index % 2 ? 3 : 2.2,
    waterVolumePerHa: 600,
    totalProductUsed: round((index % 2 ? 3 : 2.2) * block.area, 1),
    totalWaterUsed: round(600 * block.area, 0),
    operator: 'გიორგი კობახიძე',
    machineryUsed: 'ვენახის მისაბმელი შემასხურებელი',
    windSpeed: 6,
    temperature: 24,
    humidity: 62,
    preHarvestIntervalDays: 30,
    reEntryIntervalHours: 24,
    notes: 'დამუშავება ჩატარდა დილით, ქარის დაბალი სიჩქარის დროს.',
  }));

  const scoutings = blocks.slice(0, 4).map(block => ({
    id: `SC-${block.id}`,
    blockId: block.id,
    date: '2024-07-12',
    locationDetails: 'შუა რიგები და ქვედა ფოთლოვანი ზონა',
    problemType: 'Powdery mildew',
    severity: 'low',
    notes: 'ფოთლების ქვედა მხარეს მსუბუქი რისკი, მტევანი ჯანმრთელია.',
    recommendedAction: 'გაგრძელდეს მონიტორინგი და საჭიროების შემთხვევაში გოგირდის მსუბუქი შეწამვლა.',
  }));

  const soilRecords = blocks.map(block => ({
    id: `SOIL-${block.id}`,
    blockId: block.id,
    date: '2024-03-12',
    pH: 7.4,
    organicMatterPct: 2.8,
    nitrogenMgKg: 38,
    phosphorusMgKg: 24,
    potassiumMgKg: 280,
    calciumMgKg: 3100,
    magnesiumMgKg: 360,
    salinityDsm: 0.42,
    notes: 'კალციუმით მდიდარი ნიადაგი, ორგანული ნივთიერება დამაკმაყოფილებელია.',
  }));

  const irrigationLogs = blocks.filter(block => block.irrigationEnabled).map(block => ({
    id: `IR-${block.id}`,
    blockId: block.id,
    date: '2024-08-05',
    durationHours: 3.5,
    waterVolumeLiters: round(block.area * 4200, 0),
    soilMoistureBeforePct: 18,
    soilMoistureAfterPct: 27,
    weatherConditions: 'მშრალი და თბილი დღე',
    notes: 'მორწყვა ჩატარდა ზომიერად, შაქრიანობის შენარჩუნებისთვის.',
  }));

  const fertilizerLogs = blocks.slice(0, 3).map(block => ({
    id: `FR-${block.id}`,
    blockId: block.id,
    date: '2024-04-08',
    productName: 'ორგანული კომპოსტი',
    dosePerHa: 1.8,
    totalAmountUsed: round(block.area * 1.8, 2),
    applicationMethod: 'რიგებში შეტანა',
    operator: 'გიორგი კობახიძე',
    notes: 'ნიადაგის სიცოცხლისუნარიანობის გასაძლიერებლად.',
  }));

  const cellarOps = lotSpecs.flatMap(spec => [
    {
      id: `OP-${spec.id}-START`,
      date: `${addDays(spec.intakeDate, 1)}T09:00:00.000Z`,
      type: 'ferment_start',
      lotId: spec.id,
      lotName: spec.name,
      vesselId: spec.intakeVesselId,
      volumeBeforeL: spec.initialVolume,
      volumeAfterL: spec.initialVolume,
      materialId: spec.wineClass === 'red' ? 'INV-RED-YEAST' : 'INV-YEAST',
      materialName: spec.wineClass === 'red' ? 'საფუარი RC212' : 'საფუარი QA23',
      dose: round(spec.initialVolume * 0.0002, 2),
      unit: 'კგ',
      operator: OPERATOR,
      notes: 'დუღილის დაწყება, ტემპერატურის და მკვებავის კონტროლით.',
    },
    {
      id: `OP-${spec.id}-SO2`,
      date: `${addDays(spec.intakeDate, 24)}T10:30:00.000Z`,
      type: 'sulfitation',
      lotId: spec.id,
      lotName: spec.name,
      vesselId: spec.vesselId || spec.intakeVesselId,
      volumeBeforeL: spec.currentVolume || spec.initialVolume,
      volumeAfterL: spec.currentVolume || spec.initialVolume,
      materialId: 'INV-KMBS',
      materialName: 'კალიუმის მეტაბისულფიტი',
      dose: round((spec.currentVolume || spec.initialVolume) * 0.00005, 2),
      unit: 'კგ',
      operator: OPERATOR,
      notes: 'თავისუფალი SO2 დაკორექტირდა ლაბორატორიული შედეგების მიხედვით.',
    },
  ]);

  const transfers = lotSpecs.flatMap((spec, index) => {
    const lotTransfers = [];
    const sourceVessel = spec.intakeVesselId;
    const destVessel = spec.vesselId || spec.intakeVesselId;

    // 1. Initial Racking (universal first transfer after fermentation / pressing)
    lotTransfers.push({
      id: `TR-${spec.id}-RACK`,
      sourceId: sourceVessel,
      destId: destVessel,
      volume: spec.initialVolume,
      loss: index % 2 === 0 ? round(spec.initialVolume * 0.005, 1) : 0,
      operator: OPERATOR,
      category: 'racking',
      date: addDays(spec.intakeDate, 15),
      pump: 'Enopump E-400',
      details: `${spec.name} - დუღილის შემდგომი გადაღება ლექიდან სუფთა ფრაქციის გამოსაყოფად და დასაწმენდად.`
    });

    // 2. Secondary Operation (e.g., topping for aging, cold stabilization, or final racking before bottling)
    if (spec.stage === 'aging') {
      lotTransfers.push({
        id: `TR-${spec.id}-TOP`,
        sourceId: destVessel,
        destId: destVessel,
        volume: spec.currentVolume,
        loss: 1.5,
        operator: OPERATOR,
        category: 'topping',
        date: addDays(spec.intakeDate, 45),
        pump: 'Gravity',
        details: `${spec.name} - კასრის/ქვევრის შევსება აორთქლების დანაკარგის კომპენსაციისთვის.`
      });
    } else if (spec.stage === 'stabilization') {
      lotTransfers.push({
        id: `TR-${spec.id}-STAB`,
        sourceId: destVessel,
        destId: destVessel,
        volume: spec.currentVolume,
        loss: 0,
        operator: OPERATOR,
        category: 'stabilization',
        date: addDays(spec.intakeDate, 30),
        pump: 'Cooling loop',
        details: `${spec.name} - ცივი სტაბილიზაციის ციკლი ტარტარატების დასალექად.`
      });
    } else if (spec.stage === 'bottled') {
      lotTransfers.push({
        id: `TR-${spec.id}-BOTTLING-RACK`,
        sourceId: destVessel,
        destId: 'T-104',
        volume: spec.initialVolume,
        loss: index % 2 === 0 ? 2 : 0,
        operator: OPERATOR,
        category: 'filtration',
        date: addDays(spec.intakeDate, 120),
        pump: 'Enopump E-400',
        details: `${spec.name} - ფილტრაცია და გადატანა ჩამოსასხმელ რეზერვუარში.`
      });
    }

    return lotTransfers;
  });

  const bottlingRuns = [
    {
      id: 'bot_1',
      lotId: 'RK-23',
      lotName: 'რქაწითელი ქვევრი 2023',
      date: '2024-03-18',
      lotNumber: 'KV-RK-23-001',
      operator: OPERATOR,
      formats: { '750ml': 1800 },
      totalBottles: 1800,
      totalCeramic: 0,
      volumeBottledL: 1350,
      packagingMaterialIds: { bottle: 'INV-BOTTLE-750', closure: 'INV-CORK', label: 'INV-LABEL', box: 'INV-BOX' },
      packagingDeductions: { 'INV-BOTTLE-750': 1800, 'INV-CORK': 1800, 'INV-LABEL': 1800, 'INV-BOX': 300 },
      bottlesPerBox: 6,
      packagingCostTotal: 3150,
      bottlingServiceCost: 1260,
      storageLocationId: 'SL-QVEVRI',
      storageMovementId: 'sm_1',
      placedInStorageBottles: 1800,
    },
    {
      id: 'BOT-TS-23-01',
      lotId: 'TS-23',
      lotName: 'წინანდალი კლასიკური 2023',
      date: '2024-04-12',
      lotNumber: 'KV-TS-23-001',
      operator: OPERATOR,
      formats: { '750ml': 300 },
      totalBottles: 300,
      totalCeramic: 0,
      volumeBottledL: 225,
      packagingMaterialIds: { bottle: 'INV-BOTTLE-750', closure: 'INV-CORK', label: 'INV-LABEL', box: 'INV-BOX' },
      packagingDeductions: { 'INV-BOTTLE-750': 300, 'INV-CORK': 300, 'INV-LABEL': 300, 'INV-BOX': 50 },
      bottlesPerBox: 6,
      packagingCostTotal: 525,
      bottlingServiceCost: 210,
      storageLocationId: 'SL-MAIN',
      storageMovementId: 'SM-TS-23-IN',
      placedInStorageBottles: 300,
    },
  ];

  const costEntries = [
    ...lotSpecs.map((spec, index) => ({
      id: index === 0 ? 'cost_1' : index === 1 ? 'cost_2' : `COST-GRAPE-${spec.id}`,
      date: spec.intakeDate,
      lotId: spec.id,
      category: 'grape',
      description: `${spec.name} - ყურძნის თვითღირებულება`,
      amount: round(spec.harvestKg * spec.costPerKg, 2),
      currency: 'GEL',
      quantity: spec.harvestKg,
      unitCost: spec.costPerKg,
      sourceRef: `GI-${spec.id}`,
      createdBy: OPERATOR,
    })),
    { id: 'COST-PACK-RK-23', date: '2024-03-18', lotId: 'RK-23', category: 'packaging', description: 'ბოთლი, საცობი, ეტიკეტი და ყუთი', amount: 3150, currency: 'GEL', quantity: 1800, unitCost: 1.75, sourceRef: 'bot_1', createdBy: OPERATOR },
    { id: 'COST-BOT-RK-23', date: '2024-03-18', lotId: 'RK-23', category: 'bottling', description: 'ჩამოსხმის მომსახურება', amount: 1260, currency: 'GEL', quantity: 1800, unitCost: 0.7, sourceRef: 'bot_1', createdBy: OPERATOR },
    { id: 'COST-PACK-TS-23', date: '2024-04-12', lotId: 'TS-23', category: 'packaging', description: 'წინანდლის შეფუთვა', amount: 525, currency: 'GEL', quantity: 300, unitCost: 1.75, sourceRef: 'BOT-TS-23-01', createdBy: OPERATOR },
    { id: 'COST-BARREL-MUK-23', date: '2023-11-15', lotId: 'MUK-23', category: 'other', description: 'მუხის კასრის გამოყენების განაწილებული ხარჯი', amount: 450, currency: 'GEL', quantity: 0.25, unitCost: 1800, sourceRef: 'INV-BARREL', createdBy: OPERATOR },
  ];

  const storageLocations = [
    { id: 'SL-MAIN', name: 'მთავარი ბოთლების საწყობი', type: 'warehouse', capacityBottles: 12000, targetTempC: 15, targetHumidity: 68, notes: 'მზა პროდუქციის ძირითადი ზონა.' },
    { id: 'SL-QVEVRI', name: 'ქვევრის დარბაზის საწყობი', type: 'qvevri_hall', capacityBottles: 3500, targetTempC: 14, targetHumidity: 72, notes: 'ქვევრის ხაზის მცირე პარტიები.' },
    { id: 'SL-EXPORT', name: 'ექსპორტის გამზადების ზონა', type: 'warehouse', capacityBottles: 5000, targetTempC: 16, targetHumidity: 65, notes: 'შეკვეთების კონსოლიდაცია და ეტიკეტის კონტროლი.' },
  ];

  const stockMovements = [
    { id: 'sm_1', date: '2024-03-18', lotId: 'RK-23', locationId: 'SL-QVEVRI', direction: 'in', bottles: 1800, reason: 'bottling', sourceRef: 'bot_1', note: 'რქაწითელი ქვევრის ჩამოსხმის მიღება საწყობში.' },
    { id: 'SM-RK-23-OUT-1', date: '2024-04-05', lotId: 'RK-23', locationId: 'SL-QVEVRI', direction: 'out', bottles: 600, reason: 'sale', sourceRef: 'disp_1', note: 'დისტრიბუციის მიწოდება.' },
    { id: 'SM-TS-23-IN', date: '2024-04-12', lotId: 'TS-23', locationId: 'SL-MAIN', direction: 'in', bottles: 300, reason: 'bottling', sourceRef: 'BOT-TS-23-01', note: 'წინანდლის მცირე პარტია საწყობში.' },
  ];

  const salesOrders = [
    { id: 'ord_1', orderNumber: 'ORD-2024-001', orderDate: '2024-03-28', createdAt: '2024-03-28T09:00:00.000Z', requestedDispatchDate: '2024-04-05', customerName: 'ჯივიეს დისტრიბუცია', lotId: 'RK-23', lotName: 'რქაწითელი ქვევრი 2023', locationId: 'SL-QVEVRI', locationName: 'ქვევრის დარბაზის საწყობი', bottles: 600, pricePerBottle: 25, currency: 'GEL', revenue: 15000, costPerBottle: 7.1, cogs: 4260, grossProfit: 10740, marginPct: 71.6, status: 'fulfilled', dispatchId: 'disp_1', fulfilledAt: '2024-04-05T10:00:00.000Z', operator: OPERATOR, notes: 'პირველი სადემონსტრაციო კომერციული შეკვეთა.' },
    { id: 'SO-TS-23-RES', orderNumber: 'ORD-2024-002', orderDate: '2024-04-20', createdAt: '2024-04-20T12:00:00.000Z', requestedDispatchDate: '2024-05-02', reservedUntil: '2027-05-02', customerName: 'ყვარლის ღვინის ბარი', lotId: 'TS-23', lotName: 'წინანდალი კლასიკური 2023', locationId: 'SL-MAIN', locationName: 'მთავარი ბოთლების საწყობი', bottles: 60, pricePerBottle: 18, currency: 'GEL', revenue: 1080, costPerBottle: 5.8, cogs: 348, grossProfit: 732, marginPct: 67.8, status: 'reserved', operator: OPERATOR, notes: 'რეზერვაცია დეგუსტაციის ღონისძიებისთვის.' },
  ];

  const salesDispatches = [
    { id: 'disp_1', date: '2024-04-05', customerName: 'ჯივიეს დისტრიბუცია', lotId: 'RK-23', lotName: 'რქაწითელი ქვევრი 2023', locationId: 'SL-QVEVRI', locationName: 'ქვევრის დარბაზის საწყობი', bottles: 600, pricePerBottle: 25, currency: 'GEL', revenue: 15000, costPerBottle: 7.1, cogs: 4260, grossProfit: 10740, marginPct: 71.6, stockMovementId: 'SM-RK-23-OUT-1', salesOrderId: 'ord_1', operator: OPERATOR, notes: 'მიწოდება დასრულდა, ზედნადები მიბმულია შეკვეთაზე.' },
  ];

  const tasks = [
    { id: 'task_1', title: 'საფერავის გაგრილების კონტროლი', priority: 'high', dueDate: '2026-07-03', assignedTo: OPERATOR, status: 'pending', description: 'T-101 ავზზე ტემპერატურა შეინარჩუნეთ 18°C-ის ფარგლებში.', lastModified: now },
    { id: 'task_2', title: 'ქვევრების ცვილის ბეჭდის შემოწმება', priority: 'medium', dueDate: '2026-07-05', assignedTo: 'გიორგი კობახიძე', status: 'pending', description: 'Q-02, Q-03 და Q-04 ქვევრებზე ბეჭედი და ტენიანობა შემოწმდეს.', lastModified: now },
    { id: 'task_3', title: 'მზა პროდუქციის ინვენტარიზაცია', priority: 'medium', dueDate: '2026-07-08', assignedTo: OPERATOR, status: 'pending', description: 'RK-23 და TS-23 ბოთლების ნაშთი შეედაროს საწყობის მოძრაობებს.', lastModified: now },
    { id: 'task_4', title: 'მუხის კასრების შევსება', priority: 'low', dueDate: '2026-07-10', assignedTo: OPERATOR, status: 'completed', description: 'B-01 და B-03 კასრების აორთქლების დანაკარგი დაკომპენსირდა.', lastModified: now },
    { id: 'task_5', title: 'ლაბორატორიული SO2 გადამოწმება', priority: 'high', dueDate: '2026-07-04', assignedTo: LAB_TECH, status: 'pending', description: 'დაბალი თავისუფალი SO2-ის მქონე პარტიებზე განმეორებითი ანალიზი.', lastModified: now },
  ];

  const notes = [
    { id: 'note_1', title: 'საფერავის ფერის ინტენსივობა', date: '2024-09-26', author: OPERATOR, category: 'Tasting', relatedLotId: 'SAP-24', content: 'ფერი ღრმა იისფერია, ტანინი რბილი და მწიფე. საჭიროა ტემპერატურის ფრთხილი კონტროლი.' },
    { id: 'note_2', title: 'კისის ქვევრის არომატი', date: '2023-11-10', author: LAB_TECH, category: 'Tasting', relatedLotId: 'KIS-23', content: 'ატმის ჩირი, თაფლი და ჩაის ტონები. ჟანგვა არ აღინიშნება.' },
    { id: 'note_3', title: 'მზა პროდუქციის QR მიკვლევადობა', date: '2024-04-15', author: OPERATOR, category: 'General', relatedLotId: 'RK-23', content: 'RK-23 ბოთლების ეტიკეტზე მითითებული QR უკავშირდება მიღებას, ლაბორატორიას, ჩამოსხმას და გაყიდვას.' },
  ];

  const auditLogs = [
    { id: 'AUD-SEED-001', timestamp: '2024-09-18T08:30:00.000Z', user: OPERATOR, module: 'GVINO', actionType: 'Create Demo Lot', changedItem: 'SAP-24', oldValue: '', newValue: 'საფერავი ყვარელი 2024', notes: 'დემო ანგარიშის საწყისი პარტია.' },
    { id: 'AUD-SEED-002', timestamp: '2024-03-18T10:00:00.000Z', user: OPERATOR, module: 'GVINO', actionType: 'Bottling', changedItem: 'RK-23', oldValue: 'bulk wine', newValue: '1800 bottles', notes: 'ჩამოსხმა და საწყობის მოძრაობა დაკავშირებულია.' },
    { id: 'AUD-SEED-003', timestamp: '2024-04-05T10:00:00.000Z', user: OPERATOR, module: 'MARANIOS', actionType: 'Sales Dispatch', changedItem: 'ord_1', oldValue: 'reserved', newValue: 'fulfilled', notes: 'გაყიდვა მიბმულია stockMovementId-ზე SM-RK-23-OUT-1.' },
  ];

  return {
    syncDeletionLedger: [],
    invoiceReceipts: [],
    inventoryMovements: [],
    companyProfile: {
      companyName: 'ყვარლის სადემონსტრაციო მარანი',
      wineryName: WINERY_NAME,
      country: 'საქართველო',
      region: 'კახეთი',
      municipality: 'ყვარელი',
      address: 'შოთა რუსთაველის ქ. 45, ყვარელი, საქართველო',
      contactEmail: 'kvareli.demo@vinos.app',
      phone: '+995 599 123 456',
      website: 'https://vinos.app',
      measurementUnits: 'metric',
      currency: 'GEL',
      latitude: 41.9542,
      longitude: 45.8152,
    },
    blocks: withSyncStamp(blocks),
    vineyardProjects: withSyncStamp([
      {
        id: 'VP-KV-2026-01',
        projectName: 'Kvareli terrace restoration 2026',
        landOwnershipDocumentName: 'land-rights-kvareli-terrace.pdf',
        cadastralMapDocumentName: 'cadastre-map-57.06.55.018.pdf',
        soilAnalysisDocumentName: 'soil-analysis-kvareli-terrace.pdf',
        agrotechnicalQuestionnaireName: 'agro-questionnaire-kvareli-terrace.pdf',
        plannedVarieties: ['Saperavi', 'Khikhvi'],
        rootstock: '5C / SO4',
        spacing: '2.4m x 1.1m',
        rowDirection: 'North-South',
        irrigationPlan: 'Drip irrigation from estate reservoir with moisture checks before July heat.',
        nurseryInvoiceDocumentName: 'nursery-intent-2026.pdf',
        applicationStatus: 'ready',
        approvalDate: '',
        approvalValidUntil: '',
        soilDepth: 82,
        pH: 7.1,
        organicMatter: 2.3,
        caco3: 8.4,
        texture: 'loam with limestone gravel',
        ec: 0.36,
        exchangeableCa: 18.5,
        exchangeableMg: 4.6,
        exchangeableNa: 0.24,
        hygroscopicWater: 5.2,
      },
    ]),
    vessels: withSyncStamp(vessels),
    lots: withSyncStamp(lots),
    fermlogs: withSyncStamp(lotSpecs.flatMap(makeFermLogs)),
    lablogs: withSyncStamp(lotSpecs.flatMap(makeLabLogs)),
    inventory: withSyncStamp(inventory),
    tasks: withSyncStamp(tasks),
    notes: withSyncStamp(notes),
    phenologyLogs: withSyncStamp(phenologyLogs),
    sprays: withSyncStamp(sprays),
    scoutings: withSyncStamp(scoutings),
    soilRecords: withSyncStamp(soilRecords),
    samplings: withSyncStamp(samplings),
    harvests: withSyncStamp(harvests),
    irrigationLogs: withSyncStamp(irrigationLogs),
    fertilizerLogs: withSyncStamp(fertilizerLogs),
    auditLogs,
    bottlingRuns: withSyncStamp(bottlingRuns),
    transfers: withSyncStamp(transfers),
    grapeIntakes: withSyncStamp(grapeIntakes),
    cellarOps: withSyncStamp(cellarOps),
    costEntries: withSyncStamp(costEntries),
    winePricing: {
      'SAP-24': 32,
      'RK-23': 25,
      'MTS-24': 18,
      'KIS-23': 28,
      'AL-24': 24,
      'KH-24': 26,
      'MUK-23': 55,
      'TS-23': 18,
      'OJ-24': 30,
      'US-24': 48,
    },
    storageLocations: withSyncStamp(storageLocations),
    stockMovements: withSyncStamp(stockMovements),
    salesDispatches: withSyncStamp(salesDispatches),
    salesOrders: withSyncStamp(salesOrders),
    supplierPayments: withSyncStamp([
      { id: 'PAY-OWN-ALLOC-01', date: '2024-10-15', supplierName: 'შიდა ვენახის თვითღირებულება', amount: 5000, currency: 'GEL', method: 'bank', note: 'დემო ბიუჯეტის შიდა გადატანა რთველის ხარჯებისთვის.', operator: OPERATOR },
    ]),
    certificationRecords: [],
    attachments: [],
    crmLeads: [],
    aiDrafts: [],
    workflowApprovals: [],
    qualitySops: [],
    purchaseOrders: [],
    productionPlans: [],
    recallCases: [],
    aiFindings: [],
  };
}
