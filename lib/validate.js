import { expectedHash } from './hash.js';

/**
 * Checks the JSON sent by the ESP32.
 * Returns { ok: true, data } or { ok: false, status, message }.
 */
export function validateReading(body, { verifyHash = true, allowedDevices = [] } = {}) {
  const bad = (message, status = 400) => ({ ok: false, status, message });

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('Body must be a JSON object.');
  }
  for (const f of ['device_id', 'weight_kg', 'data_hash', 'tamper_status']) {
    if (!(f in body)) return bad(`Missing field: ${f}`);
  }
  const { device_id, weight_kg, data_hash, tamper_status } = body;

  if (typeof device_id !== 'string' || !/^[0-9A-Fa-f]{8,32}$/.test(device_id)) {
    return bad('device_id must be 8-32 hex characters.');
  }
  const deviceId = device_id.toUpperCase();
  if (allowedDevices.length > 0 && !allowedDevices.includes(deviceId)) {
    return bad('Device not allowed.', 403);
  }

  if (typeof weight_kg !== 'number' || !Number.isFinite(weight_kg)) {
    return bad('weight_kg must be a number.');
  }
  const weight = Math.round(weight_kg * 100) / 100;
  if (weight < 0 || weight > 999.99) {
    return bad('weight_kg must be between 0 and 999.99.');
  }

  if (typeof data_hash !== 'string' || !/^[0-9A-Fa-f]{64}$/.test(data_hash)) {
    return bad('data_hash must be a 64-character SHA-256 hex string.');
  }
  const hash = data_hash.toUpperCase();

  if (typeof tamper_status !== 'boolean') {
    return bad('tamper_status must be true or false.');
  }

  if (verifyHash && expectedHash(weight) !== hash) {
    return bad('data_hash does not match weight_kg.');
  }

  return {
    ok: true,
    data: { device_id: deviceId, weight_kg: weight, data_hash: hash, tamper_status },
  };
}
