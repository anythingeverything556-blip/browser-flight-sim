import * as THREE from 'three';
import { CG_MODEL } from './flight.js';

const VIEWS = ['cockpit', 'chase', 'orbit', 'tower', 'wing', 'flyby'],
  VIEW_NAMES = {
    cockpit: 'Cockpit',
    chase: 'Chase',
    orbit: 'Free orbit',
    tower: 'Tower',
    wing: 'Wing',
    flyby: 'Fly-by',
  },
  _2 = new THREE.Vector3(11.22 - CG_MODEL.x, 3.31 - CG_MODEL.y, 0),
  y2 = new THREE.Vector3(-9.5 - CG_MODEL.x, 3.2 - CG_MODEL.y, -6.2);
class CameraRig {
  constructor(t, e) {
    ((this.camera = t),
      (this.view = 'chase'),
      (this.world = new THREE.Vector3()),
      (this.look = { yaw: 0, pitch: -0.12 }),
      (this.orbit = { az: 2.6, el: 0.18, dist: 48 }),
      (this.fov = { cockpit: 84, other: 55 }),
      (this.chasePos = null),
      (this.flyPos = null),
      (this.tower = null),
      (this.shake = 0),
      (this.shakeT = 0));
    let n = null;
    (e.addEventListener('pointerdown', (i) => {
      (i.button === 0 || i.button === 2) && (n = { x: i.clientX, y: i.clientY });
    }),
      window.addEventListener('pointerup', () => {
        n = null;
      }),
      window.addEventListener('pointermove', (i) => {
        if (!n) return;
        const r = (i.clientX - n.x) * 0.005,
          a = (i.clientY - n.y) * 0.005;
        ((n = { x: i.clientX, y: i.clientY }),
          this.view === 'cockpit' || this.view === 'wing'
            ? ((this.look.yaw -= r), (this.look.pitch = THREE.MathUtils.clamp(this.look.pitch - a, -1.4, 1.4)))
            : ((this.orbit.az -= r), (this.orbit.el = THREE.MathUtils.clamp(this.orbit.el + a, -1.2, 1.45))));
      }),
      e.addEventListener(
        'wheel',
        (i) => {
          const r = Math.exp(i.deltaY * 0.001);
          this.view === 'cockpit' || this.view === 'wing'
            ? (this.fov.cockpit = THREE.MathUtils.clamp(this.fov.cockpit * r, 20, 100))
            : this.view === 'tower' || this.view === 'flyby'
              ? (this.fov.other = THREE.MathUtils.clamp(this.fov.other * r, 2, 70))
              : (this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * r, 25, 3e3));
        },
        { passive: !0 },
      ),
      e.addEventListener('dblclick', () => {
        ((this.look.yaw = 0), (this.look.pitch = -0.12));
      }));
  }
  set(t) {
    ((this.view = t),
      (this.chasePos = null),
      (this.flyPos = null),
      t === 'chase' &&
        ((this.orbit.az = Math.PI), (this.orbit.el = 0.16), (this.orbit.dist = Math.max(this.orbit.dist, 40))));
  }
  next(t = 1) {
    const e = VIEWS.indexOf(this.view);
    return (this.set(VIEWS[(e + t + VIEWS.length) % VIEWS.length]), this.view);
  }
  update(t, e, n, i, r = 0) {
    const a = this.camera,
      l = e.quat,
      h = e.pos,
      u = new THREE.Vector3();
    let f = null;
    if (((a.near = 0.05), this.view === 'cockpit' || this.view === 'wing')) {
      u.copy(this.view === 'cockpit' ? _2 : y2)
        .applyQuaternion(l)
        .add(h);
      const p = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.look.pitch, this.look.yaw - Math.PI / 2, 0, 'YXZ'),
      );
      (a.quaternion.copy(l).multiply(p), (a.fov = this.fov.cockpit));
    } else if (this.view === 'chase') {
      const p = new THREE.Vector3(-1, 0, 0).applyQuaternion(l),
        v = this.orbit.dist,
        y = h
          .clone()
          .addScaledVector(p, v)
          .add(new THREE.Vector3(0, v * 0.2, 0));
      (!this.chasePos || this.chasePos.distanceTo(y) > v * 4) && (this.chasePos = y.clone());
      const x = this.chasePos.clone().sub(h),
        g = y.clone().sub(h);
      (x.lerp(g, 1 - Math.exp(-t * 3)).setLength(v),
        this.chasePos.copy(h).add(x),
        u.copy(this.chasePos),
        (f = h.clone().addScaledVector(p, -12)),
        (a.fov = 55),
        (a.near = 0.5));
    } else if (this.view === 'orbit') {
      const p = this.orbit;
      (u
        .set(Math.sin(p.az) * Math.cos(p.el), Math.sin(p.el), Math.cos(p.az) * Math.cos(p.el))
        .multiplyScalar(p.dist)
        .add(h),
        (f = h),
        (a.fov = 55),
        (a.near = 0.5));
    } else if (this.view === 'tower') {
      (u.set(i.x, i.y + 35, i.z), (f = h));
      const p = u.distanceTo(h);
      ((a.fov = THREE.MathUtils.clamp((2 * Math.atan(60 / p) * 180) / Math.PI, 1.2, this.fov.other)), (a.near = 1));
    } else if (this.view === 'flyby') {
      if (!this.flyPos || this.flyPos.distanceTo(h) > 1500 || e.vel.length() < 1) {
        const v = e.vel.lengthSq() > 1 ? e.vel.clone().normalize() : new THREE.Vector3(1, 0, 0).applyQuaternion(l),
          y = new THREE.Vector3().crossVectors(v, new THREE.Vector3(0, 1, 0)).normalize(),
          x = Math.min(1200, Math.max(150, e.vel.length() * 4));
        this.flyPos = h
          .clone()
          .addScaledVector(v, x)
          .addScaledVector(y, 60)
          .add(new THREE.Vector3(0, 8, 0));
      }
      (u.copy(this.flyPos), (f = h));
      const p = u.distanceTo(h);
      ((a.fov = THREE.MathUtils.clamp((2 * Math.atan(45 / p) * 180) / Math.PI, 2, 60)), (a.near = 1));
    }
    if (this.view !== 'cockpit' && this.view !== 'wing') {
      const p = n(u.x, u.z);
      u.y < p + 2 && (u.y = p + 2);
    }
    if ((this.world.copy(u), a.position.set(0, 0, 0), f)) {
      const p = new THREE.Matrix4().lookAt(new THREE.Vector3(), f.clone().sub(u), new THREE.Vector3(0, 1, 0));
      a.quaternion.setFromRotationMatrix(p);
    }
    this.shakeT += t;
    const d = r * (this.view === 'cockpit' ? 1 : this.view === 'chase' || this.view === 'wing' ? 0.45 : 0.15);
    if (d > 0.001) {
      const p = this.shakeT,
        v = (y, x, g) => Math.sin(p * y) * 0.5 + Math.sin(p * x + 1.3) * 0.3 + Math.sin(p * g + 2.1) * 0.2;
      a.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(v(37, 61, 89) * 0.012 * d, v(29, 53, 97) * 0.008 * d, v(41, 71, 113) * 0.01 * d),
        ),
      );
    }
    a.updateProjectionMatrix();
  }
}

export { CameraRig, VIEWS, VIEW_NAMES };
