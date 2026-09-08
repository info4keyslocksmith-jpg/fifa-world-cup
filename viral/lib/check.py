#!/usr/bin/env python3
"""Pass 3: the anti-trash gate.

Every threshold here traces to a documented short-form benchmark (see README,
"Why these numbers"). The point is that a clip cannot be shipped on vibes --
it has to clear the same bar every time.

FAIL blocks the post. WARN is a judgement call you make with your eyes open.
"""

import argparse
import json
import os
import re
import subprocess
import sys

FAIL, WARN, PASS = "FAIL", "WARN", "PASS"


class Report:
    def __init__(self):
        self.rows = []

    def add(self, level, name, detail, why=""):
        self.rows.append({"level": level, "name": name,
                          "detail": detail, "why": why})

    @property
    def failed(self):
        return any(r["level"] == FAIL for r in self.rows)

    def render(self):
        width = max(len(r["name"]) for r in self.rows)
        out = []
        for r in self.rows:
            out.append(f"  [{r['level']}] {r['name'].ljust(width)}  {r['detail']}")
            if r["why"] and r["level"] != PASS:
                out.append(f"         -> {r['why']}")
        return "\n".join(out)


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json",
                        "-show_format", "-show_streams", path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ffprobe failed: {r.stderr}")
    return json.loads(r.stdout)


def loudness(path):
    r = subprocess.run(["ffmpeg", "-v", "info", "-i", path,
                        "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    lufs = re.findall(r"I:\s+(-?[\d.]+)\s+LUFS", r.stderr)
    peak = re.findall(r"Peak:\s+(-?[\d.]+)\s+dBFS", r.stderr)
    return (float(lufs[-1]) if lufs else None,
            float(peak[-1]) if peak else None)


def check(video, sidecar, style, rep):
    cards = sidecar["cards"]
    shots = sidecar["shots"]
    dur = sidecar["duration"]
    cap = style["caption"]
    safe = style["safe_zone"]

    # --- geometry ---------------------------------------------------------
    info = probe(video)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    w, h = int(v["width"]), int(v["height"])
    ar = w / h
    if abs(ar - 9 / 16) < 0.01:
        rep.add(PASS, "aspect ratio", f"{w}x{h} (9:16)")
    else:
        rep.add(FAIL, "aspect ratio", f"{w}x{h} (={ar:.3f})",
                "Vertical feeds letterbox anything that is not 9:16.")

    # --- length -----------------------------------------------------------
    if dur < 12:
        rep.add(WARN, "duration", f"{dur:.1f}s",
                "Under ~12s there is not enough room to land a story beat.")
    elif dur > 45:
        rep.add(WARN, "duration", f"{dur:.1f}s",
                "Past 45s completion rate falls off; 21-34s is the sweet spot.")
    else:
        rep.add(PASS, "duration", f"{dur:.1f}s")

    # --- the hook ---------------------------------------------------------
    if not cards:
        rep.add(FAIL, "hook: first words", "no captions at all",
                "Most feed views are muted. No captions means no hook.")
    else:
        first = cards[0]["start"]
        if first > 0.5:
            rep.add(FAIL, "hook: dead air", f"first caption at {first:.2f}s",
                    "The scroll decision happens inside ~1.3s. Cut the run-up.")
        else:
            rep.add(PASS, "hook: dead air", f"first caption at {first:.2f}s")

        hook_words = sum(c["words"] for c in cards if c["start"] < 3.0)
        if hook_words == 0:
            rep.add(FAIL, "hook: content", "nothing spoken in first 3s",
                    "The opening line has to carry the whole hook.")
        elif hook_words > 14:
            rep.add(WARN, "hook: content", f"{hook_words} words in first 3s",
                    "Over ~14 words the hook is too dense to land. Tighten it.")
        else:
            rep.add(PASS, "hook: content", f"{hook_words} words in first 3s")

    # --- caption legibility ----------------------------------------------
    over = [c for c in cards if c["words"] > cap["max_words_per_card"]]
    if over:
        rep.add(FAIL, "caption density",
                f"{len(over)} cards over {cap['max_words_per_card']} words",
                "Full sentences on screen are cognitive load, not captions.")
    else:
        rep.add(PASS, "caption density",
                f"max {max((c['words'] for c in cards), default=0)} words/card")

    fast = [c for c in cards if c["end"] - c["start"] < 0.25]
    share = len(fast) / len(cards) if cards else 0
    if share > 0.10:
        rep.add(FAIL, "caption speed",
                f"{len(fast)} of {len(cards)} cards under 0.25s "
                f"({share:.0%})",
                "Captions are flashing past across the whole clip. Usually the "
                "delivery is rushed -- reshoot the line or cut it.")
    elif fast:
        # A card can be short simply because those words were said quickly.
        # Nothing in the edit fixes that, so it is not a blocker.
        rep.add(WARN, "caption speed",
                f"{len(fast)} of {len(cards)} cards under 0.25s",
                "A few cards flash by on fast-spoken words. Fine unless it "
                "reads badly on the phone.")
    else:
        rep.add(PASS, "caption speed", f"{len(cards)} cards, none under 0.25s")

    stale = [c for c in cards if c["end"] - c["start"] > 3.5]
    if stale:
        rep.add(WARN, "caption stalls", f"{len(stale)} cards over 3.5s on screen",
                "Static text for that long reads as a frozen frame.")
    else:
        rep.add(PASS, "caption stalls", "none over 3.5s")

    # --- caption coverage (silent stretches) ------------------------------
    gaps, cursor = [], 0.0
    for c in sorted(cards, key=lambda x: x["start"]):
        if c["start"] - cursor > 1.5:
            gaps.append((cursor, c["start"]))
        cursor = max(cursor, c["end"])
    if dur - cursor > 1.5:
        gaps.append((cursor, dur))
    if gaps:
        worst = max(gaps, key=lambda g: g[1] - g[0])
        rep.add(WARN, "caption gaps",
                f"{len(gaps)} gap(s), longest {worst[1]-worst[0]:.1f}s "
                f"at {worst[0]:.1f}s",
                "Uncaptioned stretches are where muted viewers leave. "
                "Cover with B-roll, an overlay, or cut it.")
    else:
        rep.add(PASS, "caption gaps", "no gap over 1.5s")

    # --- pacing beats -----------------------------------------------------
    beats = sorted({0.0, dur}
                   | {s["out_start"] for s in shots}
                   | {c["start"] for c in cards}
                   | {float(o["start"]) for o in sidecar.get("overlays", [])})
    worst_gap, worst_at = 0.0, 0.0
    for a, b in zip(beats, beats[1:]):
        if b - a > worst_gap:
            worst_gap, worst_at = b - a, a
    if worst_gap > 3.0:
        rep.add(WARN, "beat cadence",
                f"{worst_gap:.1f}s with nothing changing at {worst_at:.1f}s",
                "Something should change every 1.5-3s: a cut, a punch-in, "
                "a caption, an overlay.")
    else:
        rep.add(PASS, "beat cadence", f"longest still stretch {worst_gap:.1f}s")

    # --- pattern interrupts ----------------------------------------------
    hard = sorted({0.0} | {s["out_start"] for s in shots} | {dur})
    worst_pi = max((b - a for a, b in zip(hard, hard[1:])), default=dur)
    if dur > 12 and worst_pi > 12.0:
        rep.add(WARN, "pattern interrupt",
                f"{worst_pi:.1f}s with no cut or punch-in",
                "Unbroken talking-head is the most common drop-off point.")
    else:
        rep.add(PASS, "pattern interrupt", f"longest single shot {worst_pi:.1f}s")

    # --- safe zone --------------------------------------------------------
    y = cap["baseline_y"]
    half = cap["font_size"]
    if y - half < safe["top"] or y + half > safe["bottom"]:
        rep.add(FAIL, "safe zone", f"captions centred at y={y}",
                f"Platform UI covers outside {safe['top']}-{safe['bottom']}px.")
    else:
        rep.add(PASS, "safe zone",
                f"captions y={y} inside {safe['top']}-{safe['bottom']}")

    bad_ov = [o for o in sidecar.get("overlays", [])
              if not (safe["top"] <= o.get("y", style["overlay"]["top_y"])
                      <= safe["bottom"])]
    if bad_ov:
        rep.add(FAIL, "overlay safe zone", f"{len(bad_ov)} overlay(s) outside",
                "Same UI problem as captions.")

    # --- audio ------------------------------------------------------------
    lufs, peak = loudness(video)
    target = style["audio"]["target_lufs"]
    ceiling = style["audio"]["true_peak"]
    if lufs is None:
        rep.add(WARN, "loudness", "could not measure")
    elif abs(lufs - target) <= 1.5:
        rep.add(PASS, "loudness", f"{lufs} LUFS, peak {peak} dBFS")
    elif lufs < target and peak is not None and peak >= ceiling - 0.6:
        rep.add(WARN, "loudness",
                f"{lufs} LUFS, peak {peak} dBFS (target {target})",
                "Peak-limited: the source is too spiky to raise further without "
                "clipping. Usually means recording level was too hot. "
                "Not fixable in the edit.")
    else:
        rep.add(WARN, "loudness", f"{lufs} LUFS, peak {peak} dBFS "
                f"(target {target})",
                "Quiet against the feed. Platforms normalise anyway, and their "
                "version is usually worse than doing it here.")

    # --- the ending -------------------------------------------------------
    if cards:
        tail = dur - max(c["end"] for c in cards)
        if tail > 0.8:
            rep.add(WARN, "trailing dead air", f"{tail:.1f}s after the last word",
                    "Dead frames at the end break the loop and cost rewatches.")
        else:
            rep.add(PASS, "trailing dead air", f"{tail:.2f}s")


def main():
    ap = argparse.ArgumentParser(description="Pass 3: QC the rendered clip.")
    ap.add_argument("video")
    ap.add_argument("--sidecar", default=None,
                    help="the .render.json written by build.py")
    ap.add_argument("--json", default=None, help="write the report as JSON")
    args = ap.parse_args()

    if not os.path.exists(args.video):
        sys.exit(f"No such file: {args.video}")

    sidecar_path = args.sidecar
    if not sidecar_path:
        d = os.path.join(os.path.dirname(args.video) or ".", ".work")
        stem = os.path.splitext(os.path.basename(args.video))[0]
        sidecar_path = os.path.join(d, f"{stem}.render.json")
    if not os.path.exists(sidecar_path):
        sys.exit(f"Sidecar not found: {sidecar_path}\nRender with build.py first.")

    sidecar = json.load(open(sidecar_path))
    style = json.load(open(sidecar["style"]))

    rep = Report()
    check(args.video, sidecar, style, rep)

    print(f"\nQC -- {os.path.basename(args.video)}\n")
    print(rep.render())

    counts = {lvl: sum(1 for r in rep.rows if r["level"] == lvl)
              for lvl in (PASS, WARN, FAIL)}
    print(f"\n{counts[PASS]} pass, {counts[WARN]} warn, {counts[FAIL]} fail")

    if args.json:
        with open(args.json, "w") as f:
            json.dump({"video": args.video, "counts": counts,
                       "rows": rep.rows}, f, indent=2)

    if rep.failed:
        print("\nBlocked. Fix the FAIL rows and re-render before posting.")
        sys.exit(1)
    print("\nClear to post." if counts[WARN] == 0
          else "\nShippable, but read the WARN rows first.")


if __name__ == "__main__":
    main()
