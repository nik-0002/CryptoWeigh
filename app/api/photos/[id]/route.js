import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/auth.js';
import { supabase } from '../../../../lib/supabase.js';
import { getLocalReadings, readLocalPhoto, withTimeout } from '../../../../lib/offlineSync.js';
import { parseReadingId } from '../../../../lib/photo.js';

export const dynamic = 'force-dynamic';

const text = (message, status) => new NextResponse(message, { status });

// Admin-only: shows the photo that belongs to one reading.
// The photos bucket is private, so every image goes through this check.
export async function GET(_request, { params }) {
  if (!(await isAdmin())) return text('Not logged in', 401);

  const { id: rawId } = await params;
  const id = parseReadingId(rawId);
  if (!id) return text('Bad id', 400);

  const jpeg = (bytes, cache) =>
    new NextResponse(bytes, {
      headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache },
    });
  const serveLocal = async () => {
    const row = (await getLocalReadings()).find((r) => r.id === id);
    if (!row?.local_photo_file) return null;
    try {
      return jpeg(await readLocalPhoto(row.local_photo_file), 'private, no-cache');
    } catch {
      return null;
    }
  };

  // Photos not yet uploaded live only on this computer.
  const pending = (await getLocalReadings()).find((r) => r.id === id && !r.photo_uploaded);
  if (pending) {
    const res = await serveLocal();
    if (res) return res;
  }

  const db = supabase();
  let data, error;
  try {
    ({ data, error } = await withTimeout(db.from('ledger').select('photo_path').eq('id', id).maybeSingle()));
  } catch (e) {
    error = e;
  }
  if (error) {
    const res = await serveLocal(); // offline
    if (res) return res;
    console.error('Photo lookup failed:', error);
    return text('Database error', 500);
  }
  if (!data?.photo_path) return text('No photo', 404);

  const { data: blob, error: downloadError } = await db.storage.from('photos').download(data.photo_path);
  if (downloadError || !blob) {
    console.error('Photo download failed:', downloadError);
    return text('Storage error', 500);
  }

  return new NextResponse(Buffer.from(await blob.arrayBuffer()), {
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Content-Type-Options': 'nosniff',
      // A reading's photo never changes, so the browser can keep it and not re-download every 10 s.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
