export const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB (an ESP32-CAM VGA photo is ~30-80 KB)

/** A JPEG file always starts with the bytes FF D8 FF. */
export function isJpeg(buf) {
  return !!buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** Turns "123" into 123. Anything else returns null. */
export function parseReadingId(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,15}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
