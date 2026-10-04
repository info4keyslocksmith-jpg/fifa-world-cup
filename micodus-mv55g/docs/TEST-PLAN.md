# MV55G-AU test plan

Goal: get our physical MV55G-AU reporting to the test platform, capture every packet type it
produces, confirm or correct the decoder, and end with a documented, repeatable set of
behaviours we can build the real app on. Each stage has a pass condition; do not skip stage 0.

## Stage 0 — before touching the device (15 min)

- [ ] Read `docs/RESEARCH-REPORT.md` §security. MiCODUS devices shipped with password `123456`
      and accepted some SMS commands without it (2022 CVEs). Treat the tracker as hostile until
      the password is changed.
- [ ] Prepare a SIM: 4G data plan, SMS capable (we need to send commands by SMS), know the APN.
      **Band check:** the AU variant is tuned for Australian LTE bands. Confirm from the report
      which bands it supports and which of them your US carrier uses before buying a plan.
- [ ] Decide where the server runs. The device must reach `ip:port` over the internet:
  - VPS: `git clone … && cd micodus-mv55g/server && TCP_PORT=5023 node src/index.js`
  - Laptop at home: forward TCP 5023 on the router, or `ssh -R 5023:localhost:5023 vps` /
    `ngrok tcp 5023`.
- [ ] Start the platform and run `node simulator/simulate.js --host <public ip> --port 5023 --count 3`
      from a different network (phone hotspot) to prove the port is reachable. Pass: three
      location rows appear in the dashboard.

## Stage 1 — bench power-up (no car)

OBD-II pin 16 is +12 V battery, pins 4 and 5 are ground. Power the tracker from a 12 V bench
supply or a car battery through an OBD breakout/extension cable; it needs no CAN bus to boot.

- [ ] Insert SIM (power off), plug in, watch the LEDs. Note the blink patterns for power/GSM/GPS
      and write them in the report if they differ from the manual.
- [ ] Send `PARAM#` (or the MiCODUS equivalent) by SMS from your phone. Pass: a reply listing
      IMEI, server, APN, timer. Save the reply verbatim in `docs/captures/`.
- [ ] Change the password. Pass: old password is rejected afterwards.
- [ ] Set APN. Pass: `STATUS#` reply shows GPRS/data link up.

## Stage 2 — repoint to our server

- [ ] `SERVER,1,<public ip>,<port>,0#` (IP mode, TCP). If the device wants a domain use mode 0
      with a DNS name. Then `RESET#`.
- [ ] Dashboard: `0x01 login` with the device IMEI within ~60 s, server ACK, then heartbeats.
      Pass: device card shows connected, GSM level, voltage.
- [ ] Note the login extras (type code, time zone) and whether a `0x8A` time request arrives.
- [ ] Record the heartbeat type (`0x13` or `0x23`) and interval.

If no login appears: check the raw log for garbage (wrong protocol), check the VPS firewall,
re-send `SERVER` with the other mode, confirm APN. If login appears but the device
disconnects every few seconds the ACK is wrong — capture the hex and compare with §1 of
`PROTOCOL.md`.

## Stage 3 — positioning (outdoors, engine off)

- [ ] Take the bench setup outdoors or plug into a parked car. Pass: `0x22`/`0xA0` locations
      with `valid=true`, correct hemisphere (N/W for the US), plausible satellites count.
- [ ] Set a short timer (`TIMER,10,…#`) and verify the interval on the Positions tab.
- [ ] Walk 100 m. Pass: trail moves on the map, course changes.
- [ ] Note MCC/MNC/LAC/CID from the LBS block and compare with the carrier (MCC 310/311 = US).

## Stage 4 — alarms

- [ ] Unplug the device from OBD with the backup battery charged. Pass: alarm packet
      (`power_cut` or vendor code) + the dashboard Events tab shows it; note the exact code.
- [ ] Shake / tap the device while parked. Pass: vibration alarm (if enabled; some firmware needs
      `SENALM,ON#`-style commands — see SMS cheat sheet).
- [ ] Overspeed: set a low threshold, drive above it. Pass: overspeed alarm code.
- [ ] Geofence if the firmware supports it by command.
- [ ] Record each alarm's raw hex in `docs/captures/alarms.hex` (one frame per line) so
      `node simulator/simulate.js --replay docs/captures/alarms.hex` can reproduce them.

## Stage 5 — OBD-II data (engine running)

- [ ] Plug into the car, start the engine, drive 10 minutes.
- [ ] Watch for new protocol numbers in the raw log (`unknown` kind) and for `0x8C` / `0x94`
      frames. Pass: at least one frame that changes with RPM.
- [ ] Capture 20+ frames with the engine running and 5 with it off into
      `docs/captures/obd-*.hex`. Compare fields against the car's dash (speed, RPM, coolant,
      fuel level) to work out scaling. Update `OBD_KEYS` in `constants.js` and the decoder.
- [ ] Check whether the VIN is reported (login extras, `0x94`, or OBD frame).
- [ ] Note ACC/ignition detection delay on engine start and stop.

## Stage 6 — commands from our server

- [ ] From the Commands tab send `STATUS#`, `PARAM#`, `VERSION#`, `WHERE#`. Pass: `0x15` or
      `0x21` reply text appears in the response column within ~5 s.
- [ ] Try one setting command (`TIMER,…#`) and confirm with `PARAM#`.
- [ ] Note whether commands need the password, and whether `includeLanguage` must be off
      (set `commandOptions` in `tcp-server.js`).
- [ ] Do **not** send relay / engine-cut commands.

## Stage 7 — robustness

- [ ] Drive through a known dead zone. Pass: buffered points arrive with upload mode
      `network_reconnect_reupload` and correct device timestamps.
- [ ] Power the server off for 2 minutes. Pass: device reconnects and re-logs in on its own.
- [ ] Leave overnight. Pass: no disconnect storms, heartbeat cadence stable, idle timeout not hit.

## Stage 8 — hand-off to the app

After the stages above, update `docs/PROTOCOL.md` §7 with the confirmed answers, add a
`docs/captures/` replay file per scenario, and extend `test/codec.test.js` with one test per
real captured frame. The app can then be built against the REST/SSE API of this server or
embed `src/gt06/` directly.

## Capture log template

```
# date  stage  scenario            hex
2026-10-05 S2 login              78 78 11 01 ...
2026-10-05 S4 unplug alarm       78 78 25 26 ...
```
