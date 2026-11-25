import { A380X, NOTCHES } from './a380x.js';
// Shared game's key bindings, independent of the Il-76 cargo/door controls.
export function makeA380xControls({ fdm, toast, casKt }) {
  const flap = n => { fdm.setFlaps(n); const s = NOTCHES[fdm.flapCmd]; toast(`A380X ${s.name}${Number.isFinite(s.vfe) ? ` — VFE ${s.vfe} KIAS` : ''}`, casKt() > s.vfe); };
  return {
    gear() { const down = !fdm.gearDown; if (!fdm.setGear(down)) return toast('Weight on wheels — gear locked down', true); toast(`Gear ${down ? 'down' : 'up'} — limit ${A380X.VLO} KIAS`, casKt() > A380X.VLO); },
    flapsDown() { flap(Math.min(NOTCHES.length - 1, fdm.flapCmd + 1)); },
    flapsUp() { flap(fdm.flapCmd - 1); },
    spoilers() { fdm.setSpoilers(!fdm.spoilerCmd); toast(`Spoilers ${fdm.spoilerCmd ? 'out' : 'in'}`); },
    reverse() { if (!fdm.setReverser(!fdm.reverserCmd)) return toast('Reverse thrust is locked out in the air', true); toast(fdm.reverserCmd ? 'Inboard engines 2 + 3 reverse — raise thrust levers for reverse power' : 'Reverse stowed'); },
    doors() { toast('Passenger doors are not interactive in this browser conversion. Choose Passenger cabin in Views.'); },
    cargo() { toast('Cargo doors are not interactive in this browser conversion.'); },
    paratroop() { toast('No paratroop doors on the A380.'); },
    frame() { return 1; },
    warnTone(w) { return w.pullUp ? 2 : w.stall ? 1 : w.overspeed ? 4 : w.gearUnsafe ? 3 : 0; },
  };
}
