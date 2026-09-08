#!/usr/bin/env python3
"""Watch a synced folder and run the pipeline as clips land in it.

Built for a Mac that stays on with Google Drive Desktop syncing. The video file
never leaves the machine -- only the small text files travel through Drive, so
Claude can read a transcript and drop back an edit plan without anyone moving
a 200MB clip around.

    1_drop/     you put raw clips here (from your phone, from anywhere)
    2_review/   the transcript appears here a minute later
    3_plans/    the edit plan goes here -- yours or Claude's
    4_ready/    finished vertical clip + its QC report
    _work/      internal state, ignore it

Two things trigger work: a new video in 1_drop, and a new plan in 3_plans.
"""

import argparse
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


def log(msg):
    print(f"{datetime.now():%H:%M:%S}  {msg}", flush=True)


def ensure_layout(root):
    for f in FOLDERS:
        os.makedirs(os.path.join(root, f), exist_ok=True)
    readme = os.path.join(root, "READ ME.txt")
    if not os.path.exists(readme):
        with open(readme, "w") as fh:
            fh.write(
                "Drop a clip in 1_drop.\n\n"
                "A minute or two later a transcript shows up in 2_review.\n"
                "Send that transcript to Claude. Claude puts an edit plan in\n"
                "3_plans, and the finished vertical video lands in 4_ready\n"
                "with a QC report next to it.\n\n"
                "Nothing else to do. Leave this Mac on.\n")


def is_hidden_or_partial(name):
    """Drive and macOS both leave junk mid-sync. Skip it."""
    return (name.startswith(".") or name.startswith("~$")
            or name.endswith((".tmp", ".crdownload", ".part", ".download")))


def settled(path, seen, need=2):
    """True once a file's size has held steady across `need` polls.

    A file still syncing down from Drive keeps growing; transcribing a half-
    written clip produces garbage, so wait for it to stop moving.
    """
    try:
        size = os.path.getsize(path)
    except OSError:
        return False
    if size == 0:
        return False
    prev_size, count = seen.get(path, (None, 0))
    if size == prev_size:
        count += 1
    else:
        count = 0
    seen[path] = (size, count)
    return count >= need


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def python_bin():
    venv = os.path.join(os.path.dirname(HERE), ".venv", "bin", "python")
    return venv if os.path.exists(venv) else sys.executable


def write_note(path, title, body):
    with open(path, "w") as f:
        f.write(f"# {title}\n\n{body}\n")


def handle_video(root, video, opts):
    stem = os.path.splitext(os.path.basename(video))[0]
    work = os.path.join(root, "_work")
    review = os.path.join(root, "2_review")

    log(f"new clip: {os.path.basename(video)} -- transcribing")
    cmd = [python_bin(), os.path.join(HERE, "analyze.py"), video,
           "--outdir", work, "--model", opts.model]
    if opts.language:
        cmd += ["--language", opts.language]
    lex = os.path.join(os.path.dirname(HERE), "lexicon.json")
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

    # A starter plan, so there is always something renderable even with no input.
    plan_path = os.path.join(root, "3_plans", f"{stem}.edit.json")
    if not os.path.exists(plan_path):
        code, out = run([python_bin(), os.path.join(HERE, "scaffold.py"),
                         os.path.join(work, f"{stem}.analysis.json"),
                         "--out", os.path.join(work, f"{stem}.auto.json"),
                         "--video-out", os.path.join(root, "4_ready",
                                                     f"{stem}.mp4"),
                         "--style", os.path.join(os.path.dirname(HERE),
                                                 "style", "default.json")])
        if code == 0:
            log(f"  starter plan ready for {stem}")

    log(f"  transcript in 2_review/{stem}.transcript.md")


def handle_plan(root, plan, opts):
    stem = os.path.splitext(os.path.basename(plan))[0].replace(".edit", "")
    work = os.path.join(root, "_work")
    ready = os.path.join(root, "4_ready")

    analysis = os.path.join(work, f"{stem}.analysis.json")
    if not os.path.exists(analysis):
        log(f"  no analysis for {stem} yet, skipping plan")
        return

    log(f"plan for {stem} -- rendering")
    output = os.path.join(ready, f"{stem}.mp4")
    code, out = run([python_bin(), os.path.join(HERE, "build.py"), plan,
                     "--analysis", analysis, "--output", output])
    if code != 0:
        log(f"  render failed for {stem}")
        write_note(os.path.join(ready, f"{stem}.FAILED.md"),
                   f"Could not render {stem}", "```\n" + out[-2500:] + "\n```")
        return

    code, qc = run([python_bin(), os.path.join(HERE, "check.py"), output,
                    "--json", os.path.join(work, f"{stem}.qc.json")])
    verdict = "BLOCKED" if code != 0 else "OK"
    write_note(os.path.join(ready, f"{stem}.QC.txt"),
               f"{stem} -- {verdict}", qc)
    log(f"  done: 4_ready/{stem}.mp4  [{verdict}]")

    done = os.path.join(work, "plans_done")
    os.makedirs(done, exist_ok=True)
    shutil.copy2(plan, os.path.join(done, os.path.basename(plan)))


def plan_is_new(root, plan):
    stem = os.path.splitext(os.path.basename(plan))[0].replace(".edit", "")
    done = os.path.join(root, "_work", "plans_done", os.path.basename(plan))
    if not os.path.exists(done):
        return True
    return os.path.getmtime(plan) > os.path.getmtime(done) + 1


def main():
    ap = argparse.ArgumentParser(description="Watch a folder and edit what lands.")
    ap.add_argument("root", help="the synced folder to watch")
    ap.add_argument("--interval", type=float, default=20.0)
    ap.add_argument("--model", default=os.environ.get("VV_MODEL", "small"))
    ap.add_argument("--language", default=os.environ.get("VV_LANG") or None)
    ap.add_argument("--once", action="store_true", help="one sweep, then exit")
    args = ap.parse_args()

    root = os.path.abspath(os.path.expanduser(args.root))
    ensure_layout(root)
    log(f"watching {root}")
    log(f"  drop clips in 1_drop, finished videos appear in 4_ready")

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
        # settled() wants a size that holds still across polls, so a single
        # sweep can never clear it. Do the whole settle cycle and exit.
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
