// Activation only: spawn/physics/loading policy remains in main.js.
export function activateFlight({ document, state, controls, cmap, settings, logbook, renderLogbook, openSheet, placeAircraftPicker, syncStripH, toast }) {
  logbook.begin(state.setup); renderLogbook();
  if (settings.cmap !== false && !cmap.visible) cmap.toggle(true);
  document.body.classList.remove('intro'); state.started = true; controls.enabled = true;
  openSheet(null); placeAircraftPicker(); syncStripH();
  toast('W/S pitch · A/D roll (steer the nose wheel on the ground) · ? all keys');
}
