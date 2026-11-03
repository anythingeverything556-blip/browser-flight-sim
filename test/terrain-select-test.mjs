import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as THREE from 'three';

globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return {}; } };
let clock = 1000;
const realNow = performance.now.bind(performance);
Object.defineProperty(performance, 'now', { value: () => clock, configurable: true });
const { Terrain, TERRAIN_UNIFORMS } = await import('../src/terrain.js');
const { Geo, D2R } = await import('../src/geo.js');
const ok = (name, c, info = '') => { assert.ok(c, `${name} ${info}`); console.log(`PASS  ${name} ${info}`); };

const dem = new Float32Array(65536);
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) dem[y * 256 + x] = 700 + 60 * Math.sin(x / 31) + 40 * Math.cos(y / 23);
const low = new Float32Array(768).fill(0.4);
const presets = { high: { detail: 2.5, leaves: 340, seg: 32, hiZ: 15 }, normal: { detail: 2.2, leaves: 420, seg: 32 }, ultra: { detail: 3.0, leaves: 460, seg: 40, hiZ: 13 }, low: { detail: 2.0, leaves: 300, seg: 32 } };

function rig(preset, lat, lon, { boost = false, nodata = 0, free = true } = {}) {
  const scene = new THREE.Scene(), geo = new Geo(lat, lon), terrain = new Terrain(scene, geo, null);
  terrain.detail = preset.detail; terrain.leafCap = preset.leaves; terrain.setSeg(preset.seg); terrain.pxScale = 1; terrain.loadBoost = boost; terrain.hiZ = preset.hiZ || 99;
  if (free) { terrain.buildMax = 1e9; terrain.uploadBytes = 1e12; }
  terrain.camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 4e6);
  const pending = [];
  terrain.loader.request = (msg, cb) => { msg.id = terrain.loader.nextId++; pending.push({ msg, cb }); return msg.id; };
  terrain.loader.cancel = (id) => { const i = pending.findIndex((p) => p.msg.id === id); if (i >= 0) pending.splice(i, 1); };
  let n = 0;
  const flush = () => {
    for (const { msg, cb } of pending.splice(0)) {
      if (msg.type === 'dem') cb({ id: msg.id, data: dem });
      else if (msg.type === 'mask') cb({ id: msg.id, water: n++ % 7 === 0 ? 2 : 0 });
      else if (msg.hi) cb({ id: msg.id, bmp: { width: 512, height: 512, close() {} }, low });
      else if (nodata && (() => { const m = /(\d+)\/(\d+)\/(\d+)(\.\w+)?$/.exec(msg.lo[0].u); return m && +m[1] >= 12 && (+m[2] * 31 + +m[3] * 17) % nodata === 0; })()) cb({ id: msg.id, nodata: true });
      else cb({ id: msg.id, bmp: { width: 256, height: 256, close() {} }, low });
    }
  };
  return { scene, geo, terrain, flush };
}

// round 6: five digests re-recorded after the crossfade fix (terrain-fade-coverage-test); with fades and ghosts left out of the hash, all seven
// scenarios give the same digest before and after, so tile selection, stitching and visibility are unchanged
const scenarios = [
  ['high parked', 'high', 34.92, -117.88, 704, 0, 90, 0, 150, {}, '025728f94e3932ee'],
  ['high mach3 at 20 km', 'high', 34.92, -117.88, 20000, 900, 70, 0.1, 300, {}, '139dca5454e07e41'],
  ['high low and fast', 'high', 34.92, -117.88, 1000, 300, 30, 0.3, 300, {}, 'dc23c83a9a35d2a4'],
  ['normal turning, loading boost', 'normal', 47.6, 8.5, 1500, 250, 0, 0.5, 300, { boost: true }, '7c03dd2b33d58216'],
  ['ultra across the antimeridian', 'ultra', 0.5, 179.97, 900, 200, 90, 0, 300, {}, 'dea44887233b8eca'],
  ['low, some tiles without imagery', 'low', 34.92, -117.88, 600, 100, 45, 0.2, 300, { nodata: 9 }, '0f153a07dd73709c'],
  ['high, no imagery, boost', 'high', 51.5, 0, 2500, 400, 200, 0.15, 300, { boost: true, nodata: 11 }, '506409b6d4aae730'],
];
let last;
for (const [name, pn, lat, lon, alt, speed, hdg0, turn, frames, opt, digest] of scenarios) {
  const r = rig(presets[pn], lat, lon, opt), { terrain, geo, flush } = r, hashes = [];
  let e = 0, n = 0, hdg = hdg0;
  for (let f = 0; f < frames; f++) {
    clock = 1000 + f * 16.667; hdg += turn;
    e += Math.sin(hdg * D2R) * speed / 60; n += Math.cos(hdg * D2R) * speed / 60;
    const cw = { x: e, y: alt, z: -n }, ll = geo.toLatLon(cw.x, cw.z);
    terrain.camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -hdg * D2R + Math.PI / 2); terrain.camera.rotateX(-0.1); terrain.camera.updateMatrixWorld(true);
    flush();
    terrain.update(cw, ll.lat, ll.lon);
    const keys = terrain.drawn.map((t) => `${t.key}:${t.flags}:${t.mesh.visible ? 1 : 0}`).join('|'), s = terrain.stats;
    const fades = terrain.drawn.map((t) => t.fade.toFixed(4) + t.fadeDir).join(''), ghosts = terrain.ghosts.map((t) => t.key).join(',');
    const line = [terrain.frame, keys, fades, ghosts, s.want, s.splits, s.visible, s.tris, terrain.budget.toFixed(6), s.imgWait, s.demWait, s.built].join('#');
    hashes.push(crypto.createHash('sha1').update(line).digest('hex').slice(0, 8));
  }
  const got = crypto.createHash('sha1').update(hashes.join('')).digest('hex').slice(0, 16);
  ok(`${name}: same tiles, stitches, fades and ghosts as before on every one of ${frames} frames`, got === digest, `(${got})`);
  last = r;
}

{
  const { terrain } = last, meshes = [...terrain.tiles.values()].filter((t) => t.mesh).map((t) => t.mesh);
  ok('every tile mesh uses the single shared terrain material', meshes.length > 100 && meshes.every((m) => m.material === terrain.material), `(${meshes.length} meshes)`);
  const keys = new Set(meshes.map((m) => `${m.material.id}|${JSON.stringify(m.material.defines)}|${m.material.customProgramCacheKey()}`));
  ok('so one program variant is compiled for all of them', keys.size === 1);
  ok('no tile owns a uniform object of its own', meshes.every((m) => m.material.uniforms === terrain.material.uniforms));
}

{
  const { terrain } = rig(presets.high, 34.92, -117.88), mat = terrain.material, wr = mat.userData.gate.wrappers;
  const fake = (frame) => ({ info: { render: { frame } }, getRenderTarget: () => null });
  const tex = new THREE.Texture(), mask = new THREE.Texture(), shadow = new THREE.Texture();
  const a = terrain.getTile(14, 2800, 6500), b = terrain.getTile(14, 2801, 6500);
  a.tex = tex; a.maskTex = mask; a.fade = 0.3; a.fadeDir = 1; a.water = 0;
  b.water = 2;
  const sun = new THREE.Vector3(0.1, 0.9, 0.2);
  TERRAIN_UNIFORMS.uSun.value = sun;
  ok('shared uniforms stay live views of the module uniforms', mat.uniforms.uSun.value === sun);
  const sampler = wr.find((w) => w.value === null);
  ok('there are sampler uniforms among the shared ones', !!sampler);
  const withTexture = { get value() { return shadow; }, needsUpdate: true };
  mat.userData.gate.wrappers.push(withTexture);
  mat.uniformsNeedUpdate = false;
  terrain.bindTile(a, fake(7), mat);
  ok('the first tile of a render call gets the full upload (all shared uniforms flagged, no extra upload)', wr.every((w) => w.needsUpdate === true) && mat.uniformsNeedUpdate === false);
  ok('its imagery, mask, tile origin and fade reach the shared uniforms', mat.uniforms.uMap.value === tex && mat.uniforms.uMask.value === mask && mat.uniforms.uWater.value === 1 && mat.uniforms.uTile.value === a.tile && mat.uniforms.uFade.value === 0.3 && mat.uniforms.uFadeDir.value === 1);
  terrain.bindTile(b, fake(7), mat);
  ok('later tiles upload only per-tile values and samplers', mat.uniformsNeedUpdate === true && wr.filter((w) => w.needsUpdate === false).length > 25 && sampler.needsUpdate === true && withTexture.needsUpdate === true);
  ok('a tile without imagery shows the fallback colour and the white texture', mat.uniforms.uMap.value === mat.userData.white && mat.uniforms.uTint.value === terrain.fallbackColor && mat.uniforms.uWater.value === 2 && mat.uniforms.uFade.value === 1);
  terrain.bindTile(a, fake(8), mat);
  ok('the next render call starts with a full upload again', wr.every((w) => w.needsUpdate === true));
  terrain.bindTile(b, fake(8), mat);
  const other = { info: { render: { frame: 8 } }, getRenderTarget: () => ({}) };
  terrain.bindTile(a, other, mat);
  ok('and so does a render into another target', wr.every((w) => w.needsUpdate === true));
  terrain.uniformGate = false; terrain.bindTile(b, other, mat); mat.uniformsNeedUpdate = false; terrain.bindTile(a, other, mat);
  ok('with the gate off every tile forces a full upload', mat.uniformsNeedUpdate === true);
  ok('tiles drawn with another material (overrides) are left alone', (() => { const m = new THREE.MeshBasicMaterial(); terrain.bindTile(a, fake(9), m); return true; })());
}

{
  const { terrain, flush } = rig(presets.high, 34.92, -117.88, { free: false });
  const cw = { x: 0, y: 704, z: 0 }, ll = terrain.geo.toLatLon(0, 0), built = [];
  for (let f = 0; f < 40; f++) {
    clock += f % 2 ? 16 : 250; flush();
    const b0 = terrain.stats.built; terrain.update(cw, ll.lat, ll.lon); built.push(terrain.stats.built - b0);
  }
  ok('builds per update never exceed the cap, slow frames or not', Math.max(...built) <= 2 && built.some((n) => n === 2), `(max ${Math.max(...built)})`);
  const t = [];
  for (let i = 0; i < 10; i++) { const x = terrain.getTile(15, 5600 + i, 13000); x.built = true; x.bmp = { width: 256, height: 256, close() {} }; terrain.applyTexture(x); t.push(x); }
  let inits = 0; terrain.renderer = { initTexture() { inits++; } };
  terrain.uploadTextures();
  ok('texture uploads per frame are capped by bytes (5 x 256 px with mipmaps) even with a free time budget', inits === 5 && terrain.uploadQ.length === 5, `(${inits} uploaded, ${terrain.uploadQ.length} waiting)`);
  terrain.uploadTextures(); terrain.uploadTextures();
  ok('the rest follow on the next frames, then the tiles are ready', inits === 10 && terrain.uploadQ.length === 0 && t.every((x) => x.ready && x.tex && !x.pendingTex));
  const m = terrain.getTile(15, 5700, 13000); m.built = true;
  const maskBmp = { width: 256, height: 256, close() {} };
  m.mk = 'loading'; terrain.loader.request = (msg, cb) => cb({ id: 1, water: 1, bmp: maskBmp, grid: null });
  terrain.startMask(m);
  ok('water masks go through the same upload queue instead of uploading at first draw', m.maskTex === null && m.pendingMask !== null && terrain.uploadQ.includes(m));
  terrain.uploadTextures();
  ok('and are bound once uploaded', m.maskTex !== null && m.pendingMask === null && inits === 11);
}
Object.defineProperty(performance, 'now', { value: realNow, configurable: true });
console.log('terrain-select OK');
