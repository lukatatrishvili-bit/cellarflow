/**
 * Optional Google Cloud Storage persistence for db.json.
 *
 * Cloud Run's container filesystem is ephemeral — it is wiped on every new
 * revision/instance. When GCS_BUCKET is set, the whole database is mirrored to
 * a single object in a bucket so per-user data survives redeploys and scaling.
 *
 * Auth uses Application Default Credentials (the Cloud Run service account) —
 * no key files needed. When GCS_BUCKET is unset, every function is a no-op and
 * the app falls back to the local file (unchanged local/dev behaviour).
 */

import type { Storage as GcsStorage } from '@google-cloud/storage';

const BUCKET = process.env.GCS_BUCKET || '';
const OBJECT = process.env.GCS_DB_OBJECT || 'db.json';

export const gcsEnabled = !!BUCKET;

let storage: GcsStorage | null = null;

async function dbFile() {
  if (!storage) {
    // Lazy import so the SDK is only loaded when GCS is actually configured.
    const { Storage } = await import('@google-cloud/storage');
    storage = new Storage();
  }
  return storage.bucket(BUCKET).file(OBJECT);
}

/** Returns the stored db.json contents, or null if GCS is off or object missing. */
export async function downloadDb(): Promise<string | null> {
  if (!gcsEnabled) return null;
  try {
    const file = await dbFile();
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return contents.toString('utf8');
  } catch (err) {
    console.error('[gcs] download failed:', err);
    return null;
  }
}

/** Writes the db.json contents to the bucket (atomic at the object level). */
export async function uploadDb(json: string): Promise<void> {
  if (!gcsEnabled) return;
  try {
    const file = await dbFile();
    await file.save(json, { contentType: 'application/json', resumable: false });
  } catch (err) {
    console.error('[gcs] upload failed:', err);
  }
}

export function gcsTarget(): string {
  return gcsEnabled ? `gs://${BUCKET}/${OBJECT}` : '(local file)';
}
