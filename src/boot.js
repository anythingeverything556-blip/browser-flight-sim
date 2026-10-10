// Check for WebGL 2 (required by three.js r180) before loading the simulator, so an unsupported
// browser gets an explanation on the start screen instead of an uncaught exception.
const msg = (text) => {
  const el = document.getElementById('loadmsg');
  if (el) { el.textContent = text; el.classList.add('err'); }
  document.querySelectorAll('#start-btn, #home-go').forEach((b) => { b.disabled = true; });
};

let gl = null;
try { gl = document.createElement('canvas').getContext('webgl2'); } catch { /* reported below */ }
if (!gl) {
  msg('This simulator needs WebGL 2. Turn on hardware acceleration in your browser settings or try another browser.');
} else {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  import('./main.js').catch((e) => { console.error(e); msg('Failed to start: ' + (e && e.message ? e.message : e)); });
}
