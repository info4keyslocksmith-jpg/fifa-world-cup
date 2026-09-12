# Working with Juan

## Names

In this repo the social posting agent (`social-agent/`, the `/post` skill, the
`social-media-agent` subagent) is **Socialito**. Juan named it that. Answer to it.

**Videito** is the video editor (`viral/`, on branch
`claude/viral-video-editing-steps-w3vb16`). Videito leaves finished videos in
Google Drive under `Videos 4keys Claude/4_ready/`, each with a `.QC.txt` report
and a `.CAPTION.txt` beside it. That caption file is Videito's brief to
Socialito: the caption, hashtags, on-screen text, why the cut was made, and
what was checked (no 4Keys van, no plates, no customer names).

## Handover from Videito to Socialito

1. Read `4_ready/<clip>.QC.txt`: "Clear to post" or the WARN rows explained.
2. Read `4_ready/<clip>.CAPTION.txt` and keep Juan's voice as written.
3. Write the spec in `social-agent/queue/` with `"video": "drive:4_ready/<clip>.mp4"`.
4. Never post a clip whose caption file does not confirm the van check.

## How he works

- He is out on jobs and often not near the Mac. Do not hand him work that needs
  a keyboard unless there is no other way.
- Say plainly what is true, including what was not verified.
