// Scene depth texture -> view distance w (m along the view axis), for both depth modes the renderer can run in.
//
// log depth (three's logdepthbuf, Low and browsers without EXT_clip_control): d = log2(1 + w) / log2(far + 1)   uDepthK = (log2(far + 1), 0)
// reversed depth (EXT_clip_control, 0..1 clip, 1 = near, 0 = far): three r180 projects with c = n/(f-n), d = f*n/(f-n), so
//   d = A / w - B with A = f*n/(f-n), B = n/(f-n), and w = A / (d + B)                                             uDepthK = (A, B), B > 0
// The cleared depth (sky) is 1 in log mode and exactly 0 in reversed mode. Terrain 100+ km away reads d ~ 1e-7 under reversed depth, so the
// sky test there is d <= 0, not a small threshold.
export const DEPTH_GLSL = `
uniform vec2 uDepthK;
float depthW(float d) { return uDepthK.y > 0.0 ? uDepthK.x / (d + uDepthK.y) : exp2(d * uDepthK.x) - 1.0; }
bool depthSky(float d) { return uDepthK.y > 0.0 ? d <= 0.0 : d > 0.99999; }
`;

export const isReversed = (renderer) => !!(renderer && renderer.state && renderer.state.buffers.depth.getReversed());

// out: THREE.Vector2 (or anything with set(x, y)); n/f from the camera
export function depthK(camera, reversed, out) {
  const n = camera.near, f = camera.far;
  return reversed ? out.set((f * n) / (f - n), n / (f - n)) : out.set(Math.log2(f + 1), 0);
}

// JS mirror of the GLSL, for the tests
export const decodeDepth = (d, kx, ky) => (ky > 0 ? kx / (d + ky) : 2 ** (d * kx) - 1);
export const depthIsSky = (d, ky) => (ky > 0 ? d <= 0 : d > 0.99999);
