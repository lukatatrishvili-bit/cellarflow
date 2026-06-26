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
  lastSealedDate?: string; // For Qvevri clay seals
  soilTemperature?: number; // For Qvevri underground soil temps
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
export const initialVessels: Vessel[] = [];
export const initialLots: WineLot[] = [];
export const initialFermLogs: DailyFermLog[] = [];
export const initialLabLogs: LabAnalysis[] = [];
export const initialInventory: InventoryItem[] = [];
export const initialTasks: Task[] = [];

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
export interface MaraniOSAuditLog {
  id: string;
  timestamp: string;
  user: string;
  module: 'MARANIOS' | 'VAZI' | 'GVINO';
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
  enabledModules?: string[];
  enabledWidgets?: string[];
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
  /** ISO-ish currency code for cost accounting (GEL/EUR/USD/…). Defaults to GEL. */
  currency?: string;
  latitude?: number;
  longitude?: number;
}

// ==========================================
// INITIAL VAZI DATASETS
// ==========================================

export const initialVineyardBlocks: VineyardBlock[] = [];
export const initialPhenologyRecords: PhenologyRecord[] = [];
export const initialSprayRecords: SprayRecord[] = [];
export const initialScoutingRecords: ScoutingRecord[] = [];
export const initialSoilAnalysis: SoilAnalysisRecord[] = [];
export const initialGrapeSamples: GrapeSamplingRecord[] = [];
export const initialHarvestRecords: HarvestRecord[] = [];
export const initialIrrigationLogs: IrrigationRecord[] = [];
export const initialFertilizerLogs: FertilizationRecord[] = [];
export const initialMaraniOSAuditLogs: MaraniOSAuditLog[] = [];
