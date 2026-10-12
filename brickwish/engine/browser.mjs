// Browser jobs for the pipeline (headless Chromium via Playwright):
//   node browser.mjs pdf    manual.html manual.pdf
//   node browser.mjs pages  preview.html out_dir prefix        -> prefix-1.png ... one image per page
//   node browser.mjs video  viewer.html build.mp4 poster.png   -> 9:16 build animation, 30 fps
//   node browser.mjs frame  viewer.html frame.png 12.5           -> one frame at t seconds
//   node browser.mjs svgs   out.png a.svg b.svg                  -> drawings side by side (design agent's eyes)
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright")); }

const [, , mode, ...args] = process.argv;
const url = (p) => "file://" + path.resolve(p);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

try {
  if (mode === "pdf") {
    const [html, out] = args;
    const page = await browser.newPage();
    await page.goto(url(html), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  } else if (mode === "pages") {
    const [html, outDir, prefix] = args;
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1.5 });
    await page.goto(url(html), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const pages = await page.$$(".page");
    for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(outDir, `${prefix}-${i + 1}.png`) });
  } else if (mode === "video") {
    const [html, out, poster] = args;
    const fps = 30;
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 4 / 3 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url(html) + "#record", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error("viewer error: " + errors.join("; "));
    const duration = await page.evaluate(() => window.DURATION);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-frames-"));
    const frames = Math.ceil(duration * fps);
    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.setTime(t), f / fps);
      await page.screenshot({ path: path.join(dir, `f${String(f).padStart(5, "0")}.jpg`), type: "jpeg", quality: 90 });
    }
    if (poster) {
      await page.evaluate((t) => window.setTime(t), duration - 0.05);
      await page.screenshot({ path: poster });
    }
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", path.join(dir, "f%05d.jpg"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", "-preset", "medium", "-movflags", "+faststart", out]);
    fs.rmSync(dir, { recursive: true, force: true });
  } else if (mode === "svgs") {
    const [out, ...svgs] = args;
    const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
    const cells = svgs.map((f) => `<div style="flex:1;min-width:0;height:740px;display:flex;align-items:center;justify-content:center">` +
      fs.readFileSync(f, "utf8").replace("<svg ", '<svg style="width:100%;height:100%" ') + "</div>").join("");
    await page.setContent(`<body style="margin:0;background:#EAF3FC;display:flex;gap:10px;padding:10px">${cells}</body>`);
    await page.screenshot({ path: out });
  } else if (mode === "frame") {
    const [html, out, t] = args;
    const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 4 / 3 });
    await page.goto(url(html) + "#record", { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((x) => window.setTime(x), Number(t));
    await page.screenshot({ path: out });
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
} finally {
  await browser.close();
}
