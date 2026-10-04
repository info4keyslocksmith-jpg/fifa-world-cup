/**
 * JT/T 808 message decoder with the MiCODUS additions.
 *
 * Same rule as the GT06 decoder: never lose bytes. Every additional-information
 * item is listed with its raw hex next to the interpreted value, and anything
 * unparsed ends up in `tailHex`.
 */
import { ALARM_BITS, ITEM_NAMES, MSG_NAMES, PARAM_IDS, REGISTER_RESULTS, RESULT_CODES, STATUS_BITS, TERMINAL_CONTROL } from './constants.js';
import { bcdToDigits, hex } from './frame.js';

const hex2 = (n) => '0x' + n.toString(16).padStart(2, '0').toUpperCase();
const hex4 = (n) => '0x' + n.toString(16).padStart(4, '0').toUpperCase();
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

let gbkDecoder;
function textFrom(buf) {
  try {
    gbkDecoder ??= new TextDecoder('gbk');
    return gbkDecoder.decode(buf).replace(/\0+$/, '');
  } catch {
    return buf.toString('latin1').replace(/\0+$/, '');
  }
}
const ascii = (buf) => buf.toString('latin1').replace(/\0+$/, '').trim();

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
  i16() {
    this.need(2);
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n) {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  rest() {
    return this.bytes(this.remaining());
  }
}
const tail = (r) => (r.remaining() ? { tailHex: hex(r.rest()) } : {});

/** BCD YYMMDDhhmmss -> ISO string; tzHours is the offset the device uses (0 = UTC, 8 = China standard). */
export function decodeBcdTime(buf, tzHours = 0) {
  const s = bcdToDigits(buf);
  if (!/^\d{12}$/.test(s) || s === '000000000000') return { timeBcd: s, time: null };
  const [yy, mm, dd, hh, mi, ss] = [0, 2, 4, 6, 8, 10].map((i) => +s.slice(i, i + 2));
  const d = new Date(Date.UTC(2000 + yy, mm - 1, dd, hh, mi, ss) - tzHours * 3600 * 1000);
  return { timeBcd: s, time: Number.isNaN(d.getTime()) ? null : d.toISOString() };
}

function bitsOf(value, table) {
  const out = [];
  for (let i = 0; i < 32; i++) if (value & (1 << i)) out.push(table[i] || `bit${i}`);
  return out;
}

// ---------------------------------------------------------------------------
// Additional information items
// ---------------------------------------------------------------------------

/** True when `buf` looks like "content(1) + well-formed TLV sequence" (Traccar's 0x80 container). */
function looksLikeNestedContainer(buf) {
  if (buf.length < 4) return false;
  let i = 1;
  let count = 0;
  while (i + 2 <= buf.length) {
    const len = buf[i + 1];
    i += 2 + len;
    count++;
  }
  return i === buf.length && count >= 1;
}

function applyObdItem(id, v, obd, extras, notes) {
  const u8 = () => v[0];
  const u16 = () => v.readUInt16BE(0);
  const u32 = () => v.readUInt32BE(0);
  switch (id) {
    case 0x80:
      obd.obdSpeedKmh = v.length >= 2 ? u16() : u8();
      break;
    case 0x81:
      obd.rpm = v.length >= 2 ? u16() : u8();
      break;
    case 0x82:
      obd.externalVoltage = round((v.length >= 2 ? u16() : u8()) / 10, 1);
      break;
    case 0x83:
      obd.engineLoadPct = u8();
      break;
    case 0x84:
      obd.coolantC = u8() - 40;
      break;
    case 0x85:
      obd.fuelRateRaw = v.length >= 2 ? u16() : u8();
      obd.fuelRateLph = round(obd.fuelRateRaw / 10, 1); // MV55G capture; Traccar keeps the raw value
      break;
    case 0x86:
      obd.intakeTempC = u8() - 40;
      break;
    case 0x87:
      obd.mafGps = round((v.length >= 2 ? u16() : u8()) / 100, 2);
      break;
    case 0x88:
      obd.mapKpa = u8();
      break;
    case 0x89:
      obd.throttlePct = u8();
      break;
    case 0x8b:
      obd.vin = ascii(v);
      break;
    case 0x8c:
      obd.canOdometerKm = round(u32() / 10, 1);
      break;
    case 0x8d:
      obd.tripKm = v.length >= 2 ? u16() : u8();
      break;
    case 0x8e:
      obd.fuelLevelPct = u8();
      break;
    case 0x91: {
      const r = new Reader(v);
      obd.externalVoltage = round(r.u16() / 10, 1);
      obd.rpm = r.u16();
      obd.obdSpeedKmh = r.u8();
      obd.throttlePct = Math.round((r.u8() * 100) / 255);
      obd.engineLoadPct = Math.round((r.u8() * 100) / 255);
      obd.coolantC = r.u8() - 40;
      r.u16();
      obd.fuelRateLph = round(r.u16() / 100, 2);
      if (r.remaining() >= 10) {
        r.u16();
        r.u32();
        r.u16();
        obd.fuelUsedL = round(r.u16() / 100, 2);
      }
      break;
    }
    case 0x94:
      if (v.length) obd.vin = ascii(v);
      break;
    case 0xa0:
      obd.dtcs = ascii(v)
        .split(/[,\s]+/)
        .filter(Boolean);
      break;
    case 0xcc:
      extras.iccid = ascii(v);
      break;
    default:
      return false;
  }
  return true;
}

export function decodeItems(buf) {
  const items = [];
  const obd = {};
  const extras = {};
  const alarms = [];
  const notes = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const id = buf[i];
    const len = buf[i + 1];
    if (i + 2 + len > buf.length) {
      notes.push(`item ${hex2(id)} declares ${len} bytes but only ${buf.length - i - 2} remain`);
      items.push({ id, idHex: hex2(id), name: ITEM_NAMES[id] || 'unknown', len, hex: hex(buf.subarray(i + 2)), truncated: true });
      i = buf.length;
      break;
    }
    const v = buf.subarray(i + 2, i + 2 + len);
    i += 2 + len;
    const entry = { id, idHex: hex2(id), name: ITEM_NAMES[id] || 'unknown', len, hex: hex(v) };
    try {
      const u8 = () => v[0];
      const u16 = () => v.readUInt16BE(0);
      const u32 = () => v.readUInt32BE(0);
      switch (id) {
        case 0x01:
          extras.mileageKm = round(u32() / 10, 1);
          entry.value = extras.mileageKm;
          break;
        case 0x02: {
          const f = u16();
          if (f & 0x8000) extras.fuelLevelPct = f & 0x7fff;
          else extras.fuelL = round(f / 10, 1);
          entry.value = f & 0x8000 ? `${f & 0x7fff} %` : `${f / 10} L`;
          break;
        }
        case 0x03:
          extras.recordedSpeedKmh = round(u16() / 10, 1);
          entry.value = extras.recordedSpeedKmh;
          break;
        case 0x04:
          extras.alarmEventId = u16();
          entry.value = extras.alarmEventId;
          break;
        case 0x06:
          extras.batteryPct = u8();
          entry.value = extras.batteryPct;
          break;
        case 0x25:
          extras.extendedSignal = u32();
          entry.value = hex(v);
          break;
        case 0x2a:
          extras.ioStatus = u16();
          entry.value = hex(v);
          break;
        case 0x2b:
          extras.adc1 = round(u16() / 100, 2);
          if (v.length >= 4) extras.adc2 = round(v.readUInt16BE(2) / 100, 2);
          entry.value = [extras.adc1, extras.adc2].filter((x) => x != null).join(' / ');
          break;
        case 0x30:
          extras.rssi = u8();
          entry.value = extras.rssi;
          break;
        case 0x31:
          extras.satellites = u8();
          entry.value = extras.satellites;
          break;
        case 0x32:
          extras.gpsSatellites = u8();
          entry.value = extras.gpsSatellites;
          break;
        case 0x33:
          extras.beidouSatellites = u8();
          entry.value = extras.beidouSatellites;
          break;
        case 0x34:
          extras.glonassSatellites = u8();
          entry.value = extras.glonassSatellites;
          break;
        case 0x56:
          extras.batteryPct = u8() * 10;
          entry.value = extras.batteryPct;
          break;
        case 0x57: {
          const r = new Reader(v);
          const a = r.u16();
          const ext = { raw: hex(v), harshAcceleration: !!(a & (1 << 8)), harshBraking: !!(a & (1 << 9)), harshCornering: !!(a & (1 << 10)) };
          if (ext.harshAcceleration) alarms.push('harsh_acceleration');
          if (ext.harshBraking) alarms.push('harsh_braking');
          if (ext.harshCornering) alarms.push('harsh_cornering');
          if (r.remaining() >= 2) ext.switches = hex4(r.u16());
          if (r.remaining() >= 4) {
            const w = r.u32();
            ext.word = '0x' + w.toString(16).padStart(8, '0').toUpperCase();
            if (w & (1 << 16)) {
              ext.door = true;
              alarms.push('door');
            }
          }
          extras.alarmExtension = ext;
          entry.value = ext;
          break;
        }
        case 0x61:
          extras.powerVoltage = round(u16() / 100, 2);
          entry.value = extras.powerVoltage;
          break;
        case 0x68:
          extras.batteryPct = round(u16() / 100, 2);
          entry.value = extras.batteryPct;
          break;
        case 0x69:
          extras.batteryVoltage = round(u16() / 100, 2);
          entry.value = extras.batteryVoltage;
          break;
        case 0x80:
          if (looksLikeNestedContainer(v)) {
            entry.name = 'obd_container';
            entry.content = v[0];
            entry.nested = decodeItems(v.subarray(1));
            Object.assign(obd, entry.nested.obd);
            Object.assign(extras, entry.nested.extras);
            entry.value = entry.nested.items.map((x) => `${x.idHex}=${x.value ?? x.hex}`).join(' ');
          } else {
            applyObdItem(0x80, v, obd, extras, notes);
            entry.name = 'obd_speed';
            entry.value = obd.obdSpeedKmh;
          }
          break;
        case 0xac:
          extras.odometerM = u32();
          entry.value = extras.odometerM;
          break;
        case 0xd3:
          extras.powerVoltage = round(u16() / 10, 1);
          entry.value = extras.powerVoltage;
          break;
        case 0xe1:
          if (v.length === 1) {
            if (v[0] === 0xff) {
              extras.charging = true;
              entry.value = 'charging';
            } else {
              extras.backupBatteryPct = v[0];
              entry.value = v[0];
            }
          } else if (v.length === 2) {
            extras.powerVoltage = round(u16() / 10, 1);
            entry.value = extras.powerVoltage;
          } else entry.value = hex(v);
          break;
        default:
          if (applyObdItem(id, v, obd, extras, notes)) {
            const key = { 0x81: 'rpm', 0x82: 'externalVoltage', 0x83: 'engineLoadPct', 0x84: 'coolantC', 0x85: 'fuelRateLph', 0x86: 'intakeTempC', 0x87: 'mafGps', 0x88: 'mapKpa', 0x89: 'throttlePct', 0x8b: 'vin', 0x8c: 'canOdometerKm', 0x8d: 'tripKm', 0x8e: 'fuelLevelPct', 0x94: 'vin', 0xa0: 'dtcs', 0xcc: 'iccid' }[id];
            entry.value = key ? (obd[key] ?? extras[key]) : undefined;
            if (id === 0x91) entry.value = { ...obd };
          } else entry.value = hex(v);
      }
    } catch (e) {
      entry.error = String(e.message || e);
    }
    items.push(entry);
  }
  if (i < buf.length) notes.push(`${buf.length - i} trailing byte(s) after the last item: ${hex(buf.subarray(i))}`);
  return { items, obd, extras, alarms, notes };
}

// ---------------------------------------------------------------------------
// Location body
// ---------------------------------------------------------------------------

export function decodeLocationBody(body, { tzHours = 0 } = {}) {
  const r = new Reader(body);
  const alarmWord = r.u32();
  const status = r.u32();
  const latRaw = r.u32();
  const lonRaw = r.u32();
  const altitude = r.i16();
  const speedKmh = round(r.u16() / 10, 1);
  const course = r.u16();
  const { time, timeBcd } = decodeBcdTime(r.bytes(6), tzHours);
  let lat = latRaw / 1e6;
  let lon = lonRaw / 1e6;
  if (status & (1 << 2)) lat = -lat;
  if (status & (1 << 3)) lon = -lon;
  const out = {
    gps: { time, timeBcd, lat: round(lat, 6), lon: round(lon, 6), altitude, speedKmh, course, valid: !!(status & (1 << 1)), hemisphere: `${status & 4 ? 'S' : 'N'}${status & 8 ? 'W' : 'E'}` },
    status: { raw: '0x' + status.toString(16).padStart(8, '0').toUpperCase(), acc: !!(status & 1), positioned: !!(status & 2), stopped: !!(status & 16), fuelCut: !!(status & (1 << 10)), relayCut: !!(status & (1 << 11)), charging: !!(status & (1 << 26)), flags: bitsOf(status, STATUS_BITS) },
    alarmWord: '0x' + alarmWord.toString(16).padStart(8, '0').toUpperCase(),
    alarms: bitsOf(alarmWord, ALARM_BITS),
  };
  const decoded = decodeItems(r.rest());
  out.items = decoded.items;
  out.alarms.push(...decoded.alarms);
  if (Object.keys(decoded.obd).length) out.obd = decoded.obd;
  if (Object.keys(decoded.extras).length) out.extras = decoded.extras;
  if (decoded.extras.satellites != null) out.gps.satellites = decoded.extras.satellites;
  if (decoded.notes.length) out.notes = decoded.notes;
  return out;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function decodeRegister(r, version) {
  const is2019 = version != null;
  const out = { kind: 'register', province: r.u16(), city: r.u16() };
  out.manufacturer = ascii(r.bytes(is2019 ? 11 : 5));
  out.model = ascii(r.bytes(is2019 ? 30 : 20));
  out.terminalIdText = ascii(r.bytes(is2019 ? 30 : 7));
  if (r.remaining() >= 1) out.plateColor = r.u8();
  if (r.remaining() >= 1) out.plate = textFrom(r.rest());
  const m = `${out.model} ${out.terminalIdText} ${out.plate || ''}`.match(/\d{15}/);
  if (m) out.imei = m[0];
  return out;
}

function decodeParams(r) {
  const replySerial = r.u16(); // 0x0104 body: replySerial(2) count(1) [id(4) len(1) value]...
  const count = r.u8();
  const params = [];
  for (let i = 0; i < count && r.remaining() >= 5; i++) {
    const id = r.u32();
    const len = r.u8();
    const v = r.bytes(Math.min(len, r.remaining()));
    const name = PARAM_IDS[id] || 'unknown';
    let value;
    if ([0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0017, 0x0040, 0x0083].includes(id)) value = ascii(v);
    else if (v.length === 4) value = v.readUInt32BE(0);
    else if (v.length === 2) value = v.readUInt16BE(0);
    else if (v.length === 1) value = v[0];
    else value = hex(v);
    params.push({ id: hex4(id), name, value, hex: hex(v) });
  }
  return { kind: 'params', replySerial, count, params, ...tail(r) };
}

/**
 * Decode a parsed JT808 frame into a normalized object.
 * opts.tzHours: the offset the device applies to its BCD timestamps (0 = UTC).
 */
export function decodeFrame(frame, { tzHours = 0 } = {}) {
  const base = {
    protocol: 'jt808',
    msgId: frame.msgId,
    typeHex: hex4(frame.msgId),
    name: MSG_NAMES[frame.msgId] || 'unknown',
    terminalId: frame.terminalId,
    deviceId: frame.deviceId,
    serial: frame.serial,
    version: frame.version,
    subpackage: frame.subpackage,
    crcOk: frame.checksumOk,
    contentHex: hex(frame.body),
    rawHex: hex(frame.raw),
  };
  const r = new Reader(frame.body);
  try {
    switch (frame.msgId) {
      case 0x0001: {
        const replySerial = r.u16();
        const replyMsgId = r.u16();
        const result = r.u8();
        return { ...base, kind: 'terminal_response', replySerial, replyMsgId: hex4(replyMsgId), replyName: MSG_NAMES[replyMsgId] || 'unknown', result, resultName: RESULT_CODES[result] || result, ...tail(r) };
      }
      case 0x0002: {
        const out = { ...base, kind: 'heartbeat' };
        if (r.remaining() >= 3) {
          out.batteryPct = r.u8();
          out.rssi = r.u8();
          out.status = r.u8();
        }
        return { ...out, ...tail(r) };
      }
      case 0x0003:
        return { ...base, kind: 'logout' };
      case 0x0100:
        return { ...base, ...decodeRegister(r, frame.version) };
      case 0x0102:
        return { ...base, kind: 'auth', code: ascii(r.rest()) };
      case 0x0104:
        return { ...base, ...decodeParams(r) };
      case 0x0107: {
        const out = { ...base, kind: 'attributes', terminalType: hex4(r.u16()) };
        out.manufacturer = ascii(r.bytes(5));
        out.model = ascii(r.bytes(20));
        out.terminalIdText = ascii(r.bytes(7));
        out.iccid = bcdToDigits(r.bytes(10));
        if (r.remaining() >= 1) {
          const hl = r.u8();
          out.hardwareVersion = ascii(r.bytes(Math.min(hl, r.remaining())));
        }
        if (r.remaining() >= 1) {
          const fl = r.u8();
          out.firmwareVersion = ascii(r.bytes(Math.min(fl, r.remaining())));
        }
        if (r.remaining() >= 1) out.gnss = hex2(r.u8());
        if (r.remaining() >= 1) out.comms = hex2(r.u8());
        return { ...out, ...tail(r) };
      }
      case 0x0109:
        return { ...base, kind: 'time_sync_request' };
      case 0x0200:
      case 0x0202:
      case 0x0203:
        return { ...base, kind: 'location', ...decodeLocationBody(frame.body, { tzHours }) };
      case 0x0201: {
        const replySerial = r.u16();
        return { ...base, kind: 'location', replySerial, ...decodeLocationBody(r.rest(), { tzHours }) };
      }
      case 0x0704: {
        const count = r.u16();
        const batchType = r.u8();
        const positions = [];
        while (r.remaining() >= 2) {
          const len = r.u16();
          if (len === 0 || len > r.remaining()) break;
          positions.push(decodeLocationBody(r.bytes(len), { tzHours }));
        }
        return { ...base, kind: 'batch', count, batchType: batchType === 1 ? 'blind_zone_supplement' : 'normal', positions, ...tail(r) };
      }
      case 0x0900: {
        const type = r.u8();
        const data = r.rest();
        return { ...base, kind: 'transparent', dataType: hex2(type), dataHex: hex(data), text: ascii(data) };
      }
      case 0x6006: {
        const encoding = r.u8();
        return { ...base, kind: 'command_response', encoding, text: encoding === 2 ? Buffer.from(r.rest()).swap16().toString('utf16le') : textFrom(r.rest()) };
      }
      case 0x1300: {
        const replySerial = r.u16();
        const data = r.rest();
        return { ...base, kind: 'command_response', replySerial, text: Buffer.from(data).swap16().toString('utf16le').trim() };
      }
      case 0x0701: {
        return { ...base, kind: 'command_response', text: textFrom(r.rest()) };
      }
      // platform -> terminal (so the hex tool can explain our own frames)
      case 0x8001: {
        const replySerial = r.u16();
        const replyMsgId = r.u16();
        const result = r.u8();
        return { ...base, kind: 'ack', direction: 'server_to_device', replySerial, replyMsgId: hex4(replyMsgId), replyName: MSG_NAMES[replyMsgId] || 'unknown', result, resultName: RESULT_CODES[result] || result };
      }
      case 0x8100: {
        const replySerial = r.u16();
        const result = r.u8();
        return { ...base, kind: 'register_response', direction: 'server_to_device', replySerial, result, resultName: REGISTER_RESULTS[result] || result, authCode: ascii(r.rest()) };
      }
      case 0x8300: {
        const flag = r.u8();
        return { ...base, kind: 'server_command', direction: 'server_to_device', flag: hex2(flag), text: textFrom(r.rest()) };
      }
      case 0x8105: {
        const cmd = r.u8();
        return { ...base, kind: 'terminal_control', direction: 'server_to_device', command: cmd, commandName: TERMINAL_CONTROL[cmd] || cmd, params: ascii(r.rest()) };
      }
      case 0x8201:
      case 0x8104:
        return { ...base, kind: base.name, direction: 'server_to_device' };
      case 0x8103: {
        const count = r.u8();
        const params = [];
        for (let i = 0; i < count && r.remaining() >= 5; i++) {
          const id = r.u32();
          const len = r.u8();
          const v = r.bytes(Math.min(len, r.remaining()));
          params.push({ id: hex4(id), name: PARAM_IDS[id] || 'unknown', hex: hex(v), text: ascii(v) });
        }
        return { ...base, kind: 'set_parameters', direction: 'server_to_device', params };
      }
      case 0x8109:
        return { ...base, kind: 'time_sync_response', direction: 'server_to_device', ...decodeBcdTime(r.bytes(6), tzHours) };
      default:
        return { ...base, kind: 'unknown', note: 'no decoder for this message id; body kept as hex' };
    }
  } catch (e) {
    return { ...base, kind: 'decode_error', error: String(e.message || e), consumed: r.pos };
  }
}
