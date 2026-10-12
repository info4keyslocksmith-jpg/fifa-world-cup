"""Design spec -> buildable brick model.

The Design Agent writes a *spec*: simple shapes measured in studs (x, y) and brick layers (z),
each with a palette color. compile_spec() turns the spec into real bricks, checks that every
brick is connected to the ground, splits the build into steps and bags for the builder's age,
and counts the parts. Everything here is deterministic: the same spec always gives the same kit.

Spec shapes (applied in order; later shapes overwrite earlier ones):
  {"type": "box",       "at": [x, y, z], "size": [w, d, h], "color": c}
  {"type": "cylinder",  "center": [cx, cy], "z": z, "height": h, "radius": r, "color": c}
  {"type": "cone",      "center": [cx, cy], "z": z, "height": h, "radius_bottom": r1, "radius_top": r2, "color": c}
  {"type": "ellipsoid", "center": [cx, cy, cz], "radii": [rx, ry, rz], "color": c}
  {"type": "taper",     "at": [x, y, z], "size": [w, d, h], "inset_per_layer": n, "color": c}   (pyramids, roofs)
  {"type": "paint",     "region": <any shape above, no color>, "color": c,
                        "pattern": "solid|rows|columns|checker", "every": n, "offset": k, "surface_only": true}
  {"type": "carve",     "region": <any shape above>}                     (removes bricks: windows, doors, arches)
  {"type": "element",   "kind": "round1x1|cone1x1|round2x2", "at": [x, y, z], "color": c}
Options: "hollow": {"wall": 2, "keep_under_roof": 1}   saves parts inside big solid volumes.
         "fit": true                                    rescales the whole spec to land in the tier's piece range.
"""

import math
from collections import Counter, defaultdict

from .palette import AGE_RULES, BRICKS, COLORS, SPECIAL, TIERS

BRICK_SIZES = sorted(BRICKS, key=lambda s: -(s[0] * s[1]))
BAG_SIZE = {"4-6": 30, "7-9": 60, "10-12": 120, "13+": 200}


class SpecError(ValueError):
    pass


# ---------------------------------------------------------------- shapes -> cells

def _shape_cells(sh, s=1.0):
    """Yield the (x, y, z) cells a shape fills. s rescales the shape (used by "fit")."""
    t = sh["type"]
    if t in ("box", "taper"):
        x, y, z = sh["at"]
        w, d, h = sh["size"]
        x0, y0, z0 = round(x * s), round(y * s), round(z * s)
        x1, y1, z1 = max(x0 + 1, round((x + w) * s)), max(y0 + 1, round((y + d) * s)), max(z0 + 1, round((z + h) * s))
        inset = sh.get("inset_per_layer", 0) if t == "taper" else 0
        for k in range(z0, z1):
            m = math.floor((k - z0) * inset)
            for i in range(x0 + m, x1 - m):
                for j in range(y0 + m, y1 - m):
                    yield (i, j, k)
    elif t in ("cylinder", "cone"):
        cx, cy = sh["center"][0] * s, sh["center"][1] * s
        z0 = round(sh["z"] * s)
        z1 = max(z0 + 1, round((sh["z"] + sh["height"]) * s))
        rb = sh.get("radius", sh.get("radius_bottom", 1)) * s
        rt = sh.get("radius", sh.get("radius_top", rb / s)) * s
        for k in range(z0, z1):
            f = (k - z0 + 0.5) / (z1 - z0)
            r = rb + (rt - rb) * f
            for i in range(math.floor(cx - r) - 1, math.ceil(cx + r) + 1):
                for j in range(math.floor(cy - r) - 1, math.ceil(cy + r) + 1):
                    if (i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r + 1e-9:
                        yield (i, j, k)
    elif t == "ellipsoid":
        cx, cy, cz = (v * s for v in sh["center"])
        rx, ry, rz = (max(0.5, v * s) for v in sh["radii"])
        for k in range(math.floor(cz - rz), math.ceil(cz + rz) + 1):
            for i in range(math.floor(cx - rx), math.ceil(cx + rx) + 1):
                for j in range(math.floor(cy - ry), math.ceil(cy + ry) + 1):
                    if ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 + ((k + 0.5 - cz) / rz) ** 2 <= 1 + 1e-9:
                        yield (i, j, k)
    else:
        raise SpecError(f"unknown shape type {t!r}")


def _pattern_ok(sh, c, cells):
    i, j, k = c
    if sh.get("surface_only", True):
        hidden_sides = all((i + dx, j + dy, k) in cells for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        if hidden_sides and (i, j, k + 1) in cells:
            return False
    every, off = max(1, sh.get("every", 2)), sh.get("offset", 0)
    p = sh.get("pattern", "solid")
    if p == "rows":
        return k % every == off
    if p == "columns":
        return (i + j) % every == off
    if p == "checker":
        return (i + j + k) % 2 == off
    return True


def rasterize(spec, s=1.0):
    cells, special = {}, {}
    for n, sh in enumerate(spec["shapes"]):
        t = sh["type"]
        color = sh.get("color")
        if t not in ("carve",) and color not in COLORS:
            raise SpecError(f"shape {n}: color {color!r} is not in the palette")
        if t == "element":
            kind = sh["kind"]
            if kind not in SPECIAL:
                raise SpecError(f"shape {n}: unknown element {kind!r}")
            x, y, z = (round(v * s) for v in sh["at"])
            fp = SPECIAL[kind][2]
            for i in range(x, x + fp):
                for j in range(y, y + fp):
                    cells[(i, j, z)] = color
            special[(x, y, z)] = (kind, color)
        elif t == "paint":
            region = list(_shape_cells(sh["region"], s))
            hits = [c for c in region if c in cells and _pattern_ok(sh, c, cells)]
            for c in hits:
                cells[c] = color
        elif t == "carve":
            for c in _shape_cells(sh["region"], s):
                cells.pop(c, None)
        else:
            for c in _shape_cells(sh, s):
                cells[c] = color
    # drop anything below the table
    cells = {c: v for c, v in cells.items() if c[2] >= 0}
    if not cells:
        raise SpecError("the spec produced no bricks")
    # shift so the model starts at x = 0, y = 0
    mx = min(c[0] for c in cells)
    my = min(c[1] for c in cells)
    cells = {(x - mx, y - my, z): v for (x, y, z), v in cells.items()}
    special = {(x - mx, y - my, z): v for (x, y, z), v in special.items()}
    return cells, special


def hollow_out(cells, special, wall=2, keep_under_roof=1):
    """Remove hidden inside cells, keeping walls `wall` studs thick and solid slabs under every roof."""
    covered_special = {(x + i, y + j, z) for (x, y, z), (kind, _) in special.items()
                       for i in range(SPECIAL[kind][2]) for j in range(SPECIAL[kind][2])}
    remove = []
    for (x, y, z) in cells:
        if (x, y, z) in covered_special:
            continue
        if any((x, y, z + dz) not in cells for dz in range(1, keep_under_roof + 2)):
            continue
        if all((x + dx, y + dy, z) in cells for dx in range(-wall, wall + 1) for dy in range(-wall, wall + 1)):
            remove.append((x, y, z))
    for c in remove:
        del cells[c]
    return cells


# ---------------------------------------------------------------- cells -> bricks

def _pack_layer(layer_cells, z, below, prefer_x, next_id):
    """Cover one layer with the biggest bricks that fit, staggering seams against the layer below."""
    covered = set()
    bricks = []
    order = sorted(layer_cells, key=(lambda c: (c[1], c[0])) if prefer_x else (lambda c: (c[0], c[1])))
    for c in order:
        if c in covered:
            continue
        color = layer_cells[c]
        best, best_score = None, -1e9
        for a, b in BRICK_SIZES:
            for w, d in ({(a, b), (b, a)}):
                footprint = [(c[0] + i, c[1] + j) for i in range(w) for j in range(d)]
                if any(f in covered or layer_cells.get(f) != color for f in footprint):
                    continue
                under = Counter(below[f] for f in footprint if f in below)
                score = w * d * 10
                if (w >= d) == prefer_x and w != d:
                    score += 3
                if len(under) >= 2:
                    score += 4 * (len(under) - 1)
                elif len(under) == 1:
                    (bid, n), = under.items()
                    if n == w * d and below.get(("size", bid)) == (w, d):
                        score -= 8  # sits exactly on an identical brick: no bonding
                if score > best_score:
                    best, best_score = (w, d), score
        w, d = best
        for i in range(w):
            for j in range(d):
                covered.add((c[0] + i, c[1] + j))
        part, name = BRICKS[tuple(sorted((w, d)))]
        bricks.append({"id": next_id + len(bricks), "x": c[0], "y": c[1], "z": z, "w": w, "d": d,
                       "color": color, "part": part, "name": name, "kind": "brick"})
    return bricks


def pack(cells, special):
    by_layer = defaultdict(dict)
    for (x, y, z), color in cells.items():
        by_layer[z][(x, y)] = color
    bricks, below = [], {}
    for z in sorted(by_layer):
        layer = by_layer[z]
        layer_bricks = []
        for (x, y, zz), (kind, color) in special.items():
            if zz != z:
                continue
            fp = SPECIAL[kind][2]
            for i in range(fp):
                for j in range(fp):
                    layer.pop((x + i, y + j), None)
            part, name, _ = SPECIAL[kind]
            layer_bricks.append({"id": len(bricks) + len(layer_bricks), "x": x, "y": y, "z": z, "w": fp, "d": fp,
                                 "color": color, "part": part, "name": name, "kind": kind})
        layer_bricks += _pack_layer(layer, z, below, prefer_x=(z % 2 == 0), next_id=len(bricks) + len(layer_bricks))
        below = {}
        for b in layer_bricks:
            below[("size", b["id"])] = (b["w"], b["d"])
            for i in range(b["w"]):
                for j in range(b["d"]):
                    below[(b["x"] + i, b["y"] + j)] = b["id"]
        bricks += layer_bricks
    return bricks


def footprint(b):
    return [(b["x"] + i, b["y"] + j) for i in range(b["w"]) for j in range(b["d"])]


def check_connections(bricks):
    """Every brick must reach the table through stud connections. Returns (floating ids, weak ids)."""
    index = defaultdict(dict)
    for b in bricks:
        for f in footprint(b):
            index[b["z"]][f] = b["id"]
    links = defaultdict(Counter)
    for b in bricks:
        if b["z"] == 0:
            continue
        for f in footprint(b):
            other = index[b["z"] - 1].get(f)
            if other is not None and bricks[other]["kind"] != "cone1x1":  # nothing clicks onto a cone tip
                links[b["id"]][other] += 1
                links[other][b["id"]] += 1
    seen = {b["id"] for b in bricks if b["z"] == 0}
    todo = list(seen)
    while todo:
        n = todo.pop()
        for m in links[n]:
            if m not in seen:
                seen.add(m)
                todo.append(m)
    floating = [b["id"] for b in bricks if b["id"] not in seen]
    weak = [b["id"] for b in bricks if b["z"] > 0 and b["w"] * b["d"] > 1 and sum(links[b["id"]].values()) == 1]
    return floating, weak


# ---------------------------------------------------------------- build order

def layer_order(layer_bricks):
    """Back-to-front order for one layer (viewer looks from +x, +y, above). Used for building and drawing."""
    n = len(layer_bricks)
    after = defaultdict(set)
    indeg = [0] * n
    for i, a in enumerate(layer_bricks):
        ax0, ax1, ay0, ay1 = a["x"], a["x"] + a["w"], a["y"], a["y"] + a["d"]
        for j, b in enumerate(layer_bricks):
            if i == j:
                continue
            bx0, bx1, by0, by1 = b["x"], b["x"] + b["w"], b["y"], b["y"] + b["d"]
            x_ov, y_ov = ax0 < bx1 and bx0 < ax1, ay0 < by1 and by0 < ay1
            if (ax1 <= bx0 and (y_ov or ay1 <= by0)) or (ay1 <= by0 and (x_ov or ax1 <= bx0)):
                if j not in after[i]:
                    after[i].add(j)
                    indeg[j] += 1
    ready = [i for i in range(n) if indeg[i] == 0]
    out = []
    while ready:
        ready.sort(key=lambda i: (layer_bricks[i]["x"] + layer_bricks[i]["y"], layer_bricks[i]["x"]))
        i = ready.pop(0)
        out.append(layer_bricks[i])
        for j in after[i]:
            indeg[j] -= 1
            if indeg[j] == 0:
                ready.append(j)
    if len(out) < n:  # should not happen; keep every brick anyway
        out += [b for b in layer_bricks if b not in out]
    return out


def make_steps(bricks, age):
    rules = AGE_RULES[age]
    per = rules["parts_per_step"]
    layers = defaultdict(list)
    for b in bricks:
        layers[b["z"]].append(b)
    steps = []
    for z in sorted(layers):
        ordered = layer_order(layers[z])
        if rules["merge_layers"] and steps and len(steps[-1]) + len(ordered) <= per:
            steps[-1] += ordered
            continue
        k = math.ceil(len(ordered) / per)
        size = math.ceil(len(ordered) / k)
        for i in range(0, len(ordered), size):
            steps.append(ordered[i:i + size])
    for n, step in enumerate(steps, 1):
        for b in step:
            b["step"] = n
    # bags: consecutive steps grouped so each bag holds about BAG_SIZE parts
    bags, count, bag = [], 0, 1
    for n, step in enumerate(steps, 1):
        if count and count + len(step) > BAG_SIZE[age] * 1.15:
            bag += 1
            count = 0
        count += len(step)
        bags.append(bag)
        for b in step:
            b["bag"] = bag
    return len(steps), bags


def bill_of_materials(bricks):
    bom = Counter((b["part"], b["name"], b["color"], b["kind"], tuple(sorted((b["w"], b["d"])))) for b in bricks)
    rows = []
    for (part, name, color, kind, size), qty in sorted(bom.items(), key=lambda kv: (kv[0][2], -kv[0][4][0] * kv[0][4][1], kv[0][0])):
        small = kind in ("cone1x1", "round1x1") or size[0] * size[1] <= 2
        rows.append({"part": part, "name": name, "color": color, "kind": kind, "w": size[0], "d": size[1],
                     "qty": qty, "spares": 1 if small else 0})
    return rows


# ---------------------------------------------------------------- main entry

def _build(spec, scale):
    cells, special = rasterize(spec, scale)
    if spec.get("hollow"):
        h = spec["hollow"]
        cells = hollow_out(cells, special, h.get("wall", 2), h.get("keep_under_roof", 1))
    return pack(cells, special)


def compile_spec(spec):
    tier, age = spec["tier"], spec["age"]
    if tier not in TIERS:
        raise SpecError(f"unknown tier {tier!r}")
    if age not in AGE_RULES:
        raise SpecError(f"unknown age range {age!r}")
    lo, hi = TIERS[tier]
    scale = 1.0
    bricks = _build(spec, scale)
    if spec.get("fit") and not lo <= len(bricks) <= hi:
        target = (lo + hi) / 2
        best = (abs(len(bricks) - target), scale, bricks)
        for i in range(8, 52):
            s = i * 0.05
            try:
                bs = _build(spec, s)
            except SpecError:
                continue
            if abs(len(bs) - target) < best[0]:
                best = (abs(len(bs) - target), s, bs)
        _, scale, bricks = best
    floating, weak = check_connections(bricks)
    n_steps, bags = make_steps(bricks, age)
    bom = bill_of_materials(bricks)
    xs = max(b["x"] + b["w"] for b in bricks)
    ys = max(b["y"] + b["d"] for b in bricks)
    zs = max(b["z"] for b in bricks) + 1
    warnings = []
    if not lo <= len(bricks) <= hi:
        warnings.append(f"{len(bricks)} pieces is outside the {tier} range {lo}-{hi}")
    if floating:
        warnings.append(f"{len(floating)} bricks are not connected to the model: {floating[:12]}")
    if weak:
        warnings.append(f"{len(weak)} bricks hold on by a single stud")
    return {
        "title": spec.get("title", "My build"),
        "title_es": spec.get("title_es", spec.get("title", "Mi construcción")),
        "wish": spec.get("wish", ""),
        "tier": tier, "age": age, "lang": spec.get("lang", "en"),
        "scale": round(scale, 2),
        "bricks": bricks,
        "steps": n_steps,
        "bags": max(bags) if bags else 1,
        "bom": bom,
        "stats": {
            "pieces": len(bricks),
            "unique_parts": len(bom),
            "studs": [xs, ys],
            "layers": zs,
            "size_cm": [round(xs * 0.8, 1), round(ys * 0.8, 1), round(zs * 0.96, 1)],
            "floating": len(floating),
            "weak": len(weak),
        },
        "warnings": warnings,
        "ok": not floating and lo <= len(bricks) <= hi,
    }
