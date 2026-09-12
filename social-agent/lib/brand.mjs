// @4keyslocksmith brand rules, encoded as checks. Mirrors the hard rules of the
// social-media-4keys skill: max 5 hashtags, no ASMR/geo tags, no hard service
// or course CTAs, first person, human captions, story in every post.

export const MAX_HASHTAGS = 5;
export const BRAND_TAG = '#4keyslocksmith';

export const BANNED_TAGS = new Set([
  '#asmr', '#oddlysatisfying', '#satisfying', '#satisfyingvideo', '#viral', '#viralvideo', '#foryou', '#foryoupage',
]);

// Geo words: any hashtag containing one of these is a local-service signal.
export const GEO_WORDS = [
  'miami', 'atlanta', 'atl', 'florida', 'georgia', 'newjersey', 'jersey', 'tampa', 'orlando', 'jacksonville',
  'brickell', 'fortlauderdale', 'lauderdale', 'hialeah', 'kendall', 'doral', 'broward', 'dade', 'southflorida',
  'sofla', 'westpalm', 'boca', 'naples', 'sarasota', 'gainesville', 'tallahassee', 'savannah', 'marietta',
  'texas', 'houston', 'dallas', 'nyc', 'newyork', 'losangeles', 'chicago', 'usa',
];

export const HARD_CTA_PATTERNS = [
  /\bcall (us|now|today|me for (a )?(quote|service))\b/i,
  /\bdm (us|me) for (a )?(quote|price|service|booking)/i,
  /\bbook (now|today|online|a service)\b/i,
  /\bcontact (us|me) (for|to)\b/i,
  /\bschedule (a|your) (service|appointment)\b/i,
  /\bll[aá]manos\b/i,
  /\bll[aá]mame para (una )?(cotizaci[oó]n|servicio)/i,
  /\bescr[ií]benos\b/i,
  /\breserva (ahora|hoy|tu cita)\b/i,
  /\bagenda (tu|una) cita\b/i,
  /\b(join|buy|enroll in) (my|the) course\b/i,
  /\bcourse (link|is open|drops)\b/i,
  /\blink in bio for (the )?(course|booking|service)/i,
];

export const MARKETER_PATTERNS = [
  /\bhope this helps\b/i,
  /\bsorry for the long post\b/i,
  /\bdouble tap\b/i,
  /\blike and share\b/i,
  /\bsmash that\b/i,
];

export const NOT_FIRST_PERSON = [
  /\bour team\b/i,
  /\bnuestro equipo\b/i,
  /\bnosotros\b/i,
  /\bwe (are|offer|provide|specialize|do|can)\b/i,
];

export const PLATFORM_LIMITS = {
  instagram: { caption: 2200 },
  tiktok: { caption: 2200, title: 90 },
  youtube: { description: 5000, titleMin: 2, titleMax: 100, tagsTotal: 500 },
};

export function normalizeTag(t) {
  const s = String(t).trim().toLowerCase();
  return s.startsWith('#') ? s : `#${s}`;
}

/**
 * Validate a post spec. Returns { errors: string[], warnings: string[] }.
 * Errors block publishing. Warnings block too unless --force is passed.
 */
export function validateSpec(spec, { platforms = ['instagram', 'tiktok', 'youtube'] } = {}) {
  const errors = [];
  const warnings = [];
  const caption = String(spec.caption || '').trim();
  const tags = (spec.hashtags || []).map(normalizeTag);

  if (!caption) errors.push('caption is empty. Every post needs a story or lesson.');
  if (!spec.date) errors.push('date is missing (ISO 8601, e.g. 2026-09-14T17:00:00-04:00).');
  else if (Number.isNaN(Date.parse(spec.date))) errors.push(`date "${spec.date}" is not a valid ISO 8601 date.`);
  else if (Date.parse(spec.date) < Date.now() + 5 * 60 * 1000) {
    errors.push(`date "${spec.date}" is in the past or less than 5 minutes away.`);
  }
  if (!spec.video) errors.push('video is missing.');

  // Hashtags
  if (tags.length > MAX_HASHTAGS) errors.push(`${tags.length} hashtags. Max is ${MAX_HASHTAGS}.`);
  if (new Set(tags).size !== tags.length) errors.push('duplicate hashtags.');
  for (const t of tags) {
    if (BANNED_TAGS.has(t)) errors.push(`hashtag ${t} is banned (global ASMR/low-intent signal).`);
    const bare = t.slice(1);
    const geo = GEO_WORDS.find((g) => bare.includes(g));
    if (geo) errors.push(`hashtag ${t} is a geo tag ("${geo}"). Cities live in the story, never in the tags.`);
    if (!/^#[\p{L}\p{N}_]+$/u.test(t)) errors.push(`hashtag ${t} has invalid characters.`);
  }
  if (t_has(tags, '#fyp') && platforms.some((p) => p !== 'tiktok')) {
    warnings.push('#fyp is only acceptable on TikTok. It will be stripped from Instagram and YouTube.');
  }
  if (!tags.includes(BRAND_TAG)) warnings.push(`brand tag ${BRAND_TAG} is missing.`);
  if (tags.length > 0 && tags.length < 3) warnings.push('fewer than 3 hashtags. Formula: 2 craft + 2 audience/culture + 1 brand.');
  if (/#[\p{L}\p{N}_]+/u.test(caption)) {
    warnings.push('caption text contains hashtags. Put them in the "hashtags" array instead so they land on their own line.');
  }

  // CTA and voice
  for (const re of HARD_CTA_PATTERNS) {
    if (re.test(caption)) errors.push(`hard CTA detected (${re}). Community first: follow / save / comment only.`);
  }
  for (const re of MARKETER_PATTERNS) {
    if (re.test(caption)) warnings.push(`marketer-speak detected (${re}). Sound like a person.`);
  }
  for (const re of NOT_FIRST_PERSON) {
    if (re.test(caption)) warnings.push(`not first person (${re}). This is Juan's story: "I", "yo".`);
  }
  if (!/\?\s*$/.test(caption) && !/\?[^\n]*$/m.test(caption.split('\n').filter(Boolean).at(-1) || '')) {
    warnings.push('caption does not end on a question. End with something that invites a real comment.');
  }
  const lines = caption.split('\n');
  if (lines.length < 3) warnings.push('caption is a single block. Use line breaks: hook / story beats / lesson / soft CTA.');
  if ((lines[0] || '').length > 140) warnings.push('first line (the hook) is over 140 characters. Hooks pull people out of the scroll; keep it tight.');

  // Platform specifics
  const p = spec.platforms || {};
  const ig = p.instagram || {};
  const tt = p.tiktok || {};
  const yt = p.youtube || {};

  if (platforms.includes('instagram')) {
    const text = fullCaption(ig.caption || caption, tags.filter((t) => t !== '#fyp'));
    if (text.length > PLATFORM_LIMITS.instagram.caption) errors.push(`Instagram caption is ${text.length} chars (max ${PLATFORM_LIMITS.instagram.caption}).`);
    if (ig.post_type && !['post', 'story'].includes(ig.post_type)) errors.push(`instagram.post_type must be "post" or "story".`);
  }
  if (platforms.includes('tiktok')) {
    const text = fullCaption(tt.caption || caption, tags);
    if (text.length > PLATFORM_LIMITS.tiktok.caption) errors.push(`TikTok caption is ${text.length} chars (max ${PLATFORM_LIMITS.tiktok.caption}).`);
    const title = tt.title || firstLine(caption);
    if (title.length > PLATFORM_LIMITS.tiktok.title) errors.push(`TikTok title is ${title.length} chars (max ${PLATFORM_LIMITS.tiktok.title}). Set platforms.tiktok.title.`);
    if (tt.settings?.content_posting_method === 'UPLOAD') {
      warnings.push('TikTok content_posting_method is UPLOAD: the video lands in the TikTok inbox as a draft and is NOT published.');
    }
  }
  if (platforms.includes('youtube')) {
    if (!yt.title) errors.push('platforms.youtube.title is required. Rewrite the title for search: [Specific Result] + [Vehicle/Tool] + [Authority hook].');
    else if (yt.title.length < PLATFORM_LIMITS.youtube.titleMin || yt.title.length > PLATFORM_LIMITS.youtube.titleMax) {
      errors.push(`YouTube title must be ${PLATFORM_LIMITS.youtube.titleMin}-${PLATFORM_LIMITS.youtube.titleMax} chars (got ${yt.title.length}).`);
    }
    if (yt.type && !['public', 'private', 'unlisted'].includes(yt.type)) errors.push('platforms.youtube.type must be public, private or unlisted.');
    const desc = fullCaption(yt.description || caption, tags.filter((t) => t !== '#fyp'));
    if (desc.length > PLATFORM_LIMITS.youtube.description) errors.push(`YouTube description is ${desc.length} chars (max ${PLATFORM_LIMITS.youtube.description}).`);
    const words = (yt.description || caption).split(/\s+/).filter(Boolean).length;
    if (yt.longform && words < 150) warnings.push(`YouTube long-form description has ${words} words. Target 150+ with US-relevant keywords and timestamps.`);
    const ytTags = youtubeTags(yt.tags, tags);
    const total = ytTags.reduce((n, t) => n + t.label.length + (/\s/.test(t.label) ? 2 : 0), 0);
    if (total > PLATFORM_LIMITS.youtube.tagsTotal) errors.push(`YouTube tags total ${total} chars (max ${PLATFORM_LIMITS.youtube.tagsTotal}).`);
    if (/\b(locksmith life|satisfying keys?)\b/i.test(yt.title || '')) warnings.push('YouTube title is generic. Make it specific and searchable.');
  }

  return { errors, warnings };
}

function t_has(tags, t) {
  return tags.includes(t);
}

export function firstLine(caption) {
  return String(caption || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

export function fullCaption(caption, tags) {
  const body = String(caption || '').trim();
  return tags.length ? `${body}\n\n${tags.join(' ')}` : body;
}

export function youtubeTags(explicit, hashtags) {
  const src = explicit && explicit.length ? explicit : (hashtags || []).map((t) => t.replace(/^#/, ''));
  return src.map((t) => String(t).trim()).filter(Boolean).map((t) => ({ value: t, label: t }));
}
