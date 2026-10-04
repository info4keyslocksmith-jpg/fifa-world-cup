# Wire protocol as implemented (GT06 / Concox family)

This is the protocol the test platform speaks. It is the de-facto standard of the Chinese
tracker ecosystem (Concox GT06 → Jimi, MiCODUS, Sinotrack, Wanway, …) and the one Traccar
uses for MiCODUS devices (`gt06`, port 5023). Sections marked **verify** must be confirmed
against a capture from our MV55G-AU; the server logs every byte so that is easy.

## 1. Frame

```
Basic     78 78 | LEN(1) | PROTO(1) | CONTENT(LEN-5) | SERIAL(2) | CRC(2) | 0D 0A
Extended  79 79 | LEN(2) | PROTO(1) | CONTENT(LEN-5) | SERIAL(2) | CRC(2) | 0D 0A
```

- `LEN` = 1 (proto) + N (content) + 2 (serial) + 2 (crc). Extended frames are used when the
  content is long or by newer packet types (0x94 info, 0x21 command reply).
- `SERIAL` increments per device packet. A server acknowledgement echoes the same serial.
- `CRC` = **CRC-16/X-25** (poly 0x1021 reflected, init 0xFFFF, final XOR 0xFFFF) over
  `LEN … SERIAL` inclusive. Check value for the ASCII string `123456789` is `0x906E`.
- Transport is plain TCP, no TLS. All integers big-endian.

Worked example (from the public GT06 document, reproduced by `buildLogin('123456789012345', 1)`):

```
78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A
      │  │  └──────── terminal ID = 0123456789012345 ──┘ │     │
      │  └ proto 0x01 login                      serial 1 ┘  CRC ┘
      └ LEN 13 = 1 + 8 + 2 + 2
server reply:  78 78 05 01 00 01 D9 DC 0D 0A
```

## 2. Packets the device sends

| Proto | Name | Content | Server reply |
| --- | --- | --- | --- |
| `0x01` | login | terminal ID (8 bytes, IMEI as BCD with a leading 0) [+ type code (2)] [+ timezone/language (2)] | ACK |
| `0x12` | GPS + LBS | GPS block (18) + LBS (MCC 2, MNC 1/2, LAC 2, CID 3) | ACK |
| `0x22` | GPS + LBS (newer) | as 0x12 + ACC (1) + upload mode (1) + real-time re-upload (1) + mileage metres (4) | ACK |
| `0xA0` | GPS + 4G LBS | as 0x22 but LBS = MCC 2, MNC 1/2, LAC **4**, Cell ID **8** | ACK |
| `0x13` | heartbeat / status | terminal info (1) + voltage level (1) + GSM level (1) + alarm (1) + language (1) | ACK |
| `0x23` | heartbeat (newer) | terminal info (1) + voltage centivolts (2) + GSM (1) + alarm (1) + language (1) | ACK |
| `0x16` `0x26` `0x27` | alarm | GPS block (18) + LBS length (1) + LBS + terminal info + voltage + GSM + alarm + language | ACK |
| `0x19` | LBS + status | LBS + status (no GPS) | ACK |
| `0x8A` | time request | empty | `0x8A` with UTC `YY MM DD hh mm ss` |
| `0x15` | reply to online command | cmd length (1) + server flag (4) + ASCII text + language (2) | none |
| `0x21` (ext) | reply to online command | server flag (4) + encoding (1: 1 ASCII, 2 UTF-16BE) + text | none |
| `0x94` (ext) | info | sub-type (1) + payload, see §4 | none (optional) |
| `0x8C` | OBD data **verify** | date/time (6) + ASCII `key=value,key=value` | ACK |
| `0x65` `0x66` | OBD DTC / PID **verify** | unknown layout; logged raw | ACK |

Unknown protocol numbers are acknowledged (same proto, same serial) and shown as `unknown`
with their content hex. This keeps the device online while we learn its dialect.

### GPS block (18 bytes)

```
YY MM DD hh mm ss      UTC date/time (year 2000+)
L/S                    high nibble = block length (0x0C = 12), low nibble = satellites in use
LAT(4)  LON(4)         value / 30000 = minutes  →  / 60 = degrees
SPEED(1)               km/h
COURSE/STATUS(2)       bit13 differential · bit12 GPS positioned · bit11 West (else East)
                       bit10 North (else South) · bits 9..0 course 0-359°
```

### Terminal information byte (heartbeat / alarm)

```
bit7 relay cut (oil & electricity disconnected)   bit6 GPS tracking on
bits5-3 alarm: 100 SOS · 011 low battery · 010 power cut · 001 shock · 000 normal
bit2 charging   bit1 ACC / ignition high   bit0 armed (defence)
```

Voltage level byte: 0 no power … 6 very high. GSM level byte: 0 none … 4 strong.
Language byte: 0x01 Chinese, 0x02 English.

### Alarm byte (heartbeat and alarm packets)

`0x00` normal · `0x01` SOS · `0x02` power cut (unplugged) · `0x03` vibration · `0x04` fence in ·
`0x05` fence out · `0x06` overspeed · `0x09` displacement · `0x0E` low external power ·
`0x13` tamper · `0x29` harsh acceleration · `0x30` harsh braking · `0xFE` ACC on · `0xFF` ACC off.
The full table is in `server/src/gt06/constants.js`; codes not in the table are shown as
`alarm_0xNN`. **verify** which codes the MV55G actually emits (harsh driving and unplug are the
interesting ones for an OBD tracker).

## 3. Packets the server sends

| Proto | Purpose | Content |
| --- | --- | --- |
| same as received | acknowledgement | empty; serial copied from the device packet |
| `0x8A` | time response | `YY MM DD hh mm ss` UTC |
| `0x80` | online command | cmd length (1 = 4 + M) + server flag (4) + command (M ASCII) + language (2, `00 02` English) |

Online commands use the same text as SMS commands (e.g. `STATUS#`, `PARAM#`, `VERSION#`,
`WHERE#`, `TIMER,10,300#`, `RESET#`). The device answers with `0x15` or `0x21`. The platform
matches the answer to the last command sent to that IMEI. **verify** whether MV55G firmware
needs the password inside online commands and whether it includes the language word.

## 4. Info packet `0x94` sub-types

| Sub | Meaning | Payload |
| --- | --- | --- |
| `0x00` | external power voltage | u16 / 100 V |
| `0x04` | terminal status sync | ASCII `KEY=VAL;KEY=VAL…` |
| `0x05` | door status | 1 byte |
| `0x0A` | identifiers | IMEI (8) + IMSI (8) + ICCID (10), BCD |
| others | logged with raw hex | |

## 5. Session behaviour

1. TCP connect → `0x01` login → ACK. Without the ACK most firmware re-sends login and reconnects.
2. Optional `0x8A` time request → time response.
3. Heartbeat every 1–5 minutes (`0x13`/`0x23`), location on the configured timer or on events
   (`0x22`/`0xA0`), alarms as they happen (`0x16`…).
4. Server may send `0x80` at any time; it is sent as soon as the device logs in if queued earlier.
5. The device reconnects on its own after network loss; buffered points are re-uploaded with
   upload mode `network_reconnect_reupload`.

## 6. Decoding by hand

```bash
node src/cli-decode.js "78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A"
curl -s -X POST localhost:8080/api/decode -d '{"hex":"78 78 0A 13 46 06 03 00 02 00 0C 61 56 0D 0A"}'
```

## 7. Open questions for the real MV55G-AU (fill in from captures)

- Which location proto it uses (`0x22` vs `0xA0`) and whether MNC is 1 or 2 bytes on the AU SIM.
- Whether heartbeat is `0x13` or `0x23` (2-byte voltage).
- Which packet carries OBD-II data (VIN, RPM, speed, coolant, fuel, DTCs, odometer): `0x8C`
  ASCII pairs, `0x94` sub-types, or a vendor-specific number. Capture one with the engine
  running and paste it into the decoder.
- Alarm codes for unplug, harsh driving, overspeed, tow/vibration, idle.
- Whether the device accepts online commands without password and which ones.
