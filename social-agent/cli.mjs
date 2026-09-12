#!/usr/bin/env node
// 4Keys social agent: posts story-driven videos to Instagram, TikTok and
// YouTube through a real Chrome window on this computer. No third-party service.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { loadEnv } from './lib/env.mjs';
import { validateSpec } from './lib/brand.mjs';
import { SITES, PLATFORMS } from './lib/sites/index.mjs';
import { withBrowser, PROFILE_DIR } from './lib/browser.mjs';
import { enabledPlatforms } from './lib/jobs.mjs';
import { readSpec, queueSpecs, processSpec, pendingPlatforms } from './lib/runner.mjs';

const HELP = `4Keys social agent (Chrome)

Usage: node social-agent/cli.mjs <command> [options]

  login                         Open Chrome so you can sign in to YouTube, TikTok and Instagram (once)
  check <spec.json>             Validate a post spec against the brand + platform rules (no browser)
  post <spec.json>              Process one spec: YouTube uploads + schedules now, TikTok/Instagram post when due
  run                           Process every spec in queue/ once
  run --watch                   Keep running: checks the queue every minute and posts what is due
  status                        Show the queue and what each channel is waiting on
  help                          This text

Options for post / run:
  --now                         Ignore the date: publish everywhere immediately
  --only instagram,tiktok       Limit to some platforms
  --dry-run                     Show what would happen, open nothing
  --force                       Proceed despite warnings (errors always block)
  --interval 60                 Seconds between checks for --watch

Environment (social-agent/.env or exported): HEADLESS=1, BROWSER_EXECUTABLE, CHROME_PROFILE_DIR
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
      } else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function opts(args) {
  return {
    only: args.only ? String(args.only).split(',').map((s) => s.trim()) : undefined,
    now: !!args.now,
    dryRun: !!args['dry-run'],
    force: !!args.force,
  };
}

async function login() {
  console.log(`Opening Chrome with the agent profile (${PROFILE_DIR}).`);
  console.log('Sign in to each tab: YouTube Studio, TikTok, Instagram. Approve any 2-step prompts on your phone.');
  await withBrowser(async (page, ctx) => {
    const tabs = [];
    for (const site of Object.values(SITES)) {
      const p = tabs.length ? await ctx.newPage() : page;
      await p.goto(site.urls.home, { waitUntil: 'domcontentloaded' }).catch(() => {});
      tabs.push([site, p]);
    }
    await new Promise((done) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('\nWhen you are signed in on all three, press Enter here... ', () => {
        rl.close();
        done();
      });
    });
    for (const [site, p] of tabs) {
      const ok = await site.isLoggedIn(p).catch(() => false);
      console.log(`  ${ok ? '✔' : '✖'} ${site.name}${ok ? '' : ' (not signed in yet, run login again)'}`);
    }
  }, { headless: false });
}

function check(specPath, args) {
  const spec = readSpec(resolve(specPath));
  const platforms = enabledPlatforms(spec, opts(args).only);
  const { errors, warnings } = validateSpec(spec, { platforms });
  console.log(`${spec.id} → ${platforms.join(', ')}  (${new Date(spec.date).toLocaleString()})`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const e of errors) console.log(`  ✖ ${e}`);
  if (!errors.length && !warnings.length) console.log('  ✔ passes every brand and platform rule');
  else console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
  return errors.length ? 1 : 0;
}

async function runOnce(specs, args) {
  let failed = 0;
  for (const spec of specs) {
    console.error(`▶ ${spec.id} (${new Date(spec.date).toLocaleString()})`);
    try {
      const r = await processSpec(spec, opts(args));
      failed += r.failed.length;
    } catch (err) {
      failed++;
      console.error(`  ✖ ${err.message}`);
    }
  }
  return failed;
}

async function run(args) {
  const interval = Math.max(15, Number(args.interval || 60)) * 1000;
  do {
    const specs = queueSpecs();
    if (!specs.length) console.error(`${new Date().toLocaleTimeString()} queue is empty`);
    const failed = await runOnce(specs, args);
    if (!args.watch) {
      process.exitCode = failed ? 1 : 0;
      return;
    }
    await new Promise((r) => setTimeout(r, interval));
  } while (true);
}

function status() {
  const specs = queueSpecs();
  if (!specs.length) return console.log('Queue is empty.');
  for (const s of specs) {
    console.log(`${s.id}  ${new Date(s.date).toLocaleString()}`);
    for (const p of enabledPlatforms(s)) {
      const st = s.status?.[p];
      const text = !st ? 'pending' : st.state === 'done' ? `done ${st.mode === 'schedule' ? '(scheduled on YouTube)' : ''} ${st.at}` : `FAILED ×${st.attempts}: ${st.error}`;
      console.log(`    ${p.padEnd(10)} ${text}`);
    }
  }
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const [cmd, target] = args._;
  switch (cmd) {
    case 'login':
      return login();
    case 'check':
      if (!target) throw new Error('check needs a spec file');
      process.exitCode = check(target, args);
      return;
    case 'post': {
      if (!target) throw new Error('post needs a spec file');
      const spec = readSpec(resolve(target));
      process.exitCode = (await runOnce([spec], args)) ? 1 : 0;
      return;
    }
    case 'run':
      return run(args);
    case 'status':
      return status();
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
