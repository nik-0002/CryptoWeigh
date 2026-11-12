import { NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase.js';
import { getLocalReadings, readLocalPhoto, withTimeout } from '../../../../lib/offlineSync.js';
import { parseReadingId } from '../../../../lib/photo.js';

export const dynamic = 'force-dynamic';

const text = (m, status) => new NextResponse(m, { status, headers: { 'Cache-Control': 'no-store' } });
const jpeg = (bytes) =>
  new NextResponse(bytes, {
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    },
  });

// PUBLIC (no login): the photo of ONE reading.
export async function GET(_request, { params }) {
  const id = parseReadingId((await params).id);
  if (!id) return text('Bad id', 400);

  try {
    const db = supabase();
    const { data, error } = await withTimeout(
      db.from('ledger').select('photo_path').eq('id', id).maybeSingle(),
      5000,
    );
    if (error) throw error;
    if (data?.photo_path) {
      const { data: blob, error: dlError } = await withTimeout(db.storage.from('photos').download(data.photo_path), 10000);
      if (dlError || !blob) throw dlError || new Error('download failed');
      return jpeg(Buffer.from(await blob.arrayBuffer()));
    }
  } catch (e) {
    console.error('Public photo failed:', e.message);
  }

  // Offline on this computer: serve the local copy.
  const row = (await getLocalReadings()).find((r) => r.id === id);
  if (row?.local_photo_file) {
    try {
      return jpeg(await readLocalPhoto(row.local_photo_file));
    } catch {}
  }
  return text('No photo', 404);
}
