'use strict';
/**
 * Image dimensions as a browser reports them on an <img> (naturalWidth /
 * naturalHeight). Browsers apply JPEG EXIF orientation by default
 * (image-orientation: from-image), so orientations 5-8 swap the axes: a phone
 * photo stored sideways with orientation 6 measures as portrait. The backend
 * relies on this when it bakes the rotation into the pixels.
 *
 * Reads headers only. PNG, JPEG and WebP — the containers the generator accepts.
 * EXIF orientation is honoured for JPEG only.
 */

function measureImage(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504E47 && buf.readUInt32BE(4) === 0x0D0A1A0A) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    return measureJpeg(buf);
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return measureWebp(buf);
  }
  throw new Error('not a PNG, JPEG or WebP image');
}

function measureJpeg(buf) {
  let orientation = 1;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xFF) throw new Error('corrupt JPEG marker at byte ' + i);
    const marker = buf[i + 1];
    if (marker === 0xFF) { i++; continue; }                        // fill byte
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD8)) { i += 2; continue; } // no length
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xE1 && buf.toString('binary', i + 4, i + 10) === 'Exif\0\0') {
      orientation = exifOrientation(buf, i + 10, i + 2 + len) || orientation;
    }
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return orientation >= 5 && orientation <= 8
        ? { width: height, height: width }
        : { width: width, height: height };
    }
    i += 2 + len;
  }
  throw new Error('JPEG has no frame header');
}

// Orientation tag (0x0112) from IFD0 of the TIFF block at [start, end).
function exifOrientation(buf, start, end) {
  if (end > buf.length || start + 8 > end) return null;
  const order = buf.toString('ascii', start, start + 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = function(o) { return le ? buf.readUInt16LE(o) : buf.readUInt16BE(o); };
  const u32 = function(o) { return le ? buf.readUInt32LE(o) : buf.readUInt32BE(o); };
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function measureWebp(buf) {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
  }
  if (chunk === 'VP8L') {
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
    return {
      width: 1 + (((b1 & 0x3F) << 8) | b0),
      height: 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6))
    };
  }
  if (chunk === 'VP8X') {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  throw new Error('unknown WebP chunk ' + JSON.stringify(chunk));
}

module.exports = { measureImage };
