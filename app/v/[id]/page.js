import { getPublicReading } from '../../../lib/publicReading.js';
import { parseReadingId } from '../../../lib/photo.js';
import Receipt from '../../verify/Receipt.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proof of Fair Weight – Receipt', robots: { index: false } };

// The QR code on the scale points here. Renders the receipt directly: no redirects, no login.
export default async function ReceiptPage({ params }) {
  const id = parseReadingId((await params).id);
  if (!id) {
    return (
      <main className="rc-wrap">
        <header className="rc-head">
          <h1>Proof of Fair Weight</h1>
          <p className="rc-sub">Public Cryptographic Receipt</p>
        </header>
        <div className="rc-banner rc-bad">INVALID TRANSACTION ID</div>
      </main>
    );
  }
  return <Receipt id={id} initial={await getPublicReading(id)} />;
}
