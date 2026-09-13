const themeToggle = document.getElementById('themeToggle');
const root = document.documentElement;

function applyTheme(theme) {
  if (theme === 'y2k') root.dataset.theme = 'y2k';
  else delete root.dataset.theme;
  themeToggle.setAttribute('aria-pressed', theme === 'y2k' ? 'true' : 'false');
  themeToggle.querySelector('.theme-toggle-label').textContent = theme === 'y2k' ? 'Classic mode' : 'Y2K mode';
  try { localStorage.setItem('crmsn-theme', theme); } catch (e) {}
}

applyTheme(root.dataset.theme === 'y2k' ? 'y2k' : 'classic');

themeToggle.addEventListener('click', () => {
  applyTheme(root.dataset.theme === 'y2k' ? 'classic' : 'y2k');
});

/* ---------- visualizer ----------
   The audio host sends no CORS headers, so the browser can't analyse the stream itself.
   discog.py precomputes a small spectrum file per track (viz/<file>.bin: 24 log-spaced bands +
   tone + level, 16 fps); this reads it and follows audio.currentTime, interpolating between
   frames and smoothing so the motion stays fluid. Colours come from the active theme's
   --viz-* tokens, shifted along the palette by the tone (spectral centroid) of the music. */
const viz = (function () {
  const canvas = document.getElementById('viz');
  const ctx = canvas.getContext('2d');
  const stage = canvas.parentElement;
  const modesEl = document.getElementById('vizModes');
  const hint = document.getElementById('vizHint');
  const MODES = [
    { id: 'bars', name: 'Bars & Waves' },
    { id: 'scope', name: 'Scope' },
    { id: 'ambience', name: 'Ambience' },
    { id: 'spikes', name: 'Spikes' },
  ];
  const N = 24;                                   // bands drawn (matches the analysis)
  const cur = new Float32Array(N), peak = new Float32Array(N), peakV = new Float32Array(N);
  const wavePts = new Float32Array(128);
  let mode = 'bars';
  try { const m = localStorage.getItem('crmsn-viz'); if (MODES.some(x => x.id === m)) mode = m; } catch (e) {}
  let audio = null, data = null, fetchCtl = null;
  const cache = new Map();
  let tone = 0.35, level = 0, energy = 0, clock = 0, spin = 0;
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0, inView = true;
  let colors = null;

  // ---- colours from the theme
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  function parseColor(s) {
    ctx.fillStyle = '#000'; ctx.fillStyle = s.trim();
    const v = ctx.fillStyle;                       // canvas normalises to #rrggbb for opaque colours
    if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    const m = v.match(/[\d.]+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]];
  }
  function readColors() {
    const cs = getComputedStyle(canvas);
    const get = (n, fb) => parseColor(cs.getPropertyValue(n) || fb);
    colors = { stops: [get('--viz-a', '#8b5cff'), get('--viz-b', '#ff3ea5'), get('--viz-c', '#35e6ff')],
               hot: get('--viz-hot', '#ffffff'), bg: get('--viz-bg', '#05050b') };
  }
  const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  function grad(u) {                               // position along the 3-stop palette, 0..1
    u = clamp(u, 0, 1) * 2; const s = colors.stops;
    return u < 1 ? mix(s[0], s[1], u) : mix(s[1], s[2], u - 1);
  }
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')';

  // ---- data
  function parse(buf) {
    if (buf.byteLength < 16) return null;
    const v = new DataView(buf);
    if (v.getUint32(0) !== 0x43524d56) return null;   // 'CRMV'
    const fps = v.getUint8(5), bands = v.getUint8(6), stride = bands + v.getUint8(7), n = v.getUint32(8, true);
    if (buf.byteLength < 16 + n * stride) return null;
    return { fps, bands, stride, n, frames: new Uint8Array(buf, 16, n * stride) };
  }
  function setTrack(track) {
    if (fetchCtl) fetchCtl.abort();
    data = null; hint.hidden = true;
    if (!track) return;
    const key = track.file;
    if (cache.has(key)) { data = cache.get(key); if (!data) hint.hidden = false; return; }
    fetchCtl = new AbortController();
    fetch('viz/' + encodeURIComponent(key) + '.bin', { signal: fetchCtl.signal })
      .then(r => r.ok ? r.arrayBuffer() : null)
      .then(buf => {
        const d = buf ? parse(buf) : null;
        cache.set(key, d);
        if (audio && (audio.dataset.file === key)) { data = d; hint.hidden = !!d; kick(); }
      })
      .catch(() => {});
  }
  hint.textContent = 'No visualizer data for this track yet';

  // ---- per-frame state
  const tgt = new Float32Array(N);
  function sample(t) {
    if (!data) { tgt.fill(0); return { tone: null, level: 0 }; }
    const x = t * data.fps, f0 = clamp(Math.floor(x), 0, data.n - 1), f1 = Math.min(f0 + 1, data.n - 1), a = clamp(x - f0, 0, 1);
    const fr = data.frames, s = data.stride, o0 = f0 * s, o1 = f1 * s;
    for (let i = 0; i < N; i++) {
      const b = (i * data.bands / N) | 0;
      const raw = (fr[o0 + b] + (fr[o1 + b] - fr[o0 + b]) * a) / 255;
      const v = clamp((raw - 0.3) / 0.7, 0, 1);     // lift the floor so quiet bands rest near zero
      tgt[i] = Math.pow(v, 1.3);
    }
    const tn = (fr[o0 + data.bands] + (fr[o1 + data.bands] - fr[o0 + data.bands]) * a) / 255;
    const lv = (fr[o0 + data.bands + 1] + (fr[o1 + data.bands + 1] - fr[o0 + data.bands + 1]) * a) / 255;
    return { tone: tn, level: Math.pow(clamp((lv - 0.25) / 0.75, 0, 1), 1.2) };
  }
  function step(dt) {
    const playing = audio && !audio.paused && !audio.ended;
    const s = playing ? sample(audio.currentTime) : { tone: null, level: 0 };
    if (!playing) tgt.fill(0);
    const up = 1 - Math.exp(-dt / 0.045), down = 1 - Math.exp(-dt / 0.16);
    energy = 0;
    for (let i = 0; i < N; i++) {
      const v = tgt[i];
      cur[i] += (v - cur[i]) * (v > cur[i] ? up : down);
      if (cur[i] >= peak[i]) { peak[i] = cur[i]; peakV[i] = 0; }
      else { peakV[i] += 2.4 * dt; peak[i] = Math.max(cur[i], peak[i] - peakV[i] * dt); }
      energy += cur[i] + peak[i];
    }
    level += (s.level - level) * (s.level > level ? up : down);
    if (s.tone !== null && s.level > 0.06) tone += (s.tone - tone) * (1 - Math.exp(-dt / 0.6));
    clock += dt; spin += dt * (0.12 + level * 0.5);
    energy = energy / (2 * N) + level;
    // the wave is resynthesised from the bands: each band contributes a sine at its own pace
    let sum = 0.001; for (let i = 0; i < N; i++) sum += cur[i];
    for (let p = 0; p < wavePts.length; p++) {
      const x = p / (wavePts.length - 1); let y = 0;
      for (let i = 0; i < N; i++) y += cur[i] * Math.sin(6.2832 * (x * (1 + i * 0.7) + clock * (0.35 + i * 0.22)));
      wavePts[p] = y / sum * level;
    }
  }

  // ---- drawing
  function drawBg(alpha) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = rgba(colors.bg, alpha); ctx.fillRect(0, 0, W, H);
  }
  function drawWave(width, alpha, scale) {
    ctx.beginPath();
    for (let p = 0; p < wavePts.length; p++) {
      const x = p / (wavePts.length - 1) * W, y = H * 0.5 - wavePts[p] * H * scale;
      p ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(grad(tone), alpha); ctx.stroke();
  }
  function drawBars() {
    drawBg(1);
    const gap = Math.max(2, W / N * 0.22), bw = (W - gap * (N + 1)) / N, base = H - 6, maxH = H * 0.86;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const x = gap + i * (bw + gap), h = Math.max(2, cur[i] * maxH);
      const c = grad(tone * 0.55 + (i / (N - 1)) * 0.45);
      const g = ctx.createLinearGradient(0, base, 0, base - maxH);
      g.addColorStop(0, rgba(mix(c, colors.bg, 0.45), 0.9)); g.addColorStop(0.55, rgba(c, 0.95)); g.addColorStop(1, rgba(colors.hot, 0.9));
      ctx.fillStyle = g; ctx.fillRect(x, base - h, bw, h);
      const ph = peak[i] * maxH;
      if (ph > 3) { ctx.fillStyle = rgba(colors.hot, 0.5 + 0.5 * peak[i]); ctx.fillRect(x, base - ph - 3, bw, 2.5); }
    }
    ctx.shadowColor = rgba(grad(tone), 0.9); ctx.shadowBlur = 14;
    drawWave(2, 0.85, 0.32);
    ctx.shadowBlur = 0;
  }
  function drawScope() {
    drawBg(0.28);                                   // faint trails
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(grad(tone), 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5); ctx.stroke();
    ctx.shadowColor = rgba(grad(tone), 1); ctx.shadowBlur = 22;
    drawWave(7, 0.22, 0.42);
    drawWave(3, 0.95, 0.42);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(colors.hot, 0.55); drawWave(1, 0.55, 0.42);
  }
  function drawAmbience() {
    drawBg(0.11);
    ctx.globalCompositeOperation = 'lighter';
    const R = Math.min(W, H);
    for (let k = 0; k < 5; k++) {
      let g = 0; for (let i = k * 5; i < k * 5 + 5 && i < N; i++) g += cur[i]; g /= 5;
      const t = clock * (0.10 + k * 0.035), ph = k * 1.7;
      const x = W * (0.5 + 0.34 * Math.sin(t + ph)), y = H * (0.5 + 0.30 * Math.cos(t * 1.3 + ph * 0.6));
      const r = R * (0.14 + 0.32 * g + 0.08 * level);
      const c = grad(tone + (k - 2) * 0.11);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(mix(c, colors.hot, 0.35), 0.28 + 0.5 * g)); rg.addColorStop(0.5, rgba(c, 0.18 + 0.25 * g)); rg.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
  }
  function drawSpikes() {
    drawBg(0.35);
    ctx.globalCompositeOperation = 'lighter';
    const cx = W / 2, cy = H / 2, R = Math.min(W, H), r0 = R * (0.19 + 0.07 * level), len = R * 0.5;
    const M = N * 2;
    for (let k = 0; k < M; k++) {
      const i = k < N ? k : M - 1 - k;              // mirrored so the ring is symmetric
      const a = spin + k / M * 6.2832, h = r0 + cur[i] * len, w = 0.55 * (6.2832 / M);
      const c = grad(tone * 0.6 + (i / (N - 1)) * 0.4);
      ctx.fillStyle = rgba(c, 0.35 + 0.6 * cur[i]);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - w) * r0, cy + Math.sin(a - w) * r0);
      ctx.lineTo(cx + Math.cos(a) * h, cy + Math.sin(a) * h);
      ctx.lineTo(cx + Math.cos(a + w) * r0, cy + Math.sin(a + w) * r0);
      ctx.closePath(); ctx.fill();
      const p = r0 + peak[i] * len;
      ctx.fillStyle = rgba(colors.hot, 0.6 * peak[i]); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * p, cy + Math.sin(a) * p, 1.6, 0, 6.2832); ctx.fill();
    }
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0);
    rg.addColorStop(0, rgba(mix(grad(tone), colors.hot, 0.5), 0.55 + 0.4 * level)); rg.addColorStop(1, rgba(grad(tone), 0.05));
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, r0, 0, 6.2832); ctx.fill();
  }
  const DRAW = { bars: drawBars, scope: drawScope, ambience: drawAmbience, spikes: drawSpikes };

  // ---- loop
  function frame(now) {
    raf = 0;
    const dt = last ? clamp((now - last) / 1000, 0.001, 0.05) : 0.016; last = now;
    step(dt); DRAW[mode]();
    const playing = audio && !audio.paused && !audio.ended;
    if (inView && (playing || energy > 0.003 || mode === 'ambience')) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function kick() { if (!raf && inView) raf = requestAnimationFrame(frame); }

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBg(1); kick();
  }
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(es => { inView = es[0].isIntersecting; kick(); }).observe(stage);
  new MutationObserver(() => { readColors(); drawBg(1); kick(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  function setMode(id) {
    mode = id;
    try { localStorage.setItem('crmsn-viz', id); } catch (e) {}
    modesEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === id ? 'true' : 'false'));
    drawBg(1); kick();
  }
  MODES.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'viz-mode'; b.dataset.mode = m.id; b.textContent = m.name;
    b.addEventListener('click', () => setMode(m.id));
    modesEl.appendChild(b);
  });
  canvas.addEventListener('click', () => setMode(MODES[(MODES.findIndex(m => m.id === mode) + 1) % MODES.length].id));

  readColors(); setMode(mode);
  return {
    attach(el) { audio = el; ['play', 'playing', 'seeked'].forEach(ev => el.addEventListener(ev, kick)); },
    setTrack,
  };
})();

/* ---------- discography player ---------- */
(function () {
  const MAX_ROWS = 7;                               // rows visible per list before it scrolls
  const player = document.getElementById('player');
  const audio = document.getElementById('audio');
  const grid = document.getElementById('trackList');
  const empty = document.getElementById('trackEmpty');
  const playBtn = document.getElementById('playBtn');
  const seek = document.getElementById('seek');
  const titleEl = document.getElementById('playerTitle');
  const curEl = document.getElementById('timeCur');
  const durEl = document.getElementById('timeDur');
  const fileEl = document.getElementById('playerFile');
  const fileY2k = document.getElementById('playerFileY2k');
  let tracks = [];
  let current = -1;
  let seeking = false;

  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';

  // public vs private follows the folder the file was sorted into (music/<artist>/…private…/),
  // falling back to what SoundCloud reported at match time
  function visibility(t) {
    const folder = (t.source || '').split('/').slice(0, -1).join('/').toLowerCase();
    return /private/.test(folder) ? 'private' : /public/.test(folder) ? 'public' : (t.sharing || 'public');
  }

  function render() {
    grid.innerHTML = '';
    // one list per artist; an artist with both public and private tracks gets one list of each
    const groups = [];
    tracks.forEach((t, i) => {
      const name = t.artist || '', vis = visibility(t);
      let g = groups.find(x => x.name === name && x.vis === vis);
      if (!g) { g = { name, vis, items: [] }; groups.push(g); }
      g.items.push(i);
    });
    const artists = [...new Set(groups.map(g => g.name))];   // keep artist order, public before private
    groups.sort((a, b) => artists.indexOf(a.name) - artists.indexOf(b.name) || (a.vis === 'public' ? -1 : 1));
    groups.forEach(g => {
      const split = groups.some(x => x !== g && x.name === g.name);
      const cell = document.createElement('div'); cell.className = 'discog-cell track-group';
      const bar = document.createElement('div'); bar.className = 'y2k-titlebar'; bar.setAttribute('aria-hidden', 'true');
      bar.innerHTML = '<span class="y2k-titlebar-text"></span><span class="y2k-titlebar-btns"><i></i><i></i><i></i></span>';
      bar.querySelector('.y2k-titlebar-text').textContent = ((g.name || 'tracks') + (split ? ' ' + g.vis : '')).replace(/\s+/g, '_') + '.m3u';
      cell.appendChild(bar);
      const head = document.createElement('div'); head.className = 'cell-head';
      const h = document.createElement('h3'); h.className = 'track-group-name'; h.textContent = g.name || 'Tracks';
      if (split) {
        const tag = document.createElement('span'); tag.className = 'track-vis is-' + g.vis; tag.textContent = g.vis;
        h.appendChild(tag);
      }
      const count = document.createElement('span'); count.className = 'track-count';
      count.textContent = g.items.length + (g.items.length === 1 ? ' track' : ' tracks');
      head.appendChild(h); head.appendChild(count); cell.appendChild(head);
      const ol = document.createElement('ol'); ol.className = 'track-list';
      g.items.forEach((i, n) => {
        const t = tracks[i];
        const li = document.createElement('li');
        li.className = 'track'; li.dataset.index = i;
        li.innerHTML = '<button type="button" class="track-btn">' +
          '<span class="track-num">' + String(n + 1).padStart(2, '0') + '</span>' +
          '<span class="track-title"></span>' +
          '<span class="track-meta"></span></button>';
        li.querySelector('.track-title').textContent = t.title;
        li.querySelector('.track-meta').textContent = (t.file.split('.').pop() || '').toUpperCase() + (t.duration ? ' · ' + fmt(t.duration) : '');
        li.querySelector('button').addEventListener('click', () => (i === current ? toggle() : load(i, true)));
        ol.appendChild(li);
      });
      ol.addEventListener('scroll', () => markEnd(ol), { passive: true });
      cell.appendChild(ol);
      grid.appendChild(cell);
    });
    fitLists();
  }

  // cap each list at MAX_ROWS rows; the rest scrolls inside the cell
  function markEnd(ol) { ol.classList.toggle('at-end', ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 2); }
  const ro = new ResizeObserver(fitLists);
  function fitLists() {
    grid.querySelectorAll('.track-list').forEach(ol => {
      const items = ol.children;
      if (items.length <= MAX_ROWS) { ol.style.maxHeight = ''; ol.classList.remove('is-scroll'); return; }
      ro.observe(items[0]);
      const last = items[MAX_ROWS - 1];
      ol.style.maxHeight = (last.offsetTop + last.offsetHeight) + 'px';
      ol.classList.add('is-scroll'); markEnd(ol);
    });
  }
  window.addEventListener('resize', fitLists);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitLists);

  function reveal(i) {                              // keep the playing row visible inside its list
    const li = grid.querySelector('.track[data-index="' + i + '"]'); if (!li) return;
    const ol = li.parentElement, top = li.offsetTop, bottom = top + li.offsetHeight;
    if (top < ol.scrollTop || bottom > ol.scrollTop + ol.clientHeight)
      ol.scrollTo({ top: top - (ol.clientHeight - li.offsetHeight) / 2, behavior: 'smooth' });
  }

  function mark() {
    grid.querySelectorAll('.track').forEach(li => {
      const i = Number(li.dataset.index);
      li.classList.toggle('is-current', i === current);
      li.classList.toggle('is-playing', i === current && !audio.paused);
    });
    player.classList.toggle('is-playing', !audio.paused);
    playBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  }

  function load(i, autoplay) {
    current = (i + tracks.length) % tracks.length;
    audio.src = tracks[current].url;
    audio.dataset.file = tracks[current].file;
    viz.setTrack(tracks[current]);
    titleEl.textContent = tracks[current].title;
    // the original file name stays visible as a small detail for whatever is playing
    const srcName = (tracks[current].source || tracks[current].file).split('/').pop();
    fileEl.textContent = srcName;
    fileY2k.textContent = srcName.replace(/\s+/g, '_');
    seek.value = 0; curEl.textContent = '0:00'; durEl.textContent = '0:00';
    if (autoplay) audio.play().catch(() => {});
    mark(); reveal(current);
  }
  function toggle() { if (current < 0) return load(0, true); audio.paused ? audio.play() : audio.pause(); }

  playBtn.addEventListener('click', toggle);
  document.getElementById('prevBtn').addEventListener('click', () => load(current - 1, true));
  document.getElementById('nextBtn').addEventListener('click', () => load(current + 1, true));
  audio.addEventListener('play', mark);
  audio.addEventListener('pause', mark);
  audio.addEventListener('ended', () => load(current + 1, true));
  audio.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    curEl.textContent = fmt(audio.currentTime);
    if (!seeking && audio.duration) seek.value = Math.round(audio.currentTime / audio.duration * 1000);
  });
  seek.addEventListener('input', () => { seeking = true; curEl.textContent = fmt(seek.value / 1000 * (audio.duration || 0)); });
  seek.addEventListener('change', () => { seeking = false; if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; });
  viz.attach(audio);

  fetch('tracks.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      tracks = (data.tracks || []).filter(t => t.url && t.title && !t.duplicate_of);
      if (!tracks.length) { empty.hidden = false; return; }
      player.hidden = false;
      grid.hidden = false;
      render();
      load(0, false);
    })
    .catch(() => { empty.hidden = false; });
})();
