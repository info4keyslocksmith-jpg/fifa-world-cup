# MV55G SMS and online command cheat sheet

Commands are plain text SMS sent to the SIM in the tracker. The same strings can be sent over
the data channel by a platform (JT808 `0x8300` text message on the MV55G; GT06 `0x80` on the
MV7xx family), which is what the Commands tab of the test platform does.

Confidence key: **[MV55G manual]** = MiCODUS MV55G user guide V1.0/V2.0 (micodus.com PDF and its
manualslib / manuals.plus mirrors); **[MV55G capture]** = commands used by a community project with
a live MV55G; **[MV720 manual]** = sibling model, same firmware family, to be confirmed on the
MV55G; **[family]** = generic MiCODUS/Concox behaviour.

## Defaults

| Item | Value | Source |
| --- | --- | --- |
| Password | `123456` | [MV55G manual] |
| Default server | `d.micodus.net` port `7700` (IP `47.254.77.28`) | [MV55G manual] |
| Login to app / web | device **ID** (or IMEI) + password `123456` at www.micodus.net / "MiCODUS" app | [MV55G manual] |
| Device identity on the wire | 11-digit MiCODUS ID (sent as `0` + ID in JT808) — **not** the IMEI | [MV55G capture], Traccar forum MV55G-AU |

## Provisioning (do these first, in this order)

| Purpose | Command | Reply / notes | Source |
| --- | --- | --- | --- |
| Set APN | `APN,<apn>#` | "SET APN OK" — also returned for a wrong APN, so it proves nothing by itself | [MV55G manual] |
| Set APN with credentials | `APN,<apn>,<user>,<password>#` | | [MV55G manual] |
| Point to a server by IP | `SERVER,0,<ip>,<port>#` e.g. `SERVER,0,47.254.77.28,7700#` | mode `0` = IP | [MV55G manual] |
| Point to a server by domain | `SERVER,1,<domain>,<port>#` e.g. `SERVER,1,d.micodus.net,7700#` | mode `1` = domain name | [MV55G manual] |
| Restart | `RESET#` | device reconnects to the configured server | [family] |
| Factory reset | `FACTORY#` | wipes APN/server settings | [MV720 manual], confirm |
| Change password | `PASSWORD,<old>,<new>#` | **confirm exact spelling on the MV55G** (MV720 manual uses this form; legacy Concox firmware uses `password123456 <new>`) | [MV720 manual] |

## Status and queries

| Purpose | Command | Source |
| --- | --- | --- |
| Firmware version + device ID | `VERSION#` | [MV55G capture], Traccar forum MV55G-AU |
| Parameters (server, APN, timer, …) | `PARAM#` | [MV720 manual] |
| Status (battery, GSM, GPS, ACC) | `STATUS#` | [MV55G capture] |
| Position as text / map link | `WHERE#` / `URL#` | [family] |
| Mileage | `MILEAGE#` | [MV55G capture] |

## Reporting and alarms

| Purpose | Command | Notes | Source |
| --- | --- | --- | --- |
| Upload interval | `TIMER,<seconds>#` e.g. `TIMER,30#` | some firmware takes `TIMER,<moving>,<stopped>#` | [MV55G capture] |
| Overspeed threshold | `SPEED,<km/h>#` e.g. `SPEED,80#` | | [MV55G capture] |
| Ignition (ACC) alarm on/off | `ACCALM,1#` / `ACCALM,0#` | | [MV55G capture] |
| Power-cut / unplug alarm | `PWRALM,1#` / `PWRALM,0#` | | [MV55G capture] |
| Vibration alarm | `SENALM,1#` / `SENALM,0#` | | [MV55G capture] |
| Time zone | `GMT,E,0#` (UTC), `GMT,W,5#` (UTC−5) | affects the device timestamps in JT808 reports; set `JT808_TZ_HOURS` on the server to match | [MV720 manual] |
| SOS numbers | `SOS,A,<n1>,<n2>,<n3>#` | add; `SOS,D,…#` delete | [MV55G manual] |
| Centre / admin number | `CENTER,A,<number>#` | | [MV720 manual] |
| Arm / disarm (vibration alarm mode) | `ARM#` / `DISARM#` | | [MV55G manual] |

## Legacy Concox-style forms seen in MiCODUS manuals

Older MiCODUS firmware (and the MV720 manual) also documents the Concox word+password syntax:
`apn123456 <apn>`, `adminip123456 <ip> <port>`, `admin123456 <number>`, `begin123456`
(initialise), `password123456 <new>`. Try these only if the comma syntax is not answered.

## Online (data-channel) commands from our server

- MV55G / JT808: the text above goes inside an `0x8300` message (flag byte 1 by default; try
  `!text,4,STATUS#` from the Commands tab if the device answers *not supported*). Binary
  alternatives: `!query` (0x8201 position), `!params` (0x8104 parameter dump), `!reset` (0x8105).
- flespi documents exactly one MV55G command in its catalogue: a JT808 **terminal control**
  message `0x8105` with body `0x11` to ARM the device — i.e. MiCODUS also uses binary JT808
  control messages, not only text. Send it from the Commands tab as a raw frame if needed.
- MV7xx / GT06: the text goes inside an `0x80` message and the reply comes back as `0x15`/`0x21`.
- Whether the MV55G requires the password inside data-channel commands is unknown — Stage 6 of
  the test plan checks it.

## Safety

- Never send relay / engine-cut commands (`RELAY,1#`-style or JT808 `0x8500`) during tests.
- Change the password before anything else; anyone who knows the SIM number can otherwise
  reconfigure the tracker (CVE-2022-2141 on the MV720).
