import type { WineClass } from './wineryState';

export interface GeorgianWineRegion {
  id: string;
  name: string;
  nameKa?: string;
  aliases: string[];
  macroRegion: 'East Georgia' | 'West Georgia' | 'South Georgia';
  mainMicrozones: string[];
  commonVarieties: string[];
}

export interface GeorgianGrapeVariety {
  id: string;
  name: string;
  nameKa?: string;
  aliases: string[];
  color: 'red' | 'white' | 'pink';
  primaryRegions: string[];
  recommendedWineClasses: WineClass[];
  notes: string;
}

export const GEORGIAN_WINE_REGIONS: GeorgianWineRegion[] = [
  {
    id: 'kakheti',
    name: 'Kakheti',
    nameKa: 'კახეთი',
    aliases: ['kacheti', 'kakheti region', 'telavi', 'gurjaani', 'kvareli', 'sighnaghi', 'sagarejo', 'akhmeta'],
    macroRegion: 'East Georgia',
    mainMicrozones: ['Tsinandali', 'Mukuzani', 'Kindzmarauli', 'Kvareli', 'Napareuli', 'Akhasheni', 'Manavi', 'Vazisubani', 'Gurjaani', 'Kardenakhi', 'Kisi Magraani'],
    commonVarieties: ['Saperavi', 'Rkatsiteli', 'Kakhuri Mtsvane', 'Kisi', 'Khikhvi', 'Mtsvivani Kakhuri']
  },
  {
    id: 'kartli',
    name: 'Kartli',
    nameKa: 'ქართლი',
    aliases: ['shida kartli', 'kvemo kartli', 'mtskheta', 'gori', 'bolnisi'],
    macroRegion: 'East Georgia',
    mainMicrozones: ['Ateni', 'Bolnisi', 'Mukhrani'],
    commonVarieties: ['Chinuri', 'Goruli Mtsvane', 'Tavkveri', 'Shavkapito', 'Budiauri']
  },
  {
    id: 'imereti',
    name: 'Imereti',
    nameKa: 'იმერეთი',
    aliases: ['imeretia', 'zestafoni', 'terjola', 'baghdati', 'vani'],
    macroRegion: 'West Georgia',
    mainMicrozones: ['Sviri', 'Obcha', 'Kvaliti'],
    commonVarieties: ['Tsolikouri', 'Tsitska', 'Krakhuna', 'Otskhanuri Sapere', 'Dzelshavi']
  },
  {
    id: 'racha',
    name: 'Racha',
    nameKa: 'რაჭა',
    aliases: ['racha-lechkhumi', 'ambrolauri', 'oni'],
    macroRegion: 'West Georgia',
    mainMicrozones: ['Khvanchkara'],
    commonVarieties: ['Aleksandrouli', 'Mujuretuli', 'Rachuli Tetra']
  },
  {
    id: 'lechkhumi',
    name: 'Lechkhumi',
    nameKa: 'ლეჩხუმი',
    aliases: ['tsageri', 'racha lechkhumi'],
    macroRegion: 'West Georgia',
    mainMicrozones: ['Tvishi', 'Usakhelouri'],
    commonVarieties: ['Tsolikouri', 'Usakhelouri', 'Orbeluri Ojaleshi']
  },
  {
    id: 'samegrelo',
    name: 'Samegrelo',
    nameKa: 'სამეგრელო',
    aliases: ['megrelia', 'zugdidi', 'martvili', 'senaki'],
    macroRegion: 'West Georgia',
    mainMicrozones: ['Salkhino', 'Martvili'],
    commonVarieties: ['Ojaleshi', 'Chvitiluri', 'Chechipeshi']
  },
  {
    id: 'guria',
    name: 'Guria',
    nameKa: 'გურია',
    aliases: ['ozurgeti', 'chokhatauri', 'lanchkhuti'],
    macroRegion: 'West Georgia',
    mainMicrozones: ['Sakvavistke', 'Bakhvi'],
    commonVarieties: ['Chkhaveri', 'Jani', 'Skhilatubani']
  },
  {
    id: 'adjara',
    name: 'Adjara',
    nameKa: 'აჭარა',
    aliases: ['ajara', 'batumi', 'keda', 'shuakhevi', 'khulo'],
    macroRegion: 'West Georgia',
    mainMicrozones: ['Keda', 'Acharistskali'],
    commonVarieties: ['Chkhaveri', 'Tsolikouri', 'Satsuri']
  },
  {
    id: 'meskheti',
    name: 'Meskheti',
    nameKa: 'მესხეთი',
    aliases: ['samtskhe-javakheti', 'akhaltsikhe', 'aspindza'],
    macroRegion: 'South Georgia',
    mainMicrozones: ['Aspindza', 'Atskuri'],
    commonVarieties: ['Meskhuri Mtsvane', 'Tamaris Vazi', 'Akhaltsikhuri Tetri']
  }
];

export const GEORGIAN_GRAPE_VARIETIES: GeorgianGrapeVariety[] = [
  {
    id: 'saperavi',
    name: 'Saperavi',
    nameKa: 'საფერავი',
    aliases: ['saperavi budeshuri', 'budeshuri saperavi'],
    color: 'red',
    primaryRegions: ['Kakheti', 'Kartli'],
    recommendedWineClasses: ['red'],
    notes: 'Deep-colored teinturier grape used for dry and naturally semi-sweet reds.'
  },
  {
    id: 'rkatsiteli',
    name: 'Rkatsiteli',
    nameKa: 'რქაწითელი',
    aliases: ['rkaciteli', 'rkatseteli'],
    color: 'white',
    primaryRegions: ['Kakheti', 'Kartli'],
    recommendedWineClasses: ['white', 'amber'],
    notes: 'High-acid white variety widely used for both European-style and qvevri amber wines.'
  },
  {
    id: 'kakhuri_mtsvane',
    name: 'Kakhuri Mtsvane',
    nameKa: 'კახური მწვანე',
    aliases: ['mtsvane', 'mstvane', 'green kakhetian', 'mtsvane kakhuri'],
    color: 'white',
    primaryRegions: ['Kakheti'],
    recommendedWineClasses: ['white', 'amber'],
    notes: 'Aromatic Kakhetian white variety, often blended with Rkatsiteli.'
  },
  {
    id: 'kisi',
    name: 'Kisi',
    nameKa: 'ქისი',
    aliases: ['qisi'],
    color: 'white',
    primaryRegions: ['Kakheti'],
    recommendedWineClasses: ['white', 'amber'],
    notes: 'Textural Kakhetian variety used for aromatic dry and qvevri wines.'
  },
  {
    id: 'khikhvi',
    name: 'Khikhvi',
    nameKa: 'ხიხვი',
    aliases: ['hikhvi'],
    color: 'white',
    primaryRegions: ['Kakheti'],
    recommendedWineClasses: ['white', 'amber'],
    notes: 'Low-yielding aromatic white variety with qvevri potential.'
  },
  {
    id: 'tsolikouri',
    name: 'Tsolikouri',
    nameKa: 'ცოლიკოური',
    aliases: ['csolikouri'],
    color: 'white',
    primaryRegions: ['Imereti', 'Lechkhumi', 'Adjara'],
    recommendedWineClasses: ['white'],
    notes: 'Fresh western Georgian white variety, including Tvishi PDO styles.'
  },
  {
    id: 'tsitska',
    name: 'Tsitska',
    nameKa: 'ციცქა',
    aliases: ['citska'],
    color: 'white',
    primaryRegions: ['Imereti'],
    recommendedWineClasses: ['white', 'sparkling'],
    notes: 'Imeretian high-acid white variety suited to dry and sparkling base wines.'
  },
  {
    id: 'krakhuna',
    name: 'Krakhuna',
    nameKa: 'კრახუნა',
    aliases: ['krahuna'],
    color: 'white',
    primaryRegions: ['Imereti'],
    recommendedWineClasses: ['white', 'amber'],
    notes: 'Fuller-bodied Imeretian white variety.'
  },
  {
    id: 'chinuri',
    name: 'Chinuri',
    nameKa: 'ჩინური',
    aliases: ['chinebuli'],
    color: 'white',
    primaryRegions: ['Kartli'],
    recommendedWineClasses: ['white', 'sparkling'],
    notes: 'Kartli white variety valued for acidity and sparkling base wines.'
  },
  {
    id: 'goruli_mtsvane',
    name: 'Goruli Mtsvane',
    nameKa: 'გორული მწვანე',
    aliases: ['gori mtsvane'],
    color: 'white',
    primaryRegions: ['Kartli'],
    recommendedWineClasses: ['white', 'sparkling'],
    notes: 'Kartli white variety often blended with Chinuri.'
  },
  {
    id: 'tavkveri',
    name: 'Tavkveri',
    nameKa: 'თავკვერი',
    aliases: ['tavkver'],
    color: 'red',
    primaryRegions: ['Kartli'],
    recommendedWineClasses: ['red', 'rose'],
    notes: 'Light red Kartli variety also used for rose.'
  },
  {
    id: 'aleksandrouli',
    name: 'Aleksandrouli',
    nameKa: 'ალექსანდროული',
    aliases: ['alexandrouli'],
    color: 'red',
    primaryRegions: ['Racha'],
    recommendedWineClasses: ['red'],
    notes: 'Racha red variety used with Mujuretuli for Khvanchkara.'
  },
  {
    id: 'mujuretuli',
    name: 'Mujuretuli',
    nameKa: 'მუჯურეთული',
    aliases: ['mudzhuretuli'],
    color: 'red',
    primaryRegions: ['Racha'],
    recommendedWineClasses: ['red'],
    notes: 'Racha red blending partner for Aleksandrouli.'
  },
  {
    id: 'ojaleshi',
    name: 'Ojaleshi',
    nameKa: 'ოჯალეში',
    aliases: ['orbeluri ojaleshi'],
    color: 'red',
    primaryRegions: ['Samegrelo', 'Lechkhumi'],
    recommendedWineClasses: ['red'],
    notes: 'Western Georgian red variety with distinctive acidity and perfume.'
  },
  {
    id: 'chkhaveri',
    name: 'Chkhaveri',
    nameKa: 'ჩხავერი',
    aliases: ['chkaveri'],
    color: 'pink',
    primaryRegions: ['Guria', 'Adjara'],
    recommendedWineClasses: ['rose', 'white'],
    notes: 'Pink-skinned western Georgian grape often made as rose or pale wine.'
  },
  {
    id: 'usakhelouri',
    name: 'Usakhelouri',
    nameKa: 'უსახელოური',
    aliases: ['usakhelauri'],
    color: 'red',
    primaryRegions: ['Lechkhumi'],
    recommendedWineClasses: ['red'],
    notes: 'Rare Lechkhumi red grape used for premium dry and semi-sweet wines.'
  }
];

export function normalizeWineTerm(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u10a0-\u10ff]+/g, ' ')
    .trim();
}

function matchesTerm(candidate: { name: string; nameKa?: string; aliases: string[] }, query: unknown): boolean {
  const q = normalizeWineTerm(query);
  if (!q) return false;
  const terms = [candidate.name, candidate.nameKa || '', ...candidate.aliases].map(normalizeWineTerm).filter(Boolean);
  return terms.some(term => term === q || term.includes(q) || q.includes(term));
}

export function findGeorgianRegion(query: unknown): GeorgianWineRegion | undefined {
  const q = normalizeWineTerm(query);
  if (!q) return undefined;
  return GEORGIAN_WINE_REGIONS.find(region => {
    if (matchesTerm(region, query)) return true;
    return region.mainMicrozones.some(microzone => {
      const term = normalizeWineTerm(microzone);
      return term === q || term.includes(q) || q.includes(term);
    });
  });
}

export function findGeorgianVariety(query: unknown): GeorgianGrapeVariety | undefined {
  return GEORGIAN_GRAPE_VARIETIES.find(variety => matchesTerm(variety, query));
}

export function suggestVarietiesForRegion(regionQuery: unknown): GeorgianGrapeVariety[] {
  const region = findGeorgianRegion(regionQuery);
  if (!region) return [];
  const allowed = new Set(region.commonVarieties.map(normalizeWineTerm));
  return GEORGIAN_GRAPE_VARIETIES.filter(variety =>
    allowed.has(normalizeWineTerm(variety.name)) ||
    variety.primaryRegions.some(name => normalizeWineTerm(name) === normalizeWineTerm(region.name))
  );
}

export function suggestRegionsForVariety(varietyQuery: unknown): GeorgianWineRegion[] {
  const variety = findGeorgianVariety(varietyQuery);
  if (!variety) return [];
  const regionNames = new Set(variety.primaryRegions.map(normalizeWineTerm));
  return GEORGIAN_WINE_REGIONS.filter(region => regionNames.has(normalizeWineTerm(region.name)));
}

export function suggestMicrozonesForRegion(regionQuery: unknown): string[] {
  return findGeorgianRegion(regionQuery)?.mainMicrozones || [];
}

export function inferWineClassForVariety(varietyQuery: unknown): WineClass | undefined {
  return findGeorgianVariety(varietyQuery)?.recommendedWineClasses[0];
}
