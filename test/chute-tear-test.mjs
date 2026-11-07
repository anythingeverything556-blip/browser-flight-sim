// Drag chute above the limit: it streams out and half-blossoms, then tears loose and the canopy falls away in world space. Below the limit it is unchanged. Real GLB in node.

import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

const { vite, load } = await createViteSsr();
const { AircraftVisual } = await load('/src/aircraft.js');
const { FlightModel } = await load('/src/flight.js');
const ok = (n, c, i = '') => { if (!c) { console.error(`FAIL  ${n} ${i}`); process.exit(1); } console.log(`PASS  ${n} ${i}`); };

const scene = new THREE.Scene(), visual = new AircraftVisual(scene);
await visual.load('/models/SR71_sim.glb');
await new Promise((r) => setTimeout(r, 300));
const env = { night: 0, elev: 0.5, sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize() }, cam = new THREE.Vector3(), wind = new THREE.Vector3(), DT = 1 / 120;

// flies the model with the chute pulled; returns what the visual showed
function run(speed, seconds, jettisonAt = -1) {
  const f = new FlightModel(), v = visual;
  v.chuteState = 'stowed'; v.torn.age = -1; v.tornChute.visible = false; v.chute.visible = false;
  f.reset(new THREE.Vector3(0, 300, 0), 90, speed, false, 0);
  const log = { openAtFail: null, failT: -1, visibleBeforeFail: false, maxScaleBeforeFail: 0, tornDist: [], hiddenAt: -1, tornParent: null, rootChildren: 0, vy0: 0, events: [] };
  f.chute = 'deployed'; f.chuteOpen = 0;
  let t = 0;
  const cams = cam.clone();
  while (t < seconds) {
    for (let i = 0; i < 2; i++) { f.step(DT, () => 0, wind); t += DT; }
    if (jettisonAt >= 0 && t >= jettisonAt && f.chute === 'deployed') f.chute = 'jettisoned';
    const st = f.chute;
    v.update(DT * 2, f, cams, 'chase', env, 0, null);
    for (const e of f.events.splice(0)) if (e === 'chute-fail') { log.failT = t; log.openAtFail = f.chuteOpen; }
    if (st === 'deployed') { log.visibleBeforeFail ||= v.chute.visible; log.maxScaleBeforeFail = Math.max(log.maxScaleBeforeFail, v.chute.scale.y); }
    if (v.torn.age >= 0 && log.tornDist.length < 600) log.tornDist.push({ age: v.torn.age, d: v.tornChute.position.distanceTo(v.root.position), vis: v.tornChute.visible, att: v.chute.visible });
    if (log.hiddenAt < 0 && v.torn.age < 0 && log.tornDist.length) log.hiddenAt = t;
  }
  log.tornParent = v.tornChute.parent; log.sceneIsParent = v.tornChute.parent === scene; log.final = { chute: f.chute, vis: v.tornChute.visible, attVis: v.chute.visible, V: f.out.V };
  return log;
}

// over the limit: 250 kt (129 m/s) at 300 m
const over = run(129, 9);
ok('above the limit the chute is shown before it fails', over.visibleBeforeFail && over.maxScaleBeforeFail > 0.2, `max open scale ${over.maxScaleBeforeFail.toFixed(2)}`);
ok('it fails once partly open, after 0.3-0.6 s', over.failT >= 0.3 && over.failT <= 0.6 && over.openAtFail > 0.2 && over.openAtFail < 0.5, `failed at ${over.failT.toFixed(2)} s, open ${over.openAtFail.toFixed(2)}`);
ok('the canopy is detached into the scene, not parented to the aircraft', over.sceneIsParent);
const first = over.tornDist[0], mid = over.tornDist.find((x) => x.age > 1.5);
ok('the attached chute is gone and the torn canopy appears at the tail', first && first.vis && !first.att && first.d < 40, `starts ${first && first.d.toFixed(1)} m from the CG`);
ok('the torn canopy falls back and away from the jet', mid && mid.d > 80, `${mid && mid.d.toFixed(0)} m behind at ${mid && mid.age.toFixed(1)} s`);
ok('it is hidden after a few seconds', over.hiddenAt > 0 && !over.final.vis && over.final.chute === 'failed', `hidden at ${over.hiddenAt.toFixed(1)} s`);

// below the limit: 150 kt (77 m/s), stays deployed and attached, nothing torn
const under = run(77, 4);
ok('below the limit the chute opens fully and stays attached', under.final.chute === 'deployed' && under.final.attVis && !under.final.vis && under.tornDist.length === 0 && under.maxScaleBeforeFail > 0.95, `scale ${under.maxScaleBeforeFail.toFixed(2)}`);
ok('below the limit nothing is torn off', under.failT < 0);

// jettison: the canopy is released and falls away too
const jet = run(77, 9, 2);
const jmid = jet.tornDist.find((x) => x.age > 1.5);
ok('a jettisoned chute is released and falls away', jet.final.chute === 'jettisoned' && jmid && jmid.d > 40 && !jet.final.vis && !jet.final.attVis, `${jmid && jmid.d.toFixed(0)} m at ${jmid && jmid.age.toFixed(1)} s`);

console.log('chute-tear-test ok');
await vite.close(); process.exit(0);
