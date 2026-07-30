import { stageLabel } from '../../enumLabels';
import type { WineryBaselines } from '../baselines';
import { action, buildFinding, confidence, evidence } from '../finding';
import { forecastInventoryDepletion } from '../predictions';
import { daysBetween, lotLabel, type WineryIntelligenceSnapshot } from '../snapshot';
import { labsForLot, snapshotIndexes } from '../indexes';
import { num, plain, text } from '../text';
import type { AiFinding } from '../types';

/**
 * Operations, inventory and compliance detectors. The inventory rules are where
 * cross-module intelligence shows up first: stock is judged against this
 * winery's measured consumption and its actual upcoming production, not against
 * a static minimum threshold.
 */

// ---------------------------------------------------------------------------
// Inventory — depletion forecast, not just a threshold breach
// ---------------------------------------------------------------------------

export function detectInventoryRisk(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): AiFinding[] {
  const findings: AiFinding[] = [];
  const minCover = snapshot.config.targets.minStockCoverDays;

  for (const item of snapshot.inventory) {
    const forecast = forecastInventoryDepletion(baselines, item.id, item.stock, snapshot.today);
    const belowThreshold = item.stock <= item.minThreshold;
    const shortCover = forecast.coverDays !== null && forecast.coverDays < minCover;
    if (!belowThreshold && !shortCover) continue;

    const outOfStock = item.stock <= 0;
    const severity = outOfStock
      ? 'critical'
      : (forecast.coverDays !== null && forecast.coverDays < minCover / 2) || belowThreshold
        ? 'warning'
        : 'attention';

    const consumptionKnown = forecast.dailyUsage !== null;

    findings.push(buildFinding({
      findingType: outOfStock ? 'inventory_out_of_stock' : 'inventory_depletion_risk',
      agent: 'inventory',
      area: 'inventory',
      severity,
      entityType: 'inventory_item',
      entityId: item.id,
      entityLabel: item.name,
      title: outOfStock
        ? text(`Out of stock — ${item.name}`, `მარაგი ამოიწურა — ${item.name}`)
        : text(`Stock may run short — ${item.name}`, `მარაგი შეიძლება არ გეყოთ — ${item.name}`),
      observation: consumptionKnown
        ? text(
          `${num(item.stock, 1)} ${item.unit} on hand, used at about ${num(forecast.dailyUsage ?? 0, 2)} ${item.unit}/day over the last ${baselines.windowDays} days — roughly ${num(forecast.coverDays ?? 0, 0)} days of cover${forecast.depletionDate ? `, empty around ${forecast.depletionDate}` : ''}.`,
          `მარაგშია ${num(item.stock, 1)} ${item.unit}, ბოლო ${baselines.windowDays} დღეში ხარჯვა დაახლოებით ${num(forecast.dailyUsage ?? 0, 2)} ${item.unit}/დღეში — დაახლოებით ${num(forecast.coverDays ?? 0, 0)} დღის მარაგი${forecast.depletionDate ? `, ამოიწურება დაახლოებით ${forecast.depletionDate}` : ''}.`,
        )
        : text(
          `${num(item.stock, 1)} ${item.unit} on hand against a minimum of ${num(item.minThreshold, 1)} ${item.unit}. No consumption history exists yet, so no depletion date could be projected.`,
          `მარაგშია ${num(item.stock, 1)} ${item.unit}, მინიმუმია ${num(item.minThreshold, 1)} ${item.unit}. ხარჯვის ისტორია ჯერ არ არსებობს, ამიტომ ამოწურვის თარიღი ვერ დაითვალა.`,
        ),
      whyItMatters: text(
        'A material that runs out mid-operation stops the operation: nutrient during an active fermentation or a closure during a bottling run cannot wait for a delivery.',
        'ოპერაციის შუაში ამოწურული მასალა აჩერებს ოპერაციას: აქტიური დუღილის დროს საკვები ან ჩამოსხმისას საცობი მიწოდებას ვერ დაელოდება.',
      ),
      possibleCauses: consumptionKnown
        ? [
          text('Consumption above the usual rate this season', 'ხარჯვა ამ სეზონში ჩვეულებრივზე მაღალია'),
          text('Reorder not placed after the last drawdown', 'ბოლო ხარჯვის შემდეგ შეკვეთა არ განთავსებულა'),
        ]
        : [
          text('Stock recorded below the minimum without a matching consumption record', 'მარაგი მინიმუმზე დაბალია, თუმცა შესაბამისი ხარჯვის ჩანაწერი არ არის'),
        ],
      recommendedActions: [
        action('purchase', text(`Prepare a restock request for ${item.supplierName || 'the supplier'}`, `მოამზადეთ შევსების მოთხოვნა მომწოდებლისთვის: ${item.supplierName || 'მომწოდებელი'}`), { targetModule: 'inventory' }),
        action('check', text('Confirm the physical count before ordering', 'შეკვეთამდე დაადასტურეთ ფაქტობრივი ნაშთი'), { targetModule: 'inventory' }),
      ],
      evidence: [
        evidence('fact', text('On hand', 'ნაშთი'), plain(`${num(item.stock, 1)} ${item.unit}`), `inventory:${item.id}`),
        evidence('fact', text('Minimum threshold', 'მინიმალური ზღვარი'), plain(`${num(item.minThreshold, 1)} ${item.unit}`)),
        ...(consumptionKnown
          ? [
            evidence('inference', text('Observed consumption', 'დაფიქსირებული ხარჯვა'), plain(`${num(forecast.dailyUsage ?? 0, 2)} ${item.unit}/day`)),
            evidence('prediction', text('Projected depletion', 'პროგნოზირებული ამოწურვა'), plain(forecast.depletionDate || '—')),
          ]
          : []),
      ],
      confidence: confidence(
        forecast.observations >= 4 ? 'high' : consumptionKnown ? 'medium' : 'low',
        forecast.observations >= 4 ? 0.8 : consumptionKnown ? 0.55 : 0.3,
        [
          consumptionKnown
            ? text(`Based on ${forecast.observations} recorded consumption events`, `ეყრდნობა ${forecast.observations} დაფიქსირებულ ხარჯვის ჩანაწერს`)
            : text('No consumption history; this is a threshold breach only, not a forecast.', 'ხარჯვის ისტორია არ არის; ეს მხოლოდ ზღვრის დარღვევაა და არა პროგნოზი.'),
        ],
      ),
      missingInformation: consumptionKnown
        ? []
        : [text('No material consumption has been recorded against operations for this item.', 'ამ პროდუქტზე ოპერაციებში ხარჯვა არ დაფიქსირებულა.')],
      cooldownHours: outOfStock ? 24 : 72,
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Cellar capacity
// ---------------------------------------------------------------------------

export function detectCapacityRisk(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const vessels = snapshot.vessels.filter((v) => Number.isFinite(v.capacity) && v.capacity > 0);
  if (vessels.length === 0) return [];

  const capacity = vessels.reduce((sum, v) => sum + v.capacity, 0);
  const filled = vessels.reduce((sum, v) => sum + Math.max(0, v.currentVolume), 0);
  const fillPct = (filled / capacity) * 100;
  const ceiling = snapshot.config.targets.maxCellarFillPct;
  if (fillPct < ceiling) return [];

  const freeL = Math.max(0, capacity - filled);
  const emptyVessels = vessels.filter((v) => v.currentVolume <= 0).length;

  return [buildFinding({
    findingType: 'cellar_capacity_tight',
    agent: 'management',
    area: 'operations',
    // Quotes aggregate vessel capacity and occupancy.
    requiredModules: ['vessels'],
    severity: fillPct >= 98 ? 'warning' : 'attention',
    entityType: 'winery',
    entityId: 'cellar',
    entityLabel: snapshot.companyProfile?.wineryName || 'Cellar',
    title: text('Cellar capacity is tight', 'მარნის ტევადობა შემოიფარგლა'),
    observation: text(
      `${num(filled, 0)} L of ${num(capacity, 0)} L is occupied (${num(fillPct, 0)}%), leaving ${num(freeL, 0)} L across ${emptyVessels} empty vessel${emptyVessels === 1 ? '' : 's'}.`,
      `დაკავებულია ${num(filled, 0)} ლ ${num(capacity, 0)} ლ-დან (${num(fillPct, 0)}%), თავისუფალია ${num(freeL, 0)} ლ, ${emptyVessels} ცარიელი ჭურჭელი.`,
    ),
    whyItMatters: text(
      'Headroom is what makes racking, blending and an unplanned intake possible. Once it is gone, every subsequent operation needs another operation first.',
      'თავისუფალი ადგილი არის ის, რაც შესაძლებელს ხდის გადაღებას, კუპაჟსა და დაუგეგმავ მიღებას. მისი ამოწურვის შემდეგ ყოველი ოპერაცია სხვა ოპერაციას საჭიროებს.',
    ),
    possibleCauses: [
      text('Bottled or sold lots still occupying vessels in the records', 'ჩამოსხმული ან გაყიდული პარტიები ჩანაწერებში კვლავ იკავებს ჭურჭელს'),
      text('Intake volume above the plan for this vintage', 'მიღებული მოცულობა ამ მოსავლის გეგმას აღემატება'),
    ],
    recommendedActions: [
      action('check', text('Review vessels holding bottled or sold lots', 'გადახედეთ ჭურჭლებს, რომლებშიც ჩამოსხმული ან გაყიდული პარტიებია'), { targetModule: 'vessels' }),
      action('schedule', text('Plan consolidation or racking to free headroom', 'დაგეგმეთ გაერთიანება ან გადაღება ადგილის გასათავისუფლებლად'), { targetModule: 'transfers' }),
    ],
    evidence: [
      evidence('fact', text('Occupied volume', 'დაკავებული მოცულობა'), plain(`${num(filled, 0)} L`)),
      evidence('fact', text('Total capacity', 'საერთო ტევადობა'), plain(`${num(capacity, 0)} L`)),
      evidence('fact', text('Empty vessels', 'ცარიელი ჭურჭლები'), plain(String(emptyVessels))),
    ],
    confidence: confidence('high', 0.9, [
      text('Computed from current vessel volumes', 'გამოთვლილია ჭურჭლების მიმდინარე მოცულობებიდან'),
    ]),
    missingInformation: [],
    cooldownHours: 72,
  })];
}

// ---------------------------------------------------------------------------
// Overdue work — one finding, not one per task
// ---------------------------------------------------------------------------

export function detectOverdueWork(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const overdue = snapshot.tasks.filter(
    (task) => task.status === 'pending' && task.dueDate && task.dueDate < snapshot.today,
  );
  if (overdue.length === 0) return [];

  const worstAge = Math.max(...overdue.map((task) => daysBetween(task.dueDate, snapshot.today)));
  const highPriority = overdue.filter((task) => task.priority === 'high');
  const severity = highPriority.length > 0 || worstAge > 7 ? 'warning' : 'attention';
  const sample = overdue
    .slice()
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 5);

  return [buildFinding({
    // Aggregated deliberately: fifty individual overdue-task alerts is exactly
    // the alert fatigue this layer exists to avoid.
    findingType: 'work_overdue',
    agent: 'management',
    area: 'operations',
    // Quotes task titles, due dates and assignees.
    requiredModules: ['tasks'],
    severity,
    entityType: 'winery',
    entityId: 'tasks',
    entityLabel: snapshot.companyProfile?.wineryName || 'Winery',
    relatedEntities: sample.map((task) => ({ type: 'task' as const, id: task.id, label: task.title })),
    title: text(
      `${overdue.length} operation${overdue.length === 1 ? '' : 's'} overdue`,
      `${overdue.length} ოპერაცია ვადაგადაცილებულია`,
    ),
    observation: text(
      `${overdue.length} pending task${overdue.length === 1 ? '' : 's'} passed their due date, the oldest by ${worstAge} day${worstAge === 1 ? '' : 's'}${highPriority.length > 0 ? `; ${highPriority.length} marked high priority` : ''}.`,
      `${overdue.length} დავალებას ვადა გაუვიდა, ყველაზე ძველს — ${worstAge} დღით${highPriority.length > 0 ? `; ${highPriority.length} მაღალი პრიორიტეტისაა` : ''}.`,
    ),
    whyItMatters: text(
      'Planned cellar work that silently slips is the most common root cause behind the chemistry and protection findings elsewhere in this list.',
      'დაგეგმილი სამარნე სამუშაო, რომელიც უხმაუროდ იგვიანებს, ყველაზე ხშირი ძირეული მიზეზია ამ სიაში არსებული ქიმიისა და დაცვის სხვა დასკვნებისა.',
    ),
    possibleCauses: [
      text('Work performed but not marked complete', 'სამუშაო შესრულდა, მაგრამ დასრულებულად არ მოინიშნა'),
      text('Capacity shortfall during a peak period', 'რესურსის ნაკლებობა პიკურ პერიოდში'),
    ],
    recommendedActions: [
      action('check', text('Review the overdue list and close what is already done', 'გადახედეთ ვადაგადაცილებულ სიას და დახურეთ უკვე შესრულებული'), { targetModule: 'tasks' }),
      action('schedule', text('Re-date or reassign what is still outstanding', 'გადაავადეთ ან გადაანაწილეთ დარჩენილი'), { targetModule: 'tasks' }),
    ],
    evidence: [
      evidence('fact', text('Overdue tasks', 'ვადაგადაცილებული დავალებები'), plain(String(overdue.length))),
      evidence('fact', text('Oldest overdue by', 'ყველაზე ძველი ვადაგადაცილება'), plain(`${worstAge} days`)),
      ...sample.map((task) =>
        evidence('fact', plain(task.title), plain(`${task.dueDate} · ${task.assignedTo || '—'}`), `tasks:${task.id}`),
      ),
    ],
    confidence: confidence('high', 0.95, [
      text('Read directly from task due dates', 'პირდაპირ დავალებების ვადებიდან'),
    ]),
    missingInformation: [],
    cooldownHours: 24,
  })];
}

// ---------------------------------------------------------------------------
// Bottling readiness — cross-module: lot stage × packaging stock
// ---------------------------------------------------------------------------

const PACKAGING_CATEGORIES = ['bottles', 'closures', 'corks', 'capsules', 'labels', 'boxes', 'packaging'];

export function detectBottlingReadiness(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const findings: AiFinding[] = [];
  const readyStages = new Set(['stabilization', 'filtration']);

  const packaging = snapshot.inventory.filter((item) =>
    PACKAGING_CATEGORIES.includes((item.category || '').toLowerCase()),
  );

  for (const lot of snapshot.lots) {
    if (lot.voidedAt || !readyStages.has(lot.stage)) continue;
    const label = lotLabel(snapshot, lot.id);
    // A 750 mL fill is the planning assumption; the finding says so explicitly.
    const requiredBottles = Math.ceil(lot.currentVolume / 0.75);
    const shortages = packaging.filter((item) => item.stock < requiredBottles);
    const latestLab = labsForLot(snapshot, lot.id)[0];
    const labAge = latestLab ? daysBetween(latestLab.date, snapshot.today) : null;
    const labStale = labAge === null || labAge > 30;

    if (shortages.length === 0 && !labStale) continue;

    findings.push(buildFinding({
      findingType: 'bottling_preparation_gap',
      agent: 'inventory',
      area: 'operations',
      // States the age of a laboratory analysis and names packaging stock, so it
      // is only visible to a role that can open both of those records.
      requiredModules: ['lab', 'inventory'],
      // Both a packaging shortfall and stale release chemistry are lead-time
      // problems rather than today's problems, so they share one severity. If the
      // winery wants a shortfall to shout louder, that is a policy change here.
      severity: 'attention',
      entityType: 'lot',
      entityId: lot.id,
      entityLabel: label,
      relatedEntities: shortages.map((item) => ({ type: 'inventory_item' as const, id: item.id, label: item.name })),
      title: text(`Bottling preparation incomplete — ${label}`, `ჩამოსხმის მომზადება არასრულია — ${label}`),
      observation: text(
        `${label} is at the "${stageLabel(lot.stage, 'en')}" stage with ${num(lot.currentVolume, 0)} L (about ${requiredBottles} × 750 mL).${shortages.length > 0 ? ` Packaging below that quantity: ${shortages.map((i) => i.name).join(', ')}.` : ''}${labStale ? ` Release chemistry is ${labAge === null ? 'missing' : `${labAge} days old`}.` : ''}`,
        `${label} არის "${stageLabel(lot.stage, 'ka')}" ეტაპზე, ${num(lot.currentVolume, 0)} ლ (დაახლოებით ${requiredBottles} × 750 მლ).${shortages.length > 0 ? ` ამ რაოდენობაზე ნაკლები შეფუთვა: ${shortages.map((i) => i.name).join(', ')}.` : ''}${labStale ? ` გამოშვების ქიმია ${labAge === null ? 'არ არსებობს' : `${labAge} დღისაა`}.` : ''}`,
      ),
      whyItMatters: text(
        'Packaging and release analysis both have lead times. Discovered on the bottling day, either one costs a full line day.',
        'შეფუთვასაც და გამოშვების ანალიზსაც მიწოდების ვადა აქვს. ჩამოსხმის დღეს აღმოჩენილი ნებისმიერი მათგანი მთელ სამუშაო დღეს გიჯდებათ.',
      ),
      possibleCauses: [
        text('Packaging ordered for a smaller run than the current volume', 'შეფუთვა შეკვეთილია მიმდინარე მოცულობაზე ნაკლებ პარტიაზე'),
        text('Release analysis not yet scheduled for this batch', 'ამ პარტიისთვის გამოშვების ანალიზი ჯერ არ დაგეგმილა'),
      ],
      recommendedActions: [
        action('check', text('Confirm the intended bottle format and run size', 'დაადასტურეთ ბოთლის ფორმატი და პარტიის ზომა'), { targetModule: 'bottling' }),
        action('purchase', text('Cover the packaging shortfall before scheduling the run', 'ჩამოსხმის დაგეგმვამდე შეავსეთ შეფუთვის დეფიციტი'), { targetModule: 'inventory' }),
        action('measure', text('Schedule release chemistry', 'დაგეგმეთ გამოშვების ქიმია'), { targetModule: 'labs' }),
      ],
      evidence: [
        evidence('fact', text('Volume to bottle', 'ჩამოსასხმელი მოცულობა'), plain(`${num(lot.currentVolume, 0)} L`), `lots:${lot.id}`),
        evidence('inference', text('Bottles required at 750 mL', 'საჭირო ბოთლები 750 მლ-ზე'), plain(String(requiredBottles))),
        ...shortages.map((item) =>
          evidence('fact', plain(item.name), plain(`${num(item.stock, 0)} ${item.unit}`), `inventory:${item.id}`),
        ),
      ],
      confidence: confidence('medium', 0.55, [
        text('Bottle count assumes a 750 mL format; a different format changes the requirement.', 'ბოთლების რაოდენობა ეყრდნობა 750 მლ ფორმატს; სხვა ფორმატი შეცვლის საჭიროებას.'),
      ]),
      missingInformation: [
        text('No scheduled bottling date is recorded, so lead time could not be evaluated.', 'ჩამოსხმის დაგეგმილი თარიღი არ არის ჩაწერილი, ამიტომ მიწოდების ვადა ვერ შეფასდა.'),
      ],
      cooldownHours: 96,
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Compliance and traceability gaps
// ---------------------------------------------------------------------------

export function detectComplianceGaps(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const findings: AiFinding[] = [];

  for (const lot of snapshot.lots) {
    if (lot.voidedAt) continue;
    const isRegulated = lot.classification === 'PDO' || lot.classification === 'PGI';
    const exporting = lot.marketStatus === 'export' || lot.marketStatus === 'local_and_export';
    if (!isRegulated && !exporting) continue;

    const gaps: Array<{ en: string; ka: string }> = [];
    if (lot.originProofStatus !== 'verified') {
      gaps.push({
        en: `origin proof is "${lot.originProofStatus || 'missing'}"`,
        ka: `წარმოშობის დადასტურება — "${lot.originProofStatus || 'არ არის'}"`,
      });
    }
    const certification = snapshotIndexes(snapshot).certificationByLot.get(lot.id);
    if (!certification) {
      gaps.push({ en: 'no certification record exists', ka: 'სერტიფიკაციის ჩანაწერი არ არსებობს' });
    } else {
      if (!certification.labProtocolUploaded) {
        gaps.push({ en: 'laboratory protocol not attached', ka: 'ლაბორატორიული ოქმი არ არის მიმაგრებული' });
      }
      if (certification.applicationStatus === 'draft') {
        gaps.push({ en: 'certification application is still a draft', ka: 'სერტიფიკაციის განაცხადი ჯერ პროექტია' });
      }
      if (certification.expiryDate && certification.expiryDate < snapshot.today) {
        gaps.push({ en: `certificate expired on ${certification.expiryDate}`, ka: `სერტიფიკატს ვადა გაუვიდა ${certification.expiryDate}` });
      }
    }
    const intake = snapshotIndexes(snapshot).intakeByCreatedLot.get(lot.id);
    if (intake && !intake.cadastralCode && intake.source === 'own') {
      gaps.push({ en: 'the originating intake has no cadastral code', ka: 'საწყის მიღებას საკადასტრო კოდი არ აქვს' });
    }
    if (gaps.length === 0) continue;

    const label = lotLabel(snapshot, lot.id);
    const severity = exporting ? 'warning' : 'attention';

    findings.push(buildFinding({
      findingType: 'compliance_documentation_gap',
      agent: 'compliance',
      area: 'compliance',
      // Reads the originating intake to check for a cadastral code.
      requiredModules: ['grape_intake'],
      severity,
      entityType: 'lot',
      entityId: lot.id,
      entityLabel: label,
      title: text(`Documentation incomplete — ${label}`, `დოკუმენტაცია არასრულია — ${label}`),
      observation: text(
        `${label} is classified ${lot.classification || 'unclassified'}${exporting ? ' and marked for export' : ''}, but ${gaps.map((g) => g.en).join('; ')}.`,
        `${label} კლასიფიცირებულია როგორც ${lot.classification || 'უკლასიფიკაციო'}${exporting ? ' და მონიშნულია ექსპორტისთვის' : ''}, თუმცა ${gaps.map((g) => g.ka).join('; ')}.`,
      ),
      whyItMatters: text(
        'Under Georgian wine regulation, origin and certification evidence must exist before dispatch — assembling it after a shipment is booked is what turns a paperwork gap into a blocked consignment.',
        'ქართული ღვინის რეგულაციით, წარმოშობისა და სერტიფიკაციის მტკიცებულება გაგზავნამდე უნდა არსებობდეს — მისი შეგროვება უკვე დაჯავშნილი გადაზიდვის შემდეგ სწორედ ისაა, რაც დოკუმენტურ ხარვეზს დაბლოკილ პარტიად აქცევს.',
      ),
      possibleCauses: [
        text('Evidence held outside the system and never attached', 'მტკიცებულება სისტემის გარეთაა და არასდროს მიმაგრებულა'),
        text('Certification workflow started but not completed', 'სერტიფიკაციის პროცესი დაიწყო, მაგრამ არ დასრულებულა'),
      ],
      recommendedActions: [
        action('document', text('Attach the missing documents to the lot', 'მიამაგრეთ დაკლებული დოკუმენტები პარტიას'), { targetModule: 'certification' }),
        action('check', text('Verify origin evidence against the intake and cadastre records', 'გადაამოწმეთ წარმოშობის მტკიცებულება მიღებისა და საკადასტრო ჩანაწერებთან'), { targetModule: 'documents' }),
      ],
      evidence: [
        evidence('fact', text('Classification', 'კლასიფიკაცია'), plain(lot.classification || '—'), `lots:${lot.id}`),
        evidence('fact', text('Market status', 'ბაზრის სტატუსი'), plain(lot.marketStatus || '—')),
        evidence('fact', text('Origin proof', 'წარმოშობის დადასტურება'), plain(lot.originProofStatus || 'missing')),
        ...gaps.map((gap) => evidence('fact', text('Gap', 'ხარვეზი'), text(gap.en, gap.ka))),
      ],
      confidence: confidence('high', 0.9, [
        text('Derived from stored certification and origin fields', 'გამომდინარეობს შენახული სერტიფიკაციისა და წარმოშობის ველებიდან'),
      ]),
      missingInformation: [],
      cooldownHours: 168,
    }));
  }

  return findings;
}
