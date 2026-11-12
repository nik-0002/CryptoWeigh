import { supabase } from './supabase.js';
import { expectedHash } from './hash.js';
import { getLocalReadings, withTimeout } from './offlineSync.js';

/** Turns a ledger row into the only fields a public visitor may see. */
function toPublic(r, hasPhoto) {
  const weight = Number(r.weight_kg);
  const stored = String(r.data_hash || '').toUpperCase();
  return {
    id: r.id,
    created_at: r.created_at,
    device_id: r.device_id,
    weight_kg: weight,
    weight_g: Math.round(weight * 1000),
    payload: `${weight.toFixed(2)}kg`,
    data_hash: stored,
    hash_ok: expectedHash(weight) === stored,
    tamper_status: !!r.tamper_status,
    has_photo: hasPhoto,
  };
}

/** Fetches ONE reading by id. Falls back to this computer's offline queue when the cloud is unreachable. */
export async function getPublicReading(id) {
  try {
    const { data, error } = await withTimeout(
      supabase()
        .from('ledger')
        .select('id, created_at, device_id, weight_kg, data_hash, tamper_status, photo_path')
        .eq('id', id)
        .maybeSingle(),
      5000,
    );
    if (error) throw error;
    if (data) return toPublic(data, !!data.photo_path);
  } catch (e) {
    console.error('Public reading lookup failed:', e.message);
  }
  const local = (await getLocalReadings()).find((r) => r.id === id);
  return local ? toPublic(local, !!local.local_photo_file) : null;
}
