import { calculateVaziRisk, type VaziRiskCategory, type VaziRiskItem } from '../../vaziRisk';
import type { WineryBaselines } from '../baselines';
import { action, buildFinding, confidence, evidence } from '../finding';
import { forecastHarvestDate } from '../predictions';
import { blockLabel, daysBetween, type WineryIntelligenceSnapshot } from '../snapshot';
import { blockRecords } from '../indexes';
import { num, plain, text, type LocalizedText } from '../text';
import type { AiFinding, AiSeverity } from '../types';

/**
 * Vineyard detectors reuse the existing deterministic `calculateVaziRisk`
 * scoring rather than re-deriving disease pressure. Only the scores and levels
 * are consumed — the narrative is re-authored bilingually here, because the
 * risk engine's own reason strings are English-only.
 */

const CATEGORY_LABELS: Record<VaziRiskCategory, LocalizedText> = {
  downyMildew: text('Downy mildew', 'ჭრაქი'),
  powderyMildew: text('Powdery mildew', 'ნაცარი'),
  botrytis: text('Botrytis / grey rot', 'ნაცრისფერი სიდამპლე'),
  waterStress: text('Water stress', 'წყლის სტრესი'),
  harvestReadiness: text('Harvest readiness', 'რთველის მზადყოფნა'),
  phiConflict: text('Pre-harvest interval conflict', 'მოცდის ვადის (PHI) კონფლიქტი'),
};

const CATEGORY_CAUSES: Record<VaziRiskCategory, LocalizedText[]> = {
  downyMildew: [
    text('Warm, wet leaf-wetness periods after rainfall', 'თბილი, სველი ფოთლის პერიოდები წვიმის შემდეგ'),
    text('Protection interval exceeded since the last spray', 'ბოლო შესხურებიდან დაცვის ინტერვალი გადაცილებულია'),
    text('Dense canopy holding humidity in the fruit zone', 'სქელი ფოთლოვანი მასა ინარჩუნებს ტენს მტევნების ზონაში'),
  ],
  powderyMildew: [
    text('Mild temperatures with high humidity and low direct rainfall', 'ზომიერი ტემპერატურა მაღალი ტენიანობით და მცირე პირდაპირი ნალექით'),
    text('Shaded fruit zone with poor air movement', 'დაჩრდილული მტევნების ზონა სუსტი ჰაერის მოძრაობით'),
  ],
  botrytis: [
    text('Rain or high humidity close to or during ripening', 'წვიმა ან მაღალი ტენიანობა მომწიფების პერიოდში'),
    text('Berry splitting or insect damage opening infection sites', 'მარცვლის გასკდომა ან მწერის დაზიანება ხსნის ინფექციის კარს'),
  ],
  waterStress: [
    text('Sustained heat with no rainfall or irrigation event', 'ხანგრძლივი სიცხე ნალექისა და მორწყვის გარეშე'),
    text('Shallow soil or high evaporative demand on this aspect', 'თხელი ნიადაგი ან მაღალი აორთქლების მოთხოვნა ამ ექსპოზიციაზე'),
  ],
  harvestReadiness: [
    text('Sugar accumulation approaching the winery target', 'შაქრის დაგროვება უახლოვდება მარნის სამიზნეს'),
  ],
  phiConflict: [
    text('A spray was applied inside the pre-harvest interval for the planned picking date', 'შესხურება ჩატარდა დაგეგმილი კრეფის თარიღის მოცდის ვადის შიგნით'),
  ],
};

const CATEGORY_ACTIONS: Record<VaziRiskCategory, LocalizedText> = {
  downyMildew: text('Scout the block and review the protection interval before the next wet period', 'დაათვალიერეთ ნაკვეთი და გადახედეთ დაცვის ინტერვალს შემდეგ სველ პერიოდამდე'),
  powderyMildew: text('Scout the fruit zone and check canopy openness', 'დაათვალიერეთ მტევნების ზონა და შეამოწმეთ ფოთლოვანი მასის გახსნილობა'),
  botrytis: text('Inspect clusters for splitting and assess whether leaf removal is warranted', 'შეამოწმეთ მტევნები გასკდომაზე და შეაფასეთ ფოთლის მოცილების საჭიროება'),
  waterStress: text('Check soil moisture and review the irrigation plan', 'შეამოწმეთ ნიადაგის ტენიანობა და გადახედეთ მორწყვის გეგმას'),
  harvestReadiness: text('Take a fresh maturity sample before fixing the picking date', 'კრეფის თარიღის დაფიქსირებამდე აიღეთ ახალი სიმწიფის ნიმუში'),
  phiConflict: text('Confirm the pre-harvest interval of every recent product before picking', 'კრეფამდე დაადასტურეთ ყველა ბოლო პრეპარატის მოცდის ვადა'),
};

function severityForLevel(level: VaziRiskItem['level']): AiSeverity | null {
  switch (level) {
    case 'critical': return 'critical';
    case 'high': return 'warning';
    case 'moderate': return 'attention';
    default: return null;
  }
}

export function detectVineyardRisk(snapshot: WineryIntelligenceSnapshot): AiFinding[] {
  const findings: AiFinding[] = [];
  const today = new Date(`${snapshot.today}T00:00:00Z`);

  for (const block of snapshot.blocks) {
    const weather = snapshot.weatherByBlock[block.id];
    const records = blockRecords(snapshot, block.id);
    const summary = calculateVaziRisk({
      block,
      weather,
      ...records,
      today,
    });

    for (const item of Object.values(summary.items)) {
      // Harvest readiness gets its own richer finding with a date forecast.
      if (item.category === 'harvestReadiness') continue;
      const severity = severityForLevel(item.level);
      // Moderate disease pressure without weather data is too weak to surface.
      if (!severity || (severity === 'attention' && !weather)) continue;

      const label = blockLabel(snapshot, block.id);
      const categoryLabel = CATEGORY_LABELS[item.category];
      // The index is already newest first, so no per-block scan or sort here.
      const lastSpray = records.sprays[0];
      const lastScouting = records.scoutings[0];

      findings.push(buildFinding({
        findingType: `vineyard_risk_${item.category}`,
        agent: 'vineyard',
        area: 'vineyard',
        severity,
        entityType: 'block',
        entityId: block.id,
        entityLabel: label,
        title: text(
          `${categoryLabel.en} risk elevated — ${label}`,
          `${categoryLabel.ka}ის რისკი მომატებულია — ${label}`,
        ),
        observation: text(
          `Risk score ${item.score}/100 for ${block.grapeVariety || 'this block'} at the "${block.currentPhenology || 'unrecorded'}" stage.${weather ? ` Latest conditions: ${num(weather.temp ?? weather.tempMax ?? 0, 0)} °C, ${num(weather.humidity ?? 0, 0)}% humidity, ${num(weather.rainMm ?? 0, 1)} mm rain.` : ' No weather data is attached to this block.'}`,
          `რისკის ქულა ${item.score}/100 — ${block.grapeVariety || 'ეს ნაკვეთი'}, ფაზა "${block.currentPhenology || 'არ არის ჩაწერილი'}".${weather ? ` ბოლო პირობები: ${num(weather.temp ?? weather.tempMax ?? 0, 0)} °C, ტენიანობა ${num(weather.humidity ?? 0, 0)}%, ნალექი ${num(weather.rainMm ?? 0, 1)} მმ.` : ' ამ ნაკვეთს ამინდის მონაცემები არ აქვს მიბმული.'}`,
        ),
        whyItMatters: text(
          'Vineyard pressure is the earliest point in the chain: fruit condition at picking sets the microbial load, the chemistry and, ultimately, how much SO₂ protection the cellar will need.',
          'ვენახის წნეხი ჯაჭვის ყველაზე ადრეული წერტილია: მოსავლის მდგომარეობა კრეფისას განსაზღვრავს მიკრობულ დატვირთვას, ქიმიას და საბოლოოდ იმას, რამდენი SO₂-ის დაცვა დასჭირდება მარანს.',
        ),
        possibleCauses: CATEGORY_CAUSES[item.category],
        recommendedActions: [
          action('inspect', CATEGORY_ACTIONS[item.category], { targetModule: 'vazi' }),
          action('check', text('Confirm PHI, REI and label restrictions before any application', 'ნებისმიერ დამუშავებამდე შეამოწმეთ PHI, REI და ეტიკეტის შეზღუდვები'), { targetModule: 'vazi' }),
        ],
        evidence: [
          evidence('inference', text('Risk score', 'რისკის ქულა'), plain(`${item.score}/100`)),
          evidence('fact', text('Phenological stage', 'ფენოლოგიური ფაზა'), plain(block.currentPhenology || '—'), `blocks:${block.id}`),
          ...(lastSpray
            ? [evidence('fact', text('Last protection', 'ბოლო დაცვა'), plain(`${lastSpray.date} · ${lastSpray.productName}`), `sprays:${lastSpray.id}`)]
            : []),
          ...(lastScouting
            ? [evidence('fact', text('Last scouting', 'ბოლო დათვალიერება'), plain(`${lastScouting.date} · ${lastScouting.problemType} (${lastScouting.severity})`), `scoutings:${lastScouting.id}`)]
            : []),
        ],
        confidence: confidence(
          weather ? 'medium' : 'low',
          weather ? 0.6 : 0.35,
          [
            weather
              ? text('Weather conditions are attached to this block.', 'ამ ნაკვეთს ამინდის მონაცემები აქვს მიბმული.')
              : text('No weather data for this block; the score rests on scouting and spray history alone.', 'ამ ნაკვეთს ამინდის მონაცემები არ აქვს; ქულა ეყრდნობა მხოლოდ დათვალიერებისა და შესხურების ისტორიას.'),
            text('Disease scores are pressure estimates, not confirmed infection.', 'დაავადების ქულები წნეხის შეფასებაა და არა დადასტურებული ინფექცია.'),
          ],
        ),
        missingInformation: weather
          ? []
          : [text('No weather record is linked to this block.', 'ამ ნაკვეთს ამინდის ჩანაწერი არ აქვს მიბმული.')],
        cooldownHours: 24,
      }));
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Harvest window, compared with the winery's own historical timing
// ---------------------------------------------------------------------------

export function detectHarvestWindow(
  snapshot: WineryIntelligenceSnapshot,
  baselines: WineryBaselines,
): AiFinding[] {
  const findings: AiFinding[] = [];
  const targetBrix = snapshot.config.targets.harvestTargetBrix;

  for (const block of snapshot.blocks) {
    const samplings = blockRecords(snapshot, block.id).samplings;
    const historical = baselines.harvestTimingByVariety[(block.grapeVariety || '').trim().toLowerCase()];
    const forecast = forecastHarvestDate(samplings, {
      today: snapshot.today,
      targetBrix,
      blockEstimate: block.estimatedHarvestDate,
      varietyMedianDayOfYear: historical?.medianDayOfYear,
    });
    if (!forecast.estimatedDate || forecast.method === 'insufficient_data') continue;
    const daysAway = daysBetween(snapshot.today, forecast.estimatedDate);
    // A three-week horizon is the point at which crew, vessels and packaging
    // decisions actually become actionable.
    if (daysAway < 0 || daysAway > 21) continue;

    const label = blockLabel(snapshot, block.id);
    const severity: AiSeverity = daysAway <= 7 ? 'warning' : 'attention';

    findings.push(buildFinding({
      findingType: 'harvest_window_approaching',
      agent: 'vineyard',
      area: 'vineyard',
      // The historical timing baseline is derived from past fruit receipts.
      // Deliberately nothing from the cellar: this finding is routed to the
      // viticulturist, who holds no vessel permission, so quoting free tank
      // capacity here would either leak it or hide the finding from its
      // own audience. The recommended check points a winemaker at it instead.
      requiredModules: ['grape_intake'],
      severity,
      entityType: 'block',
      entityId: block.id,
      entityLabel: label,
      title: text(`Harvest window approaching — ${label}`, `რთველის ფანჯარა უახლოვდება — ${label}`),
      observation: text(
        `${block.grapeVariety || 'This block'} is projected to reach ${num(targetBrix, 1)} °Brix around ${forecast.estimatedDate} (${daysAway} day${daysAway === 1 ? '' : 's'} away)${forecast.latestBrix !== null ? `, from ${num(forecast.latestBrix, 1)} °Brix at the last sampling` : ''}.`,
        `${block.grapeVariety || 'ეს ნაკვეთი'} პროგნოზით მიაღწევს ${num(targetBrix, 1)} °Brix-ს დაახლოებით ${forecast.estimatedDate}-ს (${daysAway} დღეში)${forecast.latestBrix !== null ? `, ბოლო ნიმუშში იყო ${num(forecast.latestBrix, 1)} °Brix` : ''}.`,
      ),
      whyItMatters: text(
        'The picking date fixes everything downstream — crew, vessel availability, intake capacity and the first fermentation decisions all have to be in place before it, not after.',
        'კრეფის თარიღი განსაზღვრავს ყველაფერს შემდგომში — ბრიგადა, ჭურჭლის ხელმისაწვდომობა, მიღების სიმძლავრე და დუღილის პირველი გადაწყვეტილებები მზად უნდა იყოს მანამდე და არა შემდეგ.',
      ),
      possibleCauses: [
        text('Sugar accumulating at the rate measured in recent samplings', 'შაქარი გროვდება ბოლო ნიმუშებში გაზომილი ტემპით'),
      ],
      recommendedActions: [
        action('measure', text('Take a maturity sample within the next few days', 'უახლოეს დღეებში აიღეთ სიმწიფის ნიმუში'), { targetModule: 'vazi' }),
        action('check', text('Confirm empty vessel capacity for the expected intake', 'დაადასტურეთ ცარიელი ჭურჭლის ტევადობა მოსალოდნელი მიღებისთვის'), { targetModule: 'vessels' }),
        action('schedule', text('Confirm picking crew and transport', 'დაადასტურეთ მკრეფავთა ბრიგადა და ტრანსპორტი'), { targetModule: 'tasks' }),
      ],
      evidence: [
        evidence('prediction', text('Projected picking date', 'პროგნოზირებული კრეფის თარიღი'), plain(forecast.estimatedDate)),
        ...(forecast.brixPerDay !== null
          ? [evidence('inference', text('Sugar accumulation', 'შაქრის დაგროვება'), plain(`${num(forecast.brixPerDay, 2)} °Brix/day`))]
          : []),
        ...(historical
          ? [evidence('inference', text('Winery history for this variety', 'მარნის ისტორია ამ ჯიშისთვის'), text(
            `usually received around day ${Math.round(historical.medianDayOfYear)} of the year (${historical.sampleSize} intakes)`,
            `ჩვეულებრივ მიიღება წლის დაახლოებით ${Math.round(historical.medianDayOfYear)}-ე დღეს (${historical.sampleSize} მიღება)`,
          ))]
          : []),
      ],
      confidence: confidence(
        forecast.method === 'sugar_accumulation' ? 'medium' : 'low',
        forecast.method === 'sugar_accumulation' ? 0.6 : 0.3,
        [
          forecast.method === 'sugar_accumulation'
            ? text('Projected from this block\'s own recent sugar curve.', 'გამოთვლილია ამ ნაკვეთის ბოლო შაქრის მრუდიდან.')
            : forecast.method === 'block_estimate'
              ? text('Taken from the stored block estimate, not from measurements.', 'აღებულია ნაკვეთის შენახული შეფასებიდან და არა გაზომვებიდან.')
              : text('Taken from this winery\'s historical timing for the variety.', 'აღებულია ამ მარნის ისტორიული ვადებიდან ამ ჯიშისთვის.'),
          text('Weather in the remaining window can move this date materially.', 'დარჩენილ პერიოდში ამინდმა შეიძლება ეს თარიღი მნიშვნელოვნად შეცვალოს.'),
        ],
      ),
      missingInformation: samplings.length < 2
        ? [text('Fewer than two maturity samplings exist for this block.', 'ამ ნაკვეთისთვის ორზე ნაკლები სიმწიფის ნიმუშია.')]
        : [],
      cooldownHours: 48,
    }));
  }

  return findings;
}
