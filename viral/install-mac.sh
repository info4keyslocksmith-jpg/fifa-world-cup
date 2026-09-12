#!/usr/bin/env bash
# One-paste installer for macOS.
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/info4keyslocksmith-jpg/fifa-world-cup/claude/viral-video-editing-steps-w3vb16/viral/install-mac.sh)"
#
# Finds the Google Drive folder, installs the tool next to it, and starts the
# watcher. Homebrew is used if it is already there; if not, a standalone ffmpeg
# is fetched instead, so nothing is installed system-wide and no password is
# needed.

set -uo pipefail

REPO="info4keyslocksmith-jpg/fifa-world-cup"
BRANCH="claude/viral-video-editing-steps-w3vb16"
DEST="$HOME/4keys-editor"
DRIVE_FOLDER_NAME="${VV_FOLDER_NAME:-Videos 4keys Claude}"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  ok    %s\n" "$1"; }
warn() { printf "  note  %s\n" "$1"; }
die()  { printf "\n  STOP  %s\n\n" "$1" >&2; exit 1; }

bold ""
bold "4Keys video editor -- setup"
echo

# ---------------------------------------------------------------- 1. the Mac
[ "$(uname)" = "Darwin" ] || die "This installer is for macOS."

if ! command -v python3 >/dev/null 2>&1; then
  die "python3 is missing. Run 'xcode-select --install', accept the prompt,
        wait for it to finish, then paste this command again."
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null \
  || die "python3 is too old. Install a newer Python from python.org, then retry."
ok "python3 $(python3 -c 'import platform;print(platform.python_version())')"

# ------------------------------------------------------- 2. the Drive folder
find_drive_folder() {
  local roots=()
  [ -d "$HOME/Library/CloudStorage" ] && \
    while IFS= read -r d; do roots+=("$d"); done \
      < <(find "$HOME/Library/CloudStorage" -maxdepth 1 -name 'GoogleDrive-*' 2>/dev/null)
  roots+=("$HOME/Google Drive" "$HOME")

  for r in "${roots[@]}"; do
    [ -d "$r" ] || continue
    local hit
    hit="$(find "$r" -maxdepth 4 -type d -name "$DRIVE_FOLDER_NAME" -print -quit 2>/dev/null)"
    [ -n "$hit" ] && { printf '%s' "$hit"; return 0; }
  done
  return 1
}

if [ -n "${VV_FOLDER:-}" ]; then
  FOLDER="$VV_FOLDER"
  [ -d "$FOLDER" ] || die "VV_FOLDER is set but does not exist: $FOLDER"
else
  echo "  ...    looking for your Google Drive folder"
  FOLDER="$(find_drive_folder)" || die "Could not find a folder named
        '$DRIVE_FOLDER_NAME' in Google Drive.

        Make sure Google Drive for desktop is installed and that folder has
        finished syncing. Or run this instead, with the real path:

          VV_FOLDER=\"/path/to/your/folder\" bash -c \"\$(curl -fsSL \\
            https://raw.githubusercontent.com/$REPO/$BRANCH/viral/install-mac.sh)\""
fi
ok "folder: $FOLDER"

# ---------------------------------------------------------------- 3. the tool
echo "  ...    downloading the editor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" \
  | tar xz -C "$TMP" 2>/dev/null \
  || die "Download failed. Check the internet connection and try again."

SRC="$(find "$TMP" -maxdepth 2 -type d -name viral -print -quit)"
[ -n "$SRC" ] || die "Downloaded archive did not contain the editor."

mkdir -p "$DEST"
rm -rf "$DEST/lib" "$DEST/style"
cp -R "$SRC/." "$DEST/"
chmod +x "$DEST/vv" "$DEST/setup.sh" 2>/dev/null
ok "editor installed at $DEST"

# ------------------------------------------------- 4. python + speech model
echo "  ...    setting up the transcriber"
python3 -m venv "$DEST/.venv" >/dev/null 2>&1
PIP="$DEST/.venv/bin/pip"
VENV_PY="$DEST/.venv/bin/python"
[ -x "$PIP" ] || die "Could not create a Python environment at $DEST/.venv"
"$PIP" install --quiet --upgrade pip >/dev/null 2>&1
"$PIP" install --quiet faster-whisper >/dev/null 2>&1 \
  || die "Could not install faster-whisper. Run this to see why:
          $PIP install faster-whisper"
ok "transcriber ready"

# ------------------------------------------------------------------ 5. ffmpeg
fetch_standalone_ffmpeg() {
  "$PIP" install --quiet static-ffmpeg >/dev/null 2>&1 || return 1
  mkdir -p "$DEST/bin"
  "$VENV_PY" - "$DEST/bin" <<'PYEOF' >/dev/null 2>&1 || return 1
import os, shutil, sys
import static_ffmpeg.run as r
dest = sys.argv[1]
for src in r.get_or_fetch_platform_executables_else_raise():
    tgt = os.path.join(dest, os.path.basename(src))
    shutil.copy2(src, tgt)
    os.chmod(tgt, 0o755)
PYEOF
  # Trust nothing: a copied binary is only useful if it actually runs.
  "$DEST/bin/ffmpeg" -version >/dev/null 2>&1 || return 1
  "$DEST/bin/ffprobe" -version >/dev/null 2>&1 || return 1
  return 0
}

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "ffmpeg already installed"
elif command -v brew >/dev/null 2>&1; then
  echo "  ...    installing ffmpeg with Homebrew (a few minutes)"
  if brew install ffmpeg >/dev/null 2>&1; then
    ok "ffmpeg installed"
  else
    warn "Homebrew could not install ffmpeg -- trying the standalone build"
    fetch_standalone_ffmpeg && ok "standalone ffmpeg ready" \
      || die "Could not get a working ffmpeg. Run 'brew install ffmpeg' on its
        own and read the error."
  fi
else
  echo "  ...    fetching a standalone ffmpeg (~50MB, no password needed)"
  if fetch_standalone_ffmpeg; then
    ok "standalone ffmpeg ready -- Homebrew not needed"
  else
    die "Could not fetch a working standalone ffmpeg on this Mac.

        Install Homebrew instead -- paste this, let it finish (it will ask for
        your Mac password), then paste the original command again:

          /bin/bash -c \"\$(curl -fsSL \\
            https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  fi
fi

# -------------------------------------------------------------- 6. the watcher
"$DEST/vv" install-agent "$FOLDER" >/dev/null 2>&1 \
  || die "Could not start the watcher. Run this to see why:
          \"$DEST/vv\" install-agent \"$FOLDER\""

bold ""
bold "Done. The watcher is running and will restart itself after a reboot."
cat <<EOF

Inside your folder you now have:

  1_drop/     put a clip here
  2_review/   the transcript shows up here
  3_plans/    the edit plan goes here
  4_ready/    finished vertical video + QC report

Try it: drag one clip into 1_drop, wait a couple of minutes, then tell Claude
the clip name. The first clip is slower -- it downloads the speech model once.

Watch it work:  tail -f "$DEST/logs/watch.log"
Stop it:        launchctl unload ~/Library/LaunchAgents/com.4keys.viral.watch.plist

EOF
