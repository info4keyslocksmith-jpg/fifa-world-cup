/**
 * MV55G test platform entry point.
 *
 *   TCP_PORT         port the tracker connects to        (default 7700, same as MiCODUS' own cloud)
 *   HTTP_PORT        dashboard + REST API                 (default 8080)
 *   DATA_DIR         JSONL persistence directory          (default ./data, set "" to disable)
 *   JT808_TZ_HOURS   offset the device applies to its BCD timestamps (default 0 = UTC; 8 = China time)
 *   JT808_TEXT_FLAG  flag byte of 0x8300 text commands    (default 1)
 *   FORCE_PROTOCOL   "jt808" or "gt06" to skip auto-detection
 *   ACK_EXTENDED     set to 1 to also ACK GT06 0x7979 frames
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { createTrackerServer } from './tcp-server.js';
import { createHttpServer } from './http-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TCP_PORT = +(process.env.TCP_PORT || 7700);
const HTTP_PORT = +(process.env.HTTP_PORT || 8080);
const DATA_DIR = process.env.DATA_DIR === '' ? null : process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TZ_HOURS = +(process.env.JT808_TZ_HOURS || 0);
const TEXT_FLAG = +(process.env.JT808_TEXT_FLAG || 1);
const FORCE_PROTOCOL = process.env.FORCE_PROTOCOL || null;
const ACK_EXTENDED = process.env.ACK_EXTENDED === '1';

const store = new Store({ dataDir: DATA_DIR });
const tracker = createTrackerServer({ store, ackExtended: ACK_EXTENDED, tzHours: TZ_HOURS, jt808TextFlag: TEXT_FLAG, forceProtocol: FORCE_PROTOCOL });
const httpServer = createHttpServer({ store, tracker, tcpPort: TCP_PORT, tzHours: TZ_HOURS });

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

const pad = (s, n) => String(s).slice(0, n).padEnd(n);

tracker.listen(TCP_PORT, '0.0.0.0', () => {
  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    const ips = lanAddresses();
    console.log(`
┌──────────────────────────────────────────────────────────────────────┐
│  MiCODUS MV55G test platform                                         │
├──────────────────────────────────────────────────────────────────────┤
│  Tracker TCP listener : ${pad('0.0.0.0:' + TCP_PORT + '  (JT808 + GT06, auto-detected)', 45)}│
│  Dashboard / API      : ${pad('http://localhost:' + HTTP_PORT, 45)}│
│  LAN addresses        : ${pad(ips.join(', ') || 'none detected', 45)}│
│  Data directory       : ${pad(DATA_DIR || 'disabled', 45)}│
│  JT808 time offset    : ${pad('UTC' + (TZ_HOURS >= 0 ? '+' : '') + TZ_HOURS + '  (JT808_TZ_HOURS)', 45)}│
├──────────────────────────────────────────────────────────────────────┤
│  Point the MV55G at this server by SMS (see docs/SMS-COMMANDS.md):   │
│    APN,<your-apn>#                                                   │
│    ${pad('SERVER,0,<public-ip>,' + TCP_PORT + '#        (or SERVER,1,<dns-name>,' + TCP_PORT + '#)', 66)}│
│  The port must be reachable from the cellular network (VPS, router   │
│  port-forward or TCP tunnel). The device shows up by its 11/12-digit │
│  MiCODUS ID, not by IMEI.                                            │
│                                                                      │
│  Try it without hardware:                                            │
│    ${pad('node simulator/simulate.js --port ' + TCP_PORT + ' --obd', 66)}│
└──────────────────────────────────────────────────────────────────────┘`);
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
