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
  for (const ev of ['raw', 'position', 'event', 'device', 'command']) {
    handlers[ev] = (payload) => res.write(`event: ${ev}\ndata: ${JSON.stringify(payload)}\n\n`);
    store.on(ev, handlers[ev]);
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    for (const [ev, h] of Object.entries(handlers)) store.off(ev, h);
  });
}

export function createHttpServer({ store, tracker, log = console, tcpPort = null, tzHours = 0 }) {
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
      return send(404, { error: 'not found' });
    } catch (e) {
      log.error('[http]', e);
      return send(500, { error: String(e.message || e) });
    }
  });
}
