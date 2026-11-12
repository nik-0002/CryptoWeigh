import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { supabase } from './supabase.js';

// Local queue + photos. These live next to the project, so they only persist when
// the app runs on your own computer (on Vercel the disk is read-only, so local saving
// is skipped quietly and Supabase stays the source of truth).
const ROOT = process.cwd();
export const READINGS_FILE = path.join(ROOT, 'offline-readings.json');
export const PHOTO_DIR = path.join(ROOT, 'public', 'offline-photos');
const CLOUD_TIMEOUT_MS = 4000;

const localDisabled = () => !!process.env.VERCEL;

/** Rejects if `promise` takes longer than `ms`. */
export function withTimeout(promise, ms = CLOUD_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Only one file edit at a time, so two requests can't overwrite each other.
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

async function readFileRows() {
  try {
    const rows = JSON.parse(await fs.readFile(READINGS_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read offline-readings.json:', e.message);
    return [];
  }
}

async function writeFileRows(rows) {
  const tmp = `${READINGS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2));
  await fs.rename(tmp, READINGS_FILE);
}

/** Returns all readings stored locally (newest first). */
export async function getLocalReadings() {
  if (localDisabled()) return [];
  return readFileRows();
}

/** Puts a reading at the top of offline-readings.json. */
export function saveLocalReading(reading) {
  if (localDisabled()) return Promise.resolve(reading);
  return locked(async () => {
    const rows = await readFileRows();
    const entry = { created_at: new Date().toISOString(), ...reading };
    // Replace an older entry with the same id instead of duplicating it.
    const next = [entry, ...rows.filter((r) => r.id !== entry.id)];
    await writeFileRows(next);
    return entry;
  });
}

/** Changes fields of one local reading. Returns the updated row, or null if not found. */
export function updateLocalReading(id, updates) {
  if (localDisabled()) return Promise.resolve(null);
  return locked(async () => {
    const rows = await readFileRows();
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...updates };
    await writeFileRows(rows);
    return rows[i];
  });
}

export async function saveLocalPhoto(id, bytes) {
  if (localDisabled()) return null;
  const file = `reading_${id}.jpg`;
  await fs.mkdir(PHOTO_DIR, { recursive: true });
  await fs.writeFile(path.join(PHOTO_DIR, file), bytes);
  return file;
}

export async function readLocalPhoto(file) {
  // basename() makes sure a bad value can never point outside the photo folder.
  return fs.readFile(path.join(PHOTO_DIR, path.basename(file)));
}

/** Uploads one JPEG to the private bucket and links it to the cloud row. */
export async function uploadPhotoToCloud(cloudId, bytes) {
  const db = supabase();
  const photoPath = `readings/${cloudId}.jpg`;
  const { error: uploadError } = await withTimeout(
    db.storage.from('photos').upload(photoPath, bytes, { contentType: 'image/jpeg', upsert: true }),
    15000,
  );
  if (uploadError) throw uploadError;

  const { error: updateError } = await withTimeout(
    db
      .from('ledger')
      .update({
        photo_path: photoPath,
        photo_sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
        photo_at: new Date().toISOString(),
      })
      .eq('id', cloudId)
      .is('photo_path', null),
  );
  if (updateError) throw updateError;
  // The dashboard shows cloud photos through this admin-only route (the bucket is private).
  return `/api/photos/${cloudId}`;
}

let syncing = null;

/**
 * Pushes everything that is still waiting in offline-readings.json to Supabase.
 * Never throws: if the internet is down it just stops and tries again next time.
 */
export function syncPendingToSupabase() {
  if (localDisabled()) return Promise.resolve({ synced: 0, failed: 0 });
  if (syncing) return syncing;
  syncing = doSync()
    .catch((e) => {
      console.error('Sync failed:', e.message);
      return { synced: 0, failed: 0 };
    })
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

async function doSync() {
  const rows = await getLocalReadings();
  // Oldest first, so the cloud ledger keeps the real order.
  const pending = rows
    .filter((r) => r.synced === false || (r.synced && r.cloud_id && r.local_photo_file && !r.photo_uploaded))
    .reverse();
  let synced = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      let cloudId = row.cloud_id;

      if (!row.synced) {
        const { data, error } = await withTimeout(
          supabase()
            .from('ledger')
            .insert({
              device_id: row.device_id,
              weight_kg: row.weight_kg,
              data_hash: row.data_hash,
              tamper_status: row.tamper_status,
              created_at: row.created_at,
            })
            .select('id')
            .single(),
        );
        if (error) throw error;
        cloudId = data.id;
        await updateLocalReading(row.id, { synced: true, cloud_id: cloudId });
        synced++;
      }

      if (row.local_photo_file) {
        let bytes;
        try {
          bytes = await readLocalPhoto(row.local_photo_file);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          // File was deleted: don't block the queue forever.
          await updateLocalReading(row.id, { photo_uploaded: true, local_photo_file: null });
          continue;
        }
        const photoUrl = await uploadPhotoToCloud(cloudId, bytes);
        await updateLocalReading(row.id, { photo_url: photoUrl, photo_uploaded: true });
      }
    } catch (e) {
      failed++;
      console.error(`Sync of reading ${row.id} failed:`, e.message);
      break; // most likely offline: stop and retry next time
    }
  }
  return { synced, failed };
}
