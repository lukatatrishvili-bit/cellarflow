import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The local store is a single JSON document, and startup used to treat "this
 * file will not parse" the same as "there is no file": it initialised an empty
 * database, and `initDB` then saved that straight back over the original. One
 * corrupt or half-written file therefore became permanent, total data loss — and
 * the only surviving trace was a log line claiming no database had been found,
 * while the unreadable file sat right there.
 *
 * That is how a 365 KB workspace became a 127-byte empty document on this
 * project. These tests pin the corrected behaviour: an unreadable database stops
 * the boot, keeps its bytes, and says what to do about it.
 */

const originalEnv = { ...process.env };
let root: string;
let dbPath: string;

beforeEach(() => {
  vi.resetModules();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cellarflow-corrupt-db-'));
  dbPath = path.join(root, 'db.json');
  process.env = {
    ...originalEnv,
    NODE_ENV: 'development',
    DATABASE_URL: '',   // no PostgreSQL, so the local file is the only source
    GCS_BUCKET: '',
    DATABASE_PATH: dbPath,
  };
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

const validDatabase = () => JSON.stringify({
  users: [{ username: 'nino', role: 'Owner/Admin', activeOrganizationId: 'org-a' }],
  organizations: [{ id: 'org-a', name: 'ყვარლის მარანი' }],
  memberships: [{ id: 'm1', userId: 'nino', organizationId: 'org-a', role: 'Owner/Admin' }],
  invitations: [],
  securityAuditEvents: [],
  whatsappDeliveries: [],
  orgData: { 'org-a': { lots: [{ id: 'SAP-25' }, { id: 'RK-25' }], vessels: [{ id: 'Q-01' }] } },
}, null, 2);

describe('unreadable database file', () => {
  it('refuses to start rather than overwriting it', async () => {
    const corrupt = validDatabase().slice(0, 200); // a half-written file
    fs.writeFileSync(dbPath, corrupt);

    const { initDB } = await import('../server/db');
    await expect(initDB()).rejects.toThrow(/could not be parsed/i);

    // The decisive assertion: the bytes are still there.
    expect(fs.readFileSync(dbPath, 'utf8')).toBe(corrupt);
  });

  it('keeps a timestamped copy so the original survives a later overwrite', async () => {
    fs.writeFileSync(dbPath, validDatabase().slice(0, 200));

    const { initDB } = await import('../server/db');
    await initDB().catch(() => undefined);

    const preserved = fs.readdirSync(root).filter(name => name.includes('.corrupt-'));
    expect(preserved).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, preserved[0]), 'utf8')).toBe(validDatabase().slice(0, 200));
  });

  it('tells the operator what happened and how to proceed', async () => {
    fs.writeFileSync(dbPath, '{ this is not json');

    const { initDB } = await import('../server/db');
    const error = await initDB().then(() => null, (e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = String(error?.message);
    // Naming the file, the reason, the kept copy, and the way out — the previous
    // behaviour offered none of these.
    expect(message).toContain(dbPath);
    expect(message).toMatch(/refusing to start/i);
    expect(message).toMatch(/\.corrupt-/);
    expect(message).toMatch(/move it aside/i);
  });

  it('still starts empty when there is genuinely no database', async () => {
    // A real first run must not be blocked by this guard.
    expect(fs.existsSync(dbPath)).toBe(false);

    const { initDB, getDB } = await import('../server/db');
    await expect(initDB()).resolves.toBeUndefined();
    expect(getDB().users).toEqual([]);
  });

  it('loads a valid database untouched', async () => {
    fs.writeFileSync(dbPath, validDatabase());

    const { initDB, getDB } = await import('../server/db');
    await initDB();

    const db = getDB();
    expect(db.users.map((u: any) => u.username)).toEqual(['nino']);
    expect(db.orgData['org-a'].lots).toHaveLength(2);
    expect(fs.readdirSync(root).filter(name => name.includes('.corrupt-'))).toHaveLength(0);
  });
});
