import { mountSetupAccessibility } from './setup-accessibility.js';
import { diagnostics, installRuntimeDiagnostics } from './telemetry.js';
// Check for WebGL 2 (required by three.js r180) before loading the simulator, so an unsupported
// browser gets an explanation on the start screen instead of an uncaught exception.
import { showStartupError as msg } from './startup.js';
import { touchOnly } from './touchcontrols.js';
import { aircraftChoice, AIRCRAFT_TYPES } from './aircrafts.js';

mountSetupAccessibility(aircraftChoice(savedSettings(), location.search));
installRuntimeDiagnostics(window);
diagnostics.record('start_screen_viewed', 'screen');
diagnostics.record('aircraft_chosen', aircraftChoice(savedSettings(), location.search));
function savedSettings() { try { return JSON.parse(localStorage.getItem('sr71sim.settings') || '{}'); } catch { return {}; } }

// Name the explicit quick-start aircraft before enabling the early-click queue.
let savedChoice = {}; try { savedChoice = JSON.parse(localStorage.getItem('sr71sim.settings') || '{}'); } catch { /* private/corrupt storage */ }
const selectedAircraft = aircraftChoice(savedChoice, location.search);
const quickChoice = ['da40', 'c172', 'f27'].includes(selectedAircraft) ? selectedAircraft : 'sr71';
const quickButton = document.getElementById('just-fly');
if (quickButton) { quickButton.textContent = `Just fly · ${AIRCRAFT_TYPES[quickChoice].short}`; quickButton.disabled = false; }

// Start flight answers the first click even while the simulator is still loading: the loading screen opens at once and main.js replays the
// click when it is ready (window.__simReady). The buttons used to stay disabled for the first 10-30 s, so early clicks did nothing.
window.__startQueued = null;
document.addEventListener('click', (e) => {
  const clicked = e.target instanceof Element && e.target.closest('#start-btn, #home-go, #just-fly, #resume-flight');
  if (clicked && !clicked.disabled && e.isTrusted) diagnostics.record('start_clicked', ({'start-btn':'custom','home-go':'home','just-fly':'quick','resume-flight':'resume'})[clicked.id]);
  const aircraftCard = e.target instanceof Element && e.target.closest('#ac-cards [data-v]');
  if (aircraftCard && e.isTrusted) diagnostics.record('aircraft_chosen', aircraftCard.dataset.v);
  if (window.__simReady) return;
  const b = e.target instanceof Element && e.target.closest('#start-btn, #home-go, #just-fly, #resume-flight');
  if (!b || b.disabled) return;
  e.stopImmediatePropagation(); e.preventDefault();
  window.__startQueued = b.id;
  const ls = document.getElementById('loadscreen'); if (ls) { ls.hidden = false; ls.classList.remove('out'); }
}, true);

// The check opens the game's own context on the game's canvas, with the attributes three.js asks for (main.js: canvas MSAA only on Low), so the
// renderer's getContext gets this same context back. A throwaway probe context here cost ~1 s of a SwiftShader boot and meant a second GPU context.
function startSimulator() {
  document.querySelectorAll('link[data-flight-preload]').forEach(link => { link.media = 'all'; });
let gl = null;
try {
  let low = false; try { low = (JSON.parse(localStorage.getItem('sr71sim.settings') || 'null') || {}).gfx === 'low'; } catch { /* storage blocked: main.js reads it the same way */ }
  const view = document.getElementById('view'), attrs = { alpha: true, depth: true, stencil: false, antialias: low, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false };
  gl = (view || document.createElement('canvas')).getContext('webgl2', attrs);
} catch { /* reported below */ }
if (!gl) {
  diagnostics.record('load_failure', 'webgl');
  msg('This simulator needs WebGL 2. Turn on hardware acceleration in your browser settings or try another browser.');
} else {
  import('./main.js').catch((e) => { console.error(e); msg('Failed to start: ' + (e && e.message ? e.message : e)); });
}

}
if (touchOnly()) {
  const gate = document.getElementById('touch-gate');
  gate.showModal();
  diagnostics.record('mobile_gate_shown', 'touch');
  gate.addEventListener('cancel', e => e.preventDefault());
  document.getElementById('touch-continue').addEventListener('click', () => { gate.close(); startSimulator(); }, { once: true });
} else startSimulator();
