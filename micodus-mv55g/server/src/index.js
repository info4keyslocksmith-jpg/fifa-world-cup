/**
 * MV55G test platform entry point.
 *
 *   TCP_PORT      port the tracker connects to          (default 5023, the Traccar GT06 port)
 *   HTTP_PORT     dashboard + REST API                   (default 8080)
 *   DATA_DIR      JSONL persistence directory            (default ./data, set "" to disable)
 *   ACK_EXTENDED  set to 1 to also ACK 0x7979 frames     (default off)
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createTrackerServer } from './tcp-server.js';
import { createHttpServer } from './http-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TCP_PORT = +(process.env.TCP_PORT || 5023);
const HTTP_PORT = +(process.env.HTTP_PORT || 8080);
const DATA_DIR = process.env.DATA_DIR === '' ? null : process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ACK_EXTENDED = process.env.ACK_EXTENDED === '1';

const store = new Store({ dataDir: DATA_DIR });
const tracker = createTrackerServer({ store, ackExtended: ACK_EXTENDED });
const httpServer = createHttpServer({ store, tracker, tcpPort: TCP_PORT });

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

tracker.listen(TCP_PORT, '0.0.0.0', () => {
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    const ips = lanAddresses();
    const ip = ips[0] || '<this-machine-ip>';
    console.log(`
┌──────────────────────────────────────────────────────────────────────┐
│  MiCODUS MV55G test platform                                         │
├──────────────────────────────────────────────────────────────────────┤
│  Tracker TCP listener : 0.0.0.0:${String(TCP_PORT).padEnd(37)}│
│  Dashboard / API      : http://localhost:${String(HTTP_PORT).padEnd(28)}│
│  LAN addresses        : ${(ips.join(', ') || 'none detected').padEnd(45)}│
│  Data directory       : ${(DATA_DIR || 'disabled').slice(0, 45).padEnd(45)}│
├──────────────────────────────────────────────────────────────────────┤
│  Point the device at this server (SMS, default password 123456):     │
│    SERVER,1,<public-ip-or-dns>,${String(TCP_PORT)},0#${' '.repeat(Math.max(0, 33 - String(TCP_PORT).length))}│
│  The device must reach this port from the cellular network: use a    │
│  VPS, a router port-forward, or a TCP tunnel (see docs/TEST-PLAN.md) │
│                                                                      │
│  Try it without hardware:                                            │
│    node simulator/simulate.js --host 127.0.0.1 --port ${String(TCP_PORT).padEnd(14)}│
└──────────────────────────────────────────────────────────────────────┘`);
    void ip;
  });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} received, shutting down`);
    tracker.close();
    httpServer.close();
    tracker.destroyAll();
    setTimeout(() => process.exit(0), 200).unref();
  });
}
