import React, { useState, useEffect, useMemo } from 'react';
import {
  Sun, CloudSun, CloudRain, Wind, Droplets, AlertTriangle, Info, Calendar, RotateCw, MapPin,
  ShieldAlert, Sparkles, Flame, Snowflake,
  Bot, TrendingUp, Layers
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, Cell
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import type { VineyardBlock } from '../lib/wineryState';
import type { Language } from '../lib/i18n';
import { buildAgroForecastUrl } from '../lib/weatherApi';
import WeatherExplorer from './WeatherExplorer';

interface WeatherTabProps {
  lang: Language;
  blocks: VineyardBlock[];
  setActiveModule?: (mod: 'portal' | 'vazi' | 'gvino' | 'settings' | 'audit') => void;
  setActiveTab?: (tab: string) => void;
  setPrefilledTaskTitle?: (title: string) => void;
  setPrefilledTaskPriority?: (priority: 'high' | 'medium' | 'low') => void;
  setPrefilledTaskDesc?: (desc: string) => void;
  canCreateTask?: boolean;
}

interface WeatherData {
  currentTemp: number;
  currentHumidity: number;
  currentWind: number;
  currentPrecip: number;
  weatherCode: number;
  apparentTemp: number;
  hourly: Array<{
    time: string;
    temp: number;
    humidity: number;
    wind: number;
    pop: number; // Probability of precipitation
  }>;
  daily: Array<{
    date: string;
    tempMax: number;
    tempMin: number;
    popMax: number;
    windMax: number;
    weatherCode: number;
  }>;
}

// Translations for weather module
const dict = {
  en: {
    weather_station: 'Vineyard Agro-Weather Station',
    station_desc: 'Real-time microclimatic telemetry and precision decision support systems.',
    select_block: 'Active Vineyard Block',
    coordinates: 'GPS Telemetry',
    elevation: 'Elevation',
    current_conditions: 'Current Microclimate',
    temp: 'Temperature',
    apparent: 'Apparent Temp',
    wind: 'Wind Speed',
    humidity: 'Relative Humidity',
    precip_prob: 'Rain Probability',
    spray_decision: 'Microclimatic Spraying Conditions',
    harvest_decision: 'Precision Harvest Decision Index',
    disease_pressure: 'Downy & Powdery Mildew Infection Risk',
    hourly_forecast: '24-Hour Microclimate Projection',
    daily_forecast: '5-Day Agro-Meteorological Outlook',
    fetching: 'Syncing live telemetry parameters...',
    fetch_error: 'Unable to connect to microclimatic station. Showing baseline fallback estimation.',
    updating: 'Updating...',
    no_blocks: 'No vineyard blocks found. Set coordinates in Settings or Blocks tab.',
    risk_low: 'Low Pressure',
    risk_med: 'Moderate Pressure',
    risk_high: 'High Pressure / Severe Infection Risk',
    spray_optimal: 'OPTIMAL: Spray Safe',
    spray_caution: 'CAUTION: Marginal Conditions',
    spray_danger: 'DANGER: Do Not Spray',
    harvest_optimal: 'OPTIMAL: Excellent Harvest Window',
    harvest_marginal: 'MARGINAL: Harvest with Vigilance',
    harvest_unsafe: 'UNSAFE: Delay Harvest',
    recommendation: 'Strategic Directive',
    conditions_analyzed: 'Parameters Analyzed',
    frost_warning: 'CRITICAL: Frost Risk Warning!',
    heat_warning: 'CRITICAL: Canopy Heat Stress alert!',
    refresh: 'Refresh Telemetry',
    feels_like: 'apparent temperature'
  },
  ka: {
    weather_station: 'ვენახის აგრო-მეტეო სადგური',
    station_desc: 'მიკროკლიმატური ტელემეტრია რეალურ დროში და გადაწყვეტილების მხარდაჭერა.',
    select_block: 'ვენახის აქტიური ნაკვეთი',
    coordinates: 'GPS ტელემეტრია',
    elevation: 'სიმაღლე ზღ.დ.',
    current_conditions: 'მეტეო პირობები',
    temp: 'ტემპერატურა',
    apparent: 'შეგრძნებადი ტემპ.',
    wind: 'ქარის სიჩქარე',
    humidity: 'ტენიანობა',
    precip_prob: 'ნალექის ალბათობა',
    spray_decision: 'წამლობის მიკროკლიმატური პირობები',
    harvest_decision: 'მოსავლის აღების ზუსტი ინდექსი',
    disease_pressure: 'ჭრაქისა და ნაცრის გავრცელების რისკი',
    hourly_forecast: '24-საათიანი მიკროკლიმატის პროგნოზი',
    daily_forecast: '5-დღიანი აგრო-მეტეოროლოგიური ხედვა',
    fetching: 'მიმდინარეობს ტელემეტრიის სინქრონიზაცია...',
    fetch_error: 'მეტეო სადგურთან დაკავშირება ვერ მოხერხდა. ნაჩვენებია საბაზისო სათადარიგო მონაცემები.',
    updating: 'ახლდება...',
    no_blocks: 'ნაკვეთები ვერ მოიძებნა. მიუთითეთ კოორდინატები პარამეტრებში.',
    risk_low: 'დაბალი წნევა',
    risk_med: 'საშუალო წნევა',
    risk_high: 'მაღალი წნევა / სერიოზული საფრთხე',
    spray_optimal: 'ოპტიმალური: შესხურება უსაფრთხოა',
    spray_caution: 'ფრთხილად: ზღვრული პირობები',
    spray_danger: 'საფრთხე: არ შეწამლოთ',
    harvest_optimal: 'ოპტიმალური: საუკეთესო მოსავლის ფანჯარა',
    harvest_marginal: 'საშუალო: აიღეთ მოსავალი სიფრთხილით',
    harvest_unsafe: 'საშიშია: გადადეთ მოსავლის აღება',
    recommendation: 'სტრატეგიული დირექტივა',
    conditions_analyzed: 'გაანალიზებული პარამეტრები',
    frost_warning: 'კრიტიკული: წაყინვის საფრთხე!',
    heat_warning: 'კრიტიკული: ვაზის თერმული სტრესი!',
    refresh: 'ტელემეტრიის განახლება',
    feels_like: 'შეგრძნებადი ტემპერატურა'
  },
  it: {
    weather_station: 'Stazione Agro-Meteorologica del Vigneto',
    station_desc: 'Telemetria microclimatica in tempo reale e sistemi di supporto alle decisioni di precisione.',
    select_block: 'Parcella Vigneto Attiva',
    coordinates: 'Telemetria GPS',
    elevation: 'Elevazione',
    current_conditions: 'Microclima Corrente',
    temp: 'Temperatura',
    apparent: 'Temp Percepita',
    wind: 'Velocità del Vento',
    humidity: 'Umidità Relativa',
    precip_prob: 'Probabilità di Pioggia',
    spray_decision: 'Condizioni Microclimatiche di Irrorazione',
    harvest_decision: 'Indice di Decisione della Vendemmia di Precisione',
    disease_pressure: 'Rischio di Infezione da Peronospora e Oidio',
    hourly_forecast: 'Proiezione Microclimatica a 24 Ore',
    daily_forecast: 'Previsioni Agro-Meteorologiche a 5 Giorni',
    fetching: 'Sincronizzazione dei parametri di telemetria in corso...',
    fetch_error: 'Impossibile connettersi alla stazione microclimatica. Mostrando stime di backup.',
    updating: 'Aggiornamento...',
    no_blocks: 'Nessuna parcella trovata. Configura le coordinate nelle impostazioni.',
    risk_low: 'Pressione Bassa',
    risk_med: 'Pressione Moderata',
    risk_high: 'Pressione Alta / Rischio Grave di Infezione',
    spray_optimal: 'OTTIMALE: Sicuro da Irrorare',
    spray_caution: 'ATTENZIONE: Condizioni Marginali',
    spray_danger: 'PERICOLO: Non Irrorare',
    harvest_optimal: 'OTTIMALE: Ottima Finestra di Vendemmia',
    harvest_marginal: 'MARGINALE: Vendemmiare con Vigilanza',
    harvest_unsafe: 'NON SICURO: Ritardare Vendemmia',
    recommendation: 'Direttiva Strategica',
    conditions_analyzed: 'Parametri Analizzati',
    frost_warning: 'CRITICO: Allerta Rischio Gelo!',
    heat_warning: 'CRITICO: Allerta Stress da Calore della Chioma!',
    refresh: 'Aggiorna Telemetria',
    feels_like: 'temperatura percepita'
  },
  fr: {
    weather_station: 'Station Agro-Météorologique de la Parcelle',
    station_desc: 'Télémétrie microclimatique en temps réel et systèmes de support aux décisions de précision.',
    select_block: 'Parcelle active du vignoble',
    coordinates: 'Télémétrie GPS',
    elevation: 'Altitude',
    current_conditions: 'Microclimat Actuel',
    temp: 'Température',
    apparent: 'Temp Ressentie',
    wind: 'Vitesse du Vent',
    humidity: 'Humidité Relative',
    precip_prob: 'Probabilité de Pluie',
    spray_decision: 'Conditions de Pulvérisation Microclimatiques',
    harvest_decision: 'Indice de Décision de Récolte de Précision',
    disease_pressure: 'Risque d’Infection (Mildiou & Oïdium)',
    hourly_forecast: 'Projection Microclimatique sur 24 Heures',
    daily_forecast: 'Perspectives Agro-Météorologiques à 5 Jours',
    fetching: 'Synchronisation de la télémétrie en cours...',
    fetch_error: 'Impossible de se connecter à la station. Affichage de données simulées.',
    updating: 'Mise à jour...',
    no_blocks: 'Aucune parcelle trouvée. Veuillez configurer les coordonnées.',
    risk_low: 'Pression Faible',
    risk_med: 'Pression Modérée',
    risk_high: 'Pression Élevée / Risque d’Infection Grave',
    spray_optimal: 'OPTIMAL: Pulvérisation Sûre',
    spray_caution: 'ATTENTION: Conditions Marginales',
    spray_danger: 'DANGER: Ne Pas Pulvériser',
    harvest_optimal: 'OPTIMAL: Excellente Fenêtre de Vendange',
    harvest_marginal: 'MARGINAL: Récolter avec Vigilance',
    harvest_unsafe: 'DANGER: Retarder la Vendange',
    recommendation: 'Directive Strategique',
    conditions_analyzed: 'Paramètres Analysés',
    frost_warning: 'CRITIQUE: Alerte Rischio Gelée!',
    heat_warning: 'CRITIQUE: Alerte Stress Thermique de la Canopée!',
    refresh: 'Actualiser la Télémétrie',
    feels_like: 'température ressentie'
  },
  de: {
    weather_station: 'Weinberg Agro-Wetterstation',
    station_desc: 'Echtzeit-Mikroklimatetelemetrie und Präzisions-Entscheidungshilfe.',
    select_block: 'Aktive Weinbergsparzelle',
    coordinates: 'GPS-Telemetrie',
    elevation: 'Höhe',
    current_conditions: 'Aktuelles Mikroklima',
    temp: 'Temperatur',
    apparent: 'Gefühlte Temp',
    wind: 'Windgeschwindigkeit',
    humidity: 'Relative Luftfeuchtigkeit',
    precip_prob: 'Regenwahrscheinlichkeit',
    spray_decision: 'Bedingungen zum Spritzen',
    harvest_decision: 'Ernte-Entscheidungsindex',
    disease_pressure: 'Infektionsrisiko (Falscher & Echter Mehltau)',
    hourly_forecast: '24-Stunden-Mikroklimaprognose',
    daily_forecast: '5-Tage-Agrarwettervorhersage',
    fetching: 'Synchronisiere Telemetrie...',
    fetch_error: 'Verbindung zur Wetterstation fehlgeschlagen. Zeige simulierte Daten.',
    updating: 'Aktualisiere...',
    no_blocks: 'Keine Parzellen gefunden. Bitte Koordinaten einstellen.',
    risk_low: 'Geringer Druck',
    risk_med: 'Mittlerer Druck',
    risk_high: 'Hoher Druck / Schweres Infektionsrisiko',
    spray_optimal: 'OPTIMAL: Spritzen Sicher',
    spray_caution: 'ACHTUNG: Grenzwertige Bedingungen',
    spray_danger: 'GEFAHR: Nicht Spritzen',
    harvest_optimal: 'OPTIMAL: Hervorragendes Erntefenster',
    harvest_marginal: 'GRENZWERTIG: Ernte mit Vorsicht',
    harvest_unsafe: 'GEFÄHRLICH: Ernte verschieben',
    recommendation: 'Strategische Richtlinie',
    conditions_analyzed: 'Analysierte Parameter',
    frost_warning: 'KRITISCH: Frostrisiko-Warnung!',
    heat_warning: 'KRITISCH: Hitzestress-Warnung für Laubwand!',
    refresh: 'Telemetrie aktualisieren',
    feels_like: 'gefühlte Temperatur'
  }
};

function getDownyDirective(risk: number, lang: string): string {
  const isKa = lang === 'ka';
  if (risk > 60) {
    return isKa
      ? "მაღალი საფრთხე! სასწრაფოდ გამოიყენეთ სისტემური დამცავები. ქიმიური: CAA ჯგუფი (FRAC 40) ან ფენილამიდები (FRAC 4). ბიო: სპილენძის დამცავი ჯგუფი (FRAC M01) + ვარჯის აერაცია."
      : "Severe threat! High infection risk. Apply systemic protectants immediately. Chemical: CAA group (FRAC 40) or Phenylamides (FRAC 4). Organic: Protectant Copper (FRAC M01) + canopy aeration.";
  }
  if (risk > 30) {
    return isKa
      ? "საშუალო საფრთხე. მოსალოდნელი წვიმის წინ რეკომენდებულია პრევენცია. ბიო: სპილენძის ნაერთები (FRAC M01). ქიმიური: ფოსფონატები (FRAC P07) ან CAA ჯგუფი (FRAC 40)."
      : "Moderate threat. Preventative application advised before forecasted rain. Organic: Copper Compounds (FRAC M01). Chemical: Phosphonates (FRAC P07) or CAA group (FRAC 40).";
  }
  return isKa
    ? "დაბალი საფრთხე. შესხურება არ არის საჭირო. განაგრძეთ ვარჯის ჩვეული მონიტორინგი."
    : "Low threat. No immediate treatment needed. Continue routine monitoring of canopy and leaves.";
}

function getPowderyDirective(risk: number, lang: string): string {
  const isKa = lang === 'ka';
  if (risk > 60) {
    return isKa
      ? "მაღალი საფრთხე! სოკოს სწრაფი გამრავლების ფანჯარა! რეზისტენტობის თავიდან ასაცილებლად მოახდინეთ MoA-ს როტაცია. ქიმიური: SDHI ჯგუფი (FRAC 7) ან ქვინაზოლინონები (FRAC 13). ბიო: გოგირდი (FRAC M02) + ბიოკონტროლი."
      : "Severe threat! Rapid fungal replication window. Rotate Mode of Action to manage resistance. Chemical: SDHI group (FRAC 7) or Quinazolinones (FRAC 13). Organic: Sulfur (FRAC M02) + systemic biocontrols.";
  }
  if (risk > 30) {
    return isKa
      ? "საშუალო საფრთხე. თბილი ამინდი და მაღალი ტენიანობა ხელს უწყობს გამრავლებას. ბიო: გოგირდი (FRAC M02) ან კალიუმის ბიკარბონატი. ქიმიური: DMI ტრიაზოლები (FRAC 3)."
      : "Moderate threat. Warm temperatures and high humidity favor replication. Organic: Sulfur (FRAC M02) or Potassium Bicarbonate. Chemical: DMI Triazoles (FRAC 3).";
  }
  return isKa
    ? "დაბალი საფრთხე. შესხურება არ არის საჭირო. განაგრძეთ ვარჯის ჩვეული მონიტორინგი."
    : "Low threat. Safe weather windows. No immediate spray required. Continue routine monitoring.";
}

export default function WeatherTab({
  lang,
  blocks,
  setActiveModule,
  setActiveTab,
  setPrefilledTaskTitle,
  setPrefilledTaskPriority,
  setPrefilledTaskDesc,
  canCreateTask = true,
}: WeatherTabProps) {
  const currentLang = (lang === 'ka' || lang === 'it' || lang === 'fr' || lang === 'de') ? lang : 'en';
  const t = dict[currentLang];

  const scheduleSprayingLabel = {
    en: 'Schedule Spraying',
    ka: 'წამლობის დაგეგმვა',
    it: 'Pianifica Irrorazione',
    fr: 'Planifier la Pulvérisation',
    de: 'Spritzen Planen'
  }[currentLang] || 'Schedule Spraying';

  const scheduleHarvestLabel = {
    en: 'Schedule Harvest',
    ka: 'კრეფის დაგეგმვა',
    it: 'Pianifica Vendemmia',
    fr: 'Planifier la Vendange',
    de: 'Ernte Planen'
  }[currentLang] || 'Schedule Harvest';

  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorStatus, setErrorStatus] = useState<boolean>(false);
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);

  // Advanced Agronometrics and AI Insight states
  const [selectedVariety, setSelectedVariety] = useState<string>('');
  const [selectedPhenology, setSelectedPhenology] = useState<string>('fruit_set');

  const phenologyPhases = useMemo(() => [
    {
      id: 'dormancy',
      label: {
        en: 'Dormancy / Winter Rest',
        ka: 'მოსვენების პერიოდი / ზამთარი',
        it: 'Dormienza / Riposo Invernale',
        fr: 'Dormance / Repos Hivernal',
        de: 'Dormanz / Winterruhe'
      },
      detail: {
        en: 'Inactive sap flow',
        ka: 'წვენის მოძრაობის გარეშე',
        it: 'Flusso di linfa inattivo',
        fr: 'Flux de sève inactif',
        de: 'Inaktiver Saftfluss'
      }
    },
    {
      id: 'budburst',
      label: {
        en: 'Budburst / Bud Break',
        ka: 'კვირტის გაშლა / გაღვიძება',
        it: 'Germogliamento',
        fr: 'Débourrement',
        de: 'Knospenaufbruch'
      },
      detail: {
        en: 'First green tips visible',
        ka: 'პირველი მწვანე ყლორტები',
        it: 'Prime punte verdi visibili',
        fr: 'Premières pointes vertes',
        de: 'Erste grüne Spitzen sichtbar'
      }
    },
    {
      id: 'shoot_dev',
      label: {
        en: 'Shoot & Leaf Development',
        ka: 'ყლორტებისა და ფოთლების ზრდა',
        it: 'Sviluppo dei Germogli e Foglie',
        fr: 'Développement des Rameaux et Feuilles',
        de: 'Trieb- und Blattentwicklung'
      },
      detail: {
        en: 'Rapid vegetative growth',
        ka: 'ვეგეტატიური მასის სწრაფი ზრდა',
        it: 'Rapida crescita vegetativa',
        fr: 'Croissance végétative rapide',
        de: 'Schnelles vegetatives Wachstum'
      }
    },
    {
      id: 'flowering',
      label: {
        en: 'Flowering / Bloom Stage',
        ka: 'ყვავილობის ეტაპი',
        it: 'Fioritura',
        fr: 'Floraison',
        de: 'Blütezeit'
      },
      detail: {
        en: 'Pollination and cap fall',
        ka: 'ყვავილების დამტვერვა',
        it: 'Impollinazione e caduta della caliptra',
        fr: 'Pollinisation et chute des capuchons',
        de: 'Bestäubung und Abwurf der Käppchen'
      }
    },
    {
      id: 'fruit_set',
      label: {
        en: 'Post-Flowering / Fruit Set',
        ka: 'ყვავილობის შემდგომი / გამონასკვა',
        it: 'Allegagione / Post-Fioritura',
        fr: 'Nouaison / Post-Floraison',
        de: 'Fruchtansatz / Nachblüte'
      },
      detail: {
        en: 'Early canopy expansion',
        ka: 'ფოთლოვანი საფარის სწრაფი ზრდა',
        it: 'Espansione precoce della chioma',
        fr: 'Expansion précoce de la canopée',
        de: 'Frühe Kronenentwicklung'
      }
    },
    {
      id: 'berry_dev',
      label: {
        en: 'Berry Development / Pea Size',
        ka: 'მარცვლის ზრდა / ბარდის ხელა ზომა',
        it: 'Accrescimento degli Acini',
        fr: 'Grossissement des Baies',
        de: 'Beerenwachstum'
      },
      detail: {
        en: 'Acid synthesis and cell division',
        ka: 'მჟავების სინთეზი და უჯრედების დაყოფა',
        it: 'Sintesi acida e divisione cellulare',
        fr: 'Synthèse d\'acide et division cellulaire',
        de: 'Säuresynthese und Zellteilung'
      }
    },
    {
      id: 'veraison',
      label: {
        en: 'Veraison (Color & Sugar Shift)',
        ka: 'შეფერადება / შაქრიანობის მატება',
        it: 'Invaiatura',
        fr: 'Véraison',
        de: 'Reifebeginn (Veraison)'
      },
      detail: {
        en: 'Berries soften and pigment',
        ka: 'კენკრა რბილდება და ფერადდება',
        it: 'Gli acini si ammorbidiscono e si pigmentano',
        fr: 'Les baies ramollissent et se colorent',
        de: 'Beeren werden weich und färben sich'
      }
    },
    {
      id: 'ripening',
      label: {
        en: 'Harvest Maturity Phase',
        ka: 'სიმწიფის / კრეფის წინა ეტაპი',
        it: 'Maturità di Raccolta',
        fr: 'Maturité de Récolte',
        de: 'Erntereife'
      },
      detail: {
        en: 'Phenolic maturity window',
        ka: 'ფენოლური სიმწიფის ფანჯარა',
        it: 'Finestra di maturità fenolica',
        fr: 'Fenêtre de maturité phénolique',
        de: 'Phenolisches Reifefenster'
      }
    },
    {
      id: 'post_harvest',
      label: {
        en: 'Post-Harvest / Leaf Fall',
        ka: 'მოსავლის შემდგომი / ფოთოლცვენა',
        it: 'Post-Vendemmia / Caduta Foglie',
        fr: 'Post-Récolte / Chute des Feuilles',
        de: 'Nachernte / Blattfall'
      },
      detail: {
        en: 'Nutrient reserve mobilization',
        ka: 'საკვები ნივთიერებების რეზერვირება',
        it: 'Mobilitazione delle riserve di nutrienti',
        fr: 'Mobilisation des réserves de nutriments',
        de: 'Mobilisierung von Nährstoffreserven'
      }
    }
  ], []);

  const activePhenologyConfig = useMemo(() => {
    return phenologyPhases.find(p => p.id === selectedPhenology) || phenologyPhases[4];
  }, [selectedPhenology, phenologyPhases]);

  const [apiCumulativeGdd, setApiCumulativeGdd] = useState<number | null>(null);
  const [apiCompareData, setApiCompareData] = useState<any[] | null>(null);
  const [apiMonthlyData, setApiMonthlyData] = useState<any[] | null>(null);
  const [histLoading, setHistLoading] = useState<boolean>(false);
  const [histError, setHistError] = useState<boolean>(false);
  const [histViewMode, setHistViewMode] = useState<'ytd' | 'monthly'>('ytd');

  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [histMetric, setHistMetric] = useState<'gdd' | 'rain' | 'temp'>('gdd');
  const [selectedForecastIdx, setSelectedForecastIdx] = useState<number>(0);

  // Varieties and threshold targets
  const varietyPresets = useMemo(() => [
    { name: 'Saperavi', requiredGdd: 1450, baseTemp: 10, type: 'red' },
    { name: 'Rkatsiteli', requiredGdd: 1300, baseTemp: 10, type: 'white' },
    { name: 'Kisi', requiredGdd: 1220, baseTemp: 10, type: 'amber' },
    { name: 'Mtsvane', requiredGdd: 1180, baseTemp: 10, type: 'amber' },
    { name: 'Pinot Noir', requiredGdd: 1050, baseTemp: 10, type: 'red' },
    { name: 'Chardonnay', requiredGdd: 1000, baseTemp: 10, type: 'white' },
    { name: 'Cabernet Sauvignon', requiredGdd: 1520, baseTemp: 10, type: 'red' },
    { name: 'Alexandrouli', requiredGdd: 1350, baseTemp: 10, type: 'red' }
  ], []);

  // Set default selected block and auto-bind variety preset
  useEffect(() => {
    if (blocks.length > 0 && !selectedBlockId) {
      setSelectedBlockId(blocks[0].id);
    }
  }, [blocks, selectedBlockId]);

  const activeBlock = useMemo(() => {
    return blocks.find(b => b.id === selectedBlockId) || blocks[0] || null;
  }, [blocks, selectedBlockId]);

  const finalCumulativeGdd = apiCumulativeGdd ?? 0;
  const finalCompareData = apiCompareData ?? [];

  const finalMonthlyData = apiMonthlyData ?? [];

  const activeMetricLabel = useMemo(() => {
    switch(histMetric) {
      case 'gdd': return { title: 'YTD Accumulated GDD Heat Sum (°C)', desc: 'Total heat accumulation since budburst. Higher sums indicate accelerated grape physiological maturation.', unit: '°C' };
      case 'rain': return { title: 'YTD Cumulative Spring Rainfall (mm)', desc: 'Aggregated microclimate water levels. Very high rain (e.g., 2025) sparks aggressive Downy pressure.', unit: 'mm' };
      case 'temp': return { title: 'Average Ambient Growth Temperate (°C)', desc: 'Mean canopy microclimate temperatures recorded daily across active growth hours.', unit: '°C' };
    }
  }, [histMetric]);

  useEffect(() => {
    if (activeBlock) {
      const match = varietyPresets.find(v =>
        v.name.toLowerCase() === activeBlock.grapeVariety.toLowerCase() ||
        activeBlock.grapeVariety.toLowerCase().includes(v.name.toLowerCase())
      );
      setSelectedVariety(match ? match.name : varietyPresets[0].name);
    }
  }, [activeBlock, varietyPresets]);

  // Fetch true weather from Open-Meteo keyless REST API
  const fetchWeatherData = async (lat: number, lng: number) => {
    setLoading(true);
    setErrorStatus(false);
    try {
      const response = await fetch(buildAgroForecastUrl(lat, lng));
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.reason || 'Network error');
      }
      const data = await response.json();

      // Format hourly points (next 24 hours)
      const hourlyData: Array<{
        time: string;
        temp: number;
        humidity: number;
        wind: number;
        pop: number;
      }> = [];
      const nowIdx = new Date().getHours();
      for (let i = 0; i < 24; i++) {
        const timeStr = data.hourly.time[nowIdx + i]
          ? new Date(data.hourly.time[nowIdx + i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : `${nowIdx + i}:00`;
        hourlyData.push({
          time: timeStr,
          temp: Math.round(data.hourly.temperature_2m[nowIdx + i] || 20),
          humidity: Math.round(data.hourly.relative_humidity_2m[nowIdx + i] || 60),
          wind: Math.round(data.hourly.wind_speed_10m[nowIdx + i] || 10),
          pop: Math.round(data.hourly.precipitation_probability[nowIdx + i] || 10),
        });
      }

      // Format daily points (next 5 days)
      const dailyData: Array<{
        date: string;
        tempMax: number;
        tempMin: number;
        popMax: number;
        windMax: number;
        weatherCode: number;
      }> = [];
      for (let i = 0; i < 5; i++) {
        const dateStr = data.daily.time[i]
          ? new Date(data.daily.time[i]).toLocaleDateString(currentLang === 'ka' ? 'ka-GE' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : `Day +${i}`;
        dailyData.push({
          date: dateStr,
          tempMax: Math.round(data.daily.temperature_2m_max[i] || 25),
          tempMin: Math.round(data.daily.temperature_2m_min[i] || 12),
          popMax: Math.round(data.daily.precipitation_probability_max[i] || 20),
          windMax: Math.round(data.daily.wind_speed_10m_max[i] || 15),
          weatherCode: data.daily.weather_code[i] || 0,
        });
      }

      setWeatherData({
        currentTemp: Math.round(data.current.temperature_2m),
        currentHumidity: Math.round(data.current.relative_humidity_2m),
        currentWind: Math.round(data.current.wind_speed_10m),
        currentPrecip: Math.round(data.current.precipitation || 0),
        weatherCode: data.current.weather_code,
        apparentTemp: Math.round(data.current.apparent_temperature),
        hourly: hourlyData,
        daily: dailyData
      });
    } catch {
      setErrorStatus(true);
      setWeatherData(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchHistoricalData = async (lat: number, lng: number) => {
    setHistLoading(true);
    setHistError(false);
    try {
      const today = new Date();
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(today.getDate() - 3);
      const formatDate = (d: Date) => d.toISOString().split('T')[0];

      const end2026 = formatDate(twoDaysAgo);
      const start2026 = '2026-04-01';

      const url2024 = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=2024-04-01&end_date=2024-10-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const url2025 = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=2025-04-01&end_date=2025-10-31&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
      const url2026 = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start2026}&end_date=${end2026}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

      const [res24, res25, res26] = await Promise.all([
        fetch(url2024).then(r => {
          if (!r.ok) throw new Error('2024 failed');
          return r.json();
        }),
        fetch(url2025).then(r => {
          if (!r.ok) throw new Error('2025 failed');
          return r.json();
        }),
        fetch(url2026).then(r => {
          if (!r.ok) throw new Error('2026 failed');
          return r.json();
        })
      ]);

      const processYearData = (data: any, year: number) => {
        if (!data || !data.daily || !data.daily.time) return [];
        return data.daily.time.map((timeStr: string, idx: number) => {
          const maxTemp = data.daily.temperature_2m_max[idx] ?? 18;
          const minTemp = data.daily.temperature_2m_min[idx] ?? 8;
          const precip = data.daily.precipitation_sum[idx] ?? 0;
          const avgTemp = (maxTemp + minTemp) / 2;
          const gdd = Math.max(0, avgTemp - 10);
          const date = new Date(timeStr);
          return {
            dateStr: timeStr,
            year,
            month: date.getMonth(),
            gdd,
            precip,
            avgTemp
          };
        });
      };

      const daily2024 = processYearData(res24, 2024);
      const daily2025 = processYearData(res25, 2025);
      const daily2026 = processYearData(res26, 2026);

      const todayMonth = today.getMonth();
      const todayDay = today.getDate();

      const isYtd = (item: any) => {
        const d = new Date(item.dateStr);
        const m = d.getMonth();
        const day = d.getDate();
        if (m < 3) return false;
        if (m > todayMonth) return false;
        if (m === todayMonth && day > todayDay) return false;
        return true;
      };

      const calcYtdStats = (dailyList: any[]) => {
        const ytdItems = dailyList.filter(isYtd);
        const totalGdd = Math.round(ytdItems.reduce((acc, item) => acc + item.gdd, 0));
        const totalRain = Math.round(ytdItems.reduce((acc, item) => acc + item.precip, 0));
        const meanTemp = ytdItems.length > 0
          ? Number((ytdItems.reduce((acc, item) => acc + item.avgTemp, 0) / ytdItems.length).toFixed(1))
          : 18.0;
        return { gdd: totalGdd, rain: totalRain, temp: meanTemp };
      };

      const stats2024 = calcYtdStats(daily2024);
      const stats2025 = calcYtdStats(daily2025);
      const stats2026 = calcYtdStats(daily2026);

      setApiCumulativeGdd(stats2026.gdd);

      const compareData = [
        {
          year: '2024 Past Vintage',
          gdd: stats2024.gdd,
          rain: stats2024.rain,
          temp: stats2024.temp,
          color: '#d97706'
        },
        {
          year: '2025 Past Vintage',
          gdd: stats2025.gdd,
          rain: stats2025.rain,
          temp: stats2025.temp,
          color: '#059669'
        },
        {
          year: '2026 Current Vintage',
          gdd: stats2026.gdd,
          rain: stats2026.rain,
          temp: stats2026.temp,
          color: '#4e0e15'
        }
      ];
      setApiCompareData(compareData);

      const monthKeys = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
      const monthNames: Record<number, string> = {
        3: 'Apr', 4: 'May', 5: 'Jun', 6: 'Jul', 7: 'Aug', 8: 'Sep', 9: 'Oct'
      };

      const monthlyBreakdown = monthKeys.map(mName => {
        const filterByMonthName = (dailyList: any[], mIndex: number) => {
          return dailyList.filter(item => item.month === mIndex);
        };

        const mIdxNum = Number(Object.keys(monthNames).find(k => monthNames[Number(k)] === mName));

        const items24 = filterByMonthName(daily2024, mIdxNum);
        const items25 = filterByMonthName(daily2025, mIdxNum);
        const items26 = filterByMonthName(daily2026, mIdxNum);

        const sumGdd = (items: any[]) => Math.round(items.reduce((acc, item) => acc + item.gdd, 0));
        const sumRain = (items: any[]) => Math.round(items.reduce((acc, item) => acc + item.precip, 0));
        const avgTemp = (items: any[]) => items.length > 0
          ? Number((items.reduce((acc, item) => acc + item.avgTemp, 0) / items.length).toFixed(1))
          : 0;

        const hasData26 = mIdxNum <= todayMonth;

        return {
          month: mName,
          '2024_gdd': sumGdd(items24),
          '2025_gdd': sumGdd(items25),
          '2026_gdd': hasData26 ? sumGdd(items26) : null,
          '2024_rain': sumRain(items24),
          '2025_rain': sumRain(items25),
          '2026_rain': hasData26 ? sumRain(items26) : null,
          '2024_temp': avgTemp(items24),
          '2025_temp': avgTemp(items25),
          '2026_temp': hasData26 ? avgTemp(items26) : null
        };
      });

      setApiMonthlyData(monthlyBreakdown);

    } catch (err) {
      console.error("Historical fetch error:", err);
      setHistError(true);
    } finally {
      setHistLoading(false);
    }
  };

  // Selected variety configuration
  const activeVarietyConfig = useMemo(() => {
    return varietyPresets.find(v => v.name === selectedVariety) || varietyPresets[0];
  }, [selectedVariety, varietyPresets]);

  // Dynamic daily GDD additions based on forecast
  const forecastGddSum = useMemo(() => {
    if (!weatherData) return 0;
    return weatherData.daily.reduce((sum, day) => {
      const avg = (day.tempMax + day.tempMin) / 2;
      const gddDay = Math.max(0, avg - activeVarietyConfig.baseTemp);
      return sum + gddDay;
    }, 0);
  }, [weatherData, activeVarietyConfig]);

  // Calculate ripeness estimate (how many days of avg GDD growth is remaining)
  const daysToRipeness = useMemo(() => {
    const remainingGdd = activeVarietyConfig.requiredGdd - finalCumulativeGdd;
    if (remainingGdd <= 0) return 0; // Already ripe/harvestable!
    const avgDailyGdd = forecastGddSum > 0 ? (forecastGddSum / 5) : 8; // fallback to 8 GDD/day
    return Math.max(1, Math.round(remainingGdd / avgDailyGdd));
  }, [finalCumulativeGdd, activeVarietyConfig, forecastGddSum]);

  // Advanced Infection Indices calculation
  const infectionMetrics = useMemo(() => {
    const temp = weatherData?.currentTemp ?? 20;
    const hum = weatherData?.currentHumidity ?? 65;
    const hoursWet = weatherData && weatherData.currentPrecip > 0 ? 12 : 3;
    const rainAmount = weatherData?.currentPrecip ?? 0;

    // Downy Mildew Risk (Plasmopara viticola)
    let downyRisk = 5;
    if (temp >= 10 && temp <= 29 && (hoursWet >= 6 || rainAmount > 0)) {
      const tempFactor = 1 - Math.abs(temp - 20) / 10;
      const wetFactor = Math.min(1.5, hoursWet / 10);
      downyRisk = Math.min(100, Math.round(30 + 50 * tempFactor * wetFactor + (hum > 80 ? 15 : 0)));
    } else if (temp >= 8 && temp <= 30 && hum > 70) {
      downyRisk = 15;
    }

    // Powdery Mildew Risk (Uncinula necator)
    let powderyRisk = 10;
    if (temp >= 13 && temp <= 32) {
      const tempFactor = 1 - Math.abs(temp - 23) / 11;
      const humFactor = Math.min(1.2, hum / 65);
      powderyRisk = Math.min(100, Math.round(20 + 65 * tempFactor * humFactor - (rainAmount > 10 ? 15 : 0)));
    }

    // Botrytis Bunch Rot (Gray Rot)
    let botrytisRisk = 5;
    if (temp >= 12 && temp <= 26 && (hoursWet >= 8 || hum > 80)) {
      const tempFactor = 1 - Math.abs(temp - 19) / 8;
      const wetFactor = Math.max(0.5, Math.min(1.6, hoursWet / 12));
      botrytisRisk = Math.min(100, Math.round(15 + 60 * tempFactor * wetFactor));
    }

    return { downyRisk, powderyRisk, botrytisRisk };
  }, [weatherData]);

  // 5-Day Pathogen Projections
  const forecastPathogenRisks = useMemo(() => {
    if (!weatherData) return [];
    return weatherData.daily.map(day => {
      const avgTemp = (day.tempMax + day.tempMin) / 2;

      let downy = 10;
      if (avgTemp > 10 && day.popMax > 25) {
        downy = Math.min(100, Math.round(25 + (day.popMax - 25) * 0.9 + (10 - Math.abs(avgTemp - 20)) * 2.5));
      } else if (avgTemp > 12) {
        downy = 20;
      }

      let powdery = 15;
      if (avgTemp >= 15 && avgTemp <= 28) {
        powdery = Math.min(100, Math.round(30 + (13 - Math.abs(avgTemp - 23)) * 4.5 - (day.popMax > 50 ? 15 : 0)));
      }

      return {
        date: day.date.split(',')[0],
        downy,
        powdery
      };
    });
  }, [weatherData]);

  // Combined Disease pressure index (Mildew progression risk)
  const diseasePressureIndex = useMemo(() => {
    if (!weatherData) return 'low';
    const h = weatherData.currentHumidity;
    const t = weatherData.currentTemp;
    if (h > 75 && t > 18 && t < 28) return 'high';
    if (h > 60 && t > 15) return 'medium';
    return 'low';
  }, [weatherData]);

  // Call Gemini AI Viticulturalist engine
  const handleGetAiReport = async () => {
    setAiLoading(true);
    setAiAdvice(null);
    try {
      const gddInfo = `Accumulated GDD: ${finalCumulativeGdd}°C, Required GDD for ${selectedVariety}: ${activeVarietyConfig.requiredGdd}°C. Predicted days to physiological maturity: ${daysToRipeness} days.`;
      const currentStats = `REAL-TIME TELEMETRY STATUS: Temp ${weatherData?.currentTemp}°C, Humidity ${weatherData?.currentHumidity}%, Wind: ${weatherData?.currentWind} km/h, Precipitation Code: ${weatherData?.weatherCode}.`;
      const phenologyInfo = `OBSERVED PHENOLOGICAL PHASE: ${activePhenologyConfig.label.en} (${activePhenologyConfig.detail.en}).`;

      const forecastSummary = weatherData
        ? `Upcoming 5-day forecast limits: ${weatherData.daily.map(d => `${d.date}: Max ${d.tempMax}°C / Min ${d.tempMin}°C, Rain chance ${d.popMax}%`).join('; ')}`
        : 'No 5-day forecast available.';

      const promptMsg = `You are a Senior Viticulturist & Precision Vineyard Modeler.
Provide a professional, highly specific agronomic assessment for vineyard block: "${activeBlock?.name}" which is a ${activeBlock?.grapeVariety} block at altitude ${activeBlock?.elevation} meters.

${currentStats}
${gddInfo}
${phenologyInfo}
${forecastSummary}

Calculated disease infection indices:
- Downy Mildew: ${infectionMetrics.downyRisk}%
- Powdery Mildew: ${infectionMetrics.powderyRisk}%
- Botrytis / Bunch Rot: ${infectionMetrics.botrytisRisk}%

Output a concise strategic viticultural recommendation plan. Since the user selected variety is ${selectedVariety}, tailor your answers specifically to this variety (e.g. Saperavi thick skin, Rkatsiteli bunch density, etc.). Include:
1. Phenological status commentary & Ripeness time prediction.
2. Pathogen Risk Assessment & preventative spraying guide.
3. Canopy Management actions (e.g. canopy thinning, leaf pulling) regarding current weather trends.
Avoid preamble or general fluff, respond with scientific precision in a highly-structured markdown layout using clean bullet points.`;

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptMsg })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch prediction metrics.');
      }
      setAiAdvice(data.text);
    } catch (err: any) {
      console.error(err);
      setAiAdvice(`⚠️ **Viticultural Engine Offline**: ${err.message || 'Check your Gemini key configuration.'}`);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (activeBlock) {
      fetchWeatherData(activeBlock.latitude, activeBlock.longitude);
      fetchHistoricalData(activeBlock.latitude, activeBlock.longitude);
    }
    // Fetch only when the selected block changes. The request helpers update
    // this component's state and are intentionally not effect dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBlock]);

  // Decode WMO weather code to text & icon
  const weatherIconAndText = (code: number) => {
    if (code === 0) {
      return { icon: <Sun className="w-8 h-8 text-amber-500 animate-pulse" />, text: currentLang === 'ka' ? 'მოწმენდილი' : 'Clear Sky' };
    } else if (code >= 1 && code <= 3) {
      return { icon: <CloudSun className="w-8 h-8 text-stone-500" />, text: currentLang === 'ka' ? 'ნაწილობრივ ღრუბლიანი' : 'Partly Cloudy' };
    } else if (code >= 51 && code <= 67) {
      return { icon: <CloudRain className="w-8 h-8 text-sky-500" />, text: currentLang === 'ka' ? 'წვიმა' : 'Rainy Conditions' };
    } else if (code >= 80 && code <= 82) {
      return { icon: <CloudRain className="w-8 h-8 text-sky-600 animate-bounce" style={{ animationDuration: '4s' }} />, text: currentLang === 'ka' ? 'ხანმოკლე წვიმა' : 'Showers' };
    } else {
      return { icon: <Sun className="w-8 h-8 text-amber-500" />, text: currentLang === 'ka' ? 'სასიამოვნო' : 'Mild Seasonal' };
    }
  };

  // Spraying Condition Decision Engine
  const sprayingAnalysis = useMemo(() => {
    if (!weatherData) return null;
    const { currentWind, hourly } = weatherData;
    // Check next 6 hours precipitation probability is high
    const next6HoursPrecip = hourly.slice(0, 6).some(h => h.pop > 30);
    const rainNow = weatherData.currentPrecip > 0;

    let status: 'optimal' | 'caution' | 'danger' = 'optimal';
    let labelText = t.spray_optimal;
    let message = '';

    if (currentWind > 18 || rainNow || next6HoursPrecip) {
      status = 'danger';
      labelText = t.spray_danger;
      if (currentWind > 18) {
        message = currentLang === 'ka'
          ? `ქარის სიჩქარეა ${currentWind} კმ/სთ, რამაც შეიძლება გამოიწვიოს პრეპარატის დრიფტი (არათანაბარი გადანაწილება). შესხურება დაუშვებელია.`
          : `High winds of ${currentWind} km/h introduce extreme chemical drift risks. Spraying is prohibited.`;
      } else if (rainNow) {
        message = currentLang === 'ka'
          ? 'ვენახში ამჟამად წვიმს. პრეპარატები მყისიერად ჩამოირეცხება ფოთლიდან და ვერ შეაღწევს ქსოვილებში.'
          : 'Precipitation currently active. Chemicals will instantly wash off the canopy before absorption.';
      } else {
        message = currentLang === 'ka'
          ? 'მომდევნო 6 საათში მოსალოდნელია წვიმა (ალბათობა > 30%). დაუშვებელია კონტაქტური ფუნგიციდების შესხურება.'
          : 'High rain probability (>30%) forecast in the next 6 hours. Systemic or contact spray will wash off.';
      }
    } else if (currentWind > 12 || weatherData.currentTemp > 30 || currentWind < 4) {
      status = 'caution';
      labelText = t.spray_caution;
      if (currentWind > 12) {
        message = currentLang === 'ka'
          ? `ზღვრული ქარი (${currentWind} კმ/სთ). გამოიყენეთ შესაბამისი დანამატები (ადჰეზივები) ფოთოლთან უკეთესი კავშირისთვის.`
          : `Marginal wind speed of ${currentWind} km/h. Work slowly and apply drift-reduction nozzles.`;
      } else if (weatherData.currentTemp > 30) {
        message = currentLang === 'ka'
          ? `მაღალი ტემპერატურა (${weatherData.currentTemp}°C). გოგირდის ან ზეთის ბაზაზე შესხურებამ შეიძლება გამოიწვიოს ფოთლების დამწვრობა.`
          : `High temperature of ${weatherData.currentTemp}°C. Sulfur or oil spray may ignite phytotoxicity, causing canopy leaf-burn.`;
      } else {
        message = currentLang === 'ka'
          ? 'ქარი ძალიან დაბალია (<4 კმ/სთ). არსებობს თერმული ინვერსიის საფრთხე, რამაც შეიძლება შეაჩეროს ქიმიური ნისლი ერთ ადგილას.'
          : 'Ultra-low wind (<4 km/h) with risk of thermal inversion, keeping chemical cloud suspended locally with poor horizontal dispersion.';
      }
    } else {
      message = currentLang === 'ka'
        ? `ქარის სიჩქარეა ${currentWind} კმ/სთ, ტემპერატურაა ${weatherData.currentTemp}°C. ფოთოლი მშრალია. იდეალური პირობებია შესაწამლად.`
        : `Wind speed matches optimal range (${currentWind} km/h) and temperature is mild (${weatherData.currentTemp}°C). Leaves are dry. Excellent absorption rate expected.`;
    }

    return { status, labelText, message };
  }, [weatherData, t, currentLang]);

  // Harvest Decision Engine
  const harvestAnalysis = useMemo(() => {
    if (!weatherData) return null;
    const { currentTemp } = weatherData;
    const { daily } = weatherData;

    // Check if harvest is in season. Harvest is inactive if it's before August (month < 7)
    // AND GDD has not reached at least 85% of variety requirements (unless manually overridden by phenology phase).
    const currentMonth = new Date().getMonth(); // 0-indexed: June is 5, August is 7
    const isHarvestSeason = (currentMonth >= 7) || (finalCumulativeGdd >= activeVarietyConfig.requiredGdd * 0.85) || (selectedPhenology === 'ripening');

    if (!isHarvestSeason) {
      const labelText = ({
        en: 'Growth / Vegetative Phase',
        ka: 'ზრდის / ვეგეტაციის ფაზა',
        it: 'Fase Vegetativa / Crescita',
        fr: 'Phase Végétative / Croissance',
        de: 'Wachstums- / Vegetationsphase'
      })[lang] || 'Growth / Vegetative Phase';

      const message = currentLang === 'ka'
        ? `მოსავლის აღების სეზონი არ არის აქტიური. ვაზი ამჟამად ზრდა-განვითარების ფაზაშია (GDD: ${finalCumulativeGdd}°C, მიზნობრივი: ${activeVarietyConfig.requiredGdd}°C). ამ ეტაპზე ნალექები არ ახდენს გავლენას კრეფის განრიგზე.`
        : `Harvest season is inactive. Vines are currently in the growth/fruiting phase (GDD: ${finalCumulativeGdd}°C of ${activeVarietyConfig.requiredGdd}°C target). Microclimatic risks like rain do not affect harvest schedules at this stage.`;

      return { status: 'inactive' as const, labelText, message };
    }

    // Estimate if next 3 days are dry
    const incomingRain = daily.slice(0, 3).some(d => d.popMax > 40);
    const rainNow = weatherData.currentPrecip > 0;

    let status: 'optimal' | 'caution' | 'danger' | 'inactive' = 'optimal';
    let labelText = t.harvest_optimal;
    let message = '';

    if (rainNow || currentTemp < 4) {
      status = 'danger';
      labelText = t.harvest_unsafe;
      if (rainNow) {
        message = currentLang === 'ka'
          ? 'წვიმის დროს ყურძნის კრეფა დაუშვებელია! სველი ყურძენი ასქელებს ტკბილს, ამცირებს შაქრიანობას (ბრიქსს) და უწყობს ხელს ლპობას.'
          : 'Strictly delay harvest on rainy hours! Damp grape bunch skin dilutes critical sugar levels (Brix) and accelerates gray rot oxidation.';
      } else {
        message = currentLang === 'ka'
          ? `წაყინვის საშიშროება (${currentTemp}°C)! ყინვამ შეიძლება დააზიანოს კენკრა და შეაჩეროს უჯრედის მუშაობა.`
          : `Severe frost hazard (${currentTemp}°C)! Low cell vitality degrades phenolic ripeness parameters rapidly.`;
      }
    } else if (incomingRain || currentTemp > 28) {
      status = 'caution';
      labelText = t.harvest_marginal;
      if (incomingRain) {
        message = currentLang === 'ka'
          ? 'მომდევნო 72 საათში მოსალოდნელია წვიმა. თუ კენკრა სრულ მწიფობაშია, დაიწყეთ დაჩქარებული კრეფა, რომ თავიდან აიცილოთ კენკრის დასკდომა.'
          : 'Heavy precipitation is expected within 72 hours. If grape maturity indicators are optimal, accelerate picking immediately.';
      } else {
        message = currentLang === 'ka'
          ? `მაღალი სიცხე (${currentTemp}°C). რეკომენდებულია ღამის ან დილის კრეფა (დილის 5-დან 9 საათამდე), რათა ყურძენი გრილი შევიდეს მარანში და არ დაიწყოს ნაადრევი დუღილი.`
          : `Midday heat stress (${currentTemp}°C). Prioritize night-harvesting or dawn picking (5 AM - 9 AM) to preserve aromatic freshness.`;
      }
    } else {
      message = currentLang === 'ka'
        ? 'ამინდი იდეალურად მშრალია. ნიადაგი მყარია მექანიკური კრეფისთვის, ხოლო ჰაერი გრილია კენკრის პირველადი დაცვისთვის.'
        : 'Dry atmospheric envelope. Sound terrain traction for haulers, and moderate cooling profile to maintain bunch integrity.';
    }

    return { status, labelText, message };
  }, [weatherData, t, currentLang, finalCumulativeGdd, activeVarietyConfig, lang, selectedPhenology]);

  const weatherDeco = weatherData ? weatherIconAndText(weatherData.weatherCode) : { icon: <Sun className="w-8 h-8 text-amber-500" />, text: '' };

  return (
    <div className="space-y-6">
      {blocks.length === 0 ? (
        <div className="bg-white border border-amber-200 rounded-3xl p-8 text-center text-stone-700 flex flex-col items-center gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-600" />
          <div>
            <h3 className="font-bold text-sm">{t.no_blocks}</h3>
          </div>
        </div>
      ) : loading && !weatherData ? (
        <div className="bg-white border border-[#e8dfd5] rounded-3xl p-12 text-center text-stone-600 font-medium animate-pulse flex flex-col items-center gap-3">
          <RotateCw className="w-10 h-10 text-emerald-800 animate-spin" />
          <p className="text-xs font-semibold">{t.fetching}</p>
        </div>
      ) : !weatherData ? (
        <div className="bg-white border border-amber-200 rounded-3xl p-8 text-center text-stone-700 flex flex-col items-center gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-600" />
          <div>
            <h3 className="font-bold text-sm">Live weather is unavailable</h3>
            <p className="mt-1 text-xs text-stone-500">
              No estimated or simulated readings are being shown. Check the connection and the selected vineyard coordinates.
            </p>
          </div>
          {activeBlock && (
            <button
              type="button"
              onClick={() => fetchWeatherData(activeBlock.latitude, activeBlock.longitude)}
              className="rounded-lg bg-[#4e0e15] px-4 py-2 text-xs font-bold text-white cursor-pointer"
            >
              Retry live weather
            </button>
          )}
        </div>
      ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* LIVE DATA CARD */}
            <div className="lg:col-span-1 bg-gradient-to-br from-white to-stone-50/20 border border-[#e8dfd5]/65 rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.06)] flex flex-col justify-between space-y-6 relative overflow-hidden transition-all duration-300 hover:scale-[1.01]">
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#801323] to-[#4e0e15]" />
              <div className="absolute -right-10 -bottom-10 w-24 h-24 bg-[#801323]/5 rounded-full blur-2xl pointer-events-none" />

              <div className="space-y-4 relative z-10">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-stone-900 font-serif font-black text-sm uppercase tracking-wide">{t.current_conditions}</h3>
                    <p className="text-[9px] font-mono text-slate-400 mt-0.5">{activeBlock.vineyardName}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] font-mono bg-stone-100 border border-stone-250/60 text-stone-600 px-2.5 py-1 rounded font-bold uppercase inline-block">
                      {weatherDeco.text}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 py-2 border-b border-stone-100">
                  <div className="p-2 bg-stone-50 rounded-2xl border border-stone-100 shadow-3xs animate-pulse" style={{ animationDuration: '4s' }}>
                    {weatherDeco.icon}
                  </div>
                  <div>
                    <div className="flex items-baseline">
                      <span className="text-4xl font-serif font-black text-stone-900 tracking-tight">{weatherData.currentTemp}°C</span>
                    </div>
                    <span className="text-[10px] text-stone-400 font-serif font-medium">{t.apparent}: {weatherData.apparentTemp}°C</span>
                  </div>
                </div>

                {/* Grid stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-stone-50/80 rounded-2xl border border-stone-200/40 shadow-3xs hover:border-emerald-250/30 hover:bg-emerald-50/10 transition-all duration-200">
                    <span className="text-[9px] font-mono text-slate-450 uppercase block font-bold">{t.wind}</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Wind className="w-4 h-4 text-emerald-750" />
                      <strong className="text-sm font-serif font-black text-stone-850">{weatherData.currentWind} km/h</strong>
                    </div>
                  </div>
                  <div className="p-3 bg-stone-50/80 rounded-2xl border border-stone-200/40 shadow-3xs hover:border-sky-250/30 hover:bg-sky-50/10 transition-all duration-200">
                    <span className="text-[9px] font-mono text-slate-450 uppercase block font-bold">{t.humidity}</span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Droplets className="w-4 h-4 text-sky-600" />
                      <strong className="text-sm font-serif font-black text-stone-850">{weatherData.currentHumidity}%</strong>
                    </div>
                  </div>
                </div>

                {/* Vineyard Coordinate Details */}
                <div className="p-3.5 bg-gradient-to-br from-emerald-50/60 to-teal-50/20 border border-emerald-100/55 rounded-2xl shadow-3xs space-y-1.5 text-[11px] hover:border-emerald-300/40 transition-all duration-200">
                  <div className="flex items-center gap-1.5 font-mono text-[9px] text-emerald-800 font-bold">
                    <MapPin className="w-3 h-3 animate-bounce" style={{ animationDuration: '3s' }} />
                    <span>{t.coordinates}</span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-stone-605 border-b border-stone-150/40 pb-1">
                    <span>Lat / Lng:</span>
                    <span className="font-bold text-stone-800">{activeBlock.latitude.toFixed(4)}, {activeBlock.longitude.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-stone-605">
                    <span>{t.elevation}:</span>
                    <span className="font-bold text-stone-800">{activeBlock.elevation}m</span>
                  </div>
                </div>

              </div>

              {/* Temperature extremes warning */}
              {weatherData.currentTemp < 4 ? (
                <div className="p-3.5 bg-cyan-50/70 border border-cyan-205 text-cyan-900 rounded-2xl flex items-center gap-2.5">
                  <Snowflake className="w-5 h-5 text-[#2a8396] shrink-0 animate-bounce" />
                  <div className="text-[10.5px]">
                    <strong className="block leading-none uppercase font-bold text-[9.5px]">{t.frost_warning}</strong>
                    <span className="block mt-1 font-medium select-none">Frost protection active: run heaters, misting or fans if available.</span>
                  </div>
                </div>
              ) : weatherData.currentTemp > 32 ? (
                <div className="p-3.5 bg-orange-50 border border-orange-205 text-orange-900 rounded-2xl flex items-center gap-2.5">
                  <Flame className="w-5 h-5 text-orange-600 shrink-0 animate-pulse" />
                  <div className="text-[10.5px]">
                    <strong className="block leading-none uppercase font-bold text-[9.5px]">{t.heat_warning}</strong>
                    <span className="block mt-1 font-medium select-none">Irrigation support needed shortly due to high evaporation.</span>
                  </div>
                </div>
              ) : null}

              {errorStatus && (
                <div className="p-2.5 bg-amber-50 border border-[#e8dfd5] text-amber-850 text-[9px] rounded-xl flex items-center gap-1.5 mt-2 font-medium">
                  <Info className="w-3 h-3 shrink-0" />
                  <span>{t.fetch_error}</span>
                </div>
              )}
            </div>

            {/* DECISION SUPPORT MATRIX PANEL */}
            <div className="lg:col-span-2 space-y-6">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Spraying decision Card */}
                {sprayingAnalysis && (
                  <div className={`p-5 rounded-3xl border flex flex-col justify-between space-y-3.5 transition-all duration-300 hover:scale-[1.015] ${
                    sprayingAnalysis.status === 'optimal'
                      ? 'bg-gradient-to-br from-emerald-50/70 to-emerald-50/20 border-emerald-250/60 shadow-[0_8px_30px_rgba(16,185,129,0.04)] hover:shadow-[0_12px_35px_rgba(16,185,129,0.08)] hover:border-emerald-300 text-emerald-950'
                      : sprayingAnalysis.status === 'caution'
                      ? 'bg-gradient-to-br from-amber-50/70 to-amber-50/20 border-amber-250/60 shadow-[0_8px_30px_rgba(245,158,11,0.04)] hover:shadow-[0_12px_35px_rgba(245,158,11,0.08)] hover:border-amber-300 text-amber-950'
                      : 'bg-gradient-to-br from-rose-50/70 to-rose-50/20 border-rose-250/60 shadow-[0_8px_30px_rgba(239,68,68,0.04)] hover:shadow-[0_12px_35px_rgba(239,68,68,0.08)] hover:border-rose-300 text-rose-950'
                  }`}>
                    <div>
                      <div className="flex justify-between items-center border-b border-black/5 pb-2">
                        <h4 className="text-[10.5px] font-mono uppercase font-black text-stone-605">{t.spray_decision}</h4>
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-black uppercase text-white shadow-3xs ${
                          sprayingAnalysis.status === 'optimal' ? 'bg-emerald-800' : sprayingAnalysis.status === 'caution' ? 'bg-amber-600' : 'bg-red-700'
                        }`}>
                          {sprayingAnalysis.labelText}
                        </span>
                      </div>
                      <p className="text-xs font-semibold leading-relaxed mt-3">{sprayingAnalysis.message}</p>

                      {canCreateTask && sprayingAnalysis.status === 'optimal' && setActiveModule && setActiveTab && setPrefilledTaskTitle && setPrefilledTaskPriority && setPrefilledTaskDesc && (
                        <button
                          onClick={() => {
                            if (!canCreateTask) return;
                            const blockName = activeBlock?.name || '';
                            const variety = activeBlock?.grapeVariety || '';
                            const temp = weatherData?.currentTemp ?? '';
                            const wind = weatherData?.currentWind ?? '';
                            const hum = weatherData?.currentHumidity ?? '';

                            const title = currentLang === 'ka'
                              ? `ფუნგიციდებით წამლობა - ${blockName}`
                              : `Spray Fungicide Campaign - ${blockName}`;

                            const desc = currentLang === 'ka'
                              ? `წამლობის კამპანია დაგეგმილია აგრო-მეტეო ტელემეტრიის საფუძველზე. ნაკვეთი: ${blockName} (${variety}). მიმდინარე მიკროკლიმატური პირობები: ტემპერატურა ${temp}°C, ქარი ${wind} კმ/სთ, ტენიანობა ${hum}%. დაავადების რისკის წნევაა: ${diseasePressureIndex === 'high' ? 'მაღალი' : diseasePressureIndex === 'medium' ? 'საშუალო' : 'დაბალი'}.`
                              : `Spraying campaign scheduled based on agro-weather telemetry. Block: ${blockName} (${variety}). Current Conditions: Temp ${temp}°C, Wind ${wind} km/h, Humidity ${hum}%. Disease risk pressure is ${diseasePressureIndex.toUpperCase()}.`;

                            setPrefilledTaskTitle(title);
                            setPrefilledTaskPriority('medium');
                            setPrefilledTaskDesc(desc);
                            setActiveModule('gvino');
                            setActiveTab('tasks');
                          }}
                          className="w-full mt-4 py-2 px-3 text-[10px] font-sans font-extrabold uppercase tracking-wider text-white bg-gradient-to-r from-emerald-800 to-teal-850 hover:from-emerald-900 hover:to-teal-900 active:scale-98 rounded-xl transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer shadow-md hover:shadow-lg border border-transparent"
                        >
                          <Calendar className="w-3.5 h-3.5 animate-pulse" />
                          {scheduleSprayingLabel}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1 pt-1">
                      <span className="text-[8px] font-mono uppercase text-stone-405 block font-bold">{t.conditions_analyzed}</span>
                      <div className="flex gap-3 text-[10px] font-mono font-bold">
                        <span>Wind: {weatherData.currentWind} km/h</span>
                        <span>Temp: {weatherData.currentTemp}°C</span>
                        <span>Rain probability: {weatherData.hourly[0]?.pop}%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Harvesting decision Card */}
                {harvestAnalysis && (
                  <div className={`p-5 rounded-3xl border flex flex-col justify-between space-y-3.5 transition-all duration-300 hover:scale-[1.015] ${
                    harvestAnalysis.status === 'optimal'
                      ? 'bg-gradient-to-br from-emerald-50/70 to-emerald-50/20 border-emerald-250/60 shadow-[0_8px_30px_rgba(16,185,129,0.04)] hover:shadow-[0_12px_35px_rgba(16,185,129,0.08)] hover:border-emerald-300 text-emerald-950'
                      : harvestAnalysis.status === 'caution'
                      ? 'bg-gradient-to-br from-amber-50/70 to-amber-50/20 border-amber-250/60 shadow-[0_8px_30px_rgba(245,158,11,0.04)] hover:shadow-[0_12px_35px_rgba(245,158,11,0.08)] hover:border-amber-300 text-amber-950'
                      : harvestAnalysis.status === 'inactive'
                      ? 'bg-gradient-to-br from-stone-50/80 to-stone-50/30 border-stone-200 shadow-[0_8px_30px_rgba(120,113,108,0.02)] hover:shadow-[0_12px_35px_rgba(120,113,108,0.05)] hover:border-stone-300 text-stone-700'
                      : 'bg-gradient-to-br from-rose-50/70 to-rose-50/20 border-rose-250/60 shadow-[0_8px_30px_rgba(239,68,68,0.04)] hover:shadow-[0_12px_35px_rgba(239,68,68,0.08)] hover:border-rose-300 text-rose-950'
                  }`}>
                    <div>
                      <div className="flex justify-between items-center border-b border-black/5 pb-2">
                        <h4 className="text-[10.5px] font-mono uppercase font-black text-stone-605">{t.harvest_decision}</h4>
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-black uppercase text-white shadow-3xs ${
                          harvestAnalysis.status === 'optimal'
                            ? 'bg-emerald-800'
                            : harvestAnalysis.status === 'caution'
                            ? 'bg-amber-600'
                            : harvestAnalysis.status === 'inactive'
                            ? 'bg-stone-500'
                            : 'bg-red-700'
                        }`}>
                          {harvestAnalysis.labelText}
                        </span>
                      </div>
                      <p className="text-xs font-semibold leading-relaxed mt-3">{harvestAnalysis.message}</p>

                      {canCreateTask && harvestAnalysis.status === 'optimal' && setActiveModule && setActiveTab && setPrefilledTaskTitle && setPrefilledTaskPriority && setPrefilledTaskDesc && (
                        <button
                          onClick={() => {
                            if (!canCreateTask) return;
                            const blockName = activeBlock?.name || '';
                            const variety = activeBlock?.grapeVariety || '';
                            const temp = weatherData?.currentTemp ?? '';
                            const hum = weatherData?.currentHumidity ?? '';

                            const title = currentLang === 'ka'
                              ? `ყურძნის კრეფა - ${blockName}`
                              : `Harvest Picking - ${blockName}`;

                            const desc = currentLang === 'ka'
                              ? `მოსავლის კრეფის კამპანია დაგეგმილია აგრო-კლიმატური პარამეტრების საფუძველზე. ნაკვეთი: ${blockName} (${variety}). ჯიში: ${selectedVariety} (${activeVarietyConfig.type === 'red' ? 'წითელი' : activeVarietyConfig.type === 'white' ? 'თეთრი' : 'ქარვისფერი'}). მიმდინარე აქტიური ტემპერატურების ჯამი (GDD): ${finalCumulativeGdd}°C (მიზნობრივი ზღვარი: ${activeVarietyConfig.requiredGdd}°C GDD). მეტეო პარამეტრები: ტემპერატურა ${temp}°C, ტენიანობა ${hum}%.`
                              : `Harvest campaign scheduled based on viticultural agro-meteorological metrics. Block: ${blockName} (${variety}). Variety: ${selectedVariety} (${activeVarietyConfig.type}). Current heat sum: ${finalCumulativeGdd}°C GDD vs Target threshold: ${activeVarietyConfig.requiredGdd}°C GDD. Telemetry: Temp ${temp}°C, Humidity ${hum}%.`;

                            setPrefilledTaskTitle(title);
                            setPrefilledTaskPriority('high');
                            setPrefilledTaskDesc(desc);
                            setActiveModule('gvino');
                            setActiveTab('tasks');
                          }}
                          className="w-full mt-4 py-2 px-3 text-[10px] font-sans font-extrabold uppercase tracking-wider text-white bg-gradient-to-r from-emerald-800 to-teal-850 hover:from-emerald-900 hover:to-teal-900 active:scale-98 rounded-xl transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer shadow-md hover:shadow-lg border border-transparent"
                        >
                          <Calendar className="w-3.5 h-3.5 animate-pulse" />
                          {scheduleHarvestLabel}
                        </button>
                      )}
                    </div>

                    <div className="space-y-1 pt-1">
                      <span className="text-[8px] font-mono uppercase text-stone-450 block font-bold">{t.conditions_analyzed}</span>
                      <div className="flex gap-3 text-[10px] font-mono font-bold">
                        <span>Precipitation sum: {weatherData.currentPrecip} mm</span>
                        <span>Relative humidity: {weatherData.currentHumidity}%</span>
                        <span>Forecast dry days: {weatherData.daily.slice(0,3).filter(d => d.popMax < 30).length}/3</span>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* DISEASE INCUBATION PRESSURE ALERT PANEL */}
              <div className="bg-white border border-[#e8dfd5] p-5 rounded-3xl shadow-3xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1 flex-1">
                  <h4 className="font-serif font-black text-xs text-stone-900 uppercase flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#4e0e15] animate-pulse" />
                    {t.disease_pressure}
                  </h4>
                  <p className="text-[11px] text-stone-500 font-medium leading-relaxed">
                    Downy Mildew thrives in wet leaf systems above 10°C (the "10-10-10" rule: 10mm rain, 10°C temp, 10 hours moisture). Powdery Mildew replicates fast in high humidity without rainfall under mild temps.
                  </p>
                </div>

                <div className="self-center shrink-0">
                  <span className={`px-4 py-1.5 font-mono text-[10px] tracking-wider uppercase font-extrabold rounded-full border shadow-3xs ${
                    diseasePressureIndex === 'high'
                      ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : diseasePressureIndex === 'medium'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-100'
                  }`}>
                    {diseasePressureIndex === 'high' ? t.risk_high : diseasePressureIndex === 'medium' ? t.risk_med : t.risk_low}
                  </span>
                </div>
              </div>

              {/* PRECISION VARIETY GDD & RIPENESS WINDOW FORECASTER */}
              <div className="bg-white border border-[#e8dfd5] p-6 rounded-3xl shadow-xs space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-stone-100 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase bg-[#4e0e15]/5 text-[#4e0e15] border border-[#4e0e15]/10 px-2 rounded font-bold">
                      {({
                        en: 'Agronomic Metric',
                        ka: 'აგრონომიული მეტრიკა',
                        it: 'Metrica Agronomica',
                        fr: 'Métrique Agronomique',
                        de: 'Agronomische Kennzahl'
                      })[lang] || 'Agronomic Metric'}
                    </span>
                    <h4 className="font-serif font-black text-sm text-stone-900 uppercase flex items-center gap-1.5 mt-1">
                      <TrendingUp className="w-4 h-4 text-[#4e0e15]" />
                      {({
                        en: 'GDD & Cultivar Ripeness Forecaster',
                        ka: 'GDD და ჯიშების სიმწიფის პროგნოზირება',
                        it: 'Previsore GDD e Maturazione dei Cultivar',
                        fr: 'Prévision des GDD & Maturité des Cépages',
                        de: 'GDD & Reifegradprognose der Sorten'
                      })[lang] || 'GDD & Cultivar Ripeness Forecaster'}
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 self-stretch md:self-auto w-full md:w-auto">
                    {/* Cultivar Selector */}
                    <div className="flex-1 md:flex-none">
                      <span className="text-[8px] font-mono uppercase text-stone-400 block mb-1 font-bold text-left md:text-right">
                        {lang === 'ka' ? 'ვაზის ჯიში' : 'Cultivar / Variety'}
                      </span>
                      <select
                        value={selectedVariety}
                        onChange={(e) => setSelectedVariety(e.target.value)}
                        className="w-full md:w-auto bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-xl text-xs font-bold text-stone-750 cursor-pointer outline-none text-right"
                      >
                        {varietyPresets.map(v => (
                          <option key={v.name} value={v.name}>{v.name} ({({ en: 'Target', ka: 'მიზანი', it: 'Target', fr: 'Cible', de: 'Ziel' })[lang] || 'Target'}: {v.requiredGdd}°C)</option>
                        ))}
                      </select>
                    </div>
                    {/* Phenology Selector */}
                    <div className="flex-1 md:flex-none">
                      <span className="text-[8px] font-mono uppercase text-stone-400 block mb-1 font-bold text-left md:text-right">
                        {lang === 'ka' ? 'ფენოლოგიური ფაზა' : 'Phenology Phase'}
                      </span>
                      <select
                        value={selectedPhenology}
                        onChange={(e) => setSelectedPhenology(e.target.value)}
                        className="w-full md:w-auto bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-xl text-xs font-bold text-stone-750 cursor-pointer outline-none text-right"
                      >
                        {phenologyPhases.map(p => (
                          <option key={p.id} value={p.id}>{p.label[currentLang] || p.label.en}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-stone-500 leading-relaxed">
                  {({
                    en: 'Growing Degree Days (GDD) tracking identifies the heat summation index required for optimal flower, berry, and phenolic maturity. High altitudes and cooler weeks extend the ripening period.',
                    ka: 'აქტიურ ტემპერატურათა ჯამის (GDD) თვალყურის დევნება განსაზღვრავს სითბოს ჯამურ მაჩვენებელს, რომელიც საჭიროა ყვავილობის, მარცვლის ზრდისა და ფენოლური სიმწიფისთვის. მაღალი სიმაღლე და გრილი კვირები ახანგრძლივებს მწიფობის პერიოდს.',
                    it: 'Il tracciamento dei Growing Degree Days (GDD) identifica l\'indice di sommatoria termica necessario per una maturazione ottimale di fiori, acini e fenoli. Altitudini elevate e settimane più fresche prolungano il periodo di maturazione.',
                    fr: 'Le suivi des degrés-jours de croissance (GDD) permet d\'identify l\'indice di somme di chaleur nécessaire à une maturité florale, levurienne et phénolique optimale. Les altitudes élevées et les semaines plus fraîches prolongent le temps de maturité.',
                    de: 'Die Erfassung der Gradtagzahl (GDD) bestimmt die erforderliche Wärmesumme für eine optimale Blüten-, Beeren- und Phenolreife. Große Höhenlagen und kühlere Wochen verlängern die Reifezeit.'
                  })[lang] || 'Growing Degree Days (GDD) tracking identifies the heat summation index required for optimal flower, berry, and phenolic maturity. High altitudes and cooler weeks extend the ripening period.'}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-stone-50/50 border border-stone-100 p-4 rounded-2xl">
                  <div className="text-center md:text-left border-b md:border-b-0 md:border-r border-[#e8dfd5]/50 pb-3 md:pb-0">
                    <span className="text-[9px] uppercase font-mono text-slate-400 block font-bold">
                      {({
                        en: 'Seasonal Heat Sum',
                        ka: 'სეზონური სითბოს ჯამი',
                        it: 'Somma Termica Stagionale',
                        fr: 'Somme de Chaleur Saisonnière',
                        de: 'Saisonale Wärmesumme'
                      })[lang] || 'Seasonal Heat Sum'}
                    </span>
                    <strong className="text-xl font-serif font-black text-stone-900 block mt-1">{finalCumulativeGdd} °C</strong>
                    <span className="text-[9.5px] text-slate-500 font-mono font-medium">
                      {({
                        en: 'Accumulated GDD (YTD)',
                        ka: 'დაგროვილი GDD (წლის დასაწყისიდან)',
                        it: 'GDD Accumulato (YTD)',
                        fr: 'GDD Accumulés (YTD)',
                        de: 'Kumulierte GDD (seit Jahresbeginn)'
                      })[lang] || 'Accumulated GDD (YTD)'}
                    </span>
                  </div>
                  <div className="text-center md:text-left border-b md:border-b-0 md:border-r border-[#e8dfd5]/50 pb-3 md:pb-0 md:px-4">
                    <span className="text-[9px] uppercase font-mono text-slate-400 block font-bold">
                      {({
                        en: 'Cultivar Requirement',
                        ka: 'ჯიშისთვის საჭირო მაჩვენებელი',
                        it: 'Requisito del Cultivar',
                        fr: 'Besoins du Cépage',
                        de: 'Anforderung der Rebsorte'
                      })[lang] || 'Cultivar Requirement'}
                    </span>
                    <strong className="text-xl font-serif font-black text-[#4e0e14] block mt-1">{activeVarietyConfig.requiredGdd} °C</strong>
                    <span className="text-[9.5px] text-[#4e0e15]/80 font-mono font-medium">{selectedVariety} {({ en: 'Target', ka: 'მიზანი', it: 'Target', fr: 'Cible', de: 'Ziel' })[lang] || 'Target'}</span>
                  </div>
                  <div className="text-center md:text-left md:pl-4">
                    <span className="text-[9px] uppercase font-mono text-slate-400 block font-bold">
                      {({
                        en: 'Est. Days to Maturity',
                        ka: 'სავარაუდო დღეები სიმწიფემდე',
                        it: 'Giorni Stimati alla Maturità',
                        fr: 'Jours Estimés avant Maturité',
                        de: 'Voraussichtliche Tage bis zur Reife'
                      })[lang] || 'Est. Days to Maturity'}
                    </span>
                    {daysToRipeness <= 0 ? (
                      <strong className="text-xl font-serif font-black text-emerald-700 block mt-1">
                        {({
                          en: 'Fully Mature ✓',
                          ka: 'სრულად მწიფეა ✓',
                          it: 'Completamente Maturo ✓',
                          fr: 'Entièrement Mûr ✓',
                          de: 'Vollreif ✓'
                        })[lang] || 'Fully Mature ✓'}
                      </strong>
                    ) : (
                      <strong className="text-xl font-serif font-black text-amber-600 block mt-1">
                        ~ {daysToRipeness} {({ en: 'Days', ka: 'დღე', it: 'Giorni', fr: 'Jours', de: 'Tage' })[lang] || 'Days'}
                      </strong>
                    )}
                    <span className="text-[9.5px] text-slate-500 font-mono font-medium">
                      {({
                        en: 'Based on forecast velocity',
                        ka: 'ამინდის პროგნოზის სიჩქარეზე დაყრდნობით',
                        it: 'In base alla velocità prevista',
                        fr: 'D\'après la vitesse des prévisions',
                        de: 'Basierend auf der Prognosegeschwindigkeit'
                      })[lang] || 'Based on forecast velocity'}
                    </span>
                  </div>
                </div>

                {/* GDD Progress Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[10px] font-mono font-bold text-stone-605">
                    <span>
                      {({
                        en: 'Maturity Curve Progress',
                        ka: 'სიმწიფის მრუდის პროგრესი',
                        it: 'Progresso della Curva di Maturazione',
                        fr: 'Progression de la Courbe de Maturité',
                        de: 'Fortschritt der Reifekurve'
                      })[lang] || 'Maturity Curve Progress'}
                    </span>
                    <span>{Math.min(100, Math.round((finalCumulativeGdd / activeVarietyConfig.requiredGdd) * 100))}% {({ en: 'reached', ka: 'მიღწეულია', it: 'raggiunto', fr: 'atteint', de: 'erreicht' })[lang] || 'reached'}</span>
                  </div>
                  <div className="w-full h-3 bg-stone-100/60 rounded-full overflow-hidden border border-stone-200/50 shadow-inner">
                    <div
                      className={`h-full transition-all duration-500 rounded-full relative overflow-hidden bg-gradient-to-r ${
                        finalCumulativeGdd >= activeVarietyConfig.requiredGdd
                          ? 'from-emerald-500 to-emerald-700'
                          : 'from-amber-450 via-emerald-500 to-emerald-650'
                      }`}
                      style={{ width: `${Math.min(100, (finalCumulativeGdd / activeVarietyConfig.requiredGdd) * 100)}%` }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent animate-pulse" style={{ animationDuration: '2.5s' }} />
                    </div>
                  </div>

                  {/* Manual Phenology Phase Label */}
                  <div className="flex items-center gap-1.5 pt-1 text-[10px] text-stone-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-semibold text-stone-700">
                      {(lang === 'ka' ? 'მიმდინარე ფენოლოგიური ფაზა: ' : 'Current Phenological Phase: ')}
                      <strong className="text-stone-850 font-extrabold">{activePhenologyConfig.label[currentLang] || activePhenologyConfig.label.en}</strong>
                    </span>
                    <span className="font-mono text-[9px] text-[#4e0e15] ml-auto">
                      ({activePhenologyConfig.detail[currentLang] || activePhenologyConfig.detail.en})
                    </span>
                  </div>
                </div>
              </div>

              {/* REAL-TIME MICROCLIMATE ANALYTICS & PATHO-RISK MONITOR */}
              <div className="bg-white border border-[#e8dfd5] p-6 rounded-3xl shadow-xs space-y-4">
                <div>
                  <span className="text-[10px] font-mono uppercase bg-emerald-50 text-emerald-800 border border-emerald-200/50 px-2 py-0.5 rounded font-bold">
                    {lang === 'ka' ? 'ავტომატური ანალიტიკა' : 'Automated Telemetry Analysis'}
                  </span>
                  <h4 className="font-serif font-black text-sm text-stone-900 uppercase flex items-center gap-1.5 mt-1.5">
                    <Layers className="w-4 h-4 text-emerald-805" />
                    {lang === 'ka' ? 'მიკროკლიმატური დაავადებების ანალიზატორი' : 'Microclimatic Disease Pathogen Risk Advisor'}
                  </h4>
                </div>

                <p className="text-xs text-stone-600 leading-relaxed">
                  {lang === 'ka'
                    ? `მიმდინარე ინფექციის კერების და რისკების ანალიზი წარმოებს რეალურ დროში, ${activeBlock?.name || 'Vinea'} ნაკვეთის კოორდინატებზე დაფუძნებული ციფრული მეტეოროლოგიური ტელემეტრიის საფუძველზე. სისტემა აფასებს Plasmopara (ჭრაქი), Oidium (ნაცარი) და Botrytis (ლპობა) გამრავლებას გარემო ფაქტორების მიხედვით.`
                    : `Infection risks and physiological pathogen pressures are assessed live, based on precise GPS grid meteorological telemetry for the ${activeBlock?.name || 'Vinea'} block. The bio-pathological model continuously recalculates Plasmopara viticola, Uncinula necator, and Botrytis cinerea outbreak potential from active humidity, canopy leaf wetness indicators, and temperature gradients.`}
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  <div className="p-3 bg-stone-50 border border-stone-250/50 rounded-xl">
                    <span className="text-[9px] font-mono uppercase text-stone-500 block font-bold">Plasmopara Rule</span>
                    <p className="text-[10.5px] mt-1 text-stone-700">
                      {lang === 'ka' ? 'აქტიურდება ≥10°C და >10მმ ნალექის დროს' : 'Triggered at ≥10°C & accumulated rainfall/wetness'}
                    </p>
                  </div>
                  <div className="p-3 bg-stone-50 border border-stone-250/50 rounded-xl">
                    <span className="text-[9px] font-mono uppercase text-stone-500 block font-bold">Oidium Window</span>
                    <p className="text-[10.5px] mt-1 text-stone-700">
                      {lang === 'ka' ? 'ოპტიმალურია 15-27°C და მაღალი ტენიანობისას' : 'Optimal between 15°C and 27°C with high ambient humidity'}
                    </p>
                  </div>
                  <div className="p-3 bg-stone-50 border border-stone-250/50 rounded-xl">
                    <span className="text-[9px] font-mono uppercase text-stone-500 block font-bold">Botrytis Envelope</span>
                    <p className="text-[10.5px] mt-1 text-stone-700">
                      {lang === 'ka' ? 'აქტიურდება ხანგრძლივი ფოთლის სისველისას' : 'Accelerates with extended canopy dampness & ripening stage'}
                    </p>
                  </div>
                </div>

                {/* RISK GAUGES */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">

                  {/* Downy Mildew Risk Gauge */}
                  <div className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.02] ${
                    infectionMetrics.downyRisk > 60
                      ? 'bg-gradient-to-br from-rose-50/60 to-rose-50/10 border-rose-200 text-rose-950 font-semibold shadow-[0_4px_15px_rgba(239,68,68,0.03)]'
                      : infectionMetrics.downyRisk > 30
                      ? 'bg-gradient-to-br from-amber-50/60 to-amber-50/10 border-amber-200 text-amber-950 shadow-[0_4px_15px_rgba(245,158,11,0.03)]'
                      : 'bg-gradient-to-br from-emerald-50/60 to-emerald-50/10 border-emerald-100 text-emerald-950 shadow-[0_4px_15px_rgba(16,185,129,0.03)]'
                  }`}>
                    <span className="text-[9px] font-mono uppercase text-stone-550 block font-bold">Downy Mildew</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-xl font-serif font-black">{infectionMetrics.downyRisk}%</strong>
                      <span className="text-[9px] font-bold font-mono">
                        {infectionMetrics.downyRisk > 60 ? 'Severe' : infectionMetrics.downyRisk > 30 ? 'Moderate' : 'Safe'}
                      </span>
                    </div>
                    <div className="w-full bg-stone-200/50 h-2 rounded-full overflow-hidden mt-2 border border-stone-300/20 shadow-inner">
                      <div className={`h-full rounded-full transition-all duration-300 bg-gradient-to-r ${infectionMetrics.downyRisk > 60 ? 'from-rose-500 to-red-600' : infectionMetrics.downyRisk > 30 ? 'from-amber-450 to-orange-500' : 'from-emerald-400 to-teal-500'}`} style={{ width: `${infectionMetrics.downyRisk}%` }} />
                    </div>
                  </div>

                  {/* Powdery Mildew Risk Gauge */}
                  <div className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.02] ${
                    infectionMetrics.powderyRisk > 60
                      ? 'bg-gradient-to-br from-rose-50/60 to-rose-50/10 border-rose-200 text-rose-950 font-semibold shadow-[0_4px_15px_rgba(239,68,68,0.03)]'
                      : infectionMetrics.powderyRisk > 30
                      ? 'bg-gradient-to-br from-amber-50/60 to-amber-50/10 border-amber-200 text-amber-950 shadow-[0_4px_15px_rgba(245,158,11,0.03)]'
                      : 'bg-gradient-to-br from-emerald-50/60 to-emerald-50/10 border-emerald-100 text-emerald-950 shadow-[0_4px_15px_rgba(16,185,129,0.03)]'
                  }`}>
                    <span className="text-[9px] font-mono uppercase text-stone-550 block font-bold">Powdery Mildew</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-xl font-serif font-black">{infectionMetrics.powderyRisk}%</strong>
                      <span className="text-[9px] font-bold font-mono">
                        {infectionMetrics.powderyRisk > 60 ? 'Severe' : infectionMetrics.powderyRisk > 30 ? 'Moderate' : 'Safe'}
                      </span>
                    </div>
                    <div className="w-full bg-stone-200/50 h-2 rounded-full overflow-hidden mt-2 border border-stone-300/20 shadow-inner">
                      <div className={`h-full rounded-full transition-all duration-300 bg-gradient-to-r ${infectionMetrics.powderyRisk > 60 ? 'from-rose-500 to-red-600' : infectionMetrics.powderyRisk > 30 ? 'from-amber-450 to-orange-500' : 'from-emerald-400 to-teal-500'}`} style={{ width: `${infectionMetrics.powderyRisk}%` }} />
                    </div>
                  </div>

                  {/* Botrytis bunch rot */}
                  <div className={`p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.02] ${
                    infectionMetrics.botrytisRisk > 60
                      ? 'bg-gradient-to-br from-rose-50/60 to-rose-50/10 border-rose-200 text-rose-950 font-semibold shadow-[0_4px_15px_rgba(239,68,68,0.03)]'
                      : infectionMetrics.botrytisRisk > 30
                      ? 'bg-gradient-to-br from-amber-50/60 to-amber-50/10 border-amber-200 text-amber-950 shadow-[0_4px_15px_rgba(245,158,11,0.03)]'
                      : 'bg-gradient-to-br from-emerald-50/60 to-emerald-50/10 border-emerald-100 text-emerald-950 shadow-[0_4px_15px_rgba(16,185,129,0.03)]'
                  }`}>
                    <span className="text-[9px] font-mono uppercase text-stone-550 block font-bold">Botrytis Rot</span>
                    <div className="flex items-baseline justify-between mt-1">
                      <strong className="text-xl font-serif font-black">{infectionMetrics.botrytisRisk}%</strong>
                      <span className="text-[9px] font-bold font-mono">
                        {infectionMetrics.botrytisRisk > 60 ? 'Severe' : infectionMetrics.botrytisRisk > 30 ? 'Moderate' : 'Safe'}
                      </span>
                    </div>
                    <div className="w-full bg-stone-200/50 h-2 rounded-full overflow-hidden mt-2 border border-stone-300/20 shadow-inner">
                      <div className={`h-full rounded-full transition-all duration-300 bg-gradient-to-r ${infectionMetrics.botrytisRisk > 60 ? 'from-rose-500 to-red-600' : infectionMetrics.botrytisRisk > 30 ? 'from-amber-450 to-orange-500' : 'from-emerald-400 to-teal-500'}`} style={{ width: `${infectionMetrics.botrytisRisk}%` }} />
                    </div>
                  </div>

                </div>
              </div>

              {weatherData && (
                <div className="bg-white border border-[#e8dfd5] p-5 rounded-3xl shadow-3xs space-y-3">
                  <div className="flex justify-between items-center border-b border-stone-150 pb-2">
                    <span className="text-[10px] font-mono font-bold uppercase text-stone-550 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block animate-pulse" />
                      {lang === 'ka' ? '5-დღიანი პათოგენური რისკის პროგნოზი' : '5-Day Disease Pressure Outlook'}
                    </span>
                    <span className="text-[9px] font-mono text-slate-400 font-bold uppercase">{lang === 'ka' ? 'ბიოკინეტიკური მოდელირება' : 'Bio-Kinetically Calibrated'}</span>
                  </div>

                  <div className="grid grid-cols-5 gap-2 text-center">
                    {forecastPathogenRisks.map((risk, idx) => {
                      const maxRisk = Math.max(risk.downy, risk.powdery);
                      const isSelected = selectedForecastIdx === idx;
                      const riskColor = maxRisk > 60
                        ? (isSelected ? 'text-rose-900 bg-rose-100 border-rose-350 ring-2 ring-rose-400' : 'text-rose-700 bg-rose-50/50 border-rose-200')
                        : maxRisk > 30
                        ? (isSelected ? 'text-amber-900 bg-amber-100 border-amber-350 ring-2 ring-amber-450' : 'text-amber-700 bg-amber-50/50 border-amber-200')
                        : (isSelected ? 'text-emerald-950 bg-emerald-100 border-emerald-300 ring-2 ring-emerald-450' : 'text-emerald-800 bg-emerald-50/50 border-emerald-100');
                      return (
                        <div
                          key={idx}
                          onClick={() => setSelectedForecastIdx(idx)}
                          onMouseEnter={() => setSelectedForecastIdx(idx)}
                          className={`p-2.5 rounded-xl border flex flex-col justify-between space-y-1.5 transition-all duration-200 cursor-pointer hover:scale-103 ${riskColor}`}
                        >
                          <span className="text-[9.5px] font-mono font-extrabold">{risk.date}</span>
                          <div className="space-y-0.5 font-mono text-[9px]">
                            <div className="flex justify-between items-center gap-1">
                              <span className="text-[8px] text-stone-400 font-normal">Downy:</span>
                              <strong className="font-extrabold">{risk.downy}%</strong>
                            </div>
                            <div className="flex justify-between items-center gap-1">
                              <span className="text-[8px] text-stone-400 font-normal">Powdery:</span>
                              <strong className="font-extrabold">{risk.powdery}%</strong>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {forecastPathogenRisks[selectedForecastIdx] && (
                    <div className="mt-3 p-4 rounded-2xl bg-stone-50 border border-stone-150 space-y-3 transition-all duration-300">
                      <div className="flex justify-between items-center border-b border-stone-250 pb-2">
                        <span className="text-[10px] font-mono font-extrabold text-stone-600 uppercase flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-stone-500" />
                          {lang === 'ka' ? 'რეკომენდაციები: ' : 'Directives for '} {forecastPathogenRisks[selectedForecastIdx].date}
                        </span>
                        <div className="flex gap-2">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold">
                            {lang === 'ka' ? 'ბიო/ორგანული' : 'Organic'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-mono bg-purple-100 text-purple-800 border border-purple-200 font-semibold">
                            {lang === 'ka' ? 'ქიმიური/სისტემური' : 'Chemical'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Downy Mildew Directives */}
                        <div className="p-3 bg-white rounded-xl border border-stone-200/60 space-y-2">
                          <div className="flex items-center gap-1.5 border-b border-stone-100 pb-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${forecastPathogenRisks[selectedForecastIdx].downy > 60 ? 'bg-rose-500 animate-pulse' : forecastPathogenRisks[selectedForecastIdx].downy > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                            <strong className="text-xs font-serif font-black text-stone-850">
                              {lang === 'ka' ? 'ჭრაქი (Downy Mildew)' : 'Downy Mildew'} ({forecastPathogenRisks[selectedForecastIdx].downy}%)
                            </strong>
                          </div>
                          <p className="text-[11px] text-stone-600 leading-relaxed font-semibold">
                            {getDownyDirective(forecastPathogenRisks[selectedForecastIdx].downy, lang)}
                          </p>
                        </div>

                        {/* Powdery Mildew Directives */}
                        <div className="p-3 bg-white rounded-xl border border-stone-200/60 space-y-2">
                          <div className="flex items-center gap-1.5 border-b border-stone-100 pb-1.5">
                            <span className={`w-2.5 h-2.5 rounded-full ${forecastPathogenRisks[selectedForecastIdx].powdery > 60 ? 'bg-rose-500 animate-pulse' : forecastPathogenRisks[selectedForecastIdx].powdery > 30 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                            <strong className="text-xs font-serif font-black text-stone-850">
                              {lang === 'ka' ? 'ნაცარი (Powdery Mildew)' : 'Powdery Mildew'} ({forecastPathogenRisks[selectedForecastIdx].powdery}%)
                            </strong>
                          </div>
                          <p className="text-[11px] text-stone-600 leading-relaxed font-semibold">
                            {getPowderyDirective(forecastPathogenRisks[selectedForecastIdx].powdery, lang)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CONVERGED GEMINI AI AGRO-CLIMATIC INTELLIGENCE PANEL */}
              <div className="bg-gradient-to-br from-[#1c080b] to-[#0c0304] border border-[#4e0e15]/30 p-6 rounded-3xl shadow-xl space-y-4 relative overflow-hidden">
                <div className="absolute -right-16 -top-16 w-36 h-36 bg-[#801323]/10 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -left-16 -bottom-16 w-36 h-36 bg-[#c2185b]/5 rounded-full blur-3xl pointer-events-none" />

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#4e0e15]/20 pb-3 relative z-10">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 bg-[#4e0e15] border border-[#801323]/35 text-white rounded-xl shadow-md">
                      <Bot className="w-4 h-4 text-amber-400 animate-pulse" />
                    </div>
                    <div>
                      <h4 className="font-serif font-black text-xs text-white uppercase tracking-wide">AI Agronomy & Canopy Intelligent Advisor</h4>
                      <p className="text-[10px] text-[#cca5a9] mt-0.5">Gemini-Powered Viticultural Risks & Ripeness Predictions</p>
                    </div>
                  </div>
                  <button
                    onClick={handleGetAiReport}
                    disabled={aiLoading}
                    className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-amber-600 to-[#801323] hover:from-amber-500 hover:to-[#a01a2d] active:scale-95 text-white rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition-all shadow-md duration-200 border border-amber-500/20"
                  >
                    {aiLoading ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
                        Analyze Patterns with AI
                      </>
                    )}
                  </button>
                </div>

                {aiAdvice ? (
                  <div className="bg-black/35 border border-[#4e0e15]/15 p-5 rounded-2xl text-[11px] text-stone-200 leading-relaxed max-h-[350px] overflow-y-auto shadow-inner prose prose-invert max-w-none scrollbar-thin scrollbar-thumb-stone-800">
                    <ReactMarkdown>{aiAdvice}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="p-12 text-center text-[#cca5a9] flex flex-col items-center gap-2.5 relative z-10">
                    <div className="w-12 h-12 rounded-full bg-[#4e0e15]/30 border border-[#801323]/20 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-amber-300/40" />
                    </div>
                    <p className="text-xs font-bold leading-relaxed max-w-md text-[#d7b2b6] font-sans">
                      Click the analysis button to transmit cumulative seasonal GDD numbers, local elevations, variety profile attributes, and current infection potentials directly to the AI Core.
                    </p>
                  </div>
                )}
              </div>

            </div>

            {/* 2. HOURLY FORECAST AREA CHART */}
            <div className="lg:col-span-3 bg-white border border-[#e8dfd5] p-6 rounded-3xl shadow-sm space-y-4">
              <div>
                <h3 className="font-serif font-black text-sm text-stone-850 uppercase">{t.hourly_forecast}</h3>
                <p className="text-[10px] text-stone-400 mt-0.5">24-hour temperature swing profiles, wind gust patterns, and precipitation levels.</p>
              </div>

              <div className="h-48 w-full font-mono text-[10px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weatherData.hourly} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <defs>
                      <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4e0e15" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#4e0e15" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="popGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0284c7" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#0284c7" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3ebe3" />
                    <XAxis dataKey="time" stroke="#a8a29e" fontSize={9} />
                    <YAxis yAxisId="left" stroke="#854d0e" label={{ value: '°C', angle: -90, position: 'insideLeft', offset: 10 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#0369a1" label={{ value: 'Pop %', angle: 90, position: 'insideRight', offset: 10 }} />
                    <Tooltip contentStyle={{ background: '#FAF8F5', border: '1px solid #e8dfd5', borderRadius: '12px' }} />
                    <Area yAxisId="left" type="monotone" dataKey="temp" stroke="#4e0e15" strokeWidth={2} fillOpacity={1} fill="url(#tempGrad)" name={t.temp} />
                    <Area yAxisId="right" type="monotone" dataKey="pop" stroke="#0284c7" strokeWidth={1.5} fillOpacity={1} fill="url(#popGrad)" name={t.precip_prob} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 3. 5-DAY AGRO-METEOROLOGICAL OUTLOOK */}
            <div className="lg:col-span-3 bg-stone-50 border border-[#e8dfd5] p-6 rounded-3xl shadow-inner space-y-4">
              <div>
                <h3 className="font-serif font-black text-sm text-stone-900 uppercase">{t.daily_forecast}</h3>
                <p className="text-[10px] text-stone-400 mt-0.5">Macro-meteorological indices to structure spraying campaigns and harvest picker logistics.</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {weatherData.daily.map((day, i) => {
                  const dayDeco = weatherIconAndText(day.weatherCode);
                  return (
                    <div key={i} className="bg-gradient-to-b from-white to-stone-50/40 border border-[#e8dfd5]/60 rounded-2xl p-4 text-center flex flex-col justify-between space-y-2 hover:shadow-md hover:scale-[1.03] transition-all duration-300 relative overflow-hidden group">
                      <div className="absolute top-0 left-0 right-0 h-[3px] bg-stone-100 group-hover:bg-[#801323] transition-all duration-300" />
                      <span className="text-[10px] font-mono text-slate-400 font-bold block">{day.date}</span>

                      <div className="mx-auto py-1 transition-transform duration-300 group-hover:scale-110">
                        {dayDeco.icon}
                      </div>

                      <div className="space-y-0.5 text-xs">
                        <div className="flex justify-center gap-2 font-serif">
                          <strong className="text-stone-900 font-black text-sm tracking-tight">{day.tempMax}°C</strong>
                          <span className="text-stone-400">{day.tempMin}°C</span>
                        </div>
                        <span className="text-[9.5px] font-sans font-semibold text-stone-550 block leading-tight">{dayDeco.text}</span>
                      </div>

                      <div className="border-t border-stone-100 pt-2.5 grid grid-cols-2 text-[9px] font-mono text-stone-500 font-bold mt-1">
                        <div className="border-r border-stone-100 pr-1">
                          <span className="block text-[8px] uppercase tracking-wide font-normal text-stone-400">Rain</span>
                          <span className="text-sky-600 block font-serif font-black">{day.popMax}%</span>
                        </div>
                        <div className="pl-1">
                          <span className="block text-[8px] uppercase tracking-wide font-normal text-stone-400">Wind</span>
                          <span className="text-emerald-700 block font-serif font-black">{day.windMax} km/h</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 4. HISTORICAL VINTAGE WEATHER COMPARISON (COPERNICUS ECMWF INTEGRATION) */}
            <div className="lg:col-span-3 bg-white border border-[#e8dfd5] p-6 rounded-3xl shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#e8dfd5]/60 pb-3">
                <div>
                  <h3 className="font-serif font-black text-sm text-stone-850 uppercase flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-[#801323]" />
                    {lang === 'ka' ? 'ისტორიული ვინტაჟური კლიმატის შედარება' : 'Historical Vintage Weather Peer Comparison'}
                  </h3>
                  <p className="text-[10px] text-stone-400 mt-0.5">
                    Multi-year comparative satellite telemetry sourced from Copernicus ECMWF Era5 reanalysis datasets.
                  </p>
                </div>

                {/* Switchers (View Mode & Metric) */}
                <div className="flex flex-wrap items-center gap-3 self-stretch sm:self-auto">
                  {/* View Mode Toggle */}
                  <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                    <button
                      type="button"
                      onClick={() => setHistViewMode('ytd')}
                      className={`px-2.5 py-1 text-[9px] font-sans font-bold rounded-md transition-all cursor-pointer ${
                        histViewMode === 'ytd'
                          ? 'bg-white text-stone-800 shadow-2xs font-extrabold'
                          : 'text-stone-500 hover:text-stone-850'
                      }`}
                    >
                      {lang === 'ka' ? 'ჯამური (YTD)' : 'YTD Sum'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistViewMode('monthly')}
                      className={`px-2.5 py-1 text-[9px] font-sans font-bold rounded-md transition-all cursor-pointer ${
                        histViewMode === 'monthly'
                          ? 'bg-white text-stone-800 shadow-2xs font-extrabold'
                          : 'text-stone-500 hover:text-stone-855'
                      }`}
                    >
                      {lang === 'ka' ? 'ყოველთვიური' : 'Monthly'}
                    </button>
                  </div>

                  {/* Metric Switcher */}
                  <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                    <button
                      type="button"
                      onClick={() => setHistMetric('gdd')}
                      className={`px-2 py-1 text-[9px] font-mono font-bold rounded-md transition-all cursor-pointer ${histMetric === 'gdd' ? 'bg-[#4e0e15] text-white shadow-2xs' : 'bg-transparent text-stone-500 hover:text-stone-800'}`}
                    >
                      GDD
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistMetric('rain')}
                      className={`px-2 py-1 text-[9px] font-mono font-bold rounded-md transition-all cursor-pointer ${histMetric === 'rain' ? 'bg-[#4e0e15] text-white shadow-2xs' : 'bg-transparent text-stone-500 hover:text-stone-800'}`}
                    >
                      Rain
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistMetric('temp')}
                      className={`px-2 py-1 text-[9px] font-mono font-bold rounded-md transition-all cursor-pointer ${histMetric === 'temp' ? 'bg-[#4e0e15] text-white shadow-2xs' : 'bg-transparent text-stone-500 hover:text-stone-800'}`}
                    >
                      Temp
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
                {/* Visual Chart */}
                <div className="lg:col-span-2 h-56 w-full font-mono text-[9px] pt-2">
                  {histLoading ? (
                    <div className="h-full w-full flex flex-col items-center justify-center bg-stone-50 border border-stone-100 rounded-2xl p-4 animate-pulse">
                      <RotateCw className="w-6 h-6 text-[#801323] animate-spin" />
                      <span className="text-[10px] text-stone-500 font-mono font-bold mt-2">
                        {lang === 'ka' ? 'მიმდინარეობს სატელიტური არქივის სინქრონიზაცია...' : 'Syncing satellite weather archive...'}
                      </span>
                    </div>
                  ) : histError ? (
                    <div className="h-full w-full flex flex-col items-center justify-center bg-amber-50/50 border border-amber-100 rounded-2xl p-4">
                      <AlertTriangle className="w-6 h-6 text-amber-600" />
                      <span className="text-[9.5px] text-amber-900 font-bold mt-2 text-center">
                        {lang === 'ka' ? 'კავშირი ვერ დამყარდა. ნაჩვენებია სარეზერვო ტელემეტრია.' : 'Connection failed. Showing backup calibrated telemetry.'}
                      </span>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      {histViewMode === 'ytd' ? (
                        <BarChart data={finalCompareData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3ebe3" />
                          <XAxis dataKey="year" stroke="#a8a29e" fontSize={10} />
                          <YAxis stroke="#888" fontSize={9} />
                          <Tooltip contentStyle={{ background: '#FAF8F5', border: '1px solid #e8dfd5', borderRadius: '12px', fontSize: '10px' }} />
                          <Bar dataKey={histMetric} name={activeMetricLabel?.title || 'Value'} radius={[6, 6, 0, 0]}>
                            {finalCompareData.map((entry: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      ) : (
                        <BarChart data={finalMonthlyData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3ebe3" />
                          <XAxis dataKey="month" stroke="#a8a29e" fontSize={10} />
                          <YAxis stroke="#888" fontSize={9} />
                          <Tooltip contentStyle={{ background: '#FAF8F5', border: '1px solid #e8dfd5', borderRadius: '12px', fontSize: '10px' }} />
                          <Legend wrapperStyle={{ fontSize: '10px', marginTop: '10px' }} />
                          <Bar dataKey={`2024_${histMetric}`} name="2024" fill="#d97706" radius={[4, 4, 0, 0]} />
                          <Bar dataKey={`2025_${histMetric}`} name="2025" fill="#059669" radius={[4, 4, 0, 0]} />
                          <Bar dataKey={`2026_${histMetric}`} name="2026" fill="#4e0e15" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Explanatory notes & satellite verification */}
                <div className="bg-stone-50/70 border border-[#e8dfd5] p-4.5 rounded-2xl space-y-3 shrink-0">
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider font-extrabold font-mono text-stone-450 block">Current Comparison Scope</span>
                    <h4 className="font-serif font-black text-xs text-stone-900 leading-tight">{activeMetricLabel?.title}</h4>
                    <p className="text-[10px] text-stone-500 leading-normal">{activeMetricLabel?.desc}</p>
                  </div>

                  <div className="border-t border-stone-200/50 pt-3 space-y-1.5 text-[9.5px]">
                    <div className="flex justify-between items-center text-stone-600">
                      <span>Weather Provider:</span>
                      <span className="font-mono font-bold text-stone-800 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        Open-Meteo
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-stone-600">
                      <span>Coordinates Link:</span>
                      <span className="font-mono text-stone-850 font-bold">
                        {activeBlock?.latitude.toFixed(4)}°N, {activeBlock?.longitude.toFixed(4)}°E
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-stone-600">
                      <span>Model Note:</span>
                      <span className="font-mono text-stone-700 font-bold">Forecast grid, not an in-field sensor</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
      )}

      {/* 5. WEATHER EXPLORER — real data for any date & location (Open-Meteo) */}
      <WeatherExplorer lang={lang} blocks={blocks} />
    </div>
  );
}
