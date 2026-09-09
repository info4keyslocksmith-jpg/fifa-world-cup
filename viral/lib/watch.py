#!/usr/bin/env python3
"""Watch a synced folder and run the pipeline as clips land in it.

Built for a Mac that stays on with Google Drive Desktop syncing. Video files
never travel through a conversation -- only the small text files do -- so Claude
can read a transcript and drop back an edit plan without moving a 500MB clip.

    1_drop/     you put raw clips here (from your phone, from anywhere)
    2_review/   a transcript appears here for each clip
    3_plans/    the edit plan goes here -- one clip or many
    4_ready/    finished vertical clip + its QC report
    _work/      internal state, ignore it

Every clip is transcribed on its own. Combining them is the plan's job: a plan
names the clips it wants and the pieces it takes from each, so several clips
become one video.
"""

import argparse
import errno
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}
FOLDERS = ["1_drop", "2_review", "3_plans", "4_ready", "_work"]
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import analyze  # noqa: E402  (contact sheets need no speech model)
TOOL_ROOT = os.path.dirname(HERE)
STAGING = os.path.join(TOOL_ROOT, "staging")


def log(msg):
    print(f"{datetime.now():%H:%M:%S}  {msg}", flush=True)


def ensure_layout(root):
    for f in FOLDERS:
        os.makedirs(os.path.join(root, f), exist_ok=True)
    os.makedirs(STAGING, exist_ok=True)
    readme = os.path.join(root, "READ ME.txt")
    if not os.path.exists(readme):
        with open(readme, "w") as fh:
            fh.write(
                "Drop your clips in 1_drop.\n\n"
                "One job per folder: drag the whole folder in and those clips\n"
                "become one video. Loose clips are treated one at a time.\n\n"
                "A transcript appears in 2_review for each one.\n"
                "Send those to Claude. Claude puts an edit plan in 3_plans --\n"
                "one plan can pull from several clips -- and the finished\n"
                "video lands in 4_ready with a QC report.\n\n"
                "Leave this Mac on. Nothing else to do.\n")


def is_hidden_or_partial(name):
    """Drive and macOS both leave junk mid-sync. Skip it."""
    return (name.startswith(".") or name.startswith("~$")
            or name.endswith((".tmp", ".crdownload", ".part", ".download")))


def settled(path, seen, need=2):
    """True once a file's size has held steady across `need` polls."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return False
    if size == 0:
        return False
    prev_size, count = seen.get(path, (None, 0))
    count = count + 1 if size == prev_size else 0
    seen[path] = (size, count)
    return count >= need


def _copy_python(src, dest):
    with open(src, "rb") as fin, open(dest, "wb") as fout:
        shutil.copyfileobj(fin, fout, 1024 * 1024)


def _copy_tool(tool):
    def go(src, dest):
        r = subprocess.run(tool + [src, dest], capture_output=True, text=True)
        if r.returncode != 0:
            raise OSError(r.stderr.strip() or f"{tool[0]} failed")
    return go


# Ordered by how well each one coaxes a file out of Google Drive's placeholder
# layer. ditto and cp go through macOS copyfile(3), which the File Provider
# understands; a raw read does not always trigger the download.
COPY_STRATEGIES = [
    ("ditto", _copy_tool(["ditto"])),
    ("cp", _copy_tool(["cp"])),
    ("read", _copy_python),
]


def stage(src, dest_dir, name=None, attempts=3, delay=10.0):
    """Copy a dropped clip out of Drive and onto real local disk.

    Google Drive Desktop in "stream" mode leaves a placeholder on disk rather
    than the file, and ffmpeg opening one fails with EDEADLK ("resource
    deadlock avoided"). Copying it ourselves is meant to force the download --
    but not every kind of read does, so we try the ones macOS provides before
    giving up. It also keeps ffmpeg off the network filesystem entirely, which
    is faster and safer regardless.
    """
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, name or os.path.basename(src))
    want = os.path.getsize(src)

    if os.path.exists(dest) and os.path.getsize(dest) == want:
        return dest, None

    errors = []
    for attempt in range(attempts):
        for name, copy in COPY_STRATEGIES:
            try:
                copy(src, dest)
                if os.path.getsize(dest) == want:
                    if name != COPY_STRATEGIES[0][0]:
                        log(f"  copied with {name}")
                    return dest, None
                errors.append(f"{name}: got {os.path.getsize(dest)} of {want} bytes")
            except OSError as e:
                errors.append(f"{name}: {getattr(e, 'strerror', None) or e}")
            if os.path.exists(dest):
                try:
                    os.remove(dest)
                except OSError:
                    pass
        if attempt < attempts - 1:
            log(f"  waiting for Drive to release "
                f"{os.path.basename(src)} ({attempt + 1}/{attempts})")
            time.sleep(delay)

    seen, unique = set(), []
    for e in errors:
        if e not in seen:
            seen.add(e)
            unique.append(e)
    return None, "\n".join(unique)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def python_bin():
    venv = os.path.join(TOOL_ROOT, ".venv", "bin", "python")
    return venv if os.path.exists(venv) else sys.executable


def write_note(path, title, body):
    with open(path, "w") as f:
        f.write(f"# {title}\n\n{body}\n")


DRIVE_HELP = """
This usually means Google Drive is set to "stream" files rather than keep them
on the Mac, so the clip is not really on disk yet.

Fix it once and it stays fixed:

  1. Open Finder and find the 1_drop folder
  2. Right-click it
  3. Choose "Make available offline" (under the Google Drive menu)

Then drop the clip in again.
"""


def handle_video(root, video, stem, job, opts):
    work = os.path.join(root, "_work")
    review = os.path.join(root, "2_review")

    log(f"new clip: {stem}" + (f"  (job: {job})" if job else ""))
    ext = os.path.splitext(video)[1]
    local, err = stage(video, os.path.join(STAGING, "clips"), f"{stem}{ext}")
    if local is None:
        log(f"  could not read {stem} off Drive")
        write_note(os.path.join(review, f"{stem}.FAILED.md"),
                   f"Could not read {os.path.basename(video)}",
                   f"```\n{err}\n```\n{DRIVE_HELP}")
        return

    log(f"  transcribing {stem}")
    cmd = [python_bin(), os.path.join(HERE, "analyze.py"), local,
           "--outdir", work, "--model", opts.model]
    if opts.language:
        cmd += ["--language", opts.language]
    lex = os.path.join(TOOL_ROOT, "lexicon.json")
    if os.path.exists(lex):
        cmd += ["--lexicon", lex]

    code, out = run(cmd)
    if code != 0:
        log(f"  analyze failed for {stem}")
        write_note(os.path.join(review, f"{stem}.FAILED.md"),
                   f"Could not read {os.path.basename(video)}",
                   "```\n" + out[-2500:] + "\n```")
        return

    analysis_path = os.path.join(work, f"{stem}.analysis.json")
    if job and os.path.exists(analysis_path):
        try:
            data = json.load(open(analysis_path))
            data["job"] = job
            with open(analysis_path, "w") as f:
                json.dump(data, f, indent=2)
        except (OSError, ValueError):
            pass

    src_md = os.path.join(work, f"{stem}.transcript.md")
    if os.path.exists(src_md):
        shutil.copy2(src_md, os.path.join(review, f"{stem}.transcript.md"))

    # The contact sheet travels too -- it is what makes the edit sightable.
    sheet = os.path.join(work, f"{stem}.frames.jpg")
    if os.path.exists(sheet):
        shutil.copy2(sheet, os.path.join(review, f"{stem}.frames.jpg"))

    # A failure note from an earlier attempt is now wrong, and two files
    # disagreeing about the same clip is worse than no note at all.
    stale = os.path.join(review, f"{stem}.FAILED.md")
    if os.path.exists(stale):
        try:
            os.remove(stale)
        except OSError:
            pass
    log(f"  ready: 2_review/{stem}.transcript.md")


def iter_drops(drop):
    """Every clip waiting in 1_drop, as (path, stem, job).

    A folder dropped in means "these clips are one video" -- which is how a job
    actually arrives, filmed in pieces. Clips inside a folder are namespaced by
    it, because phones hand out the same filenames over and over and two jobs
    would otherwise collide.
    """
    for name in sorted(os.listdir(drop)):
        if is_hidden_or_partial(name):
            continue
        path = os.path.join(drop, name)

        if os.path.isfile(path):
            if os.path.splitext(name)[1].lower() in VIDEO_EXT:
                yield path, os.path.splitext(name)[0], None

        elif os.path.isdir(path):
            for inner in sorted(os.listdir(path)):
                if is_hidden_or_partial(inner):
                    continue
                inner_path = os.path.join(path, inner)
                if not os.path.isfile(inner_path):
                    continue
                if os.path.splitext(inner)[1].lower() not in VIDEO_EXT:
                    continue
                yield (inner_path,
                       f"{name}__{os.path.splitext(inner)[0]}",
                       name)


def backfill_frames(root):
    """Give already-transcribed clips a contact sheet.

    Clips analysed before contact sheets existed would otherwise stay unseeable
    forever, since a clip with an analysis is never re-analysed. This only needs
    ffmpeg, so it is cheap and skips the speech model entirely.
    """
    work = os.path.join(root, "_work")
    review = os.path.join(root, "2_review")
    if not os.path.isdir(work):
        return

    for name in sorted(os.listdir(work)):
        if not name.endswith(".analysis.json"):
            continue
        stem = name[: -len(".analysis.json")]
        sheet = os.path.join(work, f"{stem}.frames.jpg")
        if os.path.exists(sheet):
            continue

        path = os.path.join(work, name)
        try:
            data = json.load(open(path))
        except (OSError, ValueError):
            continue
        src = data.get("source")
        if not src or not os.path.exists(src) or data.get("frames"):
            continue

        log(f"  building contact sheet for {stem}")
        info = analyze.contact_sheet(src, sheet, data["media"]["duration"])
        if not info:
            continue

        data["frames"] = info
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        analyze.write_transcript_md(os.path.join(work, f"{stem}.transcript.md"),
                                    data)
        shutil.copy2(sheet, os.path.join(review, f"{stem}.frames.jpg"))
        shutil.copy2(os.path.join(work, f"{stem}.transcript.md"),
                     os.path.join(review, f"{stem}.transcript.md"))


def resolve_plan(root, plan_path):
    """Fill in local paths for clips a plan names by name.

    A plan written elsewhere cannot know where the clips ended up on this Mac,
    so it refers to them the way a person would -- by clip name -- and this
    turns that into real paths.
    """
    plan = json.load(open(plan_path))
    work = os.path.join(root, "_work")
    clips_dir = os.path.join(STAGING, "clips")

    sources = plan.get("sources")
    if not sources:
        clip = plan.get("clip")
        if not clip:
            return plan_path, None      # already fully specified
        sources = [{"id": "main", "clip": clip}]

    resolved, missing = [], []
    for i, src in enumerate(sources):
        if src.get("path") and src.get("analysis"):
            resolved.append(src)
            continue
        name = str(src.get("clip", src.get("id", i)))
        stem = os.path.splitext(os.path.basename(name))[0]
        analysis = os.path.join(work, f"{stem}.analysis.json")
        if not os.path.exists(analysis):
            missing.append(stem)
            continue
        path = json.load(open(analysis)).get("source")
        if not path or not os.path.exists(path):
            candidates = [f for f in os.listdir(clips_dir)
                          if os.path.splitext(f)[0] == stem] \
                if os.path.isdir(clips_dir) else []
            if not candidates:
                missing.append(stem)
                continue
            path = os.path.join(clips_dir, candidates[0])
        resolved.append({"id": str(src.get("id", stem)),
                         "path": path, "analysis": analysis})

    if missing:
        return None, missing

    plan["sources"] = resolved
    plan.pop("clip", None)
    out = os.path.join(work, os.path.basename(plan_path).replace(
        ".json", ".resolved.json"))
    with open(out, "w") as f:
        json.dump(plan, f, indent=2)
    return out, None


def handle_plan(root, plan, opts):
    stem = os.path.splitext(os.path.basename(plan))[0].replace(".edit", "")
    work = os.path.join(root, "_work")
    ready = os.path.join(root, "4_ready")

    resolved, missing = resolve_plan(root, plan)
    if missing:
        log(f"  plan {stem} names clips with no transcript yet: {missing}")
        write_note(os.path.join(ready, f"{stem}.FAILED.md"),
                   f"Cannot render {stem} yet",
                   "These clips have not been transcribed yet:\n\n"
                   + "\n".join(f"- {m}" for m in missing)
                   + "\n\nDrop them in 1_drop and wait for their transcripts.")
        return

    log(f"plan for {stem} -- rendering")
    output = os.path.join(ready, f"{stem}.mp4")
    code, out = run([python_bin(), os.path.join(HERE, "build.py"), resolved,
                     "--output", output])
    if code != 0:
        log(f"  render failed for {stem}")
        write_note(os.path.join(ready, f"{stem}.FAILED.md"),
                   f"Could not render {stem}", "```\n" + out[-2500:] + "\n```")
        return

    code, qc = run([python_bin(), os.path.join(HERE, "check.py"), output,
                    "--json", os.path.join(work, f"{stem}.qc.json")])
    verdict = "BLOCKED" if code != 0 else "OK"
    write_note(os.path.join(ready, f"{stem}.QC.txt"), f"{stem} -- {verdict}", qc)
    log(f"  done: 4_ready/{stem}.mp4  [{verdict}]")

    done = os.path.join(work, "plans_done")
    os.makedirs(done, exist_ok=True)
    shutil.copy2(plan, os.path.join(done, os.path.basename(plan)))


def plan_is_new(root, plan):
    done = os.path.join(root, "_work", "plans_done", os.path.basename(plan))
    if not os.path.exists(done):
        return True
    return os.path.getmtime(plan) > os.path.getmtime(done) + 1


def main():
    ap = argparse.ArgumentParser(description="Watch a folder and edit what lands.")
    ap.add_argument("root")
    ap.add_argument("--interval", type=float, default=20.0)
    ap.add_argument("--model", default=os.environ.get("VV_MODEL", "small"))
    ap.add_argument("--language", default=os.environ.get("VV_LANG") or None)
    ap.add_argument("--once", action="store_true")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.root))
    ensure_layout(root)
    log(f"watching {root}")
    log("  drop clips in 1_drop, finished videos appear in 4_ready")

    seen = {}

    def sweep():
        backfill_frames(root)

        drop = os.path.join(root, "1_drop")
        for path, stem, job in iter_drops(drop):
            if os.path.exists(os.path.join(root, "_work",
                                           f"{stem}.analysis.json")):
                continue
            if not settled(path, seen):
                continue
            handle_video(root, path, stem, job, args)

        plans = os.path.join(root, "3_plans")
        for name in sorted(os.listdir(plans)):
            if is_hidden_or_partial(name) or not name.endswith(".json"):
                continue
            path = os.path.join(plans, name)
            if not os.path.isfile(path) or not plan_is_new(root, path):
                continue
            if not settled(path, seen, need=1):
                continue
            handle_plan(root, path, args)

    if args.once:
        for i in range(3):
            if i:
                time.sleep(1.0)
            sweep()
        return

    while True:
        sweep()
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped")
