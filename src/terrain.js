import * as THREE from 'three';
import { R_EARTH, D2R, lon2tx, lat2ty, tx2lon, ty2lat } from './geo.js';
import { handle as loadInMain } from './terrain-worker.js';
import { sharedTerrainMaterial, gateTerrainUniforms, TERRAIN_UNIFORMS } from './terrain-shader.js';
import { sourceFor, esriUrl as IMG_URL, ESRI_MAX } from './imagery-sources.js';
export { terrariumToHeights } from './terrain-dem.js';

// Real-world scenery: Esri World Imagery (with an OpenFreeMap water mask rendered as physically based sea) draped over AWS terrarium elevation, in a camera-centred quadtree.
// Crack-free by construction: tiles never overlap (a parent is only replaced once all four children are ready),
// neighbouring leaves differ by at most one level (2:1 balance, corners included) and a tile whose neighbour is
// coarser snaps its shared edge to that neighbour's vertices. Fetching and DEM cleaning run in a worker.
// The elevation service is HTTP/1.1 and serves identical tiles from two hostnames, so tiles are sharded across them
// (deterministically, to keep browser caching) to get twice the browser's per-host connection limit.
const DEM_HOSTS = ['https://s3.amazonaws.com/elevation-tiles-prod', 'https://elevation-tiles-prod.s3.amazonaws.com'];
// sharper national / regional orthophotos where they exist (imagery-sources.js); Esri everywhere else
const DEM_URL = (z, x, y) => `${DEM_HOSTS[(x + y) & 1]}/terrarium/${z}/${x}/${y}.png`;
const DEM_MAX = 15; // AWS terrarium's deepest level (~4.8 m/px at the equator)
const ROOT_Z = 6;
const DEM_PAD = 6; // pixels of neighbour data a tile needs around itself (bicubic taps + normal apron)
// Chrome allows 6 connections per HTTP/1.1 host (two hosts each): more in flight would only queue unseen (and uncancellable) inside the browser.
// Imagery leaves a little headroom on server.arcgisonline.com for the building and tree workers' Esri requests.
// Slots count single requests (a 512 px composite costs four); every other imagery source has its own pool.
const IMG_SLOTS = 12, DEM_SLOTS = 12, BUILD_MS = 3, BUILD_MAX = 2, UPLOAD_MS = 2, UPLOAD_BYTES = 1.5 * 2 ** 20, DEM_CAP = 260, STALE_MS = 4000;

// Earth-curvature drop applied in the vertex shader. The camera sits at the world origin
// (camera-relative rendering), so the drop is simply d^2 / 2R of the horizontal distance.
const CURVATURE_VERTEX = `
  vec4 wpos = modelMatrix * vec4( transformed, 1.0 );
  wpos.y -= dot( wpos.xz, wpos.xz ) * ${(0.5 / R_EARTH).toExponential(8)};
  vec4 mvPosition = viewMatrix * wpos;
  gl_Position = projectionMatrix * mvPosition;
`;
export { TERRAIN_UNIFORMS };
export function applyCurvature(material) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', CURVATURE_VERTEX);
  };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|curved';
  return material;
}

// ---------- shared grid topology ----------
// SEG cells per tile side (graphics preset; the same for every tile, which the edge stitching relies on).
// vertices: NV*NV grid, then 4*SEG skirt vertices (boundary copies dropped a little; they only hide float pinholes)
let SEG, NV, PAD, RING, INDEX, UV, TRIS, EDGE_AT, CORNER_AT;
function topology(seg) {
  SEG = seg; NV = SEG + 1; PAD = SEG + 3;
  RING = new Uint16Array(4 * SEG);
  for (let i = 0; i < SEG; i++) { RING[i] = i; RING[SEG + i] = i * NV + SEG; RING[2 * SEG + i] = SEG * NV + SEG - i; RING[3 * SEG + i] = (SEG - i) * NV; }
  const idx = [];
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;
    if ((i + j) & 1) idx.push(a, c, d, a, d, b); else idx.push(a, c, b, b, c, d);
  }
  for (let q = 0; q < RING.length; q++) {
    const a = RING[q], b = RING[(q + 1) % RING.length], a2 = NV * NV + q, b2 = NV * NV + (q + 1) % RING.length;
    idx.push(a, b, a2, b, b2, a2);
  }
  INDEX = new THREE.BufferAttribute(new Uint16Array(idx), 1);
  const uv = new Float32Array((NV * NV + RING.length) * 2);
  for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) { uv[(j * NV + i) * 2] = i / SEG; uv[(j * NV + i) * 2 + 1] = j / SEG; }
  for (let q = 0; q < RING.length; q++) { uv[(NV * NV + q) * 2] = uv[RING[q] * 2]; uv[(NV * NV + q) * 2 + 1] = uv[RING[q] * 2 + 1]; }
  UV = new THREE.BufferAttribute(uv, 2);
  TRIS = INDEX.count / 3;
  EDGE_AT = [(k) => k, (k) => k * NV + SEG, (k) => SEG * NV + k, (k) => k * NV]; // grid index of the k-th vertex along N E S W
  CORNER_AT = [[0, 0, 0], [SEG, 0, SEG], [SEG * NV + SEG, 1, SEG], [SEG * NV, 2, 0]]; // grid index, edge and k holding the coarse value
}
topology(32);

// neighbour directions in tile space (y grows southwards) with their stitch-mask bit: edges N E S W, corners NW NE SE SW
const DIRS = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8], [-1, -1, 16], [1, -1, 32], [1, 1, 64], [-1, 1, 128]];
const CORNER_MASK = [1 | 8 | 16, 1 | 2 | 32, 2 | 4 | 64, 4 | 8 | 128]; // NW NE SE SW

const nk = (x, y) => x * 2097152 + y;
const tkey = (z, x, y) => z * 4398046511104 + x * 2097152 + y;
const dkey = (L, x, y) => L * 1073741824 + x * 32768 + y;
const demLevel = (z) => Math.max(0, Math.min(DEM_MAX, z - 2)); // 1 DEM pixel per mesh cell (256 px over 4 tiles of 64 cells)
const wrapLon = (d) => ((d + 540) % 360) - 180;
const backoff = (n) => Math.min(8000, 600 * 2 ** (n - 1));
const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const byScore = (a, b) => a.score - b.score, byD = (a, b) => a.d - b.d, byWanted = (a, b) => a.wantedAt - b.wantedAt;
const related = (a, b) => { const hi = a.z < b.z ? a : b, lo = hi === a ? b : a, sh = lo.z - hi.z; return (lo.x >> sh) === hi.x && (lo.y >> sh) === hi.y; };
const TINT_WHITE = new THREE.Color(1, 1, 1);

// Talks to the worker; falls back to running the same code on the main thread if Workers are unavailable.
class Loader {
  constructor() {
    this.jobs = new Map(); this.nextId = 1; this.worker = null;
    try {
      this.worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.done(e.data);
      this.worker.onerror = () => { this.worker = null; for (const j of [...this.jobs.values()]) loadInMain(j.msg, (m) => this.done(m)); };
    } catch (e) { this.worker = null; }
  }
  request(msg, cb) {
    msg.id = this.nextId++;
    this.jobs.set(msg.id, { msg, cb });
    if (this.worker) this.worker.postMessage(msg); else loadInMain(msg, (m) => this.done(m));
    return msg.id;
  }
  cancel(id) {
    if (!this.jobs.delete(id)) return;
    if (this.worker) this.worker.postMessage({ type: 'cancel', id }); else loadInMain({ type: 'cancel', id }, () => {});
  }
  done(m) {
    const j = this.jobs.get(m.id);
    if (!j) { if (m.bmp && m.bmp.close) m.bmp.close(); return; }
    this.jobs.delete(m.id); j.cb(m);
  }
}

class Tile {
  constructor(key, z, x, y) {
    this.key = key; this.z = z; this.x = x; this.y = y;
    this.img = 'none'; this.jobId = 0; this.tries = 0; this.retryAt = 0; this.bmp = null; this.tex = null; this.texBytes = 0; this.built = false; this.ready = false; this.mesh = null; this.demList = []; this.demEpoch = -1;
    this.mk = 'none'; this.mkJob = 0; this.mkTries = 0; this.mkAt = 0; this.water = 0; this.waterGrid = null; this.maskTex = null; this.pendingMask = null; this.pendingTex = null; this.queued = false; this.disposed = false;
    this.wantedAt = 0; this.score = 0; this.frame = -1; this.d = 0; this.inView = true; this.hMid = null; this.flags = -1; this.drawFrame = -1; this.splitFrame = -9; this.reshape = false; this.refit = false; this.usedFallback = false; this.geoVersion = -1; this.cosB = 1;
    this.up = null; this.kids = null; this.nb = [null, null, null, null, null, null, null, null, null]; this.sel = 0; this.selI = 0; this.pres = 0; this.leafFrame = -9; this.leafPrev = -9; this.ns = false; this.nsAt = -1;
    this.fade = 1; this.fadeDir = 0; this.fadeT0 = 0; this.ghostT0 = 0; this.ghostOf = null; this.wx = 0; this.wz = 0;
    this.src = undefined; this.imgSrc = null; this.imgCost = 0; this.low = null; this.hi = undefined; this.hiJob = 0; this.hiSrc = null; this.hiRetry = 0; this._r = null;
    this.pos = null; this.nor = null; this.H = null; this.lat = null; this.lon = null; this.raw = null; this.rawC = null; this.Hc = null; this.hw2 = 0; this.skirt = 0;
    this.lat1 = ty2lat(y, z); this.lat0 = ty2lat(y + 1, z); this.lon0 = tx2lon(x, z); this.lon1 = tx2lon(x + 1, z);
    this.clat = ty2lat(y + 0.5, z); this.clon = tx2lon(x + 0.5, z);
    this.hh = (this.lat1 - this.lat0) * 0.5 * D2R * R_EARTH; this.hw = (this.lon1 - this.lon0) * 0.5 * D2R * R_EARTH * Math.cos(this.clat * D2R);
    this.size = this.hw * 2; this.rad = Math.sqrt(this.hw * this.hw + this.hh * this.hh);
    const wsz = 40075016.686 / 2 ** z;
    this.tile = new THREE.Vector4((x * wsz) % 4096, (y * wsz) % 4096, wsz, 0);
  }
}

export class Terrain {
  constructor(scene, geo, db) {
    this.scene = scene; this.geo = geo; this.db = db;
    this.group = new THREE.Group(); scene.add(this.group);
    this.tiles = new Map(); this.dem = new Map(); this.noSplit = new Set(); this.pins = new Set();
    this.loader = new Loader();
    this.frame = 0; this.detail = 2.0; this.maxZ = 20; this.budget = 1;
    this.pxScale = 1;   // render height / field of view relative to a 720p reference: finer tiles are wanted when more pixels are on screen (main.js)
    this.lastNow = 0; this.vel = { e: 0, n: 0, u: 0 }; this.prevCam = { lat: 0, lon: 0, h: 0, set: false }; // camera velocity (m/s), for loading ahead of a fast aircraft
    this.leafCap = 260; // on-screen leaf tiles before the split criterion is coarsened (set by the graphics preset)
    this.hiZ = 99;      // from this level on, tiles get 512 px imagery composited from the next level (graphics preset)
    this.srcActive = {}; // requests in flight per imagery source
    this.texBytes = 0; this.texCap = 400 * 2 ** 20; // GPU bytes of imagery kept (graphics preset); 512 px tiles cost 4x
    this.uploadQ = []; this.renderer = null; // set by main.js: textures are uploaded a few per frame
    this.daylight = new THREE.Color(1, 1, 1);
    this.stats = { imgOk: 0, imgFail: 0, imgNodata: 0, demOk: 0, demFail: 0, visible: 0, draws: 0, tris: 0, tiles: 0, built: 0, imgActive: 0, demActive: 0, imgWait: 0, demWait: 0 };
    this.cam = { lat: 0, lon: 0, cos: 1, h: 0, ground: 0, agl: 100, ahead: null };
    this.fallbackColor = new THREE.Color(0x6f7a4f);
    this.anisotropy = 8;
    this.drawn = []; this.camera = null; this.now = performance.now();
    this.material = sharedTerrainMaterial(); this.uniformGate = true;
    this.ghosts = []; this.buildMax = BUILD_MAX; this.uploadBytes = UPLOAD_BYTES; this.selStamp = 0; this.presStamp = 0; this.demEpoch = 0; this.roots = []; this._rootId = -1; this._regionStamp = 0; this._regionMark = new Int32Array(4096); this.reshapeQ = [];
    this._SL = []; this._wanted = []; this._imgJobs = []; this._demJobs = []; this._builds = []; this._ups = []; this._cur = []; this._next = []; this._leaves = []; this._drawnB = []; this._lost = []; this._old = [];
    this._ahead = { e: 0, n: 0, u: 0 }; this._view = { x: 0, y: 0, z: -1, half: 1, cosH: 1, sinH: 0 }; this._dir = new THREE.Vector3(); this._vn = null; this._k = 1; this._farD = 8000; this._stamp = 0; this._selN = 0;
    this._p = new Float64Array(16); this._rows = new Float64Array(4);
    this._last = { L: -1, x: -1, y: -1, d: null };
    // learn the viewing camera from the renderer, so refinement can favour what is on screen
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (r, s, camera, ...rest) => { if (camera.isPerspectiveCamera) this.camera = camera; prev.call(scene, r, s, camera, ...rest); };
  }

  // fraction of the leaf tiles within `radius` metres that are showing their imagery: spawns wait for this so the first
  // look at a place is sharp rather than a blurry level that sharpens in front of the player
  // detail level (tile zoom) currently drawn at a point, -1 when nothing covers it: a coarse tile can sit metres above a runway
  levelAt(lat, lon) {
    const r = lat * Math.PI / 180, fy = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2, fx = (lon + 180) / 360;
    let best = -1;
    for (const t of this.drawn) { const n = 2 ** t.z; if (Math.floor(fx * n) === t.x && Math.floor(fy * n) === t.y && t.z > best) best = t.z; }
    return best;
  }
  sceneryProgress(radius = 3500) {
    let n = 0, ok = 0;
    for (const t of this.drawn) if (t.d < radius && t.inView) { n++; if (t.tex && !t.pendingTex) ok++; }
    for (const t of this.tiles.values()) if (t.drawFrame !== this.frame && t.wantedAt === this.now && t.d < radius && t.inView && t.z >= 12 && !t.ready) n++;
    return n ? ok / n : 0;
  }

  // ---------- elevation ----------
  demEntry(L, x, y) {
    const key = dkey(L, x, y);
    let e = this.dem.get(key);
    if (!e) {
      e = { key, z: L, x, y, state: 'none', data: null, tries: 0, retryAt: 0, settled: false, wantedAt: 0, score: 1e9, listed: -1, used: this.frame, jobId: 0, pin: false, failed: false };
      this.dem.set(key, e);
    }
    return e;
  }
  startDem(e) {
    e.state = 'loading'; this.stats.demActive++;
    e.jobId = this.loader.request({ type: 'dem', url: DEM_URL(e.z, e.x, e.y), z: e.z, x: e.x, y: e.y }, (m) => {
      this.stats.demActive--; e.jobId = 0; this._last.L = -1;
      this.pumpDem();
      if (m.data) { e.data = m.data; e.state = 'ready'; e.settled = true; this.stats.demOk++; if (e.failed) this.rebuildFallbacks(); return; }
      const gone = m.status === 404 || m.status === 410;
      this.stats.demFail++; e.tries++; e.state = 'failed'; e.failed = true;
      e.settled = gone || e.tries >= 4;
      e.retryAt = this.now + (gone ? 600000 : e.settled ? 60000 : backoff(e.tries));
    });
  }
  // Connections are refilled from the sorted queue as each request completes, not once per frame: at 10 fps (or 1 fps in a
  // slow frame) the ten slots otherwise sat idle between frames while hundreds of tiles waited.
  pumpDem() {
    const q = this.demQueue; if (!q) return;
    for (let i = 0; i < q.length && this.stats.demActive < DEM_SLOTS; i++) {
      const e = q[i];
      if (e.state === 'loading' || e.state === 'ready' || this.now - e.wantedAt > 1500) continue;
      if (e.state === 'none' || (e.state === 'failed' && this.now >= e.retryAt)) this.startDem(e);
    }
  }
  pumpImg() {
    const q = this.imgQueue; if (!q) return;
    for (let i = 0; i < q.length; i++) {
      const t = q[i];
      if (t.disposed || this.now - t.wantedAt > 1500) continue;
      if ((t.img === 'none' || (t.img === 'failed' && this.now >= t.retryAt)) && this.imgSlotsFree(t)) this.startImage(t);
    }
  }
  cancelDem(e) { this.loader.cancel(e.jobId); e.jobId = 0; e.state = 'none'; this.stats.demActive--; }
  // tiles built on a coarser stand-in for a DEM tile that has since arrived get reshaped
  rebuildFallbacks() { for (const t of this.tiles.values()) if (t.built && t.usedFallback) this.markReshape(t, true); }
  trimDem() {
    if (this.dem.size <= DEM_CAP) return;
    const old = [...this.dem.values()].filter((e) => e.state !== 'loading' && !e.pin && this.now - e.wantedAt > 3000).sort((a, b) => a.used - b.used);
    for (let i = 0; i < old.length && this.dem.size > DEM_CAP; i++) this.dem.delete(old[i].key);
    this._last.L = -1; this.demEpoch++;
  }
  // one source pixel at DEM level L; neighbouring DEM tiles are consulted so tile borders are seamless
  pix(L, gx, gy) {
    const W = (1 << L) * 256;
    if (gy < 0) gy = 0; else if (gy >= W) gy = W - 1;
    gx = ((gx % W) + W) % W;
    const tx = gx >> 8, ty = gy >> 8, c = this._last;
    if (c.L !== L || c.x !== tx || c.y !== ty) {
      const e = this.dem.get(dkey(L, tx, ty));
      c.L = L; c.x = tx; c.y = ty; c.d = e && e.state === 'ready' ? e.data : null;
      if (e) e.used = this.frame;
    }
    if (c.d) return c.d[(gy & 255) * 256 + (gx & 255)];
    if (L === 0) return 0;
    this.usedFallback = true;
    // missing tile: nearest loaded coarser level, read directly. (A bicubic fallback recursed 16 taps per level,
    // exponential in the number of missing levels, and froze the page while trees/buildings sampled heights.)
    for (let l = L - 1; l >= 0; l--) {
      const s = L - l, Wl = (1 << l) * 256, x = Math.min(Wl - 1, gx >> s), y = Math.min(Wl - 1, gy >> s);
      const e = this.dem.get(dkey(l, x >> 8, y >> 8));
      if (e && e.state === 'ready') return e.data[(y & 255) * 256 + (x & 255)];
    }
    return 0;
  }
  // bicubic (Catmull-Rom, clamped to the central taps so cliffs cannot overshoot); fx, fy in tile units of level L
  sampleL(L, fx, fy, P = this._p, R = this._rows) {
    const gx = fx * 256 - 0.5, gy = fy * 256 - 0.5, ix = Math.floor(gx), iy = Math.floor(gy), u = gx - ix, v = gy - iy;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) P[j * 4 + i] = this.pix(L, ix - 1 + i, iy - 1 + j);
    for (let j = 0; j < 4; j++) R[j] = cr(P[j * 4], P[j * 4 + 1], P[j * 4 + 2], P[j * 4 + 3], u);
    const h = cr(R[0], R[1], R[2], R[3], v);
    const lo = Math.min(P[5], P[6], P[9], P[10]), hi = Math.max(P[5], P[6], P[9], P[10]);
    return h < lo ? lo : h > hi ? hi : h;
  }
  rawHeight(lat, lon) {
    for (let L = DEM_MAX; L >= 0; L--) {
      const n = 1 << L, fx = lon2tx(lon, L), fy = lat2ty(lat, L), x = Math.floor(fx), y = Math.floor(fy);
      const e = this.dem.get(dkey(L, ((x % n) + n) % n, y));
      if (e && e.state === 'ready') { e.used = this.frame; return this.sampleL(L, fx, fy); }
    }
    return null;
  }
  flatten(lat, lon, h) { return this.db && this.db.ready ? this.db.flatten(lat, lon, h) : h; }
  heightAt(lat, lon) { return this.flatten(lat, lon, this.rawHeight(lat, lon)); }
  // Is there water at this point? true / false from the finest loaded water mask covering it, null when none has arrived yet. The mask is the one the
  // terrain shader draws (OpenStreetMap water polygons), so what looks like water is water.
  waterAt(lat, lon) {
    for (let z = Math.min(14, this.maxZ); z >= ROOT_Z; z--) {
      const n = 1 << z, fx = lon2tx(lon, z), fy = lat2ty(lat, z), x = Math.floor(fx), y = Math.floor(fy);
      const t = this.tiles.get(tkey(z, ((x % n) + n) % n, y));
      if (!t || t.mk !== 'ready') continue;
      if (t.water === 2) return true;
      if (t.water === 0) return false;
      if (t.waterGrid) return t.waterGrid[Math.min(15, ((fy - y) * 16) | 0) * 16 + Math.min(15, ((fx - x) * 16) | 0)] === 1;
      return false;
    }
    return null;
  }
  demAt(L, lat, lon) {
    const n = 1 << L;
    return this.demEntry(L, ((Math.floor(lon2tx(lon, L)) % n) + n) % n, Math.min(n - 1, Math.max(0, Math.floor(lat2ty(lat, L)))));
  }
  // spawn points pin their elevation tiles (fine, plus coarse stand-ins) at the front of the queue
  requestHeight(lat, lon) {
    for (const L of [DEM_MAX, 10, 7]) { const e = this.demAt(L, lat, lon); e.pin = true; e.wantedAt = this.now; this.pins.add(e); }
  }
  heightReady(lat, lon) {
    const e = this.demAt(DEM_MAX, lat, lon);
    return e.state === 'ready' || e.settled;
  }

  // ---------- tiles ----------
  getTile(z, x, y) {
    const key = tkey(z, x, y);
    let t = this.tiles.get(key);
    if (!t) {
      t = new Tile(key, z, x, y);
      this.tiles.set(key, t);
    }
    return t;
  }
  tileDems(t) {
    const out = [], seen = new Set();
    const add = (L) => {
      const s = 2 ** (t.z - L), n = 1 << L;
      const px0 = t.x / s * 256 - DEM_PAD, px1 = (t.x + 1) / s * 256 + DEM_PAD, py0 = t.y / s * 256 - DEM_PAD, py1 = (t.y + 1) / s * 256 + DEM_PAD;
      for (let ty = Math.floor(py0 / 256); ty <= Math.floor(py1 / 256); ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = Math.floor(px0 / 256); tx <= Math.floor(px1 / 256); tx++) {
          const X = ((tx % n) + n) % n, k = dkey(L, X, ty);
          if (!seen.has(k)) { seen.add(k); out.push(this.demEntry(L, X, ty)); }
        }
      }
    };
    add(demLevel(t.z));
    if (t.z > ROOT_Z) add(demLevel(t.z - 1));
    return out;
  }
  startMask(t) {
    t.mk = 'loading'; t.mkAt = this.now;
    t.mkJob = this.loader.request({ type: 'mask', z: t.z, x: t.x, y: t.y }, (m) => {
      t.mkJob = 0;
      if (t.disposed) { if (m.bmp) m.bmp.close(); return; }
      if (m.error || m.status) { t.mk = 'failed'; t.mkTries++; return; }
      t.mk = 'ready'; t.water = m.water || 0; t.waterGrid = m.grid || null;
      if (m.bmp) {
        const tex = new THREE.Texture(m.bmp);
        tex.flipY = false; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
        if (t.pendingMask) { t.pendingMask.dispose(); t.pendingMask.image.close && t.pendingMask.image.close(); }
        t.pendingMask = tex; this.queueUpload(t);
      }
    });
  }
  source(t) { if (t.src === undefined) t.src = sourceFor(t.z, t.clon, t.clat); return t.src; }
  imgSlotsFree(t) { const s = this.source(t); return s ? (this.srcActive[s.id] || 0) < s.slots : this.stats.imgActive < IMG_SLOTS; }
  releaseImg(t) {
    if (t.imgSrc) this.srcActive[t.imgSrc.id] -= t.imgCost; else this.stats.imgActive -= t.imgCost;
    t.imgCost = 0;
  }
  // request entry for the worker. b: the source paints outside its coverage (the worker checks for blank areas), g: colour curve
  imgReq(src, z, x, y) { return src ? { u: src.url(z, x, y), b: 1, g: src.id } : { u: IMG_URL(z, x, y) }; }
  srcMaxZ(t) { const s = this.source(t); return s ? s.max : ESRI_MAX; }
  // colour-balance cells per tile side: a few hundred metres each (see finish() in terrain-worker.js)
  balCells(t) { const c = t.size / 400; return c >= 8 ? 8 : c >= 4 ? 4 : c >= 2 ? 2 : 1; }
  // low-res colours (cells x cells x RGB) a tile's image is balanced to: its parent's quadrant, or its own for a 512 px
  // upgrade. null when the parent has none (roots, or the parent was evicted).
  // When the parent is gone (evicted) or has no colours yet, the nearest ancestor that has them is used, so a tile is never left unbalanced next to
  // balanced neighbours (that showed as one half of an airport reddish and the other greenish). The returned array carries its cell count in .n.
  balRef(t, own) {
    let L, ox = 0, oy = 0, span = 16;
    if (own) L = t.low;
    else {
      for (let up = 1; up <= 6 && t.z - up >= ROOT_Z; up++) {
        const a = this.tiles.get(tkey(t.z - up, t.x >> up, t.y >> up));
        if (a && a.low) {
          L = a.low; span = 16 / (1 << up); ox = (t.x & ((1 << up) - 1)) * span; oy = (t.y & ((1 << up) - 1)) * span;
          if (span < 1) { L = null; } // further than the colour grid can resolve
          break;
        }
      }
    }
    if (!L) return null;
    const n = Math.min(this.balCells(t), Math.max(1, Math.floor(span))), k = span / n, ref = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) {
      let s = 0, cnt = 0;
      for (let j = 0; j < Math.max(1, k); j++) for (let i = 0; i < Math.max(1, k); i++) { s += L[((Math.floor(oy + y * k) + j) * 16 + Math.floor(ox + x * k) + i) * 3 + c]; cnt++; }
      ref[(y * n + x) * 3 + c] = s / cnt;
    }
    ref.n = n;
    return ref;
  }
  startImage(t) {
    const src = this.source(t), z = t.z, x = t.x, y = t.y;
    const lo = src ? [this.imgReq(src, z, x, y), { u: IMG_URL(z, x, y) }] : [this.imgReq(null, z, x, y)];
    const ref = this.balRef(t, false), cells = ref ? ref.n : this.balCells(t);
    t.img = 'loading'; t.imgSrc = src; t.imgCost = 1;
    if (src) this.srcActive[src.id] = (this.srcActive[src.id] || 0) + 1; else this.stats.imgActive++;
    if (t.mk === 'none' || (t.mk === 'failed' && t.mkTries < 3)) this.startMask(t);
    t.jobId = this.loader.request({ type: 'img', hi: null, lo, ref, cells }, (m) => {
      this.releaseImg(t); t.jobId = 0;
      this.pumpImg();
      if (t.disposed) { if (m.bmp) m.bmp.close(); return; }
      if (m.bmp) {
        t.bmp = m.bmp; t.img = 'ready'; t.low = m.low; this.stats.imgOk++;
        if (t.built) this.applyTexture(t);
        return;
      }
      if (m.nodata || m.status === 404 || m.status === 410) {
        t.img = 'nodata'; this.stats.imgNodata++;
        if (t.z > ROOT_Z) this.noSplit.add(tkey(t.z - 1, t.x >> 1, t.y >> 1)); // no imagery this deep here: parent stays a leaf
        return;
      }
      t.tries++; t.img = 'failed'; this.stats.imgFail++; t.retryAt = this.now + backoff(t.tries);
    });
  }
  cancelImage(t) {
    this.loader.cancel(t.jobId); t.jobId = 0; t.img = 'none'; this.releaseImg(t);
    if (t.mkJob) { this.loader.cancel(t.mkJob); t.mkJob = 0; t.mk = 'none'; }
  }
  // Progressive sharpening: a displayed tile from hiZ on later swaps its 256 px image for a 512 px one composited from the
  // four tiles of the next level (twice the texel density). Runs only when no base imagery is waiting, nearest first, so
  // the ground fills in quickly and sharpens when there is bandwidth to spare. The four requests are the children's own
  // tiles, so if the tile is split later they come from the browser cache.
  startHi(t) {
    const src = this.source(t), z = t.z + 1, x = 2 * t.x, y = 2 * t.y;
    const hi = [this.imgReq(src, z, x, y), this.imgReq(src, z, x + 1, y), this.imgReq(src, z, x, y + 1), this.imgReq(src, z, x + 1, y + 1)];
    t.hiSrc = src;
    if (src) this.srcActive[src.id] = (this.srcActive[src.id] || 0) + 4; else this.stats.imgActive += 4;
    t.hiJob = this.loader.request({ type: 'img', hi, lo: [], ref: (t._r = this.balRef(t, true)), cells: t._r ? t._r.n : this.balCells(t) }, (m) => {
      this.releaseHi(t);
      if (t.disposed) { if (m.bmp) m.bmp.close(); return; }
      if (m.bmp) {
        t.hi = 'done'; t.bmp = m.bmp;
        if (t.z + 1 >= this.srcMaxZ(t)) this.noSplit.add(t.key); // already shows the source's finest level
        if (t.built) this.applyTexture(t);
      } else if (m.nodata) {
        t.hi = 'none';
        if (!m.hiBlank) this.noSplit.add(t.key); // nothing finer exists here (not merely the edge of a regional source)
      } else { t.hi = 'failed'; t.hiRetry = this.now + 8000; }
    });
  }
  releaseHi(t) {
    if (!t.hiJob) return;
    if (t.hiSrc) this.srcActive[t.hiSrc.id] -= 4; else this.stats.imgActive -= 4;
    t.hiJob = 0;
  }
  cancelHi(t) { this.loader.cancel(t.hiJob); this.releaseHi(t); }
  // the GPU upload happens in update(), a few per frame: uploading (and mipmapping) many images at once stalls a frame
  applyTexture(t) {
    if (!t.bmp) return;
    const tex = new THREE.Texture(t.bmp);
    tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = this.anisotropy;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
    if (t.pendingTex) { t.pendingTex.dispose(); t.pendingTex.image.close && t.pendingTex.image.close(); } else this.queueUpload(t);
    t.pendingTex = tex; t.bmp = null;
  }
  queueUpload(t) { if (!t.queued) { t.queued = true; this.uploadQ.push(t); } }
  uploadTextures(ms = UPLOAD_MS, min = 1, bytes = UPLOAD_BYTES) {
    const t0 = performance.now();
    let n = 0, spent = 0;
    while (this.uploadQ.length && (n < min || (spent < bytes && performance.now() - t0 < ms))) {
      const t = this.uploadQ.shift();
      n++; t.queued = false;
      if (t.disposed) continue;
      const mask = t.pendingMask, tex = t.pendingTex;
      if (mask) {
        t.pendingMask = null;
        if (this.renderer) this.renderer.initTexture(mask);
        spent += mask.image.width * mask.image.height * 4;
        if (t.maskTex) { const im = t.maskTex.image; t.maskTex.dispose(); im && im.close && im.close(); }
        t.maskTex = mask;
      }
      if (tex) {
        t.pendingTex = null;
        if (this.renderer) this.renderer.initTexture(tex);
        if (t.tex) { this.texBytes -= t.texBytes || 0; t.tex.dispose(); t.tex.image && t.tex.image.close && t.tex.image.close(); }
        t.tex = tex; t.texBytes = tex.image.width * tex.image.height * 4 * 1.34; this.texBytes += t.texBytes; spent += t.texBytes;
      }
      if (t.built && !t.pendingTex && (tex || t.tex)) t.ready = true;
    }
  }
  canBuild(t) {
    if (t.img !== 'ready' && !(t.z === ROOT_Z && (t.img === 'nodata' || (t.img === 'failed' && t.tries >= 2)))) return false;
    if (t.mk === 'loading' && this.now - t.mkAt < 2500) return false; // water mask usually arrives with the imagery
    for (const e of t.demList) if (!(e.state === 'ready' || e.settled)) return false;
    return true;
  }

  // near an active runway the ground is levelled; only worth testing at vertex spacings that can resolve it
  nearRunway(t) {
    const rs = this.db && this.db.ready ? this.db.activeRunways : null;
    if (!rs || !rs.length) return false;
    const rad = t.rad + 900, cosL = Math.cos(t.clat * D2R);
    for (const r of rs) { const de = (((r.lon - t.clon + 540) % 360) - 180) * D2R * R_EARTH * cosL, dn = (r.lat - t.clat) * D2R * R_EARTH; if (Math.sqrt(de * de + dn * dn) < r.len / 2 + rad) return true; }
    return false;
  }
  // sample the DEM for a tile: padded height grid at its own level plus the coarse-level edge values used for stitching
  sampleTile(t) {
    this.usedFallback = false;
    const L = demLevel(t.z), sc = 2 ** (L - t.z), raw = new Float32Array(PAD * PAD);
    // Same Catmull-Rom as sampleL, but the DEM pixels the tile needs are read once into a window (pix() per tap made this
    // the most expensive thing on the main thread)
    const gx = (i) => (t.x + (i - 1) / SEG) * sc * 256 - 0.5, gy = (j) => (t.y + (j - 1) / SEG) * sc * 256 - 0.5;
    const wx0 = Math.floor(gx(0)) - 1, wy0 = Math.floor(gy(0)) - 1;
    const W = Math.floor(gx(PAD - 1)) + 3 - wx0, Hh = Math.floor(gy(PAD - 1)) + 3 - wy0;
    const win = new Float32Array(W * Hh);
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) win[j * W + i] = this.pix(L, wx0 + i, wy0 + j);
    const R = this._rows;
    for (let j = 0; j < PAD; j++) {
      const fy = gy(j), iy = Math.floor(fy), v = fy - iy, ry = (iy - 1 - wy0) * W;
      for (let i = 0; i < PAD; i++) {
        const fx = gx(i), ix = Math.floor(fx), u = fx - ix, b = ry + ix - 1 - wx0;
        for (let r = 0; r < 4; r++) { const o = b + r * W; R[r] = cr(win[o], win[o + 1], win[o + 2], win[o + 3], u); }
        const h = cr(R[0], R[1], R[2], R[3], v), c = b + W + 1;
        const p5 = win[c], p6 = win[c + 1], p9 = win[c + W], p10 = win[c + W + 1];
        const lo = Math.min(p5, p6, p9, p10), hi = Math.max(p5, p6, p9, p10);
        raw[j * PAD + i] = h < lo ? lo : h > hi ? hi : h;
      }
    }
    let rawC = null;
    if (t.z > ROOT_Z) {
      const Lc = demLevel(t.z - 1), s2 = 2 ** (Lc - t.z);
      rawC = new Float32Array(4 * NV);
      for (let e = 0; e < 4; e++) for (let k = 0; k <= SEG; k += 2) {
        const i = e === 1 ? SEG : e === 3 ? 0 : k, j = e === 0 ? 0 : e === 2 ? SEG : k;
        rawC[e * NV + k] = this.sampleL(Lc, (t.x + i / SEG) * s2, (t.y + j / SEG) * s2);
      }
    }
    t.raw = raw; t.rawC = rawC; t.usedFallback = this.usedFallback;
  }
  // heights (runway-levelled), normals and positions from the sampled grid; geometry created on first call
  shapeTile(t) {
    const g = this.geo;
    if (!t.lat) {
      t.lat = new Float64Array(PAD); t.lon = new Float64Array(PAD);
      for (let k = 0; k < PAD; k++) { t.lat[k] = ty2lat(t.y + (k - 1) / SEG, t.z); t.lon[k] = tx2lon(t.x + (k - 1) / SEG, t.z); }
    }
    const lat = t.lat, lon = t.lon;
    const flat = t.size / SEG < 200 && this.nearRunway(t), flatC = t.size * 2 / SEG < 200 && flat;
    const H = flat ? new Float32Array(PAD * PAD) : t.raw;
    if (flat) for (let j = 0; j < PAD; j++) for (let i = 0; i < PAD; i++) H[j * PAD + i] = this.flatten(lat[j], lon[i], t.raw[j * PAD + i]);
    let Hc = null;
    if (t.rawC) {
      Hc = flatC ? new Float32Array(4 * NV) : t.rawC;
      if (flatC) for (let e = 0; e < 4; e++) for (let k = 0; k <= SEG; k += 2) {
        const i = e === 1 ? SEG : e === 3 ? 0 : k, j = e === 0 ? 0 : e === 2 ? SEG : k;
        Hc[e * NV + k] = this.flatten(lat[j + 1], lon[i + 1], t.rawC[e * NV + k]);
      }
    }
    t.Hc = Hc;
    const xs = new Float64Array(PAD), zs = new Float64Array(PAD), kx = D2R * R_EARTH * g.cos0, kz = D2R * R_EARTH;
    for (let k = 0; k < PAD; k++) { xs[k] = (lon[k] - t.clon) * kx; zs[k] = -(lat[k] - t.clat) * kz; }
    t.cosB = g.cos0;
    const nv = NV * NV + RING.length;
    if (!t.pos) { t.pos = new Float32Array(nv * 3); t.nor = new Float32Array(nv * 3); t.H = new Float32Array(NV * NV); }
    const pos = t.pos, nor = t.nor;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const k = j * NV + i, p = (j + 1) * PAD + i + 1;
      t.H[k] = H[p];
      pos[k * 3] = xs[i + 1]; pos[k * 3 + 2] = zs[j + 1];
      const nx = -(H[p + 1] - H[p - 1]) / (xs[i + 2] - xs[i]), nz = -(H[p + PAD] - H[p - PAD]) / (zs[j + 2] - zs[j]), inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      nor[k * 3] = nx * inv; nor[k * 3 + 1] = inv; nor[k * 3 + 2] = nz * inv;
    }
    for (let q = 0; q < RING.length; q++) {
      const a = RING[q], s = NV * NV + q;
      pos[s * 3] = pos[a * 3]; pos[s * 3 + 2] = pos[a * 3 + 2];
      nor[s * 3] = nor[a * 3]; nor[s * 3 + 1] = nor[a * 3 + 1]; nor[s * 3 + 2] = nor[a * 3 + 2];
    }
    t.skirt = Math.min(60, 0.7 + t.size * 0.0002);
    t.hw2 = (xs[SEG + 1] - xs[1]) * 0.5; t.flags = -1; t.reshape = false;
    let hMin = 1e9, hMax = -1e9;
    for (let k = 0; k < NV * NV; k++) { const h = t.H[k]; if (h < hMin) hMin = h; if (h > hMax) hMax = h; }
    t.hMid = (hMin + hMax) * 0.5;
    if (!t.mesh) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geom.setAttribute('uv', UV); geom.setIndex(INDEX);
      geom.boundingSphere = new THREE.Sphere();
      // imagery is already a photograph: the shader grades it and applies its own tone mapping and haze
      t.mesh = new THREE.Mesh(geom, this.material);
      t.mesh.onBeforeRender = (renderer, scene, camera, geometry, material) => this.bindTile(t, renderer, material);
      t.mesh.frustumCulled = t.z >= 12; t.mesh.visible = false;
      this.group.add(t.mesh);
    } else {
      t.mesh.geometry.attributes.position.needsUpdate = true; t.mesh.geometry.attributes.normal.needsUpdate = true;
    }
  }
  bindTile(t, renderer, material) {
    if (material !== this.material) return;
    const u = material.uniforms, white = material.userData.white;
    u.uMap.value = t.tex || white; u.uMask.value = t.maskTex || white; u.uWater.value = t.maskTex ? 1 : t.water;
    u.uTint.value = t.tex ? TINT_WHITE : this.fallbackColor;
    u.uTile.value = t.tile; u.uFade.value = t.fade; u.uFadeDir.value = t.fadeDir;
    if (!this.uniformGate || !gateTerrainUniforms(material, renderer.info.render.frame, renderer.getRenderTarget())) material.uniformsNeedUpdate = true;
  }
  // write vertex heights for the given neighbour mask: edges/corners facing a coarser tile take that tile's heights
  stitch(t, mask) {
    const pos = t.pos, H = t.H, Hc = t.Hc;
    for (let k = 0; k < NV * NV; k++) pos[k * 3 + 1] = H[k];
    if (mask && Hc) {
      for (let c = 0; c < 4; c++) if (mask & CORNER_MASK[c]) { const [idx, e, k] = CORNER_AT[c]; pos[idx * 3 + 1] = Hc[e * NV + k]; }
      for (let e = 0; e < 4; e++) {
        if (!(mask & (1 << e))) continue;
        const at = EDGE_AT[e];
        for (let k = 2; k < SEG; k += 2) pos[at(k) * 3 + 1] = Hc[e * NV + k];
        // Mercator rows are not evenly spaced in z, so interpolate by actual position to land exactly on the coarse edge
        const ax = e & 1 ? 2 : 0;
        for (let k = 1; k < SEG; k += 2) {
          const a = at(k - 1) * 3, b = at(k + 1) * 3, u = (pos[at(k) * 3 + ax] - pos[a + ax]) / (pos[b + ax] - pos[a + ax]);
          pos[at(k) * 3 + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * u;
        }
      }
    }
    let lo = 1e9, hi = -1e9;
    for (let k = 0; k < NV * NV; k++) { const h = pos[k * 3 + 1]; if (h < lo) lo = h; if (h > hi) hi = h; }
    for (let q = 0; q < RING.length; q++) pos[(NV * NV + q) * 3 + 1] = pos[RING[q] * 3 + 1] - t.skirt;
    lo -= t.skirt;
    const bs = t.mesh.geometry.boundingSphere, hz = t.hw2 * 1.02, hy = (hi - lo) * 0.5;
    bs.center.set(0, (hi + lo) * 0.5, 0); bs.radius = Math.sqrt(hz * hz + (t.hh * 1.02) ** 2 + hy * hy);
    t.mesh.geometry.attributes.position.needsUpdate = true;
    t.flags = mask;
  }
  buildTile(t) {
    this.sampleTile(t);
    this.shapeTile(t);
    t.built = true; t.geoVersion = -1;
    if (t.bmp) this.applyTexture(t);
    t.ready = !!t.tex || t.img !== 'ready'; // otherwise once its imagery is on the GPU (uploadTextures)
    this.stats.built++;
  }
  // terrain mesh density (graphics preset): every tile is rebuilt from the cached elevation and imagery
  setSeg(seg) {
    if (seg === SEG) return;
    topology(seg);
    for (const t of this.tiles.values()) {
      if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; }
      t.reshape = t.refit = false;
      t.pos = t.nor = t.H = t.lat = t.lon = t.raw = t.rawC = t.Hc = null;
      t.built = false; t.ready = false; t.flags = -1;
    }
    this.drawn = []; this.reshapeQ.length = 0; this.ghosts.length = 0;
  }
  // runway levelling changed near here: re-level from the cached raw samples
  refreshNear(lat, lon, km) {
    const cosL = Math.cos(lat * D2R);
    for (const t of this.tiles.values()) {
      if (!t.built || t.size / SEG >= 200) continue;
      const dn = (t.clat - lat) * D2R * R_EARTH, de = (((t.clon - lon + 540) % 360) - 180) * D2R * R_EARTH * cosL;
      if (Math.sqrt(dn * dn + de * de) < km * 1000 + t.hw) this.markReshape(t, false);
    }
  }
  disposeTile(t) {
    if (t.jobId) this.cancelImage(t); else if (t.mkJob) { this.loader.cancel(t.mkJob); t.mkJob = 0; }
    if (t.maskTex) { const im = t.maskTex.image; t.maskTex.dispose(); im && im.close && im.close(); }
    if (t.mesh) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); }
    if (t.pendingMask) { t.pendingMask.dispose(); t.pendingMask.image.close && t.pendingMask.image.close(); t.pendingMask = null; }
    for (let i = 0; i < 9; i++) { const n = t.nb[i]; if (n !== null && n.nb[8 - i] === t) n.nb[8 - i] = null; t.nb[i] = null; }
    if (t.up !== null && t.up.kids !== null && t.up.kids.includes(t)) t.up.kids = null;
    if (t.tex) { t.tex.dispose(); t.tex.image && t.tex.image.close && t.tex.image.close(); this.texBytes -= t.texBytes || 0; }
    if (t.pendingTex) { t.pendingTex.dispose(); t.pendingTex.image.close && t.pendingTex.image.close(); t.pendingTex = null; }
    if (t.hiJob) this.cancelHi(t);
    if (t.bmp) t.bmp.close();
    t.disposed = true; this.tiles.delete(t.key);
  }

  // ---------- per-frame selection ----------
  metrics(t, cam, view) {
    if (t.frame === this.frame) return;
    t.frame = this.frame;
    const dE = wrapLon(t.clon - cam.lon) * D2R * R_EARTH * cam.cos, dN = (t.clat - cam.lat) * D2R * R_EARTH;
    const hm = t.hMid === null ? cam.ground : t.hMid, dv = cam.h - hm;
    const ex = Math.max(0, Math.abs(dE) - t.hw), ey = Math.max(0, Math.abs(dN) - t.hh);
    let d = Math.sqrt(ex * ex + ey * ey + dv * dv);
    if (cam.ahead) {
      // a fast aircraft overflies the ring of fine tiles faster than they load: ask for what lies on its path as well
      const a = cam.ahead, fx = Math.max(0, Math.abs(dE - a.e) - t.hw), fy = Math.max(0, Math.abs(dN - a.n) - t.hh), fv = dv - a.u, da = Math.sqrt(fx * fx + fy * fy + fv * fv);
      if (da * 1.1 < d) d = da * 1.1;
    }
    t.d = Math.max(2, d);
    t.inView = true;
    if (view) {
      const vy = -dv, vz = -dN, len = Math.sqrt(dE * dE + vy * vy + vz * vz), rad = t.rad;
      if (len > rad * 1.05) {
        const cs = (dE * view.x + vy * view.y + vz * view.z) / len, sb = Math.min(1, rad / len), reach = view.half + Math.asin(sb);
        t.inView = reach >= Math.PI || cs >= view.cosH * Math.sqrt(1 - sb * sb) - view.sinH * sb;
      }
    }
    t.score = t.z * 10 + (t.inView ? 0 : 5) + Math.min(4.9, 4 * t.d / (t.size * this.detail * 1.5));
  }
  viewCone() {
    const c = this.camera;
    if (!c) return null;
    const v = this._view, d = this._dir.set(0, 0, -1).applyQuaternion(c.quaternion);
    v.x = d.x; v.y = d.y; v.z = d.z; v.half = Math.atan(Math.tan(c.fov * D2R / 2) * Math.max(1, c.aspect)) + 0.45;
    v.cosH = Math.cos(v.half); v.sinH = Math.sin(v.half);
    return v;
  }
  peek(z, x, y) { return this.tiles.get(tkey(z, x, y)) || null; }
  parentOf(t) {
    let p = t.up;
    if (p !== null && !p.disposed) return p;
    p = this.tiles.get(tkey(t.z - 1, t.x >> 1, t.y >> 1)) || null;
    t.up = p;
    return p;
  }
  children(t) {
    let k = t.kids;
    if (k !== null) return k;
    const z = t.z + 1, x = t.x * 2, y = t.y * 2;
    k = t.kids = [this.getTile(z, x, y), this.getTile(z, x + 1, y), this.getTile(z, x, y + 1), this.getTile(z, x + 1, y + 1)];
    for (let c = 0; c < 4; c++) k[c].up = t;
    return k;
  }
  near(t, dx, dy) {
    if (dx === 0 && dy === 0) return t;
    const nz = 1 << t.z, ny = t.y + dy;
    if (ny < 0 || ny >= nz) return null;
    const i = (dy + 1) * 3 + dx + 1, c = t.nb[i];
    if (c !== null && !c.disposed) return c;
    let nx = t.x + dx;
    if (nx < 0) nx += nz; else if (nx >= nz) nx -= nz;
    const n = this.tiles.get(tkey(t.z, nx, ny)) || null;
    if (n !== null) { t.nb[i] = n; n.nb[8 - i] = t; }
    return n;
  }
  isNoSplit(t) {
    const n = this.noSplit.size;
    if (t.nsAt === n) return t.ns;
    t.nsAt = n;
    return (t.ns = n > 0 && this.noSplit.has(t.key));
  }
  select(t) {
    const L = this._SL[t.z];
    t.sel = this._stamp; t.selI = L.length; L.push(t); this._selN++;
  }
  unselect(t) { t.sel = 0; this._selN--; }
  visit(t) {
    if (t.z >= this.maxZ || this.isNoSplit(t)) return;
    this.metrics(t, this.cam, this._vn);
    const d = t.d, farD = this._farD, far = d > farD ? Math.max(0.55, (farD / d) ** 0.2) : 1;
    if (!(d < t.size * this._k * far * (t.inView ? 1 : 0.6) * (t.splitFrame >= this.frame - 3 ? 1.15 : 1))) return;
    t.splitFrame = this.frame;
    this.select(t);
    const kids = this.children(t);
    this.visit(kids[0]); this.visit(kids[1]); this.visit(kids[2]); this.visit(kids[3]);
  }
  balance() {
    const SL = this._SL, stamp = this._stamp, maxZ = this.maxZ, noSplit = this.noSplit, mark = this._regionMark, rs = this._regionStamp;
    for (let pass = 0, changed = true; changed && pass < 4; pass++) {
      changed = false;
      for (let z = maxZ; z > ROOT_Z; z--) {
        const L = SL[z], nz = 1 << z, sh = z - ROOT_Z;
        for (let i = 0; i < L.length; i++) {
          const T = L[i];
          if (T.sel !== stamp || T.selI !== i) continue;
          const x = T.x, y = T.y, P = this.parentOf(T);
          let ok = true;
          for (let dy = -1; dy <= 1 && ok; dy++) {
            const my = y + dy;
            if (my < 0 || my >= nz) continue;
            const opy = (my >> 1) - (y >> 1);
            for (let dx = -1; dx <= 1; dx++) {
              let mx = x + dx;
              const opx = (mx >> 1) - (x >> 1);
              if (mx < 0) mx += nz; else if (mx >= nz) mx -= nz;
              if (mark[((mx >> sh) << 6) + (my >> sh)] !== rs) continue;
              const px = mx >> 1, py = my >> 1;
              let Q = P !== null ? this.near(P, opx, opy) : this.peek(z - 1, px, py);
              if (Q !== null && Q.sel === stamp) continue;
              if (noSplit.size > 0 && noSplit.has(tkey(z - 1, px, py))) { ok = false; break; }
              if (Q === null) Q = this.getTile(z - 1, px, py);
              this.select(Q); changed = true;
            }
          }
          if (!ok) { this.unselect(T); changed = true; }
        }
      }
      for (let z = ROOT_Z + 1; z <= maxZ; z++) {
        const L = SL[z];
        for (let i = 0; i < L.length; i++) {
          const T = L[i];
          if (T.sel !== stamp || T.selI !== i) continue;
          const P = this.parentOf(T);
          if (P === null || P.sel !== stamp) { this.unselect(T); changed = true; }
        }
      }
    }
  }
  setRoots(camLat, camLon) {
    const n5 = 1 << ROOT_Z, rx = Math.floor(lon2tx(camLon, ROOT_Z)), ry = Math.min(n5 - 1, Math.max(0, Math.floor(lat2ty(camLat, ROOT_Z)))), id = rx * n5 + ry;
    let roots = this.roots, fresh = this._rootId === id && roots.length > 0;
    if (fresh) for (let i = 0; i < roots.length; i++) if (roots[i].disposed) { fresh = false; break; }
    if (fresh) return roots;
    this._rootId = id; this._regionStamp++;
    roots = this.roots = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = ry + dy; if (y < 0 || y >= n5) continue;
      const x = (((rx + dx) % n5) + n5) % n5;
      roots.push(this.getTile(ROOT_Z, x, y)); this._regionMark[x * n5 + y] = this._regionStamp;
    }
    return roots;
  }
  markReshape(t, refit) {
    if (refit) t.refit = true;
    if (t.reshape) return;
    t.reshape = true; this.reshapeQ.push(t);
  }

  update(camWorld, camLat, camLon, camera) {
    const now = this.now = performance.now(), g = this.geo;
    this.frame++;
    TERRAIN_UNIFORMS.uTime.value = now / 1000;
    TERRAIN_UNIFORMS.uWaterOff.value.set(((camWorld.x % 16384) + 16384) % 16384, ((camWorld.z % 16384) + 16384) % 16384);
    if (camera && camera.isPerspectiveCamera) this.camera = camera;
    const ground = this.heightAt(camLat, camLon);
    const frameMs = this.lastNow ? Math.min(250, now - this.lastNow) : 16; this.lastNow = now;
    const cam = this.cam;
    cam.lat = camLat; cam.lon = camLon; cam.cos = Math.cos(camLat * D2R); cam.h = camWorld.y; cam.ground = ground ?? cam.ground;
    cam.agl = Math.max(2, cam.h - cam.ground);
    // camera velocity from its own movement (smoothed); a teleport or origin move shows up as an absurd jump and is ignored
    const pc = this.prevCam;
    if (pc.set && frameMs > 0) {
      const ve = wrapLon(camLon - pc.lon) * D2R * R_EARTH * cam.cos / (frameMs / 1000), vn = (camLat - pc.lat) * D2R * R_EARTH / (frameMs / 1000), vu = (cam.h - pc.h) / (frameMs / 1000);
      if (Math.sqrt(ve * ve + vn * vn + vu * vu) < 1800) { const a = Math.min(1, frameMs / 400); this.vel.e += (ve - this.vel.e) * a; this.vel.n += (vn - this.vel.n) * a; this.vel.u += (vu - this.vel.u) * a; }
    }
    pc.lat = camLat; pc.lon = camLon; pc.h = cam.h; pc.set = true;
    const speed = Math.sqrt(this.vel.e * this.vel.e + this.vel.n * this.vel.n + this.vel.u * this.vel.u);
    const LOOK = 4; // seconds
    if (speed > 80) { const a = this._ahead; a.e = this.vel.e * LOOK; a.n = this.vel.n * LOOK; a.u = Math.max(-cam.agl * 0.5, this.vel.u * LOOK); cam.ahead = a; } else cam.ahead = null;
    const view = this._vn = this.viewCone(), maxZ = this.maxZ;
    // beyond a few km (more when high up) haze hides fine imagery: the split distance shrinks slowly with range, which
    // keeps the far field from eating the tile budget that the ground around the aircraft needs
    this._farD = Math.max(8000, cam.agl * 3.5);

    // 1. desired split set: distance / screen-space criterion, then balanced so neighbours differ by <= 1 level.
    // If it would need more tiles than the draw budget, the criterion is coarsened until it fits.
    const roots = this.setRoots(camLat, camLon), SL = this._SL;
    while (SL.length < maxZ + 2) SL.push([]);
    let k, splits, leafCount, stamp;
    for (let attempt = 0; ; attempt++) {
      k = this._k = this.detail * 1.25 * this.budget * this.pxScale;
      stamp = this._stamp = ++this.selStamp; this._selN = 0;
      for (let z = 0; z < SL.length; z++) SL[z].length = 0;
      for (let i = 0; i < roots.length; i++) this.visit(roots[i]);
      this.balance();
      splits = this._selN;
      let onScreen = 0;
      for (let i = 0; i < roots.length; i++) if (roots[i].sel !== stamp && roots[i].inView) onScreen++;
      for (let z = ROOT_Z; z < maxZ; z++) {
        const L = SL[z];
        for (let i = 0; i < L.length; i++) {
          const T = L[i];
          if (T.sel !== stamp || T.selI !== i) continue;
          const kids = this.children(T);
          for (let c = 0; c < 4; c++) {
            const ct = kids[c];
            if (ct.sel === stamp) continue;
            this.metrics(ct, cam, view);
            if (ct.inView) onScreen++;
          }
        }
      }
      leafCount = onScreen;
      if (onScreen <= this.leafCap || attempt >= 10 || this.budget <= 0.35) break;
      this.budget *= 0.9;
    }
    if (leafCount < this.leafCap * 0.8) this.budget = Math.min(1, this.budget * Math.pow(1.02, Math.min(6, frameMs / 16.7))); // per 60 Hz frame, not per frame

    // 2. wanted tiles = roots + children of every split node; schedule their loads, coarsest and nearest first
    const wanted = this._wanted; wanted.length = 0;
    for (let i = 0; i < roots.length; i++) { const t = roots[i]; this.metrics(t, cam, view); t.wantedAt = now; wanted.push(t); }
    for (let z = ROOT_Z; z <= maxZ; z++) {
      const L = SL[z];
      for (let i = 0; i < L.length; i++) {
        const T = L[i];
        if (T.sel !== stamp || T.selI !== i) continue;
        const kids = this.children(T);
        for (let c = 0; c < 4; c++) { const t = kids[c]; this.metrics(t, cam, view); t.wantedAt = now; wanted.push(t); }
      }
    }
    const imgJobs = this.imgQueue = this._imgJobs, demJobs = this.demQueue = this._demJobs, builds = this._builds;
    imgJobs.length = 0; demJobs.length = 0; builds.length = 0;
    for (let i = 0; i < wanted.length; i++) {
      const t = wanted[i];
      if (t.img === 'none' || (t.img === 'failed' && now >= t.retryAt)) imgJobs.push(t);
      if (t.built) continue;
      if (t.demEpoch !== this.demEpoch) { t.demList = this.tileDems(t); t.demEpoch = this.demEpoch; }
      const dl = t.demList;
      for (let j = 0; j < dl.length; j++) {
        const e = dl[j];
        e.wantedAt = now;
        if (e.listed !== this.frame) { e.listed = this.frame; e.score = t.score; if (e.state === 'none' || (e.state === 'failed' && now >= e.retryAt)) demJobs.push(e); }
        else if (t.score < e.score) e.score = t.score;
      }
      if (this.canBuild(t)) builds.push(t);
    }
    for (const e of this.pins) {
      if (e.settled || e.state === 'ready') { e.pin = false; this.pins.delete(e); continue; }
      e.score = -1; e.wantedAt = now;
      if (e.listed !== this.frame && (e.state === 'none' || (e.state === 'failed' && now >= e.retryAt))) { e.listed = this.frame; demJobs.push(e); }
    }
    // drop work nobody wants any more (a teleport leaves the old area's requests in flight)
    if ((this.frame & 7) === 0) {
      for (const t of this.tiles.values()) {
        if (t.img === 'loading' && now - t.wantedAt > STALE_MS) this.cancelImage(t);
        if (t.hiJob && now - t.wantedAt > STALE_MS) this.cancelHi(t);
      }
      for (const e of this.dem.values()) if (e.state === 'loading' && !e.pin && now - e.wantedAt > STALE_MS) this.cancelDem(e);
    }
    imgJobs.sort(byScore); demJobs.sort(byScore);
    this.stats.imgWait = imgJobs.length; this.stats.demWait = demJobs.length;
    let waiting = 0;
    for (let i = 0; i < imgJobs.length; i++) { const t = imgJobs[i]; if (this.imgSlotsFree(t)) this.startImage(t); else waiting++; }
    // sharpen displayed leaves only when no base imagery is waiting for a connection
    if (this.hiZ < 99 && !waiting) {
      const ups = this._ups; ups.length = 0;
      for (const t of this.drawn) {
        if (t.z >= this.hiZ && t.inView && t.tex && !t.pendingTex && !t.hiJob && !t.disposed
          && (t.hi === undefined || (t.hi === 'failed' && now >= t.hiRetry)) && !this.noSplit.has(t.key) && t.z + 1 <= this.srcMaxZ(t)) ups.push(t);
      }
      ups.sort(byD);
      for (let i = 0; i < ups.length; i++) {
        const t = ups[i], s = this.source(t);
        if (s ? (this.srcActive[s.id] || 0) + 4 <= s.slots : this.stats.imgActive + 4 <= IMG_SLOTS) this.startHi(t);
      }
    }
    for (let i = 0; i < demJobs.length && this.stats.demActive < DEM_SLOTS; i++) this.startDem(demJobs[i]);

    // 3. build what became loadable (time-sliced), then re-level tiles near a changed runway
    builds.sort(byScore);
    // fixed budgets in flight: they used to grow with the frame time (up to 14 ms of builds and 8 ms of uploads), so a slow frame bought itself more
    // work and the next one was slower still. Only behind the loading screen (loadBoost, set by main.js) does the terrain get a bigger slice.
    const boost = this.loadBoost ? 4 : 1, t0 = performance.now(), buildMs = BUILD_MS * boost, maxBuilds = this.buildMax * boost, minBuilds = boost > 1 ? 3 : 1;
    for (let i = 0; i < builds.length && i < maxBuilds && (i < minBuilds || performance.now() - t0 < buildMs); i++) this.buildTile(builds[i]);
    const rq = this.reshapeQ;
    while (rq.length && performance.now() - t0 <= buildMs) {
      const t = rq.shift();
      if (!t.reshape || t.disposed) continue;
      if (!t.built) { t.reshape = false; continue; }
      if (t.refit) { t.refit = false; this.sampleTile(t); }
      this.shapeTile(t);
    }
    this.uploadTextures(UPLOAD_MS * boost, boost > 1 ? 3 : 1, this.uploadBytes * boost);

    // 4. what is drawn: refine a node only when all four children are ready and its same-level neighbours are already refined
    const presStamp = ++this.presStamp, mark = this._regionMark, rs = this._regionStamp, leaves = this._leaves;
    leaves.length = 0;
    let cur = this._cur, next = this._next;
    cur.length = 0;
    for (let i = 0; i < roots.length; i++) { roots[i].pres = presStamp; cur.push(roots[i]); }
    for (let z = ROOT_Z; z <= maxZ && cur.length; z++) {
      const nz = 1 << z, sh = z - ROOT_Z;
      next.length = 0;
      for (let i = 0; i < cur.length; i++) {
        const T = cur[i];
        let split = T.sel === stamp;
        if (split) {
          const kids = T.kids;
          for (let c = 0; c < 4 && split; c++) if (!kids[c].ready) split = false;
          for (let d = 0; d < 8 && split; d++) {
            const ny = T.y + DIRS[d][1]; if (ny < 0 || ny >= nz) continue;
            const nx = (((T.x + DIRS[d][0]) % nz) + nz) % nz;
            if (mark[((nx >> sh) << 6) + (ny >> sh)] === rs) { const N = this.near(T, DIRS[d][0], DIRS[d][1]); if (N === null || N.pres !== presStamp) split = false; }
          }
          if (split) for (let c = 0; c < 4; c++) { kids[c].pres = presStamp; next.push(kids[c]); }
        }
        if (!split) leaves.push(T);
      }
      const tmp = cur; cur = next; next = tmp;
    }

    // 5. place leaves, stitching edges that face a coarser neighbour
    let tris = 0, draws = 0, shown = 0;
    const drawn = this._drawnB, frame = this.frame; drawn.length = 0;
    for (let i = 0; i < leaves.length; i++) {
      const t = leaves[i];
      if (!t.ready) continue;
      let mask = 0;
      const nz = 1 << t.z, sh = t.z - ROOT_Z;
      for (let d = 0; d < 8; d++) {
        const ny = t.y + DIRS[d][1]; if (ny < 0 || ny >= nz) continue;
        const nx = (((t.x + DIRS[d][0]) % nz) + nz) % nz;
        if (mark[((nx >> sh) << 6) + (ny >> sh)] === rs) { const N = this.near(t, DIRS[d][0], DIRS[d][1]); if (N === null || N.pres !== presStamp) mask |= DIRS[d][2]; }
      }
      if (t.flags !== mask) this.stitch(t, mask);
      if (t.geoVersion !== g.version) { const c = g.toXZ(t.clat, t.clon); t.wx = c.x; t.wz = c.z; t.geoVersion = g.version; }
      const m = t.mesh;
      m.visible = t.inView; t.drawFrame = frame; t.leafPrev = t.leafFrame; t.leafFrame = frame; drawn.push(t); // tiles below z12 skip three's culling (curvature moves them), so cull by view cone here
      m.position.set(t.wx - camWorld.x, -camWorld.y, t.wz - camWorld.z);
      m.scale.x = g.cos0 / t.cosB; // an origin move only rescales east-west offsets; no rebuild
      tris += TRIS; draws++;
      if (t.inView) shown++;
    }
    // LOD crossfade: a tile that stopped being drawn while a related tile (its parent or a child) started stays on screen for FADE_S,
    // dissolving into the new one. Only when the new tile replaces something that was visible, never over empty sky.
    const FADE_S = 0.5, lost = this._lost; lost.length = 0;
    for (const t of this.drawn) if (t.leafFrame !== frame && t.mesh && t.mesh.visible && t.inView) lost.push(t);
    const ghosts = this.ghosts;
    for (let i = 0; i < drawn.length; i++) {
      const t = drawn[i];
      if (t.leafPrev === frame - 1) continue;
      // newly drawn: a fade it was in when it was last dropped is over (resuming it left part of the tile open with no ghost behind it)
      t.fadeT0 = 0; t.fade = 1;
      if (!lost.length) continue;
      // only when the outgoing tiles cover all of this one (an ancestor, or descendants filling it): turning brings in a coarse tile whose other
      // quarters were off screen last frame, and a fade over those faded in from nothing, the ground below showing through as black grain
      let area = 0;
      for (let j = 0; j < lost.length && area < 0.999; j++) { const l = lost[j]; if (related(l, t)) area += l.z <= t.z ? 1 : 4 ** (t.z - l.z); }
      if (area < 0.999) continue;
      t.fadeT0 = now;
      for (let j = 0; j < lost.length; j++) {
        const l = lost[j];
        if (related(l, t) && !ghosts.includes(l)) { l.ghostT0 = now; l.ghostOf = t; ghosts.push(l); }
      }
    }
    for (let i = 0; i < drawn.length; i++) {
      const t = drawn[i];
      if (t.fadeT0) { const f = (now - t.fadeT0) / (FADE_S * 1000); if (f >= 1) { t.fadeT0 = 0; t.fade = 1; } else { t.fade = f; t.fadeDir = 1; } }
    }
    let keep = 0;
    for (let i = 0; i < ghosts.length; i++) {
      const gt = ghosts[i];
      if (!gt.mesh || gt.leafFrame === frame || (now - gt.ghostT0) / 1000 >= FADE_S) { if (gt.mesh) { gt.fade = 1; if (gt.leafFrame !== frame) gt.mesh.visible = false; } gt.ghostT0 = 0; continue; }
      const f = (now - gt.ghostT0) / (FADE_S * 1000), r = gt.ghostOf;
      // the ghost's share always follows its replacement's, also on the first frame: it used to keep whatever fade it had (0.998 when it was itself still
      // fading in), and with the replacement at 0 almost the whole tile was a hole for a frame, the ground below showing as a black grainy tile
      if (r && r.fadeT0 && r.mesh) gt.fade = Math.min(1, (now - r.fadeT0) / (FADE_S * 1000)); else gt.fade = f;
      gt.fadeDir = 0; gt.mesh.visible = true; gt.drawFrame = frame;
      if (gt.geoVersion !== g.version) { const c = g.toXZ(gt.clat, gt.clon); gt.wx = c.x; gt.wz = c.z; gt.geoVersion = g.version; }
      gt.mesh.position.set(gt.wx - camWorld.x, -camWorld.y, gt.wz - camWorld.z); gt.mesh.scale.x = g.cos0 / gt.cosB;
      ghosts[keep++] = gt;
    }
    ghosts.length = keep;
    for (const t of this.drawn) if (t.drawFrame !== frame && t.mesh) t.mesh.visible = false;
    this._drawnB = this.drawn; this.drawn = drawn;

    const st = this.stats;
    st.visible = shown; st.draws = shown; st.leaves = draws; st.tris = shown * TRIS; st.tiles = this.tiles.size; st.splits = splits; st.k = Math.round(k * 100) / 100; st.want = leafCount;
    if (frame % 30 === 1) { let s = ''; for (let z = 0; z <= maxZ + 1; z++) { let n = 0; const L = SL[z]; if (L) for (let i = 0; i < L.length; i++) if (L[i].sel === stamp && L[i].selI === i) n++; s += (z ? ',' : '') + n; } st.perZ = s; }
    if (frame % 20 === 0) this.trimDem();
    const tileCap = Math.max(650, this.leafCap * 2.5);
    if ((frame & 7) === 3 && (this.tiles.size > tileCap || this.texBytes > this.texCap)) {
      const old = this._old; old.length = 0;
      for (const t of this.tiles.values()) if (t.drawFrame !== frame && now - t.wantedAt > 4000) old.push(t);
      old.sort(byWanted);
      for (let i = 0; i < old.length && (this.tiles.size > tileCap * 0.8 || this.texBytes > this.texCap * 0.85); i++) this.disposeTile(old[i]);
      old.length = 0;
    }
  }
}
