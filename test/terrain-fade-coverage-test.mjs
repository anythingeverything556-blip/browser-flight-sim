// LOD crossfade coverage (the black grainy tiles): while a tile swap dissolves (0.5 s), the incoming tile keeps the pixels where the screen noise is
// below its fade and the outgoing ghost the rest. Wherever the two do not add up to the whole tile, the holes show what is under the ground: black.
// Flies the Ultra terrain (turns, climbs, descents) and checks, every frame, sample points in every partly drawn tile: the visible meshes over each
// point must cover all of it. The bench rig: imagery and elevation answer at once, 60 Hz clock (a fade is 30 frames).
import * as THREE from 'three';
// fixed 60 Hz clock (the fades run on performance.now): the same frames every run, also under a loaded machine
let clock = 1000;
Object.defineProperty(performance, 'now', { value: () => clock, configurable: true });
globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return {}; } };
const { Terrain } = await import('../src/terrain.js');
const { Geo, D2R } = await import('../src/geo.js');

const LAT = 34.92, LON = -117.88, DEM_H = 700;
const dem = new Float32Array(65536);
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) dem[y * 256 + x] = DEM_H + 6 * Math.sin(x / 31) + 4 * Math.cos(y / 23);
const low = new Float32Array(16 * 16 * 3).fill(0.4);
const scene = new THREE.Scene(), geo = new Geo(LAT, LON), terrain = new Terrain(scene, geo, null);
terrain.detail = 3.0; terrain.leafCap = 460; terrain.setSeg(40); terrain.pxScale = 1; terrain.loadBoost = false; // Ultra
terrain.camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 4e6);
const pending = [];
terrain.loader.request = (msg, cb) => { msg.id = terrain.loader.nextId++; pending.push({ msg, cb }); return msg.id; };
terrain.loader.cancel = (id) => { const i = pending.findIndex((p) => p.msg.id === id); if (i >= 0) pending.splice(i, 1); };
const flush = () => { for (const { msg, cb } of pending.splice(0)) {
  if (msg.type === 'dem') cb({ id: msg.id, data: dem }); else if (msg.type === 'mask') cb({ id: msg.id, water: 0 });
  else cb({ id: msg.id, bmp: { width: msg.hi ? 512 : 256, height: msg.hi ? 512 : 256, close() {} }, low }); } };

const cov = (t) => (t.fade >= 0.999 ? 1 : t.fadeDir > 0.5 ? t.fade : 1 - t.fade); // share of the tile's pixels the shader keeps
let e = 0, n = 0, heading = 90, alt = DEM_H + 4, frames = 0, bad = 0, worst = 1, partialFrames = 0;
const examples = [], ex2 = [];
const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere(), kinds = {};
const check = () => {
  const vis = []; for (const t of terrain.tiles.values()) if (t.mesh && t.mesh.visible && t.mesh.parent) vis.push(t);
  fr.setFromProjectionMatrix(pm.multiplyMatrices(terrain.camera.projectionMatrix, terrain.camera.matrixWorldInverse));
  // on screen only: the tile's bounding sphere (camera-relative mesh position) inside the view frustum
  const onScreen = (t) => { t.mesh.updateMatrixWorld(); sph.copy(t.mesh.geometry.boundingSphere).applyMatrix4(t.mesh.matrixWorld); return fr.intersectsSphere(sph); };
  const partial = vis.filter((t) => t.fade < 0.999 && onScreen(t));
  if (partial.length) partialFrames++;
  for (const p of partial) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const Z = 30, px = (p.x + (i + 0.5) / 4) * 2 ** (Z - p.z), py = (p.y + (j + 0.5) / 4) * 2 ** (Z - p.z);
    let sum = 0; const who = [];
    for (const t of vis) { const s = 2 ** (Z - t.z); if (Math.floor(px / s) === t.x && Math.floor(py / s) === t.y) { sum += cov(t); who.push(`z${t.z} ${t.x},${t.y} fade ${t.fade.toFixed(2)} dir ${t.fadeDir} fadeT0 ${t.fadeT0 ? 'set' : 0} ${terrain.ghosts.includes(t) ? 'ghost of z' + (t.ghostOf && t.ghostOf.z) + ' ' + (t.ghostOf && t.ghostOf.x) + ',' + (t.ghostOf && t.ghostOf.y) + ' (partner fadeT0 ' + (t.ghostOf && t.ghostOf.fadeT0 ? 'set' : 0) + ', partner visible ' + !!(t.ghostOf && t.ghostOf.mesh && t.ghostOf.mesh.visible) + ')' : 'leaf'}`); } }
    // no visible leaf under a ghost: off screen when terrain's own view cone culled the leaf that is selected there (not a hole)
    if (sum < 0.99 && !who.some((w) => w.endsWith('leaf')) && terrain.drawn.some((t) => { const s = 2 ** (Z - t.z); return Math.floor(px / s) === t.x && Math.floor(py / s) === t.y && !t.inView; })) continue;
    if (sum < 0.99) { const leaf = who.some((w) => w.endsWith('leaf')), k = leaf ? 'leaf and partner short' : 'ghost with no leaf under it'; kinds[k] = (kinds[k] || 0) + 1; bad++; worst = Math.min(worst, sum); if ((leaf ? ex2 : examples).length < 4) (leaf ? ex2 : examples).push(`frame ${frames}: covered ${(sum * 100).toFixed(0)} % by [${who.join('; ')}]`); }
  }
};
const step = (speed, dHead, dAlt) => {
  heading += dHead; alt = Math.max(DEM_H + 4, alt + dAlt);
  e += Math.sin(heading * D2R) * speed / 60; n += Math.cos(heading * D2R) * speed / 60;
  const cw = { x: e, y: alt, z: -n }, ll = geo.toLatLon(cw.x, cw.z);
  terrain.camera.quaternion.setFromEuler(new THREE.Euler(-0.25, -heading * D2R + Math.PI / 2, 0, 'YXZ')); terrain.camera.updateMatrixWorld(true);
  clock += 16.667; flush(); terrain.update(cw, ll.lat, ll.lon); frames++; check();
};
const t0 = Date.now(); // wall time for the log only
for (let f = 0; f < 300; f++) step(0, 0, 0);                    // settle on the runway
for (let f = 0; f < 900; f++) step(250, 0.15, 12);              // climbing turn
for (let f = 0; f < 600; f++) step(600, -0.3, 0);               // fast turn the other way
for (let f = 0; f < 900; f++) step(300, 0.1, -12);              // descending turn
console.log(`${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${partialFrames} with a crossfade; uncovered samples: ${bad}${bad ? `, worst ${(worst * 100).toFixed(0)} % covered` : ''}`);
console.log('   by kind', JSON.stringify(kinds)); for (const x of [...ex2, ...examples]) console.log('   ' + x);
if (bad) { console.log('FAIL  crossfade leaves holes'); process.exit(1); }
console.log('PASS  every crossfading tile is fully covered by itself plus its partner');
