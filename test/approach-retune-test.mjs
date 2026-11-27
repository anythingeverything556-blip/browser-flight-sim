// E02: exercise real Navigation/Runway outputs through the shared production AP,
// with real flight-model snapshots and every aircraft AP profile. No live inputs.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Autopilot, SR71_AP, attitude } from '../src/autopilot.js';
import { FlightModel } from '../src/flight.js';
import { SF50Model } from '../src/sf50.js';
import { IL76Model } from '../src/il76.js';
import { A380XModel } from '../src/a380x.js';
import { C172Model } from '../src/c172.js';
import { DA40Model } from '../src/da40.js';
import { F27Model } from '../src/f27.js';
import { SF50_AP } from '../src/sf50ap.js';
import { IL76_AP } from '../src/il76ap.js';
import { A380X_AP } from '../src/a380xap.js';
import { C172_AP, DA40_AP, F27_AP } from '../src/propap.js';
import { Navigation } from '../src/nav.js';
import { Runway } from '../src/airportdb.js';
import { destination } from '../src/geo.js';
import { airData, trueAirspeedFromCas } from '../src/airdata.js';
import { isa } from '../src/atmosphere.js';

const dt = 1 / 120, pos = { lat: 39, lon: -121 }, alt = 544, KT = 1.943844;
// Deliberately reuse the display ident: runway geometry, not just its label, is identity.
function runway(hdg = 90, brg = 90, elev = 0, airport = 'KTST') {
  const a = destination(pos.lat, pos.lon, brg, 10000), b = destination(a.lat, a.lon, hdg, 3000);
  return new Runway({ ident: airport }, ['09', '27', a.lat, a.lon, b.lat, b.lon, elev, elev, 45, 1, 1]);
}
const fleet = [
  ['SR71', FlightModel, SR71_AP, 220], ['SF50', SF50Model, SF50_AP, 150],
  ['IL76', IL76Model, IL76_AP, 210], ['A380X', A380XModel, A380X_AP, 210],
  ['C172', C172Model, C172_AP, 100], ['DA40', DA40Model, DA40_AP, 120], ['F27', F27Model, F27_AP, 180],
];
function rig(Model, cfg, kias, modes = { hdg: true, alt: true }) {
  const fdm = new Model();
  fdm.reset(new THREE.Vector3(0, alt, 0), 90, trueAirspeedFromCas(kias / KT, isa(alt)), false);
  fdm.step(dt, () => 0, new THREE.Vector3());
  const ap = new Autopilot(cfg), nav = new Navigation();
  for (const k of Object.keys(ap.modes)) ap.modes[k] = false;
  Object.assign(ap.modes, modes, { appr: true });
  Object.assign(ap.target, { hdg: 90, alt: alt + (modes.flch || modes.vs ? 1000 : 0), vs: 2 });
  ap.engage({ ctrl: fdm.ctrl, throttle: fdm.throttle });
  const state = () => ({ fdm, out: fdm.out, att: attitude(fdm.quat), vs: fdm.vel.y,
    alt: fdm.pos.y, ias: airData(fdm.out).cas, nav: nav.update(pos, fdm.pos.y, fdm.vel.length()) });
  const update = () => ap.update(dt, state());
  return { ap, nav, state, update };
}
function captured(r) {
  assert.equal(r.ap.status.loc, true); assert.equal(r.ap.status.gs, true);
}
function freshControl(r, sample) {
  const fresh = new Autopilot(r.ap.cfg);
  Object.assign(fresh.modes, r.ap.modes); Object.assign(fresh.target, r.ap.target);
  fresh.engage({ ctrl: sample.fdm.ctrl, throttle: sample.fdm.throttle });
  // Keep the ordinary aircraft trim/protection history; only capture history differs.
  for (const k of ['deI', 'thI', 'stallHold', 'overHold']) fresh[k] = r.ap[k];
  const actual = r.ap.update(dt, sample), expected = fresh.update(dt, sample);
  assert.equal(r.ap.status.loc, fresh.status.loc); assert.equal(r.ap.status.gs, fresh.status.gs);
  assert.equal(r.ap.status.lat, fresh.status.lat); assert.equal(r.ap.status.vert, fresh.status.vert);
  assert.equal(r.ap.cmdHdg, fresh.cmdHdg); assert.equal(r.ap.locI, fresh.locI);
  for (const k of ['de', 'da', 'dr', 'th']) {
    assert.ok(Number.isFinite(actual[k]), k);
    assert.ok(Math.abs(actual[k] - expected[k]) < 1e-12, `${k}: ${actual[k]} vs fresh ${expected[k]}`);
  }
  return fresh;
}

for (const [label, Model, cfg, kias] of fleet) {
  const modes = [{ hdg: true, alt: true }, { nav: true, vs: true }, {}];
  if (!cfg.manualThrottle) modes.push({ hdg: true, flch: true, spd: true });
  for (const fallback of modes) {
    const r = rig(Model, cfg, kias, fallback);
    r.nav.setArrival(runway(), 0); r.update(); captured(r);
    assert.notEqual(r.ap.locI, 0, 'initial capture accumulates crosswind correction');
    const first = r.state().nav;
    r.nav.setArrival(runway(0, 350, 300), 0);
    if (fallback.nav) r.nav.directTo({ ...destination(pos.lat, pos.lon, 135, 40000), name: 'ROUTE' }, pos);
    const sample = r.state();
    assert.equal(first.ilsIdent, sample.nav.ilsIdent);
    assert.notEqual(first.ilsId, sample.nav.ilsId);
    assert.ok(sample.nav.ilsValid && Math.abs(sample.nav.locDev) > 2.5 && Math.abs(sample.nav.gsDev) > 0.5);
    freshControl(r, sample);
    assert.equal(r.ap.status.loc, false); assert.equal(r.ap.status.gs, false); assert.equal(r.ap.locI, 0);
    assert.equal(r.ap.cmdHdg, fallback.nav ? sample.nav.lnavHdg : fallback.hdg ? 90 : null);
    // A later legitimate intercept captures the new runway normally.
    const end = r.nav.arrival.rwy.ends[0], here = destination(end.start.lat, end.start.lon, 180, 10000);
    const next = { ...sample, att: { ...sample.att, heading: 0 },
      nav: r.nav.update(here, 300 + 4 + 10300 * Math.tan(3 * Math.PI / 180), sample.out.V) };
    r.ap.update(dt, next); captured(r);
  }
  // A valid new signal inside both gates may recapture on the very same frame,
  // but none of the previous runway's crosswind integral may leak into it.
  const r = rig(Model, cfg, kias);
  r.nav.setArrival(runway(), 0); for (let n = 0; n < 20; n++) r.update(); captured(r);
  const oldI = r.ap.locI;
  r.nav.setArrival(runway(90, 90, 0, 'KNEW'), 0);
  freshControl(r, r.state()); captured(r); assert.ok(Math.abs(r.ap.locI) < Math.abs(oldI));
  console.log(`PASS E02 ${label}: retune matches fresh AP in all fallback modes; valid recapture has no stale integral`);
}

{
  const r = rig(FlightModel, SR71_AP, 220), a = runway();
  r.nav.setArrival(a, 0); r.update(); captured(r); const id = r.state().nav.ilsId;
  // Object reconstruction and unrelated route edits must not look like a retune.
  r.nav.setArrival(runway(), 0);
  assert.equal(r.state().nav.ilsId, id);
  r.nav.directTo({ ...destination(pos.lat, pos.lon, 45, 40000), name: 'A NEW FIX' }, pos);
  const sample = r.state();
  // Same valid signal now outside capture gates: existing capture should stay latched.
  sample.nav.locDev = 4; sample.nav.gsDev = 0.8;
  r.ap.update(dt, sample); captured(r); assert.notEqual(r.ap.locI, 0);
  // Signal loss, clearing arrival, mode exit and re-engage still release capture.
  r.ap.update(dt, { ...sample, nav: { ...sample.nav, ilsValid: false } });
  assert.equal(r.ap.status.loc, false); assert.equal(r.ap.status.gs, false); assert.equal(r.ap.locI, 0);
  r.update(); captured(r);
  r.nav.setArrival(a, 1); const reciprocal = r.state();
  assert.notEqual(reciprocal.nav.ilsId, id); freshControl(r, reciprocal);
  r.nav.setArrival(a, 0); r.update(); captured(r);
  r.nav.setArrival(null); assert.equal(r.state().nav.ilsId, null); r.update();
  assert.equal(r.ap.status.loc, false); assert.equal(r.ap.status.gs, false);
  r.nav.setArrival(a, 0); r.update(); captured(r);
  r.ap.modes.appr = false; r.update(); assert.equal(r.ap.status.loc, false); assert.equal(r.ap.status.gs, false);
  r.ap.modes.appr = true; r.update(); captured(r);
  r.ap.disengage(); assert.equal(r.ap.approachId, null); assert.equal(r.ap.locI, 0);
  assert.equal(r.ap.status.loc, false); assert.equal(r.ap.status.gs, false);
  console.log('PASS E02 stable identity, route independence, reciprocal end, signal loss, clear, mode exit and disengage');
}
console.log('all approach retune regressions passed');
