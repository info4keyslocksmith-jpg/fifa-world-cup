#!/usr/bin/env bash
# One-time setup. Run this once per machine, then never again.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

say() { printf "\n== %s\n" "$1"; }

say "checking ffmpeg"
if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq && sudo apt-get install -y ffmpeg
  else
    echo "Install ffmpeg manually, then re-run." >&2
    echo "  macOS:   brew install ffmpeg" >&2
    echo "  Windows: use WSL, then apt-get install ffmpeg" >&2
    exit 1
  fi
fi
ffmpeg -version | head -1

say "python environment"
python3 -m venv .venv 2>/dev/null || true
if [ -x .venv/bin/pip ]; then
  PIP=.venv/bin/pip
else
  PIP=pip3
  echo "(venv unavailable, installing to the system python)"
fi
$PIP install --quiet --upgrade pip
$PIP install --quiet faster-whisper

say "caption font"
# Any bold sans-serif works. Montserrat ExtraBold is the safe default; if the
# download is blocked, the style falls back to a system font.
mkdir -p fonts
if [ ! -f fonts/Montserrat-ExtraBold.ttf ]; then
  URL="https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf"
  if curl -fsSL "$URL" -o fonts/Montserrat.ttf 2>/dev/null; then
    echo "downloaded Montserrat"
  else
    echo "font download unavailable -- style/default.json will use the system font"
    echo "(set caption.font_name to any bold font installed on this machine)"
  fi
fi

say "ready"
cat <<'EOF'
Drop a clip in viral/in/ and run:

    ./vv auto in/yourclip.mp4

That gives you the automatic first cut plus a QC report. The finished
version comes from editing the plan it writes -- see README.md.
EOF
