#!/usr/bin/env python3
"""Pass 1: look at the raw clip and report what's in it.

Produces two files next to each other in work/:
  <name>.analysis.json   machine-readable: word timings, silences, loudness, geometry
  <name>.transcript.md   human-readable: timestamped transcript + the numbers that
                         decide the edit, so a person (or Claude) can write the plan.

This pass never modifies or renders video. It only measures.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def probe(path):
    r = run(["ffprobe", "-v", "error", "-print_format", "json",
             "-show_format", "-show_streams", path])
    if r.returncode != 0:
        sys.exit(f"ffprobe failed on {path}:\n{r.stderr}")
    data = json.loads(r.stdout)

    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if video is None:
        sys.exit(f"{path} has no video stream.")

    num, _, den = video.get("r_frame_rate", "30/1").partition("/")
    fps = float(num) / float(den or 1)

    return {
        "duration": float(data["format"]["duration"]),
        "width": int(video["width"]),
        "height": int(video["height"]),
        "fps": round(fps, 3),
        "has_audio": audio is not None,
        "video_codec": video.get("codec_name"),
        "audio_codec": audio.get("codec_name") if audio else None,
    }


def extract_audio(path, wav_path):
    r = run(["ffmpeg", "-y", "-v", "error", "-i", path,
             "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wav_path])
    if r.returncode != 0:
        sys.exit(f"audio extraction failed:\n{r.stderr}")


def detect_silences(wav_path, noise_db, min_dur):
    """ffmpeg silencedetect -> list of {start,end}. These are the cut candidates."""
    r = run(["ffmpeg", "-v", "info", "-i", wav_path,
             "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}",
             "-f", "null", "-"])
    log = r.stderr
    starts = [float(m) for m in re.findall(r"silence_start: (-?[\d.]+)", log)]
    ends = [float(m) for m in re.findall(r"silence_end: (-?[\d.]+)", log)]
    out = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else None
        out.append({"start": round(max(s, 0.0), 3),
                    "end": round(e, 3) if e is not None else None})
    return out


def measure_loudness(wav_path):
    r = run(["ffmpeg", "-v", "info", "-i", wav_path,
             "-af", "ebur128=peak=true", "-f", "null", "-"])
    m = re.findall(r"I:\s+(-?[\d.]+)\s+LUFS", r.stderr)
    peak = re.findall(r"Peak:\s+(-?[\d.]+)\s+dBFS", r.stderr)
    return {
        "integrated_lufs": float(m[-1]) if m else None,
        "true_peak_dbfs": float(peak[-1]) if peak else None,
    }


def transcribe(wav_path, model_size, language):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("faster-whisper is not installed. Run: viral/setup.sh")

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        wav_path,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )

    words, segs = [], []
    for seg in segments:
        segs.append({"start": round(seg.start, 3),
                     "end": round(seg.end, 3),
                     "text": seg.text.strip()})
        for w in (seg.words or []):
            token = w.word.strip()
            if not token:
                continue
            words.append({"w": token,
                          "start": round(w.start, 3),
                          "end": round(w.end, 3),
                          "conf": round(getattr(w, "probability", 1.0), 3)})
    return words, segs, {"language": info.language,
                         "language_probability": round(info.language_probability, 3)}


def apply_lexicon(words, segs, lexicon):
    """Fix domain words Whisper reliably mangles. Case-insensitive whole-word."""
    if not lexicon:
        return 0
    pairs = [(re.compile(rf"\b{re.escape(k)}\b", re.I), v) for k, v in lexicon.items()]
    n = 0
    for item, key in [(w, "w") for w in words] + [(s, "text") for s in segs]:
        original = item[key]
        fixed = original
        for pat, repl in pairs:
            fixed = pat.sub(repl, fixed)
        if fixed != original:
            item[key] = fixed
            n += 1
    return n


def talk_density(words, duration, window=3.0):
    """Words spoken per rolling window. Finds dead air the transcript alone hides."""
    if not words:
        return []
    out = []
    t = 0.0
    while t < duration:
        n = sum(1 for w in words if t <= w["start"] < t + window)
        out.append({"t": round(t, 1), "words": n})
        t += window
    return out


def write_transcript_md(path, analysis):
    meta, words, segs = analysis["media"], analysis["words"], analysis["segments"]
    gaps = analysis["silences"]

    def ts(x):
        return f"{int(x // 60):d}:{x % 60:05.2f}"

    lines = [
        f"# Transcript — {os.path.basename(analysis['source'])}",
        "",
        f"- Duration: **{meta['duration']:.1f}s**",
        f"- Source: {meta['width']}x{meta['height']} @ {meta['fps']}fps",
        f"- Loudness: {analysis['loudness']['integrated_lufs']} LUFS "
        f"(peak {analysis['loudness']['true_peak_dbfs']} dBFS)",
        f"- Words: {len(words)}   Language: {analysis['asr']['language']} "
        f"({analysis['asr']['language_probability']})",
        "",
        "## Timestamped lines",
        "",
        "Pick the hook from here. Copy the start time of the line you want to open on.",
        "",
    ]
    for s in segs:
        lines.append(f"`{ts(s['start'])} → {ts(s['end'])}`  {s['text']}")
    lines += ["", "## Dead air (cut candidates)", ""]
    if gaps:
        lines.append("| start | end | length |")
        lines.append("|---|---|---|")
        for g in gaps:
            if g["end"] is None:
                continue
            lines.append(f"| {ts(g['start'])} | {ts(g['end'])} | "
                         f"{g['end'] - g['start']:.2f}s |")
    else:
        lines.append("_None over the threshold._")

    lowconf = [w for w in words if w["conf"] < 0.55]
    lines += ["", "## Low-confidence words (check these before they become captions)", ""]
    lines.append(", ".join(f"`{w['w']}`@{ts(w['start'])}" for w in lowconf[:60])
                 if lowconf else "_None._")
    lines.append("")

    with open(path, "w") as f:
        f.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser(description="Pass 1: measure a raw clip.")
    ap.add_argument("source")
    ap.add_argument("--outdir", default="work")
    ap.add_argument("--model", default="small",
                    help="whisper model: tiny/base/small/medium/large-v3")
    ap.add_argument("--language", default=None, help="e.g. en, es. Default: autodetect")
    ap.add_argument("--silence-db", type=float, default=-32.0)
    ap.add_argument("--silence-min", type=float, default=0.35)
    ap.add_argument("--lexicon", default=None, help="JSON map of ASR fixes")
    args = ap.parse_args()

    if not os.path.exists(args.source):
        sys.exit(f"No such file: {args.source}")
    os.makedirs(args.outdir, exist_ok=True)
    stem = os.path.splitext(os.path.basename(args.source))[0]

    meta = probe(args.source)
    print(f"[1/4] {meta['width']}x{meta['height']} @ {meta['fps']}fps, "
          f"{meta['duration']:.1f}s", flush=True)

    if not meta["has_audio"]:
        sys.exit("This clip has no audio track. Captions need speech.")

    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, "audio.wav")
        extract_audio(args.source, wav)

        print("[2/4] measuring silence + loudness", flush=True)
        silences = detect_silences(wav, args.silence_db, args.silence_min)
        loudness = measure_loudness(wav)

        print(f"[3/4] transcribing with whisper '{args.model}' "
              f"(this is the slow part)", flush=True)
        words, segs, asr = transcribe(wav, args.model, args.language)

    lexicon = {}
    if args.lexicon and os.path.exists(args.lexicon):
        lexicon = json.load(open(args.lexicon))
    fixed = apply_lexicon(words, segs, lexicon)

    analysis = {
        "source": os.path.abspath(args.source),
        "media": meta,
        "loudness": loudness,
        "asr": asr,
        "lexicon_fixes": fixed,
        "words": words,
        "segments": segs,
        "silences": silences,
        "talk_density": talk_density(words, meta["duration"]),
    }

    js = os.path.join(args.outdir, f"{stem}.analysis.json")
    md = os.path.join(args.outdir, f"{stem}.transcript.md")
    with open(js, "w") as f:
        json.dump(analysis, f, indent=2)
    write_transcript_md(md, analysis)

    print(f"[4/4] wrote:\n  {js}\n  {md}")
    print(f"\n{len(words)} words, {len(silences)} silence gaps"
          + (f", {fixed} lexicon fixes" if fixed else ""))


if __name__ == "__main__":
    main()
