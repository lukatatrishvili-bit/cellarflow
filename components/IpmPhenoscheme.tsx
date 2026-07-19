import React, { useState, useMemo, useEffect } from 'react';
import type { VineyardBlock, SprayRecord, UserProfile } from '../lib/wineryState';
import type { Language } from '../lib/i18n';
import { 
  Sprout, ShieldAlert, Sparkles, AlertTriangle, 
  CheckCircle2, Info, Calendar, Plus, Trash2, 
  RefreshCw, CheckSquare, Layers, Wind
} from 'lucide-react';

interface ActiveIngredientGroup {
  group_ka: string;
  group_en: string;
  moa: string;
  target: string;
}

interface PhenoStage {
  id: string;
  bbch: string;
  stage_ka: string;
  stage_en: string;
  main_risks_ka: string[];
  main_risks_en: string[];
  monitoring_ka: string;
  monitoring_en: string;
  cultural_actions_ka: string[];
  cultural_actions_en: string[];
  treatment_strategy_ka: Record<'low' | 'medium' | 'high', string>;
  treatment_strategy_en: Record<'low' | 'medium' | 'high', string>;
  active_ingredient_groups: ActiveIngredientGroup[];
  resistance_note_ka: string;
  resistance_note_en: string;
  app_warning_ka: string;
  app_warning_en: string;
}

interface TrapRecord {
  id: string;
  blockId: string;
  date: string;
  mothsCount: number;
  generation: 'Gen 1' | 'Gen 2' | 'Gen 3';
  operator: string;
}

interface IpmPhenoschemeProps {
  lang: Language;
  selectedBlock: VineyardBlock | null;
  sprays: SprayRecord[];
  onAddSprayRecord: (rec: Omit<SprayRecord, 'id'>) => void;
  currentUser: UserProfile;
  blockWeather: any;
  canCreateVineyardRecord?: boolean;
  canDeleteVineyardRecord?: boolean;
}

// 10 Phenological Stages Seed Data
const PHENOLOGICAL_STAGES: PhenoStage[] = [
  {
    id: "dormant_pre_bud_swell",
    bbch: "00-03",
    stage_ka: "მოსვენება / კვირტების დაბერვამდე",
    stage_en: "Dormancy / before bud swelling",
    main_risks_ka: ["მოზამთრე ტკიპები", "ცრუფარიანები", "კვირტის ჭია", "მერქნის ინფექციის წყაროები"],
    main_risks_en: ["overwintering mites", "scale insects", "bud moth", "wood-borne infection sources"],
    monitoring_ka: "შეამოწმეთ შტამბი, მხრები, ძველი ქერქი და კვირტები. მკურნალობა მხოლოდ საჭიროებისას.",
    monitoring_en: "Inspect trunk, cordons, old bark and buds. Treat only when needed.",
    cultural_actions_ka: ["დასნებოვნებული ნასხლავის გატანა", "ძველი ქერქის და შტამბის ვიზუალური შემოწმება", "ვენახის სისუფთავის კონტროლი"],
    cultural_actions_en: ["Remove infected prunings", "Inspect old bark and trunk", "Maintain vineyard sanitation"],
    treatment_strategy_ka: {
      low: "ქიმიური ჩარევა ჩვეულებრივ არ არის საჭირო; საკმარისია სანიტარული სამუშაოები და მონიტორინგი.",
      medium: "მოზამთრე მავნებლების არსებობისას შესაძლებელია ზეთოვანი ტიპის კონტაქტური დამუშავება ეტიკეტის მიხედვით.",
      high: "ძლიერი ისტორიული წნეხისას გამოიყენეთ ზეთოვანი კონტაქტური საშუალება, საჭიროების შემთხვევაში მიზნობრივი ინსექტიციდი/აკარიციდი მხოლოდ რეგისტრაციისა და ეტიკეტის მიხედვით."
    },
    treatment_strategy_en: {
      low: "Chemical intervention is usually unnecessary; sanitation and monitoring are enough.",
      medium: "If overwintering pests are present, an oil-type contact treatment may be used according to the label.",
      high: "Under strong historical pressure, use an oil-type contact treatment and, if needed, a targeted insecticide/acaricide only according to local registration and label."
    },
    active_ingredient_groups: [
      {
        group_ka: "პარაფინული/მინერალური ზეთი",
        group_en: "paraffinic/mineral oil",
        moa: "physical/contact",
        target: "overwintering pests"
      }
    ],
    resistance_note_ka: "ზეთოვანი დამუშავება ძირითადად ფიზიკური მოქმედებისაა; არ ჩაანაცვლოს მონიტორინგი.",
    resistance_note_en: "Oil treatment is mainly physical/contact action; it should not replace monitoring.",
    app_warning_ka: "არ გამოიყენოთ მწვანე ქსოვილზე, თუ ეტიკეტი ამას კრძალავს. დააზუსტეთ ტემპერატურული შეზღუდვები.",
    app_warning_en: "Do not apply on green tissue if the label restricts it. Check temperature limitations."
  },
  {
    id: "budburst_early_shoot",
    bbch: "07-13",
    stage_ka: "კვირტების გახსნა / ადრეული ყლორტი",
    stage_en: "Budburst / early shoot growth",
    main_risks_ka: ["ტკიპები", "შავი ლაქიანობა", "ადრეული ანთრაქნოზი"],
    main_risks_en: ["mites", "black spot / phomopsis", "early anthracnose"],
    monitoring_ka: "დაათვალიერეთ ახალგაზრდა ფოთლები და ქვედა მხარე. დაავადების რისკი იზრდება წვიმიან და გრილ პირობებში.",
    monitoring_en: "Inspect young leaves and leaf undersides. Disease risk rises in wet and cool conditions.",
    cultural_actions_ka: ["დასნებოვნებული ყლორტების მოცილება", "მავთულზე სწორი განაწილება კარგი აერაციისთვის"],
    cultural_actions_en: ["Remove infected shoots", "Position shoots for better air movement"],
    treatment_strategy_ka: {
      low: "მონიტორინგი; დამუშავება მხოლოდ სიმპტომების ან პროგნოზირებული ინფექციისას.",
      medium: "წვიმამდე გამოიყენეთ კონტაქტური/დამცავი სქემა შავი ლაქიანობისა და ანთრაქნოზის წინააღმდეგ.",
      high: "წვიმიან პირობებში დაიცავით ახალგაზრდა ქსოვილი; ტკიპების შემთხვევაში აირჩიეთ მიზნობრივი აკარიციდული ჯგუფი და არ გაიმეოროთ იგივე MoA."
    },
    treatment_strategy_en: {
      low: "Monitor; treat only if symptoms or forecasted infection are present.",
      medium: "Before rain, use a contact/protectant strategy against black spot and anthracnose.",
      high: "In wet conditions, protect young tissue; for mites choose a targeted acaricide group and do not repeat the same MoA."
    },
    active_ingredient_groups: [
      {
        group_ka: "სპილენძის ნაერთები",
        group_en: "copper compounds",
        moa: "FRAC M01",
        target: "protectant disease control"
      },
      {
        group_ka: "დამცავი მრავალსაიტიანი ფუნგიციდები",
        group_en: "multi-site protectant fungicides",
        moa: "FRAC M groups",
        target: "black spot / anthracnose"
      },
      {
        group_ka: "ტკიპების ზრდის რეგულატორები",
        group_en: "mite growth regulators",
        moa: "IRAC 10A/10B",
        target: "mites"
      },
      {
        group_ka: "METI ტიპის აკარიციდები",
        group_en: "METI-type acaricides",
        moa: "IRAC 21A",
        target: "mites"
      }
    ],
    resistance_note_ka: "აკარიციდები გამოიყენეთ მხოლოდ ზღვრების გადაჭარბებისას; მოერიდეთ ერთი და იგივე IRAC ჯგუფის გამეორებას.",
    resistance_note_en: "Use acaricides only above thresholds; avoid repeating the same IRAC group.",
    app_warning_ka: "გოგირდის/ზეთის კომბინაციებსა და ინტერვალებზე აპმა უნდა აჩვენოს ეტიკეტის შემოწმების გაფრთხილება.",
    app_warning_en: "The app should show a label-check warning for sulfur/oil combinations and intervals."
  },
  {
    id: "four_to_six_leaves",
    bbch: "14-16",
    stage_ka: "4-6 ფოთლის ფაზა / ყვავილედების გამოჩენა",
    stage_en: "4-6 leaves / inflorescences visible",
    main_risks_ka: ["ჭრაქი", "ნაცარი", "ანთრაქნოზი", "შავი ლაქიანობა", "სარეველები"],
    main_risks_en: ["downy mildew", "powdery mildew", "anthracnose", "black spot", "weeds"],
    monitoring_ka: "დააკავშირეთ ფენოფაზა ამინდის პროგნოზთან. ჭრაქის რისკი იზრდება წვიმითა და ტენიანობით, ნაცრის რისკი — მგრძნობიარე ჯიშებსა და თბილ ამინდში.",
    monitoring_en: "Link phenology with the weather forecast. Downy mildew risk rises with rain and humidity; powdery mildew risk rises on susceptible cultivars and warm conditions.",
    cultural_actions_ka: ["ყლორტების რეგულირება", "ვარჯის გახსნა", "სარეველების იდენტიფიკაცია: მარცვლოვანი/ორლებნიანი, ერთწლიანი/მრავალწლიანი"],
    cultural_actions_en: ["Shoot thinning", "Open the canopy", "Identify weeds: grass/broadleaf, annual/perennial"],
    treatment_strategy_ka: {
      low: "შესაძლებელია მხოლოდ კონტაქტური დამცავი მიდგომა ან მონიტორინგი, თუ პროგნოზი მშრალია.",
      medium: "დამცავი ფუნგიციდი წვიმამდე; საჭიროებისას დაამატეთ ნაცრის საწინააღმდეგო განსხვავებული MoA.",
      high: "არ დატოვოთ ახალი ზრდა დაუცველი. გამოიყენეთ კომბინაცია: მრავალსაიტიანი დამცავი + სისტემური/ტრანსლამინარული ჯგუფი, შემდეგ კი MoA როტაცია."
    },
    treatment_strategy_en: {
      low: "Use only a contact protectant approach or monitoring if the forecast is dry.",
      medium: "Protectant fungicide before rain; add a powdery mildew group with a different MoA if needed.",
      high: "Do not leave new growth unprotected. Use a combination of multi-site protectant + systemic/translaminar group, then rotate MoA."
    },
    active_ingredient_groups: [
      {
        group_ka: "სპილენძის ნაერთები",
        group_en: "copper compounds",
        moa: "FRAC M01",
        target: "downy mildew / anthracnose"
      },
      {
        group_ka: "დიტიოკარბამატები / მრავალსაიტიანი დამცავები",
        group_en: "dithiocarbamates / multi-site protectants",
        moa: "FRAC M03",
        target: "downy mildew / black rot support"
      },
      {
        group_ka: "გოგირდი",
        group_en: "sulfur",
        moa: "FRAC M02",
        target: "powdery mildew"
      },
      {
        group_ka: "ფოსფონატები",
        group_en: "phosphonates",
        moa: "FRAC P07",
        target: "downy mildew support"
      },
      {
        group_ka: "სისტემური სარეველების კონტროლი",
        group_en: "systemic weed control",
        moa: "HRAC label-specific",
        target: "weeds"
      },
      {
        group_ka: "კონტაქტური სარეველების კონტროლი",
        group_en: "contact weed control",
        moa: "HRAC label-specific",
        target: "weeds"
      }
    ],
    resistance_note_ka: "სარეველების კონტროლში ნუ დაეყრდნობით მხოლოდ ერთ HRAC ჯგუფს. ფუნგიციდებში გამოიყენეთ მრავალსაიტიანი ბაზა და როტაცია.",
    resistance_note_en: "For weed control, do not rely on only one HRAC group. For fungicides, use a multi-site base and rotation.",
    app_warning_ka: "ჰერბიციდი არ უნდა შეეხოს მწვანე ვაზის ნაწილებს. აპმა უნდა მოითხოვოს გამოყენების ზონის არჩევა: რიგშიდა/შორისი ზოლი.",
    app_warning_en: "Herbicide must not contact green vine tissues. The app should require selecting the application zone: under-vine/inter-row."
  },
  {
    id: "pre_flowering",
    bbch: "57-59",
    stage_ka: "ყვავილობის წინ",
    stage_en: "Pre-flowering",
    main_risks_ka: ["ჭრაქი", "ნაცარი", "შავი სიდამპლე", "ანთრაქნოზი", "ყურძნის ჭიის I თაობა"],
    main_risks_en: ["downy mildew", "powdery mildew", "black rot", "anthracnose", "first generation grape moth"],
    monitoring_ka: "ეს არის კრიტიკული დაცვის ფანჯრის დასაწყისი. გამოიყენეთ ამინდის მოდელი, წინა ინფექციის ისტორია და ფერომონული ხაფანგები.",
    monitoring_en: "This is the beginning of the critical protection window. Use weather model, infection history and pheromone traps.",
    cultural_actions_ka: ["ვარჯის მსუბუქი გახსნა", "მტევნების ზონის აერაციის გაუმჯობესება", "ხაფანგების შემოწმება კვირაში მინიმუმ ერთხელ"],
    cultural_actions_en: ["Light canopy opening", "Improve bunch-zone ventilation", "Check traps at least once per week"],
    treatment_strategy_ka: {
      low: "დამცავი პროგრამა მინიმალური ჩარევით; ნუ გამოიყენებთ მაღალი რისკის MoA-ს საჭიროების გარეშე.",
      medium: "ჭრაქისა და ნაცრის წინააღმდეგ გამოიყენეთ ორი განსხვავებული მოქმედების ჯგუფი, განსაკუთრებით წვიმის წინ.",
      high: "გამოიყენეთ ძლიერი პრევენციული სტრატეგია: ჭრაქი + ნაცარი + შავი სიდამპლე. მავნებლების წინააღმდეგ იმოქმედეთ მხოლოდ ხაფანგებისა და ზღვრების მიხედვით."
    },
    treatment_strategy_en: {
      low: "Protective program with minimal intervention; do not use high-risk MoA without need.",
      medium: "Use two different action groups against downy and powdery mildew, especially before rain.",
      high: "Use a strong preventive strategy: downy mildew + powdery mildew + black rot. Treat pests only according to traps and thresholds."
    },
    active_ingredient_groups: [
      { group_ka: "ფენილამიდები", group_en: "phenylamides", moa: "FRAC 4", target: "downy mildew" },
      { group_ka: "CAA ჯგუფი", group_en: "CAA group", moa: "FRAC 40", target: "downy mildew" },
      { group_ka: "ციმოქსანილის ჯგუფი", group_en: "cymoxanil group", moa: "FRAC 27", target: "downy mildew curative support" },
      { group_ka: "ფოსფონატები", group_en: "phosphonates", moa: "FRAC P07", target: "downy mildew support" },
      { group_ka: "DMI ტრიაზოლები", group_en: "DMI triazoles", moa: "FRAC 3", target: "powdery mildew / black rot" },
      { group_ka: "ქვინაზოლინონები", group_en: "quinazolinones", moa: "FRAC 13", target: "powdery mildew" },
      { group_ka: "გოგირდი", group_en: "sulfur", moa: "FRAC M02", target: "powdery mildew" },
      { group_ka: "დიამიდები", group_en: "diamides", moa: "IRAC 28", target: "grape moth" },
      { group_ka: "სპინოსინები", group_en: "spinosyns", moa: "IRAC 5", target: "grape moth" },
      { group_ka: "Bacillus thuringiensis", group_en: "Bacillus thuringiensis", moa: "IRAC 11A", target: "grape moth larvae" }
    ],
    resistance_note_ka: "ყვავილობის წინ ნუ გაიმეორებთ იმავე FRAC ჯგუფს, რომელიც გამოყენებული იყო 4-6 ფოთლის ფაზაში, თუ არსებობს ალტერნატივა.",
    resistance_note_en: "Before flowering, do not repeat the same FRAC group used at 4-6 leaves if an alternative exists.",
    app_warning_ka: "აპმა უნდა მონიშნოს ეს ეტაპი როგორც 'კრიტიკული დაცვის ფანჯარა'.",
    app_warning_en: "The app should mark this stage as a 'critical protection window'."
  },
  {
    id: "flowering",
    bbch: "60-69",
    stage_ka: "ყვავილობა",
    stage_en: "Flowering",
    main_risks_ka: ["ჭრაქი", "ნაცარი", "შავი სიდამპლე", "ფიტოტოქსიკურობის რისკი", "დამამტვერიანებლების დაცვა"],
    main_risks_en: ["downy mildew", "powdery mildew", "black rot", "phytotoxicity risk", "pollinator protection"],
    monitoring_ka: "ყვავილობისას ჩარევა უნდა იყოს ფრთხილი. შეამოწმეთ ამინდი, ყვავილობის პროცენტი და პრეპარატის ეტიკეტი.",
    monitoring_en: "Intervention during flowering must be careful. Check weather, flowering percentage and product label.",
    cultural_actions_ka: ["შესხურების დროის სწორად შერჩევა", "დამამტვერიანებლების აქტივობის საათების თავიდან აცილება", "ვარჯის ზედმეტი ჩარევის შეზღუდვა"],
    cultural_actions_en: ["Choose spraying time carefully", "Avoid pollinator activity hours", "Limit excessive canopy operations"],
    treatment_strategy_ka: {
      low: "თუ ამინდი მშრალია, შესაძლებელია მხოლოდ მონიტორინგი და საჭიროების შემთხვევაში რბილი დამცავი მიდგომა.",
      medium: "შეინარჩუნეთ დაცვა ჭრაქისა და ნაცრის წინააღმდეგ, მაგრამ აირჩიეთ ყვავილობისთვის უსაფრთხო ვარიანტი ეტიკეტის მიხედვით.",
      high: "წვიმიან პირობებში არ დატოვოთ ყვავილობა დაუცველი; გამოიყენეთ ეტიკეტით დაშვებული და ფიტოტოქსიკურობის მხრივ უსაფრთხო ჯგუფები."
    },
    treatment_strategy_en: {
      low: "If weather is dry, monitoring and a soft protectant approach may be enough.",
      medium: "Maintain protection against downy and powdery mildew, but choose options safe for flowering according to the label.",
      high: "In rainy conditions, do not leave flowering unprotected; use label-allowed groups with low phytotoxicity risk."
    },
    active_ingredient_groups: [
      { group_ka: "მრავალსაიტიანი დამცავები", group_en: "multi-site protectants", moa: "FRAC M groups", target: "general protection" },
      { group_ka: "გოგირდი (დაბალ დოზებში)", group_en: "sulfur (at low rates)", moa: "FRAC M02", target: "powdery mildew" },
      { group_ka: "ფოსფონატები", group_en: "phosphonates", moa: "FRAC P07", target: "downy mildew support" }
    ],
    resistance_note_ka: "ყვავილობისას მოერიდეთ ზედმეტ სისტემურ ჩარევას; გააგრძელეთ FRAC როტაცია.",
    resistance_note_en: "Avoid unnecessary systemic intervention during flowering; continue FRAC rotation.",
    app_warning_ka: "აპმა უნდა აჩვენოს: 'ყვავილობის ფაზა — შეამოწმეთ ფუტკრის, ფიტოტოქსიკურობისა და ეტიკეტის შეზღუდვები.'",
    app_warning_en: "The app should display: 'Flowering stage — check bee, phytotoxicity and label restrictions.'"
  },
  {
    id: "fruit_set_post_flowering",
    bbch: "71-73",
    stage_ka: "ყვავილობის შემდეგ / გამონასკვა",
    stage_en: "Post-flowering / fruit set",
    main_risks_ka: ["ჭრაქი", "ნაცარი", "შავი სიდამპლე", "ნაცრისფერი სიდამპლის ადრეული რისკი"],
    main_risks_en: ["downy mildew", "powdery mildew", "black rot", "early Botrytis risk"],
    monitoring_ka: "ეს არის კრიტიკული დაცვის ფანჯრის გაგრძელება. ახალი მარცვალი ძალიან მგრძნობიარეა.",
    monitoring_en: "This is the continuation of the critical protection window. Young berries are highly susceptible.",
    cultural_actions_ka: ["მტევნის ზონის აერაცია", "საჭიროებისას ზომიერი ფოთლის გაცლა", "ჭარბი აზოტისა და ზედმეტი ვეგეტაციის კონტროლი"],
    cultural_actions_en: ["Bunch-zone ventilation", "Moderate leaf removal if needed", "Control excessive nitrogen and vigor"],
    treatment_strategy_ka: {
      low: "დამცავი ინტერვალები შეიძლება გაიწელოს მხოლოდ მშრალ ამინდში და სუფთა ვენახში.",
      medium: "გააგრძელეთ ჭრაქისა და ნაცრის კონტროლი განსხვავებული MoA ჯგუფებით.",
      high: "წვიმის, ძლიერი ზრდისა და ისტორიული ინფექციისას გამოიყენეთ კომბინირებული დაცვა; დაამატეთ Botrytis სტრატეგია კომპაქტური მტევნების შემთხვევაში."
    },
    treatment_strategy_en: {
      low: "Protection intervals may be extended only in dry weather and clean vineyards.",
      medium: "Continue downy and powdery mildew control with different MoA groups.",
      high: "Under rain, strong growth and infection history, use combined protection; add Botrytis strategy for compact bunches."
    },
    active_ingredient_groups: [
      { group_ka: "CAA ჯგუფი", group_en: "CAA group", moa: "FRAC 40", target: "downy mildew" },
      { group_ka: "QoI სტრობილურინები", group_en: "QoI strobilurins", moa: "FRAC 11", target: "powdery mildew / black rot support" },
      { group_ka: "DMI ჯგუფი", group_en: "DMI group", moa: "FRAC 3", target: "powdery mildew / black rot" },
      { group_ka: "SDHI ჯგუფი", group_en: "SDHI group", moa: "FRAC 7", target: "powdery mildew / Botrytis" },
      { group_ka: "ანილინოპირიმიდინები", group_en: "anilinopyrimidines", moa: "FRAC 9", target: "Botrytis" },
      { group_ka: "ფენილპიროლები", group_en: "phenylpyrroles", moa: "FRAC 12", target: "Botrytis" },
      { group_ka: "ჰიდროქსიანილიდები", group_en: "hydroxyanilides", moa: "FRAC 17", target: "Botrytis" }
    ],
    resistance_note_ka: "QoI და SDHI ჯგუფები მაღალი რეზისტენტობის რისკისაა; შეზღუდეთ გამოყენება და ყოველთვის როტაციით იმუშავეთ.",
    resistance_note_en: "QoI and SDHI groups have high resistance risk; limit use and always rotate.",
    app_warning_ka: "აპმა უნდა შეამოწმოს წინა შეწამვლის FRAC კოდი და შემოგთავაზოთ განსხვავებული ჯგუფი.",
    app_warning_en: "The app should check the previous spray FRAC code and suggest a different group."
  },
  {
    id: "pea_size_bunch_development",
    bbch: "75-77",
    stage_ka: "ისვრიმობის პერიოდი / მარცვლის ზრდა",
    stage_en: "Pea-size berry / berry growth",
    main_risks_ka: ["ჭრაქი", "ნაცარი", "ყურძნის ჭიის II თაობა", "ჭიჭინობელა", "ტკიპები"],
    main_risks_en: ["downy mildew", "powdery mildew", "second generation grape moth", "leafhoppers", "mites"],
    monitoring_ka: "დააკვირდით ხაფანგების მონაცემებს, ფოთლის ქვედა მხარეს, ახალი ზრდის სისუფთავეს და მოსალოდნელ წვიმებს.",
    monitoring_en: "Observe trap data, leaf undersides, cleanliness of new growth and expected rains.",
    cultural_actions_ka: ["ვარჯის რეგულირება", "სარეველების კონტროლი", "მტევნის ზონის ზომიერი გახსნა"],
    cultural_actions_en: ["Canopy regulation", "Weed control", "Moderate bunch-zone opening"],
    treatment_strategy_ka: {
      low: "შეამცირეთ ჩარევა და დაეყრდენით მონიტორინგს; მოერიდეთ ზედმეტ ინსექტიციდებს.",
      medium: "ჭრაქისა და ნაცრის საწინააღმდეგოდ გააგრძელეთ როტაცია. მავნებლები დაამუშავეთ მხოლოდ ზღვრების მიხედვით.",
      high: "მაღალი წნეხისას შეინარჩუნეთ დაცვა, განსაკუთრებით წვიმის წინ. მავნებლებისთვის გამოიყენეთ განსხვავებული IRAC ჯგუფი წინა თაობასთან შედარებით."
    },
    treatment_strategy_en: {
      low: "Reduce intervention and rely on monitoring; avoid unnecessary insecticides.",
      medium: "Continue rotation against downy and powdery mildew. Treat pests only according to thresholds.",
      high: "Under high pressure, maintain protection, especially before rain. For pests, use a different IRAC group from the previous generation."
    },
    active_ingredient_groups: [
      { group_ka: "სპილენძის ნაერთები", group_en: "copper compounds", moa: "FRAC M01", target: "downy mildew support" },
      { group_ka: "ფოსფონატები", group_en: "phosphonates", moa: "FRAC P07", target: "downy mildew support" },
      { group_ka: "DMI ჯგუფი", group_en: "DMI group", moa: "FRAC 3", target: "powdery mildew" },
      { group_ka: "ქვინაზოლინონები", group_en: "quinazolinones", moa: "FRAC 13", target: "powdery mildew" },
      { group_ka: "დიამიდები", group_en: "diamides", moa: "IRAC 28", target: "grape moth" },
      { group_ka: "ოქსადიაზინები", group_en: "oxadiazines", moa: "IRAC 22A", target: "grape moth" },
      { group_ka: "ავერმექტინები", group_en: "avermectins", moa: "IRAC 6", target: "mites / moth" }
    ],
    resistance_note_ka: "ყურძნის ჭიის თაობებს შორის შეცვალეთ IRAC ჯგუფი. არ გამოიყენოთ ერთი MoA ზედიზედ თაობებზე.",
    resistance_note_en: "Change IRAC group between grape moth generations. Do not use one MoA on successive generations.",
    app_warning_ka: "აპში უნდა იყოს ხაფანგების ჩანაწერი: დაჭერილი პეპლები/კვირა, ზღვარი, რეკომენდაციის სტატუსი.",
    app_warning_en: "The app should include trap log: moths caught/week, threshold and recommendation status."
  },
  {
    id: "bunch_closure",
    bbch: "79",
    stage_ka: "მტევნის შეკვრა / სრული ისვრიმობა",
    stage_en: "Bunch closure",
    main_risks_ka: ["ნაცრისფერი სიდამპლე", "მტევნის შიდა ინფექციები", "ნაცარი", "ჭრაქი ფოთოლზე"],
    main_risks_en: ["Botrytis", "internal bunch infections", "powdery mildew", "downy mildew on leaves"],
    monitoring_ka: "შეაფასეთ მტევნის კომპაქტურობა, დაზიანებები, სეტყვა, ჩიტი/მწერი, ტენიანი მიკროკლიმატი.",
    monitoring_en: "Evaluate bunch compactness, wounds, hail, bird/insect damage and humid microclimate.",
    cultural_actions_ka: ["ფოთლის გაცლა მტევნის ზონაში", "ვარჯის აერაცია", "ზედმეტი მორწყვისა და აზოტის თავიდან აცილება"],
    cultural_actions_en: ["Leaf removal around bunch zone", "Canopy aeration", "Avoid excessive irrigation and nitrogen"],
    treatment_strategy_ka: {
      low: "Botrytis-ის სპეციფიკური ჩარევა მხოლოდ კომპაქტურ მტევნებში ან დაზიანებებისას.",
      medium: "მტევნის შეკვრამდე/შეკვრისას გამოიყენეთ Botrytis-ის სტრატეგია, თუ ჯიში ან ამინდი რისკიანია.",
      high: "კომპაქტურ მტევნებში და ნოტიო ზონებში აუცილებელია Botrytis-ის პრევენცია განსხვავებული FRAC ჯგუფით."
    },
    treatment_strategy_en: {
      low: "Botrytis-specific intervention only for compact bunches or wounds.",
      medium: "Before/at bunch closure, use a Botrytis strategy if cultivar or weather is risky.",
      high: "In compact bunches and humid zones, Botrytis prevention with a different FRAC group is necessary."
    },
    active_ingredient_groups: [
      { group_ka: "ანილინოპირიმიდინები", group_en: "anilinopyrimidines", moa: "FRAC 9", target: "Botrytis" },
      { group_ka: "ფენილპიროლები", group_en: "phenylpyrroles", moa: "FRAC 12", target: "Botrytis" },
      { group_ka: "ჰიდროქსიანილიდები", group_en: "hydroxyanilides", moa: "FRAC 17", target: "Botrytis" },
      { group_ka: "SDHI ჯგუფი", group_en: "SDHI group", moa: "FRAC 7", target: "Botrytis" },
      { group_ka: "დამცავი სპილენძის ჯგუფი", group_en: "protectant copper group", moa: "FRAC M01", target: "downy mildew on leaves" }
    ],
    resistance_note_ka: "Botrytis-ისთვის სეზონზე არ გადააჭარბოთ ერთსა და იმავე FRAC ჯგუფს. აპმა უნდა დათვალოს Botrytis ჯგუფების გამოყენება.",
    resistance_note_en: "For Botrytis, do not overuse the same FRAC group in one season. The app should count Botrytis group use.",
    app_warning_ka: "მტევნის შეკვრის შემდეგ შიდა მარცვლებთან შეღწევა რთულდება; პრევენცია უნდა გაკეთდეს დროულად.",
    app_warning_en: "After bunch closure, penetration into the inner bunch becomes difficult; prevention must be timely."
  },
  {
    id: "veraison",
    bbch: "81-83",
    stage_ka: "შეთვალება",
    stage_en: "Veraison",
    main_risks_ka: ["ნაცრისფერი სიდამპლე", "ყურძნის ჭიის III თაობა", "გვიანი ჭრაქი ფოთოლზე", "ნარჩენების/MRL რისკი"],
    main_risks_en: ["Botrytis", "third generation grape moth", "late downy mildew on leaves", "residue/MRL risk"],
    monitoring_ka: "ყურადღება მიაქციეთ მოსავლის სავარაუდო თარიღს, ლოდინის პერიოდს, ხაფანგების მონაცემებს, მტევნის დაზიანებებს და წვიმის პროგნოზს.",
    monitoring_en: "Pay attention to expected harvest date, PHI, trap data, bunch injuries and rain forecast.",
    cultural_actions_ka: ["ზედმეტი ტენიანობის შემცირება", "დაზიანებული მტევნების მოცილება საჭიროებისას", "მოსავლის ხარისხის მონიტორინგი"],
    cultural_actions_en: ["Reduce excessive humidity", "Remove damaged bunches if needed", "Monitor harvest quality"],
    treatment_strategy_ka: {
      low: "ქიმიური ჩარევა ხშირად აღარ არის საჭირო; ფოკუსი გადაიტანეთ ნარჩენებზე და მოსავლის დაგეგმვაზე.",
      medium: "თუ საჭიროა, გამოიყენეთ მოკლე PHI-ის მქონე დაბალნარჩენიანი ჯგუფები ეტიკეტის მიხედვით.",
      high: "Botrytis-ის ან ჭიის ძლიერი რისკისას იმოქმედეთ მხოლოდ PHI/MRL-ის მკაცრი კონტროლით და გამოიყენეთ განსხვავებული MoA."
    },
    treatment_strategy_en: {
      low: "Chemical intervention is often no longer needed; focus on residues and harvest planning.",
      medium: "If needed, use low-residue groups with short PHI according to the label.",
      high: "Under strong Botrytis or moth risk, act only with strict PHI/MRL control and use a different MoA."
    },
    active_ingredient_groups: [
      { group_ka: "სპილენძის ნაერთები", group_en: "copper compounds (low residue)", moa: "FRAC M01", target: "late downy mildew leaf protection" },
      { group_ka: "Botrytis-ის დაბალნარჩენიანი ჯგუფები", group_en: "low-residue Botrytis groups", moa: "label-specific FRAC", target: "Botrytis" },
      { group_ka: "ბიოინსექტიციდები", group_en: "bioinsecticides", moa: "IRAC 11A", target: "grape moth larvae" },
      { group_ka: "სპინოსინები", group_en: "spinosyns", moa: "IRAC 5", target: "grape moth" },
      { group_ka: "ავერმექტინები", group_en: "avermectins", moa: "IRAC 6", target: "moth/mites" }
    ],
    resistance_note_ka: "გვიან ფაზაში პრიორიტეტია PHI, MRL და ღვინის ხარისხი. მოერიდეთ არასაჭირო სისტემურ ჩარევას.",
    resistance_note_en: "At late stages, PHI, MRL and wine quality are priorities. Avoid unnecessary systemic intervention.",
    app_warning_ka: "აპმა უნდა დაბლოკოს რეკომენდაცია, თუ არჩეული პროდუქტის PHI მოსავლის თარიღს სცდება.",
    app_warning_en: "The app should block the recommendation if the selected product PHI exceeds the harvest date."
  },
  {
    id: "pre_harvest_harvest",
    bbch: "85-89",
    stage_ka: "მოსავლის წინ / სიმწიფე",
    stage_en: "Pre-harvest / ripening",
    main_risks_ka: ["მტევნის სიდამპლე", "ნარჩენები", "მოსავლის ხარისხი", "სანიტარული კრეფა"],
    main_risks_en: ["bunch rot", "residues", "harvest quality", "sanitary picking"],
    monitoring_ka: "აკონტროლეთ შაქარი, მჟავიანობა, pH, ლპობა, დაზიანებული მტევნები და ამინდის პროგნოზი.",
    monitoring_en: "Monitor sugar, acidity, pH, rot, damaged bunches and weather forecast.",
    cultural_actions_ka: ["სანიტარული კრეფის დაგეგმვა", "დაზიანებული მტევნების განცალკევება", "მოსავლის ლოგისტიკის მომზადება"],
    cultural_actions_en: ["Plan sanitary picking", "Separate damaged bunches", "Prepare harvest logistics"],
    treatment_strategy_ka: {
      low: "არ ჩაატაროთ არასაჭირო ქიმიური ჩარევა.",
      medium: "ფოკუსი გადაიტანეთ მოსავლის ხარისხის მართვაზე; ქიმიური ჩარევა მხოლოდ უკიდურესად საჭიროებისას.",
      high: "თუ ამინდი მოსავალს ემუქრება, პრიორიტეტია დროული კრეფა და სორტირება; ნებისმიერი ჩარევა უნდა აკმაყოფილებდეს PHI/MRL მოთხოვნებს."
    },
    treatment_strategy_en: {
      low: "Do not perform unnecessary chemical intervention.",
      medium: "Focus on harvest quality management; chemical intervention only if absolutely necessary.",
      high: "If weather threatens harvest, prioritize timely picking and sorting; any intervention must satisfy PHI/MRL requirements."
    },
    active_ingredient_groups: [
      { group_ka: "ქიმიური ჩარევა მხოლოდ ეტიკეტით დაშვებულ უკიდურეს შემთხვევაში", group_en: "chemical intervention only in label-allowed exceptional cases", moa: "label-specific", target: "last resort" }
    ],
    resistance_note_ka: "მოსავლის წინ რეზისტენტობის მართვაზე მეტად მნიშვნელოვანია ნარჩენების კონტროლი და ღვინის ხარისხი.",
    resistance_note_en: "Before harvest, residue control and wine quality are more important than adding new chemical pressure.",
    app_warning_ka: "აპმა უნდა აჩვენოს მკაფიო წითელი გაფრთხილება: 'შეამოწმეთ ლოდინის პერიოდი და საექსპორტო MRL.'",
    app_warning_en: "The app should show a clear red warning: 'Check PHI and export MRL.'"
  }
];

export default function IpmPhenoscheme({
  lang,
  selectedBlock,
  sprays,
  onAddSprayRecord,
  currentUser,
  blockWeather,
  canCreateVineyardRecord = true,
  canDeleteVineyardRecord = true,
}: IpmPhenoschemeProps) {
  const isKa = lang === 'ka';

  const translateTarget = (target: string): string => {
    if (!isKa) return target;
    const clean = target.trim();
    const map: Record<string, string> = {
      'overwintering pests': 'მოზამთრე მავნებლები',
      'scale insects': 'ცრუფარიანები',
      'bud moth': 'კვირტის ჭია',
      'wood-borne infection sources': 'მერქნის ინფექციის წყაროები',
      'mites': 'ტკიპები',
      'black spot / phomopsis': 'შავი ლაქიანობა / ფომოფსისი',
      'early anthracnose': 'ადრეული ანთრაქნოზი',
      'black spot': 'შავი ლაქიანობა',
      'black spot / anthracnose': 'შავი ლაქიანობა / ანთრაქნოზი',
      'protectant disease control': 'დამცავი კონტროლი',
      'downy mildew': 'ჭრაქი',
      'powdery mildew': 'ნაცარი',
      'anthracnose': 'ანთრაქნოზი',
      'weeds': 'სარეველები',
      'downy mildew / anthracnose': 'ჭრაქი / ანთრაქნოზი',
      'downy mildew / black rot support': 'ჭრაქი / შავი სიდამპლე',
      'downy mildew support': 'ჭრაქის კონტროლის ხელშეწყობა',
      'downy mildew curative support': 'ჭრაქის მოკლე სამკურნალო ეფექტი',
      'downy mildew short curative support': 'ჭრაქის მოკლე სამკურნალო ეფექტი',
      'black rot': 'შავი სიდამპლე',
      'first generation grape moth': 'ყურძნის ჭიის I თაობა',
      'second generation grape moth': 'ყურძნის ჭიის II თაობა',
      'third generation grape moth': 'ყურძნის ჭიის III თაობა',
      'grape moth': 'ყურძნის ჭია',
      'grape moth larvae': 'ყურძნის ჭიის მატლები',
      'phytotoxicity risk': 'ფიტოტოქსიკურობის რისკი',
      'pollinator protection': 'დამამტვერიანებლების დაცვა',
      'general protection': 'ზოგადი დაცვა',
      'early Botrytis risk': 'ნაცრისფერი სიდამპლის ადრეული რისკი',
      'powdery mildew / black rot support': 'ნაცარი / შავი სიდამპლე',
      'powdery mildew / black rot': 'ნაცარი / შავი სიდამპლე',
      'powdery mildew / Botrytis': 'ნაცარი / ნაცრისფერი სიდამპლე',
      'Botrytis': 'ნაცრისფერი სიდამპლე (ბოტრიტისი)',
      'leafhoppers': 'ჭიჭინობელა',
      'mites / moth': 'ტკიპები / ჭია',
      'moth/mites': 'ჭია / ტკიპები',
      'internal bunch infections': 'მტევნის შიდა ინფექციები',
      'downy mildew on leaves': 'ჭრაქი ფოთოლზე',
      'late downy mildew on leaves': 'გვიანი ჭრაქი ფოთოლზე',
      'late downy mildew leaf protection': 'გვიანი ჭრაქისგან ფოთლის დაცვა',
      'residue/MRL risk': 'ნარჩენების/MRL რისკი',
      'low-residue Botrytis groups': 'დაბალნარჩენიანი ბოტრიტისის ჯგუფები',
      'bunch rot': 'მტევნის სიდამპლე',
      'residues': 'ნარჩენები',
      'harvest quality': 'მოსავლის ხარისხი',
      'sanitary picking': 'სანიტარული კრეფა',
      'last resort': 'უკიდურესი შემთხვევა'
    };
    return map[clean] || map[clean.toLowerCase()] || clean;
  };
  
  // Navigation tabs inside the IPM module
  const [ipmTab, setIpmTab] = useState<'timeline' | 'risk' | 'traps' | 'sprays'>('timeline');
  const [selectedStageId, setSelectedStageId] = useState<string>(PHENOLOGICAL_STAGES[2].id); // default to 4-6 leaves

  // Pheromone trap logs state, loaded from local storage
  const [traps, setTraps] = useState<TrapRecord[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('vinea_ipm_traps');
      return saved ? JSON.parse(saved) : [
        { id: 'trap-1', blockId: 'block-1', date: '2026-05-15', mothsCount: 12, generation: 'Gen 1', operator: 'Luka Tatrishvili' },
        { id: 'trap-2', blockId: 'block-1', date: '2026-05-22', mothsCount: 24, generation: 'Gen 1', operator: 'Luka Tatrishvili' }
      ];
    }
    return [];
  });

  useEffect(() => {
    if (!canCreateVineyardRecord && !canDeleteVineyardRecord) return;
    localStorage.setItem('vinea_ipm_traps', JSON.stringify(traps));
  }, [canCreateVineyardRecord, canDeleteVineyardRecord, traps]);

  // Risk Engine inputs state
  const [riskWeather, setRiskWeather] = useState<'dry' | 'moderate' | 'wet'>('moderate');
  const [varietySensitivity, setVarietySensitivity] = useState<'low' | 'medium' | 'high'>('high'); // e.g. Saperavi is highly sensitive to Downy Mildew
  const [diseaseHistory, setDiseaseHistory] = useState<'clean' | 'mild' | 'severe'>('mild');
  const [canopyDensity, setCanopyDensity] = useState<'open' | 'normal' | 'dense'>('normal');
  const [daysSinceLastSpray, setDaysSinceLastSpray] = useState<number>(14);

  // Selected stage details
  const selectedStage = useMemo(() => {
    return PHENOLOGICAL_STAGES.find(s => s.id === selectedStageId) || PHENOLOGICAL_STAGES[0];
  }, [selectedStageId]);

  // Calculate risk level dynamically
  const computedRisk = useMemo(() => {
    let score = 0;
    // Weather contribution
    if (riskWeather === 'dry') score += 1;
    else if (riskWeather === 'moderate') score += 3;
    else if (riskWeather === 'wet') score += 5;

    // Variety sensitivity
    if (varietySensitivity === 'low') score += 1;
    else if (varietySensitivity === 'medium') score += 2;
    else if (varietySensitivity === 'high') score += 4;

    // Disease history
    if (diseaseHistory === 'clean') score += 0;
    else if (diseaseHistory === 'mild') score += 2;
    else if (diseaseHistory === 'severe') score += 4;

    // Canopy density
    if (canopyDensity === 'open') score += 0;
    else if (canopyDensity === 'normal') score += 1;
    else if (canopyDensity === 'dense') score += 3;

    // Last spray interval
    if (daysSinceLastSpray > 21) score += 3;
    else if (daysSinceLastSpray > 14) score += 2;
    else if (daysSinceLastSpray < 8) score -= 2;

    if (score <= 5) return 'low';
    if (score <= 11) return 'medium';
    return 'high';
  }, [riskWeather, varietySensitivity, diseaseHistory, canopyDensity, daysSinceLastSpray]);

  // Trap Threshold and Recommendations
  const latestTrapCount = useMemo(() => {
    if (!selectedBlock) return 0;
    const blockTraps = traps.filter(t => t.blockId === selectedBlock.id);
    if (blockTraps.length === 0) return 0;
    // Sort by date desc
    const sorted = [...blockTraps].sort((a,b) => b.date.localeCompare(a.date));
    return sorted[0].mothsCount;
  }, [traps, selectedBlock]);

  // Expected harvest date remaining days
  const daysToHarvest = useMemo(() => {
    if (!selectedBlock || !selectedBlock.estimatedHarvestDate) return 90;
    const hDate = new Date(selectedBlock.estimatedHarvestDate);
    const today = new Date();
    const diffTime = hDate.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }, [selectedBlock]);

  // Form submit state for new spray addition inside the IPM helper
  const [formMoa, setFormMoa] = useState<string>('');
  const [formMoaSystem, setFormMoaSystem] = useState<'FRAC' | 'IRAC' | 'HRAC' | 'OTHER'>('FRAC');
  const [formPhi, setFormPhi] = useState<number>(21);
  const [sprayFormError, setSprayFormError] = useState<string | null>(null);
  const [sprayFormWarning, setSprayFormWarning] = useState<string | null>(null);

  // Checks for MoA repetition and PHI conflicts in real-time
  const handleVerifySprayForm = (moa: string, phi: number) => {
    if (!selectedBlock) return;
    setSprayFormError(null);
    setSprayFormWarning(null);

    // 1. PHI Harvest Conflict Check
    if (phi > daysToHarvest) {
      setSprayFormError(
        isKa 
          ? `🚨 ლოდინის პერიოდის (PHI) კონფლიქტი! PHI (${phi} დღე) აჭარბებს მოსავლამდე დარჩენილ დროს (${daysToHarvest} დღე). შესხურება დაუშვებელია.`
          : `🚨 Pre-Harvest Interval (PHI) Conflict! The PHI of ${phi} days exceeds the ${daysToHarvest} days remaining until expected harvest. Application is blocked.`
      );
      return;
    }

    // 2. Resistance repeated MoA check
    const blockSprays = sprays.filter(s => s.blockId === selectedBlock.id);
    if (blockSprays.length > 0) {
      // Sort desc
      const sorted = [...blockSprays].sort((a,b) => b.date.localeCompare(a.date));
      const lastSpray = sorted[0];
      // Check if last spray notes or active ingredient matches the MoA code
      const notesClean = (lastSpray.notes || '').toUpperCase();
      if (moa && notesClean.includes(moa.toUpperCase())) {
        setSprayFormWarning(
          isKa 
            ? `⚠️ რეზისტენტობის რისკი: თქვენ მეორედ იყენებთ ერთი და იგივე მოქმედების მექანიზმის ჯგუფს (MoA: ${moa})! გთხოვთ, შეცვალოთ ქიმიური კლასი.`
            : `⚠️ Resistance Risk: You are repeating the same chemical class / Mode of Action (MoA: ${moa}) consecutively! Rotate to a different MoA group.`
        );
      }
    }
  };

  const handleAddSprayLog = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedBlock || !canCreateVineyardRecord) return;

    const fd = new FormData(e.currentTarget);
    const target = String(fd.get('targetProblem') || '');
    const active = String(fd.get('activeIngredient') || '');
    const dose = parseFloat(fd.get('dosePerHa') as string) || 1.5;
    const water = parseFloat(fd.get('waterVolumePerHa') as string) || 400;
    const operator = String(fd.get('operator') || currentUser.fullName);
    const moa = formMoa;

    // Check PHI first
    if (formPhi > daysToHarvest) {
      alert(isKa ? 'შესხურება დაბლოკილია PHI კონფლიქტის გამო!' : 'Spraying is blocked due to PHI harvest conflict!');
      return;
    }

    onAddSprayRecord({
      blockId: selectedBlock.id,
      date: new Date().toISOString().split('T')[0],
      targetProblem: target,
      productName: isKa ? `ზოგადი ჯგუფი: ${active}` : `Generic Group: ${active}`,
      activeIngredient: active,
      dosePerHa: dose,
      waterVolumePerHa: water,
      totalProductUsed: Math.round(dose * selectedBlock.area * 10) / 10,
      totalWaterUsed: Math.round(water * selectedBlock.area),
      operator,
      machineryUsed: 'Fendt 207V Vineyard Tractor',
      windSpeed: blockWeather?.wind ?? 0,
      temperature: blockWeather?.temp ?? 0,
      humidity: blockWeather?.humidity ?? 0,
      preHarvestIntervalDays: formPhi,
      reEntryIntervalHours: 24,
      notes: `IPM Campaign: Active Group: ${active} [MoA MoA: ${moa} (${formMoaSystem})]. PHI: ${formPhi} days.`
    });

    alert(isKa ? 'წამლობის ლოგი შენახულია დამატებითი კონტროლის ფარგლებში!' : 'IPM Spray log recorded successfully with active MoA tracking!');
    // reset form inputs
    setFormMoa('');
    setFormPhi(21);
    setSprayFormError(null);
    setSprayFormWarning(null);
    e.currentTarget.reset();
  };

  const handleAddTrapLog = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedBlock || !canCreateVineyardRecord) return;

    const fd = new FormData(e.currentTarget);
    const count = parseInt(fd.get('mothsCount') as string) || 0;
    const gen = fd.get('generation') as any || 'Gen 1';

    const newTrap: TrapRecord = {
      id: `trap-${Date.now()}`,
      blockId: selectedBlock.id,
      date: new Date().toISOString().split('T')[0],
      mothsCount: count,
      generation: gen,
      operator: currentUser.fullName
    };

    setTraps(current => [newTrap, ...current]);
    e.currentTarget.reset();
  };

  const handleDeleteTrap = (id: string) => {
    if (!canDeleteVineyardRecord) return;
    setTraps(current => current.filter(t => t.id !== id));
  };

  if (!selectedBlock) {
    return (
      <div className="bg-white border border-stone-200 p-8 rounded-2xl text-center font-serif text-sm text-[#4e0e15]/60 flex flex-col items-center justify-center">
        <Layers className="w-12 h-12 text-stone-300 mb-3 animate-bounce" />
        {isKa 
          ? 'ვენახის ფენოსქემისა და IPM პანელის გამოსაყენებლად, გთხოვთ აირჩიოთ ნაკვეთი გვერდითა მენიუში.'
          : 'Please select a vineyard block in the registry panel to deploy the brand-free phenoscheme & IPM dashboard.'}
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#e8dfd5] rounded-2xl shadow-md p-5 space-y-6 text-stone-700">
      
      {/* 1. Header Banner */}
      <div className="bg-gradient-to-br from-[#1e2f23] to-[#0d1510] text-white p-5 rounded-xl border border-emerald-900 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="text-[9px] uppercase font-mono tracking-widest bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded-sm font-bold">
            {isKa ? 'ინტეგრირებული დაცვა (IPM)' : 'Integrated Pest Management (IPM)'}
          </span>
          <h3 className="text-xl font-serif font-black text-amber-100 mt-1">
            {isKa ? 'ბრენდების გარეშე ვაზის ფენოსქემის მოდული' : 'Brand-Free Vine Phenoscheme & IPM'}
          </h3>
          <p className="text-[11px] text-emerald-200/80 mt-1 max-w-xl leading-relaxed">
            {isKa 
              ? 'ეს პანელი იყენებს მხოლოდ მოქმედ ნივთიერებებსა და MoA (FRAC/IRAC) კოდებს რეზისტენტობის პრევენციისთვის, რეკომენდაციები დამოკიდებულია ნაკვეთის მიკროკლიმატსა და ფაზებზე.'
              : 'This interface uses only active chemical groups and MoA (FRAC/IRAC) rotation rules to prevent pathogen resistance. Spray directives are dynamically generated.'}
          </p>
        </div>
        
        {/* Selected Block Info */}
        <div className="bg-[#FAF8F5]/10 border border-white/10 px-4 py-2.5 rounded-lg text-right shrink-0">
          <span className="text-[9px] font-mono text-emerald-300 block uppercase font-bold">{isKa ? 'აქტიური ნაკვეთი' : 'Selected Block'}</span>
          <span className="text-sm font-serif font-bold text-white block mt-0.5">{selectedBlock.name}</span>
          <span className="text-[10px] font-mono text-amber-200 block font-semibold">{selectedBlock.grapeVariety} • {daysToHarvest} {isKa ? 'დღე მოსავლამდე' : 'days to harvest'}</span>
        </div>
      </div>

      {(!canCreateVineyardRecord || !canDeleteVineyardRecord) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-relaxed text-amber-900">
          {!canCreateVineyardRecord && !canDeleteVineyardRecord
            ? (isKa
              ? 'IPM-ზე მხოლოდ ნახვის წვდომა გაქვთ. რისკები, ფენოსქემა, ხაფანგები და წამლობის ისტორია ხელმისაწვდომია ცვლილებების გარეშე.'
              : 'You have read-only IPM access. Risks, the phenoscheme, traps, and spray history remain available without edit controls.')
            : (isKa
              ? 'IPM მოქმედებები ნაწილობრივ ხელმისაწვდომია; ჩანაწერის შექმნისა და წაშლის ელემენტები თქვენი უფლებების მიხედვით არის ნაჩვენები.'
              : 'IPM actions are partially available; create and delete controls follow your assigned permissions.')}
        </div>
      )}

      {/* 2. Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1 bg-stone-50 p-1 border border-stone-200 rounded-xl text-xs font-semibold">
        {[
          { id: 'timeline', label_en: 'Phenological Stages Timeline', label_ka: 'ფენოფაზების დროითი ხაზი' },
          { id: 'risk', label_en: 'IPM Risk Engine', label_ka: 'რისკის ძრავი' },
          { id: 'traps', label_en: 'Pheromone Trap Log', label_ka: 'ხაფანგების მონიტორინგი' },
          { id: 'sprays', label_en: 'Treatment Log & MoA Rotator', label_ka: 'შეწამვლის რეესტრი და MoA' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setIpmTab(tab.id as any)}
            className={`px-3.5 py-1.8 rounded-lg cursor-pointer transition-all duration-200 font-extrabold uppercase tracking-wide text-[10px] ${
              ipmTab === tab.id 
                ? 'bg-[#4e0e15] text-amber-50 shadow-sm' 
                : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
            }`}
          >
            {isKa ? tab.label_ka : tab.label_en}
          </button>
        ))}
      </div>

      {/* 3. Render tabs content */}
      
      {/* TAB A: PHENOLOGICAL TIMELINE */}
      {ipmTab === 'timeline' && (
        <div className="space-y-6">
          
          {/* Horizontal scrollable timeline track */}
          <div className="space-y-2">
            <h4 className="font-serif font-bold text-xs text-stone-850">
              {isKa ? 'ვაზის ვეგეტაციის ეტაპები (მოსვენებიდან მოსავლამდე)' : 'Grapevine Phenological Stages Timeline'}
            </h4>
            <div className="flex gap-2 overflow-x-auto pb-3 pt-1 no-scrollbar">
              {PHENOLOGICAL_STAGES.map((st, idx) => {
                const isCurrent = selectedBlock.currentPhenology.toLowerCase().includes(st.stage_en.split('/')[0].trim().toLowerCase()) || (idx === 3 && selectedBlock.currentPhenology.includes('Pre-Flowering')) || (idx === 8 && selectedBlock.currentPhenology.includes('Harvest Maturity'));
                const isSelected = selectedStageId === st.id;
                return (
                  <button
                    key={st.id}
                    onClick={() => setSelectedStageId(st.id)}
                    className={`shrink-0 w-40 p-3 rounded-xl border text-left cursor-pointer transition-all relative ${
                      isSelected 
                        ? 'bg-neutral-50/90 border-[#4e0e15] ring-1 ring-[#4e0e15]/20' 
                        : isCurrent 
                        ? 'bg-emerald-50/50 border-emerald-500/50' 
                        : 'bg-white border-stone-200/80 hover:bg-stone-50'
                    }`}
                  >
                    {isCurrent && (
                      <span className="absolute top-2 right-2 text-[8px] font-mono bg-emerald-600 text-white font-extrabold px-1 rounded uppercase tracking-widest animate-pulse">
                        {isKa ? 'აქტიური' : 'Current'}
                      </span>
                    )}
                    <span className="text-[9px] font-mono text-[#c5a059] block font-black">BBCH {st.bbch}</span>
                    <strong className="text-[11px] font-serif block mt-1 leading-tight text-stone-850">
                      {isKa ? st.stage_ka : st.stage_en}
                    </strong>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Details card for selected stage */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 glass-card p-5 rounded-2xl hover-glow transition-all">
            
            {/* Left: General Stage Metadata */}
            <div className="lg:col-span-1 space-y-4">
              <div>
                <span className="text-[9px] font-mono text-[#c5a059] block font-bold">BBCH CODE {selectedStage.bbch}</span>
                <h4 className="text-base font-serif font-black text-[#4e0e15] mt-0.5">
                  {isKa ? selectedStage.stage_ka : selectedStage.stage_en}
                </h4>
              </div>

              {/* Pathogen risks */}
              <div className="space-y-1.5">
                <span className="text-[9px] font-mono text-slate-450 uppercase block font-extrabold tracking-wider">
                  {isKa ? 'მთავარი ბიოლოგიური რისკები' : 'Main Pathogen & Pest Risks'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(isKa ? selectedStage.main_risks_ka : selectedStage.main_risks_en).map((risk, i) => (
                    <span key={i} className="bg-red-50 text-red-800 border border-red-100 text-[10px] font-bold px-2 py-0.5 rounded font-mono">
                      ⚠️ {risk}
                    </span>
                  ))}
                </div>
              </div>

              {/* Monitoring guidelines */}
              <div className="space-y-1 glass-card p-3 rounded-xl text-[11px]">
                <span className="text-[9px] font-mono text-slate-400 uppercase block font-bold">
                  {isKa ? 'მონიტორინგის ინსტრუქცია' : 'Monitoring Directive'}
                </span>
                <p className="leading-relaxed text-stone-600 font-medium">
                  {isKa ? selectedStage.monitoring_ka : selectedStage.monitoring_en}
                </p>
              </div>
            </div>

            {/* Middle: Cultural actions and Warnings */}
            <div className="lg:col-span-1 space-y-4">
              {/* Cultural actions */}
              <div className="space-y-2">
                <span className="text-[9px] font-mono text-slate-450 uppercase block font-extrabold tracking-wider">
                  {isKa ? 'აგროტექნიკური მოქმედებები' : 'Cultural Practices & Operations'}
                </span>
                <ul className="space-y-1.5 text-[11px] font-medium text-stone-600">
                  {(isKa ? selectedStage.cultural_actions_ka : selectedStage.cultural_actions_en).map((act, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{act}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Resistance and app warnings */}
              <div className="p-3.5 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-2 text-[11px]">
                <div>
                  <strong className="text-[9px] uppercase font-mono text-amber-800 block font-black">
                    {isKa ? 'რეზისტენტობის პრევენცია' : 'Resistance Management Note'}
                  </strong>
                  <p className="text-amber-900 leading-relaxed font-medium mt-0.5">
                    {isKa ? selectedStage.resistance_note_ka : selectedStage.resistance_note_en}
                  </p>
                </div>
                {selectedStage.app_warning_ka && (
                  <div className="border-t border-amber-200/50 pt-1.5 mt-1.5">
                    <strong className="text-[9px] uppercase font-mono text-rose-800 block font-black">
                      {isKa ? 'გამოყენების შეზღუდვები' : 'Application Warnings'}
                    </strong>
                    <p className="text-rose-900 leading-relaxed font-semibold mt-0.5">
                      {isKa ? selectedStage.app_warning_ka : selectedStage.app_warning_en}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Treatment strategy by risk pressure */}
            <div className="lg:col-span-1 space-y-4 glass-card p-4.5 rounded-xl shadow-2xs hover-lift transition-all">
              <span className="text-[9px] font-mono text-[#c5a059] uppercase block font-extrabold tracking-wider">
                {isKa ? 'ქიმიური სტრატეგია წნეხის მიხედვით' : 'IPM Disease Pressure Strategy'}
              </span>

              <div className="space-y-3 text-[11px]">
                <div className="border-l-2 border-emerald-500 pl-2.5">
                  <strong className="text-emerald-800 font-bold block">{isKa ? 'დაბალი რისკისას' : 'Low Pressure Strategy'}</strong>
                  <p className="text-stone-500 mt-0.5 font-medium leading-relaxed">
                    {isKa ? selectedStage.treatment_strategy_ka.low : selectedStage.treatment_strategy_en.low}
                  </p>
                </div>
                <div className="border-l-2 border-amber-500 pl-2.5">
                  <strong className="text-amber-700 font-bold block">{isKa ? 'საშუალო რისკისას' : 'Medium Pressure Strategy'}</strong>
                  <p className="text-stone-500 mt-0.5 font-medium leading-relaxed">
                    {isKa ? selectedStage.treatment_strategy_ka.medium : selectedStage.treatment_strategy_en.medium}
                  </p>
                </div>
                <div className="border-l-2 border-red-500 pl-2.5">
                  <strong className="text-red-700 font-bold block">{isKa ? 'მაღალი რისკისას' : 'High Pressure Strategy'}</strong>
                  <p className="text-stone-500 mt-0.5 font-medium leading-relaxed">
                    {isKa ? selectedStage.treatment_strategy_ka.high : selectedStage.treatment_strategy_en.high}
                  </p>
                </div>
              </div>

              {/* Seeded Active Ingredients groups */}
              <div className="border-t border-stone-100 pt-3 space-y-2">
                <span className="text-[9px] font-mono text-slate-400 uppercase block font-bold">
                  {isKa ? 'რეკომენდებული მოქმედი ნივთიერებების ჯგუფები' : 'Recommended Chemical Groups'}
                </span>
                <div className="space-y-2">
                  {selectedStage.active_ingredient_groups.map((group, i) => (
                    <div key={i} className="bg-stone-50 border border-stone-150 p-2 rounded-lg flex justify-between items-start text-[10px] font-medium leading-tight">
                      <div>
                        <strong className="text-stone-800">{isKa ? group.group_ka : group.group_en}</strong>
                        <span className="block text-slate-400 text-[9px] mt-0.5">{isKa ? 'სამიზნე:' : 'Target:'} {translateTarget(group.target)}</span>
                      </div>
                      <span className="bg-amber-50 text-amber-800 font-mono px-2 py-0.5 rounded border border-amber-100 shrink-0 font-bold">
                        {group.moa}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* TAB B: RISK ENGINE CALCULATOR */}
      {ipmTab === 'risk' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left panel: Risk Inputs form */}
          <div className="lg:col-span-1 bg-stone-50 p-5 rounded-2xl border border-stone-200/80 space-y-4 text-xs font-semibold">
            <h4 className="font-serif font-black text-sm text-[#4e0e15] border-b border-stone-100 pb-2">
              {isKa ? 'რისკის ძრავის პარამეტრები' : 'Pathogen Risk Engine Parameters'}
            </h4>
            
            <div className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'ამინდის პირობები' : 'Weather / Rainfall Forecast'}
                </label>
                <select 
                  value={riskWeather} 
                  onChange={(e) => setRiskWeather(e.target.value as any)}
                  className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 outline-none font-bold text-stone-800"
                >
                  <option value="dry">☀️ {isKa ? 'მშრალი და თბილი ამინდი' : 'Dry & Warm Forecast'}</option>
                  <option value="moderate">☁️ {isKa ? 'ნორმალური ტენიანობა' : 'Moderate Humidity / Occasional Rain'}</option>
                  <option value="wet">⛈️ {isKa ? 'ხშირი წვიმები და ნისლი' : 'High Rainfall / Humid Fog'}</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'ყურძნის ჯიშის მგრძნობელობა' : 'Cultivar Pathogen Susceptibility'}
                </label>
                <select 
                  value={varietySensitivity} 
                  onChange={(e) => setVarietySensitivity(e.target.value as any)}
                  className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 outline-none font-bold text-stone-800"
                >
                  <option value="low">🟢 {isKa ? 'დაბალი (მაგ. რეზისტენტული ჰიბრიდი)' : 'Low (e.g. Resistant Hybrid)'}</option>
                  <option value="medium">🟡 {isKa ? 'საშუალო (მაგ. რქაწითელი)' : 'Medium (e.g. Rkatsiteli)'}</option>
                  <option value="high">🔴 {isKa ? 'მაღალი (მაგ. საფერავი / ჭრაქის მიმართ)' : 'High (e.g. Saperavi / Downy-susceptible)'}</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'ვენახის ისტორიული ფონი' : 'Block Disease History (Infection Pressure)'}
                </label>
                <select 
                  value={diseaseHistory} 
                  onChange={(e) => setDiseaseHistory(e.target.value as any)}
                  className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 outline-none font-bold text-stone-800"
                >
                  <option value="clean">🟢 {isKa ? 'სუფთა (წინა წლებში დაავადება არ ყოფილა)' : 'Clean (No previous season infections)'}</option>
                  <option value="mild">🟡 {isKa ? 'ზომიერი (მცირე კერები)' : 'Mild (Minor sporadic outbreaks in past)'}</option>
                  <option value="severe">🔴 {isKa ? 'მკაცრი (ძლიერი დაავადების ფონი)' : 'Severe (Severe outbreaks in last vintage)'}</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'ვარჯის სიმკვრივე' : 'Vine Canopy Density'}
                </label>
                <select 
                  value={canopyDensity} 
                  onChange={(e) => setCanopyDensity(e.target.value as any)}
                  className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 outline-none font-bold text-stone-800"
                >
                  <option value="open">🟢 {isKa ? 'ღია ვარჯი (ფოთლები გაცლილია)' : 'Open Canopy (Leaf-plucked/pruned)'}</option>
                  <option value="normal">🟡 {isKa ? 'ნორმალური (კარგი აერაცია)' : 'Normal Canopy (Standard ventilation)'}</option>
                  <option value="dense">🔴 {isKa ? 'მკვრივი (ჩახშირებული ვარჯი)' : 'Dense Canopy (Overgrown shoot density)'}</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'დღეები ბოლო შეწამვლიდან' : 'Days Since Last Spray'}
                </label>
                <input 
                  type="number" 
                  value={daysSinceLastSpray} 
                  onChange={(e) => setDaysSinceLastSpray(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-white border border-[#e8dfd5] rounded px-2.5 py-1.5 outline-none font-mono font-bold text-stone-850"
                  min="0"
                />
              </div>
            </div>

          </div>

          {/* Right panel: Calculator Outputs */}
          <div className="lg:col-span-2 bg-white border border-stone-200/90 rounded-2xl p-5 shadow-xs space-y-6 flex flex-col justify-between">
            <div>
              <h4 className="font-serif font-black text-sm text-emerald-950">
                {isKa ? 'IPM რისკის ანალიზის ანგარიში' : 'IPM Pathogen Risk Assessment Report'}
              </h4>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {isKa ? 'დინამიური გამოთვლა ვეგეტაციური ფაზისა და საველე ინდიკატორების გათვალისწინებით' : 'Dynamic threat modeling based on field and physiological metrics'}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                
                {/* Risk Gauge */}
                <div className={`p-5 rounded-xl border flex flex-col items-center justify-center text-center font-sans ${
                  computedRisk === 'high' ? 'bg-rose-50 border-rose-200 text-rose-800' :
                  computedRisk === 'medium' ? 'bg-amber-50 border-amber-200 text-amber-800' :
                  'bg-emerald-50 border-emerald-250 text-emerald-800'
                }`}>
                  <span className="text-[9px] font-mono uppercase font-black block tracking-widest">{isKa ? 'რისკის კოეფიციენტი' : 'Computed Risk Level'}</span>
                  <strong className="text-2xl font-serif font-black block uppercase mt-1">
                    {computedRisk === 'high' ? (isKa ? '🔴 მაღალი' : 'High') :
                     computedRisk === 'medium' ? (isKa ? '🟡 საშუალო' : 'Medium') :
                     (isKa ? '🟢 დაბალი' : 'Low')}
                  </strong>
                  <span className="text-[10px] font-mono font-bold block mt-1">
                    {isKa ? 'დაფუძნებულია 5 პარამეტრზე' : 'Calculated across 5 field parameters'}
                  </span>
                </div>

                {/* Treatment status recommendation text */}
                <div className="bg-stone-50 border border-stone-150 p-4 rounded-xl flex items-start gap-2.5 text-xs">
                  <Sparkles className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <strong className="text-stone-850 font-bold block">{isKa ? 'გადაწყვეტილების რეკომენდაცია:' : 'Decision Support Directive:'}</strong>
                    <p className="text-stone-600 leading-relaxed font-semibold">
                      {computedRisk === 'high' ? (
                        isKa 
                          ? 'საჭიროა სასწრაფო დაცვა! მაღალი წნეხია, ბოლო წამლობის ინტერვალი გასულია ან ვარჯი ჩახშირებულია. გამოიყენეთ მრავალსაიტიანი დამცავი + სისტემური/ტრანსლამინარული ჯგუფი.'
                          : 'Urgent protection needed! High pressure, recent rain/humidity risk, or long spray intervals exist. Apply a combination of protectant + systemic group.'
                      ) : computedRisk === 'medium' ? (
                        isKa 
                          ? 'რეკომენდებულია პრევენციული მოქმედება. ფაზა მგრძნობიარეა, ამინდი ხელს უწყობს სპორების გავრცელებას. შეწამლეთ წვიმამდე.'
                          : 'Preventive action recommended. Stage is sensitive and weather forecast supports spore release. Spray before the next rain event.'
                      ) : (
                        isKa 
                          ? 'მხოლოდ მონიტორინგი. ამინდი მშრალია, ვენახი სუფთაა და საფრთხე არ ფიქსირდება. შესხურება ჯერ არ არის საჭირო.'
                          : 'Monitor only. Dry weather, clean historical background, and open canopy mean threat levels are low. Chemical intervention is not needed.'
                      )}
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Quick Actions mapping */}
            <div className="border-t border-stone-100 pt-4 mt-4 flex justify-between items-center text-[11px] flex-wrap gap-3">
              <span className="text-stone-400 font-mono">
                {isKa ? `🍇 მოსავლის დაგეგმვა: დარჩენილია ${daysToHarvest} დღე` : `🍇 Harvest Planning: ${daysToHarvest} days left until expected picking`}
              </span>
              {canCreateVineyardRecord && (
                <button
                  onClick={() => {
                    setIpmTab('sprays');
                    // Preset active ingredient selector based on the current stage's top recommendation
                    setFormMoa(selectedStage.active_ingredient_groups[0]?.moa || '');
                    setFormPhi(21);
                  }}
                  className="bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold uppercase font-mono px-3.5 py-1.8 rounded-lg cursor-pointer transition-all text-[10px] tracking-wider inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {isKa ? 'შეწამვლის ლოგის მომზადება' : 'Draft Spray Treatment'}
                </button>
              )}
            </div>

          </div>

        </div>
      )}

      {/* TAB C: PHEROMONE TRAP LOG */}
      {ipmTab === 'traps' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Add Trap Log */}
          {canCreateVineyardRecord && (
          <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4 text-xs text-stone-600">
            <h4 className="font-serif font-black text-sm text-emerald-950 border-b border-stone-100 pb-2">
              {isKa ? 'ახალი ჩანაწერი ხაფანგებზე' : 'Record Pheromone Trap Catch'}
            </h4>
            <form onSubmit={handleAddTrapLog} className="space-y-3">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'დაჭერილი პეპლები (პეპელა/კვირა) *' : 'Weekly Moths Counted *'}
                </label>
                <input 
                  type="number" 
                  name="mothsCount" 
                  defaultValue="12" 
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-mono font-bold text-stone-900"
                  required 
                  min="0"
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'ყურძნის ჭიის თაობა *' : 'Grape Moth Target Generation *'}
                </label>
                <select name="generation" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1.5 outline-none font-bold text-stone-850">
                  <option value="Gen 1">{isKa ? 'I თაობა (გაზაფხული / ყვავილობამდე)' : 'Generation 1 (Spring/Pre-flowering)'}</option>
                  <option value="Gen 2">{isKa ? 'II თაობა (ზაფხული / მარცვლის ზრდა)' : 'Generation 2 (Summer/Berry Growth)'}</option>
                  <option value="Gen 3">{isKa ? 'III თაობა (გვიანი ზაფხული / შეთვალება)' : 'Generation 3 (Late Summer/Veraison)'}</option>
                </select>
              </div>

              <button 
                type="submit" 
                className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold font-mono uppercase tracking-wider py-2 rounded-lg cursor-pointer transition-colors"
              >
                {isKa ? 'ჩაწერა' : 'Log Trap Data'}
              </button>
            </form>
          </div>
          )}

          {/* Trap history list & status checks */}
          <div className={`${canCreateVineyardRecord ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4`}>
            <div className="flex items-center justify-between border-b border-stone-100 pb-2">
              <h4 className="font-serif font-bold text-sm text-[#4e0e15]">
                {isKa ? 'ყურძნის ჭიის ფერომონული ხაფანგების ისტორია' : 'European Grape Moth Trap Records'}
              </h4>
              
              {/* Threshold indicator */}
              <div className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded border uppercase ${
                latestTrapCount > 20 
                  ? 'bg-rose-50 text-rose-800 border-rose-250 animate-pulse' 
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}>
                {isKa ? 'ბოლო მაჩვენებელი' : 'Latest Catch'}: {latestTrapCount} {isKa ? 'პეპელა' : 'moths'} / {latestTrapCount > 20 ? (isKa ? '⚠️ ზღვარს სცდება' : '⚠️ THRESHOLD EXCEEDED') : (isKa ? '✅ ნორმაა' : '✅ NORMAL')}
              </div>
            </div>

            {/* Trap recommendation card */}
            {latestTrapCount > 20 && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-900 text-[11px] rounded-xl flex items-start gap-2 animate-fade-in">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <strong>
                    {isKa ? '⚠️ ყურადღება: ყურძნის ჭიის გავრცელება კრიტიკულ ზღვარზეა!' : '⚠️ Critical Warning: Grape moth counts exceed threshold of 20 moths/week!'}
                  </strong>
                  <p className="leading-relaxed text-stone-600 font-medium">
                    {isKa 
                      ? 'რეკომენდებულია მიზნობრივი ინსექტიციდური წამლობა (მაგ. დიამიდები ან სპინოსინები) კვერცხების მასობრივი გამოჩეკვის პერიოდში. აუცილებლად დაიცავით MoA როტაციის წესები!'
                      : 'Targeted insecticidal treatment (e.g. diamides or spinosyns) is recommended during peak egg-hatch. Ensure MoA chemical class rotation.'}
                  </p>
                </div>
              </div>
            )}

            {/* Logs list */}
            <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
              {traps.filter(t => t.blockId === selectedBlock.id).map(trap => (
                <div key={trap.id} className="p-3 border border-stone-100 rounded-lg hover:bg-stone-50/50 transition-all text-xs font-medium flex justify-between items-center flex-wrap gap-3">
                  <div>
                    <span className="text-[9px] bg-sky-100 text-sky-850 px-2 py-0.2 rounded font-mono font-bold uppercase">
                      {isKa ? (trap.generation === 'Gen 1' ? 'I თაობა' : trap.generation === 'Gen 2' ? 'II თაობა' : 'III თაობა') : trap.generation}
                    </span>
                    <strong className="text-stone-850 block mt-1">
                      {isKa ? 'დაჭერილია:' : 'Catch count:'} <span className={trap.mothsCount > 20 ? 'text-red-600 font-black' : 'text-stone-800'}>{trap.mothsCount} {isKa ? 'პეპელა/კვირა' : 'moths/week'}</span>
                    </strong>
                    <span className="block text-slate-400 text-[9px] font-mono font-normal mt-0.5">{trap.date} • {trap.operator}</span>
                  </div>
                  {canDeleteVineyardRecord && (
                    <button
                      onClick={() => handleDeleteTrap(trap.id)}
                      className="p-1.5 text-stone-400 hover:text-red-700 hover:bg-red-50 rounded cursor-pointer"
                      title={isKa ? 'ხაფანგის ჩანაწერის წაშლა' : 'Delete trap log'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}

              {traps.filter(t => t.blockId === selectedBlock.id).length === 0 && (
                <div className="text-center py-12 text-stone-400 italic font-mono text-xs">
                  <CheckSquare className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                  {isKa ? 'ხაფანგების ჩანაწერები არ არის' : 'No trap logs recorded for this block.'}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* TAB D: TREATMENT REGISTRY AND MOA */}
      {ipmTab === 'sprays' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Add Spray Record Form with real-time verification */}
          {canCreateVineyardRecord && (
          <div className="lg:col-span-1 bg-white border border-[#e8dfd5] p-5 rounded-xl h-fit shadow-xs space-y-4 text-xs text-stone-600">
            <h4 className="font-serif font-black text-sm text-emerald-950 border-b border-stone-100 pb-2">
              {isKa ? 'ახალი წამლობის შეყვანა' : 'Log Brand-Free Spray'}
            </h4>
            <form onSubmit={handleAddSprayLog} className="space-y-3.5">
              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'სამიზნე დაავადება / პრობლემა *' : 'Target Problem / Disease *'}
                </label>
                <input 
                  type="text" 
                  name="targetProblem" 
                  defaultValue={selectedStage.main_risks_en[0] || 'Downy Mildew'}
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2.5 py-1.5 outline-none font-medium text-stone-900"
                  required 
                />
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'მოქმედი ნივთიერების ზოგადი ჯგუფი *' : 'Active Ingredient Group *'}
                </label>
                <select 
                  name="activeIngredient"
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1.5 outline-none font-bold text-stone-850"
                  onChange={(e) => {
                    // Automatically pre-load MoA code from seed data
                    const matchedGroup = selectedStage.active_ingredient_groups.find(g => (isKa ? g.group_ka : g.group_en) === e.target.value);
                    if (matchedGroup) {
                      setFormMoa(matchedGroup.moa);
                      handleVerifySprayForm(matchedGroup.moa, formPhi);
                    }
                  }}
                >
                  {selectedStage.active_ingredient_groups.map((g, idx) => (
                    <option key={idx} value={isKa ? g.group_ka : g.group_en}>
                      {isKa ? g.group_ka : g.group_en} ({g.moa})
                    </option>
                  ))}
                  <option value={isKa ? 'გოგირდი' : 'Sulfur'}>{isKa ? 'გოგირდი (M02)' : 'Sulfur (M02)'}</option>
                  <option value={isKa ? 'სპილენძი' : 'Copper'}>{isKa ? 'სპილენძი (M01)' : 'Copper (M01)'}</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                    {isKa ? 'მოქმედების კოდი (MoA)' : 'MoA Code (FRAC/IRAC)'}
                  </label>
                  <input 
                    type="text" 
                    value={formMoa} 
                    onChange={(e) => {
                      setFormMoa(e.target.value);
                      handleVerifySprayForm(e.target.value, formPhi);
                    }}
                    className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none font-mono font-bold" 
                    placeholder="e.g. FRAC 40"
                  />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                    {isKa ? 'MoA სისტემა' : 'MoA System'}
                  </label>
                  <select 
                    value={formMoaSystem} 
                    onChange={(e) => setFormMoaSystem(e.target.value as any)}
                    className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none font-bold text-stone-850"
                  >
                    <option value="FRAC">{isKa ? 'FRAC (ფუნგიციდი)' : 'FRAC (Fungicide)'}</option>
                    <option value="IRAC">{isKa ? 'IRAC (ინსექტიციდი)' : 'IRAC (Insecticide)'}</option>
                    <option value="HRAC">{isKa ? 'HRAC (ჰერბიციდი)' : 'HRAC (Herbicide)'}</option>
                    <option value="OTHER">{isKa ? 'სხვა / კონტაქტური' : 'Other/Contact'}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                    {isKa ? 'დოზა/ჰა (კგ/ლ)' : 'Dose/ha (kg/L)'}
                  </label>
                  <input type="number" step="0.1" name="dosePerHa" defaultValue="2.0" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none font-mono font-bold" />
                </div>
                <div>
                  <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                    {isKa ? 'წყლის ხარჯი (ლ/ჰა)' : 'Water volume (L/ha)'}
                  </label>
                  <input type="number" step="10" name="waterVolumePerHa" defaultValue="400" className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none font-mono font-bold" />
                </div>
              </div>

              <div>
                <label className="text-[9px] uppercase font-mono block mb-1 font-bold text-slate-400">
                  {isKa ? 'ლოდინის პერიოდი (PHI - დღე)' : 'Pre-Harvest Interval (PHI Days)'}
                </label>
                <input 
                  type="number" 
                  value={formPhi} 
                  onChange={(e) => {
                    const phi = Math.max(0, parseInt(e.target.value) || 0);
                    setFormPhi(phi);
                    handleVerifySprayForm(formMoa, phi);
                  }}
                  className="w-full bg-white border border-[#e8dfd5] rounded-p px-2 py-1 outline-none font-mono font-bold text-stone-900" 
                  min="0"
                />
              </div>

              {/* Dynamic Resistance / PHI alerts */}
              {sprayFormError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg font-sans text-[11px] leading-relaxed block font-semibold">
                  {sprayFormError}
                </div>
              )}
              {sprayFormWarning && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg font-sans text-[11px] leading-relaxed block font-semibold">
                  {sprayFormWarning}
                </div>
              )}

              <button 
                type="submit" 
                disabled={!!sprayFormError}
                className="w-full bg-emerald-800 hover:bg-emerald-950 text-white font-extrabold font-mono uppercase tracking-wider py-2 rounded-lg cursor-pointer transition-colors disabled:bg-stone-300 disabled:cursor-not-allowed"
              >
                {isKa ? 'ლოგირება' : 'Commit Spray Record'}
              </button>
            </form>
          </div>
          )}

          {/* Active Spray logs list showing MoA labels */}
          <div className={`${canCreateVineyardRecord ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white rounded-xl border border-[#e8dfd5] p-5 shadow-sm space-y-4`}>
            <h4 className="font-serif font-bold text-sm text-[#4e0e15]">
              {isKa ? 'ქიმიური წამლობების ისტორია და კოდების კონტროლი' : 'Active Chemical Applications & Resistance Ledger'}
            </h4>
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              {sprays.filter(s => s.blockId === selectedBlock.id).map(spray => {
                const moaLabel = (spray.notes || '').match(/\[MoA\sMoA:\s(.*?)\]/);
                const extractedMoa = moaLabel ? moaLabel[1] : 'M01';
                return (
                  <div key={spray.id} className="p-4 border border-stone-100 rounded-xl hover:bg-stone-50/50 transition-all font-sans space-y-2 relative">
                    <div className="flex items-center gap-2 flex-wrap text-[10px]">
                      <span className="bg-red-50 text-red-800 border border-red-150 px-2 py-0.5 rounded font-mono font-bold">
                        🛡️ {isKa ? 'ლოდინის პერიოდი:' : 'PHI:'} {spray.preHarvestIntervalDays} {isKa ? 'დღე' : 'Days'}
                      </span>
                      <span className="bg-amber-50 text-amber-900 border border-amber-100 px-2 py-0.5 rounded font-mono font-black">
                        MoA: {extractedMoa}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono ml-auto">{spray.date} • {isKa ? 'ოპერატორი:' : 'Operator:'} {spray.operator}</span>
                    </div>

                    <h5 className="font-bold text-stone-900 text-sm leading-tight">{spray.productName} ({spray.activeIngredient})</h5>
                    <p className="text-xs text-stone-550 bg-stone-50/60 p-2.5 rounded border border-dashed border-stone-200/60 leading-relaxed font-semibold">
                      <strong>{isKa ? 'სამიზნე:' : 'Target:'}</strong> {isKa ? translateTarget(spray.targetProblem) : spray.targetProblem} <br />
                      <strong>{isKa ? 'დოზირების დეტალები:' : 'Dosage Telemetry:'}</strong> {spray.dosePerHa} {isKa ? 'კგ/ჰა -' : 'kg/ha in'} {spray.waterVolumePerHa}{isKa ? 'ლ წყალში' : 'L water'}. {isKa ? 'სულ:' : 'Total:'} <strong>{spray.totalProductUsed} {isKa ? 'კგ' : 'kg'}</strong> {isKa ? 'პრეპარატი' : 'chemical'}, <strong>{spray.totalWaterUsed}L</strong> {isKa ? 'წყალი' : 'water'}.
                    </p>
                  </div>
                );
              })}

              {sprays.filter(s => s.blockId === selectedBlock.id).length === 0 && (
                <div className="text-center py-12 text-stone-400 italic font-mono text-xs">
                  <Wind className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                  {isKa ? 'წამლობის ისტორია ცარიელია' : 'No treatment logs recorded for this block.'}
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* 4. Safety Disclaimer */}
      <div className="bg-[#4e0e15]/5 border border-[#4e0e15]/10 p-4 rounded-xl flex items-start gap-3">
        <Info className="w-5 h-5 text-[#4e0e15] shrink-0 mt-0.5" />
        <div className="text-[10px] text-[#4e0e15] leading-relaxed space-y-1">
          <strong className="font-bold uppercase block tracking-wider">
            {isKa ? '⚠️ უსაფრთხოების რეგულაცია და პასუხისმგებლობის შეზღუდვა' : '⚠️ Regulatory & Chemical Safety Disclaimer'}
          </strong>
          <p className="font-medium text-stone-605">
            {isKa 
              ? 'ეს მოდული არის გადაწყვეტილების მხარდაჭერისა და საგანმანათლებლო ინსტრუმენტი. ის არ ანაცვლებს ოფიციალურ ეტიკეტს, ადგილობრივ რეგისტრაციას, აგრონომის რჩევას, შრომის უსაფრთხოების წესებს, გარემოსდაცვით შეზღუდვებს, საექსპორტო MRL მოთხოვნებს ან სამართლებრივ მოთხოვნებს. ნებისმიერი გამოყენების წინ მომხმარებელმა უნდა დაადასტუროს, რომ არჩეული მოქმედი ნივთიერება/პროდუქტი რეგისტრირებულია ვაზისთვის შესაბამის ქვეყანაში და დოზა, PHI, REI, PPE, მაქსიმალური გამოყენების რაოდენობა და შერევის წესები სწორია.'
              : 'This module is a decision-support and educational tool. It does not replace the official pesticide label, local registration rules, agronomist advice, worker safety rules, environmental restrictions, export MRL requirements, or legal requirements. Before any application, the user must confirm that the selected active ingredient/product is registered for grapevine in the target country and that the rate, PHI, REI, PPE, maximum applications and mixing rules are valid.'}
          </p>
        </div>
      </div>

    </div>
  );
}
