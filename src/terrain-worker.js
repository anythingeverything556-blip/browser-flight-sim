import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { SOURCES } from './imagery-sources.js';
import { terrariumToHeights } from './terrain-dem.js';

const xb = 2521,
  Mb = 2463699343;
function wb(s) {
  if (s.byteLength !== xb) return !1;
  const t = new Uint8Array(s);
  let e = 2166136261;
  for (let n = 0; n < t.length; n++) ((e ^= t[n]), (e = Math.imul(e, 16777619) >>> 0));
  return e === Mb;
}
const fs = 256,
  bb = 14,
  Sb = 'https://tiles.openfreemap.org/planet';
let Pl = null;
function Tb() {
  return (
    Pl ||
      (Pl = fetch(Sb, { mode: 'cors' })
        .then((s) => s.json())
        .then((s) => s.tiles[0])
        .catch((s) => {
          throw ((Pl = null), s);
        })),
    Pl
  );
}
const Ds = new Map();
function Ab(s, t, e) {
  const n = `${s}/${t}/${e}`;
  let i = Ds.get(n);
  return i
    ? (Ds.delete(n), Ds.set(n, i), i)
    : ((i = (async () => {
        const r = (await Tb()).replace('{z}', s).replace('{x}', t).replace('{y}', e),
          a = new AbortController(),
          l = setTimeout(() => a.abort(), a0);
        try {
          const h = await fetch(r, { mode: 'cors', signal: a.signal });
          if (h.status === 404 || h.status === 204) return null;
          if (!h.ok) throw new Error('vt ' + h.status);
          return new VectorTile(new PbfReader(new Uint8Array(await h.arrayBuffer()))).layers.water || null;
        } finally {
          clearTimeout(l);
        }
      })()),
      i.catch(() => Ds.delete(n)),
      Ds.set(n, i),
      Ds.size > 48 && Ds.delete(Ds.keys().next().value),
      i);
}
async function Eb(s, t, e) {
  const n = Math.min(s, bb),
    i = s - n,
    r = 2 ** i,
    a = Math.floor(t / r),
    l = Math.floor(e / r),
    h = await Ab(n, a, l);
  if (!h) return { water: 0 };
  const u = h.extent,
    f = t - a * r,
    d = e - l * r,
    p = (fs * r) / u,
    v = u * 0.02,
    y = (f / r) * u - v,
    x = ((f + 1) / r) * u + v,
    g = (d / r) * u - v,
    _ = ((d + 1) / r) * u + v,
    w = new OffscreenCanvas(fs, fs),
    b = w.getContext('2d', { willReadFrequently: !0 });
  (b.setTransform(p, 0, 0, p, -f * fs, -d * fs), (b.fillStyle = '#fff'));
  for (let D = 0; D < h.length; D++) {
    const N = h.feature(D),
      R = N.properties;
    if (N.type !== 3 || R.class === 'swimming_pool' || R.intermittent === 1) continue;
    const C = N.bbox();
    if (!(C[2] < y || C[0] > x || C[3] < g || C[1] > _)) {
      b.beginPath();
      for (const F of N.loadGeometry())
        (F.forEach((k, J) => (J ? b.lineTo(k.x, k.y) : b.moveTo(k.x, k.y))), b.closePath());
      b.fill('evenodd');
    }
  }
  const S = b.getImageData(0, 0, fs, fs).data;
  let E = 0;
  for (let D = 3; D < S.length; D += 4) E += S[D];
  const A = E / (255 * fs * fs);
  return A < 5e-4 ? { water: 0 } : A > 0.9995 ? { water: 2 } : { water: 1, bmp: w.transferToImageBitmap() };
}
const Hh = new Map(),
  a0 = 2e4,
  Gh = new OffscreenCanvas(64, 64).getContext('2d', { willReadFrequently: !0 }),
  Bp = new Uint8Array(4096);
function Rb(s) {
  (Gh.clearRect(0, 0, 64, 64), Gh.drawImage(s, 0, 0, 64, 64));
  const t = Gh.getImageData(0, 0, 64, 64).data;
  for (let n = 0, i = 0; n < t.length; n += 4, i++)
    Bp[i] = t[n + 3] < 200 || (t[n] >= 254 && t[n + 1] >= 254 && t[n + 2] >= 254) ? 1 : 0;
  let e = 0;
  for (let n = 1; n < 63; n++)
    for (let i = 1; i < 63; i++) {
      let r = 1;
      for (let a = -1; a <= 1 && r; a++)
        for (let l = -1; l <= 1; l++)
          if (!Bp[(n + a) * 64 + i + l]) {
            r = 0;
            break;
          }
      e += r;
    }
  return e > 3844 * 0.01;
}
const Vh = {};
function Cb(s) {
  if (Vh[s]) return Vh[s];
  const t = new Uint8Array(768);
  return (
    SOURCES[s].forEach((e, n) => {
      for (let i = 0; i < 256; i++) {
        let r = 2;
        for (; r < e.length - 2 && e[r] < i;) r += 2;
        const a = e[r - 2],
          l = e[r - 1],
          h = e[r],
          u = e[r + 1];
        t[n * 256 + i] = Math.max(
          0,
          Math.min(255, Math.round(h > a ? l + (u - l) * Math.min(1, Math.max(0, (i - a) / (h - a))) : u)),
        );
      }
    }),
    (Vh[s] = t)
  );
}
function kp(s, t, e, n, i) {
  const r = new OffscreenCanvas(s, s),
    a = r.getContext('2d', { willReadFrequently: !0 });
  for (const u of t) (a.drawImage(u.bmp, u.x, u.y, u.s, u.s), u.bmp.close());
  const l = a.getImageData(0, 0, s, s),
    h = l.data;
  if (e && SOURCES[e]) {
    const u = Cb(e);
    for (let f = 0; f < h.length; f += 4)
      ((h[f] = u[h[f]]), (h[f + 1] = u[256 + h[f + 1]]), (h[f + 2] = u[512 + h[f + 2]]));
  }
  return (
    n && Pb(h, s, n, i),
    ((e && SOURCES[e]) || n) && a.putImageData(l, 0, 0),
    { bmp: r.transferToImageBitmap(), low: l0(h, s, 16) }
  );
}
function l0(s, t, e) {
  const n = new Float32Array(e * e * 3),
    i = t / e,
    r = Math.max(1, i >> 3);
  for (let a = 0; a < e; a++)
    for (let l = 0; l < e; l++) {
      let h = 0,
        u = 0,
        f = 0,
        d = 0;
      for (let v = a * i; v < (a + 1) * i; v += r)
        for (let y = l * i; y < (l + 1) * i; y += r) {
          const x = (v * t + y) * 4;
          ((h += s[x]), (u += s[x + 1]), (f += s[x + 2]), d++);
        }
      const p = (a * e + l) * 3;
      ((n[p] = h / d), (n[p + 1] = u / d), (n[p + 2] = f / d));
    }
  return n;
}
function Pb(s, t, e, n) {
  const i = l0(s, t, n),
    r = new Float32Array(n * n * 3);
  for (let h = 0; h < r.length; h++) r[h] = Math.min(1.8, Math.max(0.55, (e[h] + 3) / (i[h] + 3)));
  if (n > 2) {
    const h = r.slice();
    for (let u = 0; u < n; u++)
      for (let f = 0; f < n; f++)
        for (let d = 0; d < 3; d++) {
          let p = 0,
            v = 0;
          for (let y = -1; y <= 1; y++)
            for (let x = -1; x <= 1; x++) {
              const g = u + y,
                _ = f + x;
              g < 0 || _ < 0 || g >= n || _ >= n || ((p += h[(g * n + _) * 3 + d]), v++);
            }
          r[(u * n + f) * 3 + d] = p / v;
        }
  }
  const a = t / n,
    l = new Float32Array(n * 3);
  for (let h = 0; h < t; h++) {
    const u = Math.min(n - 1, Math.max(0, (h + 0.5) / a - 0.5)),
      f = Math.floor(u),
      d = Math.min(n - 1, f + 1),
      p = u - f;
    for (let v = 0; v < n * 3; v++) l[v] = r[f * n * 3 + v] * (1 - p) + r[d * n * 3 + v] * p;
    for (let v = 0; v < t; v++) {
      const y = Math.min(n - 1, Math.max(0, (v + 0.5) / a - 0.5)),
        x = Math.floor(y),
        g = Math.min(n - 1, x + 1),
        _ = y - x,
        w = (h * t + v) * 4;
      for (let b = 0; b < 3; b++) s[w + b] = s[w + b] * (l[x * 3 + b] * (1 - _) + l[g * 3 + b] * _);
    }
  }
}
async function zp({ u: s, b: t }, e) {
  const n = await fetch(s, { mode: 'cors', signal: e });
  if (n.status === 404 || n.status === 410 || n.status === 204) return { missing: !0 };
  if (!n.ok) throw new Error('img ' + n.status);
  const i = await n.arrayBuffer();
  if (wb(i)) return { missing: !0 };
  const r = await createImageBitmap(new Blob([i], { type: n.headers.get('content-type') || 'image/jpeg' }));
  return t && Rb(r) ? (r.close(), { missing: !0, blank: !0 }) : { bmp: r };
}
async function Lb(s, t, e) {
  let n = !1;
  if (s.hi) {
    const i = await Promise.all(s.hi.map((a) => zp(a, t).catch((l) => ({ err: l })))),
      r = i.find((a) => a.err);
    if (r) throw (i.forEach((a) => a.bmp && a.bmp.close()), r.err);
    if (i.every((a) => a.bmp)) {
      const a = kp(
        512,
        i.map((l, h) => ({ bmp: l.bmp, x: (h & 1) * 256, y: (h >> 1) * 256, s: 256 })),
        s.hi[0].g,
        s.ref,
        s.cells,
      );
      e({ id: s.id, bmp: a.bmp, low: a.low, hi: !0 }, [a.bmp]);
      return;
    }
    (i.forEach((a) => a.bmp && a.bmp.close()), (n = i.some((a) => a.blank)));
  }
  for (const i of s.lo) {
    const r = await zp(i, t);
    if (r.bmp) {
      const a = kp(r.bmp.width, [{ bmp: r.bmp, x: 0, y: 0, s: r.bmp.width }], i.g, s.ref, s.cells);
      e({ id: s.id, bmp: a.bmp, low: a.low, capped: !!s.hi && !n }, [a.bmp]);
      return;
    }
  }
  e({ id: s.id, nodata: !0, hiBlank: n });
}
async function handle(s, t) {
  if (s.type === 'cancel') {
    const i = Hh.get(s.id);
    i && i.abort();
    return;
  }
  if (s.type === 'mask') {
    try {
      const i = await Eb(s.z, s.x, s.y);
      t({ id: s.id, water: i.water, bmp: i.bmp }, i.bmp ? [i.bmp] : []);
    } catch (i) {
      t({ id: s.id, error: String((i && i.message) || i) });
    }
    return;
  }
  const e = new AbortController(),
    n = setTimeout(() => e.abort(), a0);
  Hh.set(s.id, e);
  try {
    if (s.type === 'img') {
      await Lb(s, e.signal, t);
      return;
    }
    const i = await fetch(s.url, { mode: 'cors', signal: e.signal });
    if (!i.ok) {
      t({ id: s.id, status: i.status });
      return;
    }
    const r = await i.arrayBuffer();
    {
      const a = await createImageBitmap(new Blob([r], { type: 'image/png' }), {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
        }),
        l = new OffscreenCanvas(a.width, a.height),
        h = l.getContext('2d', { willReadFrequently: !0 });
      h.drawImage(a, 0, 0);
      const u = h.getImageData(0, 0, a.width, a.height).data;
      a.close();
      const f = terrariumToHeights(u, l.width, s.z, s.x, s.y);
      t({ id: s.id, data: f }, [f.buffer]);
    }
  } catch (i) {
    t({ id: s.id, error: String((i && i.message) || i) });
  } finally {
    (clearTimeout(n), Hh.delete(s.id));
  }
}
typeof WorkerGlobalScope < 'u' &&
  self instanceof WorkerGlobalScope &&
  (self.onmessage = (s) => handle(s.data, (t, e) => self.postMessage(t, e || [])));

export { handle };
