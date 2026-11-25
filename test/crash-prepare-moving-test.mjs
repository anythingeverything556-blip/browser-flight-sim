// Crash split cache vs a moving aircraft (round 5). In a browser Wreck.prepare() builds the fuselage/wing caches in idle slices over many frames
// while the render loop keeps moving and turning visual.root (camera-relative position, aircraft attitude). The caches used to pair an inverse
// root matrix taken when prepare() was called with mesh world matrices read frames later, so every impact missed the cache and split ~250k
// triangles on the spot (1.2-2.0 s of a 1.8-2.6 s wreck.start in a SwiftShader profile). Real GLBs in node; the root is moved between slices.

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

const { vite, load } = await createViteSsr();
const { AircraftVisual } = await load('/src/aircraft.js');
const { Wreck } = await load('/src/crash.js');

const scene = new THREE.Scene(), visual = new AircraftVisual(scene);
await visual.load('/models/SR71_sim.glb');
await new Promise((r) => setTimeout(r, 500));

// the "render loop": a new position and attitude every few ms while the slices run, world matrices brought up to date as a frame would
let frames = 0;
const loop = setInterval(() => {
  frames++;
  visual.root.position.set(Math.sin(frames) * 900, 40 + frames % 70, Math.cos(frames * 0.7) * 600);
  visual.root.quaternion.setFromEuler(new THREE.Euler(0.3 * Math.sin(frames * 0.3), frames * 0.11, 0.2 * Math.cos(frames * 0.5)));
  scene.updateMatrixWorld(true);
}, 2);
const wreck = new Wreck(scene);
const stats = await wreck.prepare(visual, 3);
clearInterval(loop);
assert.ok(stats.meshes >= 5 && stats.tris > 250000, `prepared ${stats.meshes} meshes / ${stats.tris} triangles`);
// any handful of moves between slices exercises the stale-matrix case; the count depends on machine speed (17-29 on a 2 vCPU sandbox, so > 20 was flaky)
assert.ok(frames > 5, `the root moved ${frames} times while the caches were built`);
console.log(`PASS prepare while the jet moves: ${stats.meshes} meshes, ${stats.tris} triangles, root moved ${frames} times between slices`);

// impact somewhere else again, attitude unlike any of the above
visual.root.position.set(-1234, 17, 4321); visual.root.quaternion.setFromEuler(new THREE.Euler(-0.4, 2.2, 0.35)); scene.updateMatrixWorld(true);
const fdm = { crashVel: new THREE.Vector3(140, -60, 0), crashW: new THREE.Vector3(), pos: visual.root.position.clone(), quat: visual.root.quaternion.clone(), crashInfo: { speed: 150, sinkRate: 60, pitch: 0.5 }, gearPos: 0, out: { M: 0.45, V: 150, nz: -2 } };
visual.real.interior.visible = false;
// the first crash is the one a player sees: no JIT warm-up run before it
let t0 = performance.now(); wreck.start(visual, fdm, 'impact'); const cold = performance.now() - t0;
const s = wreck.startStats;
assert.ok(s.cached >= 5 && s.perTriangle === 0, `cached ${s.cached}, split per triangle ${s.perTriangle}: ${JSON.stringify(s.misses).slice(0, 400)}`);
wreck.clear(visual);
t0 = performance.now(); wreck.start(visual, fdm, 'impact'); const warm = performance.now() - t0;
assert.ok(wreck.startStats.perTriangle === 0);
console.log(`PASS impact after a moving prepare takes the cache for every split mesh: ${s.cached} cached, ${s.perTriangle} per-triangle; wreck.start first ${cold.toFixed(0)} ms (pieces ${s.piecesMs}), again ${warm.toFixed(0)} ms`);
wreck.clear(visual);
console.log('crash-prepare-moving-test ok');
await vite.close(); process.exit(0);
