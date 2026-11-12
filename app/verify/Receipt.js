'use client';

import { useEffect, useState } from 'react';

const POLL_MS = 2000;
const MAX_MS = 15000;

const SYNC_MAX_MS = 5 * 60 * 1000;

export default function Receipt({ id, initial }) {
  const [r, setR] = useState(initial);
  const [gaveUp, setGaveUp] = useState(false);
  const [waiting, setWaiting] = useState(!initial?.has_photo);
  const [copied, setCopied] = useState(false);
  const [imgKey, setImgKey] = useState(0);

  // Reading not in the ledger yet (the scale may still be syncing): retry every 2 s.
  useEffect(() => {
    if (r) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/public-reading/${id}`, { cache: 'no-store' });
        if (res.ok) {
          setR(await res.json());
          clearInterval(timer);
          return;
        }
      } catch {}
      if (Date.now() - started >= SYNC_MAX_MS) {
        clearInterval(timer);
        setGaveUp(true);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [r, id]);

  // The ESP32-CAM uploads ~2-3 s after the reading exists: re-check every 2 s for up to 15 s.
  useEffect(() => {
    if (!r) return;
    if (r.has_photo) {
      setWaiting(false);
      return;
    }
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/public-reading/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const next = await res.json();
          if (next.has_photo) {
            setR(next);
            setImgKey((k) => k + 1);
            clearInterval(timer);
            return;
          }
        }
      } catch {}
      if (Date.now() - started >= MAX_MS) {
        clearInterval(timer);
        setWaiting(false);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [r?.id, r?.has_photo]);

  if (!r) {
    return (
      <main className="rc-wrap">
        <header className="rc-head">
          <h1>Proof of Fair Weight</h1>
          <p className="rc-sub">Public Cryptographic Receipt • Transaction #{id}</p>
        </header>
        <section className="rc-card rc-skel" aria-live="polite">
          <div className="rc-spin" />
          <p>Receipt #{id} — {gaveUp ? 'not found. Please rescan or try again later.' : 'Syncing with ledger...'}</p>
        </section>
      </main>
    );
  }

  const good = r.hash_ok && !r.tamper_status;
  const when = new Date(r.created_at).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'long',
    timeStyle: 'medium',
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(r.data_hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <main className="rc-wrap">
      <header className="rc-head">
        <h1>Proof of Fair Weight</h1>
        <p className="rc-sub">Public Cryptographic Receipt • Transaction #{r.id}</p>
      </header>

      <div className={good ? 'rc-banner rc-good' : 'rc-banner rc-bad'} role="status">
        {good ? 'VERIFIED FAIR WEIGHT — SHA-256 HASH MATCHES' : 'SECURITY ALERT — TAMPER OR HASH MISMATCH DETECTED'}
      </div>

      <section className="rc-card rc-hero">
        <p className="rc-label">Locked weight</p>
        <p className="rc-kg">{r.weight_kg.toFixed(2)} <span>kg</span></p>
        <p className="rc-g">{r.weight_g} g</p>
        <p className="rc-time">Locked at {when}</p>
      </section>

      <section className="rc-card">
        <p className="rc-label">Live item photo</p>
        {r.has_photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={imgKey} className="rc-photo" src={`/api/public-photo/${r.id}`} alt={`Photo of weighed item #${r.id}`} />
        ) : waiting ? (
          <div className="rc-skel" aria-live="polite">
            <div className="rc-spin" />
            <p>Capturing live camera proof...</p>
          </div>
        ) : (
          <p className="rc-muted">No photo was captured for this reading.</p>
        )}
      </section>

      <section className="rc-card">
        <p className="rc-label">Cryptographic proof details</p>
        <dl className="rc-dl">
          <dt>Hardware Chip ID (ATECC608A)</dt>
          <dd className="rc-mono">{r.device_id}</dd>
          <dt>Payload Hashed</dt>
          <dd className="rc-mono">&quot;{r.payload}&quot;</dd>
          <dt>Hardware SHA-256 Signature</dt>
          <dd className="rc-mono rc-hash">{r.data_hash}</dd>
        </dl>
        <button type="button" className="rc-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy Hash'}</button>
        <dl className="rc-dl">
          <dt>Security Status</dt>
          <dd className={r.tamper_status ? 'rc-red' : 'rc-green'}>{r.tamper_status ? 'Tamper Triggered' : 'Secure'}</dd>
        </dl>
      </section>
    </main>
  );
}
