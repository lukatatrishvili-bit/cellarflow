import { molecularSO2 } from '../../alerts';
import { stageLabel } from '../../enumLabels';
import { detectAnomaly, detectTrend } from '../anomaly';
import { fermentationBaselineFor, type WineryBaselines } from '../baselines';
import { action, buildFinding, confidence, evidence, neverMeasured } from '../finding';
import { forecastFermentation } from '../predictions';
import { daysBetween, isLiveRecord, lotLabel, type WineryIntelligenceSnapshot } from '../snapshot';
import {
  fermReadingsForLot as indexedFermReadingsForLot,
  labsForLot as indexedLabsForLot,
} from '../indexes';
import { enumText, num, plain, text } from '../text';
import type { AiFinding } from '../types';

/**
 * Deterministic cellar detectors. These run on every evaluation, cost nothing,
 * and produce complete findings on their own — the model is invited only when
 * a situation needs interpretation across several of them.
 */

// Lot-scoped lookups come from the per-evaluation index in ./indexes: filtering
// the whole collection inside each lot loop is what made a large cellar slow.
// The arrays it returns are shared, so never sort or mutate them in place.
const labsForLot = indexedLabsForLot;
const fermLogsForLot = indexedFermReadingsForLot;

// ---------------------------------------------------------------------------
// Fermentation pace, measured against the winery's own history
// ---------------------------------------------------------------------------

export function detectFermentationPace(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): AiFinding[] {
  const findings: AiFinding[] = [];

  for (const lot of snapshot.lots) {
    if (lot.stage !== 'fermenting' || lot.voidedAt) continue;
    const logs = fermLogsForLot(snapshot, lot.id);
    const baseline = fermentationBaselineFor(baselines, lot.variety);
    const forecast = forecastFermentation(logs, baseline, snapshot.today);
    if (forecast.method === 'insufficient_data' && forecast.observedRatePerDay === null) continue;

    const readings = [...logs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const latest = readings[0];
    if (!latest) continue;
    const vesselId = latest.tankId;
    const label = lotLabel(snapshot, lot.id);
    const observed = forecast.observedRatePerDay;
    const stalled = observed !== null && observed < snapshot.config.targets.minDensityDropPerDay;
    const belowBaseline = forecast.paceDeviationPct !== null && forecast.paceDeviationPct <= -25;
    if (!stalled && !belowBaseline) continue;

    // A campaign that has stopped while sugar remains is materially different
    // from one that is merely behind the winery's usual pace.
    const stopped = observed !== null && observed <= 0.0005 && latest.density > 1.0;
    const severity = stopped ? 'critical' : forecast.stuckRisk >= 0.5 ? 'warning' : 'attention';

    const baselineComparison = forecast.paceDeviationPct !== null && baseline
      ? text(
        `${num(Math.abs(forecast.paceDeviationPct), 0)}% ${forecast.paceDeviationPct < 0 ? 'slower' : 'faster'} than this winery's median for ${lot.variety || 'this variety'} (${baseline.sampleSize} comparable lot${baseline.sampleSize === 1 ? '' : 's'})`,
        `${num(Math.abs(forecast.paceDeviationPct), 0)}%-ით ${forecast.paceDeviationPct < 0 ? 'ნელა' : 'სწრაფად'}, ვიდრე ამ მარნის მედიანა ${lot.variety || 'ამ ჯიშისთვის'} (${baseline.sampleSize} შესადარისი პარტია)`,
      )
      : text(
        'No comparable historical fermentation exists in this winery yet, so no pace comparison was made.',
        'ამ მარანში ჯერ არ არსებობს შესადარისი ისტორიული დუღილი, ამიტომ ტემპის შედარება არ ჩატარებულა.',
      );

    const missing: ReturnType<typeof neverMeasured>[] = [
      neverMeasured(text('Yeast assimilable nitrogen (YAN)', 'საფუარისთვის ასათვისებელი აზოტი (YAN)')),
    ];
    if (!baseline || baseline.sampleSize < 2) {
      missing.push(text(
        'Fewer than two completed comparable fermentations are on record, so the winery baseline is weak.',
        'ჩანაწერებში ორზე ნაკლები დასრულებული შესადარისი დუღილია, ამიტომ მარნის საბაზისო მაჩვენებელი სუსტია.',
      ));
    }

    findings.push(buildFinding({
      findingType: stopped ? 'fermentation_stopped' : 'fermentation_slowdown',
      agent: 'winemaking',
      area: 'fermentation',
      severity,
      entityType: 'lot',
      entityId: lot.id,
      entityLabel: label,
      relatedEntities: vesselId ? [{ type: 'vessel', id: vesselId, label: vesselId }] : [],
      title: stopped
        ? text(`Fermentation has stopped — ${label}`, `დუღილი გაჩერდა — ${label}`)
        : text(`Fermentation slower than your norm — ${label}`, `დუღილი თქვენს ნორმაზე ნელია — ${label}`),
      observation: text(
        `Specific gravity is ${num(latest.density, 3)} at ${num(latest.temperature, 1)} °C on ${latest.date.slice(0, 10)}, moving ${observed === null ? 'at an unmeasurable rate' : `${num(observed, 4)} SG/day`}.`,
        `სიმკვრივე ${num(latest.density, 3)}, ტემპერატურა ${num(latest.temperature, 1)} °C (${latest.date.slice(0, 10)}), ვარდნა ${observed === null ? 'გაზომვადი არ არის' : `${num(observed, 4)} SG/დღეში`}.`,
      ),
      whyItMatters: stopped
        ? text(
          'A campaign that stops with sugar remaining is exposed to spoilage organisms and becomes progressively harder to restart.',
          'შაქრის დარჩენისას გაჩერებული დუღილი ექვემდებარება გაფუჭების მიკროორგანიზმებს და მისი აღდგენა თანდათან რთულდება.',
        )
        : text(
          `${baselineComparison.en}. A pace this far below the winery's own norm usually precedes a stick rather than following one.`,
          `${baselineComparison.ka}. მარნის ნორმაზე ამდენად დაბალი ტემპი, როგორც წესი, წინ უსწრებს გაჩერებას და არა მოჰყვება მას.`,
        ),
      possibleCauses: [
        text('Must temperature outside the yeast strain\'s active range', 'ტკბილის ტემპერატურა საფუარის შტამის აქტიური დიაპაზონის გარეთაა'),
        text('Nitrogen (YAN) limitation or exhausted nutrient additions', 'აზოტის (YAN) დეფიციტი ან ამოწურული საკვები დანამატები'),
        text('Yeast stress from high alcohol, low pH, or high sugar at inoculation', 'საფუარის სტრესი მაღალი ალკოჰოლის, დაბალი pH-ის ან ჩათესვისას მაღალი შაქრის გამო'),
        text('Hydrometer or sampling error rather than a real change', 'არეომეტრის ან ნიმუშის აღების შეცდომა, და არა რეალური ცვლილება'),
      ],
      recommendedActions: [
        action('measure', text('Re-take the density reading and confirm the sample is degassed', 'გაიმეორეთ სიმკვრივის გაზომვა და დარწმუნდით, რომ ნიმუში გაზისგან გათავისუფლებულია'), { targetModule: 'fermentation' }),
        action('check', text('Verify must temperature against the target band', 'შეამოწმეთ ტკბილის ტემპერატურა სამიზნე დიაპაზონთან'), { targetModule: 'vessels' }),
        action('measure', text('Order YAN / nitrogen analysis before adding nutrient', 'საკვების დამატებამდე დანიშნეთ YAN / აზოტის ანალიზი'), { targetModule: 'labs' }),
        action('check', text('Compare with other vessels running the same variety and yeast', 'შეადარეთ იმავე ჯიშსა და საფუარზე მომუშავე სხვა ჭურჭლებს'), { targetModule: 'fermentation' }),
      ],
      evidence: [
        evidence('fact', text('Latest specific gravity', 'ბოლო სიმკვრივე'), plain(num(latest.density, 3)), `fermlogs:${latest.id}`),
        evidence('fact', text('Latest temperature', 'ბოლო ტემპერატურა'), plain(`${num(latest.temperature, 1)} °C`), `fermlogs:${latest.id}`),
        evidence('inference', text('Observed pace', 'დაფიქსირებული ტემპი'), plain(observed === null ? '—' : `${num(observed, 4)} SG/day`)),
        evidence('inference', text('Winery baseline comparison', 'მარნის საბაზისო შედარება'), baselineComparison),
        ...(forecast.estimatedDryDate
          ? [evidence('prediction', text('Projected dryness', 'პროგნოზირებული დასრულება'), plain(forecast.estimatedDryDate))]
          : []),
        evidence('prediction', text('Stuck-fermentation risk', 'გაჩერების რისკი'), plain(`${num(forecast.stuckRisk * 100, 0)}%`)),
      ],
      confidence: confidence(
        forecast.confidence,
        forecast.confidence === 'high' ? 0.85 : forecast.confidence === 'medium' ? 0.6 : 0.35,
        [
          text(`${readings.length} physical reading${readings.length === 1 ? '' : 's'} on this batch`, `${readings.length} ფიზიკური გაზომვა ამ პარტიაზე`),
          baselineComparison,
        ],
      ),
      missingInformation: missing,
      cooldownHours: stopped ? 6 : 24,
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Fermenter temperature against the winery's configured band
// ---------------------------------------------------------------------------

export function detectFermentationTemperature(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const findings: AiFinding[] = [];
  const { fermentationTempMinC, fermentationTempMaxC } = snapshot.config.targets;

  for (const vessel of snapshot.vessels) {
    if (vessel.currentVolume <= 0 || !Number.isFinite(vessel.temperature)) continue;
    const lot = snapshot.lots.find((l) => l.id === vessel.assignedLotId);
    if (!lot || lot.stage !== 'fermenting') continue;

    // The vessel's own target wins over the winery-wide band when it is set.
    const upper = vessel.targetTemperature != null ? vessel.targetTemperature + 4 : fermentationTempMaxC;
    const lower = vessel.targetTemperature != null ? vessel.targetTemperature - 4 : fermentationTempMinC;
    const tooHot = vessel.temperature > upper;
    const tooCold = vessel.temperature < lower;
    if (!tooHot && !tooCold) continue;

    const excess = tooHot ? vessel.temperature - upper : lower - vessel.temperature;
    const severity = excess > 4 ? 'critical' : excess > 2 ? 'warning' : 'attention';

    findings.push(buildFinding({
      findingType: tooHot ? 'fermentation_temperature_high' : 'fermentation_temperature_low',
      agent: 'winemaking',
      area: 'fermentation',
      // Quotes the vessel's own temperature, target band and jacket state.
      requiredModules: ['vessels'],
      severity,
      entityType: 'vessel',
      entityId: vessel.id,
      entityLabel: vessel.id,
      relatedEntities: [{ type: 'lot', id: lot.id, label: lot.name }],
      title: tooHot
        ? text(`${vessel.id} running hot — ${lot.name}`, `${vessel.id} გადახურებულია — ${lot.name}`)
        : text(`${vessel.id} running cold — ${lot.name}`, `${vessel.id} გადაცივებულია — ${lot.name}`),
      observation: text(
        `${num(vessel.temperature, 1)} °C against a ${num(lower, 1)}–${num(upper, 1)} °C working band${vessel.coolingJacketActive ? '' : '; the cooling jacket is off'}.`,
        `${num(vessel.temperature, 1)} °C, სამუშაო დიაპაზონია ${num(lower, 1)}–${num(upper, 1)} °C${vessel.coolingJacketActive ? '' : '; გამაგრილებელი პერანგი გამორთულია'}.`,
      ),
      whyItMatters: tooHot
        ? text(
          'Hot fermentation strips aromatics, raises volatile acidity risk, and can push the yeast past its thermal tolerance into a stick.',
          'გადახურებული დუღილი კარგავს არომატებს, ზრდის აქროლადი მჟავიანობის რისკს და საფუარი შეიძლება თერმულ ზღვარს გასცდეს და გაჩერდეს.',
        )
        : text(
          'A cold must slows the yeast and lengthens the window in which the batch has little alcohol and little SO₂ protection.',
          'ცივი ტკბილი ანელებს საფუარს და ახანგრძლივებს პერიოდს, როცა პარტიას ჯერ არც ალკოჰოლი აქვს და არც SO₂-ის დაცვა.',
        ),
      possibleCauses: tooHot
        ? [
          text('Cooling jacket off, undersized, or glycol supply interrupted', 'გამაგრილებელი პერანგი გამორთულია, არასაკმარისია ან გლიკოლის მიწოდება შეწყვეტილია'),
          text('Peak of the exothermic phase with a large cap', 'ეგზოთერმული ფაზის პიკი დიდი ქუდით'),
          text('Marani ambient temperature above normal', 'მარნის გარემოს ტემპერატურა ნორმაზე მაღალია'),
        ]
        : [
          text('Overcooling or a stuck cooling valve', 'ზედმეტი გაგრილება ან ჩარჩენილი გამაგრილებელი სარქველი'),
          text('Cold ambient marani or buried qvevri soil temperature', 'ცივი მარანი ან ჩამარხული ქვევრის ნიადაგის ტემპერატურა'),
        ],
      recommendedActions: [
        action('check', text('Confirm the reading at the vessel and check the cooling circuit', 'დაადასტურეთ ჩვენება ჭურჭელთან და შეამოწმეთ გამაგრილებელი კონტური'), { targetModule: 'vessels' }),
        action('schedule', text('Adjust cap management frequency while the temperature is out of band', 'ტემპერატურის დიაპაზონიდან გასვლისას შეცვალეთ ქუდის მართვის სიხშირე'), { targetModule: 'operations' }),
      ],
      evidence: [
        evidence('fact', text('Vessel temperature', 'ჭურჭლის ტემპერატურა'), plain(`${num(vessel.temperature, 1)} °C`), `vessels:${vessel.id}`),
        evidence('fact', text('Working band', 'სამუშაო დიაპაზონი'), plain(`${num(lower, 1)}–${num(upper, 1)} °C`)),
        evidence('fact', text('Cooling jacket', 'გამაგრილებელი პერანგი'), vessel.coolingJacketActive ? text('Active', 'აქტიური') : text('Off', 'გამორთული')),
      ],
      confidence: confidence('high', 0.9, [
        text('Read directly from the vessel record', 'პირდაპირ ჭურჭლის ჩანაწერიდან'),
      ]),
      missingInformation: [],
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// SO₂ protection, judged against the winery's own practice
// ---------------------------------------------------------------------------

export function detectSo2Protection(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): AiFinding[] {
  const findings: AiFinding[] = [];
  const targets = snapshot.config.targets;

  for (const lot of snapshot.lots) {
    if (lot.voidedAt || lot.stage === 'sold') continue;
    const labs = labsForLot(snapshot, lot.id);
    const latest = labs[0];
    if (!latest || !Number.isFinite(latest.freeSo2) || !Number.isFinite(latest.ph)) continue;

    const molecular = molecularSO2(latest.freeSo2, latest.ph);
    const belowMolecular = molecular < targets.molecularSo2MinMgL;
    const belowFreeBand = latest.freeSo2 < targets.freeSo2MinMgL;
    if (!belowMolecular && !belowFreeBand) continue;

    const wineryMedian = baselines.freeSo2MedianByStage[lot.stage];
    const label = lotLabel(snapshot, lot.id);
    const severity = molecular < targets.molecularSo2MinMgL * 0.7 ? 'critical' : 'warning';
    const ageDays = daysBetween(latest.date, snapshot.today);

    findings.push(buildFinding({
      findingType: 'so2_protection_low',
      agent: 'laboratory',
      area: 'laboratory',
      severity,
      entityType: 'lot',
      entityId: lot.id,
      entityLabel: label,
      relatedEntities: latest.tankId ? [{ type: 'vessel', id: latest.tankId, label: latest.tankId }] : [],
      title: text(`SO₂ protection below target — ${label}`, `SO₂-ის დაცვა სამიზნეზე დაბალია — ${label}`),
      observation: text(
        `Molecular SO₂ is ${num(molecular, 2)} mg/L (free ${num(latest.freeSo2, 0)} mg/L at pH ${num(latest.ph, 2)}), against this winery's ${num(targets.molecularSo2MinMgL, 2)} mg/L floor. Measured ${ageDays} day${ageDays === 1 ? '' : 's'} ago.`,
        `მოლეკულური SO₂ არის ${num(molecular, 2)} მგ/ლ (თავისუფალი ${num(latest.freeSo2, 0)} მგ/ლ, pH ${num(latest.ph, 2)}), ამ მარნის ზღვარია ${num(targets.molecularSo2MinMgL, 2)} მგ/ლ. გაზომილია ${ageDays} დღის წინ.`,
      ),
      whyItMatters: text(
        'Molecular SO₂ — not free SO₂ — is the fraction that actually suppresses Brettanomyces and acetic bacteria, and it falls sharply as pH rises.',
        'სწორედ მოლეკულური SO₂ და არა თავისუფალი, თრგუნავს Brettanomyces-სა და ძმარმჟავა ბაქტერიებს, და pH-ის ზრდისას ის მკვეთრად ეცემა.',
      ),
      possibleCauses: [
        text('Binding after a recent addition, racking, or oxygen pickup', 'შეკავშირება ბოლო დამატების, გადაღების ან ჟანგბადის შეღწევის შემდეგ'),
        text('Rising pH shifting the bisulfite equilibrium', 'მზარდი pH ცვლის ბისულფიტის წონასწორობას'),
        text('Interval since the last addition longer than usual for this cellar', 'ბოლო დამატებიდან გასული პერიოდი ამ მარნისთვის ჩვეულებრივზე გრძელია'),
      ],
      recommendedActions: [
        action('measure', text('Re-analyse free and total SO₂ before dosing', 'დოზირებამდე ხელახლა გააანალიზეთ თავისუფალი და საერთო SO₂'), { targetModule: 'labs' }),
        action('check', text('Model the KMBS addition for the confirmed volume and pH', 'გამოთვალეთ KMBS-ის დამატება დადასტურებული მოცულობისა და pH-ისთვის'), { targetModule: 'calculators' }),
      ],
      evidence: [
        evidence('fact', text('Free SO₂', 'თავისუფალი SO₂'), plain(`${num(latest.freeSo2, 0)} mg/L`), `lablogs:${latest.id}`),
        evidence('fact', text('pH', 'pH'), plain(num(latest.ph, 2)), `lablogs:${latest.id}`),
        evidence('inference', text('Molecular SO₂', 'მოლეკულური SO₂'), plain(`${num(molecular, 2)} mg/L`)),
        ...(wineryMedian !== undefined
          ? [evidence('inference', text('This winery normally holds', 'ამ მარანში ჩვეულებრივ ინახება'), plain(`${num(wineryMedian, 0)} mg/L free at this stage`))]
          : []),
      ],
      confidence: confidence(
        ageDays <= 14 ? 'high' : 'medium',
        ageDays <= 14 ? 0.9 : 0.6,
        [
          text('Calculated from a recorded laboratory analysis', 'გამოთვლილია დაფიქსირებული ლაბორატორიული ანალიზიდან'),
          ageDays > 14
            ? text(`The analysis is ${ageDays} days old; current protection may differ.`, `ანალიზს ${ageDays} დღე შესრულდა; მიმდინარე დაცვა შეიძლება განსხვავდებოდეს.`)
            : text('Analysis is recent.', 'ანალიზი ახალია.'),
        ],
      ),
      missingInformation: ageDays > 21
        ? [text('No SO₂ measurement in the last three weeks.', 'ბოლო სამი კვირის განმავლობაში SO₂ არ გაზომილა.')]
        : [],
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Volatile acidity level and trend
// ---------------------------------------------------------------------------

export function detectVolatileAcidity(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const findings: AiFinding[] = [];
  const ceiling = snapshot.config.targets.maxVolatileAcidityGL;

  for (const lot of snapshot.lots) {
    if (lot.voidedAt) continue;
    const labs = labsForLot(snapshot, lot.id).filter((lab) => Number.isFinite(lab.volatileAcid));
    if (labs.length === 0) continue;
    const latest = labs[0];
    // Oldest → newest for trend detection.
    const series = [...labs].reverse().map((lab) => lab.volatileAcid);
    const trend = detectTrend(series.slice(-4));
    const overCeiling = latest.volatileAcid > ceiling;
    const climbing = trend.sampleSize >= 3 && trend.monotonic && trend.direction === 'rising'
      && latest.volatileAcid > ceiling * 0.7;
    if (!overCeiling && !climbing) continue;

    const label = lotLabel(snapshot, lot.id);
    const severity = latest.volatileAcid > ceiling * 1.5
      ? 'critical'
      : overCeiling ? 'warning' : 'attention';

    findings.push(buildFinding({
      findingType: overCeiling ? 'volatile_acidity_high' : 'volatile_acidity_rising',
      agent: 'laboratory',
      area: 'laboratory',
      severity,
      entityType: 'lot',
      entityId: lot.id,
      entityLabel: label,
      relatedEntities: latest.tankId ? [{ type: 'vessel', id: latest.tankId, label: latest.tankId }] : [],
      title: overCeiling
        ? text(`Volatile acidity above your limit — ${label}`, `აქროლადი მჟავიანობა თქვენს ზღვარს აღემატება — ${label}`)
        : text(`Volatile acidity climbing — ${label}`, `აქროლადი მჟავიანობა იზრდება — ${label}`),
      observation: overCeiling
        ? text(
          `VA is ${num(latest.volatileAcid, 2)} g/L against your ${num(ceiling, 2)} g/L ceiling (analysis ${latest.date.slice(0, 10)}).`,
          `VA არის ${num(latest.volatileAcid, 2)} გ/ლ, თქვენი ზღვარია ${num(ceiling, 2)} გ/ლ (ანალიზი ${latest.date.slice(0, 10)}).`,
        )
        : text(
          `VA rose across the last ${trend.sampleSize} analyses, from ${num(trend.first, 2)} to ${num(trend.last, 2)} g/L, while your ceiling is ${num(ceiling, 2)} g/L.`,
          `VA გაიზარდა ბოლო ${trend.sampleSize} ანალიზში ${num(trend.first, 2)}-დან ${num(trend.last, 2)} გ/ლ-მდე, თქვენი ზღვარია ${num(ceiling, 2)} გ/ლ.`,
        ),
      whyItMatters: text(
        'Acetic acid accumulation is not reversible in the vessel; the value only ever comes down by blending, so acting early is materially cheaper than acting late.',
        'ძმარმჟავას დაგროვება ჭურჭელში შეუქცევადია; მაჩვენებელი მხოლოდ კუპაჟით მცირდება, ამიტომ ადრეული რეაგირება არსებითად იაფია.',
      ),
      possibleCauses: [
        text('Acetic bacteria activity with air contact or an unfilled headspace', 'ძმარმჟავა ბაქტერიების აქტივობა ჰაერთან კონტაქტის ან შეუვსებელი თავისუფალი სივრცის გამო'),
        text('Insufficient molecular SO₂ protection during the last interval', 'არასაკმარისი მოლეკულური SO₂-ის დაცვა ბოლო პერიოდში'),
        text('Sluggish or stuck fermentation extending the vulnerable window', 'ნელი ან გაჩერებული დუღილი ახანგრძლივებს მოწყვლად პერიოდს'),
        text('Brettanomyces or lactic spoilage in an unprotected batch', 'Brettanomyces ან რძემჟავა გაფუჭება დაუცველ პარტიაში'),
      ],
      recommendedActions: [
        action('measure', text('Confirm with a fresh VA analysis before deciding', 'გადაწყვეტილებამდე დაადასტურეთ ახალი VA ანალიზით'), { targetModule: 'labs' }),
        action('check', text('Check molecular SO₂ protection and vessel headspace', 'შეამოწმეთ მოლეკულური SO₂-ის დაცვა და ჭურჭლის თავისუფალი სივრცე'), { targetModule: 'labs' }),
        action('inspect', text('Inspect the vessel seal, bung, and topping schedule', 'დაათვალიერეთ ჭურჭლის ლუქი, საცობი და დოლივის გრაფიკი'), { targetModule: 'vessels' }),
      ],
      evidence: [
        evidence('fact', text('Latest VA', 'ბოლო VA'), plain(`${num(latest.volatileAcid, 2)} g/L`), `lablogs:${latest.id}`),
        evidence('fact', text('Winery ceiling', 'მარნის ზღვარი'), plain(`${num(ceiling, 2)} g/L`)),
        ...(trend.sampleSize >= 2
          ? [evidence('inference', text('Trend across recent analyses', 'ტენდენცია ბოლო ანალიზებში'), plain(`${num(trend.first, 2)} → ${num(trend.last, 2)} g/L`))]
          : []),
      ],
      confidence: confidence(
        trend.sampleSize >= 3 ? 'high' : 'medium',
        trend.sampleSize >= 3 ? 0.85 : 0.6,
        [
          text(`${labs.length} VA measurement${labs.length === 1 ? '' : 's'} on record for this batch`, `ამ პარტიაზე ${labs.length} VA გაზომვაა ჩაწერილი`),
        ],
      ),
      missingInformation: labs.length < 2
        ? [text('Only one VA measurement exists, so no trend could be established.', 'არსებობს მხოლოდ ერთი VA გაზომვა, ამიტომ ტენდენცია ვერ დადგინდა.')]
        : [],
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Analysis cadence
// ---------------------------------------------------------------------------

export function detectAnalysisOverdue(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const findings: AiFinding[] = [];
  const interval = snapshot.config.targets.labAnalysisIntervalDays;
  const watchedStages = new Set(['fermenting', 'maceration', 'aging', 'stabilization', 'filtration']);

  for (const lot of snapshot.lots) {
    if (lot.voidedAt || !watchedStages.has(lot.stage)) continue;
    const labs = labsForLot(snapshot, lot.id);
    const latest = labs[0];
    const age = latest ? daysBetween(latest.date, snapshot.today) : null;
    if (age !== null && age <= interval) continue;

    const label = lotLabel(snapshot, lot.id);
    const overdueBy = age === null ? null : age - interval;
    const severity = age === null || overdueBy === null
      ? 'warning'
      : overdueBy > interval ? 'warning' : 'attention';

    findings.push(buildFinding({
      findingType: 'lab_analysis_overdue',
      agent: 'laboratory',
      area: 'laboratory',
      severity,
      entityType: 'lot',
      entityId: lot.id,
      entityLabel: label,
      title: text(`Analysis overdue — ${label}`, `ანალიზი ვადაგადაცილებულია — ${label}`),
      observation: age === null
        ? text(
          `No laboratory analysis has ever been recorded for this batch, which is at the "${stageLabel(lot.stage, 'en')}" stage.`,
          `ამ პარტიისთვის ლაბორატორიული ანალიზი არასდროს ჩაწერილა, თუმცა ის "${stageLabel(lot.stage, 'ka')}" ეტაპზეა.`,
        )
        : text(
          `Last analysis was ${age} days ago (${latest.date.slice(0, 10)}); your cadence for an active batch is ${interval} days.`,
          `ბოლო ანალიზი ${age} დღის წინ ჩატარდა (${latest.date.slice(0, 10)}); აქტიური პარტიისთვის თქვენი პერიოდულობაა ${interval} დღე.`,
        ),
      whyItMatters: text(
        'Without current chemistry, SO₂ protection, VA and stability decisions are being made on stale numbers — and every other finding about this batch inherits that uncertainty.',
        'აქტუალური ქიმიის გარეშე SO₂-ის დაცვის, VA-სა და სტაბილურობის გადაწყვეტილებები ძველ ციფრებს ეყრდნობა — და ამ პარტიის ყველა სხვა დასკვნაც ამ გაურკვევლობას იმემკვიდრეობს.',
      ),
      possibleCauses: [
        text('Sampling schedule not maintained during a busy period', 'დატვირთულ პერიოდში ნიმუშების გრაფიკი არ დაცულა'),
        text('Analysis performed but not entered into the system', 'ანალიზი ჩატარდა, მაგრამ სისტემაში არ შეიტანეს'),
      ],
      recommendedActions: [
        action('create_task', text('Schedule a sampling round for this batch', 'დაგეგმეთ ამ პარტიის ნიმუშის აღება'), { targetModule: 'tasks' }),
        action('document', text('Enter any analysis already performed off-system', 'შეიტანეთ სისტემის გარეთ უკვე ჩატარებული ანალიზი'), { targetModule: 'labs' }),
      ],
      evidence: [
        evidence('fact', text('Stage', 'ეტაპი'), enumText(lot.stage, stageLabel)),
        evidence('fact', text('Last analysis', 'ბოლო ანალიზი'), latest ? plain(latest.date.slice(0, 10)) : text('never', 'არასდროს')),
        evidence('fact', text('Configured cadence', 'დაყენებული პერიოდულობა'), plain(`${interval} days`)),
      ],
      confidence: confidence('high', 0.95, [
        text('Based on recorded analysis dates only', 'ეყრდნობა მხოლოდ დაფიქსირებულ ანალიზის თარიღებს'),
      ]),
      missingInformation: [],
      cooldownHours: 72,
    }));
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Abnormal process loss on transfers
// ---------------------------------------------------------------------------

export function detectAbnormalLoss(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): AiFinding[] {
  const findings: AiFinding[] = [];
  const ceiling = snapshot.config.targets.maxProcessLossPct;
  const history = snapshot.transfers
    .filter(isLiveRecord)
    .filter((t) => Number(t.volume) > 0 && Number.isFinite(Number(t.loss)))
    .map((t) => (Number(t.loss) / Number(t.volume)) * 100);

  // Only recent movements are actionable; older ones are history, not alerts.
  const recent = snapshot.transfers
    .filter(isLiveRecord)
    .filter((t) => daysBetween((t.date || '').slice(0, 10), snapshot.today) <= 14);

  for (const transfer of recent) {
    const moved = Number(transfer.volume);
    const loss = Number(transfer.loss);
    if (!Number.isFinite(moved) || moved <= 0 || !Number.isFinite(loss) || loss <= 0) continue;
    const lossPct = (loss / moved) * 100;
    const anomaly = detectAnomaly(lossPct, history);
    const overCeiling = lossPct > ceiling;
    if (!overCeiling && !(anomaly.isAnomaly && anomaly.direction === 'above')) continue;

    const lotId = transfer.sourceLotId || transfer.resultLotId || '';
    const label = lotId ? lotLabel(snapshot, lotId) : `${transfer.sourceId} → ${transfer.destId}`;
    const wineryNorm = baselines.medianTransferLossPct;

    findings.push(buildFinding({
      findingType: 'abnormal_process_loss',
      agent: 'winemaking',
      area: 'operations',
      // Quotes a movement record: source, destination, volume and loss.
      requiredModules: ['transfers'],
      severity: lossPct > ceiling * 2 ? 'warning' : 'attention',
      entityType: 'transfer',
      entityId: transfer.id,
      entityLabel: label,
      relatedEntities: [
        { type: 'vessel', id: transfer.sourceId, label: transfer.sourceId },
        { type: 'vessel', id: transfer.destId, label: transfer.destId },
        ...(lotId ? [{ type: 'lot' as const, id: lotId, label }] : []),
      ],
      title: text(`Unusual transfer loss — ${label}`, `არაჩვეულებრივი დანაკარგი გადაღებისას — ${label}`),
      observation: text(
        `${num(loss, 1)} L lost moving ${num(moved, 0)} L from ${transfer.sourceId} to ${transfer.destId} on ${(transfer.date || '').slice(0, 10)} — ${num(lossPct, 1)}%${wineryNorm !== null ? `, against a winery median of ${num(wineryNorm, 1)}%` : ''}.`,
        `დაიკარგა ${num(loss, 1)} ლ, გადატანილია ${num(moved, 0)} ლ ${transfer.sourceId}-დან ${transfer.destId}-ში (${(transfer.date || '').slice(0, 10)}) — ${num(lossPct, 1)}%${wineryNorm !== null ? `, მარნის მედიანაა ${num(wineryNorm, 1)}%` : ''}.`,
      ),
      whyItMatters: text(
        'Loss above the cellar\'s own norm is either real wine leaving the building or a measurement that will not reconcile at audit — both are worth ten minutes now.',
        'მარნის საკუთარ ნორმაზე მაღალი დანაკარგი ან ნამდვილად დაკარგული ღვინოა, ან გაზომვაა, რომელიც აუდიტზე არ დაბალანსდება — ორივე ღირს ახლავე ათი წუთი.',
      ),
      possibleCauses: [
        text('Line, pump, or fitting leak during the movement', 'ხაზის, ტუმბოს ან შეერთების გაჟონვა გადატანისას'),
        text('Lees volume counted as loss rather than racked separately', 'ნალექის მოცულობა დანაკარგად ჩაითვალა, ცალკე გადაღების ნაცვლად'),
        text('Volume recorded by estimate rather than measurement', 'მოცულობა ჩაიწერა შეფასებით და არა გაზომვით'),
      ],
      recommendedActions: [
        action('check', text('Reconcile source and destination volumes against the vessel records', 'შეადარეთ საწყისი და მიმღები მოცულობები ჭურჭლის ჩანაწერებს'), { targetModule: 'transfers' }),
        action('inspect', text('Inspect the pump and line used for this movement', 'დაათვალიერეთ ამ გადატანისთვის გამოყენებული ტუმბო და ხაზი'), { targetModule: 'vessels' }),
      ],
      evidence: [
        evidence('fact', text('Volume moved', 'გადატანილი მოცულობა'), plain(`${num(moved, 0)} L`), `transfers:${transfer.id}`),
        evidence('fact', text('Recorded loss', 'დაფიქსირებული დანაკარგი'), plain(`${num(loss, 1)} L (${num(lossPct, 1)}%)`), `transfers:${transfer.id}`),
        ...(wineryNorm !== null
          ? [evidence('inference', text('Winery median loss', 'მარნის მედიანური დანაკარგი'), plain(`${num(wineryNorm, 1)}%`))]
          : []),
      ],
      confidence: confidence(
        anomaly.sampleSize >= 4 ? 'high' : 'medium',
        anomaly.sampleSize >= 4 ? 0.8 : 0.55,
        [
          anomaly.sampleSize >= 4
            ? text(`Compared against ${anomaly.sampleSize} previous movements`, `შედარებულია ${anomaly.sampleSize} წინა გადატანასთან`)
            : text('Limited transfer history for comparison', 'შესადარებლად გადატანების ისტორია შეზღუდულია'),
        ],
      ),
      missingInformation: [],
      cooldownHours: 168,
    }));
  }

  return findings;
}
