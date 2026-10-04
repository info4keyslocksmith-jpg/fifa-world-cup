/**
 * JT/T 808 frame builders.
 *
 * Platform side: general response (0x8001), register response (0x8100),
 * text message / online command (0x8300), location query (0x8201),
 * terminal control (0x8105), set / query parameters (0x8103 / 0x8104).
 * Device side (simulator + tests): register, auth, heartbeat, location,
 * batch, terminal general response, text report.
 */
import { FLAG, digitsToBcd, escapeBytes, xorChecksum } from './frame.js';

/** Text field encoder. Node has no GBK encoder; ASCII is identical in GBK, which covers command strings. */
function gbk(text) {
  return Buffer.from(String(text), 'latin1');
}

/**
 * Build a frame. `terminalId` is the digit string (12 or 20 digits), `version` null for 2013
 * framing or a number (e.g. 1) for 2019 framing with the version byte and 10-byte ID.
 */
export function buildFrame(msgId, terminalId, serial, body = Buffer.alloc(0), { version = null } = {}) {
  if (body.length > 0x3ff) throw new Error('body too long for a single JT808 frame (max 1023 bytes)');
  const is2019 = version != null;
  const header = Buffer.alloc(4 + (is2019 ? 1 : 0) + (is2019 ? 10 : 6) + 2);
  let o = 0;
  header.writeUInt16BE(msgId & 0xffff, o);
  o += 2;
  header.writeUInt16BE((body.length & 0x3ff) | (is2019 ? 0x4000 : 0), o);
  o += 2;
  if (is2019) header[o++] = version & 0xff;
  digitsToBcd(terminalId, is2019 ? 10 : 6).copy(header, o);
  o += is2019 ? 10 : 6;
  header.writeUInt16BE(serial & 0xffff, o);
  const payload = Buffer.concat([header, body]);
  const inner = Buffer.concat([payload, Buffer.from([xorChecksum(payload)])]);
  return Buffer.concat([Buffer.from([FLAG]), escapeBytes(inner), Buffer.from([FLAG])]);
}

// ---------------------------------------------------------------------------
// Platform -> terminal
// ---------------------------------------------------------------------------

/** 0x8001: replySerial(2) replyMsgId(2) result(1). Sent for almost every terminal message. */
export function buildGeneralResponse(terminalId, serial, replySerial, replyMsgId, result = 0, opts) {
  const b = Buffer.alloc(5);
  b.writeUInt16BE(replySerial & 0xffff, 0);
  b.writeUInt16BE(replyMsgId & 0xffff, 2);
  b[4] = result;
  return buildFrame(0x8001, terminalId, serial, b, opts);
}

/** 0x8100: replySerial(2) result(1) authCode(ASCII, only on success). */
export function buildRegisterResponse(terminalId, serial, replySerial, result = 0, authCode = '', opts) {
  const code = result === 0 ? Buffer.from(String(authCode), 'ascii') : Buffer.alloc(0);
  const b = Buffer.alloc(3 + code.length);
  b.writeUInt16BE(replySerial & 0xffff, 0);
  b[2] = result;
  code.copy(b, 3);
  return buildFrame(0x8100, terminalId, serial, b, opts);
}

/**
 * 0x8300 text message: flag(1) + text. MiCODUS carries SMS-style command strings
 * ("STATUS#", "TIMER,30#") in this message. flag bit0 emergency, bit2 display, bit3 TTS.
 */
export function buildTextMessage(terminalId, serial, text, { flag = 0x01, ...opts } = {}) {
  return buildFrame(0x8300, terminalId, serial, Buffer.concat([Buffer.from([flag]), gbk(text)]), opts);
}

/** 0x8201: ask for one position (device answers 0x0201). */
export function buildLocationQuery(terminalId, serial, opts) {
  return buildFrame(0x8201, terminalId, serial, Buffer.alloc(0), opts);
}

/** 0x8105 terminal control: command(1) + optional parameter string. 4 = reset, 5 = factory reset. */
export function buildTerminalControl(terminalId, serial, command, params = '', opts) {
  return buildFrame(0x8105, terminalId, serial, Buffer.concat([Buffer.from([command]), Buffer.from(params, 'ascii')]), opts);
}

/** 0x8104: query all parameters (device answers 0x0104). */
export function buildQueryParameters(terminalId, serial, opts) {
  return buildFrame(0x8104, terminalId, serial, Buffer.alloc(0), opts);
}

/** 0x8103: count(1) then [id(4) len(1) value]. values are Buffers or numbers (u32) or strings. */
export function buildSetParameters(terminalId, serial, params, opts) {
  const parts = [Buffer.from([params.length])];
  for (const { id, value } of params) {
    let v;
    if (Buffer.isBuffer(value)) v = value;
    else if (typeof value === 'number') {
      v = Buffer.alloc(4);
      v.writeUInt32BE(value >>> 0);
    } else v = Buffer.from(String(value), 'ascii');
    const h = Buffer.alloc(5);
    h.writeUInt32BE(id >>> 0, 0);
    h[4] = v.length;
    parts.push(h, v);
  }
  return buildFrame(0x8103, terminalId, serial, Buffer.concat(parts), opts);
}

/** 0x8109 time sync response: BCD YYMMDDhhmmss (UTC unless the device expects local). */
export function buildTimeSyncResponse(terminalId, serial, date = new Date(), opts) {
  return buildFrame(0x8109, terminalId, serial, encodeBcdTime(date), opts);
}

// ---------------------------------------------------------------------------
// Terminal -> platform (simulator / tests)
// ---------------------------------------------------------------------------

export function encodeBcdTime(date, tzHours = 0) {
  const d = new Date(date.getTime() + tzHours * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return Buffer.from(s, 'hex');
}

const fixed = (text, n) => {
  const b = Buffer.alloc(n);
  Buffer.from(String(text), 'ascii').copy(b, 0, 0, n);
  return b;
};

/**
 * 0x0100 register. 2013 layout: province(2) city(2) manufacturer(5) model(20) terminalId(7)
 * plateColor(1) plate. 2019 layout: manufacturer(11) model(30) terminalId(30).
 */
export function buildRegister(terminalId, serial, { province = 0, city = 0, manufacturer = 'MICOD', model = 'MV55G', terminalIdText = '', plateColor = 0, plate = '', version = null } = {}) {
  const is2019 = version != null;
  const parts = [Buffer.alloc(4)];
  parts[0].writeUInt16BE(province, 0);
  parts[0].writeUInt16BE(city, 2);
  parts.push(fixed(manufacturer, is2019 ? 11 : 5), fixed(model, is2019 ? 30 : 20), fixed(terminalIdText, is2019 ? 30 : 7), Buffer.from([plateColor]), gbk(plate));
  return buildFrame(0x0100, terminalId, serial, Buffer.concat(parts), { version });
}

export function buildAuth(terminalId, serial, code, opts) {
  return buildFrame(0x0102, terminalId, serial, Buffer.from(String(code), 'ascii'), opts);
}

export function buildHeartbeat(terminalId, serial, opts) {
  return buildFrame(0x0002, terminalId, serial, Buffer.alloc(0), opts);
}

/** 0x0001 terminal general response: replySerial(2) replyMsgId(2) result(1). */
export function buildTerminalGeneralResponse(terminalId, serial, replySerial, replyMsgId, result = 0, opts) {
  const b = Buffer.alloc(5);
  b.writeUInt16BE(replySerial & 0xffff, 0);
  b.writeUInt16BE(replyMsgId & 0xffff, 2);
  b[4] = result;
  return buildFrame(0x0001, terminalId, serial, b, opts);
}

/** 0x6006 text report (reply text to an 0x8300 command): encoding(1) + text. */
export function buildTextReport(terminalId, serial, text, opts) {
  return buildFrame(0x6006, terminalId, serial, Buffer.concat([Buffer.from([0x01]), Buffer.from(String(text), 'latin1')]), opts);
}

// additional-information item helpers
export const item = {
  u8: (id, v) => ({ id, value: Buffer.from([v & 0xff]) }),
  u16: (id, v) => {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v & 0xffff);
    return { id, value: b };
  },
  u32: (id, v) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v >>> 0);
    return { id, value: b };
  },
  str: (id, s) => ({ id, value: Buffer.from(String(s), 'ascii') }),
  raw: (id, buf) => ({ id, value: Buffer.from(buf) }),
};

export function encodeItems(items = []) {
  const parts = [];
  for (const { id, value } of items) {
    if (value.length > 255) throw new Error(`item 0x${id.toString(16)} too long`);
    parts.push(Buffer.from([id & 0xff, value.length]), value);
  }
  return Buffer.concat(parts);
}

/**
 * 0x0200 body: alarm(4) status(4) lat(4) lon(4) altitude(2) speed(2, 0.1 km/h) course(2) time(BCD6) + items.
 * `alarmBits` / `statusBits` are arrays of bit numbers; acc/valid/hemisphere are derived from lat/lon.
 */
export function encodeLocationBody({ time = new Date(), tzHours = 0, lat, lon, altitude = 0, speedKmh = 0, course = 0, acc = true, valid = true, alarmBits = [], statusBits = [], items = [] }) {
  let alarm = 0;
  for (const b of alarmBits) alarm |= 1 << b;
  let status = 0;
  for (const b of statusBits) status |= 1 << b;
  if (acc) status |= 1 << 0;
  if (valid) status |= 1 << 1;
  if (lat < 0) status |= 1 << 2;
  if (lon < 0) status |= 1 << 3;
  const b = Buffer.alloc(28);
  b.writeUInt32BE(alarm >>> 0, 0);
  b.writeUInt32BE(status >>> 0, 4);
  b.writeUInt32BE(Math.round(Math.abs(lat) * 1e6), 8);
  b.writeUInt32BE(Math.round(Math.abs(lon) * 1e6), 12);
  b.writeInt16BE(Math.round(altitude), 16);
  b.writeUInt16BE(Math.round(speedKmh * 10) & 0xffff, 18);
  b.writeUInt16BE(((Math.round(course) % 360) + 360) % 360, 20);
  encodeBcdTime(time, tzHours).copy(b, 22);
  return Buffer.concat([b, encodeItems(items)]);
}

export function buildLocation(terminalId, serial, loc, { msgId = 0x0200, ...opts } = {}) {
  return buildFrame(msgId, terminalId, serial, encodeLocationBody(loc), opts);
}

/** 0x0704 batch: count(2) type(1: 0 normal, 1 blind-zone supplement) then [len(2) body]. */
export function buildLocationBatch(terminalId, serial, locations, { type = 1, ...opts } = {}) {
  const parts = [Buffer.alloc(3)];
  parts[0].writeUInt16BE(locations.length, 0);
  parts[0][2] = type;
  for (const loc of locations) {
    const body = encodeLocationBody(loc);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(body.length);
    parts.push(len, body);
  }
  return buildFrame(0x0704, terminalId, serial, Buffer.concat(parts), opts);
}

/** Convenience: the MiCODUS OBD item set observed on the MV55G. */
export function micodusObdItems({ rpm, speedKmh, voltage, engineLoad, coolantC, fuelRateLph, intakeTempC, mafGps, mapKpa, throttle, odometerKm, fuelLevel, vin, dtcs, batteryPct, rssi, satellites, mileageKm } = {}) {
  const out = [];
  if (mileageKm != null) out.push(item.u32(0x01, Math.round(mileageKm * 10)));
  if (rssi != null) out.push(item.u8(0x30, rssi));
  if (satellites != null) out.push(item.u8(0x31, satellites));
  if (speedKmh != null) out.push(item.u16(0x80, Math.round(speedKmh)));
  if (rpm != null) out.push(item.u16(0x81, rpm));
  if (voltage != null) out.push(item.u16(0x82, Math.round(voltage * 10)));
  if (engineLoad != null) out.push(item.u8(0x83, engineLoad));
  if (coolantC != null) out.push(item.u8(0x84, coolantC + 40));
  if (fuelRateLph != null) out.push(item.u16(0x85, Math.round(fuelRateLph * 10)));
  if (intakeTempC != null) out.push(item.u8(0x86, intakeTempC + 40));
  if (mafGps != null) out.push(item.u16(0x87, Math.round(mafGps * 100)));
  if (mapKpa != null) out.push(item.u8(0x88, mapKpa));
  if (throttle != null) out.push(item.u8(0x89, throttle));
  if (odometerKm != null) out.push(item.u32(0x8c, Math.round(odometerKm * 10)));
  if (fuelLevel != null) out.push(item.u8(0x8e, fuelLevel));
  if (vin) out.push(item.str(0x94, vin));
  if (dtcs) out.push(item.str(0xa0, Array.isArray(dtcs) ? dtcs.join(',') : dtcs));
  if (batteryPct != null) out.push(item.u8(0xe1, batteryPct));
  return out;
}
