# Retro weather design, first version (archived 2026-11-07)

The site as it was before the CRT broadcast redesign: a normal scrolling page with an orange/blue
header and live clock, a "Local Music Forecast" title card, the player as a "Now Playing" panel,
blue playlist panels and a crawl bar along the bottom.

This folder is a full snapshot of the page: `index.html`, `retro.css` and the `script.js` it ran with.

To bring it back, copy all three files to the site root (overwriting the current ones), then
delete `tv.css` and `tv.js` from the root:

```
cp archive/2026-11-07-retro-weather/index.html archive/2026-11-07-retro-weather/retro.css archive/2026-11-07-retro-weather/script.js .
git rm tv.css tv.js
```

Then bump the `?v=` numbers in `index.html` so visitors don't get cached copies.
