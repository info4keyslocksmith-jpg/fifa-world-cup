// Turns a post spec + uploaded media into the body for POST /public/v1/posts.
// One request carries one entry per channel so Postiz groups them together.
import { fullCaption, firstLine, youtubeTags } from './brand.mjs';

export const PLATFORMS = ['instagram', 'tiktok', 'youtube'];

function mediaRef(upload) {
  return { id: upload.id || Math.random().toString(36).slice(2, 9), path: upload.path };
}

export function instagramSettings(ig = {}) {
  return {
    post_type: ig.post_type || 'post', // Reels are video "post"s; "story" for Stories
    ...(ig.collaborators?.length ? { collaborators: ig.collaborators.map((label) => ({ label })) } : {}),
    ...(ig.settings || {}),
  };
}

export function tiktokSettings(tt = {}, caption = '') {
  return {
    title: (tt.title || firstLine(caption)).slice(0, 90),
    privacy_level: 'PUBLIC_TO_EVERYONE',
    duet: true,
    stitch: true,
    comment: true,
    autoAddMusic: 'no',
    brand_content_toggle: false,
    brand_organic_toggle: false,
    // DIRECT_POST actually publishes. UPLOAD only drops a draft in the TikTok inbox.
    content_posting_method: 'DIRECT_POST',
    ...(tt.settings || {}),
  };
}

export function youtubeSettings(yt = {}, hashtags = [], thumbnailUpload) {
  return {
    title: yt.title,
    type: yt.type || 'public',
    selfDeclaredMadeForKids: 'no',
    tags: youtubeTags(yt.tags, hashtags),
    ...(thumbnailUpload ? { thumbnail: mediaRef(thumbnailUpload) } : {}),
    ...(yt.settings || {}),
  };
}

/**
 * @param spec         post spec (see queue/example.json)
 * @param integrations { instagram: id, tiktok: id, youtube: id }
 * @param uploads      { video: uploadResponse, thumbnail?: uploadResponse }
 * @param opts         { platforms: [...], draft: boolean }
 */
export function buildPostBody(spec, integrations, uploads, { platforms = PLATFORMS, draft = false } = {}) {
  const tags = (spec.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`).toLowerCase());
  const noFyp = tags.filter((t) => t !== '#fyp');
  const p = spec.platforms || {};
  const posts = [];

  for (const platform of platforms) {
    const cfg = p[platform] || {};
    if (cfg.enabled === false) continue;
    const integrationId = integrations[platform];
    if (!integrationId) throw new Error(`No ${platform} integration id. Run: node social-agent/cli.mjs setup`);

    let content;
    let settings;
    if (platform === 'instagram') {
      content = fullCaption(cfg.caption || spec.caption, noFyp);
      settings = instagramSettings(cfg);
    } else if (platform === 'tiktok') {
      content = fullCaption(cfg.caption || spec.caption, tags);
      settings = tiktokSettings(cfg, cfg.caption || spec.caption);
    } else if (platform === 'youtube') {
      content = fullCaption(cfg.description || spec.caption, noFyp);
      settings = youtubeSettings(cfg, noFyp, uploads.thumbnail);
    } else {
      throw new Error(`Unsupported platform ${platform}`);
    }

    posts.push({
      integration: { id: integrationId },
      value: [{ content, image: [mediaRef(uploads.video)], delay: 0 }],
      settings,
    });
  }

  if (!posts.length) throw new Error('No platforms enabled for this spec.');

  return {
    type: draft ? 'draft' : 'schedule',
    date: new Date(spec.date).toISOString(),
    shortLink: false,
    tags: [],
    posts,
  };
}
