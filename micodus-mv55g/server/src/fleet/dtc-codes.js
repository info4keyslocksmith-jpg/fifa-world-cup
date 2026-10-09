/**
 * OBD-II diagnostic trouble code descriptions.
 *
 * The MV55G reports DTCs as plain strings (item 0xA0, e.g. "P0301,P0420"). This table
 * turns them into something a customer and a technician can act on: a short description,
 * a severity, and a "lead type" that tells the business which service to offer.
 *
 * Generic codes (second character 0) are standard across makes; manufacturer-specific
 * codes (second character 1, 2 or 3) need a dealer-level or professional tool, which is
 * exactly the module-programming / diagnostics work a mobile automotive business sells.
 */

const CODES = {
  // --- misfires (can destroy the catalytic converter: urgent) ---
  P0300: ['Random / multiple cylinder misfire', 'critical', 'engine'],
  P0301: ['Cylinder 1 misfire', 'critical', 'engine'],
  P0302: ['Cylinder 2 misfire', 'critical', 'engine'],
  P0303: ['Cylinder 3 misfire', 'critical', 'engine'],
  P0304: ['Cylinder 4 misfire', 'critical', 'engine'],
  P0305: ['Cylinder 5 misfire', 'critical', 'engine'],
  P0306: ['Cylinder 6 misfire', 'critical', 'engine'],
  P0307: ['Cylinder 7 misfire', 'critical', 'engine'],
  P0308: ['Cylinder 8 misfire', 'critical', 'engine'],
  // --- fuel / air ---
  P0171: ['System too lean (bank 1): vacuum leak, MAF, fuel delivery', 'warning', 'engine'],
  P0172: ['System too rich (bank 1)', 'warning', 'engine'],
  P0174: ['System too lean (bank 2)', 'warning', 'engine'],
  P0175: ['System too rich (bank 2)', 'warning', 'engine'],
  P0087: ['Fuel rail pressure too low', 'critical', 'engine'],
  P0088: ['Fuel rail pressure too high', 'critical', 'engine'],
  P0230: ['Fuel pump primary circuit', 'critical', 'engine'],
  P0101: ['Mass air flow sensor range / performance', 'warning', 'engine'],
  P0102: ['Mass air flow sensor low input', 'warning', 'engine'],
  P0103: ['Mass air flow sensor high input', 'warning', 'engine'],
  P0113: ['Intake air temperature sensor high input', 'info', 'engine'],
  P0299: ['Turbo / supercharger underboost', 'warning', 'engine'],
  P0325: ['Knock sensor circuit (bank 1)', 'warning', 'engine'],
  P0335: ['Crankshaft position sensor circuit: stalling / no start risk', 'critical', 'engine'],
  P0340: ['Camshaft position sensor circuit', 'critical', 'engine'],
  P0401: ['EGR flow insufficient', 'warning', 'emissions'],
  P0404: ['EGR circuit range / performance', 'warning', 'emissions'],
  P0411: ['Secondary air injection incorrect flow', 'info', 'emissions'],
  P0500: ['Vehicle speed sensor', 'warning', 'engine'],
  P0505: ['Idle control system', 'info', 'engine'],
  P0507: ['Idle speed higher than expected', 'info', 'engine'],
  // --- variable valve timing / timing ---
  P0010: ['Camshaft position actuator circuit (bank 1)', 'warning', 'engine'],
  P0011: ['Camshaft timing over-advanced (bank 1): often low or dirty oil', 'warning', 'oil'],
  P0012: ['Camshaft timing over-retarded (bank 1): often low or dirty oil', 'warning', 'oil'],
  P0014: ['Exhaust camshaft timing over-advanced (bank 1)', 'warning', 'oil'],
  P0016: ['Crank / cam correlation (bank 1): timing chain or oil', 'critical', 'engine'],
  P0017: ['Crank / cam correlation (bank 1, exhaust)', 'critical', 'engine'],
  // --- cooling / oil ---
  P0128: ['Coolant below thermostat regulating temperature (thermostat stuck open)', 'warning', 'cooling'],
  P0217: ['Engine over-temperature condition', 'critical', 'cooling'],
  P0117: ['Engine coolant temperature sensor low input', 'warning', 'cooling'],
  P0118: ['Engine coolant temperature sensor high input', 'warning', 'cooling'],
  P0520: ['Engine oil pressure sensor circuit', 'critical', 'oil'],
  P0521: ['Engine oil pressure sensor range / performance', 'critical', 'oil'],
  P0522: ['Engine oil pressure sensor low voltage', 'critical', 'oil'],
  P0523: ['Engine oil pressure sensor high voltage', 'critical', 'oil'],
  P0524: ['Engine oil pressure too low: stop driving', 'critical', 'oil'],
  P06DD: ['Engine oil pressure control circuit stuck off', 'critical', 'oil'],
  // --- oxygen sensors / catalyst / EVAP ---
  P0131: ['O2 sensor low voltage (bank 1, sensor 1)', 'warning', 'emissions'],
  P0133: ['O2 sensor slow response (bank 1, sensor 1)', 'warning', 'emissions'],
  P0135: ['O2 sensor heater circuit (bank 1, sensor 1)', 'info', 'emissions'],
  P0141: ['O2 sensor heater circuit (bank 1, sensor 2)', 'info', 'emissions'],
  P0151: ['O2 sensor low voltage (bank 2, sensor 1)', 'warning', 'emissions'],
  P0155: ['O2 sensor heater circuit (bank 2, sensor 1)', 'info', 'emissions'],
  P0420: ['Catalyst efficiency below threshold (bank 1)', 'warning', 'emissions'],
  P0430: ['Catalyst efficiency below threshold (bank 2)', 'warning', 'emissions'],
  P0440: ['EVAP system malfunction', 'info', 'emissions'],
  P0442: ['EVAP small leak: check the gas cap first', 'info', 'emissions'],
  P0455: ['EVAP large leak: gas cap loose or missing', 'info', 'emissions'],
  P0456: ['EVAP very small leak', 'info', 'emissions'],
  P0457: ['EVAP leak: fuel cap loose / off', 'info', 'emissions'],
  // --- electrical / charging (battery and alternator leads) ---
  P0562: ['System voltage low: battery or alternator', 'warning', 'battery'],
  P0563: ['System voltage high: voltage regulator / alternator', 'warning', 'battery'],
  P0620: ['Generator (alternator) control circuit', 'warning', 'battery'],
  P0622: ['Generator field control circuit', 'warning', 'battery'],
  P0A80: ['Hybrid battery pack deterioration', 'critical', 'battery'],
  // --- modules ---
  P0601: ['Control module memory checksum error', 'warning', 'module'],
  P0603: ['Control module keep-alive memory error (often after battery disconnect)', 'info', 'module'],
  P0604: ['Control module RAM error', 'warning', 'module'],
  P0605: ['Control module ROM error', 'warning', 'module'],
  P0606: ['ECM / PCM processor fault', 'critical', 'module'],
  P0607: ['Control module performance', 'warning', 'module'],
  P062F: ['Control module EEPROM error', 'warning', 'module'],
  P0630: ['VIN not programmed or mismatch in ECM / PCM', 'warning', 'module'],
  P0633: ['Immobilizer key not programmed to ECM / PCM', 'critical', 'key'],
  P1600: ['Loss of keep-alive power / ECM programming (manufacturer specific)', 'warning', 'module'],
  P1610: ['Immobilizer / key authentication fault (manufacturer specific)', 'critical', 'key'],
  P1611: ['Immobilizer: incorrect security code (manufacturer specific)', 'critical', 'key'],
  P1612: ['Immobilizer: ECM / immobilizer communication (manufacturer specific)', 'critical', 'key'],
  // --- transmission ---
  P0700: ['Transmission control system malfunction (TCM has stored codes)', 'warning', 'transmission'],
  P0705: ['Transmission range sensor circuit', 'warning', 'transmission'],
  P0715: ['Input / turbine speed sensor circuit', 'warning', 'transmission'],
  P0720: ['Output speed sensor circuit', 'warning', 'transmission'],
  P0730: ['Incorrect gear ratio', 'warning', 'transmission'],
  P0740: ['Torque converter clutch circuit', 'warning', 'transmission'],
  P0750: ['Shift solenoid A', 'warning', 'transmission'],
  // --- network / communication (module programming leads) ---
  U0001: ['High-speed CAN bus communication fault', 'critical', 'comms'],
  U0073: ['Control module communication bus off', 'critical', 'comms'],
  U0100: ['Lost communication with ECM / PCM', 'critical', 'comms'],
  U0101: ['Lost communication with TCM', 'critical', 'comms'],
  U0121: ['Lost communication with ABS module', 'warning', 'comms'],
  U0140: ['Lost communication with body control module', 'warning', 'comms'],
  U0151: ['Lost communication with airbag (SRS) module', 'warning', 'comms'],
  U0155: ['Lost communication with instrument cluster', 'warning', 'comms'],
  U0164: ['Lost communication with HVAC module', 'info', 'comms'],
  U0184: ['Lost communication with radio', 'info', 'comms'],
  U0401: ['Invalid data received from ECM / PCM', 'warning', 'comms'],
  U0415: ['Invalid data received from ABS module', 'warning', 'comms'],
  U1000: ['Class 2 / CAN communication fault (manufacturer specific)', 'warning', 'comms'],
  // --- chassis ---
  C0035: ['Left front wheel speed sensor circuit', 'warning', 'abs'],
  C0040: ['Right front wheel speed sensor circuit', 'warning', 'abs'],
  C0045: ['Left rear wheel speed sensor circuit', 'warning', 'abs'],
  C0050: ['Right rear wheel speed sensor circuit', 'warning', 'abs'],
  C0265: ['ABS / EBCM module relay circuit', 'warning', 'abs'],
  C1201: ['Engine control system malfunction (ABS/VSC disabled, manufacturer specific)', 'warning', 'abs'],
  // --- body ---
  B1000: ['ECU malfunction (manufacturer specific body code)', 'warning', 'module'],
  B0001: ['Driver frontal airbag deployment loop (manufacturer specific)', 'warning', 'airbag'],
  B1318: ['Battery voltage low (body module, manufacturer specific)', 'warning', 'battery'],
  B2799: ['Engine immobilizer system malfunction (Toyota/Lexus)', 'critical', 'key'],
};

const SYSTEM = { P: 'powertrain', B: 'body', C: 'chassis', U: 'network' };
const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };

/** Normalise "p0301", " P0301 ", "0301" → "P0301". */
export function normalizeDtc(code) {
  let c = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (/^\d{4}$/.test(c)) c = 'P' + c;
  return /^[PBCU][0-9A-F]{4}$/.test(c) ? c : null;
}

/**
 * Describe a DTC: { code, system, generic, description, severity, lead, known }.
 * Unknown codes get a category-based description so the alert is still useful.
 */
export function describeDtc(raw) {
  const code = normalizeDtc(raw);
  if (!code) return { code: String(raw), system: 'unknown', generic: false, description: 'Not a valid DTC format', severity: 'info', lead: 'diagnostics', known: false };
  const system = SYSTEM[code[0]];
  const generic = code[1] === '0';
  const hit = CODES[code];
  if (hit) return { code, system, generic, description: hit[0], severity: hit[1], lead: hit[2], known: true };
  let description;
  let severity = 'warning';
  let lead = 'diagnostics';
  if (code[0] === 'U') {
    description = 'Network / module communication code' + (generic ? '' : ' (manufacturer specific)');
    lead = 'comms';
  } else if (code[0] === 'B') {
    description = 'Body control / electrical code' + (generic ? '' : ' (manufacturer specific)');
    lead = 'module';
    severity = 'info';
  } else if (code[0] === 'C') {
    description = 'Chassis (ABS / steering / suspension) code' + (generic ? '' : ' (manufacturer specific)');
    lead = 'abs';
  } else {
    description = generic ? 'Generic powertrain code' : 'Manufacturer-specific powertrain code: needs a professional scan tool';
    lead = generic ? 'engine' : 'diagnostics';
  }
  return { code, system, generic, description, severity, lead, known: false };
}

/** Highest severity among a list of codes ('info' | 'warning' | 'critical' | null). */
export function worstSeverity(codes = []) {
  let worst = null;
  for (const c of codes) {
    const s = describeDtc(c).severity;
    if (!worst || SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

export const DTC_TABLE_SIZE = Object.keys(CODES).length;
