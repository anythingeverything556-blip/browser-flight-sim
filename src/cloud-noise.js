// Procedural 3D noise for the volumetric clouds: tiling Worley (cellular) and value noise, blended into a 64^3 shape volume and a 32^3 detail
// volume. Pure arithmetic, so it runs in a Web Worker (cloud-noise-worker.js) and never blocks the first frame that shows clouds.
function W0(s) {
  return () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 4294967296);
}
function ra(s, t, e) {
  const n = W0(e),
    i = new Float32Array(t ** 3 * 3).map(() => n()),
    r = new Float32Array(s ** 3),
    a = (l) => ((l % t) + t) % t;
  for (let l = 0, h = 0; l < s; l++)
    for (let u = 0; u < s; u++)
      for (let f = 0; f < s; f++, h++) {
        const d = ((f + 0.5) / s) * t,
          p = ((u + 0.5) / s) * t,
          v = ((l + 0.5) / s) * t,
          y = Math.floor(d),
          x = Math.floor(p),
          g = Math.floor(v);
        let _ = 9;
        for (let w = -1; w <= 1; w++)
          for (let b = -1; b <= 1; b++)
            for (let S = -1; S <= 1; S++) {
              const E = (a(g + w) * t * t + a(x + b) * t + a(y + S)) * 3,
                A = y + S + i[E] - d,
                D = x + b + i[E + 1] - p,
                N = g + w + i[E + 2] - v,
                R = A * A + D * D + N * N;
              R < _ && (_ = R);
            }
        r[h] = 1 - Math.min(1, Math.sqrt(_));
      }
  return r;
}
function wm(s, t, e) {
  const n = W0(e),
    i = new Float32Array(t ** 3).map(() => n()),
    r = new Float32Array(s ** 3),
    a = (h, u, f) => i[(((f % t) + t) % t) * t * t + (((u % t) + t) % t) * t + (((h % t) + t) % t)],
    l = (h) => h * h * (3 - 2 * h);
  for (let h = 0, u = 0; h < s; h++)
    for (let f = 0; f < s; f++)
      for (let d = 0; d < s; d++, u++) {
        const p = (d / s) * t,
          v = (f / s) * t,
          y = (h / s) * t,
          x = Math.floor(p),
          g = Math.floor(v),
          _ = Math.floor(y),
          w = l(p - x),
          b = l(v - g),
          S = l(y - _),
          E = a(x, g, _) + (a(x + 1, g, _) - a(x, g, _)) * w,
          A = a(x, g + 1, _) + (a(x + 1, g + 1, _) - a(x, g + 1, _)) * w,
          D = a(x, g, _ + 1) + (a(x + 1, g, _ + 1) - a(x, g, _ + 1)) * w,
          N = a(x, g + 1, _ + 1) + (a(x + 1, g + 1, _ + 1) - a(x, g + 1, _ + 1)) * w;
        r[u] = E + (A - E) * b + (D + (N - D) * b - (E + (A - E) * b)) * S;
      }
  return r;
}
function bmData(s, t) {
  const e = new Float32Array(s ** 3);
  for (const [l, h] of t) for (let u = 0; u < e.length; u++) e[u] += l[u] * h;
  let n = 1e9,
    i = -1e9;
  for (const l of e) (l < n && (n = l), l > i && (i = l));
  const r = new Uint8Array(e.length);
  for (let l = 0; l < e.length; l++) r[l] = Math.round(((e[l] - n) / (i - n)) * 255);
  return r;
}

export function makeCloudNoise() {
  return {
    shape: bmData(64, [[ra(64, 4, 11), 0.45], [ra(64, 8, 23), 0.25], [wm(64, 8, 5), 0.2], [wm(64, 16, 9), 0.1]]),
    detail: bmData(32, [[ra(32, 4, 31), 0.55], [ra(32, 8, 41), 0.3], [ra(32, 16, 53), 0.15]]),
  };
}
