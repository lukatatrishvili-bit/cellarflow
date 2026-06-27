import type {
  CellarOperation,
  DailyFermLog,
  GrapeIntakeRecord,
  GrapeSamplingRecord,
  HarvestRecord,
  InventoryItem,
  IrrigationRecord,
  FertilizationRecord,
  LabAnalysis,
  MaraniOSAuditLog,
  PhenologyRecord,
  SalesDispatchRecord,
  SalesOrderRecord,
  ScoutingRecord,
  SoilAnalysisRecord,
  SprayRecord,
  Task,
  Vessel,
  VineyardBlock,
  WineLot,
} from './wineryState';

export const initialCellarOps: CellarOperation[] = [];

export const initialVessels: Vessel[] = [];
export const initialLots: WineLot[] = [];
export const initialFermLogs: DailyFermLog[] = [];
export const initialLabLogs: LabAnalysis[] = [];
export const initialInventory: InventoryItem[] = [];
export const initialTasks: Task[] = [];
export const initialGrapeIntakes: GrapeIntakeRecord[] = [];
export const initialSalesDispatches: SalesDispatchRecord[] = [];
export const initialSalesOrders: SalesOrderRecord[] = [];

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
