import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { supabase } from '../../../lib/supabase.js';
import { safeEqual } from '../../../lib/session.js';
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

  const db = supabase();
  try {
    const { data: row, error: selectError } = await db
      .from('ledger')
      .select('id, photo_path')
      .eq('id', id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!row) return fail(404, 'Reading not found.');
    if (row.photo_path) return fail(409, 'This reading already has a photo.');

    const path = `readings/${id}.jpg`;
    const { error: uploadError } = await db.storage
      .from('photos')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    // Attach the photo once. The ".is(photo_path, null)" guard stops anyone replacing it later.
    const { data: updated, error: updateError } = await db
      .from('ledger')
      .update({
        photo_path: path,
        photo_sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
        photo_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('photo_path', null)
      .select('id');
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) return fail(409, 'This reading already has a photo.');

    return NextResponse.json({ status: 'success', id, bytes: bytes.length }, { status: 200 });
  } catch (e) {
    console.error('Photo upload failed:', e);
    return fail(500, 'Storage or database error.');
  }
}
