# 4Keys social agent (Chrome)

Posts one video to **Instagram, TikTok and YouTube** from your own computer, through a real Chrome window, the same upload screens you click by hand. No third-party service, no API keys. The @4keyslocksmith brand rules are checked before anything is posted.

Inside Claude Code this repo exposes it as the `/post` skill and the `social-media-agent` subagent. This file is the manual version.

## One-time setup

Needs Node 18+ and Google Chrome installed.

```bash
cd social-agent
npm install                # installs Playwright, the library that drives Chrome
node cli.mjs login         # opens Chrome with YouTube Studio, TikTok and Instagram tabs
```

Sign in on all three tabs (approve 2-step prompts on your phone), then press Enter in the terminal. The logins are saved in `social-agent/.chrome-profile/`, a separate Chrome profile used only by this tool. You won't need to sign in again unless a site logs you out.

## How timing works

| Channel | What happens |
|---|---|
| YouTube | Uploaded right away and scheduled inside YouTube Studio for your date. Publishes on time even if the computer is off. |
| TikTok, Instagram | Their websites have no dependable scheduler, so the tool posts them **at** your date. `run --watch` has to be running on your computer at that time. |

Make sure the YouTube Studio channel timezone matches your computer's clock, since the scheduler picks the date and time by name.

## Daily use

```bash
# 1. put the clip in social-agent/media/2am-bmw.mp4
# 2. copy queue/example.json to queue/2026-09-21-2am-bmw.json and edit it
node cli.mjs check queue/2026-09-21-2am-bmw.json            # brand + platform rules, no browser
node cli.mjs post  queue/2026-09-21-2am-bmw.json --dry-run  # what would happen
node cli.mjs post  queue/2026-09-21-2am-bmw.json            # YouTube uploads + schedules now
node cli.mjs run --watch                                    # leave this running: posts TikTok/Instagram when due
```

Other commands:

```bash
node cli.mjs run                 # process the whole queue once
node cli.mjs status              # queue and per-channel state
node cli.mjs post <spec> --now   # ignore the date, publish everywhere immediately
node cli.mjs post <spec> --only tiktok,instagram
```

Flags: `--now`, `--only`, `--dry-run`, `--force` (proceed despite warnings; errors always block), `--interval 60` (seconds between checks for `--watch`).

When every channel is done the spec moves to `queue/done/` with a `status` block recording what happened. A failed channel keeps its error message and a screenshot in `logs/`; fix the cause and run again, only the failed channel is retried.

### Keeping `run --watch` alive

- **Windows:** Task Scheduler → Create Task → trigger "At log on" → action `node C:\path\to\social-agent\cli.mjs run --watch`. Or just leave a terminal open.
- **Mac:** leave a terminal open, or create a launchd agent that runs the same command at login.

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
    "instagram": { "enabled": true },
    "tiktok":    { "enabled": true, "title": "≤ 90 chars" },
    "youtube":   { "enabled": true, "title": "Searchable title, 2–100 chars", "type": "public", "tags": ["auto locksmith", "bmw key"] }
  }
}
```

- `caption` is shared. Override per platform with `platforms.instagram.caption`, `platforms.tiktok.caption`, `platforms.youtube.description`.
- `hashtags` are appended on their own line. `#fyp` is only kept on TikTok.
- `platforms.youtube.title` is required. `type` can be `public`, `unlisted` or `private` (only used when publishing immediately; scheduled videos go public at the date). `tags` default to the hashtags without `#`.
- Media paths resolve relative to the spec file, then to `social-agent/`, then to the current directory.

## What `check` enforces

Errors (block): more than 5 hashtags, banned tags (`#asmr`, `#satisfying`, `#viral`…), geo tags (`#miami`, `#atlanta`, `#florida`…), hard service or course CTAs, missing or past date, missing YouTube title, platform length limits (IG/TikTok caption 2200, TikTok title 90, YouTube title 100, YouTube tags 500 total).

Warnings (block unless `--force`): missing `#4keyslocksmith`, hashtags inside the caption text, not first person ("we", "our team", "nosotros"), marketer-speak, caption not ending on a question, single-block caption, hook line over 140 chars.

## When a site changes its page

The drivers in `lib/sites/` find buttons and boxes by the same ids and labels the real pages use today (YouTube Studio's `#create-icon`, TikTok's caption editor, Instagram's "New post" icon and "Write a caption..." box). Sites redesign now and then. If a channel starts failing, open the screenshot in `logs/`, compare with the live page, update the selector in that one file, and run `npm test`.

## Test

```bash
npm test
```

Drives each flow against local stand-in pages that use the same element ids and roles as the real sites, and checks the runner's timing, status and retry logic. No login needed.

## Layout

```
social-agent/
  cli.mjs               login, check, post, run, status
  lib/brand.mjs         @4keyslocksmith rules as checks
  lib/jobs.mjs          spec → one job per channel (text, title, tags, timing)
  lib/runner.mjs        validate → run due jobs in Chrome → record status → archive
  lib/browser.mjs       persistent Chrome profile, typing/click helpers, error screenshots
  lib/sites/            youtube.mjs, tiktok.mjs, instagram.mjs (the click-through flows)
  queue/                specs waiting (example.json is skipped by `run`)
  queue/done/           finished specs with their status
  media/                your clips (git-ignored)
  .chrome-profile/      your logins (git-ignored)
  logs/                 error screenshots (git-ignored)
  test/                 fixtures + test runner
```
