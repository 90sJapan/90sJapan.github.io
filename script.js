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
   frames and smoothing so the motion stays fluid. Bars & Waves and Scope draw on the screen
   inside the player; Ambience and Spikes draw on a full-page canvas behind everything. The same
   file's level track also gives the SoundCloud-style waveform that doubles as the seek bar.
   Colours come from the active theme's --viz-* tokens, shifted along the palette by the tone
   (spectral centroid) of the music — or, with Pastel RGB on, from a slowly cycling pastel hue. */
const viz = (function () {
  const stage = document.querySelector('.viz-stage');
  const wrap = document.querySelector('.player-viz');
  const modesEl = document.getElementById('vizModes');
  const hint = document.getElementById('vizHint');
  const MODES = [
    { id: 'bars', name: 'Bars & Waves' },
    { id: 'scope', name: 'Scope' },
    { id: 'ambience', name: 'Ambience', bg: true },
    { id: 'spikes', name: 'Spikes', bg: true },
  ];
  const isBg = id => !!MODES.find(m => m.id === id).bg;
  // two drawing targets: the screen in the player, and the fixed canvas behind the page
  const targets = {
    stage: { canvas: document.getElementById('viz'), W: 0, H: 0 },
    bg: { canvas: document.getElementById('vizBg'), W: 0, H: 0 },
  };
  for (const k in targets) targets[k].ctx = targets[k].canvas.getContext('2d');
  let ctx = targets.stage.ctx, W = 0, H = 0, onBg = false;

  const N = 24;                                   // bands drawn (matches the analysis)
  const cur = new Float32Array(N), peak = new Float32Array(N), peakV = new Float32Array(N);
  const wavePts = new Float32Array(128);
  let mode = 'bars', rgb = false, power = true;
  try {
    const m = localStorage.getItem('crmsn-viz'); if (MODES.some(x => x.id === m)) mode = m;
    rgb = localStorage.getItem('crmsn-viz-rgb') === '1';
    power = localStorage.getItem('crmsn-viz-power') !== '0';
  } catch (e) {}
  let audio = null, data = null, fetchCtl = null;
  const cache = new Map();
  let tone = 0.35, level = 0, energy = 0, clock = 0, spin = 0;
  let raf = 0, last = 0, inView = true;
  let colors = null;

  // ---- colours from the theme
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  function parseColor(s) {
    const c = targets.stage.ctx;
    c.fillStyle = '#000'; c.fillStyle = s.trim();
    const v = c.fillStyle;                         // canvas normalises to #rrggbb for opaque colours
    if (v[0] === '#') return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    const m = v.match(/[\d.]+/g) || [0, 0, 0]; return [+m[0], +m[1], +m[2]];
  }
  function readColors() {
    const cs = getComputedStyle(targets.stage.canvas);
    const get = (n, fb) => parseColor(cs.getPropertyValue(n) || fb);
    colors = { stops: [get('--viz-a', '#8b5cff'), get('--viz-b', '#ff3ea5'), get('--viz-c', '#35e6ff')],
               hot: get('--viz-hot', '#ffffff'), bg: get('--viz-bg', '#05050b') };
  }
  const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  function hsl(h, s, l) {                          // h in degrees -> [r,g,b]
    h = ((h % 360) + 360) % 360 / 60;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function grad(u) {                               // position along the palette, 0..1
    u = clamp(u, 0, 1);
    if (rgb) return light() ? hsl(clock * 45 + u * 150, 0.8, 0.6) : hsl(clock * 45 + u * 150, 0.72, 0.72);   // pastel hues flowing round the wheel (a shade deeper on the light theme)
    u *= 2; const s = colors.stops;
    return u < 1 ? mix(s[0], s[1], u) : mix(s[1], s[2], u - 1);
  }
  const hot = () => rgb ? hsl(clock * 45 + 200, 0.6, 0.9) : colors.hot;
  const light = () => root.dataset.theme === 'y2k';
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
  let track = null;
  function setTrack(t) {
    if (fetchCtl) fetchCtl.abort();
    data = null; track = t; hint.hidden = true;
    buildWave(); drawWaveform();
    if (!t) return;
    const key = t.file;
    if (cache.has(key)) { data = cache.get(key); if (!data) hint.hidden = false; buildWave(); drawWaveform(); return; }
    fetchCtl = new AbortController();
    fetch('viz/' + encodeURIComponent(key) + '.bin', { signal: fetchCtl.signal })
      .then(r => r.ok ? r.arrayBuffer() : null)
      .then(buf => {
        const d = buf ? parse(buf) : null;
        cache.set(key, d);
        if (audio && (audio.dataset.file === key)) { data = d; hint.hidden = !!d; buildWave(); drawWaveform(); kick(); }
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
  function fade(alpha) {                           // settle the previous frame: paint the screen colour,
    if (onBg) {                                    // or on the page canvas just thin out what's there
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(colors.bg, alpha); ctx.fillRect(0, 0, W, H);
    }
  }
  function clear(t) {
    if (t === targets.bg) t.ctx.clearRect(0, 0, t.W, t.H);
    else { t.ctx.globalCompositeOperation = 'source-over'; t.ctx.fillStyle = rgba(colors.bg, 1); t.ctx.fillRect(0, 0, t.W, t.H); }
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
    fade(1);
    const gap = Math.max(2, W / N * 0.22), bw = (W - gap * (N + 1)) / N, base = H - 6, maxH = H * 0.86;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const x = gap + i * (bw + gap), h = Math.max(2, cur[i] * maxH);
      const c = grad(tone * 0.55 + (i / (N - 1)) * 0.45);
      const g = ctx.createLinearGradient(0, base, 0, base - maxH);
      g.addColorStop(0, rgba(mix(c, colors.bg, 0.45), 0.9)); g.addColorStop(0.55, rgba(c, 0.95)); g.addColorStop(1, rgba(hot(), 0.9));
      ctx.fillStyle = g; ctx.fillRect(x, base - h, bw, h);
      const ph = peak[i] * maxH;
      if (ph > 3) { ctx.fillStyle = rgba(hot(), 0.5 + 0.5 * peak[i]); ctx.fillRect(x, base - ph - 3, bw, 2.5); }
    }
    ctx.shadowColor = rgba(grad(tone), 0.9); ctx.shadowBlur = 14;
    drawWave(2, 0.85, 0.32);
    ctx.shadowBlur = 0;
  }
  function drawScope() {
    fade(0.28);                                     // faint trails
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(grad(tone), 0.18); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H * 0.5); ctx.lineTo(W, H * 0.5); ctx.stroke();
    ctx.shadowColor = rgba(grad(tone), 1); ctx.shadowBlur = 22;
    drawWave(7, 0.22, 0.42);
    drawWave(3, 0.95, 0.42);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(hot(), 0.55); drawWave(1, 0.55, 0.42);
  }
  function drawAmbience() {
    fade(onBg ? 0.16 : 0.11);
    const k = onBg ? 0.34 : 1;                   // gentler behind the page so text stays readable
    ctx.globalCompositeOperation = onBg ? 'source-over' : 'lighter';
    const R = Math.max(W, H) * (onBg ? 0.34 : 0.6);   // smaller orbs behind the page so several fit on screen
    for (let k = 0; k < 5; k++) {
      let g = 0; for (let i = k * 5; i < k * 5 + 5 && i < N; i++) g += cur[i]; g /= 5;
      const t = clock * (0.10 + k * 0.035), ph = k * 1.7;
      const x = W * (0.5 + 0.38 * Math.sin(t + ph)), y = H * (0.5 + 0.36 * Math.cos(t * 1.3 + ph * 0.6));
      const r = R * (0.16 + 0.34 * g + 0.08 * level);
      const c = grad(tone + (k - 2) * 0.11);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(mix(c, hot(), 0.35), (0.26 + 0.5 * g) * k)); rg.addColorStop(0.5, rgba(c, (0.16 + 0.25 * g) * k)); rg.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    }
  }
  function drawSpikes() {
    fade(0.35);
    const k = onBg ? 0.34 : 1;
    ctx.globalCompositeOperation = onBg ? 'source-over' : 'lighter';
    // behind the page the whole ring (core + longest spike) is kept inside the viewport
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * (onBg ? 0.56 : 1), r0 = R * (0.19 + 0.07 * level), len = R * 0.5;
    const M = N * 2;
    for (let k = 0; k < M; k++) {
      const i = k < N ? k : M - 1 - k;              // mirrored so the ring is symmetric
      const a = spin + k / M * 6.2832, h = r0 + cur[i] * len, w = 0.55 * (6.2832 / M);
      const c = grad(tone * 0.6 + (i / (N - 1)) * 0.4);
      ctx.fillStyle = rgba(c, (0.35 + 0.6 * cur[i]) * k);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - w) * r0, cy + Math.sin(a - w) * r0);
      ctx.lineTo(cx + Math.cos(a) * h, cy + Math.sin(a) * h);
      ctx.lineTo(cx + Math.cos(a + w) * r0, cy + Math.sin(a + w) * r0);
      ctx.closePath(); ctx.fill();
      const p = r0 + peak[i] * len;
      ctx.fillStyle = rgba(hot(), 0.6 * peak[i] * k); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * p, cy + Math.sin(a) * p, R * 0.006, 0, 6.2832); ctx.fill();
    }
    drawSphere(cx, cy, r0);
  }
  function drawSphere(cx, cy, r) {                 // the core: a lit sphere with a halo, kept vivid on the page too
    const c = grad(tone), A = onBg ? 0.82 + 0.15 * level : 0.9 + 0.1 * level;
    ctx.globalCompositeOperation = 'source-over';
    const halo = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.6);
    halo.addColorStop(0, rgba(c, 0.45 * A)); halo.addColorStop(0.35, rgba(c, 0.14 * A)); halo.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, 6.2832); ctx.fill();
    const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.38, r * 0.05, cx, cy, r * 1.05);
    body.addColorStop(0, rgba(mix(c, hot(), 0.8), A));
    body.addColorStop(0.3, rgba(mix(c, hot(), 0.3), A));
    body.addColorStop(0.75, rgba(c, A));
    body.addColorStop(1, rgba(mix(c, [0, 0, 0], 0.55), A));
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
    const rim = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r);   // bright limb so the edge reads as a ball
    rim.addColorStop(0, rgba(hot(), 0)); rim.addColorStop(0.85, rgba(hot(), 0.12 * A)); rim.addColorStop(1, rgba(hot(), 0.5 * A));
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
  }
  const DRAW = { bars: drawBars, scope: drawScope, ambience: drawAmbience, spikes: drawSpikes };

  // ---- waveform seek bar
  // SoundCloud-style: one bar per few frames of the level track, a shorter reflection underneath, played
  // part in the theme palette, unplayed part the same hues dimmed. Click/drag/arrow keys seek.
  const wave = { canvas: document.getElementById('wave'), W: 0, H: 0, bars: null, hover: -1, scrub: -1 };
  wave.ctx = wave.canvas.getContext('2d');
  const BAR = 2, PITCH = 3;                        // bar width and spacing in css px
  let onScrub = () => {};
  const waveDur = () => audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (track && track.duration) || 0;
  function buildWave() {
    const n = Math.max(1, Math.floor((wave.W + PITCH - BAR) / PITCH));
    const out = new Float32Array(n);
    if (!data) { out.fill(0.2); wave.bars = out; return; }   // no analysis: a flat strip that still seeks
    const fr = data.frames, s = data.stride, L = data.bands + 1, per = data.n / n;
    let mx = 0.001;
    for (let i = 0; i < n; i++) {
      let lv;
      if (per >= 1) {                              // several frames per bar: keep the loudest
        const a = Math.floor(i * per), b = Math.min(data.n, Math.max(a + 1, Math.floor((i + 1) * per)));
        lv = 0; for (let f = a; f < b; f++) if (fr[f * s + L] > lv) lv = fr[f * s + L];
      } else {                                     // short track: interpolate between frames
        const x = (i + 0.5) * per, f0 = clamp(Math.floor(x), 0, data.n - 1), f1 = Math.min(f0 + 1, data.n - 1), a = x - f0;
        lv = fr[f0 * s + L] + (fr[f1 * s + L] - fr[f0 * s + L]) * a;
      }
      // level is dB below the track's loud point, over 50 dB; back to amplitude, softened so verses still show
      out[i] = Math.pow(10, -1.5 * (1 - lv / 255));
      if (out[i] > mx) mx = out[i];
    }
    for (let i = 0; i < n; i++) out[i] /= mx;
    wave.bars = out;
  }
  function drawWaveform() {
    const c = wave.ctx, W = wave.W, H = wave.H;
    if (!W || !wave.bars) return;
    c.clearRect(0, 0, W, H);
    const dur = waveDur(), pos = wave.scrub >= 0 ? wave.scrub : dur && audio ? clamp(audio.currentTime / dur, 0, 1) : 0;
    const top = Math.round(H * 0.66), refl = H - top - 2;   // upper bars, 2px gap, the reflection
    const px = pos * W, hx = wave.hover >= 0 ? wave.hover * W : -1;
    const lo = Math.min(px, hx), hi = Math.max(px, hx), lt = light();
    const n = wave.bars.length;
    for (let i = 0; i < n; i++) {
      const x = i * PITCH, cx = x + BAR / 2, h = Math.max(1.5, wave.bars[i] * (top - 2));
      const col = grad(cx / W);
      let a, b;                                    // alpha of the bar and its reflection
      let fill = col;
      if (cx <= px) { a = 1; b = 0.42; }
      else if (hx >= 0 && cx > lo && cx <= hi) { a = 0.62; b = 0.26; }
      else { fill = lt ? mix(col, [122, 130, 152], 0.55) : mix(col, colors.bg, 0.52); a = lt ? 0.9 : 0.85; b = lt ? 0.42 : 0.36; }   // unplayed: same hue, greyed
      c.fillStyle = rgba(fill, a); c.fillRect(x, top - h, BAR, h);
      c.fillStyle = rgba(fill, b); c.fillRect(x, top + 2, BAR, h * refl / top);
    }
    if (dur) {                                     // playhead
      const ph = lt ? [18, 18, 42] : hot(), x = Math.min(W - 1, Math.round(px));
      c.fillStyle = rgba(ph, 0.25); c.fillRect(x - 1, 0, 3, H);
      c.fillStyle = rgba(ph, 0.95); c.fillRect(x, 0, 1, H);
    }
  }
  function resizeWave() {
    const r = wave.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    wave.W = Math.max(1, Math.round(r.width)); wave.H = Math.max(1, Math.round(r.height));
    wave.canvas.width = Math.round(wave.W * dpr); wave.canvas.height = Math.round(wave.H * dpr);
    wave.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildWave(); drawWaveform();
  }
  new ResizeObserver(resizeWave).observe(wave.canvas);
  {
    const el = wave.canvas;
    const at = e => clamp((e.clientX - el.getBoundingClientRect().left) / wave.W, 0, 1);
    const scrubTo = f => { wave.scrub = f; onScrub(f * waveDur()); drawWaveform(); };
    el.addEventListener('pointerdown', e => { if (!waveDur()) return; el.setPointerCapture(e.pointerId); scrubTo(at(e)); });
    el.addEventListener('pointermove', e => {
      if (wave.scrub >= 0) scrubTo(at(e));
      else if (e.pointerType === 'mouse') { wave.hover = at(e); drawWaveform(); }
    });
    el.addEventListener('pointerup', () => {
      if (wave.scrub < 0) return;
      const f = wave.scrub; wave.scrub = -1;
      if (audio && waveDur()) audio.currentTime = f * waveDur();
      onScrub(null); drawWaveform();
    });
    el.addEventListener('pointercancel', () => { if (wave.scrub < 0) return; wave.scrub = -1; onScrub(null); drawWaveform(); });   // the page scrolled instead
    el.addEventListener('pointerleave', () => { wave.hover = -1; drawWaveform(); });
    el.addEventListener('keydown', e => {
      const d = waveDur(); if (!audio || !d) return;
      const jump = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }[e.key];
      if (jump !== undefined) audio.currentTime = clamp(audio.currentTime + jump, 0, d);
      else if (e.key === 'Home') audio.currentTime = 0;
      else if (e.key === 'End') audio.currentTime = d;
      else return;
      e.preventDefault(); drawWaveform();
    });
  }

  // ---- loop
  function frame(now) {
    raf = 0;
    const dt = last ? clamp((now - last) / 1000, 0.001, 0.05) : 0.016; last = now;
    onBg = isBg(mode);
    const T = onBg ? targets.bg : targets.stage;
    ctx = T.ctx; W = T.W; H = T.H;
    const playing = audio && !audio.paused && !audio.ended;
    if (!power) {                                 // switched off: only the waveform's playhead keeps moving
      drawWaveform();
      if (playing || rgb) raf = requestAnimationFrame(frame); else last = 0;
      return;
    }
    step(dt); DRAW[mode](); drawWaveform();
    if ((onBg || inView) && (playing || energy > 0.003 || mode === 'ambience' || rgb)) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function kick() { if (!raf && (!power || isBg(mode) || inView)) raf = requestAnimationFrame(frame); }

  function size(t, w, h, maxDpr) {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    t.W = Math.max(1, Math.round(w)); t.H = Math.max(1, Math.round(h));
    t.canvas.width = Math.round(t.W * dpr); t.canvas.height = Math.round(t.H * dpr);
    t.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clear(t); kick();
  }
  function resizeStage() { const r = stage.getBoundingClientRect(); size(targets.stage, r.width, r.height, 2); }
  function resizeBg() { size(targets.bg, window.innerWidth, window.innerHeight, 1.5); }
  new ResizeObserver(resizeStage).observe(stage);
  window.addEventListener('resize', resizeBg);
  new IntersectionObserver(es => { inView = es[0].isIntersecting; kick(); }).observe(stage);
  new MutationObserver(() => { readColors(); clear(targets.stage); drawWaveform(); kick(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  function setMode(id) {
    mode = id;
    try { localStorage.setItem('crmsn-viz', id); } catch (e) {}
    modesEl.querySelectorAll('.viz-mode').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === id ? 'true' : 'false'));
    wrap.classList.toggle('is-bg', isBg(id));     // the player's screen folds away while the page is the canvas
    clear(targets.stage); clear(targets.bg); kick();
  }
  // the light switch: off stops the analysis and drawing, folds the screen away and greys out the style buttons
  function setPower(on) {
    power = on;
    try { localStorage.setItem('crmsn-viz-power', on ? '1' : '0'); } catch (e) {}
    powerBtn.setAttribute('aria-checked', on ? 'true' : 'false');
    wrap.classList.toggle('is-off', !on);
    modesEl.querySelectorAll('.viz-mode, .viz-rgb').forEach(b => { b.disabled = !on; });
    if (!on) { cur.fill(0); peak.fill(0); tgt.fill(0); level = energy = 0; }
    clear(targets.stage); clear(targets.bg); kick();
  }
  let clickCtx = null;
  function clickSound(on) {                       // a short mechanical snap, brighter going on than off
    try {
      const ac = clickCtx || (clickCtx = new (window.AudioContext || window.webkitAudioContext)());
      if (ac.state === 'suspended') ac.resume();
      const n = Math.round(ac.sampleRate * 0.035), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = on ? 2600 : 1700; bp.Q.value = 1.2; g.gain.value = 0.35;
      src.connect(bp).connect(g).connect(ac.destination); src.start();
    } catch (e) {}
  }
  function setRgb(on) {
    rgb = on;
    try { localStorage.setItem('crmsn-viz-rgb', on ? '1' : '0'); } catch (e) {}
    rgbBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    drawWaveform(); kick();
  }
  MODES.forEach(m => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'viz-mode'; b.dataset.mode = m.id; b.textContent = m.name;
    b.addEventListener('click', () => setMode(m.id));
    modesEl.appendChild(b);
  });
  const rgbBtn = document.createElement('button');
  rgbBtn.type = 'button'; rgbBtn.className = 'viz-rgb'; rgbBtn.title = 'Fade through soft rainbow colours instead of the theme palette';
  rgbBtn.innerHTML = '<i aria-hidden="true"></i>Pastel RGB';
  rgbBtn.addEventListener('click', () => setRgb(!rgb));
  const powerBtn = document.createElement('button');
  powerBtn.type = 'button'; powerBtn.className = 'viz-power'; powerBtn.setAttribute('role', 'switch');
  powerBtn.setAttribute('aria-label', 'Visualizer'); powerBtn.title = 'Visualizer on / off';
  powerBtn.innerHTML = '<span class="switch-plate" aria-hidden="true"><i class="switch-screw"></i><i class="switch-screw"></i>' +
    '<span class="switch-well"><span class="switch-lever"></span></span></span>';
  powerBtn.addEventListener('click', () => { clickSound(!power); setPower(!power); });
  modesEl.appendChild(powerBtn);
  modesEl.appendChild(rgbBtn);
  targets.stage.canvas.addEventListener('click', () => setMode(MODES[(MODES.findIndex(m => m.id === mode) + 1) % MODES.length].id));

  readColors(); resizeBg(); setMode(mode); setRgb(rgb); setPower(power);
  return {
    attach(el, scrubCb) {                        // scrubCb(seconds) while the waveform is dragged, scrubCb(null) when released
      audio = el; onScrub = scrubCb || onScrub;
      ['play', 'playing', 'seeked'].forEach(ev => el.addEventListener(ev, kick));
      ['timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'emptied'].forEach(ev => el.addEventListener(ev, drawWaveform));
    },
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
  const waveEl = document.getElementById('wave');
  const titleEl = document.getElementById('playerTitle');
  const curEl = document.getElementById('timeCur');
  const durEl = document.getElementById('timeDur');
  const fileEl = document.getElementById('playerFile');
  const fileY2k = document.getElementById('playerFileY2k');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const scopeSwitch = document.getElementById('scopeSwitch');
  let tracks = [];
  let current = -1;
  let scrubbing = false;
  // shuffle on/off, and whether next/prev/auto-advance roam all playlists or stay in the current song's
  let shuffle = false, scope = 'all';
  try { shuffle = localStorage.getItem('crmsn-shuffle') === '1'; if (localStorage.getItem('crmsn-scope') === 'list') scope = 'list'; } catch (e) {}
  const played = new Set(), history = [];

  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';

  // which playlist a track belongs to follows the folder the file was sorted into
  // (music/<artist>/…private…/, …public…/, bandcamp/), falling back to what SoundCloud reported at match time
  const LIST_ORDER = ['public', 'bandcamp', 'private'];
  function visibility(t) {
    const folder = (t.source || '').split('/').slice(0, -1).join('/').toLowerCase();
    return /bandcamp/.test(folder) ? 'bandcamp' : /private/.test(folder) ? 'private' : /public/.test(folder) ? 'public' : (t.sharing || 'public');
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
    const artists = [...new Set(groups.map(g => g.name))];   // keep artist order; public, then releases, then private
    groups.sort((a, b) => artists.indexOf(a.name) - artists.indexOf(b.name) || LIST_ORDER.indexOf(a.vis) - LIST_ORDER.indexOf(b.vis));
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
      // a release whose tracks all share one album is titled after it
      const albums = new Set(g.items.map(i => tracks[i].album || ''));
      if (albums.size === 1 && !albums.has('')) {
        const album = document.createElement('span'); album.className = 'track-album'; album.textContent = [...albums][0];
        h.appendChild(album);
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

  function load(i, autoplay, back) {
    if (current >= 0 && !back) history.push(current);
    if (history.length > 200) history.shift();
    current = (i + tracks.length) % tracks.length;
    played.add(current);
    audio.src = tracks[current].url;
    audio.dataset.file = tracks[current].file;
    viz.setTrack(tracks[current]);
    titleEl.textContent = tracks[current].title;
    // the original file name stays visible as a small detail for whatever is playing
    const srcName = (tracks[current].source || tracks[current].file).split('/').pop();
    fileEl.textContent = srcName;
    fileY2k.textContent = srcName.replace(/\s+/g, '_');
    curEl.textContent = '0:00'; durEl.textContent = fmt(tracks[current].duration || 0);
    waveEl.setAttribute('aria-valuemax', String(Math.round(tracks[current].duration || 0)));
    waveEl.setAttribute('aria-valuenow', '0'); waveEl.setAttribute('aria-valuetext', '0:00');
    if (autoplay) audio.play().catch(() => {});
    mark(); reveal(current);
  }
  function toggle() { if (current < 0) return load(0, true); audio.paused ? audio.play() : audio.pause(); }

  // ---- what plays next
  const groupOf = i => (tracks[i].artist || '') + '|' + visibility(tracks[i]);
  function pool() {                                 // the indices next/prev may move between
    const all = tracks.map((_, i) => i);
    return scope === 'list' && current >= 0 ? all.filter(i => groupOf(i) === groupOf(current)) : all;
  }
  function step(dir) {
    const cands = pool();
    if (!cands.length) return;
    if (shuffle) {
      if (dir < 0 && history.length) return load(history.pop(), true, true);
      let open = cands.filter(i => i !== current && !played.has(i));
      if (!open.length) { played.clear(); open = cands.filter(i => i !== current); }   // everything heard: start over
      if (!open.length) open = cands;
      return load(open[Math.floor(Math.random() * open.length)], true);
    }
    const pos = cands.indexOf(current);
    load(cands[(pos + dir + cands.length) % cands.length], true);
  }
  function setShuffle(on) {
    shuffle = on; played.clear(); history.length = 0;
    if (current >= 0) played.add(current);
    shuffleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    player.classList.toggle('is-shuffle', on);
    try { localStorage.setItem('crmsn-shuffle', on ? '1' : '0'); } catch (e) {}
  }
  function setScope(v) {
    scope = v; played.clear(); history.length = 0;
    if (current >= 0) played.add(current);
    scopeSwitch.setAttribute('aria-checked', v === 'list' ? 'true' : 'false');
    scopeSwitch.classList.toggle('is-list', v === 'list');
    try { localStorage.setItem('crmsn-scope', v); } catch (e) {}
  }
  shuffleBtn.addEventListener('click', () => setShuffle(!shuffle));
  scopeSwitch.addEventListener('click', () => setScope(scope === 'list' ? 'all' : 'list'));
  setShuffle(shuffle); setScope(scope);

  playBtn.addEventListener('click', toggle);
  document.getElementById('prevBtn').addEventListener('click', () => step(-1));
  document.getElementById('nextBtn').addEventListener('click', () => step(1));
  audio.addEventListener('play', mark);
  audio.addEventListener('pause', mark);
  audio.addEventListener('ended', () => step(1));
  audio.addEventListener('loadedmetadata', () => {
    durEl.textContent = fmt(audio.duration);
    waveEl.setAttribute('aria-valuemax', String(Math.round(audio.duration || 0)));
  });
  audio.addEventListener('timeupdate', () => {
    if (scrubbing) return;
    curEl.textContent = fmt(audio.currentTime);
    waveEl.setAttribute('aria-valuenow', String(Math.round(audio.currentTime)));
    waveEl.setAttribute('aria-valuetext', fmt(audio.currentTime));
  });
  // the waveform is the seek bar; while it's dragged the clock follows the finger, not the audio
  viz.attach(audio, t => { scrubbing = t !== null; curEl.textContent = fmt(t === null ? audio.currentTime : t); });

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
