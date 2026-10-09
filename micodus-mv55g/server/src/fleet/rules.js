/**
 * Alert rules evaluated on every position / event of a vehicle.
 *
 * Pure functions: (vehicle state, new sample, thresholds) -> { alerts, state }. The
 * FleetService persists the state between samples. Every rule is debounced so one noisy
 * sample never bothers a customer.
 */
import { describeDtc, normalizeDtc, worstSeverity } from './dtc-codes.js';

export const DEFAULT_THRESHOLDS = {
  batteryWeakV: 12.2, // engine off, resting
  batteryCriticalV: 11.8,
  chargingLowV: 13.2, // engine running
  chargingHighV: 15.0,
  voltageSamples: 3, // consecutive samples before alerting
  coolantWarnC: 105,
  coolantCriticalC: 115,
  coolantSamples: 2,
  fuelLowPct: 15,
  fuelResetPct: 25,
  overspeedKmh: 130,
  idleMinutes: 10,
  harshEventsPerDay: 5,
  offlineHours: 24,
  geofenceRadiusM: 300,
};

const toRad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function alert(type, severity, title, detail, data = {}) {
  return { type, severity, title, detail, data };
}

/** Fresh per-vehicle rule state. */
export function initialState() {
  return {
    knownDtcs: [],
    lowVoltageStreak: 0,
    chargingLowStreak: 0,
    chargingHighStreak: 0,
    batteryAlerted: null, // 'weak' | 'critical' | null
    chargingAlerted: null, // 'low' | 'high' | null
    coolantStreak: 0,
    coolantAlerted: null,
    fuelLowAlerted: false,
    idleSince: null,
    idleAlerted: false,
    overspeedActive: false,
    harshDay: null,
    harshCount: 0,
    harshAlerted: false,
    geofenceInside: {}, // name -> boolean
    offlineAlerted: false,
    lastSampleTs: null,
    lastPosition: null,
  };
}

/**
 * Evaluate a position sample.
 * sample: { ts, time, lat, lon, valid, speedKmh, acc, obd:{rpm, externalVoltage, coolantC, fuelLevelPct, dtcs}, extras:{powerVoltage}, alarms:[] }
 */
export function evaluatePosition(stateIn, sample, vehicle = {}, T = DEFAULT_THRESHOLDS) {
  const state = { ...stateIn, geofenceInside: { ...stateIn.geofenceInside } };
  const th = { ...DEFAULT_THRESHOLDS, ...T, ...(vehicle.thresholds || {}) };
  const alerts = [];
  const obd = sample.obd || {};
  const ts = sample.ts || new Date().toISOString();
  const tsMs = new Date(ts).getTime();
  const engineRunning = obd.rpm != null ? obd.rpm > 300 : sample.acc === true;
  const voltage = obd.externalVoltage ?? sample.extras?.externalVoltage ?? sample.extras?.powerVoltage ?? null;

  // --- DTCs: alert on new codes, note when they clear ---
  if (Array.isArray(obd.dtcs)) {
    const codes = [...new Set(obd.dtcs.map(normalizeDtc).filter(Boolean))];
    const fresh = codes.filter((c) => !state.knownDtcs.includes(c));
    const cleared = state.knownDtcs.filter((c) => !codes.includes(c));
    if (fresh.length) {
      const described = fresh.map(describeDtc);
      const sev = worstSeverity(fresh) || 'warning';
      alerts.push(alert('dtc_new', sev, `Check engine: ${fresh.join(', ')}`, described.map((d) => `${d.code}: ${d.description}`).join('; '), { codes: described, leads: [...new Set(described.map((d) => d.lead))] }));
    }
    if (cleared.length) alerts.push(alert('dtc_cleared', 'info', `Fault codes cleared: ${cleared.join(', ')}`, 'The codes are no longer reported by the vehicle.', { codes: cleared }));
    state.knownDtcs = codes;
  }

  // --- battery / charging system ---
  if (voltage != null) {
    if (!engineRunning) {
      state.chargingLowStreak = 0;
      state.chargingHighStreak = 0;
      if (voltage < th.batteryWeakV) {
        state.lowVoltageStreak++;
        const level = voltage < th.batteryCriticalV ? 'critical' : 'weak';
        if (state.lowVoltageStreak >= th.voltageSamples && state.batteryAlerted !== level) {
          alerts.push(alert('battery_' + level, level === 'critical' ? 'critical' : 'warning', `Battery ${level}: ${voltage.toFixed(1)} V with engine off`, level === 'critical' ? 'The car may not start. Offer a battery test / replacement today.' : 'Resting voltage is low. Battery test recommended before it fails.', { voltage }));
          state.batteryAlerted = level;
        }
      } else {
        state.lowVoltageStreak = 0;
        if (state.batteryAlerted && voltage >= th.batteryWeakV + 0.3) {
          alerts.push(alert('battery_recovered', 'info', `Battery voltage back to ${voltage.toFixed(1)} V`, 'Resting voltage is normal again.', { voltage }));
          state.batteryAlerted = null;
        }
      }
    } else {
      state.lowVoltageStreak = 0;
      if (voltage < th.chargingLowV) {
        state.chargingLowStreak++;
        state.chargingHighStreak = 0;
        if (state.chargingLowStreak >= th.voltageSamples && state.chargingAlerted !== 'low') {
          alerts.push(alert('charging_low', 'warning', `Charging system low: ${voltage.toFixed(1)} V with engine running`, 'Alternator or belt may be failing; the battery will drain while driving.', { voltage }));
          state.chargingAlerted = 'low';
        }
      } else if (voltage > th.chargingHighV) {
        state.chargingHighStreak++;
        state.chargingLowStreak = 0;
        if (state.chargingHighStreak >= th.voltageSamples && state.chargingAlerted !== 'high') {
          alerts.push(alert('charging_high', 'warning', `Charging voltage high: ${voltage.toFixed(1)} V`, 'Voltage regulator fault can damage the battery and electronics.', { voltage }));
          state.chargingAlerted = 'high';
        }
      } else {
        state.chargingLowStreak = 0;
        state.chargingHighStreak = 0;
        if (state.chargingAlerted) {
          alerts.push(alert('charging_ok', 'info', `Charging voltage normal: ${voltage.toFixed(1)} V`, '', { voltage }));
          state.chargingAlerted = null;
        }
      }
    }
  }

  // --- coolant ---
  if (obd.coolantC != null) {
    if (obd.coolantC >= th.coolantWarnC) {
      state.coolantStreak++;
      const level = obd.coolantC >= th.coolantCriticalC ? 'critical' : 'warning';
      if (state.coolantStreak >= th.coolantSamples && state.coolantAlerted !== level) {
        alerts.push(alert('coolant_high', level, `Engine ${level === 'critical' ? 'overheating' : 'running hot'}: ${obd.coolantC} °C`, level === 'critical' ? 'Stop the engine as soon as it is safe. Check coolant level, fan and thermostat.' : 'Coolant temperature above normal. Check coolant level and fan.', { coolantC: obd.coolantC }));
        state.coolantAlerted = level;
      }
    } else {
      state.coolantStreak = 0;
      if (state.coolantAlerted && obd.coolantC < th.coolantWarnC - 5) {
        alerts.push(alert('coolant_ok', 'info', `Coolant temperature normal: ${obd.coolantC} °C`, '', { coolantC: obd.coolantC }));
        state.coolantAlerted = null;
      }
    }
  }

  // --- fuel ---
  if (obd.fuelLevelPct != null) {
    if (obd.fuelLevelPct < th.fuelLowPct && !state.fuelLowAlerted) {
      alerts.push(alert('fuel_low', 'info', `Fuel low: ${obd.fuelLevelPct}%`, '', { fuelLevelPct: obd.fuelLevelPct }));
      state.fuelLowAlerted = true;
    } else if (obd.fuelLevelPct >= th.fuelResetPct) state.fuelLowAlerted = false;
  }

  // --- overspeed (from the device alarm or our own threshold) ---
  const over = (sample.alarms || []).includes('overspeed') || (sample.speedKmh != null && sample.speedKmh > th.overspeedKmh);
  if (over && !state.overspeedActive) {
    const title = sample.speedKmh > 0 ? `Speeding: ${sample.speedKmh} km/h` : 'Speeding alarm reported by the tracker';
    alerts.push(alert('overspeed', 'warning', title, sample.speedKmh > 0 ? '' : 'The device raised its overspeed alarm; GPS speed in the same report was 0.', { speedKmh: sample.speedKmh }));
    state.overspeedActive = true;
  } else if (!over && sample.speedKmh != null && sample.speedKmh < th.overspeedKmh - 10) state.overspeedActive = false;

  // --- harsh driving counter per day ---
  const harsh = (sample.alarms || []).filter((a) => /^harsh_/.test(a) || a === 'collision');
  if (harsh.length) {
    const day = ts.slice(0, 10);
    if (state.harshDay !== day) {
      state.harshDay = day;
      state.harshCount = 0;
      state.harshAlerted = false;
    }
    state.harshCount += harsh.length;
    if (harsh.includes('collision')) alerts.push(alert('collision', 'critical', 'Possible collision detected', 'Call the driver.', { alarms: harsh }));
    if (state.harshCount >= th.harshEventsPerDay && !state.harshAlerted) {
      alerts.push(alert('harsh_driving', 'warning', `${state.harshCount} harsh driving events today`, 'Harsh braking / acceleration / cornering wear brakes and tires.', { count: state.harshCount }));
      state.harshAlerted = true;
    }
  }

  // --- idling ---
  const idling = sample.acc === true && sample.speedKmh != null && sample.speedKmh < 2 && (obd.rpm == null || obd.rpm > 300);
  if (idling) {
    if (!state.idleSince) state.idleSince = ts;
    const minutes = (tsMs - new Date(state.idleSince).getTime()) / 60000;
    if (minutes >= th.idleMinutes && !state.idleAlerted) {
      alerts.push(alert('idle_long', 'info', `Idling for ${Math.round(minutes)} minutes`, 'Engine running while parked.', { minutes: Math.round(minutes) }));
      state.idleAlerted = true;
    }
  } else {
    state.idleSince = null;
    state.idleAlerted = false;
  }

  // --- geofences (circles) ---
  if (sample.valid && sample.lat != null && Array.isArray(vehicle.geofences)) {
    for (const g of vehicle.geofences) {
      if (!g?.name || g.lat == null || g.lon == null) continue;
      const inside = distanceM({ lat: sample.lat, lon: sample.lon }, g) <= (g.radiusM || th.geofenceRadiusM);
      const was = state.geofenceInside[g.name];
      if (was !== undefined && was !== inside) {
        const dir = inside ? 'enter' : 'exit';
        if (!g.alertOn || g.alertOn === 'both' || g.alertOn === dir) {
          alerts.push(alert('geofence_' + dir, g.severity || 'info', `${inside ? 'Arrived at' : 'Left'} ${g.name}`, '', { geofence: g.name }));
        }
      }
      state.geofenceInside[g.name] = inside;
    }
  }

  state.lastSampleTs = ts;
  if (sample.valid && sample.lat != null) state.lastPosition = { lat: sample.lat, lon: sample.lon, ts };
  state.offlineAlerted = false;
  return { alerts, state };
}

/** Device-level alarms that arrive as events (not only inside positions). */
export function evaluateEvent(stateIn, event) {
  const state = { ...stateIn };
  const alerts = [];
  const alarms = event.alarms || (event.alarm ? String(event.alarm).split(',') : []);
  for (const a of alarms) {
    switch (a) {
      case 'main_power_cut':
      case 'power_cut':
        alerts.push(alert('unplugged', 'critical', 'Tracker unplugged from the OBD port', 'Possible theft or tampering, or a mechanic removed it. Running on backup battery (about 1–2 h).', { alarm: a }));
        break;
      case 'illegal_displacement':
      case 'displacement':
      case 'vibration':
        alerts.push(alert('tow_or_move', 'warning', 'Vehicle moved with the ignition off', 'Towing or a push; check the location.', { alarm: a }));
        break;
      case 'sos':
        alerts.push(alert('sos', 'critical', 'SOS button pressed', '', { alarm: a }));
        break;
      case 'low_external_power':
      case 'main_power_undervoltage':
        alerts.push(alert('vehicle_battery_low_alarm', 'warning', 'Vehicle battery low (device alarm)', '', { alarm: a }));
        break;
      case 'tamper_disassemble':
        alerts.push(alert('tamper', 'critical', 'Tracker tamper alarm', '', { alarm: a }));
        break;
      default:
        break;
    }
  }
  return { alerts, state };
}

/** Periodic check: device silent for too long. */
export function evaluateOffline(stateIn, lastSeenIso, nowMs = Date.now(), T = DEFAULT_THRESHOLDS) {
  const state = { ...stateIn };
  const alerts = [];
  if (!lastSeenIso) return { alerts, state };
  const hours = (nowMs - new Date(lastSeenIso).getTime()) / 3600000;
  if (hours >= T.offlineHours && !state.offlineAlerted) {
    alerts.push(alert('offline', 'warning', `No report for ${Math.round(hours)} hours`, 'Tracker unplugged, no cellular coverage, or SIM problem.', { hours: Math.round(hours) }));
    state.offlineAlerted = true;
  }
  return { alerts, state };
}

/** Health score 0..100 from the current state, maintenance and open alerts. */
export function healthScore({ dtcs = [], batteryAlerted = null, chargingAlerted = null, coolantAlerted = null, fuelLow = false, overdue = [], dueSoon = [], offline = false, harshCount = 0 }) {
  let score = 100;
  const sev = worstSeverity(dtcs);
  if (sev === 'critical') score -= 30;
  else if (sev === 'warning') score -= 15;
  else if (sev === 'info') score -= 5;
  // a weak battery is the most actionable finding for a mobile automotive business: it alone
  // moves the vehicle into "attention"
  if (batteryAlerted === 'critical') score -= 30;
  else if (batteryAlerted === 'weak') score -= 20;
  if (chargingAlerted) score -= 15;
  if (coolantAlerted === 'critical') score -= 25;
  else if (coolantAlerted === 'warning') score -= 10;
  if (fuelLow) score -= 3;
  score -= Math.min(30, overdue.length * 10);
  score -= Math.min(10, dueSoon.length * 3);
  if (offline) score -= 10;
  if (harshCount >= 5) score -= 5;
  score = Math.max(0, Math.min(100, score));
  return { score, label: score >= 85 ? 'good' : score >= 60 ? 'attention' : 'urgent' };
}
