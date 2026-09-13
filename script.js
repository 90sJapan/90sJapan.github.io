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
