/**
 * GT06-family packet decoder.
 *
 * Design rule for a test lab: never throw away bytes. Every decoded object
 * carries the raw hex, and any bytes a parser does not understand are kept in
 * `tailHex` so the real device's quirks are visible in the dashboard.
 */
import {
  ALARM_CODES,
  GSM_LEVELS,
  INFO_SUBTYPES,
  LANGUAGES,
  OBD_KEYS,
  PROTOCOL_NAMES,
  TERMINAL_ALARM_BITS,
  UPLOAD_MODES,
  VOLTAGE_LEVELS,
} from './constants.js';
import { hex } from './frame.js';

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  remaining() {
    return this.buf.length - this.pos;
  }
  need(n) {
    if (this.remaining() < n) throw new Error(`need ${n} byte(s) at offset ${this.pos}, only ${this.remaining()} left`);
  }
  u8() {
    this.need(1);
    return this.buf[this.pos++];
  }
  u16() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u24() {
    this.need(3);
    const v = this.buf.readUIntBE(this.pos, 3);
    this.pos += 3;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  u64() {
    this.need(8);
    const v = this.buf.readBigUInt64BE(this.pos);
    this.pos += 8;
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  bytes(n) {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  skip(n) {
    this.pos += Math.min(n, this.remaining());
  }
  rest() {
    return this.bytes(this.remaining());
  }
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;
const hex2 = (n) => '0x' + n.toString(16).padStart(2, '0').toUpperCase();

function readDateTime(r) {
  const [yy, mm, dd, hh, mi, ss] = r.bytes(6);
  if (mm === 0 || dd === 0) return null; // device without a fix yet
  const d = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 18-byte GPS block (time, sats, lat, lon, speed, course/status). */
function readGps(r) {
  const time = readDateTime(r);
  const lenSats = r.u8();
  const gpsLen = lenSats >> 4;
  const satellites = lenSats & 0x0f;
  const latRaw = r.u32();
  const lonRaw = r.u32();
  const speedKmh = r.u8();
  const cs = r.u16();
  const north = !!(cs & 0x0400);
  const west = !!(cs & 0x0800);
  let lat = latRaw / 30000 / 60;
  let lon = lonRaw / 30000 / 60;
  if (!north) lat = -lat;
  if (west) lon = -lon;
  if (gpsLen > 12) r.skip(gpsLen - 12); // vendor extension inside GPS block
  return {
    time,
    satellites,
    lat: round6(lat),
    lon: round6(lon),
    speedKmh,
    course: cs & 0x3ff,
    valid: !!(cs & 0x1000),
    differential: !!(cs & 0x2000),
    hemisphere: `${north ? 'N' : 'S'}${west ? 'W' : 'E'}`,
  };
}

const LBS_4G_TYPES = new Set([0xa0, 0xa1, 0xa5]);

/** LBS block; `hasLength` when a 1-byte LBS length precedes it (alarm packets). */
function readLbs(r, type, { hasLength = false } = {}) {
  let declared = null;
  if (hasLength) {
    declared = r.u8();
    if (declared === 0) return null;
  }
  const start = r.pos;
  const mccRaw = r.u16();
  const twoByteMnc = !!(mccRaw & 0x8000);
  const mcc = mccRaw & 0x7fff;
  const mnc = twoByteMnc ? r.u16() : r.u8();
  let lac;
  let cid;
  if (LBS_4G_TYPES.has(type) || (declared != null && declared >= 15)) {
    lac = r.u32();
    cid = r.u64();
  } else {
    lac = r.u16();
    cid = r.u24();
  }
  const consumed = r.pos - start;
  if (declared != null && declared > consumed) r.skip(declared - consumed);
  return { mcc, mnc, lac, cid, mncBytes: twoByteMnc ? 2 : 1 };
}

export function decodeTerminalInfo(ti) {
  const alarmBits = (ti >> 3) & 0x7;
  return {
    raw: hex2(ti),
    relayCut: !!(ti & 0x80), // "oil and electricity disconnected"
    gpsTracking: !!(ti & 0x40),
    alarm: TERMINAL_ALARM_BITS[alarmBits] || `alarm_bits_${alarmBits}`,
    charging: !!(ti & 0x04),
    acc: !!(ti & 0x02), // ignition line high
    armed: !!(ti & 0x01),
  };
}

/** Status tail: terminalInfo, voltage (1 or 2 bytes), gsm, alarm, language — adaptive on length. */
function readStatus(r) {
  const n = r.remaining();
  const status = { terminal: decodeTerminalInfo(r.u8()) };
  if (n >= 6) {
    status.voltage = r.u16() / 100;
  } else {
    const lvl = r.u8();
    status.voltageLevel = lvl;
    status.voltageLevelName = VOLTAGE_LEVELS[lvl] || `level_${lvl}`;
  }
  if (r.remaining() >= 1) {
    const g = r.u8();
    status.gsm = g;
    status.gsmName = GSM_LEVELS[g] || `level_${g}`;
  }
  if (r.remaining() >= 1) {
    const a = r.u8();
    status.alarmCode = hex2(a);
    status.alarm = ALARM_CODES[a] || `alarm_${hex2(a)}`;
  }
  if (r.remaining() >= 1) {
    const l = r.u8();
    status.language = LANGUAGES[l] || l;
  }
  return status;
}

function tail(r) {
  return r.remaining() ? { tailHex: hex(r.rest()) } : {};
}

// ---------------------------------------------------------------------------

function decodeLogin(r) {
  const idHex = r.bytes(8).toString('hex');
  const out = { kind: 'login', imei: idHex.length === 16 && idHex[0] === '0' ? idHex.slice(1) : idHex };
  if (r.remaining() >= 2) out.typeCode = '0x' + r.u16().toString(16).padStart(4, '0').toUpperCase();
  if (r.remaining() >= 2) {
    const tz = r.u16();
    const v = tz >> 4;
    const hours = Math.floor(v / 100) + (v % 100) / 60;
    out.timezoneHours = (tz & 0x8 ? -1 : 1) * hours;
    out.language = LANGUAGES[tz & 0x3] || tz & 0x3;
  }
  return { ...out, ...tail(r) };
}

function decodeLocation(r, type) {
  const gps = readGps(r);
  const out = { kind: 'location', gps };
  const minimalLbs = LBS_4G_TYPES.has(type) ? 2 + 1 + 4 + 8 : 2 + 1 + 2 + 3;
  if (r.remaining() >= minimalLbs) out.lbs = readLbs(r, type);
  if (r.remaining() >= 7) {
    out.acc = r.u8() > 0;
    const mode = r.u8();
    out.uploadMode = UPLOAD_MODES[mode] || hex2(mode);
    out.realtimeReupload = r.u8() > 0;
    out.mileageM = r.u32();
  } else if (r.remaining() >= 3) {
    out.acc = r.u8() > 0;
    const mode = r.u8();
    out.uploadMode = UPLOAD_MODES[mode] || hex2(mode);
    out.realtimeReupload = r.u8() > 0;
  }
  return { ...out, ...tail(r) };
}

function decodeLbsOnly(r, type) {
  const out = { kind: 'lbs' };
  out.time = readDateTime(r);
  out.lbs = readLbs(r, type);
  return { ...out, ...tail(r) };
}

function decodeHeartbeat(r) {
  return { kind: 'heartbeat', status: readStatus(r), ...tail(r) };
}

function decodeAlarm(r, type) {
  const out = { kind: 'alarm' };
  if (type !== 0x19) out.gps = readGps(r);
  out.lbs = readLbs(r, type, { hasLength: type !== 0x19 });
  if (r.remaining() >= 4) out.status = readStatus(r);
  out.alarm = out.status?.alarm;
  return { ...out, ...tail(r) };
}

function decodeStringInfo(r) {
  const cmdLen = r.u8();
  const serverFlag = r.u32();
  const textLen = Math.max(0, Math.min(cmdLen - 4, r.remaining()));
  const text = r.bytes(textLen).toString('latin1');
  const out = { kind: 'command_response', serverFlag, text };
  if (r.remaining() >= 2) out.language = LANGUAGES[r.u16()] || null;
  return { ...out, ...tail(r) };
}

function decodeOnlineCommandResponse(r) {
  const serverFlag = r.u32();
  const encoding = r.u8();
  const data = r.rest();
  const text = encoding === 2 ? data.swap16().toString('utf16le') : data.toString('latin1');
  return { kind: 'command_response', serverFlag, encoding: encoding === 2 ? 'utf16be' : 'ascii', text };
}

function decodeServerCommand(r) {
  const cmdLen = r.u8();
  const serverFlag = r.u32();
  const text = r.bytes(Math.max(0, Math.min(cmdLen - 4, r.remaining()))).toString('latin1');
  const out = { kind: 'server_command', serverFlag, text };
  if (r.remaining() >= 2) out.language = LANGUAGES[r.u16()] || null;
  return { ...out, ...tail(r) };
}

function decodeInfo(r) {
  const sub = r.u8();
  const out = { kind: 'info', subtype: hex2(sub), subtypeName: INFO_SUBTYPES[sub] || 'unknown' };
  switch (sub) {
    case 0x00:
      out.externalVoltage = r.u16() / 100;
      break;
    case 0x04:
    case 0x06:
    case 0x09: {
      out.text = r.rest().toString('latin1');
      // "ALM1=40;ALM2=4C;ALM3=00;STA1=00;DYD=01;SOS=...;CENTER=...;FENCE=...;ITV=..." style payloads
      const kv = {};
      for (const part of out.text.split(/[;,]/)) {
        const [k, ...v] = part.split('=');
        if (k && v.length) kv[k.trim()] = v.join('=').trim();
      }
      if (Object.keys(kv).length) out.fields = kv;
      return out;
    }
    case 0x0a: {
      out.imei = r.bytes(8).toString('hex').replace(/^0/, '');
      out.imsi = r.bytes(8).toString('hex').replace(/^0+/, '');
      out.iccid = r.bytes(10).toString('hex').replace(/f+$/i, '');
      break;
    }
    case 0x05:
    case 0x08:
      out.state = r.u8();
      break;
    default:
      break;
  }
  return { ...out, ...tail(r) };
}

function decodeObd(r) {
  const time = readDateTime(r);
  const text = r.rest().toString('latin1');
  const pairs = {};
  const parsed = {};
  for (const pair of text.split(',')) {
    const [k, v] = pair.split('=');
    if (!k || v === undefined) continue;
    pairs[k] = v;
    const key = parseInt(k.slice(0, 2), 10);
    const def = OBD_KEYS[key];
    if (!def) continue;
    if (def.string) parsed[def.name] = v;
    else if (/^[0-9a-f]+$/i.test(v)) parsed[def.name] = Math.round(parseInt(v, 16) * def.scale * 100) / 100;
  }
  return { kind: 'obd', time, text, pairs, parsed };
}

/**
 * Decode a parsed frame (from frame.js) into a normalized object.
 * Never throws: decode errors are reported in `error` with the raw hex kept.
 */
export function decodeFrame(frame) {
  const base = {
    type: frame.type,
    typeHex: hex2(frame.type),
    name: PROTOCOL_NAMES[frame.type] || 'unknown',
    ext: frame.ext,
    serial: frame.serial,
    crcOk: frame.crcOk,
    contentHex: hex(frame.content),
    rawHex: hex(frame.raw),
  };
  const r = new Reader(frame.content);
  try {
    // Server -> device acknowledgement: same protocol number, empty content.
    if (frame.content.length === 0 && frame.type !== 0x8a) {
      return { ...base, kind: 'ack', direction: 'server_to_device' };
    }
    // Server -> device time response (0x8A with 6-byte UTC date/time).
    if (frame.type === 0x8a && frame.content.length >= 6) {
      return { ...base, kind: 'time_response', direction: 'server_to_device', time: readDateTime(r), ...tail(r) };
    }
    switch (frame.type) {
      case 0x01:
        return { ...base, ...decodeLogin(r) };
      case 0x10:
      case 0x12:
      case 0x1e:
      case 0x22:
      case 0x2d:
      case 0x31:
      case 0x32:
      case 0x37:
      case 0xa0:
        return { ...base, ...decodeLocation(r, frame.type) };
      case 0x11:
      case 0xa1:
        return { ...base, ...decodeLbsOnly(r, frame.type) };
      case 0x13:
      case 0x23:
        return { ...base, ...decodeHeartbeat(r) };
      case 0x16:
      case 0x19:
      case 0x26:
      case 0x27:
      case 0xa5:
        return { ...base, ...decodeAlarm(r, frame.type) };
      case 0x8a:
        return { ...base, kind: 'time_request' };
      case 0x15:
        return { ...base, ...decodeStringInfo(r) };
      case 0x21:
        return { ...base, ...decodeOnlineCommandResponse(r) };
      case 0x80:
      case 0x81:
      case 0x82:
        return { ...base, ...decodeServerCommand(r) };
      case 0x94:
        return { ...base, ...decodeInfo(r) };
      case 0x8c:
        return { ...base, ...decodeObd(r) };
      default:
        return { ...base, kind: 'unknown', note: 'no decoder for this protocol number; content kept as hex' };
    }
  } catch (e) {
    return { ...base, kind: 'decode_error', error: String(e.message || e), consumed: r.pos };
  }
}
