// Cirrus Vision Jet SF50 (G3) flight model against the published data: static weight on wheels, FJ33-5A thrust / spool / fuel flow, take-off roll, climb,
// stall speeds, FL280 cruise, hands-off stability, power-pitch coupling, retractable gear, landing roll, and long random-input runs.
// Flat ground at 0 m, no wind, ISA.
import * as THREE from 'three';
import { SF50Model, SF50, SF50_CG, SF50_GEAR, SF50_HARD, FLAP_POS, FLAP_DEG, stallAlpha, sf50Lift } from '../src/sf50.js';
import { isa } from '../src/atmosphere.js';

let fails = 0;
let last = null;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}${last && last.crashed ? ` [crashed: ${last.crashed}]` : ''}`); if (!ok) fails++; last = null; };
const KT = 1.943844, FT = 3.28084, LBH = 0.45359237 / 3600, G = 9.80665, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const kias = (f) => (f.out.ias ?? f.out.V) * KT;
const fly = (f, secs, ctl) => { last = f; for (let t = 0; t < secs; t += dt) { ctl && ctl(f, t); f.step(dt, ground, wind); if (f.crashed) break; } };
const pitchOf = (f) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y);
const bankOf = (f) => Math.asin(Math.max(-1, Math.min(1, -new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat).y)));
const hdgOf = (f) => { const v = new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat); return Math.atan2(v.z, v.x) * 180 / Math.PI; };
const dHdg = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const clampv = (v, a, b) => Math.max(a, Math.min(b, v));
// pilot: wings level and ball centred; elevator gains scale down with dynamic pressure (the V-tail's authority grows with q)
const level = (f) => { f.ctrl.da = clampv(-2 * bankOf(f) - 0.5 * f.w.x, -1, 1); f.ctrl.dr = clampv(3 * (f.out.beta || 0) + 0.3 * f.w.y, -1, 1); };
const kq = (f) => clampv(1800 / Math.max(f.out.qbar || 1800, 300), 0.25, 1.5);
const holdPitch = (target) => (f) => { const k = kq(f); f.ctrl.de = clampv(k * 3 * (target - pitchOf(f)) - 0.8 * k * f.w.z, -1, 1); level(f); };
const pilotAlt = (alt, st) => (f) => { const k = kq(f), e = (alt - f.pos.y) / 30 - f.vel.y / 6; st.i = clampv(st.i + e * dt * 0.5, -2, 2); f.ctrl.de = clampv(k * (0.5 * e + 0.3 * st.i) - 0.6 * k * f.w.z, -1, 1); level(f); };
// a new jet at MTOW (full tanks); onGround: sitting on the gear at the runway
const fresh = (alt, kt, ground = false, gamma = 0) => { const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; f.reset(new THREE.Vector3(0, ground ? SF50_CG.y : alt, 0), 90, kt / KT, ground, gamma); return f; };
const lbh = (f) => f.engines[0].ff / LBH;
// change the configuration of a freshly reset jet (reset picks flaps and gear from the speed): level it again and re-trim for gamma
const reconfig = (f, notch, gear, gamma = 0) => {
  f.setFlaps(notch); f.flaps = FLAP_DEG[notch]; f.gearDown = gear; f.gearPos = gear ? 1 : 0;
  const v = f.vel.length(); f.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0).identity(); f.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - Math.PI / 2);
  f.vel.set(v, 0, 0); f.w.set(0, 0, 0); f.trimLevel(gamma);
};

// ---- model constants agree with the measured airframe and published weights ----
check('weights and geometry', Math.abs(SF50.EMPTY + SF50.FUEL_MAX - 2722) < 2 && SF50_GEAR.length === 3 && SF50_HARD.length === 9 && FLAP_POS.join() === '0,50,100' && SF50.FLAP_NOTCHES === 2 && FLAP_DEG.length === 3,
  `MTOW ${SF50.EMPTY + SF50.FUEL_MAX} kg (6,000 lb), fuel ${SF50.FUEL_MAX} kg, ${FLAP_POS.join('/')} % = ${FLAP_DEG.join('/')} deg, max notch ${SF50.FLAP_NOTCHES}`);

// ---- 1. on the ground at MTOW: the gear carries the weight, nose share 15-30 %, nothing drifts with brakes on and idle thrust ----
{
  const f = fresh(0, 0, true); f.parkingBrake = true; f.brakes = 1; f.throttle = 0; const x0 = f.pos.clone();
  fly(f, 60, () => {});
  const tot = f.contacts.reduce((s, c) => s + c, 0), share = f.contacts[0] / tot, W = f.mass * G;
  check('parked at idle with the brakes on, 60 s', !f.crashed && f.pos.distanceTo(x0) < 0.3 && Math.abs(tot - W) < 0.04 * W && share > 0.15 && share < 0.30 && Math.abs(f.pos.y - SF50_CG.y) < 0.05,
    `moved ${f.pos.distanceTo(x0).toFixed(2)} m, gear carries ${(tot / W * 100).toFixed(1)} % of the weight, nose wheel ${(share * 100).toFixed(1)} % (target ~23 %), CG ${f.pos.y.toFixed(3)} m, pitch ${(pitchOf(f) * 180 / Math.PI).toFixed(2)} deg`);
  const g = fresh(0, 0, true); g.throttle = 0; g.parkingBrake = false; fly(g, 60, () => {});
  check('idle thrust, brakes off: only a ~1 cm/s creep, as a real jet on the flat', !g.crashed && g.pos.distanceTo(x0) < 2 && Math.hypot(g.vel.x, g.vel.z) < 0.05, `moved ${g.pos.distanceTo(x0).toFixed(2)} m in 60 s, ${Math.hypot(g.vel.x, g.vel.z).toFixed(3)} m/s`);
}

// ---- 2. engine: static sea-level thrust, spool time, altitude lapse, fuel flow ----
{
  const f = fresh(0, 0, true); f.parkingBrake = true; fly(f, 5, () => {});
  const idleT = f.engines[0].thrust, idleFF = lbh(f); let t95 = null; f.throttle = 1;
  fly(f, 30, () => {});
  const full = f.engines[0].thrust, ffFull = lbh(f);
  const h = fresh(0, 0, true); h.parkingBrake = true; fly(h, 5, () => {}); h.throttle = 1;
  fly(h, 30, (g, t) => { if (t95 === null && g.engines[0].thrust >= 0.95 * full) t95 = t; });
  check('static sea-level thrust 1,846 lbf', !f.crashed && full > 8000 && full < 8400, `${(full / 1000).toFixed(2)} kN = ${(full / 4.44822).toFixed(0)} lbf, idle ${(idleT / 1000).toFixed(2)} kN (${(idleT / full * 100).toFixed(1)} %), N1 ${f.engines[0].n1.toFixed(0)} % N2 ${f.engines[0].n2.toFixed(0)} % ITT ${f.engines[0].itt.toFixed(0)} C`);
  check('spool idle to take-off thrust 4-8 s', t95 !== null && t95 > 4 && t95 < 8, `${t95 === null ? 'never' : t95.toFixed(1)} s to 95 % thrust`);
  check('fuel flow at sea level', idleFF > 60 && idleFF < 200 && ffFull > 700 && ffFull < 1000, `idle ${idleFF.toFixed(0)} lb/h, take-off ${ffFull.toFixed(0)} lb/h (est. 0.5 lb/lbf/h)`);
  const thr = {};
  for (const fl of [0, 100, 200, 280, 310]) {
    const a = fl * 100 / FT, g = fresh(a, 200 / KT * 0 + 150); g.reset(new THREE.Vector3(0, a, 0), 90, 0.5 * isa(a).a, false); g.setEngines(1); g.step(dt, ground, wind);
    thr[fl] = g.engines[0].thrust;
  }
  const mono = thr[0] > thr[100] && thr[100] > thr[200] && thr[200] > thr[280] && thr[280] > thr[310];
  check('thrust falls with altitude at M 0.5 (lapse fitted to the AFM MCT climb and cruise tables)', mono && thr[280] < 0.6 * thr[0] && thr[280] > 0.3 * thr[0], `SL ${(thr[0] / 1000).toFixed(2)}, FL100 ${(thr[100] / 1000).toFixed(2)}, FL200 ${(thr[200] / 1000).toFixed(2)}, FL280 ${(thr[280] / 1000).toFixed(2)}, FL310 ${(thr[310] / 1000).toFixed(2)} kN`);
}

// ---- 3. take-off: SL ISA, MTOW, flaps 50 %, full power set before brake release, rotate at 90 KIAS: ground roll to lift-off, published 1,910 ft ----
let takeoffRoll = null;
{
  const f = fresh(0, 0, true); f.setFlaps(1); f.flaps = FLAP_DEG[1]; f.setTakeoffTrim(); f.parkingBrake = true; fly(f, 8, (g) => { g.throttle = 1; });
  f.parkingBrake = false; const x0 = f.pos.clone(); let lift = null, scrape = false, vrAt = null;
  fly(f, 50, (g, t) => {
    g.throttle = 1; const rot = kias(g) > SF50.VR;
    if (rot && vrAt === null) vrAt = g.pos.distanceTo(x0);
    g.ctrl.de = rot ? clampv(6 * (5 * Math.PI / 180 - pitchOf(g)) - 1.0 * g.w.z, -1, 1) : 0; level(g);
    if (!lift && !g.onGround) lift = g.pos.clone();
    if (g.events.some((e) => e.type === 'scrape')) scrape = true; g.events.length = 0;
  });
  takeoffRoll = lift ? lift.distanceTo(x0) : Infinity;
  check('take-off ground roll, flaps 50 %, take-off trim, rotate at 90 KIAS to 5 deg (AFM technique)', !f.crashed && !scrape && takeoffRoll > 1910 / FT * 0.92 && takeoffRoll < 1910 / FT * 1.08,
    `${(takeoffRoll * FT).toFixed(0)} ft (${takeoffRoll.toFixed(0)} m; published G3 1,910 ft at 6,000 lb, SL ISA), VR reached after ${(vrAt * FT).toFixed(0)} ft, ${kias(f).toFixed(0)} KIAS and ${f.pos.y.toFixed(0)} m up after 50 s`);
}

// ---- 3b. ground handling with keyboard-style (all-or-nothing) pedals, and a rejected take-off ----
for (const kt of [15, 30, 45]) {
  const f = fresh(0, 0, true); f.parkingBrake = false; f.setFlaps(1); while (kias(f) < kt && !f.crashed) fly(f, 0.1, (g) => { g.throttle = 1; });
  let minPitch = 99, maxRate = 0; fly(f, 2, (g) => { g.throttle = 1; g.ctrl.dr = 1; minPitch = Math.min(minPitch, pitchOf(g)); maxRate = Math.max(maxRate, Math.abs(g.w.y)); });
  check(`full pedal held 2 s at ${kt} KIAS: turns without a nose strike or crash`, !f.crashed && minPitch > -5 * Math.PI / 180 && maxRate < 45 * Math.PI / 180, `min pitch ${(minPitch * 180 / Math.PI).toFixed(1)} deg, max yaw rate ${(maxRate * 180 / Math.PI).toFixed(0)} deg/s`);
}
{
  const f = fresh(0, 0, true); f.parkingBrake = false; f.setFlaps(1); while (kias(f) < 90 && !f.crashed) fly(f, 0.1, (g) => { g.throttle = 1; });
  const x0 = f.pos.x; fly(f, 40, (g) => { g.throttle = 0; g.brakes = 1; level(g); }); const d = f.pos.x - x0, v = Math.hypot(f.vel.x, f.vel.z);
  check('rejected take-off from 90 KIAS: idle, max braking, stops straight', !f.crashed && v < 0.5 && d > 400 && d < 1000 && Math.abs(f.pos.z) < 5, `stopped in ${(d * FT).toFixed(0)} ft (${d.toFixed(0)} m), ${f.pos.z.toFixed(1)} m off the centreline`);
}

// ---- 4. climb: clean-up (gear and flaps up), full thrust at 170 KIAS, sea level, MTOW ----
{
  const mk = (g) => { const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; f.reset(new THREE.Vector3(0, 300, 0), 90, 170 / KT, false, g); return f; };
  let lo = 0, hi = 25; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (mk(mid).throttle < 0.9999) lo = mid; else hi = mid; } // the steady climb angle at full thrust
  const f = mk((lo + hi) / 2), y0 = f.pos.y, pt = pitchOf(f);
  const clean = !f.gearDown && f.flaps === 0;
  fly(f, 30, (g) => { g.throttle = 1; holdPitch(pt)(g); });
  const fpm = (f.pos.y - y0) / 30 * 60 * FT;
  check('initial climb after clean-up, 170 KIAS, max continuous (AFM 1,860 fpm at 177 KIAS)', clean && !f.crashed && fpm > 1640 && fpm < 2080, `${fpm.toFixed(0)} fpm at ${kias(f).toFixed(0)} KIAS, gamma ${((lo + hi) / 2).toFixed(1)} deg, pitch ${(pt * 180 / Math.PI).toFixed(1)} deg (AFM: 1,860 fpm at 177 KIAS, MCT)`);
}

// ---- 5. stall: 1 g wings-level stall speed, full flaps ~67 KCAS at MTOW, clean ~84 (VREF flaps UP 109 / 1.3) ----
{
  const out = [];
  for (const [notch, gear, kt0] of [[0, false, 130], [1, true, 110], [2, true, 100]]) {
    // trimmed analytic stall (CLmax with the V-tail's trim download)
    const fd = FLAP_DEG[notch], a = stallAlpha(fd), W = (SF50.EMPTY + SF50.FUEL_MAX) * G;
    const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; f.reset(new THREE.Vector3(0, 3000, 0), 90, kt0 / KT, false); reconfig(f, notch, gear);
    const ana = Math.sqrt(2 * W / (1.225 * SF50.S * sf50Lift(a, fd))) * KT;
    // decelerate at idle holding altitude (~1.5 kt/s) until the angle of attack reaches the stall angle
    f.throttle = 0; let vs = null, pT = pitchOf(f), peak = 0; const alt = f.pos.y;
    fly(f, 200, (g) => { g.throttle = 0; pT += 0.0035 * dt; const k = kq(g); g.ctrl.de = clampv(k * 4 * (pT - pitchOf(g)) - 1.0 * k * g.w.z, -1, 1); level(g); if (vs === null && g.out.aoaNorm >= 0.999) vs = kias(g); peak = Math.max(peak, Math.abs(bankOf(g))); });
    out.push({ notch, ana, vs, f, peak });
  }
  const [c0, c1, c2] = out;
  check('stall speed, flaps 100 %, gear down', !c2.f.crashed && Math.abs(c2.vs - 67) < 5 && Math.abs(c2.ana - 67) < 5, `${c2.vs.toFixed(1)} KIAS flown (CLmax alpha, 1 g decel), ${c2.ana.toFixed(1)} analytic wing (published 67 KCAS at MTOW)`);
  check('stall speed, flaps 50 %', !c1.f.crashed && c1.vs > 66 && c1.vs < 80, `${c1.vs.toFixed(1)} KIAS flown, ${c1.ana.toFixed(1)} analytic (VREF 100 / 1.3 = 77)`);
  check('stall speed, clean', !c0.f.crashed && c0.vs > 80 && c0.vs < 88, `${c0.vs.toFixed(1)} KIAS flown, ${c0.ana.toFixed(1)} analytic (est. 80-88)`);
  check('stall is gentle: wings stay level to the break, aoaNorm 0..1', out.every((o) => o.peak < 12 * Math.PI / 180 && o.f.out.aoaNorm <= 1 && o.f.out.aoaNorm >= 0), `max bank ${out.map((o) => (o.peak * 180 / Math.PI).toFixed(1)).join('/')} deg through the stall`);
  const f = fresh(3000, 120); f.step(dt, ground, wind); const hi = f.out.aoaNorm;
  const g = fresh(3000, 250); g.step(dt, ground, wind);
  check('aoaNorm scale: low at cruise speed, shaker flag near the stall', g.out.aoaNorm < 0.35 && hi > g.out.aoaNorm && !f.out.shaker && c0.f.out.aoaNorm >= 0.999, `aoaNorm ${g.out.aoaNorm.toFixed(2)} at 250 KIAS, ${hi.toFixed(2)} at 120 KIAS, ${c0.f.out.aoaNorm.toFixed(2)} at the stall`);
}

// ---- 6. cruise: FL280 ISA, mid weight (2,265 kg), thrust lever to maximum continuous: 311 KTAS (G2) to 317 KTAS (G3) ----
let cruiseFF = 0;
{
  const alt = 28000 / FT, f = new SF50Model(); f.fuel = 450; f.reset(new THREE.Vector3(0, alt, 0), 90, 300 / KT, false);
  const st = { i: 0 }; fly(f, 420, (g) => { g.throttle = 1; pilotAlt(alt, st)(g); });
  const ktas = f.out.V * KT; cruiseFF = lbh(f);
  check('cruise FL280, max continuous thrust', !f.crashed && ktas > 300 && ktas < 325 && f.out.M < 0.56 && Math.abs(f.pos.y - alt) < 30, `${ktas.toFixed(1)} KTAS, M ${f.out.M.toFixed(3)}, ${f.mass.toFixed(0)} kg, alt ${(f.pos.y * FT).toFixed(0)} ft (published 311-317 KTAS, MMO 0.53)`);
  check('fuel flow at FL280 max cruise ~500 lb/h', cruiseFF > 440 && cruiseFF < 560 && f.engines[0].n1 > 90, `${cruiseFF.toFixed(0)} lb/h, N1 ${f.engines[0].n1.toFixed(0)} % ITT ${f.engines[0].itt.toFixed(0)} C (published ~500 lb/h, 400-430 at FL310)`);
  const g = new SF50Model(); g.fuel = 450; const a31 = 31000 / FT; g.reset(new THREE.Vector3(0, a31, 0), 90, 0.5 * isa(a31).a, false);
  const st2 = { i: 0 }; fly(g, 420, (h) => { h.throttle = 1; pilotAlt(a31, st2)(h); });
  check('FL310 service ceiling: can hold level flight at max continuous', !g.crashed && Math.abs(g.pos.y - a31) < 60 && g.out.V * KT > 270, `${(g.out.V * KT).toFixed(0)} KTAS, M ${g.out.M.toFixed(3)}, ${lbh(g).toFixed(0)} lb/h`);
}

// ---- 7. hands-off stability: trimmed cruise and trimmed approach, 60 s without input; pitch doublet damps ----
{
  const cruise = new SF50Model(); const alt = 25000 / FT; cruise.fuel = 450; cruise.reset(new THREE.Vector3(0, alt, 0), 90, 0.48 * isa(alt).a, false);
  const apr = fresh(900, 95), h0 = hdgOf(apr), c0h = hdgOf(cruise);
  for (const [name, f, h] of [['cruise FL250, M 0.48', cruise, c0h], ['approach, flaps 100 %, gear down, 95 KIAS', apr, h0]]) {
    f.step(dt, ground, wind); const y0 = f.pos.y, v0 = kias(f); let dh = 0, db = 0, dy = 0, dv = 0;
    fly(f, 60, (g) => { dh = Math.max(dh, dHdg(hdgOf(g), h)); db = Math.max(db, Math.abs(bankOf(g)) * 180 / Math.PI); dy = Math.max(dy, Math.abs(g.pos.y - y0)); dv = Math.max(dv, Math.abs(kias(g) - v0)); });
    check(`hands-off 60 s, ${name}`, !f.crashed && dh < 1.5 && db < 1.5 && dy < 40 && dv < 6 && (name.startsWith('app') ? f.gearPos === 1 && f.flaps === FLAP_DEG[2] : true),
      `heading ${dh.toFixed(2)} deg, bank ${db.toFixed(2)} deg, altitude ${dy.toFixed(1)} m, speed ${dv.toFixed(1)} kt, trim ${f.trim.toFixed(2)}, thrust lever ${f.throttle.toFixed(2)}`);
  }
  // 3 degree descent trimmed on the approach: the path holds
  const g = fresh(900, 95, false, -3); const vs0 = g.vel.y; fly(g, 40, () => {});
  check('hands-off 3 degree approach holds the path 40 s', !g.crashed && Math.abs(g.vel.y - vs0) < 0.8 && Math.abs(kias(g) - 95) < 5, `sink ${(-vs0).toFixed(2)} -> ${(-g.vel.y).toFixed(2)} m/s, ${kias(g).toFixed(1)} KIAS, lever ${g.throttle.toFixed(2)}`);
  // pitch doublet
  for (const [name, f0] of [['cruise', () => { const f = new SF50Model(); f.fuel = 450; f.reset(new THREE.Vector3(0, alt, 0), 90, 0.48 * isa(alt).a, false); return f; }], ['approach', () => fresh(900, 95)]]) {
    const f = f0(); let early = 0, late = 0, hmax = 0;
    fly(f, 14, (g, t) => { g.ctrl.de = t < 0.4 ? 0.12 : t < 0.8 ? -0.12 : 0; g.ctrl.da = 0; g.ctrl.dr = 0; const q = Math.abs(g.w.z); if (t < 3) early = Math.max(early, q); if (t > 8) late = Math.max(late, q); });
    check(`pitch doublet damps, ${name}`, !f.crashed && early > 0.01 && late < 0.2 * early, `peak pitch rate ${(early * 57.3).toFixed(1)} deg/s in 3 s, ${(late * 57.3).toFixed(2)} deg/s after 8 s`);
  }
  // Dutch roll: a rudder kick with the yaw damper off still dies out
  const d = fresh(900, 95); d.sasOn = false; let ymax = 0, ylate = 0; fly(d, 20, (g, t) => { g.ctrl.dr = t < 0.5 ? 0.3 : 0; ymax = Math.max(ymax, Math.abs(g.w.y)); if (t > 12) ylate = Math.max(ylate, Math.abs(g.w.y)); });
  check('Dutch roll damps without the yaw damper (approach)', !d.crashed && ylate < 0.25 * ymax, `peak yaw rate ${(ymax * 57.3).toFixed(1)} deg/s, ${(ylate * 57.3).toFixed(2)} deg/s after 12 s`);
}

// ---- 8. power-pitch coupling: the canted engine's thrust line passes ~0.14 m above the CG, so power nudges the nose down only a little ----
{
  const mk = () => { const f = fresh(3000, 140); return f; };
  const base = mk(), up = mk(); let qb = 0, qu = 0, minPower = 0;
  fly(base, 1.5, (g) => { g.ctrl.de = 0; g.ctrl.da = 0; g.ctrl.dr = 0; qb = g.w.z; });
  fly(up, 1.5, (g) => { g.throttle = 1; g.ctrl.de = 0; g.ctrl.da = 0; g.ctrl.dr = 0; qu = g.w.z; minPower = Math.min(minPower, g.w.z - base.w.z); });
  const dT = up.engines[0].thrust - base.engines[0].thrust, mom = -0.14 * dT;
  check('power increase pitches the nose down, gently ("little pitch change with power")', !up.crashed && qu - qb < 0 && qu - qb > -1 / 57.3 && dT > 1000, `pitch rate ${((qu - qb) * 57.3).toFixed(2)} deg/s relative to hands-off after 1.5 s, thrust +${(dT / 1000).toFixed(1)} kN (${(mom / 1000).toFixed(1)} kN m about the CG)`);
  const dn = mk(), cut = mk(); let qd = 0, qc = 0; fly(dn, 1.5, (g) => { g.ctrl.de = 0; qd = g.w.z; }); fly(cut, 1.5, (g) => { g.throttle = 0; g.ctrl.de = 0; qc = g.w.z; });
  check('power reduction pitches the nose up', !cut.crashed && qc - qd > 0.002, `pitch rate +${((qc - qd) * 57.3).toFixed(2)} deg/s relative to hands-off after 1.5 s`);
}

// ---- 9. gear: timing, weight-on-wheels interlock, gear-up landing, overspeed ----
{
  const f = fresh(1500, 200); f.gearDown = true; f.gearPos = 1; f.step(dt, ground, wind);
  f.events.length = 0; const ok = f.setGear(false); let tUp = null, tDn = null;
  fly(f, 12, (g, t) => { if (tUp === null && g.gearPos === 0) tUp = t; });
  const accepted = f.setGear(true); fly(f, 12, (g, t) => { if (tDn === null && g.gearPos === 1) tDn = t; });
  check('gear retracts and extends in about 6 s', ok && accepted && tUp > 5 && tUp < 7 && tDn > 5 && tDn < 7 && f.events.includes('gear-lock'), `up ${tUp && tUp.toFixed(1)} s, down ${tDn && tDn.toFixed(1)} s`);
  const g = fresh(0, 0, true); fly(g, 2, () => {});
  const refused = g.setGear(false) === false && g.gearDown; g.gearDown = false; fly(g, 1, () => {});
  check('gear cannot retract with weight on wheels', !g.crashed && refused && g.gearDown && g.gearPos === 1 && g.events.some((e) => e.type === 'gear-interlock'), `setGear(false) refused; lever forced back down by the squat switch`);
  // gear up, wheels stay stowed: a landing on the belly crashes as in the base model
  const u = new SF50Model(); u.fuel = SF50.FUEL_MAX; u.reset(new THREE.Vector3(0, 60, 0), 90, 62, false); reconfig(u, 2, false);
  fly(u, 40, (h) => { h.throttle = 0.15; holdPitch(0.0 - 0.01)(h); });
  check('gear-up landing is a crash (belly/strike), not a quiet touchdown', !!u.crashed && /hit the ground|hard landing/.test(u.crashed), `${u.crashed}`);
  const o = fresh(3000, 245); o.gearDown = true; o.events.length = 0; let gev = false, bmax = 0;
  fly(o, 12, (h) => { h.throttle = 1; holdPitch(-0.12)(h); if (h.events.some((e) => e.type === 'gear-overspeed')) gev = true; bmax = Math.max(bmax, h.out.buffet || 0); h.events.length = 0; });
  check('gear extended above VLE: warning flag and event, no crash', !o.crashed && gev && o.out.gearOverspeed && bmax > 0.05, `${kias(o).toFixed(0)} KIAS (VLE ${SF50.VLE}), peak buffet ${bmax.toFixed(2)}`);
  const fo = (kt) => { const w = new SF50Model(); w.fuel = SF50.FUEL_MAX; w.reset(new THREE.Vector3(0, 3000, 0), 90, kt / KT / Math.sqrt(isa(3000).rho / 1.225), false); reconfig(w, 2, true); fly(w, 3, (g) => { g.throttle = 0.8; holdPitch(pitchOf(g))(g); }); return w; };
  const hi = fo(175), lo = fo(125);
  check('flap overspeed flag above VFE (150 KIAS at 100 %)', !hi.crashed && !lo.crashed && hi.out.flapOverspeed === true && lo.out.flapOverspeed === false, `flag ${hi.out.flapOverspeed} at ${kias(hi).toFixed(0)} KIAS, ${lo.out.flapOverspeed} at ${kias(lo).toFixed(0)} KIAS`);
  check('setFlaps clamps 0..2', (() => { const m = new SF50Model(); m.setFlaps(5); const a = m.flapCmd; m.setFlaps(-3); const b = m.flapCmd; m.setFlaps(1.4); return a === 2 && b === 0 && m.flapCmd === 1; })(), 'notches 0, 1, 2');
}

// ---- 10. landing: stabilised 3 degree approach at VREF 89 KIAS, flaps 100 %, flare, max braking from touchdown: published ground roll 1,622 ft ----
{
  const gam = 3, h0 = 300, x0 = -h0 / Math.tan(gam * Math.PI / 180), wheelsY = SF50_CG.y - 0.08, VREF = 89;
  const f = new SF50Model(); f.fuel = SF50.FUEL_MAX; f.reset(new THREE.Vector3(x0, h0 + wheelsY, 0), 90, VREF / KT, false, -gam);
  const apr = f.gearDown && f.flaps === FLAP_DEG[2];
  let thr = f.throttle, pT = pitchOf(f), pApp = pT, iT = 0, fI = 0, td = null, tdKt = 0, tdSink = 0, stop = null, maxNz = 0;
  for (let t = 0; t < 400 && !f.crashed; t += dt) {
    const h = f.pos.y - wheelsY, k = kq(f);
    if (td === null && !f.onGround) {
      const hid = -f.pos.x * Math.tan(gam * Math.PI / 180);
      const vsT = h > 10 ? -f.out.V * Math.sin(gam * Math.PI / 180) - clampv((h - hid) * 0.03, -1.5, 1.5) : -(0.45 + 0.17 * h);
      if (h > 10) iT = clampv(iT + (vsT - f.vel.y) * 0.0015 * dt, -0.1, 0.1);
      pT = clampv(pApp + iT + 0.03 * (vsT - f.vel.y), -0.12, 0.2);
      if (h < 10) pT = Math.max(pT, 0.045 * (1 - h / 10)); // flare: the nose up to ~+2.5 deg at the wheels (the approach attitude is nose-low)
      thr = h < 6 ? 0 : clampv(thr - (kias(f) - VREF) * 0.004 * dt, 0, 1); f.throttle = thr;
      if (h < 10) fI = clampv(fI + 2.5 * (pT - pitchOf(f)) * dt, 0, 0.6);
      f.ctrl.de = clampv(fI + k * (h < 10 ? 10 : 4) * (pT - pitchOf(f)) - (h < 10 ? 2.5 : 1.0) * k * f.w.z, -1, 1); level(f);
    } else if (td === null) { td = f.pos.x; tdKt = kias(f); tdSink = -f.vel.y; }
    if (td !== null) { f.throttle = 0; f.brakes = 1; f.ctrl.de = clampv(-0.1 - 2 * (pitchOf(f) + 0.01) - 0.5 * f.w.z, -1, 1); level(f); if (f.vel.length() < 1) { stop = f.pos.x; break; } }
    f.step(dt, ground, wind); maxNz = Math.max(maxNz, f.out.nz || 1);
  }
  last = f;
  const roll = stop !== null && td !== null ? stop - td : Infinity;
  check('landing: stabilised approach, flare, touchdown without damage', apr && !f.crashed && td !== null && tdKt > 72 && tdKt < 95 && tdSink < 2.5, `touchdown ${tdKt.toFixed(0)} KIAS, sink ${tdSink.toFixed(2)} m/s, max ${maxNz.toFixed(2)} g`);
  check('landing ground roll, max braking, flaps 100 %', !f.crashed && roll > 1622 / FT * 0.92 && roll < 1622 / FT * 1.08, `${(roll * FT).toFixed(0)} ft (${roll.toFixed(0)} m; published 1,622 ft)`);
}

// ---- 11. robustness: random inputs through flaps, gear, thrust, all axes: no NaN / Infinity, crash record like the C172 ----
{
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let bad = false, crashes = 0, runs = 0, simSec = 0;
  for (let run = 0; run < 6; run++) {
    const f = run % 2 ? fresh(3000, 140) : fresh(0, 0, true); runs++; f.crashOff = run >= 4; // the last two soak up impacts and overstress so the whole 240 s is flown
    let cmd = [0, 0, 0, 0.5], tNext = 0;
    fly(f, 240, (g, t) => {
      if (t >= tNext) { tNext = t + 0.2 + rnd() * 1.5; cmd = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd()]; if (rnd() < 0.15) g.setFlaps(Math.floor(rnd() * 3)); if (rnd() < 0.1) g.setGear(rnd() < 0.5); if (rnd() < 0.05) g.brakes = rnd(); }
      g.ctrl.de = cmd[0] * 0.5; g.ctrl.da = cmd[1] * 0.6; g.ctrl.dr = cmd[2] * 0.6; g.throttle = cmd[3];
      const vals = [g.pos.x, g.pos.y, g.pos.z, g.vel.x, g.vel.y, g.vel.z, g.w.x, g.w.y, g.w.z, g.quat.x, g.quat.w, g.fuel, g.engines[0].n1, g.engines[0].itt, g.engines[0].ff, g.out.alpha];
      if (t > 0.1) vals.push(g.out.aoaNorm, g.out.ff, g.out.nz);
      if (!vals.every(Number.isFinite)) bad = true;
    });
    simSec += 240; if (f.crashed) { crashes++; if (!f.crashInfo || !(f.crashInfo.speed >= 0) || !f.crashKind || !f.events.includes('crash')) bad = true; }
  }
  check('random inputs: finite state throughout', !bad, `${runs} runs of up to ${simSec} s in total, ${crashes} ended in a crash with a proper record`);
  const d = fresh(15, 150); d.vel.y = -25; fly(d, 5, (g) => { g.throttle = 0; });
  const ci = d.crashInfo;
  check('crash record: dive into the ground', !!d.crashed && ci && ci.kind === 'impact' && ci.sinkRate > 8 && d.crashKind === 'impact' && d.events.includes('crash') && d.crashVel.length() > 20 && d.vel.length() === 0,
    `${d.crashed}; ${ci ? `${ci.speed.toFixed(0)} m/s, sink ${ci.sinkRate.toFixed(0)} m/s, mass ${ci.mass.toFixed(0)} kg, gear ${ci.gearDown ? 'down' : 'up'}` : 'no record'}`);
  const s = new SF50Model(); s.fuel = SF50.FUEL_MAX; s.reset(new THREE.Vector3(0, 20, 0), 90, 60, false); s.crashOff = true; s.vel.y = -30; fly(s, 30, () => {});
  check('Crash option off: impacts are absorbed', !s.crashed && Number.isFinite(s.pos.y), `no crash record, y ${s.pos.y.toFixed(2)} m`);
}

// ---- fuel burn moves the CG slightly forward, inertia and mass follow ----
{
  const f = fresh(0, 0, true), full = f.massProps().cgx, m1 = f.mass; f.fuel = 0; const empty = f.massProps().cgx;
  check('mass and CG follow fuel', Math.abs(full - SF50_CG.x) < 1e-9 && empty > full && empty - full < 0.15 && Math.abs(m1 - 2722) < 2 && Math.abs(f.mass - 1815) < 1, `CG ${full.toFixed(3)} -> ${empty.toFixed(3)} m (${((empty - full) / SF50.C * 100).toFixed(1)} % MAC), mass ${m1.toFixed(0)} -> ${f.mass.toFixed(0)} kg`);
}
// ---- AFM P/N 31452-001 figures (6,000 lb, ISA, MCT): climb schedule, cruise, glide, roll, flap pitch, trim band, stall protection ----
{
  const D = 180 / Math.PI, tasOf = (k, alt) => k / KT / Math.sqrt(isa(alt).rho / 1.225);
  const at = (altFt, k, gamma = 0, notch = 0, gear = false) => { const f = fresh(altFt / FT, tasOf(k, altFt / FT) * KT); reconfig(f, notch, gear, gamma); return f; };
  // steady climb: the flight-path angle at which the trimmed lever reaches max continuous
  const vsAt = (altFt, k) => { let lo = 0, hi = 25; for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (at(altFt, k, mid).throttle < 0.9999) lo = mid; else hi = mid; }
    return at(altFt, k, lo).vel.length() * Math.sin(lo / D) * FT * 60; };
  const marks = {}; let t = 0;
  for (let h = 0; h < 28000; h += 500) { const k = 175 - 35 * clampv((h - 10000) / 18000, 0, 1); t += 500 / vsAt(h + 250, k); for (const m of [10000, 20000, 28000]) if (!marks[m] && h + 500 >= m) marks[m] = t; }
  check('time to climb on the AFM schedule (175 KIAS falling to 140): FL100 / FL200 / FL280 in 6 / 13 / 21 min, within 15 %',
    [[10000, 6], [20000, 13], [28000, 21]].every(([m, ref]) => Math.abs(marks[m] / ref - 1) < 0.15), `${(marks[10000]).toFixed(1)} / ${marks[20000].toFixed(1)} / ${marks[28000].toFixed(1)} min`);
  const c = at(25000, 175); let i = 0;
  fly(c, 300, (g) => { g.throttle = 1; const e = (25000 / FT - g.pos.y) / 30 - g.vel.y / 6; i = clampv(i + e * dt * 0.05, -0.5, 0.5); g.ctrl.de = clampv(0.2 * e + i - 2 * g.w.z, -1, 1); level(g); });
  const ktas = c.out.V * KT, gph = lbh(c) / 6.7;
  check('FL250 cruise at max continuous: AFM 307 KTAS / 78 gph (G1; the G3 is a little faster)', !c.crashed && ktas > 300 && ktas < 325 && gph > 68 && gph < 88, `${ktas.toFixed(0)} KTAS, ${gph.toFixed(0)} gph`);
  let best = 0, bestK = 0; for (let k = 95; k <= 140; k += 5) { const f = at(8000, k); f.engineOn = false; fly(f, 0.5, (g) => { g.throttle = 0; }); const ld = f.out.CL / f.out.CD; if (ld > best) { best = ld; bestK = k; } }
  check('best glide, engine out: AFM 14.7:1 at 114 KIAS', best > 13.8 && best < 15.6 && Math.abs(bestK - 114) <= 10, `${best.toFixed(1)}:1 at ${bestK} KIAS`);
  const rr = [100, 140, 250].map((k) => { const f = at(5000, k); let pk = 0; fly(f, 2, (g) => { g.ctrl.da = 1; pk = Math.max(pk, Math.abs(g.w.x)); }); return pk * D; });
  check('roll rate, full aileron: light and docile, not fighter-like (below 40 deg/s at 140 KIAS, below 75 at VMO)', rr[0] > 12 && rr[1] < 40 && rr[2] < 75 && rr[2] > rr[0],
    `${rr.map((v) => v.toFixed(0)).join(' / ')} deg/s at 100 / 140 / 250 KIAS`);
  const fl = at(5000, 150), p0 = pitchOf(fl); fl.setFlaps(1); fly(fl, 2, (g) => { g.ctrl.de = 0; level(g); });
  const drop = (pitchOf(fl) - p0) * D;
  check('50 % flaps at 150 KIAS, hands off: the nose drops about 5 deg in 2 s (Aviation Week flight report)', drop < -3 && drop > -7, `${drop.toFixed(1)} deg`);
  const to = fresh(0, 0, true); to.setFlaps(1); to.flaps = FLAP_DEG[1];
  const trims = { 'take-off': to.setTakeoffTrim(), climb: at(2000, 177, 6).trim, cruise: at(25000, 180).trim, approach: at(2000, 100, -3, 2, true).trim };
  check('trim wheel stays inside its travel in every phase (take-off band set on the runway)', Object.values(trims).every((v) => Math.abs(v) < 0.8) && trims['take-off'] > 0,
    Object.entries(trims).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
  const st = at(5000, 100); let pushed = false, amax = 0;
  fly(st, 15, (g) => { g.throttle = 0; g.ctrl.de = 1; level(g); if (g.out.pusher) pushed = true; amax = Math.max(amax, g.out.alpha); });
  check('stick pusher: a held full pull at idle is pushed back from the stall angle, airborne only', pushed && !st.crashed && amax < stallAlpha(st.flaps) + 0.06 && !to.out?.pusher,
    `alpha peak ${(amax * D).toFixed(1)} deg vs stall ${(stallAlpha(0) * D).toFixed(1)}`);
}
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('sf50-fdm-test ok');
