import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { gcsEnabled, downloadDb, uploadDb, gcsTarget } from './gcsStore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Where the working copy of the DB lives on disk. In GCS mode this is just a
// local cache (the source of truth is the bucket), so default it to a writable
// temp path; otherwise keep the repo-local db.json.
const DB_PATH = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : gcsEnabled
    ? path.join(os.tmpdir(), 'cellarflow-db.json')
    : path.resolve(__dirname, '../db.json');

// Memory cache
let dbData: any = null;

// Debounced GCS upload so rapid syncs coalesce into one write.
let uploadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleGcsUpload(immediate = false): void {
  if (!gcsEnabled || !dbData) return;
  const flush = () => {
    uploadTimer = null;
    if (dbData) void uploadDb(JSON.stringify(dbData, null, 2));
  };
  if (immediate) { flush(); return; }
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(flush, 1500);
}

/**
 * Hydrate the local DB cache from GCS before the server accepts traffic.
 * No-op (returns immediately) when GCS is not configured — getDB() then
 * lazy-loads from the local file exactly as before. Must be awaited at startup.
 */
export async function initDB(): Promise<void> {
  if (!gcsEnabled) return;
  console.log(`[db] persistence: ${gcsTarget()}`);
  const remote = await downloadDb();
  if (remote !== null) {
    try {
      fs.writeFileSync(DB_PATH, remote, 'utf8'); // hydrate local cache
      dbData = null;                             // force getDB() to re-read with full logic
    } catch (err) {
      console.error('[db] failed to write local cache from GCS:', err);
    }
  }
  getDB(); // load dbData (from the GCS cache, template, or a fresh empty seed)
  if (remote === null) scheduleGcsUpload(true); // persist the freshly-seeded DB
}

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

  const templatePath = path.resolve(__dirname, '../db.json');
  if (DB_PATH !== templatePath && !fs.existsSync(DB_PATH) && fs.existsSync(templatePath)) {
    try {
      console.log(`Seeding database from template: ${templatePath} -> ${DB_PATH}`);
      fs.copyFileSync(templatePath, DB_PATH);
    } catch (err) {
      console.error(`Failed to seed database from template:`, err);
    }
  }

  if (fs.existsSync(DB_PATH)) {
    try {
      dbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!dbData.users) dbData.users = [];
      if (!dbData.userData) dbData.userData = {};

      // Merge googleConfig if missing in persistent db but present in template
      if (!dbData.googleConfig && fs.existsSync(templatePath)) {
        try {
          const templateDb = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
          if (templateDb.googleConfig) {
            console.log('Merging googleConfig from template database...');
            dbData.googleConfig = templateDb.googleConfig;
            // We delay saveDB to when server is fully initialized or call it synchronously here
            fs.writeFileSync(DB_PATH, JSON.stringify(dbData, null, 2), 'utf8');
          }
        } catch (e) {
          console.error('Failed to merge googleConfig from template:', e);
        }
      }

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
  // Mirror to durable storage (no-op unless GCS_BUCKET is set).
  scheduleGcsUpload();
}
