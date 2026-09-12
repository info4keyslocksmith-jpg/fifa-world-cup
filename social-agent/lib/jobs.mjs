// Turns a post spec into one job per platform: the exact text, title, tags and
// timing each site driver needs.
import { fullCaption, firstLine, youtubeTags } from './brand.mjs';
import { PLATFORMS } from './sites/index.mjs';

export const SCHEDULE_LEAD = 15 * 60_000; // closer than this → publish now instead of scheduling

export function enabledPlatforms(spec, only) {
  const p = spec.platforms || {};
  return PLATFORMS.filter((n) => (only ? only.includes(n) : true) && p[n]?.enabled !== false);
}

export function buildJobs(spec, { only, now = false, media = {} } = {}) {
  const tags = (spec.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`).toLowerCase());
  const noFyp = tags.filter((t) => t !== '#fyp');
  const p = spec.platforms || {};
  const scheduleAt = new Date(spec.date);
  const jobs = [];

  for (const platform of enabledPlatforms(spec, only)) {
    const cfg = p[platform] || {};
    const base = { platform, specId: spec.id, videoPath: media.video, scheduleAt };
    if (platform === 'instagram') {
      jobs.push({ ...base, mode: 'now', caption: fullCaption(cfg.caption || spec.caption, noFyp) });
    } else if (platform === 'tiktok') {
      jobs.push({ ...base, mode: 'now', caption: fullCaption(cfg.caption || spec.caption, tags), title: (cfg.title || firstLine(spec.caption)).slice(0, 90) });
    } else if (platform === 'youtube') {
      const far = scheduleAt.getTime() - Date.now() > SCHEDULE_LEAD;
      jobs.push({
        ...base,
        mode: !now && far ? 'schedule' : 'now',
        title: cfg.title,
        caption: fullCaption(cfg.description || spec.caption, noFyp),
        tags: youtubeTags(cfg.tags, noFyp).map((t) => t.label),
        visibility: cfg.type || 'public',
        thumbnailPath: media.thumbnail,
      });
    }
  }
  return jobs;
}

/** Instagram and TikTok are posted when due; YouTube is uploaded early with its own scheduler. */
export function readyNow(job, now = Date.now()) {
  if (job.platform === 'youtube') return true;
  return job.mode === 'now' && job.scheduleAt.getTime() <= now;
}
