// Local, bounded diagnostics only. No provider, transport, persistent IDs or storage.
import { AIRCRAFT_TYPES } from './aircrafts.js';
const selectableAircraft = Object.freeze(Object.keys(AIRCRAFT_TYPES));
const categories = Object.freeze({
  start_screen_viewed: ['screen'], start_clicked: ['custom','quick','home','resume'],
  cockpit_reached: ['flight'], aircraft_chosen: selectableAircraft,
  load_failure: ['startup','webgl','asset'], mobile_gate_shown: ['touch'],
  runtime_error: ['javascript','promise','resource'], graphics_error: ['shader']
});
export function createDiagnostics(limit = 100) {
  const capacity = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 100;
  const events = [];
  return Object.freeze({
    record(name, category) {
      if (!Object.hasOwn(categories, name) || !categories[name].includes(category)) return;
      events.push(Object.freeze({ name, category }));
      if (events.length > capacity) events.shift();
    },
    events: () => events.map(event => ({ ...event }))
  });
}
export const diagnostics = createDiagnostics();
const installed = new WeakSet();
export function installRuntimeDiagnostics(target) {
  if (installed.has(target)) return; installed.add(target);
  // Never prevent default: browser console diagnostics remain intact.
  target.addEventListener('error', event => diagnostics.record('runtime_error', event.error ? 'javascript' : 'resource'), true);
  target.addEventListener('unhandledrejection', () => diagnostics.record('runtime_error', 'promise'));
  target.__earthwingDebug = Object.freeze({ events: diagnostics.events });
}
export function installShaderDiagnostics(renderer) {
  const previous = renderer.debug.onShaderError;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    diagnostics.record('graphics_error', 'shader');
    if (previous) { previous(gl, program, vertex, fragment); return; }
    // Keep raw details only in the existing developer console, never in event data.
    console.error('THREE.WebGLProgram: Shader Error', gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
  };
}
