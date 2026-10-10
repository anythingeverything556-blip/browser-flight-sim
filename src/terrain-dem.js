import { D2R, tx2lon, ty2lat } from './geo.js';

const hb = [
    [29.5, 32.9, 35.2, 35.8, -430],
    [35.5, 36.9, -117.4, -116.4, -86],
    [32.5, 33.6, -116.3, -115.4, -70],
    [36.5, 47.5, 46.5, 55, -28],
    [28.5, 30.7, 25.5, 29.5, -133],
    [42.4, 43.2, 88.5, 90.5, -154],
    [13.5, 14.6, 40, 41, -125],
  ],
  El = (s, t) => (s < 0 ? 0 : s >= t ? t - 1 : s),
  Rl = new Float64Array(24);
function Op(s, t) {
  for (let e = 1; e < t; e++) {
    const n = s[e];
    let i = e - 1;
    for (; i >= 0 && s[i] > n;) ((s[i + 1] = s[i]), i--);
    s[i + 1] = n;
  }
  return t & 1 ? s[t >> 1] : (s[(t >> 1) - 1] + s[t >> 1]) / 2;
}
function ub(s, t) {
  let e = 0;
  for (let n = 0; n < s.length; n++) s[n] !== s[n] && e++;
  if (e) {
    if (e === s.length) {
      s.fill(0);
      return;
    }
    for (let n = 0; e > 0 && n < 2 * t; n++) {
      const i = s.slice();
      for (let r = 0; r < t; r++)
        for (let a = 0; a < t; a++) {
          const l = r * t + a;
          if (i[l] === i[l]) continue;
          let h = 0,
            u = 0;
          for (let f = -1; f <= 1; f++)
            for (let d = -1; d <= 1; d++) {
              const p = r + f,
                v = a + d;
              if (p < 0 || v < 0 || p >= t || v >= t) continue;
              const y = i[p * t + v];
              y === y && ((h += y), u++);
            }
          u && ((s[l] = h / u), e--);
        }
    }
    for (let n = 0; n < s.length; n++) s[n] !== s[n] && (s[n] = 0);
  }
}
function db(s, t, e) {
  const n = s.slice(),
    i = 0.45 * e + 3;
  for (let l = 0; l < t; l++)
    for (let h = 0; h < t; h++) {
      const u = l * t + h,
        f = n[u];
      let d = -1e9,
        p = 1e9,
        v = 0;
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++) {
          if (!y && !x) continue;
          const g = n[El(l + y, t) * t + El(h + x, t)];
          ((Rl[v++] = g), g > d && (d = g), g < p && (p = g));
        }
      (f > d + i || f < p - i) && (s[u] = Op(Rl, 8));
    }
  if (e > 45) return;
  const r = s.slice(),
    a = 1.6 * e + 8;
  for (let l = 0; l < t; l++)
    for (let h = 0; h < t; h++) {
      const u = l * t + h,
        f = r[u];
      let d = -1e9,
        p = 1e9,
        v = 0;
      for (let y = -2; y <= 2; y++)
        for (let x = -2; x <= 2; x++) {
          if (y > -2 && y < 2 && x > -2 && x < 2) continue;
          const g = r[El(l + y, t) * t + El(h + x, t)];
          ((Rl[v++] = g), g > d && (d = g), g < p && (p = g));
        }
      (f > d + a || f < p - a) && (s[u] = Op(Rl, 16));
    }
}
function fb(s, t, e) {
  const n = new Float32Array(s.length);
  for (let i = 0; i < e; i++) {
    for (let r = 0; r < t; r++)
      for (let a = 0; a < t; a++) {
        const l = r * t + a;
        n[l] = (s[l - (a > 0 ? 1 : 0)] + 2 * s[l] + s[l + (a < t - 1 ? 1 : 0)]) * 0.25;
      }
    for (let r = 0; r < t; r++)
      for (let a = 0; a < t; a++) {
        const l = r * t + a;
        s[l] = (n[l - (r > 0 ? t : 0)] + 2 * n[l] + n[l + (r < t - 1 ? t : 0)]) * 0.25;
      }
  }
}

// Some Terrarium tiles (mostly mountain terrain outside the US and Europe) carry corrupt rows or columns, whole or partial, that
// sit thousands of metres off; meshed, they became long thin trenches and walls. The generator's resampling can split one bad
// source line over adjacent lines (one fully bad, its neighbour partly), so bands of up to MAX_W lines are looked for. A band is
// corrupt where its interior departs from the straight bridge between the two bounding lines by more than T while the terrain
// either side of it is smooth: the slopes leaving and entering the band match, and the bridge follows them (so steep but smooth
// ground still qualifies). A real ridge or trench has sloping flanks that turn across it; a corrupt line has none. Several-line
// bands must be far off (8T): a ledge inside a steep face can pass the slope tests, but corrupt lines sit kilometres out. The band
// is rebuilt as that bridge where this holds over a long run of pixels.
const MIN_RUN = 14, MAX_GAP = 2, MAX_W = 3;
export const demStats = { lines: 0 };
function repairLines(H, t, mpp) {
  const T = Math.max(30, 4 * mpp);
  for (let axis = 0; axis < 2; axis++) {
    const at = axis ? (a, b) => b * t + a : (a, b) => a * t + b;
    for (let w = 1; w <= MAX_W; w++) {
      const off = w > 1 ? 8 * T : T;
      for (let a = 2; a + w < t - 1; a++) {
        const lo = a - 1, hi = a + w;
        let start = -1, last = -1;
        for (let b = 0; b <= t; b++) {
          let hit = false;
          if (b < t) {
            const L = H[at(lo, b)], R = H[at(hi, b)], sL = L - H[at(lo - 1, b)], sR = H[at(hi + 1, b)] - R;
            if (Math.abs(sL - sR) <= T && Math.abs(R - L - 0.5 * (w + 1) * (sL + sR)) <= 2 * T) {
              for (let i = 0; i < w && !hit; i++) hit = Math.abs(H[at(a + i, b)] - (L + (R - L) * (i + 1) / (w + 1))) > off;
            }
          }
          if (hit) {
            if (start < 0) start = b;
            last = b;
          }
          if (start >= 0 && (b === t || (!hit && b - last > MAX_GAP))) {
            if (last - start + 1 >= MIN_RUN) {
              for (let c = start; c <= last; c++) {
                const L = H[at(lo, c)], R = H[at(hi, c)];
                for (let i = 0; i < w; i++) H[at(a + i, c)] = L + (R - L) * (i + 1) / (w + 1);
              }
              demStats.lines++;
            }
            start = -1;
          }
        }
      }
    }
  }
}
function terrariumToHeights(s, t, e, n, i) {
  const r = new Float32Array(t * t),
    a = ty2lat(i, e),
    l = ty2lat(i + 1, e),
    h = tx2lon(n, e),
    u = tx2lon(n + 1, e),
    f = hb.filter((y) => y[0] < a && y[1] > l && y[2] < u && y[3] > h),
    d = new Float64Array(f.length ? t : 0),
    p = new Float64Array(f.length ? t : 0);
  for (let y = 0; y < d.length; y++) ((d[y] = ty2lat(i + (y + 0.5) / t, e)), (p[y] = tx2lon(n + (y + 0.5) / t, e)));
  for (let y = 0, x = 0, g = 0; y < t; y++)
    for (let _ = 0; _ < t; _++, x++, g += 4) {
      let w = s[g] * 256 + s[g + 1] + s[g + 2] / 256 - 32768;
      if (s[g + 3] < 250 || w < -12e3 || w > 9e3) {
        r[x] = NaN;
        continue;
      }
      if (w < 0) {
        let b = 0;
        for (let S = 0; S < f.length; S++) {
          const E = f[S];
          d[y] > E[0] && d[y] < E[1] && p[_] > E[2] && p[_] < E[3] && E[4] < b && (b = E[4]);
        }
        w < b && (w = b);
      }
      r[x] = w;
    }
  ub(r, t);
  const v = (40075016686e-3 * Math.cos(ty2lat(i + 0.5, e) * D2R)) / (t * (1 << e));
  repairLines(r, t, v);
  return (db(r, t, v), fb(r, t, v < 25 ? 2 : v < 90 ? 1 : 0), r);
}

export { terrariumToHeights };
