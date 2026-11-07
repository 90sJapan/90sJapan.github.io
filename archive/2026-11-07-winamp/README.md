# Winamp design (archived 2026-11-07)

The site's look before the retro weather-channel designs: `winamp.css` skins the page as a
classic Winamp 2.x (the player is the main window, each track list a playlist editor, the
visualizer a docked vis window).

It runs on the same page markup as the first retro weather page, which is kept as a full snapshot in
`archive/2026-11-07-retro-weather/`. To bring Winamp back:

1. Restore that snapshot to the site root (see its README).
2. In the restored `index.html`, swap the font and stylesheet lines for these:

```html
<link href="https://fonts.googleapis.com/css2?family=VT323&family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="archive/2026-11-07-winamp/winamp.css?v=20261025d">
```

3. Remove the clock (`.wx-clock`) and crawl bar (`.wx-crawl`) elements and the small script after
   `script.js` that drives them, or add `.wx-clock, .wx-crawl{ display:none; }`.
