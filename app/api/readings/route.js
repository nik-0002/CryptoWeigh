import { NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase.js';
import { validateReading } from '../../../lib/validate.js';
import { safeEqual } from '../../../lib/session.js';

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

  try {
    const { data, error } = await supabase()
      .from('ledger')
      .insert(result.data)
      .select('id')
      .single();
    if (error) throw error;
    return NextResponse.json({ status: 'success', id: data.id }, { status: 200 });
  } catch (e) {
    console.error('Insert failed:', e);
    return fail(500, 'Database error.');
  }
}
