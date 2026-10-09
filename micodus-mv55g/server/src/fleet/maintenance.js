/**
 * Maintenance schedules computed from the tracker's odometer and the calendar.
 *
 * Important limit: OBD-II exposes no oil life, oil level, brake wear or tire pressure on
 * ordinary cars. The MV55G gives us the vehicle odometer (CAN item 0x8C, when the car
 * supports it) or its own trip mileage (item 0x01), plus engine data. So "oil change due"
 * is distance / time based, the way most shops schedule it anyway, and the engine data
 * (coolant, voltage, DTCs) is used for *health* alerts in rules.js.
 */

export const KM_PER_MILE = 1.609344;

/** Default service intervals. km = 0 means time-based only; days = 0 means distance only. */
export const DEFAULT_SCHEDULE = {
  oil_change: { label: 'Engine oil and filter', km: 8000, days: 180 },
  tire_rotation: { label: 'Tire rotation', km: 10000, days: 0 },
  brake_inspection: { label: 'Brake inspection', km: 20000, days: 365 },
  engine_air_filter: { label: 'Engine air filter', km: 25000, days: 365 },
  cabin_air_filter: { label: 'Cabin air filter', km: 25000, days: 365 },
  transmission_fluid: { label: 'Transmission fluid', km: 60000, days: 0 },
  spark_plugs: { label: 'Spark plugs', km: 60000, days: 0 },
  coolant: { label: 'Coolant flush', km: 80000, days: 1825 },
  battery: { label: 'Battery test / replacement', km: 0, days: 1095 },
  wiper_blades: { label: 'Wiper blades', km: 0, days: 365 },
  key_fob_battery: { label: 'Key fob battery', km: 0, days: 730 },
  inspection: { label: 'Annual inspection / registration', km: 0, days: 365 },
};

export const DUE_SOON_FRACTION = 0.9;

const DAY_MS = 24 * 3600 * 1000;

/**
 * Status of one service item.
 *  - baseline: the last logged service for the item, or the vehicle's enrolment point.
 *  - percent: how far through the interval we are (max of distance and time), 0..∞.
 */
export function itemStatus(item, def, { lastService, odometerKm, now }) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const out = { item, label: def.label, intervalKm: def.km || 0, intervalDays: def.days || 0, lastServiceOdometerKm: lastService?.odometerKm ?? null, lastServiceDate: lastService?.date ?? null };
  let pct = 0;
  if (def.km && lastService?.odometerKm != null && odometerKm != null) {
    out.usedKm = Math.max(0, odometerKm - lastService.odometerKm);
    out.remainingKm = Math.round(def.km - out.usedKm);
    out.dueAtKm = Math.round(lastService.odometerKm + def.km);
    pct = Math.max(pct, out.usedKm / def.km);
  }
  if (def.days && lastService?.date) {
    const usedDays = (nowMs - new Date(lastService.date).getTime()) / DAY_MS;
    out.usedDays = Math.max(0, Math.round(usedDays));
    out.remainingDays = Math.round(def.days - usedDays);
    out.dueAtDate = new Date(new Date(lastService.date).getTime() + def.days * DAY_MS).toISOString().slice(0, 10);
    pct = Math.max(pct, usedDays / def.days);
  }
  out.percent = Math.round(pct * 100);
  out.status = pct >= 1 ? 'overdue' : pct >= DUE_SOON_FRACTION ? 'due_soon' : lastService ? 'ok' : 'unknown';
  return out;
}

/**
 * Status of every item in the schedule.
 * `serviceLog` entries: { item, date (ISO), odometerKm, note }.
 * `enrolled`: { date, odometerKm } used as the baseline when an item was never logged.
 */
export function maintenanceStatus({ schedule = {}, serviceLog = [], enrolled = null, odometerKm = null, now = new Date() }) {
  const merged = {};
  for (const [k, v] of Object.entries(DEFAULT_SCHEDULE)) merged[k] = { ...v };
  for (const [k, v] of Object.entries(schedule || {})) {
    if (v === null || v === false) delete merged[k];
    else merged[k] = { label: v.label || merged[k]?.label || k, km: v.km ?? merged[k]?.km ?? 0, days: v.days ?? merged[k]?.days ?? 0 };
  }
  const lastByItem = {};
  for (const s of serviceLog) {
    if (!s?.item) continue;
    if (!lastByItem[s.item] || new Date(s.date) > new Date(lastByItem[s.item].date)) lastByItem[s.item] = s;
  }
  const items = Object.entries(merged).map(([item, def]) => itemStatus(item, def, { lastService: lastByItem[item] || enrolled, odometerKm, now }));
  const order = { overdue: 0, due_soon: 1, ok: 2, unknown: 3 };
  items.sort((a, b) => order[a.status] - order[b.status] || b.percent - a.percent);
  return {
    items,
    overdue: items.filter((i) => i.status === 'overdue').map((i) => i.item),
    dueSoon: items.filter((i) => i.status === 'due_soon').map((i) => i.item),
    next: items.find((i) => i.status !== 'unknown') || null,
  };
}

export function kmToUnits(km, units) {
  if (km == null) return null;
  return units === 'mi' ? Math.round(km / KM_PER_MILE) : Math.round(km);
}

export function unitsToKm(value, units) {
  if (value == null) return null;
  return units === 'mi' ? value * KM_PER_MILE : value;
}
