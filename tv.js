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
    intro();
  }

  /* ---------- intro: a dial counting down to the next minute ending in 8 ---------- */
  const ticks = $('dialTicks'), nums = $('dialNums'), needle = $('dialNeedle'), beam = $('beam'), count = $('introCount');
  const NS = 'http://www.w3.org/2000/svg';
  for (let m = 0; m < 60; m++) {                   // 60 minute ticks; the ones ending in 8 are major and numbered
    const a = m / 60 * Math.PI * 2, major = m % 10 === 8, r0 = major ? 38 : 41;
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', Math.sin(a) * r0); l.setAttribute('y1', -Math.cos(a) * r0);
    l.setAttribute('x2', Math.sin(a) * 44); l.setAttribute('y2', -Math.cos(a) * 44);
    if (major) l.setAttribute('class', 'major');
    ticks.appendChild(l);
    if (major) {
      const s = document.createElement('span'); s.textContent = m; s.dataset.m = m;
      s.style.left = (50 + Math.sin(a) * 44) + '%'; s.style.top = (50 - Math.cos(a) * 44) + '%';
      nums.appendChild(s);
    }
  }
  let introDone = false;
  function intro() {
    if (introDone) return;
    const n = new Date(), secIntoHour = n.getMinutes() * 60 + n.getSeconds() + n.getMilliseconds() / 1000;
    const minute = n.getMinutes();
    let nextM = minute - (minute % 10) + 8; if (nextM <= minute) nextM += 10;    // the next hh:x8:00
    const left = Math.max(0, Math.round(nextM * 60 - secIntoHour));
    const prevM = nextM - 10;
    needle.setAttribute('transform', 'rotate(' + (secIntoHour / 3600 * 360).toFixed(2) + ')');
    beam.style.setProperty('--from', (prevM / 60 * 360) + 'deg');
    beam.style.setProperty('--span', Math.max(0.5, (secIntoHour - prevM * 60) / 3600 * 360).toFixed(2) + 'deg');
    nums.querySelectorAll('span').forEach(s => s.classList.toggle('is-next', +s.dataset.m === nextM % 60));
    const mm = Math.floor(left / 60), ss = left % 60;
    count.innerHTML = 'The broadcast begins<br>in ' + (mm ? mm + ' min and ' : '') + ss + ' sec';
    if (left === 0) start();                       // on the 8s it tunes in by itself (no sound until a button is pressed)
  }
  function start() {
    if (introDone) return;
    introDone = true;
    screen.dataset.view = 'cast';
    screen.classList.add('is-tuning');
    setTimeout(() => screen.classList.remove('is-tuning'), 800);
  }
  $('listenBtn').addEventListener('click', start);   // script.js starts the music on the same click
  $('introSkip').addEventListener('click', start);

  /* ---------- channels ---------- */
  function go(id, cut) {
    const p = PAGES.find(x => x.id === id) || PAGES[0];
    screen.dataset.page = p.id;
    $('castT1').textContent = p.t1; $('castT2').textContent = p.t2;
    const el = screen.querySelector('.page[data-page="' + p.id + '"]');
    if (cut && el) { el.classList.remove('is-cut'); void el.offsetWidth; el.classList.add('is-cut'); }
    if (p.id === 'lists') showCurrentList();
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
  document.addEventListener('keydown', e => {
    touched();
    if (e.target !== document.body || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '4') { start(); go(PAGES[+k - 1].id, true); }
    else if (k === 'ArrowRight' || k === 'ArrowLeft') { start(); step(k === 'ArrowRight' ? 1 : -1); }
    else if (k === ' ') { e.preventDefault(); $('playBtn').click(); }
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
      d.addEventListener('click', () => { touched(); showCell(i); go('lists', true); });
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
    if (!has) out.push(introDone ? 'Press play to tune in' : 'Press start to tune in');
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

  go('now'); syncMute(); showTheme(); tick();
  setInterval(tick, 1000);
  // script.js may have loaded the tracks before this file ran: catch up on anything already there
  if (grid.children.length) buildTabs();
  sync();
})();
