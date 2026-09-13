# CRMSN site

Static homepage for CRMSN. No build step: `index.html`, `styles.css`, `y2k.css`, `script.js`, plus `tracks.json` and `upload.sh` for the discography.
The music section embeds your SoundCloud profile directly, so new uploads to
soundcloud.com/officialcrmsn show up on the site automatically — no code changes needed.

## Two designs

The site ships with two looks, switched by the **Y2K mode / Classic mode** button in the header:

- **Classic** (`styles.css`) — dark, chrome type, soft aurora glow.
- **Y2K** (`y2k.css`) — silver chrome, glossy bubble buttons, holographic title, perspective grid, sparkles.

The visitor's choice is remembered in their browser (`localStorage`). To make Y2K the default
instead, change `'classic'` to `'y2k'` in the fallback line of `script.js` and flip the check in the
small inline script at the top of `index.html`. All Y2K rules are scoped under
`html[data-theme="y2k"]`, so editing one design never affects the other.

## Publish it on GitHub Pages (free)

GitHub's free plan only serves Pages sites from a **public** repository, so this repo
should be public. That's fine — it only contains site code (HTML/CSS/JS), nothing private.

1. Create a new repo on GitHub named exactly `yourusername.github.io` (replace
   `yourusername` with your actual GitHub username — this exact naming is what makes it
   your personal site instead of a project subpage).
2. Push these files to the root of that repo's `main` branch.
3. In the repo, go to **Settings → Pages** and confirm the source is the `main` branch, root folder.
4. Your site goes live at `https://yourusername.github.io` within a minute or two.

## Discography (full-quality files)

Song files you upload from your PC live in `music/`, which is **git-ignored** — they never enter
this public repo's history. Instead `upload.sh` publishes them as assets on the repo's
`discography` GitHub Release (free, up to 2 GB per file), and the site's player streams them
from there. `tracks.json` is the small committed manifest the player reads.

```
cp ~/Desktop/new-song.wav music/     # drop files in (mp3, wav, flac, m4a, aac, ogg, opus)
./upload.sh --push                   # upload new files + commit/push tracks.json
```

- Titles come from filenames (`Night_Drive-v2.wav` → "Night Drive v2"); edit them in `tracks.json` any time.
- Re-running the script skips files already uploaded and never touches existing entries.
- To remove a song: delete it from `music/`, remove its entry from `tracks.json`, and run
  `gh release delete-asset discography <file>`.
- To replace a file with a new version: delete the asset first (command above), then re-run.
- Anything the site can play, a visitor can download — that's true of every audio host. WAV/FLAC
  are large; MP3 320k or M4A are a good middle ground if bandwidth matters.
