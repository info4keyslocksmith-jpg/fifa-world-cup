/**
 * In-memory store with optional JSONL persistence and change events.
 *
 * Everything the TCP server learns about a device lands here, and the HTTP
 * API / dashboard read from here. Each array is a bounded ring buffer; the
 * JSONL files under DATA_DIR keep the complete history for offline analysis.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const now = () => new Date().toISOString();

export class Store extends EventEmitter {
  constructor({ dataDir = null, maxRaw = 3000, maxPositions = 20000, maxEvents = 3000, maxCommands = 500, maxAlerts = 2000 } = {}) {
    super();
    this.setMaxListeners(200);
    Object.assign(this, { dataDir, maxRaw, maxPositions, maxEvents, maxCommands, maxAlerts });
    this.devices = new Map();
    this.positions = [];
    this.events = [];
    this.raw = [];
    this.commands = [];
    this.alerts = [];
    this._nextId = 1;
    this.startedAt = now();
    if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  }

  _persist(file, obj) {
    if (!this.dataDir) return;
    fs.appendFile(path.join(this.dataDir, file), JSON.stringify(obj) + '\n', () => {});
  }

  _push(arr, item, max) {
    arr.push(item);
    if (arr.length > max) arr.splice(0, arr.length - max);
    return item;
  }

  _id() {
    return this._nextId++;
  }

  /** Get or create a device record. */
  device(imei) {
    if (!imei) return null;
    let d = this.devices.get(imei);
    if (!d) {
      d = {
        imei,
        firstSeen: now(),
        lastSeen: null,
        connected: false,
        peer: null,
        login: null,
        lastPosition: null,
        lastStatus: null,
        lastAlarm: null,
        externalVoltage: null,
        obd: null,
        info: {},
        counters: { frames: 0, positions: 0, alarms: 0, heartbeats: 0, commands: 0 },
      };
      this.devices.set(imei, d);
      this.emit('device', d);
    }
    return d;
  }

  touchDevice(imei, patch = {}) {
    const d = this.device(imei);
    if (!d) return null;
    Object.assign(d, patch);
    d.lastSeen = now();
    this.emit('device', d);
    return d;
  }

  addRaw(entry) {
    const e = this._push(this.raw, { id: this._id(), ts: now(), ...entry }, this.maxRaw);
    this._persist('raw.jsonl', e);
    this.emit('raw', e);
    return e;
  }

  addPosition(pos) {
    const p = this._push(this.positions, { id: this._id(), ts: now(), ...pos }, this.maxPositions);
    this._persist('positions.jsonl', p);
    const d = this.device(pos.imei);
    if (d) {
      d.lastPosition = p;
      d.counters.positions++;
      d.lastSeen = p.ts;
      this.emit('device', d);
    }
    this.emit('position', p);
    return p;
  }

  addEvent(ev) {
    const e = this._push(this.events, { id: this._id(), ts: now(), ...ev }, this.maxEvents);
    this._persist('events.jsonl', e);
    if (ev.kind === 'alarm' && ev.imei) {
      const d = this.device(ev.imei);
      d.counters.alarms++;
    }
    this.emit('event', e);
    return e;
  }

  queueCommand(imei, command, extra = {}) {
    const c = this._push(
      this.commands,
      { id: this._id(), ts: now(), imei, command, status: 'queued', sentAt: null, answeredAt: null, response: null, ...extra },
      this.maxCommands,
    );
    const d = this.device(imei);
    if (d) d.counters.commands++;
    this._persist('commands.jsonl', c);
    this.emit('command', c);
    return c;
  }

  pendingCommands(imei) {
    return this.commands.filter((c) => c.imei === imei && c.status === 'queued');
  }

  updateCommand(id, patch) {
    const c = this.commands.find((x) => x.id === id);
    if (!c) return null;
    Object.assign(c, patch);
    this._persist('commands.jsonl', c);
    this.emit('command', c);
    return c;
  }

  /** Most recent command that is still waiting for a text reply ("sent", or "accepted" by a JT808 0x0001). */
  lastSentCommand(imei) {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      const c = this.commands[i];
      if (c.imei === imei && (c.status === 'sent' || c.status === 'accepted')) return c;
    }
    return null;
  }

  /** Customer-facing alert produced by the fleet rules (dtc, battery, service due, unplugged, ...). */
  addAlert(alert) {
    const a = this._push(this.alerts, { id: this._id(), ts: now(), acknowledged: false, ...alert }, this.maxAlerts);
    this._persist('alerts.jsonl', a);
    this.emit('alert', a);
    return a;
  }

  ackAlert(id, by = 'dashboard') {
    const a = this.alerts.find((x) => x.id === id);
    if (!a) return null;
    a.acknowledged = true;
    a.acknowledgedAt = now();
    a.acknowledgedBy = by;
    this._persist('alerts.jsonl', a);
    this.emit('alert', a);
    return a;
  }

  positionsFor(imei, limit = 500) {
    const out = [];
    for (let i = this.positions.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.positions[i].imei === imei) out.push(this.positions[i]);
    }
    return out.reverse();
  }

  snapshot() {
    return {
      startedAt: this.startedAt,
      devices: [...this.devices.values()],
      counts: {
        positions: this.positions.length,
        events: this.events.length,
        raw: this.raw.length,
        commands: this.commands.length,
        alerts: this.alerts.length,
        openAlerts: this.alerts.filter((a) => !a.acknowledged).length,
      },
    };
  }
}
