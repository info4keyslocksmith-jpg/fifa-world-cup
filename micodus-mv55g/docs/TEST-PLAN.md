# MV55G-AU test plan

Goal: get our physical MV55G-AU reporting to the test platform, capture every message type it
produces, confirm or correct the decoder, and end with a documented, repeatable set of
behaviours we can build the real app on. Each stage has a pass condition; do not skip stage 0.

## Stage 0 — before touching the device (15 min)

- [ ] Read `docs/RESEARCH-REPORT.md` §security. MiCODUS devices shipped with password `123456`
      and accepted some SMS commands without it (2022 CVEs on the MV720). Treat the tracker as
      hostile until the password is changed.
- [ ] Prepare a SIM: 4G data plan, SMS capable (we send commands by SMS), know the APN.
      **Band check:** confirm from the report / the sticker which LTE bands this AU unit has and
      whether your carrier uses them before buying a plan.
- [ ] Decide where the server runs. The device must reach `ip:port` over the internet:
  - VPS: `git clone … && cd micodus-mv55g/server && node src/index.js` (TCP 7700, HTTP 8080)
  - Laptop at home: forward TCP 7700 on the router, or `ssh -R 7700:localhost:7700 vps` /
    `ngrok tcp 7700`.
- [ ] Prove the port is reachable from outside: from a phone hotspot run
      `node simulator/simulate.js --host <public ip> --port 7700 --count 3`. Pass: three
      location rows appear in the dashboard.

## Stage 1 — bench power-up (no car)

OBD-II pin 16 is +12 V battery, pins 4 and 5 are ground. Power the tracker from a 12 V bench
supply or a car battery through an OBD breakout/extension cable; it needs no CAN bus to boot.

- [ ] Insert SIM (power off), plug in, watch the LEDs. Note the blink patterns for power/GSM/GPS
      and write them in the report if they differ from the manual.
- [ ] Send `VERSION#` by SMS. Pass: a reply with firmware version and the device ID. Write the ID
      down: the server will show it as `0` + ID (12 digits). Save every SMS reply verbatim in
      `docs/captures/sms.txt`.
- [ ] Send `PARAM#` / `STATUS#`. Pass: current server, APN, timer, GSM/GPS state.
- [ ] Change the password. Pass: old password rejected afterwards.
- [ ] `APN,<apn>#`. Note: the device answers "SET APN OK" even for a wrong APN; only the next stage
      proves it.

## Stage 2 — repoint to our server

- [ ] `SERVER,0,<public ip>,7700#` (IP mode) or `SERVER,1,<dns name>,7700#` (domain), then `RESET#`.
- [ ] Dashboard: within ~60 s a `0x0100 register` from the device (manufacturer / model text),
      our `0x8100` response, the device's `0x0102 auth`, then `0x0002` heartbeats.
      Pass: device card shows connected, protocol `jt808`, model text, voltage item.
- [ ] Note what the register body contains (does the IMEI appear anywhere?), the heartbeat
      interval, and whether the device sends `0x0109` time sync requests.
- [ ] If the first frame starts with `78 78` instead of `7E`, the firmware is GT06-style; the
      server decodes that too — note it, everything else in this plan still applies.

If no connection appears: check the raw log for bytes outside any frame (wrong protocol), check
the VPS firewall, re-send `SERVER` with the other mode, confirm the APN with `PARAM#`. If the
device registers but disconnects every few seconds our `0x8100`/`0x8001` replies are being
rejected — capture the hex and compare with `PROTOCOL.md` §4.

## Stage 3 — positioning (outdoors, engine off)

- [ ] Take the bench setup outdoors or plug into a parked car. Pass: `0x0200` reports with
      `positioned` set, correct hemisphere (N/W for the US), plausible satellite count (`0x31`).
- [ ] Compare the device timestamp with the wall clock. If it is off by whole hours, set
      `JT808_TZ_HOURS` accordingly (or send `GMT,E,0#` to make the device use UTC) and note it.
- [ ] Set a short timer (`TIMER,10#`) and verify the interval on the Positions tab.
- [ ] Walk 100 m. Pass: trail moves on the map, course changes, mileage item `0x01` grows.

## Stage 4 — alarms

- [ ] Unplug the device from OBD with the backup battery charged. Pass: a report with alarm bit 8
      (`main_power_cut`) or a vendor code; note the exact alarm word and any `0x57` item.
- [ ] Shake / tap the device while parked (enable with `SENALM,1#` if needed). Pass: vibration /
      displacement alarm; note the bit.
- [ ] Overspeed: `SPEED,20#`, drive above it. Pass: alarm bit 1 (`overspeed`).
- [ ] Harsh braking / acceleration during the drive. Pass: `0x57` item with bits 8/9/10.
- [ ] Record each alarm's raw hex in `docs/captures/alarms.hex` (one frame per line) so
      `node simulator/simulate.js --replay docs/captures/alarms.hex` can reproduce them.

## Stage 5 — OBD-II data (engine running)

- [ ] Plug into the car, start the engine, drive 10 minutes.
- [ ] Watch the device card's OBD line and the items list inside each `0x0200` (click a raw row).
      Pass: RPM (`0x81`) and CAN speed (`0x80`) change with the engine; voltage (`0x82`) rises
      to ~14 V with the engine running.
- [ ] Check VIN (`0x94`/`0x8B`), coolant (`0x84`), fuel level (`0x8E`), odometer (`0x8C`),
      DTC list (`0xA0`) against the dashboard. Fix any scale in `src/jt808/decode.js` and add
      the captured frame to `test/jt808.test.js`.
- [ ] Items the decoder marks `unknown` are new vendor fields: capture 20+ frames with the engine
      running and 5 with it off into `docs/captures/obd-*.hex` and work out their meaning.
- [ ] Note ACC detection delay (status bit 0) on engine start and stop.

## Stage 6 — commands from our server

- [ ] From the Commands tab send `STATUS#`, `PARAM#`, `VERSION#`, `WHERE#`. Pass: the device's
      `0x0001` says `success` and a text reply shows in the response column within ~5 s.
      Note which message carries the reply (`0x6006`, `0x0900`, other).
- [ ] If the device answers `not_supported`, try `!text,4,STATUS#` (another flag byte) and
      the binary `!query` / `!params`. Record what works in `PROTOCOL.md` §4.
- [ ] Try one setting command (`TIMER,30#`) and confirm with `PARAM#` / `!params`.
- [ ] Note whether commands need the password inside the text.
- [ ] Do **not** send relay / engine-cut commands.

## Stage 7 — robustness

- [ ] Drive through a known dead zone. Pass: a `0x0704` batch arrives afterwards with the
      buffered points flagged `buffered` and correct device timestamps.
- [ ] Power the server off for 2 minutes. Pass: device reconnects and re-registers / re-auths
      on its own.
- [ ] Leave overnight. Pass: no disconnect storms, heartbeat cadence stable, idle timeout not hit.

## Stage 8 — hand-off to the app

After the stages above, update `docs/PROTOCOL.md` §8 with the confirmed answers, add a
`docs/captures/` replay file per scenario, and extend `test/jt808.test.js` with one test per
real captured frame. The app can then be built against the REST/SSE API of this server or
embed `src/jt808/` directly.

## Capture log template

```
# date  stage  scenario            hex
2026-10-05 S2 register           7E 01 00 00 2D 01 91 72 ...
2026-10-05 S4 unplug alarm       7E 02 00 00 4A 01 91 72 ...
```
