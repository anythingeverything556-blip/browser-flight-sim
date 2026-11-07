// Check for WebGL 2 (required by three.js r180) before loading the simulator, so an unsupported
// browser gets an explanation on the start screen instead of an uncaught exception.
const msg = (text) => {
  const el = document.getElementById('loadmsg');
  if (el) { el.textContent = text; el.classList.add('err'); }
  document.querySelectorAll('#start-btn, #home-go').forEach((b) => { b.disabled = true; });
  const ls = document.getElementById('loadscreen'); if (ls) ls.hidden = true; // a queued start must not cover the error
};

// Start flight answers the first click even while the simulator is still loading: the loading screen opens at once and main.js replays the
// click when it is ready (window.__simReady). The buttons used to stay disabled for the first 10-30 s, so early clicks did nothing.
window.__startQueued = null;
document.addEventListener('click', (e) => {
  if (window.__simReady) return;
  const b = e.target instanceof Element && e.target.closest('#start-btn, #home-go');
  if (!b || b.disabled) return;
  e.stopImmediatePropagation(); e.preventDefault();
  window.__startQueued = b.id;
  const ls = document.getElementById('loadscreen'); if (ls) { ls.hidden = false; ls.classList.remove('out'); }
}, true);

// The check opens the game's own context on the game's canvas, with the attributes three.js asks for (main.js: canvas MSAA only on Low), so the
// renderer's getContext gets this same context back. A throwaway probe context here cost ~1 s of a SwiftShader boot and meant a second GPU context.
let gl = null;
try {
  let low = false; try { low = (JSON.parse(localStorage.getItem('sr71sim.settings') || 'null') || {}).gfx === 'low'; } catch { /* storage blocked: main.js reads it the same way */ }
  const view = document.getElementById('view'), attrs = { alpha: true, depth: true, stencil: false, antialias: low, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false };
  gl = (view || document.createElement('canvas')).getContext('webgl2', attrs);
} catch { /* reported below */ }
if (!gl) {
  msg('This simulator needs WebGL 2. Turn on hardware acceleration in your browser settings or try another browser.');
} else {
  import('./main.js').catch((e) => { console.error(e); msg('Failed to start: ' + (e && e.message ? e.message : e)); });
}
