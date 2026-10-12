"""Design Agent: a kid's wish -> a buildable design spec, with no human in the loop.

Claude follows engine/DESIGN_GUIDE.md: every wish gets built, the level sets size and detail.
It writes a spec, calls build_preview to compile it with the brick engine and *look* at the result
(front and back pictures + piece count + connection checks), fixes problems, and calls submit_design
once the model passes.

    from agents.design_agent import design
    spec = design({"wish": "san francisco bridge", "level": 4, "age": "10-12", "extras": [], "colors": []})

Needs ANTHROPIC_API_KEY (or an `ant auth login` profile), Node 18+ and the engine's npm packages.
Refusals fall back server-side to the model Anthropic recommends for that category (fallbacks="default").
"""

import base64
import json
import subprocess
import tempfile
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "engine" / "cli.js"
MODEL = "claude-opus-5-5"
MAX_PREVIEWS = 6
LEVELS = {1: (100, 250), 2: (300, 600), 3: (700, 1200), 4: (1300, 2400), 5: (2500, 4500), 6: (5000, 8000)}

SYSTEM = (ROOT / "engine" / "DESIGN_GUIDE.md").read_text() + """

## Tools in this conversation
- build_preview(spec): compiles the spec and returns the report (ok, pieces, level_range, warnings...) and
  a picture of the front and back. Call it after every change.
- submit_design(spec, title, parent_note): submit the final spec. Only after a build_preview of the same spec
  returned ok: true.
"""

TOOLS = [
    {
        "name": "build_preview",
        "description": "Compile a design spec into bricks and return piece count, level range, warnings and front/back pictures.",
        "input_schema": {"type": "object", "properties": {"spec": {"type": "object", "description": "The complete spec JSON."}},
                         "required": ["spec"]},
    },
    {
        "name": "submit_design",
        "description": "Submit the final spec. Only call this after a build_preview of the same spec returned ok: true.",
        "input_schema": {
            "type": "object",
            "properties": {
                "spec": {"type": "object", "description": "The final spec JSON."},
                "title": {"type": "string", "description": "Short title for the box and manual, e.g. 'Golden Gate Bridge'."},
                "parent_note": {"type": "string", "description": "One sentence for the parent if the design differs from the wish "
                                "(e.g. a generic version of a character). Empty string otherwise."},
            },
            "required": ["spec", "title", "parent_note"],
        },
    },
]


class DesignFailed(RuntimeError):
    pass


def engine_preview(spec, picture=True):
    """Run the brick engine on a spec. Returns (report dict, base64 PNG or None)."""
    with tempfile.TemporaryDirectory() as d:
        spec_path, png = Path(d, "spec.json"), Path(d, "preview.png")
        spec_path.write_text(json.dumps(spec))
        args = ["node", str(CLI), "preview", str(spec_path)] + ([str(png)] if picture else [])
        run = subprocess.run(args, capture_output=True, text=True, timeout=300)
        if run.returncode not in (0, 2):
            raise DesignFailed(f"engine error: {run.stderr[-500:]}")
        report = json.loads(run.stdout.strip().splitlines()[-1])
        image = base64.standard_b64encode(png.read_bytes()).decode() if picture and png.exists() else None
        return report, image


def _force(spec, order):
    """The order, not the model, decides the level, the age and the child's words."""
    spec = dict(spec)
    spec["level"], spec["age"], spec["wish"] = int(order["level"]), order["age"], order["wish"]
    return spec


def _order_message(order):
    lo, hi = LEVELS[int(order["level"])]
    lines = [f"The child's wish: \"{order['wish']}\"",
             f"Level: {order['level']} ({lo:,}-{hi:,} pieces)",
             f"Builder age: {order['age']}"]
    if order.get("extras"):
        lines.append(f"Extras the child picked: {', '.join(order['extras'])}")
    if order.get("colors"):
        lines.append(f"Colors the child picked: {', '.join(order['colors'])}")
    elif order.get("surprise"):
        lines.append("Colors: surprise me (choose cheerful colors that suit the subject)")
    lines.append("Design it, check it with build_preview, then submit it. Remember rule 1: every wish gets built.")
    return "\n".join(lines)


def design(order, client=None, log=print):
    """Run the design loop for one order. Returns the final spec (with title and parent_note)."""
    client = client or anthropic.Anthropic()
    messages = [{"role": "user", "content": _order_message(order)}]
    previews = 0
    last_ok = None
    for _ in range(MAX_PREVIEWS * 2 + 4):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=32000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "high"},
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            tools=TOOLS,
            messages=messages,
        )
        if response.stop_reason == "refusal":
            raise DesignFailed(f"design declined ({response.stop_details.category if response.stop_details else 'unknown'})")
        messages.append({"role": "assistant", "content": response.content})
        calls = [b for b in response.content if b.type == "tool_use"]
        if not calls:
            messages.append({"role": "user", "content": "Please continue: call build_preview, or submit_design if the last preview was ok."})
            continue
        results = []
        for call in calls:
            if call.name == "build_preview":
                previews += 1
                spec = _force(call.input.get("spec", {}), order)
                report, image = engine_preview(spec)
                log(f"  preview {previews}: {report.get('pieces', '?')} pieces, ok={report.get('ok')}")
                if report.get("ok"):
                    last_ok = spec
                content = [{"type": "text", "text": json.dumps(report)}]
                if image:
                    content.append({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image}})
                if previews >= MAX_PREVIEWS:
                    content.append({"type": "text", "text": "That was the last preview. Submit your best design now."})
                results.append({"type": "tool_result", "tool_use_id": call.id, "content": content,
                                "is_error": "error" in report})
            elif call.name == "submit_design":
                spec = _force(call.input.get("spec", {}), order)
                report, _ = engine_preview(spec, picture=False)
                if report.get("ok"):
                    spec["title"] = call.input.get("title") or spec.get("title") or "My build"
                    spec["parent_note"] = call.input.get("parent_note", "")
                    return spec
                problems = report.get("warnings") or [report.get("error", "not buildable")]
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True,
                                "content": "Not accepted: " + "; ".join(problems)})
            else:
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True, "content": f"Unknown tool {call.name}"})
        messages.append({"role": "user", "content": results})
    if last_ok:
        return last_ok
    raise DesignFailed("no buildable design after the preview limit")
