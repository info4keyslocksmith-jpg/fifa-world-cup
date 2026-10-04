/**
 * GT06-family frame builders.
 *
 * Server-side: ACKs, time response, online commands (0x80).
 * Device-side: login, location, heartbeat, alarm, info, OBD, string reply
 * (used by the simulator and the tests).
 */
import { crc16X25 } from './crc.js';

export function buildFrame(type, content = Buffer.alloc(0), serial = 1, { ext = false } = {}) {
  const length = 1 + content.length + 2 + 2;
  const useExt = ext || length > 0xff;
  const lenBytes = useExt ? 2 : 1;
  const buf = Buffer.alloc(2 + lenBytes + length + 2);
  let o = 0;
  buf[o++] = useExt ? 0x79 : 0x78;
  buf[o++] = useExt ? 0x79 : 0x78;
  if (useExt) {
    buf.writeUInt16BE(length, o);
    o += 2;
  } else {
    buf[o++] = length;
  }
  buf[o++] = type;
  content.copy(buf, o);
  o += content.length;
  buf.writeUInt16BE(serial & 0xffff, o);
  o += 2;
  buf.writeUInt16BE(crc16X25(buf, 2, o), o);
  o += 2;
  buf[o++] = 0x0d;
  buf[o++] = 0x0a;
  return buf;
}

// ---------------------------------------------------------------------------
// Server -> device
// ---------------------------------------------------------------------------

/** Generic ACK: same protocol number, same serial, empty content. */
export function buildAck(type, serial) {
  return buildFrame(type, Buffer.alloc(0), serial);
}

/** Reply to a 0x8A time request with UTC date/time. */
export function buildTimeResponse(serial, date = new Date()) {
  return buildFrame(0x8a, encodeDateTime(date), serial);
}

/**
 * Online command (0x80):
 *   content = cmdLen(1 = 4 + M) | serverFlag(4) | command(M ASCII) | language(2, optional)
 * Language 0x0002 = English. Some firmware ignores it, some requires it.
 */
export function buildCommand(command, serial, { serverFlag = 0, language = 0x0002, includeLanguage = true } = {}) {
  const cmd = Buffer.from(command, 'ascii');
  const c = Buffer.alloc(1 + 4 + cmd.length + (includeLanguage ? 2 : 0));
  c[0] = 4 + cmd.length;
  c.writeUInt32BE(serverFlag >>> 0, 1);
  cmd.copy(c, 5);
  if (includeLanguage) c.writeUInt16BE(language, 5 + cmd.length);
  return buildFrame(0x80, c, serial);
}

// ---------------------------------------------------------------------------
// Device -> server (simulator / tests)
// ---------------------------------------------------------------------------

export function imeiToBytes(imei) {
  const digits = String(imei).replace(/\D/g, '');
  if (digits.length < 15 || digits.length > 16) throw new Error(`IMEI must be 15 digits, got "${imei}"`);
  return Buffer.from(digits.padStart(16, '0'), 'hex');
}

export function encodeDateTime(date) {
  return Buffer.from([
    date.getUTCFullYear() - 2000,
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ]);
}

/**
 * Login (0x01): terminalId(8 BCD) [+ typeCode(2)] [+ timezone/language(2)]
 * timezone word: bits 15..4 = |hours|*100 (+minutes), bit 3 = west (negative), bits 1..0 = language.
 */
export function buildLogin(imei, serial, { typeCode = null, timezoneHours = null, language = 2 } = {}) {
  const parts = [imeiToBytes(imei)];
  if (typeCode != null) {
    const t = Buffer.alloc(2);
    t.writeUInt16BE(typeCode);
    parts.push(t);
  }
  if (timezoneHours != null) {
    const abs = Math.abs(timezoneHours);
    const hours = Math.floor(abs);
    const minutes = Math.round((abs - hours) * 60);
    const v = ((hours * 100 + minutes) << 4) | (timezoneHours < 0 ? 0x8 : 0) | (language & 0x3);
    const tz = Buffer.alloc(2);
    tz.writeUInt16BE(v);
    parts.push(tz);
  }
  return buildFrame(0x01, Buffer.concat(parts), serial);
}

/** 18-byte GPS block shared by location and alarm packets. */
export function encodeGps({ time = new Date(), lat, lon, speed = 0, course = 0, satellites = 10, valid = true, differential = false }) {
  const b = Buffer.alloc(6 + 1 + 4 + 4 + 1 + 2);
  encodeDateTime(time).copy(b, 0);
  b[6] = (12 << 4) | (Math.min(15, Math.max(0, satellites)) & 0x0f);
  b.writeUInt32BE(Math.round(Math.abs(lat) * 60 * 30000), 7);
  b.writeUInt32BE(Math.round(Math.abs(lon) * 60 * 30000), 11);
  b[15] = Math.min(255, Math.max(0, Math.round(speed)));
  let cs = ((Math.round(course) % 360) + 360) % 360;
  if (valid) cs |= 0x1000;
  if (lon < 0) cs |= 0x0800; // bit 11: west
  if (lat >= 0) cs |= 0x0400; // bit 10: north
  if (differential) cs |= 0x2000;
  b.writeUInt16BE(cs, 16);
  return b;
}

/**
 * LBS block. Legacy layout: MCC(2) MNC(1|2) LAC(2) CID(3).
 * 4G layout (0xA0/0xA5): MCC(2) MNC(1|2) LAC(4) CID(8).
 * Bit 15 of MCC flags a 2-byte MNC.
 */
export function encodeLbs({ mcc = 310, mnc = 410, lac = 0x1234, cid = 0x00abcd, mncTwoBytes = false, layout4g = false } = {}) {
  const twoByteMnc = mncTwoBytes || mnc > 0xff;
  const b = Buffer.alloc(2 + (twoByteMnc ? 2 : 1) + (layout4g ? 4 + 8 : 2 + 3));
  b.writeUInt16BE(twoByteMnc ? mcc | 0x8000 : mcc, 0);
  let o = 2;
  if (twoByteMnc) {
    b.writeUInt16BE(mnc, o);
    o += 2;
  } else {
    b[o++] = mnc;
  }
  if (layout4g) {
    b.writeUInt32BE(lac >>> 0, o);
    o += 4;
    b.writeBigUInt64BE(BigInt(cid), o);
  } else {
    b.writeUInt16BE(lac, o);
    o += 2;
    b.writeUIntBE(cid, o, 3);
  }
  return b;
}

/**
 * Location packet. type 0x12 = GPS+LBS only; 0x22 / 0xA0 add
 * ACC(1) uploadMode(1) reupload(1) mileage(4).
 */
export function buildLocation(gps, lbs, serial, { type = 0x22, acc = 1, uploadMode = 0x00, reupload = 0x00, mileage = 0 } = {}) {
  const parts = [encodeGps(gps), encodeLbs({ ...lbs, layout4g: type === 0xa0 })];
  if (type === 0x22 || type === 0xa0 || type === 0x2d || type === 0x37) {
    const tail = Buffer.alloc(7);
    tail[0] = acc & 1;
    tail[1] = uploadMode;
    tail[2] = reupload;
    tail.writeUInt32BE(mileage >>> 0, 3);
    parts.push(tail);
  }
  return buildFrame(type, Buffer.concat(parts), serial);
}

export function encodeTerminalInfo({ armed = false, acc = false, charging = false, alarmBits = 0, gpsTracking = true, relayCut = false } = {}) {
  return (
    (relayCut ? 0x80 : 0) |
    (gpsTracking ? 0x40 : 0) |
    ((alarmBits & 7) << 3) |
    (charging ? 0x04 : 0) |
    (acc ? 0x02 : 0) |
    (armed ? 0x01 : 0)
  );
}

/** Heartbeat 0x13: terminalInfo(1) voltageLevel(1) gsm(1) alarm(1) language(1). */
export function buildHeartbeat(serial, { terminal = {}, voltageLevel = 6, gsm = 4, alarm = 0x00, language = 0x02 } = {}) {
  return buildFrame(0x13, Buffer.from([encodeTerminalInfo(terminal), voltageLevel, gsm, alarm, language]), serial);
}

/** Heartbeat 0x23: terminalInfo(1) voltage(2, centivolts) gsm(1) alarm(1) language(1). */
export function buildHeartbeat2(serial, { terminal = {}, voltage = 12.6, gsm = 4, alarm = 0x00, language = 0x02 } = {}) {
  const c = Buffer.alloc(6);
  c[0] = encodeTerminalInfo(terminal);
  c.writeUInt16BE(Math.round(voltage * 100), 1);
  c[3] = gsm;
  c[4] = alarm;
  c[5] = language;
  return buildFrame(0x23, c, serial);
}

/** Alarm 0x16: GPS(18) lbsLen(1) LBS terminalInfo(1) voltageLevel(1) gsm(1) alarm(1) language(1). */
export function buildAlarm(gps, lbs, serial, { type = 0x16, terminal = {}, voltageLevel = 6, gsm = 4, alarm = 0x03, language = 0x02 } = {}) {
  const l = encodeLbs(lbs);
  const c = Buffer.concat([
    encodeGps(gps),
    Buffer.from([l.length]),
    l,
    Buffer.from([encodeTerminalInfo(terminal), voltageLevel, gsm, alarm, language]),
  ]);
  return buildFrame(type, c, serial);
}

export function buildTimeRequest(serial) {
  return buildFrame(0x8a, Buffer.alloc(0), serial);
}

/** 0x15 string reply to a server command: cmdLen(1) serverFlag(4) text language(2). */
export function buildStringResponse(text, serial, { serverFlag = 0, language = 0x0002 } = {}) {
  const t = Buffer.from(text, 'ascii');
  const c = Buffer.alloc(1 + 4 + t.length + 2);
  c[0] = 4 + t.length;
  c.writeUInt32BE(serverFlag >>> 0, 1);
  t.copy(c, 5);
  c.writeUInt16BE(language, 5 + t.length);
  return buildFrame(0x15, c, serial);
}

/** 0x21 (extended) online command response: serverFlag(4) encoding(1: 1=ASCII) text. */
export function buildOnlineCommandResponse(text, serial, { serverFlag = 0 } = {}) {
  const t = Buffer.from(text, 'ascii');
  const c = Buffer.alloc(4 + 1 + t.length);
  c.writeUInt32BE(serverFlag >>> 0, 0);
  c[4] = 0x01;
  t.copy(c, 5);
  return buildFrame(0x21, c, serial, { ext: true });
}

/** 0x94 sub-type 0x00: external power voltage (u16 / 100 V). */
export function buildInfoVoltage(volts, serial) {
  const c = Buffer.alloc(3);
  c[0] = 0x00;
  c.writeUInt16BE(Math.round(volts * 100), 1);
  return buildFrame(0x94, c, serial, { ext: true });
}

/** 0x94 with an ASCII payload (e.g. sub-type 0x04 terminal status sync). */
export function buildInfoString(subtype, text, serial) {
  return buildFrame(0x94, Buffer.concat([Buffer.from([subtype]), Buffer.from(text, 'ascii')]), serial, { ext: true });
}

/** 0x94 sub-type 0x0A: IMEI(8) IMSI(8) ICCID(10) as BCD. */
export function buildInfoIds({ imei, imsi, iccid }, serial) {
  const bcd = (s, n) => Buffer.from(String(s).replace(/\D/g, '').padStart(n * 2, '0').slice(0, n * 2), 'hex');
  return buildFrame(0x94, Buffer.concat([Buffer.from([0x0a]), bcd(imei, 8), bcd(imsi, 8), bcd(iccid, 10)]), serial, { ext: true });
}

/** 0x8C OBD packet (Concox OB22 style): dateTime(6) + ASCII "key=value,key=value". */
export function buildObd(pairs, serial, time = new Date()) {
  const text = Object.entries(pairs)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return buildFrame(0x8c, Buffer.concat([encodeDateTime(time), Buffer.from(text, 'ascii')]), serial);
}
