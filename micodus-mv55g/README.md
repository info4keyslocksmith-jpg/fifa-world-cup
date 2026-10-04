# MiCODUS MV55G-AU — research + test platform

Everything in this folder is about one device: the **MiCODUS MV55G** 4G OBD-II plug-and-play
GPS tracker (we own the **MV55G-AU** regional variant). The goal is to understand the product
well enough to build our own server and app for it, and to have a lab to test against the real
unit.

| Folder / file | What it is |
| --- | --- |
| `docs/RESEARCH-REPORT.md` | Cited research report: hardware, SMS commands, wire protocol, cloud platform, security history |
| `docs/PROTOCOL.md` | The GT06/Concox-family wire protocol as implemented here, byte by byte, with worked examples |
| `docs/SMS-COMMANDS.md` | SMS / online command cheat sheet for the MV55G family |
| `docs/TEST-PLAN.md` | Step-by-step bench and in-car test plan for the real device |
| `server/` | The test platform (Node.js, zero dependencies): TCP server, decoder, REST API, live dashboard, simulator, tests |

## Quick start (no hardware needed)

```bash
cd micodus-mv55g/server
node src/index.js                 # TCP 5023 for the tracker, http://localhost:8080 dashboard
# in a second terminal
node simulator/simulate.js --obd  # a fake MV55G drives around Atlanta and reports every 5 s
node --test                       # 41 tests: CRC, framing, every packet type, TCP + HTTP integration
```

Open <http://localhost:8080>: devices on the left, live map in the middle, and at the bottom the
raw frame log (hex + decoded JSON), events, positions, a command console and an offline hex decoder.

Environment variables: `TCP_PORT` (5023), `HTTP_PORT` (8080), `DATA_DIR` (`server/data`, set `""`
to disable JSONL persistence), `ACK_EXTENDED=1` (also acknowledge `79 79` frames).

## Connecting the real MV55G

The device speaks TCP to a host:port it stores in flash. By default that is MiCODUS' cloud. To use
this platform you repoint it with SMS commands (details and exact spelling in
`docs/SMS-COMMANDS.md`, procedure in `docs/TEST-PLAN.md`):

1. Change the default password (`123456`) first.
2. Set the APN of the SIM you installed.
3. `SERVER,1,<public ip>,<port>,0#` (or mode `0` with a DNS name) and `RESET#`.
4. Watch the dashboard: a `0x01` login with the IMEI should appear within a minute, then
   heartbeats and location packets.

The device lives on the cellular network, so the TCP port must be reachable from the internet:
a cheap VPS running this server, a port-forward on your router, or an SSH/ngrok TCP tunnel from
your laptop all work. Keep the port firewalled to the carrier's address range if you can.

## Architecture

```
 MV55G ──LTE──▶ internet ──▶ :5023  src/tcp-server.js
                                   │  FrameParser (frame.js)  → decodeFrame (decode.js) → Store
                                   │  ACK / time response / queued 0x80 commands back to device
                                   ▼
                              src/store.js  ── JSONL files in data/ (raw, positions, events, commands)
                                   ▼
                              :8080 src/http-api.js  ── REST + Server-Sent Events ── web/index.html
```

`simulator/simulate.js` is a complete fake device (login, time request, heartbeat, location on a
route, alarms, OBD, info frames, replies to online commands, reconnect). It also replays captured
hex (`--replay file.hex`), which is how we will feed real MV55G captures back into the decoder.

## What is verified vs. assumed

The platform implements the **GT06 / Concox protocol family** that MiCODUS trackers use
(Traccar lists MiCODUS devices under its `gt06` decoder, port 5023). The exact packet set the
MV55G firmware emits — especially the OBD-II data packets — must be confirmed with a capture from
the real unit. The server was built for that: it never drops bytes, acknowledges every frame so
the device stays connected, and shows unknown protocol numbers and leftover bytes in the raw log.
See `docs/RESEARCH-REPORT.md` for confidence levels per claim.

## Safety / scope notes

- This is our own device, tested on our own vehicles and our own server.
- MiCODUS devices had serious published vulnerabilities in 2022 (default password, unauthenticated
  SMS). Change the password, use a SIM with a private/limited plan, and keep the test server
  firewalled.
- Never use the relay / engine-cut features during a test drive.
