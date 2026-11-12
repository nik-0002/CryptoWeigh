import { getPublicReading } from '../../lib/publicReading.js';
import { parseReadingId } from '../../lib/photo.js';
import Receipt from './Receipt.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proof of Fair Weight – Receipt', robots: { index: false } };

// PUBLIC page (no login): shows exactly one reading.
export default async function Verify({ searchParams }) {
  const sp = await searchParams;
  const id = parseReadingId(typeof sp?.tx_id === 'string' ? sp.tx_id : '');
  const reading = id ? await getPublicReading(id) : null;

  if (!reading) {
    return (
      <main className="rc-wrap">
        <header className="rc-head">
          <h1>Proof of Fair Weight</h1>
          <p className="rc-sub">Public Cryptographic Receipt</p>
        </header>
        <div className="rc-banner rc-bad">
          {id ? `TRANSACTION #${id} NOT FOUND` : 'MISSING OR INVALID TRANSACTION ID'}
        </div>
      </main>
    );
  }
  return <Receipt initial={reading} />;
}
