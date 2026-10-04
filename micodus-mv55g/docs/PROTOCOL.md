# Wire protocol as implemented

## 0. Which protocol does the MV55G speak?

**JT/T 808** (the Chinese national telematics standard; Traccar calls it `huabao`/`jt808`, port 5015).
Three independent sources agree, two of them about this exact model:

- A Traccar forum thread by an **MV55G-AU** owner: the unit came online on Traccar's huabao
  port, identifying itself with `0` + its 11-digit MiCODUS ID (not the IMEI).
- flespi's MiCODUS protocol page: "MV710, MV720, MV730, MV740, MV760, MV730G, MV790G, MV33,
  MV33G use TQ protocol; other models including **MV55G**, MV710G, MV810G use JT808."
- A community Node.js decoder written from a live MV55G capture: JT808 framing, 0x0200
  location reports with MiCODUS additional items 0x80–0x8E (CAN speed, RPM, voltage, …).

Traccar's `Jt808ProtocolDecoder` contains explicit `MV710G` / `MV810G` handling, and a merged
Traccar pull request added MiCODUS "G" model support from real frames.

The older MiCODUS models (MV720, MV730 …) use the GT06/Concox or "TQ"/HQ text families, so the
platform keeps a GT06 implementation as well and detects the protocol per connection from the
first byte (`0x7E` → JT808, `0x78`/`0x79` → GT06). Sections marked **verify** must be confirmed
against a capture from our own MV55G-AU; the server logs every byte so that is easy.

## 1. JT808 frame

```
7E | msgId(2) | props(2) | [version(1)] | terminalId(6 BCD) | serial(2) | [pkgTotal(2) pkgIndex(2)] | body | xor(1) | 7E
```

- `props` bits 0–9 = body length, bits 10–12 = encryption (0), bit 13 = sub-packaged (adds the
  two package words), bit 14 = 2019 edition (adds the version byte and makes the terminal ID
  10 bytes / 20 digits).
- `terminalId`: BCD "phone number". **MV55G: 12 digits = `0` + the 11-digit ID on the sticker.**
  The IMEI is not in the header. Platforms key the device on this ID (stripped of leading zeros
  or not; this server shows both).
- `serial`: per-direction message counter.
- `xor`: XOR of every byte from `msgId` through the end of `body`, computed before escaping.
- Escaping (applied to everything between the delimiters): `7E → 7D 02`, `7D → 7D 01`.
- Transport: plain TCP, no TLS.

Hand-checked example (heartbeat, id 019172682984, serial 3):

```
7E 00 02 00 00 01 91 72 68 29 84 00 03 26 7E
   └msgId┘└props┘└── terminal id ──┘└ser┘ xor
```

## 2. Terminal → platform messages

| ID | Name | Body | Platform reply |
| --- | --- | --- | --- |
| `0x0100` | register | province(2) city(2) manufacturer(5) model(20) terminalId(7) plateColor(1) plate(GBK) — 2019: 11/30/30 | `0x8100` |
| `0x0102` | authenticate | auth code (ASCII, the one we returned in 0x8100) | `0x8001` |
| `0x0002` | heartbeat | empty (some vendors: battery, RSSI, status bytes) | `0x8001` |
| `0x0200` | location report | 28-byte basic block + additional items (§3) | `0x8001` |
| `0x0201` | position query response | replySerial(2) + location body | none |
| `0x0202` / `0x0203` | MiCODUS trip start / stop **verify** | location body | `0x8001` |
| `0x0704` | batch upload (blind-zone / buffered points) | count(2) type(1) then [len(2) location body]… | `0x8001` |
| `0x0001` | terminal general response | replySerial(2) replyMsgId(2) result(1) | none |
| `0x0104` | parameter query response | replySerial(2) count(1) [id(4) len(1) value]… | `0x8001` |
| `0x0107` | terminal attributes | type(2) manufacturer(5) model(20) id(7) ICCID(10 BCD) hw/fw versions | `0x8001` |
| `0x0109` | time sync request | empty | `0x8109` BCD time |
| `0x0900` | transparent data | type(1) + data | `0x8001` |
| `0x6006` | text report (reply to an 0x8300 command) **verify** | encoding(1) + text | `0x8001` |
| `0x1300` | text response (UTF-16BE variant) **verify** | replySerial(2) + text | none |

Unknown IDs are acknowledged with `0x8001` (result 0) and shown as `unknown` with their body
hex so the device keeps talking while we learn its dialect.

## 3. Location body

```
alarm(4)  status(4)  lat(4)  lon(4)  altitude(2, signed m)  speed(2, 0.1 km/h)  course(2)  time(BCD YYMMDDhhmmss)
[ id(1) len(1) value ]...   additional information items
```

- lat / lon = value × 1e-6 degrees; status bit 2 = south, bit 3 = west.
- status bits: 0 ACC on, 1 positioned, 4 stopped, 10 fuel cut, 11 power relay cut, 12–17 doors,
  18–21 GNSS systems in use, 26 charging (vendor).
- alarm bits: 0 SOS, 1 overspeed, 2 fatigue, 7 main power undervoltage, **8 main power cut
  (unplugged)**, 13 overspeed warning, 19 overtime parking (idle), 20 geofence in/out,
  **28 illegal displacement (tow / moved)**, 29 collision, 30 rollover.
- time: the device writes its *local* time as configured by the `GMT` SMS command. The server
  option `JT808_TZ_HOURS` (default 0 = UTC) removes that offset; the raw `timeBcd` is kept.
  **verify** the default on the MV55G-AU (JT808 standard says UTC+8; export firmware usually 0).

### Additional items

Standard items: `0x01` mileage (u32, 0.1 km), `0x02` fuel (u16, 0.1 L or percent when bit 15
set), `0x03` recorded speed, `0x04` alarm event id, `0x25` extended signals, `0x2A` IO,
`0x2B` ADC, `0x30` RSSI, `0x31` satellites.

MiCODUS items (MV55G capture + Traccar MV710G/MV810G code):

| ID | Meaning | Encoding |
| --- | --- | --- |
| `0x32` `0x33` `0x34` | GPS / BeiDou / GLONASS satellites | u8 |
| `0x57` | harsh-driving extension | u16 bits 8/9/10 = harsh acceleration / braking / cornering, u16 switches, u32 (bit 16 door on MV710G/MV810G) |
| `0x80` | CAN vehicle speed **or** nested OBD container (Traccar: content byte + sub-items) | u8/u16, or TLVs |
| `0x81` | engine RPM | u16 |
| `0x82` | external / OBD rail voltage — sent with every fix on the MV55G | u16 × 0.1 V |
| `0x83` | engine load | u8 % |
| `0x84` | coolant temperature | u8 − 40 °C |
| `0x85` | fuel rate | u16 (× 0.1 L/h per capture) **verify scale** |
| `0x86` | intake air temperature | u8 − 40 °C |
| `0x87` | mass air flow | u16 × 0.01 g/s |
| `0x88` | intake manifold pressure | u8 kPa |
| `0x89` | throttle | u8 % |
| `0x8B` / `0x94` | VIN | 17 ASCII |
| `0x8C` | CAN total odometer | u32 × 0.1 km |
| `0x8D` | trip odometer | u16 km |
| `0x8E` | fuel level | u8 % |
| `0x91` | packed OBD block (voltage, RPM, speed, throttle, load, coolant, fuel rate, fuel used) | fixed layout |
| `0xA0` | DTC list | ASCII `P0301,P0420` |
| `0xCC` | ICCID | 20 ASCII |
| `0xE1` | backup battery % (0xFF = charging) or power 0.1 V when 2 bytes | u8 / u16 |

The decoder accepts both the flat layout (items at top level, as in the MV55G capture) and the
nested `0x80` container layout (Traccar). Every item is listed with its raw hex in the dashboard
and in `data/raw.jsonl`, so a wrong scale is easy to spot and fix in `src/jt808/decode.js`.

## 4. Platform → terminal messages

| ID | Purpose | Body |
| --- | --- | --- |
| `0x8001` | general response | replySerial(2) replyMsgId(2) result(1: 0 ok, 1 fail, 2 bad message, 3 unsupported) |
| `0x8100` | register response | replySerial(2) result(1) authCode (we send the device's own ID, like Traccar) |
| `0x8300` | text message = **online command** | flag(1) + text. MiCODUS accepts its SMS command strings here (`STATUS#`, `TIMER,30#`, …) **verify flag value** |
| `0x8201` | position query | empty → `0x0201` |
| `0x8104` | query all parameters | empty → `0x0104` |
| `0x8103` | set parameters | count(1) [id(4) len(1) value]… e.g. `0x0013` server, `0x0018` TCP port, `0x0029` interval |
| `0x8105` | terminal control | command(1): 4 reset, 5 factory reset, 2 connect to server |
| `0x8109` | time sync response | BCD time |
| `0x8500` | vehicle control (relay) | **never used by this platform** |

From the Commands tab, plain text goes out as `0x8300`; `!query`, `!params`, `!reset`,
`!factory` and `!text,<flag>,<text>` map to the binary messages above.

## 5. Session flow (what the dashboard should show)

1. TCP connect → `0x0100 register` → we answer `0x8100` success + auth code.
2. `0x0102 auth` with that code → `0x8001`.
3. `0x0002 heartbeat` every 1–5 min → `0x8001`.
4. `0x0200 location` on the timer / on events (alarm bits set) → `0x8001`.
5. After a dead zone: `0x0704 batch` with the buffered points (type 1).
6. Our `0x8300` command → device `0x0001` (accepted) and a text reply (`0x6006` **verify**).

A device that was already registered keeps its auth code across reconnects and may start with
`0x0102` or even `0x0002`; the server binds the session on the first frame, whatever it is.

## 6. GT06 / Concox (kept for the MV7xx family)

```
78 78 | len(1) | proto(1) | content | serial(2) | CRC-16/X-25(2) | 0D 0A      (79 79 + len(2) for extended)
```

Login `0x01` (IMEI BCD), location `0x12/0x22/0xA0`, heartbeat `0x13/0x23`, alarm `0x16/0x26`,
time `0x8A`, info `0x94`, OBD `0x8C`, online command `0x80` → reply `0x15/0x21`. The server
acknowledges with an empty frame of the same number and serial. Full tables are in
`server/src/gt06/constants.js`; the implementation is verified against the published GT06
login example (`78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A`).

## 7. Decoding by hand

```bash
node src/cli-decode.js "7E 00 02 00 00 01 91 72 68 29 84 00 03 26 7E"
curl -s -X POST localhost:8080/api/decode -d '{"hex":"7E 02 00 00 ..."}'
curl -s -X POST localhost:8080/api/encode -d '{"protocol":"jt808","id":"019172682984","command":"STATUS#"}'
```

## 8. Open questions for the real MV55G-AU (fill in from captures)

- Exact register body (manufacturer / model / terminal-id text; does the IMEI appear?).
- Heartbeat interval and whether the heartbeat carries battery / RSSI bytes.
- Item layout: flat `0x80…0x8E` or nested `0x80` container; scale of `0x85`.
- Which alarm bits fire for unplug, tow, harsh driving (`0x57`), overspeed, idle.
- Timestamp offset (`JT808_TZ_HOURS`).
- Reply message to `0x8300` commands (`0x6006`, `0x0900`, or something else) and the flag byte
  the firmware expects; whether the device requires the password inside command text.
- 2013 vs 2019 framing (version bit) — the server supports both.
