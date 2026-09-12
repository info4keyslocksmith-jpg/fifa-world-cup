#!/usr/bin/env python3
"""Pass 2: turn an edit plan into the finished vertical clip.

edit.json is authored in SOURCE time (the timestamps you read in transcript.md).
This module remaps everything onto the output timeline after the cuts are applied,
so you never have to do that arithmetic by hand.

Punch-ins are hard cuts to a tighter framing, not animated zooms. That is the
frame-accurate version of the move and it is what the pacing research describes:
something changes on a beat, rather than drifting.
"""

import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import subtitles  # noqa: E402


def load(path):
    with open(path) as f:
        return json.load(f)


MIN_SHOT = 0.25  # a shot shorter than this reads as a glitch, not a cut


def collapse_marks(marks, min_gap):
    """Drop cut points that would produce a sliver of a shot."""
    if len(marks) < 3:
        return marks
    kept = [marks[0]]
    for m in marks[1:-1]:
        if m - kept[-1] >= min_gap:
            kept.append(m)
    while len(kept) > 1 and marks[-1] - kept[-1] < min_gap:
        kept.pop()
    kept.append(marks[-1])
    return kept


def resolve_sources(plan, rel):
    """Normalise one-clip and many-clip plans into the same shape.

    A single job is usually filmed in pieces, so a plan may draw from several
    clips. Older single-source plans keep working: they become a one-entry list.
    """
    if plan.get("sources"):
        out = []
        for i, src in enumerate(plan["sources"]):
            sid = str(src.get("id", i))
            out.append({"id": sid,
                        "path": rel(src["path"]),
                        "analysis": rel(src["analysis"])})
        return out
    return [{"id": "main",
             "path": rel(plan.get("source")),
             "analysis": rel(plan["analysis"])}]


def build_shots(plan, sources):
    """Segments split at punch-in boundaries -> a flat list of shots.

    Each shot remembers which clip it came from, so the renderer can pull it
    from the right input.
    """
    framing = plan.get("framing", {})
    base_x = framing.get("x_frac", 0.5)
    base_y = framing.get("y_frac", 0.5)
    all_punches = framing.get("punch_ins", [])
    default_id = sources[0]["id"]
    known = {s["id"] for s in sources}

    shots = []
    for seg in plan["segments"]:
        sid = str(seg.get("source", default_id))
        if sid not in known:
            sys.exit(f"Segment names unknown source '{sid}': {seg}")
        s, e = float(seg["start"]), float(seg["end"])
        if e <= s:
            sys.exit(f"Segment end must be after start: {seg}")

        punches = sorted(
            (p for p in all_punches if str(p.get("source", default_id)) == sid),
            key=lambda p: p["at"])

        marks = [s, e]
        for p in punches:
            a = float(p["at"])
            b = a + float(p.get("dur", 2.0))
            for m in (a, b):
                if s < m < e:
                    marks.append(m)
        marks = collapse_marks(sorted(set(marks)), MIN_SHOT)

        for i in range(len(marks) - 1):
            a, b = marks[i], marks[i + 1]
            mid = (a + b) / 2
            zoom, xf, yf = 1.0, base_x, base_y
            for p in punches:
                if float(p["at"]) <= mid < float(p["at"]) + float(p.get("dur", 2.0)):
                    zoom = float(p.get("scale", 1.18))
                    xf = float(p.get("x_frac", base_x))
                    yf = float(p.get("y_frac", base_y))
                    break
            shots.append({"source": sid, "src_start": a, "src_end": b,
                          "zoom": zoom, "x_frac": xf, "y_frac": yf})
    return shots


def timeline(shots):
    """Attach output-time offsets; return (shots, total_duration)."""
    t = 0.0
    for sh in shots:
        sh["out_start"] = t
        t += sh["src_end"] - sh["src_start"]
        sh["out_end"] = t
    return shots, t


def map_time(shots, t, source=None, clamp_into=None):
    """Source-clip time -> finished-video time, for one clip's shots."""
    pool = [sh for sh in shots if source is None or sh["source"] == source]
    for sh in pool:
        if sh["src_start"] <= t < sh["src_end"]:
            return sh["out_start"] + (t - sh["src_start"])
    if clamp_into is not None:
        for sh in pool:
            if sh["src_start"] <= clamp_into < sh["src_end"]:
                return min(sh["out_start"] + (t - sh["src_start"]), sh["out_end"])
    return None


def remap_words(words, shots, replacements, source=None):
    out = []
    for w in words:
        start = map_time(shots, w["start"], source)
        if start is None:
            continue
        end = map_time(shots, w["end"], source, clamp_into=w["start"])
        if end is None or end <= start:
            end = start + 0.12
        if end - start < 0.06:
            continue      # a word sliced in half by a cut is not a caption
        token = w["w"]
        for k, v in (replacements or {}).items():
            if token.strip(".,!?").lower() == k.lower():
                token = token.replace(token.strip(".,!?"), v)
        out.append({"w": token, "start": start, "end": end,
                    "conf": w.get("conf", 1.0)})
    return out


def remap_overlays(overlays, shots, total, default_source):
    out = []
    for ov in overlays or []:
        osrc = str(ov.get("source", default_source))
        start = map_time(shots, float(ov["start"]), osrc)
        if start is None:
            continue
        end = map_time(shots, float(ov["end"]), osrc,
                       clamp_into=float(ov["start"]))
        if end is None or end <= start:
            end = min(start + 2.0, total)
        item = dict(ov)
        item["start"], item["end"] = start, end
        out.append(item)
    return out


def esc_filter_path(path):
    """Escape a path for use inside a filtergraph option value."""
    return path.replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


def audio_filtergraph(shots, plan, has_music, tail, index_of):
    """Audio-only graph, used for the loudness measuring pass."""
    parts, labels = [], []
    for i, sh in enumerate(shots):
        d = sh["src_end"] - sh["src_start"]
        fade = max(d - 0.012, 0.0)
        n = index_of[sh["source"]]
        parts.append(
            f"[{n}:a]atrim=start={sh['src_start']:.3f}:end={sh['src_end']:.3f},"
            f"asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=0.012,afade=t=out:st={fade:.3f}:d=0.012[a{i}]")
        labels.append(f"[a{i}]")
    parts.append("".join(labels) + f"concat=n={len(shots)}:v=0:a=1[ac]")
    if has_music:
        gain = plan.get("audio", {}).get("music_gain_db", -18)
        mi = len(set(index_of.values()))
        parts.append(f"[{mi}:a]volume={gain}dB,aloop=loop=-1:size=2e9[mus]")
        parts.append("[ac][mus]amix=inputs=2:duration=first:dropout_transition=0[pre]")
    else:
        parts.append("[ac]anull[pre]")
    parts.append("[pre]" + tail + "[aout]")
    return ";".join(parts)


def measure_loudness(inputs, music, shots, plan, target, tp, index_of):
    """First loudnorm pass. Single-pass normalisation lands 2-3 LU off target;
    feeding it real measurements is what actually hits the number."""
    tail = f"loudnorm=I={target}:TP={tp}:LRA=11:print_format=json"
    fg = audio_filtergraph(shots, plan, bool(music), tail, index_of)
    cmd = ["ffmpeg", "-v", "info"]
    for path in inputs:
        cmd += ["-i", path]
    if music:
        cmd += ["-i", music]
    cmd += ["-filter_complex", fg, "-map", "[aout]", "-f", "null", "-"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        blob = r.stderr[r.stderr.rindex("{"):]
        blob = blob[:blob.index("}") + 1]
        data = json.loads(blob)
        return {k: data[k] for k in ("input_i", "input_tp", "input_lra",
                                     "input_thresh", "target_offset")}
    except (ValueError, KeyError):
        return None


def build_filtergraph(shots, style, ass_path, plan, has_music, index_of,
                      preview=False, measured=None):
    canvas = style["canvas"]
    W, H = canvas["width"], canvas["height"]
    fps = style["encode"]["fps"]
    parts, vlabels, alabels = [], [], []

    for i, sh in enumerate(shots):
        d = sh["src_end"] - sh["src_start"]
        zw = int(round(W * sh["zoom"]))
        zh = int(round(H * sh["zoom"]))
        n = index_of[sh["source"]]
        parts.append(
            f"[{n}:v]trim=start={sh['src_start']:.3f}:end={sh['src_end']:.3f},"
            f"setpts=PTS-STARTPTS,"
            f"scale={zw}:{zh}:force_original_aspect_ratio=increase,"
            f"crop={W}:{H}:(in_w-out_w)*{sh['x_frac']:.4f}:(in_h-out_h)*{sh['y_frac']:.4f},"
            f"setsar=1,fps={fps}[v{i}]")
        fade = max(d - 0.012, 0.0)
        parts.append(
            f"[{n}:a]atrim=start={sh['src_start']:.3f}:end={sh['src_end']:.3f},"
            f"asetpts=PTS-STARTPTS,"
            f"afade=t=in:st=0:d=0.012,afade=t=out:st={fade:.3f}:d=0.012[a{i}]")
        vlabels.append(f"[v{i}]")
        alabels.append(f"[a{i}]")

    parts.append("".join(v + a for v, a in zip(vlabels, alabels))
                 + f"concat=n={len(shots)}:v=1:a=1[vc][ac]")

    post = "" if not preview else ",scale=540:960"
    parts.append(f"[vc]subtitles='{esc_filter_path(ass_path)}'{post}[vout]")

    au = plan.get("audio", {})
    target = au.get("target_lufs", style["audio"]["target_lufs"])
    tp = au.get("true_peak", style["audio"]["true_peak"])

    ln = f"loudnorm=I={target}:TP={tp}:LRA=11"
    if measured:
        ln += (f":measured_I={measured['input_i']}"
               f":measured_TP={measured['input_tp']}"
               f":measured_LRA={measured['input_lra']}"
               f":measured_thresh={measured['input_thresh']}"
               f":offset={measured['target_offset']}:linear=true")

    if has_music:
        gain = au.get("music_gain_db", -18)
        mi = len(set(index_of.values()))
        parts.append(f"[{mi}:a]volume={gain}dB,aloop=loop=-1:size=2e9[mus]")
        parts.append("[ac][mus]amix=inputs=2:duration=first:dropout_transition=0[amix]")
        parts.append(f"[amix]{ln}[aout]")
    else:
        parts.append(f"[ac]{ln}[aout]")

    return ";".join(parts)


def main():
    ap = argparse.ArgumentParser(description="Pass 2: render the edit plan.")
    ap.add_argument("plan")
    ap.add_argument("--analysis", default=None,
                    help="override the analysis (single-source plans only)")
    ap.add_argument("--style", default=None)
    ap.add_argument("--output", default=None)
    ap.add_argument("--preview", action="store_true",
                    help="fast 540x960 draft for checking the edit")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    plan = load(args.plan)
    root = os.path.dirname(os.path.abspath(args.plan))

    def rel(p):
        return p if os.path.isabs(p) else os.path.normpath(os.path.join(root, p))

    style_path = args.style or rel(plan.get("style", "../style/default.json"))
    style = load(style_path)

    sources = resolve_sources(plan, rel)
    if args.analysis and len(sources) == 1:
        sources[0]["analysis"] = args.analysis
    for src in sources:
        if not os.path.exists(src["path"]):
            sys.exit(f"Clip not found: {src['path']}")
        if not os.path.exists(src["analysis"]):
            sys.exit(f"Analysis not found for {src['path']}: {src['analysis']}")
        src["data"] = load(src["analysis"])

    index_of = {src["id"]: i for i, src in enumerate(sources)}
    inputs = [src["path"] for src in sources]

    output = args.output or rel(plan.get("output", "../out/final.mp4"))
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)

    shots, total = timeline(build_shots(plan, sources))
    if not shots:
        sys.exit("Plan produced no shots. Check 'segments'.")

    cap_cfg = plan.get("captions", {})
    words = []
    if cap_cfg.get("enabled", True):
        for src in sources:
            words += remap_words(src["data"]["words"], shots,
                                 cap_cfg.get("replacements"), src["id"])
        words.sort(key=lambda w: w["start"])
    overlays = remap_overlays(plan.get("overlays"), shots, total, sources[0]["id"])

    work = os.path.join(os.path.dirname(output) or ".", ".work")
    os.makedirs(work, exist_ok=True)
    stem = os.path.splitext(os.path.basename(output))[0]
    ass_path = os.path.join(work, f"{stem}.ass")

    ass, cards = subtitles.generate(words, style, total, overlays)
    with open(ass_path, "w") as f:
        f.write(ass)

    music = plan.get("audio", {}).get("music")
    music = rel(music) if music else None
    if music and not os.path.exists(music):
        sys.exit(f"Music file not found: {music}")

    measured = None
    if not args.dry_run and not args.preview:
        au = plan.get("audio", {})
        print("measuring loudness (pass 1 of 2)", flush=True)
        measured = measure_loudness(
            inputs, music, shots, plan,
            au.get("target_lufs", style["audio"]["target_lufs"]),
            au.get("true_peak", style["audio"]["true_peak"]), index_of)
        if measured is None:
            print("  measurement unavailable, falling back to single-pass")

    fg = build_filtergraph(shots, style, ass_path, plan, bool(music), index_of,
                           args.preview, measured)

    enc = style["encode"]
    cmd = ["ffmpeg", "-y", "-v", "warning", "-stats"]
    for path in inputs:
        cmd += ["-i", path]
    if music:
        cmd += ["-i", music]
    cmd += ["-filter_complex", fg, "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-c:a", "aac", "-b:a", enc["audio_bitrate"], "-ar", "48000"]
    if args.preview:
        cmd += ["-crf", "30", "-preset", "ultrafast"]
    else:
        cmd += ["-crf", str(enc["crf"]), "-preset", enc["preset"]]
    cmd += [output]

    sidecar = {
        "output": os.path.abspath(output),
        "sources": [{"id": s["id"], "path": s["path"]} for s in sources],
        "plan": os.path.abspath(args.plan),
        "style": os.path.abspath(style_path),
        "duration": round(total, 3),
        "target_length": plan.get("target_length"),
        "shots": shots,
        "cards": [{"text": " ".join(w["w"] for w in c["words"]),
                   "words": len(c["words"]),
                   "start": round(c["start"], 3),
                   "end": round(c["end"], 3)} for c in cards],
        "overlays": overlays,
        "words": words,
    }
    render_json = os.path.join(work, f"{stem}.render.json")
    with open(render_json, "w") as f:
        json.dump(sidecar, f, indent=2)

    print(f"clips: {len(sources)}   shots: {len(shots)}   "
          f"duration: {total:.2f}s   caption cards: {len(cards)}")
    if args.dry_run:
        print("\n--- filter_complex ---\n" + fg.replace(";", ";\n"))
        return

    if subprocess.run(cmd).returncode != 0:
        sys.exit("ffmpeg failed.")
    print(f"\nwrote {output}\nsidecar {render_json}")


if __name__ == "__main__":
    main()
