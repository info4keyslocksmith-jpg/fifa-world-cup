"""Isometric SVG drawings of brick models, in the style of a building manual.

The viewer looks from the front-right, above (+x, +y, +z). Bricks are drawn layer by layer,
back to front, so nearer bricks correctly cover farther ones. New parts in a step get a
bright outline so kids can spot them.
"""

import math
from collections import defaultdict

from .compiler import footprint, layer_order
from .palette import COLORS

C30, S30 = math.cos(math.radians(30)), 0.5
H = 1.2            # brick height in studs
STUD_R, STUD_H = 0.3, 0.2
HIGHLIGHT = "#E8175D"


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _hex(rgb):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in rgb)


def shade(h, f):
    return _hex(tuple(v * f for v in _rgb(h)))


def lighten(h, f):
    return _hex(tuple(v + (255 - v) * f for v in _rgb(h)))


def luminance(h):
    r, g, b = _rgb(h)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255


def edge(h):
    return "#8d929b" if luminance(h) < 0.2 else shade(h, 0.55)


class View:
    def __init__(self, s):
        self.s = s

    def p(self, x, y, zh):
        return ((x - y) * C30 * self.s, (x + y) * S30 * self.s - zh * self.s)


def _pts(pts):
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def _poly(pts, fill, stroke, sw):
    return f'<polygon points="{_pts(pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.2f}" stroke-linejoin="round"/>'


def _ellipse(c, rx, ry, fill, stroke="none", sw=0):
    return f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.2f}"/>'


def _cylinder(v, cx, cy, zb, zt, rb, rt, color, out, sw, top_fill=None):
    """A vertical round part (stud, round brick, cone) from height zb to zt."""
    e = edge(color)
    side = shade(color, 0.72)
    k = math.sqrt(2) * v.s
    b, t = v.p(cx, cy, zb), v.p(cx, cy, zt)
    out.append(_ellipse(b, k * rb * C30, k * rb * S30, side, e, sw))
    body = [(b[0] - k * rb * C30, b[1]), (t[0] - k * rt * C30, t[1]), (t[0] + k * rt * C30, t[1]), (b[0] + k * rb * C30, b[1])]
    out.append(f'<polygon points="{_pts(body)}" fill="{side}"/>')
    out.append(f'<line x1="{body[0][0]:.1f}" y1="{body[0][1]:.1f}" x2="{body[1][0]:.1f}" y2="{body[1][1]:.1f}" stroke="{e}" stroke-width="{sw:.2f}"/>')
    out.append(f'<line x1="{body[3][0]:.1f}" y1="{body[3][1]:.1f}" x2="{body[2][0]:.1f}" y2="{body[2][1]:.1f}" stroke="{e}" stroke-width="{sw:.2f}"/>')
    out.append(_ellipse(t, k * rt * C30, k * rt * S30, top_fill or lighten(color, 0.08), e, sw))


def brick_svg(v, b, occupied=frozenset(), highlight=False):
    c = COLORS[b["color"]][0]
    e = edge(c)
    sw = max(0.5, v.s * 0.035)
    x0, y0 = b["x"], b["y"]
    x1, y1 = x0 + b["w"], y0 + b["d"]
    zb = b["z"] * H
    zt = zb + H
    out = []
    kind = b["kind"]
    if kind == "brick":
        top = [v.p(x0, y0, zt), v.p(x1, y0, zt), v.p(x1, y1, zt), v.p(x0, y1, zt)]
        right = [v.p(x1, y0, zt), v.p(x1, y1, zt), v.p(x1, y1, zb), v.p(x1, y0, zb)]
        left = [v.p(x0, y1, zt), v.p(x1, y1, zt), v.p(x1, y1, zb), v.p(x0, y1, zb)]
        out += [_poly(right, shade(c, 0.80), e, sw), _poly(left, shade(c, 0.64), e, sw), _poly(top, c, e, sw)]
        studs = footprint(b)
    else:
        r = 0.98 if kind == "round2x2" else 0.48
        cx, cy = x0 + b["w"] / 2, y0 + b["d"] / 2
        rt = 0.26 if kind == "cone1x1" else r
        _cylinder(v, cx, cy, zb, zt, r, rt, c, out, sw, top_fill=c)
        studs = [] if kind == "cone1x1" else footprint(b)
    for (i, j) in sorted(studs, key=lambda f: f[0] + f[1]):
        if (i, j, b["z"] + 1) in occupied:
            continue
        _cylinder(v, i + 0.5, j + 0.5, zt, zt + STUD_H, STUD_R, STUD_R, c, out, sw)
    if highlight:
        hw = max(2.0, v.s * 0.13)
        if kind == "brick":
            sil = [v.p(x0, y0, zt), v.p(x1, y0, zt), v.p(x1, y0, zb), v.p(x1, y1, zb), v.p(x0, y1, zb), v.p(x0, y1, zt)]
            out.append(f'<polygon points="{_pts(sil)}" fill="none" stroke="{HIGHLIGHT}" stroke-width="{hw:.2f}" stroke-linejoin="round"/>')
        else:
            r = 0.98 if kind == "round2x2" else 0.5
            cx, cy = x0 + b["w"] / 2, y0 + b["d"] / 2
            k = math.sqrt(2) * v.s
            bc, tc = v.p(cx, cy, zb), v.p(cx, cy, zt)
            out.append(f'<rect x="{bc[0] - k * r * C30:.1f}" y="{tc[1] - k * r * S30:.1f}" width="{2 * k * r * C30:.1f}" '
                       f'height="{bc[1] - tc[1] + 2 * k * r * S30:.1f}" rx="{k * r * C30 * 0.5:.1f}" fill="none" '
                       f'stroke="{HIGHLIGHT}" stroke-width="{hw:.2f}"/>')
    return out


def proj_bounds(bricks, s):
    v = View(s)
    xs, ys = [], []
    for b in bricks:
        x0, y0, x1, y1 = b["x"], b["y"], b["x"] + b["w"], b["y"] + b["d"]
        zb, zt = b["z"] * H, b["z"] * H + H + STUD_H
        for x in (x0, x1):
            for y in (y0, y1):
                for z in (zb, zt):
                    px, py = v.p(x, y, z)
                    xs.append(px)
                    ys.append(py)
    return min(xs), min(ys), max(xs), max(ys)


def scene_svg(bricks, s, new_ids=(), box=None, pad=None, css_class="scene"):
    """Draw bricks at scale s (pixels per stud). box = (x, y, w, h) viewBox, default fits the bricks."""
    v = View(s)
    occupied = {(i, j, b["z"]) for b in bricks for (i, j) in footprint(b)}
    new_ids = set(new_ids)
    layers = defaultdict(list)
    for b in bricks:
        layers[b["z"]].append(b)
    out = []
    for z in sorted(layers):
        for b in layer_order(layers[z]):
            if box is not None:  # skip bricks the camera can't see (keeps step PDFs small)
                bx0, by0, bx1, by1 = proj_bounds([b], s)
                if bx1 < box[0] or by1 < box[1] or bx0 > box[0] + box[2] or by0 > box[1] + box[3]:
                    continue
            out += brick_svg(v, b, occupied, b["id"] in new_ids)
    if box is None:
        pad = s * 0.8 if pad is None else pad
        x0, y0, x1, y1 = proj_bounds(bricks, s)
        box = (x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)
    x, y, w, h = box
    return (f'<svg class="{css_class}" xmlns="http://www.w3.org/2000/svg" viewBox="{x:.1f} {y:.1f} {w:.1f} {h:.1f}" '
            f'preserveAspectRatio="xMidYMid meet" role="img">' + "".join(out) + "</svg>")


def part_svg(row, s=14):
    """Icon of one part for parts callouts and the parts list (long side drawn along x)."""
    w, d = max(row["w"], row["d"]), min(row["w"], row["d"])
    b = {"id": 0, "x": 0, "y": 0, "z": 0, "w": w, "d": d, "color": row["color"], "kind": row["kind"]}
    return scene_svg([b], s, pad=s * 0.25, css_class="part")


def rotated_180(bricks):
    X = max(b["x"] + b["w"] for b in bricks)
    Y = max(b["y"] + b["d"] for b in bricks)
    return [dict(b, x=X - b["x"] - b["w"], y=Y - b["y"] - b["d"]) for b in bricks]
