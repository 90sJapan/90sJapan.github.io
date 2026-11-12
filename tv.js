/* The broadcast: intro, channels, the clock, the lower band's lines, playlist tabs, the outlook,
   mute and the colour scheme. script.js runs the player and visualizer; this file arranges what they
   draw onto the picture. */
(function () {
  const $ = id => document.getElementById(id);
  const screen = $('screen'), audio = $('audio'), grid = $('trackList');
  const PAGES = [
    { id: 'now', t1: 'Now', t2: 'Playing' },
    { id: 'lists', t1: 'Latest', t2: 'Playlists' },
    { id: 'radar', t1: 'Local', t2: 'Radar' },
    { id: 'outlook', t1: 'Extended', t2: 'Outlook' },
  ];
  const CYCLE_MS = 12000;        // a channel stays up this long while the loop runs by itself
  const IDLE_MS = 90000;         // after a visitor's last touch, the loop picks up again after this
  const LINE_MS = 4000;          // each line in the lower band stays up this long

  /* ---------- clock ---------- */
  function tick() {
    const n = new Date();
    $('wxTime').textContent = n.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    $('wxDate').textContent = n.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
  }

  /* ---------- intro: what this is, what's on, and a way in ---------- */
  let introDone = false;
  function start() {
    if (introDone) return;
    introDone = true;
    screen.dataset.view = 'cast';
    screen.classList.add('is-tuning');
    setTimeout(() => screen.classList.remove('is-tuning'), 800);
  }
  // the forecast: how much music there is, and which song Start will play
  function forecast() {
    const cs = cells(); if (!cs.length) return;
    const lens = [...grid.querySelectorAll('.track-meta')].map(m => secs(m.textContent));
    const total = lens.reduce((x, y) => x + y, 0), n = grid.querySelectorAll('.track').length;
    const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
    $('fcOutlook').textContent = n + ' tracks · ' + cs.length + ' playlists · ' + (h ? h + ' hr ' + m + ' min' : m + ' min');
    const t = title.textContent.trim();
    $('fcFirst').textContent = t && t !== '—' ? t : '—';
  }
  $('listenBtn').addEventListener('click', start);   // script.js starts the music on the same click
  $('introSkip').addEventListener('click', start);  // in without sound

  /* ---------- channels ---------- */
  // cell: open the lists channel on this playlist instead of the one that's playing
  function go(id, cut, cell) {
    const p = PAGES.find(x => x.id === id) || PAGES[0];
    screen.dataset.page = p.id;
    $('castT1').textContent = p.t1; $('castT2').textContent = p.t2;
    const el = screen.querySelector('.page[data-page="' + p.id + '"]');
    if (cut && el) { el.classList.remove('is-cut'); void el.offsetWidth; el.classList.add('is-cut'); }
    if (p.id === 'lists') { if (cell === undefined) showCurrentList(); else showCell(cell); }
  }
  function step(d) { const i = PAGES.findIndex(p => p.id === screen.dataset.page); go(PAGES[(i + d + PAGES.length) % PAGES.length].id, true); }

  // the loop: channels change by themselves until the visitor touches something, and pick up again once they've been idle
  let lastTouch = 0, lastCycle = Date.now();
  const touched = () => { lastTouch = Date.now(); };
  setInterval(() => {
    const now = Date.now();
    if (!introDone || now - lastTouch < IDLE_MS || now - lastCycle < CYCLE_MS) return;
    lastCycle = now; step(1);
  }, 1000);
  const pick = fn => () => { start(); touched(); fn(); };
  $('castTitle').addEventListener('click', pick(() => step(1)));
  $('chNext').addEventListener('click', pick(() => step(1)));
  $('chPrev').addEventListener('click', pick(() => step(-1)));
  screen.addEventListener('pointerdown', touched);
  screen.addEventListener('wheel', touched, { passive: true });
  // wherever focus is (only text fields keep their keys): space plays / pauses, the arrows seek 5 s, and 0-9 jump
  // to that tenth of the song, so 0 is the start and 9 is one tenth before the end
  const SEEK_S = 5;
  const seekTo = s => { const d = audio.duration; if (audio.src && isFinite(d) && d > 0) audio.currentTime = Math.max(0, Math.min(d, s(d))); };
  document.addEventListener('keydown', e => {
    touched();
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') {
      e.preventDefault();                       // a focused button would otherwise be clicked as well
      if (!e.repeat) { start(); $('playBtn').click(); }
    } else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      seekTo(() => audio.currentTime + (k === 'ArrowRight' ? SEEK_S : -SEEK_S));
    } else if (k.length === 1 && k >= '0' && k <= '9') {
      e.preventDefault();
      seekTo(d => d * +k / 10);
    }
  });
  document.addEventListener('keyup', e => {      // Firefox presses a focused button on space's key-up
    if ((e.key === ' ' || e.key === 'Spacebar') && e.target.tagName === 'BUTTON') e.preventDefault();
  });

  /* ---------- mute (the intro's corner button and the band's square stay in step) ---------- */
  const muteBtns = document.querySelectorAll('.mute-btn');
  function syncMute() { muteBtns.forEach(b => { b.setAttribute('aria-pressed', audio.muted ? 'true' : 'false'); b.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute'); }); }
  muteBtns.forEach(b => b.addEventListener('click', () => { audio.muted = !audio.muted; syncMute(); }));
  audio.addEventListener('volumechange', syncMute);

  /* ---------- colour scheme: the gear on the intro ---------- */
  const THEMES = [{ id: 'classic', name: 'Classic' }, { id: 'crimson', name: 'Crimson' }, { id: 'teal', name: 'Teal' }];
  const root = document.documentElement;
  const themeNow = () => THEMES.find(t => t.id === (root.dataset.theme || 'classic')) || THEMES[0];
  function showTheme() { document.querySelectorAll('.theme-name').forEach(el => { el.textContent = themeNow().name; }); }
  document.querySelectorAll('.theme-btn').forEach(b => b.addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(themeNow()) + 1) % THEMES.length].id;
    if (next === 'classic') delete root.dataset.theme; else root.dataset.theme = next;   // script.js recolours the visualizer on this change
    try { localStorage.setItem('crmsn-theme', next); } catch (e) {}
    showTheme();
  }));

  /* ---------- playlists: one list on the panel at a time, picked with tabs ---------- */
  const tabs = $('listTabs');
  let activeCell = 0;
  const cells = () => [...grid.querySelectorAll('.discog-cell')];
  function cellLabel(cell) {
    const h = cell.querySelector('.track-group-name'), tag = cell.querySelector('.track-vis');
    const name = h ? [...h.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : 'Tracks';
    return { name: name || 'Tracks', vis: tag ? tag.textContent : '' };
  }
  function showCell(i) {
    const cs = cells(); if (!cs.length) return;
    activeCell = Math.max(0, Math.min(cs.length - 1, i));
    cs.forEach((c, j) => c.classList.toggle('is-active', j === activeCell));
    tabs.querySelectorAll('.list-tab').forEach((t, j) => t.setAttribute('aria-selected', j === activeCell ? 'true' : 'false'));
  }
  function currentCell() {
    const li = grid.querySelector('.track.is-current');
    return li ? cells().indexOf(li.closest('.discog-cell')) : -1;
  }
  function showCurrentList() {
    const i = currentCell();
    if (i < 0) return;
    showCell(i);
    const li = grid.querySelector('.track.is-current'), ol = li.parentElement;
    requestAnimationFrame(() => { ol.scrollTop = li.offsetTop - (ol.clientHeight - li.offsetHeight) / 2; });
  }
  function buildTabs() {
    tabs.innerHTML = '';
    cells().forEach((c, i) => {
      const { name, vis } = cellLabel(c);
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'list-tab'; t.setAttribute('role', 'tab');
      t.textContent = name + (vis ? ' · ' + vis : '');
      t.addEventListener('click', () => showCell(i));
      tabs.appendChild(t);
    });
    showCell(Math.min(activeCell, cells().length - 1));
    buildOutlook();
    forecast();
  }
  new MutationObserver(buildTabs).observe(grid, { childList: true });

  /* ---------- outlook: one forecast column per playlist ---------- */
  const outlook = $('outlook');
  const secs = s => { const m = /(\d+):(\d\d)\s*$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function buildOutlook() {
    outlook.innerHTML = '';
    cells().forEach((c, i) => {
      const { name, vis } = cellLabel(c);
      const lens = [...c.querySelectorAll('.track-meta')].map(m => secs(m.textContent)).filter(Boolean);
      const n = c.querySelectorAll('.track').length;
      const total = lens.reduce((a, b) => a + b, 0);
      const d = document.createElement('button');
      d.type = 'button'; d.className = 'panel day'; d.title = 'Open this playlist';
      // the "weather icon": bars from this list's first track lengths, so every list looks a little different
      const bars = lens.slice(0, 7), mx = Math.max(1, ...bars);
      d.innerHTML = '<span class="day-name"></span><span class="day-vis day-kind"></span>' +
        '<span class="day-icon">' + bars.map(l => '<i style="height:' + Math.round(20 + 80 * l / mx) + '%"></i>').join('') + '</span>' +
        '<span class="day-count">' + n + (n === 1 ? ' track' : ' tracks') + '</span>' +
        '<span class="day-hilo"><span class="lo">Lo<b>' + (lens.length ? fmt(Math.min(...lens)) : '–') + '</b></span>' +
        '<span class="hi">Hi<b>' + (lens.length ? fmt(Math.max(...lens)) : '–') + '</b></span></span>' +
        '<span class="day-vis">' + (total ? Math.round(total / 60) + ' min total' : '') + '</span>';
      d.querySelector('.day-name').textContent = name;
      d.querySelector('.day-kind').textContent = vis || 'playlist';
      d.addEventListener('click', () => { touched(); go('lists', true, i); });
      outlook.appendChild(d);
    });
    markCurrent();
  }

  /* ---------- now playing details ---------- */
  const title = $('playerTitle');
  function markCurrent() {
    const i = currentCell();
    tabs.querySelectorAll('.list-tab').forEach((t, j) => t.classList.toggle('has-current', j === i));
    outlook.querySelectorAll('.day').forEach((d, j) => d.classList.toggle('has-current', j === i));
    if (i < 0) return;
    const cell = cells()[i], { name, vis } = cellLabel(cell);
    $('nowList').textContent = name + (vis ? ' · ' + vis : '');
    const rows = [...cell.querySelectorAll('.track')], li = cell.querySelector('.track.is-current');
    $('nowNum').textContent = (rows.indexOf(li) + 1) + ' of ' + rows.length;
    if (screen.dataset.page !== 'lists') showCell(i);   // the lists channel opens on whatever is playing
  }
  function sync() {
    const file = $('playerFile').textContent, ext = (file.split('.').pop() || '').toUpperCase();
    forecast();
    $('nowFmt').textContent = file ? ext + (['WAV', 'AIF', 'AIFF', 'FLAC'].includes(ext) ? ' · lossless' : '') : '—';
    markCurrent();
  }
  new MutationObserver(sync).observe(title, { childList: true, characterData: true, subtree: true });
  new MutationObserver(markCurrent).observe(grid, { attributes: true, attributeFilter: ['class'], subtree: true });

  /* ---------- the lower band: one line at a time, like "conditions at..." ---------- */
  const band = $('bandText');
  let lineIx = 0;
  function lines() {
    const t = title.textContent.trim(), has = t && t !== '—';
    const out = [has ? 'Now playing: ' + t : 'CRMSN Local Music Forecast'];
    if (has) {
      out.push('Playlist: ' + $('nowList').textContent);
      out.push('Length: ' + $('timeDur').textContent + '   Format: ' + $('nowFmt').textContent);
    }
    out.push('Full-quality files, straight from the studio');
    if (!has) out.push('Press play to tune in');
    return out;
  }
  function nextLine() {
    const ls = lines(); lineIx = (lineIx + 1) % ls.length;
    band.textContent = ls[lineIx];
    band.classList.remove('is-new'); void band.offsetWidth; band.classList.add('is-new');
  }
  setInterval(nextLine, LINE_MS);
  // a new song jumps straight to its "now playing" line
  new MutationObserver(() => { lineIx = -1; nextLine(); }).observe(title, { childList: true, characterData: true, subtree: true });

  /* ---------- the intro's sky: flying through clouds, drawn live with WebGL ----------
     A camera glides forward at cloud height: puffs drift past at eye level, a cloud sea lies below.
     Drawn small and scaled up (it suits the tape's softness and keeps the GPU cool); colours come from
     the scheme's --sky-* and --cloud tokens. Without WebGL the painted CSS clouds stay instead. */
  (function cloudFlight() {
    const sky = document.querySelector('.sky');
    const cv = document.createElement('canvas'); cv.className = 'sky-gl';
    const gl = cv.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) return;
    const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
    const FS = `precision mediump float;
      uniform vec2 R; uniform float T; uniform vec3 cTop, cHor, cLit, cShade;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){
        vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * noise(p); p = p * 2.07 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
      float dens(vec3 p){
        float n = fbm(p * vec3(0.24, 0.42, 0.24));
        float sea = smoothstep(-0.9, -2.6, p.y);                 // a cloud deck below, its top around y = -1
        float puffs = smoothstep(0.9, 0.0, abs(p.y - 0.35));       // a few loose clouds at eye level
        return clamp((n - 0.66 + 0.5 * sea + 0.13 * puffs) * 4.0, 0.0, 1.0);
      }
      void main(){
        vec2 uv = (gl_FragCoord.xy - 0.5 * R) / R.y;
        float bank = sin(T * 0.07) * 0.05;                         // a slow, gentle bank
        uv = mat2(cos(bank), -sin(bank), sin(bank), cos(bank)) * uv;
        vec3 ro = vec3(sin(T * 0.05) * 1.5, 0.15 + sin(T * 0.09) * 0.12, T * 1.1);
        vec3 rd = normalize(vec3(uv.x, uv.y - 0.1, 1.3));
        vec3 sky = mix(cHor, cTop, pow(smoothstep(-0.12, 0.6, rd.y), 0.8));
        vec3 shade = mix(cShade, cTop, 0.5);
        vec3 col = vec3(0.0); float a = 0.0, t = 0.4;
        for (int i = 0; i < 48; i++){
          vec3 p = ro + rd * t;
          float d = dens(p);
          if (d > 0.01){
            float lit = clamp(0.22 + 2.6 * (d - dens(p + vec3(-0.3, 0.45, 0.0))), 0.0, 1.0);   // light from above-left
            lit = mix(lit, 1.0, smoothstep(-1.4, 0.8, p.y) * 0.3);  // higher cloud catches more light
            vec3 c = mix(shade, cLit, lit);
            c = mix(c, sky, 1.0 - exp(-0.0016 * t * t));          // distance haze
            float aa = d * 0.42 * (1.0 - a);
            col += c * aa; a += aa;
            if (a > 0.98) break;
          }
          t += 0.18 + t * 0.05;
          if (t > 40.0) break;
        }
        gl_FragColor = vec4(col + sky * (1.0 - a), 1.0);
      }`;
    const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);
    const uR = U('R'), uT = U('T'), uTop = U('cTop'), uHor = U('cHor'), uLit = U('cLit'), uShade = U('cShade');

    // scheme colours, read from the CSS tokens (the canvas 2D context normalises any CSS colour)
    const probe = document.createElement('canvas').getContext('2d');
    const rgb = v => { probe.fillStyle = '#000'; probe.fillStyle = v.trim() || '#000'; const h = probe.fillStyle;
      return h[0] === '#' ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) : (h.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(x => x / 255); };
    function colours() {
      const cs = getComputedStyle(sky);
      gl.uniform3fv(uTop, rgb(cs.getPropertyValue('--sky-1')));
      gl.uniform3fv(uHor, rgb(cs.getPropertyValue('--sky-3')));
      gl.uniform3fv(uLit, rgb(cs.getPropertyValue('--cloud')));
      gl.uniform3fv(uShade, rgb(cs.getPropertyValue('--sky-2')));
    }
    function size() {
      const r = sky.getBoundingClientRect();
      const w = Math.max(160, Math.min(480, Math.round(r.width / 2.2)));    // low-res on purpose
      cv.width = w; cv.height = Math.max(90, Math.round(w * r.height / Math.max(1, r.width)));
      gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(uR, cv.width, cv.height);
    }
    sky.prepend(cv); sky.classList.add('has-gl');
    size(); colours();
    new ResizeObserver(size).observe(sky);
    new MutationObserver(colours).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now(); let last = 0;
    function frame(now) {
      if (screen.dataset.view !== 'intro') return;            // the intro is gone: stop drawing for good
      if (now - last >= 33) {                                 // about 30 fps is plenty for tape
        last = now;
        gl.uniform1f(uT, 20 + (now - t0) / 1000);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!still) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();

  go('now'); syncMute(); showTheme(); tick();
  setInterval(tick, 1000);
  // script.js may have loaded the tracks before this file ran: catch up on anything already there
  if (grid.children.length) buildTabs();
  sync();
})();
