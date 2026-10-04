/**
 * TCP listener the tracker connects to.
 *
 *   device ──TCP──▶ protocol detect (0x7E = JT808, 0x78/0x79 = GT06) ──▶ frame parser
 *          ──▶ decode ──▶ store  (+ protocol-correct replies back to the device)
 *
 * Replies follow what the device firmware expects from a platform:
 *   JT808: 0x8100 register response (auth code = device id), 0x8001 general response to
 *          every other terminal message, 0x8109 time sync; queued commands go out as 0x8300.
 *   GT06 : empty ACK with the same protocol number/serial, 0x8A time response; commands as 0x80.
 */
import net from 'node:net';
import { PROTOCOLS, detect } from './protocols.js';
import { hex } from './gt06/frame.js';

const now = () => new Date().toISOString();

export function createTrackerServer({
  store,
  log = console,
  ackExtended = false,
  idleTimeoutMs = 20 * 60 * 1000,
  commandOptions = {},
  tzHours = 0,
  jt808TextFlag = 0x01,
  forceProtocol = null,
} = {}) {
  const sessions = new Map(); // deviceId -> session
  const sockets = new Set();
  const options = { ackExtended, commandOptions, tzHours, jt808TextFlag };

  function send(session, buf, meta = {}) {
    if (session.socket.destroyed || !session.socket.writable) return false;
    session.socket.write(buf);
    store.addRaw({ dir: 'out', imei: session.deviceId, peer: session.peer, protocol: session.protocol?.name, hex: hex(buf), ...meta });
    return true;
  }

  function flushCommands(session) {
    if (!session.deviceId || !session.protocol) return;
    for (const cmd of store.pendingCommands(session.deviceId)) {
      let built;
      try {
        built = session.protocol.command(session, cmd.command, cmd.options || {});
      } catch (e) {
        store.updateCommand(cmd.id, { status: 'failed', error: String(e.message || e) });
        continue;
      }
      if (send(session, built.buf, { ...built.meta, commandId: cmd.id })) {
        store.updateCommand(cmd.id, { status: 'sent', sentAt: now(), serial: built.meta.serial, frameType: built.meta.type, hex: hex(built.buf) });
        log.log(`[tcp] > ${session.deviceId} ${built.meta.type} ${built.meta.name} "${cmd.command}"`);
      }
    }
  }

  function bindDevice(session, id) {
    if (session.deviceId === id) return;
    session.deviceId = id;
    sessions.set(id, session);
    store.touchDevice(id, { connected: true, peer: session.peer, protocol: session.protocol.name });
  }

  function storePosition(session, d) {
    const id = session.deviceId;
    if (!id || !d.gps) return;
    const alarms = d.alarms?.length ? d.alarms : d.alarm && d.alarm !== 'normal' ? [d.alarm] : [];
    const pos = { imei: id, protocol: session.protocol.name, ...d.gps, source: d.typeHex };
    if (d.lbs) pos.lbs = d.lbs;
    if (d.acc != null) pos.acc = d.acc;
    else if (d.status?.acc != null) pos.acc = d.status.acc;
    if (d.uploadMode) pos.uploadMode = d.uploadMode;
    if (d.mileageM != null) pos.mileageM = d.mileageM;
    else if (d.extras?.mileageKm != null) pos.mileageM = Math.round(d.extras.mileageKm * 1000);
    if (d.obd) pos.obd = d.obd;
    if (d.extras) pos.extras = d.extras;
    if (alarms.length) pos.alarms = alarms;
    if (d.archive) pos.archive = true;
    store.addPosition(pos);

    const patch = {};
    if (d.obd) patch.obd = { ...d.obd, time: d.gps.time, ts: now() };
    if (d.status) patch.lastStatus = d.status;
    const volt = d.obd?.externalVoltage ?? d.extras?.externalVoltage ?? d.extras?.powerVoltage ?? d.status?.voltage;
    if (volt != null) patch.externalVoltage = volt;
    if (d.extras?.rssi != null) patch.rssi = d.extras.rssi;
    if (d.extras?.backupBatteryPct != null) patch.backupBatteryPct = d.extras.backupBatteryPct;
    if (alarms.length) {
      patch.lastAlarm = { alarm: alarms.join(','), code: d.status?.alarmCode ?? d.alarmWord ?? null, ts: now() };
      store.addEvent({ kind: 'alarm', imei: id, alarm: alarms.join(','), alarms, code: patch.lastAlarm.code, gps: d.gps, archive: !!d.archive });
    }
    store.touchDevice(id, patch);
  }

  function handleDecoded(session, d) {
    const id = session.deviceId;
    switch (d.kind) {
      case 'login': // GT06
        store.touchDevice(id, { login: { typeCode: d.typeCode ?? null, timezoneHours: d.timezoneHours ?? null, language: d.language ?? null, at: now() } });
        store.addEvent({ kind: 'login', imei: id, peer: session.peer, typeCode: d.typeCode, timezoneHours: d.timezoneHours });
        break;
      case 'register': // JT808
        store.touchDevice(id, { registration: { manufacturer: d.manufacturer, model: d.model, terminalIdText: d.terminalIdText, plate: d.plate, imei: d.imei ?? null, at: now() }, ...(d.imei ? { imeiFromRegister: d.imei } : {}) });
        store.addEvent({ kind: 'register', imei: id, peer: session.peer, manufacturer: d.manufacturer, model: d.model, terminalIdText: d.terminalIdText, imeiFromRegister: d.imei ?? null });
        break;
      case 'auth':
        store.touchDevice(id, { auth: { code: d.code, at: now() } });
        store.addEvent({ kind: 'auth', imei: id, code: d.code });
        break;
      case 'location':
        storePosition(session, d);
        break;
      case 'batch':
        for (const p of d.positions) storePosition(session, { ...p, typeHex: d.typeHex, archive: true });
        store.addEvent({ kind: 'batch', imei: id, count: d.positions.length, batchType: d.batchType });
        break;
      case 'alarm': // GT06 alarm packet (GPS + status)
        storePosition(session, d);
        if (!d.gps) store.addEvent({ kind: 'alarm', imei: id, alarm: d.alarm, code: d.status?.alarmCode });
        break;
      case 'heartbeat': {
        const patch = {};
        if (d.status) patch.lastStatus = d.status;
        if (d.batteryPct != null) patch.backupBatteryPct = d.batteryPct;
        if (d.rssi != null) patch.rssi = d.rssi;
        const dev = store.touchDevice(id, patch);
        if (dev) dev.counters.heartbeats++;
        if (d.status?.alarm && d.status.alarm !== 'normal') {
          store.addEvent({ kind: 'alarm', imei: id, alarm: d.status.alarm, code: d.status.alarmCode, viaHeartbeat: true, status: d.status });
        }
        break;
      }
      case 'info': {
        const dev = store.device(id);
        const { rawHex, contentHex, ...rest } = d;
        dev.info[d.subtypeName] = { ...rest, ts: now() };
        store.touchDevice(id, d.externalVoltage != null ? { externalVoltage: d.externalVoltage } : {});
        store.addEvent({ kind: 'info', imei: id, subtype: d.subtype, subtypeName: d.subtypeName, detail: rest });
        break;
      }
      case 'obd': // GT06 0x8C
        store.touchDevice(id, { obd: { ...d.parsed, pairs: d.pairs, time: d.time, ts: now() } });
        store.addEvent({ kind: 'obd', imei: id, parsed: d.parsed, pairs: d.pairs });
        break;
      case 'command_response': {
        const c = store.lastSentCommand(id);
        if (c) store.updateCommand(c.id, { status: 'answered', answeredAt: now(), response: d.text });
        store.addEvent({ kind: 'command_response', imei: id, text: d.text, commandId: c?.id ?? null });
        break;
      }
      case 'terminal_response': {
        // JT808 0x0001: the device accepted (or rejected) one of our messages
        const c = store.lastSentCommand(id);
        if (c && c.serial === d.replySerial) store.updateCommand(c.id, { status: d.result === 0 ? 'accepted' : 'rejected', result: d.resultName, acceptedAt: now() });
        store.addEvent({ kind: 'terminal_response', imei: id, replyTo: d.replyName, replySerial: d.replySerial, result: d.resultName });
        break;
      }
      case 'params':
        store.touchDevice(id, { params: d.params });
        store.addEvent({ kind: 'params', imei: id, count: d.count, params: d.params });
        break;
      case 'attributes': {
        const { rawHex, contentHex, ...rest } = d;
        store.touchDevice(id, { attributes: rest });
        store.addEvent({ kind: 'attributes', imei: id, detail: rest });
        break;
      }
      case 'transparent':
        store.addEvent({ kind: 'transparent', imei: id, dataType: d.dataType, text: d.text, hex: d.dataHex });
        break;
      case 'time_request':
      case 'time_sync_request':
      case 'lbs':
      case 'logout':
        break;
      default:
        store.addEvent({ kind: d.kind, imei: id, type: d.typeHex, name: d.name, error: d.error ?? null, hex: d.rawHex });
    }
    const dev = store.device(id);
    if (dev) dev.counters.frames++;
  }

  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const session = { socket, peer, protocol: null, parser: null, deviceId: null, txSerial: 1, version: null, options, connectedAt: now(), unknownBytes: 0 };
    sockets.add(socket);
    socket.setTimeout(idleTimeoutMs);
    socket.setKeepAlive(true, 60_000);
    log.log(`[tcp] + ${peer} connected`);
    store.addEvent({ kind: 'connect', peer });

    socket.on('data', (chunk) => {
      if (!session.protocol) {
        let proto = forceProtocol ? PROTOCOLS[forceProtocol] : null;
        let offset = 0;
        if (!proto) {
          for (let i = 0; i < chunk.length && !proto; i++) {
            proto = detect(chunk[i]);
            offset = i;
          }
        }
        if (!proto) {
          session.unknownBytes += chunk.length;
          store.addRaw({ dir: 'in', imei: null, peer, hex: hex(chunk), note: 'unrecognised protocol: no 0x7E (JT808) or 0x78/0x79 (GT06) start byte' });
          if (session.unknownBytes > 4096) socket.destroy();
          return;
        }
        session.protocol = proto;
        session.parser = proto.createParser();
        store.addEvent({ kind: 'protocol_detected', peer, protocol: proto.name, skipped: offset });
        log.log(`[tcp] ~ ${peer} speaks ${proto.name}`);
      }
      const garbageBefore = session.parser.garbage;
      const frames = session.parser.feed(chunk);
      if (session.parser.garbage > garbageBefore) {
        store.addRaw({ dir: 'in', imei: session.deviceId, peer, protocol: session.protocol.name, hex: hex(chunk), note: `${session.parser.garbage - garbageBefore} byte(s) outside any frame were skipped` });
      }
      for (const frame of frames) {
        const d = session.protocol.decode(frame, { tzHours });
        const id = session.protocol.identify(d);
        if (id) bindDevice(session, id);
        if (frame.version != null) session.version = frame.version;
        store.addRaw({ dir: 'in', imei: session.deviceId, peer, protocol: session.protocol.name, hex: d.rawHex, type: d.typeHex, name: d.name, serial: d.serial, crcOk: d.crcOk, decoded: d });
        if (!d.crcOk) store.addEvent({ kind: 'crc_error', imei: session.deviceId, type: d.typeHex, hex: d.rawHex });
        if (session.deviceId) handleDecoded(session, d);
        const extra =
          d.kind === 'location' ? ` ${d.gps.lat},${d.gps.lon} ${d.gps.speedKmh} km/h${d.gps.valid ? '' : ' (no fix)'}${d.alarms?.length ? ' ALARM=' + d.alarms.join(',') : ''}` : d.kind === 'alarm' ? ` ALARM=${d.alarm}` : d.kind === 'batch' ? ` ${d.positions.length} positions` : '';
        log.log(`[tcp] < ${session.deviceId || peer} ${d.typeHex} ${d.name}${extra}`);
        for (const r of session.protocol.replies(frame, d, session)) send(session, r.buf, r.meta);
        flushCommands(session);
      }
    });

    socket.on('timeout', () => {
      log.log(`[tcp] ~ ${session.deviceId || peer} idle timeout, closing`);
      socket.destroy();
    });
    socket.on('error', (e) => store.addEvent({ kind: 'socket_error', imei: session.deviceId, peer, error: e.message }));
    const dropSession = () => {
      if (session.deviceId && sessions.get(session.deviceId) === session) {
        sessions.delete(session.deviceId);
        store.touchDevice(session.deviceId, { connected: false });
      }
    };
    socket.on('end', dropSession);
    socket.on('close', () => {
      sockets.delete(socket);
      log.log(`[tcp] - ${session.deviceId || peer} disconnected`);
      store.addEvent({ kind: 'disconnect', imei: session.deviceId, peer });
      dropSession();
    });
  });

  server.sessions = sessions;
  server.sockets = sockets;

  /** Queue a command string; sent immediately when the device is connected. */
  server.sendCommand = (id, command, options) => {
    const c = store.queueCommand(id, command, options ? { options } : {});
    const s = sessions.get(id);
    if (s) flushCommands(s);
    return c;
  };

  /** Send a pre-built frame to a connected device (protocol experiments). */
  server.sendRaw = (id, buf) => {
    const s = sessions.get(id);
    if (!s) return false;
    return send(s, buf, { type: 'raw', name: 'raw_frame' });
  };

  server.destroyAll = () => {
    for (const s of sockets) s.destroy();
    sockets.clear();
    sessions.clear();
  };

  return server;
}
