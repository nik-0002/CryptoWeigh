// Sends one FAKE reading (plus a fake photo), like the ESP32 boards would.
// Usage:  node scripts/send-test.mjs <website-url> <DEVICE_API_KEY> [tamper]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [, , baseUrl, apiKey, mode] = process.argv;
if (!baseUrl || !apiKey) {
  console.log('Usage: node scripts/send-test.mjs <website-url> <DEVICE_API_KEY> [tamper]');
  process.exit(1);
}
const base = baseUrl.replace(/\/$/, '');

const weight = Math.round((0.5 + Math.random() * 4.5) * 100) / 100;
const hash = createHash('sha256').update(`${weight.toFixed(2)}kg`).digest('hex').toUpperCase();

const res = await fetch(`${base}/api/readings`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
  body: JSON.stringify({
    device_id: '0123456789ABCDEF01',
    weight_kg: weight,
    data_hash: hash,
    tamper_status: mode === 'tamper',
  }),
});
const body = await res.text();
console.log(`Reading ${weight.toFixed(2)} kg${mode === 'tamper' ? ' (TAMPER)' : ''} -> HTTP ${res.status} ${body}`);

if (res.status === 200) {
  const id = JSON.parse(body).id;
  const photo = readFileSync(new URL('./test.jpg', import.meta.url));
  const up = await fetch(`${base}/api/photos?reading_id=${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'X-API-Key': apiKey },
    body: photo,
  });
  console.log(`Photo for reading ${id} -> HTTP ${up.status} ${await up.text()}`);
}
