// Buildings: per-frame upload budget (tile buffers + roof atlases) and ranged refits, driven through the real methods with a stub renderer.
import assert from 'node:assert/strict';
import * as THREE from 'three';
globalThis.OffscreenCanvas ??= class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return new Proxy({}, { get: () => () => ({}) }); } };
const { Buildings } = await import('../src/buildings.js');

const MB = 2 ** 20;
const tileOf = (key, dist, verts) => {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const mesh = new THREE.Mesh(g); mesh.visible = false;
  return { key, dist, mesh, sited: true, uploaded: false, state: 'ready' };
};
const mk = () => { const b = Object.create(Buildings.prototype); Object.assign(b, { tiles: new Map(), atlases: new Map(), texQ: [], stats: {}, uploadBudget: 8 * MB, renderer: { inited: [], initTexture(t) { this.inited.push(t); } } }); b.mesh = null; return b; };
const t = (n, f) => { try { f(); console.log('PASS ', n); } catch (e) { console.error('FAIL ', n, '\n', e); process.exit(1); } };

t('tile buffers upload nearest first, within the byte budget, at least one tile per frame', () => {
  const b = mk(); const big = 400000; // 4.8 MB of positions each
  for (const [k, d] of [['a', 300], ['b', 100], ['c', 200]]) b.tiles.set(k, tileOf(k, d, big));
  b._uploads(); assert.deepEqual([...b.tiles.values()].map((x) => x.mesh.visible), [false, true, false]);
  b._uploads(); assert.deepEqual([...b.tiles.values()].map((x) => x.mesh.visible), [false, true, true]);
  b._uploads(); assert.ok([...b.tiles.values()].every((x) => x.mesh.visible));
  const huge = tileOf('h', 1, 3e6); b.tiles.set('h', huge); b._uploads(); assert.ok(huge.mesh.visible, 'one oversized tile still goes');
});
t('small tiles share one frame', () => {
  const b = mk(); for (let i = 0; i < 6; i++) b.tiles.set('s' + i, tileOf('s' + i, i, 100000)); b._uploads();
  assert.ok([...b.tiles.values()].every((x) => x.mesh.visible)); assert.ok(b.stats.uploadMB < 8);
});
t('roof atlases are pre-uploaded under the same budget, and shown only once uploaded', () => {
  const b = mk(); const own = { uRoof: { value: null }, uImg: { value: 0 } };
  const mkT = (k, d) => { const x = tileOf(k, d, 10); x.uploaded = true; x.mesh.material = { userData: { own } }; b.tiles.set(k, x); return x; };
  const t1 = mkT('p', 5), t2 = mkT('q', 9);
  const a1 = { tex: {}, key: 'p', bytes: 6 * MB, ready: !1 }, a2 = { tex: {}, key: 'q', bytes: 6 * MB, ready: !1 };
  b.atlases.set('p', a1); b.atlases.set('q', a2); b._attach(t2, a2); b._attach(t1, a1);
  assert.equal(own.uImg.value, 0, 'not shown before upload');
  b._uploads(); assert.deepEqual(b.renderer.inited, [a1.tex], 'nearest first, second waits'); assert.equal(own.uRoof.value, a1.tex); assert.equal(own.uImg.value, 1);
  b._uploads(); assert.deepEqual(b.renderer.inited, [a1.tex, a2.tex]); assert.equal(b.texQ.length, 0);
});
t('a dropped owner or evicted atlas is not uploaded', () => {
  const b = mk(); const x = tileOf('z', 1, 10); x.uploaded = true; x.mesh.material = { userData: { own: { uRoof: {}, uImg: {} } } }; b.tiles.set('z', x);
  const a = { tex: {}, key: 'z', bytes: MB, ready: !1 }; b.atlases.set('z', a); b._attach(x, a); b.atlases.delete('z'); b._uploads(); assert.equal(b.renderer.inited.length, 0);
});
t('without a renderer atlases attach immediately (old path)', () => {
  const b = mk(); b.renderer = null; const own = { uRoof: { value: null }, uImg: { value: 0 } }; const x = tileOf('y', 1, 10); x.mesh.material = { userData: { own } };
  const a = { tex: {}, key: 'y', bytes: MB, ready: !1 }; b._attach(x, a); assert.equal(own.uImg.value, 1);
});
t('refit of an uploaded tile adds update ranges only for moved buildings; first upload sends everything', () => {
  const b = mk(); const nb = 10, per = 36;
  const mkRefit = (uploaded) => {
    const tl = tileOf('r', 1, nb * per); tl.uploaded = uploaded; tl.count = nb; tl.W = tl.H = 100;
    tl.bStart = Array.from({ length: nb }, (_, i) => i * per); tl.bCount = new Array(nb).fill(per); tl.base = new Float32Array(nb);
    tl.bInfo = new Float32Array(nb * 6); for (let i = 0; i < nb; i++) tl.bInfo.set([i, i, i + 1, i + 1, 0, 0].slice(0, 6), i * 6);
    tl.grid = new Float32Array(1 << 16).fill(0); tl.mesh.geometry.attributes.position.array.fill(1); return tl;
  };
  const tl = mkRefit(true); tl.base.fill(0); tl.grid.fill(0); tl.grid[0] = 0;
  const pos = tl.mesh.geometry.attributes.position; tl.grid.fill(5); tl.base.fill(5); tl.base[2] = 0; tl.base[3] = 0; tl.base[7] = 0;
  b._applyHeights(tl); assert.ok(pos.updateRanges.length >= 1, 'ranges used'); assert.equal(pos.updateRanges.reduce((s, r) => s + r.count, 0), 3 * per * 3, 'three buildings');
  assert.equal(pos.updateRanges[0].start, 2 * per * 3); assert.equal(pos.updateRanges[0].count, 2 * per * 3, 'adjacent buildings merged');
  const fresh = mkRefit(false); fresh.grid.fill(5); b._applyHeights(fresh); assert.equal(fresh.mesh.geometry.attributes.position.updateRanges.length, 0); assert.equal(fresh.mesh.visible, false, 'stays hidden until the upload queue releases it');
});
console.log('all buildings upload tests passed'); process.exit(0);
