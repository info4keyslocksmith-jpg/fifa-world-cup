/**
 * GT06 / Concox protocol-family constants.
 *
 * Protocol numbers are shared across the whole Chinese "GT06" ecosystem
 * (Concox, Jimi, MiCODUS, Sinotrack, Wanway, ...). Names follow the public
 * Concox GT06 / JM-VL0x documents and the Traccar Gt06ProtocolDecoder.
 * Where several vendors reuse a number for different payloads the generic
 * name is kept and the decoder parses adaptively.
 */

export const PROTOCOL_NAMES = {
  0x01: 'login',
  0x05: 'ack_generic', // seen as a server->device ack in some vendors
  0x10: 'gps',
  0x11: 'lbs',
  0x12: 'gps_lbs',
  0x13: 'heartbeat_status',
  0x14: 'satellite_info',
  0x15: 'string_info', // device reply to an online command (0x80)
  0x16: 'alarm_gps_lbs_status',
  0x17: 'wifi_or_rfid',
  0x18: 'lbs_multiple',
  0x19: 'lbs_status',
  0x1a: 'gps_phone',
  0x1e: 'gps_lbs_extend',
  0x21: 'online_command_response', // 0x7979 variant of 0x15
  0x22: 'gps_lbs_2', // GPS + LBS + ACC + upload mode + mileage
  0x23: 'heartbeat_2',
  0x24: 'lbs_multiple_3',
  0x26: 'alarm_gps_lbs_status_2',
  0x27: 'alarm_gps_lbs_status_3',
  0x28: 'lbs_multiple_4',
  0x2a: 'address_request',
  0x2c: 'wifi_lbs_multi',
  0x2d: 'gps_lbs_4',
  0x31: 'gps_lbs_5',
  0x32: 'gps_lbs_status_4',
  0x33: 'wifi_5',
  0x36: 'status_2',
  0x37: 'gps_lbs_6',
  0x40: 'bms',
  0x41: 'multimedia',
  0x65: 'obd_dtc',
  0x66: 'obd_pid',
  0x69: 'wifi_2',
  0x70: 'gps_modular',
  0x80: 'server_command', // server -> device (online command)
  0x81: 'server_command_1',
  0x82: 'server_command_2',
  0x8a: 'time_request', // device asks for UTC time; server replies with same number
  0x8c: 'obd_data',
  0x8d: 'obd_extended',
  0x94: 'info', // extended (0x7979) info packet with sub-types
  0x95: 'alarm_ext',
  0x97: 'address_response',
  0x98: 'lbs_multiple_5',
  0x9b: 'serial_passthrough',
  0xa0: 'gps_lbs_7_4g', // GPS + 4G LBS (LAC 4 bytes, Cell ID 8 bytes)
  0xa1: 'lbs_2_4g',
  0xa2: 'wifi_3',
  0xa3: 'fence_single',
  0xa4: 'fence_multi',
  0xa5: 'lbs_alarm_4g',
  0xa7: 'lbs_address',
  0xf2: 'peripheral',
  0xf3: 'wifi_4',
};

/** Alarm byte in heartbeat (0x13/0x23) and alarm packets (0x16/0x26/0x27). */
export const ALARM_CODES = {
  0x00: 'normal',
  0x01: 'sos',
  0x02: 'power_cut', // external power disconnected / unplugged
  0x03: 'vibration',
  0x04: 'geofence_enter',
  0x05: 'geofence_exit',
  0x06: 'overspeed',
  0x09: 'displacement', // moved while parked
  0x0a: 'gps_blind_area_enter',
  0x0b: 'gps_blind_area_exit',
  0x0c: 'power_on',
  0x0d: 'gps_first_fix',
  0x0e: 'low_external_power',
  0x0f: 'low_external_power_protection',
  0x10: 'sim_changed',
  0x11: 'power_off',
  0x12: 'airplane_mode_low_power',
  0x13: 'tamper_disassemble',
  0x14: 'door',
  0x15: 'low_power_shutdown',
  0x16: 'sound_alarm',
  0x17: 'internal_battery_low',
  0x18: 'ignition_off_status',
  0x19: 'internal_battery_low_alarm',
  0x20: 'vibration_2',
  0x23: 'fall',
  0x24: 'external_power_restored',
  0x29: 'harsh_acceleration',
  0x2a: 'sharp_turn_left',
  0x2b: 'sharp_turn_right',
  0x2c: 'collision',
  0x30: 'harsh_braking',
  0x32: 'fatigue_driving',
  0x3e: 'idle', // family docs; vendor specific
  0xfe: 'acc_on',
  0xff: 'acc_off',
};

/** 3-bit alarm field inside the terminal-information byte. */
export const TERMINAL_ALARM_BITS = {
  0: 'normal',
  1: 'vibration',
  2: 'power_cut',
  3: 'low_battery',
  4: 'sos',
};

/** 1-byte voltage level in 0x13 heartbeat and 0x16 alarm. */
export const VOLTAGE_LEVELS = {
  0: 'no_power_shutdown',
  1: 'extremely_low_battery',
  2: 'very_low_battery',
  3: 'low_battery',
  4: 'medium',
  5: 'high',
  6: 'very_high',
};

/** 1-byte GSM signal strength. */
export const GSM_LEVELS = {
  0: 'no_signal',
  1: 'extremely_weak',
  2: 'weak',
  3: 'good',
  4: 'strong',
};

export const LANGUAGES = { 0x01: 'chinese', 0x02: 'english' };

/** Sub-types of the 0x94 info packet (first content byte). */
export const INFO_SUBTYPES = {
  0x00: 'external_power_voltage', // u16 / 100 V
  0x01: 'door_status',
  0x02: 'wifi_info',
  0x03: 'rfid',
  0x04: 'terminal_status_sync', // ASCII, e.g. "ALM1=..;ALM2=..;STA1=..;DYD=.."
  0x05: 'door_status_2',
  0x06: 'self_check',
  0x07: 'ambient_temp',
  0x08: 'ignition_status',
  0x09: 'driving_behaviour',
  0x0a: 'iccid_imsi_imei', // IMEI(8) + IMSI(8) + ICCID(10) BCD
  0x0b: 'fuel_sensor',
  0x0c: 'oil_level',
  0x0d: 'lbs_extension',
  0x0e: 'ignition_voltage',
  0x0f: 'external_sensors',
  0x10: 'rfid_2',
  0x11: 'tag_info',
};

/** Data upload mode byte in 0x22 / 0xA0 location packets. */
export const UPLOAD_MODES = {
  0x00: 'timed_interval',
  0x01: 'fixed_distance',
  0x02: 'inflection_point', // heading change
  0x03: 'acc_status_change',
  0x04: 'last_fix_after_static',
  0x05: 'network_reconnect_reupload',
  0x06: 'ephemeris_update',
  0x07: 'button_press',
  0x08: 'power_on',
  0x09: 'unused',
  0x0a: 'static_last_point',
  0x0b: 'wifi_decode',
  0x0c: 'lbs_decode',
  0x0d: 'wifi_timed',
  0x0e: 'lbs_timed',
  0x0f: 'reserved',
  0x10: 'gps_timed',
};

/**
 * Concox OB22-style OBD key ids (decimal key prefix of "key=value" ASCII pairs
 * in a 0x8C packet). Values are hex integers scaled by 0.01 unless noted.
 * Kept as a best-effort map; the dashboard always shows the raw pairs too.
 */
export const OBD_KEYS = {
  40: { name: 'odometer_km', scale: 0.01 },
  43: { name: 'fuel_level_pct', scale: 0.01 },
  45: { name: 'coolant_temp_c', scale: 0.01 },
  53: { name: 'obd_speed_kmh', scale: 0.01 },
  54: { name: 'rpm', scale: 0.01 },
  71: { name: 'fuel_used_l', scale: 0.01 },
  73: { name: 'engine_hours', scale: 0.01 },
  74: { name: 'vin', string: true },
};
