import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/jt808/encode.js';
import { FrameParser, bcdToDigits, digitsToBcd, escapeBytes, hex, parseFrame, splitFrames, unescapeBytes, xorChecksum } from '../src/jt808/frame.js';
import { decodeBcdTime, decodeFrame, decodeItems } from '../src/jt808/decode.js';
import { decodeBuffer, detect } from '../src/protocols.js';
import * as GE from '../src/gt06/encode.js';

const ID = '019172682984'; // "0" + the 11-digit MiCODUS device id
const T = new Date('2026-10-04T20:30:15Z');
const dec = (buf, opts) => decodeFrame(parseFrame(buf), opts);

test('escape / unescape round trip and invalid escapes', () => {
  const raw = Buffer.from([0x00, 0x7e, 0x7d, 0x01, 0x7e, 0x7e, 0x02]);
  const esc = escapeBytes(raw);
  assert.equal(hex(esc), '00 7D 02 7D 01 01 7D 02 7D 02 02');
  assert.deepEqual(unescapeBytes(esc), raw);
  assert.equal(unescapeBytes(Buffer.from([0x7d, 0x03])), null);
});

test('xor checksum and BCD helpers', () => {
  assert.equal(xorChecksum(Buffer.from([0x02, 0x00, 0x00, 0x05])), 0x07);
  assert.equal(bcdToDigits(Buffer.from([0x01, 0x91, 0x72, 0x68, 0x29, 0x84])), ID);
  assert.equal(hex(digitsToBcd('19172682984', 6)), '01 91 72 68 29 84');
  assert.throws(() => digitsToBcd('1234567890123', 6));
});

test('heartbeat frame bytes computed by hand', () => {
  // payload 00 02 | 00 00 | 01 91 72 68 29 84 | 00 03 ; xor = 0x26
  assert.equal(hex(E.buildHeartbeat(ID, 3)), '7E 00 02 00 00 01 91 72 68 29 84 00 03 26 7E');
  const f = parseFrame(E.buildHeartbeat(ID, 3));
  assert.equal(f.msgId, 0x0002);
  assert.equal(f.terminalId, ID);
  assert.equal(f.deviceId, '19172682984');
  assert.equal(f.serial, 3);
  assert.equal(f.bodyLength, 0);
  assert.equal(f.checksumOk, true);
});

test('real MV55G-AU frame from the Traccar forum (0x0102 authentication) decodes', () => {
  // posted by an MV55G-AU owner: 7e01020007019172682984015e470000000000003b7e
  const raw = Buffer.from('7e01020007019172682984015e470000000000003b7e', 'hex');
  const f = parseFrame(raw);
  assert.equal(f.checksumOk, true);
  assert.equal(f.msgId, 0x0102);
  assert.equal(f.terminalId, ID);
  assert.equal(f.serial, 0x015e);
  assert.equal(f.bodyLength, 7);
  const d = decodeFrame(f);
  assert.equal(d.kind, 'auth');
  assert.equal(d.codeHex, '47 00 00 00 00 00 00');
  // the platform general response our server sends back
  assert.equal(hex(E.buildGeneralResponse(ID, 1, 0x015e, 0x0102, 0)), '7E 80 01 00 05 01 91 72 68 29 84 00 01 01 5E 01 02 00 FE 7E');
});

test('bad checksum is flagged, not thrown', () => {
  const buf = E.buildHeartbeat(ID, 3);
  buf[buf.length - 2] ^= 0x55;
  assert.equal(parseFrame(buf).checksumOk, false);
});

test('register decode and register response', () => {
  const d = dec(E.buildRegister(ID, 1, { province: 0, city: 0, manufacturer: 'MICOD', model: 'MV55G', terminalIdText: '9172682', plate: '' }));
  assert.equal(d.kind, 'register');
  assert.equal(d.manufacturer, 'MICOD');
  assert.equal(d.model, 'MV55G');
  assert.equal(d.terminalIdText, '9172682');
  const withImei = dec(E.buildRegister(ID, 1, { model: 'MV55G', terminalIdText: '', plate: '353419989226948' }));
  assert.equal(withImei.imei, '353419989226948');
  const r = dec(E.buildRegisterResponse(ID, 7, 1, 0, ID));
  assert.equal(r.kind, 'register_response');
  assert.equal(r.replySerial, 1);
  assert.equal(r.resultName, 'success');
  assert.equal(r.authCode, ID);
  const fail = dec(E.buildRegisterResponse(ID, 8, 1, 4));
  assert.equal(fail.resultName, 'terminal_not_in_database');
  assert.equal(fail.authCode, '');
});

test('auth, general responses and text messages', () => {
  assert.equal(dec(E.buildAuth(ID, 2, ID)).code, ID);
  const g = dec(E.buildGeneralResponse(ID, 9, 2, 0x0102, 0));
  assert.equal(g.kind, 'ack');
  assert.equal(g.replyMsgId, '0x0102');
  assert.equal(g.replyName, 'auth');
  const tr = dec(E.buildTerminalGeneralResponse(ID, 3, 9, 0x8300, 3));
  assert.equal(tr.kind, 'terminal_response');
  assert.equal(tr.resultName, 'not_supported');
  const cmd = dec(E.buildTextMessage(ID, 10, 'TIMER,30#', { flag: 0x01 }));
  assert.equal(cmd.kind, 'server_command');
  assert.equal(cmd.flag, '0x01');
  assert.equal(cmd.text, 'TIMER,30#');
  const rep = dec(E.buildTextReport(ID, 4, 'Battery:12.6V'));
  assert.equal(rep.kind, 'command_response');
  assert.equal(rep.text, 'Battery:12.6V');
});

test('location report: coordinates, scaling, status, alarms', () => {
  const f = E.buildLocation(ID, 4, { time: T, lat: 33.749, lon: -84.388, altitude: -12, speedKmh: 55.5, course: 359, acc: true, valid: true, alarmBits: [8, 1] });
  const d = dec(f);
  assert.equal(d.kind, 'location');
  assert.equal(d.gps.lat, 33.749);
  assert.equal(d.gps.lon, -84.388);
  assert.equal(d.gps.hemisphere, 'NW');
  assert.equal(d.gps.altitude, -12);
  assert.equal(d.gps.speedKmh, 55.5);
  assert.equal(d.gps.course, 359);
  assert.equal(d.gps.time, '2026-10-04T20:30:15.000Z');
  assert.equal(d.gps.timeBcd, '261004203015');
  assert.equal(d.gps.valid, true);
  assert.equal(d.status.acc, true);
  assert.deepEqual(d.alarms, ['overspeed', 'main_power_cut']);
  assert.equal(d.alarmWord, '0x00000102');
});

test('location without fix, southern/eastern hemisphere, ACC off', () => {
  const d = dec(E.buildLocation(ID, 5, { time: T, lat: -33.8688, lon: 151.2093, acc: false, valid: false }));
  assert.equal(d.gps.valid, false);
  assert.equal(d.status.acc, false);
  assert.equal(d.gps.hemisphere, 'SE');
  assert.equal(d.gps.lat, -33.8688);
  assert.equal(d.gps.lon, 151.2093);
});

test('device timezone offset is removed from BCD timestamps', () => {
  const f = E.buildLocation(ID, 6, { time: T, tzHours: 8, lat: 1, lon: 1 });
  assert.equal(dec(f).gps.timeBcd, '261005043015'); // 20:30 UTC = 04:30 next day in UTC+8
  assert.equal(dec(f, { tzHours: 8 }).gps.time, '2026-10-04T20:30:15.000Z');
  assert.deepEqual(decodeBcdTime(Buffer.alloc(6)), { timeBcd: '000000000000', time: null });
});

test('MiCODUS OBD items (flat layout from the MV55G capture)', () => {
  const items = E.micodusObdItems({ rpm: 2150, speedKmh: 54, voltage: 12.6, engineLoad: 42, coolantC: 89, fuelRateLph: 3.2, intakeTempC: 31, mafGps: 12.34, mapKpa: 101, throttle: 18, odometerKm: 123456.7, fuelLevel: 62, vin: '1HGCM82633A004352', dtcs: ['P0301', 'P0420'], batteryPct: 90, rssi: 24, satellites: 11, mileageKm: 1000.5 });
  const d = dec(E.buildLocation(ID, 7, { time: T, lat: 1, lon: 1, items }));
  assert.deepEqual(d.obd, {
    obdSpeedKmh: 54,
    rpm: 2150,
    externalVoltage: 12.6,
    engineLoadPct: 42,
    coolantC: 89,
    fuelRateRaw: 32,
    fuelRateLph: 3.2,
    intakeTempC: 31,
    mafGps: 12.34,
    mapKpa: 101,
    throttlePct: 18,
    canOdometerKm: 123456.7,
    fuelLevelPct: 62,
    vin: '1HGCM82633A004352',
    dtcs: ['P0301', 'P0420'],
  });
  assert.equal(d.extras.mileageKm, 1000.5);
  assert.equal(d.extras.rssi, 24);
  assert.equal(d.gps.satellites, 11);
  assert.equal(d.extras.backupBatteryPct, 90);
  assert.equal(d.items.length, items.length);
  assert.ok(d.items.every((i) => i.name !== 'unknown'));
});

test('0x80 as nested OBD container (Traccar layout) and 0x57 harsh-driving extension', () => {
  const nested = E.encodeItems([E.item.u8(0x80, 60), E.item.u16(0x81, 1800), E.item.u8(0x84, 90 + 40), E.item.str(0x8b, '1HGCM82633A004352')]);
  const container = E.item.raw(0x80, Buffer.concat([Buffer.from([0x00]), nested]));
  const ext = Buffer.alloc(8);
  ext.writeUInt16BE((1 << 8) | (1 << 10), 0);
  ext.writeUInt32BE(1 << 16, 4);
  const d = dec(E.buildLocation(ID, 8, { time: T, lat: 1, lon: 1, items: [container, E.item.raw(0x57, ext)] }));
  assert.equal(d.items[0].name, 'obd_container');
  assert.equal(d.obd.obdSpeedKmh, 60);
  assert.equal(d.obd.rpm, 1800);
  assert.equal(d.obd.coolantC, 90);
  assert.equal(d.obd.vin, '1HGCM82633A004352');
  assert.deepEqual(d.alarms, ['harsh_acceleration', 'harsh_cornering', 'door']);
  assert.equal(d.extras.alarmExtension.harshBraking, false);
});

test('0xE1 backup battery vs power, 0x02 fuel percent flag, truncated item is reported', () => {
  const r1 = decodeItems(E.encodeItems([E.item.u8(0xe1, 77), E.item.u16(0x02, 0x8000 | 45)]));
  assert.equal(r1.extras.backupBatteryPct, 77);
  assert.equal(r1.extras.fuelLevelPct, 45);
  const r2 = decodeItems(E.encodeItems([E.item.u8(0xe1, 0xff), E.item.u16(0xe1, 124)]));
  assert.equal(r2.extras.charging, true);
  assert.equal(r2.extras.powerVoltage, 12.4);
  const r3 = decodeItems(Buffer.from([0x81, 0x05, 0x01]));
  assert.equal(r3.items[0].truncated, true);
  assert.equal(r3.notes.length, 1);
});

test('batch upload 0x0704 and position query response 0x0201', () => {
  const b = dec(E.buildLocationBatch(ID, 9, [{ time: T, lat: 1, lon: 2 }, { time: T, lat: 3, lon: 4, items: [E.item.u16(0x82, 126)] }], { type: 1 }));
  assert.equal(b.kind, 'batch');
  assert.equal(b.count, 2);
  assert.equal(b.batchType, 'blind_zone_supplement');
  assert.equal(b.positions.length, 2);
  assert.equal(b.positions[1].gps.lon, 4);
  assert.equal(b.positions[1].obd.externalVoltage, 12.6);
  const body = Buffer.concat([Buffer.from([0x00, 0x2a]), E.encodeLocationBody({ time: T, lat: 5, lon: 6 })]);
  const q = dec(E.buildFrame(0x0201, ID, 10, body));
  assert.equal(q.kind, 'location');
  assert.equal(q.replySerial, 0x2a);
  assert.equal(q.gps.lat, 5);
});

test('2019 framing: version byte and 10-byte terminal id', () => {
  const f = parseFrame(E.buildLocation(ID, 11, { time: T, lat: 1, lon: 1 }, { version: 1 }));
  assert.equal(f.version, 1);
  assert.equal(f.terminalId, '00000000' + ID);
  assert.equal(f.deviceId, '19172682984');
  assert.equal(f.checksumOk, true);
  assert.equal(dec(E.buildRegisterResponse(ID, 1, 1, 0, ID, { version: 1 })).authCode, ID);
});

test('parameters: set (0x8103) and query response (0x0104)', () => {
  const set = dec(E.buildSetParameters(ID, 12, [{ id: 0x0013, value: '1.2.3.4' }, { id: 0x0018, value: 7700 }]));
  assert.equal(set.kind, 'set_parameters');
  assert.equal(set.params[0].name, 'main_server');
  assert.equal(set.params[0].text, '1.2.3.4');
  const tlv = parseFrame(E.buildSetParameters(ID, 0, [{ id: 0x0029, value: 30 }, { id: 0x0010, value: 'internet' }])).body;
  const resp = dec(E.buildFrame(0x0104, ID, 13, Buffer.concat([Buffer.from([0x00, 0x0c]), tlv])));
  assert.equal(resp.kind, 'params');
  assert.deepEqual(resp.params.map((p) => [p.name, p.value]), [['report_interval_default_s', 30], ['apn', 'internet']]);
});

test('terminal control, location query, time sync', () => {
  assert.equal(dec(E.buildTerminalControl(ID, 1, 4)).commandName, 'reset');
  assert.equal(dec(E.buildLocationQuery(ID, 2)).kind, 'location_query');
  const ts = dec(E.buildTimeSyncResponse(ID, 3, T));
  assert.equal(ts.kind, 'time_sync_response');
  assert.equal(ts.time, '2026-10-04T20:30:15.000Z');
});

test('unknown message id and truncated body are reported, never thrown', () => {
  const u = dec(E.buildFrame(0x0f0f, ID, 1, Buffer.from([1, 2, 3])));
  assert.equal(u.kind, 'unknown');
  assert.equal(u.contentHex, '01 02 03');
  const t = dec(E.buildFrame(0x0200, ID, 2, Buffer.from([1, 2, 3])));
  assert.equal(t.kind, 'decode_error');
});

test('stream splitter: chunking, garbage, back-to-back frames, partial frames', () => {
  const a = E.buildHeartbeat(ID, 1);
  const b = E.buildLocation(ID, 2, { time: T, lat: 33.749, lon: -84.388, items: [E.item.u16(0x81, 0x7e7d)] });
  const stream = Buffer.concat([Buffer.from('noise'), a, b, a, Buffer.from([0x7e, 0x00])]);
  const p = new FrameParser();
  const got = [];
  for (let i = 0; i < stream.length; i += 4) got.push(...p.feed(stream.subarray(i, Math.min(i + 4, stream.length))));
  assert.deepEqual(got.map((f) => f.msgId), [0x0002, 0x0200, 0x0002]);
  assert.equal(p.garbage, 5);
  assert.equal(p.buf.length, 2); // "7E 00" waits for its closing delimiter
  assert.equal(dec(b).obd.rpm, 0x7e7d);
  const { frames, invalid } = splitFrames(Buffer.from([0x7e, 0x01, 0x02, 0x7e]));
  assert.equal(frames.length, 0);
  assert.equal(invalid, 1);
});

test('protocol detection and mixed-capture decoding', () => {
  assert.equal(detect(0x7e).name, 'jt808');
  assert.equal(detect(0x78).name, 'gt06');
  assert.equal(detect(0x79).name, 'gt06');
  assert.equal(detect(0x41), null);
  const mixed = Buffer.concat([E.buildHeartbeat(ID, 1), Buffer.from([0x00]), GE.buildLogin('123456789012345', 1), E.buildAuth(ID, 2, ID)]);
  const out = decodeBuffer(mixed);
  assert.deepEqual(out.frames.map((f) => `${f.protocol}:${f.kind}`), ['jt808:heartbeat', 'gt06:login', 'jt808:auth']);
  assert.equal(out.garbage, 1);
});
