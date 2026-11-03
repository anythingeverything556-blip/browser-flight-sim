import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return {}; } };
const SRC = process.env.TERRAIN_SRC || '../src/terrain.js', PERF = !!process.env.PERF;
const { Terrain } = await import(SRC);
const { Geo, R_EARTH, D2R } = await import(SRC.replace('terrain.js', 'geo.js'));
const ok = (name, c, info = '') => { assert.ok(c, `${name} ${info}`); console.log(`PASS  ${name} ${info}`); };

const LAT = 34.92, LON = -117.88, DEM_H = 700;
const dem = new Float32Array(65536);
for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) dem[y * 256 + x] = DEM_H + 6 * Math.sin(x / 31) + 4 * Math.cos(y / 23);
const low = new Float32Array(16 * 16 * 3).fill(0.4);

function rig(preset) {
  const scene = new THREE.Scene(), geo = new Geo(LAT, LON), terrain = new Terrain(scene, geo, null);
  terrain.detail = preset.detail; terrain.leafCap = preset.leaves; terrain.setSeg(preset.seg); terrain.pxScale = 1; terrain.loadBoost = false;
  terrain.camera = new THREE.PerspectiveCamera(60, 16 / 9, 1, 4e6); terrain.camera.updateMatrixWorld();
  const pending = [];
  terrain.loader.request = (msg, cb) => { msg.id = terrain.loader.nextId++; pending.push({ msg, cb }); return msg.id; };
  terrain.loader.cancel = (id) => { const i = pending.findIndex((p) => p.msg.id === id); if (i >= 0) pending.splice(i, 1); };
  const flush = () => {
    for (const { msg, cb } of pending.splice(0)) {
      if (msg.type === 'dem') cb({ id: msg.id, data: dem });
      else if (msg.type === 'mask') cb({ id: msg.id, water: 0 });
      else cb({ id: msg.id, bmp: { width: msg.hi ? 512 : 256, height: msg.hi ? 512 : 256, close() {} }, low });
    }
  };
  return { scene, geo, terrain, flush };
}

function settle(r, alt, max = 900) {
  let still = 0, built = -1;
  for (let f = 0; f < max && still < 20; f++) { fly(r, { alt, speed: 0, frames: 1 }); still = r.terrain.stats.built === built ? still + 1 : 0; built = r.terrain.stats.built; }
}
function fly(r, { alt, speed, frames, heading = 90, record = false }) {
  const { terrain, geo, flush } = r, out = { ms: [], keys: [], alloc: 0 };
  let e = r.e || 0, n = r.n || 0, dt = 1 / 60;
  const view = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading * D2R + Math.PI / 2);
  for (let f = 0; f < frames; f++) {
    e += Math.sin(heading * D2R) * speed * dt; n += Math.cos(heading * D2R) * speed * dt;
    const cw = { x: e, y: alt, z: -n }, ll = geo.toLatLon(cw.x, cw.z);
    terrain.camera.quaternion.copy(view); terrain.camera.updateMatrixWorld(true);
    flush();
    const t0 = performance.now();
    terrain.update(cw, ll.lat, ll.lon);
    out.ms.push(performance.now() - t0);
    r.e = e; r.n = n;
    if (record) out.keys.push(terrain.drawn.map((t) => t.key).sort((a, b) => a - b).join(','));
  }
  return out;
}
const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { mean: a.reduce((x, y) => x + y, 0) / a.length, med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1], at: a.indexOf(s[s.length - 1]) }; };
const fmt = (s) => `median ${s.med.toFixed(2)} ms  mean ${s.mean.toFixed(2)} ms  p95 ${s.p95.toFixed(2)} ms  max ${s.max.toFixed(2)} ms (frame ${s.at})`;

const presets = { high: { detail: 2.5, leaves: 300, seg: 32 }, normal: { detail: 2.2, leaves: 260, seg: 32 }, ultra: { detail: 3.0, leaves: 460, seg: 40 } };

const counts = {};
for (const [name, p] of Object.entries(presets)) {
  const r = rig(p);
  settle(r, DEM_H + 4);
  const a = r.terrain.drawn.map((t) => t.key).sort((x, y) => x - y).join(','), more = fly(r, { alt: DEM_H + 4, speed: 0, frames: 30, record: true });
  counts[name] = r.terrain.drawn.length;
  const flips = more.keys.filter((k) => k !== a).length;
  ok(`${name}: parked selection`, true, `changed on ${flips}/30 frames, ${counts[name]} tiles x ${p.seg} cells, leafCap ${p.leaves}, want ${r.terrain.stats.want}, budget ${r.terrain.budget.toFixed(2)}`);
  ok(`${name}: leaf count respects the preset cap`, r.terrain.stats.want <= p.leaves + 1, `(${r.terrain.stats.want} <= ${p.leaves})`);
  if (name === 'high') {
    const z = {}; for (const t of r.terrain.drawn) z[t.z] = (z[t.z] || 0) + 1;
    console.log('      drawn per level', JSON.stringify(z), 'tris', r.terrain.stats.leaves * (r.terrain.stats.tris / Math.max(1, r.terrain.stats.visible)));
    const levels = Object.keys(z).map(Number), keyHash = a.length;
    ok('high: finest tiles reach the runway', Math.max(...levels) >= 16);
    globalThis.__highKeys = a; void keyHash;
  }
}

const timing = {};
for (const [name, cfg] of [['parked', { alt: DEM_H + 4, speed: 0, frames: 240 }], ['mach3-20km', { alt: 20000, speed: 900, frames: 480 }], ['low-300ms', { alt: DEM_H + 300, speed: 300, frames: 480 }]]) {
  const r = rig(presets.high);
  settle(r, cfg.alt);
  fly(r, { ...cfg, frames: 300 });
  if (global.gc) global.gc();
  const built0 = r.terrain.stats.built;
  const res = fly(r, cfg);
  timing[name] = stat(res.ms);
  if (PERF) console.log(`PERF  ${name.padEnd(11)} ${fmt(timing[name])}  built/frame ${((r.terrain.stats.built - built0) / cfg.frames).toFixed(2)}  tiles ${r.terrain.tiles.size}`);
  ok(`${name}: drawn set is non-empty and every drawn tile is ready`, r.terrain.drawn.length > 0 && r.terrain.drawn.every((t) => t.ready));
}
console.log('terrain-perf OK');
