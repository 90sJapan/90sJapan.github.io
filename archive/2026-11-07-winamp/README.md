# Winamp design (archived 2026-11-07)

The site's look before the retro weather-channel design: `winamp.css` skins the page as a
classic Winamp 2.x (the player is the main window, each track list a playlist editor, the
visualizer a docked vis window). It needs no markup changes: `index.html` and `script.js`
still use the same class names.

To bring it back, swap the font and stylesheet lines in `index.html` (and `links.html`):

```html
<link href="https://fonts.googleapis.com/css2?family=VT323&family=Silkscreen:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="archive/2026-11-07-winamp/winamp.css?v=20261025d">
```

(or copy `winamp.css` back to the site root, as it was). The clock, date and crawl bar elements
that the retro design added are hidden by nothing in `winamp.css`; remove them from
`index.html` too, or add `.wx-clock, .wx-crawl{ display:none; }`.
