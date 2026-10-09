/**
 * FleetService: customer vehicles on top of the raw tracker data.
 *
 *   store 'position' / 'event'  ──▶  rules.js  ──▶  store.addAlert(...)  ──▶ dashboard / API / SSE
 *                                 └─▶ maintenance.js (odometer + calendar) ─┘
 *
 * A "vehicle" is a customer's car with one tracker attached. It carries the customer
 * contact, the service log, schedule overrides, geofences and the rule state. Everything
 * is persisted to data/vehicles.json so a restart loses nothing.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_THRESHOLDS, evaluateEvent, evaluateOffline, evaluatePosition, healthScore, initialState } from './rules.js';
import { DEFAULT_SCHEDULE, kmToUnits, maintenanceStatus, unitsToKm } from './maintenance.js';
import { describeDtc } from './dtc-codes.js';

const now = () => new Date().toISOString();
const newId = () => 'veh_' + Math.random().toString(36).slice(2, 10);

export class FleetService extends EventEmitter {
  constructor({ store, dataDir = null, autoCreate = true, thresholds = {}, repeatMinutes = 30, offlineCheckMs = 60_000, clock = () => Date.now() } = {}) {
    super();
    this.store = store;
    this.dataDir = dataDir;
    this.autoCreate = autoCreate;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.repeatMinutes = repeatMinutes;
    this.offlineCheckMs = offlineCheckMs;
    this.clock = clock;
    this.vehicles = new Map();
    this._lastAlertByType = new Map(); // `${vehicleId}:${type}` -> ms
    this._saveTimer = null;
    this._offlineTimer = null;
    this.file = dataDir ? path.join(dataDir, 'vehicles.json') : null;
    this._load();
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    this._onPosition = (p) => this.handlePosition(p);
    this._onEvent = (e) => this.handleEvent(e);
    this.store.on('position', this._onPosition);
    this.store.on('event', this._onEvent);
    if (this.offlineCheckMs > 0) {
      this._offlineTimer = setInterval(() => this.checkOffline(), this.offlineCheckMs);
      this._offlineTimer.unref?.();
    }
    return this;
  }

  stop() {
    if (this._onPosition) this.store.off('position', this._onPosition);
    if (this._onEvent) this.store.off('event', this._onEvent);
    if (this._offlineTimer) clearInterval(this._offlineTimer);
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveNow();
    }
  }

  _load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const v of data.vehicles || []) this.vehicles.set(v.id, { ...v, state: { ...initialState(), ...(v.state || {}) } });
    } catch (e) {
      console.error('[fleet] could not read', this.file, e.message);
    }
  }

  _save() {
    if (!this.file) return;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._saveNow();
    }, 1500);
    this._saveTimer.unref?.();
  }

  _saveNow() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ savedAt: now(), vehicles: [...this.vehicles.values()] }, null, 1));
    } catch (e) {
      console.error('[fleet] could not write', this.file, e.message);
    }
  }

  // ------------------------------------------------------------------ vehicles
  _newVehicle(input = {}) {
    const units = input.units === 'km' ? 'km' : 'mi';
    const v = {
      id: input.id || newId(),
      deviceId: input.deviceId ? String(input.deviceId) : null,
      customer: { name: input.customer?.name || input.customerName || '', phone: input.customer?.phone || input.phone || '', email: input.customer?.email || input.email || '' },
      plate: input.plate || '',
      vin: input.vin || '',
      make: input.make || '',
      model: input.model || '',
      year: input.year || '',
      units,
      notes: input.notes || '',
      odometerOffsetKm: 0,
      offsetPending: false,
      enrolled: { date: input.enrolledDate || now(), odometerKm: null },
      serviceLog: Array.isArray(input.serviceLog) ? input.serviceLog : [],
      schedule: input.schedule || {},
      geofences: Array.isArray(input.geofences) ? input.geofences : [],
      thresholds: input.thresholds || {},
      state: initialState(),
      last: {},
      createdAt: now(),
      updatedAt: now(),
    };
    return v;
  }

  addVehicle(input = {}) {
    if (input.deviceId && this.vehicleForDevice(input.deviceId, false)) throw new Error(`device ${input.deviceId} is already assigned to a vehicle`);
    const v = this._newVehicle(input);
    this.vehicles.set(v.id, v);
    if (input.odometer != null) this.setOdometer(v.id, input.odometer);
    else {
      // baseline for time/distance schedules: whatever the device reports now
      const dev = v.deviceId ? this.store.devices.get(v.deviceId) : null;
      const km = this._odometerFromPosition(v, dev?.lastPosition);
      v.enrolled.odometerKm = km;
    }
    if (v.deviceId) this._absorbDeviceState(v);
    this._save();
    this.emit('vehicle', v);
    return v;
  }

  updateVehicle(id, patch = {}) {
    const v = this.vehicles.get(id);
    if (!v) return null;
    if (patch.deviceId !== undefined && patch.deviceId !== v.deviceId) {
      const other = patch.deviceId ? this.vehicleForDevice(patch.deviceId, false) : null;
      if (other && other.id !== id) throw new Error(`device ${patch.deviceId} is already assigned to ${other.id}`);
      v.deviceId = patch.deviceId ? String(patch.deviceId) : null;
    }
    for (const k of ['plate', 'vin', 'make', 'model', 'year', 'notes', 'units', 'schedule', 'geofences', 'thresholds']) if (patch[k] !== undefined) v[k] = patch[k];
    if (patch.customer) v.customer = { ...v.customer, ...patch.customer };
    if (patch.customerName !== undefined) v.customer.name = patch.customerName;
    if (patch.phone !== undefined) v.customer.phone = patch.phone;
    if (patch.email !== undefined) v.customer.email = patch.email;
    if (patch.odometer != null) this.setOdometer(id, patch.odometer);
    v.updatedAt = now();
    this._save();
    this.emit('vehicle', v);
    return v;
  }

  removeVehicle(id) {
    const ok = this.vehicles.delete(id);
    if (ok) this._save();
    return ok;
  }

  /** Vehicle attached to a tracker id; optionally auto-created the first time the device reports. */
  vehicleForDevice(deviceId, create = this.autoCreate) {
    if (!deviceId) return null;
    for (const v of this.vehicles.values()) if (v.deviceId === String(deviceId)) return v;
    if (!create) return null;
    return this.addVehicle({ deviceId, customer: { name: `Unassigned (${deviceId})` } });
  }

  /**
   * Record the real odometer reading (in the vehicle's units). The tracker's own mileage
   * counter is relative, so we keep an offset; when the car reports its CAN odometer the
   * offset is irrelevant.
   */
  setOdometer(id, value) {
    const v = this.vehicles.get(id);
    if (!v) return null;
    const km = unitsToKm(Number(value), v.units);
    const dev = v.deviceId ? this.store.devices.get(v.deviceId) : null;
    const deviceKm = dev?.lastPosition?.mileageM != null ? dev.lastPosition.mileageM / 1000 : v.last.deviceMileageKm ?? null;
    v.manualOdometerKm = km;
    v.manualOdometerAt = now();
    const canKm = dev?.lastPosition?.obd?.canOdometerKm ?? null;
    if (canKm != null) {
      // the car reports its own odometer: that stays the source of truth, the manual value is only
      // kept to flag a disagreement (wrong units, typo, or a replaced cluster)
      v.odometerOffsetKm = 0;
      v.offsetPending = false;
      v.last.odometerKm = canKm;
      v.last.odometerSource = 'vehicle_can';
      if (v.enrolled.odometerKm == null) v.enrolled.odometerKm = canKm;
      this._save();
      return v;
    }
    if (deviceKm != null) {
      v.odometerOffsetKm = km - deviceKm;
      v.offsetPending = false;
    } else {
      v.odometerOffsetKm = km; // applied as-is until the first mileage sample arrives
      v.offsetPending = true;
    }
    v.last.odometerKm = km;
    v.last.odometerSource = 'manual';
    if (v.enrolled.odometerKm == null) v.enrolled.odometerKm = km;
    this._save();
    return v;
  }

  logService(id, { item, odometer = null, date = null, note = '' } = {}) {
    const v = this.vehicles.get(id);
    if (!v) throw new Error('unknown vehicle');
    if (!item) throw new Error('"item" is required (e.g. oil_change)');
    const entry = {
      item,
      date: date ? new Date(date).toISOString() : now(),
      odometerKm: odometer != null ? unitsToKm(Number(odometer), v.units) : (v.last.odometerKm ?? v.enrolled.odometerKm ?? null),
      note,
    };
    v.serviceLog.push(entry);
    if (odometer != null) this.setOdometer(id, odometer);
    if (v.state.maintenanceAlerted) delete v.state.maintenanceAlerted[item];
    for (const a of this.store.alerts) {
      if (a.vehicleId === id && !a.acknowledged && (a.type === 'service_overdue' || a.type === 'service_due_soon') && a.data?.item === item) this.store.ackAlert(a.id);
    }
    v.updatedAt = now();
    this._save();
    this.emit('vehicle', v);
    return entry;
  }

  // ------------------------------------------------------------------ summaries
  _odometerFromPosition(v, pos) {
    if (!pos) return v.last.odometerKm ?? v.enrolled?.odometerKm ?? null;
    if (pos.obd?.canOdometerKm != null) return pos.obd.canOdometerKm;
    if (pos.mileageM != null) return pos.mileageM / 1000 + (v.odometerOffsetKm || 0);
    return v.last.odometerKm ?? v.enrolled?.odometerKm ?? null;
  }

  _absorbDeviceState(v) {
    const dev = this.store.devices.get(v.deviceId);
    if (!dev) return;
    v.last.lastSeen = dev.lastSeen;
    v.last.connected = dev.connected;
    if (dev.lastPosition) this._applyPosition(v, dev.lastPosition, false);
  }

  _applyPosition(v, pos, evaluate = true) {
    const obd = pos.obd || {};
    if (pos.mileageM != null) {
      const deviceKm = pos.mileageM / 1000;
      if (v.offsetPending) {
        v.odometerOffsetKm = v.odometerOffsetKm - deviceKm;
        v.offsetPending = false;
      }
      v.last.deviceMileageKm = deviceKm;
    }
    const km = this._odometerFromPosition(v, pos);
    if (km != null) {
      v.last.odometerKm = km;
      v.last.odometerSource = pos.obd?.canOdometerKm != null ? 'vehicle_can' : pos.mileageM != null ? 'device_mileage' : v.last.odometerSource || 'unknown';
      if (v.enrolled.odometerKm == null) v.enrolled.odometerKm = km;
    }
    Object.assign(v.last, {
      ts: pos.ts,
      time: pos.time,
      lat: pos.valid ? pos.lat : v.last.lat,
      lon: pos.valid ? pos.lon : v.last.lon,
      speedKmh: pos.speedKmh,
      acc: pos.acc ?? v.last.acc ?? null,
      rpm: obd.rpm ?? v.last.rpm ?? null,
      voltage: obd.externalVoltage ?? pos.extras?.externalVoltage ?? pos.extras?.powerVoltage ?? v.last.voltage ?? null,
      coolantC: obd.coolantC ?? v.last.coolantC ?? null,
      fuelLevelPct: obd.fuelLevelPct ?? v.last.fuelLevelPct ?? null,
      engineLoadPct: obd.engineLoadPct ?? v.last.engineLoadPct ?? null,
      vin: obd.vin || v.last.vin || null,
      dtcs: Array.isArray(obd.dtcs) ? obd.dtcs : (v.last.dtcs ?? []),
      lastSeen: pos.ts,
    });
    if (v.last.vin && !v.vin) v.vin = v.last.vin;
    if (!evaluate) return [];
    const sample = { ts: pos.ts, lat: pos.lat, lon: pos.lon, valid: pos.valid, speedKmh: pos.speedKmh, acc: pos.acc, obd, extras: pos.extras, alarms: pos.alarms || [] };
    const { alerts, state } = evaluatePosition(v.state, sample, v, this.thresholds);
    v.state = state;
    return alerts;
  }

  _maintenance(v) {
    return maintenanceStatus({ schedule: v.schedule, serviceLog: v.serviceLog, enrolled: v.enrolled, odometerKm: v.last.odometerKm ?? v.enrolled.odometerKm ?? null, now: new Date(this.clock()) });
  }

  _maintenanceAlerts(v, m) {
    const alerts = [];
    v.state.maintenanceAlerted ||= {};
    for (const it of m.items) {
      const was = v.state.maintenanceAlerted[it.item];
      if (it.status === 'overdue' && was !== 'overdue') {
        alerts.push({ type: 'service_overdue', severity: 'warning', title: `${it.label} overdue`, detail: `${it.usedKm != null ? kmToUnits(it.usedKm, v.units) + ' ' + v.units + ' since last service' : ''}${it.usedDays != null ? (it.usedKm != null ? ', ' : '') + it.usedDays + ' days' : ''}`.trim(), data: { item: it.item, percent: it.percent } });
        v.state.maintenanceAlerted[it.item] = 'overdue';
      } else if (it.status === 'due_soon' && !was) {
        alerts.push({ type: 'service_due_soon', severity: 'info', title: `${it.label} due soon`, detail: `${it.remainingKm != null ? kmToUnits(it.remainingKm, v.units) + ' ' + v.units + ' left' : ''}${it.remainingDays != null ? (it.remainingKm != null ? ', ' : '') + it.remainingDays + ' days left' : ''}`.trim(), data: { item: it.item, percent: it.percent } });
        v.state.maintenanceAlerted[it.item] = 'due_soon';
      } else if (it.status === 'ok' && was) {
        delete v.state.maintenanceAlerted[it.item];
      }
    }
    return alerts;
  }

  _emitAlerts(v, alerts) {
    const out = [];
    for (const a of alerts) {
      const key = `${v.id}:${a.type}`;
      const last = this._lastAlertByType.get(key) || 0;
      if (this.clock() - last < this.repeatMinutes * 60_000 && !/^(dtc_new|geofence_)/.test(a.type)) continue;
      this._lastAlertByType.set(key, this.clock());
      const stored = this.store.addAlert({ vehicleId: v.id, deviceId: v.deviceId, customer: v.customer?.name || '', plate: v.plate || '', ...a });
      out.push(stored);
      this.emit('alert', stored);
    }
    return out;
  }

  summary(id) {
    const v = typeof id === 'string' ? this.vehicles.get(id) : id;
    if (!v) return null;
    const m = this._maintenance(v);
    const dev = v.deviceId ? this.store.devices.get(v.deviceId) : null;
    const offline = v.last.lastSeen ? this.clock() - new Date(v.last.lastSeen).getTime() > this.thresholds.offlineHours * 3600_000 : false;
    const health = healthScore({ dtcs: v.last.dtcs || [], batteryAlerted: v.state.batteryAlerted, chargingAlerted: v.state.chargingAlerted, coolantAlerted: v.state.coolantAlerted, fuelLow: v.state.fuelLowAlerted, overdue: m.overdue, dueSoon: m.dueSoon, offline, harshCount: v.state.harshDay === new Date(this.clock()).toISOString().slice(0, 10) ? v.state.harshCount : 0 });
    const { state, ...profile } = v;
    const openAlerts = this.store.alerts.filter((a) => a.vehicleId === v.id && !a.acknowledged).slice(-50).reverse();
    const odoKm = v.last.odometerKm ?? v.enrolled.odometerKm ?? null;
    let odometerMismatch = null;
    if (v.last.odometerSource === 'vehicle_can' && v.manualOdometerKm != null && odoKm) {
      const diff = Math.abs(v.manualOdometerKm - odoKm) / odoKm;
      if (diff > 0.05) odometerMismatch = { manual: kmToUnits(v.manualOdometerKm, v.units), vehicle: kmToUnits(odoKm, v.units), percent: Math.round(diff * 100) };
    }
    return {
      ...profile,
      connected: dev?.connected ?? false,
      odometer: kmToUnits(odoKm, v.units),
      odometerSource: v.last.odometerSource || null,
      odometerMismatch,
      dtcs: (v.last.dtcs || []).map(describeDtc),
      battery: { voltage: v.last.voltage ?? null, status: v.state.batteryAlerted || (v.state.chargingAlerted ? 'charging_' + v.state.chargingAlerted : 'ok') },
      coolant: { c: v.last.coolantC ?? null, status: v.state.coolantAlerted || 'ok' },
      fuelLevelPct: v.last.fuelLevelPct ?? null,
      maintenance: m,
      health,
      offline,
      openAlerts,
      openAlertCount: openAlerts.length,
    };
  }

  listVehicles() {
    return [...this.vehicles.values()].map((v) => this.summary(v));
  }

  // ------------------------------------------------------------------ inputs
  handlePosition(pos) {
    const v = this.vehicleForDevice(pos.imei);
    if (!v) return [];
    const alerts = this._applyPosition(v, pos, true);
    alerts.push(...this._maintenanceAlerts(v, this._maintenance(v)));
    this._save();
    this.emit('vehicle', v);
    return this._emitAlerts(v, alerts);
  }

  handleEvent(ev) {
    if (ev.kind !== 'alarm' || !ev.imei) return [];
    const v = this.vehicleForDevice(ev.imei);
    if (!v) return [];
    const { alerts, state } = evaluateEvent(v.state, ev);
    v.state = state;
    if (alerts.length) this._save();
    return this._emitAlerts(v, alerts);
  }

  checkOffline() {
    const out = [];
    for (const v of this.vehicles.values()) {
      const { alerts, state } = evaluateOffline(v.state, v.last.lastSeen, this.clock(), this.thresholds);
      v.state = state;
      if (alerts.length) out.push(...this._emitAlerts(v, alerts));
    }
    return out;
  }

  schedule() {
    return DEFAULT_SCHEDULE;
  }
}
