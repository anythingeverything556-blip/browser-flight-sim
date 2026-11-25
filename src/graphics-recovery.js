// A restored context alone does not prove all streamed/CPU-discarded textures recovered.
// Keep the flight frozen until a clean reload rebuilds every resource.
export function mountGraphicsRecovery({ canvas, state, controls, notice, status, holdAudio }) {
  const show = text => { notice.hidden = false; notice.querySelector('[role="status"]').textContent = text; };
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); state.graphicsHold = true; controls.enabled = false; controls.setLocked(true); holdAudio();
    status.textContent = 'Graphics lost — flight suspended';
    show('Graphics connection lost. Flight suspended. Waiting for graphics recovery…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!state.graphicsHold) return;
    status.textContent = 'Graphics restored — reload required';
    show('Graphics restored. Flight remains suspended; reload to rebuild all scenery and cockpit resources.');
  });
  notice.querySelector('button').addEventListener('click', () => location.reload());
}
