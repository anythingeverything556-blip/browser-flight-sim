import * as THREE from 'three';

// Weathering for the cockpit surfaces, done in the shader so the model needs no UV maps: riveted panel seams, scuffed bare metal,
// rust bleeding out of the seams and general grime, projected along whichever axis the surface faces. The look follows photographs of
// the real cockpit: slate blue-grey paint, paler worn metal, orange rust spots.
const VERT_DECL = 'varying vec3 vWP; varying vec3 vWN;\n';
const FRAG_DECL = `
varying vec3 vWP; varying vec3 vWN;
float wh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }
float wf(vec2 p) { return 0.5 * wn(p) + 0.3 * wn(p * 2.1 + 7.3) + 0.2 * wn(p * 4.3 + 3.1); }
float wearRough = 0.6;
vec3 wearPaint(vec3 base, vec3 P, vec3 N, float amount, float rustAmt) {
  vec3 a = abs(N);
  vec2 uv = (a.x >= a.y && a.x >= a.z) ? P.yz : (a.y >= a.z ? P.xz : P.xy);
  vec2 cs = vec2(0.42, 0.28) * (0.8 + 0.5 * wh(floor(uv / vec2(1.3, 1.1))));
  vec2 q = uv / cs, ci = floor(q), f = fract(q);
  float dx = min(f.x, 1.0 - f.x) * cs.x, dy = min(f.y, 1.0 - f.y) * cs.y, ed = min(dx, dy);
  float seam = 1.0 - smoothstep(0.0007, 0.0021, ed);
  float t = dx < dy ? uv.y : uv.x;
  float rv = length(vec2(ed - 0.012, (fract(t / 0.042) - 0.5) * 0.042));
  float rivet = (1.0 - smoothstep(0.0014, 0.0026, rv)) * (1.0 - smoothstep(0.018, 0.024, ed));
  vec3 c = base * (1.0 + (wh(ci) - 0.5) * 0.22);
  c *= 0.82 + 0.28 * wf(uv * 7.0 + 3.0);                                      // grime
  float scuff = smoothstep(0.80, 0.90, wf(uv * 34.0 + 11.0)) * smoothstep(0.45, 0.72, wf(uv * 3.0 + 5.0));
  c = mix(c, vec3(0.40, 0.42, 0.45), scuff * 0.7 * amount);                    // bare metal showing through
  c = mix(c, c * 1.5 + 0.04, (1.0 - smoothstep(0.0, 0.010, ed)) * 0.28 * wf(uv * 45.0) * amount); // worn edges
  float rust = smoothstep(0.76, 0.84, wf(uv * 2.3 + 19.0)) * smoothstep(0.52, 0.76, wf(uv * 22.0)) * rustAmt;
  rust = max(rust, (1.0 - smoothstep(0.0, 0.012, ed)) * smoothstep(0.80, 0.94, wf(uv * 12.0 + 31.0)) * rustAmt * 0.8);
  c = mix(c, vec3(0.46, 0.19, 0.08) * (0.65 + 0.7 * wn(uv * 70.0)), rust * 0.75);
  c = mix(c, c * 0.45, seam * 0.7);
  c = mix(c, vec3(0.42, 0.44, 0.48), rivet * 0.55);
  wearRough = clamp(0.66 - 0.34 * scuff - 0.12 * rivet + 0.25 * rust + 0.1 * (wf(uv * 9.0) - 0.5), 0.22, 0.95);
  return c;
}
`;

// mat: a MeshStandardMaterial; rust 0..1 and wear 0..1 control how battered it looks
export function applyWear(mat, { rust = 0.7, wear = 1 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_DECL).replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position; vWN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = wearPaint(diffuseColor.rgb, vWP, normalize(vWN), ${wear.toFixed(2)}, ${rust.toFixed(2)});`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = wearRough;');
  };
  mat.customProgramCacheKey = () => `cockpitwear:${rust}:${wear}`;
  mat.needsUpdate = true;
  return mat;
}

// Scratches, grime and rust specks painted over the static instrument-panel art
export function weatherPanelCanvas(ctx, W, H) {
  ctx.save();
  for (let i = 0; i < 70; i++) { // grime pooled in the corners and around the edges of the panel
    const x = Math.random() < 0.5 ? Math.random() * W * 0.12 : W - Math.random() * W * 0.12, y = Math.random() * H, r = 40 + Math.random() * 150;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(0,0,0,${0.10 + Math.random() * 0.16})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 420; i++) { // fine scratches, mostly along the horizontal and vertical
    const x = Math.random() * W, y = Math.random() * H, len = 8 + Math.random() * 80, a = (Math.random() < 0.5 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.5;
    ctx.strokeStyle = `rgba(205,210,216,${0.035 + Math.random() * 0.08})`; ctx.lineWidth = 0.5 + Math.random() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
  }
  for (let i = 0; i < 26; i++) { // rust specks and flaked paint
    const x = Math.random() * W, y = Math.random() * H, r = 2 + Math.random() * 7;
    ctx.fillStyle = `rgba(${120 + Math.random() * 40},${50 + Math.random() * 20},20,${0.25 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + Math.random() * 0.5), Math.random() * 3, 0, 6.283); ctx.fill();
  }
  const v = ctx.createLinearGradient(0, 0, 0, H); v.addColorStop(0, 'rgba(0,0,0,0.30)'); v.addColorStop(0.12, 'rgba(0,0,0,0)'); v.addColorStop(0.9, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}
