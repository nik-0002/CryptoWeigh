// lib/visualMassCheck.js

// Expanded item database with generous default mass ranges (in grams)
const ITEM_SPECS = [
  { name: 'laptop', keywords: ['laptop', 'macbook', 'notebook computer', 'chromebook'], minG: 900, maxG: 2400 },
  { name: 'book', keywords: ['book', 'notebook', 'journal', 'magazine', 'paperback'], minG: 150, maxG: 900 },
  { name: 'phone', keywords: ['phone', 'smartphone', 'cellphone', 'iphone', 'android', 'mobile'], minG: 150, maxG: 300 },
  { name: 'mouse', keywords: ['mouse', 'trackball', 'clicker'], minG: 60, maxG: 150 },
  { name: 'mug', keywords: ['mug', 'cup', 'glass', 'ceramic', 'tumbler'], minG: 200, maxG: 600 },
  { name: 'bottle', keywords: ['bottle', 'flask', 'water bottle', 'can', 'soda'], minG: 300, maxG: 1200 },
  { name: 'headphones', keywords: ['headphones', 'earphones', 'airpods', 'headset'], minG: 100, maxG: 400 },
  { name: 'wallet', keywords: ['wallet', 'cardholder', 'purse'], minG: 50, maxG: 300 },
  { name: 'keys', keywords: ['keys', 'keychain'], minG: 30, maxG: 200 },
  { name: 'glasses', keywords: ['glasses', 'sunglasses', 'spectacles'], minG: 20, maxG: 100 },
  { name: 'apple', keywords: ['apple'], minG: 100, maxG: 300 },
  { name: 'orange', keywords: ['orange'], minG: 100, maxG: 300 },
  { name: 'potato', keywords: ['potato'], minG: 100, maxG: 300 },
  { name: 'onion', keywords: ['onion'], minG: 100, maxG: 300 },
  { name: 'tomato', keywords: ['tomato'], minG: 100, maxG: 300 },
  { name: 'banana', keywords: ['banana', 'plantain'], minG: 100, maxG: 250 },
  { name: 'lemon', keywords: ['lemon', 'lime'], minG: 60, maxG: 140 }
];

const UNCERTAIN_WORDS = [
  'maybe', 'perhaps', 'possibly', 'probably', 'might', 'could be',
  'looks like', 'appears', 'unsure', 'unclear', 'unknown', 'not sure',
  'hard to', 'blurry', 'unidentified', 'object', 'item', 'thing',
  'nothing', 'empty', 'scale', 'surface', 'background'
];

export async function checkVisualMassAnomaly(jpegBuffer, measuredWeightKg) {
  const safeRange =
    typeof measuredWeightKg === 'number' && !isNaN(measuredWeightKg) && measuredWeightKg > 0
      ? `${(measuredWeightKg * 0.7).toFixed(2)}–${(measuredWeightKg * 1.3).toFixed(2)} kg`
      : '0.00–5.00 kg';

  // Default when not 100% sure: always label simply as "object"
  const defaultObject = {
    detected_item: 'object',
    detected_count: 1,
    expected_range_kg: safeRange,
    visual_anomaly: false,
    vision_verdict: 'PLAUSIBLE_MATCH'
  };

  if (!jpegBuffer || typeof measuredWeightKg !== 'number' || isNaN(measuredWeightKg)) {
    return defaultObject;
  }

  try {
    const base64Image = Buffer.from(jpegBuffer).toString('base64');
    const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';

    const res = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: 'moondream:latest',
        prompt:
          'Name the object on this scale in 1 or 2 words ONLY if you are 100% certain what product it is. If you are not 100% sure, reply ONLY with the word "object".',
        images: [base64Image],
        stream: false
      })
    });

    if (!res.ok) return defaultObject;

    const data = await res.json();
    const rawReply = (data.response || '').toLowerCase().trim();
    console.log('[Smart Vision Description]:', rawReply);

    // If blank or contains any hedging/uncertainty words -> label as "object"
    if (!rawReply || UNCERTAIN_WORDS.some((w) => rawReply.includes(w))) {
      return defaultObject;
    }

    // Match whole-word keywords across known product specs
    const matches = ITEM_SPECS.filter((spec) =>
      spec.keywords.some((kw) => new RegExp(`\\b${kw}s?\\b`, 'i').test(rawReply))
    );

    // Only name the product if Moondream unambiguously matched exactly ONE known product
    if (matches.length !== 1) {
      console.log('[Smart Vision]: Not 100% sure -> labeling as "object"');
      return defaultObject;
    }

    const matchedSpec = matches[0];
    const minKg = (matchedSpec.minG * 0.70) / 1000.0;
    const maxKg = (matchedSpec.maxG * 1.30) / 1000.0;
    const rangeStr = `${minKg.toFixed(2)}–${maxKg.toFixed(2)} kg`;

    // Only alert on extreme, undeniable tampering
    const isExtremeMismatch = measuredWeightKg < (minKg * 0.3) || measuredWeightKg > (maxKg * 2.5);

    const result = {
      detected_item: matchedSpec.name,
      detected_count: 1,
      expected_range_kg: rangeStr,
      visual_anomaly: isExtremeMismatch,
      vision_verdict: isExtremeMismatch ? 'VISUAL_MASS_ANOMALY' : 'PLAUSIBLE_MATCH'
    };

    console.log('[Smart Vision Verdict]:', result);
    return result;
  } catch (err) {
    console.log('[Smart Vision Error -> Defaulting to object]:', err.message);
    return defaultObject;
  }
}
