/**
 * Protocol abstraction used by the TCP server and the hex tool.
 *
 * The MV55G family speaks JT/T 808 (0x7E-delimited). Older MiCODUS models and
 * most Chinese trackers speak GT06/Concox (0x78 0x78). Both are supported and
 * the protocol is detected per connection from the first byte the device sends.
 *
 * Each protocol object exposes:
 *   createParser()                 -> incremental frame splitter with .feed(chunk) / .garbage
 *   decode(frame, opts)            -> normalized object (kind, gps, status, obd, ...)
 *   identify(decoded)              -> device id string when the frame identifies the device, else null
 *   replies(frame, decoded, session)-> [{ buf, meta }] to send back
 *   command(session, text, opts)   -> { buf, meta } for an online command string
 */
import * as GF from './gt06/frame.js';
import * as GE from './gt06/encode.js';
import { decodeFrame as gt06Decode } from './gt06/decode.js';
import * as JF from './jt808/frame.js';
import * as JE from './jt808/encode.js';
import { decodeFrame as jt808Decode } from './jt808/decode.js';

const GT06_NO_ACK = new Set([0x15, 0x21, 0x80, 0x81, 0x82]);

export const gt06 = {
  name: 'gt06',
  createParser: () => new GF.FrameParser(),
  decode: (frame) => ({ protocol: 'gt06', ...gt06Decode(frame) }),
  identify: (d) => (d.kind === 'login' && d.imei ? d.imei : null),
  replies(frame, d, session) {
    if (frame.type === 0x8a) return [{ buf: GE.buildTimeResponse(frame.serial), meta: { type: d.typeHex, name: 'time_response', serial: frame.serial } }];
    if (GT06_NO_ACK.has(frame.type)) return [];
    if (frame.ext && !session.options.ackExtended) return [];
    return [{ buf: GE.buildAck(frame.type, frame.serial), meta: { type: d.typeHex, name: 'ack', serial: frame.serial } }];
  },
  command(session, text, options = {}) {
    const serial = session.txSerial++ & 0xffff;
    return { buf: GE.buildCommand(text, serial, { ...session.options.commandOptions, ...options }), meta: { type: '0x80', name: 'server_command', serial, text } };
  },
};

const JT808_NO_ACK = new Set([0x0001, 0x0201, 0x1300]);

export const jt808 = {
  name: 'jt808',
  createParser: () => new JF.FrameParser(),
  decode: (frame, opts = {}) => jt808Decode(frame, { tzHours: opts.tzHours ?? 0 }),
  identify: (d) => d.terminalId || null,
  replies(frame, d, session) {
    const id = frame.terminalId;
    const fo = { version: frame.version };
    const serial = () => session.txSerial++ & 0xffff;
    if (frame.msgId === 0x0100) {
      // registration: answer with success and the device id as authentication code
      return [{ buf: JE.buildRegisterResponse(id, serial(), frame.serial, 0, frame.terminalId, fo), meta: { type: '0x8100', name: 'register_response', serial: frame.serial, authCode: frame.terminalId } }];
    }
    if (frame.msgId === 0x0109) {
      return [{ buf: JE.buildTimeSyncResponse(id, serial(), new Date(), fo), meta: { type: '0x8109', name: 'time_sync_response', serial: frame.serial } }];
    }
    if (frame.msgId >= 0x8000 || JT808_NO_ACK.has(frame.msgId)) return [];
    return [{ buf: JE.buildGeneralResponse(id, serial(), frame.serial, frame.msgId, 0, fo), meta: { type: '0x8001', name: 'ack', serial: frame.serial, replyTo: d.typeHex } }];
  },
  /**
   * Plain text -> 0x8300 text message carrying the MiCODUS command string.
   * Special forms: "!query" (0x8201 position query), "!params" (0x8104), "!reset" (0x8105/4),
   * "!factory" (0x8105/5), "!text,<flag>,<text>" to choose the 0x8300 flag byte.
   */
  command(session, text, options = {}) {
    const id = session.deviceId;
    const fo = { version: session.version ?? null, ...options };
    const serial = session.txSerial++ & 0xffff;
    const t = String(text).trim();
    if (t === '!query') return { buf: JE.buildLocationQuery(id, serial, fo), meta: { type: '0x8201', name: 'location_query', serial, text: t } };
    if (t === '!params') return { buf: JE.buildQueryParameters(id, serial, fo), meta: { type: '0x8104', name: 'query_parameters', serial, text: t } };
    if (t === '!reset') return { buf: JE.buildTerminalControl(id, serial, 4, '', fo), meta: { type: '0x8105', name: 'terminal_control_reset', serial, text: t } };
    if (t === '!factory') return { buf: JE.buildTerminalControl(id, serial, 5, '', fo), meta: { type: '0x8105', name: 'terminal_control_factory_reset', serial, text: t } };
    const m = t.match(/^!text,(0x[0-9a-f]+|\d+),(.*)$/i);
    if (m) return { buf: JE.buildTextMessage(id, serial, m[2], { flag: Number(m[1]), ...fo }), meta: { type: '0x8300', name: 'server_command', serial, text: m[2], flag: Number(m[1]) } };
    const flag = session.options.jt808TextFlag ?? 0x01;
    return { buf: JE.buildTextMessage(id, serial, t, { flag, ...fo }), meta: { type: '0x8300', name: 'server_command', serial, text: t, flag } };
  },
};

export const PROTOCOLS = { gt06, jt808 };

/** Pick the protocol from the first byte a device sends. */
export function detect(firstByte) {
  if (firstByte === 0x7e) return jt808;
  if (firstByte === 0x78 || firstByte === 0x79) return gt06;
  return null;
}

/**
 * Decode an arbitrary capture (hex pasted by a user): frames of both protocols,
 * in any order. Returns decoded frames plus garbage statistics.
 */
export function decodeBuffer(buf, opts = {}) {
  const frames = [];
  let garbage = 0;
  let i = 0;
  while (i < buf.length) {
    const proto = detect(buf[i]);
    if (!proto) {
      garbage++;
      i++;
      continue;
    }
    // feed from i to the end into a fresh parser; stop at the first frame and continue after it
    const parser = proto.createParser();
    const got = parser.feed(buf.subarray(i));
    if (!got.length) {
      garbage++;
      i++;
      continue;
    }
    const first = got[0];
    frames.push(proto.decode(first, opts));
    // advance past the first frame: find its raw bytes position
    const idx = buf.indexOf(first.raw, i);
    i = idx >= 0 ? idx + first.raw.length : i + 1;
  }
  return { bytes: buf.length, garbage, frames };
}

export function parseHex(text) {
  return GF.fromHex(text);
}
