import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { AGENT_ROOT } from './env.mjs';
import { validateSpec } from './brand.mjs';
import { buildJobs, enabledPlatforms, readyNow } from './jobs.mjs';
import { SITES } from './sites/index.mjs';
import { withBrowser, saveErrorShot } from './browser.mjs';
import { isDrivePath, resolveDrivePath, DRIVE_HELP } from './drive.mjs';

export const QUEUE_DIR = join(AGENT_ROOT, 'queue');
export const DONE_DIR = join(QUEUE_DIR, 'done');

export function readSpec(specPath) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  spec.__file = specPath;
  spec.id = spec.id || basename(specPath).replace(/\.json$/, '');
  spec.status = spec.status || {};
  return spec;
}

export function saveSpec(spec) {
  const { __file, ...clean } = spec;
  writeFileSync(__file, JSON.stringify(clean, null, 2) + '\n');
}

export function queueSpecs() {
  if (!existsSync(QUEUE_DIR)) return [];
  return readdirSync(QUEUE_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('example') && !f.startsWith('_'))
    .map((f) => readSpec(join(QUEUE_DIR, f)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

/** Resolve a media path: absolute, relative to the spec file, relative to social-agent/, or to cwd. */
export function resolveMedia(spec, p) {
  if (!p) return null;
  if (isDrivePath(p)) return resolveDrivePath(p) || p; // unresolved drive: path stays as-is and fails the exists check
  if (isAbsolute(p)) return p;
  const candidates = [join(dirname(spec.__file || QUEUE_DIR), p), join(AGENT_ROOT, p), join(process.cwd(), p)];
  return candidates.find((c) => existsSync(c)) || candidates[0];
}

export function pendingPlatforms(spec, only) {
  return enabledPlatforms(spec, only).filter((p) => spec.status?.[p]?.state !== 'done');
}

export function archiveSpec(spec) {
  const doneDir = join(dirname(spec.__file), 'done'); // queue/done for queued specs
  mkdirSync(doneDir, { recursive: true });
  const target = join(doneDir, basename(spec.__file));
  saveSpec(spec);
  if (spec.__file !== target) renameSync(spec.__file, target);
  spec.__file = target;
  return target;
}

/**
 * Process one spec: validate, build jobs, run every job that is ready now in
 * the browser, record the outcome in the spec, archive when everything is done.
 * Returns { ran: [...], waiting: [...], failed: [...] }.
 */
export async function processSpec(spec, { only, now = false, dryRun = false, force = false, log = console.error, sites = SITES, browserOpts } = {}) {
  const platforms = pendingPlatforms(spec, only);
  const result = { ran: [], waiting: [], failed: [] };
  if (!platforms.length) {
    log(`  ✔ ${spec.id}: nothing left to do`);
    return result;
  }

  const { errors, warnings } = validateSpec(spec, { platforms });
  for (const w of warnings) log(`  ⚠ ${w}`);
  for (const e of errors) log(`  ✖ ${e}`);
  if (errors.length) throw new Error(`${spec.id}: ${errors.length} brand/platform error(s). Fix the spec.`);
  if (warnings.length && !force && !dryRun) throw new Error(`${spec.id}: ${warnings.length} warning(s). Fix them or pass --force.`);

  const media = { video: resolveMedia(spec, spec.video), thumbnail: resolveMedia(spec, spec.thumbnail) };
  for (const [label, file] of Object.entries(media)) {
    if (!file || existsSync(file)) continue;
    const msg = isDrivePath(file)
      ? `${spec.id}: ${label} "${file}": ${DRIVE_HELP}`
      : `${spec.id}: ${label} not found at ${file}`;
    if (!dryRun) throw new Error(msg);
    log(`  ⚠ ${msg}`);
  }

  const jobs = buildJobs(spec, { only: platforms, now, media });
  const due = jobs.filter((j) => now || readyNow(j));
  result.waiting = jobs.filter((j) => !due.includes(j)).map((j) => j.platform);
  for (const j of result.waiting) log(`  ⏳ ${j}: waits until ${new Date(spec.date).toLocaleString()} (keep "run --watch" going)`);

  if (dryRun) {
    for (const j of due) log(`  ▶ ${j.platform} (${j.mode})${j.title ? `: "${j.title}"` : ''}`);
    result.ran = due.map((j) => j.platform);
    return result;
  }
  if (!due.length) return result;

  await withBrowser(async (page) => {
    for (const job of due) {
      const site = sites[job.platform];
      log(`  ▶ ${job.platform}: ${job.mode === 'schedule' ? 'uploading and scheduling' : 'posting now'} ...`);
      try {
        const out = await site.post(page, job, (m) => log(`    ${m}`));
        spec.status[job.platform] = { state: 'done', at: new Date().toISOString(), mode: job.mode, ...out };
        result.ran.push(job.platform);
        log(`  ✔ ${job.platform} ${job.mode === 'schedule' ? 'scheduled' : 'posted'}`);
      } catch (err) {
        const shot = await saveErrorShot(page, `${spec.id}-${job.platform}`);
        const prev = spec.status[job.platform] || {};
        spec.status[job.platform] = { state: 'failed', at: new Date().toISOString(), attempts: (prev.attempts || 0) + 1, error: String(err.message).split('\n')[0], screenshot: shot };
        result.failed.push(job.platform);
        log(`  ✖ ${job.platform}: ${spec.status[job.platform].error}${shot ? ` (screenshot: ${shot})` : ''}`);
      }
      saveSpec(spec);
    }
  }, browserOpts);

  if (!pendingPlatforms(spec, only).length && !only) {
    const target = archiveSpec(spec);
    log(`  📦 all channels done, moved to ${target}`);
  }
  return result;
}
