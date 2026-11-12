// Single-item mass in grams (min, max).
export const UNIT_MASS_TABLE = {
  apple: { minG: 135, maxG: 200 },
  banana: { minG: 118, maxG: 180 },
  orange: { minG: 130, maxG: 250 },
  lemon: { minG: 70, maxG: 120 },
  onion: { minG: 110, maxG: 220 },
  potato: { minG: 140, maxG: 280 },
  tomato: { minG: 90, maxG: 180 },
  phone: { minG: 165, maxG: 245 },
  smartphone: { minG: 165, maxG: 245 },
  cellphone: { minG: 165, maxG: 245 },
  mouse: { minG: 60, maxG: 135 },
  bottle: { minG: 500, maxG: 600 },
  can: { minG: 330, maxG: 385 },
};

const NO_VERDICT = {
  detected_item: null,
  detected_count: null,
  expected_range_kg: null,
  visual_anomaly: false,
  vision_verdict: 'NO_VERDICT',
};

const PROMPT =
  'Look at the object(s) on this weighing scale. Identify the single primary item type (apple, banana, orange, lemon, onion, potato, tomato, phone, mouse, bottle, can, or unknown) and how many there are. Reply ONLY in this format: ITEM=<word> COUNT=<number>';

/** Asks a local Moondream (Ollama) what is on the scale and checks it against the measured weight. Never throws. */
export async function checkVisualMassAnomaly(jpegBuffer, measuredWeightKg) {
  try {
    const res = await fetch(process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'moondream:latest',
        prompt: PROMPT,
        images: [Buffer.from(jpegBuffer).toString('base64')],
        stream: false,
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return NO_VERDICT;
    const text = String((await res.json()).response || '');

    const itemMatch = /ITEM\s*[=:]\s*([a-z]+)/i.exec(text);
    const countMatch = /COUNT\s*[=:]\s*(\d+)/i.exec(text);
    let item = itemMatch ? itemMatch[1].toLowerCase() : null;
    if (!item || !UNIT_MASS_TABLE[item]) {
      const lower = text.toLowerCase();
      item = Object.keys(UNIT_MASS_TABLE).find((k) => new RegExp(`\\b${k}s?\\b`).test(lower)) || null;
    }
    const spec = item ? UNIT_MASS_TABLE[item] : null;
    if (!spec) return NO_VERDICT;

    const fallbackNum = /\b(\d+)\b/.exec(text);
    const rawCount = countMatch ? parseInt(countMatch[1], 10) : fallbackNum ? parseInt(fallbackNum[1], 10) : 1;
    const count = Math.min(Math.max(Number.isFinite(rawCount) ? rawCount : 1, 1), 100);
    const minKg = (spec.minG * count * 0.9) / 1000;
    const maxKg = (spec.maxG * count * 1.1) / 1000;
    const anomaly = measuredWeightKg < minKg || measuredWeightKg > maxKg;
    return {
      detected_item: item,
      detected_count: count,
      expected_range_kg: `${minKg.toFixed(2)}–${maxKg.toFixed(2)} kg`,
      visual_anomaly: anomaly,
      vision_verdict: anomaly ? 'VISUAL_MASS_ANOMALY' : 'PLAUSIBLE_MATCH',
    };
  } catch {
    return NO_VERDICT;
  }
}
