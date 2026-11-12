import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { safeEqual } from '../../../lib/session.js';
import {
  getLocalReadings,
  saveLocalPhoto,
  syncPendingToSupabase,
  withTimeout,
  updateLocalReading,
  uploadPhotoToCloud,
} from '../../../lib/offlineSync.js';
import { isJpeg, MAX_PHOTO_BYTES, parseReadingId } from '../../../lib/photo.js';

export const dynamic = 'force-dynamic';

const fail = (status, message) => NextResponse.json({ status: 'error', message }, { status });

// The ESP32-CAM uploads one JPEG per reading:  POST /api/photos?reading_id=123
export async function POST(request) {
  const deviceKey = process.env.DEVICE_API_KEY;
  if (!deviceKey) {
    console.error('DEVICE_API_KEY is not set');
    return fail(500, 'Server is not configured.');
  }
  if (!safeEqual(request.headers.get('x-api-key') || '', deviceKey)) {
    return fail(401, 'Invalid or missing API key.');
  }

  const id = parseReadingId(new URL(request.url).searchParams.get('reading_id'));
  if (!id) return fail(400, 'reading_id must be a positive whole number.');

  if (Number(request.headers.get('content-length') || 0) > MAX_PHOTO_BYTES) {
    return fail(413, 'Photo is too large.');
  }

  let bytes;
  try {
    bytes = Buffer.from(await request.arrayBuffer());
  } catch {
    return fail(400, 'Unreadable request body.');
  }
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return fail(400, 'Empty or oversized photo.');
  if (!isJpeg(bytes)) return fail(400, 'Body must be a JPEG image.');

  // 1) Always keep the photo on this computer first.
  const localUrl = `/offline-photos/reading_${id}.jpg`;
  let savedLocally = false;
  try {
    const file = await saveLocalPhoto(id, bytes);
    if (file) {
      await updateLocalReading(id, { photo_url: localUrl, local_photo_file: file, photo_uploaded: false });
      savedLocally = true;
    }
  } catch (e) {
    console.error('Local photo save failed:', e.message);
  }
  const offlineOk = () =>
    NextResponse.json({ status: 'success', id, bytes: bytes.length, photo_url: localUrl }, { status: 200 });

  // 2) A reading that is still waiting to be synced has a temporary id the cloud doesn't know.
  //    The photo goes up together with the reading as soon as the internet is back.
  const local = (await getLocalReadings()).find((r) => r.id === id);
  if (local && !local.synced) {
    await syncPendingToSupabase();
    return offlineOk();
  }

  // 3) Reading exists in the cloud: upload the photo there too.
  const db = supabase();
  try {
    const { data: row, error: selectError } = await withTimeout(
      db.from('ledger').select('id, photo_path').eq('id', id).maybeSingle(),
    );
    if (selectError) throw selectError;
    if (!row) return fail(404, 'Reading not found.');
    if (row.photo_path) return fail(409, 'This reading already has a photo.');

    await uploadPhotoToCloud(id, bytes);
    if (savedLocally) await updateLocalReading(id, { photo_uploaded: true });
    return NextResponse.json({ status: 'success', id, bytes: bytes.length }, { status: 200 });
  } catch (e) {
    console.error('Cloud photo upload failed:', e.message);
    // Offline: the camera still gets success; sync uploads the photo later.
    if (savedLocally) return offlineOk();
    return fail(500, 'Storage or database error.');
  }
}
