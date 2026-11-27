// E03/Q01: world-route local tangent, signed geometry and missed-final policy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Navigation } from '../src/nav.js';
import { D2R, R_EARTH, bearing, destination, greatCircleLeg, haversine } from '../src/geo.js';
const error = (a, b) => ((a - b + 540) % 360) - 180;
const airports = new Map(JSON.parse(fs.readFileSync(new URL('../public/data/airports.json', import.meta.url)))
  .map(a => [a[0], { lat: a[6], lon: a[7], name: a[0] }]));
const routes = [['KSFO','KOAK'],['KLAX','KSAN'],['KJFK','KBOS'],['KJFK','EGLL'],['KSFO','RJTT'],
  ['PANC','RJTT'],['FAOR','YSSY'],['NZAA','SCEL'],['EGLL','RJTT'],['KLAX','KJFK']];
let checkpoints = 0, maxError = 0;
for (const [origin, target] of routes.flatMap(([a,b]) => [[a,b],[b,a]])) {
  const a = airports.get(origin), b = airports.get(target);
  const initial = bearing(a.lat, a.lon, b.lat, b.lon), length = haversine(a.lat, a.lon, b.lat, b.lon);
  const nav = new Navigation(); nav.directTo(b, a);
  for (const f of [.1, .25, .5, .75, .9]) {
    const p = destination(a.lat, a.lon, initial, length * f);
    // A point independently constructed on the shortest great circle must fly
    // the direct bearing to its endpoint, not its leg's initial bearing.
    const expected = bearing(p.lat, p.lon, b.lat, b.lon), out = nav.update(p, 10000, 220, 25);
    const delta = Math.abs(error(out.lnavHdg, expected)); maxError = Math.max(maxError, delta);
    assert.ok(delta < 1e-7, `${origin}->${target} at ${f}: ${delta} deg`);
    assert.ok(Math.abs(out.xtkNm) < 1e-7); assert.ok(out.routeActive && !out.routeComplete);
    const leg = greatCircleLeg(a, b, p);
    assert.ok(Math.abs(leg.alongTrack - f * length) < 1e-6);
    checkpoints++;
    // Both sides must turn toward the great circle, including polar/date-line legs.
    for (const sign of [-1, 1]) {
      const offset = destination(p.lat, p.lon, expected + sign * 90, 5000);
      const side = greatCircleLeg(a, b, offset), guidance = nav.update(offset, 10000, 220, 25);
      assert.ok(Math.abs(side.crossTrack - sign * 5000) < 1e-6);
      assert.equal(Math.sign(error(guidance.lnavHdg, side.course)), -sign);
    }
  }
}
console.log(`PASS Q01: ${checkpoints} world-route checkpoints, both lateral sides, max heading error ${maxError.toExponential(2)} deg`);
{
  // Independent equatorial expectations expose asin/acos unsigned folding and
  // planar-distance approximations, beyond 90 degrees and behind the origin.
  const a = {lat:0,lon:170}, b = {lat:0,lon:-70};
  for (const [position, along, xtk] of [[{lat:-10,lon:-90},100,10],[{lat:10,lon:160},-10,-10]]) {
    const leg = greatCircleLeg(a, b, position);
    assert.ok(Math.abs(leg.alongTrack - along * D2R * R_EARTH) < 1e-7);
    assert.ok(Math.abs(leg.crossTrack - xtk * D2R * R_EARTH) < 1e-7);
  }
  const nav = new Navigation(); nav.directTo(b, a);
  assert.ok(nav.update({lat:0,lon:160}, 10000, 220).routeActive, 'behind origin is not past endpoint');
  for (const [a,b] of [[{lat:0,lon:0},{lat:0,lon:0}],[{lat:0,lon:0},{lat:0,lon:180}]]) {
    const leg = greatCircleLeg(a,b,{lat:20,lon:30});
    for (const value of Object.values(leg)) assert.ok(Number.isFinite(value));
  }
  console.log('PASS Q01: signed spherical distances, date-line wrapping, behind-origin and degenerate fixes');
}
{
  // A great-circle continuation has no turn at the junction, despite its
  // incoming initial bearing differing greatly from its arrival tangent.
  const a = airports.get('EGLL'), b = airports.get('RJTT');
  const inbound = (bearing(b.lat,b.lon,a.lat,a.lon)+180)%360;
  const c = destination(b.lat,b.lon,inbound,300000), nav = new Navigation();
  nav.add(b); nav.add({...c,name:'CONTINUE'}); nav.activate(0,a);
  const p = destination(a.lat,a.lon,bearing(a.lat,a.lon,b.lat,b.lon),haversine(a.lat,a.lon,b.lat,b.lon)*.9);
  const out = nav.update(p,10000,220,25);
  assert.ok(out.turnDeg < 1e-7); assert.equal(out.turnInS,null);
  // A deliberate right-angle junction retains the full bank/speed fly-by lead.
  const turn = destination(b.lat,b.lon,inbound+90,300000), turning = new Navigation();
  turning.add(b); turning.add({...turn,name:'TURN'}); turning.activate(0,a);
  const before = destination(b.lat,b.lon,inbound+180,30000), next = turning.update(before,10000,220,25);
  assert.ok(Math.abs(next.turnDeg-90)<1e-7);
  const radius = 220**2 / (9.80665*Math.tan(25*D2R));
  assert.ok(Math.abs(next.turnInS-(30000-radius)/220)<1e-7);
  turning.update(destination(b.lat,b.lon,inbound+180,radius/2),10000,220,25);
  assert.equal(turning.active,1);
  console.log('PASS Q01: fly-by turn angle uses arrival tangent, straight continuation and bank-based lead preserved');
}
{
  // A lateral miss >2 km must still finish when passing the final-fix plane.
  // Repeat on a curved polar leg so terminal hold cannot regress to initial bearing.
  for (const sign of [-1,1]) {
    const a = airports.get('EGLL'), b = airports.get('RJTT'), nav = new Navigation(); nav.directTo(b,a);
    const inbound = (bearing(b.lat,b.lon,a.lat,a.lon)+180)%360;
    const beyond = destination(b.lat,b.lon,inbound,5000);
    const missed = destination(beyond.lat,beyond.lon,inbound+sign*90,15000);
    const out = nav.update(missed,10000,220,25);
    assert.ok(out.routeComplete && !out.routeActive && !out.valid);
    assert.ok(haversine(missed.lat,missed.lon,b.lat,b.lon)>15000);
    assert.equal(out.distNm,0); assert.equal(nav.totalNm(missed),0);
    const terminal = out.lnavHdg, sequence = nav.sequenced;
    assert.ok(Math.abs(error(terminal,bearing(a.lat,a.lon,b.lat,b.lon)))>100);
    for (const position of [a,b,missed,destination(b.lat,b.lon,inbound,1000000)]) {
      const held = nav.update(position,10000,220,25);
      assert.equal(held.lnavHdg,terminal); assert.equal(held.distNm,0);
      assert.ok(held.routeComplete && !held.routeActive); assert.equal(nav.sequenced,sequence);
    }
    nav.activate(0,a); assert.ok(nav.update(a,10000,220,25).routeActive);
    nav.directTo(b,a); assert.ok(nav.update(a,10000,220,25).routeActive);
    nav.clear(); assert.equal(nav.update(a,10000,220,25).lnavHdg,null);
  }
  console.log('PASS E03: missed final completes on passage, latches straight local terminal heading, explicit reactivation works');
}
{
  // Follow real guidance for the original 1,800-second class of lateral miss.
  const nav = new Navigation(), a = {lat:30,lon:0}, b = destination(30,0,90,20000);
  nav.directTo({...b,name:'FINAL'},a);
  let position = destination(30,0,0,5000), heading = 90, completedAt = null;
  for (let second=0;second<1800;second++) {
    const out = nav.update(position,10000,220,25);
    if (out.routeComplete && completedAt===null) completedAt=second;
    heading += Math.max(-1.2, Math.min(1.2, error(out.lnavHdg,heading)));
    position = destination(position.lat,position.lon,heading,220);
  }
  assert.notEqual(completedAt,null); assert.ok(completedAt<200);
  assert.ok(nav.done); assert.equal(nav.totalNm(position),0);
  console.log(`PASS E03: heading-following rig completes at ${completedAt}s and remains complete through 1,800s`);
}
