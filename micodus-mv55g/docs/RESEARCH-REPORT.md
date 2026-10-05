# MiCODUS MV55G-AU — research report

*Prepared 2026-10-04 for building our own server/app for the MV55G-AU we own. Every claim is
tagged with its source and a confidence level. Confidence: **high** = primary source
(vendor manual, government advisory, vendor code) or several independent sources agree;
**medium** = one secondary source or a search-engine snippet of a primary source that could
not be opened from this environment; **low** = single community/blog source or inference
from a sibling model.*

## Executive summary

1. **What it is.** The MV55G is MiCODUS' 4G LTE plug-and-play OBD-II vehicle tracker: it draws
   power from the OBD port (9–50 V), has a 140 mAh backup battery, positions with GPS + BeiDou
   (+ cell-tower fallback) and reads vehicle data over the OBD-II/CAN bus (speed, RPM, coolant,
   voltage, fuel, mileage, DTCs, VIN). **high**
2. **How it talks.** Not the common GT06/Concox protocol of the older MV720/MV730, but
   **JT/T 808** (the Chinese national telematics standard; Traccar calls it `jt808`, formerly
   `huabao`, port 5015): `0x7E`-framed binary over plain TCP, no TLS. The device identifies
   itself with **`0` + its 11-digit MiCODUS ID**, not its IMEI. OBD values travel inside each
   location report as vendor "additional information" items. **high** (an MV55G-AU owner's raw
   frame, flespi's protocol map and a capture-based community decoder all agree; the frame
   decodes with the decoder built in this repository; the "MV55G uses JT808" claim survived
   3 of 3 adversarial verification votes).
3. **How to connect it to our own server.** Two SMS commands from the official manual:
   `APN,<apn>#` (or `APN,<apn>,<user>,<password>#`) and `SERVER,0,<ip>,<port>#` /
   `SERVER,1,<domain>,<port>#`. The factory endpoint is `d.micodus.net:7700`
   (`47.254.77.28:7700`). **high** (3 of 3 adversarial verification votes).
4. **What to watch out for.** (a) The **AU** variant's LTE bands are the open question for
   use in the USA — two conflicting band lists exist, see §1.3; check the sticker before
   buying a US SIM. (b) MiCODUS trackers had critical, publicly documented vulnerabilities in
   2022 (default password `123456`, unauthenticated SMS commands, hard-coded platform
   credential) — change the password first and keep our server firewalled. (c) The JT808
   channel has no authentication beyond the device ID, so our server must not trust positions
   from arbitrary internet hosts.
5. **What we can do with it** (for a mobile locksmith / service-van fleet): live van location
   and ETA sharing, automatic trip and mileage logs (tax records), unplug / tow / vibration
   alerts for theft, driver-behaviour events (harsh braking, speeding), vehicle health from
   the OBD side (battery voltage trend, coolant, DTC codes), geofences around job sites, and
   history playback — all from our own database once the device reports to our server.

## 1. Hardware and product

### 1.1 Specifications (official MV55G manual V1.0/V2.0 — **high**)

| Item | Value |
| --- | --- |
| Form factor | plug-and-play OBD-II dongle, 59 × 45 × 22 mm, 80 g |
| Power | DC 9–50 V from the OBD-II connector (12 V cars and 24 V trucks) |
| Backup battery | 3.7 V 140 mAh Li-Po, roughly 1–2 h of tracking after unplugging (powers the unplug alarm) |
| Cellular | 4G LTE with 3G and 2G fallback (band numbers: see §1.3) |
| Positioning | GPS + BeiDou + LBS (cell towers); −162 dBm tracking sensitivity, 64 channels, 5–10 m accuracy, cold start ≤ 32 s, hot start ≤ 1 s |
| SIM | Micro SIM (search snippet of the manual, **medium**) |
| Manuals | V2.0 `micodus.com/uploadfiles/files/08/08befc24f6-mv55g-user-guide-20.pdf`, V1.0 `…/22/22c3af0323-mv55g-user-guide.pdf`; mirrors: manualslib.com/manual/2592511, manuals.plus/micodus/mv55g-gps-tracker-manual, device.report/manual/8366975 |

The manual host and every mirror are blocked by this environment's egress proxy, so the
values above come from the search-engine index of the official PDF (five independent indexes
agree) and from the fetch agent's extraction of the manual text. LED blink patterns and the
SIM-tray procedure could not be read; Stage 1 of `TEST-PLAN.md` records them from the unit.

### 1.2 OBD-II data the vendor advertises (**medium** — retail/flespi pages via search)

Vehicle speed, engine RPM, coolant temperature, battery voltage, fuel consumption, mileage,
DTC (fault code) scan and automatic VIN detection, plus ACC/ignition detection and an unplug
alert. §3.4 maps these to the bytes on the wire.

### 1.3 Regional variants and LTE bands — the open question for US use

The manual text that was retrieved **does not enumerate band numbers**. Two different lists
surfaced in search snippets:

| Source (snippet) | LTE bands quoted | Other |
| --- | --- | --- |
| ManualsLib spec table / Made-in-China vendor sheet (generic MV55G) | LTE-FDD **B1/B3/B7/B8/B20/B28** | GSM B2/B3/B5/B8 |
| A search summary attributed to manual V2.0, "MV55G-AU" | LTE-FDD **B1/B2/B3/B4/B5/B7/B8/B28/B66**, LTE-TDD B40 | WCDMA B1/B2/B4/B5/B8, GSM B2/B3/B5/B8 |

Why it matters: US LTE runs on B2/B4/B5/B12/B13/B14/B17/B66/B71 (AT&T: B2/B4/B5/B12/B14/B17/B66;
T-Mobile: B2/B4/B5/B12/B66/B71; Verizon: B2/B4/B5/B13/B66), and US 2G/3G networks are shut
down, so the GSM/WCDMA bands do not help.

- If our unit has the first list: **no usable US LTE band** — it will not get data service in
  the USA at all. (Confidence that this list is the EU/APAC variant: **medium**.)
- If it has the second list: B2/B4/B5/B66 give service on all three US carriers, but without
  B12/B13/B71 the low-band coverage that carries rural and indoor service is missing — expect
  weaker coverage than a US-variant tracker. (**low–medium**; unverified snippet.)

**Action:** read the band list printed on the device/box or in the seller's listing, or ask
MiCODUS support with the device ID before buying a US SIM. The bench test in Stage 1 will show
GSM registration in `STATUS#` either way.

### 1.4 MV55 vs MV55G

No source about a non-"G" MV55 was found in this research; "MV55G" is the 4G model name used
by MiCODUS, flespi, Traccar users and retailers. The suffix letters after the model
(-AU, -EU, -LA, -A/B) denote the cellular band variant, not a different protocol.

## 2. SMS command set and configuration

The complete table with per-command sources is `docs/SMS-COMMANDS.md`. The facts below are
the ones that matter for the lab.

| Fact | Detail | Confidence |
| --- | --- | --- |
| Default password | `123456` | high (manual) |
| Set APN | `APN,ApnName,User,Password#` (e.g. `APN,orange,orange,orange#`) or `APN,ApnName#` (e.g. `APN,internet#`) | high (manual, 3/3 votes) |
| Repoint to a server | `SERVER,1,Domain,Port#` (domain) / `SERVER,0,IP,Port#` (IP); examples `SERVER,1,d.micodus.net,7700#`, `SERVER,0,47.254.77.28,7700#` | high (manual, 3/3 votes) |
| APN acknowledgement is not proof | the unit replies "SET APN OK" even to a wrong APN and then never comes online | medium (manuals.plus snippet) |
| SOS numbers, arm/disarm | `SOS,A,n1,n2,n3#`, `ARM#` / `DISARM#` | medium (manual snippet) |
| Reporting / alarm settings used with a real MV55G | `TIMER,30#`, `SPEED,80#`, `ACCALM,1#`, `PWRALM,1#`, `SENALM,1#`, queries `STATUS`, `MILEAGE`, `VERSION#` (returns the device ID) | medium (community project with a live unit; Traccar forum) |
| Family commands (MV720 manual) | `PARAM#`, `GMT,E/W,n#`, factory reset, status/version queries, alarm toggles; also the legacy Concox syntax `apn123456 …`, `admin123456 …`, `begin123456` | low–medium for the MV55G (sibling model) |
| App-side commands | the MiCODUS app sends the same management commands over the data channel, so the firmware accepts commands from the platform connection as well as by SMS | high (Google Play listing) |

No source showed that a password must be included inside the comma-syntax commands; Stage 6
of the test plan checks whether data-channel commands need it.

## 3. Wire protocol (the core finding)

### 3.1 Evidence that the MV55G speaks JT/T 808

| Source | What it shows | Confidence |
| --- | --- | --- |
| Traccar forum thread "Micodus mv55g-au" (exact variant we own) | The owner pointed the unit at Traccar's `huabao` port 5015 and got "Unknown device" with the frame `7e01020007019172682984015e470000000000003b7e`; Traccar extracted the identifier **019172682984**. "Unknown device" in Traccar means the frame parsed correctly but no device with that ID was registered. The thread also mentions port 5013 (Traccar's H02 port) as advice for "similar devices"; a sibling thread for the MiCODUS ML-100G was solved with `SERVER,1,<domain>,5015#` plus registering the ID with a leading `0`. | high for the protocol (the frame itself is unambiguous), medium for the port advice |
| flespi "Micodus protocol" page | "Micodus products use TQ and JT808 protocols. MV710, MV720, MV730, MV740, MV760, MV730G, MV790G, MV33, MV33G use TQ protocol; other models including **MV55G**, MV710G, MV810G use JT808." flespi's MV55G device page lists 137 parameters, 7 settings and 1 command (`{"message_id":"8105","message_body":"11"}` = JT808 terminal control, ARM) and says to register the device by its **ID with a leading zero, not the IMEI**. | high (secondary source with a dedicated MV55G profile; page blocked here, content from indexed snippets) |
| GitHub `neanimakhari/vehicle-income-tracker` (`gps-ingest/src/micodus/`) | A Node.js decoder written "from flespi Micodus + live MV55G capture": `0x7E` framing with `0x7D` escaping and XOR checksum, 12-byte header, messages 0x0002/0x0100/0x0102/0x0200/0x0201/0x0202/0x0203/0x0704, and the OBD item map in §3.4. The author confirms only item 0x82 (voltage, "live MV55G sends this every fix") on the physical unit; the rest came from flespi's profile. | high for framing, medium for the item scales |
| Traccar `Jt808ProtocolDecoder.java` (master, 2026) | Explicit `MV810G` / `MV710G` handling (status bit 16 = door; item 0x57 bit 16 = door alarm), register/response contract, OBD TLV decoders 0x80–0x8E/0x91/0x94/0xA0/0xCC. Traccar renamed `huabao` → `jt808` on 2026-04-24 (commit 16099380); ports: jt808 5015, gt06 5023. Traccar PR #5595 "Extend support for Micodus MV710G and MV810G devices" was built from real frames and a vendor protocol PDF shared on Google Drive. | high (vendor-independent reference implementation) |

**Our own check:** the forum frame decodes with the decoder in `server/src/jt808/`:
message `0x0102` authentication, terminal ID `019172682984`, serial 350, body
`47 00 00 00 00 00 00` (a 7-byte auth code), XOR checksum valid. The platform response our
server sends for it is `7E 80 01 00 05 01 91 72 68 29 84 00 01 01 5E 01 02 00 FE 7E`.
Two practical lessons from that frame: the device may open a session with *authentication*
rather than *registration* (it already held a code from the MiCODUS cloud), and the auth code
can be non-printable, so match devices on the header ID, never on the code.

### 3.2 Frame and header

```
7E | msgId(2) | props(2) | [version(1) if props bit14] | terminalId(6 BCD; 10 if 2019) | serial(2) | [pkgTotal(2) pkgIndex(2) if bit13] | body | xor(1) | 7E
escaping: 7E→7D 02, 7D→7D 01   checksum: XOR of msgId…body before escaping   transport: TCP, no TLS
```

Full byte-level documentation, including the 2013 vs 2019 edition differences, is in
`docs/PROTOCOL.md`.

### 3.3 Message flow and the platform's duties (**high** — Traccar contract + standard)

| Device sends | Platform must answer |
| --- | --- |
| `0x0100` register (province, city, manufacturer, model, terminal-id text, plate) | `0x8100`: reply serial, result 0, **auth code** (Traccar sends the device ID digits) |
| `0x0102` auth (the code) | `0x8001` general response (reply serial, reply msg id, result 0) |
| `0x0002` heartbeat | `0x8001` |
| `0x0200` location report (also 0x0202/0x0203 on MiCODUS) | `0x8001` |
| `0x0704` batch upload (buffered points after a dead zone) | `0x8001` |
| `0x0109` time sync request | `0x8109` with BCD time |
| `0x0001` terminal general response (to our commands) | nothing |

Platform → device: `0x8300` text (MiCODUS command strings), `0x8201` position query →
`0x0201`, `0x8104` parameter query → `0x0104`, `0x8103` set parameters (server 0x0013, port
0x0018, interval 0x0029 …), `0x8105` terminal control (reset 4, factory 5; flespi's MV55G
ARM command is `0x8105` body `0x11`), `0x8500` vehicle control (relay — never used by us).

### 3.4 Location body and the MiCODUS OBD items

Basic block (28 bytes): alarm flags (u32), status (u32: bit0 ACC, bit1 fix, bit2 south, bit3
west, bit10 fuel cut, bit11 power-relay cut, bit26 charging), latitude and longitude (u32 ×
1e-6), altitude (s16 m), speed (u16 × 0.1 km/h), course (u16), time (BCD `YYMMDDhhmmss`, in
the device's configured time zone). Alarm bits that matter for an OBD tracker: bit 8 main
power cut (unplugged), bit 1 overspeed, bit 28 illegal displacement (tow), bit 19 overtime
parking (idle), bit 20 geofence, bit 29 collision.

Additional items (`id(1) len(1) value`) observed/decoded for MiCODUS — **medium** unless noted:

| ID | Meaning | Encoding | Note |
| --- | --- | --- | --- |
| 0x01 | mileage | u32 × 0.1 km | standard |
| 0x30 / 0x31 | RSSI / satellites | u8 | standard |
| 0x32–0x34 | GPS / BeiDou / GLONASS satellites | u8 | MiCODUS |
| 0x57 | harsh-driving extension | u16 bits 8/9/10 accel/brake/corner, u16 switches, u32 (bit16 door on MV710G/MV810G) | Traccar, **high** for MV710G/MV810G |
| 0x80 | CAN vehicle speed (or a nested OBD container in Traccar's reading) | u8/u16 or TLVs | both layouts decoded |
| 0x81 | engine RPM | u16 | |
| 0x82 | external / OBD voltage | u16 × 0.1 V | **high** — confirmed on a live MV55G, sent with every fix |
| 0x83 / 0x84 | engine load % / coolant °C | u8 / u8 − 40 | |
| 0x85 | fuel rate | u16 (× 0.1 L/h per capture; Traccar keeps raw) | scale to confirm |
| 0x86 / 0x87 / 0x88 / 0x89 | intake temp / MAF / MAP / throttle | u8−40 / u16 × 0.01 / u8 / u8 | |
| 0x8B / 0x94 | VIN | 17 ASCII | |
| 0x8C / 0x8D / 0x8E | CAN odometer / trip / fuel level | u32 × 0.1 km / u16 km / u8 % | |
| 0x91 | packed OBD block | fixed layout (voltage, RPM, speed, throttle, load, coolant, fuel rate, fuel used) | Traccar |
| 0xA0 | DTC list | ASCII `P0301,P0420` | |
| 0xCC | ICCID | 20 ASCII | Traccar |
| 0xE1 | backup battery % (0xFF = charging) or power 0.1 V | u8 / u16 | |

What the sources do **not** settle (all handled adaptively by the decoder and listed in
`PROTOCOL.md` §8 to confirm from the first capture): flat vs nested 0x80 layout, the 0x85
scale, the time-zone of the BCD timestamp (JT808 standard is UTC+8; export firmware is
usually UTC; the `GMT` SMS command changes it), which message carries the text reply to an
`0x8300` command, and the 2013 vs 2019 edition.

### 3.5 The other MiCODUS protocol families (for completeness)

- **GT06/Concox** (`78 78` frames, CRC-16/X-25, login with IMEI, 0x12/0x22 location, 0x13
  heartbeat, 0x16 alarm, 0x80 command) — the protocol the original question assumed. Public
  parsers such as `vondraussen/gt06` implement only the basic set and no OBD extension. The
  test platform implements it fully (with 0x94 info and 0x8C OBD) for the MV7xx models and
  auto-detects it, but the MV55G does not use it. **high**
- **"TQ"** — flespi's name for the text protocol of the MV720/MV730 line (Traccar `h02`,
  port 5013). Not implemented; not needed for the MV55G. **medium**

## 4. Cloud platform, app and API

| Fact | Detail | Confidence |
| --- | --- | --- |
| Platform | `www.micodus.net`; "compatible with 500+ trackers and 50 protocols"; real-time tracking, history playback (data kept up to 6 months), geofences, alerts, reports; distributor and end-user accounts with sub-accounts | medium (vendor page via search) |
| Default device endpoint | `d.micodus.net:7700` / `47.254.77.28:7700` | high (manual) |
| App | "Micodus", Android package `com.fw.gps.edkj` (v2.0.68, 2026-04-07, 100K+ installs, 3.8★), iOS id1472722711; publisher Shenzhen Micodus Electronic Technology Co., Ltd; login by ID/IMEI + `123456` or by account; real-time tracking, playback, remote commands, alerts (SOS, low battery, overspeed, vibrate, tamper, geofence) | high (Google Play listing) |
| ID vs IMEI | the app/web accept the device ID or IMEI; the wire protocol uses the ID (`0` + 11 digits); MiCODUS publishes a guide `micodus.com/uploadfiles/files/63/637f3549cd-app-imei-id.pdf` | high |
| Custom server from the app | no in-app setting found; the documented path is the `SERVER` SMS command (flespi, GPS-Trace and Ruhavik all instruct users this way, e.g. `86505.flespi.gw` / `185.213.2.130` port 31208) | medium |
| Open API | the platform page claims "an Open API … for third-party developers" but no public documentation was found; the only documented API surface is the one BitSight attacked (§5). The `com.fw.gps` package prefix is a white-label tracker-platform framework used by many Chinese brands | medium |
| Fees | "lifetime free use or one-year free use of the platform" depending on the SKU; afterwards US$3 per device per year or US$7 lifetime pass bought from customer service | medium (micodus.shop via search) |
| Support | info@micodus.com, sales@micodus.com, WhatsApp/phone +86 135 3075 6787 | medium |

Implication: nothing in the MiCODUS cloud is needed once the device reports to our server;
our server is the API. If we ever want MiCODUS' cloud *and* ours, the device supports only
one server at a time (plus the standard JT808 backup-server parameter 0x0017, untested).

## 5. Security research and lab implications

### 5.1 The 2022 disclosure (**high** — CISA advisory ICSA-22-200-01, NVD, BitSight via press)

Affected product: **MiCODUS MV720**, firmware up to V1.9.1, and the shared MiCODUS web
platform/app. The MV55G is not named; applicability is inferred from the shared platform.

| CVE | Issue | CVSS v3 |
| --- | --- | --- |
| CVE-2022-2107 | hard-coded master password in the API server lets an attacker send SMS commands to any tracker as if from the owner's number | 9.8 |
| CVE-2022-2141 | broken authentication: SMS commands execute with admin rights without a password | 9.8 |
| CVE-2022-2199 | reflected XSS on the main web server | 7.5 |
| CVE-2022-34150 / CVE-2022-33944 | IDOR: device-ID endpoints/parameters accept arbitrary device IDs | 7.1 / 6.5 |
| CVE-2022-34151 | guessable sequential device IDs | — |

BitSight found ~95 % of about 1,000 sampled trackers still on the default password `123456`
and estimated ~1.5 million devices across ~420,000 customers; exploitation allowed live
location, route history, disarming alarms and **remote fuel cut-off**. At disclosure no fix
existed; CISA's advisory later recorded that MiCODUS updated the web platform and asked users
to update the Android app to V2.0.32+ and the iOS app to V2.1.1+ (**high**, CISA text).

### 5.2 What it means for our lab and app

- Change the password before the SIM goes live; otherwise anyone who learns the SIM number
  can reconfigure the unit by SMS.
- The JT808 channel is cleartext and authenticates nothing but the 12-digit ID. Anyone who can
  reach our port and guess/observe an ID can inject fake positions or commands' replies. Keep
  the port firewalled (carrier address ranges or a private APN/VPN), log the source IP per
  session (the platform does), and alert on an ID connecting from two addresses at once.
- Our server can send `0x8500` vehicle control / relay commands; the platform never does, and
  the app we build should not expose them.
- Treat MiCODUS cloud credentials as low-trust (IDOR history); do not reuse them anywhere.

## 6. Recommendations for the app

1. Build on the JT808 implementation in `server/src/jt808/` (framing, decoder, replies, OBD
   items, batch upload, commands) — it is the protocol the device speaks, and it is covered
   by 67 tests including the real MV55G-AU frame.
2. Keep the GT06 path only if we ever buy MV7xx units; the server auto-detects both.
3. Run the 8-stage `TEST-PLAN.md` with the real unit; the first captures settle the remaining
   unknowns (item layout, time zone, command reply message, alarm bits, LED patterns, bands).
4. Store raw frames forever (`data/raw.jsonl` already does): every later decoder fix can be
   replayed against history with `simulator/simulate.js --replay`.
5. Design the app around what the device actually pushes: a position every N seconds with
   OBD values attached, alarm bits on the same message, and buffered batches after dead zones.
   There is no request/response for most data; commands are asynchronous (0x0001 then a
   text reply).

## 7. Sources

Primary / vendor:
- MiCODUS MV55G User Manual V2.0 — https://www.micodus.com/uploadfiles/files/08/08befc24f6-mv55g-user-guide-20.pdf (V1.0: https://www.micodus.com/uploadfiles/files/22/22c3af0323-mv55g-user-guide.pdf); mirrors https://www.manualslib.com/manual/2592511/Micodus-Mv55g.html, https://manuals.plus/micodus/mv55g-gps-tracker-manual
- MiCODUS platform description — https://www.micodus.com/news/platform ; shop/platform pass — https://www.micodus.shop/ ; ID-vs-IMEI guide — https://www.micodus.com/uploadfiles/files/63/637f3549cd-app-imei-id.pdf
- Google Play, "Micodus" app — https://play.google.com/store/apps/details?id=com.fw.gps.edkj
- CISA ICS Advisory ICSA-22-200-01 — https://www.cisa.gov/news-events/ics-advisories/icsa-22-200-01 ; NVD CVE-2022-2107 — https://nvd.nist.gov/vuln/detail/CVE-2022-2107
- Traccar `Jt808ProtocolDecoder.java` — https://github.com/traccar/traccar/blob/master/src/main/java/org/traccar/protocol/Jt808ProtocolDecoder.java ; PR #5595 — https://github.com/traccar/traccar/pull/5595

Secondary / community:
- Traccar forum, "Micodus mv55g-au" — https://www.traccar.org/forums/topic/micodus-mv55g-au/ (and the 12-digit-ID thread https://www.traccar.org/forums/topic/huabao-protocol-device-unique-id-limited-to-12-digits/)
- flespi Micodus protocol and MV55G device pages — https://flespi.com/protocols/micodus , https://flespi.com/devices/micodus-mv55g
- MV55G JT808 decoder from a live capture — https://github.com/neanimakhari/vehicle-income-tracker/blob/main/gps-ingest/src/micodus/decoder.js (framing: …/frame.js)
- GT06 parser (family reference) — https://github.com/vondraussen/gt06
- Spec sheet (bands, generic MV55G) — https://micodus.en.made-in-china.com/product/FwYtUBPOkehi/China-Micodus-4G-OBD-GPS-Tracker-Mv55g-for-All-Vehicles.html ; retail listing — https://www.amazon.co.uk/dp/B0B56RJ9TB
- Reseller how-to on connecting the MV55G to third-party software — https://www.golophy.com/blogs/solutions/how-to-connect-the-micodus-mv55g-4g-obdii-gnss-tracker-to-a-software-protocol
- Press on the 2022 disclosure — https://www.theregister.com/2022/07/19/micodus_gps_tracker_vulns/ , https://industrialcyber.co/vulnerabilities/severe-vulnerabilities-in-vehicle-gps-trackers-affect-critical-infrastructure-sector-bitsight-discloses/

## 8. How this research was done, and its limits

- A five-angle search (hardware, SMS commands, wire protocol, platform/API, security) was run
  by parallel search agents; 20 URLs were fetched for claim extraction; an adversarial
  three-vote verification was started per claim.
- The sandbox's egress proxy blocks micodus.com, manualslib, manuals.plus, flespi, golophy,
  amazon, micodus.shop and traccar.org, so those sources were read through search-engine
  snippets and the fetch agents' indexed extracts rather than opened directly. GitHub, CISA,
  NVD and Google Play were opened directly.
- Final verification tally (workflow run of 102 agents, 1,038 tool calls): 24 claims entered
  the three-vote adversarial check. Four survived **3-0** with no refutation: the `SERVER`
  command syntax and default endpoint, the `APN` command syntax, "the MV55G communicates
  using JT/T 808, not GT06" (capture-based decoder source), and Traccar's explicit MV710G/
  MV810G handling in its JT808 decoder. The other 20 claims were **unverified, not
  refuted**: all 60 of their voter agents failed on the session's usage limit, as did the
  final synthesis step. No claim was refuted. Confidence levels above are therefore the
  author's assessment from source quality and corroboration, with the four 3-0 results noted
  where they apply.
- Nothing here replaces a capture from our own unit; `TEST-PLAN.md` is the path to that.
