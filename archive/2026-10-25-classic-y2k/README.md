# Classic + Y2K design (archived 2026-10-25)

The site's look before the Winamp skin: `styles.css` (Classic) plus `y2k.css`
(the Y2K look, scoped to `html[data-theme="y2k"]`), switched by `theme.js` and the
"Y2K mode" button in the header.

To bring it back, point the pages at these files again:

```html
<script>
  try { var t = localStorage.getItem('crmsn-theme'); if (t === 'y2k') document.documentElement.dataset.theme = 'y2k'; } catch (e) {}
</script>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;900&family=Space+Grotesk:wght@400;500;600&family=Orbitron:wght@500;700;900&family=Audiowide&display=swap" rel="stylesheet">
<link rel="stylesheet" href="archive/2026-10-25-classic-y2k/styles.css">
<link rel="stylesheet" href="archive/2026-10-25-classic-y2k/y2k.css">
...
<button class="theme-toggle" id="themeToggle" type="button" aria-pressed="false" title="Switch design">
  <span class="theme-toggle-label">Y2K mode</span>
</button>
...
<script src="archive/2026-10-25-classic-y2k/theme.js"></script>
```

(or copy the three files back to the site root, as they were).
