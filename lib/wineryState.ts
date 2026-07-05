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

/**
 * Payment to a grape supplier during rtveli. Settlements are derived, never
 * stored: balance = Σ fruit cost of the supplier's intakes − Σ payments, so the
 * ledger stays truthful when an intake is corrected after the fact.
 */
export type SupplierPaymentMethod = 'cash' | 'bank' | 'other';

export interface SupplierPayment {
  id: string;
  date: string;            // YYYY-MM-DD
  supplierName: string;    // matches GrapeIntakeRecord.supplierName
  amount: number;          // in `currency`
  currency: string;
  method: SupplierPaymentMethod;
  note?: string;
  operator: string;
}

// Cellar-operation runtime helpers (estimateMustVolumeL, brixToPotentialAlcohol,
// CELLAR_OPERATIONS, deductStock) live in ./wineryOperations; this module owns the types.

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

// Empty seed datasets live in ./wineryDefaults (lazy-loaded so they stay out of
// the type-only import graph); this module owns the types.

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
  boundary?: { lat: number; lng: number }[];
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
  /** 1-based position in the tamper-evident organization audit chain. */
  chainSequence?: number;
  /** Hash of the previous canonical audit record, or GENESIS for the first. */
  previousHash?: string;
  /** SHA-256 hash of previousHash + this record's canonical payload. */
  chainHash?: string;
  hashAlgorithm?: 'SHA-256' | string;
  hashCanonicalVersion?: number;
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
  registrationComplete?: boolean;
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

// Vazi seed datasets also live in ./wineryDefaults.
