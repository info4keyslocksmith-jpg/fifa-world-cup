#!/usr/bin/env node
// 4Keys social agent: schedule story-driven videos to Instagram, TikTok and
// YouTube through Postiz. Run `node social-agent/cli.mjs help`.
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadEnv, requireEnv, AGENT_ROOT } from './lib/env.mjs';
import { clientFromEnv } from './lib/postiz.mjs';
import { validateSpec } from './lib/brand.mjs';
import { readSpec, publishSpec, archiveSpec, enabledPlatforms, INTEGRATIONS_FILE, QUEUE_DIR } from './lib/publish.mjs';

const HELP = `4Keys social agent (Postiz)

Usage: node social-agent/cli.mjs <command> [options]

  setup                         Fetch connected channels from Postiz and write config/integrations.json
  check <spec.json>             Validate a post spec against the brand + platform rules (no network)
  publish <spec.json>           Upload the video and schedule it on Instagram, TikTok and YouTube
  queue                         Publish every spec in queue/*.json (oldest date first)
  list [--days N]               Show posts scheduled in Postiz for the next N days (default 14)
  delete <postId>               Delete a scheduled post in Postiz
  help                          This text

Options for publish / queue:
  --dry-run                     Build and print the request body, upload nothing, send nothing
  --draft                       Create as draft in Postiz instead of scheduling
  --only instagram,tiktok       Limit to some platforms
  --force                       Publish despite warnings (errors always block)

Environment (social-agent/.env or exported): POSTIZ_API_KEY, optional POSTIZ_API_URL
`;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

const PROVIDER_MATCH = {
  instagram: (id) => id.startsWith('instagram'),
  tiktok: (id) => id.startsWith('tiktok'),
  youtube: (id) => id.startsWith('youtube'),
};

async function setup() {
  requireEnv('POSTIZ_API_KEY');
  const client = clientFromEnv();
  const all = await client.listIntegrations();
  const map = {};
  const notes = [];
  for (const [name, match] of Object.entries(PROVIDER_MATCH)) {
    const hits = all.filter((i) => match(String(i.identifier || i.providerIdentifier || '')));
    const active = hits.filter((i) => !i.disabled);
    if (!active.length) {
      notes.push(`${name}: not connected in Postiz. Connect it in the Postiz dashboard, then re-run setup.`);
      continue;
    }
    map[name] = active[0].id;
    if (active.length > 1) {
      notes.push(`${name}: ${active.length} channels found, using "${active[0].name}". Edit config/integrations.json to change: ${active.map((i) => `${i.name}=${i.id}`).join(', ')}`);
    }
  }
  mkdirSync(dirname(INTEGRATIONS_FILE), { recursive: true });
  writeFileSync(INTEGRATIONS_FILE, JSON.stringify(map, null, 2) + '\n');
  console.log('Connected channels:');
  for (const i of all) console.log(`  ${i.disabled ? '⏸' : '✔'} ${String(i.identifier || i.providerIdentifier).padEnd(22)} ${i.name.padEnd(28)} ${i.id}`);
  console.log(`\nWrote ${INTEGRATIONS_FILE}:\n${JSON.stringify(map, null, 2)}`);
  for (const n of notes) console.log(`⚠ ${n}`);
}

function check(specPath, args) {
  const spec = readSpec(resolve(specPath));
  const only = args.only ? String(args.only).split(',') : undefined;
  const platforms = enabledPlatforms(spec, only);
  const { errors, warnings } = validateSpec(spec, { platforms });
  console.log(`${spec.id} → ${platforms.join(', ')}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✖ ${e}`);
  if (!errors.length && !warnings.length) console.log('  ✔ passes every brand and platform rule');
  else console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
  return errors.length ? 1 : 0;
}

async function publishOne(specPath, args) {
  const spec = readSpec(resolve(specPath));
  const opts = {
    only: args.only ? String(args.only).split(',') : undefined,
    draft: !!args.draft,
    dryRun: !!args['dry-run'],
    force: !!args.force,
  };
  console.error(`▶ ${spec.id} (${new Date(spec.date).toString()})`);
  const client = opts.dryRun ? null : clientFromEnv();
  const result = await publishSpec(spec, client, opts);
  if (opts.dryRun) {
    console.log(JSON.stringify(result.body, null, 2));
    console.error('  ✔ dry run only, nothing was uploaded or scheduled');
    return;
  }
  const target = archiveSpec(spec, result);
  console.error(`  ✔ ${opts.draft ? 'draft created' : 'scheduled'} on ${result.body.posts.length} channel(s); spec archived to ${target}`);
  console.log(JSON.stringify(result.response, null, 2));
}

async function queue(args) {
  const files = readdirSync(QUEUE_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('example') && !f.startsWith('_'))
    .map((f) => join(QUEUE_DIR, f));
  if (!files.length) {
    console.log(`Queue is empty (${QUEUE_DIR}).`);
    return;
  }
  const specs = files.map((f) => readSpec(f)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let failed = 0;
  for (const spec of specs) {
    try {
      await publishOne(spec.__file, args);
    } catch (err) {
      failed++;
      console.error(`  ✖ ${err.message}`);
    }
  }
  console.error(`\n${specs.length - failed}/${specs.length} published${failed ? `, ${failed} failed` : ''}.`);
  if (failed) process.exitCode = 1;
}

async function list(args) {
  const client = clientFromEnv();
  const days = Number(args.days || 14);
  const start = new Date();
  const end = new Date(Date.now() + days * 86400000);
  const res = await client.listPosts({ startDate: start.toISOString(), endDate: end.toISOString() });
  const posts = Array.isArray(res) ? res : res?.posts || [];
  if (!posts.length) {
    console.log(`No posts scheduled in the next ${days} days.`);
    return;
  }
  for (const p of posts) {
    const when = p.publishDate || p.date || '';
    const channel = p.integration?.providerIdentifier || p.integration?.name || '';
    const text = String(p.content || '').split('\n')[0].slice(0, 70);
    console.log(`${when}  ${String(p.state || p.status || '').padEnd(10)} ${channel.padEnd(12)} ${p.id}  ${text}`);
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const [cmd, target] = args._;
  switch (cmd) {
    case 'setup':
      return setup();
    case 'check':
      if (!target) throw new Error('check needs a spec file');
      process.exitCode = check(target, args);
      return;
    case 'publish':
      if (!target) throw new Error('publish needs a spec file');
      return publishOne(target, args);
    case 'queue':
      return queue(args);
    case 'list':
      return list(args);
    case 'delete':
      if (!target) throw new Error('delete needs a post id');
      console.log(JSON.stringify(await clientFromEnv().deletePost(target), null, 2));
      return;
    case 'help':
    case undefined:
    case '--help':
      console.log(HELP);
      return;
    default:
      throw new Error(`Unknown command "${cmd}". Run: node social-agent/cli.mjs help`);
  }
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
