import { redirect } from 'next/navigation';
import { isAdmin } from '../../lib/auth.js';
import { supabase } from '../../lib/supabase.js';
import { expectedHash } from '../../lib/hash.js';
import { getLocalReadings, syncPendingToSupabase, withTimeout } from '../../lib/offlineSync.js';
import AutoRefresh from '../../components/AutoRefresh.js';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

function formatTime(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: process.env.DISPLAY_TZ || 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

export default async function Dashboard({ searchParams }) {
  if (!(await isAdmin())) redirect('/login');

  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp?.page ?? '1', 10) || 1);
  const tamperOnly = sp?.filter === 'tamper';
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Push anything saved while offline to Supabase as soon as the internet is back.
  await syncPendingToSupabase();

  const db = supabase();
  let listQuery = db
    .from('ledger')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);
  if (tamperOnly) listQuery = listQuery.eq('tamper_status', true);

  let list, totalQ, tamperQ, latestQ, photoQ;
  let offline = false;
  try {
    [list, totalQ, tamperQ, latestQ, photoQ] = await withTimeout(
      Promise.all([
        listQuery,
        db.from('ledger').select('*', { count: 'exact', head: true }),
        db.from('ledger').select('*', { count: 'exact', head: true }).eq('tamper_status', true),
        db.from('ledger').select('weight_kg').order('created_at', { ascending: false }).limit(1),
        db.from('ledger').select('id, weight_kg').not('photo_path', 'is', null).order('created_at', { ascending: false }).limit(1),
      ]),
      6000,
    );
    // supabase-js reports an unreachable server as an error object, not an exception.
    offline = !!list.error && /fetch failed|network|ENOTFOUND|ECONN|timed out/i.test(list.error.message || '');
  } catch {
    offline = true;
  }

  let dbError, rows, totalPages, total, breaches, latest, latestPhoto;
  if (offline) {
    // Cloud unreachable: show what is stored on this computer.
    const all = (await getLocalReadings())
      .map((r) => ({ ...r, photo_path: r.local_photo_file || (r.photo_uploaded ? r.photo_url : null) }))
      .filter((r) => !tamperOnly || r.tamper_status);
    dbError = null;
    rows = all.slice(from, to + 1);
    totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    total = all.length;
    breaches = all.filter((r) => r.tamper_status).length;
    latest = all[0];
    latestPhoto = all.find((r) => r.photo_path);
  } else {
    dbError = list.error && list.error.code !== 'PGRST103' ? list.error : null;
    rows = list.data ?? [];
    totalPages = Math.max(1, Math.ceil((list.count ?? 0) / PAGE_SIZE));
    total = totalQ.count ?? 0;
    breaches = tamperQ.count ?? 0;
    latest = latestQ.data?.[0];
    latestPhoto = photoQ.data?.[0];
  }
  const hrefFor = (p) => `/dashboard?page=${p}${tamperOnly ? '&filter=tamper' : ''}`;

  return (
    <main className="container">
      <AutoRefresh seconds={10} />

      <header className="topbar">
        <div>
          <h1>Proof of Fair Weight</h1>
          <p className="muted">Secure scale ledger</p>
        </div>
        <div className="actions">
          <a className="btn" href="/api/export">Download CSV</a>
          <form action="/api/logout" method="post">
            <button className="btn" type="submit">Log out</button>
          </form>
        </div>
      </header>

      {offline ? (
        <p className="muted small" role="status">
          Offline mode: showing readings stored on this computer. They sync to Supabase automatically when the internet returns.
        </p>
      ) : null}

      {dbError ? (
        <p className="error" role="alert">
          Cannot read the database. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your settings.
        </p>
      ) : null}

      <section className="cards" aria-label="Summary">
        <div className="card">
          <p className="muted">Latest weight</p>
          <p className="big">
            {latest ? Number(latest.weight_kg).toFixed(2) : '–'} <span className="unit">kg</span>
          </p>
          {latest ? (
            <p className="big">
              {Math.round(Number(latest.weight_kg) * 1000)} <span className="unit">g</span>
            </p>
          ) : null}
        </div>
        <div className="card">
          <p className="muted">Total readings stored</p>
          <p className="big">{total}</p>
        </div>
        <div className={breaches > 0 ? 'card card-alert' : 'card'}>
          <p className="muted">Tamper events</p>
          <p className="big">{breaches}</p>
        </div>
        <div className="card">
          <p className="muted">Latest photo</p>
          {latestPhoto ? (
            <a href={`/api/photos/${latestPhoto.id}`} target="_blank" rel="noreferrer">
              <img className="latest-photo" src={`/api/photos/${latestPhoto.id}`} alt={`Photo for reading ${latestPhoto.id}`} />
              <p className="muted small">#{latestPhoto.id} · {Number(latestPhoto.weight_kg).toFixed(2)} kg</p>
            </a>
          ) : (
            <p className="muted small photo-empty">No photos yet</p>
          )}
        </div>
      </section>

      <nav className="filters" aria-label="Filter">
        <a className={!tamperOnly ? 'chip active' : 'chip'} href="/dashboard">All readings</a>
        <a className={tamperOnly ? 'chip active' : 'chip'} href="/dashboard?filter=tamper">Tamper only</a>
        <span className="muted small">Updates every 10 seconds</span>
      </nav>

      <section className="table-wrap" aria-label="Ledger">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Time</th>
              <th>Photo</th>
              <th>Device</th>
              <th className="num">Weight (kg)</th>
              <th className="num">Weight (g)</th>
              <th>SHA-256 hash</th>
              <th>Integrity</th>
              <th>AI Visual Audit</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty">No readings to show yet.</td>
              </tr>
            ) : null}
            {rows.map((r) => {
              const ok = expectedHash(r.weight_kg) === String(r.data_hash).toUpperCase();
              return (
                <tr key={r.id} className={r.tamper_status ? 'row-tamper' : ''}>
                  <td className="nowrap">{r.id}</td>
                  <td className="nowrap">{formatTime(r.created_at)}</td>
                  <td>
                    {r.photo_path ? (
                      <a href={`/api/photos/${r.id}`} target="_blank" rel="noreferrer" title={`Photo SHA-256: ${r.photo_sha256 ?? ''}`}>
                        <img className="thumb" loading="lazy" src={`/api/photos/${r.id}`} alt={`Photo for reading ${r.id}`} />
                      </a>
                    ) : (
                      <span className="muted small">No photo</span>
                    )}
                  </td>
                  <td className="mono">{r.device_id}</td>
                  <td className="num strong">{Number(r.weight_kg).toFixed(2)}</td>
                  <td className="num strong">{Math.round(Number(r.weight_kg) * 1000)}</td>
                  <td className="mono hash">{r.data_hash}</td>
                  <td className="nowrap">
                    {ok ? <span className="good">Hash matches</span> : <span className="warn">Hash mismatch</span>}
                  </td>
                  <td>
                    {r.vision_verdict === 'VISUAL_MASS_ANOMALY' ? (
                      <span className="badge" style={{ background: 'rgba(251,191,36,0.15)', color: 'var(--amber)', borderColor: 'var(--amber)' }}>
                        ⚠️ Visual-Mass Anomaly ({r.detected_count}× {r.detected_item}: exp {r.expected_range_kg})
                      </span>
                    ) : r.vision_verdict === 'PLAUSIBLE_MATCH' ? (
                      <span className="badge" style={{ background: 'rgba(45,212,191,0.15)', color: '#2dd4bf', borderColor: '#2dd4bf' }}>
                        ✓ {r.detected_count}× {r.detected_item} ({r.expected_range_kg})
                      </span>
                    ) : (
                      <span className="muted small">No verdict</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {r.tamper_status ? <span className="badge badge-red">Tamper detected</span> : <span className="badge">Secure</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <footer className="pager">
        {page > 1 ? <a className="btn" href={hrefFor(page - 1)}>Newer</a> : <span />}
        <span className="muted small">Page {page} of {totalPages}</span>
        {page < totalPages ? <a className="btn" href={hrefFor(page + 1)}>Older</a> : <span />}
      </footer>
    </main>
  );
}
