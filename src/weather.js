// Weather presets and their screen-space effects: rain streaks that sweep past the camera at flight speed, a grey gloom that
// dims and desaturates the scene under cloud, a pale veil for fog, and lightning with thunder that arrives late.
import { stat } from './workstats.js';

export const WEATHER = {
  clear: { name: 'Clear', clouds: 0, wind: 4, turb: 0.04, vis: 1.8, rain: 0, gloom: 0, fog: 0, bolts: 0 },
  few: { name: 'Fair', clouds: 0.3, wind: 8, turb: 0.1, vis: 1.3, rain: 0, gloom: 0, fog: 0, bolts: 0 },
  scattered: { name: 'Scattered', clouds: 0.6, wind: 12, turb: 0.2, vis: 1.1, rain: 0, gloom: 0.12, fog: 0, bolts: 0 },
  overcast: { name: 'Overcast', clouds: 1, wind: 14, turb: 0.2, vis: 0.8, rain: 0, gloom: 0.42, fog: 0.1, bolts: 0 },
  rain: { name: 'Rain', clouds: 1, wind: 18, turb: 0.35, vis: 0.5, rain: 0.65, gloom: 0.55, fog: 0.2, bolts: 0 },
  storm: { name: 'Storm', clouds: 1, wind: 30, turb: 0.7, vis: 0.35, rain: 1, gloom: 0.72, fog: 0.25, bolts: 1 },
  fog: { name: 'Fog', clouds: 0.3, wind: 2, turb: 0.02, vis: 0.3, rain: 0, gloom: 0.2, fog: 0.85, bolts: 0 },
  windy: { name: 'Gusty', clouds: 0.3, wind: 26, turb: 0.5, vis: 1.2, rain: 0, gloom: 0, fog: 0, bolts: 0 },
};

export class Weather {
  constructor(rainCanvas, gloomEl, fogEl, boltEl) {
    this.cv = rainCanvas; this.x = rainCanvas.getContext('2d'); this.gloom = gloomEl; this.fog = fogEl; this.bolt = boltEl;
    this.rain = 0; this.rainTarget = 0; this.gloomTarget = 0; this.fogTarget = 0; this.bolts = 0; this.boltIn = 8; this.boltLevel = 0;
    this.gloomV = 0; this.fogV = 0; this.drops = []; this.thunder = []; this.w = 0; this.h = 0;
  }
  set(p) { this.rainTarget = p.rain; this.gloomTarget = p.gloom; this.fogTarget = p.fog; this.bolts = p.bolts; if (!p.bolts) this.boltIn = 8; }
  resize(w, h) { this.w = w; this.h = h; const r = Math.min(window.devicePixelRatio || 1, 1.5); this.cv.width = Math.round(w * r); this.cv.height = Math.round(h * r); this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px'; this.r = r; }
  // speed: airspeed in m/s; cockpit: looking out through the canopy
  update(dt, speed, cockpit, cam) {
    const k = 1 - Math.exp(-dt * 0.6);
    this.rain += (this.rainTarget - this.rain) * k; this.gloomV += (this.gloomTarget - this.gloomV) * k; this.fogV += (this.fogTarget - this.fogV) * k;
    if (this.gloom) this.gloom.style.opacity = this.gloomV.toFixed(3);
    if (this.fog) this.fog.style.opacity = this.fogV.toFixed(3);
    // lightning: a double flash, then thunder after the distance to the strike
    const events = [];
    // inside a thunderstorm cloud the strikes are close and frequent, even when no rain is falling at the ground
    const inStorm = this.bolts > 0 && (this.inCloud || 0) > 0.35;
    if (this.bolts > 0 && (this.rain > 0.5 || inStorm)) {
      this.boltIn -= dt;
      if (this.boltIn <= 0) { this.boltIn = inStorm ? 2.5 + Math.random() * 6 : 5 + Math.random() * 11; this.boltLevel = 1; this.flash2 = 0.12 + Math.random() * 0.1; const d = inStorm ? 120 + Math.random() * 1400 : 800 + Math.random() * 7000; events.push({ distance: d, level: 1 - d / 9000 }); this._newBolt(d); }
    }
    if (this.bolt) {
      if (this.boltLevel > 0.02) { this.boltLevel *= Math.exp(-dt * 9); if (this.flash2 > 0) { this.flash2 -= dt; if (this.flash2 <= 0) this.boltLevel = Math.max(this.boltLevel, 0.9); } this.bolt.style.opacity = Math.min(0.85, this.boltLevel).toFixed(3); }
      else if (this.boltLevel) { this.boltLevel = 0; this.bolt.style.opacity = '0'; }
    }
    this.draw(dt, speed, cockpit, cam);
    this._drawBolt(dt);
    return events;
  }
  // Rain is simulated as drops in camera space with a real depth, falling at the world's terminal velocity relative to the moving
  // camera, then projected with perspective: near drops are big and fast, far ones small and faint, and at speed the streaks
  // radiate from the point the camera is heading for. cam: { q: [x, y, z, w] camera orientation, fov: vertical degrees, vel: [x, y, z] m/s }
  draw(dt, speed, cockpit, cam) {
    const x = this.x, w = this.w, h = this.h;
    if (!w) return;
    // rain only falls out of the weather layer: it thins out between 4.5 km and 9 km and is gone above
    const alt = cam && cam.alt != null ? cam.alt : 0, k = Math.min(1, Math.max(0, (alt - 4500) / 4500)), rain = this.rain * (1 - k * k * (3 - 2 * k));
    this.eff = rain < 0.02 ? 0 : rain;
    // the 2D layer only has content for the 2D streaks, or the glass beads in the cockpit; otherwise clear it once and leave it alone
    const act = (rain >= 0.02 && (!this.field3d || (cockpit && !this.noBeads))) || (this.boltSegs && this.boltLife > 0);
    if (!act) {
      if (rain < 0.02) this.drops.length = 0;
      if (this._inked) { x.setTransform(this.r, 0, 0, this.r, 0, 0); x.clearRect(0, 0, w, h); this._inked = false; stat.did('rain2d.clear'); } else stat.skip('rain2d');
      return;
    }
    stat.did('rain2d'); this._inked = true;
    x.setTransform(this.r, 0, 0, this.r, 0, 0); x.clearRect(0, 0, w, h);
    if (rain < 0.02) return; // only a lightning bolt is on the canvas
    if (this.field3d) { if (cockpit && !this.noBeads) this._beads(x, dt, speed, w, h, rain); return; } // the streaks are real 3D geometry now
    const q = (cam && cam.q) || [0, 0, 0, 1], v = (cam && cam.vel) || [0, 0, 0];
    const tanH = Math.tan(((cam && cam.fov) || 55) * Math.PI / 360), f = 0.5 * h / tanH, aspect = w / h;
    // world rain velocity minus camera velocity, rotated into camera space (x right, y up, depth forward)
    // the camera's own speed is damped: at flight speed the true relative motion turns every drop into a streak radiating from the
    // heading point, which reads as a starfield rather than rain
    const damp = cockpit ? 0.1 : 0.07;
    const rv = rotInv(q, -v[0] * damp, -9 - v[1] * damp, -v[2] * damp);
    const vx = rv[0], vy = rv[1], vd = -rv[2];
    const FAR = 70 + 50 * (1 - rain), NEAR = cockpit ? 5 : 1.2;
    const target = Math.round((450 + 1900 * rain) * Math.min(2, (w * h) / (1280 * 720)));
    const place = (d, depth) => {
      const th = tanH * depth;
      d.d = depth; d.x = (Math.random() * 2 - 1) * th * aspect * 1.2; d.y = (Math.random() * 2 - 1) * th * 1.2;
      d.s = 0.8 + Math.random() * 0.5; d.l = Math.random();
    };
    // new drops enter on the upwind side: at the far end when we fly into the rain, the near end when it moves away
    const respawn = (d) => place(d, vd < -25 ? FAR * (0.75 + 0.25 * Math.random()) : NEAR + (FAR - NEAR) * Math.pow(Math.random(), 1.6));
    while (this.drops.length < target) { const d = {}; place(d, NEAR + (FAR - NEAR) * Math.pow(Math.random(), 1.6)); this.drops.push(d); }
    this.drops.length = Math.min(this.drops.length, target);
    const cx = w * 0.5, cy = h * 0.5, expo = 0.03, maxLen = cockpit ? 46 : 64, clipY = cockpit ? h * 0.62 : h * 2, fadeY = h * 0.14;
    x.lineCap = 'round';
    for (const d of this.drops) {
      d.x += vx * d.s * dt; d.y += vy * d.s * dt; d.d += vd * d.s * dt;
      const th = tanH * d.d;
      if (d.d < NEAR * 0.6 || d.d > FAR * 1.05 || Math.abs(d.x) > th * aspect * 1.4 || Math.abs(d.y) > th * 1.4) { respawn(d); continue; }
      const d0 = d.d, d1 = Math.max(0.4, d.d - vd * d.s * expo);
      const sx0 = cx + f * d.x / d0, sy0 = cy - f * d.y / d0;
      const sx1 = cx + f * (d.x - vx * d.s * expo) / d1, sy1 = cy - f * (d.y - vy * d.s * expo) / d1;
      let dx = sx1 - sx0, dy = sy1 - sy0; const len = Math.hypot(dx, dy);
      if (len > maxLen) { dx *= maxLen / len; dy *= maxLen / len; }
      const near = 1 - Math.min(1, d0 / FAR);
      // from the cockpit only the canopy glass at the top of the screen shows rain; the panel below stays dry
      const glass = cockpit ? Math.max(0, Math.min(1, (clipY - sy0) / fadeY)) : 1;
      if (glass <= 0) continue;
      x.strokeStyle = `rgba(214, 226, 240, ${((0.07 + 0.26 * near * near + 0.08 * d.l) * (0.45 + 0.55 * rain) * (cockpit ? 0.7 : 1) * glass).toFixed(3)})`;
      x.lineWidth = Math.min(1.7, 0.4 + 1.6 / (d0 * 0.35 + 1)) * (0.8 + 0.4 * d.l);
      x.beginPath(); x.moveTo(sx0, sy0); x.lineTo(sx0 + dx, sy0 + dy); x.stroke();
    }
    if (cockpit && !this.noBeads) this._beads(x, dt, speed, w, h, rain);
  }
  // A forked bolt: a jittered main channel from the cloud base to the ground with side branches, drawn as a bright core inside a blue glow,
  // flickering through the double flash. Distant strikes are thinner, shorter and dimmer.
  _newBolt(dist) {
    const w = this.w, h = this.h, sc = Math.max(0.25, 1 - dist / 9000), x0 = w * (0.12 + 0.76 * Math.random()), y0 = h * 0.02, y1 = h * (0.34 + 0.2 * (1 - sc) + 0.12 * Math.random());
    const segs = [], rnd = () => Math.random() - 0.5;
    const chan = (x, y, ex, ey, jit, depth) => {
      const n = 14 + ((Math.random() * 6) | 0); let px = x, py = y;
      for (let i = 1; i <= n; i++) {
        const t = i / n, nx = x + (ex - x) * t + rnd() * jit * (1 - t * 0.5), ny = y + (ey - y) * t + rnd() * jit * 0.25;
        segs.push([px, py, nx, ny, depth]); px = nx; py = ny;
        if (depth < 2 && Math.random() < 0.16) chan(nx, ny, nx + rnd() * h * 0.5 * sc, ny + (0.12 + Math.random() * 0.25) * h * sc, jit * 0.6, depth + 1);
      }
    };
    chan(x0, y0, x0 + rnd() * w * 0.1, y1, h * 0.07 * sc, 0);
    this.boltSegs = segs; this.boltLife = 0.5; this.boltSc = sc;
  }
  _drawBolt(dt) {
    if (!this.boltSegs || this.boltLife <= 0) return;
    this.boltLife -= dt; const x = this.x, t = this.boltLife;
    // main stroke, a gap, then a weaker return stroke
    const a = (t > 0.36 ? 1 : t > 0.3 ? 0.1 : t > 0.2 ? 0.75 : t > 0) * this.boltSc;
    if (a <= 0.01) return;
    x.save(); x.lineCap = 'round'; x.lineJoin = 'round';
    for (const [pass, col, wid] of [[0, 'rgba(120,150,255,A)', 9], [1, 'rgba(190,205,255,A)', 4], [2, 'rgba(255,255,255,A)', 1.7]]) {
      for (const [x0, y0, x1, y1, d] of this.boltSegs) {
        const k = d === 0 ? 1 : d === 1 ? 0.55 : 0.3;
        x.strokeStyle = col.replace('A', Math.min(1, a * (pass === 0 ? 0.25 : pass === 1 ? 0.55 : 1)).toFixed(3)); x.lineWidth = Math.max(0.6, wid * k * this.boltSc);
        x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
      }
    }
    x.restore();
  }
  // Water beads on the canopy glass: they sit still on the ground and get blown outward and up the glass once the jet moves.
  _beads(x, dt, speed, w, h, rain) {
    const want = Math.round((w * h) / 7000 * rain), top = h * 0.66, f = Math.min(1, speed / 110), cx = w * 0.5;
    const B = this.beads || (this.beads = []);
    while (B.length < want) B.push({ x: Math.random() * w, y: Math.random() * top, r: 1.2 + Math.random() * Math.random() * 4.2, age: Math.random() * 6, life: 4 + Math.random() * 6, tx: 0, ty: 0 });
    B.length = Math.min(B.length, want);
    for (const b of B) {
      b.age += dt;
      if (b.age > b.life) { b.x = Math.random() * w; b.y = Math.random() * top; b.r = 1.2 + Math.random() * Math.random() * 4.2; b.age = 0; b.life = 4 + Math.random() * 6; b.tx = b.ty = 0; }
      const k = (b.r / 5) * f;
      b.tx = (b.x - cx) / w * k * 380 * dt; b.ty = -k * 150 * dt + (1 - f) * b.r * 1.6 * dt;
      b.x += b.tx; b.y += b.ty;
      const a = Math.min(1, b.age / 0.6, (b.life - b.age) / 1.2) * (0.5 + 0.5 * rain);
      const fade = Math.max(0, Math.min(1, (top - b.y) / (h * 0.1)));
      if (a <= 0 || fade <= 0) continue;
      if (f > 0.15) { // wet trail behind a moving bead
        x.strokeStyle = `rgba(205, 222, 238, ${(0.16 * a * fade).toFixed(3)})`; x.lineWidth = Math.max(0.8, b.r * 0.55);
        x.beginPath(); x.moveTo(b.x, b.y); x.lineTo(b.x - b.tx * 9, b.y - b.ty * 9); x.stroke();
      }
      x.fillStyle = `rgba(190, 212, 232, ${(0.16 * a * fade).toFixed(3)})`; x.beginPath(); x.arc(b.x, b.y, b.r, 0, 6.2832); x.fill();
      x.strokeStyle = `rgba(235, 245, 255, ${(0.4 * a * fade).toFixed(3)})`; x.lineWidth = 0.8; x.beginPath(); x.arc(b.x, b.y, b.r, 0.5, 2.6); x.stroke();
      x.fillStyle = `rgba(255, 255, 255, ${(0.55 * a * fade).toFixed(3)})`; x.beginPath(); x.arc(b.x - b.r * 0.3, b.y - b.r * 0.35, Math.max(0.5, b.r * 0.22), 0, 6.2832); x.fill();
    }
  }
}

// rotate (x, y, z) by the inverse of quaternion q = [x, y, z, w]
function rotInv(q, x, y, z) {
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}
