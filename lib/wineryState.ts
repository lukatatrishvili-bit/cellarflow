export type VesselType = 'stainless_steel' | 'qvevri' | 'barrel' | 'plastic' | 'concrete' | 'other';
export type WineClass = 'white' | 'red' | 'rose' | 'amber' | 'qvevri' | 'sparkling' | 'fortified' | 'base_wine';
export type WinemakingStage = 'crushing' | 'fermenting' | 'maceration' | 'pressing' | 'aging' | 'stabilization' | 'filtration' | 'bottled' | 'sold';
export type LotClassification = 'PDO' | 'PGI' | 'table_wine' | 'other';
export type CertificationStatus = 'not_started' | 'sample_prepared' | 'submitted' | 'approved' | 'rejected' | 'expired';
export type OriginProofStatus = 'missing' | 'partial' | 'verified';
export type MarketStatus = 'local' | 'export' | 'local_and_export' | 'unknown';
export type WineSugarCategory = 'dry' | 'semi_dry' | 'semi_sweet' | 'sweet';

export interface WineLot {
  id: string; // Lot Code
  /** Durable command that created this lot, when applicable. */
  commandId?: string;
  /** Most recent durable command that changed this lot. */
  lastCommandId?: string;
  lastModified?: string;
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
  intendedAppellation?: string;
  classification?: LotClassification;
  certificationStatus?: CertificationStatus;
  certificateNumber?: string;
  certificateIssueDate?: string;
  certificateExpiryDate?: string;
  certificateFileName?: string;
  originProofStatus?: OriginProofStatus;
  marketStatus?: MarketStatus;
  /** Declared product category by residual sugar for Wine Agency Annex 17. */
  sugarCategory?: WineSugarCategory;
  history: Array<{
    date: string;
    type: string;
    description: string;
    operator: string;
    /** Workflow record that created this timeline event, when reversible. */
    sourceRef?: string;
  }>;
  /** A command-created lot retained as audit evidence after its creating action was reversed. */
  voidedAt?: string;
  voidedByCommandId?: string;
  voidReason?: string;
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
  lastCommandId?: string;
  lastModified?: string;
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
  /** Physical cellar floor used by the visual winery plan. */
  cellarFloorId?: string;
  xGrid?: number; // 0-100 percentage layout position
  yGrid?: number; // 0-100 percentage layout position
  /** Visual model and real-world dimensions shared by the 2D and 3D winery plan. */
  planModel?: VesselPlanModel;
  planWidthMeters?: number;
  planDepthMeters?: number;
  planHeightMeters?: number;
  /** Clearance beneath the vessel body, for legs, stands, or raised equipment. */
  planElevationMeters?: number;
  /** Free-form clockwise rotation used by the 3D editor. */
  planRotationDegrees?: number;
  lastSealedDate?: string; // For Qvevri clay seals
  soilTemperature?: number; // For Qvevri underground soil temps
  qvevriNumber?: string;
  maraniLocation?: string;
  buried?: boolean;
  lastWashingDate?: string;
  limeWashStatus?: 'unknown' | 'needed' | 'done';
  waxingStatus?: 'unknown' | 'needed' | 'done';
  inspectionNotes?: string;
  fillingDate?: string;
  grapeVariety?: string;
  chachaPercentage?: number;
  stemInclusion?: boolean;
  mixingFrequency?: string;
  dailyMixingLog?: Array<{ date: string; action: string; operator?: string; notes?: string }>;
  sealingDate?: string;
  openingDate?: string;
  skinContactDurationDays?: number;
  firstRackingDate?: string;
  sanitationHistory?: Array<{ date: string; action: string; operator?: string; notes?: string }>;
}

/** Exact completion-time facts required to safely compensate a fermentation close. */
export interface FermentationCompletionReversalSnapshot {
  version: 1;
  lot: {
    id: string;
    stage: WinemakingStage;
    currentVolume: number;
    historyDescription: string;
  };
  vessel: {
    id: string;
    currentVolume: number;
    assignedLotId: string | null;
    lastOperation: string;
  };
  finalLog: {
    id: string;
    date: string;
    temperature: number;
    density: number;
    sugar: number;
    ph: number;
    tastingNotes: string;
    capManagement: string;
    additives: string;
  };
  auditId: string;
}

export interface DailyFermLog {
  id: string;
  /** Durable completion command that promoted this reading to final evidence. */
  commandId?: string;
  /** Reversals are compensating ledger facts and not physical measurements. */
  recordKind?: 'reading' | 'completion' | 'reversal';
  lastModified?: string;
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
  /** Structured inventory-backed additions made with this reading. */
  materialsUsed?: OperationMaterialUsage[];
  /** Cellar operation that deducted the structured additions from inventory. */
  linkedOperationId?: string;
  isCompletion?: boolean;
  completedAt?: string;
  completedBy?: string;
  /** Exact before-state captured by transactional completion commands. */
  completionSnapshot?: FermentationCompletionReversalSnapshot;
  reversalOfLogId?: string;
  reversalOfCommandId?: string;
  reversedByCommandId?: string;
  reversedAt?: string;
  reversalReason?: string;
}

export interface TransferVesselReversalSnapshot {
  id: string;
  currentVolume: number;
  assignedLotId: string | null;
  cleaningStatus: Vessel['cleaningStatus'];
  lastOperation: string;
  lastCommandId?: string;
  lastModified?: string;
}

export interface TransferLotReversalSnapshot {
  id: string;
  currentVolume: number;
  lastCommandId?: string;
  lastModified?: string;
}

/** Minimal pre-command state required to compensate a transfer without deleting history. */
export interface TransferReversalSnapshot {
  version: 1;
  sourceVessel: TransferVesselReversalSnapshot;
  destinationVessel: TransferVesselReversalSnapshot;
  sourceLot: TransferLotReversalSnapshot;
  destinationLot?: TransferLotReversalSnapshot;
  createdBlendLotId?: string;
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
  extract?: number;
  density?: number;
  pressure?: number;
  iron?: number;
  copper?: number;
  methanol?: number;
  protocolNumber?: string;
  protocolFileName?: string;
}

export type CertificationProductType = 'wine' | 'sparkling_wine' | 'chacha_spirit' | 'grape_must_juice' | 'fortified_wine';
export type CertificationApplicationStatus = 'draft' | 'ready' | 'submitted' | 'approved' | 'rejected';

export interface CertificationRecord {
  id: string;
  lotId: string;
  bottlingRunId?: string;
  productType: CertificationProductType;
  samplePrepared: boolean;
  sampleDate?: string;
  sampleQuantity?: number;
  labProtocolUploaded: boolean;
  labProtocolFileName?: string;
  organolepticCheckRequired?: boolean;
  organolepticResult?: 'pending' | 'passed' | 'failed' | 'not_required';
  applicationStatus: CertificationApplicationStatus;
  balanceCheckStatus?: 'pending' | 'passed' | 'failed';
  certificateNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  certificateFileName?: string;
  purpose?: 'local_market' | 'export';
  notes?: string;
}

export type DocumentAttachmentModule =
  | 'company'
  | 'official_docs'
  | 'certification'
  | 'cadastre'
  | 'qvevri'
  | 'lab'
  | 'vineyard_project'
  | 'crm'
  | 'other';

export type DocumentAttachmentStorageKind = 'inline' | 'external' | 'metadata_only' | 'gcs';

export interface DocumentAttachment {
  id: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt: string;
  uploadedBy?: string;
  module: DocumentAttachmentModule;
  linkedRecordType?: string;
  linkedRecordId?: string;
  description?: string;
  storage: {
    kind: DocumentAttachmentStorageKind;
    dataUrl?: string;
    url?: string;
    // For kind 'gcs': the object key (bytes live in object storage, not state).
    objectKey?: string;
  };
  checksum?: string;
}

export type CrmLeadStatus = 'new' | 'contacted' | 'qualified' | 'customer' | 'archived';

export interface CrmLeadRecord {
  id: string;
  displayName: string;
  companyName: string;
  wineryName: string;
  region?: string;
  municipality?: string;
  address?: string;
  contactEmail?: string;
  phone?: string;
  website?: string;
  source: string;
  tags: string[];
  notes: string;
  status: CrmLeadStatus;
  createdAt: string;
  updatedAt: string;
  owner?: string;
  lastContactedAt?: string;
}

export interface InventoryItem {
  id: string;
  lastCommandId?: string;
  lastModified?: string;
  name: string;
  category: string; // Dynamic categorie supports, e.g. 'additives', 'yeasts', 'nutritions', 'bottles', etc.
  stock: number; // Current count / weight (kg or units)
  minThreshold: number;
  unit: string;
  costPerUnit: number;
  /** Currency of costPerUnit. Invoice receipts normalize this to the company currency. */
  costCurrency?: string;
  supplierName: string;
  details?: string; // Additional winemaker remarks/specs
  sku?: string;
  brandName?: string;
  manufacturerName?: string;
  packageSize?: number;
  packageUnit?: string;
  activeIngredients?: string[];
  recommendedDosage?: string;
  usageInstructions?: string;
  safetyNotes?: string;
  productSourceUrls?: string[];
  officialSourceUrls?: string[];
  lastInvoiceReceipt?: {
    analysisLineId: string;
    invoiceNumber?: string;
    invoiceDate?: string;
    receivedAt: string;
    supplierName: string;
    quantity: number;
    unit: string;
    unitCost: number;
    lineTotal?: number;
    currency: string;
    sourceUnitCost?: number;
    sourceLineTotal?: number;
    sourceCurrency?: string;
    exchangeRate?: number;
    invoiceReceiptId?: string;
  };
}

export type VesselPlanModel =
  | 'closed_top_jacket'
  | 'closed_top'
  | 'open_top_jacket'
  | 'open_top'
  | 'portable'
  | 'insulated'
  | 'horizontal_tank'
  | 'barrel'
  | 'qvevri'
  | 'concrete'
  | 'plastic';

export interface Task {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  assignedTo: string;
  assignedUserId?: string;
  status: 'pending' | 'completed';
  description: string;
  /** Durable link back to the operational record that created this task. */
  source?: TaskSourceReference;
  notification?: {
    status: 'sending' | 'sent' | 'partial' | 'failed';
    deliveries?: Array<{
      channel: 'email' | 'push';
      status: 'sending' | 'sent' | 'failed';
      attemptCount?: number;
      error?: string;
      updatedAt?: string;
    }>;
    updatedAt: string;
    error?: string;
  };
}

export interface TaskSourceReference {
  type: 'production_plan';
  id: string;
  lotId?: string;
  vesselIds?: string[];
  blockId?: string;
}

export interface TaskAssignmentInput {
  assignedUserId?: string;
  assignedTo?: string;
  notifyAssignee?: boolean;
  source?: TaskSourceReference;
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
  /** Idempotent server command that created this run, when available. */
  commandId?: string;
  /** Reversal entries are compensating ledger facts, not new production. */
  recordKind?: 'bottling' | 'reversal';
  /** Sync timestamp for command-created records. */
  lastModified?: string;
  /** Actual record creation time; legacy runs may only have `date` or a timestamped id. */
  createdAt?: string;
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
  /** Physical vessel debited by this run. New command-created runs always capture it. */
  sourceVesselId?: string;
  previousSourceVesselVolumeL?: number;
  previousSourceVesselAssignedLotId?: string | null;
  previousSourceVesselCleaningStatus?: Vessel['cleaningStatus'];
  previousSourceVesselLastOperation?: string;
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
  /**
   * Authoritative placement history for runs received after bottling. Legacy
   * runs may only expose the singular storage fields above.
   */
  storagePlacements?: Array<{
    movementId: string;
    locationId: string;
    bottles: number;
    date: string;
    commandId?: string;
  }>;
  /** Original bottling run and command compensated by this ledger entry. */
  reversalOfRunId?: string;
  reversalOfCommandId?: string;
  /** Marker placed on the original run after compensation. */
  reversedByCommandId?: string;
  reversedAt?: string;
  reversalReason?: string;
}

export interface CellarTransferRecord {
  id: string;
  /** Idempotent server command that created this movement, when available. */
  commandId?: string;
  /** Reversal entries are compensating ledger facts and are not new physical lineage. */
  recordKind?: 'transfer' | 'reversal';
  /** Sync timestamp for command-created records. */
  lastModified?: string;
  /**
   * Explicit lineage facts captured by the transactional transfer command.
   * Legacy records may omit these fields and are resolved by the lineage
   * engine's compatibility inference.
   */
  lineageVersion?: 1;
  sourceLotId?: string;
  /** Lot already present in the destination vessel before the movement. */
  destinationLotId?: string;
  /** Lot occupying the destination vessel after the movement. */
  resultLotId?: string;
  /** Gross source contribution before process loss. */
  sourceContributionL?: number;
  /** Existing destination-lot contribution used to create a blend. */
  destinationContributionL?: number;
  /** Net liquid arriving in the destination vessel. */
  arrivalVolumeL?: number;
  /** Captured by new transfer commands so compensation can restore exact business state. */
  reversalSnapshot?: TransferReversalSnapshot;
  reversalOfTransferId?: string;
  reversalOfCommandId?: string;
  reversalReason?: string;
  reversedByCommandId?: string;
  reversedAt?: string;
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
  /** Idempotent server command that created this dispatch, when available. */
  commandId?: string;
  /** Reversal entries are compensating financial/stock facts, not new sales. */
  recordKind?: 'dispatch' | 'reversal';
  lastModified?: string;
  date: string;
  customerName: string;
  /** Wine Agency turnover classification for Annex 18. */
  marketChannel?: 'domestic' | 'export';
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
  /** Original dispatch and command compensated by a reversal entry. */
  reversalOfDispatchId?: string;
  reversalOfCommandId?: string;
  /** Marker placed on the original dispatch after compensation. */
  reversedByCommandId?: string;
  reversedAt?: string;
  reversalReason?: string;
  operator: string;
  notes?: string;
}

export type SalesOrderStatus = 'reserved' | 'fulfilled' | 'cancelled';

export interface SalesOrderRecord {
  id: string;
  /** Idempotent server command that created this order, when available. */
  commandId?: string;
  /** Most recent command that changed the order lifecycle. */
  lastCommandId?: string;
  lastModified?: string;
  orderNumber?: string;
  orderDate: string;
  createdAt: string;
  requestedDispatchDate?: string;
  reservedUntil?: string;
  customerName: string;
  /** Carried to the dispatch and Annex 18 when the order is fulfilled. */
  marketChannel?: 'domestic' | 'export';
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
  dispatchId?: string | null;
  fulfilledAt?: string | null;
  cancelledAt?: string;
  cancelledBy?: string;
  /** Fulfilled orders are cancelled, not reopened, when their dispatch is reversed. */
  reversedByCommandId?: string;
  reversedAt?: string;
  reversalReason?: string;
  operator: string;
  notes?: string;
}

export type GrapeSource = 'own' | 'supplier';
export type GrapeIntakeCondition = 'excellent' | 'good' | 'fair' | 'damaged';

/** Exact state captured when a transactional intake is posted. */
export interface HarvestIntakeReversalSnapshot {
  version: 1;
  lot: {
    id: string;
    initialVolume: number;
    currentVolume: number;
    stage: WineLot['stage'];
    historyDescription: string;
  };
  harvest?: {
    id: string;
    sentToGvino: boolean;
    actualHarvestedKg: number | null;
    actualHarvestDate: string | null;
    harvestedAreaHa: number | null;
    associatedLotId: string | null;
  };
  vessel?: {
    id: string;
    currentVolume: number;
    assignedLotId: string | null;
    temperature: number;
    lastOperation: string;
  };
  costEntry?: {
    id: string;
    amount: number;
    currency: string;
    quantity?: number;
  };
  auditId: string;
}

/**
 * Grape receiving / harvest intake (დურდოს მიღება). The single structured entry
 * point for fruit arriving at the marani — whether from an own vineyard block or
 * a third-party supplier. Receiving an intake creates a wine batch (WineLot),
 * optionally fills a destination vessel, and seeds the first fermentation log
 * with the chemistry captured at the weighbridge.
 */
export interface GrapeIntakeRecord {
  id: string;
  commandId?: string;
  /** Reversal entries are compensating ledger facts, not new fruit receipts. */
  recordKind?: 'intake' | 'reversal';
  lastModified?: string;
  reversalSnapshot?: HarvestIntakeReversalSnapshot;
  reversalOfIntakeId?: string;
  reversalOfCommandId?: string;
  reversedByCommandId?: string;
  reversedAt?: string;
  reversalReason?: string;
  date: string;            // intake date (YYYY-MM-DD)
  time?: string;           // optional HH:mm
  source: GrapeSource;
  supplierName?: string;   // when source === 'supplier'
  supplierIdCode?: string;
  blockId?: string;        // when source === 'own'
  blockName?: string;
  transportName?: string;
  transportNumber?: string;
  weighingDocumentNumber?: string;
  labAnalysisNumber?: string;
  cadastralCode?: string;
  village?: string;
  community?: string;
  municipality?: string;
  microzone?: string;
  /** Area actually harvested for this receipt; feeds official Annex 2. */
  harvestedAreaHa?: number;
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
  /** Official/payment-facing grape price. Defaults to costPerKg when available. */
  grapePrice?: number;
  paymentStatus?: 'not_applicable' | 'unpaid' | 'partial' | 'paid';
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
  | 'vessel_filling' | 'bottling' | 'cleaning' | 'correction' | 'topping' | 'custom';

export interface OperationMaterialUsage {
  materialId: string;
  /** Immutable display facts captured when the material is consumed. */
  materialName?: string;
  category?: string;
  quantity: number;
  unit?: string;
  /** Winemaker-entered role such as yeast, starter, nutrient, sulfur, or enzyme. */
  purpose?: string;
}

export interface OperationCostProfile {
  /** Expected hands-on time used to prefill an operation's automatic labor cost. */
  laborHours: number;
  /** Expected electricity use used to prefill an operation's automatic energy cost. */
  energyKwh: number;
}

export interface CostAutomationSettings {
  enabled: boolean;
  laborRatePerHour: number;
  energyRatePerKwh: number;
  overheadPercent: number;
  ownGrapeCostPerKg: number;
  labAnalysisCost: number;
  operationProfiles: Partial<Record<CellarOperationType, OperationCostProfile>>;
}

export interface CellarOperationReversalSnapshotV1 {
  version: 1;
  lot: {
    id: string;
    currentVolume: number;
    stage: WinemakingStage;
  };
  vessel?: {
    id: string;
    currentVolume: number;
    lastOperation: string;
  };
  inventory?: {
    id: string;
    stock: number;
  };
  costEntry?: {
    id: string;
    amount: number;
    currency: string;
    quantity?: number;
  };
  auditId: string;
  operationDescription: string;
}

export interface CellarOperationReversalSnapshotV2 {
  version: 2;
  lot: {
    id: string;
    currentVolume: number;
    stage: WinemakingStage;
  };
  vessel?: {
    id: string;
    currentVolume: number;
    lastOperation: string;
  };
  inventory: Array<{
    id: string;
    stock: number;
  }>;
  costEntries: Array<{
    id: string;
    amount: number;
    currency: string;
    quantity?: number;
  }>;
  auditId: string;
  operationDescription: string;
}

export type CellarOperationReversalSnapshot =
  | CellarOperationReversalSnapshotV1
  | CellarOperationReversalSnapshotV2;

export interface CellarOperation {
  id: string;
  commandId?: string;
  /** Reversal entries are compensating facts, not a second physical treatment. */
  recordKind?: 'operation' | 'reversal';
  lastModified?: string;
  date: string;          // ISO datetime
  type: CellarOperationType;
  customLabel?: string;  // free text when type === 'custom'
  lotId: string;
  lotName: string;
  vesselId?: string | null;
  vesselToId?: string | null;
  /** Topping only: the vessel the make-up wine was drawn from. */
  sourceVesselId?: string | null;
  /**
   * Topping only: litres added. Stored as an amount rather than a resulting
   * total because a lot spread across many barrels is topped one at a time,
   * and `volumeAfterL` describes the lot, not the barrel.
   */
  toppingVolumeL?: number;
  volumeBeforeL?: number;
  volumeAfterL?: number;
  materialId?: string;
  materialName?: string;
  dose?: number;         // amount used, in the material's stock unit
  unit?: string;
  /** One or more inventory-backed materials consumed by this operation. */
  materials?: OperationMaterialUsage[];
  /** Captured cost-driver facts used by automatic costing. */
  laborHours?: number;
  energyKwh?: number;
  operator: string;
  notes: string;
  /** Exact before-state captured by new transactional operation commands. */
  reversalSnapshot?: CellarOperationReversalSnapshot;
  reversalOfOperationId?: string;
  reversalOfCommandId?: string;
  reversedByCommandId?: string;
  reversedAt?: string;
  reversalReason?: string;
}

export interface CellarOperationMeta {
  key: CellarOperationType;
  en: string;
  ka: string;
  /** Material use is common for this operation, so the UI should foreground suggestions. */
  needsMaterial?: boolean;
  /** Typically changes the batch volume (loss or addition). */
  affectsVolume?: boolean;
  /** Moves liquid to a second vessel. */
  needsVesselTo?: boolean;
  /** Draws liquid FROM a second vessel — topping's make-up wine. */
  needsSourceVessel?: boolean;
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
  cadastralCode?: string;
  officialCadastreDocumentName?: string;
  landOwner?: string;
  grower?: string;
  municipality?: string;
  community?: string;
  village?: string;
  microzone?: string;
  parcelName?: string;
  parcelArea?: number;
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
  gpsPolygon?: { lat: number; lng: number }[];
  vineyardCondition?: string;
}

export type VineyardProjectStatus = 'draft' | 'ready' | 'submitted' | 'approved' | 'rejected';

export interface VineyardPlantingProject {
  id: string;
  projectName: string;
  landOwnershipDocumentName?: string;
  cadastralMapDocumentName?: string;
  soilAnalysisDocumentName?: string;
  agrotechnicalQuestionnaireName?: string;
  plannedVarieties: string[];
  rootstock?: string;
  spacing?: string;
  rowDirection?: string;
  irrigationPlan?: string;
  nurseryInvoiceDocumentName?: string;
  applicationStatus: VineyardProjectStatus;
  approvalDate?: string;
  approvalValidUntil?: string;
  soilDepth?: number;
  pH?: number;
  organicMatter?: number;
  caco3?: number;
  texture?: string;
  ec?: number;
  exchangeableCa?: number;
  exchangeableMg?: number;
  exchangeableNa?: number;
  hygroscopicWater?: number;
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
  lastCommandId?: string;
  lastModified?: string;
  blockId: string;
  variety: string;
  estimatedHarvestDate: string;
  estimatedTons: number;
  actualHarvestDate?: string;
  actualHarvestedKg?: number;
  /** Area actually harvested, not the vineyard block's total area. */
  harvestedAreaHa?: number;
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
export type VinOSAuditLog = MaraniOSAuditLog;
export interface MaraniOSAuditLog {
  id: string;
  commandId?: string;
  lastModified?: string;
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
  /** Personal international number; never exposed for other workspace members. */
  phone?: string;
  enabledModules?: string[];
  enabledWidgets?: string[];
  registrationComplete?: boolean;
  /** Server-issued UI capability. Never infer this from role or cached identity. */
  isMasterAdmin?: boolean;
  /** Present only during an audited master-administrator support session. */
  impersonatedBy?: string;
}

export interface CompanyProfile {
  companyName: string;
  wineryName: string;
  country: string;
  region: string;
  municipality: string;
  address: string;
  identificationCode?: string;
  wineAgencyRegistrationCode?: string;
  /** Last producer identity confirmed against the Agency's public directory. */
  wineAgencyVerification?: WineAgencyVerificationEvidence;
  legalAddress?: string;
  factualAddress?: string;
  certificateContactPerson?: string;
  certificatePhone?: string;
  certificateEmail?: string;
  producerRegistrationNotes?: string;
  contactEmail: string;
  phone: string;
  website: string;
  measurementUnits: 'metric' | 'imperial';
  /** ISO-ish currency code for cost accounting (GEL/EUR/USD/…). Defaults to GEL. */
  currency?: string;
  /** Automatic production-cost drivers and rates. Disabled until explicitly enabled. */
  costAutomation?: CostAutomationSettings;
  /**
   * Intelligence-layer settings and winery-specific targets (SO₂ band,
   * fermentation temperature range, VA ceiling, stock cover). Stored loosely so
   * an older client never loses a newer winery's configuration; read it through
   * `resolveAiConfig` in lib/ai/config, never directly.
   */
  aiConfig?: unknown;
  /** Multi-floor physical cellar plan. Existing wineries default to one main floor. */
  cellarFloors?: CellarFloor[];
  latitude?: number;
  longitude?: number;
}

export interface CellarFloor {
  id: string;
  name: string;
  /** Human floor order: basement is commonly -1, ground floor is 0. */
  level: number;
  widthMeters: number;
  heightMeters: number;
  gridMeters: number;
  notes?: string;
  /** Winery-specific spatial objects drawn on this floor's scaled plan. */
  planObjects?: CellarPlanObject[];
}

export type CellarZoneUse =
  | 'general'
  | 'receiving'
  | 'fermentation'
  | 'aging'
  | 'bottling'
  | 'laboratory'
  | 'storage'
  | 'utility';

export type CellarPlanObjectKind =
  | 'zone'
  | 'door'
  | 'drain'
  | 'water'
  | 'power'
  | 'pump'
  | 'press';

export interface CellarPlanObject {
  id: string;
  kind: CellarPlanObjectKind;
  label: string;
  /** Centre point in real-world metres from the plan's top-left corner. */
  xMeters: number;
  yMeters: number;
  /** Physical footprint; zones use both dimensions, fixtures use a compact default. */
  widthMeters: number;
  heightMeters: number;
  /** Clockwise drawing rotation. Kept to right angles for predictable snapping. */
  rotation?: 0 | 90 | 180 | 270;
  zoneUse?: CellarZoneUse;
}

export interface WineAgencyVerificationEvidence {
  registrationNumber: string;
  name: string;
  legalForm?: string;
  identificationCode?: string;
  address?: string;
  website?: string;
  sourceUrl: string;
  verifiedAt: string;
  officialApi: false;
  transport: 'public_html_registry';
}

// Vazi seed datasets also live in ./wineryDefaults.
