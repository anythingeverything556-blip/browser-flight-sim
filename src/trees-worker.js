import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const w = 1024,
  lt = 3,
  ct = 1,
  Z = 2,
  ut = 4,
  Pt = 8,
  At = 16,
  mt = 32,
  dt = 64,
  Ct = Pt | At | mt | dt,
  NLC = 128, // treeless land cover: crops, meadow and pasture, open marsh, sand, rock, ice
  Ht = {
    motorway: 9,
    trunk: 8,
    primary: 6.5,
    secondary: 5.5,
    tertiary: 4.5,
    minor: 3.2,
    service: 2.6,
    rail: 3,
    raceway: 6,
    busway: 3,
    bus_guideway: 3,
  },
  Xt = new Set([
    'residential',
    'suburb',
    'neighbourhood',
    'cemetery',
    'school',
    'garden',
    'allotments',
    'grass',
    'village_green',
    'recreation_ground',
    'playground',
    'college',
    'university',
    'hospital',
  ]),
  $t = new Set(['pitch', 'stadium', 'track', 'quarry', 'railway', 'bus_station', 'parking', 'runway']),
  Kt = [
    [0.2, 0.34, 0.12],
    [0.1, 0.2, 0.12],
    [0.18, 0.36, 0.1],
  ];
function zt(e) {
  let t = e >>> 0;
  return () => {
    t = (t + 1831565813) >>> 0;
    let n = t;
    return (
      (n = Math.imul(n ^ (n >>> 15), n | 1)),
      (n ^= n + Math.imul(n ^ (n >>> 7), n | 61)),
      ((n ^ (n >>> 14)) >>> 0) / 4294967296
    );
  };
}
const ft = (e, t) => {
  let n = (Math.imul(e | 0, 374761393) + Math.imul(t | 0, 668265263)) | 0;
  return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967296);
};
function yt(e, t) {
  const n = Math.floor(e),
    r = Math.floor(t),
    s = e - n,
    i = t - r,
    a = s * s * (3 - 2 * s),
    o = i * i * (3 - 2 * i),
    y = ft(n, r),
    c = ft(n + 1, r),
    l = ft(n, r + 1),
    m = ft(n + 1, r + 1);
  return (y + (c - y) * a) * (1 - o) + (l + (m - l) * a) * o;
}
function j(e, t, n, r, s) {
  let i = 1e9,
    a = -1e9;
  for (const y of r) for (const c of y) (c.y < i && (i = c.y), c.y > a && (a = c.y));
  ((i = Math.max(0, Math.floor(i))), (a = Math.min(n - 1, Math.ceil(a))));
  const o = [];
  for (let y = i; y <= a; y++) {
    const c = y + 0.5;
    o.length = 0;
    for (const l of r)
      for (let m = 0, h = l.length - 1; m < l.length; h = m++) {
        const u = l[h],
          g = l[m];
        u.y <= c != g.y <= c && o.push(u.x + ((c - u.y) / (g.y - u.y)) * (g.x - u.x));
      }
    o.sort((l, m) => l - m);
    for (let l = 0; l + 1 < o.length; l += 2) {
      const m = Math.max(0, Math.round(o[l])),
        h = Math.min(t, Math.round(o[l + 1]));
      for (let u = m; u < h; u++) e[y * t + u] |= s;
    }
  }
}
function Bt(e, t, n, r, s, i) {
  for (let a = 0; a + 1 < r.length; a++) {
    const o = r[a],
      y = r[a + 1],
      c = y.x - o.x,
      l = y.y - o.y,
      m = c * c + l * l || 1e-9,
      h = Math.max(0, Math.floor(Math.min(o.x, y.x) - s)),
      u = Math.min(t - 1, Math.ceil(Math.max(o.x, y.x) + s)),
      g = Math.max(0, Math.floor(Math.min(o.y, y.y) - s)),
      f = Math.min(n - 1, Math.ceil(Math.max(o.y, y.y) + s));
    for (let V = g; V <= f; V++)
      for (let v = h; v <= u; v++) {
        const E = Math.min(1, Math.max(0, ((v + 0.5 - o.x) * c + (V + 0.5 - o.y) * l) / m)),
          L = o.x + E * c - v - 0.5,
          R = o.y + E * l - V - 0.5;
        L * L + R * R <= s * s && (e[V * t + v] |= i);
      }
  }
}
function Jt(e, t) {
  const n = Math.ceil(t.W / lt),
    r = Math.ceil(t.H / lt),
    s = new Uint8Array(n * r);
  if (!e) return { mask: s, mw: n, mh: r, have: !1 };
  const i = new VectorTile(new PbfReader(new Uint8Array(e))),
    o = ((i.layers.landcover || i.layers.transportation || i.layers.building || { extent: 4096 }).extent || 4096) / 2,
    y = t.sx * o,
    c = t.sy * o,
    l = (h) => h.map((u) => u.map((g) => ({ x: ((g.x - y) / o) * n, y: ((g.y - c) / o) * r }))),
    m = (h, u) => {
      const g = i.layers[h];
      if (g)
        for (let f = 0; f < g.length; f++) {
          const V = g.feature(f);
          u(V, V.properties);
        }
    };
  return (
    m('landcover', (h, u) => {
      if (h.type !== 3) return;
      const g = u.class,
        f =
          g === 'wood'
            ? ct
            : g === 'wetland'
              ? u.subclass === 'swamp' || u.subclass === 'mangrove'
                ? ct
                : NLC
              : g === 'grass'
                ? u.subclass === 'scrub'
                  ? ut
                  : NLC
                : g === 'farmland'
                  ? u.subclass === 'orchard' || u.subclass === 'plant_nursery'
                    ? Z
                    : NLC
                  : g === 'sand' || g === 'rock' || g === 'ice'
                    ? NLC
                    : 0;
      f && j(s, n, r, l(h.loadGeometry()), f);
    }),
    m('landuse', (h, u) => {
      h.type === 3 &&
        (u.class === 'forest' || u.class === 'wood'
          ? j(s, n, r, l(h.loadGeometry()), ct)
          : Xt.has(u.class)
            ? j(s, n, r, l(h.loadGeometry()), Z)
            : $t.has(u.class) && j(s, n, r, l(h.loadGeometry()), dt));
    }),
    m('park', (h, u) => {
      h.type === 3 && (u.class === 'park' || u.class === 'garden') && j(s, n, r, l(h.loadGeometry()), Z);
    }),
    m('water', (h) => {
      h.type === 3 && j(s, n, r, l(h.loadGeometry()), Pt);
    }),
    m('building', (h) => {
      h.type === 3 && j(s, n, r, l(h.loadGeometry()), At);
    }),
    m('aeroway', (h, u) => {
      const g = l(h.loadGeometry());
      if (h.type === 3) j(s, n, r, g, dt);
      else if (h.type === 2) for (const f of g) Bt(s, n, r, f, (u.class === 'runway' ? 25 : 12) / lt, dt);
    }),
    m('transportation', (h, u) => {
      if (u.brunnel === 'tunnel') return;
      const g = l(h.loadGeometry());
      if (h.type === 3) {
        u.class !== 'path' && j(s, n, r, g, mt);
        return;
      }
      const f = Ht[String(u.class).replace(/_construction$/, '')];
      if (f && h.type === 2) for (const V of g) Bt(s, n, r, V, f / lt, mt);
    }),
    { mask: s, mw: n, mh: r, have: !0 }
  );
}
function Yt(e) {
  const t = new OffscreenCanvas(w, w),
    n = t.getContext('2d', { willReadFrequently: !0 }),
    r = new Uint8Array(16);
  let s = 0;
  for (let f = 0; f < 16; f++)
    e[f] && (n.drawImage(e[f], (f & 3) * 256, (f >> 2) * 256, 256, 256), e[f].close(), (r[f] = 1), s++);
  if (!s) return null;
  const i = performance.now(),
    a = n.getImageData(0, 0, w, w).data,
    o = w + 1,
    y = performance.now();
  self.prof2 = [i, y];
  const c = new Float64Array(o * o),
    l = new Float64Array(o * o),
    m = new Float32Array(w * w);
  for (let f = 0; f < w; f++) {
    let V = 0,
      v = 0;
    for (let E = 0; E < w; E++) {
      const L = (f * w + E) * 4,
        R = 0.299 * a[L] + 0.587 * a[L + 1] + 0.114 * a[L + 2];
      ((m[f * w + E] = R),
        (V += R),
        (v += R * R),
        (c[(f + 1) * o + E + 1] = c[f * o + E + 1] + V),
        (l[(f + 1) * o + E + 1] = l[f * o + E + 1] + v));
    }
  }
  const h = new Uint8Array(w * w),
    u = 3;
  for (let f = 0; f < w; f++) {
    const V = Math.max(0, f - u),
      v = Math.min(w, f + u + 1);
    for (let E = 0; E < w; E++) {
      if (!r[(f >> 8) * 4 + (E >> 8)]) continue;
      const L = (f * w + E) * 4,
        R = a[L],
        tt = a[L + 1],
        it = a[L + 2],
        A = m[f * w + E],
        D = Math.max(0, E - u),
        X = Math.min(w, E + u + 1),
        ot = (X - D) * (v - V),
        Mt = c[v * o + X] - c[V * o + X] - c[v * o + D] + c[V * o + D],
        z = l[v * o + X] - l[V * o + X] - l[v * o + D] + l[V * o + D],
        q = Mt / ot,
        xt = Math.sqrt(Math.max(0, z / ot - q * q)),
        et = tt >= R + 3 && tt >= it + 6,
        $ = A < 120 && (A < q * 0.92 || A < 75),
        nt = A < 58 && 2 * tt - R - it >= 0 && tt >= it + 2;
      // texture is always required: smooth dark green is a crop, a lawn or dark water, not a canopy of crowns
      ((et && $ && xt > 7) || (nt && xt > 5)) && (h[f * w + E] = 1);
    }
  }
  self.prof2.push(performance.now());
  const g = new Int32Array(o * o);
  for (let f = 0; f < w; f++) {
    let V = 0;
    for (let v = 0; v < w; v++) ((V += h[f * w + v]), (g[(f + 1) * o + v + 1] = g[f * o + v + 1] + V));
  }
  return { px: a, canopy: h, iC: g, known: r, S: o };
}
function Qt(e) {
  const t = performance.now(),
    n = zt((e.x15 * 73856093) ^ (e.y15 * 19349663)),
    { mask: r, mw: s, mh: i } = Jt(e.vt, e),
    a = performance.now() - t,
    o = e.imgs ? Yt(e.imgs) : null,
    y = performance.now() - t,
    c = e.W,
    l = e.H,
    m = c / w,
    h = Math.abs(e.lat),
    u = e.elev || 0,
    g = h < 24,
    f = h > 52,
    V = (d, p) => {
      const x = Math.floor(((d + c / 2) / c) * s),
        M = Math.floor(((l / 2 - p) / l) * i);
      return x < 0 || M < 0 || x >= s || M >= i ? Ct : r[M * s + x];
    },
    v = (d, p) => {
      for (const x of e.runways) {
        const M = d - x[0],
          _ = p - x[1],
          F = M * x[2] + _ * x[3],
          k = M * x[3] - _ * x[2];
        if (Math.abs(F) < x[4] && Math.abs(k) < x[5]) return !0;
      }
      return !1;
    },
    E = (d, p, x) => {
      const M = o.S,
        _ = Math.max(0, d - x),
        F = Math.min(w, d + x + 1),
        k = Math.max(0, p - x),
        S = Math.min(w, p + x + 1),
        C = o.iC;
      return (C[S * M + F] - C[k * M + F] - C[S * M + _] + C[k * M + _]) / ((F - _) * (S - k));
    },
    L = [
      [1, 0],
      [0.7, 0.7],
      [0, 1],
      [-0.7, 0.7],
      [-1, 0],
      [-0.7, -0.7],
      [0, -1],
      [0.7, -0.7],
    ],
    R = (d, p, x) => {
      let M = 0;
      for (const _ of L) {
        let F = 0;
        for (; F < x;) {
          const k = Math.round(d + _[0] * (F + 1)),
            S = Math.round(p + _[1] * (F + 1));
          if (k < 0 || S < 0 || k >= w || S >= w || !o.canopy[S * w + k]) break;
          F++;
        }
        M += F;
      }
      return (M / 8) * m;
    },
    tt = [
      [0, 0],
      [0.5, 0],
      [-0.5, 0],
      [0, 0.5],
      [0, -0.5],
      [0.35, 0.35],
      [-0.35, 0.35],
      [0.35, -0.35],
      [-0.35, -0.35],
      [0.9, 0],
      [-0.9, 0],
      [0, 0.9],
      [0, -0.9],
    ],
    it = (d, p, x) => {
      let M = 0,
        _ = 0,
        F = 0,
        k = 0,
        S = 0,
        C = 0,
        I = 0,
        b = 0;
      for (const O of tt) {
        const B = Math.round(d + O[0] * x),
          P = Math.round(p + O[1] * x);
        if (B < 0 || P < 0 || B >= w || P >= w) continue;
        const U = (P * w + B) * 4;
        o.canopy[P * w + B]
          ? ((M += o.px[U]), (_ += o.px[U + 1]), (F += o.px[U + 2]), k++)
          : ((S += o.px[U]), (C += o.px[U + 1]), (I += o.px[U + 2]), b++);
      }
      return k ? [M / k, _ / k, F / k] : b ? [S / b, C / b, I / b] : null;
    },
    A = 3.2,
    D = [];
  let X = 0,
    ot = 0;
  for (let d = -l / 2 + A / 2; d < l / 2; d += A)
    for (let p = -c / 2 + A / 2; p < c / 2; p += A) {
      const x = p + (n() - 0.5) * A,
        M = d + (n() - 0.5) * A,
        _ = V(x, M);
      if (_ & Ct || (e.runways.length && v(x, M))) continue;
      if (_ & NLC && !(_ & (ct | Z | ut))) continue;
      const F = !!(_ & ct),
        k = Math.floor(((x + c / 2) / c) * w),
        S = Math.floor(((l / 2 - M) / l) * w);
      let C = 1,
        I;
      if (o && o.known[(S >> 8) * 4 + (k >> 8)]) ((C = E(k, S, 2)), (I = C >= (F ? 0.4 : _ & ut ? 0.5 : _ & Z ? 0.5 : 0.72)));
      else {
        const b = F ? 0.9 : _ & ut ? 0.25 : _ & Z ? 0.14 : 0;
        I = b > 0 && n() < b * (0.6 + 0.8 * yt(x / 60, M / 60));
      }
      I && (D.push(x, M, F ? 1 : _ & ut ? 2 : 0, k, S), F ? (X += A * A) : (ot += A * A));
    }
  const Mt = performance.now() - t;
  let z = 9,
    q = 5.5;
  const xt = X / (1.4 * z * z) + ot / (1.4 * q * q);
  if (xt > e.cap) {
    const d = Math.sqrt(xt / e.cap);
    ((z *= d), (q *= d));
  }
  const et = D.length / 5,
    $ = new Uint32Array(et);
  for (let d = 0; d < et; d++) $[d] = d;
  for (let d = et - 1; d > 0; d--) {
    const p = Math.floor(n() * (d + 1)),
      x = $[d];
    (($[d] = $[p]), ($[p] = x));
  }
  const nt = 4,
    Dt = Math.ceil(c / nt),
    _t = new Map(),
    Zt = Math.max(z, q),
    T = [],
    pt = Math.ceil(Zt / nt);
  for (let d = 0; d < et; d++) {
    const p = $[d] * 5,
      x = D[p],
      M = D[p + 1],
      _ = D[p + 2],
      F = D[p + 3],
      k = D[p + 4],
      S = _ === 1 ? z : _ === 2 ? q * 0.8 : q,
      C = Math.floor((x + c / 2) / nt),
      I = Math.floor((M + l / 2) / nt);
    let b = !1;
    for (let P = -pt; P <= pt && !b; P++)
      for (let U = -pt; U <= pt; U++) {
        const gt = _t.get((I + P) * Dt + C + U);
        if (gt) {
          for (const N of gt)
            if (Math.hypot(T[N] - x, T[N + 1] - M) < (S + T[N + 2]) * 0.5) {
              b = !0;
              break;
            }
          if (b) break;
        }
      }
    if (b) continue;
    const O = I * Dt + C;
    let B = _t.get(O);
    if ((B || _t.set(O, (B = [])), B.push(T.length), T.push(x, M, S, _, F, k), T.length / 6 >= e.cap)) break;
  }
  const te = performance.now() - t,
    ee = T.length / 6,
    st = [[], [], []];
  for (let d = 0; d < ee; d++) {
    const p = T[d * 6],
      x = T[d * 6 + 1],
      M = T[d * 6 + 2],
      _ = T[d * 6 + 3],
      F = T[d * 6 + 4],
      k = T[d * 6 + 5],
      S = _ === 1,
      C = _ === 2,
      I = n(),
      b = n(),
      O = n();
    let B = o && o.known[(k >> 8) * 4 + (F >> 8)] ? R(F, k, Math.round(9 / m)) : 0;
    const P = o && B >= 0 && o.known[(k >> 8) * 4 + (F >> 8)] ? it(F, k, Math.max(1.5, (B / m) * 0.7)) : null,
      U = P ? 0.299 * P[0] + 0.587 * P[1] + 0.114 * P[2] : 90,
      gt = yt(p / 110 + 7.3, x / 110 - 3.1) * 0.75 + yt(p / 35, x / 35) * 0.25;
    let N = f ? 0.9 : h > 45 ? 0.55 : h > 35 ? 0.25 : g ? 0.02 : 0.1;
    (S || (N *= 0.3), u > 1e3 && (N += 0.25), u > 1800 && (N += 0.25), U < 52 && (N += 0.2));
    let H = 0;
    (g && !C && I < (S ? 0.08 : 0.38) && B < 6.5) || (h < 31 && h > 24 && I < 0.12 && !S)
      ? (H = 2)
      : gt < N * 0.78 + (N > 0.5 ? 0.1 : 0) && (H = 1);
    let K, J;
    (H === 2
      ? ((K = 7 + b * 9), (J = 3.2 + O * 1.6))
      : C
        ? ((K = 3 + b * 4), (J = Math.max(1.6, Math.min(3.5, B || 2.5))))
        : S
          ? ((K = 12 + 13 * Math.pow(b, 0.9) * (0.75 + 0.5 * yt(p / 90, x / 90))),
            (K = Math.min(25, K)),
            (J = M * (0.58 + 0.2 * O)))
          : ((J = Math.max(2, Math.min(8, B * 1.05 || 3.2 + O * 2))),
            (K = Math.min(14, Math.max(5.5, 4.6 + J * 1.15 + b * 3)))),
      H === 1 && ((J *= 0.72), S && (K *= 1.05)));
    let kt, Vt, St;
    const rt = Kt[H];
    if (P) {
      const Y = 1.22 * (0.92 + 0.16 * O);
      ((kt = Math.min(1, (P[0] / 255) * Y) * 0.85 + rt[0] * 0.15),
        (Vt = Math.min(1, (P[1] / 255) * Y) * 0.85 + rt[1] * 0.15),
        (St = Math.min(1, (P[2] / 255) * Y) * 0.85 + rt[2] * 0.15));
    } else {
      const Y = 0.8 + 0.4 * O,
        ne = (b - 0.5) * 0.12;
      ((kt = (rt[0] + ne) * Y), (Vt = rt[1] * Y), (St = rt[2] * Y));
    }
    st[H].push([p, x, K, J, I * 6.2832, kt, Vt, St, H + 3 * (b < 0.5 ? 0 : 1)]);
  }
  const wt = st[0].length + st[1].length + st[2].length,
    Ft = new Float32Array(wt * 2),
    at = new Float32Array(wt * 4),
    ht = new Uint8Array(wt * 4);
  let G = 0;
  for (let d = 0; d < 3; d++)
    for (const p of st[d])
      ((Ft[G * 2] = p[0]),
        (Ft[G * 2 + 1] = p[1]),
        (at[G * 4] = p[2]),
        (at[G * 4 + 1] = p[3]),
        (at[G * 4 + 2] = p[4]),
        (at[G * 4 + 3] = d),
        (ht[G * 4] = Math.round(p[5] * 255)),
        (ht[G * 4 + 1] = Math.round(p[6] * 255)),
        (ht[G * 4 + 2] = Math.round(p[7] * 255)),
        (ht[G * 4 + 3] = p[8]),
        G++);
  return {
    count: wt,
    counts: st.map((d) => d.length),
    pos: Ft,
    A: at,
    C: ht,
    photo: !!o,
    vector: !!e.vt,
    prof: [a, y, Mt, te, ...(self.prof2 || []).map((d) => d - t)].map(Math.round),
    ms: performance.now() - t,
  };
}
self.onmessage = (e) => {
  const t = e.data;
  try {
    const n = Qt(t);
    self.postMessage({ id: t.id, ...n }, [n.pos.buffer, n.A.buffer, n.C.buffer]);
  } catch (n) {
    self.postMessage({ id: t.id, error: String((n && n.stack) || n) });
  }
};
