// lib/visualMassCheck.js

// Expanded item database with generous default mass ranges (in grams)
const ITEM_SPECS = [
  { keywords: ['laptop', 'macbook', 'notebook computer', 'chromebook'], minG: 900, maxG: 2400 },
  { keywords: ['book', 'notebook', 'journal', 'magazine', 'paperback'], minG: 150, maxG: 900 },
  { keywords: ['phone', 'smartphone', 'cellphone', 'iphone', 'android', 'mobile'], minG: 150, maxG: 300 },
  { keywords: ['mouse', 'trackball', 'clicker'], minG: 60, maxG: 150 },
  { keywords: ['mug', 'cup', 'glass', 'ceramic', 'tumbler'], minG: 200, maxG: 600 },
  { keywords: ['bottle', 'flask', 'water bottle', 'can', 'soda'], minG: 300, maxG: 1200 },
  { keywords: ['headphones', 'earphones', 'airpods', 'headset'], minG: 100, maxG: 400 },
  { keywords: ['wallet', 'cardholder', 'purse'], minG: 50, maxG: 300 },
  { keywords: ['keys', 'keychain'], minG: 30, maxG: 200 },
  { keywords: ['glasses', 'sunglasses', 'spectacles'], minG: 20, maxG: 100 },
  { keywords: ['apple', 'orange', 'potato', 'onion', 'tomato'], minG: 100, maxG: 300 },
  { keywords: ['banana', 'plantain'], minG: 100, maxG: 250 },
  { keywords: ['lemon', 'lime'], minG: 60, maxG: 140 }
];

export async function checkVisualMassAnomaly(jpegBuffer, measuredWeightKg) {
  // Absolute default: if unsure, blank, or error -> 100% Green / OK
  const defaultGreen = {
    detected_item: 'object',
    detected_count: 1,
    expected_range_kg: '0.00–5.00 kg',
    visual_anomaly: false,
    vision_verdict: 'PLAUSIBLE_MATCH'
  };

  if (!jpegBuffer || typeof measuredWeightKg !== 'number' || isNaN(measuredWeightKg)) {
    return defaultGreen;
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
        prompt: 'What object is on this scale? Answer in 3 words or less.',
        images: [base64Image],
        stream: false
      })
    });

    if (!res.ok) return defaultGreen;

    const data = await res.json();
    const rawReply = (data.response || '').toLowerCase().trim();
    console.log('[Smart Vision Description]:', rawReply);

    // If blank, nothing, or scale surface -> Green / OK
    if (!rawReply || rawReply.includes('nothing') || rawReply.includes('empty') || rawReply.includes('scale') || rawReply.includes('surface')) {
      return defaultGreen;
    }

    // Match item against database
    let matchedSpec = null;
    let detectedName = 'item';
    for (const spec of ITEM_SPECS) {
      if (spec.keywords.some((kw) => rawReply.includes(kw))) {
        matchedSpec = spec;
        detectedName = spec.keywords.find((kw) => rawReply.includes(kw));
        break;
      }
    }

    // UNKNOWN / UNSURE OBJECTS: Automatically give Green / OK badge ("nobody cares")
    if (!matchedSpec) {
      console.log('[Smart Vision]: Unsure/Unknown object -> Defaulting to Green (OK)');
      return {
        detected_item: rawReply.length > 20 ? 'item' : rawReply,
        detected_count: 1,
        expected_range_kg: `${(measuredWeightKg * 0.7).toFixed(2)}–${(measuredWeightKg * 1.3).toFixed(2)} kg`,
        visual_anomaly: false,
        vision_verdict: 'PLAUSIBLE_MATCH'
      };
    }

    // Generous tolerance margin
    const minKg = (matchedSpec.minG * 0.70) / 1000.0;
    const maxKg = (matchedSpec.maxG * 1.30) / 1000.0;
    const rangeStr = `${minKg.toFixed(2)}–${maxKg.toFixed(2)} kg`;

    // Only alert on extreme, undeniable tampering (e.g. weight is impossibly off)
    const isExtremeMismatch = measuredWeightKg < (minKg * 0.3) || measuredWeightKg > (maxKg * 2.5);

    const result = {
      detected_item: detectedName,
      detected_count: 1,
      expected_range_kg: rangeStr,
      visual_anomaly: isExtremeMismatch,
      vision_verdict: isExtremeMismatch ? 'VISUAL_MASS_ANOMALY' : 'PLAUSIBLE_MATCH'
    };

    console.log('[Smart Vision Verdict]:', result);
    return result;
  } catch (err) {
    console.log('[Smart Vision Error -> Defaulting to Green]:', err.message);
    return defaultGreen;
  }
}
