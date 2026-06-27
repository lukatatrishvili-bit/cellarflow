import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadDbModule(dbPath: string) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    DATABASE_PATH: dbPath,
    USE_FIRESTORE: 'false',
    GCS_BUCKET: '',
  };
  return import('../server/db');
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('database persistence', () => {
  it('creates the database directory and writes a valid JSON cache', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'nested', 'db.json');
    const dbModule = await loadDbModule(dbPath);

    const db = dbModule.getDB();
    db.users.push({ username: 'alice', role: 'Owner/Admin' });
    dbModule.saveDB();

    const saved = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    expect(saved.users).toContainEqual({ username: 'alice', role: 'Owner/Admin' });
  });

  it('does not use the shared legacy db.json.tmp filename', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-db-'));
    const dbPath = path.join(root, 'db.json');
    const dbModule = await loadDbModule(dbPath);

    const db = dbModule.getDB();
    db.users.push({ username: 'bob', role: 'Winemaker' });
    dbModule.saveDB();

    expect(fs.existsSync(`${dbPath}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(dbPath, 'utf8')).users).toContainEqual({ username: 'bob', role: 'Winemaker' });
  });
});
