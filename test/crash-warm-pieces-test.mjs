// Crash piece warm-up (round 6): Wreck.warmPieces() builds the index runs of every breakup plan once the split caches exist and draws each once
// (in the browser: VAO + sorted-index upload before impact instead of in the first frames after it). Here: a stub renderer records what the warm-up
// draw would draw and with which lights; then impacts with every plan, the root moved and turned in between, must only use warmed run geometries.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

const { vite, load } = await createViteSsr();
const { AircraftVisual } = await load('/src/aircraft.js');
const { Wreck } = await load('/src/crash.js');

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
const scene = new THREE.Scene(), visual = new AircraftVisual(scene);
await visual.load('/models/SR71_sim.glb');
const sun = new THREE.DirectionalLight(0xffffff, 3); scene.add(sun);
visual.root.position.set(300, 40, -200); scene.updateMatrixWorld(true);
const wreck = new Wreck(scene);
await wreck.prepare(visual, 3);

const camera = new THREE.PerspectiveCamera(55, 1.7, 0.05, 1.2e7); camera.layers.enableAll(); camera.layers.disable(30);
const drawn = [], lightsSeen = [], camMask = camera.layers.mask;
const renderer = { autoClear: true, shadowMap: { autoUpdate: true }, rt: 'prev', getRenderTarget() { return this.rt; }, setRenderTarget(t) { this.rt = t; },
  render(sc, cam) { assert.equal(this.autoClear, false); assert.equal(this.shadowMap.autoUpdate, false);
    sc.traverseVisible((o) => { if (o.isMesh && o.layers.test(cam.layers)) drawn.push(o); if (o.isLight && o.layers.test(cam.layers)) lightsSeen.push(o); }); } };
const target = { name: 'sceneRT' };
const st = wreck.warmPieces(visual, renderer, scene, camera, target);
check('warm-up draws every run once, with the scene lights, and nothing else', () => {
  assert.ok(st.runs > 20, `${st.runs} runs`);
  assert.equal(drawn.length, st.runs);
  assert.ok(drawn.every((m) => m.scale.x === 0 && m.geometry.index && m.geometry.drawRange.count > 0 && m.geometry.drawRange.count <= m.geometry.index.count), 'only piece runs, scaled to nothing');
  assert.ok(lightsSeen.includes(sun), 'the sun is lit in the warm-up draw (same program as the impact)');
  console.log(`      ${st.runs} runs, ${st.ms} ms`);
});
check('renderer, camera, lights and scene are restored', () => {
  assert.equal(renderer.autoClear, true); assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.rt, 'prev'); assert.equal(camera.layers.mask, camMask);
  assert.equal(sun.layers.mask, 1); assert.ok(!scene.children.some((c) => c.layers.mask === 1 << 30));
});
check('a second warm-up has nothing left to draw', () => { drawn.length = 0; assert.equal(wreck.warmPieces(visual, renderer, scene, camera, target).runs, 0); assert.equal(drawn.length, 0); });

// impacts with every plan, the jet moved and turned since the warm-up: every cached piece geometry must be one the warm-up drew
const outcomes = [['hard-landing', 0.4], ['hard-landing', 0.51], ['hard-landing', 0.6], ['fast-shallow', 1], ['steep-impact', 1], ['structural-failure', 1]];
let i = 0;
for (const [outcome, score] of outcomes) {
  check(`${outcome} ${score}: impact draws only warmed runs`, () => {
    visual.root.position.set(-1234 + 100 * i, 17, 4321); visual.root.quaternion.setFromEuler(new THREE.Euler(-0.4 + 0.1 * i, 2.2 - i, 0.35)); scene.updateMatrixWorld(true); i++;
    const plan = wreck._plan({ outcome, score }), save = wreck._plan; wreck._plan = () => plan;
    const fdm = { crashVel: new THREE.Vector3(140, -60, 0), crashW: new THREE.Vector3(), pos: visual.root.position.clone(), quat: visual.root.quaternion.clone(), crashInfo: { speed: 150, sinkRate: 60, pitch: 0.5 }, gearPos: 0, out: { M: 0.45, V: 150, nz: 1 }, mass: 50000, fuelKg: 20000 };
    try { wreck.start(visual, fdm, 'impact'); } finally { wreck._plan = save; }
    let runs = 0, cold = 0;
    for (const p of wreck.pieces) p.g.traverse((o) => { if (o.isMesh && o.geometry.index && o.geometry.drawRange.count < o.geometry.index.count) { runs++; if (!o.geometry.userData.warmed) cold++; } });
    wreck.clear(visual);
    assert.ok(runs > 0, 'no cached runs drawn'); assert.equal(cold, 0, `${cold} of ${runs} runs were never drawn before the impact`);
  });
}
if (fails) { console.log(`${fails} failed`); await vite.close(); process.exit(1); }
console.log('crash-warm-pieces-test ok');
await vite.close(); process.exit(0);
