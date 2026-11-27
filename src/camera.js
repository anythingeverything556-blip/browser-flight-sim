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
  cabinEye = new THREE.Vector3(),
  y2 = new THREE.Vector3(-9.5 - CG_MODEL.x, 3.2 - CG_MODEL.y, -6.2);
// aircraft-specific geometry (camera points relative to the CG, chase look-ahead, nearest orbit distance); the SR-71 values by default
const GEOM = { look: 12, minDist: 25, chase: 40 };
export function configureCameraAircraft({ eye, cabin, wing, look, minDist, chase }) { if (eye) _2.copy(eye); if (cabin) { cabinEye.copy(cabin); if (!VIEWS.includes('cabin')) VIEWS.push('cabin'); VIEW_NAMES.cabin = 'Passenger cabin'; } if (wing) y2.copy(wing); if (look) GEOM.look = look; if (minDist) GEOM.minDist = minDist; if (chase) GEOM.chase = chase; }
class CameraRig {
  constructor(t, e) {
    ((this.camera = t),
      (this.view = 'chase'),
      (this.world = new THREE.Vector3()),
      (this.look = { yaw: 0, pitch: -0.12 }),
      (this.externalLook = { yaw: 0, pitch: 0 }),
      (this.cockpitHome = null),
      (this.orbit = { az: 2.6, el: 0.18, dist: 48 }),
      (this.fov = { cockpit: 84, other: 55 }),
      (this.chasePos = null),
      (this.flyPos = null),
      (this.tower = null),
      (this.shake = 0),
      (this.shakeT = 0),
      (this.blockDrag = !1)); // set by the cockpit throttle-lever drag: that drag must not also turn the view
    // Per-rig scratch: camera math runs every rendered frame. Do not borrow the
    // aircraft vectors or persistent chase/fly-by positions (rebased by main.js).
    this._position = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._goalOffset = new THREE.Vector3();
    this._lookDirection = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._zero = new THREE.Vector3();
    this._rotation = new THREE.Matrix4();
    this._quaternion = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this.inputEnabled = () => true;
    let drag = null;
    const cancel = () => {
      const id = drag?.pointerId;
      drag = null;
      this.blockDrag = false;
      if (id !== undefined && e.hasPointerCapture?.(id)) e.releasePointerCapture(id);
    };
    this.cancelDrag = cancel;
    e.addEventListener('pointerdown', (event) => {
      if (!this.inputEnabled() || drag || (event.button !== 0 && event.button !== 2)) return;
      drag = { pointerId: event.pointerId, mask: event.button === 2 ? 2 : 1, x: event.clientX, y: event.clientY };
      e.setPointerCapture?.(event.pointerId);
    });
    const end = (event) => { if (drag?.pointerId === event.pointerId) cancel(); };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    e.addEventListener('lostpointercapture', end);
    window.addEventListener('blur', cancel);
    e.ownerDocument?.addEventListener('visibilitychange', () => { if (e.ownerDocument.hidden) cancel(); });
    window.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      // The original button must still be held: a missed release must never resume a drag.
      if (!this.inputEnabled() || !(event.buttons & drag.mask)) { cancel(); return; }
      if (this.blockDrag) return;
      const dx = (event.clientX - drag.x) * 0.005, dy = (event.clientY - drag.y) * 0.005;
      drag.x = event.clientX; drag.y = event.clientY;
      this.pan(-dx, this.view === 'orbit' ? dy : -dy);
    });
    e.addEventListener('wheel', (event) => {
      if (this.inputEnabled()) this.zoom(Math.exp(event.deltaY * 0.001));
    }, { passive: true });
    e.addEventListener('dblclick', () => { if (this.inputEnabled()) this.recenter(); });
  }
  pan(yaw, pitch) {
    if (this.view === 'orbit') {
      this.orbit.az += yaw;
      this.orbit.el = THREE.MathUtils.clamp(this.orbit.el + pitch, -1.2, 1.45);
    } else {
      const look = ['cockpit', 'cabin', 'wing'].includes(this.view) ? this.look : this.externalLook;
      look.yaw += yaw;
      look.pitch = THREE.MathUtils.clamp(look.pitch + pitch, -1.4, 1.4);
    }
  }
  zoom(factor) {
    if (['cockpit', 'cabin', 'wing'].includes(this.view)) this.fov.cockpit = THREE.MathUtils.clamp(this.fov.cockpit * factor, 20, 100);
    else if (this.view === 'tower' || this.view === 'flyby') this.fov.other = THREE.MathUtils.clamp(this.fov.other * factor, 2, 70);
    else this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * factor, GEOM.minDist, 3e3);
  }
  recenter() {
    this.cancelDrag();
    this.look.yaw = this.view === 'cabin' ? Math.PI : 0;
    this.look.pitch = this.view === 'cabin' ? -0.04 : -0.12;
    this.externalLook.yaw = this.externalLook.pitch = 0;
    this.fov.cockpit = 84; this.fov.other = 55;
    this.orbit.az = 2.6; this.orbit.el = 0.18;
    this.orbit.dist = Math.max(GEOM.minDist, GEOM.chase);
    if (this.view === 'cockpit' && this.cockpitHome) this.recenterCockpit();
  }
  recenterCockpit() {
    if (!this.cockpitHome) return;
    const { pitch, yaw, fov } = this.cockpitHome;
    this.look.pitch = pitch; this.look.yaw = yaw; this.fov.cockpit = fov;
  }
  set(t) {
    this.cancelDrag();
    // The passenger eye is near the front of the cabin: face aft down the original aisle.
    if (t === 'cabin') { this.look.yaw = Math.PI; this.look.pitch = -0.04; }
    else if (this.view === 'cabin') { this.look.yaw = 0; this.look.pitch = -0.12; }
    ((this.view = t),
      (this.chasePos = null),
      (this.flyPos = null),
      t === 'chase' &&
        ((this.orbit.az = Math.PI), (this.orbit.el = 0.16), (this.orbit.dist = Math.max(this.orbit.dist, GEOM.chase))));
  }
  next(t = 1) {
    const e = VIEWS.indexOf(this.view);
    return (this.set(VIEWS[(e + t + VIEWS.length) % VIEWS.length]), this.view);
  }
  update(t, e, n, i, r = 0) {
    const a = this.camera,
      l = e.quat,
      h = e.pos,
      u = this._position.set(0, 0, 0);
    let f = null;
    if (((a.near = 0.05), this.view === 'cockpit' || this.view === 'cabin' || this.view === 'wing')) {
      u.copy(this.view === 'cockpit' ? _2 : this.view === 'cabin' ? cabinEye : y2)
        .applyQuaternion(l)
        .add(h);
      const p = this._quaternion.setFromEuler(
        this._euler.set(this.look.pitch, this.look.yaw - Math.PI / 2, 0, 'YXZ'),
      );
      (a.quaternion.copy(l).multiply(p), (a.fov = this.fov.cockpit));
    } else if (this.view === 'chase') {
      const p = this._direction.set(-1, 0, 0).applyQuaternion(l),
        v = this.orbit.dist,
        y = this._target
          .copy(h)
          .addScaledVector(p, v)
          .add(this._offset.set(0, v * 0.2, 0));
      (!this.chasePos || this.chasePos.distanceTo(y) > v * 4) && (this.chasePos = y.clone());
      const x = this._offset.copy(this.chasePos).sub(h),
        g = this._goalOffset.copy(y).sub(h);
      (x.lerp(g, 1 - Math.exp(-t * 3)).setLength(v),
        this.chasePos.copy(h).add(x),
        u.copy(this.chasePos),
        (f = this._target.copy(h).addScaledVector(p, -GEOM.look)),
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
        const v = e.vel.lengthSq() > 1 ? this._direction.copy(e.vel).normalize() : this._direction.set(1, 0, 0).applyQuaternion(l),
          y = this._offset.crossVectors(v, this._up).normalize(),
          x = Math.min(1200, Math.max(150, e.vel.length() * 4));
        (this.flyPos ||= new THREE.Vector3()).copy(h)
          .addScaledVector(v, x)
          .addScaledVector(y, 60)
          .add(this._goalOffset.set(0, 8, 0));
      }
      (u.copy(this.flyPos), (f = h));
      const p = u.distanceTo(h);
      ((a.fov = THREE.MathUtils.clamp((2 * Math.atan(45 / p) * 180) / Math.PI * (this.fov.other / 55), 2, 70)), (a.near = 1));
    }
    if (this.view !== 'cockpit' && this.view !== 'cabin' && this.view !== 'wing') {
      const p = n(u.x, u.z);
      u.y < p + 2 && (u.y = p + 2);
    }
    if ((this.world.copy(u), a.position.set(0, 0, 0), f)) {
      const p = this._rotation.lookAt(this._zero, this._lookDirection.copy(f).sub(u), this._up);
      a.quaternion.setFromRotationMatrix(p);
      // Orbit pans around the aircraft; other external views can look away from their tracked target.
      if (this.view !== 'orbit' && (this.externalLook.pitch || this.externalLook.yaw)) a.quaternion.multiply(this._quaternion.setFromEuler(
        this._euler.set(this.externalLook.pitch, this.externalLook.yaw, 0, 'YXZ'),
      ));
    }
    this.shakeT += t;
    const d = r * (this.view === 'cockpit' ? 1 : this.view === 'chase' || this.view === 'wing' ? 0.45 : 0.15);
    if (d > 0.001) {
      const p = this.shakeT,
        v = (y, x, g) => Math.sin(p * y) * 0.5 + Math.sin(p * x + 1.3) * 0.3 + Math.sin(p * g + 2.1) * 0.2;
      a.quaternion.multiply(
        this._quaternion.setFromEuler(
          this._euler.set(v(37, 61, 89) * 0.012 * d, v(29, 53, 97) * 0.008 * d, v(41, 71, 113) * 0.01 * d, 'XYZ'),
        ),
      );
    }
    a.updateProjectionMatrix();
  }
}

export { CameraRig, VIEWS, VIEW_NAMES };
