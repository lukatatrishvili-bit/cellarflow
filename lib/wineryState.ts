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

export interface BottlingRunRecord {
  id: string;
  lotId: string;
  lotName: string;
  date: string;
  lotNumber: string;
  operator: string;
  formats: Record<string, number>;
  totalBottles: number;
  totalCeramic: number;
  volumeBottledL: number;
  /** Optional restoration metadata for reversing a newly-recorded run. */
  previousLotVolumeL?: number;
  previousLotStage?: WinemakingStage;
  /**
   * Optional packaging materials consumed by the run. Keys are semantic
   * components such as bottle/closure/capsule/label/box, values are inventory IDs.
   */
  packagingMaterialIds?: Partial<Record<'bottle' | 'closure' | 'capsule' | 'label' | 'box', string>>;
  /** Aggregated inventory deduction by inventory item ID. */
  packagingDeductions?: Record<string, number>;
  bottlesPerBox?: number;
  packagingCostTotal?: number;
  bottlingServiceCost?: number;
  storageLocationId?: string;
  storageMovementId?: string;
  placedInStorageBottles?: number;
}

export interface CellarTransferRecord {
  id: string;
  sourceId: string;
  destId: string;
  volume: number;
  loss: number;
  operator: string;
  category: string;
  date: string;
  pump: string;
  details: string;
}

export interface SalesDispatchRecord {
  id: string;
  date: string;
  customerName: string;
  lotId: string;
  lotName: string;
  locationId: string;
  locationName: string;
  bottles: number;
  pricePerBottle: number;
  currency: string;
  revenue: number;
  costPerBottle?: number | null;
  cogs?: number;
  grossProfit?: number;
  marginPct?: number | null;
  stockMovementId: string;
  /** Optional source reservation/order fulfilled by this physical dispatch. */
  salesOrderId?: string;
  operator: string;
  notes?: string;
}

export type SalesOrderStatus = 'reserved' | 'fulfilled' | 'cancelled';

export interface SalesOrderRecord {
  id: string;
  orderNumber?: string;
  orderDate: string;
  createdAt: string;
  requestedDispatchDate?: string;
  reservedUntil?: string;
  customerName: string;
  lotId: string;
  lotName: string;
  locationId: string;
  locationName: string;
  bottles: number;
  pricePerBottle: number;
  currency: string;
  revenue: number;
  costPerBottle?: number | null;
  cogs?: number;
  grossProfit?: number;
  marginPct?: number | null;
  status: SalesOrderStatus;
  dispatchId?: string;
  fulfilledAt?: string;
  cancelledAt?: string;
  operator: string;
  notes?: string;
}

export type GrapeSource = 'own' | 'supplier';
export type GrapeIntakeCondition = 'excellent' | 'good' | 'fair' | 'damaged';

/**
 * Grape receiving / harvest intake (დურდოს მიღება). The single structured entry
 * point for fruit arriving at the marani — whether from an own vineyard block or
 * a third-party supplier. Receiving an intake creates a wine batch (WineLot),
 * optionally fills a destination vessel, and seeds the first fermentation log
 * with the chemistry captured at the weighbridge.
 */
export interface GrapeIntakeRecord {
  id: string;
  date: string;            // intake date (YYYY-MM-DD)
  time?: string;           // optional HH:mm
  source: GrapeSource;
  supplierName?: string;   // when source === 'supplier'
  blockId?: string;        // when source === 'own'
  blockName?: string;
  variety: string;
  vintage: number;
  grossWeightKg: number;
  tareWeightKg: number;
  netWeightKg: number;
  brix: number;            // sugar at receiving
  ph: number;
  titratableAcidity: number; // TA, g/L as tartaric
  temperatureC: number;
  condition: GrapeIntakeCondition;
  pickingMethod: 'hand' | 'machine';
  wineClass: WineClass;
  juiceYieldPct: number;   // expected must/juice yield as % of net weight
  estimatedVolumeL: number;
  /** Optional fruit acquisition/allocation cost captured at receiving. */
  costPerKg?: number;
  /** Optional total fruit cost override; when absent, costPerKg × netWeightKg is used. */
  totalCost?: number;
  /** Currency used for the optional fruit cost. Defaults to the company currency. */
  currency?: string;
  destinationVesselId: string | null;
  createdLotId: string;
  harvestRecordId?: string; // links back to a Vazi HarvestRecord when received from the field
  operator: string;
  notes: string;
}

/** Estimated must/juice volume (L) from net grape weight and a yield %. ~1 kg ≈ 1 L of fruit. */
export function estimateMustVolumeL(netWeightKg: number, juiceYieldPct: number): number {
  if (!(netWeightKg > 0) || !(juiceYieldPct > 0)) return 0;
  return Math.round(netWeightKg * (juiceYieldPct / 100));
}

/** Rough potential alcohol (% vol) from sugar at harvest (°Brix). */
export function brixToPotentialAlcohol(brix: number): number {
  if (!(brix > 0)) return 0;
  return Math.round(brix * 0.59 * 10) / 10;
}

/**
 * Unified cellar operation (ტექნოლოგიური ოპერაცია). The fast-entry log for any
 * winemaking action against a batch — recorded to the lot timeline, with optional
 * inventory deduction (additives), volume adjustment (losses), and vessel context.
 */
export type CellarOperationType =
  | 'crush_destem' | 'pressing' | 'ferment_start' | 'measurement'
  | 'pumpover' | 'punchdown' | 'racking' | 'blending' | 'sulfitation'
  | 'additive' | 'fining' | 'filtration' | 'stabilization'
  | 'vessel_filling' | 'bottling' | 'cleaning' | 'correction' | 'custom';

export interface CellarOperation {
  id: string;
  date: string;          // ISO datetime
  type: CellarOperationType;
  customLabel?: string;  // free text when type === 'custom'
  lotId: string;
  lotName: string;
  vesselId?: string | null;
  vesselToId?: string | null;
  volumeBeforeL?: number;
  volumeAfterL?: number;
  materialId?: string;
  materialName?: string;
  dose?: number;         // amount used, in the material's stock unit
  unit?: string;
  operator: string;
  notes: string;
}

export interface CellarOperationMeta {
  key: CellarOperationType;
  en: string;
  ka: string;
  /** Consumes an inventory material (additive / agent). */
  needsMaterial?: boolean;
  /** Typically changes the batch volume (loss or addition). */
  affectsVolume?: boolean;
  /** Moves liquid to a second vessel. */
  needsVesselTo?: boolean;
}

/** Single source of truth for operation types, shared by the handler and the UI. */
export const CELLAR_OPERATIONS: CellarOperationMeta[] = [
  { key: 'crush_destem', en: 'Crush / destem', ka: 'დაჭყლეტა / დაგრეხა' },
  { key: 'pressing', en: 'Pressing', ka: 'დაწურვა', affectsVolume: true },
  { key: 'ferment_start', en: 'Fermentation start', ka: 'დუღილის დაწყება' },
  { key: 'measurement', en: 'Temp / Brix check', ka: 'ტემპ. / შაქრის გაზომვა' },
  { key: 'pumpover', en: 'Pump-over (remontage)', ka: 'რემონტაჟი (გადატუმბვა)' },
  { key: 'punchdown', en: 'Punch-down', ka: 'ქუდის ჩაწნეხა' },
  { key: 'racking', en: 'Transfer / racking', ka: 'გადაღება', affectsVolume: true, needsVesselTo: true },
  { key: 'blending', en: 'Blending', ka: 'კუპაჟი', affectsVolume: true, needsVesselTo: true },
  { key: 'sulfitation', en: 'Sulfitation (SO₂)', ka: 'სულფიტაცია', needsMaterial: true },
  { key: 'additive', en: 'Additive addition', ka: 'დანამატის დამატება', needsMaterial: true },
  { key: 'fining', en: 'Fining', ka: 'დადარაჯება (გაწმენდა)', needsMaterial: true },
  { key: 'filtration', en: 'Filtration', ka: 'ფილტრაცია', affectsVolume: true },
  { key: 'stabilization', en: 'Stabilization', ka: 'სტაბილიზაცია', needsMaterial: true },
  { key: 'vessel_filling', en: 'Barrel / qvevri filling', ka: 'ჭურჭლის შევსება', needsVesselTo: true },
  { key: 'bottling', en: 'Bottling', ka: 'ჩამოსხმა', affectsVolume: true },
  { key: 'cleaning', en: 'Cleaning / sanitation', ka: 'წმენდა / სანიტარია' },
  { key: 'correction', en: 'Correction', ka: 'კორექცია' },
  { key: 'custom', en: 'Custom operation', ka: 'სხვა ოპერაცია' },
];

/** Deduct an amount from a stock level, clamped at zero and rounded to 3 dp. */
export function deductStock(currentStock: number, amount: number): number {
  const next = (currentStock || 0) - (amount || 0);
  return Math.max(0, Math.round(next * 1000) / 1000);
}

export const initialCellarOps: CellarOperation[] = [];

// Initial dummy data to make the app alive instantly
export const initialVessels: Vessel[] = [];
export const initialLots: WineLot[] = [];
export const initialFermLogs: DailyFermLog[] = [];
export const initialLabLogs: LabAnalysis[] = [];
export const initialInventory: InventoryItem[] = [];
export const initialTasks: Task[] = [];
export const initialGrapeIntakes: GrapeIntakeRecord[] = [];
export const initialSalesDispatches: SalesDispatchRecord[] = [];
export const initialSalesOrders: SalesOrderRecord[] = [];

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
