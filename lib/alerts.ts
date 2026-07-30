import type { Vessel, WineLot, DailyFermLog, LabAnalysis, InventoryItem, Task } from './wineryState';
import { isPhysicalFermentationReading } from './fermentationIntegrity';
import type { Language } from './i18n';

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory =
  | 'so2'
  | 'va'
  | 'fermentation'
  | 'temperature'
  | 'cleaning'
  | 'task'
  | 'inventory';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  /** Stable identity used when this alert overlaps a richer AI finding. */
  relatedEntityType?: 'lot' | 'vessel' | 'task' | 'inventory_item';
  relatedEntityId?: string;
  relatedLotId?: string;
  relatedTankId?: string;
}

export interface AlertInputs {
  vessels: Vessel[];
  lots: WineLot[];
  fermLogs: DailyFermLog[];
  labLogs: LabAnalysis[];
  inventory: InventoryItem[];
  tasks: Task[];
  /** ISO yyyy-mm-dd. Injected so the engine stays pure and testable. Defaults to today. */
  today?: string;
  /** Alert text language; only 'ka' has translations, everything else renders English. */
  lang?: Language;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Molecular (active) SO₂ in mg/L from free SO₂ and pH.
 * Bisulfite equilibrium: molecular = free / (1 + 10^(pH − pKa)), with pKa ≈ 1.81.
 * The accepted band for microbial stability is ~0.5–0.8 mg/L molecular SO₂.
 */
export function molecularSO2(freeSo2: number, pH: number): number {
  return freeSo2 / (1 + Math.pow(10, pH - 1.81));
}

/** Most recent row per lotId, compared by ISO date string. */
function latestByLot<T extends { lotId: string; date: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const r of rows) {
    const cur = map.get(r.lotId);
    if (!cur || r.date > cur.date) map.set(r.lotId, r);
  }
  return map;
}

/**
 * Derives the live cellar alert list from current state. Pure function: no
 * side effects, deterministic given `today`.
 */
export function computeAlerts(input: AlertInputs): Alert[] {
  const { vessels, lots, fermLogs, labLogs, inventory, tasks } = input;
  const today = input.today ?? new Date().toISOString().split('T')[0];
  const ka = input.lang === 'ka';
  const alerts: Alert[] = [];
  const lotName = (id: string) => lots.find((l) => l.id === id)?.name ?? id;

  // SO₂ protection + volatile acidity — evaluated on the latest lab per lot.
  for (const lab of latestByLot(labLogs).values()) {
    const mol = molecularSO2(lab.freeSo2, lab.ph);
    if (mol < 0.5) {
      alerts.push({
        id: `so2-${lab.lotId}`,
        severity: mol < 0.35 ? 'critical' : 'warning',
        category: 'so2',
        title: ka
          ? `დაბალი მოლეკულური SO₂ — ${lotName(lab.lotId)}`
          : `Low molecular SO₂ — ${lotName(lab.lotId)}`,
        message: ka
          ? `${mol.toFixed(2)} მგ/ლ მოლეკულური (თავისუფალი ${lab.freeSo2} მგ/ლ, pH ${lab.ph}). სამიზნე ≥ 0.5 მგ/ლ; ჟანგვის / მიკრობული რისკი.`
          : `${mol.toFixed(2)} mg/L molecular (free ${lab.freeSo2} mg/L @ pH ${lab.ph}). Target ≥ 0.5 mg/L; oxidation / microbial risk.`,
        relatedEntityType: 'lot',
        relatedEntityId: lab.lotId,
        relatedLotId: lab.lotId,
        relatedTankId: lab.tankId,
      });
    }
    if (lab.volatileAcid > 0.8) {
      alerts.push({
        id: `va-${lab.lotId}`,
        severity: lab.volatileAcid > 1.2 ? 'critical' : 'warning',
        category: 'va',
        title: ka
          ? `მაღალი აქროლადი მჟავიანობა — ${lotName(lab.lotId)}`
          : `High volatile acidity — ${lotName(lab.lotId)}`,
        message: ka
          ? `VA ${lab.volatileAcid.toFixed(2)} გ/ლ აღემატება 0.8 გ/ლ ზღვარს. შეამოწმეთ ძმარმჟავა გაფუჭებაზე.`
          : `VA ${lab.volatileAcid.toFixed(2)} g/L exceeds the 0.8 g/L threshold. Investigate acetic spoilage.`,
        relatedEntityType: 'lot',
        relatedEntityId: lab.lotId,
        relatedLotId: lab.lotId,
        relatedTankId: lab.tankId,
      });
    }
  }

  // Stuck / sluggish fermentation — density not dropping while sugar remains.
  for (const lot of lots) {
    if (lot.stage !== 'fermenting') continue;
    const logs = fermLogs
      .filter((f) => f.lotId === lot.id && isPhysicalFermentationReading(f))
      .sort((a, b) => b.date.localeCompare(a.date));
    if (logs.length < 2) continue;
    const [latest, prev] = logs;
    const drop = prev.density - latest.density; // positive while actively fermenting
    if (latest.density > 1.0 && drop < 0.002) {
      alerts.push({
        id: `ferm-${lot.id}`,
        severity: latest.density > 1.02 ? 'critical' : 'warning',
        category: 'fermentation',
        title: ka
          ? `ნელი დუღილი — ${lot.name}`
          : `Sluggish fermentation — ${lot.name}`,
        message: ka
          ? `სიმკვრივე გაჩერდა ${latest.density.toFixed(3)}-ზე (Δ ${drop.toFixed(3)} ${prev.date}-დან); დარჩენილია ${latest.sugar} გ/ლ შაქარი. შეამოწმეთ ტემპერატურა და საკვები ნივთიერებები (YAN).`
          : `Density holding at ${latest.density.toFixed(3)} (Δ ${drop.toFixed(3)} since ${prev.date}); ${latest.sugar} g/L sugar remaining. Check temperature & nutrient (YAN).`,
        relatedEntityType: 'lot',
        relatedEntityId: lot.id,
        relatedLotId: lot.id,
        relatedTankId: latest.tankId,
      });
    }
  }

  // Fermenter running above its target temperature.
  for (const v of vessels) {
    if (v.targetTemperature != null && v.currentVolume > 0 && v.temperature > v.targetTemperature + 4) {
      alerts.push({
        id: `temp-${v.id}`,
        severity: v.temperature > v.targetTemperature + 8 ? 'critical' : 'warning',
        category: 'temperature',
        title: ka
          ? `${v.id} სამიზნე ტემპერატურაზე მაღლაა`
          : `${v.id} above target temperature`,
        message: ka
          ? `${v.temperature.toFixed(1)}°C სამიზნე ${v.targetTemperature.toFixed(1)}°C-ის ნაცვლად${v.coolingJacketActive ? '' : ' — გამაგრილებელი პერანგი გამორთულია'}.`
          : `${v.temperature.toFixed(1)}°C vs target ${v.targetTemperature.toFixed(1)}°C${v.coolingJacketActive ? '' : ' — cooling jacket is off'}.`,
        relatedEntityType: 'vessel',
        relatedEntityId: v.id,
        relatedTankId: v.id,
      });
    }
  }

  // Sanitation / CIP overdue.
  for (const v of vessels) {
    if (v.cleaningStatus !== 'clean') {
      alerts.push({
        id: `cip-${v.id}`,
        severity: 'warning',
        category: 'cleaning',
        title: ka
          ? `${v.id} საჭიროებს სანიტარულ დამუშავებას`
          : `${v.id} needs sanitation`,
        message:
          v.cleaningStatus === 'cleaning_needed'
            ? (ka ? `მონიშნულია CIP პროტოკოლისთვის. ბოლო წმენდა: ${v.lastCleaned}.` : `Flagged for CIP protocol. Last cleaned ${v.lastCleaned}.`)
            : (ka ? `მონიშნულია ჭუჭყიანად. ბოლო წმენდა: ${v.lastCleaned}.` : `Marked dirty. Last cleaned ${v.lastCleaned}.`),
        relatedEntityType: 'vessel',
        relatedEntityId: v.id,
        relatedTankId: v.id,
      });
    }
  }

  // Tasks due today / overdue.
  for (const tk of tasks) {
    if (tk.status !== 'pending' || !tk.dueDate) continue;
    if (tk.dueDate < today) {
      alerts.push({
        id: `task-${tk.id}`,
        severity: 'critical',
        category: 'task',
        title: ka ? `ვადაგადაცილებული: ${tk.title}` : `Overdue: ${tk.title}`,
        message: ka
          ? `ვადა იყო ${tk.dueDate} (შემსრულებელი: ${tk.assignedTo}).`
          : `Was due ${tk.dueDate} (assigned to ${tk.assignedTo}).`,
        relatedEntityType: 'task',
        relatedEntityId: tk.id,
      });
    } else if (tk.dueDate === today) {
      alerts.push({
        id: `task-${tk.id}`,
        severity: 'warning',
        category: 'task',
        title: ka ? `დღეს ვადა: ${tk.title}` : `Due today: ${tk.title}`,
        message: ka ? `შემსრულებელი: ${tk.assignedTo}.` : `Assigned to ${tk.assignedTo}.`,
        relatedEntityType: 'task',
        relatedEntityId: tk.id,
      });
    }
  }

  // Inventory at or below reorder threshold.
  for (const item of inventory) {
    if (item.stock <= 0) {
      alerts.push({
        id: `inv-${item.id}`,
        severity: 'critical',
        category: 'inventory',
        title: ka ? `მარაგი ამოიწურა: ${item.name}` : `Out of stock: ${item.name}`,
        message: ka
          ? `დარჩენილია 0 ${item.unit} (მინ. ${item.minThreshold}). შეუკვეთეთ: ${item.supplierName}.`
          : `0 ${item.unit} on hand (min ${item.minThreshold}). Reorder from ${item.supplierName}.`,
        relatedEntityType: 'inventory_item',
        relatedEntityId: item.id,
      });
    } else if (item.stock <= item.minThreshold) {
      alerts.push({
        id: `inv-${item.id}`,
        severity: 'warning',
        category: 'inventory',
        title: ka ? `დაბალი მარაგი: ${item.name}` : `Low stock: ${item.name}`,
        message: ka
          ? `დარჩენილია ${item.stock} ${item.unit} (მინ. ${item.minThreshold}). შეუკვეთეთ: ${item.supplierName}.`
          : `${item.stock} ${item.unit} left (min ${item.minThreshold}). Reorder from ${item.supplierName}.`,
        relatedEntityType: 'inventory_item',
        relatedEntityId: item.id,
      });
    }
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
