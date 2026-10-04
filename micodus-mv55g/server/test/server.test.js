/**
 * Integration test: a fake device talks to the real TCP server; the HTTP API
 * is exercised against the same store.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { createTrackerServer } from '../src/tcp-server.js';
import { createHttpServer } from '../src/http-api.js';
import * as E from '../src/gt06/encode.js';
import { FrameParser, hex } from '../src/gt06/frame.js';
import { decodeFrame } from '../src/gt06/decode.js';

const quiet = { log() {}, error() {} };
const IMEI = '353419989226948';
const T = new Date('2026-10-04T20:30:15Z');

const store = new Store({ dataDir: null });
const tracker = createTrackerServer({ store, log: quiet });
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

/** Minimal fake device: send frames, collect decoded server replies. */
async function device() {
  // make sure the previous test's connection is fully gone on the server side
  await sleep(30);
  const socket = net.connect({ host: '127.0.0.1', port: tcpPort });
  clientSockets.add(socket);
  socket.on('close', () => clientSockets.delete(socket));
  await once(socket, 'connect');
  const parser = new FrameParser();
  const replies = [];
  socket.on('data', (c) => {
    for (const f of parser.feed(c)) replies.push(decodeFrame(f));
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
          reject(new Error('timeout waiting for reply; got ' + JSON.stringify(replies.map((x) => x.kind + ':' + x.typeHex))));
        }
      }, 10);
    });
  return { socket, replies, waitFor };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('login is ACKed and the device becomes connected', async () => {
  const d = await device();
  d.socket.write(E.buildLogin(IMEI, 1, { typeCode: 0x5500, timezoneHours: -4 }));
  const ack = await d.waitFor((r) => r.kind === 'ack' && r.type === 0x01);
  assert.equal(ack.serial, 1);
  const dev = store.devices.get(IMEI);
  assert.ok(dev);
  assert.equal(dev.connected, true);
  assert.equal(dev.login.timezoneHours, -4);
  d.socket.destroy();
  await sleep(50);
  assert.equal(store.devices.get(IMEI).connected, false);
});

test('location, heartbeat, alarm, time request and info are stored and acknowledged', async () => {
  const d = await device();
  d.socket.write(E.buildLogin(IMEI, 1));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x01);

  d.socket.write(E.buildLocation({ time: T, lat: 33.749, lon: -84.388, speed: 50, course: 90 }, { mcc: 310, mnc: 410 }, 2, { type: 0x22, mileage: 1000 }));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x22 && r.serial === 2);
  const dev = store.devices.get(IMEI);
  assert.ok(Math.abs(dev.lastPosition.lat - 33.749) < 1e-5);
  assert.equal(dev.lastPosition.mileageM, 1000);
  assert.equal(dev.lastPosition.source, '0x22');

  d.socket.write(E.buildHeartbeat(3, { terminal: { acc: true }, voltageLevel: 5, gsm: 4 }));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x13 && r.serial === 3);
  assert.equal(dev.lastStatus.terminal.acc, true);
  assert.equal(dev.counters.heartbeats, 1);

  d.socket.write(E.buildAlarm({ time: T, lat: 33.75, lon: -84.39 }, { mcc: 310, mnc: 410 }, 4, { alarm: 0x02 }));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x16 && r.serial === 4);
  assert.equal(dev.lastAlarm.alarm, 'power_cut');
  assert.ok(store.events.some((e) => e.kind === 'alarm' && e.imei === IMEI && e.alarm === 'power_cut'));

  d.socket.write(E.buildTimeRequest(5));
  const tr = await d.waitFor((r) => r.kind === 'time_response');
  assert.equal(tr.serial, 5);
  assert.ok(Math.abs(new Date(tr.time).getTime() - Date.now()) < 5000);

  d.socket.write(E.buildInfoVoltage(12.37, 6));
  await sleep(50);
  assert.equal(dev.externalVoltage, 12.37);
  assert.equal(d.replies.filter((r) => r.type === 0x94).length, 0, 'extended info frames are not ACKed by default');

  d.socket.write(E.buildObd({ 54: '0003E8F0', 74: '1HGCM82633A004352' }, 7));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x8c);
  assert.equal(dev.obd.vin, '1HGCM82633A004352');
  assert.equal(dev.obd.rpm, 2562.4);

  d.socket.destroy();
});

test('a frame split across two TCP segments is reassembled', async () => {
  const d = await device();
  const login = E.buildLogin(IMEI, 1);
  d.socket.write(login.subarray(0, 6));
  await sleep(30);
  d.socket.write(login.subarray(6));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x01);
  d.socket.destroy();
});

test('queued online command is delivered after login and its reply is matched', async () => {
  const d = await device();
  // queue while offline
  const queued = tracker.sendCommand(IMEI, 'STATUS#');
  assert.equal(queued.status, 'queued');
  d.socket.write(E.buildLogin(IMEI, 1));
  const cmd = await d.waitFor((r) => r.kind === 'server_command');
  assert.equal(cmd.text, 'STATUS#');
  assert.equal(store.commands.find((c) => c.id === queued.id).status, 'sent');
  d.socket.write(E.buildStringResponse('Battery:12.6V;GSM:Strong', 9, { serverFlag: cmd.serverFlag }));
  await sleep(50);
  const c = store.commands.find((x) => x.id === queued.id);
  assert.equal(c.status, 'answered');
  assert.equal(c.response, 'Battery:12.6V;GSM:Strong');
  assert.equal(d.replies.filter((r) => r.type === 0x15).length, 0, '0x15 replies are not ACKed');
  d.socket.destroy();
});

test('HTTP API: state, positions, decode, encode, command', async () => {
  const d = await device();
  d.socket.write(E.buildLogin(IMEI, 1));
  await d.waitFor((r) => r.kind === 'ack' && r.type === 0x01);

  const state = await (await fetch(`${httpBase}/api/state`)).json();
  assert.ok(state.devices.some((x) => x.imei === IMEI && x.connected));

  const positions = await (await fetch(`${httpBase}/api/devices/${IMEI}/positions?limit=10`)).json();
  assert.ok(positions.length >= 1);

  const decoded = await (
    await fetch(`${httpBase}/api/decode`, { method: 'POST', body: JSON.stringify({ hex: '78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A' }) })
  ).json();
  assert.equal(decoded.frames[0].imei, '123456789012345');

  const encoded = await (await fetch(`${httpBase}/api/encode`, { method: 'POST', body: JSON.stringify({ protocol: 'gt06', command: 'VERSION#', serial: 3 }) })).json();
  assert.equal(encoded.hex, hex(E.buildCommand('VERSION#', 3)));
  assert.equal(encoded.decoded.text, 'VERSION#');
  assert.equal(encoded.protocol, 'gt06');

  const res = await fetch(`${httpBase}/api/devices/${IMEI}/commands`, { method: 'POST', body: JSON.stringify({ command: 'WHERE#' }) });
  assert.equal(res.status, 202);
  const cmd = await d.waitFor((r) => r.kind === 'server_command' && r.text === 'WHERE#');
  assert.ok(cmd);

  const raw = await (await fetch(`${httpBase}/api/raw?imei=${IMEI}&limit=5`)).json();
  assert.ok(raw.length > 0 && raw.every((r) => r.imei === IMEI));

  const health = await (await fetch(`${httpBase}/api/health`)).json();
  assert.equal(health.ok, true);

  const html = await (await fetch(`${httpBase}/`)).text();
  assert.ok(html.includes('MV55G Test Platform'));
  d.socket.destroy();
});

test('garbage and CRC errors are recorded without crashing the session', async () => {
  const d = await device();
  d.socket.write(Buffer.from('GET / HTTP/1.1\r\n\r\n'));
  await sleep(30);
  const bad = E.buildLogin(IMEI, 1);
  bad[bad.length - 3] ^= 0xff; // corrupt CRC
  d.socket.write(bad);
  await sleep(50);
  assert.ok(store.events.some((e) => e.kind === 'crc_error'));
  assert.ok(store.raw.some((r) => r.note && (r.note.includes('skipped') || r.note.includes('unrecognised'))));
  // still works afterwards
  d.socket.write(E.buildLogin(IMEI, 2));
  await d.waitFor((r) => r.kind === 'ack' && r.serial === 2);
  d.socket.destroy();
});
