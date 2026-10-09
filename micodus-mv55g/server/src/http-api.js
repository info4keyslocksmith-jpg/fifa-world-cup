/**
 * HTTP API + dashboard host. Zero dependencies.
 *
 *   GET  /                                  dashboard (web/index.html)
 *   GET  /api/health
 *   GET  /api/state                         devices + counters
 *   GET  /api/devices                       all devices
 *   GET  /api/devices/:id
 *   GET  /api/devices/:id/positions?limit=500
 *   POST /api/devices/:id/commands          {"command":"STATUS#"}  -> queued/sent (0x8300 JT808 or 0x80 GT06)
 *   POST /api/devices/:id/raw               {"hex":"7E ..."}       -> send a raw frame to the device
 *   GET  /api/raw?limit=200&imei=&since=    raw frames in/out (with decoded payload)
 *   GET  /api/events?limit=200&imei=&since=
 *   GET  /api/positions?limit=200&imei=&since=
 *   GET  /api/commands?imei=
 *   POST /api/decode                        {"hex":"7E 02 00 ..."} -> decoded frames, protocol auto-detected
 *   POST /api/encode                        {"protocol":"jt808","id":"019172682984","command":"STATUS#"} -> frame hex
 *   GET  /api/stream                        Server-Sent Events: raw, position, event, device, command
 *
 * `:id` is the device identifier: the 12-digit JT808 terminal id for the MV55G, the IMEI for GT06 devices.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromHex, hex } from './gt06/frame.js';
import { PROTOCOLS, decodeBuffer } from './protocols.js';
import { describeDtc } from './fleet/dtc-codes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');

export function decodeHex(text, opts = {}) {
  return decodeBuffer(fromHex(text), opts);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function slice(arr, url) {
  const limit = Math.min(5000, +(url.searchParams.get('limit') || 200));
  const imei = url.searchParams.get('imei') || url.searchParams.get('id');
  const since = +(url.searchParams.get('since') || 0);
  let items = arr;
  if (imei) items = items.filter((x) => x.imei === imei);
  if (since) items = items.filter((x) => x.id > since);
  return items.slice(-limit);
}

function sse(req, res, store) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
  });
  res.write(`event: hello\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
  const handlers = {};
  for (const ev of ['raw', 'position', 'event', 'device', 'command', 'alert']) {
    handlers[ev] = (payload) => res.write(`event: ${ev}\ndata: ${JSON.stringify(payload)}\n\n`);
    store.on(ev, handlers[ev]);
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    for (const [ev, h] of Object.entries(handlers)) store.off(ev, h);
  });
}

export function createHttpServer({ store, tracker, fleet = null, log = console, tcpPort = null, tzHours = 0 }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' });
      res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    };
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        return res.end();
      }
      const p = url.pathname;
      let m;
      if (p === '/' || p === '/index.html') return send(200, fs.readFileSync(path.join(WEB_DIR, 'index.html')), 'text/html; charset=utf-8');
      if (p === '/api/health') return send(200, { ok: true, tcpPort, uptimeS: Math.round(process.uptime()), startedAt: store.startedAt, protocols: Object.keys(PROTOCOLS) });
      if (p === '/api/state') return send(200, { ...store.snapshot(), tcpPort });
      if (p === '/api/devices') return send(200, [...store.devices.values()]);
      if ((m = p.match(/^\/api\/devices\/(\d+)$/))) {
        const d = store.devices.get(m[1]);
        return d ? send(200, d) : send(404, { error: 'unknown device' });
      }
      if ((m = p.match(/^\/api\/devices\/(\d+)\/positions$/))) {
        return send(200, store.positionsFor(m[1], +(url.searchParams.get('limit') || 500)));
      }
      if ((m = p.match(/^\/api\/devices\/(\d+)\/commands$/)) && req.method === 'POST') {
        const body = await readJson(req);
        if (!body.command) return send(400, { error: '"command" is required, e.g. {"command":"STATUS#"}' });
        return send(202, tracker.sendCommand(m[1], String(body.command), body.options));
      }
      if ((m = p.match(/^\/api\/devices\/(\d+)\/raw$/)) && req.method === 'POST') {
        const body = await readJson(req);
        const buf = fromHex(body.hex || '');
        if (!buf.length) return send(400, { error: '"hex" is required' });
        const sent = tracker.sendRaw(m[1], buf);
        return send(sent ? 202 : 409, { sent, hex: hex(buf), error: sent ? undefined : 'device not connected' });
      }
      if (p === '/api/raw') return send(200, slice(store.raw, url));
      if (p === '/api/events') return send(200, slice(store.events, url));
      if (p === '/api/positions') return send(200, slice(store.positions, url));
      if (p === '/api/commands') return send(200, slice(store.commands, url));
      if (p === '/api/decode' && req.method === 'POST') {
        const body = await readJson(req);
        return send(200, decodeHex(body.hex || '', { tzHours: body.tzHours ?? tzHours }));
      }
      if (p === '/api/encode' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body.command) return send(400, { error: '"command" is required' });
        const proto = PROTOCOLS[body.protocol || 'jt808'];
        if (!proto) return send(400, { error: `unknown protocol; use ${Object.keys(PROTOCOLS).join(' or ')}` });
        const fakeSession = { deviceId: body.id || '000000000000', txSerial: +(body.serial ?? 1), version: body.version ?? null, options: { commandOptions: {}, jt808TextFlag: body.flag ?? 0x01 } };
        const built = proto.command(fakeSession, String(body.command), body.options || {});
        return send(200, { protocol: proto.name, hex: hex(built.buf), meta: built.meta, decoded: decodeBuffer(built.buf).frames[0] });
      }
      if (p === '/api/stream') return sse(req, res, store);

      // ---- fleet: customer vehicles, maintenance, alerts ----
      if (p.startsWith('/api/vehicles') || p.startsWith('/api/alerts') || p.startsWith('/api/dtc/') || p === '/api/schedule') {
        if (!fleet) return send(503, { error: 'fleet service not enabled' });
        if (p === '/api/schedule') return send(200, fleet.schedule());
        if ((m = p.match(/^\/api\/dtc\/([A-Za-z0-9]+)$/))) return send(200, describeDtc(m[1]));
        if (p === '/api/vehicles' && req.method === 'GET') return send(200, fleet.listVehicles());
        if (p === '/api/vehicles' && req.method === 'POST') {
          const body = await readJson(req);
          try {
            return send(201, fleet.summary(fleet.addVehicle(body)));
          } catch (e) {
            return send(400, { error: e.message });
          }
        }
        if ((m = p.match(/^\/api\/vehicles\/([\w-]+)$/))) {
          if (req.method === 'GET') {
            const s = fleet.summary(m[1]);
            return s ? send(200, s) : send(404, { error: 'unknown vehicle' });
          }
          if (req.method === 'POST' || req.method === 'PATCH') {
            const body = await readJson(req);
            try {
              const v = fleet.updateVehicle(m[1], body);
              return v ? send(200, fleet.summary(v)) : send(404, { error: 'unknown vehicle' });
            } catch (e) {
              return send(400, { error: e.message });
            }
          }
          if (req.method === 'DELETE') return send(fleet.removeVehicle(m[1]) ? 200 : 404, { ok: true });
        }
        if ((m = p.match(/^\/api\/vehicles\/([\w-]+)\/service$/)) && req.method === 'POST') {
          const body = await readJson(req);
          try {
            const entry = fleet.logService(m[1], body);
            return send(201, { entry, vehicle: fleet.summary(m[1]) });
          } catch (e) {
            return send(400, { error: e.message });
          }
        }
        if (p === '/api/alerts' && req.method === 'GET') {
          const vehicle = url.searchParams.get('vehicle');
          const open = url.searchParams.get('open') === '1';
          let items = store.alerts;
          if (vehicle) items = items.filter((a) => a.vehicleId === vehicle);
          if (open) items = items.filter((a) => !a.acknowledged);
          return send(200, items.slice(-Math.min(2000, +(url.searchParams.get('limit') || 200))));
        }
        if ((m = p.match(/^\/api\/alerts\/(\d+)\/ack$/)) && req.method === 'POST') {
          const a = store.ackAlert(+m[1]);
          return a ? send(200, a) : send(404, { error: 'unknown alert' });
        }
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      log.error('[http]', e);
      return send(500, { error: String(e.message || e) });
    }
  });
}
