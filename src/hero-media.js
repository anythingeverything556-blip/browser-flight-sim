// Decorative, locally rendered loop. No video URL is assigned on phones, data-saving
// connections or reduced-motion setups: hiding an already sourced video still downloads it.
const video = document.getElementById('hero-video');
const toggle = document.getElementById('hero-motion');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const desktop = matchMedia('(min-width: 1180px)');
const connection = navigator.connection;
let stopped = false, failed = false;
const eligible = () => desktop.matches && !motion.matches && !connection?.saveData && !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType || '') && document.body.classList.contains('intro');
function clear() {
  video.pause(); video.classList.remove('playing'); toggle.hidden = true;
  if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
}
async function sync() {
  if (!video || !toggle) return;
  if (!eligible() || failed) { clear(); return; }
  if (stopped || document.hidden) { video.pause(); return; }
  if (!video.hasAttribute('src')) video.src = innerWidth * Math.min(devicePixelRatio || 1, 3) > 1920 ? '/images/earthwing-flight-4k.mp4' : '/images/earthwing-flight-1080.mp4';
  video.muted = true;
  try { await video.play(); if (eligible() && !stopped) { video.classList.add('playing'); toggle.hidden = false; } else sync(); }
  catch { if (eligible() && !document.hidden) failed = true; clear(); } // Autoplay denial or decoder failure keeps the sharp responsive poster.
}
if (video && toggle) {
  toggle.addEventListener('click', () => {
    stopped = !stopped; toggle.textContent = stopped ? 'Play background' : 'Pause background';
    if (stopped) video.pause(); else sync();
  });
  video.addEventListener('error', () => { failed = true; clear(); });
  motion.addEventListener('change', sync); desktop.addEventListener('change', sync);
  connection?.addEventListener?.('change', sync);
  document.addEventListener('visibilitychange', sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  sync();
}
