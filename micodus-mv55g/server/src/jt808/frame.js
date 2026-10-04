/**
 * JT/T 808 framing.
 *
 *   7E | msgId(2) | props(2) | [version(1) if props bit14] | terminalId(6 BCD, 10 if 2019) | serial(2)
 *      | [totalPackages(2) packageIndex(2) if props bit13] | body(props bits 0-9) | xor(1) | 7E
 *
 *   Everything between the delimiters is escaped: 0x7E -> 0x7D 0x02, 0x7D -> 0x7D 0x01.
 *   The checksum is the XOR of header + body (before escaping).
 *
 *   MiCODUS MV55G: terminal ID is 12 BCD digits = "0" + the 11-digit ID printed on the device
 *   (not the IMEI). Platforms usually accept both the padded and the stripped form.
 */

export const FLAG = 0x7e;
export const ESC = 0x7d;

export function escapeBytes(buf) {
  let extra = 0;
  for (const b of buf) if (b === FLAG || b === ESC) extra++;
  const out = Buffer.alloc(buf.length + extra);
  let o = 0;
  for (const b of buf) {
    if (b === FLAG) {
      out[o++] = ESC;
      out[o++] = 0x02;
    } else if (b === ESC) {
      out[o++] = ESC;
      out[o++] = 0x01;
    } else out[o++] = b;
  }
  return out;
}

/** Returns the unescaped buffer, or null when an invalid escape sequence is found. */
export function unescapeBytes(buf) {
  const out = Buffer.alloc(buf.length);
  let o = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === ESC) {
      const n = buf[++i];
      if (n === 0x01) out[o++] = ESC;
      else if (n === 0x02) out[o++] = FLAG;
      else return null;
    } else out[o++] = b;
  }
  return out.subarray(0, o);
}

export function xorChecksum(buf, start = 0, end = buf.length) {
  let x = 0;
  for (let i = start; i < end; i++) x ^= buf[i];
  return x & 0xff;
}

/** BCD buffer -> digit string, leading zeros kept ("012345678901"). */
export function bcdToDigits(buf) {
  let s = '';
  for (const b of buf) s += ((b >> 4) & 0xf).toString(16) + (b & 0xf).toString(16);
  return s;
}

/** Digit string -> BCD buffer of `bytes` bytes, left-padded with zeros. */
export function digitsToBcd(str, bytes) {
  const digits = String(str).replace(/\D/g, '');
  if (digits.length > bytes * 2) throw new Error(`"${str}" does not fit in ${bytes} BCD bytes`);
  return Buffer.from(digits.padStart(bytes * 2, '0'), 'hex');
}

export function hex(buf) {
  return Buffer.from(buf)
    .toString('hex')
    .toUpperCase()
    .replace(/(..)/g, '$1 ')
    .trim();
}

/**
 * Parse one complete raw frame (including both 0x7E delimiters).
 * Returns null when the frame is structurally invalid; sets checksumOk=false on a bad XOR.
 */
export function parseFrame(raw) {
  if (raw.length < 2 + 12 + 1 || raw[0] !== FLAG || raw[raw.length - 1] !== FLAG) return null;
  const inner = unescapeBytes(raw.subarray(1, raw.length - 1));
  if (!inner || inner.length < 13) return null;
  const checksum = inner[inner.length - 1];
  const payload = inner.subarray(0, inner.length - 1);
  const checksumCalc = xorChecksum(payload);
  const msgId = payload.readUInt16BE(0);
  const props = payload.readUInt16BE(2);
  const bodyLength = props & 0x03ff;
  const encryption = (props >> 10) & 0x7;
  const subpackaged = !!(props & 0x2000);
  const is2019 = !!(props & 0x4000);
  let o = 4;
  const version = is2019 ? payload[o++] : null;
  const idLen = is2019 ? 10 : 6;
  if (payload.length < o + idLen + 2) return null;
  const terminalId = bcdToDigits(payload.subarray(o, o + idLen));
  o += idLen;
  const serial = payload.readUInt16BE(o);
  o += 2;
  let subpackage = null;
  if (subpackaged) {
    if (payload.length < o + 4) return null;
    subpackage = { total: payload.readUInt16BE(o), index: payload.readUInt16BE(o + 2) };
    o += 4;
  }
  const body = payload.subarray(o, o + bodyLength);
  return {
    protocol: 'jt808',
    msgId,
    props,
    bodyLength,
    bodyLengthActual: body.length,
    encryption,
    version,
    terminalId,
    deviceId: terminalId.replace(/^0+/, '') || '0',
    serial,
    subpackage,
    body,
    checksum,
    checksumCalc,
    checksumOk: checksum === checksumCalc,
    raw,
  };
}

/**
 * Incremental stream splitter for 0x7E-delimited frames.
 * Bytes before the first delimiter are counted as garbage; partial frames are buffered.
 */
export class FrameParser {
  constructor({ maxBuffer = 64 * 1024 } = {}) {
    this.buf = Buffer.alloc(0);
    this.maxBuffer = maxBuffer;
    this.garbage = 0;
    this.invalid = 0; // delimited chunks that were not parseable frames
  }

  feed(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      const start = this.buf.indexOf(FLAG);
      if (start < 0) {
        this.garbage += this.buf.length;
        this.buf = Buffer.alloc(0);
        break;
      }
      if (start > 0) {
        this.garbage += start;
        this.buf = this.buf.subarray(start);
      }
      const end = this.buf.indexOf(FLAG, 1);
      if (end < 0) {
        if (this.buf.length > this.maxBuffer) {
          this.garbage += this.buf.length;
          this.buf = Buffer.alloc(0);
        }
        break; // wait for the closing delimiter
      }
      if (end === 1) {
        // "7E 7E": the closing delimiter of the previous frame followed by the next start
        this.buf = this.buf.subarray(1);
        continue;
      }
      const raw = Buffer.from(this.buf.subarray(0, end + 1));
      this.buf = this.buf.subarray(end + 1);
      const frame = parseFrame(raw);
      if (frame) frames.push(frame);
      else this.invalid++;
    }
    return frames;
  }
}

export function splitFrames(buf) {
  const p = new FrameParser();
  const frames = p.feed(buf);
  return { frames, garbage: p.garbage, invalid: p.invalid, leftover: p.buf.length };
}
