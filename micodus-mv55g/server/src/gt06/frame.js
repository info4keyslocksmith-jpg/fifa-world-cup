/**
 * GT06-family frame handling.
 *
 *   Basic frame     : 78 78 | len(1) | proto(1) | content(len-5) | serial(2) | crc(2) | 0D 0A
 *   Extended frame  : 79 79 | len(2) | proto(1) | content(len-5) | serial(2) | crc(2) | 0D 0A
 *
 *   len   = 1 (proto) + N (content) + 2 (serial) + 2 (crc)
 *   crc   = CRC-16/X-25 over [len .. serial]  (start bytes excluded)
 */
import { crc16X25 } from './crc.js';

/** Upper-case, space-separated hex dump. */
export function hex(buf) {
  return Buffer.from(buf)
    .toString('hex')
    .toUpperCase()
    .replace(/(..)/g, '$1 ')
    .trim();
}

/** Parse hex text (spaces, 0x prefixes and punctuation tolerated). */
export function fromHex(text) {
  const clean = String(text)
    .replace(/0x/gi, '')
    .replace(/[^0-9a-fA-F]/g, '');
  return Buffer.from(clean.length % 2 ? clean + '0' : clean, 'hex');
}

function findStart(buf, from = 0) {
  for (let i = from; i + 1 < buf.length; i++) {
    const a = buf[i];
    if ((a === 0x78 || a === 0x79) && buf[i + 1] === a) return i;
  }
  return -1;
}

/** Index of the first start marker (at or after `from`) that begins a complete, CRC-valid frame, or -1. */
function findValidFrameStart(buf, from) {
  for (let i = findStart(buf, from); i >= 0; i = findStart(buf, i + 1)) {
    const ext = buf[i] === 0x79;
    const lenBytes = ext ? 2 : 1;
    if (buf.length < i + 2 + lenBytes) return -1;
    const length = ext ? buf.readUInt16BE(i + 2) : buf[i + 2];
    const total = 2 + lenBytes + length + 2;
    if (length < 5 || buf.length < i + total) continue;
    if (buf[i + total - 2] !== 0x0d || buf[i + total - 1] !== 0x0a) continue;
    const crcIdx = i + 2 + lenBytes + length - 2;
    if (crc16X25(buf, i + 2, crcIdx) === buf.readUInt16BE(crcIdx)) return i;
  }
  return -1;
}

/**
 * Parse one complete frame (from start marker to stop marker).
 * Does not throw on a bad CRC; sets crcOk=false so the caller can decide.
 */
export function parseFrame(raw) {
  const ext = raw[0] === 0x79;
  const lenBytes = ext ? 2 : 1;
  const length = ext ? raw.readUInt16BE(2) : raw[2];
  const typeIdx = 2 + lenBytes;
  const crcIdx = typeIdx + length - 2;
  const serialIdx = crcIdx - 2;
  return {
    ext,
    length,
    type: raw[typeIdx],
    content: raw.subarray(typeIdx + 1, serialIdx),
    serial: raw.readUInt16BE(serialIdx),
    crc: raw.readUInt16BE(crcIdx),
    crcCalc: crc16X25(raw, 2, crcIdx),
    get crcOk() {
      return this.crc === this.crcCalc;
    },
    raw,
  };
}

/**
 * Incremental stream splitter. Feed TCP chunks, get complete frames back.
 * Garbage between frames is skipped and counted; partial frames are buffered.
 */
export class FrameParser {
  constructor({ maxBuffer = 64 * 1024 } = {}) {
    this.buf = Buffer.alloc(0);
    this.maxBuffer = maxBuffer;
    this.garbage = 0;
  }

  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      const idx = findStart(this.buf);
      if (idx < 0) {
        // keep the last byte: it may be the first half of a start marker
        const keep = this.buf.length ? 1 : 0;
        this.garbage += this.buf.length - keep;
        this.buf = this.buf.subarray(this.buf.length - keep);
        break;
      }
      if (idx > 0) {
        this.garbage += idx;
        this.buf = this.buf.subarray(idx);
      }
      const ext = this.buf[0] === 0x79;
      const lenBytes = ext ? 2 : 1;
      if (this.buf.length < 2 + lenBytes) break; // need the length field
      const length = ext ? this.buf.readUInt16BE(2) : this.buf[2];
      if (length < 5) {
        // cannot hold proto + serial + crc: this was not a start marker
        this.garbage += 2;
        this.buf = this.buf.subarray(2);
        continue;
      }
      const total = 2 + lenBytes + length + 2;
      if (this.buf.length < total) {
        // Incomplete candidate. If a later start marker already yields a complete,
        // CRC-valid frame, the candidate was a stray 0x78/0x79 byte: skip to it.
        const alt = findValidFrameStart(this.buf, 1);
        if (alt > 0) {
          this.garbage += alt;
          this.buf = this.buf.subarray(alt);
          continue;
        }
        if (this.buf.length > this.maxBuffer) {
          this.garbage += this.buf.length;
          this.buf = Buffer.alloc(0);
        }
        break; // wait for more data
      }
      const stopOk = this.buf[total - 2] === 0x0d && this.buf[total - 1] === 0x0a;
      if (!stopOk) {
        // false start marker inside payload or corrupted stream: resync
        this.garbage += 2;
        this.buf = this.buf.subarray(2);
        continue;
      }
      frames.push(parseFrame(Buffer.from(this.buf.subarray(0, total))));
      this.buf = this.buf.subarray(total);
    }
    return frames;
  }
}

/** Convenience: split a complete buffer (e.g. a pasted capture) into frames. */
export function splitFrames(buf) {
  const p = new FrameParser();
  const frames = p.feed(buf);
  return { frames, garbage: p.garbage, leftover: p.buf.length };
}
