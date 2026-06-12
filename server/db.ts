import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DATABASE_PATH 
  ? path.resolve(process.env.DATABASE_PATH)
  : path.resolve(__dirname, '../db.json');

// Memory cache
let dbData: any = null;

export interface UserDataState {
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
  companyProfile: any;
}

export interface DBState {
  users: any[];
  userData: Record<string, UserDataState>;
}

export function createEmptyUserData(): UserDataState {
  return {
    vessels: [],
    lots: [],
    fermlogs: [],
    lablogs: [],
    inventory: [],
    tasks: [],
    notes: [],
    blocks: [],
    phenologyLogs: [],
    sprays: [],
    scoutings: [],
    soilRecords: [],
    samplings: [],
    harvests: [],
    irrigationLogs: [],
    fertilizerLogs: [],
    auditLogs: [],
    companyProfile: {
      companyName: '',
      wineryName: '',
      country: '',
      region: '',
      municipality: '',
      address: '',
      contactEmail: '',
      phone: '',
      website: '',
      measurementUnits: 'metric',
      latitude: 41.9056,
      longitude: 45.4740
    }
  };
}

export function getDB(): DBState {
  if (dbData) return dbData;

  if (fs.existsSync(DB_PATH)) {
    try {
      dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!dbData.users) dbData.users = [];
      if (!dbData.userData) dbData.userData = {};
      return dbData;
    } catch (err) {
      console.error('Failed to read db.json, recreating...', err);
    }
  }

  // Seed initial empty database
  dbData = {
    users: [],
    userData: {}
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
