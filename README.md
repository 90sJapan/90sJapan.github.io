# CRMSN site

Static homepage for CRMSN. No build step: `index.html`, `styles.css`, `y2k.css`, `script.js`, plus `tracks.json` and `upload.sh` for the discography.
The music section embeds your SoundCloud profile directly, so new uploads to
soundcloud.com/officialcrmsn show up on the site automatically — no code changes needed.

`index.html` links its CSS/JS with a `?v=…` tag; bump that number whenever you change `styles.css`,
`y2k.css` or `script.js`, otherwise visitors' browsers can keep the old copies cached for a while
after a deploy (GitHub Pages serves everything with a 10-minute cache).

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

Song files live in `music/<artist>/…`, which is **git-ignored** — they never enter this public
repo's history. `discog.py` publishes them as assets on the repo's `discography` GitHub Release
(free, up to 2 GB per file) and the site's player streams them from there. `tracks.json` is the
small committed manifest the player reads: it carries the *display title*, while the original
file name is shown as a small detail for whatever's playing.

```
music/
  crmsn/…            # one top-level folder per artist/alias
  hush witch/…
  spotlife/…
```

Each folder is mapped to a SoundCloud profile in `tracks.json` → `"sources"`. Then:

```
python3 discog.py match            # pull titles from SoundCloud, match them to the local files
python3 discog.py status           # see what matched / needs review
python3 discog.py upload --push    # upload new files to the release, build viz data, commit, push
python3 discog.py viz [--force]    # (re)build visualizer data on its own
```

- **Matching** is by track length (SoundCloud's duration vs the local file's), with the filename
  as a tie-breaker. Confident matches get the SoundCloud title; ambiguous ones are flagged
  `needs_review` with the candidates listed; files with no match keep a cleaned-up filename as
  their title. Edit `title` in `tracks.json` by hand any time — re-running never overwrites a
  matched or edited title (delete the entry's `soundcloud` key to force a re-match).
- **Private SoundCloud tracks** are invisible to the public API. Give the script your session's
  OAuth token (soundcloud.com → DevTools → Application → Cookies → `oauth_token`) via
  `--token`, `SC_OAUTH_TOKEN`, or a git-ignored `.sc_token` file.
- Identical files that appear in two folders are uploaded once (`duplicate_of` marks the copy).
- Upload skips files already on the release and checkpoints after every file, so it can be
  interrupted and resumed. To replace a file: `gh release delete-asset discography <asset>`,
  then re-run upload.
- Anything the site can play, a visitor can download — that's true of every audio host.

The player shows one list per artist, split into **public** and **private** when an artist has both —
decided by the folder a file sits in (`…/soundcloud_private/…` vs `…/soundcloud_public/…`), falling
back to what SoundCloud reported. Each list shows 7 rows and scrolls for the rest.

### Visualizer

The player has a visualizer (Bars & Waves / Scope / Ambience / Spikes — click the screen to cycle).
GitHub's release host sends no CORS headers, so a browser can't analyse the streamed audio itself;
instead `discog.py viz` decodes each file locally (`afconvert` + numpy) and writes a small
`viz/<file>.bin` (24 log-spaced bands + tone + level at 16 fps, ~40 KB/min) that the page syncs to
the playback position. `upload` runs it automatically; a track with no file just shows an idle screen.
Colours come from the theme's `--viz-*` tokens and slide along that palette with the tone of the music.
