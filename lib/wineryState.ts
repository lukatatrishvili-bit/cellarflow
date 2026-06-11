export type VesselType = 'stainless_steel' | 'qvevri' | 'barrel' | 'plastic' | 'concrete' | 'other';
export type WineClass = 'white' | 'red' | 'rose' | 'amber' | 'sparkling' | 'fortified' | 'base_wine';
export type WinemakingStage = 'crushing' | 'fermenting' | 'maceration' | 'pressing' | 'aging' | 'stabilization' | 'filtration' | 'bottled' | 'sold';

export interface WineLot {
  id: string; // Lot Code
  name: string;
  vintage: number;
  variety: string;
  vineyardBlock: string;
  region: string;
  initialVolume: number;
  currentVolume: number;
  wineClass: WineClass;
  stage: WinemakingStage;
  createdAt: string;
  history: Array<{
    date: string;
    type: string;
    description: string;
    operator: string;
  }>;
  sensoryProfile?: {
    tannins: number; // 1-10
    acidity: number; // 1-10
    body: number;    // 1-10
    aromatics: number; // 1-10
    wood: number;    // 1-10
    fruit: number;   // 1-10
  };
}

export interface Vessel {
  id: string; // Tank ID / Name
  type: VesselType;
  shape: 'vertical' | 'horizontal' | 'conical';
  capacity: number;
  currentVolume: number;
  assignedLotId: string | null;
  cleaningStatus: 'clean' | 'dirty' | 'cleaning_needed';
  lastCleaned: string;
  temperature: number;
  coolingJacketActive: boolean;
  targetTemperature: number | null;
  lastOperation: string;
  locationDetails?: string; 
  xGrid?: number; // 0-100 percentage layout position
  yGrid?: number; // 0-100 percentage layout position
}

export interface DailyFermLog {
  id: string;
  tankId: string;
  lotId: string;
  date: string;
  temperature: number;
  density: number; // Specific gravity (e.g., 1.090 to 0.990)
  sugar: number; // g/L or Brix
  ph: number;
  tastingNotes: string;
  capManagement: string; // Punchdown, pumpover, none
  additives: string;
}

export interface LabAnalysis {
  id: string;
  lotId: string;
  tankId: string;
  date: string;
  alcoholPct: number;
  volatileAcid: number; // g/L
  freeSo2: number; // mg/L
  totalSo2: number; // mg/L
  residualSugar: number; // g/L
  ph: number;
  malicAcid: number; // g/L
  lacticAcid: number; // g/L
  turbidity: number; // NTU
  technician: string;
  titratableAcidity: number; // g/L (as Tartaric Acid)
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string; // Dynamic categorie supports, e.g. 'additives', 'yeasts', 'nutritions', 'bottles', etc.
  stock: number; // Current count / weight (kg or units)
  minThreshold: number;
  unit: string;
  costPerUnit: number;
  supplierName: string;
  details?: string; // Additional winemaker remarks/specs
}

export interface Task {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  assignedTo: string;
  status: 'pending' | 'completed';
  description: string;
}

export interface TransferEvent {
  id: string;
  date: string;
  sourceTankId: string;
  destTankId: string;
  volume: number;
  loss: number;
  reason: string;
  pumpModel: string;
  operator: string;
}

// Initial dummy data to make the app alive instantly
export const initialVessels: Vessel[] = [
  {
    id: 'Tank T-1',
    type: 'stainless_steel',
    shape: 'vertical',
    capacity: 5000,
    currentVolume: 4200,
    assignedLotId: 'CS-2025-01',
    cleaningStatus: 'clean',
    lastCleaned: '2026-05-15',
    temperature: 16.5,
    coolingJacketActive: true,
    targetTemperature: 16.0,
    lastOperation: 'Fermentation monitoring',
    locationDetails: 'Main Fermentation Room, Row A',
    xGrid: 20,
    yGrid: 30
  },
  {
    id: 'Tank T-2',
    type: 'stainless_steel',
    shape: 'conical',
    capacity: 2500,
    currentVolume: 0,
    assignedLotId: null,
    cleaningStatus: 'clean',
    lastCleaned: '2026-05-24',
    temperature: 18.0,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Full sterilization',
    locationDetails: 'Main Fermentation Room, Row A',
    xGrid: 40,
    yGrid: 30
  },
  {
    id: 'Qvevri Q-1',
    type: 'qvevri',
    shape: 'vertical',
    capacity: 1500,
    currentVolume: 1400,
    assignedLotId: 'RK-2025-A2',
    cleaningStatus: 'clean',
    lastCleaned: '2025-10-02',
    temperature: 19.2,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Skin maceration sealing',
    locationDetails: 'Lower Ancient Marani, East Bay',
    xGrid: 20,
    yGrid: 70
  },
  {
    id: 'Qvevri Q-2',
    type: 'qvevri',
    shape: 'vertical',
    capacity: 1000,
    currentVolume: 0,
    assignedLotId: null,
    cleaningStatus: 'dirty',
    lastCleaned: '2025-11-20',
    temperature: 14.5,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Emptied and rinsed',
    locationDetails: 'Lower Ancient Marani, West Bay',
    xGrid: 40,
    yGrid: 70
  },
  {
    id: 'Barrel B-1',
    type: 'barrel',
    shape: 'horizontal',
    capacity: 225,
    currentVolume: 225,
    assignedLotId: 'SAP-2024-S1',
    cleaningStatus: 'clean',
    lastCleaned: '2025-11-04',
    temperature: 15.0,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Racking & Topping',
    locationDetails: 'Aging Cellar, Back-row Rack 3',
    xGrid: 70,
    yGrid: 30
  },
  {
    id: 'Barrel B-2',
    type: 'barrel',
    shape: 'horizontal',
    capacity: 225,
    currentVolume: 0,
    assignedLotId: null,
    cleaningStatus: 'clean',
    lastCleaned: '2026-05-25',
    temperature: 14.8,
    coolingJacketActive: false,
    targetTemperature: null,
    lastOperation: 'Steam-treated',
    locationDetails: 'Aging Cellar, Row 1 Rack 12',
    xGrid: 70,
    yGrid: 50
  }
];

export const initialLots: WineLot[] = [
  {
    id: 'CS-2025-01',
    name: 'Cabernet Sauvignon Premium',
    vintage: 2025,
    variety: 'Cabernet Sauvignon',
    vineyardBlock: 'Anaklia Ridge, Sector 4',
    region: 'Kakheti Appellation',
    initialVolume: 4200,
    currentVolume: 4200,
    wineClass: 'red',
    stage: 'fermenting',
    createdAt: '2025-09-18',
    history: [
      { date: '2025-09-18', type: 'Crush', description: 'Crushed and destemmed. Initial Brix: 24.5.', operator: 'K. Eliashvili' },
      { date: '2025-09-20', type: 'Inoculation', description: 'Inoculated with Lalvin EC1118 yeast.', operator: 'K. Eliashvili' }
    ],
    sensoryProfile: { tannins: 8, acidity: 7, body: 8, aromatics: 7, wood: 2, fruit: 8 }
  },
  {
    id: 'RK-2025-A2',
    name: 'Rkatsiteli Amber Traditional',
    vintage: 2025,
    variety: 'Rkatsiteli',
    vineyardBlock: 'Kondoli South Block',
    region: 'Tsinandali Micro-zone',
    initialVolume: 1400,
    currentVolume: 1400,
    wineClass: 'amber',
    stage: 'maceration',
    createdAt: '2025-09-22',
    history: [
      { date: '2025-09-22', type: 'Qvevri Fill', description: 'Loaded into clay Qvevri Q-1 with full skins and partial stems.', operator: 'L. Tatrishvili' },
      { date: '2025-10-10', type: 'Sealing', description: 'Qvevri sealed with clay, sand and lime.', operator: 'L. Tatrishvili' }
    ],
    sensoryProfile: { tannins: 5, acidity: 6, body: 7, aromatics: 8, wood: 1, fruit: 6 }
  },
  {
    id: 'SAP-2024-S1',
    name: 'Saperavi Barrel Select',
    vintage: 2024,
    variety: 'Saperavi',
    vineyardBlock: 'Mukuzani Heights, Block D',
    region: 'Mukuzani PDO',
    initialVolume: 225,
    currentVolume: 225,
    wineClass: 'red',
    stage: 'aging',
    createdAt: '2024-09-15',
    history: [
      { date: '2024-09-15', type: 'Harvest', description: 'Hand-picked, double sorted. Initial Baumé: 14.8.', operator: 'K. Eliashvili' },
      { date: '2024-11-04', type: 'Barrel Entry', description: 'Transferred into French oak Barrel B-1 after malolactic completion.', operator: 'L. Tatrishvili' }
    ],
    sensoryProfile: { tannins: 9, acidity: 7, body: 9, aromatics: 8, wood: 6, fruit: 7 }
  }
];

export const initialFermLogs: DailyFermLog[] = [
  {
    id: 'log-8',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-27',
    temperature: 16.5,
    density: 1.002,
    sugar: 4.5,
    ph: 3.54,
    tastingNotes: 'Dry, elegant, tannic, ready for pressing shortly.',
    capManagement: 'Punchdown - twice daily',
    additives: 'None / Sugar depleted'
  },
  {
    id: 'log-7',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-26',
    temperature: 17.2,
    density: 1.008,
    sugar: 18,
    ph: 3.53,
    tastingNotes: 'Healthy, soft CO2 release, gorgeous berry and spice flavors.',
    capManagement: 'Pumpover - 15 mins',
    additives: 'None'
  },
  {
    id: 'log-6',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-25',
    temperature: 19.5,
    density: 1.018,
    sugar: 41,
    ph: 3.51,
    tastingNotes: 'Active warm cap, thick skins, fully colored must.',
    capManagement: 'Punchdown - twice daily',
    additives: 'None'
  },
  {
    id: 'log-5',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-24',
    temperature: 22.0,
    density: 1.032,
    sugar: 78,
    ph: 3.48,
    tastingNotes: 'Peak fermentation, strong carbonated aromas, warm fermenter.',
    capManagement: 'Pumpover - 20 mins',
    additives: 'DAP Nutrients added'
  },
  {
    id: 'log-4',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-23',
    temperature: 21.4,
    density: 1.050,
    sugar: 125,
    ph: 3.44,
    tastingNotes: 'Violent bubbling, thick cap rising, intense color release.',
    capManagement: 'Punchdown - twice daily',
    additives: 'None'
  },
  {
    id: 'log-3',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-22',
    temperature: 19.8,
    density: 1.072,
    sugar: 175,
    ph: 3.41,
    tastingNotes: 'Yeast multiplication fully active, foaming white collar.',
    capManagement: 'Pumpover - 10 mins',
    additives: 'None'
  },
  {
    id: 'log-2',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-21',
    temperature: 18.0,
    density: 1.090,
    sugar: 215,
    ph: 3.38,
    tastingNotes: 'First trace CO2 bubbles, inoculating density starts to budge.',
    capManagement: 'None',
    additives: 'Lalvin EC1118 yeast'
  },
  {
    id: 'log-1',
    tankId: 'Tank T-1',
    lotId: 'CS-2025-01',
    date: '2026-05-20',
    temperature: 16.0,
    density: 1.095,
    sugar: 230,
    ph: 3.36,
    tastingNotes: 'Must loaded, cold soak phase completed, yeast inoculated.',
    capManagement: 'None',
    additives: 'SO2 30ppm'
  }
];

export const initialLabLogs: LabAnalysis[] = [
  {
    id: 'lab-1',
    lotId: 'SAP-2024-S1',
    tankId: 'Barrel B-1',
    date: '2026-05-22',
    alcoholPct: 14.2,
    volatileAcid: 0.52,
    freeSo2: 26,
    totalSo2: 78,
    residualSugar: 1.8,
    ph: 3.58,
    malicAcid: 0.12,
    lacticAcid: 1.45,
    turbidity: 18,
    technician: 'Sophia Rossi',
    titratableAcidity: 6.2
  },
  {
    id: 'lab-2',
    lotId: 'CS-2025-01',
    tankId: 'Tank T-1',
    date: '2026-05-25',
    alcoholPct: 11.5,
    volatileAcid: 0.38,
    freeSo2: 12, // Needs attention!
    totalSo2: 45,
    residualSugar: 28,
    ph: 3.53,
    malicAcid: 1.85,
    lacticAcid: 0.22,
    turbidity: 140,
    technician: 'Sophia Rossi',
    titratableAcidity: 5.8
  }
];

export const initialInventory: InventoryItem[] = [
  { id: 'inv-1', name: 'Potassium Metabisulfite (KMBS)', category: 'additives', stock: 12.5, minThreshold: 5.0, unit: 'kg', costPerUnit: 18.00, supplierName: 'Enartis Winemaking Partners' },
  { id: 'inv-2', name: 'Lalvin EC-1118 Yeast', category: 'yeasts', stock: 8.2, minThreshold: 3.0, unit: 'kg', costPerUnit: 45.00, supplierName: 'Scott Laboratories' },
  { id: 'inv-3', name: 'Diammonium Phosphate (DAP)', category: 'additives', stock: 4.0, minThreshold: 10.0, unit: 'kg', costPerUnit: 12.50, supplierName: 'Scott Laboratories' }, // Low stock alarm!
  { id: 'inv-4', name: 'Classic Green Burg Bottles (750mL)', category: 'bottles', stock: 2400, minThreshold: 1000, unit: 'units', costPerUnit: 1.15, supplierName: 'Saura Glassworks' },
  { id: 'inv-5', name: 'Fluor-carbon Natural Corks', category: 'closures', stock: 1500, minThreshold: 800, unit: 'units', costPerUnit: 0.48, supplierName: 'Amorim Cork Co.' }
];

export const initialTasks: Task[] = [
  { id: 'task-1', title: 'Measure pH & Free SO2 of Cabernet', priority: 'high', dueDate: '2026-05-28', assignedTo: 'M. Rossi', status: 'pending', description: 'Cabernet EC-1118 fermentation is finishing. Check if it needs sulfite protection post-ferment.' },
  { id: 'task-2', title: 'Sealing sanitation review in Marani', priority: 'medium', dueDate: '2026-05-30', assignedTo: 'Luka Tatrishvili', status: 'pending', description: 'Inspect Q-1 clay lid seal on traditional Rkatsiteli jar.' },
  { id: 'task-3', title: 'Sanitize variable volume plastic vessel 4', priority: 'low', dueDate: '2026-06-03', assignedTo: 'G. Gogoladze', status: 'completed', description: 'Clean plastic tank for transport buffer use.' }
];

// ==========================================
// VINEA VAZI (VITICULTURE) PORTION TYPES
// ==========================================

export interface VineyardBlock {
  id: string;
  name: string;
  vineyardName: string;
  locationName: string;
  latitude: number;
  longitude: number;
  area: number; // in hectares
  elevation: number; // altitude in meters
  slope: string;
  aspect: string;
  soilType: string;
  grapeVariety: string;
  clone?: string;
  rootstock?: string;
  plantingYear: number;
  spacing: string; // e.g., "row spacing x vine spacing"
  rowsCount: number;
  vinesCount: number;
  trainingSystem: string; // e.g., "Double Guyot"
  pruningSystem: string; // e.g., "Cane pruned"
  irrigationEnabled: boolean;
  farmingStatus: 'organic' | 'conventional' | 'biodynamic';
  currentPhenology: string;
  estimatedHarvestDate: string;
  notes: string;
}

export interface PhenologyRecord {
  id: string;
  blockId: string;
  stage: string;
  date: string;
  gdd: number; // Growing Degree Days
  confidence: number; // percentage
  status: 'estimated' | 'confirmed';
  notes: string;
  observer: string;
}

export interface SprayRecord {
  id: string;
  blockId: string;
  date: string;
  targetProblem: string; // e.g., "Downy Mildew prevention"
  productName: string;
  activeIngredient: string;
  dosePerHa: number; // e.g., kg or L
  waterVolumePerHa: number; // in L
  totalProductUsed: number;
  totalWaterUsed: number;
  operator: string;
  machineryUsed: string;
  windSpeed: number; // km/h
  temperature: number; // °C
  humidity: number; // %
  preHarvestIntervalDays: number; // PHI
  reEntryIntervalHours: number; // REI
  notes: string;
}

export interface ScoutingRecord {
  id: string;
  blockId: string;
  date: string;
  locationDetails: string; // rows or zone
  problemType: 'Downy mildew' | 'Powdery mildew' | 'Botrytis' | 'Black rot' | 'Esca' | 'Mites' | 'Grape moth' | 'Nutrient deficiency' | 'Water stress' | 'Hail damage' | 'Sunburn' | 'Other';
  severity: 'low' | 'medium' | 'high';
  notes: string;
  recommendedAction: string;
  followUpTaskId?: string;
}

export interface IrrigationRecord {
  id: string;
  blockId: string;
  date: string;
  durationHours: number;
  waterVolumeLiters: number;
  soilMoistureBeforePct: number;
  soilMoistureAfterPct: number;
  weatherConditions: string;
  notes: string;
}

export interface FertilizationRecord {
  id: string;
  blockId: string;
  date: string;
  productName: string;
  dosePerHa: number;
  totalAmountUsed: number;
  applicationMethod: string;
  operator: string;
  notes: string;
}

export interface SoilAnalysisRecord {
  id: string;
  blockId: string;
  date: string;
  pH: number;
  organicMatterPct: number;
  nitrogenMgKg: number;
  phosphorusMgKg: number;
  potassiumMgKg: number;
  calciumMgKg: number;
  magnesiumMgKg: number;
  salinityDsm: number;
  notes: string;
}

export interface GrapeSamplingRecord {
  id: string;
  blockId: string;
  date: string;
  brix: number;
  pH: number;
  totalAcidityGL: number;
  berryWeightG: number;
  phenolicMaturity: 'Incomplete' | 'Intermediate' | 'Optimal' | 'Overripe';
  seedColor: 'Green' | 'Yellow-brown' | 'Dark brown';
  tasteNotes: string;
  diseaseCondition: string;
  estimatedHarvestDate: string;
  notes: string;
}

export interface HarvestRecord {
  id: string;
  blockId: string;
  variety: string;
  estimatedHarvestDate: string;
  estimatedTons: number;
  actualHarvestDate?: string;
  actualHarvestedKg?: number;
  pickingMethod: 'hand' | 'machine';
  crateQuantity?: number;
  grapeCondition: 'excellent' | 'good' | ' fair' | 'damaged';
  temperatureAtHarvest?: number;
  destinationWinery?: string;
  sentToGvino: boolean;
  associatedLotId?: string;
  notes: string;
}

// Global Audit Log
export interface VineaAuditLog {
  id: string;
  timestamp: string;
  user: string;
  module: 'VINEA' | 'VAZI' | 'GVINO';
  actionType: string; // e.g. "Create Block", "Full Transfer"
  changedItem: string;
  oldValue: string;
  newValue: string;
  notes: string;
}

// User Settings and Profile Type
export interface UserProfile {
  username: string;
  email: string;
  fullName: string;
  role: 'Owner/Admin' | 'Viticulturist' | 'Winemaker' | 'Lab Technician' | 'Cellar Worker' | 'Read-Only';
  language: 'en' | 'ka';
}

export interface CompanyProfile {
  companyName: string;
  wineryName: string;
  country: string;
  region: string;
  municipality: string;
  address: string;
  contactEmail: string;
  phone: string;
  website: string;
  measurementUnits: 'metric' | 'imperial';
  latitude?: number;
  longitude?: number;
}

// ==========================================
// INITIAL VAZI DATASETS
// ==========================================

export const initialVineyardBlocks: VineyardBlock[] = [
  {
    id: 'block-1',
    name: 'Ridge Vineyard - East Face',
    vineyardName: 'Anaklia Ridge Estate',
    locationName: 'Ganmukhuri Slope, Georgia',
    latitude: 42.5182,
    longitude: 41.5645,
    area: 4.8,
    elevation: 120,
    slope: '8% North-East',
    aspect: 'North-East',
    soilType: 'Fluvisols with deep alluvial sandy clay loam',
    grapeVariety: 'Saperavi',
    plantingYear: 2012,
    spacing: '2.5m x 1.0m',
    rowsCount: 96,
    vinesCount: 19200,
    trainingSystem: 'Double Guyot',
    pruningSystem: 'Cane pruned',
    irrigationEnabled: true,
    farmingStatus: 'organic',
    currentPhenology: 'Veraison',
    estimatedHarvestDate: '2026-09-12',
    notes: 'Premium dark-berried variety block with excellent drainage and maritime evening breeze protection.'
  },
  {
    id: 'block-2',
    name: 'Kondoli Hillside Block',
    vineyardName: 'Kondoli Estate',
    locationName: 'Telavi District, Kakheti, Georgia',
    latitude: 41.9567,
    longitude: 45.4851,
    area: 3.2,
    elevation: 350,
    slope: '14% South-West',
    aspect: 'South-West',
    soilType: 'Cinnamonic clay with limestone pebbles',
    grapeVariety: 'Rkatsiteli',
    plantingYear: 2005,
    spacing: '2.4m x 1.1m',
    rowsCount: 72,
    vinesCount: 12100,
    trainingSystem: 'Cordon de Royat',
    pruningSystem: 'Spur pruned',
    irrigationEnabled: false,
    farmingStatus: 'conventional',
    currentPhenology: 'Ripening',
    estimatedHarvestDate: '2026-09-20',
    notes: 'Dry farmed hillside block. High diurnal range gives superb crisp acidity retention to native Rkatsiteli.'
  },
  {
    id: 'block-3',
    name: 'Mukuzani Terraces S-3',
    vineyardName: 'Mukuzani Highlands',
    locationName: 'Gurjaani, Kakheti, Georgia',
    latitude: 41.7823,
    longitude: 45.7161,
    area: 5.5,
    elevation: 480,
    slope: '18% South',
    aspect: 'South',
    soilType: 'Alluvial calcareous pebbles with brown sandy clay',
    grapeVariety: 'Saperavi',
    plantingYear: 1998,
    spacing: '2.6m x 1.0m',
    rowsCount: 110,
    vinesCount: 22000,
    trainingSystem: 'Double Guyot',
    pruningSystem: 'Cane pruned',
    irrigationEnabled: false,
    farmingStatus: 'biodynamic',
    currentPhenology: 'Fruit set',
    estimatedHarvestDate: '2026-09-08',
    notes: 'Old vine plot located inside Mukuzani Specific Viticulture District. Gives intensely concentrated black fruit.'
  }
];

export const initialPhenologyRecords: PhenologyRecord[] = [
  {
    id: 'ph-1',
    blockId: 'block-1',
    stage: 'Veraison',
    date: '2026-05-24',
    gdd: 980,
    confidence: 88,
    status: 'confirmed',
    notes: 'Skin coloring detected on approximately 25% of berries in the lower section of the block.',
    observer: 'Luka Tatrishvili'
  },
  {
    id: 'ph-2',
    blockId: 'block-2',
    stage: 'Ripening',
    date: '2026-05-26',
    gdd: 1120,
    confidence: 94,
    status: 'confirmed',
    notes: 'Fruit softening fully underway. Berry skin turning translucent.',
    observer: 'Sophia Rossi'
  }
];

export const initialSprayRecords: SprayRecord[] = [
  {
    id: 'spray-1',
    blockId: 'block-1',
    date: '2026-05-18',
    targetProblem: 'Downy mildew prevention',
    productName: 'Valiant Cu-7',
    activeIngredient: 'Copper hydroxide',
    dosePerHa: 2.2,
    waterVolumePerHa: 400,
    totalProductUsed: 10.56,
    totalWaterUsed: 1920,
    operator: 'Nugzar Jincharadze',
    machineryUsed: 'Fendt 207V with Hardi Sprayer',
    windSpeed: 4.5,
    temperature: 19.0,
    humidity: 62,
    preHarvestIntervalDays: 21,
    reEntryIntervalHours: 24,
    notes: 'Successful even coverage. No nozzle clogging reported.'
  },
  {
    id: 'spray-2',
    blockId: 'block-2',
    date: '2026-05-22',
    targetProblem: 'Powdery mildew control',
    productName: 'Kumulus DF',
    activeIngredient: 'Sulfur WG',
    dosePerHa: 4.0,
    waterVolumePerHa: 300,
    totalProductUsed: 12.8,
    totalWaterUsed: 960,
    operator: 'Vano Abashidze',
    machineryUsed: 'John Deere 5075E',
    windSpeed: 6.2,
    temperature: 24.5,
    humidity: 48,
    preHarvestIntervalDays: 14,
    reEntryIntervalHours: 12,
    notes: 'Treated early morning before wind speed increased'
  }
];

export const initialScoutingRecords: ScoutingRecord[] = [
  {
    id: 'scout-1',
    blockId: 'block-1',
    date: '2026-05-25',
    locationDetails: 'Row 12 to 24, upper slope near woods',
    problemType: 'Powdery mildew',
    severity: 'low',
    notes: 'Spotted faint grayish dusting on leaves of 3 vines. No fruit cluster infections yet.',
    recommendedAction: 'Schedule systemic fungicide protectant. Avoid sulfur spray if temperatures exceed 30°C.',
    followUpTaskId: 'task_scout_1'
  },
  {
    id: 'scout-2',
    blockId: 'block-3',
    date: '2026-05-26',
    locationDetails: 'Bottom wet section near creek',
    problemType: 'Water stress',
    severity: 'low',
    notes: 'Tee leaf tips show light yellowing, lower vine leaves show curling. Soil feels aggregate dry.',
    recommendedAction: 'Keep under close review. Traditional non-irrigated rules apply, but canopy looks fine.',
  }
];

export const initialSoilAnalysis: SoilAnalysisRecord[] = [
  {
    id: 'soil-1',
    blockId: 'block-1',
    date: '2025-11-15',
    pH: 6.8,
    organicMatterPct: 2.4,
    nitrogenMgKg: 32,
    phosphorusMgKg: 18,
    potassiumMgKg: 210,
    calciumMgKg: 1450,
    magnesiumMgKg: 180,
    salinityDsm: 0.28,
    notes: 'Excellent nutrient balance. Soil organic matter is within normal range for sustainable viticulture.'
  }
];

export const initialGrapeSamples: GrapeSamplingRecord[] = [
  {
    id: 'sample-1',
    blockId: 'block-1',
    date: '2025-08-24',
    brix: 18.2,
    pH: 3.12,
    totalAcidityGL: 7.8,
    berryWeightG: 1.15,
    phenolicMaturity: 'Incomplete',
    seedColor: 'Green',
    tasteNotes: 'Mouth-puckering green malice, intense fresh herbal berry notes.',
    diseaseCondition: 'No disease, healthy clusters.',
    estimatedHarvestDate: '2025-09-12',
    notes: 'Veraison sample. Tracking initial sugar accumulation.'
  },
  {
    id: 'sample-2',
    blockId: 'block-1',
    date: '2025-08-31',
    brix: 19.8,
    pH: 3.19,
    totalAcidityGL: 7.2,
    berryWeightG: 1.21,
    phenolicMaturity: 'Intermediate',
    seedColor: 'Yellow-brown',
    tasteNotes: 'Acids softening, skins yielding dark fruit flavors like plum.',
    diseaseCondition: 'Healthy clusters.',
    estimatedHarvestDate: '2025-09-12',
    notes: 'Good accumulation rate. Sugar concentration increases steadily.'
  },
  {
    id: 'sample-3',
    blockId: 'block-2',
    date: '2025-08-28',
    brix: 16.5,
    pH: 3.02,
    totalAcidityGL: 9.1,
    berryWeightG: 1.45,
    phenolicMaturity: 'Incomplete',
    seedColor: 'Green',
    tasteNotes: 'Crisp green apple characteristics, sharp acids.',
    diseaseCondition: 'Clean fruit.',
    estimatedHarvestDate: '2025-09-20',
    notes: 'Hillside white variety showing traditional high acids.'
  }
];

export const initialHarvestRecords: HarvestRecord[] = [
  {
    id: 'harv-1',
    blockId: 'block-1',
    variety: 'Saperavi',
    estimatedHarvestDate: '2026-09-12',
    estimatedTons: 38.4,
    pickingMethod: 'hand',
    grapeCondition: 'excellent',
    sentToGvino: false,
    notes: 'Planned for selective sorting crates. Hand pick early morning.'
  },
  {
    id: 'harv-2',
    blockId: 'block-2',
    variety: 'Rkatsiteli',
    estimatedHarvestDate: '2026-09-20',
    estimatedTons: 25.6,
    pickingMethod: 'hand',
    grapeCondition: 'excellent',
    sentToGvino: false,
    notes: 'Rkatsiteli for traditional Qvevri winemaking. Full bunch clusters required.'
  }
];

export const initialIrrigationLogs: IrrigationRecord[] = [
  {
    id: 'irrig-1',
    blockId: 'block-1',
    date: '2026-05-23',
    durationHours: 4,
    waterVolumeLiters: 12000,
    soilMoistureBeforePct: 18,
    soilMoistureAfterPct: 24,
    weatherConditions: 'Dry and hot, 28°C',
    notes: 'Drip system running smoothly.'
  }
];

export const initialFertilizerLogs: FertilizationRecord[] = [
  {
    id: 'fert-1',
    blockId: 'block-1',
    date: '2026-04-10',
    productName: 'Bio-Humus Dynamic',
    dosePerHa: 500, // kg
    totalAmountUsed: 2400,
    applicationMethod: 'Soil broadcast',
    operator: 'Vano Abashidze',
    notes: 'Spring organic compost treatment'
  }
];

export const initialVineaAuditLogs: VineaAuditLog[] = [
  {
    id: 'log-101',
    timestamp: '2026-05-28T18:30:00Z',
    user: 'Luka Tatrishvili',
    module: 'VINEA',
    actionType: 'Platform Initialization',
    changedItem: 'Database System',
    oldValue: 'Legacy Single ERP',
    newValue: 'VINEA Unified Platform',
    notes: 'Rebranded platform database structure to connect Vazi and Gvino modules.'
  },
  {
    id: 'log-102',
    timestamp: '2026-05-28T18:40:00Z',
    user: 'Luka Tatrishvili',
    module: 'VAZI',
    actionType: 'Create Block',
    changedItem: 'Vineyard Blocks',
    oldValue: 'None',
    newValue: 'Ridge Vineyard - East Face',
    notes: 'Initialized new viticulture sector block with coordinate-based microclimate.'
  }
];

