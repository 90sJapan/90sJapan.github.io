/* CRT broadcast: the intro, channel switching, the clock and crawl, playlist tabs and the outlook.
   script.js runs the player and visualizer; this file only arranges what they draw onto the screen. */
(function () {
  const $ = id => document.getElementById(id);
  const screen = $('screen'), audio = $('audio'), grid = $('trackList'), player = $('player');
  const PAGES = [
    { id: 'now', t1: 'Now', t2: 'Playing' },
    { id: 'lists', t1: 'Latest', t2: 'Playlists' },
    { id: 'radar', t1: 'Local', t2: 'Radar' },
    { id: 'outlook', t1: 'Extended', t2: 'Outlook' },
  ];
  const CYCLE_MS = 12000;

  /* ---------- clock ---------- */
  function tick() {
    const n = new Date();
    $('wxTime').textContent = n.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    $('wxDate').textContent = n.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    intro();
  }

  /* ---------- intro: a dial counting down to the next minute ending in 8 ---------- */
  const ticks = $('dialTicks'), nums = $('dialNums'), needle = $('dialNeedle'), beam = $('beam'), count = $('introCount');
  const NS = 'http://www.w3.org/2000/svg';
  for (let m = 0; m < 60; m++) {                   // 60 minute ticks, the ones ending in 8 are major
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
    // seconds until the next hh:x8:00
    let nextM = minute - (minute % 10) + 8; if (nextM <= minute) nextM += 10;
    const left = Math.max(0, Math.round(nextM * 60 - secIntoHour));
    const prevM = nextM - 10;
    needle.setAttribute('transform', 'rotate(' + (secIntoHour / 3600 * 360).toFixed(2) + ')');
    beam.style.setProperty('--from', (prevM / 60 * 360) + 'deg');
    beam.style.setProperty('--span', Math.max(0.5, (secIntoHour - prevM * 60) / 3600 * 360).toFixed(2) + 'deg');
    nums.querySelectorAll('span').forEach(s => s.classList.toggle('is-next', +s.dataset.m === nextM % 60));
    const mm = Math.floor(left / 60), ss = left % 60;
    count.innerHTML = 'The broadcast begins<br>in ' + (mm ? mm + ' min and ' : '') + ss + ' sec';
    if (left === 0) start();                       // on the 8s: tune in (no sound until a button is pressed)
  }
  function start() {
    if (introDone) return;
    introDone = true;
    screen.dataset.view = 'cast';
    screen.classList.add('is-tuning');
    setTimeout(() => screen.classList.remove('is-tuning'), 500);
    resetCycle();
  }
  $('listenBtn').addEventListener('click', start);   // script.js starts the music on the same click
  $('introSkip').addEventListener('click', start);

  /* ---------- channels ---------- */
  const chBtns = document.querySelectorAll('.ch-btn[data-go]');
  function go(id, cut) {
    const p = PAGES.find(x => x.id === id) || PAGES[0];
    screen.dataset.page = p.id;
    $('castT1').textContent = p.t1; $('castT2').textContent = p.t2;
    chBtns.forEach(b => b.setAttribute('aria-selected', b.dataset.go === p.id ? 'true' : 'false'));
    const el = screen.querySelector('.page[data-page="' + p.id + '"]');
    if (cut && el) { el.classList.remove('is-cut'); void el.offsetWidth; el.classList.add('is-cut'); }
    if (p.id === 'lists') showCurrentList();
  }
  function step(d) { const i = PAGES.findIndex(p => p.id === screen.dataset.page); go(PAGES[(i + d + PAGES.length) % PAGES.length].id, true); }

  // auto: the channels cycle by themselves; picking a channel or touching the screen hands control to the visitor
  const autoBtn = $('autoBtn');
  let auto = true, timer = 0;
  function resetCycle() { clearInterval(timer); if (auto && introDone) timer = setInterval(() => step(1), CYCLE_MS); }
  function setAuto(on) { auto = on; autoBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); resetCycle(); }
  autoBtn.addEventListener('click', () => { setAuto(!auto); if (auto) step(1); });
  chBtns.forEach(b => b.addEventListener('click', () => { start(); setAuto(false); go(b.dataset.go, true); }));
  $('castBody').addEventListener('pointerdown', () => setAuto(false));
  $('castBody').addEventListener('wheel', () => setAuto(false), { passive: true });
  document.addEventListener('keydown', e => {
    if (e.target !== document.body || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '4') { start(); setAuto(false); go(PAGES[+k - 1].id, true); }
    else if (k === 'ArrowRight' || k === 'ArrowLeft') { start(); setAuto(false); step(k === 'ArrowRight' ? 1 : -1); }
    else if (k === ' ') { e.preventDefault(); $('playBtn').click(); }
  });

  /* ---------- mute (the intro's corner button and the set's button stay in step) ---------- */
  const muteBtns = document.querySelectorAll('.mute-btn');
  function syncMute() { muteBtns.forEach(b => { b.setAttribute('aria-pressed', audio.muted ? 'true' : 'false'); b.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute'); }); }
  muteBtns.forEach(b => b.addEventListener('click', () => { audio.muted = !audio.muted; syncMute(); }));
  audio.addEventListener('volumechange', syncMute);

  /* ---------- playlists: one list on screen at a time, picked with tabs ---------- */
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
    if (i >= 0) {
      showCell(i);
      const li = grid.querySelector('.track.is-current'), ol = li.parentElement;
      requestAnimationFrame(() => { ol.scrollTop = li.offsetTop - (ol.clientHeight - li.offsetHeight) / 2; });
    }
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
      d.innerHTML = '<span class="day-name"></span><span class="day-vis"></span>' +
        '<span class="day-icon">' + bars.map(l => '<i style="height:' + Math.round(20 + 80 * l / mx) + '%"></i>').join('') + '</span>' +
        '<span class="day-count">' + n + (n === 1 ? ' track' : ' tracks') + '</span>' +
        '<span class="day-hilo"><span class="lo">Lo<b>' + (lens.length ? fmt(Math.min(...lens)) : '–') + '</b></span>' +
        '<span class="hi">Hi<b>' + (lens.length ? fmt(Math.max(...lens)) : '–') + '</b></span></span>' +
        '<span class="day-vis">' + (total ? Math.round(total / 60) + ' min total' : '') + '</span>';
      d.querySelector('.day-name').textContent = name;
      d.querySelector('.day-vis').textContent = vis || 'playlist';
      d.addEventListener('click', () => { setAuto(false); showCell(i); go('lists', true); });
      outlook.appendChild(d);
    });
    markCurrent();
  }

  /* ---------- now playing details and the crawl ---------- */
  const title = $('playerTitle'), crawl = $('crawl'), idle = crawl.textContent;
  function markCurrent() {
    const i = currentCell();
    tabs.querySelectorAll('.list-tab').forEach((t, j) => t.classList.toggle('has-current', j === i));
    outlook.querySelectorAll('.day').forEach((d, j) => d.classList.toggle('has-current', j === i));
    if (i >= 0) {
      const { name, vis } = cellLabel(cells()[i]);
      $('nowList').textContent = name + (vis ? ' · ' + vis : '');
      if (screen.dataset.page !== 'lists') showCell(i);   // the lists channel opens on whatever is playing
    }
  }
  function sync() {
    const s = title.textContent.trim(), file = $('playerFile').textContent;
    const ext = (file.split('.').pop() || '').toUpperCase();
    $('nowFmt').textContent = file ? ext + (ext === 'WAV' || ext === 'AIF' || ext === 'AIFF' || ext === 'FLAC' ? ' · lossless' : '') : '—';
    crawl.textContent = s && s !== '—'
      ? 'Now playing on CRMSN: ' + s + '   ·   ' + ($('nowList').textContent || '') + '   ·   full-quality files, straight from the studio'
      : idle;
    markCurrent();
  }
  new MutationObserver(sync).observe(title, { childList: true, characterData: true, subtree: true });
  new MutationObserver(markCurrent).observe(grid, { attributes: true, attributeFilter: ['class'], subtree: true });
  const shuffleBtn = $('shuffleBtn');
  new MutationObserver(() => { $('nowShuffle').textContent = shuffleBtn.getAttribute('aria-pressed') === 'true' ? 'On' : 'Off'; })
    .observe(shuffleBtn, { attributes: true, attributeFilter: ['aria-pressed'] });

  go('now'); syncMute(); tick();
  setInterval(tick, 1000);
})();
