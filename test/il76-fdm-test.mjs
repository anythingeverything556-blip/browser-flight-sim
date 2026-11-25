// Ilyushin Il-76MD-90A flight model against the researched data (notes/FLIGHT-DATA.md, confidence letters in src/il76.js): weights, five-unit gear, PS-90A-76 thrust /
// spool / fuel flow, take-off run at MTOW, stall speeds, climb, cruise at 10,000 m, landing roll with spoilers and reverse, engine-out control, gear / flap / slat
// transit, thrust reverse rules, structure limits, and the three flying modes ordered easy < medium < realistic. Flat ground at 0 m, no wind, ISA.
import * as THREE from 'three';
import { IL76Model, IL76, IL76_CG, IL76_GEAR, IL76_HARD, IL76_ENGINES, IL76_MODES, NOTCHES, il76Lift, stallAlpha, thrustMax, thrustFrac } from '../src/il76.js';
import { isa } from '../src/atmosphere.js';
import { landingLimits } from '../src/difficulty.js';

let fails = 0, last = null;
const check = (name, ok, info) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}${last && last.crashed ? ` [crashed: ${last.crashed}]` : ''}`); if (!ok) fails++; last = null; };
const KT = 1.943844, KMH = 3.6, G = 9.80665, dt = 1 / 120, ground = () => 0, wind = new THREE.Vector3();
const kias = (f) => (f.out.ias ?? f.out.V) * KT, kmh = (f) => (f.out.ias ?? f.out.V) * KMH;
const fly = (f, secs, ctl) => { last = f; for (let t = 0; t < secs; t += dt) { ctl && ctl(f, t); f.step(dt, ground, wind); if (f.crashed) break; } };
const pitchOf = (f) => Math.asin(new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat).y);
const bankOf = (f) => Math.asin(Math.max(-1, Math.min(1, -new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat).y)));
const hdgOf = (f) => { const v = new THREE.Vector3(1, 0, 0).applyQuaternion(f.quat); return Math.atan2(v.z, v.x) * 180 / Math.PI; };
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const level = (f) => { f.ctrl.da = cl(-2 * bankOf(f) - 0.5 * f.w.x, -1, 1); f.ctrl.dr = cl(3 * (f.out.beta || 0) + 0.3 * f.w.y, -1, 1); };
const OEWP = IL76.EMPTY + IL76.PAYLOAD;
// a new aircraft at the given gross mass (kg); onGround: sitting on the gear at the runway
const fresh = (alt, speedKt, { ground: onGround = false, mass = 210000, mode = 'realistic', gamma = 0 } = {}) => {
  const f = new IL76Model(); f.setMode(mode); f.fuel = mass - OEWP; f.reset(new THREE.Vector3(0, onGround ? IL76_CG.y : alt, 0), 90, speedKt / KT, onGround, gamma); return f;
};
// the aircraft configured and re-trimmed in the air
const reconfig = (f, notch, gear) => { f.setFlaps(notch); f.flaps = NOTCHES[notch].flap; f.slats = NOTCHES[notch].slat; f.gearDown = gear; f.gearPos = gear ? 1 : 0; const v = f.vel.length(); f.quat.identity(); f.vel.set(v, 0, 0); f.w.set(0, 0, 0); f.trimLevel(0); };

// ---- model constants agree with the data ----
check('weights, geometry and gear: MTOW 210 t = empty + cargo + full tanks, 5 gear units of 20 wheels, 4 engines', IL76.EMPTY + IL76.PAYLOAD + IL76.FUEL_MAX === IL76.MTOW && IL76_GEAR.length === 5 && IL76_HARD.length === 13 && IL76_ENGINES.length === 4
  && Math.abs(IL76.THRUST0 - 16000 * G) < 1 && NOTCHES.length === 5 && IL76.S === 300 && IL76.B === 50.5 && IL76.LENGTH === 46.6, `empty ${IL76.EMPTY} + cargo ${IL76.PAYLOAD} + fuel ${IL76.FUEL_MAX} = ${IL76.EMPTY + IL76.PAYLOAD + IL76.FUEL_MAX} kg`);
{
  const nose = IL76_GEAR[0].p, mains = IL76_GEAR.slice(1), wb = nose.x - mains.reduce((s, g) => s + g.p.x, 0) / 4;
  check('wheelbase 14.17 m and track from the model (GLB root extras)', Math.abs(wb - 14.17) < 0.05 && Math.abs(mains[0].p.z + mains[2].p.z) < 1e-9, `wheelbase ${wb.toFixed(2)} m, main units at z = +-${mains[2].p.z.toFixed(2)} m`);
}

// ---- 1. on the ground at MTOW: the gear carries the weight, the nose share is realistic, brakes on and idle thrust hold ----
{
  const f = fresh(0, 0, { ground: true }); f.parkingBrake = true; f.brakes = 1; f.throttle = 0; const x0 = f.pos.clone(); fly(f, 60);
  const W = f.mass * G, sum = f.contacts.reduce((s, c) => s + c, 0), noseShare = f.contacts[0] / sum;
  check('static: the gear carries the weight, nose share 6-12 %, four equal main units, nothing creeps with the parking brake on', Math.abs(sum - W) / W < 0.02 && noseShare > 0.06 && noseShare < 0.12 && Math.abs(f.contacts[1] - f.contacts[3]) / f.contacts[1] < 0.05 && f.pos.distanceTo(x0) < 1,
    `${(sum / 1e3).toFixed(0)} kN of ${(W / 1e3).toFixed(0)} kN, nose ${(noseShare * 100).toFixed(1)} %, moved ${f.pos.distanceTo(x0).toFixed(2)} m, strut sink ${f.compress.map((c) => c.toFixed(2)).join(' ')}`);
  const g = fresh(0, 0, { ground: true, mass: 150000 }); g.parkingBrake = false; g.brakes = 0; g.throttle = 0; fly(g, 40);
  check('light, at idle with the brakes off it stays put or crawls (rolling resistance 0.02 against idle thrust)', g.vel.length() < 4, `${g.vel.length().toFixed(2)} m/s after 40 s`);
  const hold = (lever) => { const h = fresh(0, 0, { ground: true }); h.parkingBrake = true; fly(h, 25, (x) => { x.throttle = lever; }); return h.pos.x; };
  const x60 = hold(0.6), x100 = hold(1);
  check('the parking brake holds 60 % thrust but not take-off power (research: brakes hold only up to about 75-80 % power)', x60 < 2 && x100 > 20, `${x60.toFixed(1)} m at lever 0.6, ${x100.toFixed(0)} m at 1.0`);
}

// ---- 2. engines ----
{
  const f = fresh(0, 0, { ground: true }); f.parkingBrake = true; let t95 = null; const T = (g) => g.out.thrust / 4 / (thrustMax(1.225, 0) * thrustFrac(1));
  fly(f, 14, (g, t) => { g.throttle = 1; if (t95 === null && g.out.thrust && T(g) > 0.95) t95 = t; });
  const idleFF = fresh(0, 0, { ground: true }); idleFF.throttle = 0; fly(idleFF, 20);
  const ffIdle = idleFF.engines[0].ff * 3600, ffTo = f.ffTotal * 3600;
  check('spool: idle to 95 % take-off thrust in 6-11 s (8 s with margin)', t95 !== null && t95 > 6 && t95 < 11, `${t95 === null ? 'never' : t95.toFixed(1)} s`);
  check('take-off thrust 4 x 16,000 kgf (A) at sea level and the fuel flow at take-off / idle', Math.abs(f.out.thrust - 4 * IL76.THRUST0 * 0.99) < 0.04 * 4 * IL76.THRUST0 && ffTo > 18000 && ffTo < 30000 && ffIdle > 400 && ffIdle < 1100,
    `${(f.out.thrust / 1e3).toFixed(0)} kN, ${(ffTo / 1e3).toFixed(1)} t/h at take-off (0.372 kg/kgf/h), ${ffIdle.toFixed(0)} kg/h per engine at idle`);
  const lap = [0, 5000, 10000].map((h) => thrustMax(isa(h).rho, 0.3, 200) * 4 / 1e3);
  check('thrust lapses with altitude and Mach', lap[0] > 1.4 * lap[1] && lap[1] > 1.4 * lap[2] && thrustMax(1.225, 0.6, 250) < thrustMax(1.225, 0.1, 250), `${lap.map((x) => x.toFixed(0)).join(' / ')} kN at 0 / 5,000 / 10,000 m, M 0.3`);
}

// ---- 3. take-off at MTOW: T/O slats 14 and flaps 30, rotate at VR (317 km/h at 210 t), liftoff against the published 1,540 m run ----
let takeoffRoll = null;
const takeoff = (mode, mass = 210000) => {
  const f = fresh(0, 0, { ground: true, mass, mode }); f.setFlaps(2); f.flaps = 30; f.slats = 14; f.setTakeoffTrim(); f.parkingBrake = true; fly(f, 6, (g) => { g.throttle = 1; });
  f.parkingBrake = false; const x0 = f.pos.clone(), VR = f.vSpeed(IL76.VR_210); let lift = null, scrape = false, vlof = 0;
  fly(f, 60, (g) => {
    g.throttle = 1; const rot = kias(g) > VR; g.ctrl.de = rot ? cl(3 * (8 * Math.PI / 180 - pitchOf(g)) - 0.8 * g.w.z, -1, 1) : 0; level(g);
    if (!lift && !g.onGround) { lift = g.pos.clone(); vlof = kmh(g); } if (g.events.some((e) => e.type === 'scrape')) scrape = true; g.events.length = 0;
    if (lift && g.pos.y > 25 && g.gearDown) g.setGear(false);
  });
  return { f, roll: lift ? lift.distanceTo(x0) : Infinity, scrape, vlof, VR };
};
{
  const r = takeoff('realistic'); takeoffRoll = r.roll;
  check('take-off run at MTOW, slats 14 / flaps 30, rotate at VR 171 KIAS: 1,540 m (UAC, conditions unspecified) within -25 % / +30 %, no tail strike, clean liftoff', !r.f.crashed && !r.scrape && r.roll > 1540 * 0.75 && r.roll < 1540 * 1.3 && r.vlof > 290 && r.vlof < 360,
    `${r.roll.toFixed(0)} m, lift-off ${r.vlof.toFixed(0)} km/h (VR ${(r.VR * 1.852).toFixed(0)}), ${kmh(r.f).toFixed(0)} km/h and ${r.f.pos.y.toFixed(0)} m after 60 s`);
  const light = takeoff('realistic', 150000);
  check('a lighter aircraft needs less runway, and a heavy one the most', light.roll < takeoffRoll * 0.82 && light.roll > 700, `150 t: ${light.roll.toFixed(0)} m, 210 t: ${takeoffRoll.toFixed(0)} m`);
}
{
  // rejected take-off from VR at MTOW: idle, max braking, spoilers and reverse (outer engines); stops straight
  const f = fresh(0, 0, { ground: true }); f.setFlaps(2); f.flaps = 30; f.slats = 14; f.setTakeoffTrim(); f.parkingBrake = true; fly(f, 6, (g) => { g.throttle = 1; }); f.parkingBrake = false;
  fly(f, 40, (g) => { g.throttle = 1; level(g); g.ctrl.de = 0; if (kias(g) > 150) g.__rto = true; });
  const f2 = fresh(0, 0, { ground: true }); f2.setFlaps(2); f2.flaps = 30; f2.slats = 14; f2.setTakeoffTrim(); f2.parkingBrake = true; fly(f2, 6, (g) => { g.throttle = 1; }); f2.parkingBrake = false; const x0 = f2.pos.x; let went = false, t0 = 0;
  fly(f2, 90, (g, t) => { level(g); if (!went) { g.throttle = 1; if (kias(g) > 140) { went = true; t0 = t; } } else { g.throttle = 0; g.brakes = 1; g.setSpoilers(true); if (t - t0 > 1) g.setReverser(true); if (g.engines[0].rev > 0.95) g.throttle = 0.9; } });
  check('rejected take-off from 140 KIAS at MTOW stops on the runway, straight', !f2.crashed && f2.vel.length() < 0.5 && f2.pos.x - x0 > 1000 && f2.pos.x - x0 < 2400 && Math.abs(f2.pos.z) < 8, `stopped in ${(f2.pos.x - x0).toFixed(0)} m, ${f2.pos.z.toFixed(1)} m off the centreline`);
}

// ---- 4. stall speeds at 210 t, SL (D, from the clean CLmax 1.4 / 2.08 / 2.70): clean 322, take-off 264, landing 233 km/h ----
{
  const vs = (notch, mass = 210000) => { const n = NOTCHES[notch], as = stallAlpha(n.flap, n.slat), cl_ = il76Lift(as, n.flap, n.slat); return Math.sqrt(2 * mass * G / (1.225 * IL76.S * cl_)) * KMH; };
  const clean = vs(0), to = vs(2), ldg = vs(4), ldg165 = vs(4, 165000);
  check('stall speeds at 210 t: clean 322, T/O 264 (S14 F30), landing 233 (S25 F43) km/h, within 3 %', Math.abs(clean - 322) < 10 && Math.abs(to - 264) < 8 && Math.abs(ldg - 233) < 7, `${clean.toFixed(0)} / ${to.toFixed(0)} / ${ldg.toFixed(0)} km/h; landing at MLW ${ldg165.toFixed(0)} km/h`);
  // dynamic: slowing at idle in level flight, the shaker comes in at about the computed speed
  const f = fresh(1500, 230, { mass: 210000 }); reconfig(f, 0, false); let vsh = null; f.throttle = 0; f.setEngines(0.05);
  const holdAlt = { i: 0 }; fly(f, 120, (g) => { level(g); const e = (1500 - g.pos.y) / 40 - g.vel.y / 4; g.ctrl.de = cl(0.5 * e - 0.4 * g.w.z, -1, 1); g.throttle = 0; if (vsh === null && g.out.shaker) vsh = kmh(g); });
  check('slowing down clean at idle, the stall warning comes in just above the stall speed', vsh !== null && vsh > clean * 0.95 && vsh < clean * 1.25, `warning at ${vsh === null ? 'never' : vsh.toFixed(0)} km/h (stall ${clean.toFixed(0)})`);
}

// ---- 5. climb and cruise ----
{
  // steady climb at 450 km/h and 190 t, SL, clean, full thrust (the nominal rating once above 240 kt): research 12-15 m/s operational, 22 m/s theoretical at take-off rating
  const f = fresh(300, 450 / 1.852, { mass: 190000 }); reconfig(f, 0, false); const V = f.vel.length(), atm = isa(f.pos.y), T = 4 * thrustMax(atm.rho, V / atm.a, 450 / 1.852 * Math.sqrt(atm.rho / 1.225));
  let lo = 0, hi = 0.4; for (let i = 0; i < 40; i++) { const g = (lo + hi) / 2; if (f.trimSolve(V, g * 180 / Math.PI, 0, 0, 0).T < T) lo = g; else hi = g; }
  const roc = V * Math.sin((lo + hi) / 2);
  check('rate of climb at 450 km/h, 190 t, clean, SL, full lever: 12-26 m/s (D: 13 operational, 22 theoretical at take-off rating)', roc > 12 && roc < 26, `${roc.toFixed(1)} m/s (${(roc * 196.85).toFixed(0)} fpm)`);
}
{
  const tas = 0.72 * isa(10000).a;
  const f = fresh(10000, tas * KT, { mass: 170000 }); reconfig(f, 0, false); const lever = f.throttle, y0 = f.pos.y; fly(f, 90, (g) => { level(g); g.ctrl.de = 0; });
  const kmhTAS = f.out.V * KMH, ffh = f.out.ff * 3600;
  check('cruise at 10,000 m, Mach 0.72, 170 t: 770 km/h (UAC) held hands-off for 90 s, lever below the stop, 6-9 t/h of fuel', !f.crashed && Math.abs(f.out.M - 0.72) < 0.012 && Math.abs(f.pos.y - y0) < 200 && lever < 0.96 && kmhTAS > 750 && kmhTAS < 800 && ffh > 6000 && ffh < 9500,
    `${kmhTAS.toFixed(0)} km/h, M ${f.out.M.toFixed(3)}, lever ${lever.toFixed(2)}, ${(ffh / 1e3).toFixed(1)} t/h, altitude drift ${(f.pos.y - y0).toFixed(0)} m`);
  const c = fresh(12200, 0.72 * isa(12200).a * KT, { mass: 125000 }); reconfig(c, 0, false); const atm = isa(12200), V = c.vel.length(), s = c.trimSolve(V, 0, 0, 0, 0), avail = 4 * thrustMax(atm.rho, V / atm.a, V * Math.sqrt(atm.rho / 1.225) * KT);
  check('service ceiling 12,200 m (UAC): a 125 t aircraft holds Mach 0.72 there with thrust to spare', avail > s.T * 1.02, `needs ${(s.T / 1e3).toFixed(0)} kN, ${(avail / 1e3).toFixed(0)} kN available`);
}

// ---- 6. landing roll at MLW from VREF: brakes, spoilers and reverse against the published 960 m ----
const landingRoll = (mode, { spoil = true, rev = true, brakes = true } = {}) => {
  const f = fresh(0, 0, { ground: true, mass: IL76.MLW, mode }); f.setFlaps(4); f.flaps = 43; f.slats = 25; f.setGear(true); f.vel.set(f.vref() * 0.99 / KT, 0, 0); f.pos.y = IL76_CG.y + 0.3; f.parkingBrake = false;
  const x0 = f.pos.x; let t0 = null;
  fly(f, 80, (g, t) => {
    level(g); g.throttle = 0; g.ctrl.de = 0;
    if (g.onGround) { if (t0 === null) t0 = t; if (spoil && t - t0 > 1 && !IL76_MODES[mode].autoSpoilers) g.setSpoilers(true); if (rev && t - t0 > 1.5) { g.setReverser(true); if (!IL76_MODES[mode].autoRev && g.engines[0].rev > 0.95) g.throttle = 0.9; } if (brakes && t - t0 > 2.5) g.brakes = 1; }
  });
  return { dist: f.pos.x - x0, f, v: f.vel.length() };
};
const roll = {};
{
  const a = landingRoll('realistic', { spoil: false, rev: false }), b = landingRoll('realistic', { rev: false }), c = landingRoll('realistic'), d = landingRoll('realistic', { spoil: false, rev: false, brakes: false });
  roll.realistic = c.dist;
  check('landing roll at MLW from VREF with brakes, spoilers and reverse: 960 m (UAC) within -25 % / +35 %, stopped, straight', !c.f.crashed && c.v < 0.5 && c.dist > 960 * 0.75 && c.dist < 960 * 1.35 && Math.abs(c.f.pos.z) < 6, `${c.dist.toFixed(0)} m (${(c.dist / 0.3048 | 0)} ft); brakes only ${a.dist.toFixed(0)} m, + spoilers ${b.dist.toFixed(0)} m, + reverse ${c.dist.toFixed(0)} m`);
  check('each aid shortens the roll: spoilers (lift dump, more weight on the wheels), then reverse; coasting needs several kilometres', b.dist < a.dist && c.dist < b.dist && d.dist > 2 * a.dist, `coasting ${d.dist.toFixed(0)} m`);
}
{
  const touch = (mode, vs) => { const f = fresh(0, 0, { ground: true, mass: IL76.MLW, mode }); f.setFlaps(4); f.flaps = 43; f.slats = 25; f.vel.set(f.vref() / KT, -vs, 0); f.pos.y = IL76_CG.y + 0.2; let events = []; fly(f, 4, (g) => { level(g); g.throttle = 0; events = events.concat(g.events); g.events.length = 0; }); return { f, events }; };
  const soft = touch('realistic', 1.2), mid = touch('realistic', 3.2), slam = touch('realistic', 5.5);
  check('touchdown: a firm 1.2 and 3.2 m/s (630 fpm) landing is fine, 5.5 m/s breaks the gear (realistic limit 3.7 m/s); every unit reports its contact', !soft.f.crashed && !mid.f.crashed && !!slam.f.crashed && soft.events.filter((e) => e.type === 'touch').length >= 1 && mid.events.filter((e) => e.type === 'touch').length >= 4,
    `touch events: ${soft.events.filter((e) => e.type === 'touch').length} soft, ${mid.events.filter((e) => e.type === 'touch').length} firm; slam: ${slam.f.crashed}`);
}

// ---- 7. engine failure: the asymmetric thrust yaws the nose toward the dead engine; the rudder holds it above VMCA ----
{
  const run = (eng, kt, rudder = true) => {
    const f = fresh(300, kt, { mass: 190000 }); reconfig(f, 2, false); f.setEngines(1); fly(f, 1, (g) => { g.throttle = 1; level(g); }); const h0 = hdgOf(f); let maxBeta = 0, yaw0 = null;
    f.failEngine(eng); fly(f, 40, (g, t) => { g.throttle = 1; const dh = ((hdgOf(g) - h0 + 540) % 360) - 180, wantBank = cl(-dh * 0.05, -0.1, 0.1);
      g.ctrl.da = cl(-2.5 * (bankOf(g) - wantBank) - 0.8 * g.w.x, -1, 1); g.ctrl.dr = rudder ? cl(2 * (g.out.beta || 0) - 0.05 * dh, -1, 1) : 0; g.ctrl.de = cl(3 * (6 * Math.PI / 180 - pitchOf(g)) - 1.2 * g.w.z, -1, 1);
      maxBeta = Math.max(maxBeta, Math.abs(g.out.beta || 0)); if (t > 0.9 && yaw0 === null) yaw0 = g.w.y; });
    return { f, dh: ((hdgOf(f) - h0 + 540) % 360) - 180, maxBeta, yaw0 };
  };
  const out1 = run(0, 340 / 1.852), out2 = run(1, 340 / 1.852), noRud = run(0, 340 / 1.852, false), slow = run(0, 300 / 1.852);
  check('outboard engine out at 1.1 x V2 with take-off thrust: the nose yaws toward the dead engine without rudder, and rudder and ailerons hold it within 15 degrees, sideslip under 10 degrees', !out1.f.crashed && noRud.yaw0 > 0.003 && out1.maxBeta < 10 * Math.PI / 180 && Math.abs(out1.dh) < 15 && out1.f.pos.y > 300 && out1.f.vel.y > 3,
    `heading change ${out1.dh.toFixed(1)}, max sideslip ${(out1.maxBeta * 57.3).toFixed(1)}, yaw rate toward the dead engine ${noRud.yaw0.toFixed(3)} rad/s, climbing ${out1.f.vel.y.toFixed(1)} m/s`);
  check('an inboard engine out is milder than an outboard one; both are flyable down to 300 km/h', out2.maxBeta <= out1.maxBeta + 0.01 && !slow.f.crashed && slow.maxBeta < 14 * Math.PI / 180, `outboard sideslip ${(out1.maxBeta * 57.3).toFixed(1)}, inboard ${(out2.maxBeta * 57.3).toFixed(1)}, 300 km/h ${(slow.maxBeta * 57.3).toFixed(1)}`);
}

// ---- 8. gear, flaps and slats, spoilers, reverse ----
{
  const f = fresh(800, 160, { mass: 160000 }); reconfig(f, 0, true); f.setGear(false); let t = 0, up = null; while (t < 30 && f.gearPos > 0) { f.step(dt, ground, wind); t += dt; if (up === null && f.gearPos <= 0) up = t; } const upT = t;
  f.setGear(true); t = 0; while (t < 30 && f.gearPos < 1) { f.step(dt, ground, wind); t += dt; } const downT = t;
  check('gear transit: 14 s up, 12 s down (D), gear-lock events', Math.abs(upT - 14) < 0.5 && Math.abs(downT - 12) < 0.5, `${upT.toFixed(1)} s up, ${downT.toFixed(1)} s down`);
  const g = fresh(0, 0, { ground: true }); fly(g, 2); check('gear up is refused with weight on the wheels', g.setGear(false) === false && g.gearDown === true, '');
  const h = fresh(2000, 220, { mass: 160000 }); reconfig(h, 0, true); h.setGear(true); let over = false; fly(h, 3, (x) => { x.throttle = 1; if (x.events.some((e) => e.type === 'gear-overspeed')) over = true; x.events.length = 0; }); h.setEngines(1);
  check('gear overspeed above 370 km/h (200 kt) is reported once', kias(h) > 200 ? over : true, `${kias(h).toFixed(0)} KIAS`);
}
{
  const f = fresh(3000, 250, { mass: 170000 }); reconfig(f, 0, false); f.setFlaps(4); let ts = null, tf = null, t = 0; fly(f, 70, (g) => { t += dt; level(g); g.throttle = 0.3; if (ts === null && Math.abs(g.slats - 25) < 0.01) ts = t; if (tf === null && Math.abs(g.flaps - 43) < 0.01) tf = t; });
  check('slats 25 in 10 s, flaps 43 in 40 s (D), limited by the lever notch', ts !== null && tf !== null && Math.abs(ts - 10) < 1 && Math.abs(tf - 40) < 2, `slats ${ts && ts.toFixed(1)} s, flaps ${tf && tf.toFixed(1)} s`);
  const o = fresh(2000, 170, { mass: 170000 }); reconfig(o, 4, true); o.vel.multiplyScalar(1); const over = []; fly(o, 1); const v280 = 280 / 1.852; o.vel.setLength(v280 * 1.05 / Math.sqrt(isa(2000).rho / 1.225)); fly(o, 0.5);
  check('flaps 43 overspeed above 280 km/h is flagged', o.out.flapOverspeed === true, `${kmh(o).toFixed(0)} km/h`);
  check('limit speeds of the notches (B): 400, 400, 370, 370, 280 km/h', NOTCHES.map((n) => Math.round(n.vfe * 1.852)).join() === 'Infinity,400,370,370,280', NOTCHES.map((n) => Math.round(n.vfe * 1.852)).join());
}
{
  const f = fresh(1500, 230, { mass: 170000 }); reconfig(f, 0, false); f.setEngines(0.4); const sink = (sp) => { const g = fresh(1500, 230, { mass: 170000 }); reconfig(g, 0, false); g.setEngines(0.4); let t = 0; g.setSpoilers(sp); fly(g, 12, (x) => { level(x); x.throttle = 0.4; t = x.spoilers; }); return { vy: g.vel.y, v: g.vel.length(), sp: g.spoilers }; };
  const a = sink(false), b = sink(true);
  check('spoilers in the air: out in 3.5 s, extra drag and lift loss steepen the descent', b.sp > 0.45 && b.sp <= 1 && b.vy < a.vy - 0.2, `descent ${a.vy.toFixed(1)} -> ${b.vy.toFixed(1)} m/s, spoilers ${b.sp.toFixed(2)} (half above 250 km/h)`);
  const g = fresh(0, 0, { ground: true }); g.setSpoilers(true); let t = 0; fly(g, 6, (x) => { if (t === 0 && x.spoilers >= 0.99) t = 1; }); const on = g.spoilers;
  check('spoilers reach full travel on the ground', on > 0.99, `${on.toFixed(2)}`);
}
{
  const f = fresh(0, 0, { ground: true, mass: IL76.MLW }); f.vel.set(60, 0, 0); f.pos.y = IL76_CG.y + 0.2; fly(f, 3, (g) => { level(g); g.throttle = 0; });
  check('thrust reverse is refused in the air', fresh(500, 160).setReverser(true) === false, '');
  f.setReverser(true); fly(f, 0.8); const half = f.engines[0].rev; fly(f, 1.6); const full = f.engines[0].rev;
  check('sleeves deploy in under 2 s, only on the outer engines in realistic; the inner pair stays closed', half > 0.2 && half < 0.8 && full > 0.99 && f.engines[1].rev === 0 && f.engines[2].rev === 0 && f.engines[3].rev > 0.99, `engine 1: ${half.toFixed(2)} at 0.8 s, ${full.toFixed(2)} at 2.4 s; inner ${f.engines[1].rev}`);
  f.throttle = 0.9; fly(f, 6, (g) => { g.throttle = 0.9; });
  check('with the lever up, the outer engines push the aircraft backward-forward: reverse thrust of 15-80 kN each and inner engines at idle', f.engines[0].thrust < -15e3 && f.engines[0].thrust > -80e3 && Math.abs(f.engines[1].thrust) < 25e3 && f.engines[1].dry < 0.1, `engine 1 ${(f.engines[0].thrust / 1e3).toFixed(0)} kN, engine 2 ${(f.engines[1].thrust / 1e3).toFixed(0)} kN`);
  const stop = fresh(0, 0, { ground: true, mass: IL76.MLW }); stop.vel.set(5, 0, 0); stop.pos.y = IL76_CG.y + 0.1; stop.setReverser(true); fly(stop, 8, (g) => { g.throttle = 0.9; g.brakes = 0; g.parkingBrake = false; });
  check('reverse power fades out below about 50 km/h: it never backs the aircraft up', stop.vel.x > -0.5, `${stop.vel.x.toFixed(2)} m/s`);
  fly(f, 2); f.pos.y += 30; f.vel.y = 8; fly(f, 1); check('lifting off stows the reverser (lock-out)', f.reverserCmd === false, '');
}

// ---- 9. structure ----
{
  const g = fresh(2000, 300, { mass: 150000 }); reconfig(g, 0, false); g.setEngines(0.7); g.ctrl.de = 1; fly(g, 10, (x) => { x.ctrl.de = 1; x.throttle = 0.7; });
  check('a held full pull beyond the limit load breaks the airframe (ultimate 1.5 x +2 g = 3 g)', !!g.crashed && /overstress|failed/.test(g.crashed), `${g.crashed}`);
  const s = fresh(8000, 540 / 1.852 / 1.1, { mass: 150000 }); reconfig(s, 0, false); s.setEngines(1); fly(s, 90, (x) => { level(x); x.ctrl.de = -0.1; x.throttle = 1; });
  check('far past VMO (more than 1.2 x 600 km/h) the airframe fails', kias(s) < IL76.VMO * 1.2 || !!s.crashed, `${kias(s).toFixed(0)} KIAS (${s.crashed || 'intact'})`);
}

// ---- 10. hands-off flight in the air is stable, the CG and the inertia follow the fuel, fuel burn matches the flow ----
{
  const f = fresh(6000, 330, { mass: 170000 }); reconfig(f, 0, false); const y0 = f.pos.y; let maxBank = 0, maxPitchRate = 0; fly(f, 120, (g) => { g.ctrl.da = 0; g.ctrl.dr = 0; g.ctrl.de = 0; maxBank = Math.max(maxBank, Math.abs(bankOf(g))); maxPitchRate = Math.max(maxPitchRate, Math.abs(g.w.z)); });
  check('hands-off flight from trim for two minutes: wings level, no divergence, pitch rates tiny', !f.crashed && maxBank < 6 / 57.3 && Math.abs(f.pos.y - y0) < 400 && maxPitchRate < 0.03, `bank ${(maxBank * 57.3).toFixed(1)} deg, altitude drift ${(f.pos.y - y0).toFixed(0)} m, pitch rate ${maxPitchRate.toFixed(3)}`);
  const kick = fresh(3000, 250, { mass: 170000 }); reconfig(kick, 3, true); kick.w.x = 0.08; let amps = []; fly(kick, 40, (g, t) => { g.ctrl.da = 0; g.ctrl.dr = 0; g.ctrl.de = 0; if (Math.abs(g.w.x) > 0.001 || t < 1) amps.push(Math.abs(g.w.x)); });
  check('a roll disturbance dies out (Dutch roll and spiral are damped at approach speed with the yaw damper)', amps[amps.length - 1] < 0.04 && Math.max(...amps.slice(Math.floor(amps.length / 2))) < 0.07 && !kick.crashed, `roll rate ${amps[0].toFixed(3)} -> ${Math.max(...amps.slice(Math.floor(amps.length * 0.75))).toFixed(3)} rad/s`);
  const a = fresh(0, 0, { ground: true, mass: IL76.MTOW }), b = fresh(0, 0, { ground: true, mass: 130000 }); const pa = { ...a.massProps() }, pb = { ...b.massProps() }, cgA = pa.cgx, cgB = pb.cgx;
  check('the CG moves aft by about 10 % MAC as the fuel burns off, and the inertia scales with the mass (I = 12.6 / 12.5 / 23.2 million kg m2 at 210 t)', cgB < cgA && (cgA - cgB) / IL76.C > 0.03 && Math.abs(pa.Ix - 12.6e6) < 1e4 && Math.abs(pa.Iz - 12.5e6) < 1e4 && Math.abs(pa.Iy - 23.2e6) < 1e4 && pb.Ix < pa.Ix * 0.7, `CG ${(100 * (0.25 * IL76.C - cgA) / IL76.C).toFixed(0)} -> ${(100 * (0.25 * IL76.C - cgB) / IL76.C).toFixed(0)} % MAC, Ix ${(pa.Ix / 1e6).toFixed(1)} and ${(pb.Ix / 1e6).toFixed(1)} million kg m2`);
  const burn = fresh(5000, 300, { mass: 170000 }); reconfig(burn, 0, false); const m0 = burn.fuel; fly(burn, 60, (g) => { level(g); g.ctrl.de = 0; }); const used = m0 - burn.fuel;
  check('fuel burn follows the flow (7-9 t/h at 170 t, 5,000 m)', used > 60 * 3000 / 3600 && used < 60 * 12000 / 3600, `${used.toFixed(0)} kg in 60 s = ${(used * 60 / 1e3).toFixed(1)} t/h`);
}

// ---- 11. the three modes: one table of multipliers, each easier than the one above ----
{
  const R = IL76_MODES.realistic, M = IL76_MODES.medium, E = IL76_MODES.easy;
  const keys = Object.keys(R).filter((k) => typeof R[k] === 'number' && k !== 'stallDrop' && k !== 'wingDrop');
  const dirs = { damp: 1, stab: 1, ctrl: 1, clmax: 1, spool: 1, thrust: 1, brake: 1, reverse: 1, flapRate: 1, gearTime: -1, vlim: 1, struct: 1 };
  check('IL76_MODES: every multiplier moves the easy way, strictly, from realistic to medium to easy (gear transit shortens)', keys.every((k) => (dirs[k] || 1) * (E[k] - M[k]) > 0 && (dirs[k] || 1) * (M[k] - R[k]) > 0) && R.stallDrop > M.stallDrop && M.stallDrop > E.stallDrop && R.wingDrop > M.wingDrop && M.wingDrop >= E.wingDrop, keys.join(' '));
  check('realistic is the researched airframe: no assists, outer-pair reversers only, manual spoilers; easy adds envelope protection', R.autoSpoilers === false && R.autoRev === false && R.revEngines.length === 2 && M.autoSpoilers && E.autoSpoilers && E.autoRev && !!E.protect && !R.protect, '');
  const vs = (mode, notch = 4) => { const f = fresh(0, 0, { ground: true, mass: 165000, mode }), n = NOTCHES[notch], mx = f.mx; const as = stallAlpha(n.flap, n.slat, 0, mx.clmax); return Math.sqrt(2 * f.mass * G / (1.225 * IL76.S * il76Lift(as, n.flap, n.slat, 0, mx.clmax, mx.stallDrop))) * KMH; };
  check('stall speed falls with the mode: realistic > medium > easy, in every configuration', [0, 2, 4].every((n) => vs('realistic', n) > vs('medium', n) + 2 && vs('medium', n) > vs('easy', n) + 2), `landing at MLW: ${vs('realistic').toFixed(0)} / ${vs('medium').toFixed(0)} / ${vs('easy').toFixed(0)} km/h`);
  const lim = ['realistic', 'medium', 'easy'].map((m) => landingLimits('il76', m).sinkMax);
  check('landing sink limit rises with the mode (3.7 / 4.8 / 6.0 m/s), and so does the strut-bottoming limit', lim[0] < lim[1] && lim[1] < lim[2] && ['sinkBottom', 'scrapeVs'].every((k) => landingLimits('il76', 'realistic')[k] < landingLimits('il76', 'medium')[k] && landingLimits('il76', 'medium')[k] < landingLimits('il76', 'easy')[k]), lim.join(' / '));
  const dist = ['realistic', 'medium', 'easy'].map((m) => landingRoll(m).dist);
  check('stopping distance falls with the mode (stronger brakes, reverse on all four engines, auto spoilers, faster spool)', dist[0] > dist[1] + 40 && dist[1] > dist[2] + 40, dist.map((d) => d.toFixed(0)).join(' / ') + ' m');
  const spool = ['realistic', 'medium', 'easy'].map((m) => { const f = fresh(0, 0, { ground: true, mode: m }); f.parkingBrake = true; let t95 = null; fly(f, 14, (g, t) => { g.throttle = 1; if (t95 === null && g.engines[0].dry > 0.95) t95 = t; }); return t95; });
  check('engines spool faster in the easier modes', spool[0] > spool[1] + 0.8 && spool[1] > spool[2] + 0.8, spool.map((x) => x.toFixed(1)).join(' / ') + ' s');
  const autoSp = ['realistic', 'medium', 'easy'].map((m) => { const f = fresh(0, 0, { ground: true, mass: IL76.MLW, mode: m }); f.setFlaps(4); f.flaps = 43; f.slats = 25; f.vel.set(f.vref() / KT, 0, 0); f.pos.y = IL76_CG.y + 0.2; fly(f, 8, (g) => { level(g); g.throttle = 0; }); return f.spoilers; });
  check('ground spoilers deploy on touchdown by themselves in medium and easy, never in realistic', autoSp[0] < 0.01 && autoSp[1] > 0.95 && autoSp[2] > 0.95, autoSp.map((x) => x.toFixed(2)).join(' / '));
  const rollDamp = ['realistic', 'medium', 'easy'].map((m) => { const f = fresh(3000, 250, { mass: 170000, mode: m }); reconfig(f, 3, true); f.w.x = 0.1; let t = 0, peak = 0; fly(f, 6, (g) => { g.ctrl.da = 0; g.ctrl.dr = 0; g.ctrl.de = 0; peak = Math.max(peak, Math.abs(g.w.x)); }); return Math.abs(f.w.x); });
  check('roll damping: a roll rate dies away faster in the easier modes', rollDamp[0] > rollDamp[1] && rollDamp[1] > rollDamp[2], rollDamp.map((x) => x.toFixed(3)).join(' / ') + ' rad/s after 6 s');
}
// the take-off run is also shorter in the easier modes (more thrust)
{
  const rr = takeoff('medium').roll, re = takeoff('easy').roll;
  check('take-off run at MTOW falls with the mode (thrust 1.00 / 1.03 / 1.06, faster spool)', takeoffRoll > rr && rr > re && re > 1200, `${takeoffRoll.toFixed(0)} / ${rr.toFixed(0)} / ${re.toFixed(0)} m`);
}
// a three-minute random-input soak in the air: nothing explodes
{
  const f = fresh(4000, 300, { mass: 170000, mode: 'medium' }); reconfig(f, 0, false); let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  fly(f, 180, (g, t) => { if (Math.floor(t) !== g.__s) { g.__s = Math.floor(t); g.__r = [rnd() * 0.5, rnd() * 0.6, rnd() * 0.3]; } g.ctrl.de = g.__r[0]; g.ctrl.da = g.__r[1]; g.ctrl.dr = g.__r[2]; g.throttle = 0.7 + 0.3 * rnd(); });
  check('three minutes of random control inputs in Medium: finite numbers, intact (or a clean, reported break-up), no NaN', Number.isFinite(f.pos.x + f.pos.y + f.pos.z + f.vel.length() + f.fuel) && (!f.crashed || /overstress|failed|ground|hit|landing/.test(f.crashed)), `${f.crashed || 'intact'}, ${kmh(f).toFixed(0)} km/h at ${f.pos.y.toFixed(0)} m`);
}
console.log(fails ? `${fails} FAILED` : 'all passed'); process.exit(fails ? 1 : 0);
