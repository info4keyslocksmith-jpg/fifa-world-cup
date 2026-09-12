---
name: postiz
description: Post and schedule @4keyslocksmith videos to Instagram, TikTok and YouTube through Postiz. Use when Juan says /postiz, "schedule this", "post this video", "queue this for Monday", "what's scheduled", or drops a clip with a date. Wraps the official Postiz CLI rules with the 4Keys brand rules (social-media-4keys) and the social-agent/ tool in this repo.
---

# /postiz — 4Keys social scheduling agent

You are scheduling content for **@4keyslocksmith** (Instagram, TikTok, YouTube) through Postiz.
Two rulebooks apply at once:

1. **Brand rules** from the `social-media-4keys` skill (load it first when writing captions):
   story in every post, first person, max 5 hashtags, no ASMR or geo tags, no hard service or course CTAs.
2. **Postiz rules** (from the official Postiz agent skill):
   - Authenticate before anything (`POSTIZ_API_KEY`).
   - Every media file goes through Postiz upload first. Raw paths and external URLs are rejected by Instagram, TikTok and YouTube. The tool below does this for you.
   - TikTok `content_posting_method` must be `DIRECT_POST`. `UPLOAD` only drops a draft in the TikTok inbox and Postiz still reports success.
   - Settings that don't apply are silently discarded, not rejected. Check `postiz integrations:settings <id>` if a platform behaves unexpectedly.

The tool lives in `social-agent/` (Node 18+, no dependencies). Run everything from the repo root.

## Workflow

### A. One video → three platforms

1. Get the clip into `social-agent/media/` (or anywhere; the spec holds the path). Vertical 9:16 MP4 or MOV, 22–45 s.
2. Write a post spec into `social-agent/queue/<yyyy-mm-dd>-<slug>.json`. Copy `social-agent/queue/example.json`. Write the caption with the brand skill: hook line, 2–3 story beats, lesson, soft CTA ending on a question. Hashtags go in the `hashtags` array, never in the caption text.
   - `platforms.youtube.title` is required. Rewrite it for search: `[Specific result] + [Vehicle/tool] + [Authority hook]`.
   - `platforms.tiktok.title` ≤ 90 chars (defaults to the caption's first line).
   - Optional `thumbnail` (JPG/PNG) becomes the YouTube thumbnail: Juan's face + tool/car + 3-word text.
   - Per-platform overrides: `platforms.instagram.caption`, `platforms.tiktok.caption`, `platforms.youtube.description`.
   - `date` is ISO 8601 with offset, e.g. `2026-09-21T17:00:00-04:00`. Default posting windows: IG/TT 11:00–13:00 or 17:00–19:00 Eastern, YouTube 15:00–17:00 Eastern.
3. Validate: `node social-agent/cli.mjs check social-agent/queue/<file>.json`. Fix every ✖ and every ⚠ in the spec, not with `--force`.
4. Preview: `node social-agent/cli.mjs publish social-agent/queue/<file>.json --dry-run` and read the body back to Juan in plain words (date, channels, first line, hashtags, YouTube title).
5. Publish: `node social-agent/cli.mjs publish social-agent/queue/<file>.json`. Only run this when Juan asked to schedule or post. The spec moves to `queue/done/` with the Postiz response attached.

### B. A week of content

Write one spec per video into `queue/`, `check` each, then `node social-agent/cli.mjs queue --dry-run`, show the summary, and on Juan's go: `node social-agent/cli.mjs queue`.

### C. What's scheduled / undo

- `node social-agent/cli.mjs list --days 14`
- `node social-agent/cli.mjs delete <postId>` (ids come from `list` or from `queue/done/*.json`).

### D. First-time setup

`social-agent/README.md` has the full checklist. Short version: connect Instagram, TikTok and YouTube in the Postiz dashboard, put the API key in `social-agent/.env`, run `node social-agent/cli.mjs setup`.

## Hard rules for this skill

- Never publish without a passing `check` and a dry run Juan has seen, unless he explicitly said "just post it".
- Never use `--force` to bury a warning. Warnings are brand rules.
- Never set TikTok to `UPLOAD` unless Juan asks to finish the post inside the TikTok app.
- Never put `__type` in settings; the Postiz backend adds it.
- Never commit `social-agent/.env` or the media files.
- If Postiz returns an error, quote it, don't retry blindly. A 401/403 means the API key; a 4xx on `/posts` usually means a settings field or media type the platform rejected.

## Platform settings reference (what the tool sends)

| Platform | Settings sent | Notes |
|---|---|---|
| Instagram | `post_type: "post"` (or `"story"`), optional `collaborators: [{label}]` | Video posts publish as Reels. |
| TikTok | `title`, `privacy_level: PUBLIC_TO_EVERYONE`, `duet/stitch/comment: true`, `autoAddMusic: "no"`, brand toggles `false`, `content_posting_method: DIRECT_POST` | Override any via `platforms.tiktok.settings`. |
| YouTube | `title` (2–100), `type: public\|unlisted\|private`, `selfDeclaredMadeForKids: "no"`, `tags: [{value,label}]` (≤500 chars total), optional `thumbnail` | Tags default to the hashtags without `#`. |

Raw Postiz CLI (installed with `npm i -g postiz`) is available for anything the tool doesn't cover: `postiz integrations:list`, `postiz integrations:settings <id>`, `postiz posts:list`, `postiz analytics:post <id>`, `postiz posts:missing <id>` + `posts:connect` when TikTok analytics come back `{"missing": true}`.
