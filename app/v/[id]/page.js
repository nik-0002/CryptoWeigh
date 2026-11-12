import { redirect, notFound } from 'next/navigation';
import { parseReadingId } from '../../../lib/photo.js';

export const dynamic = 'force-dynamic';

// The QR code on the scale points here:  /v/104  ->  /verify?tx_id=104  (public, no login)
export default async function Short({ params }) {
  const id = parseReadingId((await params).id);
  if (!id) notFound();
  redirect(`/verify?tx_id=${id}`);
}
