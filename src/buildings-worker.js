import { PbfReader } from 'pbf';
import { classifyRings } from '@mapbox/vector-tile';
import { VectorTile } from '@mapbox/vector-tile';
import earcut from 'earcut';

const Xt = 256,
  Yt = 18,
  Zt = 4,
  te = 3.2,
  we = Xt / Zt,
  _e = Xt / te;
function hn(e, t, n, i, r) {
  let s;
  e >= 55
    ? (s = n < 0.6 ? (i * 4) | 0 : n < 0.85 ? 4 : 13)
    : e >= 28
      ? (s = n < 0.3 ? (i * 4) | 0 : n < 0.55 ? 4 + (i < 0.5 ? 0 : 1) : n < 0.8 ? 6 : 13)
      : e >= 12
        ? (s =
            n < 0.15
              ? 4 + (i < 0.5 ? 0 : 1)
              : n < 0.4
                ? 6 + (i < 0.5 ? 0 : 1)
                : n < 0.7
                  ? 9 + (i < 0.5 ? 0 : 1)
                  : n < 0.88
                    ? 8
                    : 13)
        : t > 900 && e < 16
          ? (s = 11 + (i < 0.45 ? 1 : 0))
          : (s = n < 0.3 ? 8 : n < 0.55 ? 7 : n < 0.85 ? 9 + (i < 0.5 ? 0 : 1) : 6);
  let o = s;
  return (
    s >= 11 && s <= 12
      ? (o = s)
      : e >= 7 &&
        (o = s <= 5 || s === 13 ? 14 + (r < 0.5 ? 0 : 1) : r < 0.35 ? 14 + (i < 0.5 ? 0 : 1) : r < 0.75 ? 16 : 17),
    [s, o]
  );
}
const xt = (e) => (e < 0 ? 0 : e > 1 ? 1 : e),
  ee = (e, t, n) => {
    let i = (Math.imul(e | 0, 374761393) + Math.imul(t | 0, 668265263) + Math.imul(n | 0, 1442695041)) | 0;
    return ((i = Math.imul(i ^ (i >>> 13), 1274126177)), ((i ^ (i >>> 16)) >>> 0) / 4294967296);
  },
  Ht = (e, t) => ((e % t) + t) % t;
function Bt(e, t, n, i, r) {
  const s = Math.floor(e),
    o = Math.floor(t),
    a = e - s,
    l = t - o,
    h = a * a * (3 - 2 * a),
    u = l * l * (3 - 2 * l),
    y = (p, g) => ee(Ht(s + p, n), Ht(o + g, i), r);
  return (y(0, 0) * (1 - h) + y(1, 0) * h) * (1 - u) + (y(0, 1) * (1 - h) + y(1, 1) * h) * u;
}
const d = (e, t, n, i, r, s) => xt(Math.min(Math.min(e - n, r - e) * we, Math.min(t - i, s - t) * _e) + 0.5),
  cn = [
    [58, 92, 124],
    [46, 98, 96],
    [60, 56, 54],
    [112, 142, 168],
  ];
function bt(e) {
  const t = cn[e];
  return (n, i, r, s, o) => {
    o(156, 160, 166, 0.35, 0.85, 0, 0);
    const a = Math.max(d(n, i, 0.07, 0.05, 1.96, 2.98), d(n, i, 2.04, 0.05, 3.93, 2.98));
    s(a, t[0] * 0.55, t[1] * 0.55, t[2] * 0.55, 0.22, 0.55, 0, 0);
    const l = Math.max(d(n, i, 0.07, 0.95, 1.96, 2.98), d(n, i, 2.04, 0.95, 3.93, 2.98)),
      h = 0.7 + 0.5 * (i / te) + 0.12 * Bt(n * 3, i * 3, 12, 10, 3);
    s(l, t[0] * h, t[1] * h, t[2] * h, 0.06, 0.9, 1, 0);
  };
}
function Fe(e) {
  return (t, n, i, r, s) => {
    if (!e)
      (s(204, 200, 190, 0.85, 0, 0, 1),
        r(d(t, n, 0.18, 0.9, 3.82, 2.55), 38, 60, 82, 0.08, 0.85, 1, 0),
        r(d(t, n, 1.97, 0.9, 2.03, 2.55), 92, 96, 100, 0.4, 0.8, 0, 0),
        r(d(t, n, 0.18, 0.84, 3.82, 0.9), 120, 118, 112, 0.7, 0.2, 0, 0.5));
    else {
      s(214, 205, 188, 0.88, 0, 0, 1);
      for (const o of [0.35, 2.25]) {
        const a = o + 1.4;
        (r(d(t, n, o - 0.1, 0.7, a + 0.1, 0.8), 230, 226, 216, 0.8, 0, 0, 0.6),
          r(d(t, n, o - 0.07, 0.8, a + 0.07, 2.57), 232, 230, 224, 0.55, 0, 0, 0.3),
          r(d(t, n, o, 0.87, a, 2.5), 40, 62, 84, 0.08, 0.85, 1, 0),
          r(d(t, n, o + 0.68, 0.87, o + 0.72, 2.5), 232, 230, 224, 0.55, 0, 0, 0.3),
          r(d(t, n, o, 1.86, a, 1.9), 232, 230, 224, 0.55, 0, 0, 0.3));
      }
    }
  };
}
function fn(e, t, n, i, r) {
  (r(224, 218, 206, 0.9, 0, 0, 1),
    i(d(e, t, 0.68, 0.28, 3.32, 2.55), 236, 236, 232, 0.5, 0.1, 0, 0.2),
    i(d(e, t, 0.74, 0.3, 3.26, 2.5), 34, 52, 68, 0.07, 0.85, 1, 0),
    i(d(e, t, 1.96, 0.3, 2.04, 2.5), 236, 236, 232, 0.5, 0.1, 0, 0.2),
    i(d(e, t, 0.1, 0.28, 3.9, 1.1), 120, 140, 148, 0.1, 0.5, 0, 0.1),
    i(d(e, t, 0.1, 1.06, 3.9, 1.1), 200, 204, 206, 0.4, 0.8, 0, 0),
    i(d(e, t, 0, 0, 4, 0.28), 196, 192, 184, 0.9, 0, 0, 0.8),
    i(xt((t - 2.85) * 6) * 0.35, 40, 38, 34, 0.9, 0, 0, 0.5));
}
function un(e, t, n, i, r) {
  r(228, 220, 204, 0.92, 0, 0, 1);
  for (const s of [0.55, 2.45])
    (i(d(e, t, s - 0.3, 0.85, s - 0.04, 2.35), 84, 106, 90, 0.6, 0, 0, 0),
      i(d(e, t, s + 1.04, 0.85, s + 1.3, 2.35), 84, 106, 90, 0.6, 0, 0, 0),
      i(d(e, t, s - 0.12, 0.7, s + 1.12, 0.8), 214, 208, 196, 0.8, 0, 0, 0.5),
      i(d(e, t, s - 0.04, 0.85, s + 1.04, 2.35), 240, 240, 236, 0.5, 0, 0, 0.2),
      i(d(e, t, s, 0.9, s + 1, 2.3), 38, 54, 70, 0.07, 0.85, 1, 0),
      i(d(e, t, s + 0.48, 0.9, s + 0.52, 2.3), 240, 240, 236, 0.5, 0, 0, 0.2));
}
function xn(e, t, n, i, r) {
  (r(236, 232, 222, 0.93, 0, 0, 1),
    i(d(e, t, 1, 0.78, 3, 0.88), 220, 216, 208, 0.8, 0, 0, 0.5),
    i(d(e, t, 1.1, 0.88, 2.9, 2.42), 244, 244, 240, 0.5, 0, 0, 0.15),
    i(d(e, t, 1.18, 0.96, 2.82, 2.34), 38, 54, 70, 0.07, 0.85, 1, 0),
    i(d(e, t, 1.97, 0.96, 2.03, 2.34), 244, 244, 240, 0.5, 0, 0, 0.15),
    i(d(e, t, 1.18, 1.62, 2.82, 1.66), 244, 244, 240, 0.5, 0, 0, 0.15));
  const s = Bt(e * 14, 0.5, 56, 1, 9) * xt((0.9 - t) * 3 + 0.6) * d(e, t, 1.1, 0, 2.9, 0.9) * 0.5;
  i(s, 120, 114, 104, 0.95, 0, 0, 0.6);
}
function ke(e) {
  const t = e ? [176, 140, 108] : [150, 72, 56],
    n = te / 42;
  return (i, r, s, o, a) => {
    const l = Math.floor(r / n),
      h = i + (l & 1 ? 0.125 : 0),
      u = Math.floor(h / 0.25),
      y = h / 0.25 - u,
      p = Math.min(y, 1 - y) * 0.25,
      g = r / n - l,
      c = Math.min(g, 1 - g) * n,
      L = xt(1 - (Math.min(p, c) - 0.004) * 90),
      Q = 0.82 + 0.34 * ee(Ht(u, 16), Ht(l, 42), 5);
    (a(t[0] * Q, t[1] * Q, t[2] * Q, 0.88, 0, 0, 0.25),
      o(L, 176, 170, 158, 0.95, 0, 0, 0.1),
      o(d(i, r, 1, 2.35, 3, 2.5), 196, 190, 178, 0.8, 0, 0, 0.3),
      o(d(i, r, 1, 0.7, 3, 0.8), 120, 116, 110, 0.8, 0, 0, 0.1),
      o(d(i, r, 1.1, 0.8, 2.9, 2.35), 232, 230, 224, 0.5, 0, 0, 0.1),
      o(d(i, r, 1.17, 0.87, 2.83, 2.28), 36, 52, 66, 0.07, 0.85, 1, 0),
      o(d(i, r, 1.97, 0.87, 2.03, 2.28), 232, 230, 224, 0.5, 0, 0, 0.1));
  };
}
function ve(e) {
  return (t, n, i, r, s) => {
    const o = 0.86 + 0.14 * Math.cos((t * Math.PI * 2) / 0.25);
    (s(182 * o, 186 * o, 184 * o, 0.45, 0.35, 0, 0.9),
      r(d(t, n, 0, 1.6, 4, 1.63), 120, 122, 120, 0.5, 0.4, 0, 0.5),
      r(d(t, n, 0, 0, 4, 0.8), 150, 148, 142, 0.9, 0, 0, 0.3),
      e &&
        (r(d(t, n, 0.25, 1.95, 3.75, 2.85), 120, 124, 126, 0.5, 0.5, 0, 0),
        r(d(t, n, 0.3, 2, 3.7, 2.8), 44, 60, 74, 0.1, 0.8, 0.8, 0),
        r(d(t, n, 1.17, 2, 1.2, 2.8), 120, 124, 126, 0.5, 0.5, 0, 0),
        r(d(t, n, 2.37, 2, 2.4, 2.8), 120, 124, 126, 0.5, 0.5, 0, 0)));
  };
}
function dn(e, t, n, i, r) {
  (r(176, 174, 168, 0.9, 0, 0, 0.7),
    i(d(e, t, 0.45, 0.95, 3.55, 2.15), 70, 70, 70, 0.6, 0.2, 0, 0),
    i(d(e, t, 0.5, 1, 3.5, 2.1), 36, 52, 68, 0.08, 0.85, 1, 0),
    i(d(e, t, 1.97, 1, 2.03, 2.1), 70, 70, 70, 0.6, 0.2, 0, 0),
    i(d(e, t, 1.97, 0, 2.03, 3.2), 120, 118, 114, 0.9, 0, 0, 0.4),
    i(d(e, t, 0, 0, 4, 0.03), 120, 118, 114, 0.9, 0, 0, 0.4));
  const s = Bt(e * 12, 0.3, 48, 1, 4) * xt((t - 0.9) * 1.2) * (d(e, t, 0.4, 0, 0.6, 1) + d(e, t, 3.4, 0, 3.6, 1)) * 0.5;
  i(s, 90, 88, 84, 0.95, 0, 0, 0.7);
}
function Se(e) {
  const t = e ? [232, 228, 218] : [40, 42, 48];
  return (n, i, r, s, o) => {
    (o(200, 196, 188, 0.9, 0, 0, 1),
      s(d(n, i, 0, 2.5, 4, 3.15), t[0], t[1], t[2], 0.6, 0.1, 0, e ? 0.8 : 0),
      s(d(n, i, 0.05, 0.08, 3.95, 2.45), 120, 124, 128, 0.4, 0.8, 0, 0),
      s(d(n, i, 0.1, 0.14, 3.9, 2.4), 30, 46, 56, 0.05, 0.85, 1, 0));
    for (const a of [1.3, 2.7]) s(d(n, i, a - 0.03, 0.14, a + 0.03, 2.4), 120, 124, 128, 0.4, 0.8, 0, 0);
    (s(d(n, i, 1.7, 0.1, 2.3, 2.2), 120, 124, 128, 0.4, 0.8, 0, 0),
      s(d(n, i, 1.75, 0.14, 2.25, 2.15), 26, 40, 50, 0.05, 0.85, 1, 0));
  };
}
function yn(e, t, n, i, r) {
  (r(218, 212, 200, 0.92, 0, 0, 1),
    i(d(e, t, 0, 0, 4, 0.45), 150, 146, 138, 0.95, 0, 0, 0.5),
    i(d(e, t, 1.4, 0, 2.6, 2.3), 226, 224, 218, 0.6, 0, 0, 0.2),
    i(d(e, t, 1.5, 0, 2.5, 2.2), 84, 58, 42, 0.55, 0, 0, 0),
    i(d(e, t, 1.62, 1.2, 2.38, 2.05), 40, 56, 70, 0.07, 0.8, 0.6, 0));
}
function pn(e, t, n, i, r) {
  (r(214, 208, 196, 0.92, 0, 0, 1), i(d(e, t, 0.3, 0, 3.7, 2.4), 226, 224, 218, 0.6, 0, 0, 0.2));
  const s = 0.9 + 0.1 * Math.cos((t * Math.PI * 2) / 0.4);
  i(d(e, t, 0.38, 0, 3.62, 2.32), 196 * s, 198 * s, 196 * s, 0.5, 0.3, 0, 0.3);
}
const gn = [
  bt(0),
  bt(1),
  bt(2),
  bt(3),
  Fe(!1),
  Fe(!0),
  fn,
  un,
  xn,
  ke(!1),
  ke(!0),
  ve(!1),
  ve(!0),
  dn,
  Se(!1),
  Se(!0),
  yn,
  pn,
];
function mn() {
  const e = Xt,
    t = new Uint8Array(Yt * e * e * 4),
    n = new Uint8Array(Yt * e * e * 4),
    i = new Float32Array(7),
    r = (o, a, l, h, u, y, p) => {
      ((i[0] = o), (i[1] = a), (i[2] = l), (i[3] = h), (i[4] = u), (i[5] = y), (i[6] = p));
    },
    s = (o, a, l, h, u, y, p, g) => {
      o <= 0 ||
        ((i[0] += (a - i[0]) * o),
        (i[1] += (l - i[1]) * o),
        (i[2] += (h - i[2]) * o),
        (i[3] += (u - i[3]) * o),
        (i[4] += (y - i[4]) * o),
        (i[5] += (p - i[5]) * o),
        (i[6] += (g - i[6]) * o));
    };
  for (let o = 0; o < Yt; o++) {
    const a = gn[o];
    for (let l = 0; l < e; l++)
      for (let h = 0; h < e; h++) {
        const u = (h + 0.5) / we,
          y = (e - l - 0.5) / _e;
        a(u, y, i, s, r);
        const p = i[6],
          g =
            1 +
            p *
              (0.2 * (Bt(u * 9, y * 9, 36, 29, o) - 0.5) +
                0.1 * (ee(h, l, o + 77) - 0.5) -
                0.05 * Bt(u * 3, y * 0.7, 12, 2, o + 3)),
          c = ((o * e + l) * e + h) * 4;
        ((t[c] = Math.min(255, i[0] * g)),
          (t[c + 1] = Math.min(255, i[1] * g)),
          (t[c + 2] = Math.min(255, i[2] * g)),
          (t[c + 3] = 255),
          (n[c] = Math.round(xt(i[5]) * 255)),
          (n[c + 1] = Math.round(xt(i[3]) * 255)),
          (n[c + 2] = Math.round(xt(i[4]) * 255)),
          (n[c + 3] = Math.round(xt(p) * 255)));
      }
  }
  return { alb: t, dat: n };
}
const Mn = ['https://server.arcgisonline.com', 'https://services.arcgisonline.com'],
  wn = (e, t, n) => `${Mn[(t + n) & 1]}/ArcGIS/rest/services/World_Imagery/MapServer/tile/${e}/${n}/${t}`,
  Ae = {
    white: '#f2f0ea',
    black: '#3a3a3c',
    grey: '#9a9a9a',
    gray: '#9a9a9a',
    silver: '#bfc3c6',
    red: '#a8493c',
    brown: '#7a5640',
    beige: '#d8c9a8',
    cream: '#ece3c8',
    yellow: '#dcc46a',
    orange: '#d08a4a',
    tan: '#c8ad86',
    blue: '#6d8aa8',
    green: '#7c9470',
    maroon: '#7a3b36',
    pink: '#d9a7a0',
    lightgrey: '#c4c4c4',
    lightgray: '#c4c4c4',
    darkgrey: '#5e5e5e',
    darkgray: '#5e5e5e',
    gold: '#c9a54a',
    terracotta: '#b5654a',
  },
  ne = [
    [0.76, 0.74, 0.7],
    [0.86, 0.83, 0.76],
    [0.79, 0.7, 0.58],
    [0.68, 0.69, 0.7],
    [0.82, 0.78, 0.72],
    [0.62, 0.42, 0.34],
    [0.72, 0.72, 0.66],
  ],
  ie = [
    [0.56, 0.61, 0.66],
    [0.63, 0.67, 0.71],
    [0.49, 0.54, 0.59],
    [0.72, 0.73, 0.74],
  ],
  Ve = [
    [0.56, 0.31, 0.24],
    [0.45, 0.46, 0.48],
    [0.38, 0.4, 0.44],
    [0.58, 0.57, 0.54],
    [0.42, 0.34, 0.3],
  ];
function Ee(e) {
  if (typeof e != 'string') return null;
  ((e = e.trim().toLowerCase()), Ae[e] && (e = Ae[e]));
  let t = /^#([0-9a-f]{6})$/.exec(e);
  if (t) {
    const n = parseInt(t[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  if (((t = /^#([0-9a-f]{3})$/.exec(e)), t)) {
    const n = parseInt(t[1], 16);
    return [((n >> 8) & 15) / 15, ((n >> 4) & 15) / 15, (n & 15) / 15];
  }
  return null;
}
const jt = (e, t) => {
    let n = (Math.imul(e | 0, 374761393) + Math.imul(t | 0, 668265263)) | 0;
    return ((n = Math.imul(n ^ (n >>> 13), 1274126177)), ((n ^ (n >>> 16)) >>> 0) / 4294967296);
  },
  se = (e) => Math.pow(Math.min(1, Math.max(0, e)), 2.2),
  Pe = (e, t = 1) =>
    (Math.round(se(e[0] * t) * 255) << 16) | (Math.round(se(e[1] * t) * 255) << 8) | Math.round(se(e[2] * t) * 255),
  Le = (e, t, n) => [e[0] + (t[0] - e[0]) * n, e[1] + (t[1] - e[1]) * n, e[2] + (t[2] - e[2]) * n],
  It = 3.2,
  _n = {
    house: [1, 2],
    detached: [1, 2],
    semidetached_house: [2, 2],
    terrace: [2, 2],
    bungalow: [1, 1],
    residential: [2, 3],
    apartments: [4, 12],
    dormitory: [3, 6],
    hotel: [5, 14],
    commercial: [2, 5],
    office: [4, 10],
    retail: [1, 2],
    supermarket: [1, 1],
    industrial: [2, 3],
    warehouse: [2, 3],
    manufacture: [2, 3],
    garage: [1, 1],
    garages: [1, 1],
    shed: [1, 1],
    carport: [1, 1],
    roof: [1, 1],
    hut: [1, 1],
    cabin: [1, 1],
    school: [2, 3],
    university: [3, 5],
    college: [3, 4],
    hospital: [4, 8],
    church: [3, 5],
    cathedral: [6, 9],
    mosque: [2, 4],
    temple: [1, 3],
    civic: [2, 4],
    government: [3, 6],
    public: [2, 4],
    train_station: [2, 3],
    transportation: [2, 3],
    stadium: [5, 7],
    farm: [1, 2],
    farm_auxiliary: [1, 1],
    barn: [1, 2],
    greenhouse: [1, 1],
    service: [1, 1],
    kindergarten: [1, 2],
    parking: [3, 5],
  };
function Fn(e, t, n, i, r, s, o) {
  const a = _n[e];
  if (a) return (a[0] + Math.floor(o * (a[1] - a[0] + 0.999))) * It + 0.8;
  const l = r - n,
    h = s - i,
    u = Math.max(l, h) / Math.max(1, Math.min(l, h));
  return t > 4e3
    ? 8 + o * 6
    : u > 3.5 && t < 2500
      ? 2 * It + 1
      : (t < 60 ? 1 : t < 220 ? 1 + (o < 0.6 ? 1 : 0) : t < 900 ? 2 + (o < 0.4 ? 1 : 0) : 2 + Math.floor(o * 3)) * It +
        0.8;
}
const kn = {
    flat: 'flat',
    gabled: 'gabled',
    saltbox: 'gabled',
    gambrel: 'gabled',
    hipped: 'hipped',
    half_hipped: 'hipped',
    'half-hipped': 'hipped',
    mansard: 'hipped',
    side_hipped: 'hipped',
    pyramidal: 'pyramidal',
    skillion: 'skillion',
    dome: 'dome',
    onion: 'dome',
    round: 'dome',
    spherical: 'dome',
    butterfly: 'flat',
    sawtooth: 'flat',
  },
  vn = {
    glass: 0,
    brick: 9,
    concrete: 13,
    cement_block: 13,
    plaster: 8,
    stone: 8,
    wood: 6,
    metal: 11,
    steel: 11,
    timber_framing: 6,
  },
  Sn = {
    roof_tiles: [0.62, 0.33, 0.25],
    tile: [0.62, 0.33, 0.25],
    slate: [0.32, 0.34, 0.38],
    metal: [0.58, 0.6, 0.62],
    copper: [0.36, 0.55, 0.48],
    concrete: [0.66, 0.65, 0.63],
    tar_paper: [0.3, 0.3, 0.31],
    asphalt: [0.3, 0.3, 0.31],
    thatch: [0.55, 0.47, 0.32],
    glass: [0.6, 0.66, 0.7],
    grass: [0.36, 0.45, 0.28],
  };
function An(e) {
  let t = e.slice();
  for (let n = 0; n < 3; n++) {
    const i = t.length / 2;
    if (i <= 4) break;
    const r = [];
    for (let s = 0; s < i; s++) {
      const o = (s + i - 1) % i,
        a = (s + 1) % i,
        l = t[s * 2] - t[o * 2],
        h = t[s * 2 + 1] - t[o * 2 + 1],
        u = t[a * 2] - t[s * 2],
        y = t[a * 2 + 1] - t[s * 2 + 1],
        p = Math.hypot(l, h),
        g = Math.hypot(u, y);
      (p < 0.4 || g < 0.4 ? 0 : Math.abs(Math.atan2(l * y - h * u, l * u + h * y))) > 0.14 &&
        r.push(t[s * 2], t[s * 2 + 1]);
    }
    if (r.length < 6 || r.length === t.length) break;
    t = r;
  }
  return t;
}
function Vn(e) {
  if (e.length !== 8) return !1;
  for (let t = 0; t < 4; t++) {
    const n = (t + 3) % 4,
      i = (t + 1) % 4,
      r = e[n * 2] - e[t * 2],
      s = e[n * 2 + 1] - e[t * 2 + 1],
      o = e[i * 2] - e[t * 2],
      a = e[i * 2 + 1] - e[t * 2 + 1];
    if (Math.abs(r * o + s * a) / (Math.hypot(r, s) * Math.hypot(o, a) || 1) > 0.2) return !1;
  }
  return !0;
}
function Ce(e) {
  const t = e.length / 2;
  if (t < 3) return !1;
  for (let n = 0; n < t; n++) {
    const i = n * 2,
      r = ((n + 1) % t) * 2,
      s = ((n + 2) % t) * 2;
    if ((e[r] - e[i]) * (e[s + 1] - e[r + 1]) - (e[r + 1] - e[i + 1]) * (e[s] - e[r]) < -1e-6) return !1;
  }
  return !0;
}
class En {
  constructor() {
    ((this.cap = 65536),
      (this.n = 0),
      (this.pos = new Float32Array(this.cap * 3)),
      (this.nor = new Int8Array(this.cap * 3)),
      (this.col = new Uint8Array(this.cap * 3)),
      (this.uv = new Float32Array(this.cap * 2)),
      (this.fac = new Float32Array(this.cap * 4)),
      (this.cen = new Uint16Array(this.cap * 2)),
      (this.layer = 0),
      (this.glayer = 0),
      (this.seed = 0),
      (this.cu = 0),
      (this.cv = 0),
      (this.roof = !1));
  }
  style(t, n, i, r, s) {
    ((this.layer = t),
      (this.glayer = n),
      (this.seed = i),
      (this.cu = Math.round(r * 65535)),
      (this.cv = Math.round(s * 65535)));
  }
  grow() {
    this.cap *= 2;
    const t = new Float32Array(this.cap * 3);
    (t.set(this.pos), (this.pos = t));
    const n = new Int8Array(this.cap * 3);
    (n.set(this.nor), (this.nor = n));
    const i = new Uint8Array(this.cap * 3);
    (i.set(this.col), (this.col = i));
    const r = new Float32Array(this.cap * 2);
    (r.set(this.uv), (this.uv = r));
    const s = new Float32Array(this.cap * 4);
    (s.set(this.fac), (this.fac = s));
    const o = new Uint16Array(this.cap * 2);
    (o.set(this.cen), (this.cen = o));
  }
  tri(t, n, i, r, s, o, a, l, h, u, y, p, g, c, L, Q, Mt, ct, F, _, x) {
    let O = r - t,
      H = s - n,
      B = o - i,
      $ = a - t,
      M = l - n,
      et = h - i,
      K = H * et - B * M,
      G = B * $ - O * et,
      q = O * M - H * $;
    const st = Math.hypot(K, G, q);
    if (st < 1e-9) return;
    ((K /= st),
      (G /= st),
      (q /= st),
      K * u + G * y + q * p < 0 &&
        ((K = -K),
        (G = -G),
        (q = -q),
        ([r, a] = [a, r]),
        ([s, l] = [l, s]),
        ([o, h] = [h, o]),
        ([c, L] = [L, c]),
        ([ct, _] = [_, ct]),
        ([F, x] = [x, F])),
      this.n + 3 > this.cap && this.grow());
    const E = this.n * 3,
      P = this.pos,
      wt = this.nor,
      z = this.col;
    ((P[E] = t),
      (P[E + 1] = n),
      (P[E + 2] = i),
      (P[E + 3] = r),
      (P[E + 4] = s),
      (P[E + 5] = o),
      (P[E + 6] = a),
      (P[E + 7] = l),
      (P[E + 8] = h));
    const dt = Math.round(K * 127),
      b = Math.round(G * 127),
      ft = Math.round(q * 127);
    for (let S = 0; S < 3; S++) ((wt[E + S * 3] = dt), (wt[E + S * 3 + 1] = b), (wt[E + S * 3 + 2] = ft));
    ((z[E] = g >> 16),
      (z[E + 1] = (g >> 8) & 255),
      (z[E + 2] = g & 255),
      (z[E + 3] = c >> 16),
      (z[E + 4] = (c >> 8) & 255),
      (z[E + 5] = c & 255),
      (z[E + 6] = L >> 16),
      (z[E + 7] = (L >> 8) & 255),
      (z[E + 8] = L & 255));
    const Y = this.n * 2,
      W = this.uv,
      rt = this.fac,
      yt = this.cen,
      I = this.n * 4,
      pt = this.roof ? -1 : this.layer;
    ((W[Y] = Q), (W[Y + 1] = Mt), (W[Y + 2] = ct), (W[Y + 3] = F), (W[Y + 4] = _), (W[Y + 5] = x));
    for (let S = 0; S < 3; S++)
      ((rt[I + S * 4] = pt),
        (rt[I + S * 4 + 1] = this.glayer),
        (rt[I + S * 4 + 2] = this.seed),
        (rt[I + S * 4 + 3] = P[E + S * 3 + 1]),
        (yt[Y + S * 2] = this.cu),
        (yt[Y + S * 2 + 1] = this.cv));
    this.n += 3;
  }
}
function Be(e) {
  let t = 0;
  for (let n = 0, i = e.length - 2; n < e.length; i = n, n += 2) t += e[i] * e[n + 1] - e[n] * e[i + 1];
  return t / 2;
}
function Pn(e) {
  const t = new Array(e.length);
  for (let n = 0, i = e.length - 2; n < e.length; n += 2, i -= 2) ((t[n] = e[i]), (t[n + 1] = e[i + 1]));
  return t;
}
function Ln({ buf: e, W: t, H: n, runways: i, maxTris: r, src: s }) {
  const o = new VectorTile(new PbfReader(new Uint8Array(e))),
    a = s === 'overture',
    l = a ? o.layers.building_part : null,
    h = [l, o.layers.building].filter(Boolean);
  if (!h.length) return null;
  const u = new Set();
  if (l) for (let x = 0; x < l.length; x++) u.add(l.feature(x).properties.building_id);
  const y = [];
  let p = 0;
  for (const x of h) {
    const O = x.extent || 4096,
      H = x === l;
    p += x.length;
    for (let B = 0; B < x.length; B++) {
      const $ = x.feature(B),
        M = $.properties;
      if ($.type !== 3 || (a ? M.is_underground || (!H && u.has(M.id)) : M.hide_3d)) continue;
      const et = $.loadGeometry();
      for (const K of classifyRings(et)) {
        const G = [];
        let q = 1e9,
          st = 1e9,
          E = -1e9,
          P = -1e9,
          wt = !0;
        for (let S = 0; S < K.length; S++) {
          const v = K[S],
            X = [];
          for (
            let w = 0;
            w < v.length && !(w === v.length - 1 && v.length > 1 && v[w].x === v[0].x && v[w].y === v[0].y);
            w++
          ) {
            const gt = (v[w].x / O - 0.5) * t,
              lt = -(v[w].y / O - 0.5) * n;
            (X.length >= 2 && X[X.length - 2] === gt && X[X.length - 1] === lt) ||
              (X.push(gt, lt),
              S === 0 && (gt < q && (q = gt), gt > E && (E = gt), lt < st && (st = lt), lt > P && (P = lt)));
          }
          if (X.length < 6) {
            S === 0 && (wt = !1);
            continue;
          }
          const tt = Be(X);
          G.push((S === 0) == tt > 0 ? X : Pn(X));
        }
        if (!wt || !G.length) continue;
        const z = (q + E) / 2,
          dt = (st + P) / 2;
        if (Math.abs(z) > t / 2 || Math.abs(dt) > n / 2) continue;
        const b = Be(G[0]);
        if (b < 5) continue;
        let ft = !1;
        for (const S of i) {
          const v = z - S[0],
            X = dt - S[1];
          if (Math.abs(v * S[2] + X * S[3]) < S[4] && Math.abs(v * S[3] - X * S[2]) < S[5]) {
            ft = !0;
            break;
          }
        }
        if (ft) continue;
        const Y = jt(Math.round(z * 3), Math.round(dt * 3) + 7);
        let W,
          rt,
          yt = !1,
          I = null;
        if (
          (a
            ? ((rt = +M.min_height > 0 ? +M.min_height : +M.min_floor > 0 ? M.min_floor * It : 0),
              (W =
                +M.height > 0
                  ? +M.height
                  : +M.num_floors > 0
                    ? M.num_floors * It + 0.8 + (+M.roof_height > 0 ? +M.roof_height : 0)
                    : 0),
              W || ((W = Fn(M.class || M.subtype || '', b, q, st, E, P, Y)), (yt = !0)),
              (I = {
                shape: M.roof_shape,
                roofH: +M.roof_height > 0 ? +M.roof_height : 0,
                orient: M.roof_orientation,
                roofColour: M.roof_color,
                facMat: M.facade_material,
                roofMat: M.roof_material,
                cls: M.class || M.subtype || '',
              }))
            : ((W = +M.render_height > 0 ? +M.render_height : 0),
              (rt = +M.render_min_height > 0 ? +M.render_min_height : 0)),
          W > 0 || (W = 3),
          W - rt < 0.5)
        )
          continue;
        let pt = 0;
        for (const S of G) pt += S.length + S.length / 2;
        y.push({
          out: G,
          area: b,
          h: W,
          mh: rt,
          colour: a ? M.facade_color : M.colour,
          ce: z,
          cn: dt,
          minE: q,
          minN: st,
          maxE: E,
          maxN: P,
          tris: pt,
          ov: a,
          est: yt,
          info: I,
          rnd: Y,
        });
      }
    }
  }
  let g = 0;
  for (const x of y) g += x.tris;
  if (g > r) {
    y.sort((H, B) => B.area - H.area);
    let x = 0,
      O = 0;
    for (; O < y.length && x + y[O].tris <= r;) x += y[O++].tris;
    y.length = O;
  }
  const c = new En(),
    L = y.length,
    Q = new Uint32Array(L),
    Mt = new Uint32Array(L),
    ct = new Float32Array(L * 6),
    F = (x) => x / t + 0.5,
    _ = (x) => 0.5 - x / n;
  return (
    y.forEach((x, O) => {
      Q[O] = c.n;
      const { out: H, h: B, mh: $ } = x,
        M = H[0],
        et = jt(Math.round(x.ce * 7), Math.round(x.cn * 7)),
        K = jt(Math.round(x.cn * 5), Math.round(x.ce * 3)),
        G = jt(Math.round(x.ce) + 13, Math.round(x.cn * 11));
      let [q, st] = hn(B, x.area, et, K, G);
      const E = x.info ? vn[String(x.info.facMat || '').toLowerCase()] : void 0;
      (E !== void 0 && (q = E + (E <= 3 ? Math.floor(K * 4) % 4 : 0)), $ > 0 && (st = q));
      let P = Ee(x.colour);
      if (P) {
        P = P.map((D) => 0.12 + 0.88 * D);
        const f = P[0] * 0.3 + P[1] * 0.59 + P[2] * 0.11;
        P = P.map((D) => f + (D - f) * 0.88);
      } else
        q <= 3 ? (P = ie[Math.floor(et * ie.length) % ie.length]) : (P = ne[Math.floor(et * ne.length) % ne.length]);
      const wt = 0.93 + 0.14 * K;
      P = P.map((f) => f * wt);
      let z;
      if (B > 25) z = Le(P, [0.5, 0.5, 0.52], 0.6).map((f) => f * 0.92);
      else {
        const f = Ve[Math.floor(K * 97) % Ve.length];
        z = Le(P, f, 0.65);
      }
      const dt = x.info && (Ee(x.info.roofColour) || Sn[String(x.info.roofMat || '').toLowerCase()]);
      dt && (z = dt);
      const b = Pe(P),
        ft = Pe(z),
        Y = $ > 0 ? $ : -3,
        W = $ > 0 ? $ : 0;
      let rt = 0,
        yt = 0;
      for (let f = 0; f < M.length; f += 2) ((rt += M[f]), (yt += M[f + 1]));
      ((rt /= M.length / 2), (yt /= M.length / 2), c.style(q, st, et, F(rt), _(yt)));
      const I = H.length === 1 ? An(M) : M,
        pt = H.length === 1 && Vn(I),
        S = pt ? Math.min(Math.hypot(I[2] - I[0], I[3] - I[1]), Math.hypot(I[4] - I[2], I[5] - I[3])) : 0;
      let v = 'flat';
      const X = x.info && typeof x.info.shape == 'string' ? x.info.shape.toLowerCase() : '';
      ($ > 0 && !X
        ? (v = 'flat')
        : X
          ? (v = kn[X] || 'flat')
          : pt &&
            B < 15 &&
            x.area > 30 &&
            x.area < (x.ov ? 2500 : 260) &&
            (x.ov
              ? !/^(industrial|warehouse|commercial|retail|office|supermarket|parking)/.test(x.info.cls)
              : et > 0.3) &&
            (v = x.ov && x.rnd < 0.45 ? 'hipped' : 'gabled'),
        (v === 'gabled' || v === 'hipped' || v === 'skillion') && !pt && (v = Ce(I) ? 'pyramidal' : 'flat'),
        (v === 'pyramidal' || v === 'dome') && (H.length > 1 || !Ce(I)) && (v = 'flat'));
      let tt = 0;
      if (v !== 'flat') {
        const f = pt ? S : Math.sqrt(x.area);
        ((tt =
          x.info && x.info.roofH
            ? x.info.roofH
            : v === 'dome'
              ? f * 0.45
              : v === 'skillion'
                ? Math.min(2.5, f * 0.18)
                : Math.min(4.5, f * (v === 'pyramidal' ? 0.35 : 0.3))),
          (tt = Math.min(tt, Math.max(1, (B - $) * 0.6))));
      }
      const w = Math.min(B, Math.max($ + 2.2, B - tt));
      ((tt = Math.min(tt, B - w)), tt < 0.3 && ((tt = 0), (v = 'flat')));
      const gt = Math.max(1, Math.round((w - W) / 3.3)),
        lt = (w - W) / gt,
        oe = (Y - W) / lt,
        ht = gt,
        ae = (f) => (f >= Zt * 0.75 ? Math.max(1, Math.round(f / Zt)) : f / Zt);
      c.roof = !1;
      let Tt = 0;
      for (const f of H) {
        const D = f.length / 2;
        for (let T = 0; T < D; T++) {
          const C = (T + 1) % D,
            A = f[T * 2],
            k = f[T * 2 + 1],
            m = f[C * 2],
            V = f[C * 2 + 1],
            Z = m - A,
            N = V - k,
            J = Math.hypot(Z, N);
          if (J < 0.05) continue;
          const _t = N / J,
            ot = Z / J,
            at = Tt + ae(J);
          (c.tri(A, Y, -k, m, Y, -V, m, w, -V, _t, 0, ot, b, b, b, Tt, oe, at, oe, at, ht),
            c.tri(A, Y, -k, m, w, -V, A, w, -k, _t, 0, ot, b, b, b, Tt, oe, at, ht, Tt, ht),
            (Tt = at));
        }
      }
      const U = w + tt,
        nt = (f, D, T, C, A, k) =>
          c.tri(
            f[0],
            D,
            -f[1],
            T[0],
            C,
            -T[1],
            A[0],
            k,
            -A[1],
            0,
            1,
            0,
            ft,
            ft,
            ft,
            F(f[0]),
            _(f[1]),
            F(T[0]),
            _(T[1]),
            F(A[0]),
            _(A[1]),
          ),
        Nt = (f, D, T, C) => {
          c.roof = !1;
          const A = D[0] - f[0],
            k = D[1] - f[1],
            m = Math.hypot(A, k) || 1,
            V = ae(m);
          (c.tri(
            f[0],
            w,
            -f[1],
            D[0],
            w,
            -D[1],
            T[0],
            C,
            -T[1],
            k / m,
            0,
            A / m,
            b,
            b,
            b,
            0,
            ht,
            V,
            ht,
            V / 2,
            ht + (C - w) / lt,
          ),
            (c.roof = !0));
        };
      if (v === 'gabled' || v === 'hipped' || v === 'skillion') {
        const f = [0, 1, 2, 3].map((J) => [I[J * 2], I[J * 2 + 1]]),
          D = Math.hypot(f[1][0] - f[0][0], f[1][1] - f[0][1]),
          T = Math.hypot(f[2][0] - f[1][0], f[2][1] - f[1][1]);
        let C = D >= T ? 0 : 1;
        x.info && x.info.orient === 'across' && (C = 1 - C);
        const A = f[C],
          k = f[(C + 1) % 4],
          m = f[(C + 2) % 4],
          V = f[(C + 3) % 4],
          Z = [(k[0] + m[0]) / 2, (k[1] + m[1]) / 2],
          N = [(V[0] + A[0]) / 2, (V[1] + A[1]) / 2];
        if (((c.roof = !0), v === 'gabled'))
          (Nt(k, m, Z, U),
            Nt(V, A, N, U),
            nt(A, w, k, w, Z, U),
            nt(A, w, Z, U, N, U),
            nt(m, w, V, w, N, U),
            nt(m, w, N, U, Z, U));
        else if (v === 'hipped') {
          const J = Math.hypot(k[0] - A[0], k[1] - A[1]),
            _t = Math.hypot(m[0] - k[0], m[1] - k[1]),
            ot = Math.min(0.5, _t / 2 / Math.max(J, 0.001)),
            at = [N[0] + (Z[0] - N[0]) * ot, N[1] + (Z[1] - N[1]) * ot],
            $t = [Z[0] + (N[0] - Z[0]) * ot, Z[1] + (N[1] - Z[1]) * ot];
          (nt(A, w, k, w, $t, U),
            nt(A, w, $t, U, at, U),
            nt(m, w, V, w, at, U),
            nt(m, w, at, U, $t, U),
            nt(k, w, m, w, $t, U),
            nt(V, w, A, w, at, U));
        } else {
          (Nt(k, m, m, U), Nt(V, A, V, U), (c.roof = !1));
          {
            const J = V[0] - m[0],
              _t = V[1] - m[1],
              ot = Math.hypot(J, _t) || 1,
              at = ae(ot);
            (c.tri(
              m[0],
              w,
              -m[1],
              V[0],
              w,
              -V[1],
              V[0],
              U,
              -V[1],
              _t / ot,
              0,
              J / ot,
              b,
              b,
              b,
              0,
              ht,
              at,
              ht,
              at,
              ht + tt / lt,
            ),
              c.tri(
                m[0],
                w,
                -m[1],
                V[0],
                U,
                -V[1],
                m[0],
                U,
                -m[1],
                _t / ot,
                0,
                J / ot,
                b,
                b,
                b,
                0,
                ht,
                at,
                ht + tt / lt,
                0,
                ht + tt / lt,
              ));
          }
          ((c.roof = !0), nt(A, w, k, w, m, U), nt(A, w, m, U, V, U));
        }
      } else if (v === 'pyramidal' || v === 'dome') {
        c.roof = !0;
        const f = I.length / 2;
        let D = 0,
          T = 0;
        for (let k = 0; k < f; k++) ((D += I[k * 2]), (T += I[k * 2 + 1]));
        ((D /= f), (T /= f));
        const C = v === 'dome' ? 4 : 1,
          A = (k) => {
            const m = k / C,
              V = v === 'dome' ? Math.cos((m * Math.PI) / 2) : 1 - m,
              Z = w + tt * (v === 'dome' ? Math.sin((m * Math.PI) / 2) : m),
              N = [];
            for (let J = 0; J < f; J++) N.push([D + (I[J * 2] - D) * V, T + (I[J * 2 + 1] - T) * V]);
            return { pts: N, y: Z };
          };
        for (let k = 0; k < C; k++) {
          const m = A(k),
            V = A(k + 1);
          for (let Z = 0; Z < f; Z++) {
            const N = (Z + 1) % f;
            (nt(m.pts[Z], m.y, m.pts[N], m.y, V.pts[N], V.y),
              k < C - 1 && nt(m.pts[Z], m.y, V.pts[N], V.y, V.pts[Z], V.y));
          }
        }
      } else {
        c.roof = !0;
        const f = [],
          D = [];
        for (let C = 0; C < H.length; C++) {
          C && D.push(f.length / 2);
          for (const A of H[C]) f.push(A);
        }
        const T = earcut(f, D, 2);
        for (let C = 0; C < T.length; C += 3) {
          const A = T[C] * 2,
            k = T[C + 1] * 2,
            m = T[C + 2] * 2;
          c.tri(
            f[A],
            w,
            -f[A + 1],
            f[k],
            w,
            -f[k + 1],
            f[m],
            w,
            -f[m + 1],
            0,
            1,
            0,
            ft,
            ft,
            ft,
            F(f[A]),
            _(f[A + 1]),
            F(f[k]),
            _(f[k + 1]),
            F(f[m]),
            _(f[m + 1]),
          );
        }
      }
      ((Mt[O] = c.n - Q[O]), ct.set([x.ce, x.cn, x.minE, x.minN, x.maxE, x.maxN], O * 6));
    }),
    {
      pos: c.pos.slice(0, c.n * 3),
      nor: c.nor.slice(0, c.n * 3),
      col: c.col.slice(0, c.n * 3),
      uv: c.uv.slice(0, c.n * 2),
      fac: c.fac.slice(0, c.n * 4),
      cen: c.cen.slice(0, c.n * 2),
      bStart: Q,
      bCount: Mt,
      bInfo: ct,
      verts: c.n,
      count: L,
      features: p,
    }
  );
}
const Cn = wn,
  Bn = 2521,
  In = 3,
  mt = 256,
  re = new Map();
async function Tn({ id: e, x14: t, y14: n, z: i }) {
  const r = new AbortController();
  re.set(e, r);
  const s = 1 << (i - 14),
    o = s * mt,
    a = t * s,
    l = n * s,
    h = new OffscreenCanvas(o, o),
    u = h.getContext('2d');
  ((u.imageSmoothingQuality = 'high'), (u.fillStyle = '#6f6a62'), u.fillRect(0, 0, o, o));
  const y = new Map(),
    p = setTimeout(() => r.abort(), 6e4),
    g = async (F, _, x) => {
      try {
        const O = await fetch(Cn(F, _, x), { mode: 'cors', signal: r.signal });
        if (!O.ok) return null;
        const H = await O.arrayBuffer();
        return H.byteLength === Bn ? null : await createImageBitmap(new Blob([H], { type: 'image/jpeg' }));
      } catch {
        return null;
      }
    },
    c = [];
  for (let F = 0; F < s; F++) for (let _ = 0; _ < s; _++) c.push(_, F);
  let L = 0,
    Q = 0;
  const Mt = async () => {
    for (; !r.signal.aborted && L < c.length;) {
      const F = c[L++],
        _ = c[L++],
        x = a + F,
        O = l + _,
        H = await g(i, x, O);
      if (H) {
        (u.drawImage(H, F * mt, _ * mt), H.close(), Q++);
        continue;
      }
      for (let B = 1; B <= 3; B++) {
        const $ = x >> B,
          M = O >> B,
          et = `${i - B}/${$}/${M}`;
        y.has(et) || y.set(et, g(i - B, $, M));
        const K = await y.get(et);
        if (K) {
          const G = mt >> B;
          (u.drawImage(K, (x - ($ << B)) * G, (O - (M << B)) * G, G, G, F * mt, _ * mt, mt, mt), Q++);
          break;
        }
      }
    }
  };
  (await Promise.all(Array.from({ length: In }, Mt)), clearTimeout(p), re.delete(e));
  for (const F of y.values()) F.then((_) => _ && _.close());
  if (r.signal.aborted) {
    self.postMessage({ type: 'atlas', id: e, aborted: !0 });
    return;
  }
  if (Q < s * s * 0.5) {
    self.postMessage({ type: 'atlas', id: e, none: !0 });
    return;
  }
  const ct = h.transferToImageBitmap();
  self.postMessage({ type: 'atlas', id: e, bitmap: ct, z: i, ok: Q, total: s * s }, [ct]);
}
self.onmessage = (e) => {
  const t = e.data;
  if (t.type === 'atlas') {
    Tn(t);
    return;
  }
  if (t.type === 'abort') {
    const s = re.get(t.id);
    s && s.abort();
    return;
  }
  if (t.type === 'facades') {
    const s = mn();
    self.postMessage({ type: 'facades', alb: s.alb, dat: s.dat }, [s.alb.buffer, s.dat.buffer]);
    return;
  }
  const { id: n, ...i } = t,
    r = performance.now();
  try {
    const s = Ln(i);
    if (!s) {
      self.postMessage({ id: n, empty: !0, ms: performance.now() - r });
      return;
    }
    self.postMessage({ id: n, ...s, ms: performance.now() - r }, [
      s.pos.buffer,
      s.nor.buffer,
      s.col.buffer,
      s.uv.buffer,
      s.fac.buffer,
      s.cen.buffer,
      s.bStart.buffer,
      s.bCount.buffer,
      s.bInfo.buffer,
    ]);
  } catch (s) {
    self.postMessage({ id: n, error: String((s && s.message) || s) });
  }
};
