// Explicit import functions let Vite split aircraft visuals without pulling the
// six unselected airframes (and their decoders/panels) into the first load.
const visuals = {
  c172: () => import('./c172visual.js'),
  da40: () => import('./da40visual.js'),
  f27: () => import('./f27visual.js'),
  sf50: () => import('./sf50visual.js'),
  a380x: () => import('./a380xvisual.js'),
  il76: () => import('./il76visual.js'),
  sr71: () => import('./sr71visual.js'),
};

export function loadAircraftVisual(aircraft) {
  return (Object.hasOwn(visuals, aircraft) ? visuals[aircraft] : visuals.da40)();
}
