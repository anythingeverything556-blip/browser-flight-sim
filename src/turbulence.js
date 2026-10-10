import * as THREE from 'three';

const Qo = 3.28084,
  dr = (s, t, e) => Math.min(e, Math.max(t, s)),
  Yh = () => {
    let s = 0;
    for (; s === 0;) s = Math.random();
    return Math.sqrt(-2 * Math.log(s)) * Math.cos(2 * Math.PI * Math.random());
  },
  Bl = Math.sqrt(3),
  oT = (s) => 0.2 + 7.5 * Math.pow(dr(s, 0, 1), 1.2);
function aT(s, t) {
  const e = Math.max(s * Qo, 10),
    n = 4 + 30 * dr(t, 0, 1),
    i = 0.177 + 823e-6 * e,
    r = { Lw: e / Qo, Lu: e / Math.pow(i, 1.2) / Qo, sw: 0.1 * n, su: (0.1 * n) / Math.pow(i, 0.4) },
    a = oT(t),
    l = { Lw: 1750 / Qo, Lu: 1750 / Qo, sw: a, su: a },
    h = dr((e - 1e3) / 1e3, 0, 1),
    u = (f, d) => f + (d - f) * h;
  return { Lu: u(r.Lu, l.Lu), Lw: u(r.Lw, l.Lw), su: u(r.su, l.su), sw: u(r.sw, l.sw) };
}
function windSpeedAt(s, t, e = t) {
  const i = dr(t, 0.1, 600);
  return s * Math.min(3, (Math.log(i / 0.05) / Math.log(10 / 0.05)) * (1 + dr(e, 0, 12e3) / 7e3));
}
class Turbulence {
  constructor() {
    (this.reset(),
      (this.out = new THREE.Vector3()),
      (this.fwd = new THREE.Vector3(1, 0, 0)),
      (this.side = new THREE.Vector3(0, 0, 1)));
  }
  reset() {
    ((this.u = 0), (this.v1 = this.v2 = this.w1 = this.w2 = 0), this.out && this.out.set(0, 0, 0));
  }
  update(t, e, n, i, r) {
    if (!(i > 0)) return (this.reset(), this.out);
    t = dr(t, 1e-4, 0.1);
    const a = Math.max(e, 15),
      l = aT(n, i),
      h = dr(n / 3, 0.15, 1),
      u = l.Lu / a,
      f = l.Lw / a,
      d = Math.exp(-t / u);
    this.u = d * this.u + l.su * Math.sqrt(1 - d * d) * Yh();
    const p = Math.exp(-t / u),
      v = Math.exp(-t / f),
      y = Yh() / Math.sqrt(t),
      x = Yh() / Math.sqrt(t);
    ((this.v1 = p * this.v1 + (1 - p) * y),
      (this.v2 = p * this.v2 + (1 - p) * this.v1),
      (this.w1 = v * this.w1 + (1 - v) * x),
      (this.w2 = v * this.w2 + (1 - v) * this.w1));
    const g = l.su * Math.sqrt(u) * (Bl * this.v1 + (1 - Bl) * this.v2),
      _ = l.sw * Math.sqrt(f) * (Bl * this.w1 + (1 - Bl) * this.w2);
    return (
      r && r.x * r.x + r.z * r.z > 1 ? this.fwd.set(r.x, 0, r.z).normalize() : this.fwd.set(1, 0, 0),
      this.side.set(-this.fwd.z, 0, this.fwd.x),
      this.out
        .set(0, _ * h, 0)
        .addScaledVector(this.fwd, this.u * h)
        .addScaledVector(this.side, g * h),
      this.out
    );
  }
}

export { Turbulence, windSpeedAt };
