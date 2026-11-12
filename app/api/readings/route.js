import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { validateReading } from '../../../lib/validate.js';
import { safeEqual } from '../../../lib/session.js';
import { isAdmin } from '../../../lib/auth.js';
import {
  getLocalReadings,
  saveLocalReading,
  syncPendingToSupabase,
  withTimeout,
} from '../../../lib/offlineSync.js';

export const dynamic = 'force-dynamic';

const fail = (status, message) => NextResponse.json({ status: 'error', message }, { status });

// The ESP32 sends its readings here.
export async function POST(request) {
  const deviceKey = process.env.DEVICE_API_KEY;
  if (!deviceKey) {
    console.error('DEVICE_API_KEY is not set');
    return fail(500, 'Server is not configured.');
  }
  if (!safeEqual(request.headers.get('x-api-key') || '', deviceKey)) {
    return fail(401, 'Invalid or missing API key.');
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return fail(400, 'Unreadable request body.');
  }
  if (!text || text.length > 4096) return fail(400, 'Empty or oversized request body.');

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'Body is not valid JSON.');
  }

  const allowedDevices = (process.env.ALLOWED_DEVICE_IDS || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const result = validateReading(body, {
    verifyHash: process.env.VERIFY_HASH !== 'false',
    allowedDevices,
  });
  if (!result.ok) return fail(result.status, result.message);

  // 1) Try the cloud first (4 s limit).
  try {
    const { data, error } = await withTimeout(
      supabase().from('ledger').insert(result.data).select('id').single(),
    );
    if (error) throw error;

    // Online: keep a local copy, then flush anything saved while offline (in the background).
    await saveLocalReading({ ...result.data, id: data.id, cloud_id: data.id, synced: true }).catch((e) =>
      console.error('Local copy failed:', e.message),
    );
    void syncPendingToSupabase();
    return NextResponse.json({ status: 'success', id: data.id }, { status: 200 });
  } catch (e) {
    console.error('Cloud insert failed, saving offline:', e.message);
  }

  // 2) Offline: store locally and still answer 200 so the scale shows "Saved" and the camera fires.
  try {
    const tempId = Math.floor(Date.now() / 1000);
    await saveLocalReading({ ...result.data, id: tempId, synced: false });
    return NextResponse.json({ status: 'success', id: tempId }, { status: 200 });
  } catch (e) {
    console.error('Offline save failed:', e);
    return fail(500, 'Could not save the reading.');
  }
}

// Dashboard data: pushes offline readings to the cloud first, then returns the newest rows.
export async function GET() {
  if (!(await isAdmin())) return fail(401, 'Not logged in.');

  await syncPendingToSupabase();
  try {
    const { data, error } = await withTimeout(
      supabase().from('ledger').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200),
    );
    if (error) throw error;
    return NextResponse.json(data);
  } catch (e) {
    console.error('Cloud read failed, using local readings:', e.message);
    return NextResponse.json(await getLocalReadings());
  }
}
