#!/usr/bin/env python3
"""Turn an analysis into a starting edit plan.

This is the automatic first cut: trim dead air, top-and-tail so the first word
lands immediately, and drop punch-ins on a cadence. It is deliberately
conservative -- aggressive auto-cutting is exactly what makes AI edits feel
choppy and fake. The plan it writes is meant to be edited, not shipped blind.
"""

import argparse
import json
import os


def kept_segments(analysis, min_silence, pad, head_trim):
    dur = analysis["media"]["duration"]
    words = analysis["words"]
    silences = [s for s in analysis["silences"]
                if s["end"] is not None and s["end"] - s["start"] >= min_silence]

    start = words[0]["start"] - head_trim if words else 0.0
    end = min(words[-1]["end"] + 0.25, dur) if words else dur
    start = max(start, 0.0)

    segs, cursor = [], start
    for s in silences:
        cut_a = max(s["start"] + pad, cursor)
        cut_b = min(s["end"] - pad, end)
        if cut_b <= cut_a:
            continue
        if cut_a > cursor + 0.15:
            segs.append({"start": round(cursor, 3), "end": round(cut_a, 3)})
        cursor = max(cursor, cut_b)
    if end > cursor + 0.15:
        segs.append({"start": round(cursor, 3), "end": round(end, 3)})

    return segs or [{"start": round(start, 3), "end": round(end, 3)}]


def punch_ins(analysis, segs, every, dur, scale):
    """Place punch-ins where a new sentence starts, roughly every `every` seconds.

    Anchored to sentence starts rather than ends: after dead air is trimmed the
    ends sit flush against a cut, which leaves no room for the tighter shot.
    The first sentence is skipped on purpose -- the hook is never the place to
    change framing.
    """
    def room(t):
        for x in segs:
            if x["start"] <= t < x["end"]:
                return x["end"] - t
        return 0.0

    out, last = [], -1e9
    for seg in analysis["segments"][1:]:
        t = seg["start"]
        if t - last < every:
            continue
        available = room(t)
        if available < 1.0:
            continue
        out.append({"at": round(t, 3),
                    "dur": round(min(dur, available), 3),
                    "scale": scale})
        last = t
    return out


def main():
    ap = argparse.ArgumentParser(description="analysis.json -> starter edit.json")
    ap.add_argument("analysis")
    ap.add_argument("--out", required=True)
    ap.add_argument("--video-out", default=None)
    ap.add_argument("--style", default="../style/default.json")
    ap.add_argument("--min-silence", type=float, default=0.60,
                    help="only remove dead air longer than this")
    ap.add_argument("--pad", type=float, default=0.12,
                    help="breathing room left on each side of a cut")
    ap.add_argument("--head-trim", type=float, default=0.10)
    ap.add_argument("--punch-every", type=float, default=9.0)
    ap.add_argument("--punch-dur", type=float, default=2.2)
    ap.add_argument("--punch-scale", type=float, default=1.16)
    ap.add_argument("--no-punch", action="store_true")
    args = ap.parse_args()

    analysis = json.load(open(args.analysis))
    segs = kept_segments(analysis, args.min_silence, args.pad, args.head_trim)
    punches = [] if args.no_punch else punch_ins(
        analysis, segs, args.punch_every, args.punch_dur, args.punch_scale)

    stem = os.path.splitext(os.path.basename(analysis["source"]))[0]
    video_out = args.video_out or f"../out/{stem}.mp4"

    kept = sum(s["end"] - s["start"] for s in segs)
    plan = {
        "_note": "Authored in SOURCE time -- the timestamps from transcript.md. "
                 "Edit segments to pick your hook and drop weak lines.",
        "source": analysis["source"],
        "analysis": os.path.abspath(args.analysis),
        "style": args.style,
        "output": video_out,
        "segments": segs,
        "framing": {
            "x_frac": 0.5,
            "y_frac": 0.5,
            "punch_ins": punches
        },
        "captions": {
            "enabled": True,
            "replacements": {}
        },
        "overlays": [],
        "audio": {
            "music": None,
            "music_gain_db": -20
        }
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(plan, f, indent=2)

    print(f"{len(segs)} segments, {kept:.1f}s kept of "
          f"{analysis['media']['duration']:.1f}s "
          f"({len(punches)} punch-ins) -> {args.out}")


if __name__ == "__main__":
    main()
