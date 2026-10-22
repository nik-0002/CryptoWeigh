import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../lib/auth.js';
import { supabase } from '../../../../lib/supabase.js';
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

  const db = supabase();
  const { data, error } = await db.from('ledger').select('photo_path').eq('id', id).maybeSingle();
  if (error) {
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
