import { NextResponse } from 'next/server';
import { getPublicReading } from '../../../../lib/publicReading.js';
import { parseReadingId } from '../../../../lib/photo.js';

export const dynamic = 'force-dynamic';

// PUBLIC (no login): returns one reading, nothing else.
export async function GET(_request, { params }) {
  const id = parseReadingId((await params).id);
  if (!id) return NextResponse.json({ status: 'error', message: 'Bad id' }, { status: 400 });
  const reading = await getPublicReading(id);
  if (!reading) return NextResponse.json({ status: 'error', message: 'Not found' }, { status: 404 });
  return NextResponse.json(reading, { headers: { 'Cache-Control': 'no-store' } });
}
