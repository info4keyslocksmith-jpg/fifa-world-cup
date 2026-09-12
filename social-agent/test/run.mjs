// Drives each site flow against a local stand-in page that has the same element
// ids and roles as the real site, and checks what the page received. Also
// checks brand validation, job building, and the runner's due/wait logic.
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { validateSpec } from '../lib/brand.mjs';
import { buildJobs, readyNow } from '../lib/jobs.mjs';
import { readSpec, processSpec } from '../lib/runner.mjs';
import { withBrowser } from '../lib/browser.mjs';
import * as youtube from '../lib/sites/youtube.mjs';
import * as tiktok from '../lib/sites/tiktok.mjs';
import * as instagram from '../lib/sites/instagram.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => pathToFileURL(join(here, 'fixtures', `${n}.html`)).href;
const dir = mkdtempSync(join(tmpdir(), '4keys-'));
process.env.CHROME_PROFILE_DIR = join(dir, 'profile');
process.env.HEADLESS = '1';
if (existsSync('/opt/pw-browsers/chromium') && !process.env.BROWSER_EXECUTABLE) process.env.BROWSER_EXECUTABLE = '/opt/pw-browsers/chromium';

const video = join(dir, 'clip.mp4');
const thumb = join(dir, 'thumb.jpg');
writeFileSync(video, 'fake');
writeFileSync(thumb, 'fake');
const inThreeDays = new Date(Date.now() + 3 * 86400000);
const good = {
  id: 'test-good',
  video,
  thumbnail: thumb,
  date: inThreeDays.toISOString(),
  caption: 'Got a call at 2am. 2019 BMW 330i, no key, dealer said tow it.\n\nI drove out anyway.\n\nLesson: the jobs nobody wants build your name.\n\nWildest late-night call you ever took?',
  hashtags: ['#autolocksmith', '#bmw', '#smallbusiness', '#hustleculture', '#4keyslocksmith'],
  platforms: {
    instagram: { enabled: true },
    tiktok: { enabled: true, title: 'The 2am BMW call' },
    youtube: { enabled: true, title: 'The 2am BMW key the dealer said needed a tow', tags: ['auto locksmith', 'bmw key'] },
  },
};

try {
  // 1. brand rules
  const bad = { ...good, caption: 'Watch this satisfying key cut. Call us for service! Our team is the best.', hashtags: ['#asmr', '#miami', '#locksmith', '#keys', '#cars', '#4keyslocksmith'], platforms: { ...good.platforms, youtube: { enabled: true } } };
  const v = validateSpec(bad);
  const msg = v.errors.join('\n');
  for (const re of [/6 hashtags/, /#asmr is banned/, /#miami is a geo tag/, /hard CTA/, /youtube\.title is required/]) assert.match(msg, re);
  assert.ok(v.warnings.some((w) => /first person/.test(w)));
  assert.deepEqual(validateSpec(good), { errors: [], warnings: [] });
  console.log('✔ brand validation');

  // 2. jobs + timing
  const jobs = buildJobs(good, { media: { video, thumbnail: thumb } });
  const by = Object.fromEntries(jobs.map((j) => [j.platform, j]));
  assert.equal(by.youtube.mode, 'schedule');
  assert.equal(by.tiktok.mode, 'now');
  assert.match(by.instagram.caption, /#4keyslocksmith$/);
  assert.ok(!by.instagram.caption.includes('#fyp'));
  assert.deepEqual(by.youtube.tags, ['auto locksmith', 'bmw key']);
  assert.equal(readyNow(by.youtube), true, 'YouTube uploads early with its own scheduler');
  assert.equal(readyNow(by.instagram), false, 'Instagram waits until due');
  assert.equal(readyNow(by.instagram, inThreeDays.getTime() + 1), true);
  const nowJobs = buildJobs({ ...good, date: new Date(Date.now() + 60000).toISOString() }, { media: {} });
  assert.equal(nowJobs.find((j) => j.platform === 'youtube').mode, 'now', 'too close to schedule → publish now');
  console.log('✔ jobs and timing');

  // 3. site flows against fixtures
  await withBrowser(async (page) => {
    await youtube.post(page, { ...by.youtube, scheduleAt: new Date(2026, 8, 21, 17, 3) }, () => {}, { home: fixture('youtube') });
    let c = await page.evaluate(() => window.__c);
    assert.equal(c.video, 'clip.mp4');
    assert.equal(c.thumb, 'thumb.jpg');
    assert.equal(c.title, by.youtube.title);
    assert.match(c.desc, /#4keyslocksmith$/);
    assert.deepEqual(c.radios, ['VIDEO_MADE_FOR_KIDS_NOT_MFK', 'SCHEDULE']);
    assert.equal(c.tags, 'auto locksmith,bmw key,');
    assert.equal(c.next, 3);
    assert.equal(c.day, 'Sep 21, 2026');
    assert.equal(c.time, '5:00 PM', 'rounded to the 15-minute grid');
    assert.equal(c.done, true);
    assert.equal(c.closed, true);
    console.log('✔ youtube flow (schedule)');

    await youtube.post(page, { ...by.youtube, mode: 'now', visibility: 'public' }, () => {}, { home: fixture('youtube') });
    c = await page.evaluate(() => window.__c);
    assert.deepEqual(c.radios, ['VIDEO_MADE_FOR_KIDS_NOT_MFK', 'PUBLIC']);
    console.log('✔ youtube flow (publish now)');

    await tiktok.post(page, by.tiktok, () => {}, { home: fixture('tiktok') });
    c = await page.evaluate(() => window.__c);
    assert.equal(c.video, 'clip.mp4');
    assert.equal(c.caption, by.tiktok.caption.replace(/\n/g, ''));
    assert.equal(c.posted, true);
    console.log('✔ tiktok flow');

    await instagram.post(page, by.instagram, () => {}, { home: fixture('instagram') });
    c = await page.evaluate(() => window.__c);
    assert.equal(c.video, 'clip.mp4');
    assert.equal(c.ok, true);
    assert.equal(c.crop, 'Original');
    assert.equal(c.next, 2);
    assert.equal(c.caption, by.instagram.caption.replace(/\n/g, ''));
    assert.equal(c.shared, true);
    console.log('✔ instagram flow');
  });

  // 4. runner: dry run waits on IG/TT, runs YT; --now runs all; status persisted; failure captured
  const specPath = join(dir, 'spec.json');
  writeFileSync(specPath, JSON.stringify(good));
  const spec = readSpec(specPath);
  const quiet = { log: () => {} };
  let r = await processSpec(spec, { dryRun: true, ...quiet });
  assert.deepEqual(r.ran, ['youtube']);
  assert.deepEqual(r.waiting.sort(), ['instagram', 'tiktok']);

  const fakeSites = {
    youtube: { post: async () => ({ ok: true }) },
    tiktok: { post: async () => { throw new Error('boom'); } },
    instagram: { post: async () => ({ ok: true }) },
  };
  r = await processSpec(spec, { now: true, sites: fakeSites, ...quiet });
  assert.deepEqual(r.ran.sort(), ['instagram', 'youtube']);
  assert.deepEqual(r.failed, ['tiktok']);
  const saved = JSON.parse(readFileSync(specPath, 'utf8'));
  assert.equal(saved.status.youtube.state, 'done');
  assert.equal(saved.status.tiktok.state, 'failed');
  assert.equal(saved.status.tiktok.attempts, 1);
  assert.ok(!('__file' in saved));

  // retry only the failed one, then everything is done and the spec is archived
  fakeSites.tiktok.post = async () => ({ ok: true });
  r = await processSpec(readSpec(specPath), { now: true, sites: fakeSites, ...quiet });
  assert.deepEqual(r.ran, ['tiktok']);
  assert.ok(!existsSync(specPath), 'archived out of the queue dir');
  console.log('✔ runner (due/wait, status, retry, archive)');

  console.log('\nAll tests passed.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// 5. drive: paths resolve inside the synced Google Drive folder
{
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { resolveDrivePath, findDriveFolder } = await import('../lib/drive.mjs');
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  try {
    assert.equal(findDriveFolder(undefined, home), null);
    const folder = join(home, 'Library', 'CloudStorage', 'GoogleDrive-juan@example.com', 'My Drive', 'Videos 4keys Claude');
    mkdirSync(join(folder, '4_ready'), { recursive: true });
    writeFileSync(join(folder, '4_ready', 'clip.mp4'), 'x');
    assert.equal(resolveDrivePath('drive:4_ready/clip.mp4', home), join(folder, '4_ready', 'clip.mp4'));
    console.log('✔ drive: path resolution');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
