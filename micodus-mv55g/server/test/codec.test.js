import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/gt06/encode.js';
import { fromHex, hex, parseFrame } from '../src/gt06/frame.js';
import { decodeFrame, decodeTerminalInfo } from '../src/gt06/decode.js';

const dec = (buf) => decodeFrame(parseFrame(buf));
const T = new Date('2026-10-04T20:30:15Z');

test('official GT06 login example decodes to IMEI 123456789012345', () => {
  const d = dec(fromHex('78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A'));
  assert.equal(d.kind, 'login');
  assert.equal(d.imei, '123456789012345');
  assert.equal(d.serial, 1);
  assert.equal(d.crcOk, true);
});

test('buildLogin reproduces the official example bytes', () => {
  assert.equal(hex(E.buildLogin('123456789012345', 1)), '78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A');
});

test('buildAck reproduces the official login ACK bytes', () => {
  assert.equal(hex(E.buildAck(0x01, 1)), '78 78 05 01 00 01 D9 DC 0D 0A');
});

test('login with type code and negative timezone', () => {
  const d = dec(E.buildLogin('353419989226948', 2, { typeCode: 0x5500, timezoneHours: -4 }));
  assert.equal(d.imei, '353419989226948');
  assert.equal(d.typeCode, '0x5500');
  assert.equal(d.timezoneHours, -4);
  assert.equal(d.language, 'english');
  assert.equal(dec(E.buildLogin('353419989226948', 3, { typeCode: 0x0012 })).typeCode, '0x0012');
  assert.equal(dec(E.buildLogin('353419989226948', 4, { typeCode: 0x0012, timezoneHours: 5.5 })).timezoneHours, 5.5);
});

test('location 0x22 round trip (north-west hemisphere)', () => {
  const frame = E.buildLocation(
    { time: T, lat: 33.749, lon: -84.388, speed: 55, course: 123, satellites: 9 },
    { mcc: 310, mnc: 410, lac: 0x1a2b, cid: 0x00c0de },
    2,
    { type: 0x22, acc: 1, uploadMode: 0x03, mileage: 123456 },
  );
  const d = dec(frame);
  assert.equal(d.kind, 'location');
  assert.equal(d.gps.time, '2026-10-04T20:30:15.000Z');
  assert.ok(Math.abs(d.gps.lat - 33.749) < 1e-5);
  assert.ok(Math.abs(d.gps.lon + 84.388) < 1e-5);
  assert.equal(d.gps.speedKmh, 55);
  assert.equal(d.gps.course, 123);
  assert.equal(d.gps.satellites, 9);
  assert.equal(d.gps.valid, true);
  assert.equal(d.gps.hemisphere, 'NW');
  assert.deepEqual({ mcc: d.lbs.mcc, mnc: d.lbs.mnc, lac: d.lbs.lac, cid: d.lbs.cid }, { mcc: 310, mnc: 410, lac: 0x1a2b, cid: 0x00c0de });
  assert.equal(d.acc, true);
  assert.equal(d.uploadMode, 'acc_status_change');
  assert.equal(d.mileageM, 123456);
  assert.equal(d.tailHex, undefined);
});

test('location 0x12 (no ACC/mileage tail) and south-east hemisphere', () => {
  const d = dec(E.buildLocation({ time: T, lat: -33.8688, lon: 151.2093, speed: 10, course: 350 }, { mcc: 505, mnc: 1 }, 3, { type: 0x12 }));
  assert.equal(d.gps.hemisphere, 'SE');
  assert.ok(Math.abs(d.gps.lat + 33.8688) < 1e-5);
  assert.ok(Math.abs(d.gps.lon - 151.2093) < 1e-5);
  assert.equal(d.acc, undefined);
  assert.equal(d.lbs.mncBytes, 1);
});

test('location 0xA0 uses the 4G LBS layout (LAC 4 bytes, Cell ID 8 bytes)', () => {
  const d = dec(E.buildLocation({ time: T, lat: 25.76, lon: -80.19 }, { mcc: 310, mnc: 260, lac: 0x12345678, cid: 0x1122334455 }, 4, { type: 0xa0, mileage: 42 }));
  assert.equal(d.lbs.lac, 0x12345678);
  assert.equal(d.lbs.cid, 0x1122334455);
  assert.equal(d.mileageM, 42);
});

test('location without a fix keeps coordinates but flags valid=false', () => {
  const d = dec(E.buildLocation({ time: T, lat: 1, lon: 1, valid: false }, {}, 5, { type: 0x22 }));
  assert.equal(d.gps.valid, false);
});

test('heartbeat 0x13 terminal info bits, voltage level, gsm, alarm, language', () => {
  const d = dec(E.buildHeartbeat(4, { terminal: { acc: true, charging: true, armed: true, alarmBits: 2 }, voltageLevel: 5, gsm: 3, alarm: 0x00, language: 0x02 }));
  assert.equal(d.kind, 'heartbeat');
  assert.deepEqual(d.status.terminal, { raw: '0x57', relayCut: false, gpsTracking: true, alarm: 'power_cut', charging: true, acc: true, armed: true });
  assert.equal(d.status.voltageLevel, 5);
  assert.equal(d.status.voltageLevelName, 'high');
  assert.equal(d.status.gsm, 3);
  assert.equal(d.status.alarm, 'normal');
  assert.equal(d.status.language, 'english');
});

test('heartbeat 0x23 carries a 2-byte voltage in centivolts', () => {
  const d = dec(E.buildHeartbeat2(5, { voltage: 12.84, gsm: 4 }));
  assert.equal(d.status.voltage, 12.84);
  assert.equal(d.status.gsmName, 'strong');
});

test('alarm 0x16 power cut with GPS + LBS + status', () => {
  const d = dec(E.buildAlarm({ time: T, lat: 25.7617, lon: -80.1918 }, { mcc: 310, mnc: 260 }, 6, { alarm: 0x02 }));
  assert.equal(d.kind, 'alarm');
  assert.equal(d.alarm, 'power_cut');
  assert.equal(d.status.alarmCode, '0x02');
  assert.ok(Math.abs(d.gps.lat - 25.7617) < 1e-5);
  assert.equal(d.lbs.mnc, 260);
});

test('unknown alarm codes are reported with their hex value', () => {
  const d = dec(E.buildAlarm({ time: T, lat: 1, lon: 1 }, {}, 6, { alarm: 0x7b }));
  assert.equal(d.alarm, 'alarm_0x7B');
});

test('time request and time response', () => {
  assert.equal(dec(E.buildTimeRequest(7)).kind, 'time_request');
  const d = dec(E.buildTimeResponse(7, T));
  assert.equal(d.kind, 'time_response');
  assert.equal(d.time, '2026-10-04T20:30:15.000Z');
});

test('server ACK frames decode as ack', () => {
  const d = dec(E.buildAck(0x22, 99));
  assert.equal(d.kind, 'ack');
  assert.equal(d.serial, 99);
});

test('online command 0x80 and 0x15 string reply', () => {
  const cmd = dec(E.buildCommand('STATUS#', 14, { serverFlag: 0x01020304 }));
  assert.equal(cmd.kind, 'server_command');
  assert.equal(cmd.text, 'STATUS#');
  assert.equal(cmd.serverFlag, 0x01020304);
  assert.equal(cmd.language, 'english');
  const rep = dec(E.buildStringResponse('Battery:12.5V;GSM:Strong', 8, { serverFlag: 0x01020304 }));
  assert.equal(rep.kind, 'command_response');
  assert.equal(rep.text, 'Battery:12.5V;GSM:Strong');
  assert.equal(rep.serverFlag, 0x01020304);
});

test('command without language word still decodes', () => {
  const cmd = dec(E.buildCommand('RESET#', 1, { includeLanguage: false }));
  assert.equal(cmd.text, 'RESET#');
  assert.equal(cmd.language, undefined);
});

test('0x21 extended online command response (ASCII)', () => {
  const d = dec(E.buildOnlineCommandResponse('Version:MV55G_V1.0', 9));
  assert.equal(d.ext, true);
  assert.equal(d.kind, 'command_response');
  assert.equal(d.text, 'Version:MV55G_V1.0');
});

test('0x94 info sub-types: voltage, status string, ICCID', () => {
  const v = dec(E.buildInfoVoltage(12.37, 10));
  assert.equal(v.kind, 'info');
  assert.equal(v.subtypeName, 'external_power_voltage');
  assert.equal(v.externalVoltage, 12.37);
  const s = dec(E.buildInfoString(0x04, 'ALM1=40;ALM2=4C;STA1=00;DYD=01', 11));
  assert.deepEqual(s.fields, { ALM1: '40', ALM2: '4C', STA1: '00', DYD: '01' });
  const ids = dec(E.buildInfoIds({ imei: '353419989226948', imsi: '310410123456789', iccid: '89014103211118510720' }, 12));
  assert.equal(ids.imei, '353419989226948');
  assert.equal(ids.imsi, '310410123456789');
  assert.equal(ids.iccid, '89014103211118510720');
});

test('0x8C OBD key=value payload', () => {
  const d = dec(E.buildObd({ 40: '0001E240', 54: '0003E8F0', 74: '1HGCM82633A004352' }, 13, T));
  assert.equal(d.kind, 'obd');
  assert.equal(d.parsed.odometer_km, 1234.56);
  assert.equal(d.parsed.rpm, 2562.4);
  assert.equal(d.parsed.vin, '1HGCM82633A004352');
  assert.equal(d.time, '2026-10-04T20:30:15.000Z');
});

test('unknown protocol numbers are kept with raw hex', () => {
  const d = dec(E.buildFrame(0x77, Buffer.from([1, 2, 3]), 1));
  assert.equal(d.kind, 'unknown');
  assert.equal(d.contentHex, '01 02 03');
});

test('truncated content yields decode_error instead of throwing', () => {
  const d = dec(E.buildFrame(0x22, Buffer.from([1, 2, 3]), 1));
  assert.equal(d.kind, 'decode_error');
  assert.ok(d.error.includes('need'));
});

test('decodeTerminalInfo bit layout', () => {
  assert.deepEqual(decodeTerminalInfo(0b11000011), { raw: '0xC3', relayCut: true, gpsTracking: true, alarm: 'normal', charging: false, acc: true, armed: true });
  assert.equal(decodeTerminalInfo(0b00100000).alarm, 'sos');
});

test('IMEI validation', () => {
  assert.throws(() => E.imeiToBytes('1234'), /IMEI/);
});
