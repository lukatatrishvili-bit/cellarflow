import { mockData } from './mockData';
import { doc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

// DB Interfaces
export interface Tank {
  id: string;
  name: string;
  type: 'stainless_steel' | 'qvevri' | 'barrel' | 'plastic' | 'concrete' | 'other';
  capacity: number;
  currentVolume: number;
  location: string;
  shape: 'vertical' | 'horizontal' | 'conical' | 'variable_capacity' | 'qvevri' | 'barrel';
  coolingJacket: boolean;
  tempControl: boolean;
  currentTemp: number;
  status: 'empty' | 'occupied' | 'fermenting' | 'storage' | 'cleaning' | 'maintenance';
  currentLotId: string;
  notes: string;
  lastCleaningDate: string;
  lastOperationDate: string;
}

export interface WineLot {
  id: string;
  code: string;
  wineName: string;
  vintage: number;
  variety: string;
  vineyard: string;
  region: string;
  harvestDate: string;
  grapeQuantity: number;
  initialVolume: number;
  currentVolume: number;
  type: 'white' | 'red' | 'rose' | 'amber' | 'sparkling' | 'fortified' | 'base_wine' | 'distillate';
  productionMethod: string;
  stage: 'crushing' | 'fermentation' | 'maceration' | 'pressing' | 'aging' | 'stabilization' | 'filtration' | 'bottling' | 'bottled' | 'sold';
  tanks: string[]; // List of Tank IDs where parts of this lot are stored
  responsibleWinemaker: string;
  notes: string;
}

export interface WineTransfer {
  id: string;
  date: string;
  sourceTankId: string;
  destTankId: string;
  lotId: string;
  volume: number;
  lossVolume: number;
  reason: string;
  pump: string;
  operator: string;
  notes: string;
}

export interface Fermentation {
  id: string;
  lotId: string;
  tankId: string;
  startDate: string;
  yeast: string;
  type: 'alcoholic' | 'malolactic' | 'spontaneous' | 'controlled';
  initialSugar: number; // Brix or density
  tempRange: string;
  targetDryness: number;
  status: 'active' | 'slow' | 'stuck' | 'finished';
  notes: string;
  dailyLogs?: FermentationLog[];
}

export interface FermentationLog {
  id: string;
  fermentationId: string;
  date: string;
  temp: number;
  density: number;
  sugar: number;
  pH: number;
  notes: string;
  capManagement?: string;
  additions?: string;
  problems?: string;
  responsiblePerson?: string;
}

export interface LabResult {
  id: string;
  lotId: string;
  tankId?: string;
  date: string;
  alcohol: number;
  pH: number;
  totalAcidity: number;
  volatileAcidity: number;
  freeSO2: number;
  totalSO2: number;
  residualSugar: number;
  density: number;
  tastingNote: string;
  technician: string;
}

export interface Additive {
  id: string;
  lotId: string;
  tankId?: string;
  date: string;
  productName: string;
  productType: string;
  dose: string;
  totalAmount: number;
  operator: string;
  notes: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  supplier: string;
  quantity: number;
  unit: string;
  minStock: number;
  costPerUnit: number;
  expirationDate: string;
  batchNumber?: string;
  storageLocation?: string;
  notes?: string;
}

export interface BottlingRecord {
  id: string;
  date: string;
  lotId: string;
  sourceTankId: string;
  volume: number;
  bottleSize: string;
  bottleCount: number;
  bottleType: string;
  closureType: string;
  capsuleType: string;
  labelVersion: string;
  boxSize: number;
  operator: string;
  notes: string;
}

export interface BarrelRecord {
  id: string;
  cooper: string;
  volume: number;
  oakOrigin: string;
  toastLevel: string;
  purchaseYear: number;
  fillsCount: number;
  currentLotId: string;
  location: string;
  notes: string;
}

export interface QvevriRecord {
  id: string;
  volume: number;
  location: string;
  isBuried: boolean;
  waxLimeStatus: string;
  currentLotId: string;
  skinContactDuration: string;
  notes: string;
}

export interface CleaningRecord {
  id: string;
  date: string;
  equipmentId: string;
  equipmentType: 'tank' | 'pump' | 'hose' | 'filter' | 'barrel' | 'qvevri' | 'other';
  method: string;
  productUsed: string;
  concentration: string;
  operator: string;
  notes: string;
}

export interface CellarTask {
  id: string;
  title: string;
  relatedType: string;
  relatedId: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedTo: string;
  status: 'pending' | 'completed';
  notes: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  relatedType?: string;
  relatedId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  itemsSupplied: string;
  notes?: string;
}

// Local Database Engine
class LocalDbService {
  private getStorageKey(key: string): string {
    return `vinea_${key}`;
  }

  private getData<T>(key: string, defaultVal: T[]): T[] {
    if (typeof window === 'undefined') return defaultVal;
    try {
      const stored = localStorage.getItem(this.getStorageKey(key));
      if (stored) {
        return JSON.parse(stored) as T[];
      }
      localStorage.setItem(this.getStorageKey(key), JSON.stringify(defaultVal));
      return defaultVal;
    } catch (e) {
      console.error(`Error loading localStorage key: ${key}`, e);
      return defaultVal;
    }
  }

  private saveData<T>(key: string, data: T[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.getStorageKey(key), JSON.stringify(data));
    } catch (e) {
      console.error(`Error saving localStorage key: ${key}`, e);
    }
  }

  // Auditing Helper
  addAuditLog(action: string, details: string, relatedType?: string, relatedId?: string) {
    const logs = this.getData<AuditLog>('auditlogs', mockData.auditLogs as any);
    const newLog: AuditLog = {
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: 'winemaker-01',
      userName: 'Luka Tatrishvili',
      action,
      details,
      relatedType,
      relatedId
    };
    logs.unshift(newLog); // Place newest at top
    this.saveData('auditlogs', logs);
  }

  // Tanks CRUD
  getTanks(): Tank[] {
    return this.getData<Tank>('tanks', mockData.tanks as any);
  }

  async syncTankToFirestore(tank: Tank) {
    if (typeof window === 'undefined') return;
    try {
      const tankRef = doc(db, 'wineries', 'main-winery', 'tanks', tank.id);
      await setDoc(tankRef, tank, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `wineries/main-winery/tanks/${tank.id}`);
    }
  }

  saveTanksInLocalOnly(tanks: Tank[]) {
    this.saveData('tanks', tanks);
  }

  saveTanks(tanks: Tank[]) {
    this.saveData('tanks', tanks);
    tanks.forEach(tank => {
      this.syncTankToFirestore(tank).catch(err => {
        handleFirestoreError(err, OperationType.WRITE, `wineries/main-winery/tanks/${tank.id}`);
      });
    });
  }

  addTank(tank: Omit<Tank, 'id'>): Tank {
    const tanks = this.getTanks();
    const newTank: Tank = {
      ...tank,
      id: `tank-${Date.now()}`
    };
    tanks.push(newTank);
    this.saveTanks(tanks);
    this.addAuditLog('Add Tank', `Created tank ${newTank.name} (Capacity: ${newTank.capacity}L)`, 'tank', newTank.id);
    return newTank;
  }

  updateTank(id: string, updated: Partial<Tank>): Tank {
    const tanks = this.getTanks();
    const index = tanks.findIndex(t => t.id === id);
    if (index === -1) throw new Error('Tank not found');
    
    const original = tanks[index];
    tanks[index] = { ...original, ...updated };
    this.saveTanks(tanks);
    
    this.addAuditLog(
      'Update Tank', 
      `Updated tank ${tanks[index].name}. Changes: ${Object.keys(updated).join(', ')}`, 
      'tank', 
      id
    );
    return tanks[index];
  }

  // Lots CRUD
  getLots(): WineLot[] {
    return this.getData<WineLot>('lots', mockData.lots as any);
  }

  saveLots(lots: WineLot[]) {
    this.saveData('lots', lots);
  }

  addLot(lot: Omit<WineLot, 'id'>): WineLot {
    const lots = this.getLots();
    const newLot: WineLot = {
      ...lot,
      id: `lot-${Date.now()}`
    };
    lots.push(newLot);
    this.saveLots(lots);
    this.addAuditLog('Add Lot', `Created wine lot ${newLot.wineName} (${newLot.code})`, 'lot', newLot.id);
    return newLot;
  }

  updateLot(id: string, updated: Partial<WineLot>): WineLot {
    const lots = this.getLots();
    const index = lots.findIndex(l => l.id === id);
    if (index === -1) throw new Error('Lot not found');
    lots[index] = { ...lots[index], ...updated };
    this.saveLots(lots);
    this.addAuditLog('Update Lot', `Updated wine lot ${lots[index].code}`, 'lot', id);
    return lots[index];
  }

  // Transfers CRUD & Logic
  getTransfers(): WineTransfer[] {
    return this.getData<WineTransfer>('transfers', mockData.transfers as any);
  }

  recordTransfer(transfer: Omit<WineTransfer, 'id'>): WineTransfer {
    const transfers = this.getTransfers();
    const newTransfer: WineTransfer = {
      ...transfer,
      id: `tx-${Date.now()}`
    };

    // Apply Transfer Volumes Logic
    const tanks = this.getTanks();
    const sourceIdx = tanks.findIndex(t => t.id === transfer.sourceTankId);
    const destIdx = tanks.findIndex(t => t.id === transfer.destTankId);

    if (sourceIdx === -1 || destIdx === -1) {
      throw new Error('Source or destination vessel not found');
    }

    const source = tanks[sourceIdx];
    const dest = tanks[destIdx];

    if (source.currentVolume < transfer.volume) {
      throw new Error(`Insufficient volume in source tank ${source.name}. Available: ${source.currentVolume}L`);
    }

    const netTransfer = transfer.volume - (transfer.lossVolume || 0);

    if (dest.capacity < dest.currentVolume + netTransfer) {
      throw new Error(`Destination tank ${dest.name} is too small to receive ${netTransfer}L. Available capacity: ${dest.capacity - dest.currentVolume}L`);
    }

    // Update source
    source.currentVolume -= transfer.volume;
    source.lastOperationDate = transfer.date;
    if (source.currentVolume === 0) {
      source.status = 'empty';
      source.currentLotId = '';
    }

    // Check if it's a blend in destination or destination is empty
    let destinationLotId = source.currentLotId || transfer.lotId;
    if (dest.currentVolume > 0 && dest.currentLotId && dest.currentLotId !== destinationLotId) {
      // It is a blend! Create a blended lot
      const lots = this.getLots();
      const sLot = lots.find(l => l.id === destinationLotId);
      const dLot = lots.find(l => l.id === dest.currentLotId);
      
      const blendName = sLot && dLot ? `Blend: ${sLot.wineName} + ${dLot.wineName}` : 'Cellar Blend';
      const blendCode = `BND-${Math.floor(1000 + Math.random() * 9000)}`;
      
      const blendedLot = this.addLot({
        code: blendCode,
        wineName: blendName,
        vintage: sLot?.vintage || 2024,
        variety: `${sLot?.variety || ''}/${dLot?.variety || ''}`,
        vineyard: `${sLot?.vineyard || ''}/${dLot?.vineyard || ''}`,
        region: sLot?.region || 'Kakheti',
        harvestDate: sLot?.harvestDate || new Date().toISOString().split('T')[0],
        grapeQuantity: (sLot?.grapeQuantity || 0) + (dLot?.grapeQuantity || 0),
        initialVolume: (sLot?.initialVolume || 0) + (dLot?.initialVolume || 0),
        currentVolume: dest.currentVolume + netTransfer,
        type: sLot?.type || 'red',
        productionMethod: 'Blended in Vessel',
        stage: 'aging',
        tanks: [dest.id],
        responsibleWinemaker: 'Luka Tatrishvili',
        notes: `Automatically generated blend. Source proportional components: ${transfer.volume}L of ${sLot?.wineName || 'unknown'} and ${dest.currentVolume}L of ${dLot?.wineName || 'unknown'}`
      });

      destinationLotId = blendedLot.id;
    } else {
      // Just moving a lot, or destination is empty
      const lots = this.getLots();
      const targetLot = lots.find(l => l.id === destinationLotId);
      if (targetLot) {
        // Update lot active tank list
        const currentTanks = targetLot.tanks || [];
        if (!currentTanks.includes(dest.id)) {
          targetLot.tanks = [...currentTanks, dest.id];
        }
        this.saveLots(lots);
      }
    }

    // Update destination tank
    dest.currentVolume += netTransfer;
    dest.currentLotId = destinationLotId;
    dest.status = 'occupied';
    dest.lastOperationDate = transfer.date;

    this.saveTanks(tanks);
    transfers.push(newTransfer);
    this.saveData('transfers', transfers);

    this.addAuditLog(
      'Wine Transfer', 
      `Transferred ${transfer.volume}L from ${source.name} to ${dest.name}. Net received: ${netTransfer}L (Loss: ${transfer.lossVolume}L)`, 
      'transfer', 
      newTransfer.id
    );

    return newTransfer;
  }

  // Fermentations
  getFermentations(): Fermentation[] {
    const list = this.getData<Fermentation>('fermentations', mockData.fermentations as any);
    const allLogs = this.getData<FermentationLog>('fermentation_logs', mockData.fermentationLogs as any);
    return list.map(f => ({
      ...f,
      dailyLogs: allLogs.filter(log => log.fermentationId === f.id)
    }));
  }

  saveFermentations(fermentations: Fermentation[]) {
    this.saveData('fermentations', fermentations);
  }

  addFermentation(ferm: Omit<Fermentation, 'id'>): Fermentation {
    const fermentations = this.getFermentations();
    const newFerm: Fermentation = {
      ...ferm,
      id: `ferm-${Date.now()}`
    };
    fermentations.push(newFerm);
    this.saveFermentations(fermentations);

    // Set destination tank as fermenting
    const tanks = this.getTanks();
    const tankIdx = tanks.findIndex(t => t.id === ferm.tankId);
    if (tankIdx !== -1) {
      tanks[tankIdx].status = 'fermenting';
      this.saveTanks(tanks);
    }

    this.addAuditLog('Start Fermentation', `Initiated fermentation node on Tank ${ferm.tankId}`, 'fermentation', newFerm.id);
    return newFerm;
  }

  updateFermentation(id: string, updated: Partial<Fermentation>): Fermentation {
    const list = this.getFermentations();
    const idx = list.findIndex(f => f.id === id);
    if (idx === -1) throw new Error('Fermentation record not found');
    list[idx] = { ...list[idx], ...updated };
    this.saveFermentations(list);
    this.addAuditLog('Update Fermentation', `Modified fermentation process parameter logs on Tank ${list[idx].tankId}`, 'fermentation', id);
    return list[idx];
  }

  getFermentationLogs(fermentationId: string): FermentationLog[] {
    const allLogs = this.getData<FermentationLog>('fermentation_logs', mockData.fermentationLogs as any);
    return allLogs.filter(log => log.fermentationId === fermentationId).sort((a,b) => b.date.localeCompare(a.date));
  }

  addFermentationLog(log: Omit<FermentationLog, 'id'>): FermentationLog {
    const logs = this.getData<FermentationLog>('fermentation_logs', mockData.fermentationLogs as any);
    const newLog: FermentationLog = {
      ...log,
      id: `log-${Date.now()}`
    };
    logs.push(newLog);
    this.saveData('fermentation_logs', logs);

    // Update current temp on tank
    const fermentations = this.getFermentations();
    const ferm = fermentations.find(f => f.id === log.fermentationId);
    if (ferm) {
      this.updateTank(ferm.tankId, { currentTemp: log.temp });
    }

    this.addAuditLog('Add Fermentation Log', `New daily reading. Temp: ${log.temp}°C, Density: ${log.density}`, 'fermentation', log.fermentationId);
    return newLog;
  }

  // Lab Results CRUD
  getLabResults(): LabResult[] {
    return this.getData<LabResult>('labresults', mockData.labResults as any);
  }

  addLabResult(result: Omit<LabResult, 'id'>): LabResult {
    const results = this.getLabResults();
    const newResult: LabResult = {
      ...result,
      id: `lab-${Date.now()}`
    };
    results.unshift(newResult);
    this.saveData('labresults', results);
    this.addAuditLog('Add Lab Result', `Recorded analytics parameters for Lot ${result.lotId}`, 'lab_result', newResult.id);
    return newResult;
  }

  // Inventory CRUD
  getInventory(): InventoryItem[] {
    return this.getData<InventoryItem>('inventory', mockData.inventory as any);
  }

  saveInventory(items: InventoryItem[]) {
    this.saveData('inventory', items);
  }

  addInventoryItem(item: Omit<InventoryItem, 'id'>): InventoryItem {
    const items = this.getInventory();
    const newItem: InventoryItem = {
      ...item,
      id: `inv-${Date.now()}`
    };
    items.push(newItem);
    this.saveInventory(items);
    this.addAuditLog('Add Inventory Item', `Added warehouse stockpile material: ${newItem.name}`);
    return newItem;
  }

  updateInventoryItem(id: string, updated: Partial<InventoryItem>): InventoryItem {
    const items = this.getInventory();
    const index = items.findIndex(item => item.id === id);
    if (index === -1) throw new Error('Inventory issue not found');
    items[index] = { ...items[index], ...updated };
    this.saveInventory(items);
    this.addAuditLog('Update Inventory', `Adjusted quantity of ${items[index].name} to ${items[index].quantity} ${items[index].unit}`);
    return items[index];
  }

  updateInventoryQuantity(id: string, delta: number): InventoryItem {
    const items = this.getInventory();
    const index = items.findIndex(item => item.id === id);
    if (index === -1) throw new Error('Inventory issue not found');
    items[index].quantity = Math.max(0, items[index].quantity + delta);
    this.saveInventory(items);
    this.addAuditLog('Update Inventory Quantity', `Adjusted quantity of ${items[index].name} by ${delta} to ${items[index].quantity} ${items[index].unit}`);
    return items[index];
  }

  deductInventory(name: string, amtToReduce: number) {
    const items = this.getInventory();
    const item = items.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (item) {
      item.quantity = Math.max(0, item.quantity - amtToReduce);
      this.saveInventory(items);
      this.addAuditLog('Inventory Deduction', `Deducted ${amtToReduce} ${item.unit} of ${item.name} for treatment usage.`);
    }
  }

  // Additives CRUD
  getAdditives(): Additive[] {
    return this.getData<Additive>('additives', (mockData.additives || []) as any);
  }

  addAdditive(additive: Omit<Additive, 'id'>): Additive {
    const additives = this.getAdditives();
    const newAdd: Additive = {
      ...additive,
      id: `add-${Date.now()}`
    };
    additives.unshift(newAdd);
    this.saveData('additives', additives);

    // Deduct stock
    this.deductInventory(additive.productName, additive.totalAmount);

    this.addAuditLog('Add Additive', `Added ${additive.totalAmount}g of ${additive.productName} to Lot ${additive.lotId}`, 'additive', newAdd.id);
    return newAdd;
  }

  // Bottling CRUD
  getBottlings(): BottlingRecord[] {
    return this.getData<BottlingRecord>('bottling', (mockData.bottlings || []) as any);
  }

  recordBottling(bottling: Omit<BottlingRecord, 'id'>): BottlingRecord {
    const bottlings = this.getBottlings();
    const newRecord: BottlingRecord = {
      ...bottling,
      id: `bot-${Date.now()}`
    };

    // Reduce wine from tank
    const tanks = this.getTanks();
    const tankIdx = tanks.findIndex(t => t.id === bottling.sourceTankId);
    if (tankIdx !== -1) {
      const tank = tanks[tankIdx];
      tank.currentVolume = Math.max(0, tank.currentVolume - bottling.volume);
      if (tank.currentVolume === 0) {
        tank.status = 'empty';
        tank.currentLotId = '';
      }
      this.saveTanks(tanks);
    }

    // Set Lot as Bottled
    const lots = this.getLots();
    const lotIdx = lots.findIndex(l => l.id === bottling.lotId);
    if (lotIdx !== -1) {
      lots[lotIdx].stage = 'bottled';
      lots[lotIdx].currentVolume = Math.max(0, lots[lotIdx].currentVolume - bottling.volume);
      this.saveLots(lots);
    }

    // Deduct bottles and corks from inventory!
    this.deductInventory('Burgundy Glass Bottles 0.75L', bottling.bottleCount);
    this.deductInventory('Natural Corks', bottling.bottleCount);

    bottlings.unshift(newRecord);
    this.saveData('bottling', bottlings);

    this.addAuditLog('Bottling Finished', `Bottled ${bottling.bottleCount} units (${bottling.volume}L) from Tank ${bottling.sourceTankId}`, 'bottling', newRecord.id);
    return newRecord;
  }

  // Barrels & Qvevris
  getBarrels(): BarrelRecord[] {
    return this.getData<BarrelRecord>('barrels', mockData.barrels as any);
  }

  getQvevris(): QvevriRecord[] {
    return this.getData<QvevriRecord>('qvevris', mockData.qvevris as any);
  }

  // Cleaning CRUD
  getCleanings(): CleaningRecord[] {
    return this.getData<CleaningRecord>('cleaning', mockData.cleanings as any);
  }

  addCleaning(record: Omit<CleaningRecord, 'id'>): CleaningRecord {
    const list = this.getCleanings();
    const newRec: CleaningRecord = {
      ...record,
      id: `clean-${Date.now()}`
    };
    list.unshift(newRec);
    this.saveData('cleaning', list);

    // Update equipment stats
    if (record.equipmentType === 'tank') {
      this.updateTank(record.equipmentId, { lastCleaningDate: record.date });
    }

    this.addAuditLog('Sanitation Recorded', `Sanitized ${record.equipmentType} [${record.equipmentId}] with ${record.productUsed}`, 'cleaning', newRec.id);
    return newRec;
  }

  // Tasks CRUD
  getTasks(): CellarTask[] {
    return this.getData<CellarTask>('tasks', mockData.tasks as any);
  }

  saveTasks(tasks: CellarTask[]) {
    this.saveData('tasks', tasks);
  }

  addTask(task: Omit<CellarTask, 'id'>): CellarTask {
    const tasks = this.getTasks();
    const newTask: CellarTask = {
      ...task,
      id: `task-${Date.now()}`
    };
    tasks.unshift(newTask);
    this.saveTasks(tasks);
    this.addAuditLog('Add Task', `Created task: ${newTask.title}`, 'task', newTask.id);
    return newTask;
  }

  completeTask(id: string): void {
    const tasks = this.getTasks();
    const idx = tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      tasks[idx].status = 'completed';
      this.saveTasks(tasks);
      this.addAuditLog('Complete Task', `Completed task: ${tasks[idx].title}`, 'task', id);
    }
  }

  // Audit Logs
  getAuditLogs(): AuditLog[] {
    return this.getData<AuditLog>('auditlogs', mockData.auditLogs as any);
  }

  // Reset defaults
  resetToDefaults() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.getStorageKey('tanks'));
    localStorage.removeItem(this.getStorageKey('lots'));
    localStorage.removeItem(this.getStorageKey('transfers'));
    localStorage.removeItem(this.getStorageKey('fermentations'));
    localStorage.removeItem(this.getStorageKey('fermentation_logs'));
    localStorage.removeItem(this.getStorageKey('labresults'));
    localStorage.removeItem(this.getStorageKey('inventory'));
    localStorage.removeItem(this.getStorageKey('additives'));
    localStorage.removeItem(this.getStorageKey('bottling'));
    localStorage.removeItem(this.getStorageKey('cleaning'));
    localStorage.removeItem(this.getStorageKey('tasks'));
    localStorage.removeItem(this.getStorageKey('auditlogs'));
    window.location.reload();
  }
}

export const dbService = new LocalDbService();
export default dbService;
