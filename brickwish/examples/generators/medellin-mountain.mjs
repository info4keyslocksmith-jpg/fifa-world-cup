// Generates examples/medellin-mountain.json (Level 6, 5,000+ pieces). Big scenes with many repeated props
// (112 hillside houses, 34 pines) are easier to write as a small script than by hand.
//     node examples/generators/medellin-mountain.mjs
import fs from "fs";
import * as E from "../../engine/engine.js";

const W = 96, D = 64;
const terrain = {
  type: "terrain", at: [0, 0], size: [W, D], base: 2, noise: 1.2, seed: 11,
  colors: [{ below: 3, color: "tan" }, { below: 29, color: "green" }, { color: "gray" }],
  peaks: [
    { at: [52, 4], height: 32, radius: 34 },
    { at: [12, 10], height: 22, radius: 20 },
    { at: [88, 8], height: 24, radius: 20 },
    { at: [30, 18], height: 6, radius: 10 },
  ],
};
const valley = [
  { type: "box", at: [0, 44, 0], size: [W, 20, 2], color: "tan" },
  { type: "carve", region: { type: "box", at: [0, 44, 2], size: [W, 20, 10] } },
  { type: "box", at: [0, 46, 0], size: [W, 3, 2], color: "blue" },
  ...[[6, 47], [22, 46], [41, 48], [58, 47], [77, 46], [88, 48]].map(([x, y]) => ({ type: "line", from: [x, y, 1], to: [x + 4, y, 1], radius: 0.5, color: "azure" })),
  { type: "paint", region: { type: "box", at: [0, 44, 0], size: [W, 2, 2] }, color: "dark_gray" },
  { type: "paint", region: { type: "box", at: [0, 49, 0], size: [W, 2, 2] }, color: "dark_gray" },
  { type: "paint", region: { type: "box", at: [0, 51, 0], size: [W, 13, 2] }, color: "gray" },
  { type: "paint", region: { type: "box", at: [16, 51, 0], size: [14, 6, 2] }, color: "green" },
];
const heights = E.surfaceHeights([terrain, ...valley]);
const hAt = (x, y) => heights.get(`${x},${y}`) ?? 0;
const maxH = (x, y, w, d) => { let m = 0; for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) m = Math.max(m, hAt(x + i, y + j)); return m; };
const minH = (x, y, w, d) => { let m = 1e9; for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) m = Math.min(m, hAt(x + i, y + j)); return m; };

// ---- Metrocable: valley station -> 3 towers -> top station (toward Parque Arví)
const stops = [[36, 40], [39, 32], [39, 24], [39, 16], [36, 8]];
const shapes = [];
const tops = [];
stops.forEach(([x, y], i) => {
  const base = maxH(x, y, i === 0 || i === 4 ? 6 : 2, i === 0 || i === 4 ? 4 : 2);
  if (i === 0 || i === 4) {   // stations
    shapes.push({ type: "box", at: [x, y, base], size: [6, 4, 5], color: "white" });
    shapes.push({ type: "paint", region: { type: "box", at: [x, y, base + 2], size: [6, 4, 1] }, color: "azure" });
    shapes.push({ type: "box", at: [x, y, base + 5], size: [6, 4, 1], color: "dark_gray" });
    tops.push([x + 3, y + 2, base + 6]);
    shapes.push({ type: "box", at: [x + 3, y + 2, base + 6], size: [1, 1, 1], color: "dark_gray" });
  } else {                    // towers
    shapes.push({ type: "box", at: [x, y, base], size: [2, 2, 9], color: "gray" });
    shapes.push({ type: "box", at: [x, y, base + 9], size: [2, 2, 1], color: "dark_gray" });
    tops.push([x, y, base + 10]);
  }
});
const cables = [];
for (let i = 0; i + 1 < tops.length; i++) cables.push({ type: "cable", from: tops[i], to: tops[i + 1], sag: 1, radius: 0.5, color: "black" });
shapes.push(...cables);
// gondolas hang right under the cable, away from the ground
let gondolas = 0;
for (const c of cables) {
  const cells = E.shapeCells(c);
  const low = new Map();
  for (const [x, y, z] of cells) { const k = `${x},${y}`; if (!low.has(k) || z < low.get(k)) low.set(k, z); }
  const cols = [...low.entries()].map(([k, z]) => [...k.split(",").map(Number), z]);
  cols.sort((a, b) => Math.hypot(a[0] - (c.from[0] + c.to[0]) / 2, a[1] - (c.from[1] + c.to[1]) / 2) - Math.hypot(b[0] - (c.from[0] + c.to[0]) / 2, b[1] - (c.from[1] + c.to[1]) / 2));
  for (const [x, y, z] of cols) {
    const pz = z - 2;
    if (maxH(x, y, 2, 2) < pz - 1) {
      shapes.push({ type: "prefab", name: "gondola", at: [x, y, pz], on_surface: false, colors: { body: gondolas % 2 ? "red" : "yellow" } });
      gondolas++;
      break;
    }
  }
}

// ---- comunas: little brick houses climbing the lower slopes
const wallColors = ["orange", "brown", "red", "pink", "yellow", "white", "azure", "brown", "orange", "lime"];
const roofColors = ["dark_gray", "gray", "brown", "dark_gray"];
const near = (x, y, pts, r) => pts.some(([a, b]) => Math.hypot(a - x, b - y) < r);
const corridor = stops.map(([x, y]) => [x + 1, y + 1]);
const onCable = (x, y) => {
  for (let i = 0; i + 1 < stops.length; i++) {
    const [ax, ay] = stops[i], [bx, by] = stops[i + 1];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    if (Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) < 4.5) return true;
  }
  return false;
};
const houses = [], pines = [];
let n = 0;
for (let y = 12; y <= 42; y += 3) for (let x = 1; x <= W - 3; x += 3) {
  const jx = x + ((x * 7 + y * 3) % 2), jy = y + ((x * 5 + y) % 2);
  if (jy + 2 > 43) continue;
  const lo = minH(jx, jy, 2, 2), hi = maxH(jx, jy, 2, 2);
  if (hi - lo > 2 || onCable(jx, jy) || near(jx, jy, corridor, 5)) continue;
  if (hi >= 4 && hi <= 19) {
    houses.push({ type: "prefab", name: "hillside_house", at: [jx, jy], facing: "+y",
      colors: { walls: wallColors[n % wallColors.length], roof: roofColors[(n * 3) % roofColors.length] } });
    n++;
  }
}
for (let y = 0; y <= 34; y += 4) for (let x = 0; x <= W - 3; x += 4) {
  const jx = x + ((x + y) % 3), jy = y + ((x * 3 + y) % 3);
  const hi = maxH(jx, jy, 3, 3), lo = minH(jx, jy, 3, 3);
  if (hi >= 21 && hi - lo <= 3 && !onCable(jx + 1, jy + 1) && !near(jx, jy, corridor, 5)) pines.push([jx, jy]);
}
shapes.push(...houses);
shapes.push({ type: "prefab", name: "pine", at: pines });

// ---- Biblioteca España: three dark "boulder" library buildings beside the top Metrocable station
const lib = [[44, 10, 5, 4, 5], [50, 9, 4, 5, 6], [46, 15, 4, 3, 4]];
for (const [x, y, w, d, h] of lib) {
  const base = maxH(x, y, w, d);
  shapes.push({ type: "box", at: [x, y, base], size: [w, d, h], color: "black" });
  shapes.push({ type: "paint", region: { type: "box", at: [x, y, base + 1], size: [w, d, h - 2] }, pattern: "rows", every: 3, offset: (base + 1) % 3, color: "dark_gray" });
}

// ---- the city in the valley: Metro viaduct with a train, the Coltejer tower, buildings, a flower park
for (let x = 2; x < W; x += 9) shapes.push({ type: "box", at: [x, 50, 2], size: [2, 2, 5], color: "gray" });
shapes.push({ type: "box", at: [0, 50, 7], size: [W, 2, 2], color: "gray" });
shapes.push({ type: "prefab", name: "bus", at: [[30, 50], [36, 50], [42, 50]], colors: { body: "white", windows: "azure" } });
shapes.push(
  { type: "box", at: [60, 55, 2], size: [6, 6, 26], color: "gray" },
  { type: "paint", region: { type: "box", at: [60, 55, 3], size: [6, 6, 24] }, pattern: "rows", every: 2, offset: 1, color: "azure" },
  { type: "taper", at: [60, 55, 28], size: [6, 6, 3], inset_per_layer: 1, color: "gray" },
  { type: "line", from: [62, 57, 31], to: [62, 57, 38], radius: 0.5, color: "white" },
);
shapes.push({ type: "prefab", name: "tower", scale: 2, at: [[34, 56], [44, 57], [72, 56], [84, 55], [4, 56]],
  colors: { walls: "white", windows: "azure" } });
shapes.push({ type: "prefab", name: "tower", scale: 2, at: [[52, 56], [90, 57]], colors: { walls: "tan", windows: "blue" } });
shapes.push({ type: "prefab", name: "house", at: [[11, 58], [26, 59], [78, 60], [68, 60]], colors: { walls: "white", roof: "red" } });
const flowers = [];
for (let x = 17; x < 29; x += 2) for (let y = 52; y < 56; y += 2) flowers.push([x, y]);
const petal = ["pink", "yellow", "red", "purple", "orange", "white"];
petal.forEach((c, i) => shapes.push({ type: "prefab", name: "flower", at: flowers.filter((_, k) => k % petal.length === i), colors: { petals: c } }));
shapes.push({ type: "prefab", name: "tree", at: [[16, 51], [27, 54], [1, 51], [92, 51]] });
shapes.push({ type: "prefab", name: "person", at: [[20, 56], [23, 55], [29, 52]], colors: { shirt: "yellow", pants: "blue" } });

const spec = {
  title: "Medellín Mountains",
  wish: "medellin mountain",
  level: 6,
  age: "13+",
  builder: "Valentina",
  notes: "The Aburrá Valley: green mountains covered with colorful comuna houses, the Metrocable climbing past Biblioteca España to the pine forest of Parque Arví, the Medellín River, the elevated Metro with a train, the Coltejer building with its needle top, towers and a flower park for the Feria de las Flores.",
  hollow: { wall: 2, keep_under_roof: 1 },
  shapes: [terrain, ...valley, ...shapes],
};
fs.writeFileSync(new URL("../medellin-mountain.json", import.meta.url), JSON.stringify(spec, null, 1) + "\n");
console.log(`houses ${houses.length}, pines ${pines.length}, gondolas ${gondolas}`);
