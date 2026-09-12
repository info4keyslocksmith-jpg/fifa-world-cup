# 4Keys social agent (Postiz)

Schedules one video to **Instagram, TikTok and YouTube** in a single command through [Postiz](https://postiz.com), with the @4keyslocksmith brand rules enforced before anything leaves your machine.

Inside Claude Code this repo exposes it as the `/postiz` skill and the `social-media-agent` subagent. This file is the manual version.

## One-time setup

1. **Postiz account.** Sign up at postiz.com (or self-host). In the dashboard, add three channels: Instagram (business/creator account linked to a Facebook page), TikTok, YouTube. Each one walks you through the platform's own login.
2. **API key.** Postiz dashboard → Settings → Public API → copy the key.
3. **Local config.**
   ```bash
   cp social-agent/.env.example social-agent/.env   # paste the key into POSTIZ_API_KEY
   node social-agent/cli.mjs setup                  # fetches your channels, writes config/integrations.json
   ```
   `setup` prints every connected channel. If you have more than one Instagram or YouTube channel it picks the first and tells you how to change it.
4. Optional, for raw commands and analytics: `npm install -g postiz` (the official CLI). Same `POSTIZ_API_KEY` works.

Requires Node 18 or newer. No npm install is needed for the tool itself.

## Daily use

```bash
# 1. put the clip somewhere, e.g. social-agent/media/2am-bmw.mp4
# 2. write the post spec (copy queue/example.json) into social-agent/queue/2026-09-21-2am-bmw.json
node social-agent/cli.mjs check   social-agent/queue/2026-09-21-2am-bmw.json   # brand + platform rules, offline
node social-agent/cli.mjs publish social-agent/queue/2026-09-21-2am-bmw.json --dry-run   # prints the exact request
node social-agent/cli.mjs publish social-agent/queue/2026-09-21-2am-bmw.json   # uploads once, schedules on all 3
```

`publish` uploads the video (and thumbnail) to Postiz once, reuses that URL for every channel, creates one grouped scheduled post, and moves the spec into `queue/done/` with the Postiz response attached so you keep the post ids.

Batch a week:

```bash
node social-agent/cli.mjs queue --dry-run   # every spec in queue/, oldest date first
node social-agent/cli.mjs queue
```

See and undo:

```bash
node social-agent/cli.mjs list --days 14
node social-agent/cli.mjs delete <postId>
```

Flags for `publish` and `queue`: `--dry-run`, `--draft` (creates a Postiz draft instead of scheduling), `--only instagram,tiktok`, `--force` (publish despite warnings; errors always block).

## The post spec

```json
{
  "video": "media/2am-bmw.mp4",
  "thumbnail": "media/2am-bmw-thumb.jpg",
  "date": "2026-09-21T17:00:00-04:00",
  "pillar": "craft",
  "framework": "job-story",
  "language": "en",
  "caption": "Hook line\n\nStory beat\n\nLesson\n\nQuestion that invites a comment?",
  "hashtags": ["#autolocksmith", "#bmw", "#smallbusiness", "#hustleculture", "#4keyslocksmith"],
  "platforms": {
    "instagram": { "enabled": true, "post_type": "post" },
    "tiktok":    { "enabled": true, "title": "≤ 90 chars" },
    "youtube":   { "enabled": true, "title": "Searchable title, 2–100 chars", "type": "public", "tags": ["auto locksmith", "bmw key"] }
  }
}
```

- `caption` is shared. Override per platform with `platforms.instagram.caption`, `platforms.tiktok.caption`, `platforms.youtube.description`.
- `hashtags` are appended on their own line. `#fyp` is only kept on TikTok.
- `platforms.youtube.title` is required (rewrite for search). YouTube `tags` default to the hashtags without `#`.
- Advanced per-platform Postiz settings go under `platforms.<name>.settings` and are merged over the defaults (for example `{"privacy_level": "SELF_ONLY"}` to test-post privately on TikTok, or `{"type": "unlisted"}` on YouTube).
- Media paths resolve relative to the spec file, then to `social-agent/`, then to the current directory.

## What `check` enforces

Errors (block publishing): more than 5 hashtags, banned tags (`#asmr`, `#satisfying`, `#viral`…), geo tags (`#miami`, `#atlanta`, `#florida`…), hard service or course CTAs, missing or past date, missing YouTube title, platform length limits (IG/TikTok caption 2200, TikTok title 90, YouTube title 100, YouTube tags 500 total).

Warnings (block unless `--force`): missing `#4keyslocksmith`, hashtags inside the caption text, not first person ("we", "our team", "nosotros"), marketer-speak, caption not ending on a question, single-block caption, hook line over 140 chars, TikTok set to `UPLOAD`.

## What gets sent per platform

| Platform | Settings |
|---|---|
| Instagram | `post_type: post` (video posts publish as Reels; use `story` for Stories) |
| TikTok | `privacy_level: PUBLIC_TO_EVERYONE`, duet/stitch/comment on, no auto music, brand toggles off, `content_posting_method: DIRECT_POST` (the only value that actually publishes) |
| YouTube | `title`, `type: public`, `selfDeclaredMadeForKids: no`, `tags`, optional `thumbnail` |

## Test

```bash
node social-agent/test/run.mjs
```

Spins up a local mock of the Postiz API and checks validation, single upload reuse, per-platform settings, `--only` and `--draft`. No network, no key needed.

## Layout

```
social-agent/
  cli.mjs            commands: setup, check, publish, queue, list, delete
  lib/postiz.mjs     Postiz public API client (upload, posts, integrations)
  lib/brand.mjs      @4keyslocksmith rules as checks
  lib/build.mjs      spec → Postiz request body
  lib/publish.mjs    validate → upload → create → archive
  queue/             specs waiting to be scheduled (example.json is skipped by `queue`)
  queue/done/        published specs with Postiz response and post ids
  config/integrations.json   channel ids written by `setup`
  media/             your clips (git-ignored)
  .env               POSTIZ_API_KEY (git-ignored)
```
