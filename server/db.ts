import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from './auth';

import {
  initialVessels,
  initialLots,
  initialFermLogs,
  initialLabLogs,
  initialInventory,
  initialTasks,
  initialVineyardBlocks,
  initialPhenologyRecords,
  initialSprayRecords,
  initialScoutingRecords,
  initialSoilAnalysis,
  initialGrapeSamples,
  initialHarvestRecords,
  initialIrrigationLogs,
  initialFertilizerLogs,
  initialVineaAuditLogs
} from '../lib/wineryState';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../db.json');

// Memory cache
let dbData: any = null;

export interface DBState {
  vessels: any[];
  lots: any[];
  fermlogs: any[];
  lablogs: any[];
  inventory: any[];
  tasks: any[];
  notes: any[];
  blocks: any[];
  phenologyLogs: any[];
  sprays: any[];
  scoutings: any[];
  soilRecords: any[];
  samplings: any[];
  harvests: any[];
  irrigationLogs: any[];
  fertilizerLogs: any[];
  auditLogs: any[];
  users: any[];
  companyProfile: any;
}

export function getDB(): DBState {
  if (dbData) return dbData;

  if (fs.existsSync(DB_PATH)) {
    try {
      dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      return dbData;
    } catch (err) {
      console.error('Failed to read db.json, recreating...', err);
    }
  }

  // Seed initial data
  const initialProfile = {
    companyName: 'Vinea Estates',
    wineryName: 'Vinea Central Marani',
    country: 'Georgia',
    region: 'Kakheti',
    municipality: 'Telavi',
    address: 'Kondoli Village Highway, Telavi, Kakheti, Georgia',
    contactEmail: 'production@vinea.ge',
    phone: '+995 599 123 456',
    website: 'www.vinea.ge',
    measurementUnits: 'metric',
    latitude: 41.9056,
    longitude: 45.4740
  };

  const initialNotes = [
    {
      id: 'note-1',
      title: 'Saperavi Cap Management Protocol',
      category: 'Enology',
      content: 'Ensure 3x daily punchdowns for Lot S-2025-01 to maximize color and soft tannin extraction from grapes.',
      date: '2026-05-27',
      author: 'Luka Tatrishvili',
      relatedLotId: 'S-2025-01'
    },
    {
      id: 'note-2',
      title: 'Rkatsiteli Malolactic Fermentation Check',
      category: 'Enology',
      content: 'MLF progress is slow but steady. VA level is stable at 0.35 g/L. Ambient temperature maintained at 18 degrees Celsius.',
      date: '2026-05-25',
      author: 'Sophia Rossi',
      relatedLotId: 'R-2025-02'
    },
    {
      id: 'note-3',
      title: 'Post-stabilization organoleptic tasting review',
      category: 'Tasting',
      content: 'Full-bodied, clean. No reduction issues noticed. Sulfite levels are stable. Notes of blackberry and black pepper.',
      date: '2026-05-20',
      author: 'Luka Tatrishvili'
    }
  ];

  dbData = {
    vessels: initialVessels,
    lots: initialLots,
    fermlogs: initialFermLogs,
    lablogs: initialLabLogs,
    inventory: initialInventory,
    tasks: initialTasks,
    notes: initialNotes,
    blocks: initialVineyardBlocks,
    phenologyLogs: initialPhenologyRecords,
    sprays: initialSprayRecords,
    scoutings: initialScoutingRecords,
    soilRecords: initialSoilAnalysis,
    samplings: initialGrapeSamples,
    harvests: initialHarvestRecords,
    irrigationLogs: initialIrrigationLogs,
    fertilizerLogs: initialFertilizerLogs,
    auditLogs: initialVineaAuditLogs,
    users: [
      {
        username: 'luka_winemaker',
        email: 'luka@vinea.com',
        fullName: 'Luka Tatrishvili',
        role: 'Owner/Admin',
        language: 'en',
        passwordHash: hashPassword('vinea2026')
      },
      {
        username: 'luka_viticulture',
        email: 'luka.t@vinea.com',
        fullName: 'Luka Tatrishvili',
        role: 'Viticulturist',
        language: 'en',
        passwordHash: hashPassword('vinea2026')
      },
      {
        username: 'sophia_enology',
        email: 's.rossi@vinea.com',
        fullName: 'Sophia Rossi',
        role: 'Winemaker',
        language: 'en',
        passwordHash: hashPassword('vinea2026')
      }
    ],
    companyProfile: initialProfile
  };

  saveDB();
  return dbData;
}

export function saveDB(): void {
  if (!dbData) return;
  const tempPath = DB_PATH + '.tmp';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(dbData, null, 2), 'utf8');
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.error('Failed to write db.json', err);
  }
}
