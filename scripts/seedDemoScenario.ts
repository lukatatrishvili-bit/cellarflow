/**
 * Fills a workspace with a coherent, current Georgian winery scenario.
 *
 * `server/seedTestUser.ts` already creates a baseline, but it is anchored to the
 * 2023/2024 vintages. Demoed today that reads as an abandoned account: lots
 * still "fermenting" two years on, no activity in the current season, and the
 * commercial side (certification, CRM, orders) empty. This layers a present-day
 * story on top of that history rather than replacing it — multi-vintage depth is
 * worth keeping, it just needs a live surface.
 *
 * The scenario is set in early August, roughly six weeks before Rtveli:
 *
 *   - the 2024 vintage has moved on from fermentation to ageing;
 *   - the 2025 vintage is split between bottle, qvevri, and tank;
 *   - the 2026 season is mid-veraison, with maturity sampling climbing toward
 *     harvest and the cellar being prepared for intake;
 *   - certification, export leads, orders, and dispatches give the business
 *     modules something real to show.
 *
 * Idempotent: every record has a fixed id and is replaced rather than appended,
 * so re-running produces the same workspace instead of duplicating it.
 *
 * Usage:
 *   npx tsx scripts/seedDemoScenario.ts [organizationId]
 *
 * Defaults to the organization owned by `testuser1`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAuditHashChain, signAuditEntries } from '../lib/auditHash';
import { applyInvoiceReceiptCommand } from '../lib/commands/invoiceReceipt';
import type { MaraniOSAuditLog } from '../lib/wineryState';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.resolve(__dirname, '..', 'db.json');

/** The scenario's "today". Every date below is relative to this. */
const TODAY = '2026-08-04';
const stamp = (date: string, time = '09:00:00') => `${date}T${time}.000Z`;
const MODIFIED = stamp(TODAY, '07:15:00');

const WINEMAKER = 'ლუკა თათრიშვილი';
const OENOLOGIST = 'ნინო მაისურაძე';
const VITICULTURIST = 'გიორგი კობახიძე';
const AGRONOMIST = 'მარიამ ყიფიანი';

/** Replace records with the same id, keep everything else, newest first. */
function upsert<T extends { id: string }>(existing: T[] | undefined, incoming: T[]): T[] {
  const byId = new Map<string, T>((existing || []).map(item => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// 2025 vintage — in bottle, qvevri, and tank
// ---------------------------------------------------------------------------

const lots2025 = [
  {
    id: 'SAP-25',
    name: 'საფერავი ყვარელი 2025',
    vintage: 2025,
    variety: 'Saperavi / საფერავი',
    vineyardBlock: 'ყვარლის საფერავი - ძველი ნაკვეთი',
    region: 'კახეთი, ყვარელი',
    initialVolume: 6300,
    currentVolume: 0,
    wineClass: 'red',
    stage: 'bottled',
    createdAt: '2025-09-22',
    history: [
      { date: '2025-09-22', type: 'ყურძნის მიღება', description: '9000 კგ საფერავი მიღებულია ძველი ნაკვეთიდან; შაქრიანობა 24.1°Bx, pH 3.61.', operator: WINEMAKER },
      { date: '2025-09-23', type: 'დუღილის დაწყება', description: 'ალკოჰოლური დუღილი დაიწყო ავზში T-101, ქუდის ჩაძირვა დღეში ორჯერ.', operator: WINEMAKER },
      { date: '2025-10-14', type: 'ტექნოლოგიური ოპერაცია', description: 'ვაშლმჟავა-რძემჟავა დუღილი დასრულდა, ღვინო გადაყვანილია დასავარგებლად.', operator: OENOLOGIST },
      { date: '2026-06-11', type: 'ჩამოსხმა', description: '8400 ბოთლი ჩამოისხა და განთავსდა მთავარ საწყობში.', operator: WINEMAKER },
    ],
    sensoryProfile: { tannins: 9, acidity: 6, body: 9, aromatics: 8, wood: 4, fruit: 9 },
    ph: 3.61, ta: 5.9, abv: 14.2, so2Free: 28, so2Total: 78, volatileAcidity: 0.46,
    notes: 'ძლიერი ვინტაჟი — ღრმა ფერი და მკვრივი ტანინი. სექტემბრის სიცხემ შაქრიანობა აწია.',
    lastModified: MODIFIED,
  },
  {
    id: 'RK-25',
    name: 'რქაწითელი ქვევრი 2025',
    vintage: 2025,
    variety: 'Rkatsiteli / რქაწითელი',
    vineyardBlock: 'რქაწითელის ტერასები',
    region: 'კახეთი, ყვარელი',
    initialVolume: 2400,
    currentVolume: 2200,
    wineClass: 'amber',
    stage: 'aging',
    createdAt: '2025-09-28',
    history: [
      { date: '2025-09-28', type: 'ყურძნის მიღება', description: '3400 კგ რქაწითელი; ჭაჭაზე დაყენება ქვევრში Q-01.', operator: WINEMAKER },
      { date: '2025-10-05', type: 'ტექნოლოგიური ოპერაცია', description: 'ქუდის ჩაწევა დღეში სამჯერ, დუღილის ტემპერატურა 26°C-მდე.', operator: WINEMAKER },
      { date: '2026-04-18', type: 'ტექნოლოგიური ოპერაცია', description: 'ქვევრი გაიხსნა, ღვინო გამოცალკევდა ჭაჭისგან და დაბრუნდა დავარგებაზე.', operator: OENOLOGIST },
    ],
    sensoryProfile: { tannins: 6, acidity: 7, body: 7, aromatics: 8, wood: 0, fruit: 7 },
    ph: 3.38, ta: 6.4, abv: 13.1, so2Free: 24, so2Total: 62, volatileAcidity: 0.51,
    notes: 'კლასიკური კახური ტექნოლოგია — ექვსი თვე ჭაჭაზე. ქარვისფერი, მკვეთრი ტანინით.',
    lastModified: MODIFIED,
  },
  {
    id: 'KIS-25',
    name: 'ქისი 2025',
    vintage: 2025,
    variety: 'Kisi / ქისი',
    vineyardBlock: 'ქისის ნაკვეთი',
    region: 'კახეთი, ყვარელი',
    initialVolume: 1000,
    currentVolume: 900,
    wineClass: 'white',
    stage: 'aging',
    createdAt: '2025-09-19',
    history: [
      { date: '2025-09-19', type: 'ყურძნის მიღება', description: '1450 კგ ქისი, ნაზი დაწნეხვა და გაგრილებული დუღილი.', operator: WINEMAKER },
      { date: '2026-03-02', type: 'ლაბორატორიული კონტროლი', description: 'სტაბილურობის შემოწმება ჩამოსხმის წინ.', operator: OENOLOGIST },
    ],
    sensoryProfile: { tannins: 2, acidity: 8, body: 5, aromatics: 9, wood: 0, fruit: 8 },
    ph: 3.24, ta: 7.1, abv: 12.6, so2Free: 31, so2Total: 88, volatileAcidity: 0.32,
    notes: 'არომატული და მაღალმჟავიანი. იგეგმება ჩამოსხმა შემოდგომაზე.',
    lastModified: MODIFIED,
  },
];

// ---------------------------------------------------------------------------
// 2026 season — veraison and the run-up to harvest
// ---------------------------------------------------------------------------

const phenology2026 = [
  { id: 'PH-2026-B-01', blockId: 'B-01', stage: 'შეთვალება (ვერაისონი)', date: '2026-07-26', gdd: 1180, confidence: 94, status: 'confirmed', notes: 'მტევნების დაახლოებით 70% შეთვალებულია, ერთგვაროვანი მიმდინარეობა.', observer: AGRONOMIST, lastModified: MODIFIED },
  { id: 'PH-2026-B-02', blockId: 'B-02', stage: 'შეთვალება (ვერაისონი)', date: '2026-07-30', gdd: 1145, confidence: 90, status: 'confirmed', notes: 'რქაწითელი ოდნავ ჩამორჩება საფერავს, რაც ჩვეულებრივია ამ ტერასებზე.', observer: AGRONOMIST, lastModified: MODIFIED },
  { id: 'PH-2026-B-04', blockId: 'B-04', stage: 'მარცვლის ზრდა', date: '2026-07-22', gdd: 1090, confidence: 88, status: 'confirmed', notes: 'ქისი ნორმალურ ფაზაშია, დატვირთვა საშუალო.', observer: AGRONOMIST, lastModified: MODIFIED },
];

const samplings2026 = [
  { id: 'samp-2026-01', blockId: 'B-01', date: '2026-07-21', brix: 16.4, pH: 3.12, totalAcidityGL: 11.2, berryWeightG: 1.18, phenolicMaturity: 'Developing', seedColor: 'Green-brown', tasteNotes: 'მარცვალი ჯერ მჟავეა, კანი მკვრივი.', diseaseCondition: 'სუფთა', estimatedHarvestDate: '2026-09-20', notes: 'სეზონის პირველი სინჯი შეთვალების დაწყებისას.', lastModified: MODIFIED },
  { id: 'samp-2026-02', blockId: 'B-01', date: '2026-07-28', brix: 18.1, pH: 3.24, totalAcidityGL: 9.6, berryWeightG: 1.27, phenolicMaturity: 'Developing', seedColor: 'Brown', tasteNotes: 'შაქრის მატება სტაბილურია, მჟავიანობა ეცემა მოსალოდნელი ტემპით.', diseaseCondition: 'სუფთა', estimatedHarvestDate: '2026-09-19', notes: 'ყოველკვირეული მონიტორინგი გრძელდება.', lastModified: MODIFIED },
  { id: 'samp-2026-03', blockId: 'B-01', date: '2026-08-03', brix: 19.6, pH: 3.31, totalAcidityGL: 8.7, berryWeightG: 1.33, phenolicMaturity: 'Advancing', seedColor: 'Brown', tasteNotes: 'ჯიშური არომატი იკვეთება, კანის ტანინი რბილდება.', diseaseCondition: 'სუფთა', estimatedHarvestDate: '2026-09-18', notes: 'ტემპით მივყავართ 23-24°Bx-მდე სექტემბრის მესამე კვირისთვის.', lastModified: MODIFIED },
  { id: 'samp-2026-04', blockId: 'B-02', date: '2026-08-03', brix: 17.9, pH: 3.18, totalAcidityGL: 9.1, berryWeightG: 1.62, phenolicMaturity: 'Developing', seedColor: 'Green-brown', tasteNotes: 'რქაწითელი სუფთაა, კანი თხელი.', diseaseCondition: 'სუფთა', estimatedHarvestDate: '2026-09-26', notes: 'ქარვისფერი პარტიისთვის სამიზნეა 21-22°Bx.', lastModified: MODIFIED },
];

const sprays2026 = [
  { id: 'SP-2026-B-01-06', blockId: 'B-01', date: '2026-06-24', targetProblem: 'ნაცრის პრევენცია', productName: 'გოგირდი 80 WG', activeIngredient: 'გოგირდი', dosePerHa: 3, waterVolumePerHa: 600, totalProductUsed: 7.5, totalWaterUsed: 1500, operator: VITICULTURIST, machineryUsed: 'ვენახის მისაბმელი შემასხურებელი', windSpeed: 5, temperature: 26, humidity: 55, preHarvestIntervalDays: 56, reEntryIntervalHours: 24, notes: 'პროფილაქტიკური დამუშავება ყვავილობის შემდეგ.', lastModified: MODIFIED },
  { id: 'SP-2026-B-01-07', blockId: 'B-01', date: '2026-07-15', targetProblem: 'ჭრაქის პრევენცია', productName: 'ბორდოს ხსნარი', activeIngredient: 'სპილენძი', dosePerHa: 2.2, waterVolumePerHa: 600, totalProductUsed: 5.5, totalWaterUsed: 1500, operator: VITICULTURIST, machineryUsed: 'ვენახის მისაბმელი შემასხურებელი', windSpeed: 4, temperature: 28, humidity: 60, preHarvestIntervalDays: 35, reEntryIntervalHours: 24, notes: 'ბოლო სპილენძიანი დამუშავება მოსავლის წინ — ლოდინის ვადა დაცულია.', lastModified: MODIFIED },
  { id: 'SP-2026-B-02-07', blockId: 'B-02', date: '2026-07-16', targetProblem: 'ნაცრის პრევენცია', productName: 'გოგირდი 80 WG', activeIngredient: 'გოგირდი', dosePerHa: 3, waterVolumePerHa: 600, totalProductUsed: 9.6, totalWaterUsed: 1920, operator: VITICULTURIST, machineryUsed: 'ვენახის მისაბმელი შემასხურებელი', windSpeed: 6, temperature: 27, humidity: 58, preHarvestIntervalDays: 56, reEntryIntervalHours: 24, notes: 'რქაწითელის ტერასები, დილის დამუშავება.', lastModified: MODIFIED },
];

const harvestPlan2026 = [
  { id: 'harv-2026-01', blockId: 'B-01', variety: 'Saperavi / საფერავი', estimatedHarvestDate: '2026-09-18', estimatedTons: 9.2, pickingMethod: 'hand', grapeCondition: 'excellent', destinationWinery: 'კვარლის მარანი', sentToGvino: false, notes: 'დაგეგმილი მოსავალი — საჭიროა 500+ ყუთი და 12 კაციანი ბრიგადა.', lastModified: MODIFIED },
  { id: 'harv-2026-02', blockId: 'B-02', variety: 'Rkatsiteli / რქაწითელი', estimatedHarvestDate: '2026-09-26', estimatedTons: 11.5, pickingMethod: 'hand', grapeCondition: 'excellent', destinationWinery: 'კვარლის მარანი', sentToGvino: false, notes: 'ქვევრის პარტიისთვის — მოკრეფა დილის სიგრილეში.', lastModified: MODIFIED },
  { id: 'harv-2026-03', blockId: 'B-04', variety: 'Kisi / ქისი', estimatedHarvestDate: '2026-09-12', estimatedTons: 4.1, pickingMethod: 'hand', grapeCondition: 'good', destinationWinery: 'კვარლის მარანი', sentToGvino: false, notes: 'ქისი პირველი შედის — არომატის შესანარჩუნებლად ადრეული კრეფა.', lastModified: MODIFIED },
];

// ---------------------------------------------------------------------------
// Cellar work and current tasks
// ---------------------------------------------------------------------------

const tasks2026 = [
  { id: 'task-2026-01', title: 'ქვევრების გაწმენდა და მოვლა რთველისთვის', priority: 'high', dueDate: '2026-08-14', assignedTo: WINEMAKER, status: 'pending', description: 'Q-02, Q-03, Q-04 გაიწმინდოს კირით და შემოწმდეს ჰერმეტულობა რთველამდე.', lastModified: MODIFIED },
  { id: 'task-2026-02', title: 'ბოთლებისა და საცობების შეკვეთა', priority: 'high', dueDate: '2026-08-10', assignedTo: WINEMAKER, status: 'pending', description: 'მარაგი 750მლ ბოთლებზე კრიტიკულ ზღვარზეა. საჭიროა 6000 ცალი შემოდგომის ჩამოსხმისთვის.', lastModified: MODIFIED },
  { id: 'task-2026-03', title: 'სიმწიფის ყოველკვირეული სინჯი — საფერავი', priority: 'medium', dueDate: '2026-08-10', assignedTo: AGRONOMIST, status: 'pending', description: 'B-01 ნაკვეთი: შაქრიანობა, pH და მჟავიანობა. შედეგები დაუკავშირდეს რთველის გეგმას.', lastModified: MODIFIED },
  { id: 'task-2026-04', title: 'რთველის ბრიგადის დაკომპლექტება', priority: 'high', dueDate: '2026-08-28', assignedTo: VITICULTURIST, status: 'pending', description: '12 მკრეფავი სექტემბრის მესამე კვირისთვის; ტრანსპორტი და კვება შეთანხმდეს.', lastModified: MODIFIED },
  { id: 'task-2026-05', title: 'პრესისა და ტუმბოს ტექნიკური შემოწმება', priority: 'medium', dueDate: '2026-09-01', assignedTo: WINEMAKER, status: 'pending', description: 'Enopump E-400 და პნევმატური პრესი — სერვისი და სათადარიგო ნაწილები.', lastModified: MODIFIED },
  { id: 'task-2026-06', title: 'SO2 კორექცია RK-25 ქვევრში', priority: 'medium', dueDate: '2026-08-07', assignedTo: OENOLOGIST, status: 'pending', description: 'თავისუფალი SO2 ჩამოვიდა 24 მგ/ლ-მდე. კორექცია 35 მგ/ლ-მდე.', lastModified: MODIFIED },
  { id: 'task-2026-07', title: 'PDO სერტიფიკატის განაცხადი — საფერავი 2025', priority: 'high', dueDate: '2026-08-20', assignedTo: WINEMAKER, status: 'pending', description: 'ლაბორატორიული ოქმი მზადაა, საჭიროა ორგანოლეპტიკური კომისიის ჩანიშვნა.', lastModified: MODIFIED },
  { id: 'task-2026-08', title: 'ექსპორტის შეკვეთის მომზადება — პოლონეთი', priority: 'medium', dueDate: '2026-08-18', assignedTo: WINEMAKER, status: 'pending', description: '2400 ბოთლი საფერავი 2025; საჭიროა ეტიკეტების შეთანხმება და ზედნადები.', lastModified: MODIFIED },
];

const cellarOps2026 = [
  { id: 'OP-2026-RK25-RACK', date: stamp('2026-04-18', '10:30:00'), type: 'racking', lotId: 'RK-25', lotName: 'რქაწითელი ქვევრი 2025', vesselId: 'Q-01', volumeBeforeL: 2400, volumeAfterL: 2200, operator: WINEMAKER, notes: 'ქვევრიდან ჭაჭის გამოცალკევება, დანაკარგი 200 ლ.', lastModified: MODIFIED },
  { id: 'OP-2026-KIS25-SO2', date: stamp('2026-06-02', '11:00:00'), type: 'sulfitation', lotId: 'KIS-25', lotName: 'ქისი 2025', vesselId: 'T-105', volumeBeforeL: 900, volumeAfterL: 900, materialId: 'INV-KMBS', materialName: 'კალიუმის მეტაბისულფიტი', dose: 0.045, unit: 'კგ', operator: OENOLOGIST, notes: 'თავისუფალი SO2 აყვანილია 31 მგ/ლ-მდე დავარგებისთვის.', lastModified: MODIFIED },
  { id: 'OP-2026-SAP25-BOTTLE', date: stamp('2026-06-11', '08:00:00'), type: 'bottling', lotId: 'SAP-25', lotName: 'საფერავი ყვარელი 2025', vesselId: 'T-101', volumeBeforeL: 6300, volumeAfterL: 0, operator: WINEMAKER, notes: '8400 ბოთლი ჩამოისხა, პარტია გადავიდა საწყობში.', lastModified: MODIFIED },
  { id: 'OP-2026-RK25-TOP', date: stamp('2026-07-20', '16:00:00'), type: 'custom', lotId: 'RK-25', lotName: 'რქაწითელი ქვევრი 2025', vesselId: 'Q-01', volumeBeforeL: 2185, volumeAfterL: 2200, operator: WINEMAKER, notes: 'აორთქლების შევსება, ჟანგბადთან კონტაქტის შემცირება.', lastModified: MODIFIED },
];

const labLogs2026 = [
  { id: 'LAB-RK-25-07', lotId: 'RK-25', tankId: 'Q-01', date: '2026-07-20', alcoholPct: 13.1, volatileAcid: 0.51, freeSo2: 24, totalSo2: 62, residualSugar: 1.4, ph: 3.38, malicAcid: 0.1, lacticAcid: 1.8, turbidity: 22, technician: OENOLOGIST, titratableAcidity: 6.4, lastModified: MODIFIED },
  { id: 'LAB-KIS-25-07', lotId: 'KIS-25', tankId: 'T-105', date: '2026-07-21', alcoholPct: 12.6, volatileAcid: 0.32, freeSo2: 31, totalSo2: 88, residualSugar: 1.1, ph: 3.24, malicAcid: 1.6, lacticAcid: 0.2, turbidity: 8, technician: OENOLOGIST, titratableAcidity: 7.1, lastModified: MODIFIED },
  { id: 'LAB-SAP-25-06', lotId: 'SAP-25', tankId: 'T-101', date: '2026-06-09', alcoholPct: 14.2, volatileAcid: 0.46, freeSo2: 28, totalSo2: 78, residualSugar: 1.8, ph: 3.61, malicAcid: 0.1, lacticAcid: 1.5, turbidity: 6, technician: OENOLOGIST, titratableAcidity: 5.9, lastModified: MODIFIED },
  { id: 'LAB-RK-25-08', lotId: 'RK-25', tankId: 'Q-01', date: '2026-08-03', alcoholPct: 13.1, volatileAcid: 0.53, freeSo2: 22, totalSo2: 60, residualSugar: 1.4, ph: 3.39, malicAcid: 0.1, lacticAcid: 1.8, turbidity: 20, technician: OENOLOGIST, titratableAcidity: 6.3, lastModified: MODIFIED },
];

const notes2026 = [
  { id: 'note-2026-01', title: 'რქაწითელი 2025 — ქარვისფერი პროფილი', date: '2026-07-20', author: OENOLOGIST, category: 'Tasting', relatedLotId: 'RK-25', content: 'გამომხატული ჩირისა და შავი ჩაის ტონები, ტანინი მკვეთრი მაგრამ სუფთა. ექვსთვიანმა ჭაჭაზე დაყოვნებამ სტრუქტურა მისცა. რეკომენდაცია: ჩამოსხმა გაზაფხულზე.', lastModified: MODIFIED },
  { id: 'note-2026-02', title: 'საფერავი 2025 — ჩამოსხმის შემდგომი შეფასება', date: '2026-06-20', author: WINEMAKER, category: 'Tasting', relatedLotId: 'SAP-25', content: 'ბოთლში ჩამოსხმიდან ერთი კვირის შემდეგ ღვინო ოდნავ დახურულია, რაც მოსალოდნელი იყო. ფერი ღრმა, ტანინი მკვრივი. სარეალიზაციოდ მზადაა შემოდგომიდან.', lastModified: MODIFIED },
  { id: 'note-2026-03', title: 'სეზონის მიმდინარეობა — შეთვალება', date: '2026-07-28', author: AGRONOMIST, category: 'General', content: 'შეთვალება ერთი კვირით ადრე დაიწყო შარშანდელთან შედარებით. ივლისის სიცხე მაღალი იყო, მაგრამ ღამის ტემპერატურა დაბალი რჩება — მჟავიანობა კარგად ნარჩუნდება.', lastModified: MODIFIED },
  { id: 'note-2026-04', title: 'ქვევრების მდგომარეობა რთველის წინ', date: '2026-08-02', author: WINEMAKER, category: 'Sanitation', content: 'Q-02 და Q-03 გაწმენდილია. Q-04-ზე შესამოწმებელია ყელის ჰერმეტულობა — შესაძლოა საჭირო გახდეს ცვილის განახლება.', lastModified: MODIFIED },
];

// ---------------------------------------------------------------------------
// Commercial: certification, export leads, orders
// ---------------------------------------------------------------------------

const certifications = [
  { id: 'cert-sap-24', lotId: 'SAP-24', productType: 'wine', samplePrepared: true, sampleDate: '2025-04-14', sampleQuantity: 3, labProtocolUploaded: true, labProtocolFileName: 'saperavi-2024-lab.pdf', organolepticCheckRequired: true, organolepticResult: 'passed', applicationStatus: 'approved', balanceCheckStatus: 'passed', certificateNumber: 'PDO-KV-2025-0114', issueDate: '2025-05-06', expiryDate: '2028-05-06', purpose: 'export', notes: 'ყვარლის PDO — დამტკიცებულია ექსპორტისთვის.', lastModified: MODIFIED },
  { id: 'cert-rk-23', lotId: 'RK-23', productType: 'wine', samplePrepared: true, sampleDate: '2024-02-20', sampleQuantity: 3, labProtocolUploaded: true, labProtocolFileName: 'rkatsiteli-2023-lab.pdf', organolepticCheckRequired: true, organolepticResult: 'passed', applicationStatus: 'approved', balanceCheckStatus: 'passed', certificateNumber: 'PDO-KV-2024-0087', issueDate: '2024-03-11', expiryDate: '2027-03-11', purpose: 'export', notes: 'ქარვისფერი ღვინის სერტიფიკატი — ექსპორტი პოლონეთში.', lastModified: MODIFIED },
  { id: 'cert-sap-25', lotId: 'SAP-25', productType: 'wine', samplePrepared: true, sampleDate: '2026-07-15', sampleQuantity: 3, labProtocolUploaded: true, labProtocolFileName: 'saperavi-2025-lab.pdf', organolepticCheckRequired: true, organolepticResult: 'pending', applicationStatus: 'submitted', balanceCheckStatus: 'passed', purpose: 'export', notes: 'ორგანოლეპტიკური კომისია ჩანიშნულია აგვისტოს მეორე ნახევარში.', lastModified: MODIFIED },
];

const crmLeads = [
  { id: 'lead-pl-01', displayName: 'Marek Zieliński', companyName: 'Wina Gruzji Sp. z o.o.', wineryName: 'კვარლის მარანი', region: 'Mazowieckie', municipality: 'Warszawa', contactEmail: 'marek@winagruzji.pl', phone: '+48 22 555 0134', website: 'https://winagruzji.pl', source: 'ProWein 2026', tags: ['export', 'distributor', 'poland'], notes: 'დაინტერესებულია ქარვისფერი ღვინოებით. მოითხოვა 2400 ბოთლის შეთავაზება საფერავზე.', status: 'qualified', createdAt: stamp('2026-03-19'), updatedAt: stamp('2026-07-29'), owner: WINEMAKER, lastContactedAt: stamp('2026-07-29'), lastModified: MODIFIED },
  { id: 'lead-de-01', displayName: 'Anja Bergmann', companyName: 'Kaukasus Weinhandel GmbH', wineryName: 'კვარლის მარანი', region: 'Bayern', municipality: 'München', contactEmail: 'a.bergmann@kaukasus-wein.de', phone: '+49 89 5550 221', website: 'https://kaukasus-wein.de', source: 'ვებგვერდის ფორმა', tags: ['export', 'germany', 'organic'], notes: 'ორგანულ სერტიფიცირებას ითხოვს. ნიმუშები გაიგზავნა ივნისში.', status: 'qualified', createdAt: stamp('2026-05-07'), updatedAt: stamp('2026-06-24'), owner: WINEMAKER, lastContactedAt: stamp('2026-06-24'), lastModified: MODIFIED },
  { id: 'lead-jp-01', displayName: '田中 健一', companyName: 'Tokyo Wine Imports K.K.', wineryName: 'კვარლის მარანი', region: 'Kantō', municipality: 'Tokyo', contactEmail: 'tanaka@tokyowine.jp', source: 'Wine Expo Tbilisi', tags: ['export', 'japan', 'qvevri'], notes: 'ქვევრის ღვინოებით დაინტერესება. ითხოვს ტექნოლოგიის აღწერას ეტიკეტისთვის.', status: 'contacted', createdAt: stamp('2026-06-12'), updatedAt: stamp('2026-07-02'), owner: OENOLOGIST, lastContactedAt: stamp('2026-07-02'), lastModified: MODIFIED },
  { id: 'lead-ge-01', displayName: 'ნინო ბერიძე', companyName: 'ღვინის სახლი თბილისი', wineryName: 'კვარლის მარანი', region: 'თბილისი', municipality: 'თბილისი', contactEmail: 'nino@ghvinissakhli.ge', phone: '+995 32 255 0177', source: 'რეკომენდაცია', tags: ['local', 'horeca'], notes: 'რესტორნების ქსელი — ინტერესი ქისზე და მწვანეზე.', status: 'customer', createdAt: stamp('2026-01-22'), updatedAt: stamp('2026-05-15'), owner: WINEMAKER, lastContactedAt: stamp('2026-05-15'), lastModified: MODIFIED },
];

const salesOrders2026 = [
  { id: 'ord-2026-01', orderNumber: 'ORD-2026-014', orderDate: '2026-05-12', createdAt: stamp('2026-05-12'), requestedDispatchDate: '2026-05-20', customerName: 'ღვინის სახლი თბილისი', lotId: 'RK-23', lotName: 'რქაწითელი ქვევრი 2023', locationId: 'SL-QVEVRI', locationName: 'ქვევრის დარბაზის საწყობი', bottles: 480, pricePerBottle: 32, currency: 'GEL', revenue: 15360, costPerBottle: 8.4, cogs: 4032, grossProfit: 11328, marginPct: 73.8, status: 'fulfilled', dispatchId: 'disp-2026-01', fulfilledAt: stamp('2026-05-20'), operator: WINEMAKER, notes: 'HoReCa შეკვეთა — თბილისის რესტორნების ქსელი.', lastModified: MODIFIED },
  { id: 'ord-2026-02', orderNumber: 'ORD-2026-021', orderDate: '2026-07-29', createdAt: stamp('2026-07-29'), requestedDispatchDate: '2026-08-22', customerName: 'Wina Gruzji Sp. z o.o.', lotId: 'SAP-25', lotName: 'საფერავი ყვარელი 2025', locationId: 'SL-MAIN', locationName: 'მთავარი ბოთლების საწყობი', bottles: 2400, pricePerBottle: 21, currency: 'GEL', revenue: 50400, costPerBottle: 7.8, cogs: 18720, grossProfit: 31680, marginPct: 62.9, status: 'reserved', operator: WINEMAKER, notes: 'ექსპორტი პოლონეთში. ელოდება PDO სერტიფიკატს გაგზავნამდე.', lastModified: MODIFIED },
];

const salesDispatches2026 = [
  { id: 'disp-2026-01', date: '2026-05-20', customerName: 'ღვინის სახლი თბილისი', lotId: 'RK-23', lotName: 'რქაწითელი ქვევრი 2023', locationId: 'SL-QVEVRI', locationName: 'ქვევრის დარბაზის საწყობი', bottles: 480, pricePerBottle: 32, currency: 'GEL', revenue: 15360, costPerBottle: 8.4, cogs: 4032, grossProfit: 11328, marginPct: 73.8, stockMovementId: 'sm-2026-02', salesOrderId: 'ord-2026-01', operator: WINEMAKER, notes: 'მიწოდება დასრულდა, ზედნადები #TB-2026-0512.', lastModified: MODIFIED },
];

const stockMovements2026 = [
  { id: 'sm-2026-01', date: '2026-06-11', lotId: 'SAP-25', locationId: 'SL-MAIN', direction: 'in', bottles: 8400, reason: 'bottling', sourceRef: 'bot-2026-01', note: 'საფერავი 2025 ჩამოსხმის მიღება მთავარ საწყობში.', lastModified: MODIFIED },
  { id: 'sm-2026-02', date: '2026-05-20', lotId: 'RK-23', locationId: 'SL-QVEVRI', direction: 'out', bottles: 480, reason: 'sale', sourceRef: 'disp-2026-01', note: 'გაცემა თბილისის შეკვეთაზე.', lastModified: MODIFIED },
];

const bottlingRuns2026 = [
  { id: 'bot-2026-01', lotId: 'SAP-25', lotName: 'საფერავი ყვარელი 2025', date: '2026-06-11', lotNumber: 'KV-SAP-25-001', operator: WINEMAKER, formats: { '750ml': 8400 }, totalBottles: 8400, totalCeramic: 0, volumeBottledL: 6300, packagingMaterialIds: { bottle: 'INV-BOTTLE-750', closure: 'INV-CORK', label: 'INV-LABEL', box: 'INV-BOX' }, packagingDeductions: { 'INV-BOTTLE-750': 8400, 'INV-CORK': 8400, 'INV-LABEL': 8400, 'INV-BOX': 1400 }, bottlesPerBox: 6, packagingCostTotal: 14700, bottlingServiceCost: 5880, storageLocationId: 'SL-MAIN', storageMovementId: 'sm-2026-01', placedInStorageBottles: 8400, lastModified: MODIFIED },
];

const costEntries2026 = [
  { id: 'cost-2026-01', date: '2026-06-11', lotId: 'SAP-25', category: 'packaging', description: 'საფერავი 2025 - შეფუთვის მასალა', amount: 14700, currency: 'GEL', quantity: 8400, unitCost: 1.75, sourceRef: 'bot-2026-01', createdBy: WINEMAKER, lastModified: MODIFIED },
  { id: 'cost-2026-02', date: '2026-06-11', lotId: 'SAP-25', category: 'service', description: 'ჩამოსხმის მომსახურება', amount: 5880, currency: 'GEL', quantity: 8400, unitCost: 0.7, sourceRef: 'bot-2026-01', createdBy: WINEMAKER, lastModified: MODIFIED },
  { id: 'cost-2026-03', date: '2026-07-15', lotId: 'SAP-25', category: 'service', description: 'PDO ლაბორატორიული ანალიზი და განაცხადი', amount: 640, currency: 'GEL', quantity: 1, unitCost: 640, sourceRef: 'cert-sap-25', createdBy: WINEMAKER, lastModified: MODIFIED },
];

// ---------------------------------------------------------------------------
// Supplier invoices — posted through the real command
// ---------------------------------------------------------------------------

/**
 * `invoiceReceipts` and `inventoryMovements` are not hand-written here.
 *
 * They carry weighted-average cost accounting: every movement records
 * `stockBefore`/`stockAfter` and `weightedCostBefore`/`weightedCostAfter`, and a
 * receipt spreads freight and tax across its lines in one currency while the
 * invoice is denominated in another. Inventing those numbers would produce a
 * demo whose cost figures do not reconcile — visible the moment anyone opens the
 * costs module, and misleading in exactly the place a winery would trust it.
 *
 * So the scenario posts real invoices through `applyInvoiceReceiptCommand`, the
 * same pure function the `/api/commands/invoice.receipt` endpoint runs, and
 * keeps whatever it computes. The command also updates inventory stock and unit
 * costs, so those stay consistent for free.
 */
function seedInvoiceReceipts(d: any): void {
  // Re-running must not stack receipts, and the command rejects a duplicate id.
  const seededIds = new Set(['rcpt-2026-07-eu', 'rcpt-2026-07-ge']);
  d.invoiceReceipts = (d.invoiceReceipts || []).filter((r: any) => !seededIds.has(r.id));
  d.inventoryMovements = (d.inventoryMovements || [])
    .filter((m: any) => !seededIds.has(m.invoiceReceiptId));

  // The command adds received quantity to whatever stock it finds, so re-running
  // the seeder would keep stacking receipts onto an already-received level.
  // Pin the items these invoices touch to their pre-invoice values first, and the
  // result becomes deterministic however many times this runs.
  const PRE_INVOICE_LEVELS: Record<string, { stock: number; costPerUnit: number }> = {
    'INV-YEAST': { stock: 4.5, costPerUnit: 95 },
    'INV-DAP': { stock: 12, costPerUnit: 8 },
    'INV-KMBS': { stock: 26, costPerUnit: 12 },
    'INV-CORK': { stock: 2400, costPerUnit: 0.42 },
    'INV-LABEL': { stock: 3100, costPerUnit: 0.18 },
  };
  const baselineInventory = (d.inventory || []).map((item: any) => {
    const level = PRE_INVOICE_LEVELS[item.id];
    return level ? { ...item, ...level } : item;
  });

  let state = {
    inventory: baselineInventory,
    invoiceReceipts: d.invoiceReceipts,
    inventoryMovements: d.inventoryMovements,
  };

  // An imported invoice in EUR, so the demo exercises the currency conversion
  // path rather than only the local-currency one.
  const importedInvoice = {
    receiptId: 'rcpt-2026-07-eu',
    analysisId: 'analysis-2026-07-eu',
    documentChecksum: 'demo-eu-2026-07',
    invoice: {
      supplierName: 'Enology Supply Europe',
      supplierCompanyId: 'EU-9988',
      invoiceNumber: 'ESE-2026-1187',
      invoiceDate: '2026-07-09',
      currency: 'EUR' as const,
      subtotal: 1180,
      taxAmount: 0,
      total: 1180,
    },
    accountingCurrency: 'GEL' as const,
    exchangeRate: {
      fromCurrency: 'EUR' as const,
      toCurrency: 'GEL' as const,
      rate: 2.94,
      requestedDate: '2026-07-09',
      rateDate: '2026-07-09',
      source: 'manual' as const,
      sourceLabel: 'Manually confirmed exchange rate',
      retrievedAt: stamp('2026-07-09', '10:00:00'),
    },
    costBasis: 'net' as const,
    additionalCostsSource: 120, // freight, spread across the lines
    sources: [{ id: 'src-ese-1', title: 'Supplier product sheet', url: 'https://example.invalid/sheet', official: true }],
    lines: [
      {
        lineId: 'line-eu-yeast', movementId: 'mv-2026-07-eu-1', mode: 'receive' as const,
        inventoryItemId: 'INV-YEAST', productName: 'საფუარი QA23', category: 'yeasts',
        supplierName: 'Enology Supply Europe', invoiceDescription: '10 kg QA23 yeast',
        invoiceQuantity: 10, invoiceUnit: 'kg', stockQuantity: 10, stockUnit: 'კგ',
        conversionFactor: 1, conversionConfirmed: true,
        sourceCostPerStockUnit: 28, lineNetAmount: 280, lineTotal: 280,
        activeIngredients: ['Saccharomyces cerevisiae'], sourceIds: ['src-ese-1'],
      },
      {
        lineId: 'line-eu-dap', movementId: 'mv-2026-07-eu-2', mode: 'receive' as const,
        inventoryItemId: 'INV-DAP', productName: 'საფუარის საკვები DAP', category: 'nutritions',
        supplierName: 'Enology Supply Europe', invoiceDescription: '50 kg DAP nutrient',
        invoiceQuantity: 50, invoiceUnit: 'kg', stockQuantity: 50, stockUnit: 'კგ',
        conversionFactor: 1, conversionConfirmed: true,
        sourceCostPerStockUnit: 4, lineNetAmount: 200, lineTotal: 200,
        activeIngredients: ['Diammonium phosphate'], sourceIds: ['src-ese-1'],
      },
      {
        lineId: 'line-eu-kmbs', movementId: 'mv-2026-07-eu-3', mode: 'receive' as const,
        inventoryItemId: 'INV-KMBS', productName: 'კალიუმის მეტაბისულფიტი', category: 'additives',
        supplierName: 'Enology Supply Europe', invoiceDescription: '100 kg KMBS',
        invoiceQuantity: 100, invoiceUnit: 'kg', stockQuantity: 100, stockUnit: 'კგ',
        conversionFactor: 1, conversionConfirmed: true,
        sourceCostPerStockUnit: 7, lineNetAmount: 700, lineTotal: 700,
        activeIngredients: ['Potassium metabisulphite'], sourceIds: ['src-ese-1'],
      },
    ],
  };

  // A local invoice in GEL, restocking closures and labels before the autumn
  // bottling. Bottles are deliberately NOT on it, so the "order bottles" task
  // still has a visible reason.
  const localInvoice = {
    receiptId: 'rcpt-2026-07-ge',
    analysisId: 'analysis-2026-07-ge',
    documentChecksum: 'demo-ge-2026-07',
    invoice: {
      supplierName: 'ქართული შესაფუთი მასალები',
      supplierCompanyId: '404512345',
      invoiceNumber: 'QSM-2026-0731',
      invoiceDate: '2026-07-24',
      currency: 'GEL' as const,
      subtotal: 3050,
      taxAmount: 549,
      total: 3599,
    },
    accountingCurrency: 'GEL' as const,
    exchangeRate: {
      fromCurrency: 'GEL' as const,
      toCurrency: 'GEL' as const,
      rate: 1,
      // A same-currency invoice must declare an identity rate; the parser
      // rejects 'manual' here even when the rate is 1.
      requestedDate: '2026-07-24',
      rateDate: '2026-07-24',
      source: 'identity' as const,
      sourceLabel: 'ერთი ვალუტა — კონვერტაცია არ საჭიროებს',
      retrievedAt: stamp('2026-07-24', '11:30:00'),
    },
    costBasis: 'net' as const,
    additionalCostsSource: 0,
    sources: [{ id: 'src-qsm-1', title: 'მიმწოდებლის ზედნადები', url: 'https://example.invalid/qsm', official: true }],
    lines: [
      {
        lineId: 'line-ge-cork', movementId: 'mv-2026-07-ge-1', mode: 'receive' as const,
        inventoryItemId: 'INV-CORK', productName: 'ნატურალური საცობი 44x24', category: 'closures',
        supplierName: 'ქართული შესაფუთი მასალები', invoiceDescription: '5000 ცალი საცობი',
        invoiceQuantity: 5000, invoiceUnit: 'ცალი', stockQuantity: 5000, stockUnit: 'ცალი',
        conversionFactor: 1, conversionConfirmed: true,
        sourceCostPerStockUnit: 0.43, lineNetAmount: 2150, lineTotal: 2537,
        activeIngredients: [], sourceIds: ['src-qsm-1'],
      },
      {
        lineId: 'line-ge-label', movementId: 'mv-2026-07-ge-2', mode: 'receive' as const,
        inventoryItemId: 'INV-LABEL', productName: 'ეტიკეტი კვარლის ხაზი', category: 'labels',
        supplierName: 'ქართული შესაფუთი მასალები', invoiceDescription: '5000 ცალი ეტიკეტი',
        invoiceQuantity: 5000, invoiceUnit: 'ცალი', stockQuantity: 5000, stockUnit: 'ცალი',
        conversionFactor: 1, conversionConfirmed: true,
        sourceCostPerStockUnit: 0.18, lineNetAmount: 900, lineTotal: 1062,
        activeIngredients: [], sourceIds: ['src-qsm-1'],
      },
    ],
  };

  for (const [invoice, at] of [
    [importedInvoice, stamp('2026-07-09', '10:15:00')],
    [localInvoice, stamp('2026-07-24', '11:45:00')],
  ] as const) {
    const outcome = applyInvoiceReceiptCommand(state as any, invoice, {
      commandId: `cmd-${invoice.receiptId}`,
      actorUsername: WINEMAKER,
      performedAt: new Date(at),
    });
    state = outcome.state as any;
  }

  d.inventory = state.inventory;
  d.invoiceReceipts = state.invoiceReceipts;
  d.inventoryMovements = state.inventoryMovements;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function main() {
  const orgArg = process.argv[2];
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

  let orgId = orgArg;
  if (!orgId) {
    const user = db.users?.find((u: any) => u.username === 'testuser1');
    orgId = user?.activeOrganizationId
      || db.memberships?.find((m: any) => m.userId === 'testuser1')?.organizationId;
  }
  if (!orgId || !db.orgData?.[orgId]) {
    console.error(`No workspace data found for organization "${orgId}".`);
    process.exit(1);
  }

  const d = db.orgData[orgId];

  // The scenario references blocks, vessels, inventory, and storage locations by
  // id. A workspace that has never been seeded has none of them, which would
  // leave lots pointing at vessels that do not exist. Copy that foundation from
  // a workspace that already has it, so the script produces a coherent demo from
  // an empty organization as well as enriching an established one.
  const BASE_COLLECTIONS = ['blocks', 'vessels', 'inventory', 'storageLocations'] as const;
  const needsFoundation = BASE_COLLECTIONS.some(key => !(d[key] || []).length);
  if (needsFoundation) {
    const template = Object.values(db.orgData).find((candidate: any) =>
      BASE_COLLECTIONS.every(key => (candidate?.[key] || []).length)) as any;
    if (!template) {
      console.error('This workspace has no vineyard blocks or vessels, and no seeded workspace exists to copy them from.');
      console.error('Run the baseline seeder first: GET /api/dev/seed-testuser1');
      process.exit(1);
    }
    for (const key of BASE_COLLECTIONS) {
      if (!(d[key] || []).length) d[key] = JSON.parse(JSON.stringify(template[key]));
    }
    if (!d.companyProfile?.companyName && template.companyProfile) {
      d.companyProfile = JSON.parse(JSON.stringify(template.companyProfile));
    }
    console.log(`  (copied vineyard/cellar foundation into an empty workspace)`);
  }

  seedInvoiceReceipts(d);

  d.lots = upsert(d.lots, lots2025 as any);
  d.phenologyLogs = upsert(d.phenologyLogs, phenology2026 as any);
  d.samplings = upsert(d.samplings, samplings2026 as any);
  d.sprays = upsert(d.sprays, sprays2026 as any);
  d.harvests = upsert(d.harvests, harvestPlan2026 as any);
  d.tasks = upsert(d.tasks, tasks2026 as any);
  d.cellarOps = upsert(d.cellarOps, cellarOps2026 as any);
  d.lablogs = upsert(d.lablogs, labLogs2026 as any);
  d.notes = upsert(d.notes, notes2026 as any);
  d.certificationRecords = upsert(d.certificationRecords, certifications as any);
  d.crmLeads = upsert(d.crmLeads, crmLeads as any);
  d.salesOrders = upsert(d.salesOrders, salesOrders2026 as any);
  d.salesDispatches = upsert(d.salesDispatches, salesDispatches2026 as any);
  d.stockMovements = upsert(d.stockMovements, stockMovements2026 as any);
  d.bottlingRuns = upsert(d.bottlingRuns, bottlingRuns2026 as any);
  d.costEntries = upsert(d.costEntries, costEntries2026 as any);

  // Vessel occupancy has to agree with the lots above, or the cellar view shows
  // wine in a tank that the lot says is empty.
  const occupancy: Record<string, { lot: string | null; volume: number; op: string }> = {
    'Q-01': { lot: 'RK-25', volume: 2200, op: 'რქაწითელი 2025 დავარგებაზე ქვევრში' },
    'T-105': { lot: 'KIS-25', volume: 900, op: 'ქისი 2025 დავარგებაზე' },
    'T-101': { lot: null, volume: 0, op: 'საფერავი 2025 ჩამოისხა, ავზი გასაწმენდია' },
  };
  d.vessels = (d.vessels || []).map((vessel: any) => {
    const next = occupancy[vessel.id];
    if (!next) return vessel;
    return {
      ...vessel,
      assignedLotId: next.lot,
      currentVolume: next.volume,
      cleaningStatus: next.lot ? vessel.cleaningStatus : 'needs_cleaning',
      lastOperation: next.op,
      lastModified: MODIFIED,
    };
  });

  // A vintage still marked "fermenting" two years on is the clearest sign of a
  // stale demo. Advance it, with a history entry explaining the move.
  d.lots = d.lots.map((lot: any) => {
    if (lot.vintage !== 2024 || lot.stage !== 'fermenting') return lot;
    return {
      ...lot,
      stage: 'aging',
      history: [
        ...(lot.history || []),
        { date: '2024-11-20', type: 'ტექნოლოგიური ოპერაცია', description: 'დუღილი დასრულდა, პარტია გადავიდა დავარგების ფაზაში.', operator: WINEMAKER },
      ],
      lastModified: MODIFIED,
    };
  });

  // Blocks carry their own `currentPhenology` and `estimatedHarvestDate`, shown
  // on the vineyard overview. The phenology log above is not enough on its own:
  // left alone the blocks still read "post-harvest dormancy" in August, which is
  // the wrong hemisphere's calendar and the first thing a viewer would notice.
  const blockSeason: Record<string, { phenology: string; harvest: string }> = {
    'B-01': { phenology: 'შეთვალება (ვერაისონი)', harvest: '2026-09-18' },
    'B-02': { phenology: 'შეთვალება (ვერაისონი)', harvest: '2026-09-26' },
    'B-03': { phenology: 'მარცვლის ზრდა', harvest: '2026-09-24' },
    'B-04': { phenology: 'მარცვლის ზრდა', harvest: '2026-09-12' },
    'B-05': { phenology: 'შეთვალების დასაწყისი', harvest: '2026-09-30' },
    'B-06': { phenology: 'შეთვალება (ვერაისონი)', harvest: '2026-09-21' },
  };
  d.blocks = (d.blocks || []).map((block: any) => {
    const season = blockSeason[block.id];
    if (!season) return block;
    return {
      ...block,
      currentPhenology: season.phenology,
      estimatedHarvestDate: season.harvest,
      lastModified: MODIFIED,
    };
  });

  // Bottles are the one packaging line the July invoices did not cover, which is
  // what makes the "order bottles" task visibly justified. Closures and labels
  // are left alone here: their stock and unit cost were set by the invoice
  // command above, and overwriting them would break the weighted-average
  // accounting those receipts recorded.
  d.inventory = (d.inventory || []).map((item: any) => (
    item.id === 'INV-BOTTLE-750'
      ? { ...item, stock: 950, lastModified: MODIFIED }
      : item
  ));

  // Audit entries are hash-chained; sign them against the existing chain so the
  // audit view shows a verified trail rather than unsigned rows.
  const newAuditEntries = [
    { id: 'AUD-2026-001', timestamp: stamp('2026-06-11', '08:05:00'), user: WINEMAKER, module: 'GVINO', actionType: 'Bottling Run', changedItem: 'SAP-25', oldValue: '6300 ლ', newValue: '8400 ბოთლი', notes: 'საფერავი 2025 ჩამოსხმა დასრულდა.' },
    { id: 'AUD-2026-002', timestamp: stamp('2026-07-15', '14:20:00'), user: WINEMAKER, module: 'MARANIOS', actionType: 'Certification Submitted', changedItem: 'cert-sap-25', oldValue: 'draft', newValue: 'submitted', notes: 'PDO განაცხადი გაიგზავნა.' },
    { id: 'AUD-2026-003', timestamp: stamp('2026-07-29', '10:45:00'), user: WINEMAKER, module: 'MARANIOS', actionType: 'Sales Order Created', changedItem: 'ord-2026-02', oldValue: '', newValue: '2400 ბოთლი / 50400 GEL', notes: 'ექსპორტის შეკვეთა პოლონეთისთვის.' },
    { id: 'AUD-2026-004', timestamp: stamp('2026-08-03', '09:10:00'), user: OENOLOGIST, module: 'GVINO', actionType: 'Lab Analysis', changedItem: 'LAB-RK-25-08', oldValue: '', newValue: 'SO2 თავისუფალი 22 მგ/ლ', notes: 'RK-25 კონტროლი — საჭიროა კორექცია.' },
  ] as MaraniOSAuditLog[];

  const existingAudit = (d.auditLogs || []) as MaraniOSAuditLog[];
  const alreadySeeded = new Set(newAuditEntries.map(e => e.id));
  const priorChain = existingAudit.filter(e => !alreadySeeded.has(e.id));
  d.auditLogs = [...priorChain, ...signAuditEntries(newAuditEntries, priorChain)];

  // Keep the previous state next to the file before overwriting it. The local
  // store is a single JSON document with no history, and several things rewrite
  // it wholesale — the dev server on boot, and the e2e fixtures, which replace
  // `users` and `orgData` outright. Losing a seeded workspace to one of those is
  // otherwise unrecoverable.
  const backupPath = `${DB_PATH}.seed-backup.json`;
  fs.copyFileSync(DB_PATH, backupPath);

  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

  const chain = buildAuditHashChain(d.auditLogs);
  console.log(`Seeded demo scenario into ${orgId} (as of ${TODAY})`);
  console.log(`  previous state saved to ${path.basename(backupPath)}`);
  for (const key of ['lots', 'tasks', 'samplings', 'certificationRecords', 'crmLeads', 'salesOrders', 'notes', 'lablogs', 'cellarOps', 'auditLogs']) {
    console.log(`  ${key.padEnd(22)} ${(d[key] || []).length}`);
  }
  console.log(`  audit chain            ${chain.verifiedCount} verified, ${chain.invalidCount} invalid`);
}

main();
