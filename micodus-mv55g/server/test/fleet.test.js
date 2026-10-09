import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeDtc, normalizeDtc, worstSeverity } from '../src/fleet/dtc-codes.js';
import { DEFAULT_SCHEDULE, itemStatus, kmToUnits, maintenanceStatus, unitsToKm } from '../src/fleet/maintenance.js';
import { DEFAULT_THRESHOLDS, evaluateEvent, evaluateOffline, evaluatePosition, healthScore, initialState } from '../src/fleet/rules.js';
import { FleetService } from '../src/fleet/fleet.js';
import { Store } from '../src/store.js';

const ID = '019172682984';
const T0 = new Date('2026-10-05T12:00:00Z');
const at = (min) => new Date(T0.getTime() + min * 60000).toISOString();

// ---------------------------------------------------------------- DTC table
test('DTC normalisation and descriptions', () => {
  assert.equal(normalizeDtc(' p0301 '), 'P0301');
  assert.equal(normalizeDtc('0420'), 'P0420');
  assert.equal(normalizeDtc('hello'), null);
  const d = describeDtc('P0301');
  assert.equal(d.severity, 'critical');
  assert.equal(d.lead, 'engine');
  assert.equal(d.known, true);
  const u = describeDtc('U0100');
  assert.equal(u.system, 'network');
  assert.equal(u.lead, 'comms');
  const mfr = describeDtc('P1234');
  assert.equal(mfr.known, false);
  assert.equal(mfr.generic, false);
  assert.match(mfr.description, /manufacturer/i);
  assert.equal(describeDtc('B2799').lead, 'key');
  assert.equal(worstSeverity(['P0442', 'P0301', 'P0420']), 'critical');
  assert.equal(worstSeverity([]), null);
});

// ---------------------------------------------------------------- maintenance
test('service item status by distance and time', () => {
  const def = DEFAULT_SCHEDULE.oil_change; // 8000 km / 180 days
  const last = { item: 'oil_change', date: at(-100 * 24 * 60), odometerKm: 50000 };
  const ok = itemStatus('oil_change', def, { lastService: last, odometerKm: 52000, now: T0 });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.remainingKm, 6000);
  assert.equal(ok.dueAtKm, 58000);
  assert.equal(ok.usedDays, 100);
  const soon = itemStatus('oil_change', def, { lastService: last, odometerKm: 57400, now: T0 });
  assert.equal(soon.status, 'due_soon');
  assert.equal(soon.percent, 93);
  const overdueTime = itemStatus('oil_change', def, { lastService: { ...last, date: at(-200 * 24 * 60) }, odometerKm: 51000, now: T0 });
  assert.equal(overdueTime.status, 'overdue');
  assert.ok(overdueTime.remainingDays < 0);
  const unknown = itemStatus('oil_change', def, { lastService: null, odometerKm: 51000, now: T0 });
  assert.equal(unknown.status, 'unknown');
});

test('maintenanceStatus merges overrides, uses enrolment as baseline, sorts by urgency', () => {
  const enrolled = { date: at(-400 * 24 * 60), odometerKm: 100000 };
  const m = maintenanceStatus({
    schedule: { oil_change: { km: 5000 }, wiper_blades: null, custom_check: { label: 'Fleet inspection', km: 0, days: 30 } },
    serviceLog: [{ item: 'tire_rotation', date: at(-10 * 24 * 60), odometerKm: 104500 }],
    enrolled,
    odometerKm: 105000,
    now: T0,
  });
  assert.ok(!m.items.find((i) => i.item === 'wiper_blades'));
  assert.equal(m.items.find((i) => i.item === 'custom_check').label, 'Fleet inspection');
  assert.ok(m.overdue.includes('oil_change')); // 5000 km since enrolment on a 5000 km interval
  assert.ok(m.overdue.includes('custom_check')); // 400 days on a 30-day interval
  assert.equal(m.items.find((i) => i.item === 'tire_rotation').status, 'ok');
  assert.equal(m.items[0].status, 'overdue');
  assert.ok(m.next);
});

test('unit conversion helpers', () => {
  assert.equal(kmToUnits(160.9344, 'mi'), 100);
  assert.equal(kmToUnits(100, 'km'), 100);
  assert.ok(Math.abs(unitsToKm(100, 'mi') - 160.9344) < 1e-9);
  assert.equal(kmToUnits(null, 'mi'), null);
});

// ---------------------------------------------------------------- rules
const sample = (min, o = {}) => ({ ts: at(min), lat: 33.7, lon: -84.4, valid: true, speedKmh: 50, acc: true, obd: { rpm: 2000, externalVoltage: 14.1, coolantC: 88 }, alarms: [], ...o });

test('weak battery needs three engine-off samples, then recovers', () => {
  let s = initialState();
  const parked = (min, v) => sample(min, { acc: false, speedKmh: 0, obd: { rpm: 0, externalVoltage: v } });
  let r = evaluatePosition(s, parked(0, 12.0));
  s = r.state;
  assert.equal(r.alerts.length, 0);
  r = evaluatePosition(s, parked(1, 12.0));
  s = r.state;
  r = evaluatePosition(s, parked(2, 12.0));
  s = r.state;
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].type, 'battery_weak');
  assert.equal(r.alerts[0].severity, 'warning');
  r = evaluatePosition(s, parked(3, 11.5));
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'battery_critical');
  r = evaluatePosition(s, parked(4, 12.7));
  assert.equal(r.alerts[0]?.type, 'battery_recovered');
  assert.equal(r.state.batteryAlerted, null);
});

test('charging system low while the engine runs', () => {
  let s = initialState();
  let r;
  for (let i = 0; i < 3; i++) {
    r = evaluatePosition(s, sample(i, { obd: { rpm: 2000, externalVoltage: 12.4 } }));
    s = r.state;
  }
  assert.equal(r.alerts[0]?.type, 'charging_low');
  r = evaluatePosition(s, sample(3, { obd: { rpm: 2000, externalVoltage: 14.2 } }));
  assert.equal(r.alerts[0]?.type, 'charging_ok');
});

test('coolant warning then critical, with debounce', () => {
  let s = initialState();
  let r = evaluatePosition(s, sample(0, { obd: { rpm: 2000, externalVoltage: 14, coolantC: 108 } }));
  s = r.state;
  assert.equal(r.alerts.length, 0);
  r = evaluatePosition(s, sample(1, { obd: { rpm: 2000, externalVoltage: 14, coolantC: 109 } }));
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'coolant_high');
  assert.equal(r.alerts[0]?.severity, 'warning');
  r = evaluatePosition(s, sample(2, { obd: { rpm: 2000, externalVoltage: 14, coolantC: 118 } }));
  s = r.state;
  assert.equal(r.alerts[0]?.severity, 'critical');
  r = evaluatePosition(s, sample(3, { obd: { rpm: 2000, externalVoltage: 14, coolantC: 90 } }));
  assert.equal(r.alerts[0]?.type, 'coolant_ok');
});

test('new DTCs alert once with leads, cleared codes are reported', () => {
  let s = initialState();
  let r = evaluatePosition(s, sample(0, { obd: { dtcs: ['P0301', 'u0100'] } }));
  s = r.state;
  assert.equal(r.alerts.length, 1);
  assert.equal(r.alerts[0].type, 'dtc_new');
  assert.equal(r.alerts[0].severity, 'critical');
  assert.deepEqual(r.alerts[0].data.leads.sort(), ['comms', 'engine']);
  r = evaluatePosition(s, sample(1, { obd: { dtcs: ['P0301', 'U0100'] } }));
  s = r.state;
  assert.equal(r.alerts.length, 0, 'same codes again: no new alert');
  r = evaluatePosition(s, sample(2, { obd: { dtcs: ['P0301'] } }));
  assert.equal(r.alerts[0]?.type, 'dtc_cleared');
  assert.deepEqual(r.alerts[0].data.codes, ['U0100']);
});

test('fuel low once until refuelled, overspeed, harsh driving, idling', () => {
  let s = initialState();
  let r = evaluatePosition(s, sample(0, { obd: { fuelLevelPct: 10 } }));
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'fuel_low');
  r = evaluatePosition(s, sample(1, { obd: { fuelLevelPct: 9 } }));
  s = r.state;
  assert.equal(r.alerts.length, 0);
  r = evaluatePosition(s, sample(2, { obd: { fuelLevelPct: 60 } }));
  s = r.state;
  r = evaluatePosition(s, sample(3, { obd: { fuelLevelPct: 12 } }));
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'fuel_low');

  r = evaluatePosition(s, sample(4, { speedKmh: 140 }));
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'overspeed');
  r = evaluatePosition(s, sample(5, { speedKmh: 141 }));
  s = r.state;
  assert.equal(r.alerts.length, 0, 'still speeding: no repeat');

  for (let i = 0; i < 5; i++) {
    r = evaluatePosition(s, sample(6 + i, { alarms: ['harsh_braking'] }));
    s = r.state;
  }
  assert.equal(r.alerts[0]?.type, 'harsh_driving');
  assert.equal(r.alerts[0].data.count, 5);

  r = evaluatePosition(s, sample(20, { speedKmh: 0 }));
  s = r.state;
  r = evaluatePosition(s, sample(31, { speedKmh: 0 }));
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'idle_long');
  assert.ok(r.alerts[0].data.minutes >= 10);
});

test('geofence enter / exit', () => {
  const vehicle = { geofences: [{ name: 'Shop', lat: 33.7, lon: -84.4, radiusM: 200 }] };
  let s = initialState();
  let r = evaluatePosition(s, sample(0), vehicle);
  s = r.state;
  assert.equal(r.alerts.length, 0, 'first sample only sets the state');
  r = evaluatePosition(s, sample(1, { lat: 33.72, lon: -84.4 }), vehicle);
  s = r.state;
  assert.equal(r.alerts[0]?.type, 'geofence_exit');
  r = evaluatePosition(s, sample(2, { lat: 33.7001, lon: -84.4 }), vehicle);
  assert.equal(r.alerts[0]?.type, 'geofence_enter');
});

test('device alarms, offline detection and health score', () => {
  let r = evaluateEvent(initialState(), { kind: 'alarm', alarms: ['main_power_cut'] });
  assert.equal(r.alerts[0].type, 'unplugged');
  assert.equal(r.alerts[0].severity, 'critical');
  r = evaluateEvent(initialState(), { kind: 'alarm', alarm: 'illegal_displacement' });
  assert.equal(r.alerts[0].type, 'tow_or_move');
  r = evaluateOffline(initialState(), at(-30 * 60), T0.getTime());
  assert.equal(r.alerts[0].type, 'offline');
  const again = evaluateOffline(r.state, at(-30 * 60), T0.getTime());
  assert.equal(again.alerts.length, 0);
  assert.equal(evaluateOffline(initialState(), at(-60), T0.getTime()).alerts.length, 0);

  assert.deepEqual(healthScore({}), { score: 100, label: 'good' });
  assert.equal(healthScore({ dtcs: ['P0301'], batteryAlerted: 'critical' }).label, 'urgent');
  assert.equal(healthScore({ overdue: ['oil_change'], dueSoon: ['tire_rotation'] }).score, 87);
  assert.equal(DEFAULT_THRESHOLDS.batteryWeakV, 12.2);
});

// ---------------------------------------------------------------- FleetService
function position(ts, o = {}) {
  return { imei: ID, ts, time: ts, lat: 33.7, lon: -84.4, valid: true, speedKmh: 40, acc: true, mileageM: 1_000_000, obd: { rpm: 1800, externalVoltage: 14.1, coolantC: 88, fuelLevelPct: 50 }, ...o };
}

test('FleetService: auto-created vehicle, odometer sources, alerts into the store', () => {
  const store = new Store({ dataDir: null });
  let clock = T0.getTime();
  const fleet = new FleetService({ store, dataDir: null, repeatMinutes: 30, offlineCheckMs: 0, clock: () => clock }).start();

  store.addPosition(position(at(0), { obd: { rpm: 1800, externalVoltage: 14.1, canOdometerKm: 80000 } }));
  let v = fleet.listVehicles()[0];
  assert.ok(v, 'vehicle auto-created from the first position');
  assert.equal(v.deviceId, ID);
  assert.equal(v.odometerSource, 'vehicle_can');
  assert.equal(v.odometer, kmToUnits(80000, 'mi'));

  // device mileage only + manual odometer -> offset
  store.addPosition(position(at(1), { mileageM: 2_000_000, obd: { rpm: 1800, externalVoltage: 14.1 } }));
  fleet.setOdometer(v.id, 50000); // 50,000 mi now, while the device counter reads 2,000 km
  store.addPosition(position(at(2), { mileageM: 2_016_093, obd: { rpm: 1800, externalVoltage: 14.1 } })); // +16.09 km = +10 mi
  v = fleet.summary(v.id);
  assert.equal(v.odometerSource, 'device_mileage');
  assert.equal(v.odometer, 50010);

  // weak battery: three parked samples
  for (let i = 3; i < 6; i++) store.addPosition(position(at(i), { acc: false, speedKmh: 0, obd: { rpm: 0, externalVoltage: 11.9 } }));
  assert.ok(store.alerts.some((a) => a.type === 'battery_weak' && a.vehicleId === v.id));
  v = fleet.summary(v.id);
  assert.equal(v.battery.status, 'weak');
  assert.equal(v.health.label, 'attention');

  // DTCs
  store.addPosition(position(at(6), { obd: { rpm: 1800, externalVoltage: 14.1, dtcs: ['P0420'] } }));
  const dtc = store.alerts.find((a) => a.type === 'dtc_new');
  assert.ok(dtc);
  assert.equal(dtc.data.codes[0].description, describeDtc('P0420').description);
  assert.equal(fleet.summary(v.id).dtcs[0].code, 'P0420');

  // unplug alarm via event, repeated alarms are de-duplicated for repeatMinutes
  store.addEvent({ kind: 'alarm', imei: ID, alarm: 'main_power_cut', alarms: ['main_power_cut'] });
  store.addEvent({ kind: 'alarm', imei: ID, alarm: 'main_power_cut', alarms: ['main_power_cut'] });
  assert.equal(store.alerts.filter((a) => a.type === 'unplugged').length, 1);
  clock += 31 * 60000;
  store.addEvent({ kind: 'alarm', imei: ID, alarm: 'main_power_cut', alarms: ['main_power_cut'] });
  assert.equal(store.alerts.filter((a) => a.type === 'unplugged').length, 2);

  // offline check
  clock += 25 * 3600000;
  const off = fleet.checkOffline();
  assert.equal(off[0]?.type, 'offline');
  assert.equal(fleet.summary(v.id).offline, true);

  // ack
  store.ackAlert(dtc.id);
  assert.ok(!fleet.summary(v.id).openAlerts.some((a) => a.id === dtc.id));
  fleet.stop();
});

test('FleetService: maintenance due alerts and logging a service', () => {
  const store = new Store({ dataDir: null });
  let clock = T0.getTime();
  const fleet = new FleetService({ store, dataDir: null, autoCreate: false, offlineCheckMs: 0, clock: () => clock }).start();
  // the tracker already reports (device counter at 0 km) before the customer is enrolled
  store.addPosition(position(at(-1), { mileageM: 0 }));
  assert.equal(fleet.listVehicles().length, 0, 'autoCreate off: no vehicle yet');
  const v = fleet.addVehicle({ deviceId: ID, customer: { name: 'Maria', phone: '305' }, plate: 'ABC123', units: 'km', odometer: 100000, schedule: { oil_change: { km: 1000, days: 0 } } });
  assert.equal(v.customer.name, 'Maria');
  assert.equal(fleet.summary(v.id).odometer, 100000);
  assert.equal(v.odometerOffsetKm, 100000);

  // the enrolment odometer is the baseline: 950 km later -> due soon, 1000 km -> overdue
  store.addPosition(position(at(0), { mileageM: 950_000 }));
  assert.ok(store.alerts.some((a) => a.type === 'service_due_soon' && a.data.item === 'oil_change'));
  store.addPosition(position(at(1), { mileageM: 1_050_000 }));
  const overdue = store.alerts.find((a) => a.type === 'service_overdue' && a.data.item === 'oil_change');
  assert.ok(overdue);
  assert.equal(fleet.summary(v.id).maintenance.overdue[0], 'oil_change');

  const entry = fleet.logService(v.id, { item: 'oil_change', odometer: 101050, note: '5W-30' });
  assert.equal(entry.odometerKm, 101050);
  const s = fleet.summary(v.id);
  assert.ok(!s.maintenance.overdue.includes('oil_change'));
  assert.equal(s.maintenance.items.find((i) => i.item === 'oil_change').status, 'ok');
  assert.equal(s.openAlerts.some((a) => a.id === overdue.id), false, 'the overdue alert is acknowledged by the service');
  assert.equal(s.serviceLog.length, 1);

  assert.throws(() => fleet.addVehicle({ deviceId: ID }), /already assigned/);
  fleet.stop();
});

test('FleetService: the car\'s CAN odometer wins over a manual entry, which is flagged when it disagrees', () => {
  const store = new Store({ dataDir: null });
  const fleet = new FleetService({ store, dataDir: null, offlineCheckMs: 0 }).start();
  store.addPosition(position(at(0), { mileageM: 5000, obd: { rpm: 1800, externalVoltage: 14.1, canOdometerKm: 80000 } }));
  const v = fleet.listVehicles()[0];
  fleet.updateVehicle(v.id, { units: 'km', odometer: 95000 }); // customer typed a value 19% away from the car's own reading
  let s = fleet.summary(v.id);
  assert.equal(s.odometer, 80000);
  assert.equal(s.odometerSource, 'vehicle_can');
  assert.deepEqual(s.odometerMismatch, { manual: 95000, vehicle: 80000, percent: 19 });
  fleet.updateVehicle(v.id, { odometer: 80100 }); // within 5 %: no flag
  s = fleet.summary(v.id);
  assert.equal(s.odometerMismatch, null);
  assert.equal(s.odometer, 80000);
  fleet.stop();
});

test('FleetService: vehicles persist to disk and reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv55g-fleet-'));
  const store = new Store({ dataDir: null });
  const fleet = new FleetService({ store, dataDir: dir, offlineCheckMs: 0 }).start();
  const v = fleet.addVehicle({ deviceId: ID, customer: { name: 'Jose' }, plate: 'XYZ', units: 'mi', odometer: 12345 });
  fleet.logService(v.id, { item: 'tire_rotation' });
  fleet.stop(); // flushes
  const reloaded = new FleetService({ store, dataDir: dir, offlineCheckMs: 0 });
  const r = reloaded.summary(v.id);
  assert.equal(r.customer.name, 'Jose');
  assert.equal(r.odometer, 12345);
  assert.equal(r.serviceLog[0].item, 'tire_rotation');
  fs.rmSync(dir, { recursive: true, force: true });
});
