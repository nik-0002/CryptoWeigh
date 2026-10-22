import { createHash } from 'node:crypto';

// Exactly what the ESP32 hashes: the text "1.50kg"
export function expectedHash(weight) {
  return createHash('sha256')
    .update(`${Number(weight).toFixed(2)}kg`)
    .digest('hex')
    .toUpperCase();
}
