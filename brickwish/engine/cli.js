#!/usr/bin/env node
// BrickWish engine command line (Node 18+, Playwright's Chromium, ffmpeg).
//
//   node engine/cli.js build   spec.json out_dir [--code BW-XXXXX] [--builder Mateo] [--no-video]
//       model.json, manual.pdf, preview-1..5.png, build.mp4, poster.png, viewer.html,
//       parts.csv, bricklink.xml, vendor_order.json, vendor_email.txt. Prints a JSON summary.
//   node engine/cli.js preview spec.json [picture.png]
//       Prints a JSON report (pieces, level range, warnings...) and draws the front and back.
//       This is what the design agent calls after every change.
//   node engine/cli.js manual  out_dir --builder Mateo --code BW-XXXXX
//       Rebuilds manual.pdf from out_dir/model.json with the builder's name on the cover (after payment).
//   node engine/cli.js guide
//       Prints the design guide (the rules every design agent follows).
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import * as E from "./engine.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright")); }

const FONTS = [
  ["Baloo 2", 700, "@fontsource/baloo-2/files/baloo-2-latin-700-normal.woff2"],
  ["Baloo 2", 800, "@fontsource/baloo-2/files/baloo-2-latin-800-normal.woff2"],
  ["Lexend", 400, "@fontsource/lexend/files/lexend-latin-400-normal.woff2"],
  ["Lexend", 600, "@fontsource/lexend/files/lexend-latin-600-normal.woff2"],
];
function fontsCss() {
  return FONTS.map(([family, weight, rel]) => {
    const f = path.join(HERE, "node_modules", rel);
    if (!fs.existsSync(f)) return "";
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${fs.readFileSync(f).toString("base64")}) format('woff2')}`;
  }).join("\n");
}

function args(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const name = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[name] = argv[++i]; else flags[name] = true;
    } else pos.push(argv[i]);
  }
  return [pos, flags];
}

const THREE_LOCAL = path.join(HERE, "node_modules/three/build/three.min.js");
export const THREE_CDN = "https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js";

export function viewerPage(model, { threeSrc = THREE_CDN, record = false } = {}) {
  const vm = E.viewerModel(model);
  const viewerJs = fs.readFileSync(path.join(HERE, "viewer.js"), "utf8");
  const three = record ? `<script>${fs.readFileSync(THREE_LOCAL, "utf8")}</script>` : `<script src="${threeSrc}"></script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${model.title} · BrickWish</title><style>${fontsCss()}
:root{--ink:#14203B;--yellow:#FFC629}
html,body{margin:0;height:100%;overflow:hidden;color:var(--ink);font-family:'Lexend',system-ui,sans-serif;
background:radial-gradient(circle,#CFE1F3 0 5px,transparent 5.5px) 0 0/20px 20px,linear-gradient(#EAF3FC,#D9E9F7 70%,#C9DDF2)}
canvas{position:fixed;inset:0;width:100%;height:100%;touch-action:none}
.top{position:fixed;left:0;right:0;top:5%;text-align:center;padding:0 6%;pointer-events:none}
.kicker{font:600 clamp(12px,3.4vw,18px)/1.2 'Lexend',sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.75}
.title{font:800 clamp(28px,9vw,56px)/1 'Baloo 2',sans-serif;margin-top:6px;text-wrap:balance}
.bottom{position:fixed;left:0;right:0;bottom:4.5%;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.count{font:800 clamp(18px,5vw,30px)/1 'Baloo 2',sans-serif;background:#fff;border:3px solid var(--ink);border-radius:999px;padding:8px 18px;font-variant-numeric:tabular-nums}
.count.ready{background:var(--yellow);box-shadow:0 4px 0 var(--ink)}
.brand{display:flex;align-items:center;gap:8px;font:800 clamp(16px,4.4vw,26px)/1 'Baloo 2',sans-serif}
.brand i{width:26px;height:14px;background:var(--yellow);border-radius:2px;position:relative;display:inline-block;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
.brand i::before{content:"";position:absolute;top:-5px;left:3px;width:6px;height:5px;background:var(--yellow);border-radius:1px 1px 0 0;box-shadow:13px 0 0 var(--yellow)}
</style></head><body>
<canvas id="c"></canvas>
<div class="top"><div class="kicker">Your wish</div><div class="title" id="title"></div></div>
<div class="bottom"><div class="count" id="count"></div><div class="brand"><i></i>BrickWish</div></div>
${three}<script>${viewerJs}</script>
<script>
const MODEL = ${JSON.stringify(vm)};
document.getElementById("title").textContent = MODEL.title;
const count = document.getElementById("count");
const v = BrickWishViewer.create(document.getElementById("c"), MODEL, THREE, { preserve: true, onFrame: (f) => {
  count.textContent = f.finished ? "Ready to build!" : f.placed.toLocaleString("en-US") + " / " + f.total.toLocaleString("en-US") + " pieces";
  count.classList.toggle("ready", f.finished);
}});
window.setTime = v.setTime; window.DURATION = v.duration;
addEventListener("resize", () => v.resize());
if (location.hash === "#record") v.setTime(0); else v.play();
</script></body></html>`;
}

// The video needs WebGL (software GPU); pages and pictures render much faster with the GPU off.
async function withBrowser(fn, { webgl = false } = {}) {
  const browser = await chromium.launch({ args: webgl ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] : ["--disable-gpu"] });
  try { return await fn(browser); } finally { await browser.close(); }
}

// Big scenes (thousands of shapes) become JPEG pictures so the PDF stays small and opens fast on phones.
const RASTER_SHAPES = 1500, RASTER_SCALE = 1.75, RASTER_QUALITY = 75;

async function printPdf(browser, model, opts, out) {
  const pages = E.manualPages(model, opts);
  const shell = E.manualDocument(model, { ...opts, previewPages: 1 }).replace(/<body[^>]*>[\s\S]*<\/body>/, '<body class="bw-manual"></body>');
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: RASTER_SCALE });
  await page.setContent(shell, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const done = [];
  for (let i = 0; i < pages.count; i++) {
    await page.evaluate((html) => { document.body.innerHTML = html; }, pages.page(i));
    const heavy = await page.$$eval("svg", (svgs, min) => svgs.map((s, j) => (s.childElementCount >= min ? j : -1)).filter((j) => j >= 0), RASTER_SHAPES);
    if (heavy.length) {
      const svgs = await page.$$("svg");
      const shots = [];
      for (const j of heavy) shots.push((await svgs[j].screenshot({ type: "jpeg", quality: RASTER_QUALITY })).toString("base64"));
      await page.evaluate(([idx, imgs]) => {
        const svgs = [...document.querySelectorAll("svg")];
        idx.forEach((j, n) => {
          const s = svgs[j], r = s.getBoundingClientRect(), img = document.createElement("img");
          img.src = "data:image/jpeg;base64," + imgs[n];
          img.alt = s.getAttribute("aria-label") || "";
          img.style.cssText = `display:block;width:${r.width}px;height:${r.height}px`;
          s.replaceWith(img);
        });
      }, [heavy, shots]);
    }
    done.push(await page.evaluate(() => document.body.innerHTML));
  }
  await page.close();
  const tmp = path.join(os.tmpdir(), `bw-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, shell.replace("</body>", done.join("") + "</body>"));
  const pdfPage = await browser.newPage();
  await pdfPage.goto("file://" + tmp, { waitUntil: "load", timeout: 0 });
  await pdfPage.evaluate(() => document.fonts.ready);
  await pdfPage.pdf({ path: out, preferCSSPageSize: true, printBackground: true, timeout: 0 });
  await pdfPage.close();
  fs.rmSync(tmp);
}

async function shootPages(browser, html, outDir, prefix) {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1.5 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const pages = await page.$$(".page");
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(outDir, `${prefix}-${i + 1}.png`) });
  await page.close();
}

async function recordVideo(browser, html, out, poster) {
  const tmp = path.join(os.tmpdir(), `bw-rec-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 4 / 3 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file://" + tmp + "#record", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) throw new Error("viewer error: " + errors.join("; "));
  const duration = await page.evaluate(() => window.DURATION);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-frames-"));
  const fps = 30, frames = Math.ceil(duration * fps);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((t) => window.setTime(t), f / fps);
    await page.screenshot({ path: path.join(dir, `f${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 90 });
  }
  await page.evaluate((t) => window.setTime(t), duration - 0.05);
  await page.screenshot({ path: poster });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(dir, "f%05d.jpg"),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", "-preset", "medium", "-movflags", "+faststart", out]);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(tmp);
}

function report(model) {
  const lv = E.LEVELS[model.level];
  return {
    ok: model.ok, pieces: model.stats.pieces, level: model.level, level_range: [lv.min, lv.max], steps: model.steps, bags: model.bags,
    size_cm: model.stats.size_cm, footprint_studs: model.stats.studs, layers: model.stats.layers, warnings: model.warnings,
    colors_used: [...new Set(model.bricks.map((b) => b.color))].sort(), scale_used: model.scale,
  };
}

async function cmdBuild([specPath, outDir], flags) {
  const t0 = Date.now();
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const model = E.compile(spec);
  fs.mkdirSync(outDir, { recursive: true });
  const code = flags.code || "DEMO", builder = flags.builder || spec.builder || "";
  fs.writeFileSync(path.join(outDir, "model.json"), JSON.stringify(model));
  const fonts = fontsCss();
  await withBrowser(async (browser) => {
    await printPdf(browser, model, { code, builder, fontsCss: fonts }, path.join(outDir, "manual.pdf"));
    await shootPages(browser, E.manualDocument(model, { code, builder, fontsCss: fonts, previewPages: 5 }), outDir, "preview");
  });
  fs.writeFileSync(path.join(outDir, "viewer.html"), viewerPage(model));
  if (!flags["no-video"]) {
    await withBrowser((browser) => recordVideo(browser, viewerPage(model, { record: true }), path.join(outDir, "build.mp4"), path.join(outDir, "poster.png")), { webgl: true });
  }
  const order = E.vendorOrder(model, code, { month: new Date().toISOString().slice(5, 7) + "/" + new Date().getFullYear() });
  fs.writeFileSync(path.join(outDir, "parts.csv"), E.partsCsv(model));
  fs.writeFileSync(path.join(outDir, "bricklink.xml"), E.bricklinkXml(model));
  fs.writeFileSync(path.join(outDir, "vendor_order.json"), JSON.stringify(order, null, 1));
  fs.writeFileSync(path.join(outDir, "vendor_email.txt"), E.vendorEmail(order));
  const pages = E.manualPages(model).count;
  console.log(JSON.stringify({ ...report(model), pages, seconds: Math.round((Date.now() - t0) / 1000) }));
}

async function cmdPreview([specPath, png]) {
  const spec = JSON.parse(fs.readFileSync(specPath === "-" ? 0 : specPath, "utf8"));
  const model = E.compile(spec);
  if (png) {
    const front = E.fitScene(model.bricks, 480, 720), back = E.fitScene(E.rotated180(model.bricks), 480, 720);
    await withBrowser(async (browser) => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
      await page.setContent(`<body style="margin:0;background:#EAF3FC;display:flex;gap:10px;padding:10px">` +
        [front, back].map((s) => `<div style="flex:1;height:740px;display:flex;align-items:center;justify-content:center">${s.replace("<svg ", '<svg style="width:100%;height:100%" ')}</div>`).join("") + "</body>");
      await page.screenshot({ path: png });
    });
  }
  console.log(JSON.stringify(report(model)));
}

async function cmdManual([outDir], flags) {
  const model = JSON.parse(fs.readFileSync(path.join(outDir, "model.json"), "utf8"));
  await withBrowser((browser) => printPdf(browser, model, { code: flags.code || "DEMO", builder: flags.builder || "", fontsCss: fontsCss() }, path.join(outDir, "manual.pdf")));
  console.log(JSON.stringify({ ok: true }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const [pos, flags] = args(rest);
  const run = { build: cmdBuild, preview: cmdPreview, manual: cmdManual,
                guide: async () => process.stdout.write(fs.readFileSync(path.join(HERE, "DESIGN_GUIDE.md"), "utf8")) }[cmd];
  if (!run) { console.error("usage: node engine/cli.js build|preview|manual|guide ..."); process.exit(1); }
  run(pos, flags).catch((e) => {
    if (e instanceof E.SpecError) { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(2); }
    console.error(e); process.exit(1);
  });
}
