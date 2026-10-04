/**
 * TCP listener the tracker connects to.
 *
 *   device ──TCP──▶ FrameParser ──▶ decodeFrame ──▶ store (+ ACK back to device)
 *
 * Behaviour matches what a GT06-family device expects from a platform:
 *   - every device frame is acknowledged with an empty frame of the same
 *     protocol number and serial (login, heartbeat, location, alarm, ...)
 *   - 0x8A time requests are answered with UTC time
 *   - 0x15 / 0x21 command replies are never acknowledged
 *   - extended 0x7979 frames (0x94 info) are not acknowledged unless ACK_EXTENDED=1
 *   - queued online commands (0x80) are flushed as soon as the device is logged in
 */
import net from 'node:net';
import { FrameParser, hex } from './gt06/frame.js';
import { decodeFrame } from './gt06/decode.js';
import { buildAck, buildCommand, buildTimeResponse } from './gt06/encode.js';

const NO_ACK = new Set([0x15, 0x21, 0x80, 0x81, 0x82]);
const now = () => new Date().toISOString();

export function createTrackerServer({ store, log = console, ackExtended = false, idleTimeoutMs = 20 * 60 * 1000, commandOptions = {} } = {}) {
  const sessions = new Map(); // imei -> session
  const sockets = new Set(); // every open connection, logged in or not

  function send(session, buf, meta = {}) {
    if (session.socket.destroyed || !session.socket.writable) return false;
    session.socket.write(buf);
    store.addRaw({ dir: 'out', imei: session.imei, peer: session.peer, hex: hex(buf), ...meta });
    return true;
  }

  function flushCommands(session) {
    if (!session.imei) return;
    for (const cmd of store.pendingCommands(session.imei)) {
      const serial = session.cmdSerial++ & 0xffff;
      const frame = buildCommand(cmd.command, serial, { ...commandOptions, ...(cmd.options || {}) });
      send(session, frame, { type: '0x80', name: 'server_command', serial, commandId: cmd.id, text: cmd.command });
      store.updateCommand(cmd.id, { status: 'sent', sentAt: now(), serial, hex: hex(frame) });
      log.log(`[tcp] > ${session.imei} 0x80 command "${cmd.command}"`);
    }
  }

  function handleDecoded(session, d) {
    const imei = session.imei;
    switch (d.kind) {
      case 'login': {
        session.imei = d.imei;
        sessions.set(d.imei, session);
        store.touchDevice(d.imei, {
          connected: true,
          peer: session.peer,
          login: { typeCode: d.typeCode ?? null, timezoneHours: d.timezoneHours ?? null, language: d.language ?? null, at: now() },
        });
        store.addEvent({ kind: 'login', imei: d.imei, peer: session.peer, typeCode: d.typeCode, timezoneHours: d.timezoneHours });
        break;
      }
      case 'location': {
        if (!imei) break;
        store.addPosition({ imei, ...d.gps, lbs: d.lbs ?? null, acc: d.acc ?? null, uploadMode: d.uploadMode ?? null, mileageM: d.mileageM ?? null, source: d.typeHex });
        break;
      }
      case 'alarm': {
        if (!imei) break;
        if (d.gps?.valid) store.addPosition({ imei, ...d.gps, lbs: d.lbs ?? null, alarm: d.alarm ?? null, source: d.typeHex });
        store.touchDevice(imei, { lastStatus: d.status ?? null, lastAlarm: { alarm: d.alarm, code: d.status?.alarmCode, ts: now() } });
        store.addEvent({ kind: 'alarm', imei, alarm: d.alarm, code: d.status?.alarmCode, gps: d.gps ?? null, status: d.status ?? null });
        break;
      }
      case 'heartbeat': {
        if (!imei) break;
        const dev = store.touchDevice(imei, { lastStatus: d.status });
        dev.counters.heartbeats++;
        if (d.status?.alarm && d.status.alarm !== 'normal') {
          store.addEvent({ kind: 'alarm', imei, alarm: d.status.alarm, code: d.status.alarmCode, viaHeartbeat: true, status: d.status });
        }
        break;
      }
      case 'info': {
        if (!imei) break;
        const dev = store.device(imei);
        const { rawHex, contentHex, ...rest } = d;
        dev.info[d.subtypeName] = { ...rest, ts: now() };
        store.touchDevice(imei, d.externalVoltage != null ? { externalVoltage: d.externalVoltage } : {});
        store.addEvent({ kind: 'info', imei, subtype: d.subtype, subtypeName: d.subtypeName, detail: rest });
        break;
      }
      case 'obd': {
        if (!imei) break;
        store.touchDevice(imei, { obd: { ...d.parsed, pairs: d.pairs, time: d.time, ts: now() } });
        store.addEvent({ kind: 'obd', imei, parsed: d.parsed, pairs: d.pairs });
        break;
      }
      case 'command_response': {
        if (!imei) break;
        const c = store.lastSentCommand(imei);
        if (c) store.updateCommand(c.id, { status: 'answered', answeredAt: now(), response: d.text });
        store.addEvent({ kind: 'command_response', imei, text: d.text, commandId: c?.id ?? null });
        break;
      }
      case 'time_request':
      case 'lbs':
        break;
      default:
        store.addEvent({ kind: d.kind, imei, type: d.typeHex, name: d.name, error: d.error ?? null, hex: d.rawHex });
    }
    const dev = store.device(session.imei);
    if (dev) dev.counters.frames++;
  }

  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const session = { socket, peer, imei: null, cmdSerial: 1, parser: new FrameParser(), connectedAt: now() };
    sockets.add(socket);
    socket.setTimeout(idleTimeoutMs);
    socket.setKeepAlive(true, 60_000);
    log.log(`[tcp] + ${peer} connected`);
    store.addEvent({ kind: 'connect', peer });

    socket.on('data', (chunk) => {
      const garbageBefore = session.parser.garbage;
      const frames = session.parser.feed(chunk);
      if (session.parser.garbage > garbageBefore) {
        store.addRaw({ dir: 'in', imei: session.imei, peer, hex: hex(chunk), note: `${session.parser.garbage - garbageBefore} byte(s) outside any frame were skipped` });
      }
      for (const frame of frames) {
        const d = decodeFrame(frame);
        store.addRaw({
          dir: 'in',
          imei: session.imei || (d.kind === 'login' ? d.imei : null),
          peer,
          hex: d.rawHex,
          type: d.typeHex,
          name: d.name,
          serial: d.serial,
          crcOk: d.crcOk,
          decoded: d,
        });
        if (!d.crcOk) store.addEvent({ kind: 'crc_error', imei: session.imei, type: d.typeHex, hex: d.rawHex, expected: d.crcCalc });
        handleDecoded(session, d);
        const extra =
          d.kind === 'location' ? ` ${d.gps.lat},${d.gps.lon} ${d.gps.speedKmh} km/h${d.gps.valid ? '' : ' (no fix)'}` : d.kind === 'alarm' ? ` ALARM=${d.alarm}` : '';
        log.log(`[tcp] < ${session.imei || peer} ${d.typeHex} ${d.name}${extra}`);

        let reply = null;
        let name = 'ack';
        if (frame.type === 0x8a) {
          reply = buildTimeResponse(frame.serial);
          name = 'time_response';
        } else if (!NO_ACK.has(frame.type) && (!frame.ext || ackExtended)) {
          reply = buildAck(frame.type, frame.serial);
        }
        if (reply) send(session, reply, { type: d.typeHex, name, serial: frame.serial });
        if (session.imei) flushCommands(session);
      }
    });

    socket.on('timeout', () => {
      log.log(`[tcp] ~ ${session.imei || peer} idle timeout, closing`);
      socket.destroy();
    });
    socket.on('error', (e) => store.addEvent({ kind: 'socket_error', imei: session.imei, peer, error: e.message }));
    const dropSession = () => {
      if (session.imei && sessions.get(session.imei) === session) {
        sessions.delete(session.imei);
        store.touchDevice(session.imei, { connected: false });
      }
    };
    socket.on('end', dropSession); // peer half-closed: stop sending commands to it
    socket.on('close', () => {
      sockets.delete(socket);
      log.log(`[tcp] - ${session.imei || peer} disconnected`);
      store.addEvent({ kind: 'disconnect', imei: session.imei, peer });
      dropSession();
    });
  });

  server.sessions = sessions;
  server.sockets = sockets;

  /** Destroy every open connection (used on shutdown and in tests). */
  server.destroyAll = () => {
    for (const s of sockets) s.destroy();
    sockets.clear();
    sessions.clear();
  };

  /** Queue an online command; it is sent immediately if the device is connected. */
  server.sendCommand = (imei, command, options) => {
    const c = store.queueCommand(imei, command, options ? { options } : {});
    const s = sessions.get(imei);
    if (s) flushCommands(s);
    return c;
  };

  /** Send an arbitrary pre-built frame to a connected device (for protocol experiments). */
  server.sendRaw = (imei, buf) => {
    const s = sessions.get(imei);
    if (!s) return false;
    return send(s, buf, { type: 'raw', name: 'raw_frame' });
  };

  return server;
}
