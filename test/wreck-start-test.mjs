// Crash breakup at impact (wreck.start): outside the cockpit view the hidden cockpit interior is not copied into the pieces. Real GLBs in node.

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createViteSsr } from './_ac-node.mjs';

const { vite, load } = await createViteSsr();
const { AircraftVisual } = await load('/src/aircraft.js');
const { __split, Wreck } = await load('/src/crash.js');
const { addSplitMesh, splitCache, splitAxis, meshRootName } = __split;

const scene = new THREE.Scene(), visual = new AircraftVisual(scene);
await visual.load('/models/SR71_sim.glb');
await new Promise((r) => setTimeout(r, 500));
visual.root.updateMatrixWorld(true);
const rootInverse = new THREE.Matrix4().copy(visual.root.matrixWorld).invert(), modelBounds = new THREE.Box3().setFromObject(visual.model).applyMatrix4(rootInverse);

const wreck = new Wreck(scene);
const t0 = performance.now(), stats = await wreck.prepare(visual, 50);
const prepMs = performance.now() - t0;
assert.ok(stats.meshes >= 5 && stats.tris > 250000, `prepared ${stats.meshes} meshes / ${stats.tris} triangles`);
console.log(`PASS prepare: ${stats.meshes} meshes, ${stats.tris} triangles, ${(stats.bytes / 2 ** 20).toFixed(1)} MB, ${prepMs.toFixed(0)} ms wall, ${stats.ms.toFixed(0)} ms of slices`);
const fdm = { crashVel: new THREE.Vector3(140, -60, 0), crashW: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(), crashInfo: { speed: 150, sinkRate: 60, pitch: 0.5 }, gearPos: 0, out: { M: 0.45, V: 150, nz: -2 } };
const tris = (root) => { let n = 0; root.traverse((o) => { const g = o.geometry; if (o.isMesh && g && g.attributes.position) n += Math.min(g.drawRange.count, (g.index ? g.index.count : g.attributes.position.count) - (g.drawRange.start || 0)) / 3; }); return n; }; // drawn triangles (cached pieces are index ranges)
const run = (interiorShown) => { visual.real.interior.visible = interiorShown; const t = performance.now(); wreck.start(visual, fdm, 'impact'); const ms = performance.now() - t; const n = tris(wreck.group); wreck.clear(visual); return { ms, n }; };
run(false); // JIT warm-up
const hidden = run(false), shown = run(true);
const interior = tris(visual.real.interior);
assert.ok(shown.n - hidden.n > interior * 0.5, `pieces ${hidden.n} (interior hidden) vs ${shown.n} (shown), interior ${interior}`);
console.log(`PASS chase-view breakup leaves the hidden cockpit interior out: ${Math.round(hidden.n)} vs ${Math.round(shown.n)} piece triangles, wreck.start ${hidden.ms.toFixed(0)} vs ${shown.ms.toFixed(0)} ms`);
console.log('wreck-start-test ok');
await vite.close(); process.exit(0);
