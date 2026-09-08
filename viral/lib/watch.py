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


def stage(src, dest_dir, attempts=5, delay=15.0):
    """Copy a dropped clip out of Drive and onto real local disk.

    Google Drive Desktop in "stream" mode leaves a placeholder on disk rather
    than the file. ffmpeg opening one fails with EDEADLK ("resource deadlock
    avoided") because the download has to happen first. Copying it ourselves
    forces that download through an ordinary sequential read, and it also keeps
    ffmpeg off the network filesystem entirely, which is faster and safer.
    """
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.join(dest_dir, os.path.basename(src))
    want = os.path.getsize(src)

    if os.path.exists(dest) and os.path.getsize(dest) == want:
        return dest, None

    last = None
    for attempt in range(attempts):
        try:
            with open(src, "rb") as fin, open(dest, "wb") as fout:
                shutil.copyfileobj(fin, fout, 1024 * 1024)
            if os.path.getsize(dest) == want:
                return dest, None
            last = (f"copied {os.path.getsize(dest)} of {want} bytes -- "
                    f"the file is probably still downloading from Drive")
        except OSError as e:
            last = f"{e.strerror or e} (errno {e.errno})"
            if e.errno not in (errno.EDEADLK, errno.EAGAIN, errno.EBUSY,
                               errno.EIO, errno.ENOENT):
                break
        if attempt < attempts - 1:
            log(f"  waiting for Drive to finish downloading "
                f"{os.path.basename(src)} ({attempt + 1}/{attempts})")
            time.sleep(delay)

    if os.path.exists(dest):
        try:
            os.remove(dest)
        except OSError:
            pass
    return None, last


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


def handle_video(root, video, opts):
    stem = os.path.splitext(os.path.basename(video))[0]
    work = os.path.join(root, "_work")
    review = os.path.join(root, "2_review")

    log(f"new clip: {os.path.basename(video)}")
    local, err = stage(video, os.path.join(STAGING, "clips"))
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

    src_md = os.path.join(work, f"{stem}.transcript.md")
    if os.path.exists(src_md):
        shutil.copy2(src_md, os.path.join(review, f"{stem}.transcript.md"))
    log(f"  ready: 2_review/{stem}.transcript.md")


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
        drop = os.path.join(root, "1_drop")
        for name in sorted(os.listdir(drop)):
            if is_hidden_or_partial(name):
                continue
            path = os.path.join(drop, name)
            if not os.path.isfile(path):
                continue
            if os.path.splitext(name)[1].lower() not in VIDEO_EXT:
                continue
            stem = os.path.splitext(name)[0]
            if os.path.exists(os.path.join(root, "_work",
                                           f"{stem}.analysis.json")):
                continue
            if not settled(path, seen):
                continue
            handle_video(root, path, args)

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
