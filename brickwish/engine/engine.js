// BrickWish engine: design spec -> bricks -> steps, bags, parts list, manual pages, vendor files.
// One file, no dependencies. The same code runs in the browser (the website's live preview) and in
// Node (the production pipeline, engine/cli.js), so what a kid previews is exactly what ships.
//
// A spec is a list of shapes measured in studs (x left->right, y back->front) and brick layers (z up).
// See DESIGN_GUIDE.md for the full shape language the design agents write.

export const H = 1.2; // brick height in studs

export const COLORS = {
  red:       { hex: "#C91A09", bl: 5,   blName: "Red",               name: "Red" },
  orange:    { hex: "#FE8A18", bl: 4,   blName: "Orange",            name: "Orange" },
  yellow:    { hex: "#F2CD37", bl: 3,   blName: "Yellow",            name: "Yellow" },
  lime:      { hex: "#BBE90B", bl: 34,  blName: "Lime",              name: "Lime" },
  green:     { hex: "#237841", bl: 6,   blName: "Green",             name: "Green" },
  azure:     { hex: "#36AEBF", bl: 156, blName: "Medium Azure",      name: "Sky blue" },
  blue:      { hex: "#0055BF", bl: 7,   blName: "Blue",              name: "Blue" },
  purple:    { hex: "#7A3FB8", bl: 89,  blName: "Dark Purple",       name: "Purple" },
  pink:      { hex: "#F48FB1", bl: 104, blName: "Bright Pink",       name: "Pink" },
  brown:     { hex: "#6B4226", bl: 88,  blName: "Reddish Brown",     name: "Brown" },
  tan:       { hex: "#E4CD9E", bl: 2,   blName: "Tan",               name: "Tan" },
  gray:      { hex: "#A0A5A9", bl: 86,  blName: "Light Bluish Gray", name: "Gray" },
  dark_gray: { hex: "#6C6E68", bl: 85,  blName: "Dark Bluish Gray",  name: "Dark gray" },
  white:     { hex: "#F4F4F4", bl: 1,   blName: "White",             name: "White" },
  black:     { hex: "#1E1E24", bl: 11,  blName: "Black",             name: "Black" },
};

// Plain bricks by "short x long" studs -> [LEGO design id, name]. Suppliers map these ids to their own.
export const BRICKS = {
  "1x1": ["3005", "Brick 1 x 1"], "1x2": ["3004", "Brick 1 x 2"], "1x3": ["3622", "Brick 1 x 3"],
  "1x4": ["3010", "Brick 1 x 4"], "1x6": ["3009", "Brick 1 x 6"], "1x8": ["3008", "Brick 1 x 8"],
  "2x2": ["3003", "Brick 2 x 2"], "2x3": ["3002", "Brick 2 x 3"], "2x4": ["3001", "Brick 2 x 4"],
  "2x6": ["2456", "Brick 2 x 6"], "2x8": ["3007", "Brick 2 x 8"],
};
const BRICK_SIZES = Object.keys(BRICKS).map((k) => k.split("x").map(Number)).sort((a, b) => b[0] * b[1] - a[0] * a[1]);

export const SPECIAL = {
  round1x1: { part: "3062b", name: "Brick, Round 1 x 1", size: 1 },
  cone1x1:  { part: "4589",  name: "Cone 1 x 1",         size: 1 },
  round2x2: { part: "3941",  name: "Brick, Round 2 x 2", size: 2 },
};

// How the manual is written for each age (see AI_PIPELINE.md §5).
export const AGES = {
  "4-6":   { label: "4–6",   partsPerStep: 3,  stepsPerPage: 1, mergeLayers: false, bag: 30 },
  "7-9":   { label: "7–9",   partsPerStep: 5,  stepsPerPage: 2, mergeLayers: false, bag: 60 },
  "10-12": { label: "10–12", partsPerStep: 8,  stepsPerPage: 2, mergeLayers: true,  bag: 120 },
  "13+":   { label: "13+",   partsPerStep: 12, stepsPerPage: 4, mergeLayers: true,  bag: 200 },
};

// Levels: more pieces = bigger model = more detail. Prices include US shipping.
export const LEVELS = {
  1: { name: "Starter",  min: 100,  max: 250,  price: 39 },
  2: { name: "Explorer", min: 300,  max: 600,  price: 79 },
  3: { name: "Builder",  min: 700,  max: 1200, price: 139 },
  4: { name: "Master",   min: 1300, max: 2400, price: 229 },
  5: { name: "Legend",   min: 2500, max: 4500, price: 399 },
  6: { name: "Epic",     min: 5000, max: 8000, price: 699 },
};

export class SpecError extends Error {}

// ------------------------------------------------------------------ grid

const OFF = 2048;
const key = (x, y, z) => ((x + OFF) * 4096 + (y + OFF)) * 1024 + z;
const key2 = (x, y) => (x + OFF) * 4096 + (y + OFF);
function unkey(k) {
  const z = k % 1024;
  const r = (k - z) / 1024;
  const y = (r % 4096) - OFF;
  const x = (r - (r % 4096)) / 4096 - OFF;
  return [x, y, z];
}

class Grid {
  constructor() { this.cells = new Map(); this.special = new Map(); this.top = new Map(); }
  set(x, y, z, color) {
    if (z < 0) return;
    if (z > 1000) throw new SpecError("the model is taller than 1000 layers");
    if (Math.abs(x) > 1900 || Math.abs(y) > 1900) throw new SpecError("the model is wider than 1900 studs");
    this.cells.set(key(x, y, z), color);
    const k2 = key2(x, y);
    if ((this.top.get(k2) ?? 0) < z + 1) this.top.set(k2, z + 1);
  }
  has(x, y, z) { return this.cells.has(key(x, y, z)); }
  get(x, y, z) { return this.cells.get(key(x, y, z)); }
  surface(x, y) { return this.top.get(key2(x, y)) ?? 0; }
  remove(cells) {
    const cols = new Set();
    for (const [x, y, z] of cells) if (this.cells.delete(key(x, y, z))) cols.add(key2(x, y));
    for (const k2 of cols) {  // keep surface heights right after carving
      const x = Math.floor(k2 / 4096) - OFF, y = (k2 % 4096) - OFF;
      let t = this.top.get(k2) ?? 0;
      while (t > 0 && !this.cells.has(key(x, y, t - 1))) t--;
      this.top.set(k2, t);
    }
  }
}

// ------------------------------------------------------------------ shapes -> cells

const num = (v, what) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new SpecError(`${what} must be a number`);
  return n;
};
const vec = (v, n, what) => {
  if (!Array.isArray(v) || v.length < n) throw new SpecError(`${what} must be a list of ${n} numbers`);
  return v.slice(0, n).map((x, i) => num(x, `${what}[${i}]`));
};

function boxCells(sh, s, out) {
  const [x, y, z] = vec(sh.at, 3, "at");
  const [w, d, h] = vec(sh.size, 3, "size");
  const x0 = Math.round(x * s), y0 = Math.round(y * s), z0 = Math.round(z * s);
  const x1 = Math.max(x0 + 1, Math.round((x + w) * s)), y1 = Math.max(y0 + 1, Math.round((y + d) * s));
  const z1 = Math.max(z0 + 1, Math.round((z + h) * s));
  const inset = sh.type === "taper" ? num(sh.inset_per_layer ?? 1, "inset_per_layer") : 0;
  for (let k = z0; k < z1; k++) {
    const m = Math.floor((k - z0) * inset);
    for (let i = x0 + m; i < x1 - m; i++) for (let j = y0 + m; j < y1 - m; j++) out.push([i, j, k]);
  }
}

function roundCells(sh, s, out) {
  const [cx0, cy0] = vec(sh.center, 2, "center");
  const cx = cx0 * s, cy = cy0 * s;
  const z0 = Math.round(num(sh.z ?? 0, "z") * s);
  const z1 = Math.max(z0 + 1, Math.round((num(sh.z ?? 0, "z") + num(sh.height, "height")) * s));
  const rb = num(sh.radius ?? sh.radius_bottom ?? 1, "radius") * s;
  const rt = num(sh.radius ?? sh.radius_top ?? sh.radius_bottom ?? 1, "radius") * s;
  for (let k = z0; k < z1; k++) {
    const f = (k - z0 + 0.5) / (z1 - z0);
    const r = rb + (rt - rb) * f;
    for (let i = Math.floor(cx - r) - 1; i <= Math.ceil(cx + r) + 1; i++)
      for (let j = Math.floor(cy - r) - 1; j <= Math.ceil(cy + r) + 1; j++)
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= r * r + 1e-9) out.push([i, j, k]);
  }
}

function ellipsoidCells(sh, s, out) {
  const [cx, cy, cz] = vec(sh.center, 3, "center").map((v) => v * s);
  const [rx, ry, rz] = vec(sh.radii, 3, "radii").map((v) => Math.max(0.5, v * s));
  for (let k = Math.floor(cz - rz); k <= Math.ceil(cz + rz); k++)
    for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++)
      for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++)
        if (((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2 + ((k + 0.5 - cz) / rz) ** 2 <= 1 + 1e-9) out.push([i, j, k]);
}

// A path of cells through 3D points. Each step up or down a layer shares a stud with the cell before,
// so the bricks along a sloped beam or cable always click together.
function pathCells(points, radius, out) {
  const seen = new Set();
  const add = (x, y, z) => { const k = key(x, y, z); if (!seen.has(k)) { seen.add(k); out.push([x, y, z]); } };
  const start = out.length;
  let prev = null, diagonal = false;
  for (let p = 0; p + 1 < points.length; p++) {
    const [ax, ay, az] = points[p], [bx, by, bz] = points[p + 1];
    const len = Math.hypot(bx - ax, by - ay, (bz - az) * H);
    const n = Math.max(1, Math.ceil(len * 4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const c = [Math.floor(ax + (bx - ax) * t + 0.5), Math.floor(ay + (by - ay) * t + 0.5), Math.floor(az + (bz - az) * t + 0.5)];
      if (prev && (prev[0] !== c[0] || prev[1] !== c[1] || prev[2] !== c[2])) {
        if (prev[0] !== c[0] && prev[1] !== c[1]) { add(c[0], prev[1], prev[2]); diagonal = true; }  // no corner-only steps
        if (prev[2] !== c[2] && (prev[0] !== c[0] || prev[1] !== c[1])) add(prev[0], prev[1], c[2]);  // staircase overlap
      }
      add(c[0], c[1], c[2]);
      prev = c;
    }
  }
  // A path that zigzags across the map is two layers thick, so the bricks of one layer lock the turns of the other.
  if (diagonal) for (const [x, y, z] of out.slice(start)) add(x, y, z + 1);
  if (radius > 0.75) {
    const core = out.slice();
    const r = radius, rz = Math.ceil(radius / H);
    const ext = new Set(core.map(([x, y, z]) => key(x, y, z)));
    for (const [x, y, z] of core)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
        for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
          for (let dz = -rz; dz <= rz; dz++)
            if (dx * dx + dy * dy + (dz * H) ** 2 <= r * r) {
              const k = key(x + dx, y + dy, z + dz);
              if (!ext.has(k)) { ext.add(k); out.push([x + dx, y + dy, z + dz]); }
            }
  }
}

function lineCells(sh, s, out) {
  const a = vec(sh.from, 3, "from").map((v) => v * s), b = vec(sh.to, 3, "to").map((v) => v * s);
  pathCells([a, b], num(sh.radius ?? 0.5, "radius") * s, out);
}

function cableCells(sh, s, out) {
  const a = vec(sh.from, 3, "from").map((v) => v * s), b = vec(sh.to, 3, "to").map((v) => v * s);
  const sag = num(sh.sag ?? 0, "sag") * s;
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 4 * sag * t * (1 - t)];
  const n = Math.max(8, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
  const pts = Array.from({ length: n + 1 }, (_, i) => at(i / n));
  const start = out.length;
  pathCells(pts, num(sh.radius ?? 0.5, "radius") * s, out);
  const low = new Map();
  for (let i = start; i < out.length; i++) { const [x, y, z] = out[i]; const k2 = key2(x, y); if (!low.has(k2) || z < low.get(k2)) low.set(k2, z); }
  if (sh.hangers) {  // vertical hangers from the cable down to a deck (suspension bridges)
    const every = Math.max(1, Math.round(num(sh.hangers.every ?? 3, "hangers.every") * s));
    const downTo = Math.round(num(sh.hangers.down_to, "hangers.down_to") * s);
    const margin = num(sh.hangers.margin ?? 0.08, "hangers.margin");
    const len = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    for (let d = every; d < len; d += every) {
      const t = d / len;
      if (t < margin || t > 1 - margin) continue;
      const [x, y, z] = at(t);
      const xi = Math.floor(x + 0.5), yi = Math.floor(y + 0.5);
      const top = low.get(key2(xi, yi)) ?? Math.floor(z + 0.5);
      for (let k = downTo; k < top; k++) out.push([xi, yi, k]);
    }
  }
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

// Landscapes: a height map from hills (or valleys with negative height), gentle noise, color bands by
// height, an optional top color (grass), and optional water filling everything below a level.
function terrainCells(sh, s, grid) {
  const [x0, y0] = vec(sh.at ?? [0, 0], 2, "at").map((v) => Math.round(v * s));
  const [w, d] = vec(sh.size, 2, "size").map((v) => Math.max(1, Math.round(v * s)));
  const base = num(sh.base ?? 1, "base") * s;
  const peaks = (sh.peaks ?? []).map((p, i) => ({
    x: vec(p.at, 2, `peaks[${i}].at`)[0] * s, y: vec(p.at, 2, `peaks[${i}].at`)[1] * s,
    h: num(p.height, `peaks[${i}].height`) * s, r: Math.max(1, num(p.radius, `peaks[${i}].radius`) * s),
    sharp: p.shape === "sharp",
  }));
  const amp = num(sh.noise ?? 0, "noise") * s, seed = Math.round(num(sh.seed ?? 7, "seed"));
  const bands = (sh.colors ?? [{ color: sh.color ?? "green" }]);
  for (const b of bands) if (!COLORS[b.color]) throw new SpecError(`terrain color ${b.color} is not in the palette`);
  const colorAt = (z) => { for (const b of bands) if (b.below === undefined || z < b.below * s) return b.color; return bands.at(-1).color; };
  const topColor = sh.top_color;
  const water = sh.water;
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const x = x0 + i + 0.5, y = y0 + j + 0.5;
    let h = base;
    for (const p of peaks) {
      const t = Math.hypot(x - p.x, y - p.y) / p.r;
      if (t < 1) h += p.h * (p.sharp ? 1 - t : 0.5 + 0.5 * Math.cos(Math.PI * t));
    }
    if (amp) h += amp * (valueNoise(x / 5, y / 5, seed) - 0.5) * 2;
    const top = Math.max(1, Math.round(h));
    for (let k = 0; k < top; k++) grid.set(x0 + i, y0 + j, k, k === top - 1 && topColor ? topColor : colorAt(k));
    if (water) {
      const lvl = Math.round(num(water.level, "water.level") * s);
      for (let k = top; k < lvl; k++) grid.set(x0 + i, y0 + j, k, water.color ?? "blue");
    }
  }
}

function regionCells(sh, s) {
  const out = [];
  switch (sh.type) {
    case "box": case "taper": boxCells(sh, s, out); break;
    case "cylinder": case "cone": roundCells(sh, s, out); break;
    case "ellipsoid": ellipsoidCells(sh, s, out); break;
    case "line": lineCells(sh, s, out); break;
    case "cable": cableCells(sh, s, out); break;
    default: throw new SpecError(`unknown shape type ${JSON.stringify(sh.type)}`);
  }
  return out;
}

function surfaceOk(sh, grid, x, y, z) {
  if (sh.surface_only === false) return true;
  const sides = grid.has(x + 1, y, z) && grid.has(x - 1, y, z) && grid.has(x, y + 1, z) && grid.has(x, y - 1, z);
  return !(sides && grid.has(x, y, z + 1));
}
function patternOk(sh, x, y, z) {
  const every = Math.max(1, Math.round(num(sh.every ?? 2, "every"))), off = Math.round(num(sh.offset ?? 0, "offset"));
  switch (sh.pattern ?? "solid") {
    case "rows": return ((z % every) + every) % every === off;
    case "columns": return (((x + y) % every) + every) % every === off;
    case "checker": return (((x + y + z) % 2) + 2) % 2 === off % 2;
    case "dots": return (((x + y) % every) + every) % every === off && ((z % every) + every) % every === off;
    default: return true;
  }
}

// ------------------------------------------------------------------ prefabs (ready-made small things)

const PREFABS = {
  tree:   (s, c) => [
    { type: "box", at: [s, s, 0], size: [s, s, 2 * s], color: c.trunk ?? "brown" },
    { type: "ellipsoid", center: [1.5 * s, 1.5 * s, 2 * s + 1.2 * s], radii: [1.5 * s, 1.5 * s, 1.3 * s], color: c.leaves ?? "green" }],
  pine:   (s, c) => [
    { type: "box", at: [s, s, 0], size: [s, s, s], color: c.trunk ?? "brown" },
    { type: "cone", center: [1.5 * s, 1.5 * s], z: s, height: 4 * s, radius_bottom: 1.6 * s, radius_top: 0.3, color: c.leaves ?? "green" }],
  palm:   (s, c) => [
    { type: "box", at: [s, s, 0], size: [s, s, 4 * s], color: c.trunk ?? "tan" },
    { type: "ellipsoid", center: [1.5 * s, 1.5 * s, 4 * s + 0.4 * s], radii: [1.7 * s, 1.7 * s, 0.7 * s], color: c.leaves ?? "green" }],
  bush:   (s, c) => [{ type: "ellipsoid", center: [s, s, 0.6 * s], radii: [s, s, 0.9 * s], color: c.leaves ?? "green" }],
  flower: (s, c) => [
    { type: "element", kind: "round1x1", at: [0, 0, 0], color: c.stem ?? "green" },
    { type: "element", kind: "round1x1", at: [0, 0, 1], color: c.petals ?? "pink" }],
  rock:   (s, c) => [{ type: "ellipsoid", center: [s, s, 0.4 * s], radii: [s, 0.9 * s, 0.7 * s], color: c.color ?? "gray" }],
  house:  (s, c) => [
    { type: "box", at: [0, 0, 0], size: [4 * s, 3 * s, 2 * s], color: c.walls ?? "white" },
    { type: "taper", at: [0, 0, 2 * s], size: [4 * s, 3 * s, 2 * s], inset_per_layer: 1 / s, color: c.roof ?? "red" },
    { type: "paint", region: { type: "box", at: [1.5 * s, 3 * s - 1, 0], size: [s, 1, s] }, color: c.door ?? "brown" },
    { type: "paint", region: { type: "box", at: [0, 0, s], size: [4 * s, 3 * s, 1] }, color: c.windows ?? "azure", pattern: "columns", every: 3, offset: 1 }],
  hillside_house: (s, c) => [   // small brick houses like the hillside neighborhoods of Medellín or Rio
    { type: "box", at: [0, 0, 0], size: [2 * s, 2 * s, 2 * s], color: c.walls ?? "orange" },
    { type: "box", at: [0, 0, 2 * s], size: [2 * s, 2 * s, 1], color: c.roof ?? "dark_gray" },
    { type: "paint", region: { type: "box", at: [0, 2 * s - 1, s], size: [2 * s, 1, 1] }, color: c.windows ?? "azure", pattern: "columns", every: 2, offset: 0 }],
  tower:  (s, c) => [
    { type: "box", at: [0, 0, 0], size: [3 * s, 3 * s, 6 * s], color: c.walls ?? "gray" },
    { type: "paint", region: { type: "box", at: [0, 0, 1], size: [3 * s, 3 * s, 6 * s - 1] }, color: c.windows ?? "azure", pattern: "rows", every: 2, offset: 1 }],
  person: (s, c) => [
    { type: "box", at: [0, 0, 0], size: [s, s, s], color: c.pants ?? "blue" },
    { type: "box", at: [0, 0, s], size: [s, s, s], color: c.shirt ?? "red" },
    s > 1 ? { type: "element", kind: "round2x2", at: [0, 0, 2 * s], color: c.skin ?? "tan" }
          : { type: "element", kind: "round1x1", at: [0, 0, 2], color: c.skin ?? "tan" }],
  dog:    (s, c) => [
    { type: "box", at: [0, 0, 0], size: [s, s, s], color: c.body ?? "brown" },
    { type: "box", at: [2 * s, 0, 0], size: [s, s, s], color: c.body ?? "brown" },
    { type: "box", at: [0, 0, s], size: [3 * s, s, s], color: c.body ?? "brown" },
    { type: "box", at: [2 * s, 0, 2 * s], size: [s, s, s], color: c.head ?? c.body ?? "brown" },
    { type: "box", at: [0, 0, 2 * s], size: [s, s, s], color: c.tail ?? c.body ?? "brown" },
    // spots go on separate pieces (tail, front leg, an ear) so the body stays one connected piece
    ...(c.spots ? [
      { type: "paint", region: { type: "box", at: [0, 0, 2 * s], size: [s, s, s] }, color: c.spots, surface_only: false },
      { type: "paint", region: { type: "box", at: [2 * s, 0, 0], size: [s, s, s] }, color: c.spots, surface_only: false },
      { type: "box", at: [2 * s, 0, 3 * s], size: [s, s, 1], color: c.spots }] : [])],
  car:    (s, c) => [
    { type: "box", at: [0, 0, 0], size: [s, s, s], color: "black" }, { type: "box", at: [3 * s, 0, 0], size: [s, s, s], color: "black" },
    { type: "box", at: [0, s, 0], size: [s, s, s], color: "black" }, { type: "box", at: [3 * s, s, 0], size: [s, s, s], color: "black" },
    { type: "box", at: [0, 0, s], size: [4 * s, 2 * s, s], color: c.body ?? "red" },
    { type: "box", at: [s, 0, 2 * s], size: [2 * s, 2 * s, s], color: c.windows ?? "azure" }],
  bus:    (s, c) => [
    { type: "box", at: [0, 0, 0], size: [s, s, s], color: "black" }, { type: "box", at: [5 * s, 0, 0], size: [s, s, s], color: "black" },
    { type: "box", at: [0, s, 0], size: [s, s, s], color: "black" }, { type: "box", at: [5 * s, s, 0], size: [s, s, s], color: "black" },
    { type: "box", at: [0, 0, s], size: [6 * s, 2 * s, 2 * s], color: c.body ?? "yellow" },
    { type: "paint", region: { type: "box", at: [0, 0, 2 * s], size: [6 * s, 2 * s, 1] }, color: c.windows ?? "azure", pattern: "columns", every: 2, offset: 0 }],
  bench:  (s, c) => [
    { type: "box", at: [0, 0, 0], size: [s, s, s], color: c.legs ?? "dark_gray" }, { type: "box", at: [2 * s, 0, 0], size: [s, s, s], color: c.legs ?? "dark_gray" },
    { type: "box", at: [0, 0, s], size: [3 * s, s, s], color: c.seat ?? "brown" },
    { type: "box", at: [0, 0, 2 * s], size: [3 * s, s, s], color: c.seat ?? "brown" }],
  lamp:   (s, c) => [
    ...[0, 1, 2].map((k) => ({ type: "element", kind: "round1x1", at: [0, 0, k], color: c.pole ?? "dark_gray" })),
    { type: "element", kind: "round1x1", at: [0, 0, 3], color: c.light ?? "yellow" }],
  boat:   (s, c) => [
    { type: "box", at: [0, 0, 0], size: [5 * s, 2 * s, s], color: c.hull ?? "white" },
    { type: "box", at: [2 * s, 0, s], size: [2 * s, 2 * s, s], color: c.cabin ?? "blue" }],
  gondola: (s, c) => [
    { type: "box", at: [0, 0, 0], size: [2 * s, 2 * s, 2 * s], color: c.body ?? "yellow" },
    { type: "paint", region: { type: "box", at: [0, 0, s], size: [2 * s, 2 * s, 1] }, color: c.windows ?? "azure", surface_only: true }],
};
export const PREFAB_NAMES = Object.keys(PREFABS);

function rotateCells(cells, specials, facing) {
  if (!facing || facing === "+y") return [cells, specials];
  let W = 0, D = 0;
  for (const [x, y] of cells) { W = Math.max(W, x + 1); D = Math.max(D, y + 1); }
  const f = {
    "-y": (x, y) => [W - 1 - x, D - 1 - y],
    "+x": (x, y) => [y, W - 1 - x],
    "-x": (x, y) => [D - 1 - y, x],
  }[facing];
  if (!f) throw new SpecError(`facing must be +x, -x, +y or -y`);
  const rc = cells.map(([x, y, z, c]) => [...f(x, y), z, c]);
  const rs = specials.map(({ x, y, z, kind, color }) => {
    const n = SPECIAL[kind].size;
    const pts = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push(f(x + i, y + j));
    return { x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])), z, kind, color };
  });
  return [rc, rs];
}

// ------------------------------------------------------------------ spec -> grid

let groupSeq = 0;
function placeLocal(grid, local, points, sh, ownPieces = false) {
  // local = {cells: [[x,y,z,color]], specials: [...]} drawn at the origin; copy it to each point.
  // Ground heights are measured once, before any copy is placed, so copies never stack on each other.
  // ownPieces: the copy packs into its own bricks (a tree never merges with the green hill under it).
  const onSurface = sh.on_surface ?? true;
  let minZ = Infinity;
  for (const [, , z] of local.cells) minZ = Math.min(minZ, z);
  const placed = points.map((p) => {
    const [px, py] = [Math.round(num(p[0], "at[0]")), Math.round(num(p[1], "at[1]"))];
    let pz = p.length > 2 ? Math.round(num(p[2], "at[2]")) : 0;
    if (onSurface) {
      let top = 0;
      for (const [x, y, z] of local.cells) if (z === minZ) top = Math.max(top, grid.surface(px + x, py + y));
      pz += top - minZ;
    }
    return [px, py, pz];
  });
  for (const [px, py, pz] of placed) {
    const tag = ownPieces ? `@${++groupSeq}` : "";
    for (const [x, y, z, c] of local.cells) grid.set(px + x, py + y, pz + z, c.split("@")[0] + tag);
    for (const sp of local.specials) grid.special.set(key(px + sp.x, py + sp.y, pz + sp.z), { kind: sp.kind, color: sp.color });
  }
}

function buildLocal(shapes, s) {
  const g = new Grid();
  for (const sh of shapes) applyShape(g, sh, s);
  const cells = [];
  for (const [k, c] of g.cells) { const [x, y, z] = unkey(k); cells.push([x, y, z, c]); }
  const specials = [];
  for (const [k, v] of g.special) { const [x, y, z] = unkey(k); specials.push({ x, y, z, ...v }); }
  return { cells, specials };
}

function applyShape(grid, sh, s, path = "shape") {
  if (!sh || typeof sh !== "object") throw new SpecError(`${path} must be an object`);
  const t = sh.type;
  const needsColor = !["carve", "prefab", "repeat", "terrain"].includes(t);
  if (needsColor && !COLORS[sh.color]) throw new SpecError(`${path}: color ${JSON.stringify(sh.color)} is not in the palette`);
  if (t === "element") {
    const sp = SPECIAL[sh.kind];
    if (!sp) throw new SpecError(`${path}: unknown element ${JSON.stringify(sh.kind)}`);
    let [x, y, z] = vec(sh.at, 3, `${path}.at`).map((v) => Math.round(v * s));
    if (sh.on_surface) {
      let top = 0;
      for (let i = 0; i < sp.size; i++) for (let j = 0; j < sp.size; j++) top = Math.max(top, grid.surface(x + i, y + j));
      z += top;
    }
    for (let i = 0; i < sp.size; i++) for (let j = 0; j < sp.size; j++) grid.set(x + i, y + j, z, sh.color);
    grid.special.set(key(x, y, z), { kind: sh.kind, color: sh.color });
  } else if (t === "terrain") {
    terrainCells(sh, s, grid);
  } else if (t === "paint") {
    for (const [x, y, z] of regionCells(sh.region ?? {}, s))
      if (grid.has(x, y, z) && surfaceOk(sh, grid, x, y, z) && patternOk(sh, x, y, z)) grid.cells.set(key(x, y, z), sh.color);
  } else if (t === "carve") {
    grid.remove(regionCells(sh.region ?? {}, s));
  } else if (t === "prefab") {
    const make = PREFABS[sh.name];
    if (!make) throw new SpecError(`${path}: unknown prefab ${JSON.stringify(sh.name)}. Use one of: ${PREFAB_NAMES.join(", ")}`);
    const sc = Math.max(1, Math.min(4, Math.round(num(sh.scale ?? 1, "scale"))));
    const local = buildLocal(make(sc, sh.colors ?? {}), 1);
    const [rc, rs] = rotateCells(local.cells, local.specials, sh.facing);
    const pts = Array.isArray(sh.at?.[0]) ? sh.at : [sh.at ?? [0, 0]];
    placeLocal(grid, { cells: rc, specials: rs }, pts.map((p) => p.map((v) => v * s)), sh, true);
  } else if (t === "repeat") {
    const local = buildLocal([{ ...sh.shape, on_surface: false }], s);
    const pts = (sh.offsets ?? []).map((o) => vec(o, 2, `${path}.offsets`).concat(o.length > 2 ? [num(o[2], "offset z")] : []).map((v) => v * s));
    placeLocal(grid, local, pts, { on_surface: sh.on_surface ?? false });
  } else if (sh.on_surface) {
    const cells = regionCells(sh, s);
    let minZ = Infinity;
    for (const [, , z] of cells) minZ = Math.min(minZ, z);
    let top = 0;
    for (const [x, y, z] of cells) if (z === minZ) top = Math.max(top, grid.surface(x, y));
    for (const [x, y, z] of cells) grid.set(x, y, z - minZ + top, sh.color);
  } else {
    for (const [x, y, z] of regionCells(sh, s)) grid.set(x, y, z, sh.color);
  }
}

export function rasterize(spec, s = 1) {
  if (!Array.isArray(spec.shapes) || !spec.shapes.length) throw new SpecError("the spec needs a list of shapes");
  const grid = new Grid();
  spec.shapes.forEach((sh, i) => applyShape(grid, sh, s, `shapes[${i}]`));
  if (!grid.cells.size) throw new SpecError("the spec produced no bricks");
  let mx = Infinity, my = Infinity;
  for (const k of grid.cells.keys()) { const [x, y] = unkey(k); mx = Math.min(mx, x); my = Math.min(my, y); }
  const cells = new Map(), special = new Map();
  for (const [k, c] of grid.cells) { const [x, y, z] = unkey(k); cells.set(key(x - mx, y - my, z), c); }
  for (const [k, v] of grid.special) {
    const [x, y, z] = unkey(k);
    if (grid.cells.has(k)) special.set(key(x - mx, y - my, z), v);  // a later shape may have carved it away
  }
  return { cells, special };
}

function hollowOut(cells, special, wall = 2, keepUnderRoof = 1) {
  const covered = new Set();
  for (const [k, v] of special) {
    const [x, y, z] = unkey(k);
    const n = SPECIAL[v.kind].size;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) covered.add(key(x + i, y + j, z));
  }
  // A cell is inside (and removable) only when everything within `wall` studs sideways and up to
  // keepUnderRoof + 1 layers above is filled. That keeps a skin that follows every surface: walls,
  // roofs and the steps of a slope, so the shell stays connected down to the table.
  const remove = [];
  outer: for (const k of cells.keys()) {
    if (covered.has(k)) continue;
    const [x, y, z] = unkey(k);
    for (let dz = 0; dz <= keepUnderRoof + 1; dz++)
      for (let dx = -wall; dx <= wall; dx++) for (let dy = -wall; dy <= wall; dy++)
        if (!cells.has(key(x + dx, y + dy, z + dz))) continue outer;
    remove.push(k);
  }
  for (const k of remove) cells.delete(k);
}

// ------------------------------------------------------------------ cells -> bricks

function packLayer(layer, z, below, belowSize, preferX, nextId) {
  const covered = new Set();
  const bricks = [];
  const order = [...layer.keys()].map((k2) => [Math.floor(k2 / 4096) - OFF, (k2 % 4096) - OFF]);
  order.sort(preferX ? (a, b) => a[1] - b[1] || a[0] - b[0] : (a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [cx, cy] of order) {
    if (covered.has(key2(cx, cy))) continue;
    const color = layer.get(key2(cx, cy));
    let best = null, bestScore = -Infinity;
    for (const [a, b] of BRICK_SIZES) {
      for (const [w, d] of a === b ? [[a, b]] : [[a, b], [b, a]]) {
        let ok = true;
        const under = new Map();
        for (let i = 0; i < w && ok; i++) for (let j = 0; j < d; j++) {
          const k2 = key2(cx + i, cy + j);
          if (covered.has(k2) || layer.get(k2) !== color) { ok = false; break; }
          const u = below.get(k2);
          if (u !== undefined) under.set(u, (under.get(u) ?? 0) + 1);
        }
        if (!ok) continue;
        let score = w * d * 10;
        if (z > 0 && under.size === 0) score -= 60;  // nothing underneath: only use it if nothing better fits
        if ((w >= d) === preferX && w !== d) score += 3;
        if (under.size >= 2) score += 4 * (under.size - 1);
        else if (under.size === 1) {
          const [[bid, n]] = [...under];
          const bs = belowSize.get(bid);
          if (n === w * d && bs && bs[0] === w && bs[1] === d) score -= 15;  // no bonding: sits on an identical brick
        }
        if (score > bestScore) { best = [w, d]; bestScore = score; }
      }
    }
    const [w, d] = best;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) covered.add(key2(cx + i, cy + j));
    const [part, name] = BRICKS[`${Math.min(w, d)}x${Math.max(w, d)}`];
    bricks.push({ id: nextId + bricks.length, x: cx, y: cy, z, w, d, color: color.split("@")[0], part, name, kind: "brick" });
  }
  return bricks;
}

function pack(cells, special) {
  const layers = new Map();
  for (const [k, color] of cells) {
    const [x, y, z] = unkey(k);
    if (!layers.has(z)) layers.set(z, new Map());
    layers.get(z).set(key2(x, y), color);
  }
  const bricks = [];
  let below = new Map(), belowSize = new Map();
  for (const z of [...layers.keys()].sort((a, b) => a - b)) {
    const layer = layers.get(z);
    const layerBricks = [];
    for (const [k, v] of special) {
      const [x, y, zz] = unkey(k);
      if (zz !== z) continue;
      const sp = SPECIAL[v.kind];
      for (let i = 0; i < sp.size; i++) for (let j = 0; j < sp.size; j++) layer.delete(key2(x + i, y + j));
      layerBricks.push({ id: bricks.length + layerBricks.length, x, y, z, w: sp.size, d: sp.size, color: v.color, part: sp.part, name: sp.name, kind: v.kind });
    }
    layerBricks.push(...packLayer(layer, z, below, belowSize, z % 2 === 0, bricks.length + layerBricks.length));
    below = new Map(); belowSize = new Map();
    for (const b of layerBricks) {
      belowSize.set(b.id, [b.w, b.d]);
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) below.set(key2(b.x + i, b.y + j), b.id);
    }
    bricks.push(...layerBricks);
  }
  return bricks;
}

// Repair: re-cut a loose brick together with a connected neighbor (same layer), or re-cut the layer above
// it so a new brick reaches across and holds it. New bricks must rest on a connected brick below, so the
// repair never relies on support that only existed through the bricks being replaced.
function repairFloating(bricks) {
  for (let pass = 0; pass < 4; pass++) {
    const { floating } = checkConnections(bricks);
    if (!floating.length) return bricks;
    const loose = new Set(floating);
    const cellOf = new Map();
    for (const b of bricks) for (const [x, y] of footprint(b)) cellOf.set(key(x, y, b.z), b);
    const dead = new Set(), added = [];
    const rectsIn = (U) => {
      const cells = [...U].map((k2) => [Math.floor(k2 / 4096) - OFF, (k2 % 4096) - OFF]);
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const [mx, my, Mx, My] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const out = [];
      for (const [a, b] of BRICK_SIZES) for (const [w, d] of a === b ? [[a, b]] : [[a, b], [b, a]])
        for (let x = mx; x + w - 1 <= Mx; x++) for (let y = my; y + d - 1 <= My; y++) {
          let ok = true;
          for (let i = 0; i < w && ok; i++) for (let j = 0; j < d; j++) if (!U.has(key2(x + i, y + j))) { ok = false; break; }
          if (ok) out.push([x, y, w, d]);
        }
      return out;
    };
    // try to cover the cells U of layer z with 1-3 bricks that each rest on connected bricks (not in `group`)
    const recut = (U, z, group, mustTouch) => {
      const rects = rectsIn(U);
      const rests = (r) => {
        if (z === 0) return true;
        for (let i = 0; i < r[2]; i++) for (let j = 0; j < r[3]; j++) {
          const o = cellOf.get(key(r[0] + i, r[1] + j, z - 1));
          if (o && !loose.has(o.id) && !group.has(o.id) && !dead.has(o.id) && o.kind !== "cone1x1") return true;
        }
        return false;
      };
      const touches = (r) => {
        for (let i = 0; i < r[2]; i++) for (let j = 0; j < r[3]; j++) if (mustTouch(r[0] + i, r[1] + j)) return true;
        return false;
      };
      const ok = rects.filter(rests);
      const area = (r) => r[2] * r[3];
      const disjoint = (a, b) => !(a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]);
      for (const r1 of ok) if (area(r1) === U.size && touches(r1)) return [r1];
      for (const r1 of ok) for (const r2 of ok)
        if (area(r1) + area(r2) === U.size && disjoint(r1, r2) && (touches(r1) || touches(r2))) return [r1, r2];
      for (const r1 of ok) for (const r2 of ok) {
        if (!disjoint(r1, r2) || area(r1) + area(r2) >= U.size) continue;
        for (const r3 of ok)
          if (area(r1) + area(r2) + area(r3) === U.size && disjoint(r1, r3) && disjoint(r2, r3) && (touches(r1) || touches(r2) || touches(r3)))
            return [r1, r2, r3];
      }
      return null;
    };
    const sameLayerNbrs = (b) => {
      const out = new Set();
      for (const [x, y] of footprint(b)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = cellOf.get(key(x + dx, y + dy, b.z));
        if (n && n !== b && n.kind === "brick" && n.color === b.color && !dead.has(n.id)) out.add(n);
      }
      return out;
    };
    const apply = (olds, rects, z, color) => {
      for (const o of olds) dead.add(o.id);
      for (const [x, y, w, d] of rects) {
        const [part, name] = BRICKS[`${Math.min(w, d)}x${Math.max(w, d)}`];
        added.push({ x, y, z, w, d, color, part, name, kind: "brick" });
      }
    };
    for (const id of floating) {
      const f = bricks[id];
      if (dead.has(f.id) || f.kind !== "brick") continue;
      const fCells = new Set(footprint(f).map(([x, y]) => key2(x, y)));
      let fixed = false;
      // 1) same layer: f + a connected neighbor
      for (const n of sameLayerNbrs(f)) {
        if (loose.has(n.id)) continue;
        const U = new Set([...fCells, ...footprint(n).map(([x, y]) => key2(x, y))]);
        const r = recut(U, f.z, new Set([f.id, n.id]), (x, y) => fCells.has(key2(x, y)));
        if (r) { apply([f, n], r, f.z, f.color); fixed = true; break; }
      }
      if (fixed) continue;
      // 2) layer above: a brick over f plus a neighbor, re-cut so one new brick spans from solid ground onto f
      const above = new Set();
      for (const [x, y] of footprint(f)) { const a = cellOf.get(key(x, y, f.z + 1)); if (a && a.kind === "brick" && !dead.has(a.id)) above.add(a); }
      outer: for (const a of above) for (const n of [a, ...sameLayerNbrs(a)]) {
        const group = new Set([a.id, n.id, f.id]);
        const U = new Set([...footprint(a), ...footprint(n)].map(([x, y]) => key2(x, y)));
        const r = recut(U, a.z, group, (x, y) => fCells.has(key2(x, y)));
        if (r && r.some((rc) => { for (let i = 0; i < rc[2]; i++) for (let j = 0; j < rc[3]; j++) if (!fCells.has(key2(rc[0] + i, rc[1] + j))) return true; return false; })) {
          apply(a === n ? [a] : [a, n], r, a.z, a.color);
          break outer;
        }
      }
    }
    if (!added.length) return bricks;
    bricks = bricks.filter((b) => !dead.has(b.id)).concat(added).sort((a, b) => a.z - b.z);
    bricks.forEach((b, i) => { b.id = i; });
  }
  return bricks;
}

export function footprint(b) {
  const out = [];
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) out.push([b.x + i, b.y + j]);
  return out;
}

function checkConnections(bricks) {
  const index = new Map();
  for (const b of bricks) for (const [x, y] of footprint(b)) index.set(key(x, y, b.z), b.id);
  const links = bricks.map(() => new Map());
  for (const b of bricks) {
    if (b.z === 0) continue;
    for (const [x, y] of footprint(b)) {
      const o = index.get(key(x, y, b.z - 1));
      if (o !== undefined && bricks[o].kind !== "cone1x1") {  // nothing clicks onto a cone's tip
        links[b.id].set(o, (links[b.id].get(o) ?? 0) + 1);
        links[o].set(b.id, (links[o].get(b.id) ?? 0) + 1);
      }
    }
  }
  const seen = new Uint8Array(bricks.length);
  const todo = [];
  for (const b of bricks) if (b.z === 0) { seen[b.id] = 1; todo.push(b.id); }
  while (todo.length) {
    const n = todo.pop();
    for (const m of links[n].keys()) if (!seen[m]) { seen[m] = 1; todo.push(m); }
  }
  const floating = bricks.filter((b) => !seen[b.id]).map((b) => b.id);
  const weak = bricks.filter((b) => b.z > 0 && b.w * b.d > 1 && [...links[b.id].values()].reduce((a, v) => a + v, 0) === 1).map((b) => b.id);
  return { floating, weak };
}

// ------------------------------------------------------------------ build order

// Back-to-front order within one layer (the viewer looks from the front right, above). Used for drawing.
export function layerOrder(layerBricks) {
  const n = layerBricks.length;
  if (n < 2) return layerBricks.slice();
  const after = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  // only nearby bricks can overlap on screen; bucket by diagonal to keep this fast for big layers
  const idx = layerBricks.map((b, i) => i).sort((i, j) => (layerBricks[i].x + layerBricks[i].y) - (layerBricks[j].x + layerBricks[j].y));
  for (let ii = 0; ii < n; ii++) {
    const a = layerBricks[idx[ii]];
    const ax0 = a.x, ax1 = a.x + a.w, ay0 = a.y, ay1 = a.y + a.d;
    for (let jj = ii + 1; jj < n; jj++) {
      const b = layerBricks[idx[jj]];
      if (b.x + b.y > ax1 + ay1 + 3) break;
      for (const [p, q] of [[idx[ii], idx[jj]], [idx[jj], idx[ii]]]) {
        const A = layerBricks[p], B = layerBricks[q];
        const Ax1 = A.x + A.w, Ay1 = A.y + A.d, Bx1 = B.x + B.w, By1 = B.y + B.d;
        const xOv = A.x < Bx1 && B.x < Ax1, yOv = A.y < By1 && B.y < Ay1;
        if ((Ax1 <= B.x && (yOv || Ay1 <= B.y)) || (Ay1 <= B.y && (xOv || Ax1 <= B.x))) { after[p].push(q); indeg[q]++; }
      }
    }
  }
  const ready = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  const out = [];
  const depth = (i) => layerBricks[i].x + layerBricks[i].y;
  while (ready.length) {
    let bi = 0;
    for (let i = 1; i < ready.length; i++) if (depth(ready[i]) < depth(ready[bi]) || (depth(ready[i]) === depth(ready[bi]) && layerBricks[ready[i]].x < layerBricks[ready[bi]].x)) bi = i;
    const i = ready.splice(bi, 1)[0];
    out.push(layerBricks[i]);
    for (const j of after[i]) if (--indeg[j] === 0) ready.push(j);
  }
  if (out.length < n) for (const b of layerBricks) if (!out.includes(b)) out.push(b);
  return out;
}

// Build order within a layer: tile by tile (8 x 8 studs), so each step's new pieces sit close together.
function buildOrder(layerBricks) {
  const T = 8;
  const tile = (b) => [Math.floor((b.x + b.w / 2) / T), Math.floor((b.y + b.d / 2) / T)];
  return layerBricks.slice().sort((a, b) => {
    const [ax, ay] = tile(a), [bx, by] = tile(b);
    return (ax + ay) - (bx + by) || ax - bx || (a.x + a.y) - (b.x + b.y) || a.x - b.x;
  });
}

function makeSteps(bricks, age) {
  const rules = AGES[age];
  const per = rules.partsPerStep;
  const layers = new Map();
  for (const b of bricks) { if (!layers.has(b.z)) layers.set(b.z, []); layers.get(b.z).push(b); }
  const steps = [];
  for (const z of [...layers.keys()].sort((a, b) => a - b)) {
    const ordered = buildOrder(layers.get(z));
    if (rules.mergeLayers && steps.length && steps.at(-1).length + ordered.length <= per) { steps.at(-1).push(...ordered); continue; }
    const k = Math.ceil(ordered.length / per), size = Math.ceil(ordered.length / k);
    for (let i = 0; i < ordered.length; i += size) steps.push(ordered.slice(i, i + size));
  }
  steps.forEach((st, n) => st.forEach((b) => { b.step = n + 1; }));
  let bag = 1, count = 0;
  for (const st of steps) {
    if (count && count + st.length > rules.bag * 1.15) { bag++; count = 0; }
    count += st.length;
    for (const b of st) b.bag = bag;
  }
  return { steps: steps.length, bags: bag };
}

function billOfMaterials(bricks) {
  const m = new Map();
  for (const b of bricks) {
    const k = `${b.part}|${b.color}|${b.kind}`;
    if (!m.has(k)) m.set(k, { part: b.part, name: b.name, color: b.color, kind: b.kind, w: Math.max(b.w, b.d), d: Math.min(b.w, b.d), qty: 0 });
    m.get(k).qty++;
  }
  const colorOrder = Object.keys(COLORS);
  return [...m.values()].map((r) => ({ ...r, spares: r.kind !== "brick" || r.w * r.d <= 2 ? 1 : 0 }))
    .sort((a, b) => colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color) || b.w * b.d - a.w * a.d || a.part.localeCompare(b.part));
}

// ------------------------------------------------------------------ main entry

function build(spec, s) {
  const { cells, special } = rasterize(spec, s);
  if (spec.hollow) hollowOut(cells, special, spec.hollow.wall ?? 2, spec.hollow.keep_under_roof ?? 1);
  return repairFloating(pack(cells, special));
}

export function levelOf(spec) {
  const lv = LEVELS[spec.level];
  if (!lv) throw new SpecError(`level must be 1-6`);
  return lv;
}

export function compile(spec) {
  const lv = levelOf(spec);
  if (!AGES[spec.age]) throw new SpecError(`age must be one of ${Object.keys(AGES).join(", ")}`);
  let scale = 1, bricks = build(spec, 1);
  if (spec.fit && (bricks.length < lv.min || bricks.length > lv.max)) {
    const target = (lv.min + lv.max) / 2;
    let best = [Math.abs(bricks.length - target), 1, bricks];
    for (let i = 8; i <= 60; i++) {
      const s = i * 0.05;
      let bs;
      try { bs = build(spec, s); } catch (e) { if (e instanceof SpecError) continue; throw e; }
      if (Math.abs(bs.length - target) < best[0]) best = [Math.abs(bs.length - target), s, bs];
    }
    [, scale, bricks] = best;
  }
  const { floating, weak } = checkConnections(bricks);
  const { steps, bags } = makeSteps(bricks, spec.age);
  const xs = Math.max(...bricks.map((b) => b.x + b.w)), ys = Math.max(...bricks.map((b) => b.y + b.d));
  const zs = Math.max(...bricks.map((b) => b.z)) + 1;
  const warnings = [];
  if (bricks.length < lv.min || bricks.length > lv.max) warnings.push(`${bricks.length} pieces is outside level ${spec.level} (${lv.min}-${lv.max})`);
  if (floating.length) warnings.push(`${floating.length} bricks are not connected to the model (ids ${floating.slice(0, 12).join(", ")}${floating.length > 12 ? ", ..." : ""}); they float or only touch sideways`);
  if (weak.length > Math.max(3, bricks.length * 0.02)) warnings.push(`${weak.length} bricks hold on by a single stud`);
  return {
    title: spec.title || "My build", wish: spec.wish || "", level: spec.level, age: spec.age,
    scale: Math.round(scale * 100) / 100, bricks, steps, bags, bom: billOfMaterials(bricks),
    stats: { pieces: bricks.length, unique_parts: billOfMaterials(bricks).length, studs: [xs, ys], layers: zs,
             size_cm: [+(xs * 0.8).toFixed(1), +(ys * 0.8).toFixed(1), +(zs * 0.96).toFixed(1)], floating: floating.length, weak: weak.length },
    warnings,
    ok: floating.length === 0 && bricks.length >= lv.min && bricks.length <= lv.max,
  };
}

// ------------------------------------------------------------------ drawing (isometric SVG)

const C30 = Math.cos(Math.PI / 6), S30 = 0.5, STUD_R = 0.3, STUD_H = 0.2;
export const HIGHLIGHT = "#E8175D";
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const shade = (h, f) => hex(rgb(h).map((v) => v * f));
const lighten = (h, f) => hex(rgb(h).map((v) => v + (255 - v) * f));
const lum = (h) => { const [r, g, b] = rgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
const edge = (h) => (lum(h) < 0.2 ? "#8d929b" : shade(h, 0.55));
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const P = (x, y, zh, s) => [(x - y) * C30 * s, (x + y) * S30 * s - zh * s];
const pts = (a) => a.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ");

function cylinder(cx, cy, zb, zt, rb, rt, color, s, out, sw, topFill) {
  // Two shapes per cylinder (side + top) keeps big manuals light.
  const e = edge(color), side = shade(color, 0.72), k = Math.SQRT2 * s;
  const b = P(cx, cy, zb, s), t = P(cx, cy, zt, s);
  const bx = k * rb * C30, by = k * rb * S30, tx = k * rt * C30;
  out.push(`<path d="M${f1(b[0] - bx)} ${f1(b[1])}A${f1(bx)} ${f1(by)} 0 0 0 ${f1(b[0] + bx)} ${f1(b[1])}L${f1(t[0] + tx)} ${f1(t[1])}L${f1(t[0] - tx)} ${f1(t[1])}Z" fill="${side}" stroke="${e}" stroke-width="${f1(sw)}" stroke-linejoin="round"/>`);
  out.push(`<ellipse cx="${f1(t[0])}" cy="${f1(t[1])}" rx="${f1(tx)}" ry="${f1(k * rt * S30)}" fill="${topFill ?? lighten(color, 0.08)}" stroke="${e}" stroke-width="${f1(sw)}"/>`);
}

function brickSvg(b, s, occ, highlight, out) {
  const c = COLORS[b.color].hex, e = edge(c), sw = Math.max(0.5, s * 0.035);
  const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.d, zb = b.z * H, zt = zb + H;
  let studs;
  if (b.kind === "brick") {
    out.push(`<polygon points="${pts([P(x1, y0, zt, s), P(x1, y1, zt, s), P(x1, y1, zb, s), P(x1, y0, zb, s)])}" fill="${shade(c, 0.8)}" stroke="${e}" stroke-width="${f1(sw)}" stroke-linejoin="round"/>`);
    out.push(`<polygon points="${pts([P(x0, y1, zt, s), P(x1, y1, zt, s), P(x1, y1, zb, s), P(x0, y1, zb, s)])}" fill="${shade(c, 0.64)}" stroke="${e}" stroke-width="${f1(sw)}" stroke-linejoin="round"/>`);
    out.push(`<polygon points="${pts([P(x0, y0, zt, s), P(x1, y0, zt, s), P(x1, y1, zt, s), P(x0, y1, zt, s)])}" fill="${c}" stroke="${e}" stroke-width="${f1(sw)}" stroke-linejoin="round"/>`);
    studs = footprint(b);
  } else {
    const r = b.kind === "round2x2" ? 0.98 : 0.48;
    cylinder(x0 + b.w / 2, y0 + b.d / 2, zb, zt, r, b.kind === "cone1x1" ? 0.26 : r, c, s, out, sw, c);
    studs = b.kind === "cone1x1" ? [] : footprint(b);
  }
  studs.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  for (const [i, j] of studs) if (!occ.has(key(i, j, b.z + 1))) cylinder(i + 0.5, j + 0.5, zt, zt + STUD_H, STUD_R, STUD_R, c, s, out, sw);
  if (highlight) {
    const hw = Math.max(2, s * 0.13);
    if (b.kind === "brick") {
      out.push(`<polygon points="${pts([P(x0, y0, zt, s), P(x1, y0, zt, s), P(x1, y0, zb, s), P(x1, y1, zb, s), P(x0, y1, zb, s), P(x0, y1, zt, s)])}" fill="none" stroke="${HIGHLIGHT}" stroke-width="${f1(hw)}" stroke-linejoin="round"/>`);
    } else {
      const r = b.kind === "round2x2" ? 0.98 : 0.5, k = Math.SQRT2 * s;
      const bc = P(x0 + b.w / 2, y0 + b.d / 2, zb, s), tc = P(x0 + b.w / 2, y0 + b.d / 2, zt, s);
      out.push(`<rect x="${f1(bc[0] - k * r * C30)}" y="${f1(tc[1] - k * r * S30)}" width="${f1(2 * k * r * C30)}" height="${f1(bc[1] - tc[1] + 2 * k * r * S30)}" rx="${f1(k * r * C30 * 0.5)}" fill="none" stroke="${HIGHLIGHT}" stroke-width="${f1(hw)}"/>`);
    }
  }
}

// Projected bounds of bricks at scale s: [x0, y0, x1, y1] in pixels.
export function projBounds(bricks, s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bricks) {
    const zb = b.z * H, zt = zb + H + STUD_H;
    // extreme corners of a box in this projection
    const l = P(b.x, b.y + b.d, zb, s), r = P(b.x + b.w, b.y, zb, s), t = P(b.x, b.y, zt, s), bt = P(b.x + b.w, b.y + b.d, zb, s);
    x0 = Math.min(x0, l[0]); x1 = Math.max(x1, r[0]); y0 = Math.min(y0, t[1]); y1 = Math.max(y1, bt[1]);
  }
  return [x0, y0, x1, y1];
}

export function occupancy(bricks) {
  const all = new Set(), solid = new Set();
  for (const b of bricks) for (const [x, y] of footprint(b)) { all.add(key(x, y, b.z)); if (b.kind === "brick") solid.add(key(x, y, b.z)); }
  return { all, solid };
}
function addOcc(occ, b) {
  for (const [x, y] of footprint(b)) { occ.all.add(key(x, y, b.z)); if (b.kind === "brick") occ.solid.add(key(x, y, b.z)); }
}

// A brick is invisible when its top and both front faces are covered by solid bricks.
function hiddenBrick(b, occ) {
  if (b.kind !== "brick") return false;
  for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) if (!occ.solid.has(key(b.x + i, b.y + j, b.z + 1))) return false;
  for (let j = 0; j < b.d; j++) if (!occ.solid.has(key(b.x + b.w, b.y + j, b.z))) return false;
  for (let i = 0; i < b.w; i++) if (!occ.solid.has(key(b.x + i, b.y + b.d, b.z))) return false;
  return true;
}

// Painter's order: layers bottom to top, each layer back to front.
export function paintOrder(bricks) {
  const layers = new Map();
  for (const b of bricks) { if (!layers.has(b.z)) layers.set(b.z, []); layers.get(b.z).push(b); }
  return [...layers.keys()].sort((a, b) => a - b).flatMap((z) => layerOrder(layers.get(z)));
}

// Draw bricks at s pixels per stud. box = [x, y, w, h] viewBox (default: fit the bricks).
// Pass ordered: true when the bricks are already in paintOrder (saves time on big manuals).
export function renderScene(bricks, s, { newIds = new Set(), box = null, occ = null, pad = null, cls = "scene", ordered = false } = {}) {
  occ = occ ?? occupancy(bricks);
  const out = [];
  for (const b of ordered ? bricks : paintOrder(bricks)) {
    const isNew = newIds.has(b.id);
    if (!isNew && hiddenBrick(b, occ)) continue;
    if (box) {
      const [bx0, by0, bx1, by1] = projBounds([b], s);
      if (bx1 < box[0] || by1 < box[1] || bx0 > box[0] + box[2] || by0 > box[1] + box[3]) continue;
    }
    brickSvg(b, s, occ.all, isNew, out);
  }
  if (!box) {
    const p = pad ?? s * 0.8;
    const [x0, y0, x1, y1] = projBounds(bricks, s);
    box = [x0 - p, y0 - p, x1 - x0 + 2 * p, y1 - y0 + 2 * p];
  }
  return `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="${box.map(f1).join(" ")}" preserveAspectRatio="xMidYMid meet" role="img">${out.join("")}</svg>`;
}

export function partIcon(row, s = 12) {
  const b = { id: 0, x: 0, y: 0, z: 0, w: Math.max(row.w, row.d), d: Math.min(row.w, row.d), color: row.color, kind: row.kind };
  return renderScene([b], s, { pad: s * 0.25, cls: "part" });
}

export function rotated180(bricks) {
  const X = Math.max(...bricks.map((b) => b.x + b.w)), Y = Math.max(...bricks.map((b) => b.y + b.d));
  return bricks.map((b) => ({ ...b, x: X - b.x - b.w, y: Y - b.y - b.d }));
}

export function fitScene(bricks, maxW, maxH, opts = {}) {
  const [x0, y0, x1, y1] = projBounds(bricks, 1);
  const s = Math.min(maxW / (x1 - x0 + 1.6), maxH / (y1 - y0 + 1.6), 40);
  return renderScene(bricks, s, opts);
}

// ------------------------------------------------------------------ the manual

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const TIPS = [
  "Build at a table, with a tray or a plate, so no piece rolls away.",
  "Open one bag at a time. The steps tell you when to open the next bag.",
  "Each step shows the new pieces in the blue box. In the picture, new pieces have a pink outline.",
  "Press every piece down until it clicks.",
  "Stuck? Ask a grown-up to help. Missing a piece? A grown-up can tell us and we'll send it free.",
];
const WARN_ICON = '<svg viewBox="0 0 30 27" width="26" height="23" aria-hidden="true"><path d="M15 1.5 28.5 25.5H1.5Z" fill="none" stroke="#14203B" stroke-width="2.5" stroke-linejoin="round"/><path d="M15 9.5v8" stroke="#14203B" stroke-width="3" stroke-linecap="round"/><circle cx="15" cy="21.3" r="1.8" fill="#14203B"/></svg>';
const BAG_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8Z" fill="#FFC629" stroke="#14203B" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="#14203B" stroke-width="1.6"/></svg>';

export const MANUAL_CSS = `
.bw-manual{--ink:#14203B;color:var(--ink);font-family:'Lexend','Segoe UI',Arial,sans-serif}
.bw-manual *{box-sizing:border-box}
.bw-manual .page{width:816px;height:1056px;position:relative;overflow:hidden;break-after:page;background:#fff;
  padding:43px 48px 62px;display:flex;flex-direction:column;gap:14px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bw-manual .page:last-child{break-after:auto}
.bw-manual .foot{position:absolute;left:48px;right:48px;bottom:27px;display:flex;justify-content:space-between;font-size:10px;color:#4B5A7A}
.bw-manual .brand{font:800 18px/1 'Baloo 2','Arial Rounded MT Bold',sans-serif;display:flex;align-items:center;gap:8px}
.bw-manual .brand i{width:22px;height:12px;background:#FFC629;border-radius:2px;position:relative;display:inline-block;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
.bw-manual .brand i::before{content:"";position:absolute;top:-4px;left:3px;width:5px;height:4px;background:#FFC629;border-radius:1px 1px 0 0;box-shadow:11px 0 0 #FFC629}
.bw-manual h1,.bw-manual h2{font-family:'Baloo 2','Arial Rounded MT Bold',sans-serif;margin:0;line-height:1}
.bw-manual .cover{background:#D9E9F7 radial-gradient(circle,#CFE1F3 0 6px,transparent 6.5px) 0 0/22px 22px}
.bw-manual .cover h1{font-size:56px;font-weight:800;text-wrap:balance}
.bw-manual .by{font-size:22px;display:flex;gap:10px;align-items:baseline}
.bw-manual .by b{font:800 30px/1 'Baloo 2',sans-serif;border-bottom:3px solid var(--ink);min-width:3in;padding:0 6px 2px}
.bw-manual .hero{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
.bw-manual .hero svg{width:100%;height:100%}
.bw-manual .chips{display:flex;gap:10px;flex-wrap:wrap}
.bw-manual .chip{background:#fff;border:2px solid var(--ink);border-radius:999px;padding:6px 14px;font-weight:600;font-size:15px}
.bw-manual .wish{background:#fff;border-radius:14px;padding:12px 16px;font-size:15px}
.bw-manual .wish span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#4B5A7A;margin-bottom:2px}
.bw-manual .tips{margin:0;padding:0;list-style:none;counter-reset:t;display:flex;flex-direction:column;gap:12px;font-size:17px;line-height:1.4}
.bw-manual .tips li{counter-increment:t;display:grid;grid-template-columns:40px 1fr;gap:12px;align-items:start}
.bw-manual .tips li::before{content:counter(t);width:36px;height:36px;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font:800 18px/1 'Baloo 2',sans-serif}
.bw-manual .warn{display:flex;gap:10px;align-items:center;border:2px solid var(--ink);border-radius:10px;padding:10px 12px;font-size:14px;margin:0}
.bw-manual .kitbox{display:flex;gap:18px;flex-wrap:wrap;font-size:16px}
.bw-manual .kitbox b{font:800 34px/1 'Baloo 2',sans-serif;display:block}
.bw-manual .demo-step{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:start;background:#F5F9FE;border-radius:14px;padding:14px}
.bw-manual .steps{flex:1;min-height:0;display:grid;gap:14px}
.bw-manual .steps.n1{grid-template-rows:1fr}
.bw-manual .steps.n2{grid-template-rows:1fr 1fr}
.bw-manual .steps.n4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.bw-manual .step{min-height:0;display:flex;flex-direction:column;gap:8px;border-bottom:2px dashed #C6D6EA;padding-bottom:10px}
.bw-manual .step:last-child{border-bottom:0}
.bw-manual .step-head{display:flex;gap:14px;align-items:flex-start}
.bw-manual .num{font:800 56px/.9 'Baloo 2',sans-serif;min-width:1.2em;font-variant-numeric:tabular-nums}
.bw-manual .n4 .num{font-size:40px}
.bw-manual .callout{background:#EAF3FC;border:2px solid #9DBBDD;border-radius:12px;padding:8px 12px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
.bw-manual .callout .p{display:flex;flex-direction:column;align-items:center;gap:2px;font:800 15px/1 'Baloo 2',sans-serif}
.bw-manual .callout svg{height:40px;width:auto}
.bw-manual .n4 .callout svg{height:30px}
.bw-manual .bag{display:inline-flex;gap:6px;align-items:center;background:#FFC629;border:2px solid var(--ink);border-radius:999px;padding:4px 12px;font:800 15px/1 'Baloo 2',sans-serif;margin-left:auto;white-space:nowrap}
.bw-manual .view{flex:1;min-height:0;display:flex;align-items:flex-start;justify-content:center;overflow:hidden}
.bw-manual .view svg{width:100%;height:auto;display:block}
.bw-manual .final{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:16px;min-height:0}
.bw-manual .final figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px;min-height:0}
.bw-manual .final svg{width:100%;height:100%;min-height:0}
.bw-manual .final figcaption{font:800 18px 'Baloo 2',sans-serif}
.bw-manual .big-done{font-size:64px;text-align:center}
.bw-manual .partsgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-content:start}
.bw-manual .pcell{border:2px solid #E1EAF5;border-radius:10px;padding:8px;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;text-align:center}
.bw-manual .pcell svg{height:44px;width:auto}
.bw-manual .pcell b{font:800 18px/1 'Baloo 2',sans-serif}
.bw-manual.preview .page::after{content:"PREVIEW";position:absolute;left:-10%;right:-10%;top:42%;text-align:center;font:800 120px/1 'Baloo 2',sans-serif;color:rgba(232,23,93,.13);transform:rotate(-32deg);pointer-events:none}
`;

function callout(stepBricks) {
  const counts = new Map();
  for (const b of stepBricks) {
    const k = `${b.part}|${b.color}|${b.kind}|${Math.max(b.w, b.d)}|${Math.min(b.w, b.d)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const cells = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => {
    const [, color, kind, w, d] = k.split("|");
    return `<div class="p">${partIcon({ w: +w, d: +d, color, kind }, 11)}<span>${n}x</span></div>`;
  });
  return `<div class="callout" aria-label="New pieces">${cells.join("")}</div>`;
}

// Every page of the manual as HTML. Pages are generated lazily so a 5,000-piece manual stays fast:
// manualPages(model) returns {count, page(i)} and you render only the pages you need.
export function manualPages(model, { code = "DEMO", builder = "" } = {}) {
  const rules = AGES[model.age];
  const per = rules.stepsPerPage;
  const bricks = model.bricks;
  const title = model.title;
  const st = model.stats;
  const byStep = Array.from({ length: model.steps + 1 }, () => []);
  for (const b of bricks) byStep[b.step].push(b);
  const stepPages = Math.ceil(model.steps / per);
  const bomPages = Math.ceil(model.bom.length / 24);
  const count = 2 + stepPages + 1 + bomPages;
  const foot = (n) => `<div class="foot"><span>BrickWish · ${esc(title)} · Order ${esc(code)}</span><span>Page ${n}</span></div>`;

  // layout for step views
  const contentW = 720, contentH = 1056 - 43 - 62 - 14;
  const viewW = per === 4 ? (contentW - 14) / 2 : contentW;
  const viewH = (per === 4 ? (contentH - 14) / 2 : (contentH - 14 * (per - 1)) / per) - (per === 4 ? 70 : 92);
  const unit = projBounds(bricks, 1);
  const order = paintOrder(bricks);
  const baseS = Math.max(9, Math.min(36, viewW / (unit[2] - unit[0] + 1.6)));
  // occupancy snapshots are built incrementally; cache the state after each step page
  let occ = { all: new Set(), solid: new Set() }, placed = [], doneStep = 0;
  const advanceTo = (n) => {
    if (n < doneStep) { occ = { all: new Set(), solid: new Set() }; placed = []; doneStep = 0; }
    while (doneStep < n) { doneStep++; for (const b of byStep[doneStep]) { placed.push(b); addOcc(occ, b); } }
  };

  function stepView(n) {
    advanceTo(n);
    const neu = byStep[n];
    let s = baseS;
    let nb = projBounds(neu, s);
    const fitNew = Math.min(1, (viewW - 2 * s) / (nb[2] - nb[0] + 1e-9), (viewH - 2 * s) / (nb[3] - nb[1] + 1e-9));
    if (fitNew < 1) { s = Math.max(4, s * fitNew); nb = projBounds(neu, s); }
    const pad = s * 0.8;
    const mb = projBounds(bricks, s), pb = projBounds(placed, s);
    let x0;
    if (mb[2] - mb[0] + 2 * pad <= viewW) x0 = (mb[0] + mb[2]) / 2 - viewW / 2;
    else x0 = Math.min(Math.max((nb[0] + nb[2]) / 2 - viewW / 2, mb[0] - pad), mb[2] + pad - viewW);
    let y0, h;
    if (pb[3] - pb[1] + 2 * pad <= viewH) { y0 = pb[1] - pad; h = pb[3] - pb[1] + 2 * pad; }
    else { y0 = Math.min(Math.max(nb[1] - pad - viewH * 0.15, pb[1] - pad), pb[3] + pad - viewH); h = viewH; }
    return renderScene(order.filter((b) => b.step <= n), s, { newIds: new Set(neu.map((b) => b.id)), box: [x0, y0, viewW, h], occ, ordered: true });
  }

  function page(i) {
    const n = i + 1;
    if (i === 0) {
      return `<section class="page cover"><div class="brand"><i></i>BrickWish</div><h1>${esc(title)}</h1>` +
        `<div class="by">Built by <b>${builder ? esc(builder) : "&nbsp;"}</b></div>` +
        `<div class="hero">${fitScene(bricks, 720, 600)}</div>` +
        `<div class="chips"><span class="chip">${st.pieces.toLocaleString("en-US")} pieces</span><span class="chip">${model.steps} steps</span>` +
        `<span class="chip">Level ${model.level} · ${LEVELS[model.level].name}</span><span class="chip">Ages ${rules.label}</span><span class="chip">${model.bags} bags</span></div>` +
        `<div class="wish"><span>Your wish</span>“${esc(model.wish || title)}” · Designed by BrickWish just for you</div>${foot(n)}</section>`;
    }
    if (i === 1) {
      return `<section class="page"><h2 style="font-size:44px">Before you build</h2><ol class="tips">${TIPS.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` +
        `<h2 style="font-size:26px;margin-top:6px">How to read a step</h2>` +
        `<div class="demo-step"><span class="num">1</span><div style="display:flex;flex-direction:column;gap:8px">${callout(byStep[1])}<span style="font-size:14px">${esc(TIPS[2])}</span></div></div>` +
        `<div class="kitbox"><div><b>${st.pieces.toLocaleString("en-US")}</b>pieces</div><div><b>${model.bags}</b>bags</div><div><b>${model.steps}</b>steps</div><div><b>${Math.round(st.size_cm[2])} cm</b>tall</div></div>` +
        `<p class="warn">${WARN_ICON}<span><b>WARNING:</b> CHOKING HAZARD – Small parts. Not for children under 3 yrs.</span></p>${foot(n)}</section>`;
    }
    if (i < 2 + stepPages) {
      const first = (i - 2) * per + 1;
      const blocks = [];
      for (let k = first; k < first + per && k <= model.steps; k++) {
        const neu = byStep[k];
        const prevBag = k > 1 ? byStep[k - 1][0].bag : 0;
        const bag = neu[0].bag !== prevBag ? `<span class="bag">${BAG_ICON}Open bag ${neu[0].bag}</span>` : "";
        blocks.push(`<div class="step"><div class="step-head"><span class="num">${k}</span>${callout(neu)}${bag}</div><div class="view">${stepView(k)}</div></div>`);
      }
      return `<section class="page"><div class="steps n${per}">${blocks.join("")}</div>${foot(n)}</section>`;
    }
    if (i === 2 + stepPages) {
      return `<section class="page"><h2 class="big-done">You built it!</h2><div class="final">` +
        `<figure>${fitScene(bricks, 340, 760)}<figcaption>Front</figcaption></figure>` +
        `<figure>${fitScene(rotated180(bricks), 340, 760)}<figcaption>Back</figcaption></figure></div>` +
        `<p style="text-align:center;font-size:16px;margin:0">Ask a grown-up to send us a photo. We love seeing wishes come true.</p>${foot(n)}</section>`;
    }
    const b0 = (i - 3 - stepPages) * 24;
    const rows = model.bom.slice(b0, b0 + 24);
    return `<section class="page"><h2 style="font-size:40px">All your pieces</h2><div class="partsgrid">` +
      rows.map((r) => `<div class="pcell">${partIcon(r, 12)}<b>${r.qty}x</b><span>${esc(r.name)}</span><span>${esc(COLORS[r.color].name)} · ${r.part}</span></div>`).join("") +
      `</div><p style="margin:0;font-size:14px">Your kit also has a few spare small pieces, just in case.</p>${foot(n)}</section>`;
  }
  return { count, page };
}

export function manualDocument(model, { code = "DEMO", builder = "", previewPages = 0, fontsCss = "" } = {}) {
  const pages = manualPages(model, { code, builder });
  const n = previewPages ? Math.min(previewPages, pages.count) : pages.count;
  const html = [];
  for (let i = 0; i < n; i++) html.push(pages.page(i));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(model.title)} · BrickWish</title>` +
    `<style>${fontsCss}@page{size:8.5in 11in;margin:0}html,body{margin:0;background:#fff}${MANUAL_CSS}</style></head>` +
    `<body class="bw-manual${previewPages ? " preview" : ""}">${html.join("")}</body></html>`;
}

// ------------------------------------------------------------------ the vendor's files

export function bagRows(model) {
  const m = new Map();
  for (const b of model.bricks) {
    const k = `${b.bag}|${b.part}|${b.name}|${b.color}`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const rows = [...m].map(([k, qty]) => { const [bag, part, name, color] = k.split("|"); return { bag: +bag, part, name, color, qty }; })
    .sort((a, b) => a.bag - b.bag || a.color.localeCompare(b.color) || a.part.localeCompare(b.part));
  for (const r of model.bom) if (r.spares) rows.push({ bag: "spares", part: r.part, name: r.name, color: r.color, qty: r.spares });
  return rows.map((r) => ({ ...r, bricklink_color_id: COLORS[r.color].bl, bricklink_color: COLORS[r.color].blName }));
}

export function partsCsv(model) {
  const cols = ["bag", "part", "name", "color", "bricklink_color_id", "bricklink_color", "qty"];
  return [cols.join(","), ...bagRows(model).map((r) => cols.map((c) => /[",]/.test(String(r[c])) ? `"${String(r[c]).replace(/"/g, '""')}"` : r[c]).join(","))].join("\n") + "\n";
}

export function bricklinkXml(model) {
  const t = new Map();
  for (const r of bagRows(model)) { const k = `${r.part}|${r.bricklink_color_id}`; t.set(k, (t.get(k) ?? 0) + r.qty); }
  const items = [...t].sort().map(([k, q]) => { const [p, c] = k.split("|"); return `<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>${esc(p)}</ITEMID><COLOR>${c}</COLOR><MINQTY>${q}</MINQTY></ITEM>`; });
  return `<INVENTORY>${items.join("")}</INVENTORY>\n`;
}

export function vendorOrder(model, code, { shipTo = null, month = "MM/YYYY" } = {}) {
  const rows = bagRows(model);
  const bags = {};
  for (const r of rows) (bags[r.bag] ??= []).push({ part: r.part, name: r.name, bricklink_color_id: r.bricklink_color_id, bricklink_color: r.bricklink_color, qty: r.qty });
  return {
    order_code: code, model: model.title, level: model.level, pieces: model.stats.pieces,
    pieces_with_spares: rows.reduce((a, r) => a + r.qty, 0), bags,
    packing: {
      packaging: "BrickWish branded box or mailer; one sealed bag per bag number, with a sticker 'Bag N'.",
      labels: [
        "WARNING: CHOKING HAZARD - Small parts. Not for children under 3 yrs. (with the safety-alert triangle)",
        `BrickWish, [City, State], USA · Order ${code} · Made ${month}`,
        "Bricks made in China",
      ],
      no_vendor_branding: true, no_prices_in_parcel: true,
      shipping: "DDP (duties and taxes paid). CPSC certificate eFiling done at entry by the carrier's broker.",
    },
    ship_to: shipTo ?? { name: "", address1: "", address2: "", city: "", state: "", zip: "", country: "US" },
  };
}

export function vendorEmail(order) {
  const st = order.ship_to;
  return [
    `Subject: BrickWish order ${order.order_code} - ${order.model} (${order.pieces_with_spares} pcs)`, "",
    "Hello,", "",
    `Please pick, pack and dropship BrickWish order ${order.order_code}.`,
    `- Parts: see the attached parts.csv (bag by bag) or bricklink.xml (${order.pieces_with_spares} pieces including spares).`,
    "- Pack each bag number separately and label it 'Bag N'. Put the spares bag in last.",
    `- Packaging: ${order.packing.packaging}`,
    "- Labels on the outside of the package:",
    ...order.packing.labels.map((l) => `    * ${l}`),
    "- No vendor branding, invoices or prices inside the parcel.",
    `- Shipping: ${order.packing.shipping}`, "",
    "Ship to:", `    ${st.name}`, `    ${st.address1} ${st.address2 ?? ""}`.trimEnd(), `    ${st.city}, ${st.state} ${st.zip}`, `    ${st.country}`, "",
    "Please reply with the tracking number and any part substitutions before shipping.", "", "Thank you,", "BrickWish Orders",
  ].join("\n");
}

// Smaller model object for viewers (the website's 3D preview, the video recorder).
export function viewerModel(model) {
  return {
    title: model.title, steps: model.steps,
    colors: Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, v.hex])),
    bricks: model.bricks.map((b) => [b.x, b.y, b.z, b.w, b.d, b.color, b.kind, b.step]),
  };
}

// ------------------------------------------------------------------ design helpers

// Ground height (top layer + 1) at every column after drawing these shapes: Map "x,y" -> height.
// Lets a designer (or a script) place things on slopes without guessing.
export function surfaceHeights(shapes) {
  const g = new Grid();
  shapes.forEach((sh, i) => applyShape(g, sh, 1, `shapes[${i}]`));
  const out = new Map();
  for (const [k2, t] of g.top) out.set(`${Math.floor(k2 / 4096) - OFF},${(k2 % 4096) - OFF}`, t);
  return out;
}

// The cells one shape fills, before anything else is drawn: [[x, y, z], ...]
export function shapeCells(sh) {
  return regionCells(sh, 1);
}
