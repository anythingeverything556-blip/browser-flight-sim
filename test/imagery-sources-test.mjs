// Imagery sources: coverage and zoom per source, URL templates against the tiles fetched during the research, CSP hosts,
// attribution, blank-tile detection, the source -> next source -> Esri fallback in the worker, and Esri Wayback areas.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMAGERY_SOURCES, isBlank, loadWayback, setWayback, sourceFor, sourcesFor, waybackUrl, esriUrl } from '../src/imagery-sources.js';
const t = async (n, f) => { await f(); console.log('PASS ', n); };
const id = (z, lon, lat) => sourceFor(z, lon, lat)?.id ?? null;
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const byId = Object.fromEntries(IMAGERY_SOURCES.map((s) => [s.id, s]));

// [id, max zoom, inside point, [zoom, outside point, expected id]...]
const CASES = [
  ['thr', 21, [2.3522, 48.8566], [17, -0.5792, 44.8283, 'ign'], [21, -0.5792, 44.8283, null]],
  ['lyon23', 21, [4.836, 45.764], [17, 4.6, 45.5, 'ign']],
  ['rennes21', 20, [-1.678, 48.117], [17, -2.2, 48.0, 'ign']],
  ['ge24', 21, [6.143, 46.204], [20, 6.63, 46.52, 'ch']],
  ['bs23', 20, [7.589, 47.56], [20, 7.66, 47.45, 'ch'], [20, 7.85, 47.99, 'bw']],
  ['koeln', 21, [6.96, 50.938], [21, 6.767, 51.289, 'nrw_dop']],
  ['rvr', 21, [7.012, 51.456], [21, 7.4, 51.95, 'nrw_dop']],
  ['nrw_dop', 21, [6.767, 51.289], [19, 5.86, 51.84, 'nl']],
  ['berlin', 20, [13.378, 52.516], [20, 13.06, 52.39, null]],
  ['hh', 20, [9.994, 53.551], [20, 10.123, 54.323, 'sh']],
  ['sh', 20, [10.123, 54.323], [20, 8.8, 53.08, null]],
  ['bw', 20, [9.183, 48.776], [20, 11.57, 48.14, 'by']],
  ['hessen', 20, [8.682, 50.111], [20, 7.77, 49.44, 'rlp']],
  ['sl', 20, [6.997, 49.235], [20, 7.6, 50.36, 'rlp']],
  ['be_bxl', 21, [4.352, 50.85], [20, 4.484, 50.901, 'vl_omw'], [21, 4.484, 50.901, null]],
  ['vl_omw', 20, [4.402, 51.219], [17, 3.06, 50.63, 'ign']],
  ['be_wal', 20, [4.461, 50.458], [20, 6.13, 49.61, 'lu']],
  ['act3857', 21, [149.195, -35.307], [20, 149.23, -35.42, 'nsw']],
  ['nsw', 21, [151.177, -33.946], [21, 153.03, -27.47, null]],
  ['wien_lb', 21, [16.374, 48.208], [19, 15.44, 47.07, 'at']],
  ['vogis10', 21, [9.744, 47.503], [19, 11.4, 47.26, 'at']],
  ['madrid_ayto', 20, [-3.704, 40.417], [20, -4.02, 39.86, 'es']],
  ['icgc_orto', 20, [2.173, 41.385], [20, -0.88, 41.65, 'es']],
  ['pt_2025', 20, [-9.136, 38.774], [17, -6.97, 38.88, 'es']],
  ['plwHighResolution', 21, [21.012, 52.23], [19, 21.012, 52.23, 'pl']],
  ['gbg21', 20, [11.975, 57.709], [20, 18.07, 59.33, null]],
  ['bologna26', 21, [11.343, 44.495], [20, 10.93, 44.65, null]],
  ['ky3', 20, [-85.737, 38.174], [20, -86.16, 39.77, null]],
  ['dc25', 21, [-77.037, 38.898], [20, -77.2, 38.85, null]],
  ['pa2123', 20, [-76.887, 40.273], [20, -74.0, 40.71, null]],
  ['ct23', 20, [-72.683, 41.939], [20, -71.06, 42.36, null]],
  ['bog25', 21, [-74.072, 4.61], [20, -75.57, 6.25, null]],
  ['qcwmts', 21, [-73.741, 45.471], [20, -75.69, 45.42, null], [20, -71.39, 46.79, null]],
  ['ont2327', 20, [-81.15, 43.03], [20, -79.625, 43.678, null]],
  ['uyurb', 21, [-56.164, -34.906], [20, -58.4, -34.6, null]],
  ['tas_AerialPhoto2024', 20, [147.327, -42.882], [21, 147.327, -42.882, null]],
  ['qld21', 20, [153.118, -27.384], [16, 153.118, -27.384, null], [18, 144.0, -24.0, null]],
];

await t('each source is picked inside its area at its max zoom, and not past it', () => {
  for (const [s, max, [lon, lat], ...outs] of CASES) {
    assert.ok(byId[s], s);
    assert.equal(byId[s].max, max, `${s} max zoom`);
    assert.equal(id(max, lon, lat), s, `${s} at z${max}`);
    assert.equal(id(18, lon, lat), byId[s].min <= 18 ? s : id(18, lon, lat), `${s} at z18`);
    for (const [z, a, b, want] of outs) assert.equal(id(z, a, b), want, `${s}: z${z} ${a},${b}`);
  }
});

await t('zoom caps of the existing sources', () => {
  const caps = { lu: 21, nl: 21, nsw: 21, ch: 20, es: 20, by: 20, rlp: 20, bz: 20, cz: 20, ign: 19, at: 19, pl: 19, jp: 18, ee: 18 };
  for (const [k, v] of Object.entries(caps)) assert.equal(byId[k].max, v, k);
  assert.equal(byId.vl, undefined, 'Flanders WMS replaced by the OMW WMTS');
  assert.equal(byId.plwHighResolution.min, 20);
  assert.equal(id(21, 2.3, 48.87), 'thr'); assert.equal(id(19, 2.3, 48.87), 'thr', 'THR before the national IGN layer in Paris');
  assert.equal(id(17, 2.35, 48.85), 'thr'); assert.equal(id(17, 4.85, 45.0), 'ign');
  assert.equal(id(12, 2.35, 48.85), null, 'nothing below z13');
});

await t('fallback chain lists the overlapping sources in order', () => {
  assert.deepEqual(sourcesFor(20, -85.737, 38.174).map((s) => s.id), ['ky3', 'ky2']);
  assert.deepEqual(sourcesFor(18, 2.3522, 48.8566).map((s) => s.id), ['thr', 'ign']);
  assert.deepEqual(sourcesFor(20, 21.012, 52.23).map((s) => s.id), ['plwHighResolution']);
  assert.deepEqual(sourcesFor(18, 0, 0), []);
});

await t('URL templates reproduce the tiles fetched during the research', () => {
  const rows = JSON.parse(read('test/fixtures/imagery-tested-urls.json'));
  const seen = new Set();
  for (const r of rows) { assert.equal(byId[r.id].url(r.z, r.x, r.y), r.url, `${r.id} z${r.z}`); seen.add(r.id); }
  for (const s of IMAGERY_SOURCES) if (!['ign', 'jp', 'pl', 'ee', 'at', 'ky2'].includes(s.id)) assert.ok(seen.has(s.id), `no tested URL for ${s.id}`);
});

await t('every imagery host is allowed by the CSP, and nothing else loosened', () => {
  const h = read('public/_headers'), csp = h.match(/Content-Security-Policy: (.*)/)[1];
  const connect = csp.match(/connect-src ([^;]*)/)[1].split(/\s+/);
  const hosts = new Set(IMAGERY_SOURCES.map((s) => new URL(s.url(15, 100, 100)).origin));
  hosts.add('https://wayback.maptiles.arcgis.com'); hosts.add(new URL(esriUrl(15, 1, 1)).origin);
  for (const o of hosts) assert.ok(connect.includes(o.replace('https://', '')), `connect-src lacks ${o}`);
  for (const l of h.split('\n')) assert.ok(l.length <= 2000, `_headers line of ${l.length} chars: Cloudflare Pages drops lines over 2,000`);
  assert.ok(!/\*|https:(\s|;)|'unsafe-eval'/.test(csp.replace("'wasm-unsafe-eval'", '')), 'no wildcards');
  assert.match(csp, /default-src 'self';/);
});

await t('every source carries its attribution, and the credits list it', () => {
  const dec = (s) => s.replace(/&amp;/g, '&').replace(/&copy;/g, '©').replace(/&ndash;/g, '–').replace(/&rsquo;/g, '’').replace(/&#268;/g, 'Č').replace(/&Uacute;/g, 'Ú');
  const docs = { 'index.html': dec(read('index.html')), 'NOTICE.md': read('NOTICE.md'), 'public/NOTICE.txt': read('public/NOTICE.txt'), 'README.md': read('README.md') };
  for (const s of IMAGERY_SOURCES) {
    assert.ok(typeof s.credit === 'string' && s.credit.length > 3, `${s.id} credit`);
    for (const [f, txt] of Object.entries(docs)) assert.ok(txt.replace(/\s+/g, ' ').includes(s.credit), `${f} lacks "${s.credit}" (${s.id})`);
  }
  for (const [f, txt] of Object.entries(docs)) assert.ok(txt.includes('Esri World Imagery Wayback'), `${f} lacks the Wayback credit`);
});

await t('blank / placeholder detection', () => {
  const tile = (f) => { const d = new Uint8ClampedArray(64 * 64 * 4); for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) d.set(f(x, y), (y * 64 + x) * 4); return d; };
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const photo = () => [60 + rnd() * 120, 70 + rnd() * 100, 50 + rnd() * 90, 255];
  assert.equal(isBlank(tile(photo)), false, 'imagery');
  assert.equal(isBlank(tile(() => [0, 0, 0, 0])), true, 'transparent PNG');
  assert.equal(isBlank(tile(() => [255, 255, 255, 255])), true, 'white no-data');
  assert.equal(isBlank(tile(() => [0, 0, 0, 255])), true, 'black no-data');
  assert.equal(isBlank(tile(() => [128, 130, 127, 255])), true, 'single flat colour placeholder');
  assert.equal(isBlank(tile((x) => (x < 20 ? [0, 0, 0, 0] : photo()))), true, 'partial coverage, transparent edge (THR, Tasmania, Queensland)');
  assert.equal(isBlank(tile((x, y) => (y > 50 ? [255, 255, 255, 255] : photo()))), true, 'partial coverage, white edge (Basel, Lyon)');
  assert.equal(isBlank(tile((x, y) => (x < 30 && y < 30 ? [0, 0, 0, 255] : photo()))), true, 'partial coverage, black edge (ImageServer exports)');
  assert.equal(isBlank(tile((x, y) => (x < 3 && y < 3 ? [255, 255, 255, 255] : photo()))), false, 'a few white pixels (roofs) are not a gap');
  assert.equal(isBlank(tile((x, y) => (x < 4 && y < 4 ? [2, 2, 2, 255] : photo()))), false, 'a small dark shadow is not a gap');
});

await t('worker: a failed, missing or blank source tile falls back to the next source, then Esri', async () => {
  // canvas stubs: an image is a solid colour (blank) or noise (imagery); fetch answers per URL
  const kind = new WeakMap();
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.width = w; this.height = h; this.k = 'img'; }
    getContext() {
      const c = this;
      return { clearRect() {}, drawImage(b) { c.k = kind.get(b) || 'img'; }, putImageData() {},
        getImageData(x, y, w, h) { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { const v = c.k === 'blank' ? 255 : 40 + ((i * 7919) % 150); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; } return { data: d }; } };
    }
    transferToImageBitmap() { return { width: this.width, close() {} }; }
  };
  globalThis.createImageBitmap = async (blob) => { const b = { width: 256, close() {}, type: blob.type }; kind.set(b, (await blob.text()).startsWith('BLANK') ? 'blank' : 'img'); return b; };
  const answers = new Map(); const log = [];
  globalThis.fetch = async (u) => {
    log.push(u); const a = answers.get(u) || { status: 404 };
    if (a.cors) throw new TypeError('Failed to fetch');
    return { ok: a.status >= 200 && a.status < 300, status: a.status, headers: { get: () => a.ct || 'image/jpeg' }, arrayBuffer: async () => new TextEncoder().encode(a.body || 'JPEG'.padEnd(3000, 'x')).buffer };
  };
  const { handle } = await import('../src/terrain-worker.js');
  const run = (lo, hi = null) => new Promise((res) => { log.length = 0; handle({ type: 'img', id: 1, lo, hi, ref: null, cells: 1 }, (m) => res(m)); });
  const S1 = { u: 'https://a/1', b: 1, g: 'x' }, S2 = { u: 'https://b/1', b: 1, g: 'y' }, E = { u: 'https://esri/1' };
  for (const [name, a1] of [['5xx', { status: 500 }], ['CORS', { cors: 1 }], ['404', { status: 404 }], ['blank', { status: 200, body: 'BLANK' }]]) {
    answers.clear(); answers.set(S1.u, a1); answers.set(E.u, { status: 200 });
    const m = await run([S1, S2, E]);
    assert.ok(m.bmp, `${name}: got an image`); assert.deepEqual(log, [S1.u, S2.u, E.u], `${name}: tried in order`);
  }
  answers.clear(); answers.set(S1.u, { status: 503 }); answers.set(S2.u, { status: 200 });
  assert.ok((await run([S1, S2, E])).bmp); assert.deepEqual(log, [S1.u, S2.u], 'second source used, Esri not needed');
  answers.clear(); answers.set(S1.u, { status: 200, ct: 'application/octet-stream' });
  assert.ok((await run([S1, E])).bmp, 'octet-stream JPEG (ACT) decodes');
  answers.clear(); answers.set(E.u, { status: 500 });
  assert.ok((await run([E])).error, 'Esri itself failing is still an error (retried later)');
  // Wayback entry with its Esri fallback (f), in a 512 px composite
  const W = (i) => ({ u: `https://wb/${i}`, b: 1, f: { u: `https://esri/${i}` } });
  answers.clear(); for (const i of [0, 1, 2, 3]) answers.set(`https://esri/${i}`, { status: 200 });
  answers.set('https://wb/0', { status: 200 }); answers.set('https://wb/1', { status: 200, body: 'BLANK' }); answers.set('https://wb/2', { cors: 1 });
  const m = await run([], [0, 1, 2, 3].map(W));
  assert.ok(m.bmp && m.hi, 'composite from Wayback + Esri'); assert.ok(log.includes('https://esri/1') && log.includes('https://esri/2') && log.includes('https://esri/3') && !log.includes('https://esri/0'));
  // a regional source's 404 inside a 512 px upgrade is "outside coverage" (hiBlank), not "nothing finer exists"
  answers.clear(); answers.set('https://a/0', { status: 200 });
  const h = await run([], [0, 1, 2, 3].map((i) => ({ u: `https://a/${i}`, b: 1, g: 'x' })));
  assert.ok(h.nodata && h.hiBlank);
});

await t('Esri Wayback areas from wayback.json', async () => {
  const j = JSON.parse(read('test/fixtures/wayback-fixture.json'));
  setWayback(null); assert.equal(waybackUrl(17, 66415, 45175), null, 'off without data');
  setWayback(j);
  const tile = (z, lon, lat) => { const n = 2 ** z, s = Math.sin((lat * Math.PI) / 180); return [Math.floor(((lon + 180) / 360) * n), Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)]; };
  const [x, y] = tile(17, 2.3795, 48.7262);
  assert.equal(waybackUrl(17, x, y), `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/64776/17/${y}/${x}`);
  const [x15, y15] = tile(15, 2.3795, 48.7262), [x14, y14] = tile(14, 2.3795, 48.7262);
  assert.ok(waybackUrl(15, x15, y15)); assert.equal(waybackUrl(14, x14, y14), null, 'from z15 only');
  const [x21, y21] = tile(21, 2.3795, 48.7262); assert.equal(waybackUrl(21, x21, y21), null, 'to z20 only');
  const [ox, oy] = tile(17, 2.2, 48.6); assert.equal(waybackUrl(17, ox, oy), null, 'outside every area');
  const [bx, by] = tile(17, 10.5, 10.5); assert.equal(waybackUrl(17, bx, by), null, 'malformed entries ignored');
  let calls = 0;
  await loadWayback('/data/wayback.json', async () => { calls++; return { ok: false, status: 404 }; });
  assert.equal(calls, 1); assert.equal(waybackUrl(17, x, y), null, 'missing file: off, no throw');
  await loadWayback('/data/wayback.json', async () => ({ ok: true, json: async () => { throw new SyntaxError('html fallback'); } }));
  assert.equal(waybackUrl(17, x, y), null, 'SPA index.html instead of JSON: off');
  await loadWayback('/data/wayback.json', async () => { throw new TypeError('offline'); });
  await loadWayback('/data/wayback.json', async () => ({ ok: true, json: async () => j }));
  assert.ok(waybackUrl(17, x, y), 'loaded');
  setWayback(null);
});
console.log('all imagery source tests passed');
