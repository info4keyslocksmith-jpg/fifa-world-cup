# viral — raw clip in, postable vertical video out

One command turns a clip into a 9:16 export with word-by-word captions, dead air
cut, framing punched in on the beats, and audio at feed loudness. Then a QC gate
checks it against published short-form benchmarks and **refuses to pass a clip
that would underperform**.

That last part is the point. Auto-editors are easy; auto-editors that tell you
when the result is weak are not.

---

## The honest version of "you upload, I do the rest"

The machine can do most of it. It cannot do the one thing that decides whether a
video travels.

**What the tooling does on its own, every time, identically:** transcribe, cut
dead air, frame to 9:16, build karaoke captions that stay inside the platform
UI, punch in on a cadence, normalise loudness, and grade the result.

**What it cannot do:** know which 3 seconds of your footage is the hook.

That is a judgement about *your* story — which line is the surprising one, where
the tension is, what the viewer needs withheld. No silence-detector finds it.
Research on hook rate is blunt about the stakes: 65% of viewers who make it past
the first 3 seconds stay for 10, and the scroll decision itself lands inside
~1.3 seconds on TikTok. Everything downstream is decided there.

So the split is: **you shoot, the tooling grinds, and picking the hook is a
conversation.** Step 3 below is where that happens. Skipping it gives you a
clean, competent, forgettable clip — which is exactly the "trash video" problem,
just tidier.

---

## Install on a Mac — one paste, nothing else

Open Terminal (Spotlight, type "Terminal"), paste this, press Enter:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/info4keyslocksmith-jpg/fifa-world-cup/claude/viral-video-editing-steps-w3vb16/viral/install-mac.sh)"
```

It finds your Google Drive folder by name, installs ffmpeg if it's missing,
sets up the transcriber, and starts the watcher — which restarts itself after
a reboot. No GitHub account, no cloning, no paths to type.

If your folder is named something other than `Videos 4keys Claude`, or it can't
find it, run the same line with the path spelled out:

```bash
VV_FOLDER="/path/to/your/folder" bash -c "$(curl -fsSL https://raw.githubusercontent.com/info4keyslocksmith-jpg/fifa-world-cup/claude/viral-video-editing-steps-w3vb16/viral/install-mac.sh)"
```

---

## Install by hand (other systems)

```bash
cd viral
./setup.sh
```

That installs ffmpeg (via Homebrew on macOS, apt on Linux) and the transcriber
into a local `.venv`. Nothing is installed system-wide except ffmpeg.

**Windows:** install WSL first, then run the same commands inside it.

First run downloads the speech model (~500 MB for `small`). Once. After that it
works with no internet.

---

## The hands-off setup (Mac + Google Drive)

If the Mac stays on and Google Drive Desktop is syncing, the whole thing runs
without you touching a terminal again.

```bash
./vv install-agent "/Users/you/Google Drive/My Drive/4Keys Video"
```

That creates the folder layout and installs a background watcher that survives
reboots. Inside the folder:

```
4Keys Video/
  1_drop/      you drop raw clips here -- from your phone, from anywhere
  2_review/    the transcript appears here a minute or two later
  3_plans/     the edit plan lands here (yours, or Claude's)
  4_ready/     finished vertical clip + its QC report
```

**Why this works:** the video file never leaves the Mac. Only the small text
files sync through Drive, which means Claude can read a transcript and drop an
edit plan straight back into `3_plans/` without a 200MB clip crossing the
internet. The watcher sees the plan appear and renders locally.

So the actual loop, from your phone:

1. Drop a clip in `1_drop/`.
2. Tell Claude the clip name. It reads the transcript out of Drive, picks the
   hook, writes the plan into `3_plans/`.
3. The finished video shows up in `4_ready/` a minute later, with its QC report.

The watcher is careful about sync: it waits for a file to stop growing before
touching it, so a clip still coming down from Drive is never transcribed
half-written. Partial files (`.tmp`, `.download`) are ignored.

Watch what it's doing: `tail -f logs/watch.log`.
Stop it: `launchctl unload ~/Library/LaunchAgents/com.4keys.viral.watch.plist`.

---

## The loop

### 1 — Drop the clip in and run it

```bash
./vv auto in/yourclip.mp4
```

This does all four passes and prints a QC report. What comes out is the
**automatic first cut** — real, watchable, and not yet the post.

### 2 — Read the transcript

`work/yourclip.transcript.md` — every line with a timestamp, every stretch of
dead air, and every word the transcriber wasn't sure about.

### 3 — Pick the hook (this is the step that matters)

Paste that transcript to me. I'll come back with:

- which timestamp to open on, and why that line beats the others
- lines to cut entirely
- caption text fixes for anything the transcriber mangled
- on-screen text, and where it goes
- the finished plan as `plans/yourclip.edit.json`

If you'd rather do it yourself: `segments` in that file is a list of
`{start, end}` in **source time** — the same timestamps you just read. Reorder
them, drop them, tighten them. The first segment is your hook.

### 4 — Render the real version

```bash
./vv render yourclip            # add --preview for a fast, ugly draft
./vv check  yourclip
```

### 5 — Read the QC report before you post

`FAIL` blocks. `WARN` is your call, made with the number in front of you.

---

## Commands

| | |
|---|---|
| `./vv auto in/clip.mp4` | all four passes end to end |
| `./vv analyze in/clip.mp4` | transcribe + measure only |
| `./vv plan clip` | regenerate the starter plan |
| `./vv render clip [--preview]` | render the plan |
| `./vv check clip` | QC an existing render |
| `./vv watch "<folder>"` | run continuously on a synced folder |
| `./vv install-agent "<folder>"` | keep the watcher alive on this Mac |

`VV_MODEL=medium ./vv analyze …` for better transcription on noisy audio
(slower). `VV_LANG=es` to pin the language instead of autodetecting.

---

## The edit plan

```jsonc
{
  "segments": [                      // source time — what survives, in order
    { "start": 41.0, "end": 46.2 },  // the hook goes first
    { "start": 12.4, "end": 18.9 }
  ],
  "framing": {
    "x_frac": 0.5,                   // 0 = crop to left edge, 1 = right
    "punch_ins": [                   // hard cut to a tighter shot
      { "at": 46.5, "dur": 2.2, "scale": 1.16 }
    ]
  },
  "captions": {
    "replacements": { "leashy": "Lishi" }
  },
  "overlays": [
    { "text": "$850\nFOR ONE KEY", "start": 41.0, "end": 43.5, "y": 420 }
  ],
  "audio": { "music": null, "music_gain_db": -20 }
}
```

Everything is written in **source time** — the timestamps from the transcript.
The renderer remaps it onto the cut timeline for you, and silently drops
anything that falls in material you removed.

Punch-ins are hard cuts to a tighter framing, not animated zooms. Frame-accurate,
and it's the move that actually reads on a phone.

---

## Why these numbers

Every threshold in `style/default.json` and the QC gate traces to something
published, not taste:

| Setting | Value | Why |
|---|---|---|
| Words per caption card | max 3 | 1–3 words at a time is the 2026 consensus; full sentences on screen are cognitive load |
| Caption font size | 78px @ 1080×1920 | 70–80px is where a 2–3 word card is bold and readable on a phone |
| Caption colour | white, active word yellow, 6px black outline | highest-contrast combination that survives any background |
| Caption position | y=1180 | lower-middle third, clear of every platform's UI |
| Safe zone | 230–1400px vertical | intersection of TikTok, Reels and Shorts overlays |
| Min card duration | 0.30s | below ~0.25s a card is a flash, not something read |
| Beat cadence | change every ≤3s | pro Shorts editors work in 1.5–3s beats |
| Pattern interrupt | cut or punch-in every ≤12s | interrupts appear every 8–12s in retention-optimised content |
| Hook dead air | first caption < 0.5s | the scroll decision lands at ~1.3s |
| Hook density | ≤14 words in 3s | roughly what a spoken hook fits before it stops landing |
| Target length | 21–34s | under 30s clips hold 55–70% completion; past 45s it falls off |
| Loudness | −14 LUFS, −1.5 dBTP | platform normalisation target |

Sources: [hook rate and retention benchmarks](https://viralwatch.app/viralwatch-video-analysis-blog/what-is-a-good-hook-rate/),
[retention by platform](https://retensis.com/blog/audience-retention-benchmarks-2026),
[caption style consensus](https://blitzcutai.com/blog/best-caption-style-tiktok),
[caption sizing](https://blitzcutai.com/blog/best-caption-size-youtube-shorts-2026),
[safe zones](https://kreatli.com/guides/safe-zone-guide),
[pacing and pattern interrupts](https://shortzly.com/blog/short-form-video-pacing-editing-guide),
[hook formulas](https://kineclip.com/blog/how-to-write-viral-hooks-short-form-2026/).

---

## The QC gate

Thirteen checks. `FAIL` means don't post it:

- not 9:16
- no captions at all
- dead air before the first word
- a caption card too dense or too fast to read
- captions outside the safe zone

`WARN` means look at it and decide: length, uncaptioned stretches, flat pacing,
no pattern interrupt, quiet audio, dead frames at the end.

The gate reads the render, not the plan — it grades what actually came out.

---

## What deliberately isn't automated

**Aggressive silence-cutting.** Only gaps over 0.6s are removed, with 0.12s of
breathing room left on each side. Machine-gunning every pause is what makes AI
edits feel synthetic.

**Music.** Off by default. Set `audio.music` to a path if you want a bed; it
ducks to −20dB under the voice.

**The hook.** See above.

---

## Troubleshooting

**Captions look wrong / a word is mangled** — add it to `lexicon.json`. Fixed
permanently, for every future clip.

**Wrong part of the frame is cropped** — set `framing.x_frac` (0 = left edge,
1 = right).

**Transcription is poor** — `VV_MODEL=medium`, or `large-v3` if you can wait.

**Render is slow** — `--preview` gives a 540×960 draft in a fraction of the time.
Check the edit there, then render properly once.
