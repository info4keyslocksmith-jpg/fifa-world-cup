import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { AGENT_ROOT } from './env.mjs';
import { validateSpec } from './brand.mjs';
import { buildPostBody, PLATFORMS } from './build.mjs';

export const INTEGRATIONS_FILE = join(AGENT_ROOT, 'config', 'integrations.json');
export const QUEUE_DIR = join(AGENT_ROOT, 'queue');
export const DONE_DIR = join(QUEUE_DIR, 'done');

export function readSpec(specPath) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  spec.__file = specPath;
  spec.id = spec.id || basename(specPath).replace(/\.json$/, '');
  return spec;
}

export function loadIntegrations() {
  if (!existsSync(INTEGRATIONS_FILE)) {
    throw new Error(`Missing ${INTEGRATIONS_FILE}. Run: node social-agent/cli.mjs setup`);
  }
  return JSON.parse(readFileSync(INTEGRATIONS_FILE, 'utf8'));
}

/** Resolve a media path: absolute, relative to the spec file, or relative to social-agent/. */
export function resolveMedia(spec, p) {
  if (!p) return null;
  if (isAbsolute(p)) return p;
  const candidates = [join(dirname(spec.__file || QUEUE_DIR), p), join(AGENT_ROOT, p), join(process.cwd(), p)];
  return candidates.find((c) => existsSync(c)) || candidates[0];
}

export function enabledPlatforms(spec, only) {
  const p = spec.platforms || {};
  return PLATFORMS.filter((name) => (only ? only.includes(name) : true) && p[name]?.enabled !== false);
}

/**
 * Validate, upload media, build and send the post.
 * Returns { body, response } (response is null on dry run).
 */
export async function publishSpec(spec, client, { only, draft = false, dryRun = false, force = false, log = console.error } = {}) {
  const platforms = enabledPlatforms(spec, only);
  const { errors, warnings } = validateSpec(spec, { platforms });
  for (const w of warnings) log(`  ⚠ ${w}`);
  for (const e of errors) log(`  ✖ ${e}`);
  if (errors.length) throw new Error(`${spec.id}: ${errors.length} brand/platform error(s). Fix the spec.`);
  if (warnings.length && !force && !dryRun) {
    throw new Error(`${spec.id}: ${warnings.length} warning(s). Fix them or pass --force.`);
  }

  const videoPath = resolveMedia(spec, spec.video);
  const thumbPath = resolveMedia(spec, spec.thumbnail);
  for (const [label, file] of [['video', videoPath], ['thumbnail', thumbPath]]) {
    if (!file || existsSync(file)) continue;
    const msg = `${spec.id}: ${label} not found at ${file} (looked next to the spec, in social-agent/, and in the current directory)`;
    if (!dryRun) throw new Error(msg);
    log(`  ⚠ ${msg}`);
  }

  let integrations;
  try {
    integrations = loadIntegrations();
  } catch (err) {
    if (!dryRun) throw err;
    log(`  ⚠ ${err.message} (dry run continues with placeholder ids)`);
    integrations = Object.fromEntries(PLATFORMS.map((p) => [p, `<${p}-integration-id>`]));
  }
  const uploads = {};
  if (dryRun) {
    uploads.video = { id: 'dry-run', path: `https://uploads.postiz.com/DRY-RUN/${basename(videoPath)}` };
    if (thumbPath) uploads.thumbnail = { id: 'dry-run-thumb', path: `https://uploads.postiz.com/DRY-RUN/${basename(thumbPath)}` };
  } else {
    log(`  ⬆ uploading ${basename(videoPath)} ...`);
    uploads.video = await client.upload(videoPath);
    if (thumbPath) {
      log(`  ⬆ uploading ${basename(thumbPath)} ...`);
      uploads.thumbnail = await client.upload(thumbPath);
    }
  }

  const body = buildPostBody(spec, integrations, uploads, { platforms, draft });
  if (dryRun) return { body, response: null };

  const response = await client.createPost(body);
  return { body, response };
}

/** Move a published spec into queue/done with the Postiz response attached. */
export function archiveSpec(spec, result) {
  mkdirSync(DONE_DIR, { recursive: true });
  const { __file, ...clean } = spec;
  clean.postiz = { publishedAt: new Date().toISOString(), body: result.body, response: result.response };
  const target = join(DONE_DIR, basename(__file));
  writeFileSync(target, JSON.stringify(clean, null, 2) + '\n');
  if (__file !== target && existsSync(__file)) renameSync(__file, target);
  return target;
}
