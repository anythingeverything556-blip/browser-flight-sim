import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { Autopilot, attitude, flareSink, landingAidOn, FLARE_PITCH_MAX, FLARE_THR_AGL } from '../src/autopilot.js';
const KT = 1.943844, D2R = Math.PI / 180;
const ok = (n, c, i = '') => { assert.ok(c, `${n} ${i}`); console.log(`PASS  ${n} ${i}`); };

function land({ kt = 200, throttle = 0, bank = 0, gust = 0, fuel = 12000 }) {
  const f = new FlightModel(); f.fuel = fuel; const a = new Autopilot(), wind = new THREE.Vector3(), dt = 1 / 120, flat = () => 0;
  f.reset(new THREE.Vector3(0, 2.42 + 46, 0), 90, kt / KT, false, -3); f.gearDown = true; f.gearPos = 1; f.throttle = throttle;
  if (bank) f.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bank * D2R));
  let touch = null, retardAt = null, maxPitch = 0;
  for (let t = 0; t < 120; t += dt) {
    const agl = f.pos.y - 2.42, att = attitude(f.quat);
    wind.set(0, gust * Math.sin(t * 2.1), gust * Math.sin(t * 1.3));
    if (landingAidOn({ enabled: true, onGround: f.onGround, crashed: f.crashed, gearPos: f.gearPos, agl, vs: f.vel.y, iasKt: (f.out.ias ?? 0) * KT, pitch: 0, latched: a.on })) {
      if (!a.on) { a.engage({ ctrl: f.ctrl, throttle: f.throttle }); Object.keys(a.modes).forEach((k) => { a.modes[k] = false; }); a.modes.vs = true; a.target.vsLimit = 20; a.tauV = 1.6; a.kiDiv = 8; }
      a.target.vs = flareSink(agl);
      const c = a.update(dt, { fdm: f, out: f.out, att, vs: f.vel.y, alt: f.pos.y, ias: f.out.ias ?? 0, nav: {}, agl });
      f.ctrl.de = c.de;
      if (agl < 12) { const w = Math.min(1, (12 - agl) / 8); f.ctrl.da = f.ctrl.da * (1 - w) + c.da * w; }
      if (c.thrOverride) { if (retardAt == null) retardAt = agl; f.throttle = c.th; }
      maxPitch = Math.max(maxPitch, att.pitch);
    } else if (a.on) a.disengage();
    f.step(dt, flat, wind);
    if (f.crashed) return { crashed: f.crashed, maxPitch, retardAt };
    if (f.onGround && !touch) { const at = attitude(f.quat); touch = { vs: -f.vel.y, pitch: at.pitch / D2R, bank: at.bank / D2R, kt: f.vel.length() * KT, t }; }
    if (touch && t - touch.t > 5) break;
  }
  return { touch, retardAt, maxPitch };
}

{
  const f = new FlightModel(); f.reset(new THREE.Vector3(0, 40, 0), 90, 100, false, -3); f.gearDown = true; f.gearPos = 1; f.step(1 / 120, () => 0, new THREE.Vector3());
  const a = new Autopilot(); a.engage({ ctrl: f.ctrl, throttle: f.throttle }); Object.keys(a.modes).forEach((k) => { a.modes[k] = false; }); a.modes.vs = true; a.tauV = 1.6; a.kiDiv = 8; a.target.vs = -1;
  f.out = { ...f.out, alpha: 0.28 }; a.update(1 / 60, { fdm: f, out: f.out, att: attitude(f.quat), vs: -4, alt: 40, ias: 100, nav: {}, agl: 38 });
  ok('flare mode does not latch STALL PROTECT at a high-AOA moment', a.status.prot === '' && a.stallHold === 2 || a.status.prot === '', `status '${a.status.prot}'`);
  const b = new Autopilot(); b.engage({ ctrl: f.ctrl, throttle: f.throttle }); Object.keys(b.modes).forEach((k) => { b.modes[k] = false; }); b.modes.vs = true; b.target.vs = -1;
  b.update(1 / 60, { fdm: f, out: f.out, att: attitude(f.quat), vs: -4, alt: 40, ias: 100, nav: {} });
  ok('the same moment in ordinary V/S mode still latches it', b.status.prot === 'STALL PROTECT', `status '${b.status.prot}'`);
}
{
  const r = land({ throttle: 0.45 });
  ok('left at 45 % power the flare takes the throttle back below 12 m and lands (it used to float to 350 kt)', !r.crashed && r.touch && r.retardAt != null && r.retardAt < FLARE_THR_AGL + 0.5 && r.touch.vs < 3, r.crashed || `throttle taken at ${r.retardAt?.toFixed(1)} m, touchdown ${r.touch.vs.toFixed(2)} m/s ${r.touch.kt.toFixed(0)} kt`);
}
{
  const r = land({});
  ok('the nose stays near the flare cap', r.maxPitch / D2R < FLARE_PITCH_MAX / D2R + 1.5, `max pitch ${(r.maxPitch / D2R).toFixed(1)} deg, cap ${(FLARE_PITCH_MAX / D2R).toFixed(1)}`);
  ok('touchdown pitch is clear of the nozzles (static strike about 16 deg, 13 deg with the struts compressed)', r.touch.pitch < 12 && r.touch.vs < 3, `${r.touch.pitch.toFixed(1)} deg, ${r.touch.vs.toFixed(2)} m/s`);
}
for (const bank of [3, -3, 5]) {
  const r = land({ bank });
  ok(`${bank} deg of bank at 46 m is flown out and lands without a nozzle strike`, !r.crashed && r.touch && Math.abs(r.touch.bank) < 2.5, r.crashed || `touchdown bank ${r.touch.bank.toFixed(1)} deg, pitch ${r.touch.pitch.toFixed(1)}, ${r.touch.vs.toFixed(2)} m/s`);
}
{
  const r = land({ gust: 2.5 });
  ok('gusting air: soft landing, no crash', !r.crashed && r.touch && r.touch.vs < 4.5, r.crashed || `${r.touch.vs.toFixed(2)} m/s`);
}
console.log('all flare tests passed');
