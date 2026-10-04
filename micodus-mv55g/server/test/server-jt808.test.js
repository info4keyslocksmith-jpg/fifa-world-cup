/**
 * Integration test: a fake MV55G (JT808) talks to the real TCP server, next to a GT06 device.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { createTrackerServer } from '../src/tcp-server.js';
import { createHttpServer } from '../src/http-api.js';
import * as JE from '../src/jt808/encode.js';
import * as JF from '../src/jt808/frame.js';
import { decodeFrame as jt808Decode } from '../src/jt808/decode.js';
import * as GE from '../src/gt06/encode.js';
import * as GF from '../src/gt06/frame.js';
import { decodeFrame as gt06Decode } from '../src/gt06/decode.js';

const quiet = { log() {}, error() {} };
const ID = '019172682984';
const IMEI = '353419989226948';
const T = new Date('2026-10-04T20:30:15Z');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Store({ dataDir: null });
const tracker = createTrackerServer({ store, log: quiet, tzHours: 0 });
const httpServer = createHttpServer({ store, tracker, log: quiet, tcpPort: 0 });
await new Promise((r) => tracker.listen(0, '127.0.0.1', r));
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const tcpPort = tracker.address().port;
const httpBase = `http://127.0.0.1:${httpServer.address().port}`;

const clientSockets = new Set();
after(() => {
  for (const s of clientSockets) s.destroy();
  tracker.destroyAll();
  tracker.close();
  httpServer.close();
});

async function device(protocol) {
  await sleep(30);
  const socket = net.connect({ host: '127.0.0.1', port: tcpPort });
  clientSockets.add(socket);
  socket.on('close', () => clientSockets.delete(socket));
  await once(socket, 'connect');
  const parser = protocol === 'jt808' ? new JF.FrameParser() : new GF.FrameParser();
  const decode = protocol === 'jt808' ? jt808Decode : gt06Decode;
  const replies = [];
  socket.on('data', (c) => {
    for (const f of parser.feed(c)) replies.push(decode(f));
  });
  const waitFor = (pred, ms = 2000) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const r = replies.find(pred);
        if (r) {
          clearInterval(iv);
          resolve(r);
        } else if (Date.now() - t0 > ms) {
          clearInterval(iv);
          reject(new Error('timeout; replies: ' + JSON.stringify(replies.map((x) => x.kind + ':' + x.typeHex))));
        }
      }, 10);
    });
  return { socket, replies, waitFor };
}

test('JT808 registration gets a 0x8100 response carrying the device id as auth code', async () => {
  const d = await device('jt808');
  d.socket.write(JE.buildRegister(ID, 1, { manufacturer: 'MICOD', model: 'MV55G', terminalIdText: ID.slice(-7) }));
  const r = await d.waitFor((x) => x.kind === 'register_response');
  assert.equal(r.replySerial, 1);
  assert.equal(r.resultName, 'success');
  assert.equal(r.authCode, ID);
  const dev = store.devices.get(ID);
  assert.equal(dev.protocol, 'jt808');
  assert.equal(dev.connected, true);
  assert.equal(dev.registration.model, 'MV55G');
  d.socket.write(JE.buildAuth(ID, 2, r.authCode));
  const ack = await d.waitFor((x) => x.kind === 'ack' && x.replyMsgId === '0x0102');
  assert.equal(ack.replySerial, 2);
  assert.equal(store.devices.get(ID).auth.code, ID);
  d.socket.destroy();
  await sleep(50);
  assert.equal(store.devices.get(ID).connected, false);
});

test('JT808 heartbeat, location with OBD items, alarm bits and batch are stored and acknowledged', async () => {
  const d = await device('jt808');
  d.socket.write(JE.buildHeartbeat(ID, 3));
  await d.waitFor((x) => x.kind === 'ack' && x.replyMsgId === '0x0002' && x.replySerial === 3);
  const dev = store.devices.get(ID);
  assert.equal(dev.counters.heartbeats, 1);

  const items = JE.micodusObdItems({ rpm: 2150, speedKmh: 54, voltage: 12.6, coolantC: 89, vin: '1HGCM82633A004352', rssi: 24, satellites: 11, mileageKm: 1000.5 });
  d.socket.write(JE.buildLocation(ID, 4, { time: T, lat: 33.749, lon: -84.388, speedKmh: 55.5, course: 123, items, alarmBits: [8] }));
  await d.waitFor((x) => x.kind === 'ack' && x.replyMsgId === '0x0200' && x.replySerial === 4);
  assert.equal(dev.lastPosition.lat, 33.749);
  assert.equal(dev.lastPosition.lon, -84.388);
  assert.equal(dev.lastPosition.speedKmh, 55.5);
  assert.equal(dev.lastPosition.mileageM, 1000500);
  assert.equal(dev.lastPosition.source, '0x0200');
  assert.deepEqual(dev.lastPosition.alarms, ['main_power_cut']);
  assert.equal(dev.obd.rpm, 2150);
  assert.equal(dev.obd.vin, '1HGCM82633A004352');
  assert.equal(dev.externalVoltage, 12.6);
  assert.equal(dev.rssi, 24);
  assert.equal(dev.lastAlarm.alarm, 'main_power_cut');
  assert.ok(store.events.some((e) => e.kind === 'alarm' && e.imei === ID && e.alarm === 'main_power_cut'));

  d.socket.write(JE.buildLocationBatch(ID, 5, [{ time: T, lat: 1, lon: 2 }, { time: T, lat: 3, lon: 4 }], { type: 1 }));
  await d.waitFor((x) => x.kind === 'ack' && x.replyMsgId === '0x0704');
  const positions = store.positionsFor(ID, 10);
  assert.ok(positions.filter((p) => p.archive).length >= 2);
  assert.ok(store.events.some((e) => e.kind === 'batch' && e.count === 2));

  d.socket.write(JE.buildFrame(0x0109, ID, 6, Buffer.alloc(0)));
  const ts = await d.waitFor((x) => x.kind === 'time_sync_response');
  assert.ok(Math.abs(new Date(ts.time).getTime() - Date.now()) < 5000);
  d.socket.destroy();
});

test('JT808 online command is delivered as 0x8300 and matched to 0x0001 / 0x6006 replies', async () => {
  const d = await device('jt808');
  const queued = tracker.sendCommand(ID, 'STATUS#');
  assert.equal(queued.status, 'queued');
  d.socket.write(JE.buildHeartbeat(ID, 7));
  const cmd = await d.waitFor((x) => x.kind === 'server_command');
  assert.equal(cmd.text, 'STATUS#');
  assert.equal(cmd.flag, '0x01');
  let c = store.commands.find((x) => x.id === queued.id);
  assert.equal(c.status, 'sent');
  assert.equal(c.frameType, '0x8300');
  d.socket.write(JE.buildTerminalGeneralResponse(ID, 8, cmd.serial, 0x8300, 0));
  await sleep(50);
  c = store.commands.find((x) => x.id === queued.id);
  assert.equal(c.status, 'accepted');
  d.socket.write(JE.buildTextReport(ID, 9, 'Battery:12.6V;GSM:4'));
  await d.waitFor((x) => x.kind === 'ack' && x.replyMsgId === '0x6006');
  c = store.commands.find((x) => x.id === queued.id);
  assert.equal(c.status, 'answered');
  assert.equal(c.response, 'Battery:12.6V;GSM:4');
  assert.equal(d.replies.filter((x) => x.kind === 'ack' && x.replyMsgId === '0x0001').length, 0, '0x0001 is never acknowledged');

  tracker.sendCommand(ID, '!query');
  const q = await d.waitFor((x) => x.kind === 'location_query');
  assert.ok(q);
  tracker.sendCommand(ID, '!reset');
  const rst = await d.waitFor((x) => x.kind === 'terminal_control');
  assert.equal(rst.commandName, 'reset');
  d.socket.destroy();
});

test('a GT06 device and a JT808 device are tracked side by side', async () => {
  const j = await device('jt808');
  const g = await device('gt06');
  g.socket.write(GE.buildLogin(IMEI, 1));
  j.socket.write(JE.buildHeartbeat(ID, 10));
  await g.waitFor((x) => x.kind === 'ack' && x.type === 0x01);
  await j.waitFor((x) => x.kind === 'ack' && x.replyMsgId === '0x0002');
  assert.equal(store.devices.get(IMEI).protocol, 'gt06');
  assert.equal(store.devices.get(ID).protocol, 'jt808');
  assert.equal(tracker.sessions.size, 2);
  const state = await (await fetch(`${httpBase}/api/state`)).json();
  assert.deepEqual(state.devices.map((x) => x.protocol).sort(), ['gt06', 'jt808']);
  g.socket.destroy();
  j.socket.destroy();
});

test('HTTP decode/encode work for JT808 frames', async () => {
  const frame = JE.buildLocation(ID, 11, { time: T, lat: 1, lon: 1, items: [JE.item.u16(0x82, 126)] });
  const decoded = await (await fetch(`${httpBase}/api/decode`, { method: 'POST', body: JSON.stringify({ hex: JF.hex(frame) }) })).json();
  assert.equal(decoded.frames[0].protocol, 'jt808');
  assert.equal(decoded.frames[0].obd.externalVoltage, 12.6);
  const enc = await (await fetch(`${httpBase}/api/encode`, { method: 'POST', body: JSON.stringify({ protocol: 'jt808', id: ID, command: 'TIMER,30#', serial: 5 }) })).json();
  assert.equal(enc.protocol, 'jt808');
  assert.equal(enc.decoded.text, 'TIMER,30#');
  assert.equal(enc.decoded.serial, 5);
  assert.equal(enc.decoded.terminalId, ID);
});

test('bytes that are neither protocol are reported and the connection survives', async () => {
  const d = await device('jt808');
  d.socket.write(Buffer.from('GET / HTTP/1.1\r\n\r\n'));
  await sleep(40);
  assert.ok(store.raw.some((r) => r.note && r.note.includes('unrecognised')));
  d.socket.write(JE.buildHeartbeat(ID, 12));
  await d.waitFor((x) => x.kind === 'ack' && x.replySerial === 12);
  d.socket.destroy();
});
