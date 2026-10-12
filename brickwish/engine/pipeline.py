"""One wish design -> everything the business needs, with no human steps.

    python3 -m engine.pipeline examples/empire-state-building.json --out out/empire-state --code BW-DEMO --builder Mateo

Writes into --out:
    model.json                 bricks, steps, bags, parts list, checks
    manual.pdf                 the full building manual (unlocked after payment)
    preview-1.png..5.png       first 5 pages with a PREVIEW watermark (shown before payment)
    build.mp4, poster.png      9:16 video of the model building itself, then spinning
    viewer.html                interactive 3D version of the video
    parts.csv, bricklink.xml   parts by bag for the supplier
    vendor_order.json, vendor_email.txt
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from .compiler import compile_spec
from .manual import _fonts_css, manual_html
from .palette import COLORS
from .vendor import bricklink_xml, parts_csv, vendor_email, vendor_order

ENGINE = Path(__file__).resolve().parent
THREE_LOCAL = ENGINE / "node_modules/three/build/three.min.js"
THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"


def viewer_html(model, three_src):
    keep = ("title", "title_es", "lang", "steps")
    data = {k: model[k] for k in keep}
    data["bricks"] = [{k: b[k] for k in ("x", "y", "z", "w", "d", "color", "kind", "step")} for b in model["bricks"]]
    data["colors"] = {k: v[0] for k, v in COLORS.items()}
    tpl = (ENGINE / "viewer.html").read_text()
    return (tpl.replace("/*FONTS*/", _fonts_css())
               .replace("{{THREE_SRC}}", three_src)
               .replace("/*MODEL*/null", json.dumps(data, separators=(",", ":"))))


def browser(*args):
    subprocess.run(["node", str(ENGINE / "browser.mjs"), *map(str, args)], check=True)


def run(spec, out, code="DEMO", builder="", video=True, log=print):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    model = compile_spec(spec)
    log(f"compiled: {model['stats']['pieces']} pieces, {model['steps']} steps, {model['bags']} bags, ok={model['ok']}")
    for w in model["warnings"]:
        log(f"  warning: {w}")
    (out / "model.json").write_text(json.dumps(model, indent=1))

    builder = builder or spec.get("builder", "")
    (out / "manual.html").write_text(manual_html(model, code, builder))
    (out / "preview.html").write_text(manual_html(model, code, builder, preview_pages=5))
    browser("pdf", out / "manual.html", out / "manual.pdf")
    browser("pages", out / "preview.html", out, "preview")
    (out / "preview.html").unlink()
    log(f"manual: manual.pdf + 5 preview pages ({time.time() - t0:.0f}s)")

    (out / "viewer.html").write_text(viewer_html(model, THREE_CDN))
    if video:
        rec = out / "_record.html"
        rec.write_text(viewer_html(model, THREE_LOCAL.as_uri()))
        browser("video", rec, out / "build.mp4", out / "poster.png")
        rec.unlink()
        log(f"video: build.mp4 ({time.time() - t0:.0f}s)")

    order = vendor_order(model, code, month=time.strftime("%m/%Y"))
    (out / "parts.csv").write_text(parts_csv(model))
    (out / "bricklink.xml").write_text(bricklink_xml(model))
    (out / "vendor_order.json").write_text(json.dumps(order, indent=1))
    (out / "vendor_email.txt").write_text(vendor_email(order))
    log(f"vendor files ready ({time.time() - t0:.0f}s total)")
    return model


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--out", required=True)
    ap.add_argument("--code", default="DEMO")
    ap.add_argument("--builder", default="")
    ap.add_argument("--no-video", action="store_true")
    a = ap.parse_args(argv)
    spec = json.loads(Path(a.spec).read_text())
    model = run(spec, a.out, a.code, a.builder, video=not a.no_video)
    sys.exit(0 if model["ok"] else 2)


if __name__ == "__main__":
    main()
