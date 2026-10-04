#!/usr/bin/env node
/**
 * MV55G / GT06-family device simulator.
 *
 * Connects to the test server exactly like a tracker: login, time request,
 * periodic location + heartbeat, occasional alarms, info and OBD frames, and
 * replies to 0x80 online commands with 0x15 / 0x21 responses.
 *
 *   node simulator/simulate.js --host 127.0.0.1 --port 5023
 *   node simulator/simulate.js --imei 353419989226948 --route miami --interval 3 --speed 60 --count 20
 *   node simulator/simulate.js --replay capture.hex            # resend captured frames (one per line)
 *
 * Options
 *   --host/--port       server (default 127.0.0.1:5023)
 *   --imei              15-digit IMEI (default 353419989226948)
 *   --route             atlanta | miami | sydney | circle (default atlanta)
 *   --type              location protocol: 0x12 | 0x22 | 0xA0 (default 0x22)
 *   --interval          seconds between location packets (default 5)
 *   --speed             km/h along the route (default 45)
 *   --count             number of location packets, 0 = forever (default 0)
 *   --heartbeat-every   send a heartbeat every N locations (default 4)
 *   --alarm-every       send an alarm every N locations, 0 = never (default 12)
 *   --obd               also send OBD (0x8C) and info (0x94) frames
 *   --no-fix            send locations without a GPS fix
 *   --ext-reply         answer commands with 0x21 (0x7979) instead of 0x15
 *   --replay FILE       send hex frames from FILE line by line (ignores route options)
 *   --quiet             less logging
 */
import net from 'node:net';
import fs from 'node:fs';
import * as E from '../src/gt06/encode.js';
import { FrameParser, hex, fromHex } from '../src/gt06/frame.js';
import { decodeFrame } from '../src/gt06/decode.js';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const O = {
  host: opt('host', '127.0.0.1'),
  port: +opt('port', 5023),
  imei: String(opt('imei', '353419989226948')),
  route: opt('route', 'atlanta'),
  type: parseInt(opt('type', '0x22'), 16),
  interval: +opt('interval', 5),
  speed: +opt('speed', 45),
  count: +opt('count', 0),
  heartbeatEvery: +opt('heartbeat-every', 4),
  alarmEvery: +opt('alarm-every', 12),
  obd: !!opt('obd', false),
  noFix: !!opt('no-fix', false),
  extReply: !!opt('ext-reply', false),
  replay: opt('replay', null),
  quiet: !!opt('quiet', false),
};
if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^\/\*\*?/, ''));
  process.exit(0);
}
const log = (...a) => !O.quiet && console.log(new Date().toISOString().slice(11, 23), ...a);

// ---------------------------------------------------------------------------
// Routes (lat, lon waypoints) and motion model
// ---------------------------------------------------------------------------
const ROUTES = {
  atlanta: [[33.749, -84.388], [33.7701, -84.3876], [33.7838, -84.3828], [33.7905, -84.3661], [33.7783, -84.3521], [33.7592, -84.3579], [33.7488, -84.3734]],
  miami: [[25.7617, -80.1918], [25.7743, -80.1937], [25.7907, -80.1874], [25.8028, -80.1996], [25.7906, -80.2105], [25.7700, -80.2057]],
  sydney: [[-33.8688, 151.2093], [-33.8737, 151.2069], [-33.8830, 151.2007], [-33.8915, 151.1950], [-33.8826, 151.2120], [-33.8705, 151.2155]],
  circle: Array.from({ length: 24 }, (_, i) => [33.749 + 0.01 * Math.cos((i / 24) * 2 * Math.PI), -84.388 + 0.012 * Math.sin((i / 24) * 2 * Math.PI)]),
};
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
function bearing([lat1, lon1], [lat2, lon2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function distanceM(a, b) {
  const R = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
class Vehicle {
  constructor(route, speedKmh) {
    this.route = route;
    this.speed = speedKmh;
    this.seg = 0;
    this.pos = [...route[0]];
    this.mileage = 0;
  }
  step(seconds) {
    let remaining = (this.speed / 3.6) * seconds;
    while (remaining > 0) {
      const target = this.route[(this.seg + 1) % this.route.length];
      const d = distanceM(this.pos, target);
      if (d <= remaining) {
        this.pos = [...target];
        this.seg = (this.seg + 1) % this.route.length;
        remaining -= d;
        this.mileage += d;
      } else {
        const f = remaining / d;
        this.pos = [this.pos[0] + (target[0] - this.pos[0]) * f, this.pos[1] + (target[1] - this.pos[1]) * f];
        this.mileage += remaining;
        remaining = 0;
      }
    }
    return { lat: this.pos[0], lon: this.pos[1], course: bearing(this.pos, this.route[(this.seg + 1) % this.route.length]), speed: this.speed };
  }
}

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------
const route = ROUTES[O.route] || ROUTES.atlanta;
const lbs = route[0][0] < 0 ? { mcc: 505, mnc: 1, lac: 0x2a3b, cid: 0x00beef } : { mcc: 310, mnc: 410, lac: 0x1a2b, cid: 0x00c0de };
const vehicle = new Vehicle(route, O.speed);
let serial = 1;
let sent = 0;
let voltage = 12.6;
let timer = null;
let socket = null;
let acked = 0;
const parser = new FrameParser();

function send(buf, label) {
  if (!socket || socket.destroyed) return;
  socket.write(buf);
  log(`> ${label.padEnd(18)} ${hex(buf)}`);
}

function fakeReply(cmd) {
  const c = cmd.toUpperCase().replace(/#$/, '');
  if (c === 'STATUS') return `Battery:${voltage.toFixed(2)}V;GPRS:Link Up;GSM Signal Level:Strong;GPS:Successful positioning;ACC:ON;Defense:OFF;Oil and electricity:Connected`;
  if (c === 'VERSION') return 'MV55G_SIM_V1.0.0 2026-10-04';
  if (c === 'PARAM') return `IMEI:${O.imei};TIMER:${O.interval},300;SERVER:${O.host}:${O.port};APN:internet;GMT:E,0;SENDS:5;SOS:;CENTER:;`;
  if (c === 'WHERE') return `Lat:${vehicle.pos[0].toFixed(6)},Lon:${vehicle.pos[1].toFixed(6)},Speed:${O.speed}km/h,Time:${new Date().toISOString()}`;
  if (c === 'RESET') return 'RESET OK';
  if (c.startsWith('TIMER') || c.startsWith('GMT') || c.startsWith('APN') || c.startsWith('SERVER')) return 'OK';
  return `Unknown command: ${cmd}`;
}

function onServerFrame(frame) {
  const d = decodeFrame(frame);
  if (d.kind === 'ack') {
    acked++;
    log(`< ack ${d.typeHex} serial ${d.serial}`);
  } else if (d.kind === 'time_response') {
    log(`< time response ${d.time}`);
  } else if (d.kind === 'server_command') {
    log(`< COMMAND "${d.text}" (serverFlag ${d.serverFlag})`);
    const reply = fakeReply(d.text);
    const frameOut = O.extReply
      ? E.buildOnlineCommandResponse(reply, serial++, { serverFlag: d.serverFlag })
      : E.buildStringResponse(reply, serial++, { serverFlag: d.serverFlag });
    setTimeout(() => send(frameOut, O.extReply ? 'reply 0x21' : 'reply 0x15'), 300);
    if (d.text.toUpperCase().startsWith('RESET')) setTimeout(() => socket.destroy(), 800);
  } else {
    log(`< ${d.typeHex} ${d.name} ${d.rawHex}`);
  }
}

function tick() {
  const m = vehicle.step(O.interval);
  const gps = { time: new Date(), lat: m.lat, lon: m.lon, speed: m.speed, course: m.course, satellites: 8 + (sent % 5), valid: !O.noFix };
  send(E.buildLocation(gps, lbs, serial++, { type: O.type, acc: 1, uploadMode: 0x00, mileage: Math.round(vehicle.mileage) }), `location ${'0x' + O.type.toString(16).toUpperCase()}`);
  sent++;
  if (O.heartbeatEvery && sent % O.heartbeatEvery === 0) {
    voltage = 12.3 + Math.random() * 0.6;
    send(E.buildHeartbeat(serial++, { terminal: { acc: true, charging: true, gpsTracking: true }, voltageLevel: 6, gsm: 3 + (sent % 2) }), 'heartbeat 0x13');
    if (O.obd) send(E.buildInfoVoltage(voltage, serial++), 'info voltage 0x94');
  }
  if (O.alarmEvery && sent % O.alarmEvery === 0) {
    const codes = [0x03, 0x02, 0x06, 0x29, 0x30];
    const alarm = codes[(sent / O.alarmEvery) % codes.length | 0];
    send(E.buildAlarm(gps, lbs, serial++, { terminal: { acc: true, charging: true }, alarm }), `alarm 0x16 (0x${alarm.toString(16)})`);
  }
  if (O.obd && sent % 6 === 3) {
    const rpm = 800 + Math.round(m.speed * 35);
    send(
      E.buildObd(
        {
          40: Math.round(vehicle.mileage / 10 + 1234500).toString(16).toUpperCase().padStart(8, '0'),
          43: Math.round(6200 - sent * 3).toString(16).toUpperCase().padStart(8, '0'),
          45: Math.round(8900).toString(16).toUpperCase().padStart(8, '0'),
          53: Math.round(m.speed * 100).toString(16).toUpperCase().padStart(8, '0'),
          54: Math.round(rpm * 100).toString(16).toUpperCase().padStart(8, '0'),
          74: '1HGCM82633A004352',
        },
        serial++,
      ),
      'obd 0x8C',
    );
  }
  if (O.count && sent >= O.count) {
    log(`done: ${sent} location packets sent, ${acked} acks received`);
    clearInterval(timer);
    setTimeout(() => socket.end(), 500);
  }
}

function replay(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  let i = 0;
  const next = () => {
    if (i >= lines.length) {
      log('replay finished');
      setTimeout(() => socket.end(), 1000);
      return;
    }
    const buf = fromHex(lines[i++]);
    send(buf, `replay ${i}/${lines.length}`);
    setTimeout(next, O.interval * 1000);
  };
  next();
}

function connect() {
  log(`connecting to ${O.host}:${O.port} as IMEI ${O.imei} (${O.replay ? 'replay ' + O.replay : 'route ' + O.route + ', ' + O.speed + ' km/h'})`);
  socket = net.connect({ host: O.host, port: O.port });
  socket.on('connect', () => {
    log('connected');
    if (O.replay) return replay(O.replay);
    send(E.buildLogin(O.imei, serial++, { typeCode: 0x5500, timezoneHours: 0 }), 'login 0x01');
    setTimeout(() => send(E.buildTimeRequest(serial++), 'time request 0x8A'), 400);
    if (O.obd) setTimeout(() => send(E.buildInfoIds({ imei: O.imei, imsi: '310410123456789', iccid: '89014103211118510720' }, serial++), 'info ICCID 0x94'), 700);
    setTimeout(() => {
      tick();
      timer = setInterval(tick, O.interval * 1000);
    }, 1000);
  });
  socket.on('data', (chunk) => {
    for (const f of parser.feed(chunk)) onServerFrame(f);
  });
  socket.on('error', (e) => log('socket error:', e.message));
  socket.on('close', () => {
    clearInterval(timer);
    log('disconnected');
    if (!O.count && !O.replay) {
      log('reconnecting in 5 s');
      setTimeout(connect, 5000);
    } else {
      process.exit(0);
    }
  });
}

connect();
