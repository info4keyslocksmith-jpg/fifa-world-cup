#!/usr/bin/env python3
"""Update the editor in place, when asked to.

Updating used to mean walking to the Mac and pasting a command, which is no good
when the person is out on a job. Instead an `_update` file dropped into the
watched folder asks for it -- the same channel already used for edit plans.

The rules that make this safe enough to run unattended:

  * it is never on a timer -- nothing changes unless that file appears, so an
    update is always something someone asked for
  * the source is one hard-coded repository and branch, over HTTPS
  * the new version has to be complete and has to compile before anything is
    swapped, so a truncated download cannot take the editor down
  * the old version is kept, and restored if the new one fails to start
"""

import os
import py_compile
import shutil
import subprocess
import tempfile

REPO = "info4keyslocksmith-jpg/fifa-world-cup"
BRANCH = "claude/viral-video-editing-steps-w3vb16"
UPDATE_FLAG = "_update"

TREES = ("lib", "style")
FILES = ("vv", "setup.sh", "lexicon.json", "README.md", "install-mac.sh")
REQUIRED = ("vv", "lib/watch.py", "lib/build.py", "lib/analyze.py",
            "lib/check.py", "lib/subtitles.py", "lib/scaffold.py",
            "lib/selfupdate.py", "style/default.json")
# selfupdate.py is in that list on purpose: an archive without it would install
# a watcher that cannot import its own updater, and could never update again.


def requested(root):
    return os.path.exists(os.path.join(root, UPDATE_FLAG))


def clear_request(root):
    try:
        os.remove(os.path.join(root, UPDATE_FLAG))
    except OSError:
        pass


def _fetch(dest):
    url = f"https://codeload.github.com/{REPO}/tar.gz/refs/heads/{BRANCH}"
    r = subprocess.run(["bash", "-c", f'curl -fsSL "{url}" | tar xz -C "{dest}"'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None, (r.stderr.strip()[:200] or "download failed")
    for name in os.listdir(dest):
        candidate = os.path.join(dest, name, "viral")
        if os.path.isdir(candidate):
            return candidate, None
    return None, "archive did not contain the editor"


def _verify(src):
    """Complete, and every Python file parses. Cheap, and catches the two ways
    an unattended update actually breaks a machine."""
    for rel in REQUIRED:
        path = os.path.join(src, rel)
        if not os.path.exists(path):
            return f"incomplete download, missing {rel}"

    # Compiled output goes to a scratch directory, not /dev/null: py_compile
    # refuses to write a byte-compiled file over a non-regular file, which
    # would fail every update for a reason that has nothing to do with the code.
    scratch = tempfile.mkdtemp()
    try:
        for folder in TREES:
            for base, _, names in os.walk(os.path.join(src, folder)):
                for name in names:
                    if not name.endswith(".py"):
                        continue
                    try:
                        py_compile.compile(
                            os.path.join(base, name), doraise=True,
                            cfile=os.path.join(scratch, name + "c"))
                    except py_compile.PyCompileError as e:
                        return f"{name} does not compile: {e}"
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    return None


def _swap(src, tool_root, backup):
    shutil.rmtree(backup, ignore_errors=True)
    os.makedirs(backup, exist_ok=True)
    for folder in TREES:
        current = os.path.join(tool_root, folder)
        if os.path.isdir(current):
            shutil.copytree(current, os.path.join(backup, folder))
    for name in FILES:
        current = os.path.join(tool_root, name)
        if os.path.exists(current):
            shutil.copy2(current, os.path.join(backup, name))

    for folder in TREES:
        target = os.path.join(tool_root, folder)
        shutil.rmtree(target, ignore_errors=True)
        shutil.copytree(os.path.join(src, folder), target)
    for name in FILES:
        source = os.path.join(src, name)
        if os.path.exists(source):
            shutil.copy2(source, os.path.join(tool_root, name))
    vv = os.path.join(tool_root, "vv")
    if os.path.exists(vv):
        os.chmod(vv, 0o755)


def _starts(tool_root):
    """Does the newly installed watcher actually come up? --help imports the
    whole module and touches nothing."""
    python = os.path.join(tool_root, ".venv", "bin", "python")
    if not os.path.exists(python):
        python = "python3"
    r = subprocess.run([python, os.path.join(tool_root, "lib", "watch.py"),
                        "--help"], capture_output=True, text=True, timeout=60)
    return r.returncode == 0


def rollback(tool_root, backup):
    """Put the previous version back. Used when the new one will not start."""
    if not os.path.isdir(backup):
        return False
    for folder in TREES:
        saved = os.path.join(backup, folder)
        if os.path.isdir(saved):
            target = os.path.join(tool_root, folder)
            shutil.rmtree(target, ignore_errors=True)
            shutil.copytree(saved, target)
    for name in FILES:
        saved = os.path.join(backup, name)
        if os.path.exists(saved):
            shutil.copy2(saved, os.path.join(tool_root, name))
    vv = os.path.join(tool_root, "vv")
    if os.path.exists(vv):
        os.chmod(vv, 0o755)
    return True


def apply(tool_root, log=print):
    """Fetch, verify, swap. Returns True when the caller should restart."""
    tmp = tempfile.mkdtemp()
    try:
        src, err = _fetch(tmp)
        if err:
            log(f"  update failed: {err} -- keeping the current version")
            return False

        problem = _verify(src)
        if problem:
            log(f"  update rejected: {problem} -- keeping the current version")
            return False

        backup = os.path.join(tool_root, ".previous")
        _swap(src, tool_root, backup)

        # Compiling proves the files parse; this proves they actually import
        # and start. An unattended machine must never be left with an editor
        # that cannot boot.
        if not _starts(tool_root):
            log("  new version would not start -- rolling back")
            rollback(tool_root, backup)
            return False

        log("  updated -- restarting")
        return True
    except OSError as e:
        log(f"  update failed: {e} -- keeping the current version")
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
