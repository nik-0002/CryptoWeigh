import { NextResponse } from 'next/server';
import { isAdmin } from '../../../lib/auth.js';
import { supabase } from '../../../lib/supabase.js';

export const dynamic = 'force-dynamic';

// Admin-only: download every reading as a CSV file.
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ status: 'error', message: 'Not logged in.' }, { status: 401 });
  }

  const rows = [];
  const step = 1000;
  for (let from = 0; from < 100000; from += step) {
    const { data, error } = await supabase()
      .from('ledger')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + step - 1);
    if (error) {
      console.error('Export failed:', error);
      return NextResponse.json({ status: 'error', message: 'Database error.' }, { status: 500 });
    }
    rows.push(...data);
    if (data.length < step) break;
  }

  const lines = ['id,created_at,device_id,weight_kg,data_hash,tamper_status,has_photo,photo_sha256'];
  for (const r of rows) {
    lines.push(
      [r.id, r.created_at, r.device_id, Number(r.weight_kg).toFixed(2), r.data_hash, r.tamper_status, r.photo_path ? 'yes' : 'no', r.photo_sha256 ?? ''].join(',')
    );
  }
  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ledger.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
