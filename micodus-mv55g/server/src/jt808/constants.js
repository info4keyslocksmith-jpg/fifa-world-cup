/**
 * JT/T 808 constants (2013 base with 2019 version-flag support), plus the
 * MiCODUS vendor additions seen on the MV55G / MV710G / MV810G.
 *
 * Sources: JT/T 808-2013 / 2019 specification, Traccar Jt808ProtocolDecoder
 * (which carries explicit MV710G/MV810G handling) and a community decoder
 * written from a live MV55G capture.
 */

export const MSG_NAMES = {
  // terminal -> platform
  0x0001: 'terminal_general_response',
  0x0002: 'heartbeat',
  0x0003: 'logout',
  0x0100: 'register',
  0x0102: 'auth',
  0x0104: 'param_query_response',
  0x0107: 'attributes',
  0x0108: 'upgrade_result',
  0x0109: 'time_sync_request',
  0x0200: 'location',
  0x0201: 'location_query_response',
  0x0202: 'location_trip_start', // MiCODUS vendor use of 0x0202/0x0203 (same body as 0x0200)
  0x0203: 'location_trip_stop',
  0x0301: 'event_report',
  0x0302: 'question_answer',
  0x0303: 'info_demand',
  0x0500: 'vehicle_control_response',
  0x0700: 'recorder_data',
  0x0701: 'command_response',
  0x0702: 'driver_identity',
  0x0704: 'location_batch',
  0x0705: 'can_data',
  0x0800: 'multimedia_event',
  0x0801: 'multimedia_upload',
  0x0900: 'transparent',
  0x0901: 'compressed',
  0x1300: 'text_response',
  0x6006: 'text_report',
  // platform -> terminal
  0x8001: 'platform_general_response',
  0x8003: 'resend_request',
  0x8100: 'register_response',
  0x8103: 'set_parameters',
  0x8104: 'query_parameters',
  0x8105: 'terminal_control',
  0x8106: 'query_specific_parameters',
  0x8107: 'query_attributes',
  0x8108: 'upgrade_package',
  0x8109: 'time_sync_response',
  0x8201: 'location_query',
  0x8202: 'temporary_tracking',
  0x8203: 'alarm_ack',
  0x8300: 'text_message',
  0x8500: 'vehicle_control',
  0x8600: 'set_circular_area',
  0x8602: 'set_rectangular_area',
  0x8604: 'set_polygon_area',
  0x8801: 'take_photo',
  0x8900: 'transparent_downlink',
};

/** Location report alarm flag (u32) bits — JT/T 808 standard table. */
export const ALARM_BITS = {
  0: 'sos',
  1: 'overspeed',
  2: 'fatigue_driving',
  3: 'danger_warning',
  4: 'gnss_fault',
  5: 'gnss_antenna_open',
  6: 'gnss_antenna_short',
  7: 'main_power_undervoltage',
  8: 'main_power_cut', // unplugged from OBD / power removed
  9: 'lcd_fault',
  10: 'tts_fault',
  11: 'camera_fault',
  12: 'ic_card_fault',
  13: 'overspeed_warning',
  14: 'fatigue_warning',
  18: 'driving_overtime',
  19: 'overtime_parking', // idle too long
  20: 'area_in_out', // geofence
  21: 'route_in_out',
  22: 'route_time_abnormal',
  23: 'route_deviation',
  24: 'vss_fault',
  25: 'fuel_abnormal',
  26: 'vehicle_stolen',
  27: 'illegal_ignition',
  28: 'illegal_displacement', // moved / towed
  29: 'collision',
  30: 'rollover',
  31: 'illegal_door_open',
};

/** Location report status (u32) bits. */
export const STATUS_BITS = {
  0: 'acc_on',
  1: 'positioned',
  2: 'south',
  3: 'west',
  4: 'stopped',
  5: 'coordinates_encrypted',
  8: 'load_half',
  9: 'load_full',
  10: 'fuel_cut',
  11: 'power_relay_cut',
  12: 'doors_locked',
  13: 'door1_open',
  14: 'door2_open',
  15: 'door3_open',
  16: 'door4_open',
  17: 'door5_open',
  18: 'gps_used',
  19: 'beidou_used',
  20: 'glonass_used',
  21: 'galileo_used',
  22: 'driving',
  26: 'charging', // Traccar reads bit 26 as "charge" on these vendors
};

/** Additional-information item IDs (location report TLVs). */
export const ITEM_NAMES = {
  0x01: 'mileage', // u32, 0.1 km
  0x02: 'fuel', // u16, 0.1 L (bit15 set: percent)
  0x03: 'recorded_speed', // u16, 0.1 km/h
  0x04: 'alarm_event_id', // u16
  0x06: 'battery_level',
  0x11: 'overspeed_alarm_info',
  0x12: 'area_alarm_info',
  0x13: 'route_time_alarm_info',
  0x25: 'extended_vehicle_signal',
  0x2a: 'io_status',
  0x2b: 'analog_inputs',
  0x30: 'rssi',
  0x31: 'satellites',
  0x32: 'gps_satellites', // MiCODUS
  0x33: 'beidou_satellites', // MiCODUS
  0x34: 'glonass_satellites', // MiCODUS
  0x56: 'battery_level_x10',
  0x57: 'micodus_alarm_extension', // u16 harsh-driving bits + u16 switches + u32 (bit16 door on MV710G/MV810G)
  0x61: 'power_voltage_x100',
  0x68: 'battery_level_x100',
  0x69: 'battery_voltage_x100',
  0x80: 'obd_speed_or_obd_container', // MiCODUS: CAN speed (u8/u16) or nested OBD TLV container
  0x81: 'obd_rpm',
  0x82: 'external_voltage', // u16, 0.1 V — MV55G sends it with every fix
  0x83: 'obd_engine_load',
  0x84: 'obd_coolant_temp', // u8 - 40
  0x85: 'obd_fuel_rate', // u16 (0.1 L/h per MV55G capture)
  0x86: 'obd_intake_temp', // u8 - 40
  0x87: 'obd_maf', // u16, 0.01 g/s
  0x88: 'obd_intake_pressure', // u8 kPa
  0x89: 'obd_throttle', // u8 %
  0x8b: 'obd_vin',
  0x8c: 'obd_odometer', // u32, 0.1 km
  0x8d: 'obd_trip_odometer', // u16 km
  0x8e: 'obd_fuel_level', // u8 %
  0x91: 'obd_block',
  0x94: 'vin',
  0xa0: 'obd_dtc_list', // ASCII, comma separated
  0xac: 'odometer_m',
  0xcc: 'iccid',
  0xd3: 'power_voltage_x10',
  0xe1: 'backup_battery_or_power', // len 1: battery % (0xFF charging); len 2: power 0.1 V
  0xe3: 'vendor_e3',
  0xe4: 'vendor_e4',
  0xe5: 'vendor_e5',
  0xe6: 'vendor_e6',
  0xf3: 'obd_data_f3',
};

export const RESULT_CODES = { 0: 'success', 1: 'failure', 2: 'message_error', 3: 'not_supported', 4: 'alarm_ack' };

export const REGISTER_RESULTS = {
  0: 'success',
  1: 'vehicle_already_registered',
  2: 'vehicle_not_in_database',
  3: 'terminal_already_registered',
  4: 'terminal_not_in_database',
};

/** Terminal control (0x8105) command byte. */
export const TERMINAL_CONTROL = {
  1: 'wireless_upgrade',
  2: 'connect_to_server',
  3: 'shutdown',
  4: 'reset',
  5: 'factory_reset',
  6: 'close_data',
  7: 'close_all_wireless',
};

/** Terminal parameter IDs (0x8103 / 0x0104). */
export const PARAM_IDS = {
  0x0001: 'heartbeat_interval_s',
  0x0002: 'tcp_response_timeout_s',
  0x0003: 'tcp_retries',
  0x0010: 'apn',
  0x0011: 'apn_user',
  0x0012: 'apn_password',
  0x0013: 'main_server',
  0x0014: 'backup_apn',
  0x0017: 'backup_server',
  0x0018: 'tcp_port',
  0x0019: 'udp_port',
  0x0020: 'report_strategy',
  0x0021: 'report_scheme',
  0x0022: 'report_interval_driver_logged_out_s',
  0x0027: 'report_interval_sleep_s',
  0x0028: 'report_interval_emergency_s',
  0x0029: 'report_interval_default_s',
  0x002c: 'report_distance_default_m',
  0x002d: 'report_distance_driver_logged_out_m',
  0x002e: 'report_distance_sleep_m',
  0x002f: 'report_distance_emergency_m',
  0x0030: 'inflection_angle_deg',
  0x0031: 'geofence_radius_m',
  0x0040: 'platform_phone',
  0x0045: 'answer_strategy',
  0x0050: 'alarm_mask',
  0x0055: 'max_speed_kmh',
  0x0056: 'overspeed_duration_s',
  0x0057: 'continuous_driving_limit_s',
  0x0080: 'odometer_0_1km',
  0x0081: 'province_id',
  0x0082: 'city_id',
  0x0083: 'plate',
  0x0084: 'plate_color',
  0xf030: 'at_command_passthrough', // Aovx; kept for completeness
};
