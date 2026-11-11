import { IL76, NOTCHES } from './il76.js';

// The Il-76's own cockpit controls (main.js binds the keys and calls these): gear lever, flap and slat notches, spoilers, thrust reverse, the crew, cargo and
// paratroop doors, and the take-off interlock. Everything the player is told goes through toast(); audio is optional. casKt(): calibrated airspeed in kt.
const KT = 1.943844;
const kmh = (kt) => Math.round(kt * 1.852);

export function makeIl76Controls({ fdm, visual, audio, toast, casKt }) {
  const play = (n, k) => { if (audio) audio.play(n, k); };
  const stopped = () => fdm.onGround && Math.hypot(fdm.vel.x, fdm.vel.z) <= 1;
  const flapsTo = (n) => {
    const to = Math.max(0, Math.min(NOTCHES.length - 1, n)), lim = NOTCHES[to].vfe * fdm.mx.vlim;
    fdm.setFlaps(to); play('flap-clunk', 0.6);
    toast(`Slats and flaps ${NOTCHES[to].name}${casKt() > lim ? ` — above ${Math.round(lim)} KIAS (${kmh(lim)} km/h, VFE)` : ''}`, casKt() > lim);
  };
  let capNoted = false;
  return {
    // gear lever: up is refused with weight on the wheels; the gear limit speeds (VLO / VLE 370 km/h) warn
    gear() {
      const down = !fdm.gearDown;
      if (!fdm.setGear(down)) { toast('Weight on wheels — gear locked down', true); return; }
      const lim = IL76.VLO * fdm.mx.vlim;
      toast(down ? 'Gear down' : `Gear up${casKt() > lim ? ` — above ${Math.round(lim)} KIAS (${kmh(lim)} km/h, VLO)` : ''}`);
    },
    flapsDown() { flapsTo(fdm.flapCmd >= NOTCHES.length - 1 ? 0 : fdm.flapCmd + 1); },
    flapsUp() { flapsTo(fdm.flapCmd - 1); },
    spoilers() {
      const out = !fdm.spoilerCmd; fdm.setSpoilers(out);
      toast(out ? `Spoilers and brake panels out${fdm.out && fdm.out.ias * KT > IL76.V_PANEL_MAX && !fdm.onGround ? ' (brake panels stay in above 250 km/h)' : ''}` : 'Spoilers in');
    },
    // thrust reverse: the sleeves deploy in under 2 s and only with weight on the wheels; the thrust lever then sets the reverse power (Medium and Easy: full)
    reverse() {
      const on = !fdm.reverserCmd;
      if (!fdm.setReverser(on)) { toast('Thrust reverse is locked out in the air', true); return; }
      play(on ? 'reverser-deploy' : 'reverser-stow', 1);
      const n = fdm.mx.revEngines.length, eng = n === 4 ? 'all four engines' : `engines ${fdm.mx.revEngines.map((i) => i + 1).join(' and ')}`;
      toast(on ? `Thrust reverse out (${eng})${fdm.mx.autoRev ? '' : ': raise the thrust lever for reverse power'}` : 'Thrust reverse stowed');
    },
    // crew doors: only stopped on the ground, and they close by themselves if the aircraft starts to roll
    doors() {
      const open = visual.crewDoor.cmd > 0;
      if (!open && !stopped()) { toast('The crew doors open only when stopped on the ground', true); return; }
      visual.setDoors(!open); play('gear-door', open ? 1 : -1); toast(open ? 'Crew doors closed' : 'Crew doors open');
    },
    paratroop() {
      const open = visual.para.cmd > 0;
      if (!open && !stopped()) { toast('The paratroop doors open only when stopped on the ground', true); return; }
      visual.setParatroop(!open); play('gear-door', open ? 1 : -1); toast(open ? 'Paratroop doors closing' : 'Paratroop doors opening');
    },
    // cargo hatch: clamshell doors, then the ramp, then the upper door, hoists run aft; opens only stopped on the ground, closing is always allowed
    cargo() {
      const open = visual.cargo.cmd > 0;
      if (!open && !stopped()) { toast('The cargo hatch opens only when stopped on the ground', true); return; }
      visual.setCargo(!open); play('gear-door', open ? 1 : -1); toast(open ? 'Cargo hatch closing' : 'Cargo hatch opening');
    },
    // every frame: the doors close if the aircraft rolls; the lever is held below take-off power with the cargo hatch not shut. Returns the lever cap (1 = none).
    frame() {
      const rolling = Math.hypot(fdm.vel.x, fdm.vel.z) > 3;
      if (rolling && visual.crewDoor.cmd > 0) { visual.setDoors(false); toast('Crew doors closed for taxi'); }
      if (rolling && visual.para.cmd > 0) { visual.setParatroop(false); toast('Paratroop doors closing for taxi'); }
      const hatch = visual.cargo.cmd > 0 || visual.cargo.pos > 0.02;
      if (hatch && fdm.onGround) { if (!capNoted) { capNoted = true; toast('Cargo hatch not closed — close it (4) before take-off power', true); } return 0.3; }
      capNoted = false; return 1;
    },
    // the warning tone for audio.js: pull-up siren 2, stall horn 1, overspeed clacker 4, configuration horn 3
    warnTone(w) { return w.pullUp ? 2 : w.stall ? 1 : w.overspeed ? 4 : w.gearUnsafe ? 3 : 0; },
  };
}
