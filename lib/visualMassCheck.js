// lib/visualMassCheck.js

// Unit-mass table in grams per single item
const UNIT_MASS_TABLE = {
  apple:      { minG: 135, maxG: 200 },
  banana:     { minG: 118, maxG: 180 },
  orange:     { minG: 130, maxG: 250 },
  lemon:      { minG: 70,  maxG: 120 },
  onion:      { minG: 110, maxG: 220 },
  potato:     { minG: 140, maxG: 280 },
  tomato:     { minG: 90,  maxG: 180 },
  phone:      { minG: 165, maxG: 245 }, // Great for testing on your desk!
  smartphone: { minG: 165, maxG: 245 },
  cellphone:  { minG: 165, maxG: 245 },
  mouse:      { minG: 60,  maxG: 135 }, // Great for testing on your desk!
  bottle:     { minG: 500, maxG: 600 }, // 500ml water bottle
  can:        { minG: 330, maxG: 385 }
};

const WORD_TO_NUM = {
  a: 1, an: 1, single: 1, one: 1,
  two: 2, pair: 2, couple: 2,
  three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

export async function checkVisualMassAnomaly(jpegBuffer, measuredWeightKg) {
  const noVerdict = {
    detected_item: null,
    detected_count: null,
    expected_range_kg: null,
    visual_anomaly: false,
    vision_verdict: 'NO_VERDICT'
  };

  if (!jpegBuffer || typeof measuredWeightKg !== 'number' || isNaN(measuredWeightKg)) {
    return noVerdict;
  }

  try {
    const base64Image = Buffer.from(jpegBuffer).toString('base64');
    const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';

    const res = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        model: 'moondream:latest',
        prompt: 'What objects are sitting on this scale and how many are there? Describe briefly in one sentence.',
        images: [base64Image],
        stream: false
      })
    });

    if (!res.ok) return noVerdict;

    const data = await res.json();
    const rawReply = (data.response || '').toLowerCase().trim();
    console.log('[Moondream On-Device Vision]:', rawReply);

    if (!rawReply) return noVerdict;

    // 1. Detect item from unit-mass table (handles plurals like "apples" via .includes)
    let matchedKey = null;
    for (const key of Object.keys(UNIT_MASS_TABLE)) {
      if (rawReply.includes(key)) {
        matchedKey = (key === 'smartphone' || key === 'cellphone') ? 'phone' : key;
        break;
      }
    }

    if (!matchedKey) {
      return noVerdict; // Unknown item -> advisory gives no verdict
    }

    // 2. Extract count (checks digits first, then number words like "three")
    let count = 1;
    const digitMatch = rawReply.match(/\b(\d+)\b/);
    if (digitMatch) {
      count = Math.max(1, Math.min(20, parseInt(digitMatch[1], 10)));
    } else {
      for (const [word, num] of Object.entries(WORD_TO_NUM)) {
        if (new RegExp(`\\b${word}\\b`, 'i').test(rawReply)) {
          count = num;
          break;
        }
      }
    }

    // 3. Compute expected range with 10% tolerance
    const spec = UNIT_MASS_TABLE[matchedKey];
    const minKg = (spec.minG * count * 0.90) / 1000.0;
    const maxKg = (spec.maxG * count * 1.10) / 1000.0;
    const rangeStr = `${minKg.toFixed(2)}–${maxKg.toFixed(2)} kg`;

    const isAnomaly = measuredWeightKg < minKg || measuredWeightKg > maxKg;

    return {
      detected_item: matchedKey,
      detected_count: count,
      expected_range_kg: rangeStr,
      visual_anomaly: isAnomaly,
      vision_verdict: isAnomaly ? 'VISUAL_MASS_ANOMALY' : 'PLAUSIBLE_MATCH'
    };
  } catch (err) {
    console.log('[Vision Check Skipped Safely]:', err.message);
    return noVerdict;
  }
}
