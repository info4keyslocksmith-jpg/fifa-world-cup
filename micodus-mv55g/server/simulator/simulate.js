#!/usr/bin/env node
/**
 * MiCODUS device simulator.
 *
 * Default mode imitates the MV55G: JT/T 808 framing (0x7E), 12-digit terminal id,
 * register -> auth -> heartbeat / location with the MiCODUS OBD items, blind-zone
 * batch uploads, alarm bits, and replies to 0x8300 text commands, 0x8201 position
 * queries and 0x8104 parameter queries. `--protocol gt06` imitates the older
 * MV7xx family (0x78 0x78 framing, IMEI login).
 *
 *   node simulator/simulate.js                       # JT808, id 019172682984, Atlanta loop
 *   node simulator/simulate.js --obd --interval 3    # with the full OBD item set
 *   node simulator/simulate.js --protocol gt06 --imei 353419989226948
 *   node simulator/simulate.js --replay capture.hex  # resend captured frames line by line
 *
 * Options
 *   --host/--port       server (default 127.0.0.1:7700)
 *   --protocol          jt808 (default) | gt06
 *   --id                JT808 terminal id, 11 or 12 digits (default 019172682984)
 *   --imei              GT06 IMEI (default 353419989226948)
 *   --route             atlanta | miami | sydney | circle (default atlanta)
 *   --interval          seconds between location packets (default 5)
 *   --speed             km/h along the route (default 45)
 *   --count             number of location packets, 0 = forever (default 0)
 *   --heartbeat-every   heartbeat every N locations (default 4)
 *   --alarm-every       alarm every N locations, 0 = never (default 12)
 *   --batch-every       JT808 blind-zone batch (3 points) every N locations, 0 = never (default 15)
 *   --obd               include the OBD items / frames
 *   --no-fix            report positions without a GPS fix
 *   --tz                hours the device adds to its BCD timestamps (JT808, default 0)
 *   --version2019       use JT808-2019 framing (version byte, 10-byte id)
 *   --type              GT06 location protocol number: 0x12 | 0x22 | 0xA0 (default 0x22)
 *   --replay FILE       send hex frames from FILE line by line (ignores route options)
 *   --quiet             less logging
 */
import net from 'node:net';
import fs from 'node:fs';
import * as GE from '../src/gt06/encode.js';
import * as GF from '../src/gt06/frame.js';
import { decodeFrame as gt06Decode } from '../src/gt06/decode.js';
import * as JE from '../src/jt808/encode.js';
import * as JF from '../src/jt808/frame.js';
import { decodeFrame as jt808Decode } from '../src/jt808/decode.js';

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
if (args.includes('--help') || args.includes('-h')) {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('*/')[0].replace(/^#!.*\n\/\*\*?/, ''));
  process.exit(0);
}
const O = {
  host: opt('host', '127.0.0.1'),
  port: +opt('port', 7700),
  protocol: String(opt('protocol', 'jt808')).toLowerCase(),
  id: String(opt('id', '019172682984')).replace(/\D/g, ''),
  imei: String(opt('imei', '353419989226948')),
  route: opt('route', 'atlanta'),
  interval: +opt('interval', 5),
  speed: +opt('speed', 45),
  count: +opt('count', 0),
  heartbeatEvery: +opt('heartbeat-every', 4),
  alarmEvery: +opt('alarm-every', 12),
  batchEvery: +opt('batch-every', 15),
  obd: !!opt('obd', false),
  noFix: !!opt('no-fix', false),
  tz: +opt('tz', 0),
  version2019: !!opt('version2019', false),
  type: parseInt(opt('type', '0x22'), 16),
  replay: opt('replay', null),
  quiet: !!opt('quiet', false),
  // scenario switches for the maintenance / health rules
  dtc: !!opt('dtc', false), // always report fault codes P0301,P0420
  weakBattery: !!opt('weak-battery', false), // engine off, 11.9 V resting voltage
  engineOff: !!opt('engine-off', false), // ACC off, RPM 0, parked
  hot: !!opt('hot', false), // coolant 112 °C
};
if (O.id.length === 11) O.id = '0' + O.id;
const log = (...a) => !O.quiet && console.log(new Date().toISOString().slice(11, 23), ...a);
const hex = GF.hex;

// ---------------------------------------------------------------------------
// Routes and motion model
// ---------------------------------------------------------------------------
const ROUTES = {
  atlanta: [[33.749, -84.388], [33.7701, -84.3876], [33.7838, -84.3828], [33.7905, -84.3661], [33.7783, -84.3521], [33.7592, -84.3579], [33.7488, -84.3734]],
  miami: [[25.7617, -80.1918], [25.7743, -80.1937], [25.7907, -80.1874], [25.8028, -80.1996], [25.7906, -80.2105], [25.77, -80.2057]],
  sydney: [[-33.8688, 151.2093], [-33.8737, 151.2069], [-33.883, 151.2007], [-33.8915, 151.195], [-33.8826, 151.212], [-33.8705, 151.2155]],
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
    this.mileageM = 1234500;
    this.rpm = 800;
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
        this.mileageM += d;
      } else {
        const f = remaining / d;
        this.pos = [this.pos[0] + (target[0] - this.pos[0]) * f, this.pos[1] + (target[1] - this.pos[1]) * f];
        this.mileageM += remaining;
        remaining = 0;
      }
    }
    this.rpm = 800 + Math.round(this.speed * 35 + (Math.random() - 0.5) * 200);
    return { lat: this.pos[0], lon: this.pos[1], course: bearing(this.pos, this.route[(this.seg + 1) % this.route.length]), speed: this.speed };
  }
}

const route = ROUTES[O.route] || ROUTES.atlanta;
const vehicle = new Vehicle(route, O.speed);
const VIN = '1HGCM82633A004352';
let socket = null;
let timer = null;
let sent = 0;
let acked = 0;
let serial = 1;
let voltage = 12.6;
let fuel = 62;

function write(buf, label) {
  if (!socket || socket.destroyed) return;
  socket.write(buf);
  log(`> ${label.padEnd(22)} ${hex(buf)}`);
}

function fakeReply(cmd) {
  const c = cmd.toUpperCase().replace(/#$/, '').trim();
  if (c === 'STATUS') return `Battery:${voltage.toFixed(2)}V;GPRS:Link Up;GSM:Strong;GPS:A;ACC:ON;Defense:OFF`;
  if (c === 'VERSION') return `MV55G_SIM_V1.0.0 ID:${O.id.replace(/^0/, '')}`;
  if (c === 'PARAM') return `ID:${O.id.replace(/^0/, '')};TIMER:${O.interval};SERVER:${O.host}:${O.port};APN:internet;GMT:E,${O.tz};SPEED:120`;
  if (c === 'WHERE' || c === 'URL') return `Lat:${vehicle.pos[0].toFixed(6)},Lon:${vehicle.pos[1].toFixed(6)},Speed:${O.speed}km/h`;
  if (c === 'MILEAGE') return `Mileage:${(vehicle.mileageM / 1000).toFixed(1)}km`;
  if (c === 'RESET') return 'RESET OK';
  if (/^(TIMER|GMT|APN|SERVER|SPEED|ACCALM|PWRALM|SENALM|SOS|CENTER|PASSWORD|ARM|DISARM)/.test(c)) return 'OK';
  return `Unknown command: ${cmd}`;
}

// ---------------------------------------------------------------------------
// JT808 device (MV55G-like)
// ---------------------------------------------------------------------------
const jt808 = {
  parser: null,
  version: O.version2019 ? 1 : null,
  authed: false,
  fo() {
    return { version: this.version };
  },
  start() {
    this.parser = new JF.FrameParser();
    this.authed = false;
    write(JE.buildRegister(O.id, serial++, { manufacturer: 'MICOD', model: 'MV55G', terminalIdText: O.id.slice(-7), version: this.version }), 'register 0x0100');
  },
  onData(chunk) {
    for (const f of this.parser.feed(chunk)) {
      const d = jt808Decode(f, { tzHours: O.tz });
      switch (d.kind) {
        case 'register_response':
          log(`< register response ${d.resultName} auth="${d.authCode}"`);
          write(JE.buildAuth(O.id, serial++, d.authCode, this.fo()), 'auth 0x0102');
          break;
        case 'ack':
          acked++;
          if (d.replyMsgId === '0x0102' && !this.authed) {
            this.authed = true;
            log('< authenticated');
            setTimeout(() => this.tick(), 500);
            timer = setInterval(() => this.tick(), O.interval * 1000);
          } else log(`< ack ${d.replyMsgId} ${d.replyName} serial ${d.replySerial}`);
          break;
        case 'server_command': {
          log(`< COMMAND 0x8300 flag ${d.flag} "${d.text}"`);
          write(JE.buildTerminalGeneralResponse(O.id, serial++, f.serial, f.msgId, 0, this.fo()), 'general response 0x0001');
          setTimeout(() => write(JE.buildTextReport(O.id, serial++, fakeReply(d.text), this.fo()), 'text report 0x6006'), 300);
          if (d.text.toUpperCase().startsWith('RESET')) setTimeout(() => socket.destroy(), 800);
          break;
        }
        case 'location_query':
          log('< position query 0x8201');
          write(JE.buildFrame(0x0201, O.id, serial++, Buffer.concat([Buffer.from([f.serial >> 8, f.serial & 0xff]), JE.encodeLocationBody(this.location(vehicle.step(0)))]), this.fo()), 'query response 0x0201');
          break;
        case 'query_parameters': {
          log('< parameter query 0x8104');
          const params = [
            { id: 0x0001, value: 60 },
            { id: 0x0013, value: O.host },
            { id: 0x0018, value: O.port },
            { id: 0x0029, value: O.interval },
            { id: 0x0055, value: 120 },
            { id: 0x0080, value: Math.round(vehicle.mileageM / 100) },
          ];
          const body = JE.buildSetParameters(O.id, 0, params); // reuse the TLV encoder, then rebuild as 0x0104
          const tlv = JF.parseFrame(body).body;
          write(JE.buildFrame(0x0104, O.id, serial++, Buffer.concat([Buffer.from([f.serial >> 8, f.serial & 0xff]), tlv]), this.fo()), 'param response 0x0104');
          break;
        }
        case 'terminal_control':
          log(`< terminal control ${d.commandName}`);
          write(JE.buildTerminalGeneralResponse(O.id, serial++, f.serial, f.msgId, 0, this.fo()), 'general response 0x0001');
          if (d.command === 4 || d.command === 5) setTimeout(() => socket.destroy(), 800);
          break;
        default:
          log(`< ${d.typeHex} ${d.name} ${d.rawHex}`);
          write(JE.buildTerminalGeneralResponse(O.id, serial++, f.serial, f.msgId, d.kind === 'unknown' ? 3 : 0, this.fo()), 'general response 0x0001');
      }
    }
  },
  location(m, extra = {}) {
    const parked = O.engineOff || O.weakBattery;
    const v = O.weakBattery ? 11.9 : parked ? 12.5 : voltage + 1.6; // ~14.1 V with the alternator running
    const items = JE.micodusObdItems({
      mileageKm: vehicle.mileageM / 1000,
      rssi: 20 + (sent % 8),
      satellites: 8 + (sent % 5),
      voltage: v,
      ...(O.obd
        ? {
            speedKmh: parked ? 0 : m.speed,
            rpm: parked ? 0 : vehicle.rpm,
            engineLoad: parked ? 0 : 30 + (sent % 20),
            coolantC: O.hot ? 112 : parked ? 40 : 86 + (sent % 4),
            fuelRateLph: parked ? 0 : 2 + m.speed / 30,
            intakeTempC: 31,
            mafGps: 12.3,
            mapKpa: 101,
            throttle: parked ? 0 : 15 + (sent % 10),
            odometerKm: vehicle.mileageM / 1000 + 50000,
            fuelLevel: fuel,
            batteryPct: 90,
            ...(sent % 10 === 0 ? { vin: VIN } : {}),
            ...(O.dtc || sent % 20 === 5 ? { dtcs: ['P0301', 'P0420'] } : {}),
          }
        : {}),
    });
    return { time: new Date(), tzHours: O.tz, lat: m.lat, lon: m.lon, altitude: 300, speedKmh: parked ? 0 : m.speed, course: m.course, acc: !parked, valid: !O.noFix, items, ...extra };
  },
  tick() {
    const m = O.engineOff || O.weakBattery ? vehicle.step(0) : vehicle.step(O.interval);
    voltage = 12.3 + Math.random() * 0.6;
    if (O.obd && sent % 6 === 0) fuel = Math.max(5, fuel - 1);
    let alarmBits = [];
    let extraItems = [];
    if (O.alarmEvery && sent > 0 && sent % O.alarmEvery === 0) {
      const choice = (sent / O.alarmEvery) % 4;
      if (choice === 0) alarmBits = [8]; // main power cut (unplugged)
      else if (choice === 1) alarmBits = [1]; // overspeed
      else if (choice === 2) alarmBits = [28]; // illegal displacement / tow
      else {
        const ext = Buffer.alloc(8);
        ext.writeUInt16BE(1 << 9, 0); // harsh braking
        extraItems = [JE.item.raw(0x57, ext)];
      }
    }
    const loc = this.location(m, { alarmBits });
    loc.items.push(...extraItems);
    write(JE.buildLocation(O.id, serial++, loc, this.fo()), `location 0x0200${alarmBits.length || extraItems.length ? ' (alarm)' : ''}`);
    sent++;
    if (O.heartbeatEvery && sent % O.heartbeatEvery === 0) write(JE.buildHeartbeat(O.id, serial++, this.fo()), 'heartbeat 0x0002');
    if (O.batchEvery && sent % O.batchEvery === 0) {
      const pts = [1, 2, 3].map((k) => ({ ...this.location(vehicle.step(O.interval)), time: new Date(Date.now() - (4 - k) * O.interval * 1000) }));
      write(JE.buildLocationBatch(O.id, serial++, pts, { type: 1, ...this.fo() }), 'batch 0x0704 (3 pts)');
    }
    this.checkDone();
  },
  checkDone() {
    if (O.count && sent >= O.count) {
      log(`done: ${sent} location packets sent, ${acked} acks received`);
      clearInterval(timer);
      setTimeout(() => socket.end(), 500);
    }
  },
};

// ---------------------------------------------------------------------------
// GT06 device (MV7xx-like)
// ---------------------------------------------------------------------------
const gt06 = {
  parser: null,
  lbs: route[0][0] < 0 ? { mcc: 505, mnc: 1, lac: 0x2a3b, cid: 0x00beef } : { mcc: 310, mnc: 410, lac: 0x1a2b, cid: 0x00c0de },
  start() {
    this.parser = new GF.FrameParser();
    write(GE.buildLogin(O.imei, serial++, { typeCode: 0x5500, timezoneHours: O.tz }), 'login 0x01');
    setTimeout(() => write(GE.buildTimeRequest(serial++), 'time request 0x8A'), 400);
    if (O.obd) setTimeout(() => write(GE.buildInfoIds({ imei: O.imei, imsi: '310410123456789', iccid: '89014103211118510720' }, serial++), 'info ICCID 0x94'), 700);
    setTimeout(() => {
      this.tick();
      timer = setInterval(() => this.tick(), O.interval * 1000);
    }, 1000);
  },
  onData(chunk) {
    for (const f of this.parser.feed(chunk)) {
      const d = gt06Decode(f);
      if (d.kind === 'ack') {
        acked++;
        log(`< ack ${d.typeHex} serial ${d.serial}`);
      } else if (d.kind === 'time_response') log(`< time response ${d.time}`);
      else if (d.kind === 'server_command') {
        log(`< COMMAND 0x80 "${d.text}"`);
        setTimeout(() => write(GE.buildStringResponse(fakeReply(d.text), serial++, { serverFlag: d.serverFlag }), 'reply 0x15'), 300);
        if (d.text.toUpperCase().startsWith('RESET')) setTimeout(() => socket.destroy(), 800);
      } else log(`< ${d.typeHex} ${d.name} ${d.rawHex}`);
    }
  },
  tick() {
    const m = vehicle.step(O.interval);
    const gps = { time: new Date(), lat: m.lat, lon: m.lon, speed: m.speed, course: m.course, satellites: 8 + (sent % 5), valid: !O.noFix };
    write(GE.buildLocation(gps, this.lbs, serial++, { type: O.type, acc: 1, uploadMode: 0x00, mileage: Math.round(vehicle.mileageM) }), `location 0x${O.type.toString(16).toUpperCase()}`);
    sent++;
    if (O.heartbeatEvery && sent % O.heartbeatEvery === 0) {
      voltage = 12.3 + Math.random() * 0.6;
      write(GE.buildHeartbeat(serial++, { terminal: { acc: true, charging: true, gpsTracking: true }, voltageLevel: 6, gsm: 3 + (sent % 2) }), 'heartbeat 0x13');
      if (O.obd) write(GE.buildInfoVoltage(voltage, serial++), 'info voltage 0x94');
    }
    if (O.alarmEvery && sent % O.alarmEvery === 0) {
      const codes = [0x03, 0x02, 0x06, 0x29, 0x30];
      const alarm = codes[(sent / O.alarmEvery) % codes.length | 0];
      write(GE.buildAlarm(gps, this.lbs, serial++, { terminal: { acc: true, charging: true }, alarm }), `alarm 0x16 (0x${alarm.toString(16)})`);
    }
    if (O.obd && sent % 6 === 3) {
      const h = (n) => Math.round(n).toString(16).toUpperCase().padStart(8, '0');
      write(GE.buildObd({ 40: h(vehicle.mileageM / 10), 43: h(fuel * 100), 45: h(8900), 53: h(m.speed * 100), 54: h(vehicle.rpm * 100), 74: VIN }, serial++), 'obd 0x8C');
    }
    jt808.checkDone();
  },
};

const device = O.protocol === 'gt06' ? gt06 : jt808;

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------
function replay(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  let i = 0;
  const next = () => {
    if (i >= lines.length) {
      log('replay finished');
      setTimeout(() => socket.end(), 1000);
      return;
    }
    write(GF.fromHex(lines[i++]), `replay ${i}/${lines.length}`);
    setTimeout(next, O.interval * 1000);
  };
  next();
}

function connect() {
  log(`connecting to ${O.host}:${O.port} as ${O.protocol === 'gt06' ? 'GT06 IMEI ' + O.imei : 'JT808 id ' + O.id} (${O.replay ? 'replay ' + O.replay : 'route ' + O.route + ', ' + O.speed + ' km/h'})`);
  socket = net.connect({ host: O.host, port: O.port });
  socket.on('connect', () => {
    log('connected');
    if (O.replay) {
      device.parser = O.protocol === 'gt06' ? new GF.FrameParser() : new JF.FrameParser();
      return replay(O.replay);
    }
    device.start();
  });
  socket.on('data', (chunk) => device.onData(chunk));
  socket.on('error', (e) => log('socket error:', e.message));
  socket.on('close', () => {
    clearInterval(timer);
    log('disconnected');
    if (!O.count && !O.replay) {
      log('reconnecting in 5 s');
      setTimeout(connect, 5000);
    } else process.exit(0);
  });
}

connect();
