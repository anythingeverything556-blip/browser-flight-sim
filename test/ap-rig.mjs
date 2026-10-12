// Offline closed-loop rig: flight model + autopilot stepped like main.js does (stick untouched, autopilot on).
import * as THREE from 'three';
import { FlightModel } from '../src/flight.js';
import { Autopilot, attitude } from '../src/autopilot.js';

export const KT = 1.943844, FT = 3.28084;
const flat = () => 0;

// kt is indicated (equivalent) airspeed, mach overrides it
export function makeRig({ altM = 9144, kt = 250, hdg = 90, gear = false, fuel, mach } = {}) {
  const fdm = new FlightModel(), ap = new Autopilot(), wind = new THREE.Vector3();
  if (fuel != null) fdm.fuel = fuel;
  const T = Math.max(216.65, 288.15 - 0.0065 * altM), a = Math.sqrt(1.4 * 287.05 * T);
  const rho = 1.225 * (altM < 11000 ? Math.pow(T / 288.15, 4.2559) : 0.2971 * Math.exp(-(altM - 11000) / 6341.6));
  const v = mach ? mach * a : kt / KT / Math.sqrt(rho / 1.225);
  fdm.reset(new THREE.Vector3(0, altM, 0), hdg, v, false);
  fdm.gearDown = gear; fdm.gearPos = gear ? 1 : 0;
  const rig = { fdm, ap, wind, t: 0, log: [], events: [] };
  ap.target.alt = altM; ap.target.hdg = hdg;
  rig.engage = (modes = {}) => {
    Object.assign(ap.modes, modes);
    ap.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle });
  };
  rig.step = (dt = 1 / 120) => {
    const att = attitude(fdm.quat), out = fdm.out;
    if (ap.on) {
      const c = ap.update(dt, { fdm, out, att, vs: fdm.vel.y, alt: fdm.pos.y, ias: out.ias ?? 0, nav: {} });
      fdm.ctrl.de = c.de; fdm.ctrl.da = c.da; fdm.ctrl.dr = c.dr;
      if (ap.modes.spd || ap.modes.mach || c.thrOverride) fdm.throttle = c.th;
    }
    fdm.step(dt, flat, wind);
    rig.t += dt;
  };
  rig.run = (secs, every = 1, probe) => {
    const n = Math.round(secs * 120);
    for (let i = 0; i < n; i++) {
      rig.step();
      if (i % Math.round(120 * every) === 0) rig.log.push(rig.sample());
      if (probe) probe(rig);
    }
  };
  rig.sample = () => {
    const att = attitude(fdm.quat), o = fdm.out;
    return { t: +rig.t.toFixed(1), altFt: fdm.pos.y * FT, kt: (o.ias ?? 0) * KT, M: o.M, aoaDeg: (o.alpha ?? 0) * 57.3, bankDeg: att.bank * 57.3, pitchDeg: att.pitch * 57.3,
      vsFpm: fdm.vel.y * 196.85, nz: o.nz, th: fdm.throttle };
  };
  return rig;
}

// Put the jet in an arbitrary attitude (deg) with the velocity along the nose, or along the horizontal heading if velAlongHeading.
export function setAttitude(fdm, { pitch = 0, bank = 0, hdg = 90, kt, altM, velAlongHeading = false }) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - hdg * Math.PI / 180);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch * Math.PI / 180));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bank * Math.PI / 180));
  fdm.quat.copy(q); fdm.w.set(0, 0, 0);
  if (altM != null) fdm.pos.y = altM;
  const rho = 1.225 * Math.pow(Math.max(0.2, 1 - 0.0065 * fdm.pos.y / 288.15), 4.2559);
  const tas = kt / KT / Math.sqrt(rho / 1.225);
  const dir = velAlongHeading ? new THREE.Vector3(Math.sin(hdg * Math.PI / 180), 0, -Math.cos(hdg * Math.PI / 180)) : new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  fdm.vel.copy(dir).multiplyScalar(tas);
}
