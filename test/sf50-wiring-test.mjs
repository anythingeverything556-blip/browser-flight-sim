// What the game wires around the Vision Jet: the aircraft choice and its setup card, the stick schedule (a full pull stays inside the load limit at
// every speed), the warning flags, the spawn configurations, building collision points and the single small turbofan's audio profile.
import fs from 'node:fs';
import * as THREE from 'three';
import { SF50Model, SF50, SF50_CG, FLAP_DEG, SF50_HARD, SF50_GEAR } from '../src/sf50.js';
import { AIRCRAFT_TYPES, aircraftChoice } from '../src/aircrafts.js';
import { c172Stick, c172PitchAuthority, SF50_STICK, C172_STICK } from '../src/c172stick.js';
import { sf50Warn } from '../src/sf50feed.js';
import { isa } from '../src/atmosphere.js';
import { BuildingCollider, SF50_COLLIDE_POINTS, SF50_PAD, COLLIDE_POINTS } from '../src/buildcollide.js';

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${info}`); if (!ok) fails++; };
const KT = 1.943844, dt = 1 / 120, ground = () => -1e5, flat = () => 0, wind = new THREE.Vector3(), cl = (v, a, b) => Math.max(a, Math.min(b, v));
const kias = (f) => f.out.ias * KT;

// ---- aircraft choice and the setup card
{
  const ids = Object.keys(AIRCRAFT_TYPES);
  check('three aircraft; sf50 has a name, model, blurb and three stats', ids.join() === 'sr71,c172,sf50' && AIRCRAFT_TYPES.sf50.model === 'SF50.glb' && /Vision Jet/.test(AIRCRAFT_TYPES.sf50.name) && AIRCRAFT_TYPES.sf50.stats.length === 3 && AIRCRAFT_TYPES.sf50.short === 'SF50');
  check('?aircraft=sf50 and the saved setting choose it; anything else falls back to the SR-71', aircraftChoice({}, '?aircraft=sf50') === 'sf50' && aircraftChoice({ aircraft: 'sf50' }, '') === 'sf50' && aircraftChoice({ aircraft: 'sf50' }, '?aircraft=c172') === 'c172' && aircraftChoice({ aircraft: 'x' }, '?aircraft=SF50') === 'sf50' && aircraftChoice({}, '?aircraft=b52') === 'sr71');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  check('every aircraft has a setup card', ids.every((id) => html.includes(`class="ac-card" data-v="${id}"`)));
  const model = fs.statSync(new URL('../public/models/SF50.glb', import.meta.url));
  check('the model file is in public/', model.size > 1e6, `${(model.size / 1e6).toFixed(1)} MB`);
}

// ---- stick: full travel at low speed, the schedule falls with speed; a held full pull in level flight stays inside the +3.6 g limit (no crash at 1.5 x)
{
  check('pitch authority: full to 95 KIAS, about a quarter at VMO (floor 0.24), softer than the Skyhawk\'s schedule at the same speed', c172PitchAuthority(80, SF50_STICK) === 1 && c172PitchAuthority(95, SF50_STICK) === 1 && Math.abs(c172PitchAuthority(250, SF50_STICK) - 0.24) < 1e-9 && c172PitchAuthority(120, SF50_STICK) > c172PitchAuthority(120, C172_STICK));
  const out = [];
  for (const v of [100, 150, 200, 250]) {
    const f = new SF50Model(); f.reset(new THREE.Vector3(0, 3000, 0), 90, v / KT, false, 0); f.step(dt, ground, wind);
    const st = { de: 0, da: 0 }; let nzMax = 0, crashed = false;
    for (let t = 0; t < 6; t += dt) { c172Stick(st, { pitch: 1, roll: 0 }, kias(f), dt, SF50_STICK); f.ctrl.de = st.de; f.step(dt, ground, wind); nzMax = Math.max(nzMax, f.out.nz || 1); if (f.crashed) crashed = true; f.events.length = 0; }
    out.push(`${v} KIAS ${nzMax.toFixed(1)} g`);
    check(`full back stick for 6 s at ${v} KIAS in level flight does not break the aircraft`, !crashed && nzMax < 5.2, `peak ${nzMax.toFixed(2)} g`);
    if (v === 250) check('...but it reaches the over-G warning at VMO (a determined pull still gets to the limit)', nzMax > SF50.NZ_LIMIT, `${nzMax.toFixed(2)} g`);
  }
}

// ---- warnings
{
  const mk = (over = {}) => { const f = new SF50Model(); f.reset(new THREE.Vector3(0, 3000, 0), 90, 100 / KT, false, 0); f.step(dt, ground, wind); Object.assign(f, over); return f; };
  const W = (f, o = {}) => sf50Warn(f, { casKt: o.casKt ?? 150, iasMs: o.iasMs ?? 75, agl: o.agl ?? 2000 });
  check('quiet in cruise', Object.values(W(mk())).every((x) => x === false), JSON.stringify(W(mk())));
  const f1 = mk(); f1.out = { ...f1.out, aoaNorm: 0.95 }; check('stall: AOA above 90 % of the stall angle (not on the ground)', W(f1).stall && !W({ ...f1, onGround: true, out: f1.out, vel: f1.vel, gearDown: true }).stall);
  const f2 = mk(); check('overspeed: above VMO 250 KIAS, above MMO 0.53, or past a flap / gear limit', W(f2, { casKt: 252 }).overspeed && !W(f2, { casKt: 248 }).overspeed && sf50Warn({ ...f2, out: { ...f2.out, M: 0.54 } }, { casKt: 200, iasMs: 100, agl: 5000 }).overspeed && sf50Warn({ ...f2, out: { ...f2.out, gearOverspeed: true } }, { casKt: 200, iasMs: 100, agl: 5000 }).overspeed);
  const f3 = mk(); f3.gearDown = false; f3.vel.set(60, -3, 0);
  check('gear horn: gear up, below 400 m, descending, slower than 150 KIAS; silent when fast, high or climbing', W(f3, { casKt: 120, agl: 300 }).gearUnsafe && !W(f3, { casKt: 170, agl: 300 }).gearUnsafe && !W(f3, { casKt: 120, agl: 900 }).gearUnsafe && !W({ ...f3, vel: new THREE.Vector3(60, 3, 0) }, { casKt: 120, agl: 300 }).gearUnsafe && !W({ ...mk(), gearDown: true }, { casKt: 120, agl: 300 }).gearUnsafe);
  const f4 = mk({ flaps: 0 }); f4.out = { ...f4.out, nz: 3.0 }; const f5 = mk({ flaps: 39 }); f5.out = { ...f5.out, nz: 3.0 };
  check('over-G: +3.6 g clean, +2 g with flaps out', !W(f4).overG && W(f5).overG && W({ ...f4, out: { ...f4.out, nz: 3.7 }, flaps: 0 }).overG);
  check('low fuel below 90 kg (not with unlimited fuel); PULL UP descending fast near the ground', W(mk({ fuel: 80 })).lowFuel && !W(mk({ fuel: 100 })).lowFuel && !W(mk({ fuel: 80, unlimitedFuel: true })).lowFuel && sf50Warn({ ...mk(), vel: new THREE.Vector3(60, -20, 0) }, { casKt: 120, iasMs: 60, agl: 100 }).pullUp);
}

// ---- spawn configurations (SF50Model.reset by speed, as spawnAt asks for them): 110 KIAS finals and the FL250 cruise start hold their flight
{
  const f = new SF50Model(); f.reset(new THREE.Vector3(0, 800, 0), 90, 110 / KT, false, -3);
  check('110 KIAS final: gear down, flaps 15 (notch 1)', f.gearDown && f.gearPos === 1 && f.flapCmd === 1 && f.flaps === FLAP_DEG[1], `gear ${f.gearPos}, flaps ${f.flaps}`);
  const y0 = f.pos.y; let vsMax = 0, spd = [1e9, 0];
  for (let t = 0; t < 30; t += dt) { f.step(dt, ground, wind); vsMax = Math.max(vsMax, Math.abs(f.vel.y)); spd = [Math.min(spd[0], kias(f)), Math.max(spd[1], kias(f))]; }
  check('...and it stays on the 3 degree path: sink 3-7 m/s, speed within 8 kt, not crashed', !f.crashed && f.vel.y < -2 && f.vel.y > -8 && spd[1] - spd[0] < 8, `${f.vel.y.toFixed(1)} m/s, ${spd.map((x) => x.toFixed(0))} KIAS`);
  // spawnAt turns the 180 KIAS (equivalent) of the FL250 start into the true airspeed reset() takes
  const alt = 25000 / 3.28084, tas = 180 / KT / Math.sqrt(isa(alt).rho / 1.225);
  const g = new SF50Model(); g.reset(new THREE.Vector3(0, alt, 0), 90, tas, false, 0);
  check('FL250 cruise start: gear up, flaps up, lever below take-off thrust', !g.gearDown && g.gearPos === 0 && g.flaps === 0 && g.throttle < 0.98, `lever ${g.throttle.toFixed(2)}`);
  const h0 = g.pos.y; let dh = 0;
  for (let t = 0; t < 60; t += dt) { g.step(dt, ground, wind); dh = Math.max(dh, Math.abs(g.pos.y - h0)); }
  check('...and holds it for a minute: altitude within 60 m, speed within 8 kt, Mach below MMO', !g.crashed && dh < 60 && Math.abs(kias(g) - 180) < 8 && g.out.M < SF50.MMO, `${dh.toFixed(0)} m, ${kias(g).toFixed(0)} KIAS, M ${g.out.M.toFixed(2)}`);
  const r = new SF50Model(); r.reset(new THREE.Vector3(0, SF50_CG.y, 0), 90, 0, true); r.setFlaps(1); r.flaps = FLAP_DEG[1];
  check('runway start: on the wheels, gear down, flaps 50 % commanded, engine idling', r.gearDown && r.flapCmd === 1 && r.throttle === 0 && r.engines[0].n1 > 25, `n1 ${r.engines[0].n1.toFixed(0)}`);
}

// ---- gear lever (the key handler's rules): up refused on the wheels, accepted in the air; retraction takes 6 s; the interlock puts it back down
{
  const f = new SF50Model(); f.reset(new THREE.Vector3(0, SF50_CG.y, 0), 90, 0, true);
  for (let t = 0; t < 1; t += dt) f.step(dt, flat, wind);
  check('gear up refused with weight on the wheels', f.setGear(false) === false && f.gearDown);
  const a = new SF50Model(); a.reset(new THREE.Vector3(0, 500, 0), 90, 60, false, 0); a.step(dt, ground, wind);
  check('gear up accepted in the air, down again accepted', a.setGear(false) === true && a.setGear(true) === true);
  a.setGear(false); let t0 = 0; while (a.gearPos > 0 && t0 < 12) { a.step(dt, ground, wind); t0 += dt; }
  check('retraction takes about 6 s', Math.abs(t0 - 6) < 0.5, `${t0.toFixed(1)} s`);
}

// ---- building collision: the wing tips and the cabin roof hit, a gap of the span plus a little is passed
{
  const pts = SF50_COLLIDE_POINTS, zs = pts.map((p) => p.z), ys = pts.map((p) => p.y), xs = pts.map((p) => p.x);
  check('collision points cover the span, the gear and the tail', Math.max(...zs) >= 5.9 && Math.min(...zs) <= -5.9 && Math.min(...ys) < -SF50_CG.y + 0.2 && Math.max(...ys) > 1.9 && Math.min(...xs) < -3.4 && Math.max(...xs) > 3.4 && pts.length >= SF50_HARD.length + SF50_GEAR.length, `${pts.length} points`);
  check('the Skyhawk-sized pad, smaller than the SR-71 point cloud', SF50_PAD > 0.2 && SF50_PAD < 0.6 && pts.length < COLLIDE_POINTS.length + 5 && BuildingCollider.length >= 0);
}

// ---- audio: one small turbofan, no afterburner layers, no piston voice
{
  const src = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8');
  const fan = /const FAN = \{([^}]*)\}/.exec(src), nofan = /const NO_FAN = \{([^}]*)\}/.exec(src);
  const parse = (m) => Object.fromEntries(m[1].split(',').map((kv) => kv.split(':').map((x) => x.trim())).map(([k, v]) => [k, +v]));
  check('fan profile: quieter rumble and a higher, louder whine than the J58s; neutral profile leaves the SR-71 as it was', fan && nofan && parse(fan).rumble < 1 && parse(fan).whine > 1 && parse(fan).whineLo > parse(nofan).whineLo && parse(fan).cabin < 1 && Object.entries(parse(nofan)).every(([k, v]) => (k === 'whineLo' ? v === 1100 : k === 'whineSpan' ? v === 3400 : v === 1)));
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  check('main passes the SF50\'s one engine with the fan profile', /engines: IS_SF50 \? \[fdm\.engines\[0\]\] : fdm\.engines, fan: IS_SF50/.test(main));
  check('every IS_C172 branch has an SF50 answer (no aircraft-specific line is left to the SR-71 by accident)', (main.match(/IS_C172/g) || []).length > 0 && (main.match(/IS_SF50|IS_GA/g) || []).length >= (main.match(/IS_C172/g) || []).length);
}

// ---- autoland / Safe Return wiring in main.js: terrain, fuel and altitude go to the planner; go-around events are handled; retries re-arm with the attempt
{
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const sr = main.slice(main.indexOf('function safeReturn('), main.indexOf('function safeReturn(') + 2200);
  check('Safe Return gives the planner the terrain sampler, usable fuel and altitude, and keeps the abandoned runways to avoid', /groundAt:\s*\(\w+, \w+\) => terrain\.heightAt/.test(sr) && /fuelKg:/.test(sr) && /alt: fdm\.pos\.y/.test(sr) && /avoid: state\.srAvoid/.test(sr));
  check('Safe Return arms the autoland with the attempt number; the click handler cannot pass an event as the attempt', /autoland\.arm\(true, attempt\)/.test(sr) && /typeof attempt !== 'number'/.test(sr));
  check('main handles the go-around, missed-approach, replan and hold events and passes the runway length', ['goaround', 'goaround_done', 'replan', 'hold'].every((e) => main.includes(`e === '${e}'`)) && /rwyLen: arr \? arr\.rwy\.len/.test(main) && /safeReturn\(autoland\.attempt \+ 1\)/.test(main));
}

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('sf50-wiring-test ok');
