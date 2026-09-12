// End-to-end test against a local mock of the Postiz public API.
// Verifies: brand validation, single upload reused by all channels, per-platform
// settings (TikTok DIRECT_POST, YouTube title/tags/thumbnail, Instagram post_type).
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { PostizClient } from '../lib/postiz.mjs';
import { validateSpec } from '../lib/brand.mjs';
import { publishSpec, readSpec, INTEGRATIONS_FILE } from '../lib/publish.mjs';

const calls = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, ct: req.headers['content-type'], raw });
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/public/v1/integrations') {
    return res.end(JSON.stringify([
      { id: 'ig-1', name: '4keyslocksmith', identifier: 'instagram', disabled: false },
      { id: 'tt-1', name: '4keyslocksmith', identifier: 'tiktok', disabled: false },
      { id: 'yt-1', name: '4Keys Locksmith', identifier: 'youtube', disabled: false },
    ]));
  }
  if (req.url === '/public/v1/upload') {
    const name = /filename="([^"]+)"/.exec(raw.toString('latin1'))?.[1] || 'file';
    return res.end(JSON.stringify({ id: `up-${calls.length}`, path: `https://uploads.postiz.com/test/${name}`, size: raw.length }));
  }
  if (req.url === '/public/v1/posts' && req.method === 'POST') {
    const body = JSON.parse(raw.toString());
    return res.end(JSON.stringify(body.posts.map((p, i) => ({ postId: `post-${i}`, integration: p.integration.id }))));
  }
  res.statusCode = 404;
  res.end('{"error":"not found"}');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const apiUrl = `http://127.0.0.1:${server.address().port}`;
const client = new PostizClient({ apiKey: 'test-key', apiUrl });

// Integrations file (backed up and restored)
const hadIntegrations = existsSync(INTEGRATIONS_FILE);
const previous = hadIntegrations ? readFileSync(INTEGRATIONS_FILE, 'utf8') : null;
mkdirSync(join(INTEGRATIONS_FILE, '..'), { recursive: true });
writeFileSync(INTEGRATIONS_FILE, JSON.stringify({ instagram: 'ig-1', tiktok: 'tt-1', youtube: 'yt-1' }));

const dir = mkdtempSync(join(tmpdir(), '4keys-'));
try {
  writeFileSync(join(dir, 'clip.mp4'), Buffer.from('fake-mp4'));
  writeFileSync(join(dir, 'thumb.jpg'), Buffer.from('fake-jpg'));
  const future = new Date(Date.now() + 3 * 86400000).toISOString();

  const good = {
    id: 'test-good',
    video: 'clip.mp4',
    thumbnail: 'thumb.jpg',
    date: future,
    caption: 'Got a call at 2am. 2019 BMW 330i, no key, dealer said tow it.\n\nI drove out anyway.\n\nLesson: the jobs nobody wants build your name.\n\nWildest late-night call you ever took?',
    hashtags: ['#autolocksmith', '#bmw', '#smallbusiness', '#hustleculture', '#4keyslocksmith'],
    platforms: {
      instagram: { enabled: true },
      tiktok: { enabled: true, title: 'The 2am BMW call' },
      youtube: { enabled: true, title: 'The 2am BMW key the dealer said needed a tow', tags: ['auto locksmith', 'bmw key'] },
    },
  };
  writeFileSync(join(dir, 'good.json'), JSON.stringify(good));

  // 1. brand validation catches the hard rules
  const bad = {
    ...good,
    caption: 'Watch this satisfying key cut. Call us for service! Our team is the best.',
    hashtags: ['#asmr', '#miami', '#locksmith', '#keys', '#cars', '#4keyslocksmith'],
    platforms: { ...good.platforms, youtube: { enabled: true } },
  };
  const v = validateSpec(bad);
  const msg = v.errors.join('\n');
  assert.match(msg, /6 hashtags/);
  assert.match(msg, /#asmr is banned/);
  assert.match(msg, /#miami is a geo tag/);
  assert.match(msg, /hard CTA/);
  assert.match(msg, /youtube\.title is required/);
  assert.ok(v.warnings.some((w) => /first person/.test(w)), 'warns on "our team"');
  assert.deepEqual(validateSpec(good), { errors: [], warnings: [] });
  console.log('✔ brand validation');

  // 2. dry run builds a body and touches the network zero times
  const spec = readSpec(join(dir, 'good.json'));
  const dry = await publishSpec(spec, null, { dryRun: true, log: () => {} });
  assert.equal(calls.length, 0);
  assert.equal(dry.response, null);
  assert.equal(dry.body.posts.length, 3);
  console.log('✔ dry run');

  // 3. real publish against the mock API
  const { body, response } = await publishSpec(spec, client, { log: () => {} });
  const uploads = calls.filter((c) => c.url === '/public/v1/upload');
  assert.equal(uploads.length, 2, 'video + thumbnail uploaded exactly once each');
  assert.ok(uploads.every((c) => c.auth === 'test-key' && c.ct.startsWith('multipart/form-data')));
  assert.match(uploads[0].raw.toString('latin1'), /name="file"; filename="clip.mp4"/);

  const create = calls.find((c) => c.url === '/public/v1/posts');
  assert.equal(create.auth, 'test-key');
  assert.equal(body.type, 'schedule');
  assert.equal(body.date, new Date(future).toISOString());
  assert.equal(body.shortLink, false);
  assert.deepEqual(body.tags, []);
  assert.deepEqual(body.posts.map((p) => p.integration.id), ['ig-1', 'tt-1', 'yt-1']);
  for (const p of body.posts) {
    assert.equal(p.value.length, 1);
    assert.equal(p.value[0].image.length, 1);
    assert.equal(p.value[0].image[0].path, 'https://uploads.postiz.com/test/clip.mp4');
    assert.match(p.value[0].content, /#4keyslocksmith$/);
    assert.ok(!('__type' in p.settings), 'backend adds __type');
  }
  const [ig, tt, yt] = body.posts.map((p) => p.settings);
  assert.deepEqual(ig, { post_type: 'post' });
  assert.equal(tt.content_posting_method, 'DIRECT_POST');
  assert.equal(tt.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(tt.title, 'The 2am BMW call');
  assert.equal(yt.title, 'The 2am BMW key the dealer said needed a tow');
  assert.equal(yt.type, 'public');
  assert.equal(yt.selfDeclaredMadeForKids, 'no');
  assert.deepEqual(yt.tags, [{ value: 'auto locksmith', label: 'auto locksmith' }, { value: 'bmw key', label: 'bmw key' }]);
  assert.equal(yt.thumbnail.path, 'https://uploads.postiz.com/test/thumb.jpg');
  assert.equal(response.length, 3);
  console.log('✔ publish to mock Postiz API');

  // 4. --only + --draft
  calls.length = 0;
  const partial = await publishSpec(spec, client, { only: ['tiktok'], draft: true, log: () => {} });
  assert.equal(partial.body.type, 'draft');
  assert.deepEqual(partial.body.posts.map((p) => p.integration.id), ['tt-1']);
  console.log('✔ --only / --draft');

  console.log('\nAll tests passed.');
} finally {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  if (hadIntegrations) writeFileSync(INTEGRATIONS_FILE, previous);
  else rmSync(INTEGRATIONS_FILE, { force: true });
}
