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

/* ---------- discography player ---------- */
(function () {
  const player = document.getElementById('player');
  const audio = document.getElementById('audio');
  const list = document.getElementById('trackList');
  const empty = document.getElementById('trackEmpty');
  const playBtn = document.getElementById('playBtn');
  const seek = document.getElementById('seek');
  const titleEl = document.getElementById('playerTitle');
  const curEl = document.getElementById('timeCur');
  const durEl = document.getElementById('timeDur');
  let tracks = [];
  let current = -1;
  let seeking = false;

  const fmt = s => isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '0:00';

  function render() {
    list.innerHTML = '';
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'track';
      li.innerHTML = '<button type="button" class="track-btn">' +
        '<span class="track-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="track-title"></span>' +
        '<span class="track-meta"></span></button>';
      li.querySelector('.track-title').textContent = t.title;
      li.querySelector('.track-meta').textContent = (t.file.split('.').pop() || '').toUpperCase() + (t.bytes ? ' · ' + (t.bytes / 1048576).toFixed(1) + ' MB' : '');
      li.querySelector('button').addEventListener('click', () => (i === current ? toggle() : load(i, true)));
      list.appendChild(li);
    });
  }

  function mark() {
    list.querySelectorAll('.track').forEach((li, i) => {
      li.classList.toggle('is-current', i === current);
      li.classList.toggle('is-playing', i === current && !audio.paused);
    });
    player.classList.toggle('is-playing', !audio.paused);
    playBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  }

  function load(i, autoplay) {
    current = (i + tracks.length) % tracks.length;
    audio.src = tracks[current].url;
    titleEl.textContent = tracks[current].title;
    seek.value = 0; curEl.textContent = '0:00'; durEl.textContent = '0:00';
    if (autoplay) audio.play().catch(() => {});
    mark();
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

  fetch('tracks.json', { cache: 'no-cache' })
    .then(r => r.json())
    .then(data => {
      tracks = (data.tracks || []).filter(t => t.url && t.title);
      if (!tracks.length) { empty.hidden = false; return; }
      render();
      player.hidden = false;
      load(0, false);
    })
    .catch(() => { empty.hidden = false; });
})();
