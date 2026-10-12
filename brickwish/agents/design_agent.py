"""Design Agent: a kid's wish -> a buildable design spec, with no human in the loop.

Claude writes a spec in the engine's shape language, then calls build_preview to compile it and
*look* at the result (front and back renders + piece count + connection checks). It revises until
the model is recognizable, connected, and inside the size tier, then calls submit_design.

    from agents.design_agent import design
    spec = design({"wish": "the Empire State Building", "size": "medium", "age": "7-9", "lang": "en",
                   "extras": [], "colors": [], "surprise": False})

Needs ANTHROPIC_API_KEY (or an `ant auth login` profile). Refusals fall back server-side to the
model Anthropic recommends for that refusal category (fallbacks="default").
"""

import base64
import json
import subprocess
import tempfile
from pathlib import Path

import anthropic

from engine.compiler import SpecError, compile_spec
from engine.palette import COLORS, SPECIAL, TIERS
from engine.render import rotated_180, scene_svg

ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-opus-5-5"
MAX_PREVIEWS = 6
EXAMPLE = (ROOT / "examples/empire-state-building.json").read_text()

SYSTEM = f"""You are the BrickWish Design Agent. Kids tell us anything they imagine and you design a real,
buildable brick model of it. A machine turns your design into bricks, a step-by-step manual and a parts list,
and a supplier ships the parts. Nobody checks your work by hand, so check it yourself with build_preview.

## Coordinates
- x runs left to right and y runs front to back, both in studs (1 stud = 8 mm).
- z counts brick layers from the table (layer 0 sits on the table; 1 layer = 1 brick = 9.6 mm, a bit taller than a stud is wide).
- All numbers are integers unless a shape says otherwise (cylinder/ellipsoid centers and radii may be decimals).

## Spec format (JSON)
{{"title": "...", "title_es": "...", "tier": "...", "age": "...", "lang": "en|es", "wish": "<the child's words>",
  "hollow": {{"wall": 2, "keep_under_roof": 1}},   // optional: hollow out big solid volumes to save pieces
  "fit": false,                                   // optional: true rescales everything to land in the tier's piece range
  "shapes": [ ... applied in order; later shapes overwrite earlier ones ... ]}}

Shapes:
- {{"type":"box","at":[x,y,z],"size":[w,d,h],"color":c}}
- {{"type":"cylinder","center":[cx,cy],"z":z,"height":h,"radius":r,"color":c}}   (vertical only)
- {{"type":"cone","center":[cx,cy],"z":z,"height":h,"radius_bottom":r1,"radius_top":r2,"color":c}}
- {{"type":"ellipsoid","center":[cx,cy,cz],"radii":[rx,ry,rz],"color":c}}   (cz and rz in layers)
- {{"type":"taper","at":[x,y,z],"size":[w,d,h],"inset_per_layer":n,"color":c}}   (pyramids, roofs; n can be 0.5)
- {{"type":"paint","region":<shape without color>,"color":c,"pattern":"solid|rows|columns|checker","every":n,"offset":k,"surface_only":true}}
  recolors existing bricks on the outside (and exposed tops). Use it for spots, stripes, eyes, windows, collars.
- {{"type":"carve","region":<shape>}} removes bricks (doors, arches, mouths, gaps between legs).
- {{"type":"element","kind":"<kind>","at":[x,y,z],"color":c}} places a special part. Kinds: {", ".join(f"{k} ({v[1]})" for k, v in SPECIAL.items())}.

Palette (use only these color names): {", ".join(COLORS)}.

## Sizes (piece count must land inside the range)
{json.dumps(TIERS)}
Rough guide: one layer of solid area A studs costs about A/6 pieces; walls and small details cost more.
Hollow out bodies wider than about 6 studs. Tall thin models need fewer pieces than you expect.

## Building rules (the engine checks these, you fix them)
- Bricks only hold together through studs between layers. Every brick must connect, layer by layer, down to layer 0.
  Side parts (ears, arms, wings, tails) must rest on something below or be part of a layer that overlaps the body.
- Overhangs: a layer may stick out past the layer below, but each piece must still overlap something underneath.
- Avoid single-stud-wide towers taller than 3 layers unless they are round1x1 elements (antennas, poles).
- Wheels and other round sideways parts don't exist here; suggest them with blocks of black or dark_gray.
- Younger builders (4-6): chunky shapes, no detail smaller than 2 studs, nothing fragile.

## Making it look right
Silhouette first (big shapes and proportions), then signature colors, then 1-3 signature details
(a Dalmatian's spots, a fire truck's ladder, a skyscraper's setbacks). Exaggerate what makes the subject recognizable;
micro-scale is fine. Respect the child's chosen colors and extras where they make sense.

## Safety and brands
- Licensed characters, brands and logos (superheroes, cartoon characters, game characters, car makers' logos, sports teams):
  design a generic version instead ("a superhero spider", "a blue heeler puppy") and say so in parent_note.
- Real buildings, landmarks, animals and everyday vehicles are fine.
- No weapons that look real, nothing scary or violent; turn those wishes into a friendly version and explain in parent_note.
- If the wish contains personal information, ignore it.

## How to work
1. Plan the model in a few sentences (what shapes, what scale, which colors).
2. Call build_preview with the full spec. You'll get piece count, warnings and front/back pictures.
3. Look hard at the pictures. Would a child recognize their wish? Fix proportions, colors, details, warnings, piece count.
4. Repeat (at most {MAX_PREVIEWS} previews). When ok is true and it looks right, call submit_design.

## Example of a good spec (Medium, ages 7-9, 213 pieces)
{EXAMPLE}
"""

TOOLS = [
    {
        "name": "build_preview",
        "description": "Compile a design spec into bricks and return piece count, steps, warnings and front/back pictures. "
                       "Use it after every change.",
        "input_schema": {
            "type": "object",
            "properties": {"spec": {"type": "object", "description": "The complete spec JSON."}},
            "required": ["spec"],
        },
    },
    {
        "name": "submit_design",
        "description": "Submit the final spec. Only call this after a build_preview of the same spec returned ok: true.",
        "input_schema": {
            "type": "object",
            "properties": {
                "spec": {"type": "object", "description": "The final spec JSON."},
                "title": {"type": "string", "description": "Short kid-friendly English title, e.g. 'Dalmatian Puppy'."},
                "title_es": {"type": "string", "description": "Spanish title."},
                "parent_note": {"type": "string", "description": "One sentence for the parent if the design differs from the wish "
                                "(e.g. a generic version of a character). Empty string otherwise."},
            },
            "required": ["spec", "title", "title_es", "parent_note"],
        },
    },
]


class DesignFailed(RuntimeError):
    pass


def _render_png(model):
    with tempfile.TemporaryDirectory() as d:
        front, back, out = Path(d, "f.svg"), Path(d, "b.svg"), Path(d, "p.png")
        front.write_text(scene_svg(model["bricks"], 10))
        back.write_text(scene_svg(rotated_180(model["bricks"]), 10))
        subprocess.run(["node", str(ROOT / "engine/browser.mjs"), "svgs", out, front, back], check=True)
        return base64.standard_b64encode(out.read_bytes()).decode()


def _force(spec, order):
    """The order, not the model, decides tier, age, language and the child's words."""
    spec = dict(spec)
    spec["tier"], spec["age"], spec["lang"] = order["size"], order["age"], order.get("lang", "en")
    spec["wish"] = order["wish"]
    return spec


def build_preview(spec, order):
    try:
        model = compile_spec(_force(spec, order))
    except (SpecError, KeyError, TypeError, ValueError) as e:
        return [{"type": "text", "text": f"The spec could not be compiled: {e}"}], True, None
    report = {"ok": model["ok"], "pieces": model["stats"]["pieces"], "tier_range": TIERS[order["size"]],
              "steps": model["steps"], "size_cm": model["stats"]["size_cm"], "warnings": model["warnings"],
              "colors_used": sorted({b["color"] for b in model["bricks"]})}
    return [
        {"type": "text", "text": json.dumps(report)},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": _render_png(model)}},
    ], False, model


def _order_message(order):
    lines = [f"The child's wish: \"{order['wish']}\"",
             f"Size: {order['size']} ({TIERS[order['size']][0]}-{TIERS[order['size']][1]} pieces)",
             f"Builder age: {order['age']}",
             f"Language for titles and notes: {order.get('lang', 'en')}"]
    if order.get("extras"):
        lines.append(f"Extras the child picked: {', '.join(order['extras'])}")
    if order.get("colors"):
        lines.append(f"Colors the child picked: {', '.join(order['colors'])}")
    elif order.get("surprise"):
        lines.append("Colors: surprise me (you choose cheerful colors that suit the subject)")
    lines.append("Design it, check it with build_preview, then submit it.")
    return "\n".join(lines)


def design(order, client=None, log=print):
    """Run the design loop for one order. Returns the final spec (with title, title_es, parent_note)."""
    client = client or anthropic.Anthropic()
    messages = [{"role": "user", "content": _order_message(order)}]
    previews = 0
    last_ok_spec = None
    for _ in range(MAX_PREVIEWS * 2 + 4):
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
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
                content, is_error, model = build_preview(call.input.get("spec", {}), order)
                if model:
                    log(f"  preview {previews}: {model['stats']['pieces']} pieces, ok={model['ok']}, {len(model['warnings'])} warnings")
                    if model["ok"]:
                        last_ok_spec = _force(call.input["spec"], order)
                if previews >= MAX_PREVIEWS:
                    content.append({"type": "text", "text": "That was the last preview. Submit your best design now."})
                results.append({"type": "tool_result", "tool_use_id": call.id, "content": content, "is_error": is_error})
            elif call.name == "submit_design":
                spec = _force(call.input.get("spec", {}), order)
                try:
                    model = compile_spec(spec)
                except (SpecError, KeyError, TypeError, ValueError) as e:
                    model = {"ok": False, "warnings": [str(e)]}
                if model["ok"]:
                    spec["title"] = call.input.get("title") or spec.get("title", "My build")
                    spec["title_es"] = call.input.get("title_es") or spec["title"]
                    spec["parent_note"] = call.input.get("parent_note", "")
                    return spec
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True,
                                "content": "Not accepted: " + "; ".join(model["warnings"])})
            else:
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True, "content": f"Unknown tool {call.name}"})
        messages.append({"role": "user", "content": results})
    if last_ok_spec:
        return last_ok_spec
    raise DesignFailed("no buildable design after the preview limit")
